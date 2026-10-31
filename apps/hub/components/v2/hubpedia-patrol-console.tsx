"use client";

import React, { useId, useState } from "react";

import { apiErrorMessage, authorKindLabel } from "@/lib/hubpedia-wiki-ui";

export type PatrolItem = {
  id: string;
  slug: string;
  title: string;
  editSummary: string | null;
  createdAt: string;
  riskLevel?: string | null;
  reviewLane?: string | null;
  aiReviewStatus?: string | null;
  conflictStatus?: string | null;
  submitterHandle?: string | null;
  claimKind?: string | null;
  claimStatement?: string | null;
  sensitiveCategory?: string | null;
};
export type PatrolRecent = { id: string; slug: string; title: string; revisionNumber: number; authorKind: string; editSummary: string | null };

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
    return response.ok ? { ok: true, message: "完了しました。" } : { ok: false, message: apiErrorMessage(data.code, data.error) };
  } catch {
    return { ok: false, message: "通信できませんでした。" };
  }
}

function Result({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return <p role={result.ok ? "status" : "alert"} className={result.ok ? "v2-note" : "v2-error"}>{result.message}</p>;
}

function QueueRow({ item, onDone }: { item: PatrolItem; onDone: (id: string) => void }) {
  const uid = useId();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const outcome = await call("POST", `/api/hubpedia/proposals/${encodeURIComponent(item.id)}/review`, { decision, note: note.trim() || undefined });
    setResult(outcome);
    setBusy(false);
    if (outcome.ok) onDone(item.id);
  }
  return (
    <li className="hubpedia-wiki__card">
      <h3>{item.title}</h3>
      <p className="v2-note">
        <a href={`/v2/hubpedia/${encodeURIComponent(item.slug)}`}>{item.slug}</a> ・ @{item.submitterHandle ?? "不明"} ・ {item.createdAt.slice(0, 10)}
        {item.riskLevel ? ` ・ リスク ${item.riskLevel}` : ""}{item.sensitiveCategory ? " ・ 人の確認が必要な分野" : ""}{item.conflictStatus && item.conflictStatus !== "none" ? " ・ 衝突あり" : ""}
      </p>
      <p>{item.editSummary}</p>
      {item.claimKind ? <p className="v2-note">主張の編集 ({item.claimKind}){item.claimStatement ? `: ${item.claimStatement}` : ""}</p> : null}
      <div className="hubpedia-wiki__form">
        <label htmlFor={`${uid}-note`}>判断のメモ（省略可）</label>
        <input id={`${uid}-note`} type="text" value={note} onChange={(event) => setNote(event.target.value)} />
        <div className="hubpedia-wiki__actions">
          <button type="button" className="v2-button v2-button--primary" disabled={busy} onClick={() => void decide("approve")}>承認する</button>
          <button type="button" className="v2-button" disabled={busy} onClick={() => void decide("reject")}>却下する</button>
        </div>
      </div>
      <Result result={result} />
    </li>
  );
}

function ReasonForm({ title, fields, submitLabel, onSubmit }: {
  title: string;
  fields: Array<{ name: string; label: string; type?: "text" | "number" | "datetime-local"; optional?: boolean }>;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<{ ok: boolean; message: string }>;
}) {
  const uid = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const missing = fields.find((field) => !field.optional && !(values[field.name] ?? "").trim());
    if (missing) {
      setResult({ ok: false, message: `${missing.label}を入力してください。` });
      return;
    }
    setBusy(true);
    setResult(await onSubmit(values));
    setBusy(false);
  }
  return (
    <form className="hubpedia-wiki__card hubpedia-wiki__form" onSubmit={submit} aria-label={title} noValidate>
      <h3>{title}</h3>
      {fields.map((field) => (
        <React.Fragment key={field.name}>
          <label htmlFor={`${uid}-${field.name}`}>{field.label}</label>
          <input id={`${uid}-${field.name}`} type={field.type ?? "text"} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} />
        </React.Fragment>
      ))}
      <button type="submit" className="v2-button" disabled={busy}>{submitLabel}</button>
      <Result result={result} />
    </form>
  );
}

