import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireHubAdsScanner(request: Request): NextResponse | null {
  const configured = process.env.HUB_ADS_SCANNER_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  const submitted = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!configured || configured.length < 32 || !submitted || !equalSecret(submitted, configured)) {
    return NextResponse.json({ error: "Scanner authentication required." }, { status: 403 });
  }
  return null;
}
