import { NextResponse } from "next/server";

import { getD1DirectMessageConversation } from "@/lib/server/d1-direct-messages";
import {
  directMessageErrorResponse,
  getDirectMessageActor,
  PRIVATE_RESPONSE_HEADERS,
} from "@/lib/server/direct-message-route";

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const [{ conversationId }, { database, profile }] = await Promise.all([
      context.params,
      getDirectMessageActor(request),
    ]);
    return NextResponse.json(
      await getD1DirectMessageConversation(database, conversationId, profile.id),
      { headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
