import {
  DISTRIBUTED_RESOURCE_KINDS,
  type DistributedResourceKind,
} from "@/lib/distributed-resource-manifest";

export type DistributedNodeMode = "hub-standard" | "local" | "external";

export const DISTRIBUTED_NODE_GROUPS = [
  { id: "social", label: "交流", kinds: ["post", "thread", "community"] },
  { id: "knowledge", label: "知識", kinds: ["article"] },
  { id: "media", label: "メディア", kinds: ["image", "audio", "file"] },
  { id: "commerce", label: "市場", kinds: ["product", "catalog", "logistics"] },
  { id: "intelligence", label: "計算・発見", kinds: ["compute", "search", "recommendation"] },
  { id: "infrastructure", label: "基盤", kinds: ["storage"] },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  kinds: readonly DistributedResourceKind[];
}>;

export const DISTRIBUTED_KIND_COPY: Record<DistributedResourceKind, { label: string; description: string }> = {
  post: { label: "ポスト", description: "公開ポストの原本と配信" },
  thread: { label: "スレッド", description: "公開スレッドと返信の原本" },
  community: { label: "コミュニティ", description: "公開コミュニティ情報の連合" },
  article: { label: "Hubpedia", description: "記事、版履歴、出典の原本" },
  image: { label: "画像", description: "画像原本、サムネイル、ミラー" },
  audio: { label: "音楽", description: "公開音源と配信用マニフェスト" },
  file: { label: "Vault公開物", description: "許可された公開ファイルの原本" },
  product: { label: "商品", description: "販売者が所有する商品情報" },
  catalog: { label: "カタログ", description: "販売者の商品一覧と更新情報" },
  compute: { label: "Compute", description: "AI・計算処理の実行先" },
  search: { label: "検索", description: "検索結果を作るプロバイダー" },
  recommendation: { label: "おすすめ", description: "フィードを順位付けするプロバイダー" },
  logistics: { label: "物流", description: "許認可済み物流ノードの情報" },
  storage: { label: "保存", description: "公開原本の既定保存基盤" },
};

export const AUTHORITATIVE_HUB_DOMAINS = [
  "認証・アカウント連携",
  "決済確定・返金・会計",
  "KYC・法的個人情報",
  "通報・凍結・異議申立て",
  "権限変更・監査ログ",
  "非公開DMの暗号鍵",
] as const;

export function isDistributedPreferenceKind(value: unknown): value is DistributedResourceKind {
  return DISTRIBUTED_RESOURCE_KINDS.includes(value as DistributedResourceKind);
}

export function nodeModeLabel(mode: DistributedNodeMode) {
  if (mode === "local") return "Personal Node";
  if (mode === "external") return "外部ノード";
  return "Hub";
}
