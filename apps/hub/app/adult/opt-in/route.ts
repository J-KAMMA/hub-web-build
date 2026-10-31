import { NextResponse } from "next/server";

import {
  ADULT_OPT_IN_COOKIE,
  ADULT_OPT_IN_TTL_SECONDS,
  safeAdultReturnPath,
} from "@/lib/adult/opt-in";
import { setD1AdultOptIn } from "@/lib/server/d1-adult-opt-in";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin, isSecureRequest } from "@/lib/server/hub-auth-route";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

/**
 * 成人表示の有効化と解除。
 *
 * GET は用意しない。設定の変更をリンクで起こせるようにすると、
 * 貼られたURLを踏んだだけで有効になる。
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const form = await request.formData();
  const enable = form.get("enable") === "yes";
  const next = enable ? safeAdultReturnPath(String(form.get("next") ?? "")) : "/";

  // ログインしていればアカウントに保存する。書けなかったら有効にしない——
  // 保存できていないのに見えている状態を作らない。
  const database = getOptionalHubD1();
  const profile = database ? await getOptionalHubSessionProfile(request, database) : null;
  if (profile && database) {
    try {
      await setD1AdultOptIn(database, profile.id, enable);
    } catch {
      return NextResponse.json({ error: "設定を保存できませんでした。" }, { status: 503 });
    }
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  if (enable) {
    response.cookies.set(ADULT_OPT_IN_COOKIE, "1", {
      // 記事の年齢区分と共通の端末設定なので、Hub全体から読める範囲に保存する。
      path: "/",
      maxAge: ADULT_OPT_IN_TTL_SECONDS,
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: "lax",
    });
  } else {
    response.cookies.set(ADULT_OPT_IN_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return response;
}
