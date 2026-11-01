import "server-only";

import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";

/*
 * 著作権の事件で「非公開にする」「戻す」「確定して本体を消す」の、対象ごとの実際の書き込み（PLAN 3 章）。
 *
 * 非公開は、各一覧・検索・フィード・OGP・MCP がすでに見ている列で表す。新しい除外条件を一覧ごとに足すのではなく、
 * 既存の条件がそのまま効くようにする。
 * - 投稿・記事：moderated_at / moderation_reason（reason は `copyright:<事件番号>`）
 * - 投稿の画像：social_post_images.status = 'rejected'（画像の配信は 'published' だけ）
 * - 外部動画の埋め込み：external_videos.status = 'removed'（一覧は 'active' だけ）
 * - Hub の自作動画（video）：hub_videos.hold_reason = 'copyright' と state = 'unpublished'（再生札・一覧・カタログはこれを見る）。
 *   動画の Worker への停止・停止解除・削除は、同じ batch で hub_video_outbox に積み、届くまで再送する。
 * - Hubpedia の版：版に印（copyright_hidden_at）を付け、公開の版の指し先を一つ前の版へ付け替える
 *
 * ここの関数は D1 の文を作るだけで、状態の更新（copyright_case_targets）と同じ batch に入れて使う。
 * 文はすべて「その対象の行が今その状態であるときだけ」効くように書く（EXISTS）。
 * 状態の更新が他の処理に負けたときは、公開状態も動かない。
 *
 * 本文や連絡先は、事件の記録にも通知にも写さない。ここが扱うのは対象の種類とIDだけ。
 */

export const COPYRIGHT_TARGET_KINDS = ["social_post", "social_image", "article", "hubpedia_revision", "video_embed", "video"] as const;
export type CopyrightTargetKind = (typeof COPYRIGHT_TARGET_KINDS)[number];

export function isCopyrightTargetKind(value: unknown): value is CopyrightTargetKind {
  return typeof value === "string" && (COPYRIGHT_TARGET_KINDS as readonly string[]).includes(value);
}

export const COPYRIGHT_REASON_PREFIX = "copyright:";
const SCRUBBED_BODY = "[著作権の申告により削除されました]";

/** 復元に要る、非公開にする前の状態。JSON で copyright_case_targets.restore_data に入れる（1000字まで）。 */
export type RestoreData = {
  v: 1;
  /** 画像・動画：隠す前の status。 */
  prevStatus?: string;
  /** Hubpedia：どちらの版の表か。 */
  store?: "wiki" | "enc";
  /** Hubpedia：wiki は article_key、enc は article_id。 */
  containerId?: string;
  /** Hubpedia：隠す版が、いま公開されている版だったか。 */
  wasLive?: boolean;
  /** Hubpedia：付け替えた先（一つ前の版。無ければ null）。 */
  prevPointer?: string | null;
};

