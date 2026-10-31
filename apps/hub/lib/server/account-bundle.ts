import "server-only";

import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";
import {
  BUNDLE_MAX_POSTS,
  BUNDLE_PROTOCOL,
  BUNDLE_VERSION,
  findForbiddenContent,
  verifyBundle,
  verifyDocument,
  type AccountBundle,
} from "@/lib/portable-identity";
import { followFederatedActor } from "@/lib/server/federation-gateway";
import { identityGateway, type IdentityGateway } from "@/lib/server/federation-identity-gateway";
import { ensureShadowProfile } from "@/lib/server/federation-inbound";
import { getHubMedia } from "@/lib/server/hub-d1";
import { notGatedSql } from "@/lib/server/gated-exits";
import {
  createExportMedia,
  existingImageHashes,
  importAvatar,
  MAX_IMPORT_IMAGES,
  prepareImportImage,
  type BundleMediaRef,
  type ImportMediaDeps,
} from "@/lib/server/portable-media";
import { MAX_POST_IMAGES } from "@/lib/server/social-post-images";

/*
 * hub.account.bundle v2 の書き出しと取り込み、根鍵の公開、移転（DESIGN.md 3）。
 *
 * - Hub は秘密鍵を持たない。署名は利用者の端末（ブラウザ・Desktop）でする。ここは下書きを作り、署名済みの束を検査して取り込む。
 * - 束に Hub ローカル ID・Account subject・ウォレット・メール・DM・他サービスのデータを入れない。見つかれば失敗させる。
 * - 画像（アバター・投稿の添付）は、この Hub の公開 URL + SHA-256 + MIME + サイズの参照として載せる（portable-media.ts）。R2 の鍵は載せない。
 *   取り込みは既存の画像検査に通し、通らない1枚だけを捨てて残りを続ける。捨てた数は summary.media.skipped に出す。
 *   Hub にはバナー画像の機能がないので、束にも banner は載せない（来ても取り込まない）。
 * - 取り込んだ投稿は元の日時のまま「移転前の投稿」として置く。外部へは配り直さない（通知も作らない）。
 */

export const REDIRECT_MONTHS = 12;
const MAX_IMPORT_POSTS = 5_000;
const MAX_IMPORTED_TOTAL = 20_000;
const MAX_REFOLLOW = 200;
const POST_BATCH = 50;

type Result<T> = ({ ok: true } & T) | { ok: false; status: number; error: string; detail?: string };

function fail(status: number, error: string, detail?: string): { ok: false; status: number; error: string; detail?: string } {
  return { ok: false, status, error, ...(detail ? { detail } : {}) };
}

/* ---------------------------------------------------------------- 状態 */

export type IdentityState = {
  actorUrl: string | null;
  rootKey: string | null;
  alsoKnownAs: string[];
  movedTo: string | null;
  moves: Array<{ newActor: string; movedAt: string; redirectUntil: string }>;
  importHints: { oldActor: string; followers: number; movedAt: string | null } | null;
};

export async function getIdentityState(database: D1Database, profile: Profile, gateway: IdentityGateway = identityGateway): Promise<IdentityState> {
  const [remote, moves, hints, local] = await Promise.all([
    gateway.getIdentity(profile.id),
    database.prepare("SELECT new_actor, moved_at, redirect_until FROM hub_account_moves WHERE profile_id = ? ORDER BY moved_at DESC LIMIT 5")
      .bind(profile.id).all<{ new_actor: string; moved_at: string; redirect_until: string }>(),
    database.prepare("SELECT old_actor, followers_json, moved_at FROM hub_import_move_hints WHERE profile_id = ?")
      .bind(profile.id).first<{ old_actor: string; followers_json: string; moved_at: string | null }>(),
    database.prepare("SELECT root_key_did FROM hub_portable_identities WHERE profile_id = ?").bind(profile.id).first<{ root_key_did: string }>(),
  ]);
  const identity = remote.ok ? remote.body : null;
  let followerCount = 0;
  try { followerCount = (JSON.parse(hints?.followers_json ?? "[]") as unknown[]).length; } catch { /* 壊れた手がかりは 0 件 */ }
  return {
    actorUrl: identity?.actorUrl ?? null,
    rootKey: identity?.rootKey ?? local?.root_key_did ?? null,
    alsoKnownAs: identity?.alsoKnownAs ?? [],
    movedTo: identity?.movedTo ?? null,
    moves: moves.results.map((row) => ({ newActor: row.new_actor, movedAt: row.moved_at, redirectUntil: row.redirect_until })),
    importHints: hints ? { oldActor: hints.old_actor, followers: followerCount, movedAt: hints.moved_at } : null,
  };
}

