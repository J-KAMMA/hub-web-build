import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

const keyFor = (channel: string, provider: string) => `${channel.trim().toLocaleLowerCase("ja")}:${provider}`;

export async function GET(request: Request) {
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database);
  const rows = await database.prepare(`SELECT c.channel_key, c.display_name, c.provider, f.notifications_enabled
    FROM video_channel_follows f JOIN video_channels c ON c.channel_key = f.channel_key WHERE f.profile_id = ? ORDER BY f.updated_at DESC LIMIT 500`).bind(profile.id).all<{ channel_key: string; display_name: string; provider: string; notifications_enabled: number }>();
  return NextResponse.json({ channels: rows.results.map((row) => ({ key: row.channel_key, name: row.display_name, provider: row.provider, notificationsEnabled: Boolean(row.notifications_enabled) })) });
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database); const body = await request.json().catch(() => null) as { channel?: string; provider?: string; notificationsEnabled?: boolean } | null;
  const channel = body?.channel?.trim().slice(0, 160), provider = body?.provider?.trim().slice(0, 32);
  if (!channel || !provider) return NextResponse.json({ error: "Channel and provider are required." }, { status: 400 });
  const key = keyFor(channel, provider), now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO video_channels (channel_key, display_name, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel_key) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`).bind(key, channel, provider, now, now),
    database.prepare(`INSERT INTO video_channel_follows (profile_id, channel_key, notifications_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(profile_id, channel_key) DO UPDATE SET notifications_enabled=excluded.notifications_enabled, updated_at=excluded.updated_at`).bind(profile.id, key, body?.notificationsEnabled ? 1 : 0, now, now),
  ]);
  return NextResponse.json({ followed: true, key });
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database); const url = new URL(request.url); const channel = url.searchParams.get("channel") ?? "", provider = url.searchParams.get("provider") ?? "";
  await database.prepare("DELETE FROM video_channel_follows WHERE profile_id = ? AND channel_key = ?").bind(profile.id, keyFor(channel, provider)).run();
  return NextResponse.json({ followed: false });
}