export type ResolvedCopyrightTarget = {
  kind: CopyrightTargetKind;
  /** 実際の対象のID。Hubpedia は、スラッグで申告されても版のIDに解決したもの。 */
  id: string;
  authorProfileId: string | null;
  restore: RestoreData | null;
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * 申告された対象を実在の行に解決する。見つからなければ null。
 * 本文は読まない（投稿者のIDと、復元に要る状態だけ）。
 */
export async function resolveCopyrightTarget(
  db: D1Database,
  kind: CopyrightTargetKind,
  rawId: string,
): Promise<ResolvedCopyrightTarget | null> {
  const id = rawId.trim();
  if (!id || id.length > 200) return null;
  if (kind === "video" || kind === "video_embed") {
    // 自作動画の一覧の行（external_videos）の ID は動画の ID と同じ。どちらの URL で申告されても、動画そのものを対象にする。
    const video = await db.prepare("SELECT profile_id AS author, state, hold_reason AS hold FROM hub_videos WHERE id=? AND state <> 'deleted' LIMIT 1").bind(id).first<Row>();
    if (video) {
      let prevStatus = String(video.state);
      if (video.hold === "copyright") {
        // すでに別の事件が止めている。止める前の状態は、先に止めた事件の記録から引き継ぐ（復元で元に戻すため）。
        const earlier = await db.prepare(`SELECT restore_data FROM copyright_case_targets
          WHERE target_kind = 'video' AND target_id = ? AND state IN ('hidden','final') ORDER BY hidden_at LIMIT 1`).bind(id).first<Row>();
        const inherited = parseRestoreData(earlier?.restore_data);
        if (inherited?.prevStatus) prevStatus = inherited.prevStatus;
      }
      return { kind: "video", id, authorProfileId: text(video.author), restore: { v: 1, prevStatus } };
    }
    if (kind === "video") return null;
  }
  if (kind === "social_post") {
    const row = await db.prepare("SELECT author_profile_id AS author FROM social_posts WHERE id=? LIMIT 1").bind(id).first<Row>();
    return row ? { kind, id, authorProfileId: text(row.author), restore: null } : null;
  }
  if (kind === "article") {
    const row = await db.prepare("SELECT author_profile_id AS author FROM hub_user_articles WHERE id=? LIMIT 1").bind(id).first<Row>();
    return row ? { kind, id, authorProfileId: text(row.author), restore: null } : null;
  }
  if (kind === "social_image") {
    const row = await db.prepare("SELECT owner_profile_id AS author, status FROM social_post_images WHERE id=? LIMIT 1").bind(id).first<Row>();
    return row ? { kind, id, authorProfileId: text(row.author), restore: { v: 1, prevStatus: String(row.status) } } : null;
  }
  if (kind === "video_embed") {
    const row = await db.prepare("SELECT submitted_by_profile_id AS author, status FROM external_videos WHERE id=? LIMIT 1").bind(id).first<Row>();
    return row ? { kind, id, authorProfileId: text(row.author), restore: { v: 1, prevStatus: String(row.status) } } : null;
  }
  return resolveHubpediaRevision(db, id);
}

async function resolveHubpediaRevision(db: D1Database, id: string): Promise<ResolvedCopyrightTarget | null> {
  const wiki = await db.prepare(`SELECT r.id, r.article_key AS container, r.revision_number AS n, r.created_by_profile_id AS author,
      a.published_revision_id AS live
    FROM hubpedia_wiki_revisions r JOIN hubpedia_wiki_articles a ON a.article_key = r.article_key
    WHERE r.id = ? LIMIT 1`).bind(id).first<Row>();
  if (wiki) return hubpediaWiki(db, wiki);
  const enc = await db.prepare(`SELECT r.id, r.article_id AS container, r.revision_number AS n, a.current_revision_id AS live
    FROM encyclopedia_article_revisions r JOIN encyclopedia_articles a ON a.id = r.article_id
    WHERE r.id = ? LIMIT 1`).bind(id).first<Row>();
  if (enc) return hubpediaEnc(db, enc);
  // スラッグでの申告：いま公開されている版を対象にする。
  const liveWiki = await db.prepare(`SELECT r.id, r.article_key AS container, r.revision_number AS n, r.created_by_profile_id AS author,
      a.published_revision_id AS live
    FROM hubpedia_wiki_articles a JOIN hubpedia_wiki_revisions r ON r.id = a.published_revision_id
    WHERE a.slug = ? ORDER BY CASE a.source_kind WHEN 'encyclopedia_article' THEN 0 WHEN 'd1_article' THEN 1 ELSE 2 END LIMIT 1`).bind(id).first<Row>();
  if (liveWiki) return hubpediaWiki(db, liveWiki);
  const liveEnc = await db.prepare(`SELECT r.id, r.article_id AS container, r.revision_number AS n, a.current_revision_id AS live
    FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id
    WHERE a.slug = ? LIMIT 1`).bind(id).first<Row>();
  return liveEnc ? hubpediaEnc(db, liveEnc) : null;
}

async function hubpediaWiki(db: D1Database, row: Row): Promise<ResolvedCopyrightTarget> {
  const prev = await db.prepare(`SELECT id FROM hubpedia_wiki_revisions
    WHERE article_key = ? AND revision_number < ? AND copyright_hidden_at IS NULL
    ORDER BY revision_number DESC LIMIT 1`).bind(String(row.container), Number(row.n)).first<Row>();
  return {
    kind: "hubpedia_revision",
    id: String(row.id),
    authorProfileId: text(row.author),
    restore: { v: 1, store: "wiki", containerId: String(row.container), wasLive: row.live === row.id, prevPointer: text(prev?.id) },
  };
}

async function hubpediaEnc(db: D1Database, row: Row): Promise<ResolvedCopyrightTarget> {
  const prev = await db.prepare(`SELECT id FROM encyclopedia_article_revisions
    WHERE article_id = ? AND revision_number < ? AND copyright_hidden_at IS NULL
    ORDER BY revision_number DESC LIMIT 1`).bind(String(row.container), Number(row.n)).first<Row>();
  return {
    kind: "hubpedia_revision",
    id: String(row.id),
    authorProfileId: null, // encyclopedia の created_by は Hub のプロフィールIDではない
    restore: { v: 1, store: "enc", containerId: String(row.container), wasLive: row.live === row.id, prevPointer: text(prev?.id) },
  };
}

export function parseRestoreData(value: unknown): RestoreData | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as RestoreData;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeRestoreData(restore: RestoreData | null): string | null {
  if (!restore) return null;
  const json = JSON.stringify(restore);
  return json.length <= 1000 ? json : null;
}

// ---------------------------------------------------------------------------
// 非公開・復元・確定の文
// ---------------------------------------------------------------------------

export type StatementTarget = {
  /** copyright_case_targets.id */
  rowId: string;
  kind: CopyrightTargetKind;
  /** 解決済みの対象ID */
  id: string;
  caseNumber: string;
  restore: RestoreData | null;
};

/** 行が、この瞬間の非公開（hidden_at が一致）にあるときだけ真。 */
function hiddenNow(rowId: string, now: string) {
  return {
    sql: "EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = 'hidden' AND hidden_at = ?)",
    args: [rowId, now] as unknown[],
  };
}

/**
 * 動画の Worker に伝える仕事を hub_video_outbox に積む文（条件が真のときだけ）。dropKinds は、置き換わる反対向きの仕事。
 * Hub の行を動かす文と同じ batch に入れるので、「Hub は変えたが Worker に伝え忘れた」状態は残らない。
 * 種類は定数だけで、外から文字列を入れない。
 */
function videoOutbox(
  db: D1Database,
  videoId: string,
  kind: "suspend" | "unsuspend" | "takedown",
  dropKinds: readonly ("suspend" | "unsuspend" | "unpublish" | "delete")[],
  now: string,
  where: { sql: string; args: unknown[] },
): D1PreparedStatement[] {
  const guard = `${where.sql} AND EXISTS (SELECT 1 FROM hub_videos WHERE id = ?)`;
  const args = [...where.args, videoId];
  return [
    db.prepare(`DELETE FROM hub_video_outbox WHERE video_id = ? AND kind IN (${dropKinds.map((k) => `'${k}'`).join(",")}) AND ${where.sql}`)
      .bind(videoId, ...where.args),
    db.prepare(`INSERT INTO hub_video_outbox (id, video_id, kind, attempts, next_attempt_at, created_at)
      SELECT lower(hex(randomblob(16))), ?, ?, 0, ?, ? WHERE ${guard}
      ON CONFLICT(video_id, kind) DO UPDATE SET attempts = 0, next_attempt_at = excluded.next_attempt_at`)
      .bind(videoId, kind, now, now, ...args),
  ];
}

/** 行が復元済みで、同じ対象をほかの事件が隠していないときだけ真。 */
function restorable(t: StatementTarget) {
  return {
    sql: `EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = 'restored')
      AND NOT EXISTS (SELECT 1 FROM copyright_case_targets o
        WHERE o.target_kind = ? AND o.target_id = ? AND o.id <> ? AND o.state IN ('hidden','final'))`,
    args: [t.rowId, t.kind, t.id, t.rowId] as unknown[],
  };
}

function finalNow(rowId: string) {
  return { sql: "EXISTS (SELECT 1 FROM copyright_case_targets WHERE id = ? AND state = 'final')", args: [rowId] as unknown[] };
}

/** 非公開にする文。同じ batch で行を 'hidden'（hidden_at = now）にしたあとに流す。 */
export function hideStatements(db: D1Database, t: StatementTarget, now: string): D1PreparedStatement[] {
  const cond = hiddenNow(t.rowId, now);
  const reason = `${COPYRIGHT_REASON_PREFIX}${t.caseNumber}`.slice(0, 120);
  switch (t.kind) {
    case "social_post":
      return [db.prepare(`UPDATE social_posts SET moderated_at = ?, moderation_reason = ?
        WHERE id = ? AND moderated_at IS NULL AND ${cond.sql}`).bind(now, reason, t.id, ...cond.args)];
    case "article":
      return [db.prepare(`UPDATE hub_user_articles SET moderated_at = ?, moderation_reason = ?
        WHERE id = ? AND moderated_at IS NULL AND ${cond.sql}`).bind(now, reason, t.id, ...cond.args)];
    case "social_image":
      return [db.prepare(`UPDATE social_post_images SET status = 'rejected'
        WHERE id = ? AND status = 'published' AND ${cond.sql}`).bind(t.id, ...cond.args)];
    case "video_embed":
      return [db.prepare(`UPDATE external_videos SET status = 'removed', updated_at = ?
        WHERE id = ? AND status = 'active' AND ${cond.sql}`).bind(now, t.id, ...cond.args)];
    case "video":
      return [
        db.prepare(`UPDATE hub_videos SET hold_reason = 'copyright',
            unpublished_at = CASE WHEN state = 'published' THEN ? ELSE unpublished_at END,
            state = CASE WHEN state = 'published' THEN 'unpublished' ELSE state END,
            updated_at = ?
          WHERE id = ? AND state <> 'deleted' AND hold_reason IS NULL AND ${cond.sql}`)
          .bind(now, now, t.id, ...cond.args),
        ...videoOutbox(db, t.id, "suspend", ["unsuspend"], now, cond),
      ];
    case "hubpedia_revision": {
      const r = t.restore;
      if (r?.store === "enc") {
        const out = [db.prepare(`UPDATE encyclopedia_article_revisions SET copyright_hidden_at = ?
          WHERE id = ? AND copyright_hidden_at IS NULL AND ${cond.sql}`).bind(now, t.id, ...cond.args)];
        if (r.wasLive) {
          out.push(db.prepare(`UPDATE encyclopedia_articles SET current_revision_id = ?
            WHERE id = ? AND current_revision_id = ? AND ${cond.sql}`).bind(r.prevPointer ?? null, r.containerId ?? "", t.id, ...cond.args));
        }
        return out;
      }
      const out = [db.prepare(`UPDATE hubpedia_wiki_revisions SET copyright_hidden_at = ?
        WHERE id = ? AND copyright_hidden_at IS NULL AND ${cond.sql}`).bind(now, t.id, ...cond.args)];
      if (r?.wasLive) {
        out.push(db.prepare(`UPDATE hubpedia_wiki_articles SET published_revision_id = ?, updated_at = ?
          WHERE article_key = ? AND published_revision_id = ? AND ${cond.sql}`).bind(r.prevPointer ?? null, now, r.containerId ?? "", t.id, ...cond.args));
      }
      return out;
    }
  }
}

/**
 * 戻す文。同じ batch で行を 'restored' にしたあとに流す。
 * ほかの事件が同じ対象を隠している間は何もしない。また、事件が付けた印（reason の接頭辞、
 * 隠す前の status）に当たらないものは触らない。別の理由の非公開を著作権の復元が解いてしまわないため。
 */
export function restoreStatements(db: D1Database, t: StatementTarget, restoredAt = new Date().toISOString()): D1PreparedStatement[] {
  const cond = restorable(t);
  switch (t.kind) {
    case "social_post":
      return [db.prepare(`UPDATE social_posts SET moderated_at = NULL, moderation_reason = NULL
        WHERE id = ? AND moderation_reason LIKE '${COPYRIGHT_REASON_PREFIX}%' AND ${cond.sql}`).bind(t.id, ...cond.args)];
    case "article":
      return [db.prepare(`UPDATE hub_user_articles SET moderated_at = NULL, moderation_reason = NULL
        WHERE id = ? AND moderation_reason LIKE '${COPYRIGHT_REASON_PREFIX}%' AND ${cond.sql}`).bind(t.id, ...cond.args)];
    case "social_image":
      return t.restore?.prevStatus === "published"
        ? [db.prepare(`UPDATE social_post_images SET status = 'published'
          WHERE id = ? AND status = 'rejected' AND ${cond.sql}`).bind(t.id, ...cond.args)]
        : [];
    case "video_embed":
      return t.restore?.prevStatus === "active"
        ? [db.prepare(`UPDATE external_videos SET status = 'active', updated_at = ?
          WHERE id = ? AND status = 'removed' AND ${cond.sql}`).bind(new Date().toISOString(), t.id, ...cond.args)]
        : [];
    case "video": {
      const wasPublished = t.restore?.prevStatus === "published" ? 1 : 0;
      const now = restoredAt;
      const freed = { sql: `${cond.sql} AND EXISTS (SELECT 1 FROM hub_videos WHERE id = ? AND hold_reason IS NULL AND state <> 'deleted')`, args: [...cond.args, t.id] };
      return [
        db.prepare(`UPDATE hub_videos SET hold_reason = NULL,
            state = CASE WHEN state = 'unpublished' AND ${wasPublished} = 1 THEN 'published' ELSE state END,
            unpublished_at = CASE WHEN state = 'unpublished' AND ${wasPublished} = 1 THEN NULL ELSE unpublished_at END,
            updated_at = ?
          WHERE id = ? AND hold_reason = 'copyright' AND state <> 'deleted' AND ${cond.sql}`).bind(now, t.id, ...cond.args),
        ...videoOutbox(db, t.id, "unsuspend", ["suspend"], now, freed),
      ];
    }
    case "hubpedia_revision": {
      const r = t.restore;
      if (r?.store === "enc") {
        const out = [db.prepare(`UPDATE encyclopedia_article_revisions SET copyright_hidden_at = NULL
          WHERE id = ? AND copyright_hidden_at IS NOT NULL AND ${cond.sql}`).bind(t.id, ...cond.args)];
        if (r.wasLive) {
          out.push(db.prepare(`UPDATE encyclopedia_articles SET current_revision_id = ?
            WHERE id = ? AND current_revision_id IS ? AND ${cond.sql}`).bind(t.id, r.containerId ?? "", r.prevPointer ?? null, ...cond.args));
        }
        return out;
      }
      const out = [db.prepare(`UPDATE hubpedia_wiki_revisions SET copyright_hidden_at = NULL
        WHERE id = ? AND copyright_hidden_at IS NOT NULL AND ${cond.sql}`).bind(t.id, ...cond.args)];
      if (r?.wasLive) {
        // 隠している間に新しい版が公開されていたら（指し先が付け替え後のままでなければ）上書きしない。
        out.push(db.prepare(`UPDATE hubpedia_wiki_articles SET published_revision_id = ?, updated_at = ?
          WHERE article_key = ? AND published_revision_id IS ? AND ${cond.sql}`).bind(t.id, new Date().toISOString(), r.containerId ?? "", r.prevPointer ?? null, ...cond.args));
      }
      return out;
    }
  }
}

/** 確定のとき、公開されていた本体の中身を消す文。行が 'final' のときだけ効く。 */
export function scrubStatements(db: D1Database, t: StatementTarget, now = new Date().toISOString()): D1PreparedStatement[] {
  const cond = finalNow(t.rowId);
  switch (t.kind) {
    case "social_post":
      return [
        db.prepare(`UPDATE social_posts SET body = ? WHERE id = ? AND ${cond.sql}`).bind(SCRUBBED_BODY, t.id, ...cond.args),
        db.prepare(`DELETE FROM social_post_revisions WHERE post_id = ? AND ${cond.sql}`).bind(t.id, ...cond.args),
        db.prepare(`UPDATE social_post_images SET status = 'rejected'
          WHERE post_id = ? AND status IN ('published','pending') AND ${cond.sql}`).bind(t.id, ...cond.args),
      ];
    case "article":
      return [
        db.prepare(`UPDATE hub_user_articles SET summary = '', body = ?, tags_json = '[]', thumbnail_url = NULL, status = 'withdrawn'
          WHERE id = ? AND ${cond.sql}`).bind(SCRUBBED_BODY, t.id, ...cond.args),
        db.prepare(`DELETE FROM hub_user_article_revisions WHERE article_id = ? AND ${cond.sql}`).bind(t.id, ...cond.args),
      ];
    case "social_image":
      // 行は 'rejected' のまま残す（同じ画像の再投稿を既存の検査が拒み続ける）。実体は R2 から消す。
      return [db.prepare(`UPDATE social_post_images SET status = 'rejected' WHERE id = ? AND status = 'published' AND ${cond.sql}`).bind(t.id, ...cond.args)];
    case "video_embed":
      return []; // 埋め込みは参照だけ。本体は外部にある。
    case "video":
      // Hub の行を削除済みにし、題名・説明・ゲートを消す。動画の Worker には削除を（SHA-256 の阻止つきで）伝える仕事を積む。
      return [
        db.prepare(`UPDATE hub_videos SET state = 'deleted', deleted_at = COALESCE(deleted_at, ?), unpublished_at = COALESCE(unpublished_at, ?),
            title = ?, description = '', hold_reason = 'copyright', updated_at = ?
          WHERE id = ? AND state <> 'deleted' AND ${cond.sql}`).bind(now, now, SCRUBBED_BODY, now, t.id, ...cond.args),
        // Comments first (same batch): with the gate row gone they would read as ungated comments of a taken-down video.
        db.prepare(`DELETE FROM social_posts WHERE reply_to_video_id = ? AND ${cond.sql}`).bind(t.id, ...cond.args),
        db.prepare(`DELETE FROM content_access_gates WHERE target_type = 'video' AND target_id = ? AND ${cond.sql}`).bind(t.id, ...cond.args),
        ...videoOutbox(db, t.id, "takedown", ["suspend", "unsuspend", "unpublish", "delete"], now, cond),
      ];
    case "hubpedia_revision":
      return t.restore?.store === "enc"
        ? [db.prepare(`UPDATE encyclopedia_article_revisions SET body_markdown = ?, summary = NULL WHERE id = ? AND ${cond.sql}`).bind(SCRUBBED_BODY, t.id, ...cond.args)]
        : [
          db.prepare(`UPDATE hubpedia_wiki_proposals SET body_markdown = ?, summary = ''
            WHERE id = (SELECT proposal_id FROM hubpedia_wiki_revisions WHERE id = ?) AND ${cond.sql}`).bind(SCRUBBED_BODY, t.id, ...cond.args),
          db.prepare(`UPDATE hubpedia_wiki_revisions SET body_markdown = ?, summary = '' WHERE id = ? AND ${cond.sql}`).bind(SCRUBBED_BODY, t.id, ...cond.args),
        ];
  }
}

/** 確定のあとに R2 から消す実体のキー（画像だけ）。確定の batch の前に読む。 */
export async function collectScrubObjectKeys(db: D1Database, kind: CopyrightTargetKind, id: string): Promise<string[]> {
  const rows = kind === "social_image"
    ? await db.prepare("SELECT object_key AS a, thumbnail_object_key AS b FROM social_post_images WHERE id = ? LIMIT 1").bind(id).all<Row>()
    : kind === "social_post"
      ? await db.prepare("SELECT object_key AS a, thumbnail_object_key AS b FROM social_post_images WHERE post_id = ? LIMIT 50").bind(id).all<Row>()
      : { results: [] as Row[] };
  return (rows.results ?? []).flatMap((row) => [text(row.a), text(row.b)].filter((key): key is string => key !== null));
}

/** 実体の削除。失敗しても確定そのものは戻さない（次の定期処理で再び消せるよう、呼び出し側が結果を見る）。 */
export async function deleteScrubObjects(media: R2Bucket | undefined, keys: readonly string[]): Promise<boolean> {
  if (!media || keys.length === 0) return true;
  try {
    await media.delete([...keys]);
    return true;
  } catch {
    return false;
  }
}

/** この対象を、いま著作権の事件が非公開にしているか。他の機能が自分で問い合わせるときの入口。 */
export async function isCopyrightNonPublic(db: D1Database, kind: CopyrightTargetKind, id: string): Promise<boolean> {
  const row = await db.prepare(`SELECT 1 AS found FROM copyright_case_targets
    WHERE target_kind = ? AND target_id = ? AND state IN ('hidden','final') LIMIT 1`).bind(kind, id).first();
  return Boolean(row);
}
