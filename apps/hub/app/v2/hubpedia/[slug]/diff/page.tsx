import type { Metadata } from "next";
import Link from "next/link";

import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { authorKindLabel } from "@/lib/hubpedia-wiki-ui";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubpediaWikiDiff } from "@/lib/server/hubpedia-wiki";

import "../../../v2.css";
import "../../hubpedia-wiki.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "差分 | Hubpedia | Hub v2", robots: { index: false, follow: false } };

type Diff = Awaited<ReturnType<typeof getHubpediaWikiDiff>>;

/* 2つの版の差分。既存の差分関数をそのまま使う。 */
export default async function V2HubpediaDiffPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const [{ slug }, { from, to }] = await Promise.all([params, searchParams]);
  const encoded = encodeURIComponent(slug);
  const database = getOptionalHubD1();
  let diff: Diff | null = null;
  let missing = false;
  if (database && to) {
    try {
      diff = await getHubpediaWikiDiff(database, slug, from ?? null, to);
    } catch {
      missing = true;
    }
  }
  const fromRow = diff?.from as { revisionNumber?: number; authorKind?: string } | null | undefined;
  const toRow = diff?.to as { revisionNumber?: number; authorKind?: string } | undefined;
  return (
    <V2PanelPage directoryRail={<V2DirectoryRail back={{ href: `/v2/hubpedia/${encoded}/history`, label: "履歴へ" }} />} currentPath={`/v2/hubpedia/${encoded}`} title={`差分: ${slug}`} note={toRow?.revisionNumber ? `${fromRow?.revisionNumber ? `#${fromRow.revisionNumber} → ` : ""}#${toRow.revisionNumber}` : undefined}>
      {!to ? (
        <p className="v2-note">比べる版が指定されていません。<Link href={`/v2/hubpedia/${encoded}/history`}>履歴から選んでください</Link>。</p>
      ) : missing || !diff ? (
        <p className="v2-note" role="status">指定された版が見つかりませんでした。<Link href={`/v2/hubpedia/${encoded}/history`}>履歴へ戻る</Link></p>
      ) : (
        <>
          <p className="v2-note">新しい版は{authorKindLabel(toRow?.authorKind)}。緑が足された行、赤が消えた行です。</p>
          <div className="hubpedia-wiki__diff" role="group" aria-label="版の差分">
            {diff.lines.map((line, index) => (
              <span key={index} data-kind={line.kind === "same" ? undefined : line.kind}>
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}
                {line.text}
              </span>
            ))}
          </div>
        </>
      )}
    </V2PanelPage>
  );
}
