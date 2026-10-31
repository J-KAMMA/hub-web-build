"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function TokenRankingCreateForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/token-rankings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: data.get("title"), symbol: data.get("symbol"), network: data.get("network"), contractAddress: data.get("contractAddress"), description: data.get("description") }),
        });
        const payload = await response.json() as { ranking?: { id: string }; error?: string };
        if (!response.ok || !payload.ranking) {
          setError(payload.error ?? "ランキングを作成できませんでした。");
          return;
        }
        form.reset();
        router.push(`/token?ranking=${encodeURIComponent(payload.ranking.id)}`);
        router.refresh();
      } catch {
        setError("ランキングを作成できませんでした。通信状態を確認して、もう一度お試しください。");
      }
    });
  };

  return <details className="token-ranking-create">
    <summary>公開残高ランキングを追加（コミュニティ管理者）</summary>
    <p>ウォレット残高の公開ランキングです。Hub運営への貢献記録とは別に管理されます。</p>
    <form onSubmit={submit}>
      <label>ランキング名<input name="title" maxLength={60} required placeholder="例：JPYC 公開残高ランキング" /></label>
      <div className="token-ranking-create__row">
        <label>シンボル<input name="symbol" maxLength={16} required placeholder="JPYC" /></label>
        <label>ネットワーク<input name="network" maxLength={40} required placeholder="Polygon" /></label>
      </div>
      <label>トークンコントラクト<input name="contractAddress" maxLength={128} placeholder="ネイティブトークンの場合は空欄" /></label>
      <label>説明<textarea name="description" maxLength={180} placeholder="ランキングの対象と目的" /></label>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <button type="submit" disabled={isPending}>{isPending ? "作成中…" : "ランキングを作成"}</button>
    </form>
  </details>;
}
