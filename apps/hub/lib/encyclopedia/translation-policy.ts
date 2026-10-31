export const HUBPEDIA_TRANSLATION_GLOSSARY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en: {
    Hubpedia: "Hubpedia",
    "人工知能": "artificial intelligence",
    "生成AI": "generative AI",
    "大規模言語モデル": "large language model",
    "検索拡張生成": "retrieval-augmented generation",
  },
};

export function createTranslationGlossaryInstruction(locale: string) {
  const entries = HUBPEDIA_TRANSLATION_GLOSSARY[locale];
  if (!entries) return "Preserve product names, personal names, acronyms, and internal-link slugs exactly.";
  return `Use these preferred terms consistently: ${Object.entries(entries).map(([source, target]) => `${source}=${target}`).join("; ")}.`;
}

export function isTranslationCurrent(sourceRevisionId: string, translatedSourceRevisionId: string) {
  return sourceRevisionId === translatedSourceRevisionId;
}
