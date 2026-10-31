import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AccountRecoveryPanel } from "@/components/account-recovery-panel";
import { AccountStoragePanel } from "@/components/account-storage-panel";
import { DesktopDeviceList } from "@/components/desktop-device-list";
import { HubAccountControls } from "@/components/hub-account-controls";
import { HubAccountLinkSettings } from "@/components/hub-account-link-settings";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { V2AccountShell } from "@/components/v2/v2-account-shell";
import { getHubLocale } from "@/lib/server/locale";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../v2.css";
import "../../account.css";
import "../v2-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "アカウント | Hub v2",
};

/*
 * アカウントの概要。既存の /account（hub-account-overview.tsx）から、頭と3つの入口を
 * v2 の形にし、ログインとデータ・復旧・連携・Desktop・端末・容量の各パネルは
 * 既存の部品をそのまま置く（認証と鍵を扱うので作り直さない）。
 */
export default async function V2AccountPage() {
  const [viewer, locale] = await Promise.all([getHubViewer(), getHubLocale()]);
  if (!viewer) redirect("/v2/auth?next=/v2/account");
  const japanese = locale === "ja";
  return (
    <V2AccountShell currentPath="/v2/account" title={japanese ? "アカウント" : "Account"} note={`@${viewer.handle}`}>
      <section className="v2-msec" aria-label={japanese ? "公開名" : "Public name"}>
        <p className="v2-note">
          {japanese
            ? `投稿・レビュー・出品では表示名「${viewer.displayName}」を使います。本名・住所・支払いは公開プロフィールと分けて扱います。`
            : `Posts, reviews and listings use the display name "${viewer.displayName}". Legal name, address and payment stay separate from the public profile.`}
        </p>
      </section>
      <div className="hub-account v2-account__panels">
        <section className="hub-account__section" id="account-session" aria-labelledby="account-session-title">
          <header><div><h2 id="account-session-title">{japanese ? "ログインとデータ" : "Sign-in and data"}</h2><p className="hub-account__lead">{japanese ? "ログイン中の端末、データの書き出し、プロフィールの削除申請。" : "Signed-in devices, data export, profile deletion request."}</p></div></header>
          <HubAccountControls basePath="/v2/account" />
        </section>
        <AccountRecoveryPanel />
        {isOptionalServiceEnabled("account-link") ? <HubAccountLinkSettings /> : null}
        <DesktopDeviceList />
        <section className="hub-account__section" id="account-storage" aria-labelledby="account-storage-title">
          <header><div><h2 id="account-storage-title">{japanese ? "ストレージ" : "Storage"}</h2><p className="hub-account__lead">{japanese ? "Hub・Music・Video・Vault で共有する保存容量。" : "Storage shared by Hub, Music, Video and Vault."}</p></div></header>
          <AccountStoragePanel locale={locale} />
        </section>
      </div>
    </V2AccountShell>
  );
}
