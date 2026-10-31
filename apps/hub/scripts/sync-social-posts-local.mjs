import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "data", "sekai-seifu-db.json");
const sqlPath = path.join(root, "data", ".social-post-sync.sql");
const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));
const posts = snapshot.socialPosts ?? [];
const profiles = new Map((snapshot.profiles ?? []).map((profile) => [profile.id, profile]));

const sql = (value) => value === null || value === undefined
  ? "NULL"
  : `'${String(value).replaceAll("'", "''")}'`;

const statements = ["PRAGMA foreign_keys = ON;"];
const referencedProfileIds = new Set(posts.map((post) => post.authorProfileId).filter(Boolean));
for (const profileId of referencedProfileIds) {
  const profile = profiles.get(profileId);
  if (!profile) throw new Error(`Missing profile for social post author: ${profileId}`);
  const joinedAt = profile.joinedAt ?? "2026-01-01T00:00:00.000Z";
  statements.push(`INSERT OR IGNORE INTO profiles
    (id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at)
    VALUES (${[
      profile.id, profile.handle, profile.displayName, profile.bio ?? "",
      profile.avatarUrl ?? null, joinedAt, joinedAt, joinedAt,
    ].map(sql).join(", ")});`);
}

const orderedPosts = [
  ...posts.filter((post) => !post.replyToPostId),
  ...posts.filter((post) => post.replyToPostId),
];
for (const post of orderedPosts) {
  statements.push(`INSERT INTO social_posts (
      id, author_profile_id, display_name, handle, identity_mode, body, created_at,
      reply_to_post_id, repost_of_target_type, repost_of_target_id,
      quote_of_target_type, quote_of_target_id
    ) VALUES (${[
      post.id, post.authorProfileId ?? null, post.displayName, post.handle ?? null,
      post.identityMode ?? "account", post.body, post.createdAt, post.replyToPostId ?? null,
      post.repostOfTargetType ?? null, post.repostOfTargetId ?? null,
      post.quoteOfTargetType ?? null, post.quoteOfTargetId ?? null,
    ].map(sql).join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      author_profile_id = excluded.author_profile_id,
      display_name = excluded.display_name,
      handle = excluded.handle,
      identity_mode = excluded.identity_mode,
      body = excluded.body,
      created_at = excluded.created_at,
      reply_to_post_id = excluded.reply_to_post_id,
      repost_of_target_type = excluded.repost_of_target_type,
      repost_of_target_id = excluded.repost_of_target_id,
      quote_of_target_type = excluded.quote_of_target_type,
      quote_of_target_id = excluded.quote_of_target_id;`);
}

try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`, "utf8");
  const wranglerCli = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [
    wranglerCli, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath,
  ], { cwd: root, encoding: "utf8", stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log(`Synchronized ${posts.length} canonical social posts to local D1.`);
} finally {
  rmSync(sqlPath, { force: true });
}
