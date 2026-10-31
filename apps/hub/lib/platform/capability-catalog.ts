import type { HubCapability, HubIntent, HubScopedRef } from "@/lib/platform/core-model";
import { validateHubIntent } from "@/lib/platform/core-model";

const serviceRef = (id: string): HubScopedRef => ({
  namespace: "hub",
  kind: "service",
  id,
});

export const HUB_CAPABILITY_CATALOG: readonly HubCapability[] = [
  {
    name: "hub.orchestration.fulfill",
    provider: serviceRef("intent-orchestrator"),
    description:
      "利用者の意図を、探索、比較、選択、明示承認、所有サービスへの引き渡し、履行確認まで再開可能な作業として進める",
    inputSchema: "hub.intent-run.create.v1",
    outputSchema: "hub.intent-run.v1",
    permissions: [
      "read:public",
      "ai:execute",
      "approve:contract",
      "authorize:payment",
    ],
    cost: { mode: "external" },
    humanApproval: "required",
  },
  {
    name: "hub.search.query",
    provider: serviceRef("search"),
    description: "Hub内のActorとObjectを横断検索する",
    inputSchema: "/api/search?q={query}",
    outputSchema: "hub.search.results.v1",
    permissions: ["read:public"],
    cost: { mode: "free" },
    humanApproval: "not_required",
  },
  {
    name: "hub.graph.read",
    provider: serviceRef("graph"),
    description: "公開されたHub Graph関係を読み取る",
    inputSchema: "/api/core/graph?profile={profile}",
    outputSchema: "hub.graph.projection.v1",
    permissions: ["read:public"],
    cost: { mode: "free" },
    humanApproval: "not_required",
  },
  {
    name: "hub.social.post.create",
    provider: serviceRef("social"),
    description: "認証中のHubプロフィールとしてポストを公開する",
    inputSchema: "hub.social.post.create.input.v1",
    outputSchema: "hub.social.post.v1",
    permissions: ["write:profile", "publish:post"],
    cost: { mode: "free" },
    humanApproval: "required",
  },
  {
    name: "hub.ai.execute",
    provider: serviceRef("ai-tools"),
    description: "AI Toolsへ目的と文脈を渡して実行候補を準備する",
    inputSchema: "hub.ai.execution-request.v1",
    outputSchema: "hub.ai.execution-result.v1",
    permissions: ["ai:execute"],
    cost: { mode: "external" },
    humanApproval: "required",
  },
  {
    name: "hub.communication.message.draft",
    provider: serviceRef("communication"),
    description: "送信前のメッセージ下書きを作成する",
    inputSchema: "hub.communication.message.draft.input.v1",
    outputSchema: "hub.communication.message.draft.v1",
    permissions: ["create:draft", "draft:message"],
    cost: { mode: "free" },
    humanApproval: "not_required",
  },
  {
    name: "hub.communication.message.mediate",
    provider: serviceRef("communication"),
    description: "メッセージ送信内容を提示し、利用者の確認を要求する",
    inputSchema: "hub.mediation.v1",
    outputSchema: "hub.mediation.v1",
    permissions: ["approve:message-send"],
    cost: { mode: "free" },
    humanApproval: "required",
  },
  {
    name: "hub.commerce.purchase.propose",
    provider: serviceRef("commerce"),
    description: "商品、販売者、最大支払額を提示し、支払承認へ引き渡す",
    inputSchema: "hub.mediation.v1",
    outputSchema: "hub.mediation.v1",
    permissions: ["propose:purchase", "authorize:payment"],
    cost: { mode: "external" },
    humanApproval: "required",
  },
  {
    name: "hub.commerce.checkout.handoff",
    provider: serviceRef("commerce"),
    description: "最大支払額を確認し、ブラウザからCommerceへ直接引き渡す",
    inputSchema: "hub.commerce.v1",
    outputSchema: "hub.commerce.handoff.v1",
    permissions: ["propose:purchase", "authorize:payment"],
    cost: { mode: "external" },
    humanApproval: "required",
  },
  {
    name: "hub.knowledge.candidate.propose",
    provider: serviceRef("hubpedia"),
    description: "公開投稿またはレスを、検証前のHubpedia記事候補として提案する",
    inputSchema: "/api/hubpedia/candidates",
    outputSchema: "hub.knowledge.candidate.v1",
    permissions: ["read:public", "write:profile"],
    cost: { mode: "free" },
    humanApproval: "required",
  },
  {
    name: "hub.knowledge.memory.propose",
    provider: serviceRef("hubpedia"),
    description: "人間または権限付きAIが、公開前のHubpedia記憶候補を審査キューへ提案する",
    inputSchema: "/api/hubpedia/memory-proposals",
    outputSchema: "hub.knowledge.memory-proposal.v1",
    permissions: ["write:profile", "propose:knowledge"],
    cost: { mode: "free" },
    humanApproval: "not_required",
  },
  {
    name: "hub.knowledge.discussion.link",
    provider: serviceRef("hubpedia"),
    description: "Hubpedia記事と自分が作成した公開スレッドを関連付ける",
    inputSchema: "/api/hubpedia/articles/{slug}/discussions",
    outputSchema: "hub.knowledge.discussion-link.v1",
    permissions: ["read:public", "write:profile"],
    cost: { mode: "free" },
    humanApproval: "required",
  },
  {
    name: "hub.agent.discover",
    provider: serviceRef("ai-tools"),
    description: "公開された個人AI・組織AI・サービスAIの能力を発見する",
    inputSchema: "/ai/api/a2a/agents?capability={capability}",
    outputSchema: "hub.a2a.agent-catalog.v1",
    permissions: ["read:public"],
    cost: { mode: "free" },
    humanApproval: "not_required",
  },
  {
    name: "hub.agent.negotiate",
    provider: serviceRef("ai-tools"),
    description: "AI同士で条件案を作り、人間の契約・支払承認へ引き渡す",
    inputSchema: "hub.a2a.negotiation.v1",
    outputSchema: "hub.a2a.negotiation.v1",
    permissions: ["ai:execute", "approve:contract", "authorize:payment"],
    cost: { mode: "external" },
    humanApproval: "required",
  },
] as const;

