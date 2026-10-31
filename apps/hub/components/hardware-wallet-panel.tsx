"use client";

import { useEffect, useState } from "react";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { shortWalletAddress } from "@/lib/hub-wallet";
import { HardwareWalletError, type HardwareAccount, type HardwareDevice } from "@/lib/hardware-wallet";
import { walletConnectErrorMessage } from "@/lib/wallet-request-error";
import { ProfileLinkInline } from "@/components/v2/profile-link-action";
import styles from "./hardware-wallet-panel.module.css";

/** 端末側の失敗を原因ごとの文にする。Trezorの識別子があれば括弧で添え、問い合わせで原因を分けられるようにする。 */
function hardwareErrorMessage(reason: unknown, device: HardwareDevice): string {
  if (!(reason instanceof HardwareWalletError)) return walletConnectErrorMessage(reason);
  const name = device === "trezor" ? "Trezor" : "Ledger";
  const base = (() => {
    switch (reason.message) {
      case "user_rejected": return "端末か確認の窓で取り消されました。";
      case "hardware_bridge_missing": return device === "trezor"
        ? "Trezorに届きませんでした。Trezor Suiteを開くかTrezor Bridgeを入れ、確認の窓を止めていないか確かめてから、もう一度押してください。"
        : "Ledgerに届きませんでした。ChromeかEdgeで開いてください。";
      case "hardware_wallet_disconnected": return `${name}が見つかりません。USBでつなぎ、PINでロックを外してください。ほかのアプリが端末を使っているときは閉じてください。`;
      default: return `${name}との通信に失敗しました。`;
    }
  })();
  return reason.detail ? `${base}（${reason.detail}）` : base;
}

function webHidAvailable() {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

/** ハードウェアウォレット（Ledger / WebHID）。鍵は端末の外に出ず、Hubは保存も復元もしない。 */
export function HardwareWalletPanel() {
  const wallet = useHubWallet();
  const [accounts, setAccounts] = useState<HardwareAccount[]>([]);
  const [selected, setSelected] = useState(0);
  const [device, setDevice] = useState<HardwareDevice>("ledger");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(true);
  const [linked, setLinked] = useState<{ address: string; device: HardwareDevice } | null>(null);
  // 接続中と言えるのは、Hubのウォレットが今もこの住所を使っているときだけ。
  const active = linked && wallet.status === "connected" && wallet.address?.toLowerCase() === linked.address.toLowerCase() ? linked : null;

  useEffect(() => {
    setSupported(webHidAvailable());
  }, []);

  async function detect() {
    setBusy(true);
    setMessage("");
    try {
      const list = await wallet.listHardwareAccounts(device);
      setAccounts(list);
      setSelected(0);
    } catch (reason) {
      setAccounts([]);
      setMessage(hardwareErrorMessage(reason, device));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    const account = accounts[selected];
    if (!account) return;
    setBusy(true);
    setMessage("");
    const ok = await wallet.connectHardware(account.path, device);
    setBusy(false);
    if (ok) setLinked({ address: account.address, device });
    else setMessage("接続できませんでした。端末のロックを解除してください（LedgerはEthereumアプリも開きます。TrezorはTrezor SuiteかBridgeが必要です）。");
  }

  return (
    <section className={styles.panel} aria-labelledby="hardware-wallet-title">
      <h2 id="hardware-wallet-title" className={styles.title}>ハードウェアウォレット</h2>
      <p className={styles.note}>
        LedgerとTrezorを使えます。署名は必ず端末の画面でも確認します。秘密鍵はHubに渡らず、保存されません。残高はHubのサーバーが別に読み取ります。
      </p>
      {active ? (
        <div className={styles.connected} role="status">
          <span>接続中：{shortWalletAddress(active.address)}（{active.device === "trezor" ? "Trezor" : "Ledger"}）。署名や送金のたびに端末で確認します。</span>
          <button type="button" className={styles.secondary} onClick={() => { wallet.hide(); setLinked(null); }}>切断</button>
        </div>
      ) : null}
      {active ? <ProfileLinkInline ja /> : null}
      {!supported && device === "ledger" ? (
        <p className={styles.warning}>このブラウザはWebHIDに対応していません。ChromeかEdgeをお使いください。</p>
      ) : (
        <>
          <fieldset className={styles.list} disabled={busy}>
            <legend className={styles.legend}>端末の種類</legend>
            {(["ledger", "trezor"] as const).map((d) => (
              <label key={d} className={styles.row}>
                <input type="radio" name="hardware-device" checked={device === d} onChange={() => { setDevice(d); setAccounts([]); }} />
                <span>{d === "ledger" ? "Ledger（WebHID）" : "Trezor（Trezor Connect）"}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className={styles.action} onClick={() => void detect()} disabled={busy}>
            {busy ? "確認中…" : "端末を検出して口座を一覧"}
          </button>
          {accounts.length ? (
            <fieldset className={styles.list} disabled={busy}>
              <legend className={styles.legend}>導出パスを選択（先頭5口座）</legend>
              {accounts.map((a) => (
                <label key={a.path} className={styles.row}>
                  <input type="radio" name="hardware-account" checked={selected === a.index} onChange={() => setSelected(a.index)} />
                  <span className={styles.path}>{a.path}</span>
                  <span>{shortWalletAddress(a.address)}</span>
                </label>
              ))}
              <button type="button" className={styles.action} onClick={() => void connect()}>この口座で接続</button>
            </fieldset>
          ) : null}
        </>
      )}
      {message || (wallet.status === "error" && wallet.error) ? (
        <p className={styles.warning} role="alert">{message || wallet.error}</p>
      ) : null}

    </section>
  );
}
