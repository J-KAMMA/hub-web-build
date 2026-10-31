import type { Metadata } from "next";
import Link from "next/link";

import { ModerationAppealForm } from "@/components/moderation-appeal-form";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../v2-tools.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "異議申し立て | Hub v2",
};

export default async function V2AppealPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "関連する文書" : "Related documents"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/terms"><span className="v2-nav__label">{japanese ? "利用規約" : "Terms"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/legal"><span className="v2-nav__label">{japanese ? "サービス条件" : "Service terms"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/copyright"><span className="v2-nav__label">{japanese ? "著作権侵害の通報" : "Copyright notice"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath="/v2/appeal"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "申し立て" : "Appeal"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "異議申し立て" : "Appeal"} />
      <ModerationAppealForm />
    </V2Shell>
  );
}
