import "server-only";

import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

const DNS_TIMEOUT_MS = 3_000;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "169.254.169.254",
]);

const blockedNetworks = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blockedNetworks.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
  ["::", 96],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) blockedNetworks.addSubnet(address, prefix, "ipv6");

export type HubAdHostnameResolver = (hostname: string) => Promise<readonly string[]>;

export type HubAdHostnameAssessment =
  | { allowed: true; addresses: readonly string[] }
  | { allowed: false; reason: "unsafe_hostname" | "dns_resolution_failed" | "unsafe_dns" };

function normalizeHostname(hostname: string) {
  const lowered = hostname.trim().toLowerCase().replace(/\.$/, "");
  return lowered.startsWith("[") && lowered.endsWith("]") ? lowered.slice(1, -1) : lowered;
}

export function isAllowedHubAdHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  if (!host || host.includes("%") || BLOCKED_HOSTS.has(host)
    || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  const family = isIP(host);
  return family === 0 || isPublicHubAdNetworkAddress(host);
}

export function isPublicHubAdNetworkAddress(address: string) {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized);
  if (family === 4) return !blockedNetworks.check(normalized, "ipv4");
  if (family === 6) return !blockedNetworks.check(normalized, "ipv6");
  return false;
}

export const resolveHubAdHostname: HubAdHostnameResolver = async (hostname) => {
  const host = normalizeHostname(hostname);
  if (isIP(host)) return [host];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("hub_ad_dns_timeout")), DNS_TIMEOUT_MS);
  });
  try {
    const responses = await Promise.race([
      Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]),
      deadline,
    ]);
    const addresses = responses.flatMap((response) => response.status === "fulfilled" ? response.value : []);
    if (addresses.length === 0) throw new Error("hub_ad_dns_no_address");
    return [...new Set(addresses.map(normalizeHostname))];
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export async function assessHubAdHostname(
  hostname: string,
  resolver: HubAdHostnameResolver = resolveHubAdHostname,
): Promise<HubAdHostnameAssessment> {
  // This is a fail-closed DNS preflight, not transport pinning. The caller must
  // still use public-only egress; a dedicated scanner must pin the approved IP
  // when the remaining DNS-resolution-to-connect rebinding window is closed.
  const host = normalizeHostname(hostname);
  if (!isAllowedHubAdHostname(host)) return { allowed: false, reason: "unsafe_hostname" };
  let addresses: readonly string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { allowed: false, reason: "dns_resolution_failed" };
  }
  if (addresses.length === 0) return { allowed: false, reason: "dns_resolution_failed" };
  if (addresses.some((address) => !isPublicHubAdNetworkAddress(address))) {
    return { allowed: false, reason: "unsafe_dns" };
  }
  return { allowed: true, addresses };
}
