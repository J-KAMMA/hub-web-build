import type { Metadata } from "next";
import Link from "next/link";

import { IntentFulfillmentPanel } from "@/components/intent-fulfillment-panel";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "履行確認 | Hub v2",
};

export default async function V2IntentFulfillmentPage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "Intent" : "Intent"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/intent"><span className="v2-nav__label">{japanese ? "Intent作業" : "Intent work"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/ai"><span className="v2-nav__label">{japanese ? "AI" : "AI"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      currentPath={`/v2/intent/${intentId}/fulfill`}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "履行確認" : "Fulfillment"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "履行確認" : "Fulfillment"} />
      <IntentFulfillmentPanel intentId={intentId} />
    </V2Shell>
  );
}
