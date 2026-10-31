export const TRANSLATION_SOURCE_LANGUAGES = ["ja", "en", "ko", "zh-CN", "other"] as const;
export type TranslationSourceLanguage = typeof TRANSLATION_SOURCE_LANGUAGES[number];
export type TranslationLanguagePreferences = Partial<Record<TranslationSourceLanguage, boolean>>;

export function isTranslationSourceLanguage(value: unknown): value is TranslationSourceLanguage {
  return typeof value === "string" && (TRANSLATION_SOURCE_LANGUAGES as readonly string[]).includes(value);
}

export function translationSourceLanguageForDisplayLanguage(
  displayLanguage: string,
): TranslationSourceLanguage {
  const normalized = displayLanguage.trim().toLowerCase().replace("_", "-");
  return normalized === "zh" || normalized.startsWith("zh-")
    ? "zh-CN"
    : normalized.startsWith("ja")
      ? "ja"
      : normalized.startsWith("ko")
        ? "ko"
        : normalized.startsWith("en")
          ? "en"
          : "other";
}

export function isTranslationSourceDisplayLanguage(
  sourceLanguage: TranslationSourceLanguage,
  displayLanguage: string,
): boolean {
  const displaySourceLanguage = translationSourceLanguageForDisplayLanguage(displayLanguage);
  return displaySourceLanguage !== "other" && sourceLanguage === displaySourceLanguage;
}

export function translationLanguageEnabledByDefault(
  sourceLanguage: TranslationSourceLanguage,
  displayLanguage: string,
): boolean {
  return !isTranslationSourceDisplayLanguage(sourceLanguage, displayLanguage);
}
