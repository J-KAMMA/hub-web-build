"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { readApiError } from "@/components/v2/v2-access-gate-shared";

import "./v2-access-gates.css";

/* 資金の使い道の報告。ゲートしない。利回り・値動き・比較は出さない。 */

export type FundReportView = { id: string; title: string; body: string; amount: string | null; evidenceUrl: string | null; createdAt: string };

export const FUND_REPORT_LABELS = { heading: "資金の使い道", leaving: "証拠のリンクを開く（Hubの外へ移動します）" } as const;

export function V2ResearchFundReports({ projectId, reports, canEdit }: { projectId: string; reports: FundReportView[]; canEdit: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reports.length === 0 && !canEdit) return null;
  const base = `/api/research/projects/${encodeURIComponent(projectId)}/fund-reports`;

  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, init);
      if (!response.ok) {
        setError(await readApiError(response, "保存できませんでした。"));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("通信できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await send(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim(), amount: amount.trim() || undefined, evidenceUrl: link.trim() || undefined }),
    });
    if (ok) {
      setTitle("");
      setAmount("");
      setBody("");
      setLink("");
    }
  }

  return (
    <section className="v2-gate-card" aria-label={FUND_REPORT_LABELS.heading} id="fund-reports">
      <h2 className="v2-gate-card__title">{FUND_REPORT_LABELS.heading}</h2>
      {reports.length > 0 ? (
        <ul className="v2-gate__list">
          {reports.map((report) => (
            <li key={report.id} className="v2-gate__item">
              <p className="v2-gate-card__state">
                <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })}</time>
                {report.amount ? ` ・ ${report.amount}` : ""}
              </p>
              <h3 className="v2-gate-card__title">{report.title}</h3>
              <p className="v2-gate-card__description">{report.body}</p>
              {report.evidenceUrl ? (
                <p className="v2-gate-card__acquire">
                  <a href={report.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">{FUND_REPORT_LABELS.leaving}</a>
                </p>
              ) : null}
              {canEdit ? (
                <p className="v2-gate__actions"><button type="button" className="v2-gate__button v2-gate__button--danger" disabled={busy} onClick={() => void send(`${base}/${encodeURIComponent(report.id)}`, { method: "DELETE" })}>削除</button></p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form className="v2-gate__form" onSubmit={(event) => void submit(event)}>
          <label className="v2-gate__field">
            題
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required disabled={busy} />
          </label>
          <label className="v2-gate__field">
            金額（任意）
            <input value={amount} onChange={(event) => setAmount(event.target.value)} maxLength={60} placeholder="例: 120 AVAX" disabled={busy} />
          </label>
          <label className="v2-gate__field">
            内容
            <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} rows={4} required disabled={busy} />
          </label>
          <label className="v2-gate__field">
            証拠のリンク（https・任意）
            <input type="url" value={link} onChange={(event) => setLink(event.target.value)} maxLength={500} disabled={busy} />
          </label>
          <p className="v2-gate__actions"><button type="submit" className="v2-gate__button v2-gate__button--primary" disabled={busy}>報告する</button></p>
          {error ? <p className="v2-note" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
