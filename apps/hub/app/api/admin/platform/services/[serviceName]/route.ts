import catalog from "@/lib/platform/service-catalog.generated.json";
import { hubApiErrorResponse } from "@/lib/platform/api-error";
import { createHubRequestContext, hubContextHeaders } from "@/lib/platform/request-context";
import { requireModerationAdmin } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serviceName: string }> },
) {
  const context = createHubRequestContext(request);
  if (requireModerationAdmin(request)) {
    return hubApiErrorResponse({
      code: "PLATFORM_CATALOG_FORBIDDEN",
      category: "forbidden",
      message: "管理者認証が必要です。",
      requestId: context.requestId,
    }, 403, hubContextHeaders(context));
  }

  const { serviceName } = await params;
  const service = catalog.services.find((candidate) => candidate.name === serviceName);
  if (!service) {
    return hubApiErrorResponse({
      code: "PLATFORM_SERVICE_NOT_FOUND",
      category: "not_found",
      message: "サービスが見つかりません。",
      requestId: context.requestId,
    }, 404, hubContextHeaders(context));
  }
  return Response.json(service, {
    headers: { ...hubContextHeaders(context), "cache-control": "private, no-store" },
  });
}
