"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { tryParseBitcoinAddress } from "@/lib/chains/address/bitcoin";
import { BITCOIN_NETWORKS, type BitcoinNetworkEntry } from "@/lib/chains/bitcoin-chain-registry";
import { buildBitcoinSend, BitcoinSendError, verifySignedBitcoinSend, type BuiltBitcoinSend, type SpendableUtxo } from "@/lib/wallet/bitcoin-psbt";
import { BITCOIN_WALLET_ADAPTERS, BitcoinWalletClientError, type BitcoinWalletAccount, type BitcoinWalletAdapter } from "@/lib/wallet/bitcoin-wallets";
import styles from "./bitcoin-wallet-panel.module.css";

type Overview = { confirmedSats: number; pendingSats: number };
type Fees = { fast: number; normal: number; slow: number };
type LinkedAccount = { namespace: string; address: string; verificationStatus: string };

const SATS = 100_000_000n;

function formatBtc(sats: bigint | number | string): string {
  const value = BigInt(sats);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const text = `${abs / SATS}.${(abs % SATS).toString().padStart(8, "0")}`;
  return `${negative ? "-" : ""}${text}`;
}

/** "0.001" -> 100000n. Null when it is not a plain decimal with at most 8 places. */
function parseBtc(text: string): bigint | null {
  const match = /^(\d{1,8})(?:\.(\d{1,8}))?$/.exec(text.trim());
  if (!match) return null;
  return BigInt(match[1]!) * SATS + BigInt((match[2] ?? "").padEnd(8, "0"));
}

const ERROR_TEXT: Record<string, string> = {
  taproot_send_refused: "タプルート（bc1p…）アドレスからの送金は、Ordinalsを誤って手放すおそれがあるため、いまは行えません。",
  unsupported_from_address: "このアドレスの種類からの送金には対応していません。",
  invalid_destination: "宛先アドレスが正しくありません。",
  wrong_network: "宛先のネットワークが選んだネットワークと違います。",
  pubkey_required: "このアドレスから送るには、ウォレットの公開鍵が必要です。",
  pubkey_mismatch: "ウォレットの公開鍵とアドレスが一致しません。",
  amount_too_small: "送金額が小さすぎます（受け取れない最小額を下回っています）。",
  invalid_amount: "送金額が正しくありません。",
  fee_rate_invalid: "手数料率が正しくありません。",
  fee_too_high: "手数料が高すぎるため止めました。",
  no_spendable_utxos: "使える承認済みの残高がありません。",
  insufficient_funds: "残高が足りません（手数料を含みます）。",
  too_many_inputs: "入力が多すぎます。",
  signed_transaction_mismatch: "ウォレットが署名した内容が、確認した内容と一致しません。送信しませんでした。",
  signed_transaction_invalid: "署名済みの取引を読み取れませんでした。",
};

function describeError(error: unknown): string {
  if (error instanceof BitcoinSendError) return ERROR_TEXT[error.code] ?? "送金を準備できませんでした。";
  if (error instanceof BitcoinWalletClientError) {
    if (error.code === "rejected") return "ウォレットで取り消されました。";
    if (error.code === "unavailable") return "ウォレットが見つかりません。";
    if (error.code === "network_mismatch") return "ウォレットのネットワークが選んだネットワークと違います。";
  }
  return "うまくいきませんでした。もう一度お試しください。";
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "request_failed");
  return body;
}

/**
 * Bitcoin: connect an external wallet, link an address (BIP-322 / signmessage), see balances, send.
 * Hub holds no Bitcoin keys. A send is a PSBT built here, signed in the user's own wallet, re-checked against
 * the confirmation screen, then relayed. Sends from taproot addresses are refused.
 */
