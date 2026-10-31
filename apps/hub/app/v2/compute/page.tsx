import type { Metadata } from "next";

import { ComputeWorkbench } from "@/components/compute-workbench";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "計算 | Hub v2" };

export default function V2ComputePage() {
  return (
    <V2PanelPage panelOwnsHeading wide currentPath="/v2/compute" title="計算">
      <ComputeWorkbench />
    </V2PanelPage>
  );
}
