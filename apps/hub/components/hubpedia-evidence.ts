import { readHubpediaCitations, type HubpediaCitation } from "./hubpedia-citations";

export const HUBPEDIA_NO_EVIDENCE = "ハブペディアに根拠が見つかりませんでした";

/**
 * Turns a Hub retrieval response ({version:1, items}) into display text plus citations. Used when paid AI execution is
 * off: the evidence is shown as found, with no generated answer.
 */
export function evidenceMessage(body: unknown): { content: string; citations: HubpediaCitation[] } {
  const record = typeof body === "object" && body !== null ? body as { version?: unknown; items?: unknown } : {};
  const items = record.version === 1 && Array.isArray(record.items) ? record.items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
  const numbered: Array<Record<string, unknown> & { n: number }> = items.map((item, index) => ({ ...item, n: index + 1 }));
  const citations = readHubpediaCitations(numbered);
  if (citations.length === 0) return { content: HUBPEDIA_NO_EVIDENCE, citations: [] };
  const lines = citations.map((citation) => {
    const item = numbered.find((entry) => entry.n === citation.n);
    return `[${citation.n}] ${String(item?.text ?? "").slice(0, 400)}`;
  });
  return { content: `ハブペディアの根拠 ${citations.length} 件です。AIによる回答文は、有料実行の停止中のため作っていません。\n${lines.join("\n")}`, citations };
}
