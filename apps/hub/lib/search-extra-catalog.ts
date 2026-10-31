export type WorkSearchItem = {
  id: string;
  kind: "job" | "project" | "service";
  title: string;
  organization: string;
  summary: string;
  location: string;
  compensation: string;
  tags: string[];
};

export const WORK_SEARCH_ITEMS: WorkSearchItem[] = [
  { id: "designer", kind: "job", title: "プロダクトデザイナー", organization: "Orbit Works", summary: "クリエイター向けプロダクトの調査、UI設計、デザインシステム運用", location: "東京・リモート可", compensation: "年収550〜750万円", tags: ["Figma", "UI", "デザイン"] },
  { id: "frontend", kind: "job", title: "フロントエンドエンジニア", organization: "Fieldnote Inc.", summary: "Next.jsを利用したWebサービスの継続開発", location: "フルリモート", compensation: "月額60〜90万円", tags: ["TypeScript", "Next.js", "Cloudflare"] },
  { id: "editor", kind: "job", title: "動画コンテンツ編集担当", organization: "Frame Journal", summary: "インタビュー動画の編集、字幕、サムネイル制作", location: "大阪・一部リモート", compensation: "時給1,800円〜", tags: ["動画", "Premiere Pro"] },
  { id: "worker-api", kind: "project", title: "Cloudflare Workers APIのレビューと改善", organization: "@tiny_stack", summary: "既存APIのセキュリティと性能を確認し、修正案を実装", location: "オンライン", compensation: "10万〜18万円", tags: ["Workers", "TypeScript", "API"] },
  { id: "translation", kind: "service", title: "技術記事の日英翻訳と編集", organization: "Clear Language", summary: "技術用語を確認しながら自然な英語へ翻訳・校正", location: "オンライン", compensation: "1文字12円〜", tags: ["翻訳", "編集", "技術記事"] },
];

