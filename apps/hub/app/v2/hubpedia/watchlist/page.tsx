import type { Metadata } from "next";
import Link from "next/link";

import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { listWatches } from "@/lib/server/hubpedia-wiki";

import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ウォッチリスト | Hubpedia | Hub v2", robots: { index: false, follow: false } };

/* Hubpedia のウォッチ中の記事。既存の /hubpedia/watchlist から機能だけを抜いた。 */
export default async function V2HubpediaWatchlistPage() {
  const viewer = await getHubViewer();
  const database = getOptionalHubD1();
  const items = viewer && database ? await listWatches(database, viewer).catch(() => null) : null;
  return (
    <V2PanelPage directoryRail={<V2DirectoryRail back={{ href: "/v2/hubpedia", label: "一覧へ" }} />} currentPath="/v2/hubpedia" title="ウォッチリスト" note={items ? `${items.length}本` : undefined} >
      {!viewer ? (
        <p className="v2-note v2-reply-auth"><Link href="/v2/auth?next=/v2/hubpedia/watchlist">ログイン</Link>するとウォッチ中の記事が見られます。</p>
      ) : items === null ? (
        <div role="status"><p className="v2-error">ウォッチリストを取得できませんでした。</p><a href="/v2/hubpedia/watchlist">再読み込み</a></div>
      ) : items.length ? (
        <ul className="v2-tlist">
          {items.map((item) => (
            <li key={String(item.slug)} className="v2-tcard">
              <Link className="v2-tcard__title" href={`/v2/hubpedia/${encodeURIComponent(String(item.slug))}`}>{String(item.slug)}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <V2Empty title="ウォッチ中の記事はありません" note="記事の画面からウォッチを足せます。" action={{ label: "記事一覧へ", href: "/v2/hubpedia" }} />
      )}
    </V2PanelPage>
  );
}
