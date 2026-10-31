import type { Metadata } from "next";

import { CommissionsFrame } from "@/components/v2/v2-commissions-frame";
import { V2CommissionSettings } from "@/components/v2/v2-commissions";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getD1AdultOptIn } from "@/lib/server/d1-adult-opt-in";
import { DEFAULT_WORK_OFFER, getWorkOffer, type WorkOffer } from "@/lib/server/d1-work";
import { getHubLocale } from "@/lib/server/locale";
import { getWorkPageViewer } from "@/lib/server/work-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "依頼の受付設定 | Hub v2",
};

/* 作り手の受付設定。閉じている間は誰も依頼できない。 */
export default async function V2CommissionSettingsPage() {
  const [locale, shell] = await Promise.all([getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const { database, viewerId } = await getWorkPageViewer("/v2/commissions/settings");
  let offer: WorkOffer = { ...DEFAULT_WORK_OFFER };
  let adultOptIn = false;
  if (database && viewerId) {
    try {
      [offer, adultOptIn] = await Promise.all([getWorkOffer(database, viewerId), getD1AdultOptIn(database, viewerId).then((value) => value.enabled)]);
    } catch {
      /* 取れなければ既定の閉じた状態で出す。 */
    }
  }
  return (
    <CommissionsFrame currentPath="/v2/commissions/settings" title={japanese ? "受付設定" : "Offer settings"} japanese={japanese} shell={shell} signedIn={Boolean(viewerId)}>
      {viewerId ? (
        <V2CommissionSettings offer={offer} adultOptIn={adultOptIn} japanese={japanese} />
      ) : (
        <V2State kind="signedOut" icon="inbox" next="/v2/commissions/settings" japanese={japanese} note={japanese ? "ログインすると、依頼の受付を設定できます。" : "Sign in to set up your offer."} />
      )}
    </CommissionsFrame>
  );
}
