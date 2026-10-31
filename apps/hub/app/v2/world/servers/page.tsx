import type { Metadata } from "next";

import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { WorldServerForm } from "@/components/world-server-form";
import { getAppShellData } from "@/lib/server/app-shell-data";

import "../../../world.css";
import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "3Dワールドのサーバを建てる | Hub v2" };

/* 自分のサーバを名簿へ届け出る。建て方は手順書、載せるのはここ（既存と同じ）。 */
export default async function V2WorldServersPage() {
  const { currentProfile } = await getAppShellData();
  return (
    <V2PanelPage currentPath="/v2/world" title="3Dワールドのサーバを建てる">
      <div className="hub-world-build">
        <p>世界はあなたの機械で動きます。Hub は身元と名簿と画面を出します。</p>
        <WorldServerForm me={currentProfile.id} />
      </div>
    </V2PanelPage>
  );
}
