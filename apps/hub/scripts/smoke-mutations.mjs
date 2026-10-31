import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const dbPath = "data/sekai-seifu-db.json";
const backupPath = join(tmpdir(), `wgt-smoke-db-${Date.now()}.json`);

const failures = [];

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), options);
  const status = `${response.status} ${response.statusText}`.trim();

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${status}${text ? `: ${text}` : ""}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  return { data, status };
}

async function check(name, path, options, expectedStatus) {
  try {
    const { status } = await request(path, options);

    if (!status.startsWith(String(expectedStatus))) {
      throw new Error(`expected ${expectedStatus}, got ${status}`);
    }

    console.log(`PASS ${name} ${status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name} -> ${message}`);
    console.error(`FAIL ${name} ${message}`);
  }
}

function jsonBody(body) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  };
}

function notificationCountFor(snapshot, receiverProfileId) {
  return snapshot.notifications.filter((item) => item.receiverProfileId === receiverProfileId).length;
}

function followNotificationCountFor(snapshot, receiverProfileId) {
  return snapshot.notifications.filter(
    (item) => item.receiverProfileId === receiverProfileId && item.type === "followed"
  ).length;
}

function unreadNotificationCountFor(snapshot, receiverProfileId) {
  return snapshot.notifications.filter(
    (item) => item.receiverProfileId === receiverProfileId && !item.isRead
  ).length;
}

async function readRuntimeDb() {
  return JSON.parse(await readFile(dbPath, "utf8"));
}

