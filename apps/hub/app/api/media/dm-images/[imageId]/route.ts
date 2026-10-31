import { NextResponse } from "next/server";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";

/*
 * DM 添付画像の配信。投稿画像（/api/media/images）と違い公開面が無い——
 * 付いているメッセージの会話の参加者にしか返さない。参加者でなければ
 * 画像の有無も含めて 404 にそろえる（fail closed）。
 * Bearer（端末の Rust 側が取りに来る）と Cookie セッションのどちらも受ける。
 */
export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  const variant = new URL(request.url).searchParams.get("variant") === "full" ? "full" : "thumbnail";
  const database = getHubD1();
  const row = await database.prepare(`SELECT i.object_key, i.thumbnail_object_key, i.mime_type,
      m.conversation_id
    FROM direct_message_images i
    JOIN direct_messages m ON m.id = i.message_id
    WHERE i.id = ? AND i.status = 'published'
      AND i.safety_status = 'clean'
      AND i.metadata_stripped_at IS NOT NULL
      AND i.message_id IS NOT NULL
    LIMIT 1`)
    .bind(imageId).first<{ object_key: string; thumbnail_object_key: string | null; mime_type: string; conversation_id: string }>();
  if (!row) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });

  // 停止中を含めて viewer が確定できないなら配らない——404 でそろえる。
  const viewer = await getOptionalHubViewerProfile(request, database).catch(() => null);
  if (!viewer) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });
  const participant = await database.prepare(`SELECT 1 AS ok FROM conversation_participants
    WHERE conversation_id = ? AND profile_id = ? LIMIT 1`)
    .bind(row.conversation_id, viewer.id).first<{ ok: number }>();
  if (!participant) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });

  const key = variant === "full" ? row.object_key : (row.thumbnail_object_key ?? row.object_key);
  const object = await getHubMedia().get(key);
  if (!object) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });
  /* 投稿画像と同じく残させない——参加者でもキャッシュに長く置かない。 */
  return new Response(await object.arrayBuffer(), { headers: { "Content-Type": row.mime_type, "Content-Length": String(object.size),
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
