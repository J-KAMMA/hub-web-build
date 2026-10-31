import { NextResponse } from "next/server";

import { startD1DirectMessage } from "@/lib/server/d1-direct-messages";
import {
  directMessageErrorResponse,
  getDirectMessageActor,
  PRIVATE_RESPONSE_HEADERS,
  requireDirectMessageMutationOrigin,
} from "@/lib/server/direct-message-route";

export async function POST(request: Request) {
  const originError = requireDirectMessageMutationOrigin(request);
  if (originError) return originError;
  try {
    const [{ database, profile }, body] = await Promise.all([
      getDirectMessageActor(request),
      request.json().catch(() => null) as Promise<{ target_profile_id?: unknown } | null>,
    ]);
    const result = await startD1DirectMessage(
      database,
      profile.id,
      typeof body?.target_profile_id === "string" ? body.target_profile_id : "",
    );
    return NextResponse.json(
      {
        conversation_id: result.conversationId,
        created_new: result.createdNew,
      },
      { status: result.createdNew ? 201 : 200, headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
