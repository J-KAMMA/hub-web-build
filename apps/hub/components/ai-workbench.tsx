"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AiWorkControls, AiWorkState } from "./ai-develop-panel";
import type { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import {
  AlignLeft,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  Cloud,
  ChevronDown,
  Code2,
  Cpu,
  Copy,
  Download,
  Folder,
  Image as ImageIcon,
  Images,
  HelpCircle,
  Languages,
  Paperclip,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Pin,
  Sparkles,
  Smartphone,
  ThumbsDown,
  ThumbsUp,
  Users,
  Video,
  X,
} from "lucide-react";
import { getHubEvmProvider, type HubEvmProvider } from "@/components/hub-wallet-provider";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import { routeAiProvider, type AiProviderId } from "@/lib/ai-model-router";
import { orchestrateHubSite, type HubSiteToolId } from "@/lib/ai-site-orchestrator";
import { inspectExternalAiPayload } from "@/lib/ai-external-privacy";
import { planOrganizationRouting, type AiOrganizationDefinition } from "@/lib/local-ai-organization";
import { compileAiTask } from "@/lib/ai-task-engine";
import { onDeviceAiBridge, type OnDeviceModel } from "@/lib/on-device-ai";
import { BYOK_SETUP_VALUE, byokErrorMessage, byokModelValue, nativeByokManager, parseByokModelValue, type ByokModelEntry } from "@/lib/native-byok";
import { buildAiExecutionPlan } from "@/lib/ai-execution-plan";
import { runHybridOrganization } from "@/lib/hybrid-organization-harness";
import { LocalRunnerHarness, type AgentHarness } from "@/lib/agent-harness";
import { buildAutomaticSkillContext } from "@/lib/ai-skill-registry";
import {
  aiToolForContext,
  createAiContextPrompt,
  getAiContextActions,
  HUB_AI_CONTEXT_STORAGE_KEY,
  HUB_AI_SOURCE_LABELS,
  normalizeHubAiContext,
  parseHubAiContextEnvelope,
  type HubAiContext,
} from "@/lib/ai-context";
import { purgeLegacyByokKeys } from "@/lib/ai-byok-purge";
import { REMOTE_SETUP_VALUE, RemoteMenuItems, RemoteNativeOptions, parseRemoteModelValue, remoteModelValue, useRemoteAiPc } from "./ai-remote-pc";
import type { LocalAiConnection, LocalModel } from "./ai-local-runner-panel";
import { AiMessageContent } from "./ai-message-content";
import { HubpediaCitations, readHubpediaCitations, type HubpediaCitation } from "./hubpedia-citations";
import { evidenceMessage, HUBPEDIA_NO_EVIDENCE } from "./hubpedia-evidence";
import type { AiUsageAction } from "./ai-usage-guide";
import type { AiWorkSettings } from "./ai-productivity-center";
import dynamic from "next/dynamic";
import { paidAiExecutionEnabled } from "@/lib/ai-paid-execution";

const AiLocalRunnerPanel = dynamic(() => import("./ai-local-runner-panel").then((module) => module.AiLocalRunnerPanel), { ssr: false });
// Talks to the desktop app on loopback, so it has nothing to render on the server.
const AiDevelopPanel = dynamic(() => import("./ai-develop-panel").then((module) => module.AiDevelopPanel), { ssr: false });
const ThisMachinePanel = dynamic(() => import("./this-machine-panel").then((module) => module.ThisMachinePanel), { ssr: false });
const AiCommercePanel = dynamic(() => import("./ai-commerce-panel").then((module) => module.AiCommercePanel), { ssr: false });
const AiAccountSyncPanel = dynamic(() => import("./ai-account-sync-panel").then((module) => module.AiAccountSyncPanel), { ssr: false });
const AiOrganizationPanel = dynamic(() => import("./ai-organization-panel").then((module) => module.AiOrganizationPanel), { ssr: false });
const AiSkillsPanel = dynamic(() => import("./ai-skills-panel").then((module) => module.AiSkillsPanel), { ssr: false });
const AiConnectionsPanel = dynamic(() => import("./ai-connections-panel").then((module) => module.AiConnectionsPanel), { ssr: false });
const AiOnDevicePanel = dynamic(() => import("./ai-on-device-panel").then((module) => module.AiOnDevicePanel), { ssr: false });
const AiUsageGuide = dynamic(() => import("./ai-usage-guide").then((module) => module.AiUsageGuide), { ssr: false });
const AiProductivityCenter = dynamic(() => import("./ai-productivity-center").then((module) => module.AiProductivityCenter), { ssr: false });

type AiExecutionCapability = "groundedSearch" | "imageGeneration" | "videoGeneration" | "musicGeneration" | "localCodeExecution";

type AiPricingQuote = {
  basis: "upstream_cost";
  upstreamCostCeilingUsd: number;
  multiplier: number;
  infrastructureFeeUsd: number;
  maximumChargeUsd: string;
};

export function selectLocalExecutionModels(models: LocalModel[], selected: LocalModel, count: number): LocalModel[] {
  return [selected, ...models.filter((model) => model.runtime !== selected.runtime || model.id !== selected.id)].slice(0, Math.max(1, count));
}

export function inferAiTool(input: string): "summarize" | "translate" | "analyze" | "image" | "video" {
  const text = input.trim().toLocaleLowerCase("ja");
  if (/^(\/動画)|動画|ビデオ|video|movie|animate|アニメーション/.test(text)) return "video";
  if (/^(\/画像)|画像|イラスト|写真|ロゴ|サムネ|image|illustration|photo|draw|描いて/.test(text)) return "image";
  if (/^(\/翻訳)|翻訳|訳して|英語に|日本語に|translate|translation/.test(text)) return "translate";
  if (/^(\/分析)|比較|分析|調査|根拠|論点|違い|メリット|デメリット|analy[sz]e|compare|research/.test(text)) return "analyze";
  return "summarize";
}

type Tool = {
  id: string;
  name: string;
  description: string;
  category: string;
  priceUsd: string;
  model: string;
  placeholder: string;
  available?: boolean;
  output?: "text" | "image" | "video";
  providerId?: AiProviderId;
  requiredCapabilities?: AiExecutionCapability[];
  pricing?: AiPricingQuote;
};

type AiProvider = {
  id: AiProviderId;
  name: string;
  description: string;
  model: string;
  priceUsd: string;
  available: boolean;
  capabilities?: AiExecutionCapability[];
  pricing?: AiPricingQuote;
};

type Catalog = {
  payment: {
    enabled: boolean;
    testEnabled?: boolean;
    protocol: "x402";
    network: string;
    currency: string;
    options?: PaymentOption[];
  };
  readiness?: { ready: boolean; missing: string[]; providers: { enabled: number; total: number } };
  providers: AiProvider[];
  tools: Tool[];
  executionCapabilities?: Array<{
    id: AiExecutionCapability;
    label: string;
    target: "ai-worker" | "external-provider" | "local-runner";
    availability: "available" | "unavailable" | "client_required";
  }>;
};

type PaymentOption = {
  id: "usdc" | "jpyc";
  currency: "USDC" | "JPYC";
  network: `${string}:${string}`;
  asset: string;
  decimals: number;
  chainName: string;
  unitsPerUsd?: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  receipt?: string;
  /** Set by the hubpedia-answer tool: the sources behind each [n] marker in the content. */
  citations?: HubpediaCitation[];
  mediaType?: "image" | "video";
  mediaUrl?: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  toolId: string;
  providerId: "auto" | AiProviderId;
  project?: string;
  pinned?: boolean;
  archived?: boolean;
};
type MemoryFact = { id: string; content: string; createdAt: number; updatedAt: number };
type LocalAttachment = { id: string; name: string; size: number; text: string };

export function isWithinExecutionBudget(chargeUsd: string | number, budgetUsd: number): boolean {
  const charge = typeof chargeUsd === "number" ? chargeUsd : Number(chargeUsd);
  return Number.isFinite(charge) && Number.isFinite(budgetUsd) && budgetUsd >= 0 && charge <= budgetUsd;
}

const MAX_PROMPT_CHARACTERS = 8_000;
const MAX_MEMORY_ARCHIVE_BYTES = 1_000_000;
const MAX_ATTACHMENT_BYTES = 1_000_000;
const MAX_ATTACHMENT_CONTEXT = 12_000;
const PAYMENT_SESSION_CAP_ATOMIC = 1_000_000n;
const PAYMENT_SESSION_DURATION_MS = 30 * 60 * 1_000;
const PROVIDER_IDS = new Set<AiProviderId>(["openai", "anthropic", "gemini", "grok", "deepseek", "mistral", "perplexity", "kimi", "qwen", "glm", "minimax", "cohere"]);

export function buildConversationMemory(messages: ChatMessage[], submitted: string): string {
  if (messages.length === 0) return submitted;
  const heading = "以下はこのチャット内の直近の会話です。文脈として参照し、最後の依頼に回答してください。\n\n";
  const current = `\n\n現在の依頼:\n${submitted}`;
  const available = MAX_PROMPT_CHARACTERS - [...heading, ...current].length;
  if (available <= 0) return submitted;

  const selected: string[] = [];
  let used = 0;
  const older = messages.length > 12 ? messages.slice(0, -8) : [];
  const contextMessages = messages.length > 12 ? messages.slice(-8) : messages;
  const compactSummary = older.length > 0
    ? `以前の会話の要点: ${older.filter((message) => message.role === "user").map((message) => message.content.replace(/\s+/g, " ").slice(0, 90)).slice(-6).join(" / ")}`
    : "";
  for (const message of [...contextMessages].reverse()) {
    const segment = `${message.role === "user" ? "ユーザー" : "AI"}: ${message.content}`;
    const length = [...segment].length + (selected.length > 0 ? 2 : 0);
    if (used + length > available) break;
    selected.unshift(segment);
    used += length;
  }
  if (compactSummary && used + [...compactSummary].length + 2 <= available) selected.unshift(compactSummary);
  return selected.length > 0 ? `${heading}${selected.join("\n\n")}${current}` : submitted;
}

export function serializeMemoryArchive(conversations: Conversation[], memories: MemoryFact[] = []): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    memories: memories.slice(0, 50).map(({ content }) => ({ content })),
    conversations: conversations.slice(0, 20).map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(0, 100).map(({ id, role, content }) => ({ id, role, content }))
    }))
  }, null, 2);
}

export function parseRememberedFacts(raw: string): string[] {
  if (new Blob([raw]).size > MAX_MEMORY_ARCHIVE_BYTES) throw new Error("memory_archive_too_large");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("invalid_memory_archive");
  const memories = (value as { memories?: unknown }).memories ?? [];
  if (!Array.isArray(memories)) throw new Error("invalid_memory_archive");
  return memories.slice(0, 50).map((memory) => {
    const content = memory && typeof memory === "object" ? (memory as { content?: unknown }).content : undefined;
    if (typeof content !== "string" || !content.trim() || [...content].length > 500) throw new Error("invalid_memory_archive");
    return content.trim();
  });
}

export function parseMemoryArchive(raw: string): Conversation[] {
  if (new Blob([raw]).size > MAX_MEMORY_ARCHIVE_BYTES) throw new Error("memory_archive_too_large");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) throw new Error("invalid_memory_archive");
  const items = (value as { conversations?: unknown }).conversations;
  if (!Array.isArray(items)) throw new Error("invalid_memory_archive");
  return items.slice(0, 20).map((item): Conversation => {
    if (!item || typeof item !== "object") throw new Error("invalid_memory_archive");
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.title !== "string" || typeof candidate.toolId !== "string" || !Array.isArray(candidate.messages)) throw new Error("invalid_memory_archive");
    const providerId = candidate.providerId;
    if (providerId !== "auto" && (typeof providerId !== "string" || !PROVIDER_IDS.has(providerId as AiProviderId))) throw new Error("invalid_memory_archive");
    const messages = candidate.messages.slice(0, 100).map((message): ChatMessage => {
      if (!message || typeof message !== "object") throw new Error("invalid_memory_archive");
      const entry = message as Record<string, unknown>;
      if (typeof entry.id !== "number" || (entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string" || [...entry.content].length > MAX_PROMPT_CHARACTERS) throw new Error("invalid_memory_archive");
      return { id: entry.id, role: entry.role, content: entry.content };
    });
    const project = typeof candidate.project === "string" ? [...candidate.project].slice(0, 40).join("") : "一般";
    return { id: candidate.id, title: [...candidate.title].slice(0, 80).join(""), toolId: candidate.toolId, providerId: providerId as "auto" | AiProviderId, project, messages };
  });
}

