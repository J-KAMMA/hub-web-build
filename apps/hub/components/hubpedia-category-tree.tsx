"use client";

import { HubpediaInstantCategoryLink } from "@/components/hubpedia-instant-catalog";
import { useCategoryAccordion } from "@/lib/use-category-accordion";

type CategoryNode = {
  id: string;
  name: string;
  children: CategoryNode[];
};

function CategoryBranch({
  node,
  selectedCategory,
  allLabel,
  hrefFor,
}: {
  node: CategoryNode;
  selectedCategory?: string;
  allLabel: string;
  hrefFor?: (category: string) => string;
}) {
  const containsSelection = selectedCategory === node.id
    || node.children.some((child) => selectedCategory === child.id || selectedCategory?.startsWith(`${child.id}/`));
  const { expandedCategoryKey, toggleCategory } = useCategoryAccordion(containsSelection ? node.id : null);
  const expanded = expandedCategoryKey === node.id;
  return <section>
    <div className="hubpedia__category-branch-row">
      <button type="button" aria-expanded={expanded} aria-controls={`hubpedia-subcategories-${node.id}`} onClick={() => toggleCategory(node.id)}>
        <span>{node.name}</span>
      </button>
      <HubpediaInstantCategoryLink category={node.id} hrefFor={hrefFor} current={selectedCategory === node.id}>{allLabel}</HubpediaInstantCategoryLink>
    </div>
    {expanded && node.children.length ? <div id={`hubpedia-subcategories-${node.id}`} className="hubpedia__category-branch-children">
      {node.children.map((child) => <CategoryBranch key={child.id} node={child} selectedCategory={selectedCategory} allLabel={allLabel} hrefFor={hrefFor} />)}
    </div> : null}
  </section>;
}

export function HubpediaCategoryTree({
  categories,
  selectedCategory,
  initialExpandedCategory,
  allLabel,
  hrefBase,
  rootCounts,
  queryString,
}: {
  categories: CategoryNode[];
  selectedCategory?: string;
  initialExpandedCategory?: string;
  allLabel: string;
  /*
   * 行き先を外から決める（2026-09-04）。渡すと素のリンクになる。
   * v2 は URL で絞り込むので、押した瞬間の即時切り替えとは噛み合わない。
   *
   * 関数（hrefFor）ではなく道の頭を受け取る（2026-09-07）。この部品は
   * "use client" で、サーバーの画面から関数は渡せない。分類が D1 に入った日に
   * Hubpedia の一覧が丸ごと落ちた（Functions cannot be passed directly to
   * Client Components）。0 行の間は木を出さなかったので、それまで見えなかった。
   */
  hrefBase?: string;
  rootCounts?: Record<string, number>;
  queryString?: string;
}) {
  const hrefFor = hrefBase === undefined
    ? undefined
    : (category: string) => {
        const query = new URLSearchParams(queryString);
        query.delete("page");
        if (category) query.set("category", category);
        else query.delete("category");
        return query.size ? `${hrefBase}?${query}` : hrefBase;
      };
  const { expandedCategoryKey, toggleCategory } = useCategoryAccordion(initialExpandedCategory ?? null);
  return <div className="hubpedia__directory-tree">
    {categories.map((root) => {
      const expanded = expandedCategoryKey === root.id;
      return <section key={root.id}>
        <button type="button" aria-expanded={expanded} aria-controls={`hubpedia-subcategories-${root.id}`} onClick={() => toggleCategory(root.id)}>
          <span>{root.name}</span>
          {rootCounts?.[root.id] !== undefined ? <small>{rootCounts[root.id]}</small> : null}
        </button>
        {expanded ? <nav id={`hubpedia-subcategories-${root.id}`}>
          <HubpediaInstantCategoryLink category={root.id} hrefFor={hrefFor} current={selectedCategory === root.id}>{allLabel}</HubpediaInstantCategoryLink>
          {root.children.map((child) => <CategoryBranch key={child.id} node={child} selectedCategory={selectedCategory} allLabel={allLabel} hrefFor={hrefFor} />)}
        </nav> : null}
      </section>;
    })}
  </div>;
}
