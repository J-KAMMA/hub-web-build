"use client";

// /v2/wallet のページ内ウォレット面。
// パスキー作成 → アカウントアドレス解決 → 有効化 → 残高・送金。
// 鍵は端末の認証器（WebAuthn）にだけ存在し、Hubサーバーには送らない。
// 送信はすべて NativeWalletHost の承認ダイアログを経る。

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getHubEvmProvider, useHubWallet } from "@/components/hub-wallet-provider";
import { HardwareWalletPanel } from "@/components/hardware-wallet-panel";
import { BitcoinWalletPanel } from "@/components/wallet/bitcoin-wallet-panel";
import { SolanaWalletPanel } from "@/components/wallet/solana-wallet-panel";
import { createWalletPasskey } from "@/lib/wallet/passkey";
import { BUILTIN_NETWORKS, DEFAULT_CHAIN_ID, walletNetwork, type HubWalletNetwork, type HubWalletToken } from "@/lib/wallet/networks";
import { parseNativeAmount } from "@/lib/wallet/transaction";
import { formatNativeQuantity } from "@/lib/wallet/transaction-request";
import { clearNativeWalletState, createInitialWalletState, loadNativeWalletState, recordWalletActivity, saveNativeWalletState, type WalletActivity } from "@/lib/wallet/storage";
import { activateNativeWallet, confirmNativeWalletOperation, defaultBundlerUrl, installNativeWalletProvider } from "@/lib/wallet/native-provider";
import { V2ExternalSend } from "@/components/v2/v2-external-send";
import { chainTag, erc20BalanceOfData, formatTokenQuantity, pad32, shortAddress, shortHash } from "@/components/v2/v2-wallet-format";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ERC20_TRANSFER = "0xa9059cbb";

function erc20TransferData(to: string, amount: bigint): string {
  return `${ERC20_TRANSFER}${pad32(to)}${amount.toString(16).padStart(64, "0")}`;
}

type Phase = "checking" | "empty" | "created" | "connected" | "active";

function errorMessage(error: unknown, japanese: boolean): string {
  const code = error instanceof Error ? error.message : String(error ?? "");
  const table: Record<string, string> = {
    wallet_rejected: japanese ? "承認が拒否されました。" : "Approval was rejected.",
    passkey_creation_cancelled: japanese ? "パスキー作成がキャンセルされました。" : "Passkey creation was cancelled.",
    webauthn_unavailable: japanese ? "この端末ではパスキーが使えません。" : "Passkeys are unavailable on this device.",
    rate_limited: japanese ? "送信が多すぎます。しばらく待ってから試してください。" : "Too many submissions. Wait and try again.",
    bundler_not_configured: japanese ? "バンドラーが未設定です。" : "Bundler is not configured.",
    smart_account_already_deployed: japanese ? "このアカウントは既に有効化されています。" : "This account is already activated.",
    invalid_recipient: japanese ? "宛先アドレスの形式が正しくありません。" : "Invalid recipient address.",
    user_operation_receipt_timeout: japanese ? "確認がタイムアウトしました。" : "Confirmation timed out.",
  };
  return table[code] ?? (japanese ? `失敗しました（${code.slice(0, 80)}）` : `Failed (${code.slice(0, 80)})`);
}

