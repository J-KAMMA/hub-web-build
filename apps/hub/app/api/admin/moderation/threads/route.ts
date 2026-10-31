import { NextResponse } from "next/server";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";

/*
 * カテゴリ移動申請は 2026-08-31 に廃止した。掲示板の階層をタグへ移した時点で
 * 「どのカテゴリに属するか」を運営が承認する意味が無くなり、運営に承認作業を
 * 持たせない方針になったため。申請の入口（/api/bbs/threads/[id]/move-request）と
 * 作成者側のボタンも同時に撤去した。
 * 適用済みマイグレーション 0082 と thread_move_requests 表はそのまま残す
 * （適用済みの移行は書き換えない。既存行も消さない）。
 */
type ThreadAction =
  | "freeze"
  | "unfreeze"
  | "undo"
  | "archive_stale";

type ThreadActionBody = {
  action?: ThreadAction;
  requestId?: string;
  threadId?: string;
  note?: string;
  operationId?: string;
};

type AuditRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
  metadata_json: string;
};

function actionReceipt(input: {
  auditId: string;
  action: string;
  targetId: string;
  confirmedAt: string;
  replayed?: boolean;
  affected?: number;
}) {
  return {
    auditId: input.auditId,
    action: input.action,
    kind: "thread",
    targetId: input.targetId,
    confirmedAt: input.confirmedAt,
    replayed: input.replayed ?? false,
    ...(typeof input.affected === "number" ? { affected: input.affected } : {})
  };
}

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

function adminAudit(
  db: D1Database,
  input: {
    id: string;
    action: string;
    targetId: string;
    note: string;
    now: string;
    metadata?: Record<string, unknown>;
  }
) {
  return db
    .prepare(
      "INSERT INTO hub_admin_audit_log(id,actor_role,action,target_type,target_id,metadata_json,created_at) VALUES(?,'moderator',?,'thread',?,?,?)"
    )
    .bind(
      input.id,
      input.action,
      input.targetId,
      JSON.stringify({ note: input.note, ...input.metadata }),
      input.now
    );
}

async function replayedReceipt(db: D1Database, operationId: string) {
  const row = await db
    .prepare(
      "SELECT id,action,target_type,target_id,created_at,metadata_json FROM hub_admin_audit_log WHERE id=? AND target_type='thread'"
    )
    .bind(operationId)
    .first<AuditRow>();
  if (!row) return null;
  const metadata = JSON.parse(row.metadata_json || "{}") as { affected?: number };
  return actionReceipt({
    auditId: row.id,
    action: row.action,
    targetId: row.target_id,
    confirmedAt: row.created_at,
    replayed: true,
    affected: metadata.affected
  });
}

export async function GET(request: Request) {
  const denied = requireModerationAdmin(request);
  if (denied) return denied;
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const [operations, stale] = await Promise.all([
    db
      .prepare(
        `SELECT a.id,a.thread_id threadId,t.title,a.action,a.detail,a.created_at createdAt
           FROM thread_operation_audit a
           JOIN threads t ON t.id=a.thread_id
          WHERE a.undone_at IS NULL
            AND a.action IN ('move','freeze','unfreeze','merge')
          ORDER BY a.created_at DESC
          LIMIT 50`
      )
      .all(),
    db
      .prepare(
        "SELECT COUNT(*) total FROM threads WHERE status='closed' AND updated_at < datetime('now','-180 days')"
      )
      .first<{ total: number }>()
  ]);

  return NextResponse.json({
    operations: operations.results ?? [],
    staleThreadCount: Number(stale?.total ?? 0)
  });
}

