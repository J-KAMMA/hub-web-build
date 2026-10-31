import { normalizeSponsorUrl, type HubAdPlacement } from "@/lib/advertising";

const CAMPAIGN_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const PLACEMENTS = new Set<HubAdPlacement>(["home", "hubpedia-index", "hubpedia-article", "hubpedia-article-bottom"]);
const MAX_CAMPAIGNS = 50;
const MAX_KEYWORDS = 20;

export interface SponsorCampaign {
  id: string;
  title: string;
  copy: string;
  url: string;
  placements: HubAdPlacement[];
  locales: string[];
  keywords: string[];
  requireKeywordMatch: boolean;
  weight: number;
  expectedCpmJpy?: number;
  startsAt?: number;
  endsAt?: number;
}

export interface SponsorSelectionContext {
  placement: HubAdPlacement;
  locale: string;
  text: string;
  now?: Date;
  rotationHours?: number;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/\s+/g, " ").trim();
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function optionalDate(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseCampaign(value: unknown): SponsorCampaign | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const id = boundedString(input.id, 64);
  const title = boundedString(input.title, 80);
  const copy = boundedString(input.copy, 240);
  const url = typeof input.url === "string" ? normalizeSponsorUrl(input.url) : undefined;
  if (!id || !CAMPAIGN_ID.test(id) || !title || !copy || !url) return undefined;

  if (!Array.isArray(input.placements) || input.placements.length === 0 || input.placements.length > PLACEMENTS.size) return undefined;
  if (!input.placements.every((item) => typeof item === "string" && PLACEMENTS.has(item as HubAdPlacement))) return undefined;
  const placements = [...new Set(input.placements as HubAdPlacement[])];

  if (input.locales !== undefined && !Array.isArray(input.locales)) return undefined;
  const rawLocales = (input.locales ?? []) as unknown[];
  if (rawLocales.length > 20 || !rawLocales.every((item) => typeof item === "string" && LOCALE.test(item))) return undefined;
  const locales = [...new Set((rawLocales as string[]).map((item) => item.toLowerCase()))];

  if (input.keywords !== undefined && !Array.isArray(input.keywords)) return undefined;
  const rawKeywords = (input.keywords ?? []) as unknown[];
  if (rawKeywords.length > MAX_KEYWORDS || !rawKeywords.every((item) => typeof item === "string" && normalizedText(item).length > 0 && normalizedText(item).length <= 60)) return undefined;
  const keywords = [...new Set((rawKeywords as string[]).map(normalizedText))];

  if (input.weight !== undefined && (typeof input.weight !== "number" || !Number.isFinite(input.weight) || input.weight < 0.1 || input.weight > 100)) return undefined;
  const weight = (input.weight as number | undefined) ?? 1;
  if (input.expectedCpmJpy !== undefined && (typeof input.expectedCpmJpy !== "number" || !Number.isFinite(input.expectedCpmJpy) || input.expectedCpmJpy <= 0 || input.expectedCpmJpy > 1_000_000)) return undefined;
  const expectedCpmJpy = input.expectedCpmJpy as number | undefined;
  if (input.requireKeywordMatch !== undefined && typeof input.requireKeywordMatch !== "boolean") return undefined;
  const startsAt = optionalDate(input.startsAt);
  const endsAt = optionalDate(input.endsAt);
  if (startsAt === null || endsAt === null || (startsAt !== undefined && endsAt !== undefined && startsAt >= endsAt)) {
    return undefined;
  }

  return {
    id,
    title,
    copy,
    url,
    placements,
    locales,
    keywords,
    requireKeywordMatch: input.requireKeywordMatch === true,
    weight,
    expectedCpmJpy,
    startsAt,
    endsAt,
  };
}

export function parseSponsorCampaigns(value: string | undefined): SponsorCampaign[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const campaigns = parsed.slice(0, MAX_CAMPAIGNS).map(parseCampaign).filter((item): item is SponsorCampaign => Boolean(item));
    return [...new Map(campaigns.map((campaign) => [campaign.id, campaign])).values()];
  } catch {
    return [];
  }
}

function localeMatches(campaign: SponsorCampaign, locale: string): boolean {
  if (campaign.locales.length === 0) return true;
  const normalized = locale.toLowerCase();
  const language = normalized.split("-")[0];
  return campaign.locales.some((item) => item === normalized || item === language);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeSponsorRotationHours(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(168, Math.max(1, parsed)) : 6;
}

export function selectSponsorCampaign(
  campaigns: SponsorCampaign[],
  context: SponsorSelectionContext,
): SponsorCampaign | undefined {
  const now = (context.now ?? new Date()).getTime();
  const locale = context.locale || "ja";
  const text = normalizedText(context.text);
  const rotationHours = Math.min(168, Math.max(1, context.rotationHours ?? 6));
  const bucket = Math.floor(now / (rotationHours * 60 * 60 * 1000));
  const seed = `${context.placement}|${locale.toLowerCase()}|${text.slice(0, 600)}|${bucket}`;

  let winner: SponsorCampaign | undefined;
  let winnerScore = -1;
  for (const campaign of campaigns) {
    if (!campaign.placements.includes(context.placement)) continue;
    if (!localeMatches(campaign, locale)) continue;
    if (campaign.startsAt !== undefined && now < campaign.startsAt) continue;
    if (campaign.endsAt !== undefined && now >= campaign.endsAt) continue;

    const matches = campaign.keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
    if (campaign.requireKeywordMatch && matches === 0) continue;
    const contextualMultiplier = campaign.keywords.length === 0 ? 1 : matches > 0 ? 1 + Math.min(matches, 4) : 0.35;
    // Expected CPM is deliberately bounded and only affects relative delivery.
    // Campaigns without revenue data retain the legacy weight-only behavior.
    const revenueMultiplier = campaign.expectedCpmJpy ?? 1;
    const effectiveWeight = campaign.weight * contextualMultiplier * revenueMultiplier;
    const uniform = (fnv1a(`${seed}|${campaign.id}`) + 1) / 4294967297;
    const score = Math.pow(uniform, 1 / effectiveWeight);
    if (score > winnerScore) {
      winner = campaign;
      winnerScore = score;
    }
  }
  return winner;
}
