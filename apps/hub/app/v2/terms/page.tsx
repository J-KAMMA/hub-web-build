import type { Metadata } from "next";

import { HubTerms } from "@/components/hub-terms";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../legal.css";
import "../v2.css";

export const metadata: Metadata = {
  title: "利用規約 | Hub v2",
  /* 同じ文が2つの道で出る。索引は既に外へ出ている既存の道へ寄せる。 */
  alternates: { canonical: "/v2/terms" },
};

/* 本文は components/hub-terms.tsx。v1 と同じものを使う（2026-09-04）。 */
export default function V2HubTermsPage() {
  return (
    <V2PanelPage wide currentPath="/v2/settings" title="利用規約">
      <div className="v2-readdoc"><HubTerms surface="/v2" /></div>
    </V2PanelPage>
  );
}
