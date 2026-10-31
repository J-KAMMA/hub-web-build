import type { Metadata } from "next";
import Link from "next/link";

import { CommissionsFrame } from "@/components/v2/v2-commissions-frame";
import { WorkStateBadge } from "@/components/v2/v2-commissions";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listWorkContracts, type WorkListItem } from "@/lib/server/d1-work";
import { getHubLocale } from "@/lib/server/locale";
import { getWorkPageViewer } from "@/lib/server/work-page";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "依頼 | Hub v2",
};

function Rows({ items, japanese }: { items: WorkListItem[]; japanese: boolean }) {
  return (
    <ul className="v2-work__list">
      {items.map((item) => (
        <li key={item.contractId}>
          <Link className="v2-work__row" href={`/v2/commissions/${item.contractId}`}>
            <span className="v2-work__row-title">{item.title}</span>
            <span className="v2-work__row-sub">{item.otherName} / {item.category} / {item.priceUnits.toLocaleString()} JPYC</span>
            <WorkStateBadge state={item.state} japanese={japanese} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* 指名依頼の入口。受けた依頼（作り手として）と出した依頼（依頼者として）。入金前の依頼は作り手には並ばない。 */
export default async function V2CommissionsPage() {
  const [locale, shell] = await Promise.all([getHubLocale(), getAppShellData()]);
  const japanese = locale === "ja";
  const { database, viewerId } = await getWorkPageViewer("/v2/commissions");
  let received: WorkListItem[] = [];
  let sent: WorkListItem[] = [];
  if (database && viewerId) {
    try {
      [received, sent] = await Promise.all([listWorkContracts(database, viewerId, "worker"), listWorkContracts(database, viewerId, "client")]);
    } catch {
      /* 取れなければ空として出す。 */
    }
  }
  return (
    <CommissionsFrame currentPath="/v2/commissions" title={japanese ? "依頼" : "Commissions"} japanese={japanese} shell={shell} signedIn={Boolean(viewerId)}>
      {viewerId ? (
        <div className="v2-work">
          <section className="v2-work__section" aria-label={japanese ? "受けた依頼" : "Received"}>
            <h2 className="v2-work__heading">{japanese ? "受けた依頼" : "Received"}</h2>
            {received.length ? <Rows items={received} japanese={japanese} /> : (
              <V2State kind="empty" compact icon="inbox" japanese={japanese} note={japanese ? "受けた依頼はまだありません。受付設定で受付を開くと、入金済みの依頼がここに並びます。" : "No requests yet. Open your offer settings to start accepting."} action={{ label: japanese ? "受付設定を開く" : "Offer settings", href: "/v2/commissions/settings" }} />
            )}
          </section>
          <section className="v2-work__section" aria-label={japanese ? "出した依頼" : "Sent"}>
            <h2 className="v2-work__heading">{japanese ? "出した依頼" : "Sent"}</h2>
            {sent.length ? <Rows items={sent} japanese={japanese} /> : (
              <V2State kind="empty" compact icon="inbox" japanese={japanese} note={japanese ? "出した依頼はまだありません。作り手のプロフィールから依頼できます。" : "Nothing sent yet. Request from a creator's profile."} />
            )}
          </section>
        </div>
      ) : (
        <V2State kind="signedOut" icon="inbox" next="/v2/commissions" japanese={japanese} note={japanese ? "ログインすると、依頼を出したり受けたりできます。" : "Sign in to send or receive commissions."} />
      )}
    </CommissionsFrame>
  );
}
