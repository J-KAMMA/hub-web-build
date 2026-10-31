import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { searchByTag, TAG_KINDS, tagKey, type TagKind } from "@/lib/server/d1-tag-search";
import { canonicalTagSlug } from "@/lib/tag-href";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのタグ横断検索。Web版 /v2/tag/[tag] と同じ
 * searchByTag（可視リンクだけを読む）を使うので、6種類が同じ内容で返る。
 * ?kind= で1種類に絞り、?cursor= で続きを取る。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tag: string }> },
) {
  const { tag: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 復号できなければ生の値で検証する。
  }
  const slug = decoded.length <= 100 ? canonicalTagSlug(decoded) : null;
  const key = slug ? tagKey(decodeURIComponent(slug)) : "";
  if (!key) {
    return NextResponse.json({ error: "タグの指定が正しくありません。" }, { status: 400 });
  }
  const url = new URL(request.url);
  const requestedKind = url.searchParams.get("kind");
  const kind = (TAG_KINDS as readonly string[]).includes(requestedKind ?? "") ? requestedKind as TagKind : null;
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    const result = await searchByTag(database, key, viewer?.id ?? null, { kind, cursor: kind ? url.searchParams.get("cursor") : null });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    throw error;
  }
}
