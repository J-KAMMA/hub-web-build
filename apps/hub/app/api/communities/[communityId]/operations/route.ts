import {mutateCommunityAccessManagement} from '@/lib/server/community-access-management';
import {accessManagementJson,accessManagementFailure,readAccessManagementInput} from '@/lib/server/community-access-management-route';
import {mutateCommunityChannelPolicy} from '@/lib/server/community-channel-policy';
import {channelPolicyJson,channelPolicyFailure} from '@/lib/server/community-channel-policy-route';
import { NextResponse } from "next/server";
import {reviewCommunityMembershipRequest} from "@/lib/server/community-membership-review";
import {membershipReviewErrorResponse,membershipReviewHeaders} from "@/lib/server/community-membership-review-response";
import {resolveCommunityReport} from "@/lib/server/community-report-review";
import {reportReviewErrorResponse,reportReviewHeaders} from "@/lib/server/community-report-review-response";
import {resolveCommunityAppeal} from "@/lib/server/community-appeal-review";
import {appealReviewErrorResponse,appealReviewHeaders} from "@/lib/server/community-appeal-review-response";

import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { refreshCommunityDailyMetrics } from "@/lib/server/d1-community-scheduled";
import { COMMUNITY_BOT_KINDS, runCommunityBot } from "@/lib/server/d1-community-bots";

type Context = { params: Promise<{ communityId: string }> };
type OperatorRole = "owner" | "moderator";
const CRITICAL_ACTIONS = new Set([
  "delete_role",
  "delete_rule",
  "delete_onboarding_question",
  "delete_bot",
  "set_channel_archived",
  "member_action",
  "resolve_report",
  "resolve_appeal",
  "membership",
  "revoke_invite",
  "close",
  "assign_role",
  "channel_permission",
  "create_auto_role_rule",
  "delete_auto_role_rule",
  "create_invite",
]);

type CommunityAuditRow = {
  id: string;
  action: string;
  detail: string;
  created_at: string;
};

async function requireOperator(request: Request, communityId: string, ownerOnly = false) {
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  const membership = await database.prepare(`SELECT role FROM community_memberships
    WHERE community_id = ? AND profile_id = ? AND status = 'active' LIMIT 1`)
    .bind(communityId, actor.id).first<{ role: string }>();
  if (!membership || !["owner", "moderator"].includes(membership.role) || (ownerOnly && membership.role !== "owner")) {
    throw new Error("この操作を行う権限がありません。");
  }
  return { database, actor, role: membership.role as OperatorRole };
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.normalize("NFKC").trim().slice(0, max) : "";
}

function validOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{16,80}$/.test(value);
}

function auditDetail(note: string, targetId: string, targetLabel: string) {
  return JSON.stringify({ note, targetId, targetLabel });
}

function parseAuditDetail(value: string) {
  try {
    return JSON.parse(value) as { note?: string; targetId?: string; targetLabel?: string };
  } catch {
    return {};
  }
}

function actionReceipt(input: {
  auditId: string;
  action: string;
  targetId: string;
  targetLabel: string;
  confirmedAt: string;
  replayed?: boolean;
}) {
  return {
    auditId: input.auditId,
    action: input.action,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    confirmedAt: input.confirmedAt,
    replayed: input.replayed ?? false,
  };
}

