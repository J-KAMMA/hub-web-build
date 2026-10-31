import type { D1Database } from "@cloudflare/workers-types";
import { normalizeTag } from "@jkamma/content-tags";

/**
 * 記事のタグのフォロー。tag は表示用の正規化済みの形、tag_key は共有の鍵（@jkamma/content-tags）で、
 * 一致の判定は鍵で行う（NFKC・大文字小文字をまたいで同じタグ）。鍵が無い古い行は tag の完全一致で拾う。
 * 1人100まで。
 */

export const TAG_FOLLOW_LIMIT = 100;

export class TagFollowLimitError extends Error {
  constructor() {
    super(`フォローできるタグは${TAG_FOLLOW_LIMIT}までです。使わないタグのフォローを外してください。`);
    this.name = "TagFollowLimitError";
  }
}

export class TagFollowValidationError extends Error {
  constructor() {
    super("タグの形が正しくありません。");
    this.name = "TagFollowValidationError";
  }
}

/** URLや本文から来た値は信用しない。空・長すぎる・制御文字入りは断る。 */
export function parseFollowTag(value: unknown): string {
  if (typeof value !== "string") throw new TagFollowValidationError();
  const tag = value.trim();
  if (!tag || tag.length > 100 || /[\u0000-\u001f\u007f]/u.test(tag)) throw new TagFollowValidationError();
  return tag;
}

export async function isFollowingTag(database: D1Database, profileId: string, tag: string): Promise<boolean> {
  const key = normalizeTag(tag)?.key ?? null;
  const row = await database.prepare("SELECT 1 AS following FROM hub_article_tag_follows WHERE profile_id = ? AND (tag_key = ? OR tag = ?) LIMIT 1")
    .bind(profileId, key, tag).first<{ following: number }>();
  return Boolean(row);
}

/** すでに追っていれば何もしない（上限でも成功のまま）。 */
export async function followTag(database: D1Database, profileId: string, tag: string, now = new Date()): Promise<void> {
  if (await isFollowingTag(database, profileId, tag)) return;
  try {
    const normalized = normalizeTag(tag);
    if (!normalized) throw new TagFollowValidationError();
    await database.prepare("INSERT OR IGNORE INTO hub_article_tag_follows (profile_id, tag, tag_key, created_at) VALUES (?, ?, ?, ?)")
      .bind(profileId, normalized.display, normalized.key, now.toISOString()).run();
  } catch (error) {
    if (error instanceof Error && /hub_article_tag_follow_limit/.test(error.message)) throw new TagFollowLimitError();
    throw error;
  }
}

export async function unfollowTag(database: D1Database, profileId: string, tag: string): Promise<void> {
  const key = normalizeTag(tag)?.key ?? null;
  await database.prepare("DELETE FROM hub_article_tag_follows WHERE profile_id = ? AND (tag_key = ? OR tag = ?)").bind(profileId, key, tag).run();
}

/** フォロー中のタグ。新しく追った順。上限が100なので1回で全部読める。 */
export async function listFollowedTags(database: D1Database, profileId: string): Promise<string[]> {
  const result = await database.prepare(`SELECT tag FROM hub_article_tag_follows WHERE profile_id = ?
    ORDER BY created_at DESC, tag LIMIT ${TAG_FOLLOW_LIMIT}`).bind(profileId).all<{ tag: string }>();
  return (result.results ?? []).map((row) => row.tag);
}
