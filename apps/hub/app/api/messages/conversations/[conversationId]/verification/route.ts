import { NextResponse } from "next/server";

import { getD1DirectMessageConversation } from "@/lib/server/d1-direct-messages";
import {
  directMessageErrorResponse,
  getDirectMessageActor,
  PRIVATE_RESPONSE_HEADERS,
  requireDirectMessageMutationOrigin,
} from "@/lib/server/direct-message-route";

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const originError = requireDirectMessageMutationOrigin(request);
  if (originError) return originError;
  try {
    const [{ conversationId }, { database, profile }] = await Promise.all([
      context.params,
      getDirectMessageActor(request),
    ]);
    await getD1DirectMessageConversation(database, conversationId, profile.id);
    return NextResponse.json(
      {
        error: "この会話ではエンドツーエンド暗号化を利用できません。",
        code: "e2ee_not_available",
      },
      { status: 409, headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
