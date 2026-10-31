import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdReportForm } from "@/components/ad-report-form";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { verifyHubAdMeasurementToken } from "@/lib/server/hub-ads-token";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "この広告について | Hub v2",
};

export default async function V2AdInformationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const payload = verifyHubAdMeasurementToken(token);
  if (!payload) notFound();
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "広告" : "Ads"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/advertising"><span className="v2-nav__label">{japanese ? "広告" : "Advertising"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath="/v2/ads/about"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "広告" : "Ads"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "この広告について" : "About this ad"} />
      <div className="ad-info-page">
        <span>HUB ADS</span>
        <p>この広告は、ページの内容、言語、掲載場所など許可された文脈情報を使って選ばれました。個人を特定する広告プロフィールは作成しません。</p>
        <p>氏名、メールアドレス、電話番号、正確な位置、閲覧履歴、ウォレット情報は広告選択に使用しません。</p>
        <p>広告ID: <code>{payload.tokenId.slice(0, 8)}</code></p>
        <AdReportForm token={token} />
        <Link href="/v2">Hubへ戻る</Link>
      </div>
    </V2Shell>
  );
}
