import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DomainPolicies } from "@/components/v2/v2-domain-policies";
import { V2Shell } from "@/components/v2/v2-shell";
import { isHubOperator, isInstanceOperator } from "@/lib/hub-operators";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "連合の方針 | Hub v2",
};

/*
 * 運営者だけの画面。他のハブのドメインごとに allow / limit / suspend を決める。
 * 判定は API（/api/federation/domains）と同じ HUB_OPERATOR_PROFILE_IDS。運営者でなければ存在しない画面として扱う。
 */
export default async function V2OperatorFederationPage() {
  const shell = await getAppShellData();
  const database = getOptionalHubD1();
  const operatorIds = process.env.HUB_OPERATOR_PROFILE_IDS;
  const allowed = database
    ? await isInstanceOperator(database, shell.currentProfile.id, operatorIds)
    : isHubOperator(shell.currentProfile.id, operatorIds);
  if (!allowed) notFound();
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell
      currentPath="/v2/operator/federation"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "連合の方針" : "Federation policy"} />
      <V2DomainPolicies japanese={japanese} />
    </V2Shell>
  );
}
