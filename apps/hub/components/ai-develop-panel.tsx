"use client";

import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { HarnessConnector, summarize, type HarnessAdapterContract, type HarnessCheck, type HarnessControlSnapshot, type HarnessEvent, type HarnessFileChange, type HarnessRunRecord, type HarnessRuntime, type HarnessTokenUsage } from "@/lib/agent-harness";
import { piWork, type PiPendingAction, type PiRunState, type PiWorkModels } from "@/lib/hub-work";
import styles from "./ai-develop-panel.module.css";

const RUNNER = "http://127.0.0.1:43127";
// The Hub AI model picker's last choice survives panel reloads.
const PI_MODEL_KEY = "hub.piWorkModel";
const PI_TOOL_LIST_MAX = 8;

function CliUsage({ usage }: { usage?: HarnessTokenUsage | null }) {
  return <p aria-label="CLIの使用量">{usage ? <>
    入力 {usage.inputTokens ?? "未報告"} · 未キャッシュ入力 {usage.uncachedInputTokens ?? "未報告"} · 再利用 {usage.cacheReadTokens ?? "未報告"} · キャッシュ書込 {usage.cacheWriteTokens ?? "未報告"} · 出力 {usage.outputTokens} トークン
    <small> CLIの終了報告に基づく今回の使用量です。</small>
  </> : "使用量は未報告です。"}</p>;
}

type Workspace = { enabled: boolean; workspace: string | null };
type DevRun = {
  id: string;
  agent: string;
  model: string;
  status: "awaiting_confirmation" | "running" | "verifying" | "cancelling" | "done" | "failed" | "cancelled";
  output: string;
  sessionId: string | null;
  exitCode: number | null;
  workspace: string;
};

type DevAgent = { id: string; label: string; available: boolean; defaultModel: string; canResume: boolean; unavailableReason?: string | null; sendsSourceToProvider?: boolean; adapter?: HarnessAdapterContract };

function adapterOf(item: DevAgent): HarnessAdapterContract {
  return item.adapter ?? {
    id: `${item.id}.legacy`, label: item.label, protocolVersion: "legacy", transport: "stdio",
    executionAuthority: "provider_harness", approvalMode: "hub_preflight_provider_boundary",
    connectionState: item.available ? "connected" : "unavailable", capabilities: item.id === "claude" ? ["proposal"] : ["workspace_write"], providerOwns: ["agent_loop", "tool_selection"]
  };
}
type UsageWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; resetsAtMs: number | null; resetsAtLabel: string | null };
type UsageSnapshot = { agent: string; windows: UsageWindow[]; checkedAtMs: number };
type UsageLoadState =
  | { state: "loading" }
  | { state: "ready"; snapshot: UsageSnapshot }
  | { state: "unavailable" };
type ConnectorState = "connecting" | "connected" | "unavailable";
const AUTH_LABELS = {
  unchecked: "インストール済み・認証未確認",
  checking: "認証を確認中…",
  configured: "ログイン情報あり（接続未確認）",
  missing: "ログイン情報なし",
  unknown: "認証状態を確認できません",
  unsupported: "認証確認は未対応",
  unavailable: "CLIを利用できません"
} as const;
type AuthState = keyof typeof AUTH_LABELS;

function authState(value: unknown): AuthState {
  const state = value && typeof value === "object" && "state" in value ? value.state : undefined;
  return state === "configured" || state === "missing" || state === "unknown" || state === "unsupported" || state === "unavailable" ? state : "unknown";
}

const AGENT_GUIDANCE: Record<string, { badge: string; work: string; detail: string }> = {
  codex: {
    badge: "実装向き",
    work: "コード編集・調査・テスト・仕上げ",
    detail: "リポジトリを読んで実装し、テストまで通して完成させる仕事に向いています。"
  },
  claude: {
    badge: "編集・構想",
    work: "コード編集・UI/UX・文章・仕様整理・セカンドオピニオン",
    detail: "作業フォルダ内のファイルを読んで編集できます。CLI自身はシェルを使いません。確認コマンドはHubが別途承認を受けて実行します。"
  }
};

function preferredAgent(available: DevAgent[]): DevAgent | undefined {
  return available.find((item) => item.id === "codex" && item.available) ?? available.find((item) => item.available);
}

// Suggestions only. The runner accepts any name shaped like a model identifier,
// so a release that appears tomorrow can be typed in.
const SUGGESTED: Record<string, string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["gpt-5.6-luna", "gpt-5.6-sol"]
};
const WHEN = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const RESET_AT = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function isUsageSnapshot(value: unknown): value is UsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UsageSnapshot>;
  return typeof candidate.agent === "string"
    && typeof candidate.checkedAtMs === "number"
    && Array.isArray(candidate.windows)
    && candidate.windows.every((window) => typeof window.label === "string"
      && typeof window.remainingPercent === "number"
      && Number.isFinite(window.remainingPercent));
}

function resetText(window: UsageWindow): string {
  if (window.resetsAtMs) return RESET_AT.format(new Date(window.resetsAtMs));
  return window.resetsAtLabel ?? "更新時刻なし";
}

function durationText(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1_000))}秒`;
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}時間${minutes % 60}分` : `${minutes}分`;
}

/** Minimal markdown for assistant text: blank-line paragraphs, # headings,
 *  - bullets, fenced code, **bold** and `code`. Text nodes stay text — no
 *  HTML is ever injected. */
