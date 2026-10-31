import { NextResponse } from "next/server";

import { markD1ConversationRead } from "@/lib/server/d1-direct-messages";
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
    return NextResponse.json(
      await markD1ConversationRead(database, conversationId, profile.id),
      { headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
