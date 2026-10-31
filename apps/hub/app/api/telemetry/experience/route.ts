import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

const metrics = new Set(["lcp", "cls", "inp", "navigation"]);
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ accepted: false }, { status: 403 });
  const database = getOptionalHubD1();
  if (!database) return NextResponse.json({ accepted: false });
  const input = await request.json().catch(() => null) as { metric?: string; value?: number; route?: string } | null;
  if (!input?.metric || !metrics.has(input.metric) || !Number.isFinite(input.value) || input.value! < 0 || input.value! > 120_000) return NextResponse.json({ accepted: false }, { status: 400 });
  const routeGroup = input.route === "/" ? "home" : "other";
  const value = Math.round(input.value!); const day = new Date().toISOString().slice(0, 10);
  await database.prepare(`INSERT INTO home_experience_metrics(day, route_group, metric, sample_count, sample_sum, sample_max)
    VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(day, route_group, metric) DO UPDATE SET
    sample_count = sample_count + 1, sample_sum = sample_sum + excluded.sample_sum, sample_max = MAX(sample_max, excluded.sample_max)`)
    .bind(day, routeGroup, input.metric, value, value).run();
  return NextResponse.json({ accepted: true });
}
