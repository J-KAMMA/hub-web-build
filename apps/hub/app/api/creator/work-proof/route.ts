import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { verifyWorkTrustProof } from "@/lib/server/work-trust-proof";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }
  const publicKey = process.env.COMMERCE_PROJECTION_PUBLIC_KEY_SPKI?.trim() ?? "";
  if (!publicKey) {
    return NextResponse.json(
      { error: "work_proof_verification_unavailable" },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => null) as { proof?: unknown } | null;
  const projection = await verifyWorkTrustProof(body?.proof, publicKey);
  if (!projection) {
    return NextResponse.json({ error: "invalid_work_proof" }, { status: 422 });
  }
  return NextResponse.json(
    { projection },
    { headers: { "cache-control": "private, no-store" } },
  );
}
