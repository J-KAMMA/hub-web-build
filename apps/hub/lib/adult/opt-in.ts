import { cookies } from "next/headers";

import { getD1AdultOptIn } from "@/lib/server/d1-adult-opt-in";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";

/**
 * 成人表示のオプトイン。
 *
 * 「年齢を訊いて通す」ゲートではなく、**利用者が自分で有効にする設定**として扱う。
 * 有効にしていない人には成人層が存在しないのと同じ状態にする——
 * 一般フィード・一般検索・おすすめに出さないのと同じ規律を、直接アクセスにも掛ける。
 *
 * 保存先は2つある。
 *   - ログインしている人: アカウント（profile_adult_opt_in）。端末を変えても保たれ、アプリとも共有される
 *   - ログインしていない人: Hub全体で使うCookie。その端末のそのbrowserにだけ残る
 *
 * ログイン中はアカウント側だけを見る。Cookieが残っていても、アカウントで解除していれば見えない
 * ——2つの保存先が食い違ったとき、利用者の意思として新しいのはアカウント側だからだ。
 */
export const ADULT_OPT_IN_COOKIE = "hub_adult_opt_in";
export const ADULT_OPT_IN_TTL_SECONDS = 60 * 60 * 24 * 180;

export async function hasAdultOptIn(): Promise<boolean> {
  const viewer = await getHubViewer();
  if (viewer) {
    const database = getOptionalHubD1();
    // DBに繋がらないときは、ログイン中の人にも見せない。
    // 判定できないなら閉じる側に倒す。
    if (!database) return false;
    return (await getD1AdultOptIn(database, viewer.id)).enabled;
  }
  return hasAdultOptInCookie();
}

export async function hasAdultOptInCookie(): Promise<boolean> {
  const store = await cookies();
  return store.get(ADULT_OPT_IN_COOKIE)?.value === "1";
}

/**
 * 遷移先の検証。成人層のパスだけを受け付ける。
 * 文字種で絞らないのは、slugに日本語（出演者名・ジャンル名）が入るため。
 */
export function safeAdultReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/adult/")) return "/articles";
  const base = "https://internal.invalid";
  try {
    const resolved = new URL(raw, base);
    if (resolved.origin !== base) return "/articles";
    if (!resolved.pathname.startsWith("/adult/")) return "/articles";
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return "/articles";
  }
}
