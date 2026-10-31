export type HubCategoryId = "governance" | "technology" | "science" | "culture" | "economy" | "community" | "music" | "games" | "life" | "sports" | "world";

export type HubCategory = {
  id: HubCategoryId;
  label: string;
  description: string;
  aliases: readonly string[];
};

export const HUB_CATEGORIES: readonly HubCategory[] = [
  { id: "governance", label: "政治・制度", description: "政治、法律、行政、公共制度", aliases: ["政治", "制度", "法律", "行政", "社会", "governance", "politics", "law"] },
  { id: "technology", label: "技術・AI", description: "AI、ソフトウェア、インターネット、ものづくり", aliases: ["技術", "テクノロジー", "AI", "人工知能", "プログラミング", "開発", "technology", "software", "electronics"] },
  { id: "science", label: "科学・自然", description: "数学、物理、生命、宇宙、環境", aliases: ["科学", "自然", "数学", "物理", "生物", "宇宙", "環境", "science", "nature"] },
  { id: "culture", label: "文化・創作", description: "本、映画、漫画、芸術、デザイン", aliases: ["文化", "創作", "本", "映画", "漫画", "アニメ", "芸術", "デザイン", "culture", "creator", "books"] },
  { id: "economy", label: "経済・仕事", description: "市場、企業、金融、仕事、プロジェクト", aliases: ["経済", "仕事", "企業", "金融", "ビジネス", "求人", "economy", "business", "work"] },
  { id: "community", label: "地域・コミュニティ", description: "地域活動、交流、共同制作", aliases: ["地域", "コミュニティ", "交流", "共同制作", "community", "local"] },
  { id: "music", label: "音楽", description: "楽曲、アーティスト、演奏、プレイリスト", aliases: ["音楽", "楽曲", "アーティスト", "演奏", "music", "audio"] },
  { id: "games", label: "動画・ゲーム", description: "動画、配信、ゲーム、攻略", aliases: ["動画", "配信", "ゲーム", "攻略", "video", "games", "gaming", "hobby"] },
  { id: "life", label: "暮らし・健康", description: "健康、食、住まい、美容、育児", aliases: ["暮らし", "健康", "食", "料理", "キッチン", "住まい", "美容", "育児", "life", "health", "food", "living", "beauty", "baby", "pet", "coffee-tea"] },
  { id: "sports", label: "スポーツ", description: "競技、運動、アウトドア", aliases: ["スポーツ", "競技", "運動", "アウトドア", "sports", "fitness", "outdoor"] },
  { id: "world", label: "地域・世界", description: "国、都市、歴史、旅行、地理", aliases: ["世界", "国", "都市", "歴史", "旅行", "地理", "world", "history", "travel"] },
] as const;

const categoryById = new Map(HUB_CATEGORIES.map((category) => [category.id, category]));
const normalizedAliasEntries = HUB_CATEGORIES.flatMap((category) => [category.id, category.label, ...category.aliases].map((alias) => [normalizeTaxonomyText(alias), category.id] as const));

export function normalizeTaxonomyText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ja");
}

export function hubCategory(id: string) {
  return categoryById.get(id as HubCategoryId);
}

export function resolveHubCategoryIds(...values: Array<string | null | undefined>): HubCategoryId[] {
  const text = normalizeTaxonomyText(values.filter(Boolean).join(" "));
  if (!text) return [];
  const scores = new Map<HubCategoryId, number>();
  for (const [alias, id] of normalizedAliasEntries) {
    if (!alias) continue;
    const ascii = /^[a-z0-9+#.-]+$/iu.test(alias);
    const matched = ascii
      ? new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "iu").test(text)
      : text.includes(alias);
    if (!matched) continue;
    scores.set(id, (scores.get(id) ?? 0) + Math.max(1, alias.length));
  }
  return [...scores].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 3).map(([id]) => id);
}

export function hubCategorySearchTerms(value: string): string[] {
  const normalized = normalizeTaxonomyText(value);
  const ids = resolveHubCategoryIds(normalized);
  const terms = new Set([normalized]);
  for (const id of ids) {
    const category = hubCategory(id);
    if (!category) continue;
    terms.add(category.id); terms.add(category.label);
    for (const alias of category.aliases) terms.add(normalizeTaxonomyText(alias));
  }
  return [...terms].filter(Boolean);
}

export function hubCategorySearchText(...values: Array<string | null | undefined>) {
  const original = values.filter(Boolean).join(" ");
  const categories = resolveHubCategoryIds(original).flatMap((id) => {
    const category = hubCategory(id); return category ? [category.id, category.label, ...category.aliases] : [];
  });
  return [original, ...categories].join(" ");
}
