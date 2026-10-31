import {
  createHubActionProjection,
  publicResourceToken,
  type HubActionProjection,
} from "@/lib/action-layer";
import { getInstanceOrigin, isJkammaServicesEnabled, JKAMMA_HUB_ORIGIN } from "@/lib/instance-origin";

export type HubInternalActionTarget =
  | { kind: "work"; href: string; listingId: string; workKind: "job" | "project" }
  | { kind: "ai"; href: string; resourceId: string; resourceKind: "tool" | "workflow" };

const DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1"]);
const SAFE_ID = /^[A-Za-z0-9._~-]{1,160}$/;

function isHubHost(url: URL): boolean {
  if (DEVELOPMENT_HOSTS.has(url.hostname)) return url.protocol === "http:" || url.protocol === "https:";
  if (url.protocol !== "https:") return false;
  if (url.hostname === new URL(getInstanceOrigin()).hostname) return true;
  /* Existing posts on the jkamma instance link to the jkamma Hub host; a self-hosted Hub does not trust that host. */
  return isJkammaServicesEnabled() && url.hostname === new URL(JKAMMA_HUB_ORIGIN).hostname;
}

function safeParam(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)?.trim() ?? "";
  return SAFE_ID.test(value) ? value : null;
}

export function classifyHubInternalActionUrl(rawUrl: string): HubInternalActionTarget | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!isHubHost(url) || url.username || url.password || url.hash) return null;

  if (url.pathname === "/work" || url.pathname === "/jobs") {
    const listingId = safeParam(url, "listing");
    if (!listingId) return null;
    const workKind = url.pathname === "/jobs" ? "job" : "project";
    return {
      kind: "work",
      href: `${url.pathname}?listing=${encodeURIComponent(listingId)}`,
      listingId,
      workKind,
    };
  }

  if (url.pathname === "/ai") {
    const resourceId = safeParam(url, "workflow") ?? safeParam(url, "tool");
    if (!resourceId) return null;
    const key = url.searchParams.has("workflow") ? "workflow" : "tool";
    return {
      kind: "ai",
      href: `/ai?${key}=${encodeURIComponent(resourceId)}`,
      resourceId,
      resourceKind: key,
    };
  }

  return null;
}

const AI_TOOL_ACTIONS: Record<string, { title: string; description: string }> = {
  summarize: { title: "要約", description: "文章の要点と結論を整理します。" },
  translate: { title: "翻訳", description: "文脈と固有名詞を保ちながら翻訳します。" },
  analyze: { title: "比較・分析", description: "違い、根拠、判断材料を構造化します。" },
  image: { title: "画像生成", description: "指示から画像を生成します。" },
  video: { title: "動画生成", description: "指示から短い動画を生成します。" },
};

const AI_WORKFLOW_ACTIONS: Record<string, { title: string; description: string }> = {
  direct: { title: "そのまま回答", description: "適切なAIを選び、直接回答します。" },
  research: { title: "深い調査", description: "検索、複数AIの分析、検証を組み合わせます。" },
  create: { title: "成果物を作る", description: "要件整理から下書き、批評、完成まで進めます。" },
  team: { title: "AIチーム", description: "複数の役割を持つAIで調査、作成、検証を行います。" },
};

export function aiInternalActionProjection(
  target: Extract<HubInternalActionTarget, { kind: "ai" }>,
): HubActionProjection {
  const metadata = target.resourceKind === "tool"
    ? AI_TOOL_ACTIONS[target.resourceId]
    : AI_WORKFLOW_ACTIONS[target.resourceId];
  if (!metadata) return unavailableInternalActionProjection(target);

  return createHubActionProjection({
    type: "execute_ai",
    publicResourceRef: `ai:workflow:${publicResourceToken(`${target.resourceKind}:${target.resourceId}`)}`,
    ownerService: "ai",
    projectionVersion: "1",
    label: target.resourceKind === "tool" ? "AIツール" : "AIワークフロー",
    title: metadata.title,
    description: metadata.description,
    priceLabel: "実行前に最大料金を確認",
    href: target.href,
    status: "available",
    statusLabel: "AIで開く",
  });
}

export function unavailableInternalActionProjection(
  target: Exclude<HubInternalActionTarget, { kind: "work" }>,
): HubActionProjection {
  return createHubActionProjection({
    type: "execute_ai",
    publicResourceRef: `ai:workflow:${publicResourceToken(target.resourceId)}`,
    ownerService: "ai",
    projectionVersion: "1",
    label: "AI",
    title: "AIワークフロー",
    description: "実行可否と最大料金を確認できませんでした。",
    href: null,
    status: "unavailable",
    statusLabel: "AIで実行条件を確認できません",
  });
}
