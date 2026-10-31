export const THREAD_LANGUAGE_TAGS = [
  "ja-JP", "en-US", "en-GB", "en-AU", "en-CA", "ko-KR",
  "zh-Hans", "zh-Hant", "es-ES", "es-MX", "es-419",
  "fr-FR", "fr-CA", "de-DE", "pt-BR", "pt-PT",
  "ar", "hi-IN", "bn-BD", "ur-PK", "id-ID", "ms-MY",
  "vi-VN", "th-TH", "tl-PH", "ru-RU", "uk-UA", "tr-TR",
  "it-IT", "nl-NL", "pl-PL", "sv-SE", "fa-IR", "he-IL",
] as const;
export type ThreadLanguageTag = typeof THREAD_LANGUAGE_TAGS[number];

export const THREAD_LANGUAGE_TAG_LABELS: Record<ThreadLanguageTag, string> = {
  "ja-JP": "日本語（日本）", "en-US": "English (US)", "en-GB": "English (UK)",
  "en-AU": "English (Australia)", "en-CA": "English (Canada)", "ko-KR": "한국어（韓国）",
  "zh-Hans": "简体中文", "zh-Hant": "繁體中文", "es-ES": "Español (España)",
  "es-MX": "Español (México)", "es-419": "Español (Latinoamérica)",
  "fr-FR": "Français (France)", "fr-CA": "Français (Canada)", "de-DE": "Deutsch",
  "pt-BR": "Português (Brasil)", "pt-PT": "Português (Portugal)", ar: "العربية",
  "hi-IN": "हिन्दी", "bn-BD": "বাংলা", "ur-PK": "اردو", "id-ID": "Bahasa Indonesia",
  "ms-MY": "Bahasa Melayu", "vi-VN": "Tiếng Việt", "th-TH": "ไทย",
  "tl-PH": "Filipino", "ru-RU": "Русский", "uk-UA": "Українська",
  "tr-TR": "Türkçe", "it-IT": "Italiano", "nl-NL": "Nederlands",
  "pl-PL": "Polski", "sv-SE": "Svenska", "fa-IR": "فارسی", "he-IL": "עברית",
};

export const THREAD_COUNTRY_CODES = (
  "AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW"
).split(" ") as readonly string[];

export function isThreadLanguageTag(value: unknown): value is ThreadLanguageTag {
  return typeof value === "string" && (THREAD_LANGUAGE_TAGS as readonly string[]).includes(value);
}

export function normalizeThreadLanguageTags(value: unknown, fallback = "ja-JP"): ThreadLanguageTag[] {
  const items = (Array.isArray(value) ? value : []).filter(isThreadLanguageTag);
  const unique = [...new Set(items)].slice(0, 8);
  return unique.length ? unique : [isThreadLanguageTag(fallback) ? fallback : "ja-JP"];
}

export function normalizeThreadCountries(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toUpperCase())
    .filter((item) => THREAD_COUNTRY_CODES.includes(item)))].slice(0, 32);
}

export function baseLanguageForTag(tag: ThreadLanguageTag): string {
  if (tag.startsWith("zh-")) return "zh-CN";
  if (tag === "ja-JP") return "ja";
  if (tag === "ko-KR") return "ko";
  if (tag.startsWith("pt-")) return "pt";
  if (tag.startsWith("hi-")) return "hi";
  if (tag === "ar") return "ar";
  const base = tag.split("-")[0];
  return ["en", "es", "fr", "de"].includes(base) ? base : "other";
}
