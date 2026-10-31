import "server-only";

import type { ThreadReportReason } from "@/lib/domain";
import { toPublicThreadPost } from "@/lib/thread-privacy";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  deleteD1ThreadPost,
  editD1ThreadPost,
  getD1ThreadPostRevisions,
  reportD1ThreadPost,
  toggleD1UserControl
} from "@/lib/server/thread-moderation-repository";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { ensureD1ThreadPostAvailable } from "@/lib/server/bbs-route-data";

async function authenticatedD1(request: Request, postId: string) {
  const database = getHubD1();
  await ensureD1ThreadPostAvailable(postId);
  return { database, viewer: await requireHubViewerProfile(request, database) };
}

export async function reportThreadPostRouteData(request: Request, postId: string, reason: ThreadReportReason, details?: string) {
  const { database, viewer } = await authenticatedD1(request, postId);
  return reportD1ThreadPost(database, { postId, reason, details, reporterProfileId: viewer.id });
}

export async function toggleThreadUserControlRouteData(request: Request, postId: string, action: "mute" | "block") {
  const { database, viewer } = await authenticatedD1(request, postId);
  return { control: await toggleD1UserControl(database, postId, action, viewer.id) };
}

export async function editThreadPostRouteData(request: Request, postId: string, body: string, editReason = "") {
  const { database, viewer } = await authenticatedD1(request, postId);
  return { post: toPublicThreadPost(await editD1ThreadPost(database, postId, body, viewer.id, editReason)) };
}

export async function deleteThreadPostRouteData(request: Request, postId: string) {
  const { database, viewer } = await authenticatedD1(request, postId);
  return { post: toPublicThreadPost(await deleteD1ThreadPost(database, postId, viewer.id)) };
}

export async function getThreadPostHistoryRouteData(request: Request, postId: string) {
  const { database, viewer } = await authenticatedD1(request, postId);
  return { revisions: await getD1ThreadPostRevisions(database, postId, viewer.id) };
}
