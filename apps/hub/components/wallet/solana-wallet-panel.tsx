"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { base58 } from "@scure/base";

import {
  connectSolanaWallet,
  disconnectSolanaWallet,
  listSolanaWallets,
  signAndSendSolanaTransaction,
  signLinkMessage,
  SolanaWalletClientError,
  walletStandardChain,
  watchSolanaWallets,
  type ConnectedSolanaWallet,
  type SolanaWalletEntry,
} from "@/lib/wallet/wallet-standard";
import type { BuiltSolanaSend, InspectedTransaction } from "@/lib/wallet/solana-send";
import styles from "./solana-wallet-panel.module.css";

type Network = { chainRef: string; name: string; testnet: boolean; cluster: "mainnet" | "devnet" };
type Token = { mint: string; amount: string; decimals: number; program: "spl-token" | "spl-token-2022"; accounts: number };
type Overview = { lamports: number; tokens: Token[] };
type HistoryItem = { signature: string; blockTime: number | null; failed: boolean };
type LinkedAccount = { id: string; namespace: string; address: string; verificationStatus: string; tipsEnabled?: number };
type MintInfo = { program: "spl-token" | "spl-token-2022"; decimals: number; extensions: string[]; refused: string[]; transferFee: { basisPoints: number; maximumFee: string } | null };
type SendContext = { blockhash: string; lastValidBlockHeight: number; tokenAccountRentLamports: number };

type Review = {
  built: BuiltSolanaSend;
  inspected: InspectedTransaction;
  network: Network;
  symbol: string;
  decimals: number;
  rentLamports: bigint;
  transferFee: bigint;
  tokenName: string | null;
};

const LAMPORTS_DECIMALS = 9;
const FEE_LAMPORTS = BigInt(5000);

const ERROR_TEXT: Record<string, string> = {
  invalid_address: "アドレスが正しくありません。",
  invalid_amount: "金額が正しくありません。",
  same_address: "自分のアドレスには送れません。",
  mint_extension_unsupported: "このトークンには、Hubがいまは扱わない拡張（転送フック・恒久委任・譲渡不可・機密転送のいずれか）があります。送金を止めました。",
  unsupported_token_program: "このトークンの種類には対応していません。",
  insufficient_funds: "残高が足りません（手数料を含みます）。",
  source_not_associated_account: "このトークンは標準の口座に入っていないため、送れません。",
  unexpected_transaction: "作った取引の中身が想定と一致しませんでした。送信しませんでした。",
};