try {
  await mkdir(dirname(backupPath), { recursive: true });
  await copyFile(dbPath, backupPath);

  const { data: snapshot } = await request("/api/snapshot");
  const profile = snapshot.profiles.find(
    (item) =>
      !item.isCurrentUser &&
      !snapshot.follows.some(
        (relation) =>
          relation.followerProfileId === snapshot.currentProfile.id &&
          relation.followedProfileId === item.id
      )
  );
  const board = snapshot.boards[0];
  const thread = snapshot.threads[0];
  const socialPost = snapshot.socialPosts[0];
  const otherAuthorPost = snapshot.socialPosts.find(
    (item) => item.authorProfileId && item.authorProfileId !== snapshot.currentProfile.id
  );
  const list = [...snapshot.lists].sort((left, right) => left.order - right.order)[0];
  const conversation = snapshot.conversations[0];

  if (!profile || !board || !thread || !socialPost || !otherAuthorPost || !list || !conversation) {
    throw new Error("Snapshot is missing required seed data for mutation smoke checks.");
  }

  await check(
    "POST /api/social/posts",
    "/api/social/posts",
    jsonBody({ body: "smoke test post", identity_mode: "account" }),
    201
  );

  const { data: socialPostsAfterCreate } = await request("/api/social/posts");

  if (socialPostsAfterCreate.posts[0]?.body !== "smoke test post") {
    throw new Error("Created social post was not returned at the top of the latest posts list.");
  }

  const runtimeDbBeforeRepost = await readRuntimeDb();
  const notificationCountBeforeRepost = notificationCountFor(
    runtimeDbBeforeRepost,
    otherAuthorPost.authorProfileId
  );
  await check(
    "POST /api/social/posts repost",
    "/api/social/posts",
    jsonBody({
      body: "",
      identity_mode: "account",
      repost_of_target_type: "social_post",
      repost_of_target_id: otherAuthorPost.id
    }),
    201
  );

  const snapshotAfterRepost = await readRuntimeDb();
  const notificationCountAfterRepost = notificationCountFor(
    snapshotAfterRepost,
    otherAuthorPost.authorProfileId
  );

  if (notificationCountAfterRepost <= notificationCountBeforeRepost) {
    throw new Error("Repost did not create a notification for the original author.");
  }

  await check(
    "POST /api/bbs/threads",
    "/api/bbs/threads",
    jsonBody({
      board_key: board.key,
      title: "Smoke test thread",
      body: "Smoke test body",
      identity_mode: "account"
    }),
    201
  );

  await check(
    "POST /api/bbs/threads/[id]/posts",
    `/api/bbs/threads/${thread.id}/posts`,
    jsonBody({ body: "Smoke reply", identity_mode: "account" }),
    201
  );

  await check(
    "POST /api/messages/start",
    "/api/messages/start",
    jsonBody({ target_profile_id: profile.id }),
    200
  );

  await check(
    "POST /api/messages/conversations/[id]/messages",
    `/api/messages/conversations/${conversation.id}/messages`,
    jsonBody({
      encrypted_payload: "smoke-payload",
      preview_text: "Smoke message",
      encryption_version: "v1"
    }),
    201
  );

  await check(
    "POST /api/messages/conversations/[id]/read",
    `/api/messages/conversations/${conversation.id}/read`,
    { method: "POST" },
    200
  );

  const runtimeDbAfterConversationRead = await readRuntimeDb();
  const readConversation = runtimeDbAfterConversationRead.conversations.find(
    (item) => item.id === conversation.id
  );
  const unreadMessagesAfterRead =
    readConversation?.unreadCountByProfileId[snapshot.currentProfile.id] ?? 0;

  if (unreadMessagesAfterRead !== 0) {
    throw new Error("Conversation read state did not persist unread count at zero.");
  }

  await check(
    "POST /api/messages/conversations/[id]/verification",
    `/api/messages/conversations/${conversation.id}/verification`,
    jsonBody({ status: "verified", fingerprint: conversation.fingerprint }),
    200
  );

  await check(
    "POST /api/engagements/reaction",
    "/api/engagements/reaction",
    jsonBody({ target_type: "social_post", target_id: socialPost.id, kind: "like" }),
    200
  );

  await check(
    "POST /api/engagements/bookmark",
    "/api/engagements/bookmark",
    jsonBody({ target_type: "social_post", target_id: socialPost.id, note: "smoke" }),
    200
  );

  const runtimeDbBeforeFollow = await readRuntimeDb();
  const followNotificationsBefore = followNotificationCountFor(runtimeDbBeforeFollow, profile.id);
  await check(
    "POST /api/follows/toggle",
    "/api/follows/toggle",
    jsonBody({ target_profile_id: profile.id }),
    200
  );

  const runtimeDbAfterFollow = await readRuntimeDb();
  const followExists = runtimeDbAfterFollow.follows.some(
    (relation) =>
      relation.followerProfileId === snapshot.currentProfile.id &&
      relation.followedProfileId === profile.id
  );
  const followNotificationsAfter = followNotificationCountFor(runtimeDbAfterFollow, profile.id);

  if (!followExists) {
    throw new Error("Follow toggle did not persist the follow relation.");
  }

  if (followNotificationsAfter <= followNotificationsBefore) {
    throw new Error("Follow toggle did not create a follow notification.");
  }

  await check(
    "POST /api/notifications/read-all",
    "/api/notifications/read-all",
    { method: "POST" },
    200
  );

  const runtimeDbAfterReadAll = await readRuntimeDb();
  const unreadAfterReadAll = unreadNotificationCountFor(
    runtimeDbAfterReadAll,
    snapshot.currentProfile.id
  );

  if (unreadAfterReadAll !== 0) {
    throw new Error("Read-all notifications did not persist unread count at zero.");
  }

  await check(
    "POST /api/lists/reorder",
    "/api/lists/reorder",
    jsonBody({ list_id: list.id, direction: "down" }),
    200
  );

  await check(
    "PUT /api/profile/avatar",
    "/api/profile/avatar",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatarUrl: "https://example.com/smoke-avatar.png" })
    },
    200
  );

  const { data: profileUpdate } = await request(
    "/api/profile",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Smoke Profile",
        bio: "Smoke profile update"
      })
    }
  );

  if (profileUpdate.profile.displayName !== "Smoke Profile") {
    throw new Error("Profile update did not return the updated display name.");
  }

  const runtimeDbAfterProfileUpdate = await readRuntimeDb();
  const persistedProfile = runtimeDbAfterProfileUpdate.profiles.find(
    (item) => item.id === snapshot.currentProfile.id
  );

  if (persistedProfile?.displayName !== "Smoke Profile") {
    throw new Error("Profile update did not persist the updated display name.");
  }

  const { data: searchAfterProfileUpdate } = await request("/api/search?q=Smoke%20Profile");
  const updatedAuthorPostVisible = searchAfterProfileUpdate.posts.some(
    (post) => post.displayName === "Smoke Profile"
  );

  if (!updatedAuthorPostVisible) {
    throw new Error("Updated profile display name was not reflected in social post search results.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`setup -> ${message}`);
  console.error(`FAIL setup ${message}`);
} finally {
  try {
    await copyFile(backupPath, dbPath);
    await rm(backupPath, { force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`restore -> ${message}`);
    console.error(`FAIL restore ${message}`);
  }
}

if (failures.length > 0) {
  console.error("");
  console.error("Mutation smoke checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("");
console.log(`Mutation smoke checks passed for ${baseUrl}`);
console.log("Runtime DB restored from backup.");
