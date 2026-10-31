"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";

import {
  ACTION_LABEL,
  IMMEDIATE_REASONS,
  IMMEDIATE_REASON_LABEL,
  QUEUE_FILTERS,
  ROLE_LABEL,
  STATE_LABEL,
  TARGET_KIND_LABEL,
  deadlineCountdown,
  deadlineLines,
  formatJst,
  moderatorActions,
  stateTone,
  validateModeratorInput,
  type ModeratorAction,
  type QueueFilter,
} from "@/lib/copyright-case-ui";
import type { ModeratorCaseView, QueueItem } from "@/lib/server/copyright-case-views";
import styles from "./copyright-moderation.module.css";

const TONE_CLASS = { neutral: "", warning: styles.chipWarning, danger: styles.chipDanger, positive: styles.chipPositive } as const;

function StateChip({ state }: { state: keyof typeof STATE_LABEL }) {
  return <span className={`${styles.chip} ${TONE_CLASS[stateTone(state)]}`}>{STATE_LABEL[state]}</span>;
}

function AccessRequired() {
  return (
    <div className={styles.shell}>
      <p className={styles.muted}>運営としてログインしていません。</p>
      <p><Link className={styles.link} href="/admin/moderation">運営の画面でログインする</Link></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 列
// ---------------------------------------------------------------------------

export function CopyrightQueue({ authenticated, initialFilter = "received" }: { authenticated: boolean; initialFilter?: QueueFilter }) {
  const [filter, setFilter] = useState<QueueFilter>(initialFilter);
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [now, setNow] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setItems(null);
    try {
      const response = await fetch(`/api/admin/moderation/copyright/queue?filter=${filter}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { items?: QueueItem[]; now?: string; error?: string };
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "運営としてログインしていません。" : "一覧を取得できませんでした。");
      setItems(payload.items ?? []);
      setNow(payload.now ?? new Date().toISOString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "一覧を取得できませんでした。");
      setItems([]);
    }
  }, [filter]);

  useEffect(() => { if (authenticated) void load(); }, [authenticated, load]);

  if (!authenticated) return <AccessRequired />;
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>運営</span>
          <h1>著作権の申告</h1>
          <p>締切の早い順に並べています。</p>
        </div>
        <Link className={styles.link} href="/admin/moderation">通報の一覧へ戻る</Link>
      </header>
      <div className={styles.filters} role="group" aria-label="状態で絞る">
        {QUEUE_FILTERS.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>{entry.label}</button>
        ))}
      </div>
      {error ? <p role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>{error}</p> : null}
      {items === null ? <p className={styles.muted}>読み込んでいます。</p> : null}
      {items && items.length === 0 && !error ? <p className={styles.empty}>この状態の申告はありません。</p> : null}
      {items && items.length > 0 ? (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Link className={styles.row} href={`/admin/moderation/copyright/${item.id}`}>
                <div>
                  <p className={styles.rowTitle}>{item.claimant}</p>
                  <p className={styles.rowMeta}>
                    {item.caseNumber} / {TARGET_KIND_LABEL[item.targetKind] ?? item.targetKind}
                    {item.service !== "hub" ? ` / ${item.service === "music" ? "Music" : "Vault"}` : ""}
                    {item.route === "immediate" ? " / 即時の申出" : ""}
                  </p>
                </div>
                <div className={styles.rowSide}>
                  <StateChip state={item.state} />
                  {item.needsDecisionAt ? <span>7日経過・判断待ち</span> : null}
                  {item.state === "hidden" && item.objectionOpen ? <span>異議あり</span> : null}
                  {item.deadline && item.state === "inquiry" ? <span>{formatJst(item.deadline)}まで（{deadlineCountdown(item.deadline, now)}）</span> : null}
                  {item.pendingAction ? <span>Rights Desk へ反映待ち</span> : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1件の画面
// ---------------------------------------------------------------------------

type StepStatus = "pending" | "ok" | "failed";
type Step = { key: "sign" | "send" | "sync"; label: string; status: StepStatus; detail?: string };
type ExternalInput = { action: ModeratorAction; note: string; immediateReason: string; clearly: boolean };

const STEP_ICON: Record<StepStatus, string> = { pending: "…", ok: "済", failed: "失敗" };

export function CopyrightCaseDetail({ rowId, authenticated }: { rowId: string; authenticated: boolean }) {
  const [data, setData] = useState<{ case: ModeratorCaseView; viewerIsParty: boolean; now: string } | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ModeratorAction | null>(null);
  const [note, setNote] = useState("");
  const [immediateReason, setImmediateReason] = useState("");
  const [clearly, setClearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [lastExternal, setLastExternal] = useState<ExternalInput | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/moderation/copyright/cases/${encodeURIComponent(rowId)}`, { cache: "no-store" });
      if (response.status === 404) throw new Error("申告が見つかりません。");
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "運営としてログインしていません。" : "取得できませんでした。");
      setData(await response.json());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "取得できませんでした。");
    }
  }, [rowId]);

  useEffect(() => { if (authenticated) void load(); }, [authenticated, load]);

  function resetForm() {
    setSelected(null);
    setNote("");
    setImmediateReason("");
    setClearly(false);
    setFormError("");
  }

  async function postJson(url: string, body: unknown, method = "POST") {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, payload };
  }

  async function runHub(action: ModeratorAction, input: { note: string; immediateReason: string; clearly: boolean }) {
    const { response, payload } = await postJson(`/api/admin/moderation/unified/copyright/${encodeURIComponent(rowId)}`, {
      action: action.hubAction,
      note: input.note.trim(),
      immediateReason: action.immediateReason ? input.immediateReason : undefined,
      clearlyInfringing: action.clearlyCheckbox ? input.clearly : undefined,
    }, "PATCH");
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "処理できませんでした。");
    setMessage("操作を反映しました。");
  }

  /** 反映の確認。Hub のサーバーが Rights Desk に聞いた答えだけを Hub の表に写す。 */
  async function syncOnly(existing: Step[] = []) {
    const base = existing.filter((s) => s.key !== "sync");
    setSteps([...base, { key: "sync", label: "反映を確かめる", status: "pending" }]);
    const { response, payload } = await postJson("/api/admin/moderation/copyright/sync", { targetRowId: rowId });
    const state = typeof payload.state === "string" ? payload.state : null;
    const ok = response.ok && payload.ok === true;
    setSteps([...base, {
      key: "sync", label: "反映を確かめる", status: ok ? "ok" : "failed",
      detail: ok ? (state ? `現在の状態：${STATE_LABEL[state as keyof typeof STATE_LABEL] ?? state}` : undefined) : `Rights Desk の答えを確かめられませんでした（${response.status}）。あとでもう一度確かめてください。`,
    }]);
    await load();
    return ok;
  }

  async function runExternal(input: ExternalInput) {
    setLastExternal(input);
    const action = input.action;
    setSteps([{ key: "sign", label: "Hub が判断に署名する", status: "pending" }]);
    const minted = await postJson("/api/admin/moderation/copyright/decision", {
      targetRowId: rowId,
      action: action.externalAction,
      route: action.externalRoute,
      immediateReason: action.immediateReason ? input.immediateReason : undefined,
      clearlyInfringing: action.clearlyCheckbox ? input.clearly : undefined,
      note: input.note.trim(),
      outcome: action.externalOutcome,
    });
    if (!minted.response.ok || typeof minted.payload.token !== "string" || typeof minted.payload.path !== "string") {
      const text = typeof minted.payload.message === "string" ? minted.payload.message : typeof minted.payload.error === "string" ? minted.payload.error : "署名できませんでした。";
      setSteps([{ key: "sign", label: "Hub が判断に署名する", status: "failed", detail: text }]);
      return;
    }
    const signed: Step = { key: "sign", label: "Hub が判断に署名する", status: "ok" };
    setSteps([signed, { key: "send", label: "ブラウザから Rights Desk へ送る", status: "pending" }]);
    let sent: Step;
    try {
      // 判断はブラウザが Rights Desk へ直接送る。Hub のサーバーは中継しない。
      const delivered = await fetch(minted.payload.path, { method: "POST", headers: { Authorization: `Bearer ${minted.payload.token}` } });
      sent = delivered.ok
        ? { key: "send", label: "ブラウザから Rights Desk へ送る", status: "ok" }
        : { key: "send", label: "ブラウザから Rights Desk へ送る", status: "failed", detail: `Rights Desk が受け付けませんでした（${delivered.status}）。` };
    } catch {
      sent = { key: "send", label: "ブラウザから Rights Desk へ送る", status: "failed", detail: "Rights Desk に届きませんでした。" };
    }
    setSteps([signed, sent]);
    // 送れなかったときも、反映の確認は試せる（Hub 側の再送が先に届いていることがある）。
    await syncOnly([signed, sent]);
  }

  async function submit() {
    if (!selected || !data) return;
    const invalid = validateModeratorInput(selected, { note, immediateReason });
    if (invalid) { setFormError(invalid); return; }
    setFormError("");
    setBusy(true);
    setMessage("");
    try {
      const input = { action: selected, note, immediateReason, clearly };
      if (data.case.service === "hub") await runHub(selected, input);
      else await runExternal(input);
      resetForm();
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "処理できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) return <AccessRequired />;
  if (error && !data) {
    return (
      <div className={styles.shell}>
        <p role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>{error}</p>
        <p><Link className={styles.link} href="/admin/moderation/copyright">著作権の列へ戻る</Link></p>
      </div>
    );
  }
  if (!data) return <div className={styles.shell}><p className={styles.muted}>読み込んでいます。</p></div>;

  const c = data.case;
  const { actions, waiting } = moderatorActions({ service: c.service, state: c.state, objectionOpen: c.objectionOpen, needsDecisionAt: c.needsDecisionAt });
  const lines = deadlineLines({ state: c.state, deadline: c.deadline, hiddenAt: c.hiddenAt, objectionOpen: c.objectionOpen, clearlyInfringing: c.clearlyInfringing, needsDecisionAt: c.needsDecisionAt });
  const external = c.service !== "hub";
  const lastFailed = steps.some((s) => s.status === "failed");

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{c.caseNumber}</span>
          <h1>{c.claimant}</h1>
          <p>{TARGET_KIND_LABEL[c.targetKind] ?? c.targetKind}{external ? `（${c.service === "music" ? "Music" : "Vault"}）` : ""}への申告</p>
        </div>
        <Link className={styles.link} href="/admin/moderation/copyright">著作権の列へ戻る</Link>
      </header>

      {data.viewerIsParty ? (
        <p role="status" className={`${styles.banner} ${styles.bannerWarning}`}>あなたはこの事件の当事者（投稿者または申告者）です。この事件には運営として操作できません。</p>
      ) : null}
      {message ? <p role="status" className={`${styles.banner} ${styles.bannerPositive}`}>{message}</p> : null}

      <div className={styles.grid}>
        <div>
          <section className={styles.card} aria-labelledby="notice-heading">
            <h2 id="notice-heading">申告の内容</h2>
            <dl className={styles.dl}>
              <dt>申告者</dt><dd>{c.claimant}</dd>
              <dt>対象</dt><dd>{TARGET_KIND_LABEL[c.targetKind] ?? c.targetKind}：{c.targetId}</dd>
              <dt>受付</dt><dd>{formatJst(c.createdAt)}</dd>
              {c.route === "immediate" ? <><dt>即時の申出</dt><dd>{c.immediateReason ? IMMEDIATE_REASON_LABEL[c.immediateReason as keyof typeof IMMEDIATE_REASON_LABEL] ?? c.immediateReason : "あり"}</dd></> : null}
            </dl>
            <p className={styles.muted} style={{ marginTop: 14 }}>作品の説明</p>
            <p className={styles.notice}>{c.workDescription}</p>
            <p className={styles.muted} style={{ marginTop: 14 }}>権利の根拠</p>
            <p className={styles.notice}>{c.claimBasis}</p>
            {c.siblings.length > 0 ? (
              <p className={styles.help} style={{ marginTop: 14 }}>同じ申告の別の対象：{c.siblings.map((s) => `${TARGET_KIND_LABEL[s.targetKind] ?? s.targetKind}（${STATE_LABEL[s.state]}）`).join("、")}</p>
            ) : null}
          </section>

          {c.responses.length > 0 ? (
            <section className={styles.card} aria-labelledby="responses-heading">
              <h2 id="responses-heading">投稿者の回答</h2>
              {c.responses.map((r) => (
                <div key={r.kind}>
                  <p className={styles.muted}>{r.kind === "agree" ? "措置に同意" : r.kind === "disagree" ? "同意しない旨の回答" : "非公開への異議"}（{formatJst(r.createdAt)}）</p>
                  {r.body ? <p className={styles.notice}>{r.body}</p> : null}
                </div>
              ))}
            </section>
          ) : null}

          <section className={styles.card} aria-labelledby="timeline-heading">
            <h2 id="timeline-heading">経過</h2>
            {c.timeline.length === 0 ? <p className={styles.muted}>まだ記録はありません。</p> : (
              <ol className={styles.timeline}>
                {c.timeline.map((e, i) => (
                  <li key={`${e.createdAt}-${i}`}>
                    <time dateTime={e.createdAt}>{formatJst(e.createdAt)}</time>
                    {ROLE_LABEL[e.role] ?? e.role}：{ACTION_LABEL[e.action] ?? e.action}
                    {e.toState && e.toState !== e.fromState ? `（${STATE_LABEL[e.toState as keyof typeof STATE_LABEL] ?? e.toState}）` : ""}
                    {e.reason ? <span className={styles.reason}>　{e.reason}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div>
          <section className={styles.card} aria-labelledby="state-heading">
            <h2 id="state-heading">いまの状態</h2>
            <p><StateChip state={c.state} /></p>
            {c.clearlyInfringing && c.state === "inquiry" ? <p className={styles.help}>「明らかな侵害」の印あり。回答がなければ7日後に自動で非公開にします。</p> : null}
            {lines.length > 0 ? (
              <dl className={styles.dl} style={{ marginTop: 10 }}>
                {lines.map((line) => (
                  <Fragment key={line.label}><dt>{formatJst(line.at)}</dt><dd>{line.label}（{deadlineCountdown(line.at, data.now)}）</dd></Fragment>
                ))}
              </dl>
            ) : null}
            {c.pendingAction ? (
              <p role="status" className={`${styles.banner} ${styles.bannerWarning}`} style={{ marginTop: 12, marginBottom: 0 }}>
                Rights Desk への反映を確かめられていません。確かめるか、もう一度送ってください。
              </p>
            ) : null}
          </section>

          <section className={styles.card} aria-labelledby="actions-heading">
            <h2 id="actions-heading">運営の操作</h2>
            {data.viewerIsParty ? <p className={styles.help}>当事者のため、操作できません。</p> : (
              <>
                {waiting ? <p className={styles.help}>{waiting}</p> : null}
                <div className={styles.actions}>
                  {actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`${styles.actionButton} ${action.tone === "primary" ? styles.actionPrimary : action.tone === "danger" ? styles.actionDanger : ""}`}
                      aria-pressed={selected?.id === action.id}
                      disabled={busy}
                      onClick={() => { setSelected(action); setFormError(""); setMessage(""); }}
                    >{action.label}</button>
                  ))}
                </div>
                {selected ? (
                  <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-label={selected.label}>
                    <p className={styles.help}>{selected.help}</p>
                    {external ? <p className={styles.help}>この対象は {c.service === "music" ? "Music" : "Vault"} のものです。Hub が判断に署名し、このブラウザから Rights Desk へ送ります。</p> : null}
                    {selected.immediateReason ? (
                      <label>
                        理由の種類
                        <select className={styles.field} value={immediateReason} onChange={(event) => setImmediateReason(event.target.value)}>
                          <option value="">選んでください</option>
                          {IMMEDIATE_REASONS.map((reason) => <option key={reason} value={reason}>{IMMEDIATE_REASON_LABEL[reason]}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {selected.clearlyCheckbox ? (
                      <label className={styles.check}>
                        <input type="checkbox" checked={clearly} onChange={(event) => setClearly(event.target.checked)} />
                        <span>明らかな侵害（回答がなければ7日後に自動で非公開にする）</span>
                      </label>
                    ) : null}
                    <label>
                      判断理由（5文字以上）
                      <textarea className={styles.field} rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
                    </label>
                    {formError ? <p role="alert" className={`${styles.banner} ${styles.bannerDanger}`} style={{ marginBottom: 0 }}>{formError}</p> : null}
                    <div className={styles.formButtons}>
                      <button type="submit" className={`${styles.actionButton} ${styles.actionPrimary}`} disabled={busy}>{busy ? "処理しています" : "実行する"}</button>
                      <button type="button" className={styles.secondary} disabled={busy} onClick={resetForm}>やめる</button>
                    </div>
                  </form>
                ) : null}
              </>
            )}

            {external && steps.length > 0 ? (
              <div className={styles.form}>
                <p className={styles.help}>Rights Desk への送信</p>
                <ul className={styles.steps} aria-live="polite">
                  {steps.map((step) => (
                    <li key={step.key}><strong>{STEP_ICON[step.status]}</strong><span>{step.label}{step.detail ? `：${step.detail}` : ""}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {external && !data.viewerIsParty && (c.pendingAction || lastFailed) ? (
              <div className={styles.formButtons} style={{ marginTop: 12 }}>
                <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setBusy(true); void syncOnly(steps).finally(() => setBusy(false)); }}>反映を確かめる</button>
                {lastExternal ? (
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => { setBusy(true); void runExternal(lastExternal).finally(() => setBusy(false)); }}>もう一度送る</button>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
