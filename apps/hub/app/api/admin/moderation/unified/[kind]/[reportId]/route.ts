import { NextResponse } from "next/server";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireModerationAdmin, requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { actOnUnifiedReport, type UnifiedReport } from "@/lib/server/unified-moderation";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { isCopyrightParty } from "@/lib/server/copyright-case-views";
import { createD1HubNotification } from "@/lib/server/d1-notification-events";

const REPORT_KINDS: UnifiedReport["kind"][] = ["social_post", "social_post_appeal", "profile", "appeal", "copyright", "video", "music", "work_listing", "remote_flag", "article_comment"];
const ALLOWED_ACTIONS: Record<UnifiedReport["kind"], readonly string[]> = {
  social_post: ["dismiss", "hide", "restore"], social_post_appeal: ["reject", "accept"],
  profile: ["dismiss", "suspend"], appeal: ["reject", "accept"],
  copyright: ["reject", "action", "accept", "immediate"], video: ["dismiss", "hide", "reject", "accept"], music: ["dismiss", "resolve"],
  work_listing: ["dismiss", "resolve", "hide"],
  remote_flag: ["dismiss", "hide"],
  article_comment: ["dismiss", "remove"],
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function privateJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: PRIVATE_HEADERS });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ kind: string; reportId: string }> }) {
  const denied = requireModerationAdmin(request) || requireSameOrigin(request);
  if (denied) {
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
      denied.headers.set(name, value);
    }
    return denied;
  }
  const db = getHubD1();
  const { kind, reportId } = await params;
  const body = await request.json() as { action?: string; note?: string; immediateReason?: string; clearlyInfringing?: boolean };
  if (!REPORT_KINDS.includes(kind as UnifiedReport["kind"]) || !body.action) {
    return privateJson({ error: "入力を確認してください。" }, { status: 400 });
  }
  if (!ALLOWED_ACTIONS[kind as UnifiedReport["kind"]].includes(body.action)) {
    return privateJson({ error: "不正な操作です。" }, { status: 400 });
  }
  const note = String(body.note || "").trim().slice(0, 1000);
  const decisionRequiresReason = new Set([
    "hide", "remove", "restore", "suspend", "accept", "reject", "action", "resolve", "immediate",
  ]);
  if (decisionRequiresReason.has(body.action) && note.length < 5) {
    return privateJson({ error: "判断理由を5文字以上で入力してください。" }, { status: 400 });
  }
  if (kind === "copyright") {
    // 事件の当事者（投稿者・申告者）は、その事件に運営として判断できない（PLAN 9.3）。
    const viewer = await getOptionalHubSessionProfile(request, db).catch(() => null);
    if (await isCopyrightParty(db, reportId, viewer?.id)) return privateJson({ error: "この事件の当事者のため、操作できません。" }, { status: 403 });
  }
  let receipt: { auditId: string; action: string; kind: string; targetId: string; confirmedAt: string } | null = null;
  const mediaReporter = kind === "music"
    ? await db.prepare("SELECT reporter_profile_id reporterId FROM music_reports WHERE id=? AND status='open'")
      .bind(reportId).first<{ reporterId: string }>()
    : kind === "video"
      ? await db.prepare("SELECT reporter_profile_id reporterId FROM video_reports WHERE id=? AND status='open'")
        .bind(reportId).first<{ reporterId: string }>()
      : null;
  if (kind === "music") {
    const now = new Date().toISOString();
    const result = await db.prepare("UPDATE music_reports SET status=?, updated_at=? WHERE id=? AND status='open'")
      .bind(body.action === "dismiss" ? "dismissed" : "resolved", now, reportId).run();
    if (!result.meta.changes) return privateJson({ error: "通報が見つかりません。" }, { status: 404 });
    const auditId = crypto.randomUUID();
    await db.prepare("INSERT INTO hub_admin_audit_log(id,actor_role,action,target_type,target_id,metadata_json,created_at) VALUES(?,'moderator',?,?,?,?,?)")
      .bind(auditId, body.action, kind, reportId, JSON.stringify({ note }), now).run();
    receipt = { auditId, action: body.action, kind, targetId: reportId, confirmedAt: now };
  } else if (kind === "video") {
    const report = await db.prepare("SELECT video_id FROM video_reports WHERE id=? AND status='open'").bind(reportId).first<{ video_id: string }>();
    if (!report) return privateJson({ error: "通報が見つかりません。" }, { status: 404 });
    const now = new Date().toISOString();
    if (body.action === "hide") await db.batch([
      db.prepare("UPDATE external_videos SET status='removed', updated_at=? WHERE id=?").bind(now, report.video_id),
      db.prepare("UPDATE video_reports SET status='resolved' WHERE id=? AND status='open'").bind(reportId),
    ]); else await db.prepare("UPDATE video_reports SET status='dismissed' WHERE id=? AND status='open'").bind(reportId).run();
    const auditId = crypto.randomUUID();
    await db.prepare("INSERT INTO hub_admin_audit_log(id,actor_role,action,target_type,target_id,metadata_json,created_at) VALUES(?,'moderator',?,?,?,?,?)")
      .bind(auditId, body.action, kind, reportId, JSON.stringify({ note }), now).run();
    receipt = { auditId, action: body.action, kind, targetId: reportId, confirmedAt: now };
  } else {
    try {
      receipt = await actOnUnifiedReport(db, kind as UnifiedReport["kind"], reportId, body.action, note, {
        immediateReason: body.immediateReason,
        clearlyInfringing: body.clearlyInfringing === true,
        // 確定のとき、公開されていた画像の実体を消す。
        media: kind === "copyright" ? getHubMedia() : undefined,
      });
    } catch (error) {
      return privateJson(
        { error: error instanceof Error ? error.message : "処理できませんでした。" },
        { status: 409 },
      );
    }
  }
  if (receipt && mediaReporter) {
    const actionTaken = kind === "music"
      ? body.action !== "dismiss"
      : body.action === "hide";
    await createD1HubNotification(db, {
      receiverProfileId: mediaReporter.reporterId,
      text: actionTaken
        ? `${kind === "music" ? "音楽" : "動画"}への通報を確認し、必要な対応を行いました。`
        : `${kind === "music" ? "音楽" : "動画"}への通報を確認しました。現時点では対応対象とは判断しませんでした。`,
      route: "/notifications",
      dedupeKey: `moderation-report:${kind}:${reportId}:${body.action}`,
      createdAt: receipt.confirmedAt,
    });
  }
  return privateJson({ ok: true, receipt });
}
