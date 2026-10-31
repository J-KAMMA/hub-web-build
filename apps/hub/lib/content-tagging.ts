import { extractContentTags, normalizeContentTag } from "@/lib/content-tags";

export type ContentTagProvenance = "structured" | "category" | "rule" | "link" | "publisher";
export type ContentTagSignal = {
  tag: string;
  kind: string;
  confidence: number;
  provenance: ContentTagProvenance;
  basis: string;
  classifierVersion: string;
};

export const CONTENT_TAG_CLASSIFIER_VERSION = "hub-content-tags-v1";

type Rule = [RegExp, string, string, number];
type Common = { existingCategory?: string; publisherTags?: string[] };
export type TaggableContent =
  | (Common & { target: "social_post"; body: string; urls?: string[]; destination?: string; attachmentTypes?: string[] })
  | (Common & { target: "thread"; title: string; body: string; board?: string; solved?: boolean })
  | (Common & { target: "hubpedia"; title: string; summary: string; headings?: string[] })
  | (Common & { target: "product"; title: string; manufacturer?: string; model?: string; price?: number; specifications?: string[] })
  | (Common & { target: "real_estate"; title: string; region?: string; propertyType?: string; layout?: string; price?: number; facilities?: string[]; builtYear?: number })
  | (Common & { target: "vehicle"; title: string; manufacturer?: string; model?: string; year?: number; fuel?: string; bodyType?: string; purpose?: string })
  | (Common & { target: "work"; title: string; industry?: string; employmentType?: string; location?: string; skills?: string[]; remote?: boolean })
  | (Common & { target: "advertisement"; advertiserCategory: string; destinationClassification?: string; destinationVerified?: boolean })
  | (Common & { target: "vault"; title: string; description?: string; format?: string; audience?: string });

const PERSON_ATTRIBUTE_PATTERN = /(?:投稿者|作者|出品者|応募者|広告主|この人|本人|ユーザー).{0,12}(?:政治思想|支持政党|健康状態|病歴|障害|宗教|信仰|人種|民族|性的指向|性自認)/iu;
const SENSITIVE_KIND_PATTERN = /^(?:person-|user-)?(?:politics|health|religion|race|ethnicity|sexuality|gender-identity|sensitive-attribute)$/iu;

function signal(tag: string, kind: string, confidence: number, provenance: ContentTagProvenance, basis: string): ContentTagSignal {
  return { tag: normalizeContentTag(tag), kind, confidence: Math.max(0, Math.min(1, confidence)), provenance, basis, classifierVersion: CONTENT_TAG_CLASSIFIER_VERSION };
}

function addRules(output: ContentTagSignal[], text: string, rules: Rule[]) {
  for (const [pattern, tag, kind, confidence] of rules) {
    if (pattern.test(text)) output.push(signal(tag, kind, confidence, "rule", `matched:${pattern.source}`));
  }
}

function addCommon(output: ContentTagSignal[], input: Common) {
  if (input.existingCategory) output.push(signal(input.existingCategory, "category", .98, "category", "existing-category"));
  for (const tag of input.publisherTags ?? []) output.push(signal(tag, "publisher", .94, "publisher", "publisher-supplied"));
}

function priceBand(price?: number) {
  if (price == null || !Number.isFinite(price) || price < 0) return "";
  if (price < 5_000) return "低価格";
  if (price < 50_000) return "中価格";
  return "高価格";
}

export function isAllowedContentTagSignal(item: ContentTagSignal): boolean {
  return Boolean(item.tag)
    && !SENSITIVE_KIND_PATTERN.test(item.kind)
    && !PERSON_ATTRIBUTE_PATTERN.test(`${item.tag} ${item.basis}`);
}

export function sanitizeContentTagSignals(input: ContentTagSignal[]): ContentTagSignal[] {
  const unique = new Map<string, ContentTagSignal>();
  for (const item of input) {
    if (!isAllowedContentTagSignal(item)) continue;
    const key = `${item.kind}:${item.tag.toLocaleLowerCase("ja-JP")}`;
    const previous = unique.get(key);
    if (!previous || item.confidence > previous.confidence) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 32);
}

export function searchableContentTagText(signals: ContentTagSignal[], minimumConfidence = .5): string {
  return sanitizeContentTagSignals(signals)
    .filter((item) => item.confidence >= minimumConfidence)
    .map((item) => item.tag)
    .join(" ");
}

export function contentTagRecommendationScore(
  preferredTags: string[],
  signals: ContentTagSignal[],
  engagementWeight = 0,
): number {
  const preferred = new Set(preferredTags.map((tag) => normalizeContentTag(tag).toLocaleLowerCase("ja-JP")));
  const tagScore = sanitizeContentTagSignals(signals)
    .filter((item) => item.confidence >= .5 && preferred.has(item.tag.toLocaleLowerCase("ja-JP")))
    .reduce((total, item) => total + item.confidence, 0);
  return tagScore + Math.max(0, engagementWeight);
}

