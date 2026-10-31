import {experienceGuardrail,experimentMultiplier,pacingMultiplier,type OptimizationGoal,type PacingMode} from "@/lib/hub-ads-advanced-optimization";
export const HUB_AD_FORMATS = ["native", "static_display", "sponsored_search", "text", "sponsorship"] as const;
export type HubAdFormat = (typeof HUB_AD_FORMATS)[number];

export const HUB_AD_TARGETING_KEYS = [
  "pageTypes", "pageCategories", "contentTags", "contentKeywords", "languages", "countries",
  "regions", "deviceClasses", "operatingSystems", "browserClasses", "loginStates", "weekdays",
  "hourRanges", "visitorTypes", "estimatedAudience", "estimatedMonthlyImpressions",
] as const;

const TARGETING_KEY_SET = new Set<string>(HUB_AD_TARGETING_KEYS);
const FORBIDDEN_KEYS = /(^|_)(email|phone|name|address|gps|latitude|longitude|race|ethnicity|religion|politic|health|sexual|union|criminal|income|minor|identity|wallet|kyc|profile|session|cookie|fingerprint|user_id|account_id)($|_)/i;
const BLOCKED_PAGE_TYPES = new Set(["auth", "checkout", "settings", "personal_data", "admin", "report", "private", "sensitive", "error"]);
const CONTEXT_KEYS = new Set(["pageType", "pageCategory", "contentTags", "contentKeywords", "language", "country", "region",
  "deviceClass", "operatingSystem", "browserClass", "loginState", "visitorType", "weekday", "hour"]);
const SHORTENER_HOSTS = new Set(["bit.ly", "t.co", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly"]);

export interface HubAdContext {
  pageType: string;
  pageCategory?: string;
  contentTags?: string[];
  contentKeywords?: string[];
  language?: string;
  country?: string;
  region?: string;
  deviceClass?: string;
  operatingSystem?: string;
  browserClass?: string;
  loginState?: "logged_in" | "logged_out";
  visitorType?: "new" | "returning";
  weekday?: number;
  hour?: number;
}

export interface HubAdServeRequest {
  requestId: string;
  placementKey: string;
  context: HubAdContext;
  excludedCreativeVersionIds?: string[];
}

export interface HubAdPlacementRecord {
  id: string;
  placementKey: string;
  format: HubAdFormat;
  status: "draft" | "active" | "paused" | "archived";
  maximumAdsPerPage: number;
  targetingAllowed: string[];
}

export interface HubAdCandidate {
  advertiserRef: string;
  categoryKey: string;
  campaignId: string;
  lineItemId: string;
  creativeVersionId: string;
  format: HubAdFormat;
  campaignStatus: string;
  campaignReviewStatus: string;
  lineItemStatus: string;
  creativeStatus: string;
  creativeReviewStatus: string;
  startAt: number;
  endAt: number;
  priority: number;
  pacingMode: PacingMode;
  rateJpyMicros: number;
  campaignBudgetJpyMicros: number;
  campaignSpentJpyMicros: number;
  lineItemBudgetJpyMicros: number;
  lineItemSpentJpyMicros: number;
  dailyBudgetJpyMicros?: number;
  dailySpentJpyMicros: number;
  expectedSpendRatio: number;
  actualSpendRatio: number;
  frequencyCapCount?: number;
  frequencyCount: number;
  optimizationServed?: number;
  optimizationViewable?: number;
  optimizationClicked?: number;
  recentServed?: number;
  recentClicked?: number;
  previousServed?: number;
  previousClicked?: number;
  negativeFeedback?: number;
  publicReports?: number;
  optimizationGoal?: OptimizationGoal;
  abTestingEnabled?: boolean;
  minimumExplorationPercent?: number;
  totalCreativeServed?: number;
  optimizationConversions?: number;
  placementPerformance?: number;
  reservationBoost?: number;
  experienceNegativeRate?: number;
  experienceSlowRate?: number;
  experienceAdDensity?: number;
  targetingRules: Readonly<Record<string, unknown>>;
  headline: string;
  description: string;
  imagePath?: string;
  altText: string;
  callToAction: string;
  advertiserDisplayName: string;
}

export interface HubAdSelectionInput {
  adsPaused: boolean;
  now: number;
  placement: HubAdPlacementRecord | null;
  request: HubAdServeRequest;
  candidates: HubAdCandidate[];
  recentCreativeVersionIds?: string[];
  recentAdvertiserRefs?: string[];
  recentCategoryKeys?: string[];
  hiddenCreativeVersionIds?: string[];
  hiddenAdvertiserRefs?: string[];
}

export interface HubAdSelection {
  candidate: HubAdCandidate;
  score: number;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP") : "";
}

function normalizedArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(normalized).filter(Boolean) : [];
}

function matchesOne(rule: unknown, actual: string | undefined): boolean {
  const choices = normalizedArray(rule);
  return choices.length === 0 || choices.includes(normalized(actual));
}

function overlaps(rule: unknown, actual: string[] | undefined): boolean {
  const choices = new Set(normalizedArray(rule));
  if (choices.size === 0) return true;
  return (actual ?? []).some((item) => choices.has(normalized(item)));
}

function hourMatches(rule: unknown, hour: number | undefined): boolean {
  if (!Array.isArray(rule) || rule.length === 0) return true;
  if (!Number.isInteger(hour) || hour === undefined || hour < 0 || hour > 23) return false;
  return rule.some((range) => Array.isArray(range) && range.length === 2
    && Number.isInteger(range[0]) && Number.isInteger(range[1])
    && hour >= Number(range[0]) && hour < Number(range[1]));
}

function weekdayMatches(rule: unknown, weekday: number | undefined): boolean {
  if (!Array.isArray(rule) || rule.length === 0) return true;
  return Number.isInteger(weekday) && rule.some((item) => Number.isInteger(item) && item === weekday);
}

function stableUnitInterval(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) + 1) / 4294967297;
}

