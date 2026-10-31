import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { pullFederationAll } from "@/lib/server/federation-group-inbound";

function authorized(request: Request): boolean {
  const provided = request.headers.get("authorization");
  const secret = process.env.HUB_FEDERATION_SECRET?.trim();
  if (!provided?.startsWith("Bearer ") || !secret || secret.length < 32) return false;
  const left = new TextEncoder().encode(provided.slice(7));
  const right = new TextEncoder().encode(secret);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/**
 * Federation の受信箱を今すぐ取り込む（運営・試験用）。定期の取り込みは HUB_JOBS が行う。
 * Federation と共有する HUB_FEDERATION_SECRET を持つ呼び出しだけが通る。ブラウザ・Desktop からは呼ばない。
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    return NextResponse.json(await pullFederationAll(getHubD1()), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json({ error: "pull_failed" }, { status: 500 });
  }
}
