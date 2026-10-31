import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { readCookie } from "@/lib/server/hub-session";

const COOKIE = "hub.video_viewer";
const TOKEN = /^[0-9a-f-]{36}$/u;
const EVENTS = new Set(["start", "quarter", "half", "complete", "skip", "external"]);

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const body = await request.json().catch(() => null) as { event?: string } | null;
  if (!body?.event || !EVENTS.has(body.event)) return NextResponse.json({ error: "Invalid video event." }, { status: 400 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ recorded: false });
  const existing = readCookie(request.headers.get("cookie"), COOKIE);
  const token = existing && TOKEN.test(existing) ? existing : crypto.randomUUID();
  const { videoId } = await params;
  const now = new Date();
  await database.prepare(`INSERT OR IGNORE INTO video_playback_events
    (id, video_id, viewer_hash, event_type, event_day, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), videoId, await hash(token), body.event, now.toISOString().slice(0, 10), now.toISOString()).run();
  const response = NextResponse.json({ recorded: true });
  if (token !== existing) response.cookies.set(COOKIE, token, { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict", path: "/", maxAge: 31536000 });
  return response;
}