export async function PATCH(request: Request) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) return denied;
  const db = getOptionalHubD1();
  if (!db) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });

  const body = (await request.json()) as ThreadActionBody;
  const now = new Date().toISOString();
  const note = String(body.note ?? "").trim().slice(0, 1000);

  if (!body.action) {
    return NextResponse.json({ error: "操作が正しくありません。" }, { status: 400 });
  }

  if (!validOperationId(body.operationId)) {
    return NextResponse.json({ error: "操作IDが正しくありません。" }, { status: 400 });
  }
  if (note.length < 5) {
    return NextResponse.json({ error: "判断理由を5文字以上で入力してください。" }, { status: 400 });
  }
  const replay = await replayedReceipt(db, body.operationId);
  if (replay) return NextResponse.json({ ok: true, receipt: replay });

  if (body.action === "freeze" || body.action === "unfreeze") {
    if (!body.threadId) {
      return NextResponse.json({ error: "対象スレッドを確認してください。" }, { status: 400 });
    }
    const previous = await db
      .prepare("SELECT moderation_status moderationStatus FROM threads WHERE id=?")
      .bind(body.threadId)
      .first<{ moderationStatus: string }>();
    if (!previous) {
      return NextResponse.json({ error: "対象スレッドが見つかりません。" }, { status: 404 });
    }
    const nextStatus = body.action === "freeze" ? "frozen" : "active";
    if (previous.moderationStatus === nextStatus) {
      return NextResponse.json({ error: "スレッドはすでに同じ状態です。" }, { status: 409 });
    }
    const operationAuditId = crypto.randomUUID();
    await db.batch([
      db
        .prepare("UPDATE threads SET moderation_status=? WHERE id=? AND moderation_status<>?")
        .bind(nextStatus, body.threadId, nextStatus),
      db
        .prepare(
          "INSERT INTO thread_operation_audit(id,thread_id,action,detail,created_at,undo_payload_json) VALUES(?,?,?,?,?,?)"
        )
        .bind(
          operationAuditId,
          body.threadId,
          body.action,
          note,
          now,
          JSON.stringify(previous)
        ),
      adminAudit(db, {
        id: body.operationId!,
        action: body.action,
        targetId: body.threadId,
        note,
        now,
        metadata: { operationAuditId }
      })
    ]);
    return NextResponse.json({
      ok: true,
      receipt: actionReceipt({
        auditId: body.operationId!,
        action: body.action,
        targetId: body.threadId,
        confirmedAt: now
      })
    });
  }


  if (body.action === "undo") {
    const audit = await db
      .prepare(
        "SELECT id,thread_id,action,undo_payload_json FROM thread_operation_audit WHERE id=? AND undone_at IS NULL"
      )
      .bind(body.requestId)
      .first<{
        id: string;
        thread_id: string;
        action: string;
        undo_payload_json: string;
      }>();
    if (!audit) {
      return NextResponse.json({ error: "操作はすでに戻されたか、見つかりません。" }, { status: 409 });
    }
    const previous = JSON.parse(audit.undo_payload_json || "{}") as {
      boardKey?: string;
      moderationStatus?: string;
      status?: string;
      mergedIntoThreadId?: string | null;
    };
    const statements: D1PreparedStatement[] = [];
    if (audit.action === "move" && previous.boardKey) {
      statements.push(
        db
          .prepare(
            "UPDATE threads SET board_id=(SELECT id FROM boards WHERE board_key=?),updated_at=? WHERE id=?"
          )
          .bind(previous.boardKey, now, audit.thread_id)
      );
    } else if (
      (audit.action === "freeze" || audit.action === "unfreeze") &&
      previous.moderationStatus
    ) {
      statements.push(
        db
          .prepare("UPDATE threads SET moderation_status=? WHERE id=?")
          .bind(previous.moderationStatus, audit.thread_id)
      );
    } else if (audit.action === "merge") {
      statements.push(
        db
          .prepare("UPDATE threads SET status=?,merged_into_thread_id=? WHERE id=?")
          .bind(previous.status ?? "open", previous.mergedIntoThreadId ?? null, audit.thread_id)
      );
    } else {
      return NextResponse.json({ error: "この操作は戻せません。" }, { status: 400 });
    }
    const auditId = body.operationId!;
    statements.push(
      db
        .prepare("UPDATE thread_operation_audit SET undone_at=? WHERE id=? AND undone_at IS NULL")
        .bind(now, audit.id),
      adminAudit(db, {
        id: auditId,
        action: "undo_thread_operation",
        targetId: audit.thread_id,
        note,
        now,
        metadata: { operationAuditId: audit.id }
      })
    );
    await db.batch(statements);
    return NextResponse.json({
      ok: true,
      receipt: actionReceipt({
        auditId,
        action: "undo_thread_operation",
        targetId: audit.thread_id,
        confirmedAt: now
      })
    });
  }

  if (body.action === "archive_stale") {
    const count = await db
      .prepare(
        "SELECT COUNT(*) total FROM threads WHERE status='closed' AND updated_at < datetime('now','-180 days')"
      )
      .first<{ total: number }>();
    const affected = Number(count?.total ?? 0);
    await db.batch([
      db.prepare(
        "UPDATE threads SET status='archived' WHERE status='closed' AND updated_at < datetime('now','-180 days')"
      ),
      adminAudit(db, {
        id: body.operationId!,
        action: body.action,
        targetId: "closed_threads_180d",
        note,
        now,
        metadata: { affected }
      })
    ]);
    return NextResponse.json({
      ok: true,
      archived: affected,
      receipt: actionReceipt({
        auditId: body.operationId!,
        action: body.action,
        targetId: "closed_threads_180d",
        confirmedAt: now,
        affected
      })
    });
  }

  return NextResponse.json({ error: "操作が正しくありません。" }, { status: 400 });
}
