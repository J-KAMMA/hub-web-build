import { getEvolvingCategoryChildren, type EvolvingCategoryIndex } from "@/lib/encyclopedia/category-evolution";

/*
 * 分類の木を組む（2026-09-04）。
 *
 * もとは app/hubpedia/page.tsx の中の入れ子の関数だった。v2 の Hubpedia にも
 * 同じ木が要るので切り出す。**複製すると必ずずれる**——分類は増え続けるので、
 * 片方だけ古い並びを持つと、同じ Hub が2つの分類を見せることになる。
 *
 * 並びは categoryRecords の順。記録に無いものは後ろへ回す（既存と同じ）。
 * hidden の節は出さない。輪（親が子を指し、子が親を指す）を踏んでも止まるよう、
 * 通った節を覚えながら降りる。
 */
export type CategoryTreeNode = { id: string; name: string; children: CategoryTreeNode[] };

type CategoryRecord = { id: string; name: string };

export function buildHubpediaCategoryTree(
  categoryIndex: EvolvingCategoryIndex,
  categoryRecords: CategoryRecord[],
  parentId: string,
  visited: Set<string> = new Set(),
): CategoryTreeNode[] {
  if (visited.has(parentId)) return [];
  const nextVisited = new Set(visited).add(parentId);
  const recordById = new Map(categoryRecords.map((record) => [record.id, record]));
  const order = new Map(categoryRecords.map((record, index) => [record.id, index]));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;

  return getEvolvingCategoryChildren(categoryIndex, parentId)
    .filter((node) => !("hidden" in node && node.hidden))
    .sort((left, right) => rank(left.id) - rank(right.id))
    .map((node) => ({
      id: node.id,
      name: recordById.get(node.id)?.name ?? node.name,
      children: buildHubpediaCategoryTree(categoryIndex, categoryRecords, node.id, nextVisited),
    }));
}
