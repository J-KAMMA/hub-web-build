import Link from "next/link";

import type { ArticleSeriesContext } from "@/lib/server/d1-user-article-series";

/**
 * 読む画面のシリーズ箱。シリーズの題と、シリーズ内の前後の記事だけ。
 * 「同じ書き手の前後」(V2ArticleNeighbours) とは別で、著者が決めた順序に従う。
 */
export function V2ArticleSeriesBox({ series, japanese }: { series: ArticleSeriesContext; japanese: boolean }) {
  return (
    <aside className="v2-series-box" aria-label={japanese ? "シリーズ" : "Series"}>
      <div className="v2-series-box__head">
        <small>{japanese ? "シリーズ" : "Series"}</small>
        <Link href={`/v2/articles/series/${encodeURIComponent(series.id)}`}>{series.title}</Link>
        <small>{series.position} / {series.total}</small>
      </div>
      {series.previous || series.next ? (
        <nav className="v2-series-box__nav" aria-label={japanese ? "シリーズの前後の記事" : "Previous and next in series"}>
          {series.previous
            ? <Link href={`/v2/articles/${series.previous.id}`}><small>{japanese ? "シリーズの前" : "Previous"}</small><strong>{series.previous.title}</strong></Link>
            : <span />}
          {series.next
            ? <Link className="v2-series-box__next" href={`/v2/articles/${series.next.id}`}><small>{japanese ? "シリーズの次" : "Next"}</small><strong>{series.next.title}</strong></Link>
            : <span />}
        </nav>
      ) : null}
    </aside>
  );
}
