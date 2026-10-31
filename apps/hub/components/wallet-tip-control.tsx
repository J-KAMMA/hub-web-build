"use client";

import { parseEther, toHex } from "viem";
import { useEffect, useState } from "react";

import { HubWalletButton } from "@/components/hub-wallet-button";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

type Recipient = {
  enabled: boolean;
  handle: string;
  displayName: string;
  options: RecipientOption[];
};

type RecipientOption = {
  address: string;
  chainId: number;
  network: string;
  symbol: string;
  minimumAmount: string;
};

type OwnLink = {
  address: string;
  chainId: number;
  network: string;
  symbol: string;
  tipsEnabled: boolean;
  minimumAmount: string;
};

const ownLinkKey = (link: OwnLink) => `${link.chainId}:${link.address.toLowerCase()}`;

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function WalletTipControl({
  handle,
  isCurrentUser,
  articleId,
  openLabel = "投げ銭",
}: {
  handle: string;
  isCurrentUser: boolean;
  /* 記事から送るときだけ。台帳に「どの記事への応援か」を残す。 */
  articleId?: string;
  openLabel?: string;
}) {
  /* 見ている面の中に留まる。 */
  const surface = useHubUiSurface();
  const wallet = useHubWallet();
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [ownLinks, setOwnLinks] = useState<OwnLink[]>([]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("0.001");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  const [minimumDrafts, setMinimumDrafts] = useState<Record<string, string>>({});

  async function load() {
    const endpoint = isCurrentUser
      ? "/api/tips/settings"
      : `/api/tips/recipient?handle=${encodeURIComponent(handle)}`;
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (isCurrentUser) {
      const links = payload.links ?? [];
      setOwnLinks(links);
      setMinimumDrafts(Object.fromEntries(links.map((link: OwnLink) => [ownLinkKey(link), link.minimumAmount])));
    }
    else {
      const nextRecipient = payload as Recipient;
      setRecipient(nextRecipient);
      setSelectedChainId((current) =>
        nextRecipient.options?.some((option) => option.chainId === current)
          ? current
          : nextRecipient.options?.[0]?.chainId ?? null,
      );
    }
  }

  useEffect(() => {
    void load();
  }, [handle, isCurrentUser]);

  async function toggleReceiving(link: OwnLink) {
    if (busy) return;
    if (!link.tipsEnabled && !window.confirm(`受取を有効にすると、ウォレットアドレス ${link.address} とこのプロフィールの関連が公開されます。${link.network}（chain ${link.chainId}）で公開して受け取りますか？`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tips/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: link.address,
          chainId: link.chainId,
          enabled: !link.tipsEnabled,
          ...(!link.tipsEnabled ? { publishAddress: true } : {}),
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "設定を更新できませんでした。");
      await load();
      setMessage(link.tipsEnabled
        ? `${link.network} の受取を停止し、このネットワークのウォレット連携を非公開にしました。`
        : `${link.symbol}の投げ銭受け取りを有効にしました。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function saveMinimum(link: OwnLink) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/tips/settings", { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({address:link.address,chainId:link.chainId,minimumAmount:minimumDrafts[ownLinkKey(link)] ?? "0"}) });
      const payload=await response.json() as {error?:string};
      if(!response.ok) throw new Error(payload.error||"最低金額を更新できませんでした。");
      await load(); setMessage(`${link.symbol} の最低金額を更新しました。`);
    } catch(error) { setMessage(error instanceof Error?error.message:"最低金額を更新できませんでした。"); }
    finally { setBusy(false); }
  }

  async function confirmTip(hash: `0x${string}`, chainId = selectedChainId) {
    if (!chainId) throw new Error("受取トークンを選択してください。");
    const response = await fetch("/api/tips/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientHandle: handle, txHash: hash, chainId, ...(articleId ? { articleId } : {}) }),
    });
    const payload = await response.json() as {
      error?: string;
      pending?: boolean;
      amount?: string;
      symbol?: string;
    };
    if (!response.ok) {
      if (payload.pending) {
        setPendingHash(hash);
        throw new Error(`${payload.error} トランザクションは失われていません。`);
      }
      throw new Error(payload.error || "投げ銭を確認できませんでした。");
    }
    setPendingHash(null);
    setMessage(`${payload.amount} ${payload.symbol} の投げ銭が完了しました。`);
    setOpen(false);
  }

  async function sendTip() {
    const option = recipient?.options.find((item) => item.chainId === selectedChainId);
    if (!recipient?.enabled || !option) return;
    setBusy(true);
    setMessage("");
    try {
      if (!wallet.address || !wallet.chainId) {
        const connected = await wallet.connect();
        if (!connected) return;
        throw new Error("ウォレット接続後、もう一度送信ボタンを押してください。");
      }
      const linksResponse = await fetch("/api/wallet/links", { cache: "no-store" });
      const linksPayload = await linksResponse.json() as {
        links?: Array<{ address: string }>;
      };
      const linked = linksPayload.links?.some(
        (link) =>
          link.address.toLocaleLowerCase("en") ===
          wallet.address?.toLocaleLowerCase("en"),
      );
      if (!linked) {
        throw new Error("送信元ウォレットを先にHubアカウントへ紐づけてください。");
      }
      const value = parseEther(amount);
      if (value <= 0n) throw new Error("0より大きい金額を入力してください。");
      if (value < parseEther(option.minimumAmount || "0")) throw new Error(`最低金額は ${option.minimumAmount} ${option.symbol} です。`);
      if (wallet.chainId !== option.chainId) {
        await wallet.switchChain(option.chainId);
      }
      const hash = await wallet.sendNativeTransaction(
        option.address,
        toHex(value),
      );
      setPendingHash(hash);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const receipt = await wallet.getTransactionReceipt(hash);
        if (receipt) break;
        await wait(1500);
      }
      await confirmTip(hash, option.chainId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "投げ銭を送信できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (isCurrentUser) {
    return (
      <div className="wallet-tip-settings">
        {ownLinks.length ? (
          <>
            <button
              type="button"
              className="button wallet-tip-settings__open"
              aria-expanded={open}
              aria-controls="profile-wallet-tip-settings"
              onClick={() => setOpen((value) => !value)}
            >
              受取設定
            </button>
            {open ? (
              <div className="wallet-tip-settings__panel" id="profile-wallet-tip-settings">
                <button
                  type="button"
                  className="wallet-tip-settings__close"
                  aria-label="受取設定を閉じる"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
                <fieldset className="wallet-tip-settings__options" disabled={busy}>
                  <legend>受取トークン</legend>
                  {ownLinks.map((link) => (
                    <div className="wallet-tip-settings__option" key={`${link.chainId}:${link.address}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={link.tipsEnabled}
                        onChange={() => void toggleReceiving(link)}
                      />
                      <span>
                        <strong>{link.symbol}</strong>
                        <small>{link.network}</small>
                      </span>
                    </label>
                    <span className="wallet-tip-settings__minimum"><input inputMode="decimal" aria-label={`${link.symbol}の最低金額`} value={minimumDrafts[ownLinkKey(link)] ?? "0"} onChange={(event)=>setMinimumDrafts((current)=>({...current,[ownLinkKey(link)]:event.target.value}))}/><button type="button" onClick={()=>void saveMinimum(link)}>最低額を保存</button></span>
                    </div>
                  ))}
                </fieldset>
                <small>受取を停止すると、そのネットワークのウォレット連携は非公開に戻ります。</small>
                {!ownLinks.some((link) => link.tipsEnabled) ? (
                  <small>受け取るトークンを1つ選択してください。</small>
                ) : null}
                {message ? <small role="status">{message}</small> : null}
              </div>
            ) : null}
          </>
        ) : (
          <a className="button" href={hubSurfacePath(surface, "/token?ranking=token-ranking-eth")}>
            ウォレットを紐づける
          </a>
        )}
      </div>
    );
  }

  if (!recipient?.enabled) return null;

  return (
    <div className="wallet-tip-control">
      <button type="button" className="button wallet-tip-control__open" onClick={() => setOpen((value) => !value)}>
        {openLabel}
      </button>
      {open ? (
        <div className="wallet-tip-control__panel">
          <strong>{recipient.displayName}へ投げ銭</strong>
          <label className="wallet-tip-control__token">
            受取トークン
            <select
              value={selectedChainId ?? ""}
              onChange={(event) => setSelectedChainId(Number(event.target.value))}
            >
              {recipient.options.map((option) => (
                <option key={`${option.chainId}:${option.address}`} value={option.chainId}>
                  {option.symbol} · {option.network}
                </option>
              ))}
            </select>
          </label>
          <small>最低金額: {recipient.options.find((option) => option.chainId === selectedChainId)?.minimumAmount} {recipient.options.find((option) => option.chainId === selectedChainId)?.symbol}</small>
          <label>
            金額
            <span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="投げ銭金額"
              />
              {recipient.options.find((option) => option.chainId === selectedChainId)?.symbol}
            </span>
          </label>
          <HubWalletButton />
          <button type="button" className="primary-action" disabled={busy} onClick={() => void sendTip()}>
            {busy ? "確認中…" : "ウォレットから送る"}
          </button>
          {pendingHash ? (
            <button type="button" className="wallet-tip-control__retry" disabled={busy} onClick={() => void confirmTip(pendingHash)}>
              承認状態を再確認
            </button>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          <small>Hubは資金を預かりません。ウォレットに表示される送金先と金額を確認してください。</small>
        </div>
      ) : null}
    </div>
  );
}