export function validateLandingUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || SHORTENER_HOSTS.has(url.hostname.toLowerCase())) return null;
    return url;
  } catch {
    return null;
  }
}

export function validateTargetingRules(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [key, rule] of Object.entries(value)) {
    if (!TARGETING_KEY_SET.has(key) || FORBIDDEN_KEYS.test(key)) return false;
    if (key === "estimatedAudience") { if (!Number.isInteger(rule) || Number(rule) < 100) return false; continue; }
    if (key === "estimatedMonthlyImpressions") { if (!Number.isInteger(rule) || Number(rule) < 10_000) return false; continue; }
    if (key === "weekdays") {
      if (!Array.isArray(rule) || rule.length > 7 || !rule.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 6)) return false;
      continue;
    }
    if (key === "hourRanges") {
      if (!Array.isArray(rule) || rule.length > 24 || !rule.every((range) => Array.isArray(range) && range.length === 2
        && Number.isInteger(range[0]) && Number.isInteger(range[1]) && Number(range[0]) >= 0 && Number(range[1]) <= 24
        && Number(range[0]) < Number(range[1]))) return false;
      continue;
    }
    if (!Array.isArray(rule) || rule.length > 100 || !rule.every((item) => typeof item === "string" && item.length > 0 && item.length <= 120)) return false;
  }
  const keys = Object.keys(value);
  const hasContextualRestriction = keys.some((key) => key !== "estimatedAudience" && key !== "estimatedMonthlyImpressions");
  if (hasContextualRestriction && (!Number.isInteger(Reflect.get(value, "estimatedAudience"))
    || Number(Reflect.get(value, "estimatedAudience")) < 100
    || !Number.isInteger(Reflect.get(value, "estimatedMonthlyImpressions"))
    || Number(Reflect.get(value, "estimatedMonthlyImpressions")) < 10_000)) return false;
  return true;
}

