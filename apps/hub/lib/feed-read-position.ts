export type FeedReadPositionInput = {
  view: "recommended" | "popular" | "following" | `lists:${string}`;
  itemId: string;
  itemType: "social" | "thread";
  listId: string | null;
  sourceItemId: string;
};

const ITEM_ID = /^[A-Za-z0-9_-]{1,100}$/;
const LIST_VIEW = /^lists:([A-Za-z0-9_-]{1,100})$/;

export function normalizeFeedReadPositionInput(value: unknown): FeedReadPositionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { view?: unknown; itemId?: unknown };
  if (typeof candidate.view !== "string" || typeof candidate.itemId !== "string") return null;

  const listMatch = candidate.view.match(LIST_VIEW);
  if (listMatch) {
    const threadItem = candidate.itemId.startsWith("thread:");
    const sourceItemId = threadItem ? candidate.itemId.slice("thread:".length) : candidate.itemId;
    if (!ITEM_ID.test(sourceItemId)) return null;
    return {
      view: candidate.view as `lists:${string}`,
      itemId: threadItem ? `thread:${sourceItemId}` : sourceItemId,
      itemType: threadItem ? "thread" : "social",
      listId: listMatch[1],
      sourceItemId,
    };
  }

  if (!["recommended", "popular", "following"].includes(candidate.view) || !ITEM_ID.test(candidate.itemId)) {
    return null;
  }
  return {
    view: candidate.view as "recommended" | "popular" | "following",
    itemId: candidate.itemId,
    itemType: "social",
    listId: null,
    sourceItemId: candidate.itemId,
  };
}
