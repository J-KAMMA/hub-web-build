import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { readProfileLinkVerifications, verifyProfileLinks } from "@/lib/server/profile-link-verification";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function errorResponse(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "確認できません。しばらくしてから再度お試しください。" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json({ error: "リンクを確認できませんでした。" }, { status: 500, headers: PRIVATE_HEADERS });
}

async function ownLinkUrls(database: ReturnType<typeof getHubD1>, profileId: string) {
  const rows = await database.prepare("SELECT label, url FROM profile_external_links WHERE profile_id = ? ORDER BY position")
    .bind(profileId).all<{ label: string; url: string }>();
  return rows.results;
}

/** 自分のリンクと、保存済みの確認結果。外への取得はしない。 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const [links, verifications] = await Promise.all([ownLinkUrls(database, viewer.id), readProfileLinkVerifications(database, viewer.id)]);
    return NextResponse.json({ handle: viewer.handle, links, verifications }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

/** 「確認する」ボタン。間隔（確認済み24時間・未確認10分）の内側のリンクは取りに行かない。 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const links = await ownLinkUrls(database, viewer.id);
    const verifications = await verifyProfileLinks(database, viewer, links.map((link) => link.url));
    return NextResponse.json({ handle: viewer.handle, links, verifications }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