export function isSafeServeRequest(value: unknown): value is HubAdServeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(request.requestId)) return false;
  if (typeof request.placementKey !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+){1,7}$/.test(request.placementKey)) return false;
  if (!request.context || typeof request.context !== "object" || Array.isArray(request.context)) return false;
  const context = request.context as Record<string, unknown>;
  if (typeof context.pageType !== "string" || BLOCKED_PAGE_TYPES.has(normalized(context.pageType))) return false;
  if (Object.keys(context).some((key) => !CONTEXT_KEYS.has(key) || FORBIDDEN_KEYS.test(key))) return false;
  if ([context.contentTags, context.contentKeywords].some((items) => items !== undefined
    && (!Array.isArray(items) || items.length > 50 || !items.every((item) => typeof item === "string" && item.length <= 120)))) return false;
  return request.excludedCreativeVersionIds === undefined
    || (Array.isArray(request.excludedCreativeVersionIds)
      && request.excludedCreativeVersionIds.length <= 20
      && request.excludedCreativeVersionIds.every((id) => typeof id === "string" && id.length <= 128));
}

function targetingMatches(rules: Readonly<Record<string, unknown>>, context: HubAdContext): boolean {
  if (!validateTargetingRules(rules)) return false;
  return matchesOne(rules.pageTypes, context.pageType)
    && matchesOne(rules.pageCategories, context.pageCategory)
    && overlaps(rules.contentTags, context.contentTags)
    && overlaps(rules.contentKeywords, context.contentKeywords)
    && matchesOne(rules.languages, context.language)
    && matchesOne(rules.countries, context.country)
    && matchesOne(rules.regions, context.region)
    && matchesOne(rules.deviceClasses, context.deviceClass)
    && matchesOne(rules.operatingSystems, context.operatingSystem)
    && matchesOne(rules.browserClasses, context.browserClass)
    && matchesOne(rules.loginStates, context.loginState)
    && matchesOne(rules.visitorTypes, context.visitorType)
    && weekdayMatches(rules.weekdays, context.weekday)
    && hourMatches(rules.hourRanges, context.hour);
}

function placementAllowsTargeting(placement: HubAdPlacementRecord, rules: Readonly<Record<string, unknown>>): boolean {
  const metadataKeys = new Set(["estimatedAudience", "estimatedMonthlyImpressions"]);
  const allowed = new Set(placement.targetingAllowed);
  return Object.keys(rules).every((key) => metadataKeys.has(key) || allowed.has(key));
}

function contextualRelevance(rules: Readonly<Record<string, unknown>>, context: HubAdContext): number {
  const pairs: Array<[unknown, string | string[] | undefined]> = [
    [rules.pageTypes, context.pageType], [rules.pageCategories, context.pageCategory],
    [rules.contentTags, context.contentTags], [rules.contentKeywords, context.contentKeywords],
    [rules.languages, context.language],
  ];
  let considered=0,matched=0;
  for(const [rule,actual] of pairs){const choices=normalizedArray(rule);if(!choices.length)continue;considered+=1;
    const values=Array.isArray(actual)?actual:[actual];if(values.some((item)=>choices.includes(normalized(item))))matched+=1;}
  return considered ? matched/considered : 0.6;
}

