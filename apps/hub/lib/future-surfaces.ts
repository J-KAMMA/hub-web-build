export const FUTURE_SURFACES = {
  videos: {
    name: "動画",
    route: "/videos",
    owns: ["動画メタデータ", "チャンネル", "再生状態", "公開コメント"],
    excludes: ["Identityの本人情報", "マーケットの注文・配送情報", "Vaultの保護ファイル"]
  },
  market: {
    name: "マーケット",
    route: "/market/products",
    owns: ["公開商品カタログ", "出品者の公開ページ", "レビュー", "お気に入り"],
    excludes: ["配送先住所", "決済情報", "Identityの本人情報", "Vaultのアクセス権"]
  }
} as const;

export type FutureSurfaceId = keyof typeof FUTURE_SURFACES;
