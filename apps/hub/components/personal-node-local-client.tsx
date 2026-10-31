"use client";

import { useEffect, useState } from "react";
import {
  createEncryptedRecoveryKey,
  createLocalRootKey,
  deleteLocalRootKey,
  readLocalRootKey,
  signWithLocalRootKey,
  type EncryptedRecoveryKey,
} from "@/lib/personal-node-local-keystore";

type LocalRoot = Awaited<ReturnType<typeof readLocalRootKey>>;

export function PersonalNodeLocalClient({
  locale,
  nodeStatus,
  onRegistered,
}: {
  locale: "ja" | "en";
  nodeStatus: "loading" | "unregistered" | "active" | "revoked";
  onRegistered: () => Promise<void>;
}) {
  const ja = locale === "ja";
  const [localRoot, setLocalRoot] = useState<LocalRoot>(null);
  const [nodeUrl, setNodeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryLabel, setRecoveryLabel] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [eraseConfirmation, setEraseConfirmation] = useState("");

  useEffect(() => {
    void readLocalRootKey()
      .then(setLocalRoot)
      .catch(() => setMessage(ja ? "このブラウザでは端末鍵を利用できません。" : "Local device keys are unavailable."));
  }, [ja]);

  async function createAndRegister() {
    if (nodeStatus !== "unregistered") return;
    if (!nodeUrl.trim()) {
      setMessage(ja ? "Node URLを入力してください。" : "Enter the node URL.");
      return;
    }
    setBusy(true);
    try {
      const root = localRoot ?? await createLocalRootKey();
      setLocalRoot(root);
      const challengeResponse = await postAction({
        action: "challenge",
        nodeUrl: nodeUrl.trim(),
        publicKeyJwk: root.publicKeyJwk,
      });
      if (!challengeResponse.ok) throw new Error("challenge_failed");
      const challenge = await challengeResponse.json() as { challengeId: string; challenge: string };
      const signature = await signWithLocalRootKey(challenge.challenge);
      const registrationResponse = await postAction({
        action: "register",
        challengeId: challenge.challengeId,
        signature,
      });
      if (!registrationResponse.ok) throw new Error("registration_failed");
      setMessage(ja
        ? "この端末の鍵でPersonal Nodeを登録しました。秘密鍵は端末外へ送信していません。"
        : "Personal Node registered with this device key. The private key never left this device.");
      await onRegistered();
    } catch (error) {
      setMessage(localError(error, ja));
    } finally {
      setBusy(false);
    }
  }

  async function downloadRecoveryKey() {
    setBusy(true);
    try {
      const bundle = await createEncryptedRecoveryKey(recoveryLabel, passphrase);
      downloadJson(bundle, `hub-personal-node-recovery-${Date.now()}.json`);
      setRecoveryLabel("");
      setPassphrase("");
      setMessage(ja
        ? "暗号化した復旧鍵を保存しました。パスフレーズとファイルは別々の場所で保管してください。"
        : "Encrypted recovery key saved. Keep its file and passphrase in separate locations.");
    } catch (error) {
      setMessage(localError(error, ja));
    } finally {
      setBusy(false);
    }
  }

  async function eraseLocalKey() {
    if (eraseConfirmation !== "ERASE") return;
    setBusy(true);
    try {
      await deleteLocalRootKey();
      setLocalRoot(null);
      setEraseConfirmation("");
      setMessage(ja
        ? "このブラウザのルート鍵を削除しました。Hub上の登録状態は変更していません。"
        : "The local root key was erased. The Hub registration status is unchanged.");
    } catch (error) {
      setMessage(localError(error, ja));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-labelledby="personal-node-device-client-title">
      <div className="settings-note">
        <strong id="personal-node-device-client-title">
          {ja ? "この端末をPersonal Nodeとして使う" : "Use this device as a Personal Node"}
        </strong>
        <p>{ja
          ? "ルート秘密鍵はこのブラウザの保護領域に非抽出鍵として保存され、Hubへ送信されません。ブラウザのデータを消す前に復旧設定を完了してください。"
          : "The root private key is stored as a non-extractable key in this browser and is never sent to Hub. Configure recovery before clearing browser data."}</p>
      </div>

      <div className="setting-row">
        <span>
          <strong>{ja ? "端末鍵" : "Device key"}</strong>
          <small>{localRoot
            ? `${ja ? "作成済み" : "Created"} · ${new Date(localRoot.createdAt).toLocaleString(locale)}`
            : ja ? "未作成" : "Not created"}</small>
        </span>
        <span>{localRoot ? "P-256" : "—"}</span>
      </div>

      {nodeStatus === "unregistered" ? (
        <>
          <label className="setting-row">
            <span>
              <strong>Node URL</strong>
              <small>{ja ? "公開するPersonal NodeのHTTPS URL" : "Public HTTPS URL for this Personal Node"}</small>
            </span>
            <input
              value={nodeUrl}
              onChange={(event) => setNodeUrl(event.target.value)}
              placeholder="https://node.example/"
              inputMode="url"
              autoComplete="url"
            />
          </label>
          <button type="button" disabled={busy || !nodeUrl.trim()} onClick={() => void createAndRegister()}>
            {busy ? (ja ? "処理中…" : "Working…") : (ja ? "端末鍵を作成して登録" : "Create key and register")}
          </button>
        </>
      ) : nodeStatus === "active" ? (
        <>
          <div className="settings-note">
            <strong>{ja ? "オフライン復旧鍵" : "Offline recovery key"}</strong>
            <p>{ja
              ? "ここで作る鍵は端末内に保存せず、暗号化ファイルとしてダウンロードします。最低2個を別々の媒体に保存し、公開鍵だけを下の復旧設定へ登録してください。"
              : "This key is not stored on the device. It is downloaded as an encrypted file. Create at least two on separate media and register only their public keys below."}</p>
          </div>
          <label className="setting-row">
            <span><strong>{ja ? "保管場所の名前" : "Storage label"}</strong><small>{ja ? "例：自宅USB" : "Example: Home USB"}</small></span>
            <input value={recoveryLabel} onChange={(event) => setRecoveryLabel(event.target.value)} />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "暗号化パスフレーズ" : "Encryption passphrase"}</strong><small>{ja ? "16文字以上" : "At least 16 characters"}</small></span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button type="button" disabled={busy || passphrase.length < 16} onClick={() => void downloadRecoveryKey()}>
            {ja ? "暗号化した復旧鍵を保存" : "Save encrypted recovery key"}
          </button>
        </>
      ) : null}

      {localRoot ? (
        <details>
          <summary>{ja ? "この端末の鍵を消去" : "Erase this device key"}</summary>
          <div className="settings-note" role="alert">
            <strong>{ja ? "先に復旧可能性を確認してください" : "Verify recovery first"}</strong>
            <p>{ja
              ? "消去後は元に戻せません。Hub上のPersonal Node登録は自動では失効しないため、復旧鍵または別端末がないと操作不能になります。"
              : "Erasure cannot be undone. It does not revoke the Hub registration, so recovery keys or another device are required to regain control."}</p>
          </div>
          <label className="setting-row">
            <span><strong>{ja ? "ERASE と入力" : "Type ERASE"}</strong></span>
            <input
              value={eraseConfirmation}
              onChange={(event) => setEraseConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            disabled={busy || eraseConfirmation !== "ERASE"}
            onClick={() => void eraseLocalKey()}
          >
            {ja ? "このブラウザの鍵だけを消去" : "Erase only this browser key"}
          </button>
        </details>
      ) : null}

      <p className="settings-note" role="status" aria-live="polite">{message}</p>
    </section>
  );
}

function postAction(body: Record<string, unknown>) {
  return fetch("/api/core/personal-node", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function downloadJson(bundle: EncryptedRecoveryKey, filename: string) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function localError(error: unknown, ja: boolean): string {
  const code = error instanceof Error ? error.message : "unknown";
  if (code === "local_root_key_exists") {
    return ja ? "この端末にはすでにルート鍵があります。" : "This device already has a root key.";
  }
  if (code === "recovery_passphrase_too_short") {
    return ja ? "パスフレーズは16文字以上にしてください。" : "Use a passphrase of at least 16 characters.";
  }
  if (code === "local_keystore_unavailable") {
    return ja ? "このブラウザでは安全な端末鍵を利用できません。" : "Secure local keys are unavailable in this browser.";
  }
  return ja ? "処理を完了できませんでした。状態を確認して再試行してください。" : "The operation could not be completed. Check the state and retry.";
}
