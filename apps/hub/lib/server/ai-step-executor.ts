import "server-only";

import { readWebPage, BrowserReadError } from "@/lib/ai-browser-reader";
import { getD1SearchRouteData } from "@/lib/server/d1-search-route-data";
import { listD1Notifications } from "@/lib/server/d1-notifications";
import { getHubD1 } from "@/lib/server/hub-d1";
import type { HubAiToolCapability } from "@/lib/platform/ai-tool-capability-adapter";

export type ExecutedStepStatus =
  | "done" | "awaiting_confirmation" | "awaiting_payment_authorization"
  | "consent_required" | "failed";

export type ExecutedStep = {
  toolId: string;
  action: string;
  status: ExecutedStepStatus;
  summary?: string;
  result?: unknown;
  error?: string;
};

type ExecutableStep = {
  toolId: string;
  action: string;
  input?: Record<string, string>;
  capability: HubAiToolCapability;
};

const SEARCH_ACTIONS = new Set(["search", "recommend", "compare", "summarize", "research"]);

function compact(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 280);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return undefined;
}

function compactRows(rows: Array<Record<string, unknown>>) {
  return rows.slice(0, 4).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, v]) => [key, compact(v)]).filter(([, v]) => v !== undefined)),
  );
}

async function executeSearchStep(query: string, profileId: string | null): Promise<ExecutedStep["result"]> {
  const data = await getD1SearchRouteData(query, profileId);
  return {
    counts: data.counts,
    posts: compactRows(data.posts as unknown as Array<Record<string, unknown>>),
    threads: compactRows(data.threads as unknown as Array<Record<string, unknown>>),
    hubpedia: compactRows(data.hubpedia as unknown as Array<Record<string, unknown>>),
    communities: compactRows(data.communities as unknown as Array<Record<string, unknown>>),
  };
}

/**
 * ハーネスのステップ実行器。read系は即時実行、確認・決済・同意が要るものは止める。
 * 実行結果は信頼されないコンテンツとして扱い、書き込み系はここでは絶対に実行しない。
 */
export async function executePlanStep(
  step: ExecutableStep,
  context: { profileId: string | null; query: string },
): Promise<ExecutedStep> {
  const base = { toolId: step.toolId, action: step.action };
  const mode = step.capability.executionMode;
  if (mode === "confirmation-required") return { ...base, status: "awaiting_confirmation" };
  if (mode === "payment-authorization-required") return { ...base, status: "awaiting_payment_authorization" };
  if (mode === "draft-only") return { ...base, status: "awaiting_confirmation", summary: "下書き作成は実行画面で確認後に行います。" };

  if (mode === "consent-required") {
    if (!context.profileId) return { ...base, status: "consent_required" };
    if (step.toolId === "notifications") {
      const notifications = await listD1Notifications(getHubD1(), context.profileId, { limit: 20 });
      return { ...base, status: "done", result: { count: notifications.length, latest: notifications.slice(0, 5).map((n) => ({ id: n.id, type: n.type, isRead: n.isRead, createdAt: n.createdAt })) } };
    }
    return { ...base, status: "consent_required", summary: "このアカウント情報の参照は個別の許可が必要です。" };
  }

  // automatic（公開読み取り）
  if (step.toolId === "browser") {
    const url = step.input?.url;
    if (!url) return { ...base, status: "failed", error: "URLがありません。" };
    try {
      const result = await readWebPage(url);
      return { ...base, status: "done", result };
    } catch (error) {
      return { ...base, status: "failed", error: error instanceof BrowserReadError ? error.message : "ページを読み取れませんでした。" };
    }
  }
  if (SEARCH_ACTIONS.has(step.action)) {
    const result = await executeSearchStep(context.query, context.profileId);
    return { ...base, status: "done", result };
  }
  return { ...base, status: "done", summary: "参照のみのステップとして記録しました。" };
}