export function selectHubAd(input: HubAdSelectionInput): HubAdSelection | null {
  const { adsPaused, now, placement, request } = input;
  if (adsPaused || !placement || placement.status !== "active" || placement.maximumAdsPerPage < 1) return null;
  if (!isSafeServeRequest(request) || request.placementKey !== placement.placementKey) return null;
  const excluded = new Set(request.excludedCreativeVersionIds ?? []);
  const recentCreatives=new Set(input.recentCreativeVersionIds??[]), recentAdvertisers=new Set(input.recentAdvertiserRefs??[]);
  const recentCategories=new Set(input.recentCategoryKeys??[]), hiddenCreatives=new Set(input.hiddenCreativeVersionIds??[]);
  const hiddenAdvertisers=new Set(input.hiddenAdvertiserRefs??[]);

  const eligible = input.candidates.filter((candidate) => {
    if (candidate.format !== placement.format || excluded.has(candidate.creativeVersionId)
      || recentCreatives.has(candidate.creativeVersionId) || recentAdvertisers.has(candidate.advertiserRef)
      || recentCategories.has(candidate.categoryKey) || hiddenCreatives.has(candidate.creativeVersionId)
      || hiddenAdvertisers.has(candidate.advertiserRef)) return false;
    if (candidate.campaignStatus !== "active" || candidate.campaignReviewStatus !== "approved") return false;
    if (candidate.lineItemStatus !== "active" || candidate.creativeStatus !== "approved" || candidate.creativeReviewStatus !== "approved") return false;
    if (now < candidate.startAt || now >= candidate.endAt) return false;
    if (candidate.campaignSpentJpyMicros >= candidate.campaignBudgetJpyMicros) return false;
    if (candidate.lineItemSpentJpyMicros >= candidate.lineItemBudgetJpyMicros) return false;
    if (candidate.dailyBudgetJpyMicros !== undefined && candidate.dailySpentJpyMicros >= candidate.dailyBudgetJpyMicros) return false;
    if (candidate.frequencyCapCount !== undefined && candidate.frequencyCount >= candidate.frequencyCapCount) return false;
    return placementAllowsTargeting(placement, candidate.targetingRules) && targetingMatches(candidate.targetingRules, request.context);
  });

  const scored = eligible.map((candidate) => {
    const underDelivery = Math.max(-1, Math.min(1, candidate.expectedSpendRatio - candidate.actualSpendRatio));
    const budgetFitness = pacingMultiplier(candidate.pacingMode,candidate.expectedSpendRatio,candidate.actualSpendRatio);
    const rotation = 0.75 + stableUnitInterval(`${request.requestId}:${candidate.lineItemId}:${candidate.creativeVersionId}`) * 0.5;
    const served = Math.max(0, candidate.optimizationServed ?? 0);
    const viewable = Math.max(0, Math.min(served, candidate.optimizationViewable ?? 0));
    const clicked = Math.max(0, Math.min(viewable, candidate.optimizationClicked ?? 0));
    // Bayesian smoothing prevents a new creative from winning on one accidental click.
    // A deterministic exploration share keeps every approved creative measurable.
    const viewability = (viewable + 20) / (served + 40);
    const clickRate = (clicked + 1) / (viewable + 100);
    const evidence = Math.min(1, served / 1_000);
    const performance = Math.max(0.5,Math.min(1.5,1 + evidence * ((viewability - 0.5) * 0.5 + (clickRate - 0.01) * 8)));
    const recentCtr=((candidate.recentClicked??0)+1)/((candidate.recentServed??0)+100);
    const previousCtr=((candidate.previousClicked??0)+1)/((candidate.previousServed??0)+100);
    const fatigue=recentCtr<previousCtr*0.7?Math.max(0.35,recentCtr/(previousCtr*0.7)):1;
    const negative=(candidate.negativeFeedback??0)+(candidate.publicReports??0)*3;
    const quality=Math.max(0.2,1-negative/Math.max(100,served));
    const fraudSafety=Math.max(0.25,1-(candidate.publicReports??0)/Math.max(20,served)*5);
    const relevance=contextualRelevance(candidate.targetingRules,request.context);
    const goalSuccesses=candidate.optimizationGoal==="conversion"?(candidate.optimizationConversions??0):candidate.optimizationGoal==="click"?clicked:viewable;
    const experiment=candidate.abTestingEnabled===false?1:experimentMultiplier({requestId:request.requestId,creativeId:candidate.creativeVersionId,served,successes:goalSuccesses,totalCreativeServed:candidate.totalCreativeServed??served,explorationPercent:candidate.minimumExplorationPercent??10});
    const guardrail=experienceGuardrail({negativeRate:candidate.experienceNegativeRate??0,slowRate:candidate.experienceSlowRate??0,adDensity:candidate.experienceAdDensity??.1});
    const explore = stableUnitInterval(`${request.requestId}:explore`) < 0.1 ? rotation : 1;
    const composite=0.4+viewability*0.15+Math.min(1,clickRate/0.04)*0.1+quality*0.1+relevance*0.15+(budgetFitness/1.5)*0.1;
    return { candidate, score: guardrail*(Math.max(0,candidate.rateJpyMicros)*composite*performance*fatigue*fraudSafety*explore*experiment*(candidate.placementPerformance??1)*(candidate.reservationBoost??1)+candidate.priority*1_000_000) };
  });
  scored.sort((left, right) => right.score - left.score || left.candidate.creativeVersionId.localeCompare(right.candidate.creativeVersionId));
  return scored[0] ?? null;
}
