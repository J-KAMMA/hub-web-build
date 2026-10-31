import { NextResponse } from "next/server";

import { parseProfileExternalLinks, ProfileExternalLinkError } from "@/lib/profile-external-links";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { verifyProfileLinks } from "@/lib/server/profile-link-verification";
import { replaceD1ProfileLinks } from "@/lib/server/profile-public-details";

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const body = await request.json() as { links?: unknown };
    const links = parseProfileExternalLinks(body.links);
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const saved = await replaceD1ProfileLinks(database, viewer.id, links);
    // 保存したら rel="me" を確かめる。確認が失敗しても保存は成功のまま返す。
    const verifications = await verifyProfileLinks(database, viewer, saved.map((link) => link.url)).catch(() => ({}));
    return NextResponse.json({ links: saved, verifications });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "プロフィールを更新できません。しばらくしてから再度お試しください。" },
        { status: 503 },
      );
    }
    const message = error instanceof ProfileExternalLinkError
      ? error.message
      : "リンクを保存できませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
