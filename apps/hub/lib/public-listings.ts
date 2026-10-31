export const PUBLIC_LISTING_KINDS = [
  "travel",
  "local-services",
  "classes",
  "events",
] as const;

export type PublicListingKind = (typeof PUBLIC_LISTING_KINDS)[number];
export type PublicListingStatus =
  | "draft"
  | "pending"
  | "published"
  | "paused"
  | "rejected";

export type PublicListing = {
  id: string;
  ownerProfileId: string;
  kind: PublicListingKind;
  category: string;
  title: string;
  summary: string;
  providerLabel: string;
  providerUrl: string;
  region: string;
  locality: string;
  priceLabel: string | null;
  trustStatus: "verified" | "pending" | "not_available";
  status: PublicListingStatus;
  publishedAt: string | null;
  startsAt: string | null;
  organizerName: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export const PUBLIC_LISTING_KIND_LABELS: Record<PublicListingKind, string> = {
  travel: "旅行",
  "local-services": "地域サービス",
  classes: "教室",
  events: "イベント",
};

export const PUBLIC_LISTING_CATEGORIES: Record<PublicListingKind, string[]> = {
  travel: ["宿泊", "交通", "観光施設", "体験", "旅行情報"],
  "local-services": [
    "暮らし",
    "修理・メンテナンス",
    "美容・健康",
    "専門サービス",
    "地域団体",
  ],
  classes: ["学習", "語学", "音楽", "スポーツ", "趣味・文化"],
  events: ["音楽", "スポーツ", "展示", "カンファレンス", "地域イベント"],
};

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function parsePublicListingCancellationReason(value: unknown): string | null {
  const reason = text(value, 501);
  return reason.length > 0 && reason.length <= 500 ? reason : null;
}

export function parsePublicListingKind(value: unknown): PublicListingKind | null {
  return PUBLIC_LISTING_KINDS.includes(value as PublicListingKind)
    ? (value as PublicListingKind)
    : null;
}

export type PublicListingInput = {
  kind: PublicListingKind;
  category: string;
  title: string;
  summary: string;
  providerLabel: string;
  providerUrl: string;
  region: string;
  locality: string;
  priceLabel: string | null;
  startsAt: string | null;
  organizerName: string | null;
};

function parseEventStartsAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const source = value.trim();
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || source.length > 64) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const offsetHour = match[8] ? Number(match[8]) : 0;
  const offsetMinute = match[9] ? Number(match[9]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1000 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return null;
  const timestamp = Date.parse(source);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parsePublicListingInput(value: unknown): PublicListingInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const kind = parsePublicListingKind(source.kind);
  const category = text(source.category, 80);
  const title = text(source.title, 160);
  const summary = text(source.summary, 1000);
  const providerLabel = text(source.providerLabel, 120);
  const providerUrl = text(source.providerUrl, 2048);
  const region = text(source.region, 80);
  const locality = text(source.locality, 120);
  const priceLabel = text(source.priceLabel, 64) || null;
  const organizerName = kind === "events" ? text(source.organizerName, 120) || null : null;
  const startsAt = kind === "events" ? parseEventStartsAt(source.startsAt) : null;
  if (!kind || !category || !title || summary.length < 20 || !providerLabel) return null;
  if (
    kind === "events" && source.startsAt != null &&
    (typeof source.startsAt !== "string" || (source.startsAt.trim() && !startsAt))
  ) return null;
  if (!PUBLIC_LISTING_CATEGORIES[kind].includes(category)) return null;
  try {
    const url = new URL(providerUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local")
    ) return null;
  } catch {
    return null;
  }
  return {
    kind,
    category,
    title,
    summary,
    providerLabel,
    providerUrl,
    region,
    locality,
    priceLabel,
    startsAt,
    organizerName,
  };
}
