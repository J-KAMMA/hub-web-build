import Link from "next/link";

import { CodeCopyBlock } from "@/components/code/code-copy-block";
import { CODE_REPOSITORY_SOFT_LIMIT_BYTES, codeCloneUrl, codeSetupCommands, formatCodeBytes, formatCodeUpdated } from "@/lib/code-ui";
import type { CodeRepositoryView } from "@/lib/server/code-repositories";

const ACCESS_LABEL = { owner: "持ち主", write: "書き込み", read: "読み取り" } as const;

/*
 * リポジトリの頁（2026-10-18、GitHub の頭に寄せた）。頭は「持ち主 / 名前」と公開の別、説明、更新。
 * 本文の左に clone と push、右にこのリポジトリの事実。
 * ファイルの一覧・README・言語・星・共同作業者は、いまの API が返さないので出さない。
 */
export function CodeRepositoryPage({ repository, origin, now }: { repository: CodeRepositoryView; origin: string; now?: Date }) {
  const cloneUrl = codeCloneUrl(origin, repository.owner, repository.name);
  const commands = codeSetupCommands(cloneUrl, repository.owner, repository.defaultBranch);
  const used = Math.min(1, repository.sizeBytes / CODE_REPOSITORY_SOFT_LIMIT_BYTES);
  const canWrite = repository.access === "owner" || repository.access === "write";
  return (
    <>
      <header className="hub-code__repo-head">
        <p className="hub-code__crumb"><Link href="/v2/code">コード</Link></p>
        <div className="hub-code__repo-title">
          <h2 className="hub-code__h1">
            <span className="hub-code__item-owner">{repository.owner}</span>
            <span className="hub-code__slash" aria-hidden="true"> / </span>
            <span className="hub-code__repo-name">{repository.name}</span>
          </h2>
          <span className="hub-code__badge">{repository.visibility === "public" ? "公開" : "非公開"}</span>
        </div>
        {repository.description
          ? <p className="hub-code__lead">{repository.description}</p>
          : <p className="hub-code__lead hub-code__lead--quiet">説明はありません。</p>}
        <p className="hub-code__meta">
          <span>{repository.defaultBranch}</span>
          <time dateTime={repository.updatedAt}>{formatCodeUpdated(repository.updatedAt, now ?? new Date())}</time>
        </p>
      </header>
      <div className="hub-code__repo-body">
        <div className="hub-code__stack">
          <section className="hub-code__panel" aria-labelledby="code-clone">
            <h2 className="hub-code__h2" id="code-clone">clone する</h2>
            <CodeCopyBlock label="clone 用 URL（HTTPS）" value={cloneUrl} />
            <CodeCopyBlock label="clone のコマンド" value={commands.clone} />
            <p className="hub-code__note">
              {repository.visibility === "public"
                ? "公開リポジトリの読み取りは、トークンなしでできます。"
                : "非公開です。ユーザー名は何でも構いません。パスワードを聞かれたら、読み取り以上のトークンを入れます。"}
            </p>
          </section>
          {canWrite ? (
            <section className="hub-code__panel" aria-labelledby="code-setup">
              <h2 className="hub-code__h2" id="code-setup">手元のコードを push する</h2>
              <ol className="hub-code__steps">
                <li><Link href="/v2/code/tokens">開発者トークン</Link>で、書き込み権限のトークンを作ります。</li>
                <li>手元のリポジトリで、次のコマンドを実行します。</li>
                <li>パスワードを聞かれたら、トークンを貼り付けます。ユーザー名は何でも構いません。</li>
              </ol>
              <CodeCopyBlock label="リモートの追加と push" value={commands.push} multiline />
              <p className="hub-code__note">トークンは URL に含めないでください。履歴やログに残ります。1回の push は100MiB まで、1ファイルは32MB まで、1リポジトリは1GB までです。</p>
            </section>
          ) : null}
        </div>
        <aside className="hub-code__panel hub-code__about" aria-labelledby="code-about">
          <h2 className="hub-code__h2" id="code-about">このリポジトリ</h2>
          <dl className="hub-code__facts">
            <div><dt>持ち主</dt><dd>{repository.owner}</dd></div>
            <div><dt>あなたの権限</dt><dd>{ACCESS_LABEL[repository.access]}</dd></div>
            <div><dt>既定のブランチ</dt><dd>{repository.defaultBranch}</dd></div>
            <div><dt>作成</dt><dd><time dateTime={repository.createdAt}>{repository.createdAt.slice(0, 10)}</time></dd></div>
            <div>
              <dt>使用量</dt>
              <dd>
                {formatCodeBytes(repository.sizeBytes)} / {formatCodeBytes(CODE_REPOSITORY_SOFT_LIMIT_BYTES)}
                <progress className="hub-code__meter" value={used} max={1} aria-label="使用量" />
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}
