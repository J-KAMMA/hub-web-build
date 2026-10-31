import { NextResponse } from "next/server";
import { apiError, requireAdmin } from "@/lib/encyclopedia/admin";
import { getHubD1 } from "@/lib/server/hub-d1";
import { upsertSourceLicense } from "@/lib/server/hubpedia-quality-operations";

const statuses = new Set(["allowed", "attribution-required", "review-required", "blocked"]);
export async function PUT(request: Request) {
  const denied = requireAdmin(request); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.host !== "string" || typeof body.reuseStatus !== "string" || !statuses.has(body.reuseStatus)) return NextResponse.json({ error: { code: "invalid_input", message: "host and a valid reuseStatus are required." } }, { status: 400 });
    await upsertSourceLicense(getHubD1(), { host: body.host, reuseStatus: body.reuseStatus as "allowed"|"attribution-required"|"review-required"|"blocked", licenseName: typeof body.licenseName === "string" ? body.licenseName : null, licenseUrl: typeof body.licenseUrl === "string" ? body.licenseUrl : null, attributionTemplate: typeof body.attributionTemplate === "string" ? body.attributionTemplate : null });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
