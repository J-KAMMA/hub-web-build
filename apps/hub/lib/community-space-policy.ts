export const COMMUNITY_SPACE_ROUTE = "/community" as const;

export const COMMUNITY_NODE_MODES = ["hub-standard", "local", "external"] as const;
export type CommunityNodeMode = (typeof COMMUNITY_NODE_MODES)[number];

export const COMMUNITY_INFORMATION_ARCHITECTURE = {
  community: {
    label: "コミュニティ",
    purpose: "共通の関心、参加者、ルール、話題をまとめる空間",
    owns: ["参加状態", "役職", "ルール", "チャンネル", "ガバナンス"],
  },
  channel: {
    label: "チャンネル",
    purpose: "コミュニティ内の話題と投稿先を分ける場所",
    owns: ["話題", "投稿種別", "閲覧・投稿権限"],
  },
  node: {
    label: "保存・配信ノード",
    purpose: "公開原本を保管し、必要に応じて配信する基盤",
    owns: ["原本", "配信", "可用性", "ミラー方針"],
  },
} as const;

export function communityNodeModeLabel(mode: CommunityNodeMode) {
  if (mode === "local") return "Personal Node";
  if (mode === "external") return "外部ノード";
  return "Hub管理";
}

export function isCommunityNodeMode(value: unknown): value is CommunityNodeMode {
  return COMMUNITY_NODE_MODES.includes(value as CommunityNodeMode);
}

export function communityRoute(slug?: string) {
  return slug
    ? `${COMMUNITY_SPACE_ROUTE}?community=${encodeURIComponent(slug)}`
    : COMMUNITY_SPACE_ROUTE;
}