export function inferContentTagSignals(input: TaggableContent): ContentTagSignal[] {
  const output: ContentTagSignal[] = [];
  addCommon(output, input);

  if (input.target === "social_post") {
    const hashtags = extractContentTags(input.body);
    for (const tag of hashtags) output.push(signal(tag, "topic", .96, "structured", "hashtag"));
    if (input.destination) output.push(signal(input.destination, "destination", .88, "structured", "posting-destination"));
    for (const type of input.attachmentTypes ?? []) output.push(signal(type, "format", .95, "structured", "attachment-type"));
    const text = `${input.body} ${(input.urls ?? []).join(" ")}`.normalize("NFKC");
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text)) output.push(signal("日本語", "language", .9, "rule", "script-detection"));
    else if (/[a-z]{4}/iu.test(text)) output.push(signal("英語", "language", .78, "rule", "script-detection"));
    addRules(output, text, [
      [/(?:募集|募集中|参加者|メンバー)/u, "募集", "format", .82],
      [/(?:質問|教えて|どうすれば|[?？])/u, "質問", "format", .76],
      [/(?:ニュース|速報|発表)/u, "ニュース", "format", .72],
      [/(?:嬉しい|最高|楽しい|ありがとう)/u, "ポジティブ", "sentiment", .65],
      [/(?:悲しい|残念|つらい|困った)/u, "ネガティブ", "sentiment", .62],
      [/(?:東京|大阪|北海道|沖縄|京都)/u, "日本・地域情報", "region", .7],
    ]);
  } else if (input.target === "thread") {
    const text = `${input.title} ${input.body} ${input.board ?? ""}`;
    if (input.board) output.push(signal(input.board, "board", .96, "structured", "board"));
    if (input.solved) output.push(signal("解決済み", "status", 1, "structured", "solved-state"));
    addRules(output, text, [
      [/(?:質問|教えて|相談|[?？])/u, "質問", "format", .88],
      [/(?:議論|意見|どう思う)/u, "議論", "format", .82],
      [/(?:募集|参加者|求人)/u, "募集", "format", .86],
      [/(?:解決|自己解決)/u, "解決", "status", .74],
      [/(?:AI|人工知能|機械学習)/iu, "AI", "theme", .84],
    ]);
  } else if (input.target === "hubpedia") {
    const text = `${input.title} ${input.summary} ${(input.headings ?? []).join(" ")}`;
    addRules(output, text, [
      [/(?:人物|生まれ|俳優|作家|研究者)/u, "人物", "entity", .8],
      [/(?:都市|地域|国|地理|場所)/u, "場所", "entity", .78],
      [/(?:技術|ソフトウェア|AI|工学)/iu, "技術", "topic", .84],
      [/(?:歴史|時代|世紀|沿革)/u, "歴史", "topic", .82],
      [/(?:文化|芸術|文学|音楽)/u, "文化", "topic", .8],
    ]);
  } else if (input.target === "product") {
    if (input.manufacturer) output.push(signal(input.manufacturer, "brand", 1, "structured", "manufacturer"));
    if (input.model) output.push(signal(input.model, "model", 1, "structured", "model-number"));
    const band = priceBand(input.price);
    if (band) output.push(signal(band, "price-band", 1, "structured", "price"));
    const text = `${input.title} ${(input.specifications ?? []).join(" ")}`;
    addRules(output, text, [
      [/(?:PC|パソコン|スマホ|カメラ|イヤホン)/iu, "電子機器", "product-category", .86],
      [/(?:家具|チェア|机|テーブル)/u, "家具", "product-category", .86],
      [/(?:業務用|プロ向け)/u, "業務用", "use", .8],
      [/(?:家庭用|初心者)/u, "家庭用", "use", .76],
    ]);
  } else if (input.target === "real_estate") {
    if (input.region) output.push(signal(input.region, "region", 1, "structured", "address-region"));
    if (input.propertyType) output.push(signal(input.propertyType, "property-type", 1, "structured", "property-type"));
    if (input.layout) output.push(signal(input.layout, "layout", 1, "structured", "layout"));
    for (const facility of input.facilities ?? []) output.push(signal(facility, "facility", .98, "structured", "facility"));
    const band = priceBand(input.price);
    if (band) output.push(signal(band, "price-band", 1, "structured", "price"));
    if (input.builtYear) output.push(signal(`${input.builtYear}年築`, "built-year", 1, "structured", "built-year"));
  } else if (input.target === "vehicle") {
    for (const [tag, kind, basis] of [[input.manufacturer, "brand", "manufacturer"], [input.model, "model", "model"], [input.fuel, "fuel", "fuel"], [input.bodyType, "body-type", "body-type"], [input.purpose, "use", "purpose"]] as const) {
      if (tag) output.push(signal(tag, kind, 1, "structured", basis));
    }
    if (input.year) output.push(signal(`${input.year}年式`, "model-year", 1, "structured", "year"));
  } else if (input.target === "work") {
    for (const [tag, kind, basis] of [[input.industry, "industry", "industry"], [input.employmentType, "employment-type", "employment-type"], [input.location, "location", "location"]] as const) {
      if (tag) output.push(signal(tag, kind, 1, "structured", basis));
    }
    for (const skill of input.skills ?? []) output.push(signal(skill, "skill", .98, "structured", "required-skill"));
    if (input.remote != null) output.push(signal(input.remote ? "リモート可" : "出社", "work-style", 1, "structured", "remote-policy"));
  } else if (input.target === "advertisement") {
    output.push(signal(input.advertiserCategory, "advertiser-category", 1, "publisher", "advertiser-declared"));
    if (input.destinationClassification && input.destinationVerified) output.push(signal(input.destinationClassification, "destination-category", .95, "link", "verified-destination"));
  } else if (input.target === "vault") {
    if (input.format) output.push(signal(input.format, "work-format", 1, "structured", "public-format"));
    if (input.audience) output.push(signal(input.audience, "audience", .9, "publisher", "public-audience"));
    addRules(output, `${input.title} ${input.description ?? ""}`, [
      [/(?:小説|物語|フィクション)/u, "物語", "theme", .78],
      [/(?:解説|入門|ガイド|教程)/u, "学習", "theme", .78],
      [/(?:素材|テンプレート)/u, "制作用素材", "theme", .82],
    ]);
  }

  return sanitizeContentTagSignals(output);
}
