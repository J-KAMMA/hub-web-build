"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, LoaderCircle, Play, ShieldCheck, X } from "lucide-react";
import {
  UiButton,
  UiLinkButton,
  UiStatePanel,
} from "@/components/ui/primitives";
import type { HubIntentApprovalKind, HubIntentRunSnapshot } from "@/lib/platform/intent-orchestrator";
import styles from "./intent-run-center.module.css";

const STAGES = {
  discovery: "探索", comparison: "比較", selection: "選択",
  contract_approval: "契約確認", payment_approval: "支払い確認",
  execution: "実行", fulfillment: "履行確認", complete: "完了",
} as const;
const STATES = {
  awaiting_approval: "確認が必要", ready: "再開できます", running: "進行中",
  paused: "一時停止", handoff_required: "サービスで操作", completed: "完了",
  failed: "失敗", cancelled: "取り消し済み", expired: "期限切れ",
} as const;
type ApiBody = { run?: HubIntentRunSnapshot; runs?: HubIntentRunSnapshot[]; error?: string };
type CommerceKind = "marketplace" | "digital" | "work" | "ai";
type IntentDraft = {
  version: 1;
  savedAt: number;
  goal: string;
  commerceRequired: boolean;
  commerceKind: CommerceKind;
  counterparty: string;
  maximumCharge: string;
  currency: string;
  recipient: string;
};

const INTENT_DRAFT_KEY = "hub.intent.draft.v1";
const INTENT_DRAFT_MAX_AGE_MS = 60 * 60 * 1_000;
const LOGIN_HREF = "/v2/auth?next=%2Fv2%2Fintent";

function isCommerceKind(value: unknown): value is CommerceKind {
  return ["marketplace", "digital", "work", "ai"].includes(String(value));
}

