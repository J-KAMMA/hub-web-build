import { classTitle, planHeadings, type ClassKey, type FactGroup } from "./class-plan";
import type { Fact } from "./facts";
import type { ItemNames } from "./verify";

/*
 * Text-only completion prompt for one Wikidata-fact stub. No tools, no outside knowledge: the model sees the facts grouped
 * under the class plan's headings and returns {"article": "<markdown>"}. Style follows docs/hubpedia-cognitive-rhythm.md
 * (reference-first, descriptive headings, varied sentences, no meta-writing, no evaluation); sentence-level verification and
 * the rhythm check are done afterwards by verify.ts.
 */

const EXAMPLES = [
  "例1（映画。見出しは与えられた区分名のまま）",
  "入力: [冒頭] f1 説明: 1927 film by Sergei Eisenstein / f2 監督: セルゲイ・エイゼンシュテイン / f3 公開日: 1927年11月7日 / f4 製作国: ソビエト連邦 / f5 ジャンル: サイレント映画 / [制作] f6 音楽: ドミートリイ・ショスタコーヴィチ / f7 制作会社: モスフィルム / f8 上映時間: 115分 / f9 映像の色: 白黒 / [出演] f10 出演: ボリス・リヴァノフ / f11 出演: エドアルド・ティッセ / [内容] f12 主題: 十月革命",
  "出力: {\"article\": \"『十月』は、セルゲイ・エイゼンシュテインが監督し、1927年11月7日に公開されたソビエト連邦のサイレント映画{f:f2}{f:f3}{f:f4}{f:f5}。\\n\\n## 制作\\n制作はモスフィルムで、白黒の画面に115分の長さで収められている{f:f7}{f:f8}{f:f9}。音楽はドミートリイ・ショスタコーヴィチが担当した{f:f6}。\\n\\n## 出演\\nボリス・リヴァノフとエドアルド・ティッセが出演している{f:f10}{f:f11}。\\n\\n## 内容\\n主題に取り上げられているのは十月革命{f:f12}。\"}",
  "例2（湖。事実を値の並びにせず、関連する事実を1文にまとめる）",
  "入力: [冒頭] f1 説明: lake in Benin / f2 分類: 湖 / f3 分類: ラグーン / f4 国: ベナン / [地理] f5 位置座標: 北緯6.4328度、東経2.4256度 / f6 全長: 20キロメートル / f7 全幅: 10キロメートル / [水系] f8 流入する河川: ウエメ川 / [保護と指定] f9 指定: ラムサール条約登録地",
  "出力: {\"article\": \"ノクエ湖は、ベナンにある湖で、ラグーンにも分類される{f:f2}{f:f3}{f:f4}。\\n\\n## 地理\\n北緯6.4328度、東経2.4256度に位置し、全長20キロメートル、全幅10キロメートルに及ぶ{f:f5}{f:f6}{f:f7}。\\n\\n## 水系\\nウエメ川が流れ込んでいる{f:f8}。\\n\\n## 保護と指定\\nラムサール条約の登録地に指定されている{f:f9}。\"}",
].join("\n");

export const SYSTEM_PROMPT = [
  "あなたは中立的な日本語の百科事典の短い項目を書く編集者です。道具は使わず、与えられた事実の一覧だけから書きます。",
  "規則:",
  "1. 一覧に無いことは書かない（外の知識、推測、評価、感想）。",
  "2. 文はすべて「。」で終え、依拠する事実の id を句点の直前に {f:f3} の形で付ける。複数なら {f:f3}{f:f5}。",
  "3. 数、年、日付、固有名は事実の表記のまま。日本語名のない固有名は英語の綴りのまま書く（音写しない）。",
  "4. 事実は区分（冒頭・見出し付きの節）ごとにまとめて渡される。冒頭の区分の事実は見出しなしの最初の段落に、見出しのある区分の事実は同じ見出し（## 見出し）の節にだけ書く。見出しは渡された名前をそのまま使い、新しい見出しや別の節の事実を持ち込まない。事実の無い区分は書かない。",
  "5. 冒頭の最初の文で対象が何かを示す。「〜は…である。」の連打にしない。関連する事実（例: 国と所在地、日付と出来事、規模の数値）は1文にまとめ、主語・述語・文末を変える。事実の項目名をそのまま主語にしない。",
  "6. 文末の「である」は全体の半分以下にとどめ、同じ語で始まる文を続けない。評価、前置き、進行の実況（「次に」「ここでは」）は書かない。",
  "出力は JSON オブジェクト1つだけ: {\"article\": \"<Markdown本文>\"}。",
  "",
  "書き方の例（事実はこの例の中でだけ有効。実際の入力の事実に置き換えて書く）:",
  EXAMPLES,
].join("\n");

export type PromptItem = { qid: string; names: ItemNames; facts: readonly Fact[]; classKey: ClassKey; groups: readonly FactGroup[] };

/** The user prompt is a JSON document, like the other Hubpedia jobs: the chain wrappers expect an outputContract. */
export function buildPrompt(item: PromptItem, options: { retryNote?: string } = {}): string {
  const byId = new Map(item.facts.map((fact) => [fact.id, fact] as const));
  return JSON.stringify({
    task: "Write a Japanese encyclopedia stub from these facts only.",
    outputContract: { article: "Markdown string: lead paragraph (no heading), then ## sections using only the given headings; every sentence ends with {f:<fact id>} before the full stop." },
    item: {
      titleJa: item.names.labelJa,
      titleEn: item.names.labelEn,
      aliases: item.names.aliases.slice(0, 6),
      kind: classTitle(item.classKey),
    },
    allowedHeadings: planHeadings(item.classKey),
    sections: item.groups.map((group) => ({
      heading: group.heading ?? "(冒頭: 見出しなし)",
      facts: group.factIds.map((id) => ({ id, text: byId.get(id)?.text ?? "" })),
    })),
    ...(options.retryNote ? { retryNote: options.retryNote } : {}),
  });
}

/** The article text of a chain answer: {"article": "..."} (also accepts "markdown" or "body"). */
export function articleFromOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  for (const key of ["article", "markdown", "body", "text"]) if (typeof record[key] === "string" && (record[key] as string).trim()) return record[key] as string;
  return null;
}
