import type { Metadata } from "next";

import { V2AccessGateEditor } from "@/components/v2/v2-access-gate-editor";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "鍵 | Hub v2" };

/* トークンの保有を条件にした閲覧条件（門）の管理。設計は docs/hub-token-gates/DESIGN.md。 */
export default function V2AccessGatesPage() {
  return (
    <V2PanelPage skin="luxe" wide panelOwnsHeading currentPath="/v2/creator" title="鍵">
      <V2AccessGateEditor />
    </V2PanelPage>
  );
}
