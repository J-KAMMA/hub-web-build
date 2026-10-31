export type CommunityMessageAttempt = {
  client_request_id: string;
  body: string;
  kind: "chat" | "guide" | "question" | "party";
  reply_to_message_id: string | null;
  image_ids: string[];
};

export function readCommunityMessageAttempt(value: string | null): CommunityMessageAttempt | null {
  if (value === null) return null;
  const parsed = JSON.parse(value) as CommunityMessageAttempt;
  if (!parsed || typeof parsed.client_request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.client_request_id)
    || typeof parsed.body !== "string" || parsed.body.length > 2000
    || !["chat", "guide", "question", "party"].includes(parsed.kind)
    || !(parsed.reply_to_message_id === null || typeof parsed.reply_to_message_id === "string")
    || !Array.isArray(parsed.image_ids) || parsed.image_ids.length > 4
    || parsed.image_ids.some(id => typeof id !== "string" || !id)
    || new Set(parsed.image_ids).size !== parsed.image_ids.length) {
    throw new Error("保存された投稿を読み取れませんでした。");
  }
  return parsed;
}
