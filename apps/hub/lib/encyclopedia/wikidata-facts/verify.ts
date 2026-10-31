import type { Fact } from "./facts";

/*
 * Deterministic check of a model-written stub (owner decision 2026-10-30). The model gets only the fact list; every sentence
 * must end in {f:<id>} markers, and every number, date and proper name in the sentence has to be found in the cited facts or
 * in the item's own label and aliases. A sentence that fails is dropped, never repaired. The article is rejected when fewer
 * than MIN_SENTENCES remain or the lead is gone.
 */

export const MIN_SENTENCES = 3;
export const ALLOWED_HEADINGS: readonly string[] = ["来歴", "経歴", "歴史", "地理", "人口", "行政", "特徴", "作品", "活動", "構成", "関係", "参加者"];

export type Section = { heading: string | null; sentences: ParsedSentence[] };
export type ParsedSentence = { text: string; factIds: string[] };
export type ParsedArticle = { sections: Section[]; badHeadings: string[] };

/** NFKC, katakana folded to hiragana, lower case. Names such as ガン and がん compare equal. */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

const MARKER_GROUP = /\{f:?\s*([^}]*)\}/gu;

/** Splits the model's markdown into sections of sentences. Markers may sit before or right after the full stop. */
export function parseArticle(markdown: string): ParsedArticle {
  const sections: Section[] = [{ heading: null, sentences: [] }];
  const badHeadings: string[] = [];
  const normalised = markdown.replace(/\r/gu, "").replace(/。((?:\s*\{f:?[^}]*\})+)/gu, "$1。");
  for (const rawLine of normalised.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{2,3}\s+(.+)$/u.exec(line);
    if (heading) {
      const name = heading[1].trim();
      if (!ALLOWED_HEADINGS.includes(name)) badHeadings.push(name);
      sections.push({ heading: name, sentences: [] });
      continue;
    }
    if (/^#\s/u.test(line)) continue; // the title line, if the model wrote one
    const section = sections[sections.length - 1];
    for (const chunk of line.replace(/^[-*・]\s*/u, "").split("。")) {
      const factIds: string[] = [];
      for (const match of chunk.matchAll(MARKER_GROUP)) for (const raw of match[1].split(/[,\s、]+/u)) {
        const id = raw.replace(/^(?:f:)+/u, "");
        if (id) factIds.push(/^\d+$/u.test(id) ? `f${id}` : id);
      }
      const text = chunk.replace(MARKER_GROUP, "").trim();
      if (!text) continue;
      section.sentences.push({ text: `${text}。`, factIds });
    }
  }
  return { sections, badHeadings };
}

/* ---- tokens ---- */

const KANJI_DIGIT: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const KANJI_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 二〇二〇 or 千九百四十五 -> number; null when the run is not a plain numeral. */
export function kanjiNumber(run: string): number | null {
  if (/^[〇一二三四五六七八九]+$/u.test(run)) return Number([...run].map((ch) => KANJI_DIGIT[ch]).join(""));
  if (!/^[〇一二三四五六七八九十百千]+$/u.test(run)) return null;
  let total = 0;
  let digit: number | null = null;
  for (const ch of run) {
    if (ch in KANJI_DIGIT) digit = KANJI_DIGIT[ch];
    else { total += (digit ?? 1) * KANJI_UNIT[ch]; digit = null; }
  }
  return total + (digit ?? 0);
}

const stripCommas = (text: string) => text.replace(/(\d),(?=\d{3}\b)/gu, "$1");

/** Arabic numbers of a text, commas removed, plus kanji numerals that stand before a counter (年月日世紀人回度). */
export function numberTokens(text: string): string[] {
  const normalised = stripCommas(text.normalize("NFKC"));
  const out = new Set<string>();
  for (const match of normalised.matchAll(/\d+(?:\.\d+)?/gu)) out.add(match[0]);
  for (const match of normalised.matchAll(/([〇一二三四五六七八九十百千]+)(?=[年月日世紀人回度号位])/gu)) {
    const value = kanjiNumber(match[1]);
    if (value !== null) out.add(String(value));
  }
  return [...out];
}

const DATE_PATTERN = /\d{1,4}年\d{1,2}月\d{1,2}日|\d{1,4}年\d{1,2}月|\d{1,2}月\d{1,2}日/gu;

