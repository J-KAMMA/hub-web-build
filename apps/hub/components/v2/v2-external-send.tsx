"use client";

// パスキー・ウォレットに配備がないチェーンで、ユーザー自身の外部ウォレット
// （EIP-6963 で検出）から送金する面。ネイティブトークンと ERC-20 の送金のみ。
// トランザクションはブラウザで組み立て、署名はウォレットが行う。交換・取引ではない。

import { useEffect, useMemo, useState } from "react";

import { ENABLED_EVM_CHAINS } from "@/lib/chains/evm-chain-registry";
import {
  buildConfirmation,
  buildTransfer,
  connectExternalWallet,
  discoverExternalWallets,
  estimateFee,
  ExternalSendError,
  readErc20Metadata,
  type TokenMetadata,
  externalSendErrorMessage,
  sendExternalTransfer,
  type BuiltTransfer,
  type ConfirmationContent,
  type ExternalWallet,
} from "@/lib/chains/external-wallet-send";
import { BUILTIN_NETWORKS } from "@/lib/wallet/networks";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function externalOnlyChains() {
  const smart = new Set(
    Object.values(BUILTIN_NETWORKS)
      .filter((item) => item.transactionEnabled === true)
      .map((item) => Number(BigInt(item.chainId))),
  );
  return ENABLED_EVM_CHAINS.filter((entry) => !smart.has(entry.chainId)).sort((a, b) => Number(a.testnet) - Number(b.testnet));
}