/* ---------------------------------------------------------------- 根鍵の公開（公開鍵だけ） */

export async function registerRootKey(
  database: D1Database,
  profile: Profile,
  statement: unknown,
  gateway: IdentityGateway = identityGateway,
): Promise<Result<{ rootKey: string; actor: string }>> {
  if (!statement || typeof statement !== "object" || Array.isArray(statement)) return fail(400, "invalid_registration");
  // 秘密鍵らしい項目が混ざっていたら、保存も転送もせずに拒む。
  if (findForbiddenContent(statement)) return fail(400, "invalid_registration");
  if (JSON.stringify(statement).includes("\"d\":") || /privateKey|pkcs8/i.test(JSON.stringify(statement))) return fail(400, "private_key_refused");
  const checked = await verifyDocument(statement);
  if (!checked.ok) return fail(400, "registration_signature_invalid");
  const sent = await gateway.registerRootKey(profile.id, statement);
  if (!sent.ok) return fail(sent.status === 503 ? 503 : sent.status, sent.error);
  await database.prepare(
    `INSERT INTO hub_portable_identities (profile_id, root_key_did, registered_at) VALUES (?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET root_key_did = excluded.root_key_did, registered_at = excluded.registered_at`,
  ).bind(profile.id, sent.body.rootKey, sent.body.registeredAt).run();
  return { ok: true, rootKey: sent.body.rootKey, actor: sent.body.actor };
}

export async function removeRootKey(database: D1Database, profile: Profile, gateway: IdentityGateway = identityGateway): Promise<Result<object>> {
  const sent = await gateway.removeRootKey(profile.id);
  if (!sent.ok) return fail(sent.status, sent.error);
  await database.prepare("DELETE FROM hub_portable_identities WHERE profile_id = ?").bind(profile.id).run();
  return { ok: true };
}

/* ---------------------------------------------------------------- 書き出しの下書き（署名は端末で） */

type PostRow = {
  id: string;
  body: string;
  audience: string;
  created_at: string;
  imported_original_id: string | null;
  parent_id: string | null;
  parent_origin: string | null;
  parent_object: string | null;
  parent_imported_original: string | null;
};

