import { NextResponse } from "next/server";

import { getHubMedia, getOptionalHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

type RemovalBody = {
  id?: string;
  note?: string;
  operationId?: string;
};

type ImageRow = {
  id: string;
  object_key: string;
  thumbnail_object_key: string | null;
  status: string;
  thread_id: string;
  post_no: number;
};

type AuditRow = {
  id: string;
  action: string;
  target_id: string;
  created_at: string;
};

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

function receipt(input: {
  auditId: string;
  targetId: string;
  confirmedAt: string;
  replayed?: boolean;
  storageDeletionPending?: boolean;
}) {
  return {
    auditId: input.auditId,
    action: "remove_thread_image",
    targetId: input.targetId,
    confirmedAt: input.confirmedAt,
    replayed: input.replayed ?? false,
    storageDeletionPending: input.storageDeletionPending ?? false
  };
}

async function deleteStoredImage(image: ImageRow) {
  try {
    await Promise.all([
      getHubMedia().delete(image.object_key),
      ...(image.thumbnail_object_key ? [getHubMedia().delete(image.thumbnail_object_key)] : [])
    ]);
    return false;
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) return denied;
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const images = await db
    .prepare(
      `SELECT i.id,i.post_id postId,i.mime_type mimeType,i.byte_size byteSize,
              i.width,i.height,i.alt_text altText,i.safety_status safetyStatus,
              i.created_at createdAt,p.thread_id threadId,p.post_no postNo
         FROM social_post_images i
         JOIN thread_posts p ON p.id=i.post_id
        WHERE i.status='published'
        ORDER BY i.created_at DESC
        LIMIT 100`
    )
    .all();
  return NextResponse.json({ images: images.results ?? [] });
}

export async function DELETE(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as RemovalBody | null;
  const id = String(body?.id ?? "").trim();
  const note = String(body?.note ?? "").trim().slice(0, 1000);
  const operationId = body?.operationId;
  if (!id) return NextResponse.json({ error: "画像を指定してください。" }, { status: 400 });
  if (!validOperationId(operationId)) {
    return NextResponse.json({ error: "操作IDが正しくありません。" }, { status: 400 });
  }
  if (note.length < 5) {
    return NextResponse.json({ error: "判断理由を5文字以上で入力してください。" }, { status: 400 });
  }

  const image = await db
    .prepare(
      `SELECT i.id,i.object_key,i.thumbnail_object_key,i.status,
              p.thread_id,p.post_no
         FROM social_post_images i
         JOIN thread_posts p ON p.id=i.post_id
        WHERE i.id=?`
    )
    .bind(id)
    .first<ImageRow>();
  if (!image) return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404 });

  const replay = await db
    .prepare(
      "SELECT id,action,target_id,created_at FROM hub_admin_audit_log WHERE id=? AND target_type='thread_image'"
    )
    .bind(operationId)
    .first<AuditRow>();
  if (replay) {
    const storageDeletionPending = await deleteStoredImage(image);
    return NextResponse.json({
      ok: true,
      receipt: receipt({
        auditId: replay.id,
        targetId: replay.target_id,
        confirmedAt: replay.created_at,
        replayed: true,
        storageDeletionPending
      })
    });
  }

  if (image.status !== "published") {
    return NextResponse.json({ error: "画像はすでに公開停止されています。" }, { status: 409 });
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare("UPDATE social_post_images SET status='deleted' WHERE id=? AND status='published'")
      .bind(id),
    db
      .prepare(
        "INSERT INTO hub_admin_audit_log(id,actor_role,action,target_type,target_id,metadata_json,created_at) VALUES(?,'moderator','remove_thread_image','thread_image',?,?,?)"
      )
      .bind(
        operationId,
        id,
        JSON.stringify({
          note,
          threadId: image.thread_id,
          postNo: image.post_no
        }),
        now
      )
  ]);
  const storageDeletionPending = await deleteStoredImage(image);
  return NextResponse.json({
    ok: true,
    receipt: receipt({
      auditId: operationId,
      targetId: id,
      confirmedAt: now,
      storageDeletionPending
    })
  });
}
