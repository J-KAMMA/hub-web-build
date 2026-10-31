import type { DirectMessage, MessageConversation, Profile } from "@/lib/domain";

/*
 * メッセージの純粋な計算。既存の messages-workspace.tsx の中にあった小さな
 * 関数をここへ。サーバー（内側左列の会話一覧）とクライアントの両方から使う。
 */

export const MESSAGE_MAX = 280;

export function conversationPartner(conversation: MessageConversation, selfId: string, profiles: Map<string, Profile>): Profile | undefined {
  const partnerId = conversation.participantIds.find((id) => id !== selfId) ?? conversation.participantIds[0];
  return partnerId ? profiles.get(partnerId) : undefined;
}

export function unreadFor(conversation: MessageConversation, profileId: string): number {
  return conversation.unreadCountByProfileId[profileId] ?? 0;
}

export function totalUnreadMessages(conversations: MessageConversation[], profileId: string): number {
  return conversations.reduce((total, conversation) => total + unreadFor(conversation, profileId), 0);
}

/* 取り直した分を id で合わせて、時刻順に並べる。二重に足さない。 */
export function mergeMessages(current: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

export function sortConversations(conversations: MessageConversation[]): MessageConversation[] {
  return [...conversations].sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt));
}

/**
 * 会話一覧の2行目（最後の1通）。サーバーは会話ごとに最新の1通を返している
 * （listD1DirectMessagePageData）。自分の送信は「あなた: 」を前に付け、画像だけなら「画像」。
 */
export function lastMessageLine(messages: DirectMessage[], conversationId: string, selfId: string, japanese: boolean): string | null {
  let last: DirectMessage | undefined;
  for (const message of messages) {
    if (message.conversationId !== conversationId) continue;
    if (!last || Date.parse(message.createdAt) > Date.parse(last.createdAt) || (message.createdAt === last.createdAt && message.id > last.id)) last = message;
  }
  if (!last) return null;
  const text = last.previewText.replace(/\s+/gu, " ").trim();
  const body = text || (last.images?.length ? (japanese ? "画像" : "Image") : "");
  if (!body) return null;
  return last.senderProfileId === selfId ? `${japanese ? "あなた: " : "You: "}${body}` : body;
}
