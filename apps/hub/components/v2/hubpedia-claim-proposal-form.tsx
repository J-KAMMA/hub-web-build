"use client";

import React, { useId, useState } from "react";

import {
  apiErrorMessage,
  buildClaimProposalBody,
  claimProposalKindLabels,
  validateClaimProposal,
  type ClaimProposalDraft,
  type ClaimProposalKind,
} from "@/lib/hubpedia-wiki-ui";

const KINDS: ClaimProposalKind[] = ["modify_claim", "add_evidence", "add_refuting_evidence"];

/* 主張に対する編集の提案。人による編集が止まっているときは、静かな注意書きだけを出す。 */
export function HubpediaClaimProposalForm({
  slug,
  claimId,
  statement,
  baseRevisionKey,
  humanEditingEnabled,
  signedIn,
}: {
  slug: string;
  claimId: string;
  statement: string;
  baseRevisionKey: string;
  humanEditingEnabled: boolean;
  signedIn: boolean;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<ClaimProposalDraft>({ kind: "modify_claim", editSummary: "", statement, evidenceUrl: "", evidenceQuote: "" });
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!humanEditingEnabled) {
    return <p className="v2-note">いまは人による編集の提案を受け付けていません。再開したらここから提案できます。</p>;
  }
  if (!signedIn) {
    return <p className="v2-note">編集の提案は<a href="/v2/auth?next=/v2/hubpedia">ログイン</a>すると行えます。</p>;
  }

  const set = (patch: Partial<ClaimProposalDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const needsStatement = draft.kind === "modify_claim";
  const needsEvidence = draft.kind !== "modify_claim";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateClaimProposal(draft, statement);
    if (problem) {
      setMessage({ tone: "error", text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/hubpedia/articles/${encodeURIComponent(slug)}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildClaimProposalBody(draft, claimId, baseRevisionKey)),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; code?: string; status?: string };
      if (!response.ok) {
        setMessage({ tone: "error", text: apiErrorMessage(data.code, data.error) });
      } else {
        setMessage({ tone: "ok", text: data.status === "approved" ? "反映されました。" : "提案を送りました。見回り役か AI の確認を待ちます。" });
        setDraft((current) => ({ ...current, editSummary: "", evidenceUrl: "", evidenceQuote: "" }));
      }
    } catch {
      setMessage({ tone: "error", text: "通信できませんでした。もう一度お試しください。" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="hubpedia-wiki__form" onSubmit={submit} aria-label="この主張の編集を提案する" noValidate>
      <label htmlFor={`${uid}-kind`}>提案の種類</label>
      <select id={`${uid}-kind`} value={draft.kind} onChange={(event) => set({ kind: event.target.value as ClaimProposalKind })}>
        {KINDS.map((kind) => <option key={kind} value={kind}>{claimProposalKindLabels[kind]}</option>)}
      </select>
      {needsStatement ? (
        <>
          <label htmlFor={`${uid}-statement`}>直したあとの主張</label>
          <textarea id={`${uid}-statement`} rows={3} value={draft.statement} onChange={(event) => set({ statement: event.target.value })} />
        </>
      ) : null}
      {needsEvidence ? (
        <>
          <label htmlFor={`${uid}-url`}>出典のURL</label>
          <input id={`${uid}-url`} type="url" inputMode="url" value={draft.evidenceUrl} onChange={(event) => set({ evidenceUrl: event.target.value })} />
          <label htmlFor={`${uid}-quote`}>引用（200字まで・省略可）</label>
          <textarea id={`${uid}-quote`} rows={2} maxLength={200} value={draft.evidenceQuote} onChange={(event) => set({ evidenceQuote: event.target.value })} />
        </>
      ) : null}
      <label htmlFor={`${uid}-summary`}>編集の理由</label>
      <input id={`${uid}-summary`} type="text" maxLength={300} value={draft.editSummary} onChange={(event) => set({ editSummary: event.target.value })} />
      {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "v2-error" : "v2-note"}>{message.text}</p> : null}
      <button type="submit" className="v2-button v2-button--primary" disabled={busy}>{busy ? "送信中" : "提案を送る"}</button>
    </form>
  );
}
