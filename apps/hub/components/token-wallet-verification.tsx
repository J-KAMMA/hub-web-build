"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HubWalletButton } from "@/components/hub-wallet-button";
import { Button } from "@/components/v2/ui/button";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { shortWalletAddress, walletNetworkLabel } from "@/lib/hub-wallet";

type VerificationState = "idle" | "requesting" | "signing" | "reading" | "success" | "error";

export function TokenWalletVerification({ rankingId, symbol, network }: { rankingId: string; symbol: string; network: string }) {
  const router = useRouter();
  const wallet = useHubWallet();
  const [state, setState] = useState<VerificationState>("idle");
  const [message, setMessage] = useState("");
  const [linked, setLinked] = useState(false);
  const busy = state === "requesting" || state === "signing" || state === "reading";

  useEffect(() => {
    if (!wallet.address || !wallet.chainId) { setLinked(false); return; }
    let active = true;
    void fetch("/api/wallet/links", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ links?: Array<{ address: string; chainId: number }> }> : { links: [] })
      .then((payload) => { if (active) setLinked(Boolean(payload.links?.some((link) => link.chainId === wallet.chainId && link.address.toLowerCase() === wallet.address?.toLowerCase()))); })
      .catch(() => { if (active) setLinked(false); });
    return () => { active = false; };
  }, [wallet.address, wallet.chainId]);

  async function refreshBalance() {
    setMessage("");
    try {
      if (!wallet.address || !wallet.chainId) {
        const connected = await wallet.connect();
        if (!connected) return;
        setState("idle");
        setMessage("接続しました。内容を確認して、もう一度「署名して残高を更新」を押してください。");
        return;
      }
      setState("requesting");
      const challengeResponse = await fetch("/api/wallet/challenge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rankingId, address: wallet.address, chainId: wallet.chainId }) });
      const challenge = await challengeResponse.json() as { challengeId?: string; message?: string; error?: string };
      if (!challengeResponse.ok || !challenge.challengeId || !challenge.message) throw new Error(challenge.error || "所有確認を開始できませんでした。");
      setState("signing");
      const signature = await wallet.signMessage(challenge.message);
      setState("reading");
      const verificationResponse = await fetch("/api/wallet/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: challenge.challengeId, address: wallet.address, message: challenge.message, signature }) });
      const verification = await verificationResponse.json() as { amount?: string; error?: string };
      if (!verificationResponse.ok || typeof verification.amount !== "string") throw new Error(verification.error || "残高を更新できませんでした。");
      setState("success");
      setLinked(true);
      setMessage(`${verification.amount} ${symbol} を確認しました。初期設定は非公開です。プロフィール設定で公開するとランキングへ反映されます。`);
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error && error.message ? error.message : "ウォレットの所有確認に失敗しました。");
    }
  }

  async function unlinkWallet() {
    if (!wallet.address || !wallet.chainId || busy) return;
    setMessage("");
    try {
      const response = await fetch("/api/wallet/links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: wallet.address, chainId: wallet.chainId }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "連携を解除できませんでした。");
      setLinked(false);
      setState("idle");
      setMessage("ウォレット連携を解除しました。公開済み残高は次回のランキング更新まで残る場合があります。");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "連携を解除できませんでした。");
    }
  }

  return <section className="token-wallet-connect" aria-label="ウォレット所有確認">
    <div className="token-wallet-connect__copy">
      <strong>ウォレットから公開残高を更新</strong>
      <small>{wallet.address ? `${shortWalletAddress(wallet.address)} · ${walletNetworkLabel(wallet.chainId)}${linked ? " · 連携済み" : ""}` : `${network} 上の ${symbol} 保有残高を署名で確認します。`}</small>
      <small>署名はアドレスの所有確認だけに使われます。送金、支払い、トークン利用許可、ログイン権限は発生しません。</small>
      {message ? <p className={`token-wallet-connect__message is-${state}`} role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </div>
    <div className="token-wallet-connect__actions">
      <HubWalletButton />
      <Button variant="primary" disabled={busy} onClick={() => void refreshBalance()} label={state === "requesting" ? "確認を準備中…" : state === "signing" ? "署名を確認中…" : state === "reading" ? "残高を取得中…" : "署名して残高を更新"} />
      {linked ? <Button variant="secondary" className="token-wallet-connect__unlink" disabled={busy} onClick={() => void unlinkWallet()} label="連携を解除" /> : null}
    </div>
  </section>;
}
