"use client";

// 右列のウォレット（2026-10-15 所有者指定：ウォレットは左のナビから右列へ）。
// ネットワーク・残高（JPYC などのトークン含む）・受取アドレス・最近の取引だけを出す要約。
// 送金は右列では行わない。「送金する」は /v2/wallet の送金欄へ送り、承認ダイアログを通す既存の手順だけを使う。
// 鍵は端末の認証器にだけ存在し、この部品は鍵にも署名にも触れない。
// 交換・スワップ・ブリッジ・価格比較は置かない。

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { getHubEvmProvider, useHubWallet } from "@/components/hub-wallet-provider";
import { chainTag, erc20BalanceOfData, formatTokenQuantity, shortAddress } from "@/components/v2/v2-wallet-format";
import { DEFAULT_CHAIN_ID, walletNetwork } from "@/lib/wallet/networks";
import { loadNativeWalletState, type NativeWalletState } from "@/lib/wallet/storage";
import { formatNativeQuantity } from "@/lib/wallet/transaction-request";

const HISTORY_ROWS = 5;
const POLL_MS = 15_000;

export function AsideWallet({ japanese }: { japanese: boolean }) {
  const wallet = useHubWallet();
  const [state, setState] = useState<NativeWalletState | null>(null);
  const [checked, setChecked] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setState(loadNativeWalletState());
    setChecked(true);
  }, [wallet.status, wallet.address, wallet.chainId]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const network = useMemo(
    () => walletNetwork(wallet.chainId != null ? `0x${wallet.chainId.toString(16)}` : state?.chainId ?? DEFAULT_CHAIN_ID) ?? walletNetwork(DEFAULT_CHAIN_ID),
    [wallet.chainId, state?.chainId],
  );
  const chainKey = network?.chainId ?? state?.chainId ?? DEFAULT_CHAIN_ID;
  const account = wallet.address
    ?? state?.activeSmartAccounts?.[chainKey]?.address
    ?? state?.smartAccountAddresses?.[chainKey]
    ?? null;
  const token = network?.tokens?.[0] ?? null;

  // 残高は、ウォレットが接続されて提供元が使えるときだけ読む（/v2/wallet と同じ読み方）。
  useEffect(() => {
    setBalance(null);
    setTokenBalance(null);
    if (!account || wallet.status !== "connected") return;
    let cancelled = false;
    const read = async () => {
      const provider = getHubEvmProvider();
      if (!provider) return;
      const value = await provider.request({ method: "eth_getBalance", params: [account, "latest"] }).catch(() => null);
      if (!cancelled && typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) setBalance(BigInt(value));
      if (token) {
        const raw = await provider.request({ method: "eth_call", params: [{ to: token.address, data: erc20BalanceOfData(account) }, "latest"] }).catch(() => null);
        if (!cancelled && typeof raw === "string" && /^0x[0-9a-fA-F]+$/.test(raw)) setTokenBalance(BigInt(raw));
      }
    };
    void read();
    const timer = setInterval(read, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [account, wallet.status, network, token]);

  const history = useMemo(
    () => (state?.activity ?? []).filter((item) => item.chainId === network?.chainId).slice(0, HISTORY_ROWS),
    [state?.activity, network],
  );
  const explorerTx = (hash: string) => (network?.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : null);

  const copyAddress = () => {
    if (!account) return;
    void navigator.clipboard?.writeText(account).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    }).catch(() => undefined);
  };

  if (!checked) return <p className="v2-note" role="status">{japanese ? "確認しています…" : "Checking…"}</p>;

  if (!state || !account) {
    return (
      <div className="v2-aside-wallet">
        <p className="v2-note">{japanese ? "この端末のウォレットはまだありません。パスキーで作成できます。" : "No wallet on this device yet. Create one with a passkey."}</p>
        <Link className="v2-aside-wallet__open" href="/v2/wallet">{japanese ? "ウォレットを開く" : "Open wallet"}</Link>
      </div>
    );
  }

  return (
    <div className="v2-aside-wallet">
      <p className="v2-aside-wallet__network">
        <strong>{network?.name ?? ""}</strong>
        <span className="v2-aside-wallet__tag">{chainTag(network, japanese)}</span>
      </p>
      <p className="v2-aside-wallet__label">{japanese ? "残高" : "Balance"}</p>
      <p className="v2-aside-wallet__balance" aria-live="polite">
        {balance != null && network ? formatNativeQuantity(balance, network) : "—"}
      </p>
      {token ? (
        <p className="v2-aside-wallet__token">{tokenBalance != null ? formatTokenQuantity(tokenBalance, token) : `— ${token.symbol}`}</p>
      ) : null}
      {wallet.status !== "connected" ? (
        <p className="v2-note">{japanese ? "残高はウォレットを開いて接続すると表示されます。" : "Open the wallet and connect to see balances."}</p>
      ) : null}

      <p className="v2-aside-wallet__label">{japanese ? "受取アドレス" : "Receive address"}</p>
      <p className="v2-aside-wallet__address">
        <code title={account}>{shortAddress(account)}</code>
        <button type="button" className="v2-aside-wallet__copy" onClick={copyAddress}>
          {copied ? (japanese ? "コピー済み" : "Copied") : (japanese ? "コピー" : "Copy")}
        </button>
      </p>
      <p className="v2-note">
        {japanese
          ? `受取ネットワークは ${network?.name ?? ""} です。別のネットワークで送ると受け取れないことがあります。`
          : `Receive on ${network?.name ?? "this network"} only; funds sent on another network may be lost.`}
      </p>

      <div className="v2-aside-wallet__actions">
        <Link className="v2-aside-wallet__send" href="/v2/wallet#v2-wallet-send">{japanese ? "送金する" : "Send"}</Link>
        <Link className="v2-aside-wallet__open" href="/v2/wallet">{japanese ? "ウォレットを開く" : "Open wallet"}</Link>
      </div>
      <p className="v2-note">{japanese ? "送金は、ウォレット画面で内容を確認し、承認してから実行されます。" : "Sending is done in the wallet page, after you review and approve it."}</p>

      <h3 className="v2-aside-wallet__label">{japanese ? "最近の取引" : "Recent activity"}</h3>
      {history.length ? (
        <ul className="v2-aside__list">
          {history.map((item) => {
            const href = explorerTx(item.transactionHash);
            const summary = item.kind === "send"
              ? `${japanese ? "送金" : "Sent"} ${item.amount ?? ""} ${item.symbol ?? ""}`.trim()
              : (japanese ? "有効化" : "Activation");
            return (
              <li key={item.transactionHash}>
                {href
                  ? <a className="v2-aside__item" href={href} target="_blank" rel="noreferrer"><span className="v2-aside__item-name">{summary}</span><span className="v2-aside__item-body">{new Date(item.at).toLocaleString(japanese ? "ja-JP" : "en-US")}</span></a>
                  : <p className="v2-aside__item"><span className="v2-aside__item-name">{summary}</span><span className="v2-aside__item-body">{new Date(item.at).toLocaleString(japanese ? "ja-JP" : "en-US")}</span></p>}
              </li>
            );
          })}
        </ul>
      ) : <p className="v2-note">{japanese ? "このネットワークの取引はまだありません。" : "No activity on this network yet."}</p>}
    </div>
  );
}
