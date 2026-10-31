import { NextResponse } from "next/server";

import { federationOutboxUrl } from "@/lib/platform/external-protocols";

/* 旧い outbox URL。実体は apps/federation の /users/{handle}/outbox（../route.ts 参照）。 */
export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$/.test(handle)) {
    return NextResponse.json({ error: "invalid_handle" }, { status: 400 });
  }
  return NextResponse.redirect(federationOutboxUrl(new URL(request.url).origin, handle.toLowerCase()), 308);
}