export async function GET(request: Request, { params }: Context) {
  const { communityId } = await params;
  try {
    const { database, role } = await requireOperator(request, communityId);
    await refreshCommunityDailyMetrics(database, new Date(), communityId);
    const [requests, reports, audit, invites, customRoles, rules, metrics, members, channels, permissions, onboardingQuestions, appeals, autoRoleRules, tokens, bots, botRuns] = await Promise.all([
      database.prepare(`SELECT r.profile_id AS profileId, p.display_name AS displayName, r.created_at AS createdAt
        FROM community_membership_requests r JOIN profiles p ON p.id = r.profile_id
        WHERE r.community_id = ? AND r.status = 'pending' ORDER BY r.created_at`).bind(communityId).all(),
      database.prepare(`SELECT r.id, r.message_id AS messageId, r.reason, r.created_at AS createdAt,
        p.display_name AS reporterName, m.body AS messageBody, m.edited_at AS messageEditedAt
        FROM community_message_reports r
        JOIN profiles p ON p.id = r.reporter_profile_id
        JOIN community_channels channel ON channel.id = r.channel_id AND channel.community_id = r.community_id
        JOIN community_channel_messages m ON m.id = r.message_id AND m.channel_id = channel.id
        WHERE r.community_id = ? AND r.status = 'open' ORDER BY r.created_at`).bind(communityId).all(),
      database.prepare(`SELECT a.id, a.action, a.detail, a.created_at AS createdAt,
        actor.display_name AS actorName, target.display_name AS targetName
        FROM community_audit_log a JOIN profiles actor ON actor.id = a.actor_profile_id
        LEFT JOIN profiles target ON target.id = a.target_profile_id
        WHERE a.community_id = ? ORDER BY a.created_at DESC LIMIT 100`).bind(communityId).all(),
      database.prepare(`SELECT id, label, max_uses AS maxUses, use_count AS useCount,
        expires_at AS expiresAt, revoked_at AS revokedAt, created_at AS createdAt
        FROM community_invites WHERE community_id = ? ORDER BY created_at DESC`).bind(communityId).all(),
      database.prepare(`SELECT id, name, position, can_manage_channels AS canManageChannels,
        can_manage_posts AS canManagePosts, can_manage_members AS canManageMembers,
        can_manage_guides AS canManageGuides FROM community_custom_roles
        WHERE community_id = ? ORDER BY position DESC, created_at`).bind(communityId).all(),
      database.prepare(`SELECT id, title, body, position, required FROM community_rules
        WHERE community_id = ? ORDER BY position, created_at`).bind(communityId).all(),
      database.prepare(`SELECT metric_day AS metricDay, active_members AS activeMembers, joins, leaves, posts, reports
        FROM community_daily_metrics WHERE community_id = ? ORDER BY metric_day DESC LIMIT 30`).bind(communityId).all(),
      database.prepare(`SELECT m.profile_id AS profileId, p.display_name AS displayName, m.role, m.status,
        group_concat(mr.role_id) AS customRoleIds FROM community_memberships m
        JOIN profiles p ON p.id = m.profile_id LEFT JOIN community_member_custom_roles mr
        ON mr.community_id = m.community_id AND mr.profile_id = m.profile_id
        WHERE m.community_id = ? AND m.status != 'banned' GROUP BY m.profile_id ORDER BY p.display_name`).bind(communityId).all(),
      database.prepare(`SELECT id, name, archived_at AS archivedAt, slowmode_seconds AS slowmodeSeconds
        FROM community_channels WHERE community_id = ? ORDER BY position, created_at`).bind(communityId).all(),
      database.prepare(`SELECT p.channel_id AS channelId, p.role_id AS roleId, p.can_view AS canView,
        p.can_post AS canPost, p.can_manage AS canManage FROM community_channel_permissions p
        JOIN community_channels c ON c.id = p.channel_id WHERE c.community_id = ?`).bind(communityId).all(),
      database.prepare(`SELECT id, prompt, required, position FROM community_onboarding_questions
        WHERE community_id = ? ORDER BY position, created_at`).bind(communityId).all(),
      database.prepare(`SELECT a.id, a.reason, a.status, a.created_at AS createdAt,
        p.display_name AS displayName FROM community_moderation_appeals a JOIN profiles p ON p.id = a.profile_id
        WHERE a.community_id = ? AND a.status = 'pending' ORDER BY a.created_at`).bind(communityId).all(),
      database.prepare(`SELECT a.id, a.role_id AS roleId, r.name AS roleName, a.criterion, a.threshold, a.enabled
        FROM community_role_auto_rules a JOIN community_custom_roles r ON r.id = a.role_id
        WHERE a.community_id = ? ORDER BY a.created_at`).bind(communityId).all(),
      database.prepare(`SELECT id, name, symbol, network FROM community_tokens WHERE community_id = ? ORDER BY created_at`).bind(communityId).all(),
      database.prepare(`SELECT b.id, b.name, b.kind, b.channel_id AS channelId, c.name AS channelName,
        b.enabled, b.permissions_json AS permissionsJson, b.updated_at AS updatedAt
        FROM community_bots b LEFT JOIN community_channels c ON c.id = b.channel_id
        WHERE b.community_id = ? ORDER BY b.created_at`).bind(communityId).all(),
      database.prepare(`SELECT r.id, r.bot_id AS botId, b.name AS botName, r.trigger_type AS triggerType,
        r.status, r.matched_count AS matchedCount, r.summary, r.completed_at AS completedAt
        FROM community_bot_runs r JOIN community_bots b ON b.id = r.bot_id
        WHERE r.community_id = ? ORDER BY r.completed_at DESC LIMIT 50`).bind(communityId).all(),
    ]);
    return NextResponse.json({ role, requests: requests.results, reports: reports.results, audit: audit.results, invites: invites.results, customRoles: customRoles.results, rules: rules.results, metrics: metrics.results, members: members.results, channels: channels.results, permissions: permissions.results, onboardingQuestions: onboardingQuestions.results, appeals: appeals.results, autoRoleRules: autoRoleRules.results, tokens: tokens.results, bots: bots.results, botRuns: botRuns.results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "運営情報を取得できませんでした。" }, { status: 403 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) {originDenied.headers.set("cache-control","private, no-store");return originDenied;}
  const { communityId } = await params;
  let payload:unknown;try{payload=await readAccessManagementInput(request);if(payload instanceof Response)return payload;}catch(error){return accessManagementFailure(error);}
  if(!payload || typeof payload!=="object" || Array.isArray(payload))return NextResponse.json({error:"操作内容が正しくありません。"},{status:400,headers:membershipReviewHeaders});
  const body=payload as Record<string,unknown>;
  const action = text(body.action, 40);
  if(['create_invite','revoke_invite','create_rule','delete_rule','create_onboarding_question','delete_onboarding_question'].includes(action)){
    try{if(new URL(request.url).searchParams.size)return accessManagementJson({error:'指定が不正です。'},400);const db=getHubD1(),actor=await requireHubSessionProfile(request,db);return accessManagementJson(await mutateCommunityAccessManagement(db,actor.id,communityId,body));}catch(error){return accessManagementFailure(error);}
  }
  if(action==='channel_controls'||action==='set_channel_archived'){
    try{const db=getHubD1(),actor=await requireHubSessionProfile(request,db);return channelPolicyJson(await mutateCommunityChannelPolicy(db,actor.id,communityId,body));}
    catch(error){return channelPolicyFailure(error);}
  }
  if(action === "membership") {
    try {
      const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
      return NextResponse.json(await reviewCommunityMembershipRequest(database,actor,communityId,typeof body.profileId==="string"?body.profileId:"",body),{headers:membershipReviewHeaders});
    }catch(error){return membershipReviewErrorResponse(error);}
  }
  if(action === "resolve_report") {
    try {
      const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
      return NextResponse.json(await resolveCommunityReport(database,actor,communityId,typeof body.reportId==="string"?body.reportId:"",{
        operationId:body.operationId,decision:body.resolution,note:body.note,expectedCreatedAt:body.expectedCreatedAt,expectedMessageEditedAt:body.expectedMessageEditedAt,
      }),{headers:reportReviewHeaders});
    }catch(error){return reportReviewErrorResponse(error);}
  }
  if(action === "resolve_appeal") {
    try {
      const database=getHubD1(),actor=await requireHubSessionProfile(request,database);
      return NextResponse.json(await resolveCommunityAppeal(database,actor,communityId,typeof body.appealId==="string"?body.appealId:"",{
        operationId:body.operationId,decision:body.decision,note:body.note,expectedCreatedAt:body.expectedCreatedAt,expectedSanctionKey:body.expectedSanctionKey,
      }),{headers:appealReviewHeaders});
    }catch(error){return appealReviewErrorResponse(error);}
  }
  try {
    const ownerOnly = ["create_role", "update_role", "delete_role", "assign_role", "channel_permission", "revoke_invite", "close", "request_verification", "create_rule", "delete_rule", "create_onboarding_question", "delete_onboarding_question", "create_auto_role_rule", "delete_auto_role_rule", "channel_token_gate", "set_channel_archived", "create_bot", "update_bot", "delete_bot", "run_bot"].includes(action);
    const { database, actor } = await requireOperator(request, communityId, ownerOnly);
    const now = new Date().toISOString();
    const critical = CRITICAL_ACTIONS.has(action);
    const operationId = text(body.operationId, 80);
    const operationNote = text(body.note, 1000);
    if (critical) {
      if (!validOperationId(operationId)) throw new Error("操作IDが正しくありません。");
      if (operationNote.length < 5) throw new Error("判断理由を5文字以上で入力してください。");
      const existing = await database.prepare(`SELECT id, action, detail, created_at
        FROM community_audit_log WHERE id = ? AND community_id = ?`)
        .bind(operationId, communityId).first<CommunityAuditRow>();
      if (existing) {
        if (existing.action !== action) throw new Error("操作IDが別の操作で使用されています。");
        const detail = parseAuditDetail(existing.detail);
        return NextResponse.json({
          ok: true,
          receipt: actionReceipt({
            auditId: existing.id,
            action: existing.action,
            targetId: detail.targetId ?? "",
            targetLabel: detail.targetLabel ?? "処理済みの対象",
            confirmedAt: existing.created_at,
            replayed: true,
          }),
        });
      }
    }
    if (action === "create_bot") {
      const name = text(body.name, 40);
      const kind = COMMUNITY_BOT_KINDS.includes(String(body.kind) as never) ? String(body.kind) : "";
      const channelId = text(body.channelId, 100) || null;
      if (!name || !kind) throw new Error("Bot名と種類を選んでください。");
      await database.prepare(`INSERT INTO community_bots
        (id, community_id, name, kind, channel_id, enabled, config_json, permissions_json, created_by_profile_id, created_at, updated_at)
        SELECT ?, ?, ?, ?, c.id, 1, '{}', '["read","notify"]', ?, ?, ? FROM community_channels c
        WHERE c.id = ? AND c.community_id = ?`)
        .bind(crypto.randomUUID(), communityId, name, kind, actor.id, now, now, channelId, communityId).run();
    } else if (action === "update_bot") {
      await database.prepare(`UPDATE community_bots SET enabled = ?, updated_at = ?
        WHERE id = ? AND community_id = ?`).bind(Number(body.enabled === true), now, text(body.botId, 100), communityId).run();
    } else if (action === "delete_bot") {
      const botId = text(body.botId, 100);
      const bot = await database.prepare("SELECT name FROM community_bots WHERE id = ? AND community_id = ?")
        .bind(botId, communityId).first<{ name: string }>();
      if (!bot) throw new Error("Botはすでに削除されたか、見つかりません。");
      await database.batch([
        database.prepare("DELETE FROM community_bots WHERE id = ? AND community_id = ?").bind(botId, communityId),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(operationNote, botId, `Bot「${bot.name}」`), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: botId, targetLabel: `Bot「${bot.name}」`, confirmedAt: now }) });
    } else if (action === "run_bot") {
      const run = await runCommunityBot(database, { communityId, botId: text(body.botId, 100), actorProfileId: actor.id });
      return NextResponse.json({ ok: true, run });
    } else if (action === "create_role") {
      const name = text(body.name, 40); if (!name) throw new Error("役職名を入力してください。");
      await database.prepare(`INSERT INTO community_custom_roles
        (id, community_id, name, position, can_manage_channels, can_manage_posts, can_manage_members, can_manage_guides, created_at)
        VALUES (?, ?, ?, (SELECT count(*) FROM community_custom_roles WHERE community_id = ?), ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), communityId, name, communityId, Number(body.canManageChannels === true), Number(body.canManagePosts === true), Number(body.canManageMembers === true), Number(body.canManageGuides === true), now).run();
    } else if (action === "assign_role") {
      const profileId = text(body.profileId, 100);
      const roleId = text(body.roleId, 100);
      const assigned = body.assigned !== false;
      const target = await database.prepare(`SELECT p.display_name AS displayName, r.name AS roleName,
        CASE WHEN mr.role_id IS NULL THEN 0 ELSE 1 END AS assigned
        FROM community_memberships m
        JOIN profiles p ON p.id = m.profile_id
        JOIN community_custom_roles r ON r.id = ? AND r.community_id = m.community_id
        LEFT JOIN community_member_custom_roles mr ON mr.community_id = m.community_id
          AND mr.profile_id = m.profile_id AND mr.role_id = r.id
        WHERE m.community_id = ? AND m.profile_id = ? AND m.status != 'banned'`)
        .bind(roleId, communityId, profileId).first<{ displayName: string; roleName: string; assigned: number }>();
      if (!target) throw new Error("対象メンバーまたは役職が見つかりません。");
      if (Boolean(target.assigned) === assigned) throw new Error(assigned ? "この役職はすでに割り当て済みです。" : "この役職はすでに解除されています。");
      const targetLabel = `${target.displayName}の役職「${target.roleName}」`;
      const mutation = assigned
        ? database.prepare(`INSERT INTO community_member_custom_roles
          (community_id, profile_id, role_id, assigned_at, assigned_by_profile_id) VALUES (?, ?, ?, ?, ?)`)
          .bind(communityId, profileId, roleId, now, actor.id)
        : database.prepare(`DELETE FROM community_member_custom_roles
          WHERE community_id = ? AND profile_id = ? AND role_id = ?`).bind(communityId, profileId, roleId);
      await database.batch([
        mutation,
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, profileId, action, auditDetail(`${operationNote}・変更:${assigned ? "割り当て" : "解除"}`, `${profileId}:${roleId}`, targetLabel), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: `${profileId}:${roleId}`, targetLabel, confirmedAt: now }) });
    } else if (action === "delete_role") {
      const roleId = text(body.roleId, 100);
      const role = await database.prepare("SELECT name FROM community_custom_roles WHERE id = ? AND community_id = ?")
        .bind(roleId, communityId).first<{ name: string }>();
      if (!role) throw new Error("役職はすでに削除されたか、見つかりません。");
      await database.batch([
        database.prepare("DELETE FROM community_custom_roles WHERE id = ? AND community_id = ?").bind(roleId, communityId),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(operationNote, roleId, `役職「${role.name}」`), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: roleId, targetLabel: `役職「${role.name}」`, confirmedAt: now }) });
    } else if (action === "update_role") {
      const name = text(body.name, 40); if (!name) throw new Error("役職名を入力してください。");
      await database.prepare(`UPDATE community_custom_roles SET name = ?, position = ?, can_manage_channels = ?,
        can_manage_posts = ?, can_manage_members = ?, can_manage_guides = ? WHERE id = ? AND community_id = ?`)
        .bind(name, Math.max(0, Math.floor(Number(body.position) || 0)), Number(body.canManageChannels === true), Number(body.canManagePosts === true), Number(body.canManageMembers === true), Number(body.canManageGuides === true), text(body.roleId, 100), communityId).run();
    } else if (action === "channel_permission") {
      const channelId = text(body.channelId, 100);
      const roleId = text(body.roleId, 100);
      const canView = body.canView !== false;
      const canPost = canView && body.canPost !== false;
      const canManage = canView && body.canManage === true;
      const target = await database.prepare(`SELECT c.name AS channelName, r.name AS roleName,
        COALESCE(p.can_view, 1) AS canView, COALESCE(p.can_post, 1) AS canPost, COALESCE(p.can_manage, 0) AS canManage
        FROM community_channels c JOIN community_custom_roles r ON r.id = ? AND r.community_id = c.community_id
        LEFT JOIN community_channel_permissions p ON p.channel_id = c.id AND p.role_id = r.id
        WHERE c.id = ? AND c.community_id = ?`)
        .bind(roleId, channelId, communityId).first<{ channelName: string; roleName: string; canView: number; canPost: number; canManage: number }>();
      if (!target) throw new Error("対象チャンネルまたは役職が見つかりません。");
      if (Boolean(target.canView) === canView && Boolean(target.canPost) === canPost && Boolean(target.canManage) === canManage) {
        throw new Error("チャンネル権限はすでに指定した状態です。");
      }
      const targetId = `${roleId}:${channelId}`;
      const targetLabel = `役職「${target.roleName}」の#${target.channelName}権限`;
      const before = `閲覧${target.canView ? "可" : "不可"}・投稿${target.canPost ? "可" : "不可"}・管理${target.canManage ? "可" : "不可"}`;
      const after = `閲覧${canView ? "可" : "不可"}・投稿${canPost ? "可" : "不可"}・管理${canManage ? "可" : "不可"}`;
      await database.batch([
        database.prepare(`INSERT INTO community_channel_permissions (channel_id, role_id, can_view, can_post, can_manage, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(channel_id, role_id) DO UPDATE SET can_view = excluded.can_view, can_post = excluded.can_post, can_manage = excluded.can_manage, updated_at = excluded.updated_at`)
          .bind(channelId, roleId, Number(canView), Number(canPost), Number(canManage), now),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(`${operationNote}・変更前:${before}・変更後:${after}`, targetId, targetLabel), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId, targetLabel, confirmedAt: now }) });
    } else if (action === "channel_token_gate") {
      // Retired: the symbol-only gate no longer guards anything (0241). Writing the old
      // columns would silently leave the channel open, so refuse and point to access gates.
      throw new Error("このチャンネル条件の設定は終了しました。新しい保有条件（アクセスゲート）を使ってください。");
    } else if (action === "create_auto_role_rule") {
      const criterion = ["membership_days", "message_count", "guide_contributions", "token_balance"].includes(String(body.criterion)) ? String(body.criterion) : "message_count";
      const threshold = text(body.threshold, 80);
      const roleId = text(body.roleId, 100);
      if (!threshold || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0) throw new Error("自動付与の基準値を1以上で入力してください。");
      const role = await database.prepare(`SELECT name FROM community_custom_roles WHERE id = ? AND community_id = ?`)
        .bind(roleId, communityId).first<{ name: string }>();
      if (!role) throw new Error("自動付与する役職が見つかりません。");
      const duplicate = await database.prepare(`SELECT id FROM community_role_auto_rules
        WHERE community_id = ? AND role_id = ? AND criterion = ? AND enabled = 1`)
        .bind(communityId, roleId, criterion).first<{ id: string }>();
      if (duplicate) throw new Error("この役職には同じ種類の自動付与ルールがすでにあります。");
      const ruleId = crypto.randomUUID();
      const targetLabel = `役職「${role.name}」の自動付与`;
      await database.batch([
        database.prepare(`INSERT INTO community_role_auto_rules
          (id, community_id, role_id, criterion, threshold, token_id, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?)`).bind(ruleId, communityId, roleId, criterion, threshold, now),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(`${operationNote}・基準:${criterion} ${threshold}`, ruleId, targetLabel), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: ruleId, targetLabel, confirmedAt: now }) });
    } else if (action === "delete_auto_role_rule") {
      const ruleId = text(body.ruleId, 100);
      const rule = await database.prepare(`SELECT a.criterion, a.threshold, r.name AS roleName
        FROM community_role_auto_rules a JOIN community_custom_roles r ON r.id = a.role_id
        WHERE a.id = ? AND a.community_id = ?`)
        .bind(ruleId, communityId).first<{ criterion: string; threshold: string; roleName: string }>();
      if (!rule) throw new Error("自動付与ルールはすでに解除されたか、見つかりません。");
      const targetLabel = `役職「${rule.roleName}」の自動付与`;
      await database.batch([
        database.prepare(`DELETE FROM community_role_auto_rules WHERE id = ? AND community_id = ?`).bind(ruleId, communityId),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(`${operationNote}・旧基準:${rule.criterion} ${rule.threshold}`, ruleId, targetLabel), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: ruleId, targetLabel, confirmedAt: now }) });
    } else if (action === "member_action") {
      const targetProfileId = text(body.profileId, 100);
      const memberAction = ["warn", "timeout", "remove_timeout"].includes(String(body.memberAction)) ? String(body.memberAction) : "warn";
      const member = await database.prepare(`SELECT m.role, m.status, p.display_name AS displayName
        FROM community_memberships m JOIN profiles p ON p.id = m.profile_id
        WHERE m.community_id = ? AND m.profile_id = ? AND m.status != 'banned'`)
        .bind(communityId, targetProfileId).first<{ role: string; status: string; displayName: string }>();
      if (!member || member.role === "owner") throw new Error("処分対象のメンバーが見つからないか、操作できません。");
      if (memberAction === "timeout" && member.status === "muted") throw new Error("このメンバーはすでに投稿停止中です。");
      if (memberAction === "remove_timeout" && member.status !== "muted") throw new Error("このメンバーは投稿停止中ではありません。");
      const reason = operationNote;
      const expiresAt = memberAction === "timeout" ? new Date(Date.now() + Math.min(Math.max(Number(body.hours) || 24, 1), 24 * 28) * 3600000).toISOString() : null;
      const targetLabel = `${member.displayName}への${memberAction === "warn" ? "警告" : memberAction === "timeout" ? "投稿停止" : "投稿停止解除"}`;
      await database.batch([
        database.prepare(`INSERT INTO community_member_actions (id, community_id, target_profile_id, actor_profile_id, action, reason, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), communityId, targetProfileId, actor.id, memberAction, reason, expiresAt, now),
        database.prepare(`UPDATE community_memberships SET status = CASE WHEN ? = 'timeout' THEN 'muted' WHEN ? = 'remove_timeout' THEN 'active' ELSE status END WHERE community_id = ? AND profile_id = ? AND role != 'owner'`)
          .bind(memberAction, memberAction, communityId, targetProfileId),
        database.prepare(`INSERT INTO community_audit_log (id, community_id, actor_profile_id, target_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, targetProfileId, action, auditDetail(`${reason}${expiresAt ? `・期限:${expiresAt}` : ""}`, targetProfileId, targetLabel), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: targetProfileId, targetLabel, confirmedAt: now }) });
    } else if (action === "request_verification") {
      const reason = text(body.reason, 1000); if (reason.length < 20) throw new Error("認証が必要な理由を20文字以上で入力してください。");
      await database.batch([
        database.prepare(`INSERT INTO community_verification_requests (community_id, requested_by_profile_id, reason, status, created_at) VALUES (?, ?, ?, 'pending', ?)
          ON CONFLICT(community_id) DO UPDATE SET requested_by_profile_id = excluded.requested_by_profile_id, reason = excluded.reason, status = 'pending', created_at = excluded.created_at, resolved_at = NULL`).bind(communityId, actor.id, reason, now),
        database.prepare(`UPDATE communities SET verification_status = 'pending' WHERE id = ?`).bind(communityId),
      ]);
    } else if (action === "close") {
      const community = await database.prepare(`SELECT name, lifecycle_status AS lifecycleStatus
        FROM communities WHERE id = ? AND owner_profile_id = ?`)
        .bind(communityId, actor.id).first<{ name: string; lifecycleStatus: string }>();
      if (!community) throw new Error("閉鎖できるコミュニティが見つかりません。");
      if (community.lifecycleStatus === "closed") throw new Error("コミュニティはすでに閉鎖されています。");
      if (text(body.confirmName, 160) !== community.name) throw new Error("コミュニティ名が一致しません。");
      await database.batch([
        database.prepare(`UPDATE communities SET lifecycle_status = 'closed', updated_at = ?
          WHERE id = ? AND owner_profile_id = ? AND lifecycle_status != 'closed'`).bind(now, communityId, actor.id),
        database.prepare(`INSERT INTO community_audit_log
          (id, community_id, actor_profile_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(operationId, communityId, actor.id, action, auditDetail(operationNote, communityId, `コミュニティ「${community.name}」`), now),
      ]);
      return NextResponse.json({ ok: true, receipt: actionReceipt({ auditId: operationId, action, targetId: communityId, targetLabel: `コミュニティ「${community.name}」`, confirmedAt: now }) });
    } else throw new Error("未対応の操作です。");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "運営操作を完了できませんでした。";
    const status = /ログイン|認証|権限/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
