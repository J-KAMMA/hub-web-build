import type { Metadata } from "next";

import { CommissionsFrame } from "@/components/v2/v2-commissions-frame";
import { V2CommissionContract } from "@/components/v2/v2-commissions";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { contentFileDepsFromEnv } from "@/lib/server/content-files";
import { getWorkContractView, syncWorkContractState, type WorkContractView } from "@/lib/server/d1-work";
import { getHubLocale } from "@/lib/server/locale";
import { workStateDeps } from "@/lib/server/work-route";
import { getWorkPageViewer } from "@/lib/server/work-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "依頼の契約 | Hub v2",
  robots: { index: false, follow: false },
};

/*
 * 契約の画面。当事者の2人だけが開ける (それ以外は「見つからない」と同じ答え)。開くたびに Commerce の署名つきの状態を
 * 読み直し、確かめられなければ「確認中」と出して操作を出さない。成人向けの契約は検索・通知・OGP のどこにも出ない。
 */
export default async function V2CommissionContractPage({ params }: { params: Promise<{ contractId: string }> }) {
  const [locale, shell, { contractId }] = await Promise.all([getHubLocale(), getAppShellData(), params]);
  const japanese = locale === "ja";
  const { database, viewerId } = await getWorkPageViewer(`/v2/commissions/${contractId}`);
  let view: WorkContractView | null = null;
  let checking = false;
  if (database && viewerId) {
    try {
      const synced = await syncWorkContractState(database, contractId, workStateDeps(), contentFileDepsFromEnv());
      checking = synced?.checking ?? true;
      view = await getWorkContractView(database, viewerId, contractId);
    } catch {
      view = null;
    }
  }
  return (
    <CommissionsFrame currentPath="/v2/commissions" title={view?.title ?? (japanese ? "依頼の契約" : "Commission")} japanese={japanese} shell={shell} signedIn={Boolean(viewerId)}>
      {!viewerId ? (
        <V2State kind="signedOut" icon="inbox" next={`/v2/commissions/${contractId}`} japanese={japanese} note={japanese ? "ログインすると、依頼を開けます。" : "Sign in to open this commission."} />
      ) : !view ? (
        <V2State kind="empty" icon="inbox" japanese={japanese} note={japanese ? "この依頼は見つかりません。" : "This commission was not found."} action={{ label: japanese ? "依頼の一覧へ" : "Back to requests", href: "/v2/commissions" }} />
      ) : (
        <V2CommissionContract view={{ ...view, checking }} japanese={japanese} />
      )}
    </CommissionsFrame>
  );
}