export function V2ExternalSend({ japanese }: { japanese: boolean }) {
  const chains = useMemo(() => externalOnlyChains(), []);
  const [wallets, setWallets] = useState<ExternalWallet[]>([]);
  const [walletId, setWalletId] = useState("");
  const [from, setFrom] = useState("");
  const [chainId, setChainId] = useState<number>(chains[0]?.chainId ?? 0);
  const [asset, setAsset] = useState<"native" | "erc20">("native");
  const [token, setToken] = useState("");
  const [tokenMeta, setTokenMeta] = useState<TokenMetadata | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ transfer: BuiltTransfer; content: ConfirmationContent } | null>(null);
  const [sent, setSent] = useState<{ hash: string; explorerUrl: string } | null>(null);

  useEffect(() => discoverExternalWallets(window, setWallets), []);

  const wallet = wallets.find((item) => item.id === walletId) ?? null;
  const entry = chains.find((item) => item.chainId === chainId) ?? null;
  const fail = (e: unknown) => setError(externalSendErrorMessage(e instanceof ExternalSendError ? e.code : "send_failed", japanese));

  const connect = async () => {
    if (!wallet) return;
    setBusy(true);
    setError("");
    try {
      setFrom(await connectExternalWallet(wallet));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const readToken = async () => {
    setBusy(true);
    setError("");
    setTokenMeta(null);
    try {
      setTokenMeta(await readErc20Metadata(chainId, token.trim(), { provider: wallet?.provider }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const prepare = async () => {
    if (!wallet || !from) return;
    setBusy(true);
    setError("");
    setSent(null);
    try {
      const transfer = buildTransfer({
        chainId,
        from,
        to: to.trim(),
        amount,
        asset: asset === "native" ? { kind: "native" } : { kind: "erc20", address: tokenMeta!.address, symbol: tokenMeta!.symbol, decimals: tokenMeta!.decimals },
      });
      const fee = await estimateFee(transfer);
      setReview({ transfer, content: buildConfirmation({ transfer, fee, walletName: wallet.name, japanese }) });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!wallet || !review) return;
    setBusy(true);
    setError("");
    try {
      setSent(await sendExternalTransfer(wallet, review.transfer));
      setReview(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (chains.length === 0) return null;
  const c = review?.content;

  return (
    <section className="v2-wallet__card" aria-labelledby="v2-wallet-external">
      <header className="v2-wallet__card-head"><h2 id="v2-wallet-external">{japanese ? "外部ウォレットから送る" : "Send from an external wallet"}</h2></header>
      <p className="v2-note">{japanese ? "このチェーンでは外部ウォレットから送れます" : "On these chains you can send from an external wallet"}</p>
      <p className="v2-wallet__form-note">{japanese ? "MetaMask・Rabby・Coinbase Wallet などの自分のウォレットで署名します。Hubは鍵も資金も預かりません。送金専用で、交換や取引はできません。" : "You sign in your own wallet (MetaMask, Rabby, Coinbase Wallet…). Hub never holds keys or funds. Transfers only; no exchange or trading."}</p>

      {!review ? (
        <div className="v2-wallet__form">
          <div className="v2-wallet__field">
            <span className="v2-wallet__field-label">{japanese ? "ウォレット" : "Wallet"}</span>
            {wallets.length === 0 ? (
              <p className="v2-wallet__form-note">{japanese ? "ブラウザ拡張のウォレットが見つかりません。" : "No browser wallet found."}</p>
            ) : (
              <div className="v2-wallet__segments" role="radiogroup" aria-label={japanese ? "ウォレット" : "Wallet"}>
                {wallets.map((item) => (
                  <button key={item.id} type="button" role="radio" aria-checked={item.id === walletId} className={`v2-wallet__segment ${item.id === walletId ? "v2-wallet__segment--on" : ""}`} onClick={() => { setWalletId(item.id); setFrom(""); }}>
                    {item.name}
                  </button>
                ))}
              </div>
            )}
            {wallet && !from ? (
              <button type="button" className="v2-button v2-wallet__cta" disabled={busy} onClick={connect}>{japanese ? "接続する" : "Connect"}</button>
            ) : null}
            {from ? <small className="v2-wallet__form-note"><code>{from}</code></small> : null}
          </div>

          <label className="v2-wallet__field">
            <span className="v2-wallet__field-label">{japanese ? "チェーン" : "Chain"}</span>
            <select className="v2-wallet__input" value={chainId} onChange={(event) => { setChainId(Number(event.target.value)); setTokenMeta(null); }}>
              {chains.map((item) => (
                <option key={item.chainId} value={item.chainId}>{item.name}{item.testnet ? (japanese ? "（テスト）" : " (test)") : ""}</option>
              ))}
            </select>
          </label>
          {entry && entry.publicRpcUrls.length === 0 ? (
            <p className="v2-wallet__form-note">{japanese ? "このチェーンはHubから追加できません。先にウォレットでこのチェーンを追加してください。" : "Hub cannot add this chain. Add it in your wallet first."}</p>
          ) : null}

          <div className="v2-wallet__field">
            <span className="v2-wallet__field-label">{japanese ? "資産" : "Asset"}</span>
            <div className="v2-wallet__segments" role="radiogroup" aria-label={japanese ? "資産" : "Asset"}>
              <button type="button" role="radio" aria-checked={asset === "native"} className={`v2-wallet__segment ${asset === "native" ? "v2-wallet__segment--on" : ""}`} onClick={() => setAsset("native")}>{entry?.nativeSymbol}</button>
              <button type="button" role="radio" aria-checked={asset === "erc20"} className={`v2-wallet__segment ${asset === "erc20" ? "v2-wallet__segment--on" : ""}`} onClick={() => setAsset("erc20")}>ERC-20</button>
            </div>
          </div>
          {asset === "erc20" ? (
            <>
              <label className="v2-wallet__field">
                <span className="v2-wallet__field-label">{japanese ? "トークンのコントラクト" : "Token contract"}</span>
                <input className="v2-wallet__input v2-wallet__input--mono" type="text" value={token} onChange={(event) => { setToken(event.target.value); setTokenMeta(null); }} placeholder="0x…" spellCheck={false} autoComplete="off" maxLength={42} />
              </label>
              <button type="button" className="v2-button v2-wallet__cta" disabled={busy || !ADDRESS.test(token.trim())} onClick={readToken}>
                {japanese ? "コントラクトから読み取る" : "Read from contract"}
              </button>
              {tokenMeta ? (
                <p className="v2-wallet__form-note">{japanese ? "読み取り結果" : "Read"}: {tokenMeta.symbol} · {tokenMeta.decimals} {japanese ? "桁" : "decimals"}</p>
              ) : null}
            </>
          ) : null}
          <label className="v2-wallet__field">
            <span className="v2-wallet__field-label">{japanese ? "宛先アドレス" : "Recipient"}</span>
            <input className="v2-wallet__input v2-wallet__input--mono" type="text" value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" maxLength={42} />
          </label>
          <label className="v2-wallet__field">
            <span className="v2-wallet__field-label">{japanese ? "金額" : "Amount"}<span className="v2-wallet__field-unit">{asset === "native" ? entry?.nativeSymbol : tokenMeta?.symbol}</span></span>
            <input className="v2-wallet__input" type="text" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.0" inputMode="decimal" autoComplete="off" maxLength={40} />
          </label>
          <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy || !from || !ADDRESS.test(to.trim()) || !amount.trim() || (asset === "erc20" && !tokenMeta)} onClick={prepare}>
            {japanese ? "内容を確認する" : "Review"}
          </button>
        </div>
      ) : c ? (
        <div className="v2-wallet__form">
          <dl className="v2-wallet__ext-summary" aria-label={japanese ? "送金内容" : "Transfer details"}>
            <div><dt>{japanese ? "チェーン" : "Chain"}</dt><dd>{c.chainName}</dd></div>
            <div><dt>{japanese ? "送信元" : "From"}</dt><dd><code>{c.from}</code></dd></div>
            <div><dt>{japanese ? "宛先" : "To"}</dt><dd><code>{c.to}</code></dd></div>
            <div><dt>{japanese ? "金額" : "Amount"}</dt><dd>{c.amountText} {c.symbol}</dd></div>
            <div><dt>{japanese ? "手数料の目安" : "Estimated fee"}</dt><dd>{c.feeText ?? (japanese ? "取得できません（ウォレットに表示されます）" : "Unavailable (shown in your wallet)")}</dd></div>
          </dl>
          <p className="v2-wallet__form-note">{c.networkNote}</p>
          <p className="v2-wallet__form-note">{c.transferNote}</p>
          <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy} onClick={send}>
            {busy ? (japanese ? "ウォレットで確認中…" : "Waiting for wallet…") : (japanese ? "ウォレットで送金する" : "Send in wallet")}
          </button>
          <button type="button" className="v2-button v2-wallet__cta" disabled={busy} onClick={() => setReview(null)}>{japanese ? "戻る" : "Back"}</button>
        </div>
      ) : null}

      {error ? <p className="v2-note" role="alert">{error}</p> : null}
      {sent ? (
        <p className="v2-note">{japanese ? "送信しました" : "Sent"}: <a className="v2-card__link" href={sent.explorerUrl} target="_blank" rel="noreferrer"><code>{sent.hash.slice(0, 14)}…</code></a></p>
      ) : null}
    </section>
  );
}