export function HubpediaPatrolConsole({ role, initialItems, nextCursor, recent }: { role: "patrol" | "operator"; initialItems: PatrolItem[]; nextCursor: string | null; recent: PatrolRecent[] }) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(nextCursor);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function more() {
    if (!cursor) return;
    try {
      const response = await fetch(`/api/hubpedia/patrol/queue?cursor=${encodeURIComponent(cursor)}`);
      if (!response.ok) throw new Error("load");
      const data = (await response.json()) as { items: PatrolItem[]; nextCursor: string | null };
      setItems((current) => [...current, ...data.items]);
      setCursor(data.nextCursor);
    } catch {
      setLoadError("続きを取得できませんでした。");
    }
  }

  return (
    <div className="hubpedia-wiki__patrol">
      <section aria-labelledby="patrol-queue">
        <h2 id="patrol-queue" className="v2-column__title v2-column__title--section">審査待ちの提案</h2>
        {items.length ? (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {items.map((item) => <QueueRow key={item.id} item={item} onDone={(id) => setItems((current) => current.filter((entry) => entry.id !== id))} />)}
          </ul>
        ) : (
          <p className="v2-note">審査待ちの提案はありません。</p>
        )}
        {loadError ? <p role="alert" className="v2-error">{loadError}</p> : null}
        {cursor ? <button type="button" className="v2-button" onClick={() => void more()}>さらに読み込む</button> : null}
      </section>

      <section aria-labelledby="patrol-actions">
        <h2 id="patrol-actions" className="v2-column__title v2-column__title--section">差し戻し・保護・一時停止</h2>
        <section className="hubpedia-wiki__card" aria-label="差し戻す版を選ぶ">
          <h3>最近の版を差し戻す</h3>
          {recent.length ? (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {recent.map((entry) => <RecentRevert key={entry.id} entry={entry} />)}
            </ul>
          ) : <p className="v2-note">最近の変更はありません。</p>}
        </section>
        <ReasonForm
          title="記事を保護する・外す"
          submitLabel="保護を更新"
          fields={[
            { name: "slug", label: "記事のslug" },
            { name: "until", label: "保護の期限（空欄で保護を外す）", type: "datetime-local", optional: true },
            { name: "reason", label: "理由" },
          ]}
          onSubmit={(values) =>
            call("POST", `/api/hubpedia/articles/${encodeURIComponent(values.slug.trim())}/protection`, {
              until: values.until ? new Date(values.until).toISOString() : null,
              reason: values.reason.trim(),
            })
          }
        />
        <ReasonForm
          title="編集者を一時停止する"
          submitLabel="停止する"
          fields={[
            { name: "profileId", label: "プロフィールID" },
            { name: "hours", label: "停止の時間（1から720）", type: "number" },
            { name: "reason", label: "理由" },
          ]}
          onSubmit={(values) => call("POST", "/api/hubpedia/patrol/suspensions", { profileId: values.profileId.trim(), hours: Number(values.hours), reason: values.reason.trim() })}
        />
        <ReasonForm
          title="一時停止を解く"
          submitLabel="解く"
          fields={[{ name: "profileId", label: "プロフィールID" }, { name: "reason", label: "理由" }]}
          onSubmit={(values) => call("DELETE", "/api/hubpedia/patrol/suspensions", { profileId: values.profileId.trim(), reason: values.reason.trim() })}
        />
      </section>

      {role === "operator" ? (
        <section aria-labelledby="patrol-appoint">
          <h2 id="patrol-appoint" className="v2-column__title v2-column__title--section">見回り役の任命</h2>
          <ReasonForm title="見回り役に任命する" submitLabel="任命" fields={[{ name: "profileId", label: "プロフィールID" }]} onSubmit={(values) => call("POST", "/api/hubpedia/patrol/appointments", { profileId: values.profileId.trim() })} />
          <ReasonForm title="見回り役を外す" submitLabel="外す" fields={[{ name: "profileId", label: "プロフィールID" }]} onSubmit={(values) => call("DELETE", "/api/hubpedia/patrol/appointments", { profileId: values.profileId.trim() })} />
        </section>
      ) : null}
    </div>
  );
}

function RecentRevert({ entry }: { entry: PatrolRecent }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  async function revert(event: React.FormEvent) {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setResult({ ok: false, message: "理由を3文字以上で書いてください。" });
      return;
    }
    setResult(await call("POST", `/api/hubpedia/articles/${encodeURIComponent(entry.slug)}/revert`, { revisionId: entry.id, reason: reason.trim() }));
  }
  return (
    <li className="hubpedia-wiki__claim">
      <p>{entry.title} #{entry.revisionNumber} ・ {authorKindLabel(entry.authorKind)} ・ {entry.editSummary ?? ""}</p>
      <button type="button" className="v2-button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>この版へ戻す</button>
      {open ? (
        <form className="hubpedia-wiki__form" onSubmit={revert} noValidate>
          <label htmlFor={`${uid}-reason`}>理由</label>
          <input id={`${uid}-reason`} type="text" value={reason} onChange={(event) => setReason(event.target.value)} />
          <button type="submit" className="v2-button">差し戻す</button>
        </form>
      ) : null}
      <Result result={result} />
    </li>
  );
}
