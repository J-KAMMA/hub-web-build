import { NextResponse } from "next/server";

import {
  countD1UnreadDirectMessages,
  listD1DirectMessagePageData,
} from "@/lib/server/d1-direct-messages";
import {
  directMessageErrorResponse,
  getDirectMessageActor,
  PRIVATE_RESPONSE_HEADERS,
} from "@/lib/server/direct-message-route";

export async function GET(request: Request) {
  try {
    const { database, profile } = await getDirectMessageActor(request);
    const conversationId = new URL(request.url).searchParams.get("conversation") ?? undefined;
    const [page, messageCount] = await Promise.all([
      listD1DirectMessagePageData(database, profile.id, conversationId),
      countD1UnreadDirectMessages(database, profile.id),
    ]);
    return NextResponse.json(
      { currentProfileId: profile.id, ...page, messageCount },
      { headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
