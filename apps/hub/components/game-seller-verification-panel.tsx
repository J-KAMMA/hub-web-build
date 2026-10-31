"use client";

import { useState } from "react";
import Link from "next/link";

import { commerceApiUrl } from "@/lib/commerce-client";

/*
 * 実行ファイルの配布に必要な販売者確認（2026-10-29）。Commerce の販売者確認を済ませた人だけがビルドを公開できる。
 * 流れ：Hub が一度きりの問いかけを出す → ブラウザが Commerce へ直接送る → 返ってきた署名つきの証明だけを Hub へ渡す。
 * Hub は確認した時刻と期限だけを覚え、Commerce の販売者ID・氏名・住所・本人確認の中身は受け取らない。
 */

const ERRORS: Record<string, string> = {
  seller_unauthorized: "Commerce で販売者確認が済んでいないか、Commerce にログインしていません。先に販売者確認を済ませてください。",
  untrusted_origin: "この画面からは Commerce に確認を頼めません。",
  game_seller_verification_unavailable: "確認の証明を今は発行できません。少し待ってからやり直してください。",
  seller_verification_unavailable: "Hub が確認の証明を検証できる状態ではありません。少し待ってからやり直してください。",
  invalid_seller_proof: "確認の証明を受け付けられませんでした。もう一度やり直してください。",
  invalid_seller_challenge: "確認の手続きの有効時間（5分）が過ぎました。もう一度やり直してください。",
  seller_proof_replayed: "この確認はすでに使われています。もう一度やり直してください。",
  login_required: "ログインしてください。",
};

async function errorCode(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function dayOf(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export function GameSellerVerificationPanel({ initialVerified, initialExpiresAt }: { initialVerified: boolean; initialExpiresAt: string | null }) {
  const [verified, setVerified] = useState(initialVerified);
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function importVerification() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const challengeResponse = await fetch("/api/games/seller-verification/challenge", { method: "POST", cache: "no-store" });
      if (!challengeResponse.ok) throw new Error(await errorCode(challengeResponse, "login_required"));
      const { challenge } = await challengeResponse.json() as { challenge: string };
      const proofResponse = await fetch(commerceApiUrl("/seller/hub-game-verification"), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge }),
      });
      if (!proofResponse.ok) throw new Error(await errorCode(proofResponse, "seller_unauthorized"));
      const { proof } = await proofResponse.json() as { proof: string };
      const redeemed = await fetch("/api/games/seller-verification", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof }),
      });
      if (!redeemed.ok) throw new Error(await errorCode(redeemed, "invalid_seller_proof"));
      const status = await redeemed.json() as { expiresAt: string | null };
      setVerified(true);
      setExpiresAt(status.expiresAt);
      setMessage("販売者確認を取り込みました。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(ERRORS[code] ?? "確認を取り込めませんでした。時間をおいてやり直してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="販売者確認" data-seller-verified={verified ? "true" : "false"}>
      {verified ? (
        <p role="status">販売者確認は済んでいます（{dayOf(expiresAt)} まで）。実行ファイルのビルドを公開できます。期限が切れたら、もう一度取り込みます。</p>
      ) : (
        <>
          <p role="note">
            実行ファイル（exe など）の配布には、Commerce の販売者確認が必要です。Hub が受け取るのは「確認済み」という事実と時刻だけで、氏名・住所・本人確認の書類は受け取りません。
          </p>
          <p>
            <Link href="/v2/market/products/sell">販売者確認を済ませる</Link>
            {" "}
            <button type="button" onClick={() => void importVerification()} disabled={busy}>確認を取り込む</button>
          </p>
        </>
      )}
      {verified ? (
        <p>
          <button type="button" onClick={() => void importVerification()} disabled={busy}>確認を取り込み直す</button>
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
