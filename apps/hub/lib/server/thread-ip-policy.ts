export type ThreadIpPolicy = {
  mode: "none" | "allow" | "deny";
  cidrs: string[];
};

const IPV4 = /^(\d{1,3})(?:\.(\d{1,3})){3}$/;

export function normalizeThreadIpPolicy(value: unknown): ThreadIpPolicy {
  if (!value || typeof value !== "object") return { mode: "none", cidrs: [] };
  const source = value as { mode?: unknown; cidrs?: unknown };
  const mode = source.mode === "allow" || source.mode === "deny" ? source.mode : "none";
  const cidrs = [...new Set((Array.isArray(source.cidrs) ? source.cidrs : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(isValidIpRule))].slice(0, 20);
  return mode === "none" || !cidrs.length ? { mode: "none", cidrs: [] } : { mode, cidrs };
}

export function parseStoredThreadIpPolicy(value: string | null | undefined): ThreadIpPolicy {
  try { return normalizeThreadIpPolicy(JSON.parse(value ?? "{}")); }
  catch { return { mode: "none", cidrs: [] }; }
}

export function requestClientIp(request: Request): string | null {
  return normalizeIp(request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip"));
}

export function enforceThreadIpPolicy(policy: ThreadIpPolicy, ip: string | null): string | null {
  if (policy.mode === "none") return null;
  if (!ip) return "このスレッドはIP制限が有効ですが、接続元を安全に確認できません。";
  const matched = policy.cidrs.some((rule) => ipMatchesRule(ip, rule));
  if (policy.mode === "allow" && !matched) return "この接続元IPからは書き込めません。";
  if (policy.mode === "deny" && matched) return "この接続元IPからは書き込めません。";
  return null;
}

function normalizeIp(value: string | null): string | null {
  const ip = value?.trim().replace(/^\[|\]$/g, "") ?? "";
  return isIpv4(ip) || ip.includes(":") && /^[0-9a-f:]+$/i.test(ip) ? ip.toLowerCase() : null;
}

function isIpv4(value: string): boolean {
  return IPV4.test(value) && value.split(".").every((part) => Number(part) <= 255);
}

function isValidIpRule(value: string): boolean {
  const [address, prefixText] = value.split("/");
  if (isIpv4(address)) return prefixText === undefined || /^\d+$/.test(prefixText) && Number(prefixText) <= 32;
  return address.includes(":") && /^[0-9a-f:]+$/i.test(address) && prefixText === undefined;
}

function ipMatchesRule(ip: string, rule: string): boolean {
  const [address, prefixText] = rule.toLowerCase().split("/");
  if (!isIpv4(ip) || !isIpv4(address)) return prefixText === undefined && ip === address;
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  const toNumber = (value: string) => value.split(".").reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (toNumber(ip) & mask) === (toNumber(address) & mask);
}
