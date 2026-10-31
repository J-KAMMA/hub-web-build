import { NextResponse } from "next/server";

import { federationActorUrl } from "@/lib/platform/external-protocols";

/*
 * 旧い actor URL。実体は apps/federation の /users/{handle} だけが返す（公開鍵と inbox を持つ唯一の actor）。
 * 以前この道が返していた actor は公開鍵も inbox の経路も無く、Federation の actor と食い違っていた。
 * すでに配った旧 URL が壊れないよう、恒久転送だけ残す。
 */
export async function GET(request: Request, context: { params: Promise<{ handle: string }> }) {
  const { handle } = await context.params;
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,31}$/.test(handle)) {
    return NextResponse.json({ error: "invalid_handle" }, { status: 400 });
  }
  return NextResponse.redirect(federationActorUrl(new URL(request.url).origin, handle.toLowerCase()), 308);
}
