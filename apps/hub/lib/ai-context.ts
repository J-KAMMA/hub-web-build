import { getInstanceOrigin } from "@/lib/instance-origin";
export type HubAiIntent =
  | "explain"
  | "summarize"
  | "compare"
  | "draft_reply"
  | "research"
  | "translate"
  | "verify"
  | "related";

export type HubAiSource =
  | "feed"
  | "thread"
  | "community"
  | "hubpedia"
  | "video"
  | "music"
  | "shopping"
  | "vault"
  | "notification";

export type HubAiContext = {
  source: HubAiSource;
  targetId: string;
  coreObjective?: "hub.ai.execute";
  title?: string;
  content?: string;
  href?: string;
  intent?: HubAiIntent;
};

export type HubAiContextEnvelope = {
  version: 1;
  createdAt: number;
  expiresAt: number;
  nonce: string;
  context: HubAiContext;
};

export const HUB_AI_CONTEXT_EVENT = "hub:ai-context";
export const HUB_AI_CONTEXT_STORAGE_KEY = "hub.ai.pending-context";
export const HUB_AI_CONTEXT_TTL_MS = 10 * 60 * 1_000;

export const HUB_AI_INTENT_LABELS: Record<HubAiIntent, string> = {
  explain: "質問",
  summarize: "要約",
  compare: "比較",
  draft_reply: "返信案",
  research: "追加調査",
  translate: "翻訳",
  verify: "主張を検証",
  related: "関連情報",
};

export const HUB_AI_CONTEXT_ACTIONS: Record<HubAiSource, readonly HubAiIntent[]> = {
  feed: ["summarize", "explain", "translate", "verify", "related"],
  thread: ["summarize", "draft_reply", "translate", "verify", "related"],
  community: ["summarize", "draft_reply", "translate", "verify", "related"],
  hubpedia: ["summarize", "research", "verify", "related"],
  video: ["summarize", "explain", "verify", "related"],
  music: ["explain", "translate", "related"],
  shopping: ["compare", "verify", "related"],
  vault: ["summarize", "explain", "verify", "related"],
  notification: ["summarize", "verify", "related"],
};

export const HUB_AI_SOURCE_LABELS: Record<HubAiSource, string> = {
  feed: "フィードのポスト",
  thread: "スレッドの投稿",
  community: "コミュニティの投稿",
  hubpedia: "Hubpediaの記事",
  video: "動画",
  music: "音楽",
  shopping: "商品",
  vault: "Vaultのコンテンツ",
  notification: "通知",
};

const AI_SOURCES = new Set<HubAiSource>(Object.keys(HUB_AI_CONTEXT_ACTIONS) as HubAiSource[]);
const AI_INTENTS = new Set<HubAiIntent>(Object.keys(HUB_AI_INTENT_LABELS) as HubAiIntent[]);
const SAFE_ENVELOPE_ID = /^[A-Za-z0-9._:~-]{1,200}$/;

function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return undefined;
  try {
    const url = new URL(value, getInstanceOrigin());
    if (url.origin !== getInstanceOrigin()) return undefined;
    return `${url.pathname}${url.search}`.slice(0, 2_048);
  } catch {
    return undefined;
  }
}

export function normalizeHubAiContext(value: unknown): HubAiContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.source !== "string"
    || !AI_SOURCES.has(candidate.source as HubAiSource)
    || typeof candidate.targetId !== "string"
    || !SAFE_ENVELOPE_ID.test(candidate.targetId)
  ) return null;
  if (
    candidate.intent !== undefined
    && (typeof candidate.intent !== "string" || !AI_INTENTS.has(candidate.intent as HubAiIntent))
  ) return null;
  const title = typeof candidate.title === "string" ? candidate.title.trim().slice(0, 300) : undefined;
  const content = typeof candidate.content === "string" ? candidate.content.trim().slice(0, 12_000) : undefined;
  const href = safeHref(candidate.href);
  const intent = candidate.intent as HubAiIntent | undefined;
  return {
    source: candidate.source as HubAiSource,
    targetId: candidate.targetId,
    coreObjective: "hub.ai.execute",
    ...(title ? { title } : {}),
    ...(content ? { content } : {}),
    ...(href ? { href } : {}),
    ...(intent ? { intent } : {}),
  };
}

export function createHubAiContextEnvelope(
  context: HubAiContext,
  now = Date.now(),
  nonce = crypto.randomUUID(),
): HubAiContextEnvelope {
  const normalized = normalizeHubAiContext(context);
  if (!normalized) throw new Error("invalid_hub_ai_context");
  return {
    version: 1,
    createdAt: now,
    expiresAt: now + HUB_AI_CONTEXT_TTL_MS,
    nonce,
    context: normalized,
  };
}

export function parseHubAiContextEnvelope(
  serialized: string,
  now = Date.now(),
): HubAiContextEnvelope | null {
  if (serialized.length > 16_384) return null;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      value.version !== 1
      || typeof value.createdAt !== "number"
      || typeof value.expiresAt !== "number"
      || typeof value.nonce !== "string"
      || !SAFE_ENVELOPE_ID.test(value.nonce)
      || value.createdAt > now + 60_000
      || value.expiresAt <= now
      || value.expiresAt - value.createdAt > HUB_AI_CONTEXT_TTL_MS
    ) return null;
    const context = normalizeHubAiContext(value.context);
    return context ? {
      version: 1,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      nonce: value.nonce,
      context,
    } : null;
  } catch {
    return null;
  }
}

export function aiToolForContext(context: HubAiContext): "summarize" | "translate" | "analyze" {
  if (context.intent === "summarize") return "summarize";
  if (context.intent === "translate") return "translate";
  return "analyze";
}

const INTENT_INSTRUCTIONS: Record<HubAiIntent, string> = {
  explain: "内容について利用者の質問に答えてください。断定できない点は明示してください。",
  summarize: "重要な要点を簡潔に要約してください。元の意味や留保を変えないでください。",
  compare: "比較できる項目、相違点、判断に必要な不足情報を整理してください。",
  draft_reply: "内容を踏まえ、相手を尊重した簡潔な返信案を作成してください。",
  research: "追加で確認すべき論点と、信頼できる一次資料を使った調査方針を示してください。",
  translate: "内容の言語を判定し、利用者の表示言語へ自然に翻訳してください。固有名詞とURLは保持してください。",
  verify: "主要な主張を分け、確認済み・未確認・意見を区別してください。根拠がない内容を事実として補わないでください。",
  related: "関連する論点、Hubpediaで探す語句、追加で確認すべき情報を整理してください。",
};

function bounded(value: string | undefined, maximum: number) {
  return value?.trim().slice(0, maximum) ?? "";
}

export function getAiContextActions(source: HubAiSource) {
  return HUB_AI_CONTEXT_ACTIONS[source].map((intent) => ({
    intent,
    label: HUB_AI_INTENT_LABELS[intent],
  }));
}

export function createAiContextPrompt(context: HubAiContext) {
  const intent = context.intent ?? "explain";
  const title = bounded(context.title, 300);
  const content = bounded(context.content, 12_000);
  const href = bounded(context.href, 2_048);

  return [
    `対象: ${HUB_AI_SOURCE_LABELS[context.source]}`,
    `操作: ${HUB_AI_INTENT_LABELS[intent]}`,
    INTENT_INSTRUCTIONS[intent],
    title ? `タイトル: ${title}` : "",
    content ? `内容:\n${content}` : "",
    href ? `参照先: ${href}` : "",
  ].filter(Boolean).join("\n");
}
