import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { inferContentTagSignals } from "@/lib/content-tagging";
import { replaceD1ContentTags } from "@/lib/server/d1-content-tags";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";

type OwnedPostRow = {
  id: string;
  author_profile_id: string | null;
  body: string;
  moderated_at: string | null;
  moderation_reason: string | null;
  audience: "public" | "followers";
  has_images: number;
};

export class SocialPostActionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "SocialPostActionError";
  }
}

async function findPost(
  database: D1Database,
  postId: string,
) {
  return database.prepare(`SELECT post.id, post.author_profile_id, post.body,
      post.moderated_at, post.moderation_reason, post.audience,
      EXISTS (
        SELECT 1 FROM social_post_images image
        WHERE image.post_id = post.id
          AND image.status = 'published'
      ) AS has_images
    FROM social_posts post WHERE post.id = ? LIMIT 1`)
    .bind(postId)
    .first<OwnedPostRow>();
}

async function refreshPostTags(
  database: D1Database,
  post: OwnedPostRow,
  body: string,
) {
  await replaceD1ContentTags(
    database,
    "social_post",
    post.id,
    inferContentTagSignals({
      target: "social_post",
      body,
      destination: post.audience,
      attachmentTypes: post.has_images ? ["画像"] : [],
    }),
  );
}

async function requireOwnedPost(
  database: D1Database,
  postId: string,
  profileId: string,
) {
  const post = await findPost(database, postId);
  if (!post) throw new SocialPostActionError("ポストが見つかりません。", 404);
  if (post.author_profile_id !== profileId) {
    throw new SocialPostActionError("自分のポストだけ変更できます。", 403);
  }
  if (post.moderated_at) {
    throw new SocialPostActionError("非表示のポストは変更できません。", 409);
  }
  return post;
}

export async function editD1SocialPost(
  database: D1Database,
  postId: string,
  profileId: string,
  body: string,
) {
  const normalizedBody = body.trim();
  if (!normalizedBody || normalizedBody.length > HUB_SOCIAL_POST_MAX_CHARACTERS) {
    throw new SocialPostActionError(
      `本文は1文字以上${HUB_SOCIAL_POST_MAX_CHARACTERS}文字以内で入力してください。`,
      400,
    );
  }
  const post = await requireOwnedPost(database, postId, profileId);
  if (post.body === normalizedBody) {
    await refreshPostTags(database, post, normalizedBody);
    return { id: post.id, body: post.body, edited: false };
  }

  const updated = await database.prepare(`UPDATE social_posts SET body = ?
    WHERE id = ? AND author_profile_id = ? AND body = ?
      AND moderated_at IS NULL`)
    .bind(normalizedBody, postId, profileId, post.body)
    .run();
  if (!updated.meta.changes) {
    const current = await requireOwnedPost(database, postId, profileId);
    if (current.body === normalizedBody) {
      return { id: current.id, body: current.body, edited: false };
    }
    throw new SocialPostActionError(
      "別の編集が先に保存されました。内容を確認してもう一度編集してください。",
      409,
    );
  }
  await refreshPostTags(database, post, normalizedBody);
  return { id: post.id, body: normalizedBody, edited: true };
}

export async function deleteD1SocialPost(
  database: D1Database,
  postId: string,
  profileId: string,
) {
  const post = await findPost(database, postId);
  if (!post) throw new SocialPostActionError("ポストが見つかりません。", 404);
  if (post.author_profile_id !== profileId) {
    throw new SocialPostActionError("自分のポストだけ削除できます。", 403);
  }
  if (post.moderated_at) {
    if (post.moderation_reason === "user_deleted") {
      return {
        id: post.id,
        deletedAt: post.moderated_at,
        alreadyDeleted: true,
      };
    }
    throw new SocialPostActionError(
      "運営により非表示になったポストは削除できません。",
      409,
    );
  }

  const deletedAt = new Date().toISOString();
  const [deleted] = await database.batch([
    database.prepare(`UPDATE social_posts
      SET moderated_at = ?, moderation_reason = 'user_deleted'
      WHERE id = ? AND author_profile_id = ? AND moderated_at IS NULL`)
      .bind(deletedAt, post.id, profileId),
    database.prepare(`UPDATE social_post_images
      SET status = 'deleted'
      WHERE post_id = ? AND owner_profile_id = ?
        AND status IN ('pending', 'published')`)
      .bind(post.id, profileId),
    database.prepare(`DELETE FROM reactions
      WHERE target_type = 'social_post' AND target_id = ?`)
      .bind(post.id),
    database.prepare(`DELETE FROM bookmarks
      WHERE target_type = 'social_post' AND target_id = ?`)
      .bind(post.id),
    database.prepare("DELETE FROM post_pushes WHERE post_id = ?")
      .bind(post.id),
    database.prepare("DELETE FROM profile_pinned_posts WHERE post_id = ?")
      .bind(post.id),
    database.prepare(`DELETE FROM content_tag_links
      WHERE target_type = 'social_post' AND target_id = ?`)
      .bind(post.id),
    database.prepare(`DELETE FROM notifications
      WHERE target_type = 'social_post' AND target_id = ?`)
      .bind(post.id),
  ]);
  if (deleted.meta.changes) {
    return { id: post.id, deletedAt, alreadyDeleted: false };
  }

  const current = await findPost(database, postId);
  if (
    current?.author_profile_id === profileId &&
    current.moderated_at &&
    current.moderation_reason === "user_deleted"
  ) {
    return {
      id: current.id,
      deletedAt: current.moderated_at,
      alreadyDeleted: true,
    };
  }
  throw new SocialPostActionError(
    "ポストの状態が変更されました。再読み込みしてください。",
    409,
  );
}