export async function buildBundleDraft(
  database: D1Database,
  profile: Profile,
  gateway: IdentityGateway = identityGateway,
  deps: { bucket?: R2Bucket | null } = {},
): Promise<Result<{ draft: Omit<AccountBundle, "bundleProof">; /** 鍵付きのため移していない投稿の件数（本文は入れない） */ gatedSkipped: number }>> {
  const parts = await gateway.portableExport(profile.id);
  if (!parts.ok) return fail(parts.status === 404 ? 409 : parts.status, parts.status === 404 ? "federation_not_enabled" : parts.error);
  const origin = new URL(parts.body.actor).origin;
  const [posts, lists, muted, gatedCount] = await Promise.all([
    database.prepare(
      `SELECT s.id, s.body, s.audience, s.created_at, ip.original_id AS imported_original_id,
              parent.id AS parent_id, parent.origin AS parent_origin, parent.origin_object_id AS parent_object,
              pip.original_id AS parent_imported_original
       FROM social_posts s
       LEFT JOIN hub_imported_posts ip ON ip.post_id = s.id
       LEFT JOIN social_posts parent ON parent.id = s.reply_to_post_id
       LEFT JOIN hub_imported_posts pip ON pip.post_id = parent.id
       WHERE s.author_profile_id = ? AND s.identity_mode = 'account' AND s.origin = 'local'
         AND s.moderated_at IS NULL AND length(s.body) > 0
         AND ${notGatedSql("post", "s.id")}
       ORDER BY s.created_at LIMIT ?`,
    ).bind(profile.id, BUNDLE_MAX_POSTS).all<PostRow>(),
    database.prepare("SELECT name, description FROM user_lists WHERE owner_profile_id = ? ORDER BY sort_order, created_at LIMIT 100")
      .bind(profile.id).all<{ name: string; description: string }>(),
    database.prepare("SELECT term FROM profile_muted_terms WHERE profile_id = ? ORDER BY term LIMIT 500")
      .bind(profile.id).all<{ term: string }>(),
    database.prepare(
      `SELECT count(*) AS total FROM social_posts s
       WHERE s.author_profile_id = ? AND s.identity_mode = 'account' AND s.origin = 'local'
         AND s.moderated_at IS NULL AND length(s.body) > 0
         AND NOT (${notGatedSql("post", "s.id")})`,
    ).bind(profile.id).first<{ total: number }>(),
  ]);
  const seen = new Set<string>();
  const bundlePosts: AccountBundle["posts"] = [];
  const hubIdByOriginal = new Map<string, string>();
  for (const row of posts.results) {
    const originalId = row.imported_original_id ?? `${origin}/objects/${encodeURIComponent(row.id)}`;
    if (seen.has(originalId)) continue;
    seen.add(originalId);
    const inReplyTo = !row.parent_id ? null
      : row.parent_origin === "remote" ? row.parent_object
        : row.parent_imported_original ?? `${origin}/objects/${encodeURIComponent(row.parent_id)}`;
    bundlePosts.push({ originalId, published: row.created_at, content: row.body, inReplyTo, attachments: [], audience: row.audience === "public" ? "public" : "followers" });
    hubIdByOriginal.set(originalId, row.id);
  }
  // 画像。取り出せなかったものは黙って入れない（書き出しを止めない）。
  let avatar: BundleMediaRef | null = null;
  if (deps.bucket) {
    try {
      const media = await createExportMedia(database, deps.bucket, {
        profileId: profile.id, avatarUrl: profile.avatarUrl, postIds: [...hubIdByOriginal.values()], origin,
      });
      avatar = media.avatar;
      for (const post of bundlePosts) post.attachments = media.attachmentsByPost.get(hubIdByOriginal.get(post.originalId) ?? "") ?? [];
    } catch { avatar = null; }
  }
  const draft: Omit<AccountBundle, "bundleProof"> = {
    protocol: BUNDLE_PROTOCOL,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    subject: { actor: parts.body.actor, rootKey: parts.body.rootKey },
    profile: { handle: profile.handle, displayName: profile.displayName, summary: (profile.bio ?? "").slice(0, 5000), avatar },
    following: parts.body.following.map((entry) => ({ actor: entry.actor, since: entry.since ?? null })),
    followers: parts.body.followers.map((entry) => ({ actor: entry.actor, inbox: entry.inbox ?? null })),
    posts: bundlePosts,
    communities: [],
    // ブックマークは Hub ローカルの ID を指すので入れない。リストは名前と説明だけ。
    settings: { lists: lists.results.map((row) => ({ name: row.name, description: row.description })), bookmarks: [], mutedTerms: muted.results.map((row) => row.term) },
    nodeEvents: [],
  };
  const forbidden = findForbiddenContent(draft);
  if (forbidden) return fail(500, "export_contains_forbidden_data", forbidden);
  return { ok: true, draft, gatedSkipped: Number(gatedCount?.total ?? 0) };
}

/* ---------------------------------------------------------------- 取り込み */

export type RefollowFn = (profileId: string, actorUrl: string) => Promise<boolean>;

/** 束のフォロー一覧の相手へ Follow を送り直す。承認（Accept）が来るまで pending。 */
export function defaultRefollow(database: D1Database): RefollowFn {
  return async (profileId, actorUrl) => {
    const followed = await followFederatedActor(profileId, { actorUrl });
    if (!followed.ok) return false;
    const shadow = await ensureShadowProfile(database, followed.body.actor);
    const state = followed.body.state === "accepted" ? "accepted" : followed.body.state === "rejected" ? "rejected" : "pending";
    const now = new Date().toISOString();
    await database.batch([
      database.prepare(
        `INSERT INTO remote_follows (follower_profile_id, remote_profile_id, federation_follow_id, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(follower_profile_id, remote_profile_id) DO UPDATE SET federation_follow_id = excluded.federation_follow_id,
           state = excluded.state, updated_at = excluded.updated_at`,
      ).bind(profileId, shadow.profileId, followed.body.followId, state, now, now),
      ...(state === "accepted"
        ? [database.prepare("INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at) VALUES (?, ?, ?)").bind(profileId, shadow.profileId, now)]
        : []),
    ]);
    return true;
  };
}

