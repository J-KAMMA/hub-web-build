import { getHubD1 } from "@/lib/server/hub-d1";
import { createHubAdReportCsv, listHubAdReports } from "@/lib/server/hub-ads-reporting";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export async function GET(request: Request) {
  const authError = requireModerationAdmin(request);
  if (authError) return authError;
  const value = Number(new URL(request.url).searchParams.get("days") ?? "30");
  const report = await listHubAdReports(getHubD1(), Number.isFinite(value) ? value : 30);
  return new Response(createHubAdReportCsv(report.rows as Record<string, unknown>[]), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="hub-ads-report-${new Date().toISOString().slice(0, 10)}.csv"`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
