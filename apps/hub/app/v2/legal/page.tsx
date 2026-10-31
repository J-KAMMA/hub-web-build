import type { Metadata } from "next";

import { HubServiceTerms } from "@/components/hub-service-terms";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../legal.css";
import "../v2-tools.css";
import "../v2.css";

export const metadata: Metadata = {
  title: "サービス条件 | Hub v2",
  /* 同じ文が2つの道で出る。索引は既に外へ出ている既存の道へ寄せる。 */
  alternates: { canonical: "/v2/legal" },
};

/* 本文は components/hub-service-terms.tsx。v1 と同じものを使う（2026-09-04）。 */
export default function V2HubServiceTermsPage() {
  return (
    <V2PanelPage wide panelOwnsHeading currentPath="/v2/settings" title="サービス条件">
      <div className="v2-readdoc"><HubServiceTerms surface="/v2" /></div>
    </V2PanelPage>
  );
}
