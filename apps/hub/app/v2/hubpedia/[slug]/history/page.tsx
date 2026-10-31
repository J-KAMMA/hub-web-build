import type { Metadata } from "next";
import Link from "next/link";

import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { authorKindLabel } from "@/lib/hubpedia-wiki-ui";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listHistory } from "@/lib/server/hubpedia-wiki";

import "../../../v2.css";
import "../../hubpedia-wiki.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "履歴 | Hubpedia | Hub v2", robots: { index: false, follow: false } };

type Row = {
  id: string;
  revisionNumber: number;
  title: string;
  editSummary: string | null;
  createdAt: string;
  authorHandle: string | null;
  authorKind: string | null;
  contributorsJson: string | null;
};

function contributorCount(json: string | null) {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/* 記事の版の一覧。書き手の種類と関わった人の数、前の版との差分へのリンク。 */
export default async function V2HubpediaHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const database = getOptionalHubD1();
  const rows = database ? ((await listHistory(database, slug).catch(() => null)) as Row[] | null) : null;
  const encoded = encodeURIComponent(slug);
  return (
    <V2PanelPage directoryRail={<V2DirectoryRail back={{ href: `/v2/hubpedia/${encoded}`, label: "記事へ" }} />} currentPath={`/v2/hubpedia/${encoded}`} title={`履歴: ${slug}`} note={rows ? `${rows.length}版` : undefined}>
      {rows === null ? (
        <div role="status"><p className="v2-error">履歴を取得できませんでした。</p><a href={`/v2/hubpedia/${encoded}/history`}>再読み込み</a></div>
      ) : rows.length === 0 ? (
        <p className="v2-note">この記事にはまだ共同編集の版がありません。<Link href={`/v2/hubpedia/${encoded}`}>記事へ戻る</Link></p>
      ) : (
        <table className="hubpedia-wiki__table">
          <caption className="v2-note">版は新しい順です。</caption>
          <thead>
            <tr><th scope="col">版</th><th scope="col">書き手</th><th scope="col">要約</th><th scope="col">日付</th><th scope="col">差分</th></tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const previous = rows[index + 1];
              const people = contributorCount(row.contributorsJson);
              return (
                <tr key={row.id}>
                  <th scope="row">#{row.revisionNumber}</th>
                  <td>
                    {authorKindLabel(row.authorKind)}
                    {people ? `・${people}人` : ""}
                    {row.authorHandle ? <><br />@{row.authorHandle}</> : null}
                  </td>
                  <td>{row.editSummary || row.title}</td>
                  <td>{row.createdAt.slice(0, 10)}</td>
                  <td>
                    <Link href={`/v2/hubpedia/${encoded}/diff?${previous ? `from=${encodeURIComponent(previous.id)}&` : ""}to=${encodeURIComponent(row.id)}`}>
                      {previous ? "前の版と比べる" : "最初の版を見る"}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </V2PanelPage>
  );
}
