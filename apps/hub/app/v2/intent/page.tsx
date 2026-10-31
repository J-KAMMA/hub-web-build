import type { Metadata } from "next";

import { IntentRunCenter } from "@/components/intent-run-center";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../v2.css";
import "../v2-tools.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "意図 | Hub v2" };

/* 意図の実行の中心。既存の IntentRunCenter を列の幅に置く。 */
export default function V2IntentPage() {
  return (
    <V2PanelPage wide currentPath="/v2/intent" title="意図">
      <div className="v2-tools-intent">
        <IntentRunCenter project="personal" />
      </div>
    </V2PanelPage>
  );
}
