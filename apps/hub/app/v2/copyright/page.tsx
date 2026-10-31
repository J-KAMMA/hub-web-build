import type { Metadata } from "next";
import Link from "next/link";

import { CopyrightNoticeForm } from "@/components/copyright-notice-form";
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
  title: "著作権侵害の通報 | Hub v2",
};

export default async function V2CopyrightPage() {
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
        <li><Link className="v2-nav__item" href="/v2/appeal"><span className="v2-nav__label">{japanese ? "異議申し立て" : "Appeal"}</span></Link></li>
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
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "著作権侵害の通報" : "Copyright notice"} />
      <CopyrightNoticeForm />
    </V2Shell>
  );
}
