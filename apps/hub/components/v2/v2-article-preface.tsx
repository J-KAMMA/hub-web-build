import { ArticleBodyView } from "@/components/article-body-view";

/*
 * 鍵の手前に見せる部分。書き手が誰にでも読めるように書いた文章で、本文から作ったものではない。
 * 本文と同じ描画（ArticleBodyView）を通すので、HTMLは注入しない。
 * 空なら何も出さない。区切りの線は、手前の部分があるときだけ出す。
 */
export function V2ArticlePreface({ preface, gated }: { preface: string; gated: boolean }) {
  const text = preface.trim();
  if (!text) return null;
  return (
    <>
      <div data-article-preface="">
        <ArticleBodyView body={text} className="v2-prose v2-reader__body v2-reader__preface" />
      </div>
      {gated ? <ArticleLockDivider /> : null}
    </>
  );
}

export function ArticleLockDivider() {
  return (
    <div className="v2-lock-divider" role="separator" aria-label="ここから先は鍵つきです">
      <span>ここから先は鍵つきです</span>
    </div>
  );
}