export function BitcoinWalletPanel() {
  const networks = useMemo(() => BITCOIN_NETWORKS.filter((entry) => entry.enabled), []);
  const [network, setNetwork] = useState<BitcoinNetworkEntry>(networks.find((entry) => entry.testnet) ?? networks[0]!);
  const [adapter, setAdapter] = useState<BitcoinWalletAdapter | null>(null);
  const [accounts, setAccounts] = useState<BitcoinWalletAccount[]>([]);
  const [selected, setSelected] = useState(0);
  const [linked, setLinked] = useState<LinkedAccount[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [fees, setFees] = useState<Fees | null>(null);
  const [feePreset, setFeePreset] = useState<"slow" | "normal" | "fast">("normal");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [built, setBuilt] = useState<{ send: BuiltBitcoinSend; feeRate: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sentTxid, setSentTxid] = useState("");

  const account = accounts[selected] ?? null;
  const parsed = account ? tryParseBitcoinAddress(network.chainRef, account.address) : null;
  const isLinked = Boolean(account && linked.some((item) => item.namespace === "bip122" && item.address === account.address && item.verificationStatus === "verified"));
  const taproot = parsed?.kind === "p2tr";

  const loadLinked = useCallback(async () => {
    try {
      const data = await getJson<{ accounts: LinkedAccount[] }>("/api/wallet/accounts");
      setLinked(data.accounts ?? []);
    } catch { setLinked([]); }
  }, []);

  useEffect(() => { void loadLinked(); }, [loadLinked]);

  useEffect(() => {
    setAccounts([]); setSelected(0); setOverview(null); setBuilt(null); setSentTxid(""); setMessage("");
  }, [network]);

  const refresh = useCallback(async (address: string) => {
    try {
      setOverview(await getJson<Overview>(`/api/wallet/bitcoin?view=overview&chainRef=${encodeURIComponent(network.chainRef)}&address=${encodeURIComponent(address)}`));
    } catch { setOverview(null); setMessage("残高を取得できませんでした（このネットワークのAPIが未設定の可能性があります）。"); }
  }, [network.chainRef]);

  async function connect(candidate: BitcoinWalletAdapter) {
    setBusy(true); setMessage(""); setBuilt(null);
    try {
      const list = await candidate.connect(network);
      setAdapter(candidate); setAccounts(list); setSelected(0);
      if (list[0]) await refresh(list[0].address);
    } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }

  async function link() {
    if (!adapter || !account) return;
    setBusy(true); setMessage("");
    try {
      const challenge = await postJson<{ challengeId: string; message: string }>("/api/wallet/links/bitcoin/challenge", { chainRef: network.chainRef, address: account.address });
      const signature = await adapter.signMessage(network, account.address, challenge.message);
      await postJson("/api/wallet/links/bitcoin/verify", { challengeId: challenge.challengeId, signature, signedMessage: challenge.message });
      await loadLinked();
      setMessage("アドレスを連携しました（非公開です）。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "address_cannot_sign" ? "このアドレスの種類は連携できません。" : code === "wallet_linked_elsewhere" ? "このアドレスはすでに別のアカウントに連携されています。" : code === "bad_signature" ? "署名を確認できませんでした。ウォレットの署名方式（BIP-322）に対応していない可能性があります。" : describeError(error));
    } finally { setBusy(false); }
  }

  async function prepare() {
    if (!account) return;
    setBusy(true); setMessage(""); setSentTxid("");
    try {
      const sats = parseBtc(amount);
      if (sats === null) throw new BitcoinSendError("invalid_amount");
      const [utxoData, feeData] = await Promise.all([
        getJson<{ utxos: SpendableUtxo[] }>(`/api/wallet/bitcoin?view=utxos&chainRef=${encodeURIComponent(network.chainRef)}&address=${encodeURIComponent(account.address)}`),
        getJson<Fees>(`/api/wallet/bitcoin?view=fees&chainRef=${encodeURIComponent(network.chainRef)}`),
      ]);
      setFees(feeData);
      const feeRate = feeData[feePreset];
      const send = buildBitcoinSend({ chainRef: network.chainRef, from: account.address, to: to.trim(), amountSats: sats, utxos: utxoData.utxos, feeRate, publicKeyHex: account.publicKey ?? undefined });
      setBuilt({ send, feeRate });
    } catch (error) { setBuilt(null); setMessage(describeError(error)); } finally { setBusy(false); }
  }

  async function confirmSend() {
    if (!adapter || !account || !built) return;
    setBusy(true); setMessage("");
    try {
      const signedPsbt = await adapter.signPsbt(network, account.address, built.send.psbtBase64, built.send.summary.inputCount);
      // Re-check what the wallet signed against what the user saw, before anything leaves this page.
      verifySignedBitcoinSend({ psbtBase64: signedPsbt }, built.send.expected);
      const result = await postJson<{ txid: string }>("/api/wallet/bitcoin", { chainRef: network.chainRef, from: account.address, psbtBase64: signedPsbt, expected: built.send.expected });
      setSentTxid(result.txid); setBuilt(null); setAmount(""); setTo("");
      await refresh(account.address);
    } catch (error) { setMessage(describeError(error)); } finally { setBusy(false); }
  }

  return (
    <section className={styles.panel} aria-labelledby="bitcoin-wallet-title">
      <h3 id="bitcoin-wallet-title" className={styles.title}>Bitcoin</h3>
      <p className={styles.note}>外部ウォレットで署名します。Hubは鍵を作らず、保管せず、復元もしません。ウォレットはBIP-322に対応している必要があります。</p>

      <label className={styles.field}>
        <span>ネットワーク</span>
        <select className={styles.input} value={network.chainRef} onChange={(event) => setNetwork(networks.find((entry) => entry.chainRef === event.target.value) ?? network)}>
          {networks.map((entry) => <option key={entry.chainRef} value={entry.chainRef}>{entry.name}{entry.testnet ? "（テストネット）" : ""}</option>)}
        </select>
      </label>
      {network.testnet ? <p className={styles.badge}>テストネット：価値のないコインです</p> : <p className={styles.warning}>メインネットです。実際の資産が動きます。</p>}

      <div className={styles.row}>
        {BITCOIN_WALLET_ADAPTERS.map((candidate) => (
          <button key={candidate.id} type="button" className={styles.action} disabled={busy || !candidate.isAvailable()} onClick={() => void connect(candidate)}>
            {candidate.label}{candidate.isAvailable() ? "で接続" : "（未検出）"}
          </button>
        ))}
      </div>

      {account ? (
        <div className={styles.connected}>
          {accounts.length > 1 ? (
            <select className={styles.input} value={selected} onChange={(event) => { const index = Number(event.target.value); setSelected(index); setBuilt(null); void refresh(accounts[index]!.address); }}>
              {accounts.map((item, index) => <option key={item.address} value={index}>{item.address}</option>)}
            </select>
          ) : <span className={styles.address}>{account.address}</span>}
          <dl className={styles.facts}>
            <dt>種類</dt><dd>{parsed?.kind ?? "-"}</dd>
            <dt>承認済み残高</dt><dd>{overview ? `${formatBtc(overview.confirmedSats)} BTC` : "-"}</dd>
            <dt>承認待ち</dt><dd>{overview ? `${formatBtc(overview.pendingSats)} BTC（まだ使えません）` : "-"}</dd>
            <dt>連携</dt><dd>{isLinked ? "連携済み（非公開）" : "未連携"}</dd>
          </dl>
          {!isLinked ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void link()}>署名してアドレスを連携</button> : null}
        </div>
      ) : null}

      {account && isLinked ? (
        taproot ? (
          <p className={styles.warning}>タプルート（bc1p…）アドレスからの送金は、Ordinalsを誤って手放すおそれがあるため、いまは行えません。受け取りと残高の表示はできます。</p>
        ) : (
          <form className={styles.form} onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
            <label className={styles.field}><span>宛先アドレス</span><input className={styles.input} value={to} onChange={(event) => setTo(event.target.value)} autoComplete="off" spellCheck={false} required /></label>
            <label className={styles.field}><span>金額（BTC）</span><input className={styles.input} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0001" required /></label>
            <fieldset className={styles.presets}>
              <legend>手数料の目安</legend>
              {(["slow", "normal", "fast"] as const).map((preset) => (
                <label key={preset} className={styles.preset}><input type="radio" name="fee-preset" checked={feePreset === preset} onChange={() => setFeePreset(preset)} />{preset === "slow" ? "ゆっくり" : preset === "normal" ? "ふつう" : "はやい"}{fees ? `（${fees[preset]} sat/vB）` : ""}</label>
              ))}
            </fieldset>
            <button type="submit" className={styles.action} disabled={busy}>内容を確認する</button>
          </form>
        )
      ) : null}

      {built ? (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="bitcoin-confirm-title">
          <h4 id="bitcoin-confirm-title" className={styles.title}>送金の確認</h4>
          {built.send.summary.testnet ? <p className={styles.badge}>テストネット</p> : null}
          <dl className={styles.facts}>
            <dt>ネットワーク</dt><dd>{built.send.summary.networkName}</dd>
            <dt>送信元</dt><dd className={styles.address}>{built.send.summary.from}</dd>
            <dt>宛先</dt><dd className={styles.address}>{built.send.summary.to}</dd>
            <dt>資産</dt><dd>BTC</dd>
            <dt>金額</dt><dd>{formatBtc(built.send.summary.amountSats)} BTC（{built.send.summary.amountSats} sat）</dd>
            <dt>手数料率</dt><dd>{built.send.summary.feeRate} sat/vB</dd>
            <dt>取引サイズ</dt><dd>約 {built.send.summary.vsize} vB</dd>
            <dt>手数料の合計</dt><dd>{formatBtc(built.send.summary.feeSats)} BTC（{built.send.summary.feeSats} sat）</dd>
            <dt>つり銭</dt><dd>{built.send.summary.changeSats === "0" ? "なし" : `${formatBtc(built.send.summary.changeSats)} BTC（同じアドレスへ）`}</dd>
            <dt>合計引き落とし</dt><dd>{formatBtc(built.send.summary.totalDebitedSats)} BTC</dd>
            <dt>相手が受け取る額</dt><dd>{formatBtc(built.send.summary.amountSats)} BTC</dd>
          </dl>
          <ul className={styles.warnings}>
            <li>送金はHubでも取り消せません。宛先を必ず確かめてください。</li>
            <li>手数料を上げて置き換えられるRBFを有効にしています。</li>
            {built.send.summary.excludedPossibleInscriptions > 0 ? <li>Ordinalsなどを含む可能性のある小額の残高 {built.send.summary.excludedPossibleInscriptions} 件は、使わずに残しました。</li> : null}
          </ul>
          <div className={styles.buttons}>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setBuilt(null)}>戻る</button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => void confirmSend()}>ウォレットで署名して送る</button>
          </div>
        </div>
      ) : null}

      {sentTxid ? <p className={styles.note}>送信しました。取引ID：<a className={styles.link} href={`${network.explorerUrl}/tx/${sentTxid}`} target="_blank" rel="noreferrer noopener">{sentTxid}</a></p> : null}
      {message ? <p className={styles.note} role="status">{message}</p> : null}
    </section>
  );
}
