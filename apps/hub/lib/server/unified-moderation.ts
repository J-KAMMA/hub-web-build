import "server-only";

import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";

import { unpublishAttachedFiles } from "@/lib/server/content-files";
import { CopyrightCaseError, decideCase, hideImmediately, listCopyrightQueue } from "@/lib/server/copyright-cases";

export type UnifiedReport = {
  id: string;
  kind: "social_post" | "social_post_appeal" | "profile" | "appeal" | "copyright" | "video" | "music" | "work_listing" | "remote_flag" | "article_comment";
  reason: string;
  details: string;
  status: string;
  createdAt: string;
  targetId: string;
  preview: string;
};

export async function listUnifiedReports(db: D1Database, status = "open") {
  const [social, socialAppeals, profiles, appeals, copyright, workListings, remoteFlags, articleComments] = await Promise.all([
    db.prepare("SELECT r.id,r.reason,r.details,r.status,r.created_at,r.post_id target_id,substr(p.body,1,500) preview FROM social_post_reports r JOIN social_posts p ON p.id=r.post_id WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    db.prepare("SELECT a.id,'post_appeal' reason,a.message details,a.status,a.created_at,a.post_id target_id,substr(p.body,1,500) preview FROM social_post_moderation_appeals a JOIN social_posts p ON p.id=a.post_id WHERE (?='all' OR a.status=?) ORDER BY a.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    db.prepare("SELECT r.id,r.reason,r.details,r.status,r.created_at,r.target_profile_id target_id,('@'||p.handle||' '||p.display_name) preview FROM profile_reports r JOIN profiles p ON p.id=r.target_profile_id WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    db.prepare("SELECT a.id,'appeal' reason,a.message details,a.status,a.created_at,a.profile_id target_id,('@'||p.handle||' '||p.display_name) preview FROM moderation_appeals a JOIN profiles p ON p.id=a.profile_id WHERE (?='all' OR a.status=?) ORDER BY a.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    // 著作権の申告は事件の表（copyright_case_targets）から引く。連絡先は Hub に無い。
    listCopyrightQueue(db, status),
    db.prepare("SELECT r.id,r.reason,r.details,r.status,r.created_at,r.listing_id target_id,substr(w.title,1,500) preview FROM work_listing_reports r JOIN work_listings w ON w.id=r.listing_id WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    // 他のハブから Flag で届いた通報。通報者は個人ではなく送信元のハブ。
    db.prepare("SELECT r.id,r.reason,r.details,r.status,r.created_at,r.target_id,('['||r.source_host||'] '||COALESCE(CASE WHEN r.target_kind='post' THEN (SELECT substr(body,1,400) FROM social_posts WHERE id=r.target_id) ELSE (SELECT '@'||handle||' '||display_name FROM profiles WHERE id=r.target_id) END,'')) preview FROM remote_flag_reports r WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100").bind(status, status).all<any>(),
    // 記事コメントへの通報。表示するのは通報時点のコメント抜粋だけで、記事本文（閲覧条件つきを含む）は出さない。
    db.prepare("SELECT r.id,r.reason,('記事 '||r.article_id) details,r.status,r.created_at,r.comment_id target_id,r.excerpt preview FROM hub_user_article_comment_reports r WHERE (?='all' OR r.status=?) ORDER BY r.created_at DESC LIMIT 100").bind(status, status).all<any>(),
  ]);
  const map = (kind: UnifiedReport["kind"]) => (row: any): UnifiedReport => ({
    id: row.id,
    kind,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
    targetId: row.target_id,
    preview: row.preview,
  });
  return [
    ...(social.results ?? []).map(map("social_post")),
    ...(socialAppeals.results ?? []).map(map("social_post_appeal")),
    ...(profiles.results ?? []).map(map("profile")),
    ...(appeals.results ?? []).map(map("appeal")),
    ...copyright.map((row): UnifiedReport => ({ ...row, kind: "copyright" })),
    ...(workListings.results ?? []).map(map("work_listing")),
    ...(remoteFlags.results ?? []).map(map("remote_flag")),
    ...(articleComments.results ?? []).map(map("article_comment")),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function outcomeText(subject: string, actionTaken: boolean) {
  return actionTaken
    ? `${subject}への通報を確認し、必要な対応を行いました。`
    : `${subject}への通報を確認しました。現時点では対応対象とは判断しませんでした。`;
}

export async function actOnUnifiedReport(
  db: D1Database,
  kind: UnifiedReport["kind"],
  id: string,
  action: string,
  note: string,
  options: { immediateReason?: unknown; clearlyInfringing?: boolean; media?: R2Bucket } = {},
) {
  const now = new Date().toISOString();
  const notices: Array<[profileId: string, text: string, route: string]> = [];

  if (kind === "remote_flag") {
    if (!["dismiss", "hide"].includes(action)) throw new Error("不正な操作です。");
    const report = await db.prepare("SELECT target_kind,target_id FROM remote_flag_reports WHERE id=? AND status='open'")
      .bind(id).first<{ target_kind: string; target_id: string }>();
    if (!report) throw new Error("通報が見つからないか、すでに処理済みです。");
    if (action === "hide") {
      if (report.target_kind !== "post") throw new Error("外部のハブからの通報で非表示にできるのは投稿だけです。");
      await db.batch([
        db.prepare("UPDATE social_posts SET moderated_at=?,moderation_reason=? WHERE id=?").bind(now, note, report.target_id),
        db.prepare(`INSERT INTO social_post_moderation_cases(post_id,status,reason,report_count,version,opened_at,updated_at,resolved_at)
          VALUES(?,'hidden',?,0,1,?,?,?)
          ON CONFLICT(post_id) DO UPDATE SET status='hidden',reason=excluded.reason,updated_at=excluded.updated_at,
          resolved_at=excluded.resolved_at,version=version+1`).bind(report.target_id, note, now, now, now),
        db.prepare("UPDATE remote_flag_reports SET status='actioned',reviewed_at=? WHERE target_kind='post' AND target_id=? AND status='open'")
          .bind(now, report.target_id),
      ]);
      // Gated file attachments stop with the post (AGENTS.md: same operation as the suspension).
      await unpublishAttachedFiles(db, { targetType: "post", targetId: report.target_id });
    } else {
      await db.prepare("UPDATE remote_flag_reports SET status='dismissed',reviewed_at=? WHERE id=? AND status='open'")
        .bind(now, id).run();
    }
    // 通報したのは外部のハブなので、こちらの利用者への通知は出さない（投稿者への通知は hide のときだけ）。
    if (action === "hide") {
      const author = await db.prepare("SELECT author_profile_id FROM social_posts WHERE id=?").bind(report.target_id).first<{ author_profile_id: string | null }>();
      if (author?.author_profile_id) notices.push([author.author_profile_id, "投稿が運営判断により非表示になりました。異議申し立てを利用できます。", "/appeal"]);
    }
  } else if (kind === "article_comment") {
    if (!["dismiss", "remove"].includes(action)) throw new Error("不正な操作です。");
    const report = await db.prepare(`SELECT r.comment_id,r.reporter_profile_id,c.author_profile_id
      FROM hub_user_article_comment_reports r JOIN hub_user_article_comments c ON c.id=r.comment_id
      WHERE r.id=? AND r.status='open'`).bind(id).first<{
      comment_id: string; reporter_profile_id: string; author_profile_id: string;
    }>();
    if (!report) throw new Error("通報が見つからないか、すでに処理済みです。");
    if (action === "remove") {
      await db.batch([
        db.prepare("UPDATE hub_user_article_comments SET status='removed',body='',removed_by='moderator',removed_at=? WHERE id=? AND status='published'")
          .bind(now, report.comment_id),
        db.prepare("UPDATE hub_user_article_comment_reports SET status='resolved' WHERE comment_id=? AND status='open'")
          .bind(report.comment_id),
      ]);
      notices.push([report.author_profile_id, "記事へのコメントが運営判断により削除されました。", "/notifications"]);
    } else {
      await db.prepare("UPDATE hub_user_article_comment_reports SET status='dismissed' WHERE id=? AND status='open'")
        .bind(id).run();
    }
    notices.push([report.reporter_profile_id, outcomeText("コメント", action === "remove"), "/notifications"]);
  } else if (kind === "work_listing") {
    if (!["dismiss", "resolve", "hide"].includes(action)) throw new Error("不正な操作です。");
    const report = await db.prepare(`SELECT r.listing_id,r.reporter_profile_id,w.owner_profile_id
      FROM work_listing_reports r JOIN work_listings w ON w.id=r.listing_id
      WHERE r.id=? AND r.status='open'`).bind(id).first<{
      listing_id: string; reporter_profile_id: string; owner_profile_id: string;
    }>();
    if (!report) throw new Error("通報が見つからないか、すでに処理済みです。");
    const statements: D1PreparedStatement[] = [
      db.prepare("UPDATE work_listing_reports SET status=?,updated_at=? WHERE id=? AND status='open'")
        .bind(action === "dismiss" ? "dismissed" : "resolved", now, id),
    ];
    if (action === "hide") {
      statements.push(db.prepare("UPDATE work_listings SET status='rejected',rejection_reason=?,updated_at=? WHERE id=?")
        .bind(note, now, report.listing_id));
    }
    await db.batch(statements);
    notices.push([report.reporter_profile_id, outcomeText("仕事掲載", action !== "dismiss"), "/notifications"]);
    if (action === "hide") {
      notices.push([report.owner_profile_id, "仕事掲載が運営判断により非公開になりました。", "/work"]);
    }
  } else if (kind === "social_post") {
    if (!["dismiss", "hide", "restore"].includes(action)) throw new Error("不正な操作です。");
    const report = await db.prepare(`SELECT r.post_id,r.reporter_profile_id,p.author_profile_id
      FROM social_post_reports r JOIN social_posts p ON p.id=r.post_id
      WHERE r.id=? AND r.status='open'`).bind(id).first<{
      post_id: string; reporter_profile_id: string; author_profile_id: string | null;
    }>();
    if (!report) throw new Error("通報が見つからないか、すでに処理済みです。");
    if (action === "hide") {
      await db.batch([
        db.prepare("UPDATE social_posts SET moderated_at=?,moderation_reason=? WHERE id=?").bind(now, note, report.post_id),
        db.prepare("UPDATE social_post_reports SET status='actioned',reviewed_at=? WHERE post_id=? AND status='open'").bind(now, report.post_id),
        db.prepare(`INSERT INTO social_post_moderation_cases(post_id,status,reason,report_count,version,opened_at,updated_at,resolved_at)
          VALUES(?,'hidden',?,0,1,?,?,?)
          ON CONFLICT(post_id) DO UPDATE SET status='hidden',reason=excluded.reason,updated_at=excluded.updated_at,
          resolved_at=excluded.resolved_at,version=version+1`).bind(report.post_id, note, now, now, now),
      ]);
      await unpublishAttachedFiles(db, { targetType: "post", targetId: report.post_id });
    } else if (action === "restore") {
      await db.batch([
        db.prepare("UPDATE social_posts SET moderated_at=NULL,moderation_reason=NULL WHERE id=?").bind(report.post_id),
        db.prepare("UPDATE social_post_reports SET status='dismissed',reviewed_at=? WHERE post_id=? AND status='open'").bind(now, report.post_id),
        db.prepare(`UPDATE social_post_moderation_cases SET status='restored',reason=?,updated_at=?,resolved_at=?,version=version+1
          WHERE post_id=? AND status IN ('auto_held','hidden')`).bind(note, now, now, report.post_id),
      ]);
    } else {
      await db.prepare("UPDATE social_post_reports SET status='dismissed',reviewed_at=? WHERE id=? AND status='open'")
        .bind(now, id).run();
    }
    notices.push([report.reporter_profile_id, outcomeText("投稿", action === "hide"), "/notifications"]);
    if (action === "hide" && report.author_profile_id) {
      notices.push([report.author_profile_id, "投稿が運営判断により非表示になりました。異議申し立てを利用できます。", "/appeal"]);
    }
    if (action === "restore" && report.author_profile_id) {
      notices.push([report.author_profile_id, "安全確認が完了し、投稿の表示を復元しました。", `/posts/${report.post_id}`]);
    }
  } else if (kind === "social_post_appeal") {
    if (!["accept", "reject"].includes(action)) throw new Error("不正な操作です。");
    const appeal = await db.prepare(`SELECT post_id,author_profile_id
      FROM social_post_moderation_appeals WHERE id=? AND status='open'`)
      .bind(id).first<{ post_id: string; author_profile_id: string }>();
    if (!appeal) throw new Error("異議申し立てが見つからないか、すでに審査済みです。");
    if (action === "accept") {
      await db.batch([
        db.prepare("UPDATE social_posts SET moderated_at=NULL,moderation_reason=NULL WHERE id=?").bind(appeal.post_id),
        db.prepare(`UPDATE social_post_moderation_cases SET status='restored',reason=?,updated_at=?,resolved_at=?,version=version+1
          WHERE post_id=? AND status IN ('auto_held','hidden')`).bind(note, now, now, appeal.post_id),
        db.prepare("UPDATE social_post_moderation_appeals SET status='accepted',resolution_note=?,resolved_at=? WHERE id=? AND status='open'")
          .bind(note, now, id),
      ]);
    } else {
      await db.prepare("UPDATE social_post_moderation_appeals SET status='rejected',resolution_note=?,resolved_at=? WHERE id=? AND status='open'")
        .bind(note, now, id).run();
    }
    notices.push([
      appeal.author_profile_id,
      action === "accept" ? "異議申し立てが承認され、投稿を復元しました。" : "投稿への異議申し立ての審査が完了しました。",
      "/appeal",
    ]);
  } else if (kind === "profile") {
    if (!["dismiss", "suspend"].includes(action)) throw new Error("不正な操作です。");
    const report = await db.prepare("SELECT target_profile_id,reporter_profile_id FROM profile_reports WHERE id=? AND status='open'")
      .bind(id).first<{ target_profile_id: string; reporter_profile_id: string }>();
    if (!report) throw new Error("通報が見つからないか、すでに処理済みです。");
    if (action === "suspend") {
      await db.batch([
        db.prepare(`INSERT INTO profile_moderation_status(profile_id,status,reason,suspended_at,updated_at)
          VALUES(?,'suspended',?,?,?) ON CONFLICT(profile_id) DO UPDATE SET status='suspended',
          reason=excluded.reason,suspended_at=excluded.suspended_at,updated_at=excluded.updated_at`)
          .bind(report.target_profile_id, note, now, now),
        db.prepare("UPDATE profile_reports SET status='reviewed',updated_at=? WHERE id=?").bind(now, id),
      ]);
    } else {
      await db.prepare("UPDATE profile_reports SET status='closed',updated_at=? WHERE id=?").bind(now, id).run();
    }
    notices.push([report.reporter_profile_id, outcomeText("プロフィール", action === "suspend"), "/notifications"]);
    if (action === "suspend") {
      notices.push([report.target_profile_id, "プロフィールが停止されました。異議申し立てを利用できます。", "/appeal"]);
    }
  } else if (kind === "appeal") {
    if (!["accept", "reject"].includes(action)) throw new Error("不正な操作です。");
    const appeal = await db.prepare("SELECT profile_id FROM moderation_appeals WHERE id=? AND status='open'")
      .bind(id).first<{ profile_id: string }>();
    if (!appeal) throw new Error("異議申し立てが見つからないか、すでに審査済みです。");
    if (action === "accept") {
      await db.batch([
        db.prepare("UPDATE profile_moderation_status SET status='active',reason='',updated_at=? WHERE profile_id=?").bind(now, appeal.profile_id),
        db.prepare("UPDATE moderation_appeals SET status='accepted',resolution_note=?,resolved_at=? WHERE id=?").bind(note, now, id),
      ]);
    } else {
      await db.prepare("UPDATE moderation_appeals SET status='rejected',resolution_note=?,resolved_at=? WHERE id=?")
        .bind(note, now, id).run();
    }
    notices.push([
      appeal.profile_id,
      action === "accept" ? "異議申し立てが承認され、プロフィール停止を解除しました。" : "異議申し立ての審査が完了しました。",
      "/appeal",
    ]);
  } else if (kind === "copyright") {
    /*
     * 著作権の申告。id は copyright_case_targets.id（旧い申告は旧い id をそのまま引き継いでいる）。
     * 通知（投稿者・申告者）と追記だけの記録は、状態を動かす 1 本の batch の中で copyright-cases が書く。
     * 以前の「処置」は状態の文字を変えるだけで対象を非公開にしていなかった。いまは対象の公開状態まで動く。
     *   accept / action : 申告を認める（受付→照会か即時、異議あり→確定、同意しない旨→非公開）
     *   reject          : 申告を退ける（受付→却下、同意しない旨→公開のまま、非公開→復元）
     *   immediate       : 明白な場合の即時の非公開（理由 immediateReason が要る）
     */
    if (!["reject", "action", "accept", "immediate"].includes(action)) throw new Error("不正な操作です。");
    try {
      if (action === "immediate") await hideImmediately(db, id, options.immediateReason, note, { media: options.media, now });
      else await decideCase(db, id, action === "reject" ? "reject" : "accept", note, { media: options.media, now, clearlyInfringing: options.clearlyInfringing === true });
    } catch (error) {
      if (error instanceof CopyrightCaseError) throw new Error(error.message);
      throw error;
    }
  } else {
    throw new Error("この種類の通報は専用処理が必要です。");
  }

  const auditId = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO hub_admin_audit_log
      (id,actor_role,action,target_type,target_id,metadata_json,created_at)
      VALUES(?,'moderator',?,?,?,?,?)`)
      .bind(auditId, action, kind, id, JSON.stringify({ note: note.slice(0, 1000) }), now),
    ...notices.map(([profileId, text, route]) => db.prepare(`INSERT INTO notifications
      (id,receiver_profile_id,actor_profile_id,notification_type,target_type,target_id,text,is_read,created_at)
      VALUES(?,?,NULL,'system','system',?,?,0,?)`)
      .bind(crypto.randomUUID(), profileId, `${route}#event=moderation-report:${kind}:${id}:${action}`, text, now)),
  ]);
  return { auditId, action, kind, targetId: id, confirmedAt: now };
}
