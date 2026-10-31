export type CategoryGraphNode = {
  id: string;
  articleCount: number;
  state: string;
  namespace?: string;
};

export type CategoryGraphEdge = {
  parentId: string;
  childId: string;
  confidence: number;
};

export type CategoryIntegrityFinding = {
  categoryId: string | null;
  type: "cycle" | "orphan" | "parent-smaller-than-child" | "singleton-visible" | "semantic-review";
  severity: "warning" | "blocker";
  detail: string;
};

export function detectCategoryGraphProblems(
  nodes: readonly CategoryGraphNode[],
  edges: readonly CategoryGraphEdge[],
): CategoryIntegrityFinding[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    parents.set(edge.childId, [...(parents.get(edge.childId) ?? []), edge.parentId]);
    children.set(edge.parentId, [...(children.get(edge.parentId) ?? []), edge.childId]);
  }
  const findings: CategoryIntegrityFinding[] = [];
  for (const node of nodes) {
    if (!parents.has(node.id) && node.id.includes("/")) {
      findings.push({ categoryId: node.id, type: "orphan", severity: "warning", detail: "The category has no registered parent edge." });
    }
    if (node.state === "visible" && node.articleCount < 2) {
      findings.push({ categoryId: node.id, type: "singleton-visible", severity: "warning", detail: "A visible category contains fewer than two articles." });
    }
  }
  for (const edge of edges) {
    const parent = byId.get(edge.parentId);
    const child = byId.get(edge.childId);
    if (parent && child && parent.articleCount < child.articleCount) {
      findings.push({
        categoryId: edge.childId,
        type: "parent-smaller-than-child",
        severity: "warning",
        detail: "The parent category contains fewer articles than its child.",
      });
    }
    if (edge.confidence < 0.75) {
      findings.push({ categoryId: edge.childId, type: "semantic-review", severity: "warning", detail: "The parent-child meaning requires AI review." });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const child of children.get(id) ?? []) {
      if (walk(child)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const node of nodes) {
    if (walk(node.id)) {
      findings.push({ categoryId: node.id, type: "cycle", severity: "blocker", detail: "A category cycle was detected." });
      break;
    }
  }
  return findings;
}

export function categoryRelationshipSemantics(parentName: string, childName: string) {
  const incidental = /^(?:関連|その他|現在|概要|人気|新着)$/u.test(childName);
  const same = parentName.normalize("NFKC").toLocaleLowerCase("ja") === childName.normalize("NFKC").toLocaleLowerCase("ja");
  return {
    valid: !incidental && !same,
    confidence: incidental || same ? 0.2 : 0.8,
    reason: same ? "同名カテゴリは統合対象です。" : incidental ? "一時的・説明的な名称です。" : `${childName}の記事集合は${parentName}の記事集合に包含されます。`,
  };
}