function AssistantText({ text }: { text: string }) {
  const inline = (line: string, scope: string) =>
    line.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
      const key = `${scope}-${i}`;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
      return part;
    });
  return (
    <>
      {text.split(/\n{2,}/).map((block, bi) => {
        if (block.startsWith("```")) {
          return <pre key={bi} className={styles.mdCode}>{block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "")}</pre>;
        }
        const lines = block.split("\n");
        if (lines.every((line) => /^\s*[-*]\s/.test(line))) {
          return (
            <ul key={bi} className={styles.mdList}>
              {lines.map((line, li) => <li key={li}>{inline(line.replace(/^\s*[-*]\s/, ""), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((line, li) => {
              const heading = /^#{1,6}\s+/.test(line);
              const content = inline(heading ? line.replace(/^#{1,6}\s+/, "") : line, `${bi}-${li}`);
              return <React.Fragment key={li}>{li > 0 ? <br /> : null}{heading ? <strong>{content}</strong> : content}</React.Fragment>;
            })}
          </p>
        );
      })}
    </>
  );
}

const PHASE_LABEL: Record<string, string> = {
  approval: "承認待ち",
  planning: "計画",
  executing: "実行",
  verifying: "検証",
  completed: "終了",
  failed: "停止"
};

/**
 * The kept tail is cut by bytes, so its first line is usually half an event.
 * Showing the fragment would look like corruption; dropping it loses nothing.
 */
function tailText(tail: string): string {
  const lines = tail.split("\n");
  if (lines.length > 1) lines.shift();
  if (lines.length === 1) {
    try { JSON.parse(lines[0]); } catch { return ""; }
  }
  return summarize(lines.join("\n"));
}

const STATUS: Record<string, string> = {
  running: "実行中",
  awaiting_confirmation: "承認待ち",
  awaiting_approval: "承認待ち",
  verifying: "変更内容を検証中",
  cancelling: "中断処理中",
  interrupted: "中断地点を保存",
  done: "完了",
  failed: "失敗",
  denied: "拒否しました",
  cancelled: "中断しました"
};

function verificationText(check: PiRunState["verification"]) {
  if (!check) return "確認コマンドの指定なし";
  const labels: Record<string, string> = { pending: "未検証", running: "確認中", passed: "合格", failed: "失敗", denied: "実行を拒否" };
  return `指定した検証: ${labels[check.status] ?? "未完了"} · ${check.attempts}回`;
}

function filePreview(action: PiPendingAction) {
  const detail = action.detail;
  return ["hub_write", "hub_edit"].includes(action.tool) && typeof detail?.path === "string"
    && typeof detail.before === "string" && typeof detail.after === "string" ? detail : null;
}

function missingFilePreview(action: PiPendingAction) {
  return ["hub_write", "hub_edit"].includes(action.tool) && !filePreview(action);
}

function stopText(reason: string) {
  return reason === "provider_authentication_failed"
    ? "接続先の認証が拒否されました。端末のCLIでログイン状態を確認してから、もう一度実行してください。"
    : reason;
}

// hub_pay is a proposal: approving it opens the buyer's own cart screen with
// the proposed item and quantity (2026-10-17, owner-approved). Checkout,
// wallet confirmation and the Commerce order stay with the human on that
// screen; the panel never pays, signs, mints a grant or creates an order.
const PURCHASE_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function purchaseProposal(action: Pick<PiPendingAction, "tool" | "detail">): { productId: string; quantity: number } | null {
  const productId = action.detail?.productId;
  const quantity = action.detail?.quantity;
  if (action.tool !== "hub_pay" || typeof productId !== "string" || !PURCHASE_PRODUCT_ID.test(productId)
    || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) return null;
  return { productId, quantity };
}

export function purchaseCheckoutPath({ productId, quantity }: { productId: string; quantity: number }): string {
  return `/v2/market/cart?${new URLSearchParams({ product: productId, quantity: String(quantity) })}`;
}

type Mode = "harness" | "pi";

export type AiWorkControls = { submit(): void; cancel(): void };
export type AiWorkState = { ready: boolean; busy: boolean; label: string };

export function AiDevelopPanel({ onClose, embedded = false, request, controlsRef, onStateChange }: {
  onClose(): void;
  embedded?: boolean;
  request?: string;
  controlsRef?: Ref<AiWorkControls>;
  onStateChange?: (state: AiWorkState) => void;
}) {
  const [sessionToken, setSessionToken] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [connectorState, setConnectorState] = useState<ConnectorState>("connecting");
  const [agents, setAgents] = useState<DevAgent[]>([]);
  const [agent, setAgent] = useState("codex");
  const [model, setModel] = useState("gpt-5.6-luna");
  const [draft, setPrompt] = useState("");
  const prompt = request ?? draft;
  const submitting = useRef(false);
  const [starting, setStarting] = useState(false);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [resume, setResume] = useState(false);
  const [status, setStatus] = useState<"idle" | "awaiting_confirmation" | "running" | "verifying" | "cancelling" | "done" | "failed" | "cancelled">("idle");
  const [output, setOutput] = useState("");
  const [runId, setRunId] = useState("");
  const harnessRef = useRef<HarnessConnector | null>(null);
  const [changed, setChanged] = useState<HarnessFileChange[] | null>(null);
  const [reverted, setReverted] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<HarnessCheck[]>([]);
  const [error, setError] = useState("");
  const [lastSession, setLastSession] = useState<{ id: string; prompt: string } | null>(null);
  const [history, setHistory] = useState<HarnessRunRecord[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  const pairing = useRef(false);
  const [usage, setUsage] = useState<Record<string, UsageLoadState>>({});
  const usageGeneration = useRef(0);
  const [authentication, setAuthentication] = useState<Record<string, AuthState>>({});
  const authGeneration = useRef(0);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [runtime, setRuntime] = useState<HarnessRuntime | null>(null);
  const [mode, setMode] = useState<Mode>("pi");
  const [pendingApproval, setPendingApproval] = useState<HarnessControlSnapshot["approval"] | null>(null);
  const [deciding, setDeciding] = useState(false);
  // Hub AI — the Pi sidecar loop the desktop itself owns.
  const [piModels, setPiModels] = useState<PiWorkModels | null>(null);
  const [piRefreshingModels, setPiRefreshingModels] = useState(false);
  const [piModelLocation, setPiModelLocation] = useState("all");
  const [piModel, setPiModel] = useState(() => {
    try { return localStorage.getItem(PI_MODEL_KEY) ?? ""; } catch { return ""; }
  });
  const [piAllowWrite, setPiAllowWrite] = useState(false);
  const [piAllowExec, setPiAllowExec] = useState(false);
  const [piAllowHttp, setPiAllowHttp] = useState(false);
  const [verificationProgram, setVerificationProgram] = useState("");
  const [verificationArgs, setVerificationArgs] = useState("");
  const [piRun, setPiRun] = useState<PiRunState | null>(null);
  const [piHistory, setPiHistory] = useState<PiRunState[]>([]);
  const [piResumeId, setPiResumeId] = useState("");
  // Re-rendered once a second while a run is live so the elapsed-time readout
  // moves even when the model is thinking between version bumps.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const piPoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation guard: an in-flight long-poll outlives its timer handle, so
  // superseded watch loops (reconnect, unmount) die by stale generation.
  const piWatch = useRef(0);


  /**
   * Everything the machine kept, plus which continuation handle is offered.
   *
   * The newest run of this agent by default; an entry in the list can name a
   * different one.
   */
  const loadHistory = useCallback(async (harness: HarnessConnector, forAgent: string) => {
    const runs = await harness.history();
    setHistory(runs);
    const latest = runs.find((run) => run.agent === forAgent && run.sessionId);
    setLastSession(latest ? { id: latest.sessionId as string, prompt: latest.prompt } : null);
  }, []);

  useEffect(() => {
    authGeneration.current += 1;
    setAuthentication({});
    return () => { authGeneration.current += 1; };
  }, [sessionToken]);

  const refreshAuthentication = () => {
    const generation = ++authGeneration.current;
    const installed = agents.filter((item) => item.available);
    setAuthentication(Object.fromEntries(installed.map((item) => [item.id, "checking" as const])));
    for (const item of installed) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      void fetch(`${RUNNER}/dev/harnesses/${encodeURIComponent(item.id)}/auth`, {
        headers: { authorization: `Bearer ${sessionToken}` }, cache: "no-store", signal: controller.signal
      }).then(async (response) => {
        const state = response.ok ? authState(await response.json()) : "unknown";
        if (authGeneration.current === generation) setAuthentication((current) => ({ ...current, [item.id]: state }));
      }).catch(() => {
        if (authGeneration.current === generation) setAuthentication((current) => ({ ...current, [item.id]: "unknown" }));
      }).finally(() => clearTimeout(timeout));
    }
  };

  const refreshUsage = useCallback((token: string, agentIds: string[]) => {
    const generation = usageGeneration.current + 1;
    usageGeneration.current = generation;
    setUsage((current) => {
      const next = { ...current };
      for (const id of agentIds) next[id] = { state: "loading" };
      return next;
    });
    for (const id of agentIds) {
      void fetch(`${RUNNER}/dev/usage/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store"
      }).then(async (response) => {
        const body: unknown = response.ok ? await response.json() : null;
        if (!response.ok || !isUsageSnapshot(body)) throw new Error("usage_unavailable");
        if (usageGeneration.current !== generation) return;
        setUsage((current) => ({ ...current, [id]: { state: "ready", snapshot: body } }));
      }).catch(() => {
        if (usageGeneration.current !== generation) return;
        setUsage((current) => ({ ...current, [id]: { state: "unavailable" } }));
      });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (pairing.current) return;
        pairing.current = true;
        const paired = await fetch(`${RUNNER}/pair`, { method: "POST" });
        const body = (await paired.json()) as { sessionToken?: string };
        if (!paired.ok || !body.sessionToken) throw new Error("pair_failed");
        setSessionToken(body.sessionToken);
        const state = await fetch(`${RUNNER}/dev/workspace`, {
          headers: { authorization: `Bearer ${body.sessionToken}` },
          cache: "no-store"
        });
        setWorkspace((await state.json()) as Workspace);
        const listed = await fetch(`${RUNNER}/dev/harnesses`, {
          headers: { authorization: `Bearer ${body.sessionToken}` },
          cache: "no-store"
        });
        const available = (await listed.json()) as DevAgent[];
        setAgents(available);
        setConnectorState("connected");
        refreshUsage(body.sessionToken, available.map((item) => item.id));
        // The model picker's options come from the machine's pi registry.
        // An absent or unreachable registry leaves the free-text field —
        // the run then starts on the runner's default.
        void piWork.models(body.sessionToken).then((available) => {
          const list = Array.isArray(available?.models)
            ? available.models.filter((item): item is string => typeof item === "string")
            : [];
          // `ready` is absent when the runner could not probe auth — that is
          // unknown, not "nothing can run", so it stays undefined rather than
          // becoming an empty list.
          const ready = Array.isArray(available?.ready)
            ? available.ready.filter((item): item is string => typeof item === "string")
            : undefined;
          const fallback = typeof available?.default === "string" ? available.default : "";
          setPiModels({ models: list, ready, default: fallback, locations: available.locations });
          // A remembered or typed choice stays while the registry still lists
          // it — even when `ready` says its provider lacks auth right now,
          // since the operator may be about to add credentials; only a spec
          // the registry does not know falls back to the runner's default.
          setPiModel((current) => (current && (list.length === 0 || list.includes(current)) ? current : fallback || current));
        }).catch(() => {});
        // The ordinary path is implementation and verification, so prefer
        // Codex even when the runner happens to list Claude first.
        const first = preferredAgent(available);
        if (first) { setAgent(first.id); setModel(first.defaultModel); }
        await loadHistory(new HarnessConnector(body.sessionToken), first?.id ?? "codex");
        await attach(body.sessionToken);
      } catch {
        // A desktop app that is not running is the ordinary case, not a fault.
        setConnectorState("unavailable");
      }
    })();
  }, [loadHistory, refreshUsage]);



  /**
   * Pick a run in progress back up.
   *
   * The agent keeps editing after this panel is closed. Opening to an empty
   * form hides that, and asking for the same work again is refused by the
   * runner as a second run in one workspace — so the panel would look broken
   * for a reason the operator cannot see.
   */
  async function attach(token: string) {
    // In-flight Pi work belongs to the same operator screen: a reloaded
    // panel picks the run back up instead of looking empty while it runs.
    const livePi = await piWork.list(token).catch(() => [] as PiRunState[]);
    setPiHistory(Array.isArray(livePi) ? livePi : []);
    const livePiRun = Array.isArray(livePi) ? livePi.find((run) => run.status === "running" || (run.pendingActions ?? []).length > 0) : undefined;
    if (livePiRun) {
      setMode("pi");
      setPiRun(livePiRun);
      watchPi(token, livePiRun.id);
    }
    const harness = new HarnessConnector(token);
    const live = await harness.inProgress();
    if (!live) return;
    setMode("harness");
    setAgent(live.agent);
    setModel(live.model);
    setOutput(live.output);
    setRuntime(live.runtime ?? null);
    setStatus((["awaiting_confirmation", "running", "verifying", "cancelling"] as string[]).includes(live.status)
      ? live.status as DevRun["status"]
      : "running");
    setRunId(live.runId);
    const following = new HarnessConnector(token, live.agent, live.model);
    harnessRef.current = following;
    await consume(following, following.watch(live.runId), live.agent);
  }

  /** Both the started and the picked-up run end the same way, so they share this. */
  async function consume(harness: HarnessConnector, events: AsyncIterable<HarnessEvent>, forAgent: string) {
    try {
      for await (const event of events) {
        if (event.type === "started") { setRunId(event.runId); continue; }
        if (event.type === "approval_required") { setStatus("awaiting_confirmation"); if (event.approval) setPendingApproval(event.approval); continue; }
        if (event.type === "verifying") { setStatus("verifying"); setOutput(event.output); if (event.runtime) setRuntime(event.runtime); continue; }
        if (event.type === "progress") { setOutput(event.output); if (event.runtime) setRuntime(event.runtime); continue; }
        if (event.type === "completed") {
          setOutput(event.output);
          if (event.runtime) setRuntime(event.runtime);
          // The finished run becomes the top of the history below, carrying the
          // same file list and the same undo. Keeping it here as well would put
          // two buttons for one run on the screen.
          setChanged(null);
          setChecks(event.checks ?? []);
          setStatus("done");
          void loadHistory(harness, forAgent);
          return;
        }
        setError(event.error);
        setStatus(event.error === "cancelled" ? "cancelled" : "failed");
        // A run that stopped part-way may already have written; that is exactly
        // when the operator needs to see what, and be able to put it back.
        if (runId) setChanged(await harness.changes(runId));
        void loadHistory(harness, forAgent);
        return;
      }
    } catch (cause) {
      setError((cause as Error).message);
      setStatus("failed");
    }
  }

  async function start() {
    const text = prompt.trim();
    if (!text || running) return;
    const verification = verificationProgram.trim() ? {program: verificationProgram.trim(), args: verificationArgs ? verificationArgs.split("\n") : []} : undefined;
    if (verification && !agents.find((item) => item.id === agent)?.adapter?.capabilities.includes("required_verification")) {
      setError("このRunnerはCLIの指定検証に対応していません。Runnerを更新してください。");
      return;
    }
    setError("");
    setOutput("");
    setChanged(null);
    setReverted(null);
    setChecks([]);
    setRuntime(null);
    setStatus("awaiting_confirmation");
    const resumeId = resume ? lastSession?.id : undefined;
    const harness = new HarnessConnector(sessionToken, agent, model, RUNNER, resumeId);
    harnessRef.current = harness;
    await consume(harness, harness.run({ task: { privacy: "local_preferred" } as never, prompt: text, verification }), agent);
  }

  async function decideVerification(approve: boolean) {
    const action = runtime?.pendingVerification;
    if (!action || !harnessRef.current || deciding) return;
    setDeciding(true);
    try {
      await harnessRef.current.decideVerification(runId, action.id, approve);
      setRuntime((value) => value ? {...value, pendingVerification: null} : value);
    } catch (cause) { setError((cause as Error).message); }
    finally { setDeciding(false); }
  }

  async function revert(id = runId) {
    if (!id) return;
    const harness = harnessRef.current ?? new HarnessConnector(sessionToken, agent, model);
    try {
      setReverted(await harness.revert(id));
      setChanged(null);
      await loadHistory(harness, agent);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  /** Continue the conversation this entry left behind, with its agent. */
  function continueFrom(run: HarnessRunRecord) {
    selectConnection("harness");
    setAgent(run.agent);
    setModel(run.model);
    setLastSession(run.sessionId ? { id: run.sessionId, prompt: run.prompt } : null);
    setResume(true);
  }

  function selectConnection(next: Mode) {
    setMode(next);
    setResume(false);
    setPiResumeId("");
    setPiAllowWrite(false);
    setPiAllowExec(false);
    setPiAllowHttp(false);
    setVerificationProgram("");
    setVerificationArgs("");
  }

  function continuePi(run: PiRunState) {
    selectConnection("pi");
    setPiResumeId(run.id);
    choosePiModel(run.model);
  }

  async function cancel() {
    if (!runId) return;
    setStatus("cancelling");
    await harnessRef.current?.cancel(runId);
  }

  async function decideRun(approved: boolean) {
    if (!runId || deciding) return;
    setDeciding(true);
    setError("");
    try {
      const harness = harnessRef.current ?? new HarnessConnector(sessionToken, agent, model);
      if (approved) await harness.approve(runId); else await harness.deny(runId);
      if (!approved) setPendingApproval(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  // --- Hub AI (Pi sidecar) ---
  // One in-flight long-poll replaces the poll cadence: the request resolves
  // the moment the runner bumps the run's version, so token deltas, tool
  // transitions and approvals arrive immediately with zero idle traffic.
  function watchPi(token: string, id: string) {
    const generation = ++piWatch.current;
    let version = 0;
    const tick = async () => {
      try {
        const { run, version: next } = await piWork.watch(token, id, version);
        if (generation !== piWatch.current) return;
        version = next;
        if (typeof run?.status !== "string") {
          piPoll.current = null;
          return;
        }
        setPiRun(run);
        setPiHistory((runs) => [run, ...runs.filter((item) => item.id !== run.id)]);
        if (run.status !== "running" && (run.pendingActions ?? []).length === 0) {
          piPoll.current = null;
          return;
        }
        void tick();
      } catch {
        // Runner unreachable or restarting: back off while this watch
        // generation is still the live one.
        if (generation === piWatch.current) piPoll.current = setTimeout(tick, 1000);
      }
    };
    void tick();
  }

  /** The picker's selection is remembered for the next panel open. */
  function choosePiModel(value: string) {
    setPiModel(value);
    try { localStorage.setItem(PI_MODEL_KEY, value); } catch { /* storage can be unavailable */ }
  }

  async function startPi() {
    const text = prompt.trim();
    if (!text || !sessionToken || piBusy) return;
    setError("");
    if (verificationProgram.trim() && !piAllowExec) {
      setError("確認コマンドを指定する場合は、コマンド実行を有効にしてください。実行前には承認を求めます。");
      return;
    }
    try {
      const run = await piWork.start(sessionToken, {
        prompt: text,
        model: piModel.trim() || undefined,
        // Older saved conversations retain their runtime without presenting
        // a second harness to the user. New work uses Hub's default runtime.
        engine: piHistory.find((saved) => saved.id === piResumeId)?.engine === "dsh" ? "dsh" : undefined,
        resumeRunId: piResumeId || undefined,
        allowWrite: piAllowWrite,
        allowExec: piAllowExec,
        allowHttp: piAllowHttp,
        ...(verificationProgram.trim() ? { verification: { program: verificationProgram.trim(), args: verificationArgs ? verificationArgs.split("\n") : [] } } : {})
      });
      if (typeof run?.status !== "string") throw new Error("unexpected_response");
      setPiRun(run);
      setPiResumeId("");
      watchPi(sessionToken, run.id);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function decidePi(action: PiPendingAction, approve: boolean) {
    if (!piRun || deciding || (approve && missingFilePreview(action))) return;
    setDeciding(true);
    setError("");
    // Approving hub_pay opens the cart screen synchronously (inside the click,
    // so it is not a blocked popup) and reports only that handoff. An invalid
    // proposal or a screen that did not open resolves as a denial.
    let handoffError = "";
    let outcome: unknown;
    let decision = approve;
    if (approve && action.tool === "hub_pay") {
      const proposal = purchaseProposal(action);
      const opened = proposal ? window.open(purchaseCheckoutPath(proposal), "_blank") : null;
      if (proposal && opened) {
        try { opened.opener = null; } catch { /* cross-context window */ }
        outcome = { status: "handed_to_checkout", productId: proposal.productId, quantity: proposal.quantity };
      } else {
        decision = false;
        handoffError = proposal ? "購入画面を開けませんでした。提案は拒否として返しました。" : "購入提案の内容が正しくないため、拒否として返しました。";
      }
    }
    try {
      // decide bumps the run's version, so the in-flight watch request
      // resolves immediately with the post-decision state — no extra fetch.
      setPiRun(await piWork.decide(sessionToken, piRun.id, action.id, decision, outcome));
      if (handoffError) setError(handoffError);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setDeciding(false);
    }
  }

  async function cancelPi() {
    if (!piRun) return;
    setError("");
    try {
      setPiRun(await piWork.cancel(sessionToken, piRun.id));
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  useEffect(() => () => {
    // Stale the watch generation so an in-flight long-poll stops rescheduling.
    piWatch.current++;
    if (piPoll.current) clearTimeout(piPoll.current);
  }, []);

  useEffect(() => {
    if (piRun?.status !== "running") return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [piRun?.status]);

  async function chooseWorkspace() {
    if (!sessionToken || selectingWorkspace) return;
    setSelectingWorkspace(true);
    setError("");
    try {
      const response = await fetch(`${RUNNER}/dev/workspace/pick`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      if (!response.ok) throw new Error("workspace_picker_failed");
      const selected = (await response.json()) as Workspace;
      if (selected.enabled) setWorkspace(selected);
    } catch {
      setError("フォルダ選択を開けませんでした。デスクトップアプリを確認してください。");
    } finally {
      setSelectingWorkspace(false);
    }
  }

  const running = ["awaiting_confirmation", "running", "verifying", "cancelling"].includes(status);
  const piBusy = !!piRun && piRun.status === "running";
  const busy = running || piBusy || starting;
  const ready = connectorState === "connected" && !!workspace?.enabled
    && (mode !== "harness" || !!agents.find((item) => item.id === agent)?.available);
  const label = `Hubハーネス · ${mode === "harness" ? `${agent} · ${model}`
    : piBusy && piRun ? piRun.model : piModel || "既定のモデル"}`;
  const pastRuns = [
    ...history.map((run) => ({ kind: "cli" as const, run })),
    ...piHistory.filter((run) => run.status !== "running").map((run) => ({ kind: "hub" as const, run }))
  ].sort((left, right) => (right.run.startedAtMs || 0) - (left.run.startedAtMs || 0));

  async function submitRequest() {
    if (!ready || busy || submitting.current || !prompt.trim() || prompt.length > 32000) return;
    submitting.current = true;
    setStarting(true);
    setSubmittedPrompt(prompt.trim());
    try {
      await (mode === "harness" ? start() : startPi());
    } finally {
      submitting.current = false;
      setStarting(false);
    }
  }

  useImperativeHandle(controlsRef, () => ({
    submit: () => { void submitRequest(); },
    cancel: () => { void (mode === "harness" ? cancel() : cancelPi()); }
  }));
  useEffect(() => { onStateChange?.({ ready, busy, label }); }, [ready, busy, label, onStateChange]);

  const frameClass = embedded ? styles.inline : styles.overlay;

  if (connectorState === "unavailable") {
    return (
      <section className={frameClass} aria-label="作業">
        <div className={styles.panel}>
          <div className={styles.header}>
            <div>
              <h2>作業するPCに接続できません</h2>
              <p>Hubのデスクトップアプリの起動と接続を確認してください。</p>
            </div>
            <button type="button" onClick={onClose}>{embedded ? "会話に戻る" : "閉じる"}</button>
          </div>
          <p className={styles.note}>
            このPCで利用可能な開発エージェントに作業を依頼する機能です。デスクトップアプリを起動してください。
          </p>
        </div>
      </section>
    );
  }

  if (connectorState === "connecting") {
    return (
      <section className={frameClass} aria-label="作業の接続">
        <div className={styles.panel} aria-live="polite">
          <div className={styles.header}>
            <div><h2>作業</h2><p>このPCのエージェントに接続しています…</p></div>
            <button type="button" onClick={onClose}>{embedded ? "会話に戻る" : "閉じる"}</button>
          </div>
        </div>
      </section>
    );
  }

  function chooseAgent(next: DevAgent) {
    if (running || !next.available || next.id === agent) return;
    setAgent(next.id);
    setModel(next.defaultModel);
    setResume(false);
    void loadHistory(new HarnessConnector(sessionToken), next.id);
  }

  // Runnable specs (provider auth resolved) lead the picker; the rest stay
  // listed — any spec may still be typed or picked — but are marked as
  // needing auth. Absent `ready` means auth state is unknown, so nothing is
  // marked and the registry order is kept.
  const piReady = piModels?.ready ? new Set(piModels.ready) : null;
  const piTools = piRun?.toolCalls ?? [];
  const piLastTool = piTools[piTools.length - 1];
  const piSpecs = (piModels && piReady
    ? [...piModels.models.filter((spec) => piReady.has(spec)), ...piModels.models.filter((spec) => !piReady.has(spec))]
    : (piModels?.models ?? [])).filter((spec) => piModelLocation === "all" || piModels?.locations?.[spec] === piModelLocation);

  return (
    <section className={frameClass} aria-label="作業">
      <div className={styles.panel}>
        {embedded ? (
          <div className={styles.headerSlim}>
            <h2 className={styles.headerTitle}>Hubハーネス</h2>
            <span className={styles.headerMeta} title={workspace?.workspace ?? undefined}>
              {mode === "pi" ? (piRun?.model ?? piModel) || piModels?.default || "既定のモデル" : `${agent} · ${model}`}
              {workspace?.workspace ? ` · ${workspace.workspace.split(/[\\/]/).filter(Boolean).pop()}` : ""}
            </span>
            <button type="button" onClick={onClose}>会話に戻る</button>
          </div>
        ) : (
          <div className={styles.header}>
            <div>
              <h2>Hubハーネス</h2>
              <p>モデルや接続先を選び、作業を依頼できます。承認・進捗・変更内容・検証結果をここで確認します。</p>
            </div>
            <button type="button" onClick={onClose}>閉じる</button>
          </div>
        )}

        {!embedded ? <p className={styles.workspace}>{workspace ? (workspace.workspace ?? "作業フォルダは未設定です") : "確認中…"}</p> : null}

        <details className={styles.settings} open={embedded ? undefined : true}>
          <summary>作業の設定・使用量 <span>{label}</span></summary>
        <label className={styles.modelControl}>
          <span>接続方法</span>
          <select aria-label="モデルの接続方法" value={mode} disabled={busy} onChange={(event) => selectConnection(event.target.value as Mode)}>
            <option value="pi">API・ローカルモデル</option>
            <option value="harness">CLI</option>
          </select>
        </label>

        {workspace && !workspace.enabled ? (
          <section className={styles.workspaceSetup} aria-label="作業フォルダの設定">
            <p>実行前に作業フォルダを1つ選びます。Codex・Claudeの使用量確認と切り替えは、設定前でも利用できます。</p>
            <button className={styles.workspaceAction} type="button" onClick={() => void chooseWorkspace()} disabled={selectingWorkspace || !sessionToken}>
              {selectingWorkspace ? "選択画面を開いています…" : "作業フォルダを選ぶ"}
            </button>
          </section>
        ) : null}

        {mode === "pi" ? (
          <section className={styles.workspace} aria-label="Hubハーネスのモデル接続">
            <h3>モデル接続</h3>
            <p>モデルを選んで作業を依頼できます。編集・コマンド実行・通信の許可は、この画面で確認できます。</p>
            <div className={styles.controls}>
              <label className={styles.modelControl}>
                <span>会話</span>
                <select aria-label="Hubハーネスの会話" value={piResumeId} disabled={piBusy} onChange={(event) => {
                  setPiResumeId(event.target.value);
                  setPiAllowWrite(false);
                  setPiAllowExec(false);
                  setPiAllowHttp(false);
                  setVerificationProgram("");
                  setVerificationArgs("");
                }}>
                  <option value="">新しい会話</option>
                  {piHistory.filter((run) => run.workspace === workspace?.workspace && run.status !== "running" && run.continuation?.available).map((run) => (
                    <option key={run.id} value={run.id}>{run.prompt.slice(0, 80)}</option>
                  ))}
                </select>
                {piResumeId ? <small>保存した会話から続けます。今回の操作許可を選び直してください。</small> : null}
              </label>
              <label className={styles.modelControl}>
                <span>接続先</span>
                <select aria-label="モデルの接続先" value={piModelLocation} onChange={(event) => setPiModelLocation(event.target.value)} disabled={piBusy}>
                  <option value="all">すべて</option>
                  <option value="local">ローカル</option>
                  <option value="api">API</option>
                </select>
              </label>
              <label className={styles.modelControl}>
                <span>モデル</span>
                <input value={piModel} onChange={(event) => choosePiModel(event.target.value)} placeholder={piModels?.default || "既定のモデル"} spellCheck={false} className={styles.model} disabled={piBusy} list="pi-work-models" />
                <datalist id="pi-work-models">
                  {piSpecs.map((spec) => (
                    <option key={spec} value={spec} label={[piModels?.locations?.[spec] === "local" ? "ローカル" : piModels?.locations?.[spec] === "api" ? "API" : "", piReady && !piReady.has(spec) ? "要認証" : ""].filter(Boolean).join(" · ") || undefined} />
                  ))}
                </datalist>
                {piModels?.ready ? <span className={styles.usageMessage}>今すぐ使えるモデル: {piModels.ready.length}件（全{piModels.models.length}件中）</span> : null}
              </label>
              <button type="button" disabled={!sessionToken || piBusy || piRefreshingModels} onClick={async () => {
                setPiRefreshingModels(true);
                try { setPiModels(await piWork.models(sessionToken, true)); }
                catch (cause) { setError((cause as Error).message); }
                finally { setPiRefreshingModels(false); }
              }}>{piRefreshingModels ? "モデルを確認中…" : "モデル一覧を更新"}</button>
              <label className={styles.resume}><input type="checkbox" checked={piAllowWrite} onChange={(event) => setPiAllowWrite(event.target.checked)} disabled={piBusy} />書き込みを一括許可（未チェックなら毎回承認）</label>
              <label className={styles.resume}><input type="checkbox" checked={piAllowExec} onChange={(event) => setPiAllowExec(event.target.checked)} disabled={piBusy} />コマンド実行を使う（実行のたびに承認）</label>
              <label className={styles.resume}><input type="checkbox" checked={piAllowHttp} onChange={(event) => setPiAllowHttp(event.target.checked)} disabled={piBusy} />HTTP通信を使う（送信のたびに承認）</label>
            </div>
          </section>
        ) : null}

        {mode === "harness" ? (
        <>
        <section className={styles.agentPicker} aria-labelledby="dev-agent-heading">
          <div className={styles.agentPickerHead}>
            <div>
              <h3 id="dev-agent-heading">CLIの接続先</h3>
              <span>機能・端末の認証情報・残り使用量を確認できます</span>
            </div>
            <button
              type="button"
              onClick={refreshAuthentication}
              disabled={!sessionToken || !agents.some((item) => item.available) || Object.values(authentication).includes("checking")}
            >
              認証を確認
            </button>
            <button
              type="button"
              onClick={() => refreshUsage(sessionToken, agents.map((item) => item.id))}
              disabled={!sessionToken || agents.length === 0 || Object.values(usage).some((item) => item.state === "loading")}
            >
              使用量を更新
            </button>
          </div>
          <div className={styles.agentCards} role="radiogroup" aria-label="開発エージェント">
            {agents.map((item) => {
              const adapter = adapterOf(item);
              const guidance = adapter.capabilities.includes("proposal") ? {
                badge: "提案専用",
                work: "文章・仕様整理・セカンドオピニオン",
                detail: "提案専用です。ファイルやシェルは操作しません。"
              } : AGENT_GUIDANCE[item.id] ?? {
                badge: "追加エージェント",
                work: "設定された役割",
                detail: "この端末のエージェント設定に従って作業します。"
              };
              const selected = item.id === agent;
              const usageState = usage[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`${styles.agentCard} ${selected ? styles.agentCardSelected : ""}`}
                  onClick={() => chooseAgent(item)}
                  disabled={running || !item.available}
                >
                  <span className={styles.agentName}><strong>{item.label}</strong><small>{guidance.badge}</small></span>
                  <span className={styles.agentWork} aria-live="polite">{adapter.connectionState === "connected" ? AUTH_LABELS[authentication[item.id] ?? "unchecked"] : "利用不可"}</span>
                  <span className={styles.agentWork}>{guidance.work}</span>
                  <span className={styles.agentDetail}>{item.available ? guidance.detail : item.unavailableReason === "executable not installed" ? "この端末にCLIが見つかりません。" : "この接続先では作業フォルダの範囲を安全に制限できません。"}</span>
                  <span className={styles.agentDetail}>能力: {adapter.capabilities.join(" / ")}</span>
                  <span className={styles.usage} aria-live="polite">
                    {!usageState || usageState.state === "loading" ? (
                      <span className={styles.usageMessage}>使用量を確認中…</span>
                    ) : usageState.state === "unavailable" ? (
                      <span className={styles.usageMessage}>使用量を取得できません</span>
                    ) : (
                      usageState.snapshot.windows.map((window) => (
                        <span className={styles.usageWindow} key={window.id}>
                          <span><strong>{window.label}</strong><b>残り {Math.round(window.remainingPercent)}%</b></span>
                          <progress aria-label={`${window.label}の残り使用量`} max={100} value={window.remainingPercent} />
                          <small>更新 {resetText(window)}</small>
                        </span>
                      ))
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className={styles.controls}>
          <label className={styles.modelControl}>
            <span>モデル</span>
            <input
              list="dev-models"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="モデル"
              spellCheck={false}
              className={styles.model}
              disabled={running}
            />
          </label>
          <datalist id="dev-models">
            {(SUGGESTED[agent] ?? []).map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {agents.find((item) => item.id === agent)?.canResume && lastSession ? (
            <label className={styles.resume} title={lastSession.prompt}>
              <input type="checkbox" checked={resume} onChange={(event) => setResume(event.target.checked)} disabled={running} />
              続きから
              <span className={styles.resumeHint}>{lastSession.prompt.slice(0, 24)}</span>
            </label>
          ) : null}
        </div>
        </>
        ) : null}

        <div className={styles.controls}>
          <label className={`${styles.modelControl} ${styles.verificationControl}`}>
            <span>確認コマンド（任意）</span>
            <input aria-label="確認コマンド" value={verificationProgram} onChange={(event) => setVerificationProgram(event.target.value)} placeholder="例: node" disabled={busy} />
          </label>
          {verificationProgram ? <label className={`${styles.modelControl} ${styles.verificationControl}`}>
            <span>引数（1行に1つ）</span>
            <textarea aria-label="確認コマンドの引数" value={verificationArgs} onChange={(event) => setVerificationArgs(event.target.value)} placeholder="例: verify.cjs" disabled={busy} />
            <small>{mode === "harness" ? "CLI終了後、Hubが作業フォルダで実行します。実行には別途承認が必要です。" : "作業フォルダで実行します。失敗時は1回の修正後に再確認します。実行のたびに承認が必要です。"}</small>
          </label> : null}
        </div>
        </details>

        {mode === "harness" && runtime ? (
          <section className={styles.runtime} aria-label="Hubハーネスの実行状態">
            <span><small>フェーズ</small><strong>{PHASE_LABEL[runtime.phase] ?? runtime.phase}</strong></span>
            <span><small>経過</small><strong>{durationText(runtime.elapsedMs)} / {durationText(runtime.budget.maxDurationMs)}</strong></span>
            <span><small>ツール</small><strong>{runtime.toolCalls} / {runtime.budget.maxToolCalls}</strong></span>
            <span><small>反復</small><strong>{runtime.iterations}</strong></span>
            <CliUsage usage={runtime.usage} />
            {runtime.stopReason ? <p>停止理由: {stopText(runtime.stopReason)}</p> : null}
            {runtime.control ? (
              <div className={styles.controlPlane}>
                <span><small>Task Contract</small><strong>{runtime.control.contract.id}</strong></span>
                <span><small>実行主体</small><strong>{runtime.control.adapter?.label ?? "旧接続記録"}</strong></span>
                <span><small>接続</small><strong>{runtime.control.adapter ? `${runtime.control.adapter.connectionState} · ${runtime.control.adapter.transport}` : "legacy"}</strong></span>
                <span><small>現在のStep</small><strong>{runtime.control.state.plan.find((step) => step.id === runtime.control?.state.activeStepId)?.description ?? "完了判定"}</strong></span>
                <span><small>Checkpoint</small><strong>{runtime.control.state.checkpointId}</strong></span>
                <span><small>Trace</small><strong>{runtime.control.trace.length} events</strong></span>
                <span><small>承認</small><strong>{runtime.control.approval.riskLevel} · {runtime.control.approval.state}</strong></span>
                <span><small>Context</small><strong>{runtime.control.context.hotChars + runtime.control.context.warmChars + runtime.control.context.coldChars} / {runtime.control.context.budgetChars} chars</strong></span>
                <span><small>評価</small><strong>{runtime.control.state.status === "completed" || runtime.control.state.status === "failed" ? `${runtime.control.evaluation.score} / 100` : "計測中"}</strong></span>
                {runtime.control.approval.blockedCapabilities.length > 0 ? <p>禁止された作用: {runtime.control.approval.blockedCapabilities.join(" / ")}</p> : null}
                {runtime.control.failureClass ? <p>失敗分類: {runtime.control.failureClass}</p> : null}
                {runtime.control.state.forceReplan ? <p>同じ失敗を検出したため、再計画が必要です。</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}



        {embedded && !workspace?.enabled ? <button className={styles.workspaceAction} type="button" onClick={() => void chooseWorkspace()} disabled={selectingWorkspace || !sessionToken}>{selectingWorkspace ? "選択画面を開いています…" : "作業フォルダを選ぶ"}</button> : null}

        {!embedded ? <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          maxLength={32000}
          placeholder="やってほしいことを書く"
        /> : null}

        {error ? <p className={styles.error} role="alert">{stopText(error)}</p> : null}

        {/* The feed is the work transcript: request → approvals → progress → answer. */}
        <div className={styles.feed}>
        {embedded && submittedPrompt ? <div className={styles.request} aria-label="今回の依頼"><p>{submittedPrompt}</p></div> : null}

        {mode === "harness" && status === "verifying" && runtime?.pendingVerification ? (
          <section className={`${styles.changes} ${styles.attention}`} aria-label="確認コマンドの承認">
            <strong>指定した確認コマンドを実行しますか？</strong>
            <p>CLIの制限外で、端末上のプログラムを実行します。</p>
            <pre className={styles.output}>{JSON.stringify(runtime.pendingVerification.command, null, 2)}</pre>
            <div className={styles.actions}>
              <button type="button" onClick={() => void decideVerification(false)} disabled={deciding}>検証を拒否</button>
              <button type="button" onClick={() => void decideVerification(true)} disabled={deciding}>承認して検証</button>
            </div>
          </section>
        ) : null}

        {mode === "harness" ? (
          <>
            {!embedded ? <div className={styles.actions}>
              <button type="button" onClick={cancel} disabled={!running}>中断</button>
              <button type="button" className={styles.primary} onClick={() => void submitRequest()} disabled={busy || !ready || !prompt.trim()}>
                実行
              </button>
            </div> : null}

            {status === "awaiting_confirmation" ? (
              <section className={`${styles.changes} ${styles.attention}`} aria-label="実行の承認">
                <strong>この実行を開始しますか？</strong>
                <ul>
                  <li><code>{agent} {model}</code> が作業フォルダで実行されます</li>
                  {pendingApproval ? (
                    <>
                      <li>リスク: {pendingApproval.riskLevel} · 要求能力: {pendingApproval.requestedCapabilities.join(" / ") || "なし"}</li>
                      {pendingApproval.blockedCapabilities.length > 0 ? <li>禁止された作用: {pendingApproval.blockedCapabilities.join(" / ")}</li> : null}
                      <li><small>フィンガープリント {pendingApproval.requestFingerprint}</small></li>
                    </>
                  ) : null}
                </ul>
                <div className={styles.actions}>
                  <button type="button" onClick={() => void decideRun(false)} disabled={deciding}>拒否</button>
                  <button type="button" className={styles.primary} onClick={() => void decideRun(true)} disabled={deciding}>承認して開始</button>
                </div>
              </section>
            ) : null}

            {status === "idle" ? null : (
              <>
                <p className={styles.status}>{status === "done" ? runtime?.verification?.status === "passed" ? "指定した検証に合格" : "返答終了" : STATUS[status]}</p>
                {runtime?.verification ? <p className={styles.meta} aria-label="今回の検証結果">{verificationText(runtime.verification)}</p> : null}
                <pre className={styles.output}>{output}</pre>
              </>
            )}
          </>
        ) : (
          <>
            {!embedded ? <div className={styles.actions}>
              <button type="button" onClick={() => void cancelPi()} disabled={!piBusy}>中断</button>
              <button type="button" className={styles.primary} onClick={() => void submitRequest()} disabled={busy || !ready || !prompt.trim()}>
                実行
              </button>
            </div> : null}

            {piRun && (piRun.pendingActions ?? []).length > 0 ? (
              <section className={`${styles.changes} ${styles.attention}`} aria-label="操作の承認">
                <strong>承認待ちの操作 {piRun.pendingActions.length}件</strong>
                {(piRun.pendingActions ?? []).map((action) => (
                  <div key={action.id}>
                    <p><code>{action.tool}</code> {action.summary}</p>
                    {filePreview(action) ? <details open>
                      <summary>変更内容 · {action.detail!.path}</summary>
                      <p>変更前{action.detail!.previousSha256 === null ? "（新しいファイル）" : ""}</p>
                      <pre className={styles.output} aria-label="承認する変更の変更前">{action.detail!.before}</pre>
                      <p>変更後</p>
                      <pre className={styles.output} aria-label="承認する変更の変更後">{action.detail!.after}</pre>
                    </details> : missingFilePreview(action) ? <p role="status">変更内容が届いていないため承認できません。Desktop Runtimeを更新してください。</p> : null}
                    {action.tool === "hub_pay" ? <p>{purchaseProposal(action)
                      ? `これは購入の提案です（数量 ${purchaseProposal(action)!.quantity}）。購入画面を開くだけで、支払いや署名は行いません。内容を確認して、購入するかどうかはご自身で決めます。`
                      : "購入提案の内容が正しくないため、開けません。拒否してください。"}</p> : null}
                    <div className={styles.changesHead}>
                      <button type="button" onClick={() => void decidePi(action, false)} disabled={deciding}>拒否</button>
                      {" "}
                      <button type="button" className={styles.primary} onClick={() => void decidePi(action, true)} disabled={deciding || missingFilePreview(action) || (action.tool === "hub_pay" && !purchaseProposal(action))}>{action.tool === "hub_pay" ? "購入画面を開く" : "承認"}</button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {piRun ? (
              <>
                <p className={styles.status} data-active={piRun.status === "running" || undefined}>
                  {piRun.status === "running" ? <span className={styles.liveDot} aria-hidden="true" /> : null}
                  {piRun.status === "done" ? "返答終了" : (STATUS[piRun.status] ?? piRun.status)} · 経過 {durationText(Math.max(0, (piRun.endedAtMs ?? nowMs) - piRun.startedAtMs))} · ツール {piTools.length}回
                  {piRun.outcome ? ` · 終了コード ${piRun.outcome.exitCode ?? "?"}` : ""}
                </p>
                {piTools.length > 0 ? (
                  <details className={styles.trace}>
                    <summary>
                      <span className={styles.traceCount}>ツール {piTools.length}回</span>
                      {piLastTool ? (
                        <span className={styles.traceLatest} aria-hidden="true">
                          <span className={styles.toolMark} data-state={piLastTool.ok === true ? "ok" : piLastTool.ok === false ? "fail" : "run"}>{piLastTool.ok === true ? "✓" : piLastTool.ok === false ? "✗" : "…"}</span>
                          <code className={styles.toolName}>{piLastTool.name}</code>
                          {piLastTool.detail ? <span className={styles.toolArg}>{piLastTool.detail}</span> : null}
                        </span>
                      ) : null}
                    </summary>
                  <ul className={styles.toolList} aria-label="ツールの実行">
                    {piTools.length > PI_TOOL_LIST_MAX ? <li className={styles.toolMore}>…他 {piTools.length - PI_TOOL_LIST_MAX} 件</li> : null}
                    {piTools.slice(-PI_TOOL_LIST_MAX).map((call) => {
                      const state = call.ok === true ? "ok" : call.ok === false ? "fail" : "run";
                      const row = <>
                        <span className={styles.toolMark} data-state={state} aria-hidden="true">{state === "ok" ? "✓" : state === "fail" ? "✗" : "…"}</span>
                        <code className={styles.toolName}>{call.name}</code>
                        {call.detail ? <span className={styles.toolArg}>{call.detail}</span> : null}
                        {state === "run" ? <span className={styles.toolState}>実行中</span> : null}
                      </>;
                      return (
                        <li key={call.id} className={styles.toolItem} data-state={state}>
                          {call.preview ? (
                            <details className={styles.toolExpand}>
                              <summary>{row}</summary>
                              <pre className={styles.toolPreview}>{call.preview}</pre>
                            </details>
                          ) : (
                            <div className={styles.toolRow}>{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  </details>
                ) : null}
                {piRun.continuation?.error ? <p className={styles.meta} role="status">会話の保存に問題があります。直近の作業は再開時に引き継がれない場合があります。</p> : null}
                {piRun.verification ? <p className={styles.meta} aria-label="今回の検証結果">{verificationText(piRun.verification)}。モデルの返答後にもHubが確認します。</p> : null}
                {piRun.usage && piRun.usage.requests > 0 ? <p className={styles.meta} aria-label="モデルの使用量">
                  入力 {piRun.usage.input + piRun.usage.cacheRead + piRun.usage.cacheWrite} · 未キャッシュ入力 {piRun.usage.input} · 再利用 {piRun.usage.cacheRead} · キャッシュ書込 {piRun.usage.cacheWrite} · 出力 {piRun.usage.output} トークン · {piRun.usage.requests}回の応答
                  <small> 提供元の報告値です。再利用が0でも、キャッシュ情報が未報告の場合があります。</small>
                </p> : null}
                {piRun.status === "running" && piRun.partialOutput ? (
                  <div className={styles.answer} aria-live="polite"><AssistantText text={piRun.partialOutput} /></div>
                ) : null}
                {piRun.status !== "running" && piRun.finalOutput ? <div className={styles.answer} aria-label="最終応答"><AssistantText text={piRun.finalOutput} /></div> : null}
                {piRun.stderrTail ? <pre className={styles.output}>{piRun.stderrTail}</pre> : null}
              </>
            ) : null}
          </>
        )}

        {mode === "harness" && checks.length > 0 ? (
          <section className={styles.changes} aria-label="検証結果">
            <strong>検証結果</strong>
            <ul>{checks.map((check) => <li key={check.name}><code>{check.status}</code> {check.name} · {check.detail}</li>)}</ul>
          </section>
        ) : null}

        {mode === "harness" && changed && changed.length > 0 ? (
          <section className={styles.changes}>
            <div className={styles.changesHead}>
              <strong>変更したファイル {changed.filter((item) => !item.alreadyDirty).length}件</strong>
              <button type="button" onClick={() => void revert()} disabled={running || !changed.some((item) => !item.alreadyDirty && item.revertSupported !== false)}>この実行を取り消す</button>
            </div>
            <ul>
              {changed.map((item) => (
                <li key={item.path} className={item.alreadyDirty ? styles.untouched : undefined}>
                  <code>{item.state.trim() || "??"}</code> {item.path}
                  {item.alreadyDirty ? <small>実行前から変更あり · 取り消さない</small> : null}
                  {!item.alreadyDirty && item.revertSupported === false ? <small>安全な自動取り消しの対象外</small> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {mode === "harness" && reverted ? (
          <p className={styles.status}>
            {reverted.length > 0 ? `${reverted.length}件を元に戻しました` : "戻すものはありませんでした"}
          </p>
        ) : null}

        <section className={styles.history} aria-label="Hubハーネスの実行履歴">
          <h3>{embedded ? "このPCの実行履歴" : "これまでの実行"}</h3>
          {pastRuns.length === 0 ? (
            <p className={styles.historyEmpty}>まだありません</p>
          ) : (
            pastRuns.map((entry) => {
              if (entry.kind === "hub") {
                const run = entry.run;
                const key = `hub:${run.id}`;
                const isOpen = opened === key;
                return (
                  <article key={key} className={styles.entry}>
                    <p className={styles.request}>{run.prompt.split("\n")[0]}</p>
                    <div className={styles.entryHead}>
                      <strong className={run.status === "done" ? undefined : styles.failed}>
                        {run.status === "done" ? "返答終了" : STATUS[run.status] ?? run.status} · {run.model}
                      </strong>
                      {run.startedAtMs ? <span>{WHEN.format(new Date(run.startedAtMs))}</span> : null}
                    </div>
                    <p className={styles.count}>操作 {run.toolCalls.length}回 · 失敗 {run.toolCalls.filter((tool) => tool.ok === false).length}回</p>
                    <p className={styles.count} aria-label="指定した検証の結果">{verificationText(run.verification)}</p>
                    <div className={styles.entryActions}>
                      <button type="button" onClick={() => setOpened(isOpen ? null : key)}>{isOpen ? "たたむ" : "中身を見る"}</button>
                      {run.continuation?.available && run.workspace === workspace?.workspace ? (
                        <button type="button" disabled={busy} onClick={() => continuePi(run)}>この続きから</button>
                      ) : null}
                    </div>
                    {isOpen ? <>
                      {run.finalOutput ? <div className={styles.answer} aria-label="最終応答"><AssistantText text={run.finalOutput} /></div> : null}
                      {run.outcome?.error ? <p className={styles.failed}>{run.outcome.error}</p> : null}
                      {run.continuation?.error ? <p className={styles.failed}>{run.continuation.error}</p> : null}
                      <p>返答終了は、検証の合格や目的の達成を示すものではありません。</p>
                    </> : null}
                  </article>
                );
              }
              const run = entry.run;
              const mine = (run.changed ?? []).filter((item) => !item.alreadyDirty);
              const reversible = mine.filter((item) => item.revertSupported !== false);
              const key = `cli:${run.id}`;
              const isOpen = opened === key;
              return (
                <article key={key} className={styles.entry}>
                  <p className={styles.request}>{run.prompt.split("\n")[0]}</p>
                  <div className={styles.entryHead}>
                    <strong className={run.status === "done" ? undefined : styles.failed}>
                      {run.status === "done" ? run.verification?.status === "passed" ? "指定した検証に合格" : "返答終了" : STATUS[run.status] ?? run.status} · {run.agent} {run.model}
                    </strong>
                    <span>{WHEN.format(new Date(run.startedAtMs))}</span>
                  </div>
                  <p className={styles.count}>{mine.length > 0 ? `${mine.length}件のファイルを変更` : "変更なし"}</p>
                  <p className={styles.count} aria-label="指定した検証の結果">{verificationText(run.verification)}</p>
                  <p className={styles.audit}>
                    {PHASE_LABEL[run.phase ?? ""] ?? run.phase ?? "終了"} · ツール {run.toolCalls ?? 0}回 · 反復 {run.iterations ?? 0}回
                    {run.harness?.state.checkpointId ? ` · Checkpoint ${run.harness.state.checkpointId}` : ""}
                    {run.harness?.approval.riskLevel ? ` · Risk ${run.harness.approval.riskLevel}` : ""}
                    {typeof run.harness?.evaluation.score === "number" ? ` · 評価 ${run.harness.evaluation.score}/100` : ""}
                    {run.stopReason ? ` · 停止理由 ${stopText(run.stopReason)}` : ""}
                  </p>
                  <div className={styles.entryActions}>
                    <button type="button" onClick={() => setOpened(isOpen ? null : key)}>
                      {isOpen ? "たたむ" : "中身を見る"}
                    </button>
                    {run.sessionId ? (
                      <button type="button" disabled={busy} onClick={() => continueFrom(run)}>この続きから</button>
                    ) : null}
                    {mine.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => void revert(run.id)}
                        disabled={!run.revertable || reversible.length === 0 || busy}
                        title={reversible.length === 0 ? "この変更は安全な自動取り消しに対応していません" : run.revertable ? undefined : "実行後にファイルが変わったか、アプリを起動し直したため取り消せません"}
                      >
                        取り消す
                      </button>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <>
                      <CliUsage usage={run.usage} />
                      {tailText(run.tail) ? <pre className={styles.output}>{tailText(run.tail)}</pre> : null}
                      {mine.length > 0 ? (
                        <ul>
                          {mine.map((item) => (
                            <li key={item.path}>
                              <code>{item.state.trim() || "??"}</code> {item.path}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {(run.checks ?? []).length > 0 ? (
                        <ul aria-label="検証結果">
                          {(run.checks ?? []).map((check) => <li key={check.name}><code>{check.status}</code> {check.name} · {check.detail}</li>)}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
        </div>

        {mode === "harness" ? (
            <p className={styles.note}>
              CLI接続では、作業内容をCLIへ渡します。開始前の承認、進捗、変更内容、検証結果、取り消しはHubハーネスで確認できます。依頼文と必要なソースの一部は、選んだ接続先のクラウド処理へ送信される場合があります。
            </p>
        ) : null}
      </div>
    </section>
  );
}
