import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { OnboardingForm } from "@/components/onboarding-form";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2PageHeader } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getOnboardingPageData } from "@/lib/server/onboarding-page-data";
import { v2NavItems } from "@/lib/v2-nav";
import { safeHubReturnPath } from "@/lib/auth-return-path";

import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hubをはじめる | Hub v2",
};

/*
 * はじめの設定。興味・人・コミュニティを選んで POST /api/onboarding。
 * 欄は既存の部品をそのまま置く（送り先と選び方は既存と同じでなければならない）。
 */
export default async function V2OnboardingPage({ searchParams }: {
  searchParams: Promise<{next?: string | string[]}>;
}) {
  const params = await searchParams;
  const returnTo = params.next === undefined ? undefined : safeHubReturnPath(params.next);
  const onboardingHref = returnTo === undefined ? "/v2/onboarding" : `/v2/onboarding?next=${encodeURIComponent(returnTo)}`;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const [shell, data] = await Promise.all([getAppShellData(), getOnboardingPageData()]);
  if (!data) redirect(`/v2/auth?next=${encodeURIComponent(onboardingHref)}`);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  return (
    <V2Shell
      skin="luxe"
      currentPath="/v2/onboarding"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      {/* 見出しは本体の h1 が持つ。枠の見出しと副題は出さない（二重にしない）。 */}
      <V2PageHeader panelOwnsHeading title={japanese ? "Hub をはじめる" : "Get started"} />
      <div className="v2-account__panels">
        <OnboardingForm data={data} returnTo={returnTo} />
      </div>
    </V2Shell>
  );
}
