import catalog from "@/lib/platform/service-catalog.generated.json";
import { hubApiErrorResponse } from "@/lib/platform/api-error";
import { createHubRequestContext, hubContextHeaders } from "@/lib/platform/request-context";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const context = createHubRequestContext(request);
  const authError = requireModerationAdmin(request);
  if (authError) {
    return hubApiErrorResponse({
      code: "PLATFORM_CATALOG_FORBIDDEN",
      category: "forbidden",
      message: "管理者認証が必要です。",
      requestId: context.requestId,
    }, 403, hubContextHeaders(context));
  }
  return Response.json(catalog, {
    headers: { ...hubContextHeaders(context), "cache-control": "private, no-store" },
  });
}
