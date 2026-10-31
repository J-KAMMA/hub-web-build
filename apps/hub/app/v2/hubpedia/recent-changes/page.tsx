import type { Metadata } from "next";
import Link from "next/link";

import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { authorKindLabel } from "@/lib/hubpedia-wiki-ui";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getWikiRole } from "@/lib/server/hubpedia-wiki-policy";
import { listRecentChanges } from "@/lib/server/hubpedia-wiki-patrol";

import "../../v2.css";
import "../hubpedia-wiki.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "最近の変更 | Hubpedia | Hub v2", robots: { index: false, follow: false } };

const FILTERS = [
  { value: "", label: "すべて" },
  { value: "ai", label: "AIが書いた" },
  { value: "human", label: "人が書いた" },
  { value: "hybrid", label: "AIが書き人が確かめた" },
] as const;

/* 公開された版の新しい順の一覧。書き手の種類で絞れる。 */
export default async function V2HubpediaRecentChangesPage({ searchParams }: { searchParams: Promise<{ authorKind?: string; cursor?: string }> }) {
  const { authorKind, cursor } = await searchParams;
  const kind = authorKind && ["ai", "human", "hybrid"].includes(authorKind) ? authorKind : "";
  const database = getOptionalHubD1();
  const result = database ? await listRecentChanges(database, { limit: 30, cursor: cursor ?? null, authorKind: kind || null }).catch(() => null) : null;
  /* 見回り役と運営だけに、審査待ちの画面への入口を出す。それ以外の人には出さない（開いても存在しない画面）。 */
  const viewer = database ? await getHubViewer().catch(() => null) : null;
  const canPatrol = database && viewer ? (await getWikiRole(database, viewer.id).catch(() => "editor")) !== "editor" : false;
  const query = (patch: Record<string, string>) => {
    const params = new URLSearchParams(patch);
    const text = params.toString();
    return text ? `/v2/hubpedia/recent-changes?${text}` : "/v2/hubpedia/recent-changes";
  };
  return (
    <V2PanelPage directoryRail={<V2DirectoryRail back={{ href: "/v2/hubpedia", label: "一覧へ" }} />} currentPath="/v2/hubpedia" title="最近の変更" note={result ? `${result.items.length}件` : undefined}>
      {canPatrol ? <p><Link href="/v2/hubpedia/patrol">審査待ちの提案（見回り）</Link></p> : null}
      <nav className="hubpedia-wiki__filters" aria-label="書き手の種類で絞る">
        {FILTERS.map((filter) => (
          <Link key={filter.value} className="v2-facet" href={query(filter.value ? { authorKind: filter.value } : {})} aria-current={filter.value === kind ? "page" : undefined}>
            {filter.label}
          </Link>
        ))}
      </nav>
      {result === null ? (
        <div role="status"><p className="v2-error">最近の変更を取得できませんでした。</p><a href={query(kind ? { authorKind: kind } : {})}>再読み込み</a></div>
      ) : result.items.length === 0 ? (
        <V2Empty title="この条件の変更はまだありません" />
      ) : (
        <table className="hubpedia-wiki__table">
          <thead>
            <tr><th scope="col">記事</th><th scope="col">書き手</th><th scope="col">要約</th><th scope="col">日付</th></tr>
          </thead>
          <tbody>
            {result.items.map((item) => {
              const row = item as typeof item & { slug: string; title: string; revisionNumber: number; editSummary: string | null; authorKind: string; contributorHandles: string[]; restoredFrom: string | null; sensitiveCategory: string | null };
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/v2/hubpedia/${encodeURIComponent(row.slug)}`}>{row.title}</Link>
                    <br /><Link href={`/v2/hubpedia/${encodeURIComponent(row.slug)}/history`}>履歴 #{row.revisionNumber}</Link>
                  </th>
                  <td>
                    {authorKindLabel(row.authorKind)}
                    {row.contributorHandles.length ? <><br />{row.contributorHandles.map((handle) => `@${handle}`).join("、")}</> : null}
                  </td>
                  <td>
                    {row.restoredFrom ? "差し戻し: " : ""}{row.editSummary || "(要約なし)"}
                    {row.sensitiveCategory ? <><br /><span className="v2-note">人の確認が必要な分野</span></> : null}
                  </td>
                  <td>{row.createdAt.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {result?.nextCursor ? <p><Link href={query({ ...(kind ? { authorKind: kind } : {}), cursor: result.nextCursor })}>さらに古い変更</Link></p> : null}
    </V2PanelPage>
  );
}