const CAPABILITIES = new Map(
  HUB_CAPABILITY_CATALOG.map((capability) => [capability.name, capability]),
);

export type HubIntentResolution =
  | {
      status: "ready";
      intent: HubIntent;
      capability: HubCapability;
      pendingApprovals: string[];
      handoff: { href: string; method: "GET" | "POST" };
    }
  | {
      status: "invalid";
      issues: string[];
    }
  | {
      status: "unsupported";
      objective: string;
    };

function pendingApprovals(intent: HubIntent, capability: HubCapability) {
  const pending: string[] = [];
  if (capability.name === "hub.orchestration.fulfill") {
    if (intent.constraints.commerceRequired === true) {
      if (intent.approvals.contract !== "granted") pending.push("contract");
      if (intent.approvals.payment !== "granted") pending.push("payment");
    }
    if (intent.approvals.personalData !== "granted") {
      pending.push("personal_data");
    }
    return pending;
  }
  if (capability.humanApproval === "required") {
    if (
      capability.name === "hub.social.post.create"
      && intent.approvals.publish !== "granted"
    ) {
      pending.push("publish");
    } else if (capability.name === "hub.ai.execute") {
      pending.push("execution");
    } else {
      pending.push("confirmation");
    }
  }
  if (capability.cost.mode !== "free" && intent.approvals.payment !== "granted") {
    pending.push("payment");
  }
  if (
    capability.permissions.some((permission) => permission.includes("contract"))
    && intent.approvals.contract !== "granted"
  ) {
    pending.push("contract");
  }
  return pending;
}

function capabilityHandoff(capability: HubCapability) {
  switch (capability.name) {
    case "hub.orchestration.fulfill":
      return { href: "/ai?panel=work", method: "GET" as const };
    case "hub.search.query":
      return { href: "/api/search", method: "GET" as const };
    case "hub.graph.read":
      return { href: "/api/core/graph", method: "GET" as const };
    case "hub.social.post.create":
      return { href: "/api/core/actions", method: "POST" as const };
    case "hub.ai.execute":
      return { href: "/ai", method: "GET" as const };
    case "hub.communication.message.draft":
      return { href: "/ai", method: "GET" as const };
    case "hub.communication.message.mediate":
      return { href: "/api/core/mediations", method: "POST" as const };
    case "hub.commerce.purchase.propose":
      return { href: "/api/core/mediations", method: "POST" as const };
    case "hub.commerce.checkout.handoff":
      return {
        href: "/api/core/commerce/handoff",
        method: "POST" as const,
      };
    case "hub.knowledge.candidate.propose":
      return { href: "/api/hubpedia/candidates", method: "POST" as const };
    case "hub.knowledge.discussion.link":
      return {
        href: "/api/hubpedia/articles/{slug}/discussions",
        method: "POST" as const,
      };
    case "hub.agent.discover":
      return { href: "/ai/api/a2a/agents", method: "GET" as const };
    case "hub.agent.negotiate":
      return { href: "/ai?panel=agents", method: "GET" as const };
    default:
      return { href: "/", method: "GET" as const };
  }
}

export function resolveHubIntent(intent: HubIntent): HubIntentResolution {
  const issues = validateHubIntent(intent);
  if (issues.length) return { status: "invalid", issues };
  const capability = CAPABILITIES.get(intent.objective);
  if (!capability) return { status: "unsupported", objective: intent.objective };
  return {
    status: "ready",
    intent,
    capability,
    pendingApprovals: pendingApprovals(intent, capability),
    handoff: capabilityHandoff(capability),
  };
}

export function getHubCapability(name: string) {
  return CAPABILITIES.get(name) ?? null;
}
