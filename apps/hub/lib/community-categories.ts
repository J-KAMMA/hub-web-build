export const COMMUNITY_CATEGORIES = [
  "交流・雑談",
  "ゲーム",
  "ゲーム攻略",
  "アニメ・漫画",
  "テクノロジー",
  "AI・データ",
  "プログラミング",
  "仕事・創作",
  "デザイン",
  "イラスト",
  "写真",
  "音楽",
  "本・映画",
  "映像",
  "暮らし",
  "料理・グルメ",
  "健康・フィットネス",
  "学び・交流",
  "語学",
  "科学",
  "スポーツ",
  "旅行",
  "地域",
  "その他",
] as const;

export const COMMUNITY_CATEGORY_GROUPS = [
  { label: "交流", categories: ["交流・雑談", "地域", "その他"] },
  { label: "ゲーム・エンタメ", categories: ["ゲーム", "ゲーム攻略", "アニメ・漫画", "音楽", "本・映画", "映像"] },
  { label: "テクノロジー", categories: ["テクノロジー", "AI・データ", "プログラミング", "科学"] },
  { label: "創作", categories: ["仕事・創作", "デザイン", "イラスト", "写真"] },
  { label: "暮らし・学び", categories: ["暮らし", "料理・グルメ", "健康・フィットネス", "学び・交流", "語学", "スポーツ", "旅行"] },
] as const;

export function getCommunityCategoryOptions(existing: readonly string[] = []) {
  return Array.from(
    new Set([
      ...COMMUNITY_CATEGORIES,
      ...existing.map((category) => category.trim()).filter(Boolean),
    ]),
  );
}
