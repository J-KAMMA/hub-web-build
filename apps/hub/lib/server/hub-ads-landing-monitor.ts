import "server-only";

import { createHash } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { validateLandingUrl } from "@/lib/hub-ads";
import {
  createHubAdLandingEgressFetcher,
  HubAdsEgressScannerError,
  type HubAdEgressBinding,
} from "@/lib/server/hub-ads-egress-scanner-client";
import {
  assessHubAdHostname,
  isAllowedHubAdHostname,
  resolveHubAdHostname,
  type HubAdHostnameResolver,
} from "@/lib/server/hub-ads-landing-network-policy";

const BLOCKED_PATH = /\/(?:login|signin|sign-in|auth|oauth|checkout|account)(?:\/|$)/i;
const LANDING_RECHECK_MS = 6 * 60 * 60 * 1000;
const LANDING_LEASE_MS = 2 * 60 * 1000;

export interface LandingCheckResult { result: "passed" | "failed" | "error"; reasonCode: string; finalHost?: string; httpStatus?: number; redirectCount: number; }

export type HubAdLandingCheckLease = {
  creativeId: string;
  creativeVersionId: string;
  landingUrl: string;
  leaseToken: string;
  claimedAt: number;
  expiresAt: number;
};

function leaseHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function inspectHubAdLandingUrl(
  initial: string,
  fetcher?: typeof fetch,
  resolver: HubAdHostnameResolver = resolveHubAdHostname,
  binding?: HubAdEgressBinding,
): Promise<LandingCheckResult> {
  let url = validateLandingUrl(initial);
  if (!url || !isAllowedHubAdHostname(url.hostname)) {
    return { result: "failed", reasonCode: "unsafe_url", redirectCount: 0 };
  }
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (BLOCKED_PATH.test(url.pathname)) return { result: "failed", reasonCode: "blocked_destination", finalHost: url.hostname, redirectCount: redirects };
    const network = await assessHubAdHostname(url.hostname, resolver);
    if (!network.allowed) {
      const reasonCode = network.reason === "unsafe_dns"
        ? (redirects === 0 ? "unsafe_dns" : "unsafe_redirect_dns")
        : (redirects === 0 ? "dns_resolution_failed" : "redirect_dns_resolution_failed");
      return { result: network.reason === "dns_resolution_failed" ? "error" : "failed", reasonCode, finalHost: url.hostname, redirectCount: redirects };
    }
    let response: Response;
    try {
      const outbound = fetcher ?? (binding ? createHubAdLandingEgressFetcher(binding) : null);
      if (!outbound) throw new HubAdsEgressScannerError("error", "egress_scanner_unavailable");
      response = await outbound(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000), headers: {
      accept: "text/html,application/xhtml+xml", range: "bytes=0-4095", "user-agent": "HubAdsLandingMonitor/1.0",
    } });
    } catch (error) {
      if (error instanceof HubAdsEgressScannerError) {
        return { result: error.result, reasonCode: error.reasonCode, finalHost: url.hostname, redirectCount: redirects };
      }
      return { result: "error", reasonCode: "fetch_failed", finalHost: url.hostname, redirectCount: redirects };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location || redirects === 3) return { result: "failed", reasonCode: "invalid_redirect", finalHost: url.hostname, httpStatus: response.status, redirectCount: redirects };
      const next = validateLandingUrl(new URL(location, url).toString());
      if (!next || !isAllowedHubAdHostname(next.hostname)) return { result: "failed", reasonCode: "unsafe_redirect", finalHost: url.hostname, httpStatus: response.status, redirectCount: redirects + 1 };
      url = next; continue;
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    const attachment = response.headers.get("content-disposition")?.toLowerCase().includes("attachment"); await response.body?.cancel();
    if (response.status < 200 || response.status >= 400) return { result: "failed", reasonCode: "http_status", finalHost: url.hostname, httpStatus: response.status, redirectCount: redirects };
    if (attachment || (contentType !== "text/html" && contentType !== "application/xhtml+xml")) return { result: "failed", reasonCode: "unsupported_content", finalHost: url.hostname, httpStatus: response.status, redirectCount: redirects };
    return { result: "passed", reasonCode: "ok", finalHost: url.hostname, httpStatus: response.status, redirectCount: redirects };
  }
  return { result: "failed", reasonCode: "invalid_redirect", redirectCount: 3 };
}

