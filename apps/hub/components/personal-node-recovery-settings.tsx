"use client";

import { useEffect, useState } from "react";
import {
  createPendingRecoveryRootKey,
  discardPendingRecoveryRootKey,
  promotePendingRecoveryRootKey,
  recoveryKeyThumbprint,
  signWithEncryptedRecoveryKey,
  signWithLocalRootKey,
  signWithPendingRecoveryRootKey,
  type EncryptedRecoveryKey,
} from "@/lib/personal-node-local-keystore";

type RecoveryState = {
  recovery: {
    config: { threshold: number; version: number; status: string };
    keys: Array<{ recoveryKeyId: string; label: string; keyThumbprint: string; status: string }>;
  } | null;
};

type SetupChallenge = {
  setupId: string;
  challenge: string;
  expiresAt: string;
  threshold: number;
  keys: Array<{ recoveryKeyId: string; label: string; keyThumbprint: string }>;
};

type RecoveryChallenge = {
  recoveryId: string;
  challenge: string;
  expiresAt: string;
  threshold: number;
  recoveryKeys: Array<{ recoveryKeyId: string; label: string; keyThumbprint: string }>;
  oldKeyThumbprint: string;
  newKeyThumbprint: string;
  revokedDeviceCount: number;
};

export function PersonalNodeRecoverySettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [state, setState] = useState<RecoveryState>({ recovery: null });
  const [keysText, setKeysText] = useState(JSON.stringify([
    { label: ja ? "復旧鍵1" : "Recovery key 1", publicKeyJwk: {} },
    { label: ja ? "復旧鍵2" : "Recovery key 2", publicKeyJwk: {} },
  ], null, 2));
  const [threshold, setThreshold] = useState(2);
  const [setup, setSetup] = useState<SetupChallenge | null>(null);
  const [setupSignature, setSetupSignature] = useState("");
  const [newRootText, setNewRootText] = useState("");
  const [recovery, setRecovery] = useState<RecoveryChallenge | null>(null);
  const [recoverySignatures, setRecoverySignatures] = useState<Record<string, string>>({});
  const [recoveryBundles, setRecoveryBundles] = useState<Record<string, EncryptedRecoveryKey>>({});
  const [recoveryPassphrases, setRecoveryPassphrases] = useState<Record<string, string>>({});
  const [newRootSignature, setNewRootSignature] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [pendingRootPrepared, setPendingRootPrepared] = useState(false);

  async function reload() {
    const response = await fetch("/api/core/personal-node", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.ok) setState(await response.json() as RecoveryState);
  }

  useEffect(() => { void reload(); }, []);

  async function startSetup() {
    const keys = parseJsonArray(keysText);
    if (!keys) {
      setMessage(ja ? "復旧鍵のJSONを確認してください。" : "Check the recovery-key JSON.");
      return;
    }
    const response = await action({
      action: "recovery_setup_start",
      idempotencyKey: crypto.randomUUID(),
      threshold,
      keys,
    });
    if (!response.ok) {
      setMessage(ja ? "復旧設定を準備できません。" : "Could not prepare recovery configuration.");
      return;
    }
    const nextSetup = await response.json() as SetupChallenge;
    setSetup(nextSetup);
    try {
      setSetupSignature(await signWithLocalRootKey(nextSetup.challenge));
      setMessage(ja
        ? "この端末のルート鍵で復旧設定へ署名しました。内容を確認して確定してください。"
        : "Signed the recovery configuration with this device's root key. Review and confirm it.");
    } catch {
      setMessage(ja ? "設定内容をルート鍵で署名してください。" : "Sign the configuration with the root key.");
    }
  }

  async function completeSetup() {
    if (!setup || !setupSignature.trim()) return;
    const response = await action({
      action: "recovery_setup_complete",
      setupId: setup.setupId,
      signature: setupSignature.trim(),
    });
    if (!response.ok) {
      setMessage(ja ? "復旧設定の署名を確認できません。" : "The recovery configuration signature is invalid.");
      return;
    }
    setSetup(null);
    setSetupSignature("");
    setMessage(ja ? "複数鍵による復旧を設定しました。" : "Threshold recovery configured.");
    await reload();
  }

  async function startRecovery() {
    const newPublicKeyJwk = parseJsonObject(newRootText);
    if (!newPublicKeyJwk) {
      setMessage(ja ? "新しいルート公開JWKを確認してください。" : "Check the new root public JWK.");
      return;
    }
    const response = await action({
      action: "recovery_start",
      idempotencyKey: crypto.randomUUID(),
      newPublicKeyJwk,
    });
    if (!response.ok) {
      setMessage(ja ? "鍵復旧を開始できません。先に復旧鍵を設定してください。" : "Could not start recovery. Configure recovery keys first.");
      return;
    }
    const next = await response.json() as RecoveryChallenge;
    setRecovery(next);
    setRecoverySignatures(Object.fromEntries(next.recoveryKeys.map((key) => [key.recoveryKeyId, ""])));
    try {
      setNewRootSignature(await signWithPendingRecoveryRootKey(next.challenge));
      setMessage(ja
        ? "新しいルート鍵の所有署名を端末内で作成しました。必要数の復旧鍵ファイルを読み込んでください。"
        : "Created the new-root proof locally. Load the required encrypted recovery-key files.");
    } catch {
      setMessage(ja ? "必要数の復旧鍵と、新しいルート鍵で同じ内容を署名してください。" : "Sign the challenge with the required recovery keys and the new root key.");
    }
  }

  async function prepareNewRoot() {
    try {
      const publicKeyJwk = await createPendingRecoveryRootKey();
      setNewRootText(JSON.stringify(publicKeyJwk, null, 2));
      setPendingRootPrepared(true);
      setRecovery(null);
      setNewRootSignature("");
      setMessage(ja
        ? "新しいルート鍵をこの端末に一時作成しました。復旧が成功するまで現在の鍵は置き換えません。"
        : "Created a pending root key on this device. The current key will not be replaced until recovery succeeds.");
    } catch {
      setMessage(ja ? "新しいルート鍵を準備できませんでした。" : "Could not prepare a new root key.");
    }
  }

  async function loadRecoveryBundle(
    recoveryKeyId: string,
    expectedThumbprint: string,
    file: File | undefined,
  ) {
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text()) as EncryptedRecoveryKey;
      const actualThumbprint = await recoveryKeyThumbprint(bundle.publicKeyJwk);
      if (actualThumbprint !== expectedThumbprint) throw new Error("recovery_key_wrong_file");
      setRecoveryBundles((current) => ({ ...current, [recoveryKeyId]: bundle }));
      setMessage(ja
        ? "復旧鍵ファイルの公開鍵が登録内容と一致しました。"
        : "The recovery file public key matches the registered key.");
    } catch {
      setMessage(ja
        ? "この復旧鍵ファイルは選択した登録鍵と一致しません。"
        : "This recovery file does not match the selected registered key.");
    }
  }

  async function signRecoveryBundle(recoveryKeyId: string) {
    if (!recovery) return;
    const bundle = recoveryBundles[recoveryKeyId];
    const passphrase = recoveryPassphrases[recoveryKeyId] ?? "";
    if (!bundle || !passphrase) return;
    try {
      const signature = await signWithEncryptedRecoveryKey(
        bundle,
        passphrase,
        recovery.challenge,
      );
      setRecoverySignatures((current) => ({ ...current, [recoveryKeyId]: signature }));
      setRecoveryPassphrases((current) => ({ ...current, [recoveryKeyId]: "" }));
      setMessage(ja
        ? "復旧鍵で署名しました。復号した秘密鍵とパスフレーズは保持していません。"
        : "Signed with the recovery key. The decrypted private key and passphrase were not retained.");
    } catch {
      setMessage(ja
        ? "復旧鍵を復号・署名できませんでした。パスフレーズを確認してください。"
        : "Could not decrypt or sign with this recovery key. Check the passphrase.");
    }
  }

  async function completeRecovery() {
    if (!recovery || confirmation !== "RECOVER" || !newRootSignature.trim()) return;
    const signatures = Object.entries(recoverySignatures)
      .filter(([, signature]) => signature.trim())
      .map(([recoveryKeyId, signature]) => ({ recoveryKeyId, signature: signature.trim() }));
    if (signatures.length < recovery.threshold) return;
    const response = await action({
      action: "recovery_complete",
      recoveryId: recovery.recoveryId,
      newSignature: newRootSignature.trim(),
      signatures,
    });
    if (!response.ok) {
      setMessage(ja ? "復旧できません。署名数・署名内容・期限を確認してください。" : "Recovery failed. Check signature count, signatures, and expiry.");
      return;
    }
    const receipt = await response.json() as {
      recoveryId: string;
      revokedDeviceCount: number;
      consumedRecoveryKeyCount: number;
    };
    if (pendingRootPrepared) {
      try {
        await promotePendingRecoveryRootKey();
      } catch {
        setMessage(ja
          ? `サーバー側の復旧は完了しましたが、この端末への新鍵確定に失敗しました。Receipt: ${receipt.recoveryId}`
          : `Server recovery completed, but the new local key could not be finalized. Receipt: ${receipt.recoveryId}`);
        return;
      }
    }
    setRecovery(null);
    setNewRootText("");
    setNewRootSignature("");
    setRecoverySignatures({});
    setRecoveryBundles({});
    setRecoveryPassphrases({});
    setConfirmation("");
    setPendingRootPrepared(false);
    setMessage(ja
      ? `復旧しました。端末鍵${receipt.revokedDeviceCount}件と復旧鍵${receipt.consumedRecoveryKeyCount}件を失効しました。Receipt: ${receipt.recoveryId}`
      : `Recovered. Revoked ${receipt.revokedDeviceCount} device keys and consumed ${receipt.consumedRecoveryKeyCount} recovery keys. Receipt: ${receipt.recoveryId}`);
    await reload();
  }

  return (
    <section className="settings-note">
      <strong>{ja ? "ルート鍵の復旧" : "Root-key recovery"}</strong>
      <p>{ja
        ? "Hub運営者によるリセットはできません。事前登録した独立した復旧鍵のうち、設定した数の署名が必要です。復旧鍵は別々の端末・場所で保管してください。"
        : "Hub operators cannot reset the key. Recovery requires the configured threshold of independently stored recovery keys."}</p>

      {state.recovery?.config.status === "active" ? (
        <div className="settings-note">
          <strong>{ja ? "復旧設定済み" : "Recovery configured"}</strong>
          <p>{ja ? "必要署名数" : "Required signatures"}: {state.recovery.config.threshold} / {state.recovery.keys.filter((key) => key.status === "active").length}</p>
          {state.recovery.keys.map((key) => (
            <p key={key.recoveryKeyId}>{key.label} · {key.keyThumbprint} · {key.status}</p>
          ))}
        </div>
      ) : (
        <>
          <label className="setting-row">
            <span><strong>{ja ? "必要署名数" : "Signature threshold"}</strong><small>2–5</small></span>
            <input type="number" min={2} max={5} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "復旧用の公開JWK一覧" : "Recovery public JWK list"}</strong><small>{ja ? "秘密鍵は入力しないでください。" : "Never enter private keys."}</small></span>
            <textarea value={keysText} onChange={(event) => setKeysText(event.target.value)} rows={12} />
          </label>
          <button type="button" onClick={() => void startSetup()}>{ja ? "復旧設定をプレビュー" : "Preview recovery setup"}</button>
          {setup ? (
            <>
              <div className="settings-note" role="alert">
                <strong>{ja ? "設定内容" : "Configuration impact"}</strong>
                <p>{ja ? "必要署名数" : "Threshold"}: {setup.threshold}</p>
                <p>{ja ? "登録鍵数" : "Key count"}: {setup.keys.length}</p>
                <p>{ja ? "期限" : "Expiry"}: {setup.expiresAt}</p>
              </div>
              <textarea value={setup.challenge} readOnly rows={10} />
              <label className="setting-row">
                <span><strong>{ja ? "現在のルート鍵による承認署名" : "Current root approval signature"}</strong></span>
                <textarea value={setupSignature} onChange={(event) => setSetupSignature(event.target.value)} rows={3} />
              </label>
              <button type="button" disabled={!setupSignature.trim()} onClick={() => void completeSetup()}>
                {ja ? "復旧設定を確定" : "Confirm recovery setup"}
              </button>
            </>
          ) : null}
        </>
      )}

      {state.recovery?.config.status === "active" ? (
        <>
          <div className="settings-actions">
            <button type="button" onClick={() => void prepareNewRoot()}>
              {ja ? "この端末に新しいルート鍵を準備" : "Prepare a new root key on this device"}
            </button>
            <button
              type="button"
              onClick={() => void discardPendingRecoveryRootKey().then(() => {
                setNewRootText("");
                setRecovery(null);
                setNewRootSignature("");
                setPendingRootPrepared(false);
              })}
            >
              {ja ? "準備中の鍵を破棄" : "Discard pending key"}
            </button>
          </div>
          <label className="setting-row">
            <span><strong>{ja ? "復旧後の新しいルート公開JWK" : "New root public JWK after recovery"}</strong></span>
            <textarea value={newRootText} onChange={(event) => setNewRootText(event.target.value)} rows={4} />
          </label>
          <button type="button" onClick={() => void startRecovery()}>{ja ? "鍵復旧を開始" : "Start key recovery"}</button>
        </>
      ) : null}

      {recovery ? (
        <>
          <div className="settings-note" role="alert">
            <strong>{ja ? "復旧による影響" : "Recovery impact"}</strong>
            <p>{ja ? "旧鍵" : "Old key"}: {recovery.oldKeyThumbprint}</p>
            <p>{ja ? "新鍵" : "New key"}: {recovery.newKeyThumbprint}</p>
            <p>{ja ? "必要署名数" : "Threshold"}: {recovery.threshold}</p>
            <p>{ja ? "失効する端末鍵" : "Device keys to revoke"}: {recovery.revokedDeviceCount}</p>
            <p>{ja ? "すべての復旧鍵は使用済みになります。復旧後に再設定が必要です。" : "All recovery keys will be consumed and must be configured again."}</p>
            <p>{ja ? "期限" : "Expiry"}: {recovery.expiresAt}</p>
          </div>
          <textarea value={recovery.challenge} readOnly rows={12} />
          {recovery.recoveryKeys.map((key) => (
            <div className="settings-note" key={key.recoveryKeyId}>
              <strong>{key.label}</strong>
              <small>{key.keyThumbprint}</small>
              <label className="setting-row">
                <span><strong>{ja ? "暗号化した復旧鍵ファイル" : "Encrypted recovery-key file"}</strong></span>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void loadRecoveryBundle(
                    key.recoveryKeyId,
                    key.keyThumbprint,
                    event.target.files?.[0],
                  )}
                />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "パスフレーズ" : "Passphrase"}</strong></span>
                <input
                  type="password"
                  value={recoveryPassphrases[key.recoveryKeyId] ?? ""}
                  autoComplete="current-password"
                  onChange={(event) => setRecoveryPassphrases((current) => ({
                    ...current,
                    [key.recoveryKeyId]: event.target.value,
                  }))}
                />
              </label>
              <button
                type="button"
                disabled={!recoveryBundles[key.recoveryKeyId] ||
                  !(recoveryPassphrases[key.recoveryKeyId] ?? "")}
                onClick={() => void signRecoveryBundle(key.recoveryKeyId)}
              >
                {recoverySignatures[key.recoveryKeyId]
                  ? (ja ? "署名済み" : "Signed")
                  : (ja ? "この復旧鍵で署名" : "Sign with this recovery key")}
              </button>
            </div>
          ))}
          <label className="setting-row">
            <span><strong>{ja ? "新しいルート鍵の所有証明署名" : "New root proof-of-possession signature"}</strong></span>
            <textarea value={newRootSignature} onChange={(event) => setNewRootSignature(event.target.value)} rows={3} />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "確認のため RECOVER と入力" : "Type RECOVER to confirm"}</strong></span>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" />
          </label>
          <button
            type="button"
            disabled={confirmation !== "RECOVER" || !newRootSignature.trim()}
            onClick={() => void completeRecovery()}
          >
            {ja ? "ルート鍵を復旧し既存鍵を失効" : "Recover root and revoke existing keys"}
          </button>
        </>
      ) : null}
      <p role="status">{message}</p>
    </section>
  );
}

function action(body: Record<string, unknown>) {
  return fetch("/api/core/personal-node", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function parseJsonArray(value: string): Array<{ label: string; publicKeyJwk: unknown }> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as Array<{ label: string; publicKeyJwk: unknown }> : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value: string): object | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
