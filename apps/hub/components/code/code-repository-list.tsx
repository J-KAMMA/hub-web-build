import Link from "next/link";

import { codeRepositoryHref, formatCodeBytes, formatCodeUpdated } from "@/lib/code-ui";
import type { CodeRepositoryView } from "@/lib/server/code-repositories";

const ACCESS_LABEL: Record<CodeRepositoryView["access"], string> = { owner: "持ち主", write: "書き込み", read: "読み取り" };

/*
 * リポジトリの行（2026-10-18、GitHub の一覧に寄せた）。名前・公開の別・説明・更新・大きさ。
 * 言語と星は、いまの API（CodeRepositoryView）が持たないので出さない。
 */
export function CodeRepositoryList({ repositories, empty, showAccess = false, now }: { repositories: CodeRepositoryView[]; empty: string; showAccess?: boolean; now?: Date }) {
  if (!repositories.length) return <p className="hub-code__empty">{empty}</p>;
  const current = now ?? new Date();
  return (
    <ul className="hub-code__list">
      {repositories.map((repository) => (
        <li key={repository.id} className="hub-code__item">
          <div className="hub-code__item-head">
            <Link className="hub-code__item-name" href={codeRepositoryHref(repository.owner, repository.name)}>
              <span className="hub-code__item-owner">{repository.owner}/</span>{repository.name}
            </Link>
            <span className="hub-code__badge">{repository.visibility === "public" ? "公開" : "非公開"}</span>
            {showAccess ? <span className="hub-code__badge hub-code__badge--quiet">{ACCESS_LABEL[repository.access]}</span> : null}
          </div>
          {repository.description ? <p className="hub-code__item-text">{repository.description}</p> : null}
          <p className="hub-code__meta">
            <span>{repository.defaultBranch}</span>
            <span>{formatCodeBytes(repository.sizeBytes)}</span>
            <time dateTime={repository.updatedAt} title={repository.updatedAt.slice(0, 16).replace("T", " ")}>{formatCodeUpdated(repository.updatedAt, current)}</time>
          </p>
        </li>
      ))}
    </ul>
  );
}