function takeIntentDraft(): IntentDraft | null {
  try {
    const raw = window.sessionStorage.getItem(INTENT_DRAFT_KEY);
    window.sessionStorage.removeItem(INTENT_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<IntentDraft>;
    if (
      draft.version !== 1
      || typeof draft.savedAt !== "number"
      || Date.now() - draft.savedAt > INTENT_DRAFT_MAX_AGE_MS
      || typeof draft.goal !== "string"
      || typeof draft.commerceRequired !== "boolean"
      || !isCommerceKind(draft.commerceKind)
      || typeof draft.counterparty !== "string"
      || typeof draft.maximumCharge !== "string"
      || typeof draft.currency !== "string"
      || typeof draft.recipient !== "string"
    ) return null;
    return draft as IntentDraft;
  } catch {
    return null;
  }
}

export function IntentRunCenter({
  project,
  focusRunId,
  showComposer = true,
}: {
  project: string;
  focusRunId?: string;
  showComposer?: boolean;
}) {
  const [runs, setRuns] = useState<HubIntentRunSnapshot[]>([]);
  const [goal, setGoal] = useState("");
  const [commerceRequired, setCommerceRequired] = useState(false);
  const [commerceKind, setCommerceKind] = useState<CommerceKind>("marketplace");
  const [counterparty, setCounterparty] = useState("");
  const [maximumCharge, setMaximumCharge] = useState("");
  const [currency, setCurrency] = useState("JPYC");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [accessRequired, setAccessRequired] = useState(false);

  useEffect(() => {
    const draft = takeIntentDraft();
    if (!draft) return;
    setGoal(draft.goal.slice(0, 500));
    setCommerceRequired(draft.commerceRequired);
    setCommerceKind(draft.commerceKind);
    setCounterparty(draft.counterparty.slice(0, 200));
    setMaximumCharge(draft.maximumCharge.replace(/\D/g, "").slice(0, 39));
    setCurrency(draft.currency.slice(0, 16));
    setRecipient(draft.recipient.slice(0, 200));
  }, []);

  function preserveDraft() {
    try {
      const draft: IntentDraft = {
        version: 1,
        savedAt: Date.now(),
        goal,
        commerceRequired,
        commerceKind,
        counterparty,
        maximumCharge,
        currency,
        recipient,
      };
      window.sessionStorage.setItem(INTENT_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // The in-memory draft remains available when browser storage is blocked.
    }
  }

  function clearPreservedDraft() {
    try {
      window.sessionStorage.removeItem(INTENT_DRAFT_KEY);
    } catch {
      // The run was still created successfully.
    }
  }

  const refresh = useCallback(async () => {
    const response = await fetch("/api/core/intents?limit=20", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null) as ApiBody | null;
    if (response.status === 401) {
      setRuns([]);
      setAccessRequired(true);
      setNotice("");
      return;
    }
    if (!response.ok || !body) throw new Error(body?.error ?? "Intent作業を取得できませんでした。");
    setRuns(body.runs ?? []);
    setAccessRequired(false);
    setNotice("");
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(error instanceof Error ? error.message : "取得に失敗しました。"));
  }, [refresh]);
  useEffect(() => {
    if (!runs.some((run) =>
      !["completed", "cancelled", "expired"].includes(run.state)
    )) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => {
        // Keep the last known snapshot visible and retry on the next interval.
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, runs]);

  async function createRun() {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/core/intents", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: { namespace: "hub", kind: "profile", id: "self" },
          objective: "hub.orchestration.fulfill",
          constraints: {
            goalSummary: goal.trim().slice(0, 500),
            project,
            commerceRequired,
            ...(commerceRequired
              ? {
                  contractSummary: goal.trim().slice(0, 500),
                  kind: commerceKind,
                  counterparty: counterparty.trim().slice(0, 200),
                  maximumCharge: maximumCharge.trim(),
                  currency: currency.trim().toUpperCase().slice(0, 16),
                  recipient: recipient.trim().slice(0, 200),
                }
              : {}),
          },
          negotiable: [],
          approvals: { publish: "required", contract: "required", payment: "required", personalData: "required" },
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
      const body = await response.json().catch(() => null) as ApiBody | null;
      if (response.status === 401) {
        preserveDraft();
        setAccessRequired(true);
        return;
      }
      if (!response.ok || !body?.run) throw new Error(body?.error ?? "Intent作業を作成できませんでした。");
      setAccessRequired(false);
      setGoal("");
      setCommerceRequired(false);
      setCommerceKind("marketplace");
      setCounterparty("");
      setMaximumCharge("");
      setCurrency("JPYC");
      setRecipient("");
      clearPreservedDraft();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "作成に失敗しました。");
    } finally { setBusy(false); }
  }

  async function retryAccess() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await refresh();
    } catch {
      setNotice("ログイン状態を確認できませんでした。接続を確認して、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function transition(run: HubIntentRunSnapshot, endpoint: "advance" | "cancel") {
    setBusy(true);
    try {
      const response = await fetch(`/api/core/intents/${encodeURIComponent(run.id)}/${endpoint}`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: run.version, outcome: endpoint === "advance" ? "continue" : undefined }),
      });
      const body = await response.json().catch(() => null) as ApiBody | null;
      if (response.status === 401) {
        setAccessRequired(true);
        return;
      }
      if (!response.ok) {
        throw new Error(body?.error === "contract_preview_required"
          ? "契約案が所有サービスから届くまで待機します。"
          : body?.error === "payment_preview_required"
            ? "支払先と最大額がCommerceから届くまで待機します。"
            : body?.error ?? "作業を更新できませんでした。");
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新に失敗しました。");
    } finally { setBusy(false); }
  }

  async function decide(run: HubIntentRunSnapshot, kind: HubIntentApprovalKind, decision: "granted" | "denied") {
    const preview = run.checkpoints?.at(-1);
    setBusy(true);
    try {
      const response = await fetch(`/api/core/intents/${encodeURIComponent(run.id)}/approval`, {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, decision, previewHash: preview?.previewHash ?? null }),
      });
      const body = await response.json().catch(() => null) as ApiBody | null;
      if (response.status === 401) {
        setAccessRequired(true);
        return;
      }
      if (!response.ok) throw new Error(body?.error ?? "確認結果を保存できませんでした。");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "更新に失敗しました。");
    } finally { setBusy(false); }
  }

  return <section className={styles.section} aria-labelledby="intent-run-heading">
    <header><div><h2 id="intent-run-heading">Intent作業</h2><p>探索から履行までを保存し、いつでも再開できます。</p></div>{busy ? <LoaderCircle className={styles.spin} aria-label="更新中" /> : null}</header>
    {showComposer ? <div className={styles.composer}>
      <textarea value={goal} maxLength={500} onChange={(event) => setGoal(event.target.value)} placeholder="実現したいことを簡潔に入力" aria-label="実現したいこと" />
      <label>
        <input
          type="checkbox"
          checked={commerceRequired}
          onChange={(event) => setCommerceRequired(event.target.checked)}
        />
        購入・契約・有料サービスを含む
      </label>
      {commerceRequired ? <div className={styles.commerceFields}>
        <label>取引種別<select value={commerceKind} onChange={(event) => setCommerceKind(event.target.value as typeof commerceKind)}>
          <option value="marketplace">商品</option>
          <option value="digital">デジタル</option>
          <option value="work">クラウドソーシング</option>
          <option value="ai">AI</option>
        </select></label>
        <label>相手<input value={counterparty} maxLength={200} onChange={(event) => setCounterparty(event.target.value)} /></label>
        <label>支払い上限<input inputMode="numeric" value={maximumCharge} onChange={(event) => setMaximumCharge(event.target.value.replace(/\D/g, "").slice(0, 39))} /></label>
        <label>通貨<input value={currency} maxLength={16} onChange={(event) => setCurrency(event.target.value)} /></label>
        <label>受取先<input value={recipient} maxLength={200} onChange={(event) => setRecipient(event.target.value)} /></label>
      </div> : null}
      <button
        type="button"
        disabled={!goal.trim() || busy || (commerceRequired && (!counterparty.trim() || !maximumCharge || !currency.trim() || !recipient.trim()))}
        onClick={createRun}
      ><Play />作業を始める</button>
    </div> : null}
    {accessRequired ? <UiStatePanel
      state="forbidden"
      title="Intent作業にはログインが必要です"
      description="入力内容は保持されています。ログイン後にこの画面へ戻るか、ログイン済みなら状態を再確認してください。"
      action={<div className="ui-state-actions">
        <UiLinkButton href={LOGIN_HREF} tone="primary" onClick={preserveDraft}>ログインして続ける</UiLinkButton>
        <UiButton type="button" pending={busy} pendingLabel="確認中…" onClick={() => void retryAccess()}>ログイン状態を再確認</UiButton>
      </div>}
    /> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    <div className={styles.runs}>
      {[...runs].sort((left, right) => {
        if (left.id === focusRunId) return -1;
        if (right.id === focusRunId) return 1;
        return 0;
      }).map((run) => {
        const preview = run.checkpoints?.at(-1);
        const pending = run.approvals.filter((item) => item.status !== "granted");
        const approval = run.currentStage === "contract_approval" ? pending.find((item) => item.kind === "contract")
          : run.currentStage === "payment_approval" ? pending.find((item) => item.kind === "payment")
          : run.currentStage === "execution" ? pending.find((item) => item.kind === "execution" || item.kind === "personal_data")
          : null;
        const terminal = ["completed", "cancelled", "expired"].includes(run.state);
        const retryable = run.state === "failed";
        const stageNames = Object.keys(STAGES);
        const currentIndex = stageNames.indexOf(run.currentStage);
        return <article
          key={run.id}
          aria-current={run.id === focusRunId ? "step" : undefined}
        >
          <div className={styles.runHeading}><div><strong>{run.goalSummary || STAGES[run.currentStage]}</strong><span data-state={run.state}>{STATES[run.state]}</span></div><small>v{run.version}</small></div>
          <ol className={styles.steps} aria-label="作業の進行状況">
            {Object.entries(STAGES).map(([stage, label], index) => <li key={stage} data-current={stage === run.currentStage} data-complete={index < currentIndex || run.state === "completed"}><span>{index < currentIndex || run.state === "completed" ? <Check /> : index + 1}</span>{label}</li>)}
          </ol>
          {preview && Object.keys(preview.safeSummary).length ? <dl className={styles.preview}>{Object.entries(preview.safeSummary).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : null}
          {run.checkpoints?.length ? <details className={styles.history}>
            <summary>作業履歴 <span>{run.checkpoints.length}</span></summary>
            <ol>
              {[...run.checkpoints].reverse().map((checkpoint) => <li key={`${checkpoint.sequence}-${checkpoint.createdAt}`}>
                <span data-status={checkpoint.status} aria-hidden="true" />
                <div>
                  <strong>{STAGES[checkpoint.stage]}</strong>
                  <small>{new Intl.DateTimeFormat("ja-JP", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(checkpoint.createdAt))}</small>
                  <p>{checkpoint.status === "failed"
                    ? "処理に失敗しました。安全に再試行できます。"
                    : checkpoint.status === "cancelled"
                      ? "取り消しました。"
                      : checkpoint.status === "completed"
                        ? "完了しました。"
                        : checkpoint.status === "handoff"
                          ? "担当サービスの処理を待っています。"
                          : checkpoint.status === "paused"
                            ? "一時停止しています。"
                            : "この段階を開始しました。"}</p>
                </div>
              </li>)}
            </ol>
          </details> : null}
          <div className={styles.actions}>
            {approval ? <><button type="button" disabled={busy} onClick={() => decide(run, approval.kind, "granted")}><ShieldCheck />内容を確認して承認</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => decide(run, approval.kind, "denied")}>拒否</button></>
              : !terminal && run.state !== "handoff_required" ? <button type="button" disabled={busy} onClick={() => transition(run, "advance")}><ChevronRight />{retryable ? "安全に再試行" : run.state === "paused" ? "再開する" : "次へ進む"}</button> : null}
            {!terminal ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => transition(run, "cancel")}><X />取り消す</button> : null}
            {run.state === "handoff_required" ? <a href={
              run.currentStage === "discovery"
                ? `/v2/ai?intent=${encodeURIComponent(run.id)}`
                : `/v2/intent/${encodeURIComponent(run.id)}/fulfill`
            }>{run.currentStage === "discovery" ? "AIで調査・比較する" : run.commercePreview?.kind === "ai" ? "AIで実行を続ける" : "Commerceで履行を続ける"}</a> : null}
          </div>
        </article>;
      })}
      {!runs.length && !notice ? <p className={styles.empty}>保存されたIntent作業はありません。</p> : null}
    </div>
  </section>;
}
