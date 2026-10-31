"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  ACTION_LABEL,
  OBJECTION_MAX,
  OBJECTION_MIN,
  OBJECTION_REASONS,
  ROLE_LABEL,
  STATE_LABEL,
  TARGET_KIND_LABEL,
  authorStage,
  deadlineCountdown,
  formatJst,
  stateTone,
  validateObjection,
} from "@/lib/copyright-case-ui";
import { objectionWindowEnd } from "@/lib/copyright-case-state";
import type { AuthorCaseView, AuthorTargetView } from "@/lib/server/copyright-case-views";
import styles from "./copyright-case-response.module.css";

const TONE_CLASS = { neutral: "", warning: styles.chipWarning, danger: styles.chipDanger, positive: styles.chipPositive } as const;

const CLOSED_TEXT: Record<string, string> = {
  final: "非公開にした投稿を確定して削除しました。",
  restored: "非公開を解除しました。投稿は元に戻っています。",
  kept: "投稿は公開のままです。この件はこれで終わりです。",
  rejected: "申告は受け付けられず、この件は終わりました。投稿は公開のままです。",
};

function TargetCard({ target, now, caseId }: { target: AuthorTargetView; now: string; caseId: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "object">("");
  const [reason, setReason] = useState("");
  const [text, setText] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const stage = authorStage({
    state: target.state, canRespond: target.canRespond, canObject: target.canObject,
    objectionOpen: target.objectionOpen, responded: target.responded,
  });
  const afterHide = stage === "object_after_hide";

  async function send(response: "agree" | "object") {
    setError("");
    if (response === "object") {
      const invalid = validateObjection({ reason, text, attested });
      if (invalid) { setError(invalid); return; }
    }
    setBusy(true);
    try {
      const result = await fetch(`/api/copyright/cases/${encodeURIComponent(caseId)}/response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetRowId: target.id, response, reason, text, attested }),
      });
      const payload = await result.json().catch(() => ({})) as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? "送れませんでした。");
      setDone(response === "agree" ? "措置に同意しました。投稿を非公開にしました。" : afterHide ? "異議を受け付けました。運営が判断します。" : "同意しない旨を受け付けました。運営が双方の言い分を見て判断します。");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "送れませんでした。");
    } finally {
      setBusy(false);
    }
  }

  const objectionForm = (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void send("object"); }} aria-label={afterHide ? "異議を申し立てる" : "同意しない"}>
      <label>
        理由の種類
        <select className={styles.field} value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">選んでください</option>
          {OBJECTION_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label>
        理由（{OBJECTION_MIN}字以上）
        <textarea className={styles.field} rows={5} maxLength={OBJECTION_MAX - 20} value={text} onChange={(event) => setText(event.target.value)} />
        <span className={styles.count}>{text.trim().length}字</span>
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
        <span>書いた内容は正しいと確認しました。偽りがあれば、責任を負うことがあると理解しています。</span>
      </label>
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`} disabled={busy}>{busy ? "送っています" : afterHide ? "異議を申し立てる" : "同意しない旨を送る"}</button>
    </form>
  );

  return (
    <section className={styles.card} aria-label={`${TARGET_KIND_LABEL[target.targetKind] ?? target.targetKind}への申告`}>
      <h2>{TARGET_KIND_LABEL[target.targetKind] ?? target.targetKind}</h2>
      <p>
        <span className={`${styles.chip} ${TONE_CLASS[stateTone(target.state)]}`}>{STATE_LABEL[target.state]}</span>
      </p>

      {done ? <p role="status" className={`${styles.banner} ${styles.bannerPositive}`}>{done}</p> : null}

      {stage === "closed" ? <p className={`${styles.banner} ${styles.bannerPositive}`}>{CLOSED_TEXT[target.state]}</p> : null}

      {stage === "respond" && !done ? (
        <>
          <p className={`${styles.banner} ${styles.bannerWarning}`}>
            {formatJst(target.deadline)}までにお答えください（{deadlineCountdown(target.deadline, now)}）。
            何もしなかった場合は、{target.clearlyInfringing ? "その時刻に投稿を非公開にします。" : "運営が改めて判断します。自動では非公開にしません。"}
          </p>
          <div className={styles.options}>
            <div className={styles.option}>
              <h3>措置に同意する</h3>
              <p className={styles.help}>投稿を非公開にします。非公開にした日から14日のあいだは、あとから異議を申し立てられます。</p>
              <button type="button" className={`${styles.button} ${styles.buttonDanger}`} disabled={busy} onClick={() => void send("agree")} style={{ marginTop: 10 }}>同意して非公開にする</button>
            </div>
            <div className={styles.option}>
              <h3>同意しない</h3>
              <p className={styles.help}>引用にあたる、許諾を得ている、自分の作品である、などの理由を書いてください。運営が双方の言い分を見て判断します。それまで投稿は公開のままです。</p>
              {mode === "object" ? objectionForm : (
                <button type="button" className={styles.button} onClick={() => setMode("object")} style={{ marginTop: 10 }}>理由を書く</button>
              )}
            </div>
            <div className={styles.option}>
              <h3>何もしない</h3>
              <p className={styles.help}>
                {target.clearlyInfringing
                  ? `${formatJst(target.deadline)}に、投稿を非公開にします。`
                  : "運営が内容を見て、改めて判断します。"}
              </p>
            </div>
          </div>
          {error && mode !== "object" ? <p role="alert" className={styles.error}>{error}</p> : null}
        </>
      ) : null}

      {afterHide && !done ? (
        <>
          <p className={`${styles.banner} ${styles.bannerDanger}`}>
            この投稿は著作権の申告により非公開です。{formatJst(objectionWindowEnd(target.hiddenAt ?? now), false)}までは、異議を申し立てられます。申し立てがなければ、その後に確定して削除します。
          </p>
          {objectionForm}
        </>
      ) : null}

      {stage === "waiting" && !done ? (
        <p className={`${styles.banner} ${styles.bannerWarning}`}>
          {target.state === "objected" ? "回答を受け付けました。運営が双方の言い分を見て判断します。"
            : target.state === "hidden" && target.objectionOpen ? "異議を受け付けました。運営が判断します。それまで確定は行いません。"
              : target.state === "hidden" ? "異議を申し立てられる期間を過ぎています。"
                : target.state === "inquiry" && target.responded ? "回答を受け付けました。"
                  : target.state === "inquiry" ? "回答の期限を過ぎています。運営が判断します。"
                    : "運営が確認しています。"}
        </p>
      ) : null}

      {target.timeline.length > 0 ? (
        <>
          <p className={styles.label}>経過</p>
          <ol className={styles.timeline}>
            {target.timeline.map((event, index) => (
              <li key={`${event.createdAt}-${index}`}>
                <time dateTime={event.createdAt}>{formatJst(event.createdAt)}</time>
                {ROLE_LABEL[event.role] ?? event.role}：{ACTION_LABEL[event.action] ?? event.action}
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </section>
  );
}

export function CopyrightCaseResponse({ view, now }: { view: AuthorCaseView; now: string }) {
  return (
    <div className={styles.wrap}>
      <section className={styles.card} aria-labelledby="claim-heading">
        <h2 id="claim-heading">著作権の申告</h2>
        <p className={styles.meta}>申告者：{view.claimant}（受付番号 {view.caseNumber}）</p>
        <p className={styles.label}>申告された作品</p>
        <p className={styles.claim}>{view.workDescription}</p>
        <p className={styles.label}>申告の根拠</p>
        <p className={styles.claim}>{view.claimBasis}</p>
        <p className={styles.help}>申告者の連絡先は、Hub にはありません。</p>
      </section>
      {view.targets.map((target) => <TargetCard key={target.id} target={target} now={now} caseId={view.caseId} />)}
    </div>
  );
}
