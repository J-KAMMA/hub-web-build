import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hashModerationRecoveryCode, requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import {
  RECOVERY_ROTATION_ACQUIRE_SQL,
  RECOVERY_ROTATION_COOLDOWN_SECONDS,
  RECOVERY_ROTATION_DELETE_CODES_SQL,
  RECOVERY_ROTATION_FINISH_SQL,
  RECOVERY_ROTATION_INSERT_AUDIT_SQL,
  RECOVERY_ROTATION_INSERT_CODE_SQL,
  RECOVERY_ROTATION_LEASE_SECONDS,
  RECOVERY_ROTATION_RELEASE_SQL,
} from "@/lib/server/moderation-recovery-code-rotation";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCode(): string {
  const bytes = randomBytes(12);
  let value = "";
  for (let index = 0; index < 12; index += 1) value += ALPHABET[bytes[index] % ALPHABET.length];
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8)}`;
}

type RotationReceipt = {
  id: string;
  action: string;
  targetId: string;
  confirmedAt: string;
};

async function replayedReceipt(database: NonNullable<ReturnType<typeof getOptionalHubD1>>, operationId: string) {
  return database
    .prepare(
      "SELECT id,action,target_id targetId,created_at confirmedAt FROM hub_admin_audit_log WHERE id=? AND target_type='moderation_security' AND action='rotate_recovery_codes'"
    )
    .bind(operationId)
    .first<RotationReceipt>();
}

function replayResponse(previous: RotationReceipt) {
  return NextResponse.json({
    codes: [],
    receipt: {
      auditId: previous.id,
      action: previous.action,
      kind: "moderation_security",
      targetId: previous.targetId,
      confirmedAt: previous.confirmedAt,
      replayed: true,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = requireModerationAdmin(request) ?? requireSameOrigin(request);
  if (denied) return denied;
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { operationId?: string; note?: string };
  const operationId = String(body.operationId ?? "");
  const note = String(body.note ?? "").trim().slice(0, 1000);
  if (!/^[A-Za-z0-9-]{16,80}$/.test(operationId)) {
    return NextResponse.json({ error: "操作IDが正しくありません。" }, { status: 400 });
  }
  if (note.length < 5) {
    return NextResponse.json({ error: "再生成理由を5文字以上で入力してください。" }, { status: 400 });
  }
  const previous = await replayedReceipt(database, operationId);
  if (previous) return replayResponse(previous);

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const lockExpiresAt = new Date(now + RECOVERY_ROTATION_LEASE_SECONDS * 1000).toISOString();
  const cooldownCutoff = new Date(now - RECOVERY_ROTATION_COOLDOWN_SECONDS * 1000).toISOString();
  const acquired = await database.prepare(RECOVERY_ROTATION_ACQUIRE_SQL)
    .bind(operationId, lockExpiresAt, createdAt, createdAt, cooldownCutoff)
    .run();
  if ((acquired.meta.changes ?? 0) !== 1) {
    const completedWhileWaiting = await replayedReceipt(database, operationId);
    if (completedWhileWaiting) return replayResponse(completedWhileWaiting);
    const state = await database.prepare(
      "SELECT locked_until lockedUntil,last_completed_at lastCompletedAt FROM hub_admin_mfa_recovery_rotation_state WHERE id=1",
    ).first<{ lockedUntil: string | null; lastCompletedAt: string | null }>();
    const lastCompletedAt = state?.lastCompletedAt ? Date.parse(state.lastCompletedAt) : Number.NaN;
    const cooldownRemaining = Number.isFinite(lastCompletedAt)
      ? Math.ceil((lastCompletedAt + RECOVERY_ROTATION_COOLDOWN_SECONDS * 1000 - now) / 1000)
      : 0;
    const retryAfter = Math.max(1, cooldownRemaining > 0 ? cooldownRemaining : RECOVERY_ROTATION_LEASE_SECONDS);
    return NextResponse.json({
      error: cooldownRemaining > 0
        ? "復旧コードは直前に再生成されています。現在表示されたコードを保存してください。"
        : "別の復旧コード再生成を処理しています。完了後に状態を確認してください。",
      code: cooldownRemaining > 0 ? "recovery_codes_recently_rotated" : "recovery_codes_rotation_in_progress",
      retryAfterSeconds: retryAfter,
    }, {
      status: 409,
      headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) },
    });
  }

  const completedBeforeCommit = await replayedReceipt(database, operationId);
  if (completedBeforeCommit) {
    await database.prepare(RECOVERY_ROTATION_RELEASE_SQL).bind(createdAt, operationId).run();
    return replayResponse(completedBeforeCommit);
  }
  const codes = Array.from({ length: 10 }, createCode);
  const hashes = codes.map(hashModerationRecoveryCode);
  if (hashes.some((hash) => !hash)) {
    await database.prepare(RECOVERY_ROTATION_RELEASE_SQL).bind(createdAt, operationId).run();
    return NextResponse.json({ error: "管理認証が設定されていません。" }, { status: 503 });
  }
  const results = await database.batch([
    database.prepare(RECOVERY_ROTATION_DELETE_CODES_SQL).bind(operationId, createdAt),
    ...hashes.map((hash) => database.prepare(RECOVERY_ROTATION_INSERT_CODE_SQL).bind(hash, createdAt, operationId, createdAt)),
    database
      .prepare(RECOVERY_ROTATION_INSERT_AUDIT_SQL)
      .bind(operationId, JSON.stringify({ note }), createdAt, operationId, createdAt),
    database.prepare(RECOVERY_ROTATION_FINISH_SQL).bind(createdAt, createdAt, operationId, createdAt),
  ]);
  const auditResult = results[1 + hashes.length];
  if ((auditResult?.meta.changes ?? 0) !== 1) {
    return NextResponse.json({
      error: "復旧コードの再生成は確定しませんでした。現在のコードは変更されていません。",
      code: "recovery_codes_rotation_not_committed",
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    codes,
    receipt: {
      auditId: operationId,
      action: "rotate_recovery_codes",
      kind: "moderation_security",
      targetId: "recovery_codes",
      confirmedAt: createdAt,
      replayed: false
    }
  }, { headers: { "Cache-Control": "no-store" } });
}
