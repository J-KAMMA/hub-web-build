export const THREAD_LANGUAGES = ["ja", "en", "ko", "zh-CN", "es", "fr", "de", "pt", "ar", "hi", "other"] as const;
export type ThreadLanguage = typeof THREAD_LANGUAGES[number];

export const THREAD_REGIONS = ["global", "africa", "asia-pacific", "europe", "latin-america-caribbean", "middle-east-north-africa", "north-america", "local"] as const;
export type ThreadRegion = typeof THREAD_REGIONS[number];

export const THREAD_LANGUAGE_LABELS: Record<ThreadLanguage, string> = {
  ja: "日本語", en: "English", ko: "한국어", "zh-CN": "简体中文", es: "Español",
  fr: "Français", de: "Deutsch", pt: "Português", ar: "العربية", hi: "हिन्दी", other: "その他"
};

export const THREAD_REGION_LABELS: Record<ThreadRegion, string> = {
  global: "グローバル",
  africa: "アフリカ",
  "asia-pacific": "アジア太平洋",
  europe: "ヨーロッパ",
  "latin-america-caribbean": "中南米・カリブ",
  "middle-east-north-africa": "中東・北アフリカ",
  "north-america": "北米",
  local: "地域限定"
};

export function isThreadLanguage(value: unknown): value is ThreadLanguage {
  return typeof value === "string" && (THREAD_LANGUAGES as readonly string[]).includes(value);
}

export function threadLanguageForLocale(locale: string): ThreadLanguage {
  if (locale === "pt-BR") return "pt";
  return isThreadLanguage(locale) ? locale : "other";
}

export function isThreadRegion(value: unknown): value is ThreadRegion {
  return typeof value === "string" && (THREAD_REGIONS as readonly string[]).includes(value);
}
