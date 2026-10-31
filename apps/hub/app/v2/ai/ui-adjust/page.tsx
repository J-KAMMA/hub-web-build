import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { UiAdjustmentStudio } from "@/components/ui-adjustment-studio";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-luxe.css";
import "../../v2-luxe-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "UI調整スタジオ | Hub v2",
  description: "Hubの実画面を見ながらUIの調整値を作る開発専用ツール",
};

export default async function V2UiAdjustPage() {
  const localDevelopmentRuntime = process.env.CLOUDFLARE_BINDINGS_LOCAL === "true";
  if (process.env.NODE_ENV === "production" && !localDevelopmentRuntime) notFound();
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "AI" : "AI"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/ai"><span className="v2-nav__label">{japanese ? "AIワークベンチ" : "AI workbench"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      skin="luxe"
      currentPath="/v2/ai/ui-adjust"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "UI調整" : "UI adjust"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "UI調整スタジオ" : "UI adjustment studio"} />
      <UiAdjustmentStudio />
    </V2Shell>
  );
}
