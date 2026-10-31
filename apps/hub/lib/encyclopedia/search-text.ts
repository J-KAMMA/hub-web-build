export function normalizeHubpediaSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\u30a1-\u30f6]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/\s+/g, " ")
    .trim();
}

export interface HubpediaSearchFields {
  title: string;
  reading?: string;
  aliases?: readonly string[];
  category?: string;
  summary?: string;
  description?: string;
  body?: string;
}

export function scoreHubpediaSearchFields(fields: HubpediaSearchFields, query: string) {
  const term = normalizeHubpediaSearchText(query);
  if (!term) return 1;
  const title = normalizeHubpediaSearchText(fields.title);
  const reading = normalizeHubpediaSearchText(fields.reading ?? "");
  const aliases = (fields.aliases ?? []).map(normalizeHubpediaSearchText);
  const category = normalizeHubpediaSearchText(fields.category ?? "");
  const summary = normalizeHubpediaSearchText(fields.summary ?? "");
  const description = normalizeHubpediaSearchText(fields.description ?? "");
  const body = normalizeHubpediaSearchText(fields.body ?? "");

  if (title === term) return 1000;
  if (reading.split(" ").includes(term)) return 950;
  if (aliases.includes(term)) return 900;
  if (title.startsWith(term)) return 800;
  if (reading.split(" ").some((candidate) => candidate.startsWith(term))) return 700;
  if (aliases.some((alias) => alias.startsWith(term))) return 650;
  if (title.includes(term)) return 600;
  if (reading.includes(term) || aliases.some((alias) => alias.includes(term))) return 500;
  if (category.includes(term)) return 250;
  if (summary.includes(term)) return 150;
  if (description.includes(term)) return 100;
  if (body.includes(term)) return 50;
  return 0;
}
