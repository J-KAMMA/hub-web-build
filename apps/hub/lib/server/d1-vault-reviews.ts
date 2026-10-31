import type { D1Database } from "@cloudflare/workers-types";

export type VaultReview = {
  id: string;
  contentId: string;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: {
    profileId: string;
    handle: string;
    displayName: string;
    avatarUrl?: string;
  };
};

export type VaultReviewCollection = {
  reviews: VaultReview[];
  averageRating: number;
  reviewCount: number;
  viewerReview: VaultReview | null;
};

type VaultReviewRow = {
  id: string;
  vault_content_id: string;
  rating: number;
  body: string;
  created_at: string;
  updated_at: string;
  author_profile_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
};

export class InvalidVaultReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidVaultReviewError";
  }
}

function validateContentId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) {
    throw new InvalidVaultReviewError("有効なコンテンツIDが必要です。");
  }
  return value;
}

export function parseVaultReviewInput(value: unknown): { rating: number; body: string } {
  if (!value || typeof value !== "object") {
    throw new InvalidVaultReviewError("評価とレビュー本文が必要です。");
  }
  const rating = Reflect.get(value, "rating");
  const bodyValue = Reflect.get(value, "body");
  const body = typeof bodyValue === "string" ? bodyValue.trim() : "";
  if (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5) {
    throw new InvalidVaultReviewError("評価は1から5で指定してください。");
  }
  if (body.length < 1 || body.length > 2000) {
    throw new InvalidVaultReviewError("レビュー本文は1文字以上2000文字以内で入力してください。");
  }
  return { rating: Number(rating), body };
}

function mapReview(row: VaultReviewRow): VaultReview {
  return {
    id: row.id,
    contentId: row.vault_content_id,
    rating: Number(row.rating),
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      profileId: row.author_profile_id,
      handle: row.handle,
      displayName: row.display_name,
      ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    },
  };
}

export async function listD1VaultReviews(
  database: D1Database,
  contentIdValue: unknown,
  viewerProfileId: string | null,
): Promise<VaultReviewCollection> {
  const contentId = validateContentId(contentIdValue);
  const result = await database.prepare(`SELECT review.id, review.vault_content_id, review.rating,
      review.body, review.created_at, review.updated_at, review.author_profile_id,
      profile.handle, profile.display_name, profile.avatar_url
    FROM vault_content_reviews review
    JOIN profiles profile ON profile.id = review.author_profile_id
    WHERE review.vault_content_id = ?
    ORDER BY review.updated_at DESC
    LIMIT 100`).bind(contentId).all<VaultReviewRow>();
  const reviews = (result.results ?? []).map(mapReview);
  const ratingTotal = reviews.reduce((total, review) => total + review.rating, 0);
  return {
    reviews,
    averageRating: reviews.length ? Math.round((ratingTotal / reviews.length) * 10) / 10 : 0,
    reviewCount: reviews.length,
    viewerReview: viewerProfileId
      ? reviews.find((review) => review.author.profileId === viewerProfileId) ?? null
      : null,
  };
}

export async function upsertD1VaultReview(database: D1Database, input: {
  contentId: unknown;
  profileId: string;
  rating: number;
  body: string;
}): Promise<VaultReviewCollection> {
  const contentId = validateContentId(input.contentId);
  const parsed = parseVaultReviewInput(input);
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO vault_content_reviews
      (id, vault_content_id, author_profile_id, rating, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(vault_content_id, author_profile_id) DO UPDATE SET
      rating = excluded.rating,
      body = excluded.body,
      updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), contentId, input.profileId, parsed.rating, parsed.body, now, now)
    .run();
  return listD1VaultReviews(database, contentId, input.profileId);
}

export async function deleteD1VaultReview(
  database: D1Database,
  contentIdValue: unknown,
  profileId: string,
): Promise<VaultReviewCollection> {
  const contentId = validateContentId(contentIdValue);
  await database.prepare(
    "DELETE FROM vault_content_reviews WHERE vault_content_id = ? AND author_profile_id = ?",
  ).bind(contentId, profileId).run();
  return listD1VaultReviews(database, contentId, profileId);
}
