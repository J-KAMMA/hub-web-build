import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  deleteFederatedVideo,
  federationConfiguration,
  followFederatedActor,
  sendFederatedBlock,
  sendFederatedLike,
  syncFederatedVideo,
  undoFederatedFollow,
} from "@/lib/server/federation-gateway";
import { ensureShadowProfile } from "@/lib/server/federation-inbound";
import { getInstanceOrigin } from "@/lib/instance-origin";

/*
 * Hub の利用者の操作（外部の人のフォロー・外部の投稿へのいいね）を Federation へ送る（DESIGN.md 4.1）。
 * 外部への返信は、通常の投稿作成のあと publishFederatedPost が inReplyTo の元 URL つきで送る。
 */

export type RemoteFollowState = "pending" | "accepted" | "rejected";

export type RemoteFollowResult =
  | { ok: true; profileId: string; handle: string; displayName: string; host: string; state: RemoteFollowState }
  | { ok: false; error: string; status: number };

const ERROR_STATUS: Record<string, number> = {
  invalid_handle: 400,
  unsupported_host: 400,
  cannot_follow_local_actor: 400,
  domain_suspended: 403,
  webfinger_no_actor: 404,
  federation_not_enabled: 409,
};

async function recordFollow(
  database: D1Database,
  followerProfileId: string,
  followId: string,
  state: string,
  actor: Parameters<typeof ensureShadowProfile>[1],
): Promise<RemoteFollowResult> {
  const shadow = await ensureShadowProfile(database, actor);
  const normalized: RemoteFollowState = state === "accepted" ? "accepted" : state === "rejected" ? "rejected" : "pending";
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(
      `INSERT INTO remote_follows (follower_profile_id, remote_profile_id, federation_follow_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(follower_profile_id, remote_profile_id) DO UPDATE SET federation_follow_id = excluded.federation_follow_id,
         state = excluded.state, updated_at = excluded.updated_at`,
    ).bind(followerProfileId, shadow.profileId, followId, normalized, now, now),
    ...(normalized === "accepted"
      ? [database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)")
          .bind(followerProfileId, shadow.profileId, now)]
      : []),
  ]);
  return { ok: true, profileId: shadow.profileId, handle: shadow.handle, displayName: shadow.displayName, host: shadow.host, state: normalized };
}

/** `@user@host` を WebFinger で引いてフォローする。承認（Accept）が来るまで state は pending。 */
export async function followRemoteHandle(database: D1Database, viewerProfileId: string, handle: string): Promise<RemoteFollowResult> {
  if (!federationConfiguration()) return { ok: false, error: "federation_unavailable", status: 503 };
  const result = await followFederatedActor(viewerProfileId, { handle: handle.trim() });
  if (!result.ok) return { ok: false, error: result.error, status: ERROR_STATUS[result.error] ?? (result.status >= 500 ? 502 : result.status) };
  return recordFollow(database, viewerProfileId, result.body.followId, result.body.state, result.body.actor);
}

export type RemoteFollowItem = { profileId: string; /** プロフィールURL用（profiles.handle） */ profileHandle: string; handle: string; displayName: string; host: string; state: RemoteFollowState };

/** 自分が外部の人へ送ったフォローの一覧（承認待ち・承認済み・拒否）。新しい順。 */
export async function listRemoteFollows(database: D1Database, viewerProfileId: string, limit = 100): Promise<RemoteFollowItem[]> {
  const rows = await database.prepare(`SELECT p.id AS profile_id, p.handle AS profile_handle, r.handle, p.display_name, r.host, f.state
    FROM remote_follows f
    JOIN remote_actor_profiles r ON r.profile_id = f.remote_profile_id
    JOIN profiles p ON p.id = f.remote_profile_id
    WHERE f.follower_profile_id = ?
    ORDER BY f.updated_at DESC LIMIT ?`).bind(viewerProfileId, Math.min(Math.max(limit, 1), 200))
    .all<{ profile_id: string; profile_handle: string; handle: string; display_name: string; host: string; state: RemoteFollowState }>();
  return rows.results.map((row) => ({ profileId: row.profile_id, profileHandle: row.profile_handle, handle: row.handle, displayName: row.display_name, host: row.host, state: row.state }));
}

export async function remoteActorUrl(database: D1Database, profileId: string): Promise<string | null> {
  const row = await database.prepare("SELECT actor_url FROM remote_actor_profiles WHERE profile_id = ? LIMIT 1")
    .bind(profileId).first<{ actor_url: string }>();
  return row?.actor_url ?? null;
}

