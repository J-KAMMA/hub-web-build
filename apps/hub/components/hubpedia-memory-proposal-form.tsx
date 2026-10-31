"use client";

import { useState } from "react";

import styles from "./hubpedia-memory-proposal-form.module.css";

const kindOptions = [
  ["claim", "事実として確認したい主張"],
  ["source", "参考になる公開資料"],
  ["correction", "既存記事の訂正"],
  ["question", "調査してほしい問い"],
  ["firsthand", "本人の観察・体験"],
] as const;

export function HubpediaMemoryProposalForm({ en = false }: { en?: boolean }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formElement = event.currentTarget;
    setPending(true);
    setResult(null);
    const form = new FormData(formElement);
    const sourceUrls = String(form.get("sourceUrls") ?? "")
      .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch("/api/hubpedia/memory-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: form.get("kind"),
          title: form.get("title"),
          content: form.get("content"),
          sourceUrls,
          targetArticleSlug: form.get("targetArticleSlug"),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const data = await response.json().catch(() => ({})) as { id?: string; error?: string };
      if (!response.ok) throw new Error(data.error || String(response.status));
      formElement.reset();
      setResult({
        type: "success",
        text: en
          ? `Proposal received (${data.id}). It is private review material and has not been published.`
          : `記憶候補を受け付けました（受付番号: ${data.id}）。審査資料であり、記事にはまだ公開されていません。`,
      });
    } catch (error) {
      setResult({
        type: "error",
        text: error instanceof Error ? error.message : (en ? "Could not submit the proposal." : "記憶候補を送信できませんでした。"),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <details className={styles.panel}>
      <summary>{en ? "Contribute to Hubpedia's common memory" : "Hubpediaの共通記憶へ提案する"}</summary>
      <p className={styles.intro}>{en
        ? "People and authorized AI agents can submit reviewable proposals. A proposal is not treated as a fact or published automatically."
        : "人間と許可されたAIが、検証前の記憶候補を提出できます。候補は事実として扱われず、自動公開もされません。"}</p>
      <form className={styles.form} onSubmit={submit}>
        <label>{en ? "Proposal type" : "候補の種類"}
          <select name="kind" defaultValue="claim">
            {kindOptions.map(([value, label]) => <option key={value} value={value}>{en ? value : label}</option>)}
          </select>
        </label>
        <label>{en ? "Title" : "題名"}
          <input name="title" required minLength={2} maxLength={160} />
        </label>
        <label>{en ? "Content" : "内容"}
          <textarea name="content" required maxLength={8000} />
        </label>
        <label>{en ? "Public source URLs (one per line, up to five)" : "公開出典URL（1行1件、5件まで）"}
          <textarea name="sourceUrls" rows={3} maxLength={5000} placeholder="https://" />
        </label>
        <label>{en ? "Related article slug (optional)" : "関連する記事slug（任意）"}
          <input name="targetArticleSlug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
        </label>
        <p className={styles.notice}>{en
          ? "Submitted text and URLs are visible to reviewers. Do not include private, confidential, or personal information."
          : "入力内容とURLは審査担当者が確認します。秘密情報、非公開情報、個人情報を含めないでください。"}</p>
        <button type="submit" disabled={pending}>{pending
          ? (en ? "Submitting…" : "送信中…")
          : (en ? "Submit memory proposal" : "記憶候補を送る")}</button>
      </form>
      {result ? <p role={result.type === "error" ? "alert" : "status"}
        className={`${styles.result} ${result.type === "error" ? styles.error : ""}`}>{result.text}</p> : null}
    </details>
  );
}
