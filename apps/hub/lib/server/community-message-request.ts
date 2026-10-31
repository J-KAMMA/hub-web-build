type MessageIntent = {
  communityId: string;
  channelId: string;
  body: string;
  kind: "chat" | "guide" | "question" | "party";
  replyToMessageId?: string | null;
  imageIds?: string[];
};

export function isCommunityMessageId(value: string) {
  return /^(?:[A-Za-z0-9_-]{1,80}|scheduled:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value);
}

async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Identifies one operation; callers must still authorize and compare persisted intent. */
export async function communityMessageRequestIdentity(profileId: string, requestId: string, input: MessageIntent) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("投稿操作IDが正しくありません。");
  }
  const scope = ["hub-community-message-v1", profileId, input.communityId, input.channelId, requestId.toLowerCase()];
  return {
    messageId: `cm-${await digest(scope)}`,
    fingerprint: await digest([input.body.trim(), input.kind, input.replyToMessageId ?? null, input.imageIds ?? []]),
  };
}