function describeError(error: unknown): string {
  if (error instanceof SolanaWalletClientError) {
    if (error.code === "rejected") return "ウォレットで取り消されました。";
    if (error.code === "unavailable" || error.code === "no_account") return "ウォレットが見つかりません。";
    if (error.code === "unsupported") return "このウォレットはこの操作に対応していません。";
  }
  const code = (error as { code?: string })?.code ?? (error instanceof Error ? error.message : "");
  return ERROR_TEXT[code] ?? "うまくいきませんでした。もう一度お試しください。";
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

async function sendJson<T>(url: string, method: "POST" | "PATCH", payload: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

function short(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/**
 * Solana: connect an external wallet (Wallet Standard), link an address (Sign-In With Solana), see balances, send
 * SOL and SPL / Token-2022 tokens. Hub holds no Solana keys: the transaction is built here, checked against the
 * confirmation screen from its own bytes, and signed in the user's wallet. No swap, quote or route is offered.
 */
export function SolanaWalletPanel() {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [network, setNetwork] = useState<Network | null>(null);
  const [wallets, setWallets] = useState<SolanaWalletEntry[]>([]);
  const [connected, setConnected] = useState<ConnectedSolanaWallet | null>(null);
  const [linked, setLinked] = useState<LinkedAccount[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [asset, setAsset] = useState("sol");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sentSignature, setSentSignature] = useState("");
  const [sentStatus, setSentStatus] = useState("");
  const [tipsEnabled, setTipsEnabled] = useState(false);

  const account = connected ? linked.find((item) => item.namespace === "solana" && item.address === connected.address && item.verificationStatus === "verified") ?? null : null;
  useEffect(() => { setTipsEnabled(Boolean(account?.tipsEnabled)); }, [account?.id, account?.tipsEnabled]);
  const tokens = useMemo(() => overview?.tokens ?? [], [overview]);

  useEffect(() => {
    setWallets(listSolanaWallets());
    return watchSolanaWallets(() => setWallets(listSolanaWallets()));
  }, []);

  useEffect(() => {
    let alive = true;
    getJson<{ networks: Network[] }>("/api/wallet/solana?action=networks")
      .then((data) => { if (alive) { setNetworks(data.networks); setNetwork((current) => current ?? data.networks.find((item) => item.testnet) ?? data.networks[0] ?? null); } })
      .catch(() => { if (alive) setNetworks([]); });
    return () => { alive = false; };
  }, []);

  const loadLinked = useCallback(async () => {
    try { setLinked((await getJson<{ accounts: LinkedAccount[] }>("/api/wallet/accounts")).accounts ?? []); } catch { setLinked([]); }
  }, []);
  useEffect(() => { void loadLinked(); }, [loadLinked]);

  const refresh = useCallback(async (address: string, target: Network) => {
    const query = `chainRef=${encodeURIComponent(target.chainRef)}&address=${encodeURIComponent(address)}`;
    try {
      const [view, past] = await Promise.all([
        getJson<Overview>(`/api/wallet/solana?action=overview&${query}`),
        getJson<{ history: HistoryItem[] }>(`/api/wallet/solana?action=history&${query}`).catch(() => ({ history: [] })),
      ]);
      setOverview(view); setHistory(past.history);
    } catch { setOverview(null); setHistory([]); setMessage("残高を取得できませんでした（このネットワークのRPCが未設定の可能性があります）。"); }
  }, []);

  useEffect(() => {
    setReview(null); setSentSignature(""); setSentStatus(""); setAsset("sol");
    if (connected && network) void refresh(connected.address, network);
  }, [network, connected, refresh]);

  async function connect(entry: SolanaWalletEntry) {
    setBusy(true); setMessage("");
    try { setConnected(await connectSolanaWallet(entry)); } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }

  async function disconnect() {
    if (connected) await disconnectSolanaWallet(connected.entry);
    setConnected(null); setOverview(null); setHistory([]); setReview(null);
  }

  async function link() {
    if (!connected || !network) return;
    setBusy(true); setMessage("");
    try {
      const challenge = await sendJson<{ challengeId: string; message: string }>("/api/wallet/links/challenge", "POST", { chainRef: network.chainRef, address: connected.address });
      const signed = await signLinkMessage(connected, challenge);
      await sendJson("/api/wallet/links/verify", "POST", { challengeId: challenge.challengeId, signature: signed.signature, signedMessage: signed.signedMessage });
      await loadLinked();
      setMessage("アドレスを連携しました（非公開です）。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const known: Record<string, string> = {
        wallet_linked_elsewhere: "このアドレスはすでに別のアカウントに連携されています。",
        address_cannot_sign: "このアドレスでは署名できません。",
        message_mismatch: "ウォレットが表示した文面が発行した内容と一致しませんでした。連携しませんでした。",
        wrong_network: "ウォレットの署名したネットワークが選んだネットワークと違います。",
        challenge_expired: "有効期限が切れました。もう一度お試しください。",
        rate_limited: "試行が多すぎます。しばらくしてからお試しください。",
      };
      setMessage(known[code] ?? describeError(error));
    } finally { setBusy(false); }
  }

  async function prepare() {
    if (!connected || !network || !overview) return;
    setBusy(true); setMessage(""); setSentSignature(""); setSentStatus("");
    try {
      const send = await import("@/lib/wallet/solana-send");
      const context = await getJson<SendContext>(`/api/wallet/solana?action=send-context&chainRef=${encodeURIComponent(network.chainRef)}`);
      const lifetime = { blockhash: context.blockhash, lastValidBlockHeight: context.lastValidBlockHeight };
      const recipient = to.trim();
      let built: BuiltSolanaSend;
      let symbol = "SOL";
      let decimals = LAMPORTS_DECIMALS;
      let transferFee = BigInt(0);
      let rent = BigInt(0);
      let tokenName: string | null = null;
      if (asset === "sol") {
        const lamports = send.parseTokenAmount(amount, LAMPORTS_DECIMALS);
        if (lamports === null) throw Object.assign(new Error("invalid_amount"), { code: "invalid_amount" });
        built = send.buildSolSend({ from: connected.address, to: recipient, lamports, balanceLamports: BigInt(overview.lamports), lifetime });
      } else {
        const token = tokens.find((item) => `${item.program}:${item.mint}` === asset);
        if (!token) throw Object.assign(new Error("invalid_amount"), { code: "invalid_amount" });
        const mintInfo = await getJson<MintInfo>(`/api/wallet/solana?action=mint&chainRef=${encodeURIComponent(network.chainRef)}&mint=${encodeURIComponent(token.mint)}`);
        send.assertSendableMint({ program: mintInfo.program, decimals: mintInfo.decimals, extensions: mintInfo.extensions });
        const raw = send.parseTokenAmount(amount, mintInfo.decimals);
        if (raw === null) throw Object.assign(new Error("invalid_amount"), { code: "invalid_amount" });
        const sourceAccount = await send.deriveAssociatedTokenAccount(connected.address, token.mint, mintInfo.program);
        const recipientAccount = await send.deriveAssociatedTokenAccount(recipient, token.mint, mintInfo.program);
        const [source, destination] = await Promise.all([
          getJson<{ exists: boolean }>(`/api/wallet/solana?action=account&chainRef=${encodeURIComponent(network.chainRef)}&address=${encodeURIComponent(sourceAccount)}`),
          getJson<{ exists: boolean }>(`/api/wallet/solana?action=account&chainRef=${encodeURIComponent(network.chainRef)}&address=${encodeURIComponent(recipientAccount)}`),
        ]);
        if (!source.exists) throw Object.assign(new Error("source_not_associated_account"), { code: "source_not_associated_account" });
        built = await send.buildSplSend({
          from: connected.address, to: recipient, mint: token.mint, amount: raw,
          mintFacts: { program: mintInfo.program, decimals: mintInfo.decimals, extensions: mintInfo.extensions },
          sourceBalance: BigInt(token.amount), recipientAccountExists: destination.exists, lifetime,
        });
        symbol = short(token.mint); decimals = mintInfo.decimals; tokenName = token.mint;
        transferFee = send.transferFeeFor(raw, mintInfo.transferFee);
        rent = built.createRecipientAccount ? BigInt(context.tokenAccountRentLamports) : BigInt(0);
        if (built.createRecipientAccount && BigInt(overview.lamports) < FEE_LAMPORTS + rent) throw Object.assign(new Error("insufficient_funds"), { code: "insufficient_funds" });
      }
      // What the user confirms is read back from the serialized bytes, never from the form.
      const inspected = send.assertBuiltMatches(built);
      setReview({ built, inspected, network, symbol, decimals, rentLamports: rent, transferFee, tokenName });
    } catch (error) { setReview(null); setMessage(describeError(error)); } finally { setBusy(false); }
  }

  async function confirmSend() {
    if (!connected || !review) return;
    setBusy(true); setMessage("");
    try {
      const send = await import("@/lib/wallet/solana-send");
      send.assertBuiltMatches(review.built);
      const signature = await signAndSendSolanaTransaction(connected, { chain: walletStandardChain(review.network.cluster), transaction: review.built.transaction }, (bytes) => base58.encode(bytes));
      setSentSignature(signature); setSentStatus("pending"); setReview(null); setAmount(""); setTo("");
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const result = await sendJson<{ status: string }>("/api/wallet/solana", "POST", { signature, chainRef: review.network.chainRef }).catch(() => null);
        if (result) setSentStatus(result.status);
        if (result && (result.status === "finalized" || result.status === "failed")) break;
      }
      if (network) await refresh(connected.address, network);
    } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }

  async function toggleTips(enabled: boolean) {
    if (!account) return;
    setBusy(true); setMessage("");
    try {
      await sendJson("/api/wallet/tips/solana", "PATCH", { accountId: account.id, enabled, minimumLamports: "0", visibility: enabled ? "public" : "private" });
      setTipsEnabled(enabled);
      setMessage(enabled ? "投げ銭を受け取る設定にしました。このアドレスは公開されます。" : "投げ銭を止め、アドレスを非公開に戻しました。");
    } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }

  const currentToken = asset === "sol" ? null : tokens.find((item) => `${item.program}:${item.mint}` === asset) ?? null;
  const transfer = review?.inspected.operations.find((op) => op.type === "transfer-sol" || op.type === "transfer-checked");
  const rawAmount = transfer ? (transfer.type === "transfer-sol" ? transfer.lamports : transfer.type === "transfer-checked" ? transfer.amount : BigInt(0)) : BigInt(0);
  const formatRaw = (raw: bigint, decimals: number) => {
    const padded = raw.toString().padStart(decimals + 1, "0");
    const whole = padded.slice(0, padded.length - decimals) || "0";
    const fraction = decimals > 0 ? padded.slice(padded.length - decimals).replace(/0+$/, "") : "";
    return fraction ? `${whole}.${fraction}` : whole;
  };

  return (
    <section className={styles.panel} aria-labelledby="solana-wallet-title">
      <h3 id="solana-wallet-title" className={styles.title}>Solana</h3>
      <p className={styles.note}>Phantom・Solflare・Backpackなど、外部ウォレットで署名します。Hubは鍵を作らず、保管せず、復元もしません。</p>

      {networks.length > 0 ? (
        <label className={styles.field}>
          <span>ネットワーク</span>
          <select className={styles.input} value={network?.chainRef ?? ""} onChange={(event) => setNetwork(networks.find((item) => item.chainRef === event.target.value) ?? network)}>
            {networks.map((item) => <option key={item.chainRef} value={item.chainRef}>{item.name}{item.testnet ? "（テストネット）" : ""}</option>)}
          </select>
        </label>
      ) : <p className={styles.warning}>利用できるSolanaネットワークがありません。</p>}
      {network?.testnet ? <p className={styles.badge}>テストネット：価値のないコインです</p> : network ? <p className={styles.warning}>メインネットです。実際の資産が動きます。</p> : null}

      {!connected ? (
        <div className={styles.row}>
          {wallets.length === 0 ? <p className={styles.note}>Solana対応のウォレット拡張が見つかりません。</p> : null}
          {wallets.map((entry) => (
            <button key={entry.name} type="button" className={styles.action} disabled={busy || !network} onClick={() => void connect(entry)}>{entry.name}で接続</button>
          ))}
        </div>
      ) : (
        <div className={styles.connected}>
          <span className={styles.address}>{connected.address}</span>
          <dl className={styles.facts}>
            <dt>ウォレット</dt><dd>{connected.entry.name}</dd>
            <dt>SOL（確定済み）</dt><dd>{overview ? formatRaw(BigInt(overview.lamports), LAMPORTS_DECIMALS) : "-"}</dd>
            <dt>連携</dt><dd>{account ? "連携済み（非公開）" : "未連携"}</dd>
          </dl>
          {tokens.length > 0 ? (
            <ul className={styles.warnings}>
              {tokens.map((token) => <li key={`${token.program}:${token.mint}`}>{short(token.mint)}：{formatRaw(BigInt(token.amount), token.decimals)}{token.program === "spl-token-2022" ? "（Token-2022）" : ""}</li>)}
            </ul>
          ) : null}
          <div className={styles.row}>
            {!account ? <button type="button" className={styles.secondary} disabled={busy || !network} onClick={() => void link()}>署名してアドレスを連携</button> : null}
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void disconnect()}>接続を外す</button>
          </div>
        </div>
      )}

      {connected && account && network && overview ? (
        <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
          <label className={styles.field}>
            <span>送るもの</span>
            <select className={styles.input} value={asset} onChange={(event) => setAsset(event.target.value)}>
              <option value="sol">SOL</option>
              {tokens.map((token) => <option key={`${token.program}:${token.mint}`} value={`${token.program}:${token.mint}`}>{short(token.mint)}（{formatRaw(BigInt(token.amount), token.decimals)}）</option>)}
            </select>
          </label>
          <label className={styles.field}><span>宛先アドレス</span><input className={styles.input} value={to} onChange={(event) => setTo(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
          <label className={styles.field}><span>金額{currentToken ? `（${short(currentToken.mint)}）` : "（SOL）"}</span><input className={styles.input} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.01" required /></label>
          <button type="submit" className={styles.action} disabled={busy}>内容を確認する</button>
        </form>
      ) : null}

      {account ? (
        <div className={styles.row}>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void toggleTips(!tipsEnabled)}>{tipsEnabled ? "投げ銭の受け取りを止める" : "このアドレスで投げ銭を受け取る"}</button>
        </div>
      ) : null}

      {review && transfer ? (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="solana-confirm-title">
          <h4 id="solana-confirm-title" className={styles.title}>送金の確認</h4>
          {review.network.testnet ? <p className={styles.badge}>テストネット</p> : null}
          <dl className={styles.facts}>
            <dt>ネットワーク</dt><dd>{review.network.name}</dd>
            <dt>送信元</dt><dd className={styles.address}>{review.built.from}</dd>
            <dt>宛先</dt><dd className={styles.address}>{review.built.to}</dd>
            <dt>資産</dt><dd>{review.tokenName ? <>トークン <span className={styles.address}>{review.tokenName}</span></> : "SOL"}</dd>
            <dt>金額</dt><dd>{formatRaw(rawAmount, review.decimals)}（最小単位で {rawAmount.toString()}）</dd>
            {review.transferFee > BigInt(0) ? <><dt>トークンの転送手数料</dt><dd>{formatRaw(review.transferFee, review.decimals)}</dd></> : null}
            <dt>ネットワーク手数料</dt><dd>{formatRaw(FEE_LAMPORTS, LAMPORTS_DECIMALS)} SOL（署名1つ・{FEE_LAMPORTS.toString()} lamports）</dd>
            {review.built.createRecipientAccount ? <><dt>相手の口座の作成費</dt><dd>{formatRaw(review.rentLamports, LAMPORTS_DECIMALS)} SOL（あなたが払います）</dd></> : null}
            <dt>SOLの合計引き落とし</dt><dd>{formatRaw((review.built.kind === "sol" ? rawAmount : BigInt(0)) + FEE_LAMPORTS + review.rentLamports, LAMPORTS_DECIMALS)} SOL</dd>
            <dt>相手が受け取る額</dt><dd>{formatRaw(rawAmount > review.transferFee ? rawAmount - review.transferFee : BigInt(0), review.decimals)}</dd>
          </dl>
          <ul className={styles.warnings}>
            <li>送金はHubでも取り消せません。宛先を必ず確かめてください。</li>
            <li>取引には、ここに表示した命令だけが入っています（{review.inspected.operations.length}件）。</li>
          </ul>
          <div className={styles.buttons}>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setReview(null)}>戻る</button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => void confirmSend()}>ウォレットで署名して送る</button>
          </div>
        </div>
      ) : null}

      {sentSignature && network ? (
        <p className={styles.note}>
          送信しました（{sentStatus === "finalized" ? "確定" : sentStatus === "confirmed" ? "承認済み・確定待ち" : sentStatus === "failed" ? "失敗" : "処理中"}）。署名：
          <a className={styles.link} href={`https://explorer.solana.com/tx/${sentSignature}${network.cluster === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer noopener">{short(sentSignature)}</a>
        </p>
      ) : null}
      {history.length > 0 ? (
        <details className={styles.note}>
          <summary>最近の取引（確定済み）</summary>
          <ul className={styles.warnings}>{history.slice(0, 10).map((item) => <li key={item.signature}>{short(item.signature)}{item.failed ? "（失敗）" : ""}{item.blockTime ? ` ${new Date(item.blockTime * 1000).toLocaleString("ja-JP")}` : ""}</li>)}</ul>
        </details>
      ) : null}
      {message ? <p className={styles.note} role="status">{message}</p> : null}
    </section>
  );
}
