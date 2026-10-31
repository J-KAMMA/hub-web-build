import { assessCommercialReuse, assessEvidenceUse } from "@/lib/encyclopedia/source-license-policy";

export type ArticleDisplaySource = {
  url: string;
  title?: string | null;
  publisher?: string | null;
  license?: string | null;
  sourceType?: string | null;
  reliabilityTier?: string | null;
  metadata?: Record<string, unknown> | null;
};

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function reviewedDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(date)
    : value;
}

export function SourceDisclosure({ sources }: { sources: readonly ArticleDisplaySource[] }) {
  if (sources.length === 0) {
    return <section className="hubpedia-sources" aria-labelledby="hubpedia-sources-title">
      <h2 id="hubpedia-sources-title">出典と利用条件</h2>
      <p className="hubpedia-sources__notice">この記事には、公開できる出典情報が登録されていません。権利確認済みの資料が追加されるまで、外部資料の原文・画像・図表を再利用できるとは判断しないでください。</p>
    </section>;
  }

  return <section className="hubpedia-sources" aria-labelledby="hubpedia-sources-title">
    <h2 id="hubpedia-sources-title">出典と利用条件</h2>
    <p className="hubpedia-sources__notice">出典として参照できることと、資料の文章・画像・図表を転載できることは別です。各資料の表示は、Hubpediaが確認した利用範囲を示します。</p>
    <ol className="hubpedia-sources__list">
      {sources.map((source, index) => {
        const evidence = assessEvidenceUse(source);
        const commercial = assessCommercialReuse(source);
        const title = source.title?.trim() || sourceHost(source.url);
        const publisher = source.publisher?.trim() || "発行元未登録";
        const reviewAt = evidence.allowed ? evidence.reviewedAt : commercial.allowed ? commercial.reviewedAt : null;
        const reuseLabel = commercial.allowed ? "商用で再利用可" : evidence.allowed ? "引用・事実確認のみ" : "権利確認が必要";
        return <li id={`source-${index + 1}`} key={`${source.url}:${index}`}>
          <div className="hubpedia-sources__heading">
            <span className="hubpedia-sources__number">{index + 1}</span>
            <div>
              <a href={source.url} rel="noreferrer" target="_blank">{title}</a>
              <p>{publisher}<span aria-hidden="true">・</span>{sourceHost(source.url)}</p>
            </div>
          </div>
          <dl>
            <div><dt>利用範囲</dt><dd data-status={commercial.allowed ? "allowed" : evidence.allowed ? "citation" : "review"}>{reuseLabel}</dd></div>
            <div><dt>ライセンス</dt><dd>{commercial.allowed ? <a href={commercial.licenseUrl} rel="noreferrer" target="_blank">{commercial.license}</a> : source.license || "転載条件は未確認"}</dd></div>
            {reviewAt ? <div><dt>確認日</dt><dd>{reviewedDate(reviewAt)}</dd></div> : null}
          </dl>
          {!commercial.allowed ? <small>原資料の表現、画像、図表をコピー・翻訳・改変して再利用できるという意味ではありません。</small> : null}
        </li>;
      })}
    </ol>
  </section>;
}
