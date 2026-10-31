import "server-only";

import { markThreadRead, setThreadBestAnswer, toggleThreadFollowing } from "@/lib/mock-data";
import { ensureD1ThreadAvailable } from "@/lib/server/bbs-route-data";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { markD1ThreadRead, setD1ThreadBestAnswer, setD1ThreadNotificationMode, toggleD1ThreadFollowing } from "@/lib/server/d1-threads";

async function authenticatedThread(request: Request, threadId: string) {
  const database = await ensureD1ThreadAvailable(threadId);
  if (!database) throw new HubAuthenticationError("Hub D1 session is required.");
  return { database, viewer: await requireHubViewerProfile(request, database) };
}

export async function toggleThreadFollowingRouteData(request: Request, threadId: string) {
  const { database, viewer } = await authenticatedThread(request, threadId);
  return { tracking: await toggleD1ThreadFollowing(database, threadId, viewer.id) };
}

export async function setThreadNotificationModeRouteData(request: Request, threadId: string, mode: "instant" | "digest" | "important" | "none") {
  const { database, viewer } = await authenticatedThread(request, threadId);
  return { tracking: await setD1ThreadNotificationMode(database, threadId, viewer.id, mode) };
}

export async function markThreadReadRouteData(request: Request, threadId: string, lastReadPostNo: number) {
  const { database, viewer } = await authenticatedThread(request, threadId);
  return { tracking: await markD1ThreadRead(database, threadId, viewer.id, lastReadPostNo) };
}

export async function setThreadBestAnswerRouteData(request: Request, threadId: string, postId: string | null) {
  const { database, viewer } = await authenticatedThread(request, threadId);
  return { thread: await setD1ThreadBestAnswer(database, threadId, postId, viewer.id) };
}
