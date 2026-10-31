export type WorkMarketplaceMode = "jobs" | "crowdsourcing";

export type WorkCategoryNode = {
  id: string;
  label: string;
  children: ReadonlyArray<{ id: string; label: string }>;
};

export const WORK_CATEGORY_TAXONOMY: Record<
  WorkMarketplaceMode,
  ReadonlyArray<WorkCategoryNode>
> = {
  jobs: [
    {
      id: "development",
      label: "IT・エンジニア",
      children: [
        { id: "job-frontend", label: "フロントエンド" },
        { id: "job-backend", label: "バックエンド" },
        { id: "job-mobile", label: "アプリ開発" },
        { id: "job-ai-data", label: "AI・データ" },
        { id: "job-infrastructure", label: "インフラ・セキュリティ" },
      ],
    },
    {
      id: "design",
      label: "デザイン・クリエイティブ",
      children: [
        { id: "job-ui-design", label: "UI・UXデザイン" },
        { id: "job-graphic-design", label: "グラフィックデザイン" },
        { id: "job-video-creative", label: "映像・制作" },
      ],
    },
    {
      id: "marketing",
      label: "営業・マーケティング",
      children: [
        { id: "job-corporate-sales", label: "法人営業" },
        { id: "job-sales-planning", label: "営業企画" },
        { id: "job-digital-marketing", label: "デジタルマーケティング" },
        { id: "job-public-relations", label: "広報・PR" },
      ],
    },
    {
      id: "operations",
      label: "事務・管理",
      children: [
        { id: "job-general-affairs", label: "事務・総務" },
        { id: "job-human-resources", label: "人事・採用" },
        { id: "job-accounting", label: "経理・財務" },
        { id: "job-legal", label: "法務" },
      ],
    },
    {
      id: "writing",
      label: "編集・コンテンツ",
      children: [
        { id: "job-editorial", label: "編集・ライティング" },
        { id: "job-translation", label: "翻訳・通訳" },
        { id: "job-community", label: "コミュニティ運営" },
      ],
    },
    {
      id: "consulting",
      label: "専門職・その他",
      children: [
        { id: "job-consulting", label: "コンサルティング" },
        { id: "job-education", label: "教育" },
        { id: "job-customer-support", label: "カスタマーサポート" },
        { id: "job-other", label: "その他" },
      ],
    },
  ],
  crowdsourcing: [
    {
      id: "development",
      label: "開発",
      children: [
        { id: "crowd-web-development", label: "Web制作" },
        { id: "crowd-app-development", label: "アプリ開発" },
        { id: "crowd-system-development", label: "システム開発" },
        { id: "crowd-maintenance", label: "保守・修正" },
        { id: "crowd-ai-data", label: "AI・データ処理" },
      ],
    },
    {
      id: "design",
      label: "デザイン",
      children: [
        { id: "crowd-ui-design", label: "UI・UX" },
        { id: "crowd-logo-design", label: "ロゴ・ブランド" },
        { id: "crowd-illustration", label: "イラスト" },
        { id: "crowd-image-production", label: "画像制作" },
      ],
    },
    {
      id: "writing",
      label: "ライティング・翻訳",
      children: [
        { id: "crowd-article-writing", label: "記事作成" },
        { id: "crowd-editing", label: "編集・校正" },
        { id: "crowd-translation", label: "翻訳" },
        { id: "crowd-copywriting", label: "コピーライティング" },
      ],
    },
    {
      id: "marketing",
      label: "マーケティング",
      children: [
        { id: "crowd-market-research", label: "市場調査" },
        { id: "crowd-social-media", label: "SNS運用" },
        { id: "crowd-advertising", label: "広告運用" },
        { id: "crowd-seo", label: "SEO" },
      ],
    },
    {
      id: "creative",
      label: "動画・音声",
      children: [
        { id: "crowd-video-editing", label: "動画編集" },
        { id: "crowd-animation", label: "アニメーション" },
        { id: "crowd-audio", label: "音声・ナレーション" },
        { id: "crowd-music", label: "音楽制作" },
      ],
    },
    {
      id: "operations",
      label: "業務支援・その他",
      children: [
        { id: "crowd-data-entry", label: "データ入力" },
        { id: "crowd-online-assistant", label: "オンライン事務" },
        { id: "crowd-consulting", label: "相談・コンサルティング" },
        { id: "crowd-education", label: "レッスン・教育" },
        { id: "crowd-other", label: "その他" },
      ],
    },
  ],
};

export function workCategoryLabel(mode: WorkMarketplaceMode, categoryId: string) {
  for (const parent of WORK_CATEGORY_TAXONOMY[mode]) {
    if (parent.id === categoryId) return parent.label;
    const child = parent.children.find((item) => item.id === categoryId);
    if (child) return child.label;
  }
  return categoryId;
}

export function workCategoryMatches(
  mode: WorkMarketplaceMode,
  listingCategory: string,
  selectedCategory: string,
) {
  if (selectedCategory === "all") return true;
  if (listingCategory === selectedCategory) return true;
  const parent = WORK_CATEGORY_TAXONOMY[mode].find(
    (item) => item.id === selectedCategory,
  );
  return Boolean(parent?.children.some((item) => item.id === listingCategory));
}

const COMMON_WORK_TAGS = ["未経験可", "経験者歓迎", "リモート", "短期", "長期"];
const CATEGORY_TAG_SUGGESTIONS: Record<string, string[]> = {
  development: ["TypeScript", "JavaScript", "Python", "Git", "Web開発"],
  design: ["Figma", "UIデザイン", "UXリサーチ", "Illustrator"],
  writing: ["記事作成", "編集", "校正", "翻訳", "SEO"],
  marketing: ["SNS運用", "広告運用", "市場調査", "分析"],
  operations: ["顧客対応", "文書作成", "表計算", "業務改善"],
  creative: ["動画編集", "画像制作", "音声編集", "制作進行"],
  consulting: ["要件定義", "課題分析", "事業企画", "プロジェクト管理"],
};

export function workTagSuggestions(mode: WorkMarketplaceMode, categoryId: string) {
  const parent = WORK_CATEGORY_TAXONOMY[mode].find(
    (item) => item.id === categoryId || item.children.some((child) => child.id === categoryId),
  );
  return [...(CATEGORY_TAG_SUGGESTIONS[parent?.id ?? categoryId] ?? []), ...COMMON_WORK_TAGS];
}
