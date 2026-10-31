import Link from "next/link";

import { V2DetailSection } from "@/components/v2/v2-detail";

export type V2HubpediaCitation = { slug: string; title: string; claimCount: number };

/*
 * 「この項目を引いている事典」(docs/hubpedia-hybrid/DESIGN.md section 8)。
 * 引いている公開済みの項目が無ければ何も出さない。色は既存の v2 の部品が持つ
 * 意味づけトークンだけを使う。
 */
export function V2HubpediaCitations({ citations, japanese }: { citations: readonly V2HubpediaCitation[]; japanese: boolean }) {
  if (!citations.length) return null;
  return (
    <V2DetailSection title={japanese ? "この項目を引いている事典" : "Cited in Hubpedia"} note={japanese ? `${citations.length}件` : `${citations.length}`}>
      <ul className="v2-facets" aria-label={japanese ? "この項目を引いている事典" : "Hubpedia entries citing this item"}>
        {citations.map((citation) => (
          <li key={citation.slug}>
            <Link className="v2-facet" href={`/v2/hubpedia/${encodeURIComponent(citation.slug)}`}>
              {citation.title}
              <small>{japanese ? ` 主張${citation.claimCount}件` : ` ${citation.claimCount} claim${citation.claimCount === 1 ? "" : "s"}`}</small>
            </Link>
          </li>
        ))}
      </ul>
    </V2DetailSection>
  );
}