type EthereumProvider = HubEvmProvider & {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

const FALLBACK_TOOLS: Tool[] = [
  { id: "summarize", name: "要約", description: "長い文章から要点と結論を整理します。", category: "調査・文章", priceUsd: "0.20", model: "gpt-5.6-luna", output: "text", placeholder: "要約したい文章を貼り付けてください", available: false },
  { id: "translate", name: "翻訳", description: "文脈を保ちながら日本語または英語へ翻訳します。", category: "翻訳", priceUsd: "0.14", model: "gpt-5.6-luna", output: "text", placeholder: "翻訳したい文章と希望する言語を入力してください", available: false },
  { id: "analyze", name: "比較・分析", description: "複数案の違いと判断材料を構造化します。", category: "分析", priceUsd: "0.24", model: "gpt-5.6-luna", output: "text", placeholder: "比較したい案やデータを入力してください", available: false },
  { id: "image", name: "画像生成", description: "文章から高品質な画像を生成します。", category: "画像", priceUsd: "0.30", model: "gpt-image-2", providerId: "openai", output: "image", placeholder: "生成したい画像を具体的に説明してください", available: false },
  { id: "video", name: "動画生成", description: "文章から音声付きの短い動画を生成します。", category: "動画", priceUsd: "2.00", model: "veo-3.1-fast-generate-preview", providerId: "gemini", output: "video", placeholder: "場面、動き、カメラ、音を具体的に説明してください", available: false }
];

const FALLBACK_PROVIDERS: AiProvider[] = [
  { id: "openai", name: "GPT", description: "高速で幅広い文章・分析タスクに対応します。", model: "gpt-5.6-luna", priceUsd: "0.20", available: false },
  { id: "anthropic", name: "Claude", description: "長文の読解と丁寧な文章作成に向いています。", model: "claude-sonnet-5", priceUsd: "0.24", available: false },
  { id: "gemini", name: "Gemini", description: "高速な推論と多言語タスクに対応します。", model: "gemini-3.5-flash", priceUsd: "0.14", available: false },
  { id: "grok", name: "Grok", description: "コード、推論、X由来の話題に強いAIです。", model: "grok-4.5", priceUsd: "0.24", available: false },
  { id: "deepseek", name: "DeepSeek", description: "低コストで推論とコード生成に対応します。", model: "deepseek-v4-flash", priceUsd: "0.10", available: false },
  { id: "mistral", name: "Mistral", description: "多言語処理に強い欧州発のAIです。", model: "mistral-large-latest", priceUsd: "0.16", available: false },
  { id: "perplexity", name: "Perplexity", description: "ウェブ検索に基づく調査回答を生成します。", model: "sonar-pro", priceUsd: "0.24", available: false },
  { id: "kimi", name: "Kimi", description: "長い文脈の理解、知識作業、複雑な推論に向いています。", model: "kimi-k3", priceUsd: "0.16", available: false },
  { id: "qwen", name: "Qwen", description: "多言語、長文、幅広い一般タスクに対応します。", model: "qwen3.7-max", priceUsd: "0.16", available: false },
  { id: "glm", name: "GLM", description: "エージェント型の推論とコード作業に強いAIです。", model: "glm-5.2", priceUsd: "0.16", available: false },
  { id: "minimax", name: "MiniMax", description: "速度と費用のバランスを重視した推論モデルです。", model: "MiniMax-M2.7", priceUsd: "0.12", available: false },
  { id: "cohere", name: "Cohere", description: "企業文書、検索拡張、業務向けの文章処理に向いています。", model: "command-a-plus-05-2026", priceUsd: "0.16", available: false }
];

const SUGGESTIONS: Record<string, string[]> = {
  summarize: ["この記事を3行で要約して", "重要な論点を箇条書きにして", "結論と根拠を整理して"],
  translate: ["自然な英語に翻訳して", "日本語に翻訳して", "ビジネス向けの表現にして"],
  analyze: ["2つの案を比較して", "メリットとリスクを整理して", "判断基準を作って"],
  image: ["近未来の東京を映画のワンシーン風に", "白背景の商品写真を作って", "水彩画風の静かな森を描いて"],
  video: ["夜の東京を走る車をシネマティックに", "料理が完成するまでを短い映像に", "風に揺れる草原をドローン撮影風に"]
};
const AI_COMMANDS = [
  { command: "/要約", tool: "summarize", prompt: "次の内容を要約してください。\n" },
  { command: "/調査", tool: "analyze", prompt: "次のテーマを調査し、根拠と引用元を示してください。\n" },
  { command: "/翻訳", tool: "translate", prompt: "次の内容を自然な日本語に翻訳してください。\n" },
  { command: "/画像", tool: "image", prompt: "次の内容で画像を生成してください。\n" },
  { command: "/動画", tool: "video", prompt: "次の内容で動画を生成してください。\n" },
  { command: "/ハブペディア", tool: "hubpedia-answer", prompt: "" },
] as const;

function ToolIcon({ toolId }: { toolId: string }) {
  const Icon = toolId === "summarize"
    ? AlignLeft
    : toolId === "translate"
      ? Languages
      : toolId === "analyze"
        ? BarChart3
        : toolId === "image"
          ? ImageIcon
          : toolId === "video"
            ? Video
            : Sparkles;
  return <Icon aria-hidden="true" size={16} strokeWidth={1.8} />;
}

export type AiWorkbenchHandoff = { prompt: string; context: HubAiContext | null; isCurrent: () => boolean; onAccepted?: () => void };
export type AiWorkbenchActivation = { isCurrent: () => boolean };
type AiWorkbenchProps = {
  variant?: "page" | "rail";
  initialPrompt?: string;
  initialContext?: HubAiContext | null;
  isActive?: () => boolean;
  handoff?: AiWorkbenchHandoff;
  hostActivation?: AiWorkbenchActivation;
  hubScope?: string;
};

async function requestAiSync(type: "conversations" | "projects" | "preferences", method: "GET" | "PUT", document?: unknown) {
  const assertion = await requestAiAssertion();
  const response = await fetch(`/ai/api/sync/${type}`, {
    method,
    cache: "no-store",
    headers: { authorization: `Bearer ${assertion}`, ...(method === "PUT" ? { "content-type": "application/json" } : {}) },
    body: method === "PUT" ? JSON.stringify({ document }) : undefined,
  });
  if (!response.ok) throw new Error("ai_sync_unavailable");
  return response.json() as Promise<{ document?: unknown }>;
}

async function requestAiAssertion() {
  const response = await fetch("/account/api/v1/assertions/ai", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { assertion?: unknown } | null;
  if (!response.ok || typeof body?.assertion !== "string") {
    throw new Error("account_assertion_unavailable");
  }
  return body.assertion;
}

export function AiWorkbench({ variant = "page", initialPrompt, initialContext, isActive, handoff, hostActivation, hubScope }: AiWorkbenchProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<"loading" | "ready" | "error">("loading");
  const [catalogRetryKey, setCatalogRetryKey] = useState(0);
  const [selectedId, setSelectedId] = useState("summarize");
  const [selectedProviderId, setSelectedProviderId] = useState<"auto" | AiProviderId>("auto");
  // Paid (x402) execution is off by default (owner decision 2026-10-15). See lib/ai-paid-execution.ts.
  const paidEnabled = paidAiExecutionEnabled();
  const [paymentCurrency, setPaymentCurrency] = useState<"USDC" | "JPYC">("USDC");
  const [prompt, setPrompt] = useState("");
  const [activeIntentRunId, setActiveIntentRunId] = useState<string | null>(null);
  const [activeIntentStage, setActiveIntentStage] = useState<
    "discovery" | "fulfillment" | null
  >(null);
  const [activeHubContext, setActiveHubContext] = useState<HubAiContext | null>(
    () => normalizeHubAiContext(initialContext),
  );
  const previousInitialContext = useRef(initialContext);
  const previousHubScope = useRef(hubScope), currentActivation = useRef(hostActivation);
  currentActivation.current = hostActivation;
  useLayoutEffect(() => {
    if (previousHubScope.current !== hubScope) { setActiveHubContext(null); setActiveIntentRunId(null); setActiveIntentStage(null); }
    previousHubScope.current = hubScope;
  }, [hubScope]);
  useEffect(() => {
    if (previousInitialContext.current && initialContext === null) setActiveHubContext(null);
    previousInitialContext.current = initialContext;
  }, [initialContext]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [executionMode, setExecutionMode] = useState<"auto" | "compare" | "team">("auto");
  const [localPolicy, setLocalPolicy] = useState<"prefer" | "only">("prefer");
  const [localRunnerOpen, setLocalRunnerOpen] = useState(false);
  const [developOpen, setDevelopOpen] = useState(false);
  const [developMounted, setDevelopMounted] = useState(false);
  const workControls = useRef<AiWorkControls>(null);
  const [workState, setWorkState] = useState<AiWorkState>({ ready: false, busy: false, label: "接続を確認中" });
  useEffect(() => { if (developOpen) setDevelopMounted(true); }, [developOpen]);
  const [machineOpen, setMachineOpen] = useState(false);
  const [localAiConnection, setLocalAiConnection] = useState<LocalAiConnection | null>(null);

  useEffect(() => {
    if (!initialPrompt) return;
    setPrompt(initialPrompt.slice(0, 8_000));
    const context = normalizeHubAiContext(initialContext);
    setActiveHubContext(context);
    setSelectedId(context ? aiToolForContext(context) : "analyze");
  }, [initialContext, initialPrompt]);

  const acceptedHandoff = useRef<AiWorkbenchHandoff | undefined>(undefined);
  useEffect(() => {
    if (!handoff || acceptedHandoff.current === handoff) return;
    acceptedHandoff.current = handoff;
    if (!handoff.isCurrent()) return;
    setPrompt(handoff.prompt.slice(0, 8_000));
    setActiveHubContext(normalizeHubAiContext(handoff.context));
    setSelectedId(handoff.context ? aiToolForContext(handoff.context) : "analyze");
    handoff.onAccepted?.();
  }, [handoff]);

  const acceptedUrls = useRef(new Set<string>());
  useEffect(() => {
    if (isActive?.() === false) return;
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.toString();
    if (acceptedUrls.current.has(urlKey)) return;
    acceptedUrls.current.add(urlKey);
    const current = () => currentActivation.current === hostActivation && hostActivation?.isCurrent() !== false && isActive?.() !== false;
    const intentRunId = params.get("intent");
    if (intentRunId && /^[0-9a-f-]{36}$/i.test(intentRunId)) {
      void fetch(`/api/core/intents/${encodeURIComponent(intentRunId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      }).then(async (response) => {
        const body = await response.json().catch(() => null) as {
          run?: {
            goalSummary?: unknown;
            currentStage?: unknown;
            state?: unknown;
            commercePreview?: { kind?: unknown };
          };
        } | null;
        if (!current()) return;
        if (
          !response.ok
          || typeof body?.run?.goalSummary !== "string"
          || (
            body.run.currentStage !== "discovery"
            && !(
              body.run.currentStage === "fulfillment"
              && body.run.commercePreview?.kind === "ai"
            )
          )
          || body.run.state !== "handoff_required"
        ) {
          throw new Error("intent_handoff_not_ready");
        }
        setActiveIntentRunId(intentRunId);
        setActiveIntentStage(body.run.currentStage);
        setPrompt(body.run.goalSummary.slice(0, 8_000));
        setSelectedId("analyze");
      }).catch(() => { if (current()) setError("このIntent作業はAIで実行できる状態ではありません。"); });
    }
    const requestedTool = params.get("tool");
    if (requestedTool && ["summarize", "translate", "analyze", "image", "video", "hubpedia-answer"].includes(requestedTool)) {
      setSelectedId(requestedTool);
      return;
    }
    const requestedWorkflow = params.get("workflow");
    if (!requestedWorkflow || !["direct", "research", "create", "team"].includes(requestedWorkflow)) return;
    setWorkSettings((current) => ({ ...current, workflow: requestedWorkflow }));
    setProductivityOpen(true);
  }, [hostActivation]);
  const [useLocalAi, setUseLocalAi] = useState(false);
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [pendingOrganization, setPendingOrganization] = useState<AiOrganizationDefinition | null>(null);
  const [organizationRun, setOrganizationRun] = useState<{ status: "running" | "completed" | "failed"; stages: Array<{ id: string; label: string; model: string; durationMs: number }>; artifacts: Array<{ id: string; roleId: string; roleName: string; summary: string }>; rating?: number } | null>(null);
  const organizationController = useRef<AbortController | null>(null);
  const organizationHarness = useRef<{ harness: AgentHarness; runId: string } | null>(null);
  const [onDeviceOpen, setOnDeviceOpen] = useState(false);
  const [onDeviceModels, setOnDeviceModels] = useState<OnDeviceModel[]>([]);
  const [onDeviceBridgeReady, setOnDeviceBridgeReady] = useState(false);
  // 自分のAPIキー（モバイルアプリのみ）。キーはネイティブ側にあり、ここにはモデル一覧と選択だけを持つ。
  const [byokOpen, setByokOpen] = useState(false);
  const [byokManagerReady, setByokManagerReady] = useState(false);
  const [byokModels, setByokModels] = useState<ByokModelEntry[]>([]);
  const [byokSelection, setByokSelection] = useState<{ connectionId: string; modelId: string } | null>(null);
  // 自分のPC（Hub Desktop）のAI接続をスマホから使う。ペアリング済みの端末間通信だけを通る。
  const remotePc = useRemoteAiPc();
  const refreshByokModels = useCallback(async () => {
    const manager = nativeByokManager();
    if (!manager) {
      setByokManagerReady(false);
      setByokModels([]);
      return;
    }
    setByokManagerReady(true);
    try {
      if (!(await manager.status()).available) {
        setByokModels([]);
        return;
      }
      const response = await manager.listModels();
      setByokModels(response.models);
      // 一覧が一時的に引けなかっただけの接続の選択は残す。消えた・無効になった接続の選択は外す。
      setByokSelection((current) => current && (response.models.some((model) => model.connectionId === current.connectionId && model.modelId === current.modelId) || response.errors.some((entry) => entry.connectionId === current.connectionId)) ? current : null);
    } catch {
      setByokModels([]);
    }
  }, []);
  useEffect(() => {
    const refresh = () => { void refreshByokModels(); };
    refresh();
    window.addEventListener("hub-native-byok-ready", refresh);
    return () => window.removeEventListener("hub-native-byok-ready", refresh);
  }, [refreshByokModels]);
  const [usageGuideOpen, setUsageGuideOpen] = useState(false);
  const [productivityOpen, setProductivityOpen] = useState(false);
  const [productivityInitialTab, setProductivityInitialTab] = useState<"work" | "jobs">("work");
  const [pendingApproval, setPendingApproval] = useState<{ id: string; title: string; steps: number; expiresAt: number | null } | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [commerceOpen, setCommerceOpen] = useState(false);
  const [commerceQuery, setCommerceQuery] = useState("");
  const [accountSyncOpen, setAccountSyncOpen] = useState(false);
  const [routingPreference, setRoutingPreference] = useState<"quality" | "balanced" | "cost">("balanced");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [messageFeedback, setMessageFeedback] = useState<Record<number, "up" | "down">>({});
  const [draggingAttachment, setDraggingAttachment] = useState(false);
  const [siteSources, setSiteSources] = useState<HubSiteToolId[]>([]);
  const [siteReads, setSiteReads] = useState<Array<{ url: string; title: string; truncated: boolean }>>([]);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const [workSettings, setWorkSettings] = useState<AiWorkSettings>({ deliverable: "回答", workflow: "direct", evidence: false, budgetUsd: 0.50, attachmentContext: "" });
  const [projectWorkSettings, setProjectWorkSettings] = useState<Record<string, AiWorkSettings>>({});
  const [projects, setProjects] = useState(["一般"]);
  const [activeProject, setActiveProject] = useState("一般");
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  // The page-level tool column is collapsed by ShellFrame, like every other
  // in-page left column. Keep this value only for the compact-copy branches;
  // the AI workspace must not own a second persisted collapse state.
  const sidebarCollapsed = false;
  const [status, setStatus] = useState<"idle" | "confirm" | "paying" | "done" | "error">("idle");
  const [paymentSessionExpiry, setPaymentSessionExpiry] = useState<number | null>(null);
  const paymentSession = useRef<{ client: x402Client; scheme: { refund(endpoint: string, options: { fetch: typeof fetch }): Promise<unknown> }; expiresAt: number } | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const bridge = onDeviceAiBridge();
      if (!bridge) {
        if (active) {
          setOnDeviceBridgeReady(false);
          setOnDeviceModels([]);
        }
        return;
      }
      if (active) {
        setOnDeviceBridgeReady(true);
        setError((current) => current.startsWith("x402決済は現在準備中") ? "" : current);
        setStatus((current) => current === "error" ? "idle" : current);
      }
      try {
        const models = await bridge.listModels();
        if (active) {
          setOnDeviceModels(models);
        }
      } catch {
        if (active) setOnDeviceModels([]);
      }
    };
    void refresh();
    window.addEventListener("hub-native-gemma-ready", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.removeEventListener("hub-native-gemma-ready", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const [paymentTestStatus, setPaymentTestStatus] = useState<"idle" | "confirm" | "paying" | "done" | "error">("idle");
  const [paymentTestResult, setPaymentTestResult] = useState("");
  const [error, setError] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const pollingTimers = useRef<number[]>([]);
  const executionAbort = useRef<AbortController | null>(null);
  const accountSyncHydrated = useRef(false);

  useEffect(() => {
    if (isActive?.() === false) return;
    const serializedContext = window.sessionStorage.getItem(HUB_AI_CONTEXT_STORAGE_KEY);
    if (!serializedContext) return;
    window.sessionStorage.removeItem(HUB_AI_CONTEXT_STORAGE_KEY);
    try {
      const envelope = parseHubAiContextEnvelope(serializedContext);
      if (!envelope) {
        setWorkspaceStatus("Hubから渡された内容は期限切れか、形式が正しくありません。");
        return;
      }
      const context = envelope.context;
      setActiveHubContext(context);
      setPrompt(createAiContextPrompt(context).slice(0, 12_000));
      setSelectedId(aiToolForContext(context));
      setWorkspaceStatus("Hubの内容を一度だけ受け取りました。確認するまでAIへ送信されません。");
    } catch {
      // Ignore malformed or stale device-local handoffs.
    }
  }, [hostActivation]);

  useEffect(() => { purgeLegacyByokKeys(); }, []);

  useEffect(() => {
    const receiveNativeShare = (event: Event) => {
      if (isActive?.() === false) return;
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== "string" || !text.trim()) return;
      setPrompt(text.trim().slice(0, 8_000));
      setSelectedId("analyze");
      setWorkspaceStatus("共有された文章を取り込みました。内容を確認して送信してください。");
    };
    window.addEventListener("hub-native-share", receiveNativeShare);
    return () => window.removeEventListener("hub-native-share", receiveNativeShare);
  }, [isActive]);

  function openProductivity(tab: "work" | "jobs" = "work") {
    setProductivityInitialTab(tab);
    setProductivityOpen(true);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCatalogStatus("loading");
    fetch("/ai/api/catalog", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("catalog_unavailable");
        return response.json() as Promise<Catalog>;
      })
      .then((value) => {
        if (!active) return;
        if (!Array.isArray(value.tools) || !Array.isArray(value.providers)) {
          throw new Error("catalog_invalid");
        }
        setCatalog(value);
        setCatalogStatus("ready");
        setSelectedId((current) => value.tools.some((tool) => tool.id === current)
          ? current
          : value.tools[0]?.id ?? current);
        setSelectedProviderId((current) => current === "auto"
          || value.providers.some((provider) => provider.id === current && provider.available)
          ? current
          : "auto");
      })
      .catch((cause) => {
        if (!active || (cause instanceof DOMException && cause.name === "AbortError")) return;
        setCatalog(null);
        setCatalogStatus("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [catalogRetryKey]);

  useEffect(() => () => {
    for (const timer of pollingTimers.current) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch("/ai/api/memory", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ memories: MemoryFact[] }> : Promise.reject(new Error("memory_unavailable")))
      .then((value) => setMemoryFacts(value.memories))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (prompt.trim()) setSelectedId(inferAiTool(prompt));
  }, [prompt]);

  useEffect(() => {
    let active = true;
    async function hydrateAccountData() {
      if (window.sessionStorage.getItem("ai.account-sync") !== "on") { accountSyncHydrated.current = false; return; }
      try {
        const [conversationResult, projectResult, preferenceResult] = await Promise.all([
          requestAiSync("conversations", "GET"), requestAiSync("projects", "GET"), requestAiSync("preferences", "GET"),
        ]);
        if (!active) return;
        if (conversationResult.document) {
          const restored = parseMemoryArchive(JSON.stringify(conversationResult.document));
          if (restored.length) setConversations(restored);
        }
        const projectDocument = projectResult.document as { names?: unknown; settings?: unknown } | null;
        if (projectDocument && Array.isArray(projectDocument.names)) {
          const names = projectDocument.names.filter((value): value is string => typeof value === "string" && value.length > 0).slice(0, 30);
          if (names.length) { setProjects(names); setProjectWorkSettings(projectDocument.settings && typeof projectDocument.settings === "object" ? projectDocument.settings as Record<string, AiWorkSettings> : {}); }
        }
        const preferenceDocument = preferenceResult.document as Record<string, unknown> | null;
        if (preferenceDocument) {
          if (["quality", "balanced", "cost"].includes(String(preferenceDocument.routingPreference))) setRoutingPreference(preferenceDocument.routingPreference as "quality" | "balanced" | "cost");
          if (["auto", "compare", "team"].includes(String(preferenceDocument.executionMode))) setExecutionMode(preferenceDocument.executionMode as "auto" | "compare" | "team");
          if (["USDC", "JPYC"].includes(String(preferenceDocument.paymentCurrency))) setPaymentCurrency(preferenceDocument.paymentCurrency as "USDC" | "JPYC");
          if (typeof preferenceDocument.selectedId === "string" && !new URLSearchParams(window.location.search).has("tool")) {
            setSelectedId(preferenceDocument.selectedId);
          }
          if (typeof preferenceDocument.selectedProviderId === "string") setSelectedProviderId(preferenceDocument.selectedProviderId as "auto" | AiProviderId);
        }
        accountSyncHydrated.current = true;
      } catch { accountSyncHydrated.current = false; }
    }
    void hydrateAccountData();
    window.addEventListener("ai-account-sync-changed", hydrateAccountData);
    return () => { active = false; window.removeEventListener("ai-account-sync-changed", hydrateAccountData); };
  }, []);

  useEffect(() => {
    if (!accountSyncHydrated.current || window.sessionStorage.getItem("ai.account-sync") !== "on") return;
    const timer = window.setTimeout(() => {
      const current = messages.length ? [{ id: conversationId, title: messages.find((message) => message.role === "user")?.content.slice(0, 28) || "新しいチャット", messages, toolId: selectedId, providerId: selectedProviderId, project: activeProject }, ...conversations.filter((item) => item.id !== conversationId)] : conversations;
      void Promise.all([
        requestAiSync("conversations", "PUT", current.slice(0, 20)),
        requestAiSync("projects", "PUT", { names: projects, settings: projectWorkSettings }),
        requestAiSync("preferences", "PUT", { selectedId, selectedProviderId, routingPreference, executionMode, paymentCurrency }),
      ]).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [activeProject, conversationId, conversations, executionMode, messages, paymentCurrency, projectWorkSettings, projects, routingPreference, selectedId, selectedProviderId]);

  const tools = catalogStatus === "ready" ? (catalog?.tools ?? []).filter((tool) => paidEnabled || (tool.output !== "image" && tool.output !== "video")) : [];
  const providers = catalogStatus === "ready" ? catalog?.providers ?? [] : [];
  const selected = useMemo(() => tools.find((tool) => tool.id === selectedId) ?? tools[0], [selectedId, tools]);
  const recommendedDecision = useMemo(() => routeAiProvider(selectedId, prompt, providers), [providers, selectedId, prompt]);
  const recommendedProvider = useMemo(() => {
    const available = providers.filter((provider) => provider.available);
    if (routingPreference === "cost") return [...available].sort((left, right) => Number(left.priceUsd) - Number(right.priceUsd))[0] ?? providers[0];
    if (routingPreference === "quality") return [...available].sort((left, right) => Number(right.priceUsd) - Number(left.priceUsd))[0] ?? providers[0];
    return providers.find((provider) => provider.id === recommendedDecision.providerId) ?? providers[0];
  }, [providers, recommendedDecision.providerId, routingPreference]);
  const selectedProvider = useMemo(() => selectedProviderId === "auto" ? recommendedProvider : providers.find((provider) => provider.id === selectedProviderId) ?? providers[0], [providers, recommendedProvider, selectedProviderId]);
  const isMedia = selected?.output === "image" || selected?.output === "video";
  const executionProvider = isMedia ? providers.find((provider) => provider.id === selected?.providerId) ?? selectedProvider : selectedProvider;
  const executionPriceUsd = isMedia ? selected?.priceUsd : selectedProvider?.priceUsd ?? selected?.priceUsd;
  const comparisonProviders = useMemo(() => {
    if (executionMode === "auto" || isMedia || !executionProvider) return executionProvider ? [executionProvider] : [];
    const limit = executionMode === "team" ? 3 : 2;
    return [executionProvider, ...providers.filter((provider) => provider.available && provider.id !== executionProvider.id)].slice(0, limit);
  }, [executionMode, executionProvider, isMedia, providers]);
  const requiredProviderCount = executionMode === "team" ? 3 : executionMode === "compare" ? 2 : 1;
  const localRequiredModelCount = executionMode === "compare" ? 2 : 1;
  const localExecutionModels = useMemo(() => {
    if (!localAiConnection) return [];
    return selectLocalExecutionModels(localAiConnection.models, localAiConnection.model, executionMode === "team" ? 3 : localRequiredModelCount);
  }, [executionMode, localAiConnection, localRequiredModelCount]);
  const localAiSelected = Boolean(useLocalAi && localAiConnection && !isMedia);
  const localAiReady = Boolean(localAiSelected && localExecutionModels.length >= localRequiredModelCount);
  const executionChargeUsd = localAiSelected
    ? "0"
    : formatUsdAmount(comparisonProviders.reduce((total, provider) => total + Number(provider.priceUsd), 0));
  const executionPricing = isMedia
    ? selected?.pricing
    : comparisonProviders.length === 1
      ? comparisonProviders[0]?.pricing
      : undefined;
  const paymentOption = catalog?.payment.options?.find((option) => option.currency === paymentCurrency)
    ?? catalog?.payment.options?.[0];
  const paymentMaximum = paymentOption?.currency === "JPYC"
    ? `${formatPaymentUnits(executionChargeUsd, paymentOption.unitsPerUsd ?? "150")} JPYC`
    : `$${executionChargeUsd} USDC`;
  const budgetReady = isWithinExecutionBudget(executionChargeUsd, workSettings.budgetUsd);
  const toolCapabilityReady = (selected?.requiredCapabilities ?? []).every((required) =>
    catalog?.executionCapabilities?.some((capability) => capability.id === required && capability.availability === "available")
  );
  const capabilityReady = toolCapabilityReady && (selectedProviderId !== "auto" || recommendedDecision.missingCapabilities.length === 0);
  const paymentReady = Boolean(paidEnabled && catalog?.payment.enabled && budgetReady && capabilityReady && (isMedia ? selected.available : executionMode !== "auto" ? comparisonProviders.length === requiredProviderCount : selectedProvider?.available));
  // 自分のAPIキーを選んでいて、外部送信が許される設定のときだけ使う。「外部送信なし」では端末内に戻る。
  const byokSelectedModel = byokSelection ? byokModels.find((model) => model.connectionId === byokSelection.connectionId && model.modelId === byokSelection.modelId) : undefined;
  const byokUsable = Boolean(byokSelection && byokManagerReady && !isMedia && executionMode === "auto" && localPolicy !== "only");
  const remoteUsable = Boolean(remotePc.usable && !isMedia && executionMode === "auto" && localPolicy !== "only");
  const onDeviceReady = !isMedia && executionMode === "auto" && onDeviceBridgeReady && !byokUsable && !remoteUsable;
  const activeModelValue = localAiSelected && localAiConnection
    ? `local:${localAiConnection.models.findIndex((model) => model.runtime === localAiConnection.model.runtime && model.id === localAiConnection.model.id)}`
    : remoteUsable && remotePc.selection ? remoteModelValue(remotePc.selection)
    : byokUsable && byokSelection ? byokModelValue(byokSelection.connectionId, byokSelection.modelId)
    : paidEnabled ? selectedProviderId : "device:setup";
  const executionReady = localPolicy === "only" ? localAiReady || onDeviceReady : localAiReady || onDeviceReady || byokUsable || remoteUsable || paymentReady;
  const externalPrivacy = useMemo(() => inspectExternalAiPayload(promptWithAttachments(prompt.trim())), [attachments, prompt]);
  const usageReceipts = useMemo(() => {
    const allMessages = [...messages, ...conversations.flatMap((conversation) => conversation.messages)];
    const unique = new Map<number, ChatMessage>();
    for (const message of allMessages) if (message.receipt) unique.set(message.id, message);
    return [...unique.values()].reverse();
  }, [conversations, messages]);
  const artifacts = useMemo(() => {
    const unique = new Map<number, ChatMessage>();
    for (const message of [...messages, ...conversations.flatMap((conversation) => conversation.messages)]) if (message.mediaUrl) unique.set(message.id, message);
    return [...unique.values()].reverse();
  }, [conversations, messages]);
  const sessionSpendUsd = usageReceipts.reduce((total, message) => total + Number(message.receipt?.match(/\$([0-9.]+)/)?.[1] ?? 0), 0);
  const localRunnerCapability = catalog?.executionCapabilities?.find((capability) => capability.id === "localCodeExecution");
  const executionBlockReason = executionReady ? "" : localPolicy === "only" && !localAiReady
    ? "ローカル限定です。スマホ内AIを取得するか、Local Runnerを接続してください。"
    : useLocalAi && !isMedia && localExecutionModels.length < localRequiredModelCount
    ? `${executionMode === "compare" ? "ローカル比較" : "ローカルAI"}には${localRequiredModelCount}個のモデルが必要です。Local Runnerでモデルを追加してください。`
    : !paidEnabled
    ? "この端末内AIまたは接続PCを選んでください。"
    : !budgetReady
    ? `この実行の最大料金 $${executionChargeUsd} は、設定した予算上限 $${workSettings.budgetUsd.toFixed(2)} を超えています。`
    : !catalog
    ? "AIサービスへ接続できていません。"
    : !catalog.payment.enabled
      ? "x402決済は現在準備中です。この端末内AIと接続PCのAIは無料で利用できます。"
      : !toolCapabilityReady
        ? `${selected?.name ?? "この機能"}に必要な能力が接続されていません。`
        : recommendedDecision.missingCapabilities.length
          ? "この依頼に必要な検索・出典能力が接続されていません。"
          : isMedia && !selected?.available
            ? `${selected?.name ?? "メディア生成"}の提供元が利用できません。`
            : executionMode !== "auto" && comparisonProviders.length < requiredProviderCount
              ? `${executionMode === "team" ? "チーム" : "比較"}実行に必要な${requiredProviderCount}つのAIが利用できません。`
              : `${selectedProvider?.name ?? "選択したAI"}は現在利用できません。`;

  function archiveCurrentChat() {
    if (messages.length === 0) return;
    const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? "新しいチャット";
    const title = [...firstUserMessage].slice(0, 28).join("");
    const snapshot: Conversation = { id: conversationId, title, messages, toolId: selectedId, providerId: selectedProviderId, project: activeProject };
    setConversations((current) => [snapshot, ...current.filter((conversation) => conversation.id !== conversationId)].slice(0, 20));
  }

  function resetChat() {
    archiveCurrentChat();
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setError("");
    setStatus("idle");
    setWorkspaceStatus("新しいチャットを開始しました。");
  }

  async function attachFiles(files: FileList | null) {
    if (!files) return;
    const next: LocalAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5 - attachments.length)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setError(`${file.name}は1MBを超えています。`);
        continue;
      }
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (!extension || !["txt", "md", "csv", "json", "html", "css", "js", "ts", "tsx", "jsx", "py", "yaml", "yml"].includes(extension)) {
        setError(`${file.name}はまだ読み取れません。テキスト・Markdown・CSV・JSON・コードを選んでください。`);
        continue;
      }
      next.push({ id: crypto.randomUUID(), name: file.name, size: file.size, text: (await file.text()).slice(0, MAX_ATTACHMENT_CONTEXT) });
    }
    setAttachments((current) => [...current, ...next].slice(0, 5));
    if (next.length > 0) setError("");
    if (attachmentInput.current) attachmentInput.current.value = "";
  }

  function promptWithAttachments(submitted: string) {
    if (attachments.length === 0) return submitted;
    const context = attachments.map((file) => `添付ファイル: ${file.name}\n---\n${file.text}`).join("\n\n");
    return `${submitted}\n\n${context}`.slice(0, MAX_PROMPT_CHARACTERS);
  }

  function downloadAnswer(message: ChatMessage) {
    if (message.mediaUrl) {
      const link = document.createElement("a");
      link.href = message.mediaUrl;
      link.download = `ai-result-${message.id}.${message.mediaType === "video" ? "mp4" : "png"}`;
      link.click();
      return;
    }
    const url = URL.createObjectURL(new Blob([message.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-answer-${message.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function saveAnswerToWorkspace(message: ChatMessage) {
    setWorkspaceStatus("保存中…");
    const kind = message.mediaType === "image" ? "image" : message.mediaType === "video" ? "video" : /```/.test(message.content) ? "code" : "text";
    const response = await fetch("/ai/api/artifacts", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: activeProject, kind, name: `${selected?.name ?? "AI成果物"}-${new Date().toLocaleDateString("ja-JP")}`, mimeType: kind === "code" ? "text/markdown" : kind === "text" ? "text/markdown" : kind === "image" ? "image/*" : "video/*", content: kind === "text" || kind === "code" ? message.content : null }),
    });
    setWorkspaceStatus(response.ok ? "プロジェクトへ保存しました。" : "成果物を保存できませんでした。");
  }

  async function recordMessageFeedback(messageId: number, feedback: "up" | "down") {
    setMessageFeedback((current) => ({ ...current, [messageId]: feedback }));
    await fetch("/ai/api/evaluations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: selectedProvider?.id ?? "local",
        toolId: selected?.id ?? "chat",
        rating: feedback === "up" ? 5 : 2,
        outcome: "succeeded",
      }),
    }).catch(() => undefined);
  }

  async function recordHubWork(title: string, workPlan: Array<{ toolId: string; action: string; phase: "read" | "draft" | "confirm"; href: string; input?: Record<string, string> }>) {
    const effectivePlan = workPlan.length
      ? workPlan
      : activeIntentRunId
        ? [{
            toolId: "ai-chat",
            action: "read",
            phase: "read" as const,
            href: "/ai",
            input: { intent: activeIntentRunId },
          }]
        : [];
    if (!effectivePlan.length) return;
    const task=compileAiTask({title,project:activeProject,privacy:localPolicy==="only"?"local_only":"local_preferred",budgetUsd:workSettings.budgetUsd,steps:effectivePlan});
    let assertion: string | null = null;
    let intentHandoffProof: string | undefined;
    if (activeIntentRunId) {
      const [handoffResponse, issuedAssertion] = await Promise.all([
        fetch(`/api/core/intents/${encodeURIComponent(activeIntentRunId)}/handoff`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ service: "ai" }),
        }),
        requestAiAssertion(),
      ]);
      const handoffBody = await handoffResponse.json().catch(() => null) as {
        proof?: unknown;
        error?: unknown;
      } | null;
      if (!handoffResponse.ok || typeof handoffBody?.proof !== "string") {
        throw new Error(
          typeof handoffBody?.error === "string"
            ? handoffBody.error
            : "intent_handoff_unavailable",
        );
      }
      assertion = issuedAssertion;
      intentHandoffProof = handoffBody.proof;
    }
    const aiHeaders = {
      "content-type": "application/json",
      ...(assertion ? { authorization: `Bearer ${assertion}` } : {}),
    };
    const response = await fetch("/ai/api/jobs", {
      method: "POST", credentials: "same-origin", headers: aiHeaders,
      body: JSON.stringify({
        title: task.title,
        project: task.project,
        budgetUsd: task.budgetUsd,
        idempotencyKey: (activeIntentRunId
          ? `hub-intent:${activeIntentRunId}:${activeIntentStage ?? "discovery"}`
          : `${activeProject}:${title}:${effectivePlan.map((step) => `${step.toolId}.${step.action}`).join(",")}`
        ).slice(0, 120),
        steps: effectivePlan.map((step, index) => ({ ...step, id: task.steps[index].id })),
        ...(intentHandoffProof ? { intentHandoffProof } : {}),
        preview: {
          externalDataPreview: externalPrivacy.preview,
          externalRecipients: useLocalAi ? [] : [executionProvider?.name ?? "自動選択"],
        },
      }),
    });
    if (!response.ok) return;
    const body = await response.json() as { job?: { id?: string; status?: string; approvalExpiresAt?: number | null; previewHash?: string } };
    const confirmSteps = effectivePlan.filter((step) => step.phase === "confirm");
    if (body.job?.id && body.job.status === "approval_required" && confirmSteps.length > 0) {
      setPendingApproval({ id: body.job.id, title: title.slice(0, 120), steps: confirmSteps.length, expiresAt: body.job.approvalExpiresAt ?? null });
      return;
    }
    if (body.job?.id) {
      if (body.job.status !== "completed") {
        await fetch(`/ai/api/jobs/${encodeURIComponent(body.job.id)}/start`, {
          method: "POST",
          credentials: "same-origin",
          headers: assertion ? { authorization: `Bearer ${assertion}` } : undefined,
        });
        const verified = await fetch(`/ai/api/jobs/${encodeURIComponent(body.job.id)}/verify`, {
          method: "POST",
          credentials: "same-origin",
          headers: aiHeaders,
          body: JSON.stringify({ evidence: task.steps.map((step) => ({
            stepId: step.id,
            kind: step.verification.kind,
            ref: step.verification.kind === "artifact" ? `chat-artifact:${conversationId}` : `chat-response:${conversationId}`,
          })) }),
        });
        if (!verified.ok) throw new Error("intent_execution_verification_failed");
      }
      if (activeIntentRunId && assertion) {
        const resultResponse = await fetch(
          `/ai/api/jobs/${encodeURIComponent(body.job.id)}/intent-result`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { authorization: `Bearer ${assertion}` },
          },
        );
        const resultBody = await resultResponse.json().catch(() => null) as {
          proof?: unknown;
          error?: unknown;
        } | null;
        if (!resultResponse.ok || typeof resultBody?.proof !== "string") {
          throw new Error(
            typeof resultBody?.error === "string"
              ? resultBody.error
              : "intent_result_unavailable",
          );
        }
        const accepted = await fetch("/api/core/intents/owner-result", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof: resultBody.proof }),
        });
        if (!accepted.ok) throw new Error("intent_result_not_accepted");
        setActiveIntentRunId(null);
        setActiveIntentStage(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("intent");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        window.dispatchEvent(new CustomEvent("hub:intent-updated"));
      }
    }
  }

  function openConversation(conversation: Conversation) {
    if (conversation.id === conversationId) return;
    archiveCurrentChat();
    setConversationId(conversation.id);
    setSelectedId(conversation.toolId);
    setSelectedProviderId(conversation.providerId);
    setActiveProject(conversation.project ?? "一般");
    setMessages(conversation.messages);
    setPrompt("");
    setError("");
    setStatus("idle");
  }

  function exportMemory() {
    const active = messages.length > 0 ? [{
      id: conversationId,
      title: [...(messages.find((message) => message.role === "user")?.content ?? "新しいチャット")].slice(0, 28).join(""),
      messages,
      toolId: selectedId,
      providerId: selectedProviderId
      , project: activeProject
    }, ...conversations.filter((conversation) => conversation.id !== conversationId)] : conversations;
    const url = URL.createObjectURL(new Blob([serializeMemoryArchive(active, memoryFacts)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-memory-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importMemory(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_MEMORY_ARCHIVE_BYTES) throw new Error("memory_archive_too_large");
      const raw = await file.text();
      const imported = parseMemoryArchive(raw);
      const rememberedFacts = parseRememberedFacts(raw);
      setConversations(imported);
      const importedProjects = [...new Set(["一般", ...imported.map((conversation) => conversation.project ?? "一般")])];
      setProjects(importedProjects);
      if (imported[0]) {
        setConversationId(imported[0].id);
        setSelectedId(imported[0].toolId);
        setSelectedProviderId(imported[0].providerId);
        setActiveProject(imported[0].project ?? "一般");
        setMessages(imported[0].messages);
      }
      setPrompt("");
      setStatus("idle");
      setError("");
      for (const content of rememberedFacts) {
        const response = await fetch("/ai/api/memory", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
        const body = await readJson(response);
        const memory = response.ok && body && typeof body === "object" ? (body as { memory?: MemoryFact }).memory : undefined;
        if (memory) setMemoryFacts((current) => current.some((item) => item.content === memory.content) ? current : [memory, ...current]);
      }
    } catch {
      setError("メモリファイルを読み込めません。AIから書き出したJSONファイルを選んでください。");
      setStatus("error");
    } finally { /* The settings panel resets its file input after each selection. */ }
  }

  async function addMemoryFact() {
    const content = window.prompt("AIに覚えさせる内容（500文字以内）")?.trim();
    if (!content) return;
    const response = await fetch("/ai/api/memory", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) });
    const body = await readJson(response);
    const memory = response.ok && body && typeof body === "object" ? (body as { memory?: MemoryFact }).memory : undefined;
    if (memory) setMemoryFacts((current) => [memory, ...current]);
    else setError("メモリを保存できませんでした。");
  }

  async function deleteMemoryFact(id: string) {
    const response = await fetch(`/ai/api/memory/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setMemoryFacts((current) => current.filter((memory) => memory.id !== id));
  }

  async function clearMemoryFacts() {
    if (!window.confirm("AIが覚えていることをすべて削除しますか？")) return;
    const response = await fetch("/ai/api/memory", { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setMemoryFacts([]);
  }

  function renameConversation(conversation: Conversation) {
    const title = window.prompt("チャット名", conversation.title)?.trim();
    if (title) setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, title: [...title].slice(0, 80).join("") } : item));
  }

  function deleteConversation(id: string) {
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
    if (id === conversationId) resetChat();
  }

  function duplicateConversation(conversation: Conversation) {
    setConversations((current) => [{ ...conversation, id: crypto.randomUUID(), title: `${conversation.title} のコピー`, pinned: false, archived: false }, ...current]);
  }

  function moveConversation(conversation: Conversation) {
    const choices = projects.filter((project) => project !== (conversation.project ?? "一般"));
    if (choices.length === 0) { openProductivity(); return; }
    const destination = window.prompt(`移動先: ${choices.join(" / ")}`, choices[0]);
    if (!destination || !projects.includes(destination)) return;
    setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, project: destination } : item));
  }

  function createProject() {
    const name = window.prompt("プロジェクト名（40文字以内）")?.trim();
    if (!name) return;
    const normalized = [...name].slice(0, 40).join("");
    setProjects((current) => current.includes(normalized) ? current : [...current, normalized]);
    setActiveProject(normalized);
    resetChat();
  }

  function selectProject(project: string) {
    archiveCurrentChat();
    setProjectWorkSettings((current) => ({ ...current, [activeProject]: workSettings }));
    setActiveProject(project);
    setWorkSettings(projectWorkSettings[project] ?? { deliverable: "回答", workflow: "direct", evidence: false, budgetUsd: 0.50, attachmentContext: "" });
    resetChat();
  }

  function branchFromMessage(messageId: number) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const source = messages[index];
    const edited = window.prompt("ここから分岐する質問", source.content)?.trim();
    if (!edited) return;
    const branchMessages = messages.slice(0, index).filter((message) => message.role !== "assistant" || message.content);
    archiveCurrentChat();
    setConversationId(crypto.randomUUID());
    setMessages(branchMessages);
    setPrompt(edited);
    setStatus("idle");
    setError("");
  }

  function regenerateFromMessage(messageId: number) {
    const assistantIndex = messages.findIndex((message) => message.id === messageId);
    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (assistantIndex < 0 || userIndex < 0) return;
    const previousPrompt = messages[userIndex].content;
    setMessages(messages.slice(0, userIndex));
    setPrompt(previousPrompt);
    setStatus("idle");
    setError("");
  }

  function selectTool(id: string) {
    setSelectedId(id);
    resetChat();
  }

  function chooseUsage(action: AiUsageAction) {
    sessionStorage.setItem("hub.ai.usage-guide.seen", "1"); setUsageGuideOpen(false);
    if (action === "organization") { setOrganizationOpen(true); return; }
    if (action === "pc-local") { setLocalRunnerOpen(true); return; }
    if (action === "develop") { setDevelopOpen(true); return; }
    if (action === "on-device") { setOnDeviceOpen(true); return; }
    if (action === "image") { selectTool("image"); setPrompt("作りたい画像の用途、被写体、構図、雰囲気、縦横比を入力してください。\n"); return; }
    if (action === "research") { selectTool("analyze"); setPrompt("次のテーマについて最新情報を検索し、出典と確認日を付けて調査してください。\nテーマ: "); return; }
    selectTool("analyze"); setPrompt("");
  }

  function selectProvider(id: "auto" | AiProviderId) {
    if (id !== "auto" && !providers.some((provider) => provider.id === id && provider.available)) {
      setError("このAIモデルは現在利用できません。利用可能なモデルを選んでください。");
      setStatus("error");
      return;
    }
    setUseLocalAi(false);
    setSelectedProviderId(id);
    setError("");
    setStatus("idle");
  }

  function selectAiModel(value: string) {
    if (value === BYOK_SETUP_VALUE) {
      setByokOpen(true);
      return;
    }
    if (value === REMOTE_SETUP_VALUE) {
      remotePc.setOpen(true);
      if (remotePc.connected) remotePc.refresh();
      return;
    }
    const remoteChoice = parseRemoteModelValue(value);
    if (remoteChoice) {
      setUseLocalAi(false);
      setByokSelection(null);
      remotePc.select(remoteChoice);
      setError("");
      setStatus("idle");
      return;
    }
    const byokChoice = parseByokModelValue(value);
    if (byokChoice) {
      setUseLocalAi(false);
      remotePc.select(null);
      setByokSelection(byokChoice);
      setError("");
      setStatus("idle");
      return;
    }
    setByokSelection(null);
    remotePc.select(null);
    if (value === "device:setup") {
      setOnDeviceOpen(true);
      return;
    }
    if (value === "local:setup") {
      setLocalRunnerOpen(true);
      return;
    }
    if (value.startsWith("local:")) {
      const index = Number(value.slice(6));
      const model = localAiConnection?.models[index];
      if (localAiConnection && model) {
        setLocalAiConnection({ ...localAiConnection, model });
        setUseLocalAi(true);
        resetChat();
      }
      return;
    }
    selectProvider(value as "auto" | AiProviderId);
  }

  async function showHubpediaEvidence(question: string) {
    addUserMessage(question, []);
    setStatus("paying");
    try {
      const response = await fetch(`/api/hubpedia/retrieve?q=${encodeURIComponent(question.slice(0, 200))}&limit=6`, { cache: "no-store" });
      const { content, citations } = evidenceMessage(response.ok ? await response.json() : null);
      setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content, citations }]);
      setStatus("done");
    } catch {
      setError("ハブペディアの根拠を取得できませんでした。");
      setStatus("error");
    }
  }

  function prepareExecution() {
    if (status === "paying" || status === "confirm") return;
    setError("");
    const submitted = prompt.trim();
    if (!submitted) {
      setError("実行する内容を入力してください。");
      setStatus("error");
      return;
    }
    if ([...submitted].length > 8_000) {
      setError("入力は8,000文字以内にしてください。");
      setStatus("error");
      return;
    }
    if (selected?.id === "hubpedia-answer" && !paymentReady) {
      // Without paid execution there is no grounded model call. Show the evidence Hub retrieval finds, with no generated answer.
      void showHubpediaEvidence(submitted);
      return;
    }
    const grounded = selected?.id === "hubpedia-answer"; // answers must come from the Worker's checked pipeline, not a local model
    if (!grounded && localAiReady) {
      void runLocalAiInChat(submitted);
      return;
    }
    if (!grounded && remoteUsable) {
      void runRemoteInChat(submitted);
      return;
    }
    if (!grounded && byokUsable) {
      void runByokInChat(submitted);
      return;
    }
    if (!grounded && onDeviceReady) {
      void runOnDeviceAiInChat(submitted);
      return;
    }
    if (localPolicy === "only") {
      setError("ローカル限定のため外部AIへは送信しません。Local Runnerを接続してください。");
      setStatus("error");
      return;
    }
    if (localAiSelected) {
      setError(executionBlockReason);
      setStatus("error");
      return;
    }
    if (!paymentReady) {
      setError(paidEnabled ? "x402決済は現在準備中です。利用可能になるまでお待ちください。" : "この端末内AIまたは接続PCを選んでください。");
      setStatus("error");
      return;
    }
    if (externalPrivacy.blocked) {
      setError(`外部送信を停止しました: ${externalPrivacy.findings.filter((finding) => finding.blocking).map((finding) => finding.label).join("・")}。削除するかローカルAIを使用してください。`);
      setStatus("error");
      return;
    }
    setStatus("confirm");
  }

  async function runOnDeviceAiInChat(submitted: string) {
    const bridge = onDeviceAiBridge();
    if (!bridge) {
      setOnDeviceOpen(true);
      setError("スマホ内AIへ接続できません。アプリを開き直してください。");
      setStatus("error");
      return;
    }
    addUserMessage(submitted, attachments.map((file) => file.name));
    setStatus("paying");
    setError("");
    const controller = new AbortController();
    executionAbort.current = controller;
    controller.signal.addEventListener("abort", () => { void bridge.cancel?.().catch(() => undefined); }, { once: true });
    const priority = ["gemma-4-e2b-it", "qwen-2.5-1.5b-it", "qwen-3-0.6b-it", "smollm2-360m-it", "smollm2-135m-it", "phi-4-mini-it"];
    let availableModels = onDeviceModels;
    if (availableModels.length === 0) {
      try {
        availableModels = await bridge.listModels();
        setOnDeviceModels(availableModels);
      } catch {
        availableModels = [];
      }
    }
    const candidates = [...availableModels].sort((left, right) => priority.indexOf(left.id) - priority.indexOf(right.id));
    const requestPrompt = buildConversationMemory(messages, promptWithAttachments(submitted)).slice(-MAX_PROMPT_CHARACTERS);
    for (const model of candidates) {
      const messageId = Date.now() + 1;
      let streamed = "";
      try {
        setMessages((current) => [...current, {
          id: messageId,
          role: "assistant",
          content: "",
          receipt: `スマホ内AI · ${model.name} · 無料`,
        }]);
        const input = { modelId: model.id, prompt: requestPrompt, maxOutputTokens: 2_048, temperature: 0.7 };
        const result = bridge.generateStream
          ? await bridge.generateStream(input, (chunk) => {
              streamed = `${streamed}${chunk}`.slice(0, 32_000);
              setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: streamed } : message));
            })
          : await bridge.generate(input);
        if (controller.signal.aborted) {
          setStatus("done");
          executionAbort.current = null;
          return;
        }
        setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: streamed || result.output } : message));
        setStatus("done");
        executionAbort.current = null;
        return;
      } catch {
        setMessages((current) => current.filter((message) => message.id !== messageId || Boolean(message.content)));
        if (controller.signal.aborted) {
          setStatus("done");
          executionAbort.current = null;
          return;
        }
        // A device backend can reject one model while a smaller installed model remains usable.
      }
    }
    setOnDeviceOpen(true);
    setError("インストール済みのスマホ内AIを実行できませんでした。モデル画面で状態を確認してください。");
    setStatus("error");
    executionAbort.current = null;
  }

  // 自分のAPIキーでの実行。アプリが提供元へ直接つなぎ、断片だけをここへ流す。
  // プロンプトも応答もHubへは送らず、会話の保存先も変えない。
  async function runRemoteInChat(submitted: string) {
    const chosen = remotePc.chosen;
    if (!chosen) {
      remotePc.setOpen(true);
      setError("自分のPCのAIの接続を確認してください。");
      setStatus("error");
      return;
    }
    if (externalPrivacy.blocked) {
      setError(`外部送信を停止しました: ${externalPrivacy.findings.filter((finding) => finding.blocking).map((finding) => finding.label).join("・")}。削除するか端末内AIを使用してください。`);
      setStatus("error");
      return;
    }
    addUserMessage(submitted, attachments.map((file) => file.name));
    setStatus("paying");
    setError("");
    const controller = new AbortController();
    executionAbort.current = controller;
    const requestPrompt = buildConversationMemory(messages, promptWithAttachments(submitted)).slice(-MAX_PROMPT_CHARACTERS);
    const messageId = Date.now() + 1;
    let streamed = "";
    setMessages((current) => [...current, { id: messageId, role: "assistant", content: "", receipt: `自分のPC · ${chosen.name} · ${chosen.modelId}` }]);
    try {
      await remotePc.run([{ role: "user", content: requestPrompt }], (chunk) => {
        streamed = `${streamed}${chunk}`.slice(0, 64_000);
        setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: streamed } : message));
      }, controller.signal);
      setStatus("done");
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== messageId || Boolean(message.content)));
      if (controller.signal.aborted) {
        setStatus("done");
      } else {
        setError(reason instanceof Error ? reason.message : "自分のPCで実行できませんでした。");
        setStatus("error");
      }
    } finally {
      executionAbort.current = null;
    }
  }

  async function runByokInChat(submitted: string) {
    const manager = nativeByokManager();
    const selection = byokSelection;
    if (!manager || !selection) {
      setByokOpen(true);
      setError("自分のAPIキーの接続を確認してください。");
      setStatus("error");
      return;
    }
    if (externalPrivacy.blocked) {
      setError(`外部送信を停止しました: ${externalPrivacy.findings.filter((finding) => finding.blocking).map((finding) => finding.label).join("・")}。削除するか端末内AIを使用してください。`);
      setStatus("error");
      return;
    }
    addUserMessage(submitted, attachments.map((file) => file.name));
    setStatus("paying");
    setError("");
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    executionAbort.current = controller;
    controller.signal.addEventListener("abort", () => { void manager.cancel(requestId).catch(() => undefined); }, { once: true });
    const requestPrompt = buildConversationMemory(messages, promptWithAttachments(submitted)).slice(-MAX_PROMPT_CHARACTERS);
    const messageId = Date.now() + 1;
    let streamed = "";
    setMessages((current) => [...current, {
      id: messageId,
      role: "assistant",
      content: "",
      receipt: `自分のAPIキー · ${byokSelectedModel?.connectionLabel ?? ""} · ${byokSelectedModel?.name ?? selection.modelId}`,
    }]);
    try {
      await manager.generate(
        { connectionId: selection.connectionId, model: selection.modelId, messages: [{ role: "user", content: requestPrompt }], maxOutputTokens: 4_096 },
        (chunk) => {
          streamed = `${streamed}${chunk}`.slice(0, 64_000);
          setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: streamed } : message));
        },
        requestId,
      );
      setStatus("done");
    } catch (reason) {
      setMessages((current) => current.filter((message) => message.id !== messageId || Boolean(message.content)));
      if (controller.signal.aborted) {
        setStatus("done");
      } else {
        setError(byokErrorMessage(reason));
        setStatus("error");
      }
    } finally {
      executionAbort.current = null;
    }
  }

  async function runLocalAiInChat(submitted: string) {
    if (!localAiConnection) return;
    const attachedNames = attachments.map((file) => file.name);
    addUserMessage(submitted, attachedNames);
    setStatus("paying");
    setError("");
    try {
      const site = localAiConnection.policy.allowHubRead
        ? await orchestrateHubSite(submitted)
        : { context: "", sources: [] as HubSiteToolId[], workPlan: [], resultCount: 0, reads: [] };
      setSiteSources(site.sources);
      setSiteReads(site.reads);
      const conversation = buildConversationMemory(messages, promptWithAttachments(submitted));
      const skillContext=buildAutomaticSkillContext(submitted,localPolicy==="only"?"local_only":"local_preferred");
      const requestPrompt = `${skillContext ? `${skillContext}\n\n` : ""}${site.context ? `${site.context}\n\n` : ""}${conversation}`.slice(-MAX_PROMPT_CHARACTERS);
      const callLocal = async (model: LocalAiConnection["model"], localPrompt: string) => {
        const response = await fetch("http://127.0.0.1:43127/local-ai/chat", {
          method: "POST",
          headers: { authorization: `Bearer ${localAiConnection.sessionToken}`, "content-type": "application/json" },
          body: JSON.stringify({ runtime: model.runtime, model: model.id, prompt: localPrompt, policy: localAiConnection.policy })
        });
        const body = await response.json() as { output?: string; error?: string };
        if (!response.ok || typeof body.output !== "string") throw new Error(body.error ?? "local_ai_failed");
        return body.output;
      };
      if (executionMode === "auto") {
        const output = await callLocal(localExecutionModels[0], requestPrompt);
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content: output, receipt: `接続PC · ${localExecutionModels[0].name} · 無料` }]);
      } else if (executionMode === "compare") {
        const candidates = localExecutionModels.slice(0, 2);
        const outputs: Array<{ name: string; output: string }> = [];
        for (const model of candidates) {
          const output = await callLocal(model, requestPrompt);
          outputs.push({ name: model.name, output });
          setMessages((current) => [...current, { id: Date.now() + outputs.length, role: "assistant", content: output, receipt: `比較 · 接続PC · ${model.name} · 無料` }]);
        }
      } else {
        setOrganizationRun({ status: "running", stages: [], artifacts: [] });
        const harness=new LocalRunnerHarness(localAiConnection.sessionToken,localExecutionModels);
        const task=compileAiTask({title:submitted,project:activeProject,privacy:"local_only",budgetUsd:0,steps:[]});
        let completed=false;
        for await(const event of harness.run({task,prompt:requestPrompt,organization:pendingOrganization})){
          if(event.type==="started"){organizationHarness.current={harness,runId:event.runId};continue;}
          if(event.type==="failed")throw new Error(event.error);
          // A harness may report partial output while it works; only the closing
          // event carries the stages and artifacts this block reads.
          if(event.type!=="completed")continue;
          completed=true;organizationHarness.current=null;
          const modelNames=[...new Set(event.stages.map((step)=>step.model))].join("・");
          setOrganizationRun({status:"completed",stages:event.stages,artifacts:event.artifacts});
          setMessages((current)=>[...current,{id:Date.now()+10,role:"assistant",content:event.output,receipt:`ローカルAIチーム · Harness: ${harness.manifest.name} ${harness.manifest.version} · ${modelNames} · 無料`}]);
        }
        if(!completed)throw new Error("local_orchestration_incomplete");
      }
      await recordHubWork(submitted, site.workPlan);
      setStatus("done");
    } catch (cause) {
      if (executionMode === "team") setOrganizationRun((current) => current ? { ...current, status: "failed" } : { status: "failed", stages: [], artifacts: [] });
      if (cause instanceof DOMException && cause.name === "AbortError") { setError("AI組織の実行を中止しました。"); setStatus("error"); return; }
      setLocalAiConnection(null);
      setLocalRunnerOpen(true);
      setError("Local Runnerとの接続が切れました。再度ペアリングしてください。");
      setStatus("error");
    }
  }

  async function rerunOrganizationRole(artifact: { id: string; roleId: string; roleName: string; summary: string }) {
    if (!localAiConnection) return;
    const model=localExecutionModels[0] ?? localAiConnection.model;
    setOrganizationRun((current)=>current?{...current,status:"running"}:current);
    try{
      const response=await fetch("http://127.0.0.1:43127/local-ai/chat",{method:"POST",headers:{authorization:`Bearer ${localAiConnection.sessionToken}`,"content-type":"application/json"},body:JSON.stringify({runtime:model.runtime,model:model.id,prompt:`役職「${artifact.roleName}」の成果を、正確性・具体性・実行可能性の観点で改善してください。\n\n現在の成果:\n${artifact.summary}`.slice(0,8_000),policy:localAiConnection.policy})});
      const body=await response.json() as {output?:string};if(!response.ok||typeof body.output!=="string")throw new Error("rerun_failed");
      setOrganizationRun((current)=>current?{...current,status:"completed",artifacts:current.artifacts.map((item)=>item.id===artifact.id?{...item,summary:body.output!}:item)}:current);
    }catch{setOrganizationRun((current)=>current?{...current,status:"failed"}:current);}
  }

  function addUserMessage(content: string, attachedNames: string[] = []) {
    const visibleContent = attachedNames.length > 0 ? `${content}\n\n添付: ${attachedNames.join("、")}` : content;
    setMessages((current) => [...current, { id: Date.now(), role: "user", content: visibleContent }]);
    setPrompt("");
    setAttachments([]);
  }

  async function runJpycPaymentTest() {
    if (!paidEnabled) return;
    const option = catalog?.payment.options?.find((item) => item.currency === "JPYC");
    if (!catalog?.payment.testEnabled || !option || option.network !== "eip155:1001") return;
    setPaymentTestStatus("paying");
    setPaymentTestResult("");
    try {
      const [{ x402Client, x402HTTPClient }, { ExactEvmScheme }, { wrapFetchWithPayment }, { createWalletClient, custom, getAddress }, { kairos }] = await Promise.all([
        import("@x402/core/client"), import("@x402/evm/exact/client"), import("@x402/fetch"), import("viem"), import("viem/chains"),
      ]);
      const provider = getHubEvmProvider() as EthereumProvider | null;
      if (!provider) throw new Error("wallet_missing");
      await switchPaymentChain(provider, option.network);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error("wallet_account_unavailable");
      const address = getAddress(accounts[0]);
      const walletClient = createWalletClient({ account: address, chain: kairos, transport: custom(provider) });
      const signer: ClientEvmSigner = {
        address,
        async signTypedData(message) { return walletClient.signTypedData(message as Parameters<typeof walletClient.signTypedData>[0]); }
      };
      const maximum = 1_000_000_000_000_000_000n;
      const client = new x402Client()
        .register(option.network, new ExactEvmScheme(signer))
        .registerPolicy((_version, requirements) => requirements.filter((item) => allowedPayment(item, option.network, option.asset, maximum)));
      const response = await wrapFetchWithPayment(fetch, client)("/ai/api/payment-test", { method: "POST" });
      if (!response.ok) throw new Error(errorMessage(await readJson(response)));
      const settled = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
      setPaymentTestResult(`決済成功 · 1 JPYC · ${settled.transaction || "settled"}`);
      setPaymentTestStatus("done");
    } catch (cause) {
      setPaymentTestResult(userFacingError(cause));
      setPaymentTestStatus("error");
    }
  }

  async function approveAndRun(useSession = false) {
    if (!paidEnabled) return;
    if (!selected || !executionProvider || !catalog) return;
    const submitted = prompt.trim();
    if (!submitted) return;
    const attachedNames = attachments.map((file) => file.name);
    const remembered = memoryFacts.length > 0 ? `覚えているユーザー情報:\n${memoryFacts.map((fact) => `- ${fact.content}`).join("\n")}\n\n` : "";
    const submittedWithAttachments = promptWithAttachments(submitted);
    addUserMessage(submitted, attachedNames);
    setStatus("paying");
    setError("");
    try {
      const [
        { x402Client, x402HTTPClient },
        { ExactEvmScheme },
        { BatchSettlementEvmScheme, InMemoryClientChannelStorage },
        { wrapFetchWithPayment },
        { createWalletClient, custom, getAddress },
        { generatePrivateKey, privateKeyToAccount },
        { baseSepolia, kairos },
      ] = await Promise.all([
        import("@x402/core/client"),
        import("@x402/evm/exact/client"),
        import("@x402/evm/batch-settlement/client"),
        import("@x402/fetch"),
        import("viem"),
        import("viem/accounts"),
        import("viem/chains"),
      ]);
      const site = isMedia ? { context: "", sources: [] as HubSiteToolId[], workPlan: [], resultCount: 0, reads: [] } : await orchestrateHubSite(submitted);
      setSiteSources(site.sources);
      setSiteReads(site.reads);
      // hubpedia-answer sends only the question: it is the retrieval query, so no site context, memory or history is prepended.
      const requestPrompt = isMedia || selected.id === "hubpedia-answer"
        ? (isMedia ? submittedWithAttachments : submitted)
        : `${site.context ? `${site.context}\n\n` : ""}${remembered}${buildConversationMemory(messages, submittedWithAttachments)}`.slice(-MAX_PROMPT_CHARACTERS);
      const provider = getHubEvmProvider() as EthereumProvider | null;
      if (!provider) throw new Error("wallet_missing");
      if (!paymentOption || !["eip155:84532", "eip155:1001"].includes(paymentOption.network)) throw new Error("network_unsupported");
      await switchPaymentChain(provider, paymentOption.network);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) {
        throw new Error("wallet_account_unavailable");
      }
      const address = getAddress(accounts[0]);
      const chain = paymentOption.network === "eip155:1001" ? kairos : baseSepolia;
      const walletClient = createWalletClient({ account: address, chain, transport: custom(provider) });
      const signer: ClientEvmSigner = {
        address,
        async signTypedData(message) {
          return walletClient.signTypedData(message as Parameters<typeof walletClient.signTypedData>[0]);
        }
      };
      const authorizedMaximumUsd = Math.min(Number(executionChargeUsd), workSettings.budgetUsd);
      const maxAtomic = paymentOption.currency === "JPYC"
        ? decimalProductToAtomic(String(authorizedMaximumUsd), paymentOption.unitsPerUsd ?? "150", paymentOption.decimals)
        : decimalProductToAtomic(String(authorizedMaximumUsd), "1", paymentOption.decimals);
      const activeSession = paymentSession.current && paymentSession.current.expiresAt > Date.now()
        ? paymentSession.current
        : null;
      if (!activeSession && paymentSession.current) {
        paymentSession.current = null;
        setPaymentSessionExpiry(null);
      }
      let client: x402Client;
      let usingSession = false;
      if (paymentOption.currency === "USDC" && (useSession || activeSession)) {
        usingSession = true;
        if (activeSession) {
          client = activeSession.client;
        } else {
          const voucherAccount = privateKeyToAccount(generatePrivateKey());
          const scheme = new BatchSettlementEvmScheme(signer, {
            storage: new InMemoryClientChannelStorage(),
            voucherSigner: voucherAccount,
            salt: generatePrivateKey(),
            rpcUrl: "https://sepolia.base.org",
            depositStrategy: () => PAYMENT_SESSION_CAP_ATOMIC,
          });
          const expiresAt = Date.now() + PAYMENT_SESSION_DURATION_MS;
          client = new x402Client()
            .register(paymentOption.network, scheme)
            .register(paymentOption.network, new ExactEvmScheme(signer))
            .registerPolicy((_version, requirements) => requirements.filter((item) => allowedPayment(item, paymentOption.network, paymentOption.asset, PAYMENT_SESSION_CAP_ATOMIC)));
          paymentSession.current = { client, scheme, expiresAt };
          setPaymentSessionExpiry(expiresAt);
        }
      } else {
        client = new x402Client().register(paymentOption.network, new ExactEvmScheme(signer));
      }
      if (!usingSession) client.registerPolicy((_version, requirements) => requirements.filter((item) => allowedPayment(item, paymentOption.network, paymentOption.asset, maxAtomic)));
      const paidFetch = wrapFetchWithPayment(fetch, client);
      const abortController = new AbortController();
      executionAbort.current = abortController;
      if (executionMode === "team" && pendingOrganization) {
        const routing = planOrganizationRouting(
          pendingOrganization,
          localAiConnection?.models ?? [],
          providers,
          localPolicy === "only" ? "local_only" : "local_preferred",
        );
        const task = compileAiTask({
          title: submitted,
          project: activeProject,
          privacy: localPolicy === "only" ? "local_only" : "local_preferred",
          budgetUsd: workSettings.budgetUsd,
          steps: site.workPlan,
        });
        const plan = buildAiExecutionPlan({ task, organization: pendingOrganization, assignments: routing.assignments });
        if (!plan.valid) throw new Error(plan.errors.includes("external_budget_exceeded") ? "budget_exceeded" : "invalid_execution_plan");
        const runRole = async ({ target, prompt: roleRequest, signal }: Parameters<Parameters<typeof runHybridOrganization>[0]["runRole"]>[0]) => {
          if (target.kind === "local") {
            if (!localAiConnection) throw new Error("local_runner_required");
            const model = localAiConnection.models.find((item) => item.id === target.modelId) ?? localAiConnection.model;
            const localResponse = await fetch("http://127.0.0.1:43127/local-ai/chat", {
              method: "POST",
              headers: { authorization: `Bearer ${localAiConnection.sessionToken}`, "content-type": "application/json" },
              body: JSON.stringify({ runtime: model.runtime, model: model.id, prompt: roleRequest, policy: localAiConnection.policy }),
              signal,
            });
            const localBody = await localResponse.json() as { output?: string; error?: string };
            if (!localResponse.ok || typeof localBody.output !== "string") throw new Error(localBody.error ?? "local_ai_failed");
            return localBody.output;
          }
          const targetProvider = providers.find((provider) => provider.id === target.providerId && provider.available);
          if (!targetProvider) throw new Error("provider_unavailable");
          const externalResponse = await paidFetch(`/ai/api/providers/${encodeURIComponent(targetProvider.id)}/tools/${encodeURIComponent(selected.id)}/stream`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: roleRequest }),
            signal,
          });
          if (!externalResponse.ok) throw new Error(errorMessage(await readJson(externalResponse)));
          let output = "";
          await consumeAiStream(externalResponse, (delta) => { output += delta; });
          return output;
        };
        setOrganizationRun({ status: "running", stages: [], artifacts: [] });
        const hybrid = await runHybridOrganization({
          organization: pendingOrganization,
          plan,
          runRole,
          synthesize: runRole,
          signal: abortController.signal,
        });
        setOrganizationRun({
          status: "completed",
          stages: hybrid.results.map((item) => ({ id: item.roleId, label: item.roleName, model: item.target.kind === "local" ? item.target.modelId : item.target.providerId, durationMs: item.durationMs })),
          artifacts: hybrid.results.map((item) => ({ id: crypto.randomUUID(), roleId: item.roleId, roleName: item.roleName, summary: item.output })),
        });
        const localCount = plan.roles.filter((role) => role.target.kind === "local").length;
        const externalCount = plan.roles.length - localCount;
        setMessages((current) => [...current, {
          id: Date.now() + 10,
          role: "assistant",
          content: hybrid.output,
          receipt: `AI組織 · ローカル${localCount}役 · 外部${externalCount}役 · 上限 $${plan.maximumExternalCostUsd.toFixed(2)}`,
        }]);
        await recordHubWork(submitted, site.workPlan);
        setStatus("done");
        executionAbort.current = null;
        return;
      }
      if (executionMode !== "auto" && !isMedia) {
        const candidates = executionMode === "team" ? comparisonProviders.slice(0, 2) : comparisonProviders;
        const candidateOutputs: Array<{ provider: AiProvider; output: string }> = [];
        for (const target of candidates) {
          const response = await paidFetch(`/ai/api/providers/${encodeURIComponent(target.id)}/tools/${encodeURIComponent(selected.id)}/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: requestPrompt }), signal: abortController.signal });
          if (!response.ok) throw new Error(errorMessage(await readJson(response)));
          const settled = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
          const messageId = Date.now() + candidates.indexOf(target) + 1;
          const receipt = `${executionMode === "team" ? "候補" : "比較"} · ${target.name} · $${target.priceUsd} (${paymentOption.currency}) · ${settled.network} · ${settled.transaction || "settled"}`;
          let output = "";
          setMessages((current) => [...current, { id: messageId, role: "assistant", content: "", receipt }]);
          await consumeAiStream(response, (delta) => {
            output += delta;
            setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: message.content + delta } : message));
          });
          candidateOutputs.push({ provider: target, output });
        }
        if (executionMode === "team") {
          const synthesizer = comparisonProviders[2];
          if (!synthesizer) throw new Error("provider_unavailable");
          const synthesisPrompt = `${requestPrompt}\n\n以下は同じ依頼に対する独立した候補です。事実性、要件充足、明確さ、実行可能性を評価し、誤りや矛盾を直した最終回答だけを作成してください。\n\n${candidateOutputs.map((candidate, index) => `候補${index + 1} (${candidate.provider.name}):\n${candidate.output}`).join("\n\n")}`.slice(-MAX_PROMPT_CHARACTERS);
          const response = await paidFetch(`/ai/api/providers/${encodeURIComponent(synthesizer.id)}/tools/${encodeURIComponent(selected.id)}/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: synthesisPrompt }), signal: abortController.signal });
          if (!response.ok) throw new Error(errorMessage(await readJson(response)));
          const settled = new x402HTTPClient(client).getPaymentSettleResponse((name) => response.headers.get(name));
          const messageId = Date.now() + 10;
          const receipt = `統合 · ${synthesizer.name} · $${synthesizer.priceUsd} (${paymentOption.currency}) · ${settled.network} · ${settled.transaction || "settled"}`;
          setMessages((current) => [...current, { id: messageId, role: "assistant", content: "", receipt }]);
          await consumeAiStream(response, (delta) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: message.content + delta } : message)));
        }
        await recordHubWork(submitted, site.workPlan);
        setStatus("done");
        return;
      }
      const endpoint = selected.output === "image"
        ? "/ai/api/media/image"
        : selected.output === "video"
          ? "/ai/api/media/video"
          : `/ai/api/providers/${encodeURIComponent(executionProvider.id)}/tools/${encodeURIComponent(selected.id)}/stream`;
      const response = await paidFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selected.output === "image" || selected.output === "video"
          ? { prompt: submitted, aspectRatio: selected.output === "image" ? "1:1" : "16:9" }
          : { prompt: requestPrompt }),
        signal: abortController.signal
      });
      if (!response.ok) throw new Error(errorMessage(await readJson(response)));
      const httpClient = new x402HTTPClient(client);
      const settled = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
      const receipt = `${executionProvider.name} · $${executionPriceUsd} (${paymentOption.currency}) · ${settled.network} · ${settled.transaction || "settled"}`;
      if (selected.output === "text") {
        const messageId = Date.now() + 1;
        setMessages((current) => [...current, { id: messageId, role: "assistant", content: "", receipt }]);
        await consumeAiStream(response, (delta) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: message.content + delta } : message)), (citations) => setMessages((current) => current.map((message) => message.id === messageId ? { ...message, citations } : message)));
        await recordHubWork(submitted, site.workPlan);
        setStatus("done");
        executionAbort.current = null;
        return;
      }
      const body = await readJson(response);
      if (selected.output === "image") {
        const imageBase64 = readString(body, "imageBase64");
        const mimeType = readString(body, "mimeType") ?? "image/png";
        if (!imageBase64) throw new Error("provider_failed");
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content: "画像を生成しました。", mediaType: "image", mediaUrl: `data:${mimeType};base64,${imageBase64}`, receipt }]);
      } else if (selected.output === "video") {
        const token = readString(body, "token");
        if (!token) throw new Error("provider_failed");
        const messageId = Date.now() + 1;
        setMessages((current) => [...current, { id: messageId, role: "assistant", content: "動画を生成しています…", receipt }]);
        void pollVideo(token, messageId);
      } else {
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content: readString(body, "output") ?? "結果を取得しました。", receipt }]);
      }
      setStatus("done");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") { setStatus("done"); return; }
      if (cause instanceof Error && cause.message === "no_evidence") {
        // The Worker found nothing in Hubpedia, never called a model and did not settle the payment.
        setMessages((current) => [...current, { id: Date.now() + 1, role: "assistant", content: HUBPEDIA_NO_EVIDENCE, receipt: "課金なし" }]);
        setStatus("done");
        return;
      }
      setError(userFacingError(cause));
      setStatus("error");
    } finally { executionAbort.current = null; }
  }

  async function endPaymentSession() {
    if (!paidEnabled) return;
    const current = paymentSession.current;
    if (!current) return;
    setStatus("paying");
    setError("");
    try {
      await current.scheme.refund("/ai/api/payment-session", { fetch });
      paymentSession.current = null;
      setPaymentSessionExpiry(null);
      setStatus("idle");
    } catch (cause) {
      setStatus("error");
      setError(userFacingError(cause));
    }
  }

  async function pollVideo(token: string, messageId: number) {
    try {
      const response = await fetch(`/ai/api/media/video/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(body));
      const videoStatus = readString(body, "status");
      if (videoStatus === "completed") {
        setMessages((current) => current.map((message) => message.id === messageId
          ? { ...message, content: "動画を生成しました。", mediaType: "video", mediaUrl: `/ai/api/media/video/${encodeURIComponent(token)}/content` }
          : message));
        return;
      }
      if (videoStatus === "failed") throw new Error("provider_failed");
      pollingTimers.current.push(window.setTimeout(() => { void pollVideo(token, messageId); }, 8_000));
    } catch (cause) {
      setMessages((current) => current.map((message) => message.id === messageId ? { ...message, content: "動画生成に失敗しました。" } : message));
      setError(userFacingError(cause));
      setStatus("error");
    }
  }

  const isRail = variant === "rail";
  const chatBusy = status === "paying" || status === "confirm";
  const composerBlocked = developOpen
    ? !workState.ready || workState.busy || chatBusy || prompt.length > 32000
    : chatBusy || !executionReady || [...prompt].length > 8000;
  function submitComposer() {
    if (composerBlocked || !prompt.trim()) return;
    if (developOpen) workControls.current?.submit();
    else prepareExecution();
  }

  return (
    <section className={`ai-chat${isRail ? " ai-chat--rail" : " tab-left-column-layout"}`} id={isRail ? undefined : "main-content"}>
      <aside data-hub-page-left-column className={`ai-chat__sidebar${isRail ? "" : " tab-left-column"}`}>
        <div className="ai-chat__brand tab-left-column__header">
          <div><strong>AI</strong></div>
        </div>
        <button className="ai-chat__new" type="button" onClick={resetChat} aria-label="新しいチャット" title={sidebarCollapsed ? "新しいチャット" : undefined}><Plus aria-hidden="true" /><span className="ai-chat__new-copy">新しいチャット</span></button>
        <div className="ai-chat__history-filter ai-chat__history-filter--primary"><Search aria-hidden="true" /><input type="search" className="ai-chat__history-search" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="チャットを検索" aria-label="チャット履歴を検索" /><button type="button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "通常" : "保管"}</button></div>
        <div className="ai-chat__nav-label">プロジェクト</div>
        <nav className="ai-chat__tools ai-chat__projects" aria-label="プロジェクト">
          {projects.map((project) => <button key={project} type="button" className={project === activeProject ? "is-selected" : ""} onClick={() => selectProject(project)} title={sidebarCollapsed ? project : undefined}><span className="ai-chat__tool-icon"><Folder aria-hidden="true" /></span><span><strong>{project}</strong></span></button>)}
          <button type="button" onClick={createProject} title={sidebarCollapsed ? "プロジェクトを作成" : undefined}><span className="ai-chat__tool-icon"><Plus aria-hidden="true" /></span><span><strong>新しいプロジェクト</strong></span></button>
        </nav>
        {conversations.length > 0 ? <>
          <div className="ai-chat__nav-label">ピン留め・最近のチャット</div>
          <nav className="ai-chat__tools" aria-label="チャット履歴">
            {conversations.filter((conversation) => Boolean(conversation.archived) === showArchived && (conversation.project ?? "一般") === activeProject && conversation.title.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase())).sort((left, right) => Number(right.pinned) - Number(left.pinned)).map((conversation) => (
              <div className="ai-chat__history-row" key={conversation.id}>
                <button type="button" className={conversation.id === conversationId ? "is-selected" : ""} onClick={() => openConversation(conversation)} title={sidebarCollapsed ? conversation.title : undefined}><span><strong>{conversation.title}</strong></span></button>
                <button type="button" className="ai-chat__history-action" onClick={() => setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, pinned: !item.pinned } : item))} aria-label={`${conversation.title}を${conversation.pinned ? "ピン留め解除" : "ピン留め"}`}><Pin aria-hidden="true" /></button>
                <details className="ai-chat__history-menu"><summary aria-label={`${conversation.title}の操作`}>•••</summary><div><button type="button" onClick={() => renameConversation(conversation)}>名前を変更</button><button type="button" onClick={() => duplicateConversation(conversation)}>複製</button><button type="button" onClick={() => moveConversation(conversation)}>プロジェクトへ移動</button><button type="button" onClick={() => setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, archived: !item.archived, pinned: false } : item))}>{conversation.archived ? "保管を解除" : "アーカイブ"}</button><button type="button" onClick={() => deleteConversation(conversation.id)}>削除</button></div></details>
              </div>
            ))}
          </nav>
        </> : null}
        <div className="ai-chat__sidebar-footer">
          <button type="button" onClick={() => setAccountSyncOpen(true)} title={sidebarCollapsed ? "アカウント同期" : undefined}><Cloud aria-hidden="true" /><span>アカウント同期</span></button>
          <button type="button" onClick={() => openProductivity()} title={sidebarCollapsed ? "AI設定" : undefined}><Settings aria-hidden="true" /><span>AI設定</span></button>
        </div>
      </aside>

      <section className={`ai-chat__main${isRail ? "" : " tab-left-column-main"}${messages.length === 0 && !developOpen ? " ai-chat__main--empty" : ""}`}>
        <header className="ai-chat__header">
          <div className="ai-chat__workspace-switch" aria-label="AIワークスペース">
            <button type="button" className={!developOpen ? "is-selected" : ""} aria-pressed={!developOpen} onClick={() => setDevelopOpen(false)}>会話</button>
            <button type="button" className={developOpen ? "is-selected" : ""} aria-pressed={developOpen} onClick={() => setDevelopOpen(true)} disabled={chatBusy}>作業{workState.busy ? " · 実行中" : ""}</button>
          </div>
          {developOpen ? <span className="ai-chat__work-label">{workState.label}</span> : <>
          {isRail ? <button type="button" className="ai-chat__on-device-button" onClick={() => setOnDeviceOpen(true)}>
            <Smartphone aria-hidden="true" />
            <span>この端末内AI</span>
          </button> : null}
          <div className="ai-chat__model-picker">
            <span>AIモデル</span>
            {paidEnabled && catalogStatus !== "ready"
              ? <strong>{catalogStatus === "loading" ? "モデルを確認中" : "モデルを取得できません"}</strong>
              : paidEnabled && isMedia
              ? <strong>{executionProvider?.name} · ${executionPriceUsd}</strong>
              : <>
                <select className="ai-model-picker__native" value={activeModelValue} onChange={(event) => selectAiModel(event.target.value)} aria-label="AIモデルを選択">
                  {paidEnabled ? <option value="auto" disabled={!providers.some((provider) => provider.available)}>自動選択 · ${recommendedProvider?.priceUsd ?? executionPriceUsd}</option> : null}
                  <option value="device:setup">この端末内AI · 無料・オフライン</option>
                  {localAiConnection?.models.map((model, index) => <option key={`${model.runtime}:${model.id}`} value={`local:${index}`}>{model.name} · 接続PC・無料</option>)}
                  <option value="local:setup">接続PCを追加…</option>
                  {byokManagerReady ? <>{byokModels.map((model) => <option key={byokModelValue(model.connectionId, model.modelId)} value={byokModelValue(model.connectionId, model.modelId)}>{model.name} · {model.connectionLabel} · 自分のAPIキー</option>)}<option value={BYOK_SETUP_VALUE}>AIの接続…</option></> : null}
                  <RemoteNativeOptions remote={remotePc} />
                  {paidEnabled ? providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.name} · ${provider.priceUsd}{provider.available ? "" : "（準備中）"}</option>) : null}
                </select>
                <details className="ai-model-picker">
                  <summary aria-label="AIモデルメニューを開く">
                    <span className="ai-model-picker__identity">
                      <strong>{remoteUsable ? (remotePc.chosen?.name ?? "自分のPC") : byokUsable ? (byokSelectedModel?.name ?? "自分のAPIキー") : localAiSelected ? localAiConnection?.model.name : !paidEnabled ? "この端末内AI" : selectedProviderId === "auto" ? "自動選択" : selectedProvider?.name}</strong>
                      <small>{remoteUsable ? `自分のPC · ${remotePc.chosen?.modelId ?? ""}` : byokUsable ? `自分のAPIキー · ${byokSelectedModel?.connectionLabel ?? ""}` : localAiSelected ? `${executionMode === "team" ? "ローカルAIチーム" : executionMode === "compare" ? "ローカル比較" : "この端末で実行"}` : !paidEnabled ? "無料・オフライン" : selectedProviderId === "auto" ? `${selectedProvider?.name}を推奨` : selectedProvider?.model}</small>
                    </span>
                    <span className="ai-model-picker__charge">{remoteUsable ? "PCの請求" : byokUsable ? "提供元請求" : localAiSelected || !paidEnabled ? "無料" : `$${selectedProviderId === "auto" ? recommendedProvider?.priceUsd ?? executionPriceUsd : selectedProvider?.priceUsd}`}</span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div className="ai-model-picker__menu" role="listbox" aria-label="利用するAIモデル">
                    {paidEnabled ? <div className="ai-model-picker__preference" aria-label="自動選択の優先項目"><span>自動選択</span>{(["quality", "balanced", "cost"] as const).map((preference) => <button type="button" key={preference} className={routingPreference === preference ? "is-selected" : ""} onClick={() => setRoutingPreference(preference)}>{preference === "quality" ? "品質" : preference === "cost" ? "料金" : "バランス"}</button>)}</div> : null}
                    <p>実行方法</p>
                    <button type="button" onClick={(event) => { selectAiModel("device:setup"); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={false}>
                      <span className="ai-model-picker__check" />
                      <span><strong>この端末内AI</strong><small>今使っているスマホまたはPC · 無料・オフライン</small></span>
                      <em>端末内</em>
                    </button>
                    {paidEnabled ? <button type="button" disabled={!providers.some((provider) => provider.available)} className={activeModelValue === "auto" ? "is-selected" : ""} onClick={(event) => { selectAiModel("auto"); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={activeModelValue === "auto"}>
                      <span className="ai-model-picker__check">{activeModelValue === "auto" ? <Check aria-hidden="true" /> : null}</span>
                      <span><strong>自動選択</strong><small>内容に合うAIを自動で選びます</small></span>
                      <em>${recommendedProvider?.priceUsd ?? executionPriceUsd}</em>
                    </button> : null}
                    {localAiConnection?.models.map((model, index) => {
                      const value = `local:${index}`;
                      return <button type="button" key={`${model.runtime}:${model.id}`} className={activeModelValue === value ? "is-selected" : ""} onClick={(event) => { selectAiModel(value); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={activeModelValue === value}>
                        <span className="ai-model-picker__check">{activeModelValue === value ? <Check aria-hidden="true" /> : null}</span>
                        <span><strong>{model.name}</strong><small>接続PC · データを外へ送りません</small></span>
                        <em>無料</em>
                      </button>;
                    })}
                    <button type="button" onClick={(event) => { selectAiModel("local:setup"); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={false}>
                      <span className="ai-model-picker__check" />
                      <span><strong>接続PCを追加</strong><small>Local Runnerが動くPCのモデルを使用</small></span>
                      <em>設定</em>
                    </button>
                    {byokManagerReady ? <>
                      <p>自分のAPIキー</p>
                      {byokModels.map((model) => {
                        const value = byokModelValue(model.connectionId, model.modelId);
                        return <button type="button" key={value} className={activeModelValue === value ? "is-selected" : ""} onClick={(event) => { selectAiModel(value); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={activeModelValue === value}>
                          <span className="ai-model-picker__check">{activeModelValue === value ? <Check aria-hidden="true" /> : null}</span>
                          <span><strong>{model.name}</strong><small>{model.connectionLabel} · 提供元へ直接送信</small></span>
                          <em>自分の請求</em>
                        </button>;
                      })}
                      <button type="button" onClick={(event) => { selectAiModel(BYOK_SETUP_VALUE); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={false}>
                        <span className="ai-model-picker__check" />
                        <span><strong>AIの接続</strong><small>自分のAPIキーを登録・管理（Anthropic・OpenAI・Gemini・互換）</small></span>
                        <em>設定</em>
                      </button>
                    </> : null}
                    <RemoteMenuItems remote={remotePc} activeValue={activeModelValue} check={<Check aria-hidden="true" />} pick={(value, event) => { selectAiModel(value); event.currentTarget.closest("details")?.removeAttribute("open"); }} />
                    {paidEnabled ? <p>クラウドAI</p> : null}
                    {paidEnabled ? providers.map((provider) => <button type="button" key={provider.id} disabled={!provider.available} className={activeModelValue === provider.id ? "is-selected" : ""} onClick={(event) => { selectAiModel(provider.id); event.currentTarget.closest("details")?.removeAttribute("open"); }} role="option" aria-selected={activeModelValue === provider.id}>
                      <span className="ai-model-picker__check">{activeModelValue === provider.id ? <Check aria-hidden="true" /> : null}</span>
                      <span><strong>{provider.name}</strong><small>{provider.available ? provider.model : "接続準備中"}</small></span>
                      <em>${provider.priceUsd}</em>
                    </button>) : null}
                  </div>
                </details>
              </>}
            {paidEnabled && catalogStatus === "ready" ? <small title={!isMedia && selectedProviderId === "auto" ? `選択理由: ${recommendedDecision.reasons.join("・")}` : undefined}>{isMedia ? `自動選択 · ${selected?.model}` : <>{selectedProviderId === "auto" ? `推奨: ${selectedProvider?.name}（${recommendedDecision.reasons.join("・")}） · ` : ""}{selectedProvider?.model}</>} · {selected?.name} · {recommendedDecision.missingCapabilities.length ? "必要能力が未接続" : "能力確認済み"} · 会話メモリ ON</small> : null}
          </div>
            {!isRail && !isMedia ? <div className="ai-chat__execution-mode ai-chat__execution-mode--header" aria-label="AI実行モード">
              {(["auto", "compare", "team"] as const).map((mode) => <button type="button" key={mode} className={executionMode === mode ? "is-selected" : ""} aria-pressed={executionMode === mode} onClick={() => setExecutionMode(mode)}>{mode === "auto" ? "自動" : mode === "compare" ? "比較" : "チーム"}</button>)}
            </div> : null}
            {!isRail && !isMedia ? <div className="ai-chat__execution-mode ai-chat__execution-mode--header" aria-label="外部送信ポリシー">
              <button type="button" className={localPolicy === "prefer" ? "is-selected" : ""} aria-pressed={localPolicy === "prefer"} onClick={() => setLocalPolicy("prefer")}>端末優先</button>
              <button type="button" className={localPolicy === "only" ? "is-selected" : ""} aria-pressed={localPolicy === "only"} onClick={() => setLocalPolicy("only")}>外部送信なし</button>
            </div> : null}
            {artifacts.length > 0 ? <button type="button" className="ai-chat__usage-button" onClick={() => setGalleryOpen(true)}><Images aria-hidden="true" />成果物 {artifacts.length}</button> : null}
            {paidEnabled && sessionSpendUsd > 0 ? <button type="button" className="ai-chat__usage-button" onClick={() => setUsageOpen(true)} aria-label="利用料金を確認">${sessionSpendUsd.toFixed(2)}</button> : null}
            {paidEnabled ? <select className="ai-chat__currency" value={paymentCurrency} onChange={(event) => setPaymentCurrency(event.target.value as "USDC" | "JPYC")} aria-label="支払い通貨">
              {(catalog?.payment.options ?? []).map((option) => <option key={option.id} value={option.currency}>{option.currency}</option>)}
            </select> : null}
            {paidEnabled || localAiSelected ? <div
              className="ai-chat__price"
              title={executionPricing
                ? `上流原価上限 $${executionPricing.upstreamCostCeilingUsd} × ${executionPricing.multiplier} + 基盤料 $${executionPricing.infrastructureFeeUsd}`
                : undefined}
            >
              {localAiSelected
                ? `${localExecutionModels.length}モデル · 無料 · PC内`
                : `${executionMode !== "auto" && !isMedia ? `${comparisonProviders.length}モデル · 最大 ` : "最大 "}${paymentMaximum} · 原価連動 · x402`}
            </div> : null}
          </>}
        </header>
        {!developOpen ? <>
        {paidEnabled && catalogStatus === "loading" ? <UiStatePanel
          className="ai-chat__catalog-state"
          state="loading"
          title="利用できるAIを確認しています"
          description="入力内容はこのまま保持されます。"
        /> : null}
        {paidEnabled && catalogStatus === "error" ? <UiStatePanel
          className="ai-chat__catalog-state"
          state="error"
          title="AIカタログを取得できませんでした"
          description="クラウドAIは選択・実行できません。接続を確認して再試行してください。端末内AIや接続PCは引き続き設定できます。"
          action={<UiButton
            type="button"
            tone="primary"
            onClick={() => setCatalogRetryKey((current) => current + 1)}
          >
            再試行
          </UiButton>}
        /> : null}
        {!isRail ? <div className="ai-chat__project-context">
          <Folder aria-hidden="true" />
          <span><strong>{activeProject}</strong><small>{conversations.filter((conversation) => (conversation.project ?? "一般") === activeProject).length}件のチャット · 記憶{memoryFacts.length}件{paidEnabled ? ` · 予算 $${workSettings.budgetUsd.toFixed(2)}` : ""}</small></span>
          <button type="button" onClick={() => openProductivity("work")}>管理</button>
        </div> : null}
        {!isRail ? <section className="ai-chat__trust-strip" aria-label="AI実行の安全サマリー">
          <article data-state={localAiSelected || onDeviceReady ? "local" : "external"}>
            <ShieldCheck aria-hidden="true" />
            <span><small>データ</small><strong>{localAiSelected || onDeviceReady ? "端末の外へ送信しません" : "外部送信前に内容を確認"}</strong></span>
          </article>
          {paidEnabled ? <article>
            <span><small>最大料金</small><strong>{localAiSelected || onDeviceReady ? "無料" : paymentMaximum}</strong></span>
          </article> : null}
          <article data-state={status} aria-live="polite" aria-atomic="true">
            <span><small>実行状態</small><strong>{status === "paying" ? "処理中・停止できます" : status === "confirm" ? "署名前の確認待ち" : status === "error" ? "修正または再試行が必要" : executionBlockReason ? "準備が必要" : "入力できます"}</strong></span>
          </article>
        </section> : null}

        </> : null}
        <div className={developOpen ? "ai-chat__messages ai-chat__messages--work" : "ai-chat__messages"} aria-live="polite">
          {messages.length === 0 ? (developOpen ? null :
            <div className="ai-chat__welcome">
              <div className="ai-chat__welcome-kicker">{isRail ? "QUICK AI" : selected?.category}</div>
              <h2>{isRail ? selected?.name : "どのようなご用ですか？"}</h2>
              {isRail ? <p>{selected?.description}</p> : null}
            </div>
          ) : (
            <div className="ai-chat__thread">
              {messages.map((message) => (
                <article key={message.id} className={`ai-chat__message ai-chat__message--${message.role}`}>
                  <div className="ai-chat__avatar" aria-hidden="true">{message.role === "assistant" ? "AI" : "私"}</div>
                  <div>
                    <div className="ai-chat__content"><AiMessageContent content={message.content} /></div>
                    {message.role === "user" ? <button type="button" className="ai-chat__branch" onClick={() => branchFromMessage(message.id)}>編集して分岐</button> : null}
                    {message.mediaType === "image" && message.mediaUrl ? <img className="ai-chat__media ai-chat__media--image" src={message.mediaUrl} alt="AIが生成した画像" /> : null}
                    {message.mediaType === "video" && message.mediaUrl ? <video className="ai-chat__media ai-chat__media--video" src={message.mediaUrl} controls preload="metadata" playsInline /> : null}
                    {message.citations?.length ? <HubpediaCitations citations={message.citations} /> : null}
                    {message.receipt ? <small className="ai-chat__receipt">{message.receipt}</small> : null}
                    {message.role === "assistant" && status !== "paying" ? <div className="ai-chat__message-actions">
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(message.content); }} aria-label="回答をコピー"><Copy aria-hidden="true" />コピー</button>
                      <button type="button" onClick={() => regenerateFromMessage(message.id)} aria-label="回答を再生成">再生成</button>
                      <button type="button" onClick={() => downloadAnswer(message)} aria-label="回答を保存"><Download aria-hidden="true" />保存</button>
                      <details className="ai-chat__answer-more"><summary>その他</summary><div>
                        <button type="button" onClick={() => { void saveAnswerToWorkspace(message); }} aria-label="プロジェクトへ保存"><Folder aria-hidden="true" />プロジェクトへ保存</button>
                        <button type="button" className={messageFeedback[message.id] === "up" ? "is-selected" : ""} onClick={() => { void recordMessageFeedback(message.id, "up"); }} aria-label="良い回答"><ThumbsUp aria-hidden="true" />良い回答</button>
                        <button type="button" className={messageFeedback[message.id] === "down" ? "is-selected" : ""} onClick={() => { void recordMessageFeedback(message.id, "down"); }} aria-label="改善が必要な回答"><ThumbsDown aria-hidden="true" />改善が必要</button>
                      </div></details>
                    </div> : null}
                  </div>
                </article>
              ))}
              {status === "paying" ? <div className="ai-chat__progress" role="status"><span className="is-done">依頼を分析</span><span className="is-done">{localAiSelected ? "接続PCを確認" : "実行先を確認"}</span><span className="is-active">{localAiSelected ? `${localExecutionModels[0]?.name ?? "AI"}で処理中` : `${executionProvider?.name ?? "AI"}で処理中`}</span><span>結果を検証</span></div> : null}
              {status === "paying" ? <button type="button" className="ai-chat__stop" onClick={() => executionAbort.current?.abort()}>生成を停止</button> : null}
            </div>
          )}
          {developMounted ? <div className="ai-chat__work" hidden={!developOpen}>
            <AiDevelopPanel embedded request={prompt} controlsRef={workControls} onStateChange={setWorkState} onClose={() => setDevelopOpen(false)} />
          </div> : null}
        </div>

        <div className="ai-chat__dock">
          <div hidden={developOpen}>
          {organizationRun ? <div className="ai-chat__organization-run" data-status={organizationRun.status}>
            <div><strong>{organizationRun.status === "running" ? "AI組織が実行中" : organizationRun.status === "completed" ? "AI組織の仕事が完了" : "AI組織の実行に失敗"}</strong><small>{organizationRun.stages.length ? organizationRun.stages.map((stage)=>`${stage.label}: ${stage.model}`).join(" · ") : "Local Runnerで役職を配属しています"}</small></div>
            {organizationRun.artifacts.length ? <details><summary>役職別成果物 {organizationRun.artifacts.length}</summary>{organizationRun.artifacts.map((artifact)=><article key={artifact.id}><strong>{artifact.roleName}</strong><p>{artifact.summary}</p><button type="button" disabled={organizationRun.status==="running"} onClick={()=>void rerunOrganizationRole(artifact)}>この役職だけ再実行</button></article>)}</details> : null}
            {organizationRun.status === "running" ? <button type="button" onClick={()=>{const active=organizationHarness.current;if(active)void active.harness.cancel(active.runId);organizationController.current?.abort();organizationController.current=null;organizationHarness.current=null;setOrganizationRun((current)=>current?{...current,status:"failed"}:current);}}>実行を中止</button> : null}
            {organizationRun.status === "completed" ? <div><button type="button" aria-label="良い結果" onClick={()=>setOrganizationRun((current)=>current?{...current,rating:1}:current)}><ThumbsUp aria-hidden="true"/></button><button type="button" aria-label="改善が必要" onClick={()=>setOrganizationRun((current)=>current?{...current,rating:-1}:current)}><ThumbsDown aria-hidden="true"/></button><button type="button" onClick={()=>setOrganizationOpen(true)}>組織を編集</button></div> : null}
          </div> : null}
          {pendingApproval ? <div className="ai-chat__work-approval" role="status">
            <ShieldCheck aria-hidden="true" />
            <div><strong>実行前の確認が必要です</strong><small>{pendingApproval.steps}件の操作を停止中{pendingApproval.expiresAt ? ` · ${new Date(pendingApproval.expiresAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}まで` : ""}</small></div>
            <button type="button" onClick={() => openProductivity("jobs")}>内容を確認</button>
            <button type="button" className="is-dismiss" aria-label="承認通知を閉じる" onClick={() => setPendingApproval(null)}><X aria-hidden="true" /></button>
          </div> : null}
          {siteReads.length ? (
            <div className="ai-chat__reads" role="status" aria-label="ブラウザが読んだ外部ページ">
              <small>外部ページを参照しました（内容は未検証の外部情報として扱います）</small>
              <ul>
                {siteReads.map((read) => (
                  <li key={read.url}>
                    <a href={read.url} target="_blank" rel="noreferrer">{read.title || read.url}</a>
                    {read.truncated ? "（一部のみ）" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {paidEnabled && status === "confirm" ? (
            <div className="ai-chat__confirmation" role="dialog" aria-label="支払い確認" aria-live="assertive" aria-atomic="true">
              <div><small>外部AIへの送信・x402 支払い確認 · {executionMode !== "auto" && !isMedia ? comparisonProviders.map((provider) => provider.name).join(" / ") : executionProvider?.name}</small><strong>最大 {paymentMaximum}</strong><p>送信内容: {externalPrivacy.preview || "（本文なし）"}</p>{externalPrivacy.findings.length > 0 ? <p>検出: {externalPrivacy.findings.map((finding) => finding.label).join("・")}。内容を確認してから承認してください。</p> : <p>機密情報の自動検出に該当なし。仕事予算 ${workSettings.budgetUsd.toFixed(2)}以内です。</p>}</div>
              <div><UiButton type="button" className="is-secondary" onClick={() => setStatus("idle")}>戻る</UiButton>{paymentOption?.currency === "USDC" && !paymentSessionExpiry ? <UiButton type="button" className="is-secondary" onClick={() => { void approveAndRun(true); }}>1 USDC・30分で開始</UiButton> : null}<UiButton type="button" tone="primary" onClick={() => { void approveAndRun(false); }}>{paymentSessionExpiry ? "上限内で実行" : "署名して実行"}</UiButton></div>
            </div>
          ) : null}
          {paidEnabled && paymentSessionExpiry ? <div className="ai-chat__local-fallback"><span>USDCセッション有効 · 上限1 USDC · {new Date(paymentSessionExpiry).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}まで</span><button type="button" onClick={() => { void endPaymentSession(); }} disabled={status === "paying"}>終了して残額を返す</button></div> : null}
          {paidEnabled && paymentTestStatus === "confirm" ? (
            <div className="ai-chat__confirmation" role="dialog" aria-label="JPYC決済テスト確認" aria-live="assertive" aria-atomic="true">
              <div><small>x402 ステージング決済テスト</small><strong>最大 1 JPYC</strong><p>Kaia Kairosでファシリテーターの検証と決済だけを行います。AI推論料金は発生しません。</p></div>
              <div><UiButton type="button" className="is-secondary" onClick={() => setPaymentTestStatus("idle")}>戻る</UiButton><UiButton type="button" tone="primary" onClick={() => { void runJpycPaymentTest(); }}>1 JPYCを署名</UiButton></div>
            </div>
          ) : null}
          {paidEnabled && paymentTestResult ? <p className={paymentTestStatus === "error" ? "ai-chat__error" : undefined} role="status">{paymentTestResult}</p> : null}
          {workspaceStatus ? <p className="ai-chat__workspace-status" role="status">{workspaceStatus}</p> : null}
          {activeHubContext ? (
            <aside className="ai-chat__hub-context" aria-label="AIへ渡すHubの参照内容">
              <Sparkles aria-hidden="true" />
              <span>
                <small>Hubから参照中</small>
                <strong>{HUB_AI_SOURCE_LABELS[activeHubContext.source]}</strong>
              </span>
              {activeHubContext.href ? <a href={activeHubContext.href}>元の画面へ</a> : null}
              <details className="ai-chat__context-inspector">
                <summary>参照内容と依頼を確認</summary>
                {activeHubContext.title ? <strong>{activeHubContext.title}</strong> : null}
                <pre>{activeHubContext.content || "本文は渡されていません。参照先だけでは内容を確認できない場合があります。"}</pre>
                <p>選ぶと入力中の依頼を作り直します。送信はしません。</p>
                <div>
                  {getAiContextActions(activeHubContext.source).map(({ intent, label }) => (
                    <button key={intent} type="button" disabled={status === "paying" || status === "confirm"} onClick={() => {
                      const context = { ...activeHubContext, intent };
                      setActiveHubContext(context);
                      setSelectedId(aiToolForContext(context));
                      setPrompt(createAiContextPrompt(context).slice(0, 12_000));
                    }}>{label}の依頼を入力</button>
                  ))}
                </div>
              </details>
              <button
                type="button"
                onClick={() => {
                  setActiveHubContext(null);
                  setWorkspaceStatus("Hubの参照を解除しました。入力文は編集できます。");
                }}
              >
                参照を解除
              </button>
            </aside>
          ) : null}
          {error ? <p className="ai-chat__error" role="alert">{error}</p> : null}
          {status === "error" && executionBlockReason ? <p className="ai-chat__error" role="status">{executionBlockReason}</p> : null}
          {messages.length > 0 && catalog && (!paidEnabled || !catalog.payment.enabled) ? <div className="ai-chat__local-fallback" data-ready={onDeviceReady}>
            <span>{onDeviceReady ? `スマホ内AIで回答中${onDeviceModels[0]?.name ? ` · ${onDeviceModels[0].name}` : ""}` : "無料の端末内AIを利用できます。"}</span>
            {!onDeviceReady ? <button type="button" onClick={() => setLocalRunnerOpen(true)}>接続PC</button> : null}
            <button type="button" onClick={() => setOnDeviceOpen(true)}>{onDeviceReady ? "モデル" : "この端末"}</button>
          </div> : null}
          </div>
          <form className={`ai-chat__composer${draggingAttachment ? " is-dragging" : ""}`} onSubmit={(event) => { event.preventDefault(); submitComposer(); }} onDragEnter={(event) => { event.preventDefault(); if (!developOpen) setDraggingAttachment(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingAttachment(false); }} onDrop={(event) => { event.preventDefault(); setDraggingAttachment(false); if (!developOpen) void attachFiles(event.dataTransfer.files); }}>
            {!developOpen && prompt.startsWith("/") ? <div className="ai-chat__commands" role="listbox" aria-label="AIコマンド">{AI_COMMANDS.filter((item) => (paidEnabled || item.tool !== "image") && item.command.startsWith(prompt.split(/\s/)[0])).map((item) => <button type="button" key={item.command} onClick={() => { setSelectedId(item.tool); setPrompt(item.prompt); }}><strong>{item.command}</strong><span>{item.prompt.trim()}</span></button>)}{"/買い物".startsWith(prompt.split(/\s/)[0]) ? <button type="button" onClick={() => { setCommerceQuery(prompt.slice(4).trim()); setCommerceOpen(true); setPrompt(""); }}><strong>/買い物</strong><span>商品を探して比較・見積・購入へ進む</span></button> : null}</div> : null}
            {!developOpen && attachments.length > 0 ? <div className="ai-chat__attachments" aria-label="添付ファイル">{attachments.map((file) => <span key={file.id}><Paperclip aria-hidden="true" />{file.name}<button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))} aria-label={`${file.name}を削除`}><X aria-hidden="true" /></button></span>)}</div> : null}
            <textarea
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); if (!developOpen) { setStatus("idle"); setError(""); } }}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitComposer(); } }}
              maxLength={developOpen ? 32000 : 8000}
              rows={1}
              placeholder={developOpen ? "このPCでやってほしいことを入力" : isRail ? "このページについて質問" : "メッセージを入力"}
              disabled={status === "paying" || status === "confirm"}
              aria-label="メッセージ"
              aria-describedby="ai-composer-notice"
            />
              <div className="ai-chat__composer-meta">
                <div className="ai-chat__composer-tools">
                  {developOpen ? <span className="ai-chat__composer-context">{workState.busy ? "作業中 · 次の依頼を下書きできます" : "PCの作業"}</span> : <>
                  <input ref={attachmentInput} type="file" multiple accept=".txt,.md,.csv,.json,.html,.css,.js,.ts,.tsx,.jsx,.py,.yaml,.yml,text/plain,text/csv,application/json" onChange={(event) => { void attachFiles(event.target.files); }} />
                  <details className="ai-chat__plus-menu">
                    <summary className="ai-chat__plus-trigger" aria-label="要望を追加" title="要望を追加"><Plus aria-hidden="true" /></summary>
                    <div role="menu" aria-label="AIに頼むこと">
                      <small>作成・調査</small>
                      <button type="button" role="menuitem" onClick={(event) => { attachmentInput.current?.click(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Paperclip aria-hidden="true" />ファイルを添付</button>
                      {paidEnabled ? <button type="button" role="menuitem" onClick={(event) => { setPrompt("画像を生成してください: "); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Images aria-hidden="true" />画像を作る</button> : null}
                      <button type="button" role="menuitem" onClick={(event) => { setPrompt("次の文章を作成または編集してください: "); event.currentTarget.closest("details")?.removeAttribute("open"); }}><AlignLeft aria-hidden="true" />文章を書く</button>
                      <button type="button" role="menuitem" onClick={(event) => { setPrompt("次のテーマを調査し、根拠と出典を整理してください: "); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Search aria-hidden="true" />調べる</button>
                      <small>Hubで進める</small>
                      <button type="button" role="menuitem" onClick={(event) => { openProductivity(); event.currentTarget.closest("details")?.removeAttribute("open"); }}><BriefcaseBusiness aria-hidden="true" />仕事を進める</button>
                      <button type="button" role="menuitem" onClick={(event) => { setCommerceQuery(prompt.trim()); setCommerceOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><ShoppingBag aria-hidden="true" />商品を探して購入</button>
                      <button type="button" role="menuitem" onClick={(event) => { setPrompt("Hub内で次の操作を行ってください: "); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Sparkles aria-hidden="true" />Hubを操作</button>
                      {!isRail ? <>
                        <small>AI機能</small>
                        <button type="button" role="menuitem" onClick={(event) => { setOnDeviceOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Smartphone aria-hidden="true" />この端末内AI</button>
                        <button type="button" role="menuitem" onClick={(event) => { setLocalRunnerOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Cpu aria-hidden="true" />接続PC</button>
                        <button type="button" role="menuitem" onClick={(event) => { setDevelopOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Code2 aria-hidden="true" />この会話で作業を依頼</button>
                        <button type="button" role="menuitem" onClick={(event) => { setMachineOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Code2 aria-hidden="true" />このPC</button>
                        <button type="button" role="menuitem" onClick={(event) => { setSkillsOpen(true); event.currentTarget.closest("details")?.removeAttribute("open"); }}><Sparkles aria-hidden="true" />スキルを使う</button>
                      </> : null}
                    </div>
                  </details>
                  {paidEnabled && catalog?.payment.testEnabled && !catalog.payment.enabled ? (
                    <button
                      type="button"
                      className="ai-chat__payment-test-trigger"
                      onClick={() => {
                        setPaymentTestStatus("confirm");
                        setPaymentTestResult("");
                      }}
                    >
                      決済テスト
                    </button>
                  ) : null}
                  {!isRail && !isMedia ? <details className="ai-chat__runtime-menu">
                    <summary><Settings aria-hidden="true" /><span>{executionMode === "auto" ? "自動" : executionMode === "compare" ? "比較" : "チーム"} · {localPolicy === "prefer" ? "端末優先" : "外部送信なし"}</span><ChevronDown aria-hidden="true" /></summary>
                    <div>
                      <small>実行先</small>
                      <div className="ai-chat__destination-grid">
                        {paidEnabled ? <button type="button" className={activeModelValue === "auto" ? "is-selected" : ""} onClick={() => selectAiModel("auto")}><Sparkles aria-hidden="true" /><span><strong>自動</strong><small>最適な場所を選択</small></span></button> : null}
                        <button type="button" onClick={() => setOnDeviceOpen(true)}><Smartphone aria-hidden="true" /><span><strong>この端末</strong><small>今のスマホ／PC</small></span></button>
                        <button type="button" className={localAiSelected ? "is-selected" : ""} onClick={() => setLocalRunnerOpen(true)}><Cpu aria-hidden="true" /><span><strong>接続PC</strong><small>Local Runner</small></span></button>
                        {paidEnabled ? <button type="button" disabled={catalogStatus !== "ready" || !recommendedProvider?.available} className={!localAiSelected && selectedProviderId !== "auto" ? "is-selected" : ""} onClick={() => selectAiModel(recommendedProvider?.id ?? "auto")}><Cloud aria-hidden="true" /><span><strong>クラウド</strong><small>{catalogStatus === "error" ? "再取得が必要" : "外部API"}</small></span></button> : null}
                      </div>
                      <small>実行方法</small>
                      <div className="ai-chat__execution-mode" aria-label="入力欄のAI実行モード">{(["auto", "compare", "team"] as const).map((mode) => <button type="button" key={mode} className={executionMode === mode ? "is-selected" : ""} aria-pressed={executionMode === mode} onClick={() => setExecutionMode(mode)}>{mode === "auto" ? "自動" : mode === "compare" ? "比較" : "チーム"}</button>)}</div>
                      <small>外部送信</small>
                      <div className="ai-chat__execution-mode" aria-label="入力欄の外部送信ポリシー"><button type="button" className={localPolicy === "prefer" ? "is-selected" : ""} aria-pressed={localPolicy === "prefer"} onClick={() => setLocalPolicy("prefer")}>端末優先</button><button type="button" className={localPolicy === "only" ? "is-selected" : ""} aria-pressed={localPolicy === "only"} onClick={() => setLocalPolicy("only")}>外部送信なし</button></div>
                    </div>
                  </details> : null}
                  <span className="ai-chat__composer-context">{siteSources.length > 0 ? `Hub連携 · ` : ""}{remoteUsable ? "自分のPC" : byokUsable ? "自分のAPIキー" : onDeviceReady ? "この端末内AI" : localAiSelected ? "接続PC" : paidEnabled ? "AIを自動選択" : "AIを選択"}</span>
                  </>}
                  {[...prompt].length >= 6000 ? <span className="ai-chat__composer-count">{[...prompt].length.toLocaleString()} / {developOpen ? "32,000" : "8,000"}</span> : null}
                </div>
                {developOpen && workState.busy ? <button type="button" aria-label="作業を中断" title="作業を中断" onClick={() => workControls.current?.cancel()}><X aria-hidden="true" /></button> : <button type="submit" aria-label={developOpen ? "作業を依頼" : "送信"} title={developOpen ? "選択したエージェントに作業を依頼" : !executionReady ? executionBlockReason ?? "AIの準備中です" : "送信"} disabled={composerBlocked || !prompt.trim()}><ArrowUp aria-hidden="true" /></button>}
              </div>
            </form>
          <p className="ai-chat__notice" id="ai-composer-notice">{developOpen ? "依頼文と必要なファイルは、選択したエージェントの処理先へ送信される場合があります。会話の履歴・添付は自動では渡しません。" : onDeviceReady || localAiSelected ? "端末内の処理は外部AIへ送信されません。" : paidEnabled ? "外部AIを使う場合は、送信内容と最大料金を実行前に確認できます。" : "この端末内AIまたは接続PCを使えます。自分のAPIキーで使うときはHub Desktopで。"}{byokUsable ? " 入力は選んだ提供元へ直接送られ、料金は提供元があなたのアカウントへ請求します。" : ""}{remoteUsable ? " 入力はあなたのPCへ直接送られ、PCが選んだ接続で処理します。Hubのサーバーには送られず、保存もされません。料金は提供元がPCの持ち主へ請求します。" : ""}</p>
        </div>
      </section>
      {machineOpen ? <ThisMachinePanel onClose={() => setMachineOpen(false)} onDevelop={() => { setMachineOpen(false); setDevelopOpen(true); }} /> : null}
      {localRunnerOpen ? <AiLocalRunnerPanel onClose={() => setLocalRunnerOpen(false)} onConnected={(connection) => { setLocalAiConnection(connection); setUseLocalAi(true); setLocalRunnerOpen(false); setError(""); setStatus("idle"); }} /> : null}
      {organizationOpen ? <AiOrganizationPanel providers={providers} localModels={localAiConnection?.models ?? []} onClose={() => setOrganizationOpen(false)} onUse={(organizationPrompt, organization) => { const route=planOrganizationRouting(organization,localAiConnection?.models??[],providers,localPolicy==="only"?"local_only":"local_preferred");if(route.blocked){setError("ローカル限定では外部AIを担当にできません。役職をPCローカルAIへ変更してください。");setStatus("error");return;}const localOnly=!route.requiresExternalApproval;setPrompt(organizationPrompt);setPendingOrganization(organization);setExecutionMode("team");setUseLocalAi(Boolean(localOnly&&localAiConnection));setOrganizationOpen(false); }} /> : null}
      {skillsOpen ? <AiSkillsPanel onClose={()=>setSkillsOpen(false)} onUse={(skill)=>{setPrompt((current)=>`${current}${current?"\n\n":""}使用スキル: ${skill.name}\n${skill.instructions??skill.description}\n許可ツール: ${skill.tools.join("・")||"なし"}\n完了検証: ${skill.verification.map((item)=>item.kind).join("・")}`.slice(0,8_000));if(skill.execution.runtime==="local-sandbox")setLocalRunnerOpen(true);setSkillsOpen(false);}}/> : null}
      {onDeviceOpen ? <AiOnDevicePanel onClose={() => setOnDeviceOpen(false)} /> : null}
      {remotePc.panel}
      {byokOpen ? <AiConnectionsPanel onClose={() => setByokOpen(false)} onChanged={() => { void refreshByokModels(); }} /> : null}
      {usageGuideOpen ? <AiUsageGuide paidExecution={paidEnabled} onClose={() => { sessionStorage.setItem("hub.ai.usage-guide.seen", "1"); setUsageGuideOpen(false); }} onChoose={chooseUsage} /> : null}
      {productivityOpen ? <AiProductivityCenter paidExecution={paidEnabled} initialTab={productivityInitialTab} project={activeProject} projects={projects} pinnedChats={conversations.filter((conversation) => conversation.pinned).map((conversation) => ({ id: conversation.id, title: conversation.title, project: conversation.project ?? "一般" }))} runtimeReadiness={catalog?.readiness} onSelectProject={selectProject} onCreateProject={createProject} onTogglePin={(id) => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, pinned: !conversation.pinned } : conversation))} settings={workSettings} onChange={(value) => { setWorkSettings(value); setProjectWorkSettings((current) => ({ ...current, [activeProject]: value })); }} memories={memoryFacts} onAddMemory={() => { void addMemoryFact(); }} onDeleteMemory={(id) => { void deleteMemoryFact(id); }} onClearMemories={() => { void clearMemoryFacts(); }} onExportMemory={exportMemory} onImportMemory={(file) => { void importMemory(file); }} onClose={() => setProductivityOpen(false)} onUsePrompt={(value) => { setPrompt(value); setProductivityOpen(false); if (workSettings.deliverable === "画像") setSelectedId("image"); else if (workSettings.deliverable === "動画") setSelectedId("video"); else setSelectedId("analyze"); }} /> : null}
      {paidEnabled && usageOpen ? <div className="ai-usage" role="dialog" aria-modal="true" aria-label="利用料金"><button type="button" className="ai-usage__backdrop" onClick={() => setUsageOpen(false)} aria-label="閉じる" /><section><header><div><small>このブラウザセッション</small><h2>利用料金</h2></div><button type="button" onClick={() => setUsageOpen(false)} aria-label="閉じる"><X aria-hidden="true" /></button></header><div className="ai-usage__summary"><span><small>利用額</small><strong>${sessionSpendUsd.toFixed(2)}</strong></span><span><small>予算上限</small><strong>${workSettings.budgetUsd.toFixed(2)}</strong></span></div><p>支払い履歴は会話内の領収情報から表示しています。Hubのサーバーには保存されません。</p><div className="ai-usage__list">{usageReceipts.length > 0 ? usageReceipts.map((message) => <div key={message.id}><span><strong>{message.receipt?.split(" · ")[0]}</strong><small>{message.receipt}</small></span><time>{new Date(message.id).toLocaleString("ja-JP")}</time></div>) : <p>このセッションの有料実行はまだありません。</p>}</div></section></div> : null}
      {galleryOpen ? <div className="ai-usage" role="dialog" aria-modal="true" aria-label="成果物ギャラリー"><button type="button" className="ai-usage__backdrop" onClick={() => setGalleryOpen(false)} aria-label="閉じる" /><section><header><div><small>画像・動画</small><h2>成果物</h2></div><button type="button" onClick={() => setGalleryOpen(false)} aria-label="閉じる"><X aria-hidden="true" /></button></header><div className="ai-artifacts">{artifacts.map((artifact) => <article key={artifact.id}>{artifact.mediaType === "image" ? <img src={artifact.mediaUrl} alt="AI生成画像" /> : <video src={artifact.mediaUrl} controls preload="metadata" />}<footer><span><strong>{artifact.content}</strong><small>{artifact.receipt}</small></span><button type="button" onClick={() => downloadAnswer(artifact)} aria-label="成果物を保存"><Download aria-hidden="true" /></button></footer></article>)}</div></section></div> : null}
      {commerceOpen ? <AiCommercePanel initialQuery={commerceQuery} onClose={() => setCommerceOpen(false)} /> : null}
      {accountSyncOpen ? <AiAccountSyncPanel onClose={() => setAccountSyncOpen(false)} /> : null}
    </section>
  );
}

function allowedPayment(requirement: PaymentRequirements, network: string, asset: string, maxAtomic: bigint): boolean {
  if (requirement.network !== network || (requirement.scheme !== "exact" && requirement.scheme !== "batch-settlement") || requirement.asset.toLowerCase() !== asset.toLowerCase()) return false;
  try { return BigInt(requirement.amount) <= maxAtomic; } catch { return false; }
}

async function switchPaymentChain(provider: EthereumProvider, network: string): Promise<void> {
  const kairosNetwork = network === "eip155:1001";
  const chainId = kairosNetwork ? "0x3e9" : "0x14a34";
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? (cause as { code?: unknown }).code : undefined;
    if (code !== 4902) throw cause;
    await provider.request({ method: "wallet_addEthereumChain", params: [kairosNetwork
      ? { chainId, chainName: "Kaia Kairos", nativeCurrency: { name: "Kairos KAIA", symbol: "KAIA", decimals: 18 }, rpcUrls: ["https://public-en-kairos.node.kaia.io"], blockExplorerUrls: ["https://kairos.kaiascan.io"] }
      : { chainId, chainName: "Base Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] }] });
  }
}

function decimalProductToAtomic(value: string, multiplier: string, decimals: number): bigint {
  const parse = (input: string) => {
    const normalized = Number(input).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
    const [whole, fraction = ""] = normalized.split(".");
    return { integer: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
  };
  const left = parse(value);
  const right = parse(multiplier);
  const numerator = left.integer * right.integer * (10n ** BigInt(decimals));
  const denominator = left.scale * right.scale;
  return (numerator + denominator - 1n) / denominator;
}

function formatPaymentUnits(priceUsd: string, unitsPerUsd: string): string {
  return (Number(priceUsd) * Number(unitsPerUsd)).toLocaleString("ja-JP", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatUsdAmount(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

async function consumeAiStream(response: Response, onDelta: (delta: string) => void, onCitations?: (citations: HubpediaCitation[]) => void): Promise<void> {
  if (!response.body) throw new Error("provider_failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const frames = pending.split(/\r?\n\r?\n/);
    pending = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split(/\r?\n/).find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!data) continue;
      const event = JSON.parse(data) as { type?: string; text?: string; error?: string; citations?: unknown };
      if (event.type === "delta" && event.text) onDelta(event.text);
      if (event.type === "citations" && onCitations) onCitations(readHubpediaCitations(event.citations));
      if (event.type === "error") throw new Error(event.error ?? "provider_failed");
    }
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 24_000_000) throw new Error("response_too_large");
  try { return JSON.parse(text) as unknown; } catch { return {}; }
}
function readString(value: unknown, key: string): string | null { return isRecord(value) && typeof value[key] === "string" ? value[key] : null; }
function errorMessage(value: unknown): string { return readString(value, "error") ?? "request_failed"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function userFacingError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "request_failed";
  if (message === "wallet_missing") return "x402対応のEVMウォレットが見つかりません。";
  if (message.includes("rejected") || message.includes("denied") || message === "4001") return "ウォレットで署名がキャンセルされました。";
  if (message === "provider_unavailable" || message === "payment_not_configured") return "AIサービスは現在セットアップ中です。";
  if (message === "network_unsupported") return "この決済ネットワークにはまだ対応していません。";
  return "実行できませんでした。支払いは確定していないことを確認してから、もう一度お試しください。";
}
