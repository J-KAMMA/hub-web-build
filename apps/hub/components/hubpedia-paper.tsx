"use client";

import type { getHubpediaResearchWork } from "@/lib/server/hubpedia-research-knowledge";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

/*
 * 論文の本文（2026-09-04）。
 *
 * もとは app/hubpedia/papers/[id]/page.tsx に直に書いてあった。v2 にも同じ画面が
 * 要るので、**複製せず部品に切り出す**。同じ見た目を2か所に書くと必ずずれる。
 *
 * 行き先は今いる面の中へ。Hubpedia の一覧も記事も v2 に在る。
 */
/*
 * 型は取得する関数から引く。手で書き写すと必ずずれる
 * （一度書き写して型検査が2件落ちた）。
 */
export type HubpediaPaper = NonNullable<Awaited<ReturnType<typeof getHubpediaResearchWork>>>;

export function HubpediaPaper({ work }: { work: HubpediaPaper }) {
  const surface = useHubUiSurface();
  const sections = [
    ["研究目的", work.researchQuestion],
    ["方法", work.methods],
    ["結果", work.results],
    ["新規性", work.novelty],
    ["限界", work.limitations],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="hubpedia hubpedia-paper">
      <nav className="hubpedia-article__crumb">
        <a href={hubSurfacePath(surface, "/hubpedia")}>Hubpedia</a><span>/</span><span>出典資料</span>
      </nav>
      <header className="hubpedia-paper__header">
        <span>論文・研究資料</span>
        <h1>{work.title}</h1>
        {work.authors.length ? <p>{work.authors.join(", ")}</p> : null}
        <dl>
          <div><dt>査読状態</dt><dd>{work.peerReviewState}</dd></div>
          <div><dt>証拠種別</dt><dd>{work.evidenceType}</dd></div>
          {work.publishedAt ? <div><dt>公開日</dt><dd>{work.publishedAt.slice(0, 10)}</dd></div> : null}
          {work.doi ? <div><dt>DOI</dt><dd>{work.doi}</dd></div> : null}
          {work.arxivId ? <div><dt>arXiv</dt><dd>{work.arxivId}</dd></div> : null}
        </dl>
        <a className="hubpedia-paper__original" href={work.canonicalUrl} rel="noreferrer">一次資料を開く</a>
      </header>
      {work.abstract ? <section><h2>要旨</h2><p>{work.abstract}</p></section> : null}
      {sections.map(([heading, body]) => <section key={heading}><h2>{heading}</h2><p>{body}</p></section>)}
      {work.articles.length ? (
        <section>
          <h2>この資料を参照する百科項目</h2>
          <ul>
            {work.articles.map((article) => (
              <li key={`${article.slug}:${article.role}`}>
                <a href={hubSurfacePath(surface, `/hubpedia/${article.slug}`)}>{String(article.title ?? article.slug)}</a>
                <span>{String(article.role)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