/** 束の添付を「画像の参照」として読める形に揃える。形が違うものはそのまま渡し、後段の検査で1件ずつ捨てる。 */
function attachmentRefs(value: unknown): Array<BundleMediaRef> {
  return Array.isArray(value) ? (value as BundleMediaRef[]) : [];
}

function defaultMediaDeps(): ImportMediaDeps | null {
  try { return { bucket: getHubMedia() }; } catch { return null; }
}

export type ImportSummary = {
  imported: number;
  duplicates: number;
  skipped: number;
  provenance: "verified" | "unverified";
  rootKey: string | null;
  oldActor: string;
  newActor: string | null;
  followersHinted: number;
  following: { attempted: number; started: number };
  federationRegistered: boolean;
  aliasSet: boolean;
  /** 画像の取り込み結果。skipped は検査に通らず捨てた数（取得失敗・不一致・サイズ超過・メタデータ付きなど）。 */
  media: { imported: number; skipped: number; avatar: "imported" | "kept_existing" | "skipped" | "none" };
};

export async function importAccountBundle(
  database: D1Database,
  profile: Profile,
  input: unknown,
  deps: { gateway?: IdentityGateway; refollow?: RefollowFn; refollowFollowing?: boolean; media?: ImportMediaDeps | null } = {},
): Promise<Result<{ summary: ImportSummary }>> {
  const gateway = deps.gateway ?? identityGateway;
  const refollow = deps.refollow ?? defaultRefollow(database);
  const media = deps.media !== undefined ? deps.media : defaultMediaDeps();
  // 1か所でも不正なら束全体を拒む。何も書かない。
  const check = await verifyBundle(input);
  if (!check.ok) return fail(400, check.error, check.detail);
  const bundle = input as AccountBundle;
  if (bundle.posts.length > MAX_IMPORT_POSTS) return fail(413, "bundle_too_large");

  const identity = await gateway.getIdentity(profile.id);
  if (!identity.ok) return fail(identity.status === 404 ? 409 : identity.status, identity.error);
  if (!identity.body.actorUrl || identity.body.enabled === false) return fail(409, "federation_not_enabled");
  const newActor = identity.body.actorUrl;
  if (bundle.subject.actor === newActor) return fail(409, "bundle_is_from_this_actor");

  const existing = await database.prepare("SELECT COUNT(*) AS n FROM hub_imported_posts WHERE profile_id = ?").bind(profile.id).first<{ n: number }>();
  if ((existing?.n ?? 0) + bundle.posts.length > MAX_IMPORTED_TOTAL) return fail(413, "import_limit_reached");

  const provenance: "verified" | "unverified" = check.signed ? "verified" : "unverified";
  const now = new Date().toISOString();
  const sorted = [...bundle.posts].sort((left, right) => Date.parse(left.published) - Date.parse(right.published));
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  let mediaImported = 0;
  let mediaSkipped = 0;
  const seenHashes = new Set<string>();
  const toRegister: Array<{ hubPostId: string; originalId: string; published: string; text: string; inReplyTo: string | null; proof: unknown }> = [];

  for (let start = 0; start < sorted.length; start += POST_BATCH) {
    const chunk = sorted.slice(start, start + POST_BATCH);
    const known = await database.prepare(
      `SELECT original_id FROM hub_imported_posts WHERE profile_id = ? AND original_id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(profile.id, ...chunk.map((post) => post.originalId)).all<{ original_id: string }>();
    const have = new Set(known.results.map((row) => row.original_id));
    const statements = [];
    const written: string[] = [];
    const known_hashes = media
      ? await existingImageHashes(database, profile.id, chunk.flatMap((post) => attachmentRefs(post.attachments).map((ref) => ref.sha256)).filter((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)))
      : new Set<string>();
    for (const hash of known_hashes) seenHashes.add(hash);
    for (const post of chunk) {
      if (have.has(post.originalId)) { duplicates += 1; continue; }
      const body = post.content.replace(/\r\n/g, "\n").trim();
      if (!body || body.length > 20_000) { skipped += 1; continue; }
      // 未来の日時は付けない（並び順を乗っ取らせない）。
      const published = new Date(Math.min(Date.parse(post.published), Date.parse(now))).toISOString();
      // An import never widens who can read a post: anything not explicitly `public` stays followers-only.
      const audience = post.audience === "public" ? "public" : "followers";
      const postId = crypto.randomUUID();
      statements.push(
        database.prepare(
          `INSERT INTO social_posts (id, author_profile_id, display_name, handle, identity_mode, body, created_at, audience)
           VALUES (?, ?, ?, ?, 'account', ?, ?, ?)`,
        ).bind(postId, profile.id, profile.displayName.slice(0, 80), profile.handle, body, published, audience),
        database.prepare(
          `INSERT INTO hub_imported_posts (post_id, profile_id, original_id, original_published_at, in_reply_to_url, proof_json, provenance, source_actor, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(postId, profile.id, post.originalId, published, post.inReplyTo, post.proof ? JSON.stringify(post.proof).slice(0, 4000) : null, provenance, bundle.subject.actor, now),
      );
      const refs = attachmentRefs(post.attachments);
      for (const [index, ref] of refs.entries()) {
        if (!media || index >= MAX_POST_IMAGES || mediaImported + mediaSkipped >= MAX_IMPORT_IMAGES) { mediaSkipped += 1; continue; }
        let prepared: Awaited<ReturnType<typeof prepareImportImage>> = null;
        try { prepared = await prepareImportImage(profile.id, postId, ref, { ...media, seenHashes, publishedAt: published }); } catch { prepared = null; }
        if (!prepared) { mediaSkipped += 1; continue; }
        written.push(...prepared.keys);
        statements.push(database.prepare(prepared.insert[0]).bind(...prepared.insert[1]), ...prepared.storage(database));
        mediaImported += 1;
      }
      // Followers-only posts are never handed to the Federation Worker for delivery.
      if (audience === "public") toRegister.push({ hubPostId: postId, originalId: post.originalId, published, text: body, inReplyTo: post.inReplyTo, proof: post.proof ?? null });
      imported += 1;
    }
    if (statements.length) {
      try { await database.batch(statements); } catch (error) {
        // 投稿の書き込みが落ちたら、置いた画像も消す（孤児を残さない）。
        if (media && written.length) await media.bucket.delete(written).catch(() => undefined);
        throw error;
      }
    }
  }

  let avatarResult: ImportSummary["media"]["avatar"] = "none";
  if (bundle.profile.avatar != null) {
    avatarResult = media ? await importAvatar(database, profile.id, bundle.profile.avatar, media).catch(() => "skipped" as const) : "skipped";
    if (avatarResult === "imported") mediaImported += 1;
    else if (avatarResult === "skipped") mediaSkipped += 1;
  }

  let federationRegistered = true;
  for (let start = 0; start < toRegister.length; start += 500) {
    const sent = await gateway.registerImportedPosts(profile.id, toRegister.slice(start, start + 500));
    if (!sent.ok) { federationRegistered = false; break; }
  }

  // 新しい家の actor が旧 actor を名乗る（alsoKnownAs）。移転宣言を受け取った相手が確かめる根拠になる。
  const aliases = [...new Set([...(identity.body.alsoKnownAs ?? []), bundle.subject.actor])].slice(0, 8);
  const aliasSet = (await gateway.setAlsoKnownAs(profile.id, aliases)).ok;

  const followers = bundle.followers.slice(0, 20_000).map((entry) => ({ actor: entry.actor, inbox: entry.inbox }));
  await database.prepare(
    `INSERT INTO hub_import_move_hints (profile_id, old_actor, root_key_did, followers_json, created_at, moved_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(profile_id) DO UPDATE SET old_actor = excluded.old_actor, root_key_did = excluded.root_key_did,
       followers_json = excluded.followers_json, created_at = excluded.created_at, moved_at = NULL`,
  ).bind(profile.id, bundle.subject.actor, check.rootKey, JSON.stringify(followers), now).run();

  let attempted = 0;
  let started = 0;
  if (deps.refollowFollowing !== false) {
    for (const entry of bundle.following.slice(0, MAX_REFOLLOW)) {
      attempted += 1;
      try { if (await refollow(profile.id, entry.actor)) started += 1; } catch { /* 1件の失敗で止めない */ }
    }
  }

  return {
    ok: true,
    summary: {
      imported, duplicates, skipped, provenance,
      rootKey: check.rootKey, oldActor: bundle.subject.actor, newActor,
      followersHinted: followers.length, following: { attempted, started }, federationRegistered, aliasSet,
      media: { imported: mediaImported, skipped: mediaSkipped, avatar: avatarResult },
    },
  };
}

