import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "data", "sekai-seifu-db.json");
const sqlPath = path.join(root, "data", ".hub-local-seed.sql");
const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = ["PRAGMA foreign_keys = ON;"];
for (const profile of snapshot.profiles ?? []) {
  const avatarUrl = typeof profile.avatarUrl === "string" && profile.avatarUrl.length <= 2048
    ? profile.avatarUrl
    : null;
  statements.push(`INSERT OR REPLACE INTO profiles (
    id, handle, display_name, bio, avatar_url, joined_at, created_at, updated_at
  ) VALUES (${[
    profile.id,
    profile.handle,
    profile.displayName,
    profile.bio ?? "",
    avatarUrl,
    profile.joinedAt,
    profile.joinedAt,
    new Date().toISOString()
  ].map(sql).join(", ")});`);
}

for (const post of snapshot.socialPosts ?? []) {
  statements.push(`INSERT OR REPLACE INTO social_posts (
    id, author_profile_id, display_name, handle, identity_mode, body, created_at,
    reply_to_post_id, repost_of_target_type, repost_of_target_id,
    quote_of_target_type, quote_of_target_id
  ) VALUES (${[
    post.id,
    post.authorProfileId ?? null,
    post.displayName,
    post.handle ?? null,
    post.identityMode ?? "account",
    post.body,
    post.createdAt,
    post.replyToPostId ?? null,
    post.repostOfTargetType ?? null,
    post.repostOfTargetId ?? null,
    post.quoteOfTargetType ?? null,
    post.quoteOfTargetId ?? null
  ].map(sql).join(", ")});`);
}

for (const ranking of snapshot.tokenRankings ?? []) {
  statements.push(`INSERT OR REPLACE INTO token_rankings (
    id, title, symbol, network, contract_address, description,
    created_by_profile_id, created_at, verification_status,
    last_verified_at, last_synced_at, holder_count, sync_error
  ) VALUES (${[
    ranking.id,
    ranking.title,
    ranking.symbol,
    ranking.network,
    ranking.contractAddress ?? null,
    ranking.description ?? "",
    ranking.createdByProfileId,
    ranking.createdAt,
    "not_applicable",
    null,
    null,
    0,
    null
  ].map(sql).join(", ")});`);
}

for (const [profileId, balances] of Object.entries(snapshot.tokenBalances ?? {})) {
  for (const balance of balances) {
    const updatedAt = new Date().toISOString();
    statements.push(`INSERT OR REPLACE INTO token_balances (
      profile_id, symbol, amount, updated_at
    ) VALUES (${[
      profileId,
      balance.symbol,
      Number(balance.amount) || 0,
      updatedAt
    ].map(sql).join(", ")});`);
    for (const ranking of snapshot.tokenRankings ?? []) {
      const networkMatches = !balance.network ||
        balance.network.toLocaleLowerCase("en") ===
          ranking.network.toLocaleLowerCase("en");
      if (
        balance.symbol.toLocaleUpperCase("en") ===
          ranking.symbol.toLocaleUpperCase("en") &&
        networkMatches
      ) {
        statements.push(`INSERT OR REPLACE INTO token_balance_snapshots (
          profile_id, ranking_id, amount, verified_at
        ) VALUES (${[
          profileId,
          ranking.id,
          Number(balance.amount) || 0,
          updatedAt
        ].map(sql).join(", ")});`);
      }
    }
  }
}

try {
  writeFileSync(sqlPath, `${statements.join("\n")}\n`, "utf8");
  const wranglerCli = path.resolve(root, "..", "..", "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(
    process.execPath,
    [wranglerCli, "d1", "execute", "HUB_DATABASE", "--local", "--file", sqlPath],
    {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, "data", ".wrangler-seed.log") }
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(sqlPath, { force: true });
}
