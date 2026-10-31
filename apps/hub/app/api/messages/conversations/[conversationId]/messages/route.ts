import { NextResponse } from "next/server";

import { sendD1DirectMessage } from "@/lib/server/d1-direct-messages";
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
    const [{ conversationId }, { database, profile }, body] = await Promise.all([
      context.params,
      getDirectMessageActor(request),
      request.json().catch(() => null) as Promise<{
        preview_text?: unknown;
        composition_mode?: unknown;
        human_approved?: unknown;
        client_request_id?: unknown;
        image_ids?: unknown;
      } | null>,
    ]);
    const expectedViewer = request.headers.get("x-hub-expected-viewer");
    if (expectedViewer !== null && expectedViewer !== profile.id) {
      return NextResponse.json(
        { error: "アカウントが変わりました。会話を確認し直してください。", code: "direct_message_actor_changed" },
        { status: 409, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    const compositionMode = body?.composition_mode ?? "direct";
    if (body?.client_request_id !== undefined && typeof body.client_request_id !== "string") {
      return NextResponse.json({ error: "送信識別子が正しくありません。" }, { status: 400, headers: PRIVATE_RESPONSE_HEADERS });
    }
    const imageIds = body?.image_ids === undefined
      ? []
      : Array.isArray(body.image_ids) && body.image_ids.every((id) => typeof id === "string")
        ? body.image_ids as string[]
        : null;
    if (imageIds === null) {
      return NextResponse.json({ error: "画像の指定が正しくありません。" }, { status: 400, headers: PRIVATE_RESPONSE_HEADERS });
    }
    if (compositionMode !== "direct" && compositionMode !== "assist") {
      return NextResponse.json(
        { error: "送信モードが正しくありません。" },
        { status: 400, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    if (compositionMode === "assist" && body?.human_approved !== true) {
      return NextResponse.json(
        { error: "AI候補を確認してから送信してください。" },
        { status: 400, headers: PRIVATE_RESPONSE_HEADERS },
      );
    }
    const message = await sendD1DirectMessage(
      database,
      conversationId,
      profile.id,
      typeof body?.preview_text === "string" ? body.preview_text : "",
      body?.client_request_id as string | undefined,
      imageIds,
    );
    return NextResponse.json(
      { message },
      { status: 201, headers: PRIVATE_RESPONSE_HEADERS },
    );
  } catch (error) {
    return directMessageErrorResponse(error);
  }
}