/** 既存の follow 切替（/api/follows/toggle、/api/client/follows）から、相手が影のプロフィールのときに呼ぶ。 */
export async function toggleRemoteFollow(
  database: D1Database,
  viewerProfileId: string,
  remoteProfileId: string,
  active: boolean | undefined,
) {
  const existing = await database.prepare(
    "SELECT federation_follow_id, state FROM remote_follows WHERE follower_profile_id = ? AND remote_profile_id = ?",
  ).bind(viewerProfileId, remoteProfileId).first<{ federation_follow_id: string; state: RemoteFollowState }>();
  const wasFollowing = existing?.state === "accepted" || existing?.state === "pending";
  const result = (state: RemoteFollowState | null) => ({
    followerProfileId: viewerProfileId,
    followedProfileId: remoteProfileId,
    following: state === "accepted",
    pending: state === "pending",
  });
  if (active === wasFollowing) return result(wasFollowing ? existing!.state : null);

  if (wasFollowing) {
    const undone = await undoFederatedFollow(existing!.federation_follow_id);
    if (!undone.ok && undone.status !== 404) throw new Error("外部のハブにつなげませんでした。時間をおいて試してください。");
    await database.batch([
      database.prepare("DELETE FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ?").bind(viewerProfileId, remoteProfileId),
      database.prepare("DELETE FROM remote_follows WHERE follower_profile_id = ? AND remote_profile_id = ?").bind(viewerProfileId, remoteProfileId),
    ]);
    return result(null);
  }

  const actorUrl = await remoteActorUrl(database, remoteProfileId);
  if (!actorUrl) throw new Error("プロフィールが見つかりません。");
  const followed = await followFederatedActor(viewerProfileId, { actorUrl });
  if (!followed.ok) {
    throw new Error(followed.error === "domain_suspended"
      ? "このハブとはつながらない設定になっています。"
      : followed.error === "federation_not_enabled"
        ? "外部のハブをフォローするには、設定で連合を有効にしてください。"
        : "外部のハブにつなげませんでした。時間をおいて試してください。");
  }
  const recorded = await recordFollow(database, viewerProfileId, followed.body.followId, followed.body.state, followed.body.actor);
  return result(recorded.ok ? recorded.state : null);
}

/**
 * 外部の人をブロックしたとき、こちらの Follow を取り消す（Undo Follow を送り、remote_follows を消す）。
 * ブロック自体は成立済み。取り消せなくても例外にしない（非表示は thread_user_controls で効いている）。
 */
export async function endRemoteFollowOnBlock(database: D1Database, viewerProfileId: string, targetProfileId: string): Promise<void> {
  try {
    const remote = await database.prepare("SELECT 1 AS remote FROM remote_actor_profiles WHERE profile_id = ? LIMIT 1")
      .bind(targetProfileId).first();
    if (!remote) return;
    await toggleRemoteFollow(database, viewerProfileId, targetProfileId, false);
  } catch {
    console.warn(JSON.stringify({ event: "federation_unfollow_on_block_failed" }));
  }
}

/**
 * 他のハブの人をブロック／解除したとき、相手のハブへ Block / Undo{Block} を送る。
 * ブロックはこのハブ内で成立済み。送れなくても例外にしない（配送の再試行は Federation の配送キューが行う）。
 * 連合を有効にしていない利用者の分は Federation が 409 で断る。その場合は何も送らず、黙って終える。
 */
export async function mirrorRemoteBlock(database: D1Database, viewerProfileId: string, targetProfileId: string, blocked: boolean): Promise<void> {
  if (!federationConfiguration()) return;
  try {
    const actorUrl = await remoteActorUrl(database, targetProfileId);
    if (!actorUrl) return;
    const sent = await sendFederatedBlock(viewerProfileId, actorUrl, blocked);
    if (!sent.ok && sent.status !== 409) console.warn(JSON.stringify({ event: "federation_block_failed", status: sent.status }));
  } catch {
    console.warn(JSON.stringify({ event: "federation_block_failed", status: "unavailable" }));
  }
}

/** 外部から取り込んだ投稿への Like / 取り消しを相手のハブへ送る。送れなくてもローカルの操作は成立させる。 */
export async function mirrorRemoteLike(
  database: D1Database,
  input: { profileId: string; targetId: string; liked: boolean },
): Promise<void> {
  if (!federationConfiguration()) return;
  try {
    const row = await database.prepare(
      "SELECT origin_object_id FROM social_posts WHERE id = ? AND origin = 'remote' LIMIT 1",
    ).bind(input.targetId).first<{ origin_object_id: string | null }>();
    if (!row?.origin_object_id) return;
    const sent = await sendFederatedLike(input.profileId, row.origin_object_id, input.liked);
    if (!sent.ok) console.warn(JSON.stringify({ event: "federation_like_failed", status: sent.status }));
  } catch {
    console.warn(JSON.stringify({ event: "federation_like_failed", status: "unavailable" }));
  }
}

