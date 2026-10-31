import type { Metadata } from "next";

import { HubPrivacy } from "@/components/hub-privacy";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../legal.css";
import "../v2.css";

export const metadata: Metadata = {
  title: "プライバシーポリシー | Hub v2",
  /* 同じ文が2つの道で出る。索引は既に外へ出ている既存の道へ寄せる。 */
  alternates: { canonical: "/v2/privacy" },
};

/* 本文は components/hub-privacy.tsx。v1 と同じものを使う（2026-09-04）。 */
export default function V2HubPrivacyPage() {
  return (
    <V2PanelPage wide panelOwnsHeading currentPath="/v2/settings" title="プライバシーポリシー">
      <div className="v2-readdoc"><HubPrivacy surface="/v2" /></div>
    </V2PanelPage>
  );
}
