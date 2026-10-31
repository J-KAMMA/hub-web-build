import type { AiTaskPhase } from "./ai-task-engine";
import type { HubSiteToolId } from "./ai-site-orchestrator";

export type AiPermissionScope =
  | "read:public"
  | "read:account"
  | "create:draft"
  | "draft:message"
  | "publish:post"
  | "publish:thread"
  | "send:message"
  | "approve:message-send"
  | "manage:community-membership"
  | "manage:list"
  | "manage:notification"
  | "create:playlist"
  | "create:product"
  | "propose:purchase"
  | "authorize:payment"
  | "spend:wallet";

export type AiToolRisk = "read" | "reversible" | "public_write" | "financial";

export type AiToolContract = {
  id: string;
  toolId: HubSiteToolId;
  action: string;
  phase: AiTaskPhase;
  permission: AiPermissionScope;
  risk: AiToolRisk;
  requiresExplicitApproval: boolean;
  verification: "response" | "artifact" | "state" | "settlement";
  maximumInputCharacters: number;
};

const read = (toolId: HubSiteToolId, action: string, permission: AiPermissionScope = "read:public"): AiToolContract => ({
  id: `${toolId}.${action}`, toolId, action, phase: "read", permission, risk: "read",
  requiresExplicitApproval: false, verification: "response", maximumInputCharacters: 4_000,
});
const draft = (toolId: HubSiteToolId, action: string): AiToolContract => ({
  id: `${toolId}.${action}`, toolId, action, phase: "draft", permission: "create:draft", risk: "reversible",
  requiresExplicitApproval: false, verification: "artifact", maximumInputCharacters: 20_000,
});
const confirm = (toolId: HubSiteToolId, action: string, permission: AiPermissionScope, verification: AiToolContract["verification"] = "state"): AiToolContract => ({
  id: `${toolId}.${action}`, toolId, action, phase: "confirm", permission,
  risk: permission === "spend:wallet"
    || permission === "propose:purchase"
    || permission === "authorize:payment"
    ? "financial"
    : "public_write",
  requiresExplicitApproval: true, verification, maximumInputCharacters: 20_000,
});

export const AI_TOOL_CONTRACTS: readonly AiToolContract[] = [
  read("search", "search"),
  read("feed", "search"), draft("feed", "draft_post"), confirm("feed", "publish_post", "publish:post"),
  read("threads", "search"), draft("threads", "draft_thread"), draft("threads", "draft_reply"), confirm("threads", "publish_thread", "publish:thread"),
  read("hubpedia", "search"), read("hubpedia", "research"), draft("hubpedia", "draft_article"), draft("hubpedia", "propose_edit"),
  read("community", "search"), draft("community", "draft_message"), confirm("community", "join", "manage:community-membership"), confirm("community", "publish_message", "approve:message-send"),
  read("videos", "search"), read("videos", "summarize"), confirm("videos", "save", "create:playlist"), confirm("videos", "playlist", "create:playlist"), confirm("videos", "create_video_playlist", "create:playlist"),
  read("music", "search"), read("music", "recommend"), confirm("music", "favorite", "create:playlist"), confirm("music", "playlist", "create:playlist"), confirm("music", "create_music_playlist", "create:playlist"),
  read("shopping", "search"), confirm("shopping", "purchase_proposal", "propose:purchase", "settlement"),
  read("vault", "search"), read("vault", "summarize"), draft("vault", "draft_publication"), confirm("vault", "publish", "create:product"),
  read("lists", "read", "read:account"), confirm("lists", "create", "manage:list"), confirm("lists", "organize", "manage:list"),
  read("bookmarks", "read", "read:account"), read("bookmarks", "summarize", "read:account"), confirm("bookmarks", "organize", "manage:list"),
  read("notifications", "read", "read:account"), read("notifications", "summarize", "read:account"), confirm("notifications", "mark_read", "manage:notification"),
  read("browser", "read"),
] as const;

const contractMap = new Map(AI_TOOL_CONTRACTS.map((contract) => [contract.id, contract]));

export function getAiToolContract(toolId: string, action: string) {
  return contractMap.get(`${toolId}.${action}`) ?? null;
}

export function validateAiToolInput(contract: AiToolContract, input: unknown) {
  if (input === undefined) return contract.risk === "financial"
    ? { valid: false as const, error: "purchase_details_required" }
    : { valid: true as const };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false as const, error: "invalid_tool_input" };
  const serialized = JSON.stringify(input);
  if (serialized.length > contract.maximumInputCharacters) return { valid: false as const, error: "tool_input_too_large" };
  if (/(?:private[_ -]?key|seed phrase|mnemonic)/i.test(serialized)) return { valid: false as const, error: "secret_input_blocked" };
  if (contract.risk === "financial") {
    const purchase = input as Record<string, unknown>;
    if (typeof purchase.productId !== "string" || !purchase.productId.trim()) return { valid: false as const, error: "purchase_product_required" };
    if (typeof purchase.sellerId !== "string" || !purchase.sellerId.trim()) return { valid: false as const, error: "purchase_seller_required" };
    if (typeof purchase.currency !== "string" || !/^[A-Z]{3,8}$/.test(purchase.currency)) return { valid: false as const, error: "purchase_currency_required" };
    if (typeof purchase.total !== "number" || !Number.isFinite(purchase.total) || purchase.total <= 0) return { valid: false as const, error: "purchase_total_required" };
    if (purchase.subscription === true) return { valid: false as const, error: "subscription_purchase_blocked" };
  }
  return { valid: true as const };
}

export function approvalReason(contract: AiToolContract) {
  if (contract.risk === "financial") return "支払いが発生するため、金額と購入先の確認が必要です";
  if (contract.risk === "public_write") return "公開状態または他の利用者に影響するため、実行前の確認が必要です";
  return null;
}
