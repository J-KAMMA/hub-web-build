import { WIKIPEDIA_LICENSE_URL } from "@/lib/encyclopedia/wikipedia/constants";
import type { WikipediaBaseArticle } from "@/lib/encyclopedia/wikipedia/read";

import "./hubpedia-wikipedia-attribution.css";

/*
 * 日本語版ウィキペディアから取り込んだ記事の帰属表示（2026-10-30、所有者承認）。
 * CC BY-SA 4.0 の帰属として、元の頁・履歴・ライセンスへのリンクを必ず出す。Hub の台帳による確認は済んでいない。
 */
export function HubpediaWikipediaAttribution({ article, japanese }: { article: Pick<WikipediaBaseArticle, "title" | "sourceUrl" | "historyUrl" | "revisionTimestamp" | "verificationStatus">; japanese: boolean }) {
  const date = article.revisionTimestamp.slice(0, 10);
  return (
    <aside className="hubpedia-wikipedia-attribution" data-verification={article.verificationStatus} aria-label={japanese ? "出典と帰属" : "Source and attribution"}>
      <p className="hubpedia-wikipedia-attribution__text">
        {japanese
          ? <>この記事は日本語版ウィキペディアの記事『{article.title}』を元にしています（CC BY-SA 4.0）。</>
          : <>This article is based on the Japanese Wikipedia article “{article.title}” (CC BY-SA 4.0).</>}
      </p>
      <p className="hubpedia-wikipedia-attribution__links">
        <a href={article.sourceUrl} target="_blank" rel="noopener noreferrer">{japanese ? "元の記事" : "Original page"}</a>
        <a href={article.historyUrl} target="_blank" rel="noopener noreferrer">{japanese ? "編集履歴（執筆者一覧）" : "Page history (authors)"}</a>
        <a href={WIKIPEDIA_LICENSE_URL} target="_blank" rel="noopener noreferrer license">{japanese ? "ライセンス: CC BY-SA 4.0" : "Licence: CC BY-SA 4.0"}</a>
      </p>
      <p className="hubpedia-wikipedia-attribution__status">
        {article.verificationStatus === "verified"
          ? (japanese ? `Hub の台帳で確認済みです。取り込み元の版: ${date}` : `Verified by the Hub ledger. Imported revision: ${date}`)
          : (japanese ? `Hub ではまだ確認していません。取り込み元の版: ${date}。内容は誤りや古い記述を含むことがあります。` : `Not yet verified by Hub. Imported revision: ${date}. It may contain errors or outdated statements.`)}
      </p>
    </aside>
  );
}