/*
 * Hub 自作動画の連合（docs/hub-video/PLAN.md 4.3）。公開・公開範囲が public・年齢制限なし・ゲートなし・
 * 著作権の保留なし・目録で隠されていない動画だけを ActivityPub `Video` として配る。
 * それ以外（非公開・限定・ゲート付き・保留・削除・隠し）は Delete を送る。送るのは題名・説明・長さ・
 * 見る頁の URL・ライセンスだけで、HLS の URL・保管先の鍵・再生札・サムネイルの保管先は入れない
 * （Hub が公開で配るサムネイルの URL はまだ無いので省く）。Federation 側は状態を持たず、
 * PUT は初回が Create・以降が Update、DELETE は無ければ 404 で何も起きない。決して throw しない。
 */
export type HubVideoFederationDeps = {
  sync: (videoId: string, body: object) => Promise<void>;
  remove: (videoId: string) => Promise<void>;
  /**
   * Public thumbnail control at the Video Worker (PLAN 3.3): `true` marks the thumbnail public and
   * returns its revision (null when it has none), `false` withdraws it. Best effort, never throws.
   */
  thumbnail?: (assetId: string, enable: boolean) => Promise<number | null>;
};

type FederableVideoRow = {
  id: string;
  asset_id: string;
  profile_id: string;
  title: string;
  description: string;
  duration_ms: number | null;
  license: string;
  published_at: string | null;
};

const defaultVideoDeps: HubVideoFederationDeps = { sync: syncFederatedVideo, remove: deleteFederatedVideo };

export async function federateHubVideo(
  database: D1Database,
  videoId: string,
  deps: HubVideoFederationDeps = defaultVideoDeps,
  thumbnail: HubVideoFederationDeps["thumbnail"] = deps.thumbnail,
): Promise<"sent" | "deleted" | "skipped"> {
  try {
    if (!federationConfiguration() && deps === defaultVideoDeps && !thumbnail) return "skipped";
    const row = await database
      .prepare(`SELECT v.id, v.asset_id, v.profile_id, v.title, v.description, v.duration_ms, v.license, v.published_at
        FROM hub_videos v
        WHERE v.id = ? AND v.state = 'published' AND v.hold_reason IS NULL
          AND v.visibility = 'public' AND v.age_restricted = 0
          AND v.safety_hold = 0 AND v.review_status IN ('none', 'approved')
          AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'video' AND g.target_id = v.id)
          AND NOT EXISTS (SELECT 1 FROM external_videos e WHERE e.id = v.id AND e.status <> 'active')`)
      .bind(videoId)
      .first<FederableVideoRow>();
    if (!row) {
      // No longer public: withdraw the thumbnail first, then the object.
      if (thumbnail) {
        const asset = await database.prepare("SELECT asset_id FROM hub_videos WHERE id = ?").bind(videoId).first<{ asset_id: string }>();
        if (asset) await thumbnail(asset.asset_id, false).catch(() => null);
      }
      if (federationConfiguration() || deps !== defaultVideoDeps) await deps.remove(videoId);
      return "deleted";
    }
    if (!federationConfiguration() && deps === defaultVideoDeps) {
      await thumbnail?.(row.asset_id, true).catch(() => null);
      return "skipped";
    }
    // The public thumbnail URL names the Video Worker's revision, so a changed video gets a new URL.
    const revision = thumbnail ? await thumbnail(row.asset_id, true).catch(() => null) : null;
    await deps.sync(row.id, {
      ...(revision === null || revision === undefined ? {} : {
        thumbnailUrl: `${getInstanceOrigin()}/video/api/v1/thumb/${row.asset_id}/${revision}`,
      }),
      profileId: row.profile_id,
      visibility: "public",
      title: row.title,
      description: row.description,
      durationMs: row.duration_ms,
      watchUrl: `${getInstanceOrigin()}/v2/videos/${row.id}`,
      license: row.license,
      publishedAt: row.published_at,
    });
    return "sent";
  } catch {
    console.warn(JSON.stringify({ event: "hub_video_federation_failed" }));
    return "skipped";
  }
}
