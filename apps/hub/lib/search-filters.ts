export type HubSearchCurrency = "JPY" | "USD" | "EUR";
export const HUB_SEARCH_LANGUAGES = ["ja", "en", "ko", "zh-CN", "es", "fr", "de", "pt", "ar", "hi", "other"] as const;
export type HubSearchLanguage = typeof HUB_SEARCH_LANGUAGES[number];
export const HUB_SEARCH_TYPES = ["boards", "profiles", "threads", "posts", "images", "hubpedia", "communities", "videos", "products", "lists", "tokens", "work", "listings"] as const;
export type HubSearchType = typeof HUB_SEARCH_TYPES[number];

export type HubSearchFilters = Readonly<{
  from: string;
  to: string;
  maxPrice: string;
  currency: HubSearchCurrency;
  language?: HubSearchLanguage;
  region?: string;
  category?: string;
  type?: HubSearchType;
}>;

export const EMPTY_HUB_SEARCH_FILTERS: HubSearchFilters = Object.freeze({
  from: "", to: "", maxPrice: "", currency: "JPY",
});

export const HUB_SEARCH_FILTER_KEYS = ["from", "to", "maxPrice", "currency", "language", "region", "category", "type"] as const;
const FILTER_KEYS = HUB_SEARCH_FILTER_KEYS;
const MINOR_DIGITS: Record<HubSearchCurrency, number> = { JPY: 0, USD: 2, EUR: 2 };
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
type FilterInput = Partial<Record<(typeof FILTER_KEYS)[number], unknown>>;
type FilterError = "date" | "date_order" | "price" | "currency" | "duplicate" | "language" | "region" | "category" | "type";

function normalizeMetadataText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ja");
}

function isDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parsePrice(value: string, currency: HubSearchCurrency): { canonical: string; minor: number } | null {
  if (value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const digits = MINOR_DIGITS[currency];
  if (fraction.length > digits) return null;
  const scale = 10n ** BigInt(digits);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(digits, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const suffix = fraction.replace(/0+$/, "");
  return { canonical: `${BigInt(whole)}${suffix ? `.${suffix}` : ""}`, minor: Number(minor) };
}

/** One contract for URL, form, saved searches and the API. Invalid input is never silently broadened. */
export function parseHubSearchFilters(input: URLSearchParams | FilterInput):
  { ok: true; filters: HubSearchFilters } | { ok: false; reason: FilterError } {
  const values: Record<(typeof FILTER_KEYS)[number], string> = { from: "", to: "", maxPrice: "", currency: "", language: "", region: "", category: "", type: "" };
  for (const key of FILTER_KEYS) {
    const readString = (value: string) => key === "region" || key === "category" ? value : value.trim();
    const raw = input instanceof URLSearchParams ? input.getAll(key) : input[key];
    if (Array.isArray(raw)) {
      if (input instanceof URLSearchParams && raw.length <= 1) values[key] = readString(raw[0] ?? "");
      else return { ok: false, reason: "duplicate" };
    } else if (raw === null || raw === undefined) {
      values[key] = "";
    } else if (typeof raw === "string") {
      values[key] = readString(raw);
    } else {
      return { ok: false, reason: key === "from" || key === "to" ? "date" : key === "maxPrice" ? "price" : key };
    }
  }
  if ((values.from && !isDate(values.from)) || (values.to && !isDate(values.to))) return { ok: false, reason: "date" };
  if (values.from && values.to && values.from > values.to) return { ok: false, reason: "date_order" };
  const currency = values.currency.toUpperCase() || "JPY";
  if (currency !== "JPY" && currency !== "USD" && currency !== "EUR") return { ok: false, reason: "currency" };
  const price = values.maxPrice ? parsePrice(values.maxPrice, currency) : null;
  if (values.maxPrice && !price) return { ok: false, reason: "price" };
  const languageInput = values.language.toLowerCase();
  const language = languageInput === "any" || languageInput === "all" ? undefined
    : languageInput === "zh" ? "zh-CN"
    : HUB_SEARCH_LANGUAGES.find((value) => value.toLowerCase() === languageInput);
  if (languageInput && languageInput !== "any" && languageInput !== "all" && !language) return { ok: false, reason: "language" };
  const typeInput = values.type.toLowerCase();
  const type = typeInput === "all" || typeInput === "any" ? undefined
    : HUB_SEARCH_TYPES.find((value) => value === typeInput);
  if (typeInput && typeInput !== "all" && typeInput !== "any" && !type) return { ok: false, reason: "type" };
  for (const key of ["region", "category"] as const) {
    if (/[\u0000-\u001f\u007f-\u009f]/.test(values[key])) return { ok: false, reason: key };
    values[key] = normalizeMetadataText(values[key]);
    if (values[key].length > 80) return { ok: false, reason: key };
  }
  return {
    ok: true,
    filters: {
      from: values.from, to: values.to, maxPrice: price?.canonical ?? "", currency: price ? currency : "JPY",
      ...(language ? { language } : {}), ...(type ? { type } : {}),
      ...(values.region ? { region: values.region } : {}), ...(values.category ? { category: values.category } : {}),
    },
  };
}

export function hasHubSearchFilters(filters: HubSearchFilters): boolean {
  return Boolean(filters.from || filters.to || filters.maxPrice || filters.language || filters.region || filters.category || filters.type);
}

/** Stable, normalized scope for history and signed cursor context. */
export function hubSearchFiltersKey(filters: HubSearchFilters): string {
  const dateAndPrice = [filters.from, filters.to, filters.maxPrice, filters.maxPrice ? filters.currency : ""];
  // Existing v5 cursors retain their scope when no new condition is applied.
  return JSON.stringify(filters.language || filters.region || filters.category || filters.type
    ? [...dateAndPrice, filters.language ?? "", filters.region ?? "", filters.category ?? "", filters.type ?? ""]
    : dateAndPrice);
}

export function appendHubSearchFilters(params: URLSearchParams, filters: HubSearchFilters): void {
  for (const key of FILTER_KEYS) params.delete(key);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.maxPrice) {
    params.set("maxPrice", filters.maxPrice);
    params.set("currency", filters.currency);
  }
  for (const key of ["language", "region", "category", "type"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
}

/** Match only metadata explicitly supplied by its public source. Missing values do not match. */
export function matchesHubSearchMetadata(filters: HubSearchFilters, metadata: {
  language?: string | null;
  regions?: readonly (string | null | undefined)[];
  categories?: readonly (string | null | undefined)[];
}): boolean {
  if (filters.language && metadata.language?.trim().toLowerCase() !== filters.language.toLowerCase()) return false;
  const contains = (values: readonly (string | null | undefined)[] | undefined, needle: string) =>
    Boolean(values?.some((value) => typeof value === "string" && normalizeMetadataText(value).includes(needle)));
  return (!filters.region || contains(metadata.regions, normalizeMetadataText(filters.region)))
    && (!filters.category || contains(metadata.categories, normalizeMetadataText(filters.category)));
}

/** Inclusive calendar days in Japan, expressed as an exclusive UTC upper bound for SQL. */
export function getHubSearchDateBounds(filters: HubSearchFilters): { fromInclusive: string | null; toExclusive: string | null } {
  return {
    fromInclusive: filters.from ? new Date(Date.parse(`${filters.from}T00:00:00.000Z`) - JST_OFFSET_MS).toISOString() : null,
    toExclusive: filters.to ? new Date(Date.parse(`${filters.to}T00:00:00.000Z`) - JST_OFFSET_MS + DAY_MS).toISOString() : null,
  };
}

/** Input is in major currency units; the existing product catalog stores integer minor units. */
export function getHubSearchMaximumMinor(filters: HubSearchFilters): number | null {
  if (!filters.maxPrice) return null;
  const price = parsePrice(filters.maxPrice, filters.currency);
  if (!price) throw new TypeError("Invalid normalized search price");
  return price.minor;
}
