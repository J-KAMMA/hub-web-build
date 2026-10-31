import "server-only";

import { hideReportedThreadPost, listThreadPostReports, resolveThreadPostReport } from "@/lib/mock-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import {
  hideD1ReportedPost,
  listD1ModerationReports,
  resolveD1ModerationReport
} from "@/lib/server/thread-moderation-repository";
import type { ThreadPostReport } from "@/lib/domain";

export async function listModerationReportsRouteData(status: ThreadPostReport["status"] | "all") {
  const database = getOptionalHubD1();
  const reports = database
    ? await listD1ModerationReports(database, status)
    : listThreadPostReports(status);
  return { reports };
}

export async function moderateReportRouteData(reportId: string, action: "resolve" | "dismiss" | "hide", note: string) {
  const database = getOptionalHubD1();
  if (database) {
    if (action === "hide") return { report: await hideD1ReportedPost(database, reportId, note) };
    return { report: await resolveD1ModerationReport(database, reportId, action === "resolve" ? "resolved" : "dismissed", note) };
  }
  if (action === "hide") return { report: hideReportedThreadPost(reportId, note) };
  return { report: resolveThreadPostReport(reportId, action === "resolve" ? "resolved" : "dismissed", note) };
}
