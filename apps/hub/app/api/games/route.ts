import { NextResponse } from "next/server";

import { createD1GameGuideSubmission, findD1GameGuideCandidates, GameSubmissionConflictError } from "@/lib/server/d1-game-guide-submissions";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORMS = new Set(["PC", "PlayStation 5", "PlayStation 4", "Xbox Series X|S", "Xbox One", "Nintendo Switch", "iOS", "Android", "その他"]);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const headers = publicApiCacheHeaders(request, "games.catalog");
  if (query.length < 2) return NextResponse.json({ games: [] }, { headers });
  return NextResponse.json({ games: await findD1GameGuideCandidates(getHubD1(), query) }, { headers });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const officialUrl = typeof body.officialUrl === "string" ? body.officialUrl.trim() : "";
  const releaseDate = typeof body.releaseDate === "string" ? body.releaseDate.trim() : "";
  const communityId = typeof body.communityId === "string" ? body.communityId.trim() : "";
  const aliases = Array.isArray(body.aliases) ? [...new Set(body.aliases.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))].slice(0, 10) : [];
  const platforms = Array.isArray(body.platforms) ? [...new Set(body.platforms.filter((value): value is string => typeof value === "string" && PLATFORMS.has(value)))].slice(0, 8) : [];
  const database = getHubD1();
  let actor: Awaited<ReturnType<typeof requireHubSessionProfile>>;
  try {
    actor = await requireHubSessionProfile(request, database);
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json(
        { error: "ゲームを追加するにはログインが必要です。" },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "ログイン状態を確認できませんでした。" },
      { status: 500 },
    );
  }
  if (title.length < 2 || title.length > 120) return NextResponse.json({ error: "作品名は2〜120文字で入力してください。" }, { status: 400 });
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) return NextResponse.json({ error: "URL名は半角英数字とハイフンで入力してください。" }, { status: 400 });
  if (summary.length < 20 || summary.length > 500) return NextResponse.json({ error: "作品説明は20〜500文字で入力してください。" }, { status: 400 });
  if (!platforms.length) return NextResponse.json({ error: "対応機種を1つ以上選んでください。" }, { status: 400 });
  if (officialUrl) {
    try { const url = new URL(officialUrl); if (url.protocol !== "https:") throw new Error(); }
    catch { return NextResponse.json({ error: "公式URLはHTTPSの完全なURLで入力してください。" }, { status: 400 }); }
  }
  if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return NextResponse.json({ error: "発売日を確認してください。" }, { status: 400 });
  try {
    const game = await createD1GameGuideSubmission(database, actor, { title, slug, aliases, summary, officialUrl: officialUrl || undefined, platforms, releaseDate: releaseDate || undefined, communityId: communityId || undefined });
    return NextResponse.json({ game }, { status: 201 });
  } catch (error) {
    if (error instanceof GameSubmissionConflictError) return NextResponse.json({ error: error.message, existing: error.existing }, { status: 409 });
    return NextResponse.json({ error: "ゲームを登録できませんでした。" }, { status: 500 });
  }
}
