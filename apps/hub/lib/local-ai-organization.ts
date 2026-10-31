import type { LocalModel } from "@/components/ai-local-runner-panel";

export type AiOrganizationRole = {
  id: string;
  name: string;
  responsibility: string;
  providerId: string;
  reportsToId?: string | null;
  capabilities?: string[];
  skillIds?: string[];
};

export type AiOrganizationDefinition = {
  name: string;
  objective: string;
  mode: "sequential" | "parallel";
  budgetUsd: string;
  roles: AiOrganizationRole[];
};

export type OrganizationTemplateId = "development" | "research" | "content" | "commerce" | "community";

const role = (id: string, name: string, responsibility: string, capabilities: string[], reportsToId: string | null = "leader"): AiOrganizationRole => ({ id, name, responsibility, providerId: "local:auto", reportsToId, capabilities });

export const ORGANIZATION_TEMPLATES: Record<OrganizationTemplateId, Omit<AiOrganizationDefinition, "objective">> = {
  development: { name: "開発チーム", mode: "sequential", budgetUsd: "1.00", roles: [role("leader","統括AI","要件を分解し成果を統合する",["reasoning"],null),role("architect","設計AI","構造とインターフェースを設計する",["code","reasoning"]),role("builder","実装AI","実装案と変更内容を作る",["code"]),role("tester","テストAI","検証条件とテストを作る",["code","verification"]),role("security","監査AI","安全性と権限境界を確認する",["verification","reasoning"]) ] },
  research: { name: "調査チーム", mode: "parallel", budgetUsd: "0.80", roles: [role("leader","統括AI","論点を整理して結論を統合する",["reasoning"],null),role("researcher","調査AI","事実と根拠を整理する",["long-context"]),role("analyst","分析AI","比較と因果関係を分析する",["reasoning"]),role("reviewer","検証AI","矛盾と不確実性を確認する",["verification"]) ] },
  content: { name: "制作チーム", mode: "sequential", budgetUsd: "0.80", roles: [role("leader","編集長AI","目的と読者に合わせて統合する",["reasoning"],null),role("writer","執筆AI","本文を作成する",["long-context"]),role("designer","構成AI","見出しと表現を整える",["reasoning"]),role("reviewer","校閲AI","誤りと読みにくさを修正する",["verification"]) ] },
  commerce: { name: "商品企画チーム", mode: "sequential", budgetUsd: "1.00", roles: [role("leader","責任者AI","企画を統合し承認事項を示す",["reasoning"],null),role("market","市場分析AI","需要と競合を整理する",["long-context"]),role("product","商品設計AI","価値と仕様を設計する",["reasoning"]),role("risk","リスク監査AI","表示・決済・安全性を確認する",["verification"]) ] },
  community: { name: "コミュニティ運営チーム", mode: "parallel", budgetUsd: "0.60", roles: [role("leader","運営統括AI","判断を統合し人間の承認点を示す",["reasoning"],null),role("moderator","モデレーションAI","安全性とルール適合を確認する",["verification"]),role("support","案内AI","返信案と案内を作る",["long-context"]),role("analyst","分析AI","反応と改善点を整理する",["reasoning"]) ] },
};

export function createOrganizationFromTemplate(id: OrganizationTemplateId, objective = ""): AiOrganizationDefinition {
  const template = ORGANIZATION_TEMPLATES[id];
  return { ...template, objective, roles: template.roles.map((item) => ({ ...item, capabilities: [...(item.capabilities ?? [])] })) };
}

export function inferOrganizationTemplate(objective: string): OrganizationTemplateId {
  const text=objective.toLocaleLowerCase("ja");
  if(/開発|実装|コード|アプリ|web|バグ|test/.test(text))return "development";
  if(/商品|販売|価格|市場|購入|commerce/.test(text))return "commerce";
  if(/記事|動画|画像|制作|執筆|編集|content/.test(text))return "content";
  if(/コミュニティ|投稿|通知|モデレーション|運営/.test(text))return "community";
  return "research";
}

export function assignLocalModels(organization: AiOrganizationDefinition, models: LocalModel[]): Array<{ role: AiOrganizationRole; model: LocalModel | null }> {
  return organization.roles.map((item, index) => ({ role: item, model: models.length ? models[index % Math.min(models.length, 3)] : null }));
}

export function estimateOrganizationLoad(organization: AiOrganizationDefinition, modelCount: number) {
  const calls = organization.roles.length + 1;
  const concurrent = organization.mode === "parallel" ? Math.min(Math.max(modelCount, 1), organization.roles.filter((item) => item.reportsToId).length || 1) : 1;
  return { calls, concurrent, level: calls > 9 || concurrent > 3 ? "high" : calls > 5 || concurrent > 1 ? "medium" : "low" } as const;
}

export function planOrganizationRouting(organization: AiOrganizationDefinition, localModels: LocalModel[], externalProviders: Array<{id:string;priceUsd:string;available:boolean}>, privacy:"local_only"|"local_preferred") {
  const localAssignments=assignLocalModels(organization,localModels);
  const assignments=organization.roles.map((item,index)=>{
    if(item.providerId.startsWith("local:"))return {roleId:item.id,kind:"local" as const,modelId:item.providerId==="local:auto"?localAssignments[index].model?.id??null:item.providerId.split(":").slice(2).join(":")};
    const provider=item.providerId==="auto"?externalProviders.filter((candidate)=>candidate.available).sort((a,b)=>Number(a.priceUsd)-Number(b.priceUsd))[0]:externalProviders.find((candidate)=>candidate.id===item.providerId&&candidate.available);
    return {roleId:item.id,kind:"external" as const,modelId:provider?.id??null,maximumCostUsd:Number(provider?.priceUsd??0)};
  });
  const external=assignments.filter((item)=>item.kind==="external");
  return {assignments,blocked:privacy==="local_only"&&external.length>0,requiresExternalApproval:external.length>0,maximumExternalCostUsd:external.reduce((sum,item)=>sum+("maximumCostUsd" in item?item.maximumCostUsd:0),0)};
}
