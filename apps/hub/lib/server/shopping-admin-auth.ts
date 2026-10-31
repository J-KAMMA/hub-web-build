import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

function equalSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireShoppingAdmin(request: Request): NextResponse | null {
  const expected = process.env.HUB_SHOPPING_ADMIN_KEY;
  const actual = request.headers.get("x-shopping-admin-key") ?? "";
  if (!expected || !equalSecret(actual, expected)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Shopping administrator access is required." } },
      { status: 403 },
    );
  }
  return null;
}
