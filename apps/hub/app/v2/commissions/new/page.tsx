import type { Metadata } from "next";

import { CommissionsFrame } from "@/components/v2/v2-commissions-frame";
import { V2CommissionRequestForm } from "@/components/v2/v2-commissions";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getPublicWorkOffer, type PublicWorkOffer } from "@/lib/server/d1-work";
import { getHubLocale } from "@/lib/server/locale";
import { getWorkPageViewer } from "@/lib/server/work-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "依頼を作る | Hub v2",
};

/* /v2/commissions/new?to=<ハンドル>。受付が閉じている・満員の作り手には、フォームを出さない。 */
export default async function V2CommissionNewPage({ searchParams }: { searchParams: Promise<{ to?: string | string[] }> }) {
  const [locale, shell, query] = await Promise.all([getHubLocale(), getAppShellData(), searchParams]);
  const japanese = locale === "ja";
  const to = typeof query.to === "string" ? query.to.replace(/^@/, "").slice(0, 64) : "";
  const { database, viewerId } = await getWorkPageViewer("/v2/commissions/new");
  let worker: PublicWorkOffer | null = null;
  let canAdult = false;
  if (database && to) {
    try {
      worker = await getPublicWorkOffer(database, to);
      if (viewerId) {
        const row = await database.prepare("SELECT 1 AS ok FROM hub_selective_credentials WHERE profile_id = ? AND credential_type = 'adult_verified' AND expires_at > ? LIMIT 1")
          .bind(viewerId, new Date().toISOString()).first<{ ok: number }>();
        canAdult = Boolean(row);
      }
    } catch {
      worker = null;
    }
  }
  const open = worker && worker.offer.accepting && !worker.full && worker.profile.id !== viewerId;
  return (
    <CommissionsFrame currentPath="/v2/commissions/new" title={japanese ? "依頼を作る" : "New request"} japanese={japanese} shell={shell} signedIn={Boolean(viewerId)}>
      {!viewerId ? (
        <V2State kind="signedOut" icon="inbox" next={`/v2/commissions/new?to=${encodeURIComponent(to)}`} japanese={japanese} note={japanese ? "ログインすると、依頼を出せます。" : "Sign in to send a request."} />
      ) : !worker ? (
        <V2State kind="empty" icon="inbox" japanese={japanese} note={japanese ? "宛先の作り手が見つかりません。" : "That creator was not found."} />
      ) : !open ? (
        <V2State kind="empty" icon="inbox" japanese={japanese} note={japanese ? "この作り手は、いま依頼を受け付けていません。" : "This creator is not accepting requests right now."} />
      ) : (
        <V2CommissionRequestForm workerHandle={worker.profile.handle} workerName={worker.profile.displayName} offer={worker.offer} canAdult={canAdult} japanese={japanese} />
      )}
    </CommissionsFrame>
  );
}
