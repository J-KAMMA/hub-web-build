import type { Metadata } from "next";

import { HubAuthPage } from "@/components/hub-auth-page";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import {
  hubReauthenticationRequested,
  safeHubReturnPath,
} from "@/lib/auth-return-path";

import "../../auth/auth.css";
import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-account.css";

export const metadata: Metadata = {
  title: "ログイン | Hub v2",
  /* 同じ入口が2つの道で出る。索引は既存の道へ寄せる。 */
  alternates: { canonical: "/v2/auth" },
};

/* 戻り先の画面名。ログインを求めた画面が分かるように、auth の上に1行だけ出す。 */
const ORIGIN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["/v2/account/identity", "本人・事業者確認"],
  ["/v2/account/payment", "支払いと売上"],
  ["/v2/account/transactions", "取引"],
  ["/v2/account", "アカウント"],
  ["/v2/creator", "クリエイターセンター"],
  ["/v2/earnings", "収益"],
  ["/v2/node", "Personal Node"],
  ["/v2/onboarding", "初期設定"],
  ["/v2/wallet/tax", "ウォレットの税情報"],
  ["/v2/wallet", "ウォレット"],
  ["/v2/developers/services", "開発者サービス"],
  ["/v2/settings", "設定"],
  ["/v2/messages", "メッセージ"],
  ["/v2/notifications", "通知"],
  ["/v2/bookmarks", "ブックマーク"],
];

function originLabel(path: string): string | null {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const hit = ORIGIN_LABELS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return hit ? hit[1] : null;
}

/* 本文は components/hub-auth-page.tsx。v1 と同じものを使う（2026-09-05）。 */
export default async function V2HubAuthPage({
  searchParams
}: {
  searchParams: Promise<{
    next?: string | string[];
    reauth?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const returnTo = safeHubReturnPath(params.next);
  const origin = originLabel(returnTo);
  return (
    <V2PanelPage skin="luxe" wide panelOwnsHeading currentPath="/v2/auth" title="ログイン">
      {origin ? <p className="hub-auth-origin" role="status">{origin}を見るにはログインしてください。</p> : null}
      <HubAuthPage
        returnTo={safeHubReturnPath(params.next)}
        reauthenticate={hubReauthenticationRequested(params.reauth)}
        surface="/v2"
      />
    </V2PanelPage>
  );
}
