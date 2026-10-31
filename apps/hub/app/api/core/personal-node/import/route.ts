import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { validatePersonalNodeBundle } from "@/lib/server/federation-gateway";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  applyPersonalNodeRestore,
  previewPersonalNodeRestore,
} from "@/lib/server/personal-node-restore";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "bundle_too_large" }, { status: 413 });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as {
      action?: unknown;
      bundle?: unknown;
      confirmation?: unknown;
    } | null;
    if (!body || (body.action !== "preview" && body.action !== "apply") || !body.bundle) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const verified = await validatePersonalNodeBundle(body.bundle);
    if (!verified?.valid) {
      return NextResponse.json({ error: "bundle_verification_failed" }, { status: 400 });
    }
    if (verified.sourceProfileId !== profile.id) {
      return NextResponse.json({ error: "bundle_profile_mismatch" }, { status: 403 });
    }
    const preview = await previewPersonalNodeRestore(database, profile.id, verified.events);
    if (body.action === "preview") {
      return NextResponse.json({
        verified: true,
        headHash: verified.headHash,
        ...preview,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.confirmation !== "RESTORE") {
      return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
    }
    const result = await applyPersonalNodeRestore(database, profile.id, verified.events);
    return NextResponse.json({
      restored: true,
      headHash: verified.headHash,
      ...result,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    return NextResponse.json({ error: "restore_unavailable" }, { status: 503 });
  }
}