export async function checkHubAdCreativeLanding(
  database: D1Database,
  creativeId: string,
  fetcher?: typeof fetch,
  now = Date.now(),
  resolver: HubAdHostnameResolver = resolveHubAdHostname,
) {
  const row = await database.prepare(`SELECT cv.id, cv.landing_url FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv
    ON cv.creative_id = cr.id AND cv.version = cr.current_version WHERE cr.id = ? AND cr.status != 'archived'`)
    .bind(creativeId).first<{ id: string; landing_url: string }>();
  if (!row) return null;
  const check = await inspectHubAdLandingUrl(row.landing_url, fetcher, resolver, {
    creativeVersionId: row.id,
    initialUrlHash: createHash("sha256").update(row.landing_url).digest("hex"),
  });
  await database.prepare(`INSERT INTO hub_ad_landing_checks
    (id, creative_version_id, url_hash, final_host, result, reason_code, http_status, redirect_count, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), row.id, createHash("sha256").update(row.landing_url).digest("hex"), check.finalHost ?? null,
      check.result, check.reasonCode, check.httpStatus ?? null, check.redirectCount, now).run();
  return check;
}

export async function claimDueHubAdLanding(database: D1Database, now = Date.now()) {
  const candidate = await database.prepare(`SELECT cr.id creativeId,cv.id creativeVersionId,cv.landing_url landingUrl
    FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv
      ON cv.creative_id=cr.id AND cv.version=cr.current_version
    LEFT JOIN hub_ad_landing_check_leases lease ON lease.creative_version_id=cv.id
    WHERE cr.status!='archived'
      AND NOT EXISTS(SELECT 1 FROM hub_ad_landing_checks lc
        WHERE lc.creative_version_id=cv.id AND lc.checked_at>=?)
      AND (lease.creative_version_id IS NULL OR lease.lease_expires_at<?)
    ORDER BY cr.updated_at ASC,cv.id ASC LIMIT 1`)
    .bind(now - LANDING_RECHECK_MS, now)
    .first<{ creativeId: string; creativeVersionId: string; landingUrl: string }>();
  if (!candidate) return null;
  const leaseToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const expiresAt = now + LANDING_LEASE_MS;
  const claimed = await database.prepare(`INSERT INTO hub_ad_landing_check_leases(
      creative_version_id,lease_token_hash,lease_expires_at,claimed_at,updated_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(creative_version_id) DO UPDATE SET
      lease_token_hash=excluded.lease_token_hash,lease_expires_at=excluded.lease_expires_at,
      claimed_at=excluded.claimed_at,updated_at=excluded.updated_at
    WHERE hub_ad_landing_check_leases.lease_expires_at<excluded.claimed_at`)
    .bind(candidate.creativeVersionId, leaseHash(leaseToken), expiresAt, now, now).run();
  if ((claimed.meta.changes ?? 0) !== 1) return null;
  return { ...candidate, leaseToken, claimedAt: now, expiresAt } satisfies HubAdLandingCheckLease;
}

export async function recordLeasedHubAdLandingCheck(
  database: D1Database,
  lease: HubAdLandingCheckLease,
  check: LandingCheckResult,
  now = Date.now(),
) {
  const checkId = crypto.randomUUID();
  const tokenHash = leaseHash(lease.leaseToken);
  const results = await database.batch([
    database.prepare(`INSERT INTO hub_ad_landing_checks(
        id,creative_version_id,url_hash,final_host,result,reason_code,http_status,redirect_count,checked_at,check_source
      ) SELECT ?,cv.id,?,?,?,?,?,?,?,'maintenance'
      FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv
        ON cv.creative_id=cr.id AND cv.version=cr.current_version
      JOIN hub_ad_landing_check_leases lease ON lease.creative_version_id=cv.id
      WHERE cr.id=? AND cv.id=? AND cv.landing_url=?
        AND lease.lease_token_hash=? AND lease.lease_expires_at>=?
        AND NOT EXISTS(SELECT 1 FROM hub_ad_landing_checks newer
          WHERE newer.creative_version_id=cv.id AND newer.checked_at>=?)`)
      .bind(checkId, createHash("sha256").update(lease.landingUrl).digest("hex"), check.finalHost ?? null,
        check.result, check.reasonCode, check.httpStatus ?? null, check.redirectCount, now,
        lease.creativeId, lease.creativeVersionId, lease.landingUrl, tokenHash, now, lease.claimedAt),
    database.prepare(`DELETE FROM hub_ad_landing_check_leases
      WHERE creative_version_id=? AND lease_token_hash=?
        AND EXISTS(SELECT 1 FROM hub_ad_landing_checks WHERE id=?)`)
      .bind(lease.creativeVersionId, tokenHash, checkId),
  ]);
  return results.every((result) => (result.meta.changes ?? 0) === 1) ? { id: checkId, ...check } : null;
}

export async function monitorDueHubAdLandings(
  database: D1Database,
  fetcher?: typeof fetch,
  now = Date.now(),
  resolver: HubAdHostnameResolver = resolveHubAdHostname,
) {
  let claimed = 0;
  let checked = 0;
  for (let index = 0; index < 25; index += 1) {
    const lease = await claimDueHubAdLanding(database, now);
    if (!lease) break;
    claimed += 1;
    const result = await inspectHubAdLandingUrl(lease.landingUrl, fetcher, resolver, {
      creativeVersionId: lease.creativeVersionId,
      initialUrlHash: createHash("sha256").update(lease.landingUrl).digest("hex"),
    });
    if (await recordLeasedHubAdLandingCheck(database, lease, result, now)) checked += 1;
  }
  return { claimed, checked };
}
