"use client";

import { useState } from "react";

import { Button } from "@/components/v2/ui/button";

import styles from "./market-ticket-system.module.css";

export function MarketTicketCheckin({ challengeId, nonce }: { challengeId: string; nonce: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function checkin() {
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/market/tickets/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "redeem", challengeId, nonce }),
      });
      const result = await response.json() as { error?: string; checkin?: { status: string } };
      if (!response.ok || !result.checkin) throw new Error(result.error);
      setStatus("入場確認が完了しました。係員へこの画面を提示してください。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "入場を確認できませんでした。");
    } finally { setBusy(false); }
  }
  return <section className={styles.checkin}>
    <span>TOUCH CHECK-IN</span>
    <h1>チケットを確認</h1>
    <p>ログイン中のプロフィールに発行された譲渡不能トークンを確認します。</p>
    <Button variant="primary" disabled={busy || status.startsWith("入場確認")} onClick={() => void checkin()} label={busy ? "確認中…" : "入場する"} />
    {status ? <strong role="status">{status}</strong> : null}
  </section>;
}
