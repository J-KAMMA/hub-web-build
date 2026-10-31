import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

const cleanMap = (value: unknown) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {}).filter(([key, score]) => key.length <= 160 && typeof score === "number" && Number.isFinite(score)).slice(0, 500));

export async function GET(request: Request) {
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database);
  const row = await database.prepare("SELECT topics_json, channels_json, videos_json, categories_json, analytics_enabled FROM video_recommendation_settings WHERE profile_id = ?").bind(profile.id).first<{ topics_json: string; channels_json: string; videos_json: string; categories_json: string; analytics_enabled: number }>();
  return NextResponse.json({ preferences: row ? { topics: JSON.parse(row.topics_json), channels: JSON.parse(row.channels_json), videos: JSON.parse(row.videos_json), categories: JSON.parse(row.categories_json), analyticsEnabled: Boolean(row.analytics_enabled) } : null });
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database); const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const topics = cleanMap(body?.topics), channels = cleanMap(body?.channels), videos = cleanMap(body?.videos), categories = cleanMap(body?.categories), analytics = body?.analyticsEnabled !== false;
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO video_recommendation_settings (profile_id, topics_json, channels_json, videos_json, categories_json, analytics_enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET topics_json=excluded.topics_json, channels_json=excluded.channels_json, videos_json=excluded.videos_json, categories_json=excluded.categories_json, analytics_enabled=excluded.analytics_enabled, updated_at=excluded.updated_at`)
    .bind(profile.id, JSON.stringify(topics), JSON.stringify(channels), JSON.stringify(videos), JSON.stringify(categories), analytics ? 1 : 0, now).run();
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const database = getHubD1(); const profile = await requireHubSessionProfile(request, database);
  await database.prepare("DELETE FROM video_recommendation_settings WHERE profile_id = ?").bind(profile.id).run();
  return NextResponse.json({ deleted: true });
}
