import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { getCachedSuggestedUsers } from "@/lib/server/d1-suggested-users";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

/* 右列の「おすすめのユーザー」。公開データの集計だけを使う。未ログインには、閲覧者を除外しない同じ集計（直近の公開投稿の書き手）を返す。 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ users: await getCachedSuggestedUsers(database, viewer.id) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      /* 空の閲覧者IDは誰とも一致しないので、除外条件は何も除かない。 */
      return NextResponse.json({ users: await getCachedSuggestedUsers(getHubD1(), "") }, { headers: PRIVATE_HEADERS });
    }
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ users: [] }, { status: 503, headers: PRIVATE_HEADERS });
    throw error;
  }
}
