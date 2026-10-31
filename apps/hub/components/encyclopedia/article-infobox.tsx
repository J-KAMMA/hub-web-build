import type { FactoryInfoboxRow } from "@/lib/encyclopedia/factory";

/*
 * Wikipedia-style infobox: a compact fact table in the article rail. Rows
 * arrive with their citation already renumbered onto the displayed source
 * list (seed/index.ts), so a cite marker links to the same #source-N anchor
 * as a body citation. The table renders only when the record carries facts;
 * articles without an infobox keep the plain layout.
 */
export function ArticleInfobox({
  title,
  rows,
  locale = "ja",
}: {
  title: string;
  rows: readonly FactoryInfoboxRow[];
  locale?: string;
}) {
  if (!rows.length) return null;
  return (
    <table className="hubpedia-infobox">
      <caption>{title}</caption>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            <th scope="row">{row.label}</th>
            <td>
              {row.value}
              {row.cite !== undefined ? (
                <sup className="article-markdown__citation">
                  <a aria-label={`${locale === "ja" ? "出典" : "Source"} ${row.cite}`} href={`#source-${row.cite}`}>
                    [{row.cite}]
                  </a>
                </sup>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