/* ---------------------------------------------------------------- 自己署名の移転（旧 Hub が消えた後） */

export async function sendSelfSignedMove(
  database: D1Database,
  profile: Profile,
  move: unknown,
  gateway: IdentityGateway = identityGateway,
): Promise<Result<{ delivered: number }>> {
  if (!move || typeof move !== "object" || Array.isArray(move)) return fail(400, "invalid_move_statement");
  const hints = await database.prepare("SELECT old_actor, followers_json FROM hub_import_move_hints WHERE profile_id = ?")
    .bind(profile.id).first<{ old_actor: string; followers_json: string }>();
  if (!hints) return fail(409, "no_import_hints");
  if ((move as Record<string, unknown>).object !== hints.old_actor) return fail(400, "move_does_not_match_import");
  let followers: Array<{ actor: string; inbox: string | null }> = [];
  try { followers = JSON.parse(hints.followers_json); } catch { /* 手がかりが壊れていれば 0 件 */ }
  const sent = await gateway.selfMove(profile.id, move as object, followers);
  if (!sent.ok) return fail(sent.status, sent.error);
  await database.prepare("UPDATE hub_import_move_hints SET moved_at = ? WHERE profile_id = ?").bind(new Date().toISOString(), profile.id).run();
  return { ok: true, delivered: sent.body.delivered };
}

