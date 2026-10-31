import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireEncyclopediaAdmin(request: Request): NextResponse | null {
  const expected = process.env.ENCYCLOPEDIA_ADMIN_KEY;
  const actual = request.headers.get("x-encyclopedia-admin-key") ?? "";
  if (!expected || expected.length < 16 || !equalSecret(actual, expected)) {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }
  return null;
}

