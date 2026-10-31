import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DeveloperServiceCenter } from "@/components/developer-service-center";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../v2.css";
import "../../v2-account.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "開発者サービス | Hub v2" };

/* 開発者サービス（API鍵・課金・利用量）。既存の DeveloperServiceCenter をそのまま。ログインは既存と同じく必須。 */
export default async function V2DeveloperServicesPage() {
  const viewer = await getHubViewer();
  if (!viewer) redirect("/v2/auth?next=/v2/developers/services");
  return (
    <V2PanelPage currentPath="/v2/developers/services" title="開発者サービス">
      <div className="v2-devforms"><DeveloperServiceCenter /></div>
    </V2PanelPage>
  );
}
