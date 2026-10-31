import Link from "next/link";

import { CodeRepositoryList } from "@/components/code/code-repository-list";
import { filterCodeRepositories } from "@/lib/code-ui";
import type { CodeRepositoryView } from "@/lib/server/code-repositories";

/*
 * コードの一覧（/v2/code、2026-10-18 に GitHub の一覧へ寄せた）。頭・検索・自分のリポジトリ・公開リポジトリ。
 * 検索は読み込んだ行の中だけを絞る（一覧の API は語での検索を受けない）。公開リポジトリは新しい順の
 * 先頭 publicLimit 件しか読まないので、その旨を検索の結果に添える。
 */
export function CodeIndex({ signedIn, own, publicRepos, query, unavailable, publicLimit, now }: {
  signedIn: boolean;
  own: CodeRepositoryView[];
  publicRepos: CodeRepositoryView[];
  query: string;
  unavailable: boolean;
  publicLimit: number;
  now?: Date;
}) {
  const ownShown = filterCodeRepositories(own, query);
  const publicShown = filterCodeRepositories(publicRepos, query);
  const searching = Boolean(query.trim());
  return (
    <>
      <header className="hub-code__head">
        <div>
          
          <p className="hub-code__lead">ソースコードを置いて、git で読み書きします。公開すると誰でも読めます。</p>
        </div>
        <div className="hub-code__actions">
          <Link className="hub-code__button" href="/v2/code/tokens">開発者トークン</Link>
          <Link className="hub-code__button hub-code__button--primary" href="/v2/code/new">新しいリポジトリ</Link>
        </div>
      </header>
      <form className="hub-code__search" role="search" action="/v2/code" method="get">
        <input type="search" name="q" defaultValue={query} maxLength={100} placeholder="リポジトリを検索（名前・説明）" aria-label="リポジトリを検索" />
        <button type="submit" className="hub-code__button">検索</button>
        {searching ? <Link className="hub-code__clear" href="/v2/code">解除</Link> : null}
      </form>
      {unavailable ? (
        <div className="hub-code__error" role="alert">
          コード置き場を読み込めませんでした。時間をおいて開き直してください。 <Link href={searching ? `/v2/code?q=${encodeURIComponent(query)}` : "/v2/code"}>読み込み直す</Link>
        </div>
      ) : null}
      <section className="hub-code__panel" aria-labelledby="code-own">
        <header className="hub-code__panel-head">
          <h2 className="hub-code__h2" id="code-own">自分のリポジトリ</h2>
          {signedIn && !unavailable ? <span className="hub-code__count">{searching ? `${ownShown.length} / ${own.length}` : own.length}</span> : null}
        </header>
        {!signedIn ? (
          <p className="hub-code__empty">ログインすると、自分のリポジトリが並びます。</p>
        ) : unavailable ? null : !own.length ? (
          <div className="hub-code__blank" role="status">
            <p className="hub-code__blank-title">まだリポジトリがありません</p>
            <p className="hub-code__empty">リポジトリを作ると、clone の URL と push の手順が出ます。</p>
            <Link className="hub-code__button hub-code__button--primary" href="/v2/code/new">リポジトリを作る</Link>
          </div>
        ) : (
          <CodeRepositoryList repositories={ownShown} showAccess now={now} empty={`「${query.trim()}」に合うリポジトリはありません。`} />
        )}
      </section>
      {unavailable ? null : (
        <section className="hub-code__panel" aria-labelledby="code-public">
          <header className="hub-code__panel-head">
            <h2 className="hub-code__h2" id="code-public">公開リポジトリ</h2>
            <span className="hub-code__count">{searching ? `${publicShown.length} / ${publicRepos.length}` : publicRepos.length}</span>
          </header>
          {searching && publicRepos.length >= publicLimit ? <p className="hub-code__note">新しく更新された {publicLimit} 件の中から探しています。</p> : null}
          <CodeRepositoryList repositories={publicShown} now={now} empty={searching ? `「${query.trim()}」に合う公開リポジトリはありません。` : "公開されているリポジトリはまだありません。"} />
        </section>
      )}
    </>
  );
}
