import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

function equalSecret(actual: string, expected: string) { const a = Buffer.from(actual); const b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
export function requireAdmin(request: Request): NextResponse | null {
  const expected = process.env.ENCYCLOPEDIA_ADMIN_KEY;
  const actual = request.headers.get("x-encyclopedia-admin-key") ?? "";
  if (!expected || !equalSecret(actual, expected)) return NextResponse.json({ error: { code: "forbidden", message: "Administrator access is required." } }, { status: 403 });
  return null;
}
export function apiError(error: unknown): NextResponse { if (error instanceof ZodError) return NextResponse.json({ error: { code: "invalid_input", message: "Invalid request input.", issues: error.issues } }, { status: 400 }); if (error instanceof SyntaxError) return NextResponse.json({ error: { code: "invalid_json", message: "Request body must be valid JSON." } }, { status: 400 }); console.error("Encyclopedia API operation failed", { name: error instanceof Error ? error.name : "UnknownError" }); return NextResponse.json({ error: { code: "internal_error", message: "The operation could not be completed." } }, { status: 500 }); }