/* ---------------------------------------------------------------- 協力的な移転（この Hub から出る側） */

export type RefollowLocalFollowers = (followerProfileId: string, targetActor: string) => Promise<boolean>;

export async function moveAccountOut(
  database: D1Database,
  profile: Profile,
  input: { target: string; move?: object },
  deps: { gateway?: IdentityGateway; localRefollow?: RefollowLocalFollowers } = {},
): Promise<Result<{ movedTo: string; notified: number; redirectUntil: string; localFollowersMoved: number }>> {
  const gateway = deps.gateway ?? identityGateway;
  const identity = await gateway.getIdentity(profile.id);
  if (!identity.ok || !identity.body.actorUrl) return fail(409, "federation_not_enabled");
  const sent = await gateway.moveOut(profile.id, input.target, input.move);
  if (!sent.ok) return fail(sent.status, sent.error);

  const now = new Date(sent.body.movedAt);
  const until = new Date(now);
  until.setUTCMonth(until.getUTCMonth() + REDIRECT_MONTHS);
  await database.prepare(
    `INSERT INTO hub_account_moves (id, profile_id, old_actor, new_actor, new_profile_url, mode, moved_at, redirect_until)
     VALUES (?, ?, ?, ?, ?, 'cooperative', ?, ?)`,
  ).bind(
    crypto.randomUUID(), profile.id, identity.body.actorUrl, sent.body.movedTo,
    (sent.body as { targetProfileUrl?: string | null }).targetProfileUrl ?? null, now.toISOString(), until.toISOString(),
  ).run();

  // この Hub の中でフォローしていた人は、連合を有効にしている人に限り新しい家へ付け替える（Mastodon と同じ挙動）。
  let localFollowersMoved = 0;
  if (deps.localRefollow) {
    const followers = await database.prepare(
      `SELECT f.follower_profile_id AS id FROM follows f JOIN profiles p ON p.id = f.follower_profile_id
       WHERE f.followed_profile_id = ? AND p.kind = 'local' LIMIT ?`,
    ).bind(profile.id, MAX_REFOLLOW * 2).all<{ id: string }>();
    for (const follower of followers.results) {
      try { if (await deps.localRefollow(follower.id, sent.body.movedTo)) localFollowersMoved += 1; } catch { /* 続ける */ }
    }
  }
  return { ok: true, movedTo: sent.body.movedTo, notified: sent.body.notified, redirectUntil: until.toISOString(), localFollowersMoved };
}

/** 移転後 12 か月の間、プロフィールページが送る先。期限が過ぎれば null。 */
export async function getActiveAccountMove(database: D1Database, profileId: string): Promise<{ newActor: string; newProfileUrl: string | null } | null> {
  const row = await database.prepare(
    "SELECT new_actor, new_profile_url FROM hub_account_moves WHERE profile_id = ? AND redirect_until > ? ORDER BY moved_at DESC LIMIT 1",
  ).bind(profileId, new Date().toISOString()).first<{ new_actor: string; new_profile_url: string | null }>();
  return row ? { newActor: row.new_actor, newProfileUrl: row.new_profile_url } : null;
}
