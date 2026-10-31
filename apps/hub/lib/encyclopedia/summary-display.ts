function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeRepeatedTitleFromSummary(title: string, summary: string) {
  const cleanTitle = title.normalize("NFC").trim();
  const cleanSummary = summary.normalize("NFC").trim();
  if (!cleanTitle || !cleanSummary) return cleanSummary;

  const titlePattern = escapeRegExp(cleanTitle);
  const japanese = new RegExp(
    `^${titlePattern}\\s*(?:とは|は)\\s*[、,:：]?\\s*`,
    "u",
  );
  const english = new RegExp(
    `^${titlePattern}\\s+(?:is|are|refers\\s+to|means)\\s+`,
    "iu",
  );
  const result = cleanSummary.replace(japanese, "").replace(english, "").trim();
  return result || cleanSummary;
}
