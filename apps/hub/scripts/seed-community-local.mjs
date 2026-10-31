import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "data", "sekai-seifu-db.json");
const sqlPath = path.join(root, "data", ".community-local-seed.sql");
const snapshot = JSON.parse(readFileSync(sourcePath, "utf8"));
const now = new Date().toISOString();

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const statements = ["PRAGMA foreign_keys = ON;"];

for (const community of snapshot.communities ?? []) {
  statements.push(`INSERT INTO communities (
    id, slug, name, description, category, owner_profile_id, image_url,
    visibility, knowledge_label, knowledge_description, lifecycle_status,
    created_at, updated_at
  ) VALUES (${[
    community.id,
    community.slug,
    community.name,
    community.description ?? "",
    community.category ?? "general",
    community.ownerProfileId,
    community.imageUrl ?? null,
    community.visibility ?? "public",
    community.knowledgeLabel ?? "ナレッジ",
    community.knowledgeDescription ?? "",
    "active",
    community.createdAt ?? now,
    now,
  ].map(sql).join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    slug = excluded.slug,
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    owner_profile_id = excluded.owner_profile_id,
    image_url = excluded.image_url,
    visibility = excluded.visibility,
    knowledge_label = excluded.knowledge_label,
    knowledge_description = excluded.knowledge_description,
    lifecycle_status = 'active',
    updated_at = excluded.updated_at;`);
}

for (const membership of snapshot.communityMemberships ?? []) {
  statements.push(`INSERT INTO community_memberships (
    community_id, profile_id, role, status, joined_at
  ) VALUES (${[
    membership.communityId,
    membership.profileId,
    membership.role ?? "member",
    membership.status ?? "active",
    membership.joinedAt ?? now,
  ].map(sql).join(", ")})
  ON CONFLICT(community_id, profile_id) DO UPDATE SET
    role = excluded.role,
    status = CASE
      WHEN community_memberships.status = 'banned' THEN community_memberships.status
      ELSE excluded.status
    END;`);
}

for (const channel of snapshot.communityChannels ?? []) {
  statements.push(`INSERT INTO community_channels (
    id, community_id, name, description, position, created_at
  ) VALUES (${[
    channel.id,
    channel.communityId,
    channel.name,
    channel.description ?? "",
    Number(channel.position) || 0,
    channel.createdAt ?? now,
  ].map(sql).join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    position = excluded.position;`);
}

for (const message of snapshot.communityChannelMessages ?? []) {
  statements.push(`INSERT INTO community_channel_messages (
    id, channel_id, author_profile_id, body, created_at
  ) VALUES (${[
    message.id,
    message.channelId,
    message.authorProfileId,
    message.body,
    message.createdAt ?? now,
  ].map(sql).join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    body = excluded.body;`);
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
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, "data", ".wrangler-community-seed.log") },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(sqlPath, { force: true });
}