const LATIN_RUN = /[a-z][a-z0-9'’-]*[a-z0-9]/gu;
const KATAKANA_RUN = /[ァ-ヶー]{2,}/gu;
const KANJI_RUN = /[一-鿿々〆]{2,}/gu;

/** Common nouns that are not proper names; a kanji run built only from these and from the facts is accepted. */
export const GENERIC_WORDS: readonly string[] = [
  "位置", "所在", "所在地", "存在", "現在", "当時", "時代", "年代", "世紀", "紀元", "出身", "国籍", "職業", "活動", "所属", "関係", "関連", "以下", "以上", "以前", "以後", "以降",
  "地域", "地方", "都市", "首都", "場所", "地点", "面積", "人口", "標高", "高度", "長さ", "距離", "名称", "名前", "呼称", "別名", "表記", "日本語", "英語", "言語", "公用語",
  "種類", "分類", "一種", "種別", "性別", "男性", "女性", "作品", "作者", "制作", "製作", "公開", "発表", "発売", "刊行", "出版", "設立", "創設", "創立", "開業", "開館", "開催",
  "発生", "期間", "期日", "日付", "開始", "終了", "終結", "結果", "参加", "参戦", "組織", "団体", "企業", "会社", "機関", "施設", "建築", "建設", "建物", "建造物", "構造", "所有",
  "管理", "運営", "運用", "主催", "主要", "代表", "中心", "周辺", "近郊", "周囲", "北部", "南部", "東部", "西部", "中部", "北東", "北西", "南東", "南西", "地理", "歴史", "経歴", "来歴", "沿革", "特徴", "概要",
  "記載", "記録", "情報", "公式", "同年", "同日", "同月", "翌年", "前年", "現存", "現行", "存続", "廃止", "閉鎖", "解散", "合併", "改称", "移転", "所蔵", "収蔵", "収録", "含む",
  "属する", "化学", "物質", "化合物", "分子", "化学式", "分子量", "質量", "密度", "温度", "融点", "沸点", "動物", "植物", "生物", "学名", "和名", "映画", "監督", "出演", "脚本", "音楽", "配給",
  "上映", "時間", "山脈", "河川", "半島", "山頂", "頂上", "国立", "公園", "保護", "地区", "区域", "行政", "自治体", "管轄", "州都", "県庁", "県庁所在地", "国家", "地名", "人物", "人名", "個人",
  "時点", "本作", "担当", "当館", "同市", "同県", "同郡", "同宮殿", "本公園", "同公園", "共和国", "王国", "帝国", "連邦", "公国", "自治区", "特別市", "事実", "事項", "項目", "対象", "内容", "目的", "用途", "利用", "使用", "提供", "生産", "製造", "販売", "取引", "決定", "実施", "実行", "成立", "誕生", "死去", "死亡", "没年", "生年",
  "出生", "出生地", "居住", "居住地", "親族", "配偶者", "父母", "学歴", "教育", "学校", "大学", "研究", "分野", "専門", "競技", "選手", "試合", "大会", "年間", "月間", "毎年", "各地", "全体",
  "部分", "一部", "全国", "世界", "国内", "国外", "海外", "周辺国", "隣接", "接する", "接続", "連結", "運行", "運航", "運賃", "乗客", "貨物", "路線", "鉄道", "道路", "空港", "港湾", "駅",
  "紛争", "戦争", "戦闘", "作戦", "勝利", "敗北", "交戦", "指揮", "軍事", "軍隊", "部隊", "選挙", "投票", "議会", "議員", "政府", "政党", "政治", "行事", "祭り", "祝祭", "宗教", "寺院", "神社",
  "教会", "城郭", "宮殿", "遺跡", "遺産", "文化", "芸術", "絵画", "彫刻", "小説", "漫画", "雑誌", "書籍", "書名", "題名", "著者", "出版社", "叢書", "原作", "続編", "前作", "次作", "登場",
];

/** Single characters that often close or open a place, organisation or title name. */
const SINGLE_OK = new Set([..."市町村区県都道府国州郡島山川湖海港駅園庁省部署館寺社城塔橋線軍団会党者人的"]);
const GENERIC_SET = new Set([...GENERIC_WORDS.map(fold), ...SINGLE_OK]);
const GENERIC_MAX = Math.max(...[...GENERIC_SET].map((word) => word.length));

/** True when `run` can be cut into pieces that are each a generic word or a piece (2+ characters) of the allowed text. */
function coveredByVocabulary(run: string, allowed: string): boolean {
  const reachable = new Array<boolean>(run.length + 1).fill(false);
  reachable[0] = true;
  for (let start = 0; start < run.length; start += 1) {
    if (!reachable[start]) continue;
    for (let length = 1; start + length <= run.length && length <= Math.max(GENERIC_MAX, 8); length += 1) {
      const piece = run.slice(start, start + length);
      if (GENERIC_SET.has(piece) || (length >= 2 && allowed.includes(piece))) reachable[start + length] = true;
    }
  }
  return reachable[run.length];
}

const EVALUATIVE = /有名|著名|重要|優れ|素晴らし|名高い|偉大|人気|代表的|最高の|傑作|画期的|魅力/u;
const META = /この記事|本記事|本節|この節|ここでは|以下では|次に見|について解説|を紹介/u;

export type SentenceVerdict = { ok: true } | { ok: false; reason: string; detail?: string };

export type ItemNames = { labelJa: string | null; labelEn: string | null; aliases: readonly string[] };

/** Text a sentence may draw its numbers and names from: the cited facts plus the item's own label and aliases. */
export function allowedText(cited: readonly Fact[], names: ItemNames): string {
  return fold([...cited.map((fact) => fact.text), names.labelJa ?? "", names.labelEn ?? "", ...names.aliases].join("\n"));
}

export function checkSentence(sentence: ParsedSentence, factsById: ReadonlyMap<string, Fact>, names: ItemNames): SentenceVerdict {
  if (sentence.factIds.length === 0) return { ok: false, reason: "no-citation" };
  const cited: Fact[] = [];
  for (const id of sentence.factIds) {
    const fact = factsById.get(id);
    if (!fact) return { ok: false, reason: "unknown-fact-id", detail: id };
    cited.push(fact);
  }
  const allowed = allowedText(cited, names);
  /* An evaluative word that the cited fact itself carries (a "重要文化財") is a name, not an opinion. */
  const evaluative = EVALUATIVE.exec(sentence.text)?.[0];
  if (evaluative && !allowed.includes(fold(evaluative))) return { ok: false, reason: "evaluative-wording", detail: evaluative };
  if (META.test(sentence.text)) return { ok: false, reason: "meta-writing", detail: META.exec(sentence.text)![0] };
  const allowedNumbers = new Set(numberTokens(allowed));
  const plain = stripCommas(sentence.text.normalize("NFKC")).toLowerCase();
  const text = fold(plain);
  for (const date of text.match(DATE_PATTERN) ?? []) if (!allowed.includes(date)) return { ok: false, reason: "date-not-in-facts", detail: date };
  for (const number of numberTokens(sentence.text)) if (!allowedNumbers.has(number)) return { ok: false, reason: "number-not-in-facts", detail: number };
  for (const token of plain.match(LATIN_RUN) ?? []) {
    if (!allowed.includes(token)) return { ok: false, reason: "name-not-in-facts", detail: token };
  }
  for (const token of plain.match(KATAKANA_RUN) ?? []) {
    /* katakana is compared in its folded (hiragana) form, like the allowed text */
    const folded = fold(token);
    if (!allowed.includes(folded) && !coveredByVocabulary(folded, allowed)) return { ok: false, reason: "name-not-in-facts", detail: token };
  }
  /* A counter glued to a digit ("31日", "2015年") is part of the number, not a name. */
  const withoutCounted = plain.replace(/\d+(?:\.\d+)?\s*[年月日号位回人度]/gu, " ");
  for (const token of withoutCounted.match(KANJI_RUN) ?? []) {
    if (kanjiNumber(token) !== null || allowed.includes(token) || coveredByVocabulary(token, allowed)) continue;
    return { ok: false, reason: "name-not-in-facts", detail: token };
  }
  return { ok: true };
}

export type DroppedSentence = { text: string; reason: string; detail?: string; section: string | null };
export type ArticleVerdict = {
  accepted: boolean;
  rejectReason: string | null;
  sections: Array<{ heading: string | null; sentences: Array<{ text: string; factIds: string[] }> }>;
  kept: number;
  dropped: DroppedSentence[];
  /** Headings the model used that are not in the class plan (their sentences are dropped). */
  badHeadings: string[];
};

export const STYLE_MIN_SENTENCES = 4;
export const STYLE_MAX_SHARE = 0.6;

/** The subject token of a sentence: its opening up to the first topic/subject particle or comma (at most 12 characters). */
export function subjectToken(sentence: string): string {
  const text = fold(sentence.replace(/^[「『（(]/u, ""));
  const match = /^(.{1,12}?)(?:は|が|も|、)/u.exec(text);
  return match ? match[1] : text.slice(0, 4);
}

export type StyleVerdict = { ok: boolean; reason: "style-monotone-ending" | "style-monotone-subject" | null; share: number };

/**
 * Deterministic rhythm check on the kept sentences: an article is rejected when more than 60% of its sentences end in である
 * or more than 60% start with the same subject token (only judged from four sentences up).
 */
export function checkStyle(sentences: readonly string[]): StyleVerdict {
  if (sentences.length < STYLE_MIN_SENTENCES) return { ok: true, reason: null, share: 0 };
  const endings = sentences.filter((text) => /である。?$/u.test(text.trim())).length / sentences.length;
  if (endings > STYLE_MAX_SHARE) return { ok: false, reason: "style-monotone-ending", share: endings };
  const subjects = new Map<string, number>();
  for (const text of sentences) { const token = subjectToken(text); subjects.set(token, (subjects.get(token) ?? 0) + 1); }
  const top = Math.max(...subjects.values()) / sentences.length;
  if (top > STYLE_MAX_SHARE) return { ok: false, reason: "style-monotone-subject", share: top };
  return { ok: true, reason: null, share: Math.max(endings, top) };
}

export type PlanOptions = { headings?: readonly string[] };

export function checkArticle(markdown: string, facts: readonly Fact[], names: ItemNames, plan: PlanOptions = {}): ArticleVerdict {
  const allowedHeadings = plan.headings ?? ALLOWED_HEADINGS;
  const badHeadings = new Set<string>();
  const factsById = new Map(facts.map((fact) => [fact.id, fact] as const));
  const parsed = parseArticle(markdown);
  const dropped: DroppedSentence[] = [];
  const seen = new Set<string>();
  const sections: ArticleVerdict["sections"] = [];
  for (const section of parsed.sections) {
    const headingOk = section.heading === null || allowedHeadings.includes(section.heading);
    if (!headingOk && section.heading !== null) badHeadings.add(section.heading);
    const kept: ParsedSentence[] = [];
    for (const sentence of section.sentences) {
      if (!headingOk) { dropped.push({ text: sentence.text, reason: "heading-not-allowed", detail: section.heading ?? undefined, section: section.heading }); continue; }
      /* In a planned article a named section may only restate facts the plan put under that heading. */
      if (plan.headings && section.heading !== null && !sentence.factIds.some((id) => factsById.get(id)?.section === section.heading)) {
        dropped.push({ text: sentence.text, reason: "wrong-section", detail: section.heading, section: section.heading });
        continue;
      }
      const verdict = checkSentence(sentence, factsById, names);
      if (!verdict.ok) { dropped.push({ text: sentence.text, reason: verdict.reason, detail: verdict.detail, section: section.heading }); continue; }
      if (seen.has(sentence.text)) { dropped.push({ text: sentence.text, reason: "duplicate", section: section.heading }); continue; }
      seen.add(sentence.text);
      kept.push(sentence);
    }
    if (kept.length) sections.push({ heading: section.heading, sentences: kept });
  }
  const total = sections.reduce((sum, section) => sum + section.sentences.length, 0);
  const hasLead = sections.some((section) => section.heading === null && section.sentences.length > 0);
  const style = checkStyle(sections.flatMap((section) => section.sentences.map((sentence) => sentence.text)));
  const rejectReason = !hasLead ? "no-lead" : total < MIN_SENTENCES ? "too-few-sentences" : style.reason;
  return { accepted: rejectReason === null, rejectReason, sections, kept: total, dropped, badHeadings: [...badHeadings] };
}

/** The final markdown: lead, then ## sections, markers removed. */
export function renderBody(sections: ArticleVerdict["sections"]): string {
  return sections.map((section) => `${section.heading ? `## ${section.heading}\n` : ""}${section.sentences.map((sentence) => sentence.text).join("")}`).join("\n\n");
}
