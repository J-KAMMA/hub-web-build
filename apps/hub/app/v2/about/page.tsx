import type { Metadata } from "next";

import { HubAbout } from "@/components/hub-about";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getAppShellData } from "@/lib/server/app-shell-data";

import "../v2.css";

export const metadata: Metadata = {
  title: "Hubについて | Hub v2",
  /* 同じ文が2つの道で出る。索引は既に外へ出ている既存の道へ寄せる。 */
  alternates: { canonical: "/v2/about" },
};

/* 本文は components/hub-about.tsx。v1 と同じものを使う（2026-09-04）。 */
export default async function V2AboutPage() {
  const { currentProfile } = await getAppShellData();
  return (
    <V2PanelPage wide currentPath="/v2/settings" title="Hubについて">
      <div className="v2-readdoc"><HubAbout displayName={currentProfile.displayName} /></div>
    </V2PanelPage>
  );
}