export function V2NativeWallet({ japanese }: { japanese: boolean }) {
  const wallet = useHubWallet();
  const [phase, setPhase] = useState<Phase>("checking");
  const [account, setAccount] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<"" | "create" | "activate" | "send" | "connect">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("native");
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [sentHash, setSentHash] = useState("");
  const [activity, setActivity] = useState<WalletActivity[]>([]);
  const [copied, setCopied] = useState(false);
  const [pendingChain, setPendingChain] = useState<string>(DEFAULT_CHAIN_ID);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const network = useMemo(
    () => walletNetwork(wallet.chainId != null ? `0x${wallet.chainId.toString(16)}` : DEFAULT_CHAIN_ID) ?? walletNetwork(DEFAULT_CHAIN_ID),
    [wallet.chainId],
  );
  const enabledNetworks = useMemo(() => Object.values(BUILTIN_NETWORKS).filter((item) => item.transactionEnabled === true).sort((a, b) => Number(Boolean(a.testnet)) - Number(Boolean(b.testnet))), []);
  const pendingNetworks = useMemo(() => Object.values(BUILTIN_NETWORKS).filter((item) => item.transactionEnabled !== true && item.productionEnabled === true), []);
  const selectedToken = useMemo(
    () => (asset === "native" ? null : network?.tokens?.find((item) => item.address.toLowerCase() === asset.toLowerCase()) ?? null),
    [asset, network],
  );

  const refresh = useCallback(() => {
    const state = loadNativeWalletState();
    if (!state) {
      setPhase("empty");
      setAccount(null);
      setActivity([]);
      return;
    }
    setPendingChain(state.chainId);
    const chainKey = state.chainId;
    const activated = state.activeSmartAccounts[chainKey];
    const resolved = state.smartAccountAddresses[chainKey] ?? null;
    setAccount(activated?.address ?? resolved);
    setActivity(state.activity ?? []);
    setPhase(activated ? "active" : wallet.status === "connected" ? "connected" : "created");
  }, [wallet.status]);

  useEffect(refresh, [refresh]);
  useEffect(() => {
    if (wallet.status === "connected" && wallet.address) {
      const state = loadNativeWalletState();
      if (state?.activeSmartAccounts[state.chainId]?.address?.toLowerCase() === wallet.address.toLowerCase()) {
        setPhase("active");
      } else {
        setPhase("connected");
      }
      setAccount(wallet.address);
    }
  }, [wallet.status, wallet.address]);

  // 残高はアカウントが確定してから読む。有効化前でもデプロイ前アドレスの残高は取れる。
  useEffect(() => {
    if (!account || (phase !== "connected" && phase !== "active")) return;
    let cancelled = false;
    const read = async () => {
      const provider = getHubEvmProvider();
      if (!provider) return;
      const value = await provider.request({ method: "eth_getBalance", params: [account, "latest"] }).catch(() => null);
      if (!cancelled && typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) setBalance(BigInt(value));
      const token = network?.tokens?.[0];
      if (token) {
        const raw = await provider.request({ method: "eth_call", params: [{ to: token.address, data: erc20BalanceOfData(account) }, "latest"] }).catch(() => null);
        if (!cancelled && typeof raw === "string" && /^0x[0-9a-fA-F]+$/.test(raw)) setTokenBalance(BigInt(raw));
      }
    };
    void read();
    const timer = setInterval(read, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [account, phase, network]);

  const run = useCallback(async (key: typeof busy, work: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (reason) {
      setError(errorMessage(reason, japanese));
    } finally {
      setBusy("");
      refresh();
    }
  }, [japanese, refresh]);

  const create = () => run("create", async () => {
    const passkey = await createWalletPasskey();
    const state = createInitialWalletState(passkey, pendingChain);
    state.bundlerUrls[state.chainId] = defaultBundlerUrl(state.chainId);
    saveNativeWalletState(state);
    installNativeWalletProvider();
    setNotice(japanese ? "パスキーを作成しました。アカウントアドレスを解決します。" : "Passkey created. Resolving account address.");
    if (!(await wallet.connect("smart"))) throw new Error(wallet.error || "wallet_connect_failed");
  });

  const connect = () => run("connect", async () => {
    if (!(await wallet.connect("smart"))) throw new Error(wallet.error || "wallet_connect_failed");
  });

  const activate = () => run("activate", async () => {
    setNotice(japanese ? "有効化を送信しています。承認ダイアログで内容を確認してください。" : "Submitting activation — confirm in the approval dialog.");
    const userOpHash = await activateNativeWallet();
    setNotice(japanese ? "送信しました。オンチェーン確認を待っています。" : "Submitted. Waiting for on-chain confirmation.");
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 45; attempt += 1) {
      try {
        const confirmed = await confirmNativeWalletOperation(userOpHash);
        const state = loadNativeWalletState();
        if (state?.activeSmartAccounts[state.chainId]) {
          state.activeSmartAccounts[state.chainId].transactionHash = confirmed.transactionHash;
          saveNativeWalletState(recordWalletActivity(state, {
            kind: "activate",
            chainId: state.chainId,
            transactionHash: confirmed.transactionHash,
            at: new Date().toISOString(),
          }));
        }
        setNotice(japanese ? "有効化を確認しました。" : "Activation confirmed.");
        setPhase("active");
        return;
      } catch (reason) {
        lastError = reason;
        await new Promise((resolve) => setTimeout(resolve, 4_000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("user_operation_receipt_timeout");
  });

  const switchChain = (next: string) => run("connect", async () => {
    await wallet.switchChain(Number(BigInt(next)));
    if (!(await wallet.connect("smart"))) throw new Error(wallet.error || "wallet_connect_failed");
  });

  const send = () => run("send", async () => {
    const target = to.trim();
    if (!ADDRESS.test(target)) throw new Error("invalid_recipient");
    const provider = getHubEvmProvider();
    let userOpHash: `0x${string}`;
    let symbol = network?.nativeCurrency.symbol ?? "";
    let amountText = amount.trim();
    if (selectedToken) {
      if (!provider) throw new Error("wallet_unavailable");
      const value = parseNativeAmount(amountText, selectedToken.decimals);
      symbol = selectedToken.symbol;
      userOpHash = await provider.request({ method: "eth_sendTransaction", params: [{ to: selectedToken.address, data: erc20TransferData(target, value) }] }) as `0x${string}`;
    } else {
      const value = parseNativeAmount(amountText, network?.nativeCurrency.decimals ?? 18);
      userOpHash = await wallet.sendNativeTransaction(target, `0x${value.toString(16)}`);
    }
    setNotice(japanese ? "送信しました。オンチェーン確認を待っています。" : "Submitted. Waiting for on-chain confirmation.");
    const submission = await wallet.resolveTransactionSubmission(userOpHash);
    const state = loadNativeWalletState();
    if (state) {
      saveNativeWalletState(recordWalletActivity(state, {
        kind: "send",
        chainId: state.chainId,
        transactionHash: submission.transactionHash,
        to: target.toLowerCase(),
        amount: amountText,
        symbol,
        at: new Date().toISOString(),
      }));
    }
    setSentHash(submission.transactionHash);
    setNotice(japanese ? "送金を確認しました。" : "Transfer confirmed.");
    setTo("");
    setAmount("");
    setBalance(null);
  });

  const remove = () => {
    if (!window.confirm(japanese ? "この端末のウォレット情報を削除しますか？パスキーとアカウントの対応が失われ、復元には新しいパスキーの署名者追加が必要です。" : "Remove this device's wallet info? The passkey-account mapping is lost.")) return;
    clearNativeWalletState();
    wallet.hide();
    setPhase("empty");
    setAccount(null);
    setBalance(null);
    setActivity([]);
  };

  const copyAddress = () => {
    if (!account) return;
    void navigator.clipboard?.writeText(account).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    });
  };

  const fillMax = () => {
    const source = selectedToken ? tokenBalance : balance;
    if (source == null || !network) return;
    if (selectedToken) {
      setAmount(formatTokenQuantity(source, selectedToken).replace(` ${selectedToken.symbol}`, ""));
    } else {
      const scale = 10n ** BigInt(network.nativeCurrency.decimals);
      const whole = source / scale;
      const fraction = (source % scale).toString().padStart(network.nativeCurrency.decimals, "0").replace(/0+$/, "");
      setAmount(`${whole}${fraction ? `.${fraction}` : ""}`);
    }
  };

  const explorerTx = (hash: string) => network?.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : null;
  const explorerAccount = account && network?.explorerUrl ? `${network.explorerUrl}/address/${account}` : null;
  const activityForChain = useMemo(
    () => activity.filter((item) => item.chainId === network?.chainId).slice(0, 8),
    [activity, network],
  );
  const chainChips = (selected: string, onPick: (chainId: string) => void, interactive: boolean) => (
    <ul className="v2-wallet__chains" role="listbox" aria-label={japanese ? "ネットワーク" : "Network"}>
      {enabledNetworks.map((item) => (
        <li key={item.chainId}>
          <button
            type="button"
            role="option"
            aria-selected={item.chainId === selected}
            className={`v2-wallet__chain ${item.chainId === selected ? "v2-wallet__chain--on" : ""}`}
            disabled={!interactive || busy !== "" || item.chainId === selected}
            onClick={() => onPick(item.chainId)}
          >
            <span className="v2-wallet__chain-dot" aria-hidden>{item.nativeCurrency.symbol.slice(0, 1)}</span>
            {item.name}
            {item.testnet ? <span className="v2-wallet__chain-tag">{japanese ? "テスト" : "test"}</span> : null}
          </button>
        </li>
      ))}
      {pendingNetworks.map((item) => (
        <li key={item.chainId}>
          <span className="v2-wallet__chain v2-wallet__chain--pending" aria-disabled="true" title={item.transactionDisabledReason ?? undefined}>
            <span className="v2-wallet__chain-dot" aria-hidden>{item.nativeCurrency.symbol.slice(0, 1)}</span>
            {item.name}
            <span className="v2-wallet__chain-tag">{japanese ? "準備中" : "soon"}</span>
          </span>
        </li>
      ))}
    </ul>
  );

  const stepIndex = phase === "empty" ? 0 : phase === "created" ? 1 : phase === "connected" ? 2 : 3;
  const steps = japanese
    ? ["パスキー作成", "アドレス解決", "有効化", "使える"]
    : ["Passkey", "Address", "Activation", "Ready"];

  return (
    <div className="v2-wallet">
      <p className="v2-note">
        {japanese
          ? "パスキー＋スマートアカウントの非カストディアル・ウォレット。鍵はこの端末の認証器にだけ存在し、Hubサーバーには送られません。"
          : "A non-custodial passkey smart-account wallet. Keys live only in this device's authenticator and never reach Hub servers."}
      </p>

      {phase !== "checking" && phase !== "empty" ? (
        <ol className="v2-wallet__steps-flow" aria-label={japanese ? "セットアップの段階" : "Setup steps"}>
          {steps.map((label, index) => (
            <li key={label} className={`v2-wallet__step ${index < stepIndex ? "v2-wallet__step--done" : ""} ${index === Math.min(stepIndex, 2) && phase !== "active" ? "v2-wallet__step--now" : ""}`}>
              <span className="v2-wallet__step-dot" aria-hidden>{index < stepIndex || phase === "active" ? "✓" : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      ) : null}

      {phase === "checking" ? (
        <section className="v2-wallet__card" aria-busy="true">
          <p className="v2-note">{japanese ? "確認しています…" : "Checking…"}</p>
        </section>
      ) : null}

      {phase === "empty" ? (
        <section className="v2-wallet__card v2-wallet__card--hero" aria-labelledby="v2-wallet-create">
          <h2 id="v2-wallet-create" className="v2-wallet__hero-title">{japanese ? "パスキーではじめる" : "Start with a passkey"}</h2>
          <p className="v2-note">{japanese ? "この端末の認証器で鍵を作り、そこからスマートアカウントのアドレスを導きます。種フレーズはありません。" : "Create a key in this device's authenticator and derive a smart-account address. No seed phrase."}</p>
          <p className="v2-wallet__hero-label">{japanese ? "開始するネットワーク" : "Starting network"}</p>
          {chainChips(pendingChain, setPendingChain, true)}
          <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy !== ""} onClick={create}>
            {busy === "create" ? (japanese ? "作成しています…" : "Creating…") : (japanese ? "パスキーで作成" : "Create with passkey")}
          </button>
        </section>
      ) : null}

      {phase === "created" ? (
        <section className="v2-wallet__card v2-wallet__card--hero" aria-labelledby="v2-wallet-connect">
          <h2 id="v2-wallet-connect" className="v2-wallet__hero-title">{japanese ? "アドレスを解決" : "Resolve address"}</h2>
          <p className="v2-note">{japanese ? "パスキーは作成済みです。ファクトリからアカウントアドレスを導きます。" : "Passkey created. Derive the account address from the factory."}</p>
          {chainChips(pendingChain, setPendingChain, false)}
          <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy !== ""} onClick={connect}>
            {busy === "connect" ? (japanese ? "解決しています…" : "Resolving…") : (japanese ? "アドレスを解決" : "Resolve address")}
          </button>
        </section>
      ) : null}

      {account && (phase === "connected" || phase === "active") ? (
        <section className="v2-wallet__card v2-wallet__card--hero" aria-labelledby="v2-wallet-account">
          <div className="v2-wallet__hero-top">
            <span className={`v2-wallet__net-badge ${network?.testnet ? "v2-wallet__net-badge--testnet" : ""}`}>
              {network?.name}
              <span className="v2-wallet__net-kind">{chainTag(network, japanese)}</span>
            </span>
            {phase === "active"
              ? <span className="v2-wallet__status v2-wallet__status--on">{japanese ? "有効" : "Active"}</span>
              : <span className="v2-wallet__status">{japanese ? "未デプロイ" : "Not deployed"}</span>}
          </div>
          <p className="v2-wallet__hero-label">{japanese ? "残高" : "Balance"}</p>
          <p className="v2-wallet__hero-balance">
            {balance != null
              ? <>{formatNativeQuantity(balance, network).replace(` ${network?.nativeCurrency.symbol ?? ""}`, "")}<span className="v2-wallet__hero-symbol"> {network?.nativeCurrency.symbol}</span></>
              : <span className="v2-wallet__hero-loading">{japanese ? "読み込み中…" : "Loading…"}</span>}
          </p>
          <p className="v2-wallet__hero-address">
            <code title={account}>{shortAddress(account)}</code>
            <button type="button" className="v2-wallet__mini" onClick={copyAddress}>{copied ? (japanese ? "コピー済み" : "Copied") : (japanese ? "コピー" : "Copy")}</button>
            {explorerAccount ? <a className="v2-wallet__mini" href={explorerAccount} target="_blank" rel="noreferrer">{japanese ? "エクスプローラー" : "Explorer"}</a> : null}
          </p>
          {chainChips(network?.chainId ?? DEFAULT_CHAIN_ID, (next) => void switchChain(next), true)}
        </section>
      ) : null}

      {account && (phase === "connected" || phase === "active") && network?.tokens?.length ? (
        <section className="v2-wallet__card" aria-labelledby="v2-wallet-assets">
          <header className="v2-wallet__card-head"><h2 id="v2-wallet-assets">{japanese ? "保有資産" : "Assets"}</h2></header>
          <ul className="v2-wallet__assets">
            <li className="v2-wallet__asset">
              <span className="v2-wallet__asset-mark" aria-hidden>{network.nativeCurrency.symbol.slice(0, 2)}</span>
              <span className="v2-wallet__asset-body">
                <strong>{network.nativeCurrency.name}</strong>
                <small>{network.nativeCurrency.symbol}</small>
              </span>
              <span className="v2-wallet__asset-balance">{balance != null ? formatNativeQuantity(balance, network) : "—"}</span>
            </li>
            {network.tokens.map((token) => (
              <li className="v2-wallet__asset" key={token.address}>
                <span className="v2-wallet__asset-mark" aria-hidden>{token.symbol.slice(0, 2)}</span>
                <span className="v2-wallet__asset-body">
                  <strong>{token.name}</strong>
                  <small>{token.symbol}</small>
                </span>
                <span className="v2-wallet__asset-balance">{tokenBalance != null ? formatTokenQuantity(tokenBalance, token) : "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {phase === "connected" ? (
        <section className="v2-wallet__card" aria-labelledby="v2-wallet-activate">
          <header className="v2-wallet__card-head"><h2 id="v2-wallet-activate">{japanese ? "有効化" : "Activation"}</h2></header>
          <p className="v2-note">{japanese ? "アカウントはまだオンチェーンにデプロイされていません。最初のUserOperationで作成します（ネットワーク料金はHubのバンドラーが立て替えます）。" : "The account is not deployed yet. The first UserOperation creates it (Hub's bundler fronts the network fee)."}</p>
          <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy !== ""} onClick={activate}>
            {busy === "activate" ? (japanese ? "有効化しています…" : "Activating…") : (japanese ? "ウォレットを有効化" : "Activate wallet")}
          </button>
        </section>
      ) : null}

      {phase === "active" ? (
        <section className="v2-wallet__card" aria-labelledby="v2-wallet-send">
          <header className="v2-wallet__card-head"><h2 id="v2-wallet-send">{japanese ? "送金" : "Send"}</h2></header>
          <div className="v2-wallet__form">
            <div className="v2-wallet__field">
              <span className="v2-wallet__field-label">{japanese ? "資産" : "Asset"}</span>
              <div className="v2-wallet__segments" role="radiogroup" aria-label={japanese ? "資産" : "Asset"}>
                <button type="button" role="radio" aria-checked={asset === "native"} className={`v2-wallet__segment ${asset === "native" ? "v2-wallet__segment--on" : ""}`} onClick={() => setAsset("native")}>
                  {network?.nativeCurrency.symbol}
                </button>
                {network?.tokens?.map((token) => (
                  <button key={token.address} type="button" role="radio" aria-checked={asset === token.address} className={`v2-wallet__segment ${asset === token.address ? "v2-wallet__segment--on" : ""}`} onClick={() => setAsset(token.address)}>
                    {token.symbol}
                  </button>
                ))}
              </div>
            </div>
            <label className="v2-wallet__field">
              <span className="v2-wallet__field-label">{japanese ? "宛先アドレス" : "Recipient"}</span>
              <input className="v2-wallet__input v2-wallet__input--mono" type="text" value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" maxLength={42} />
            </label>
            <label className="v2-wallet__field">
              <span className="v2-wallet__field-label">
                {japanese ? "金額" : "Amount"}
                <span className="v2-wallet__field-unit">{selectedToken?.symbol ?? network?.nativeCurrency.symbol}</span>
              </span>
              <span className="v2-wallet__amount-row">
                <input className="v2-wallet__input" type="text" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.0" inputMode="decimal" autoComplete="off" maxLength={40} />
                <button type="button" className="v2-wallet__mini" disabled={(selectedToken ? tokenBalance : balance) == null} onClick={fillMax}>MAX</button>
              </span>
            </label>
            <button type="button" className="v2-button v2-button--primary v2-wallet__cta" disabled={busy !== "" || !ADDRESS.test(to.trim()) || !amount.trim()} onClick={send}>
              {busy === "send" ? (japanese ? "送信しています…" : "Sending…") : (japanese ? "送る" : "Send")}
            </button>
            <p className="v2-wallet__form-note">{japanese ? "送信前に承認ダイアログで内容と最大料金を確認します。" : "You review the details and maximum fee in an approval dialog before sending."}</p>
          </div>
          {sentHash && explorerTx(sentHash) ? (
            <p className="v2-note">{japanese ? "直近の取引" : "Latest transaction"}: <a className="v2-card__link" href={explorerTx(sentHash) ?? ""} target="_blank" rel="noreferrer"><code>{shortHash(sentHash)}</code></a></p>
          ) : null}
        </section>
      ) : null}

      <V2ExternalSend japanese={japanese} />

      {activityForChain.length > 0 ? (
        <section className="v2-wallet__card" aria-labelledby="v2-wallet-activity">
          <header className="v2-wallet__card-head"><h2 id="v2-wallet-activity">{japanese ? "アクティビティ" : "Activity"}</h2></header>
          <ul className="v2-wallet__activity-list">
            {activityForChain.map((item) => (
              <li className="v2-wallet__activity-item" key={item.transactionHash}>
                <span className={`v2-wallet__activity-icon ${item.kind === "activate" ? "v2-wallet__activity-icon--activate" : ""}`} aria-hidden>
                  {item.kind === "activate" ? "✓" : "↑"}
                </span>
                <span className="v2-wallet__activity-body">
                  <strong>{item.kind === "activate" ? (japanese ? "アカウント有効化" : "Account activation") : (japanese ? "送金" : "Sent")}</strong>
                  <small>
                    {item.kind === "send" && item.to ? `${shortAddress(item.to)} · ` : ""}
                    {new Date(item.at).toLocaleDateString(japanese ? "ja-JP" : "en-US", { month: "short", day: "numeric" })}
                  </small>
                </span>
                <span className="v2-wallet__activity-right">
                  {item.amount && item.symbol ? <span className="v2-wallet__activity-amount">−{item.amount} {item.symbol}</span> : null}
                  {explorerTx(item.transactionHash) ? <a className="v2-wallet__mini" href={explorerTx(item.transactionHash) ?? ""} target="_blank" rel="noreferrer">{shortHash(item.transactionHash)}</a> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {notice ? <p className="v2-wallet__notice" role="status">{notice}</p> : null}
      {error ? <p className="v2-note v2-note--error" role="alert">{error}</p> : null}

      <HardwareWalletPanel />
      <BitcoinWalletPanel />
      <SolanaWalletPanel />
      <section className="v2-wallet__card" aria-labelledby="v2-wallet-links">
        <header className="v2-wallet__card-head"><h2 id="v2-wallet-links">{japanese ? "関連" : "Related"}</h2></header>
        <ul className="v2-account__areas">
          <li><Link href="/v2/account/payment"><strong>{japanese ? "支払いと売上" : "Payments and sales"}</strong><span>{japanese ? "ウォレットを署名でプロフィールへ連携（チップ・ランキング用）、注文・売上の管理" : "Link the address to your profile by signature"}</span></Link></li>
          <li><Link href="/v2/wallet/tax"><strong>{japanese ? "税務" : "Tax"}</strong><span>{japanese ? "取引の税務整理" : "Tax records for transactions"}</span></Link></li>
        </ul>
        {phase !== "empty" && phase !== "checking" ? (
          <p className="v2-wallet__danger-zone">
            <button type="button" className="v2-button v2-button--text" onClick={remove}>{japanese ? "この端末のウォレット情報を削除" : "Remove wallet info from this device"}</button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
