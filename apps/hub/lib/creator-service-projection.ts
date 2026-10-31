export const CREATOR_AGGREGATE_PROJECTION_VERSION = 1 as const;

export type CreatorServiceId = "commerce" | "music" | "advertising";
export type CreatorProjectionStatus = "ready" | "empty" | "not_connected" | "unavailable";

export type CreatorProjectionMetric = {
  id: string;
  label: string;
  value: number;
  unit?: "件" | "円" | "JPYC" | "回" | "USDC";
};

export type CreatorServiceProjection = {
  version: typeof CREATOR_AGGREGATE_PROJECTION_VERSION;
  service: CreatorServiceId;
  status: CreatorProjectionStatus;
  href: string;
  metrics: CreatorProjectionMetric[];
};

const serviceHref: Record<CreatorServiceId, string> = {
  commerce: "/market/sell",
  music: "/music/studio",
  advertising: "/advertising/dashboard",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function moneyFromMicros(value: unknown): number | null {
  const micros = count(value);
  return micros === null ? null : Math.round(micros / 1_000_000);
}

function projection(
  service: CreatorServiceId,
  status: CreatorProjectionStatus,
  metrics: CreatorProjectionMetric[] = [],
): CreatorServiceProjection {
  return {
    version: CREATOR_AGGREGATE_PROJECTION_VERSION,
    service,
    status,
    href: serviceHref[service],
    metrics,
  };
}

export function unavailableCreatorProjection(service: CreatorServiceId) {
  return projection(service, "unavailable");
}

export function notConnectedCreatorProjection(service: CreatorServiceId) {
  return projection(service, "not_connected");
}

export function parseMusicCreatorProjection(payload: unknown): CreatorServiceProjection {
  const usage = record(record(payload)?.usage);
  const published = count(usage?.publishedCount);
  const pending = count(usage?.pendingCount);
  if (published === null || pending === null) return unavailableCreatorProjection("music");
  return projection("music", published + pending === 0 ? "empty" : "ready", [
    { id: "published", label: "公開中", value: published, unit: "件" },
    { id: "pending", label: "確認中", value: pending, unit: "件" },
  ]);
}

export function parseCommerceCreatorProjection(
  payload: unknown,
  now = new Date(),
): CreatorServiceProjection {
  const signedProjection = record(record(payload)?.projection);
  const orders = count(signedProjection?.orders);
  const settledSalesJpyc = count(signedProjection?.settledSalesJpyc);
  const refundedJpyc = count(signedProjection?.refundedJpyc);
  const observedAt = typeof signedProjection?.observedAt === "string"
    ? Date.parse(signedProjection.observedAt)
    : Number.NaN;
  const expiresAt = typeof signedProjection?.expiresAt === "string"
    ? Date.parse(signedProjection.expiresAt)
    : Number.NaN;
  if (
    signedProjection?.version !== 1
    || signedProjection.issuer !== "jkamma-commerce"
    || signedProjection.audience !== "hub-creator-center"
    || signedProjection.purpose !== "creator-transaction-summary"
    || typeof signedProjection.jti !== "string"
    || !/^[0-9a-f-]{36}$/i.test(signedProjection.jti)
    || orders === null
    || settledSalesJpyc === null
    || refundedJpyc === null
    || !Number.isFinite(observedAt)
    || !Number.isFinite(expiresAt)
    || observedAt > now.getTime() + 30_000
    || expiresAt <= now.getTime()
    || expiresAt - observedAt > 5 * 60 * 1000
  ) {
    return unavailableCreatorProjection("commerce");
  }
  return projection("commerce", orders === 0 ? "empty" : "ready", [
    { id: "orders", label: "販売", value: orders, unit: "件" },
    { id: "settled", label: "確定売上", value: settledSalesJpyc, unit: "JPYC" },
    { id: "refunded", label: "返金", value: refundedJpyc, unit: "JPYC" },
  ]);
}

export function parseAdvertisingCreatorProjection(payload: unknown): CreatorServiceProjection {
  const body = record(payload);
  const campaigns = Array.isArray(body?.campaigns) ? body.campaigns : null;
  if (!campaigns) return unavailableCreatorProjection("advertising");
  let active = 0;
  let pending = 0;
  let spendMicros = 0;
  let served = 0;
  let invalidTraffic = 0;
  let refundedAtomic = 0;
  for (const candidate of campaigns) {
    const campaign = record(candidate);
    if (!campaign || typeof campaign.status !== "string") {
      return unavailableCreatorProjection("advertising");
    }
    if (campaign.status === "active") active += 1;
    if (campaign.reviewStatus === "pending") pending += 1;
    const spent = count(campaign.spentJpyMicros);
    const campaignServed = count(campaign.servedCount);
    const invalid = count(campaign.invalidCount);
    const filtered = count(campaign.filteredCount);
    const refunded = count(campaign.refundedAtomic);
    if (spent === null || campaignServed === null || invalid === null || filtered === null || refunded === null) {
      return unavailableCreatorProjection("advertising");
    }
    spendMicros += spent;
    served += campaignServed;
    invalidTraffic += invalid + filtered;
    refundedAtomic += refunded;
  }
  const spend = moneyFromMicros(spendMicros);
  const refunded = moneyFromMicros(refundedAtomic);
  if (spend === null || refunded === null) return unavailableCreatorProjection("advertising");
  return projection("advertising", campaigns.length === 0 ? "empty" : "ready", [
    { id: "active", label: "配信中", value: active, unit: "件" },
    { id: "pending", label: "審査中", value: pending, unit: "件" },
    { id: "served", label: "配信", value: served, unit: "回" },
    { id: "spend", label: "累計利用", value: spend, unit: "円" },
    { id: "refunded", label: "返金", value: refunded, unit: "USDC" },
    { id: "invalid-traffic", label: "無効・除外", value: invalidTraffic, unit: "回" },
  ]);
}
