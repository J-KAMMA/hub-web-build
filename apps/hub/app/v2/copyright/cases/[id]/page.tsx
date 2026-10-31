import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CopyrightCaseResponse } from "@/components/copyright-case-response";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { loadAuthorCase } from "@/lib/server/copyright-case-views";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "著作権の申告 | Hub v2",
  robots: { index: false, follow: false },
};

/*
 * 投稿者の頁。照会の通知から開く。本人（対象の投稿者）にだけ見せ、それ以外には「ない」ものとして 404 を返す。
 */
export default async function V2CopyrightCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await getAppShellData();
  const profileId = shell.currentProfile.id;
  const db = getOptionalHubD1();
  const now = new Date().toISOString();
  const view = db && profileId ? await loadAuthorCase(db, id, profileId, now) : null;
  if (!view) notFound();

  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "関連する文書" : "Related documents"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/copyright"><span className="v2-nav__label">{japanese ? "著作権侵害の通報" : "Copyright notice"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/appeal"><span className="v2-nav__label">{japanese ? "異議申し立て" : "Appeal"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/terms"><span className="v2-nav__label">{japanese ? "利用規約" : "Terms"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath="/v2/copyright"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "著作権" : "Copyright"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn viewerId={profileId} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title="著作権の申告について" />
      <CopyrightCaseResponse view={view} now={now} />
    </V2Shell>
  );
}
