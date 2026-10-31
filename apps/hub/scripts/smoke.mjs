const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";
const scope = process.env.SMOKE_SCOPE ?? "core";

const coreChecks = [
  "/",
  "/bbs",
  "/search",
  "/community",
  "/bookmarks",
  "/lists",
  "/notifications",
  "/messages",
  "/api/snapshot",
  "/api/search?q=test",
  "/api/notifications",
  "/api/messages/conversations",
  "/api/bbs/threads"
];

const extendedChecks = [
  "/ranking",
  "/token"
];

if (!["core", "all"].includes(scope)) {
  throw new Error(`Unsupported SMOKE_SCOPE: ${scope} (expected core or all).`);
}

const staticChecks = scope === "all"
  ? [...coreChecks, ...extendedChecks]
  : coreChecks;

const redirectChecks = [
  ["/social", "/"],
  ["/timeline", "/"]
];

const failures = [];

function validateBody(response, body) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("text/html")) {
    if (!body.includes("<main")) {
      throw new Error("HTML response does not include the app main content.");
    }

    const errorMarkers = [
      "Application error",
      "Internal Server Error",
      "Unhandled Runtime Error",
      "NEXT_REDIRECT",
      "__next_error__"
    ];

    const marker = errorMarkers.find((item) => body.includes(item));
    if (marker) {
      throw new Error(`HTML response includes error marker: ${marker}`);
    }
  }

  if (contentType.includes("application/json")) {
    try {
      JSON.parse(body);
    } catch {
      throw new Error("JSON response could not be parsed.");
    }
  }

  if (body.trim().length === 0) {
    throw new Error("Response body is empty.");
  }
}

async function checkPath(path) {
  const url = new URL(path, baseUrl);

  try {
    const response = await fetch(url);
    const status = `${response.status} ${response.statusText}`.trim();

    if (!response.ok) {
      failures.push(`${path} -> ${status}`);
      console.error(`FAIL ${path} ${status}`);
      return;
    }

    const body = await response.text();
    validateBody(response, body);
    console.log(`PASS ${path} ${status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${path} -> ${message}`);
    console.error(`FAIL ${path} ${message}`);
  }
}

async function checkRedirect(path, expectedPath) {
  const url = new URL(path, baseUrl);

  try {
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    const resolvedLocation = location ? new URL(location, url) : null;

    if (
      response.status < 300
      || response.status >= 400
      || resolvedLocation?.pathname !== expectedPath
    ) {
      throw new Error(
        `expected redirect to ${expectedPath}, received ${response.status} ${location ?? "(no location)"}`
      );
    }

    console.log(`PASS ${path} ${response.status} -> ${expectedPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${path} -> ${message}`);
    console.error(`FAIL ${path} ${message}`);
  }
}

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl));
  const status = `${response.status} ${response.statusText}`.trim();

  if (!response.ok) {
    throw new Error(`${path} -> ${status}`);
  }

  return response.json();
}

for (const path of staticChecks) {
  await checkPath(path);
}

for (const [path, expectedPath] of redirectChecks) {
  await checkRedirect(path, expectedPath);
}

try {
  const snapshot = await getJson("/api/snapshot");
  const profile = snapshot.profiles.find((item) => item.handle);
  const board = snapshot.boards[0];
  const thread = snapshot.threads[0];
  const socialPost = snapshot.socialPosts[0];
  const conversation = snapshot.conversations[0];

  if (!profile || !board || !thread || !socialPost || !conversation) {
    throw new Error("Snapshot is missing required seed data for dynamic smoke checks.");
  }

  const dynamicChecks = [
    `/profile/${profile.handle}`,
    `/bbs/${board.key}`,
    `/threads/${thread.id}`,
    `/posts/${socialPost.id}`,
    `/api/bbs/threads/${thread.id}/posts`,
    `/api/messages/conversations/${conversation.id}`
  ];

  for (const path of dynamicChecks) {
    await checkPath(path);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`dynamic checks -> ${message}`);
  console.error(`FAIL dynamic checks ${message}`);
}

if (failures.length > 0) {
  console.error("");
  console.error("Smoke checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("");
console.log(`Smoke checks passed for ${baseUrl} (${scope} scope)`);
