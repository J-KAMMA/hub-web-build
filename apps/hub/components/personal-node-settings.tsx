"use client";

import { useCallback, useEffect, useState } from "react";
import { PersonalNodeRecoverySettings } from "@/components/personal-node-recovery-settings";
import { PersonalNodeRestore } from "@/components/personal-node-restore";
import { PersonalNodeLocalClient } from "@/components/personal-node-local-client";
import { PersonalNodeDevicePairing } from "@/components/personal-node-device-pairing";
import { PersonalNodeVideoSettings } from "@/components/personal-node-video-settings";
import { signWithLocalRootKey } from "@/lib/personal-node-local-keystore";

type Device = {
  deviceId: string;
  label: string;
  deviceType: "mobile" | "computer" | "server" | "backup" | "agent";
  keyThumbprint: string;
  scopes: string[];
  status: "active" | "revoked";
};

type NodeState = {
  node: {
    nodeUrl: string;
    keyThumbprint: string;
    status: "active" | "revoked";
  } | null;
  relays: Array<{ relayUrl: string; priority: number }>;
  devices: Device[];
};

type Challenge = {
  challengeId: string;
  challenge: string;
  expiresAt: string;
};

type Rotation = Challenge & {
  rotationId: string;
  oldKeyThumbprint: string;
  newKeyThumbprint: string;
  revokedDeviceCount: number;
};

const scopeOptions = [
  ["profile:write", "プロフィール更新"],
  ["post:write", "投稿"],
  ["follow:write", "フォロー"],
  ["preference:write", "個人設定"],
  ["agent:delegate", "AIへの委任"],
  ["relay:receive", "Relay受信"],
] as const;

export function PersonalNodeSettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [state, setState] = useState<NodeState>({ node: null, relays: [], devices: [] });
  const [stateLoaded, setStateLoaded] = useState(false);
  const [nodeUrl, setNodeUrl] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [signature, setSignature] = useState("");
  const [relayText, setRelayText] = useState("");
  const [message, setMessage] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [deviceType, setDeviceType] = useState<Device["deviceType"]>("computer");
  const [devicePublicKey, setDevicePublicKey] = useState("");
  const [deviceScopes, setDeviceScopes] = useState<string[]>(["post:write", "relay:receive"]);
  const [deviceChallenge, setDeviceChallenge] = useState<Challenge | null>(null);
  const [deviceSignature, setDeviceSignature] = useState("");
  const [newRootPublicKey, setNewRootPublicKey] = useState("");
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [oldRootSignature, setOldRootSignature] = useState("");
  const [newRootSignature, setNewRootSignature] = useState("");
  const [rotationConfirmation, setRotationConfirmation] = useState("");

  const reload = useCallback(async () => {
    setStateLoaded(false);
    try {
      const response = await fetch("/api/core/personal-node", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("state_unavailable");
      const next = await response.json() as NodeState;
      if (!next || !Object.hasOwn(next, "node") || !Array.isArray(next.relays)
        || next.node !== null && (!next.node || !["active", "revoked"].includes(next.node.status))) {
        throw new Error("invalid_state");
      }
      setState({ ...next, devices: next.devices ?? [] });
      setNodeUrl(next.node?.nodeUrl ?? "");
      setRelayText(next.relays.map((relay) => relay.relayUrl).join("\n"));
      setStateLoaded(true);
    } catch {
      setMessage(ja ? "Personal Nodeの状態を取得できません。" : "Personal Node status is unavailable.");
    }
  }, [ja]);

  useEffect(() => { void reload(); }, [reload]);

  async function createChallenge() {
    if (!stateLoaded || state.node !== null) return;
    const publicKeyJwk = parseJwk(publicKey, setMessage, ja);
    if (!publicKeyJwk) return;
    const response = await postAction({
      action: "challenge",
      nodeUrl,
      publicKeyJwk,
    });
    if (!response.ok) {
      setMessage(ja ? "登録チャレンジを作成できません。" : "Could not create a registration challenge.");
      return;
    }
    setChallenge(await response.json() as Challenge);
    setMessage(ja ? "次の文字列をPersonal Nodeのルート鍵で署名してください。" : "Sign the following text with the root key.");
  }

  async function register() {
    if (!stateLoaded || state.node !== null || !challenge || !signature.trim()) return;
    const response = await postAction({
      action: "register",
      challengeId: challenge.challengeId,
      signature: signature.trim(),
    });
    if (!response.ok) {
      setMessage(ja ? "署名を確認できません。" : "The signature could not be verified.");
      return;
    }
    setChallenge(null);
    setSignature("");
    setMessage(ja ? "論理Personal Nodeを登録しました。" : "Logical Personal Node registered.");
    await reload();
  }

  async function createDeviceChallenge() {
    const publicKeyJwk = parseJwk(devicePublicKey, setMessage, ja);
    if (!publicKeyJwk || !deviceLabel.trim()) return;
    const response = await postAction({
      action: "device_challenge",
      label: deviceLabel.trim(),
      deviceType,
      publicKeyJwk,
      scopes: deviceScopes,
    });
    if (!response.ok) {
      setMessage(ja ? "端末登録チャレンジを作成できません。" : "Could not create a device challenge.");
      return;
    }
    const nextChallenge = await response.json() as Challenge;
    setDeviceChallenge(nextChallenge);
    try {
      setDeviceSignature(await signWithLocalRootKey(nextChallenge.challenge));
      setMessage(ja
        ? "この端末のルート鍵で承認署名しました。内容を確認して端末を登録してください。"
        : "Signed with this device's root key. Review and register the device.");
    } catch {
      setMessage(ja ? "このチャレンジをPersonal Nodeのルート鍵で署名してください。" : "Sign this challenge with the Personal Node root key.");
    }
  }

  async function registerDevice() {
    if (!deviceChallenge || !deviceSignature.trim()) return;
    const response = await postAction({
      action: "device_register",
      challengeId: deviceChallenge.challengeId,
      signature: deviceSignature.trim(),
    });
    if (!response.ok) {
      setMessage(ja ? "端末の承認署名を確認できません。" : "The device authorization signature is invalid.");
      return;
    }
    setDeviceChallenge(null);
    setDeviceSignature("");
    setDeviceLabel("");
    setDevicePublicKey("");
    setMessage(ja ? "子鍵を持つ端末を追加しました。" : "Device child key registered.");
    await reload();
  }

  async function revokeDevice(deviceId: string) {
    const response = await fetch(`/api/core/personal-node?deviceId=${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    setMessage(response.ok
      ? ja ? "端末鍵を失効しました。" : "Device key revoked."
      : ja ? "端末鍵を失効できません。" : "Could not revoke the device key.");
    if (response.ok) await reload();
  }

  async function startRootKeyRotation() {
    const newPublicKeyJwk = parseJwk(newRootPublicKey, setMessage, ja);
    if (!newPublicKeyJwk) return;
    const response = await postAction({
      action: "root_key_rotation_start",
      idempotencyKey: crypto.randomUUID(),
      newPublicKeyJwk,
    });
    if (!response.ok) {
      setMessage(ja ? "ルート鍵の変更準備を開始できません。" : "Could not prepare root-key rotation.");
      return;
    }
    setRotation(await response.json() as Rotation);
    setMessage(ja
      ? "影響を確認し、同じチャレンジを旧ルート鍵と新ルート鍵の両方で署名してください。"
      : "Review the impact, then sign the same challenge with both old and new root keys.");
  }

  async function completeRootKeyRotation() {
    if (!rotation || rotationConfirmation !== "ROTATE" ||
        !oldRootSignature.trim() || !newRootSignature.trim()) return;
    const response = await postAction({
      action: "root_key_rotation_complete",
      rotationId: rotation.rotationId,
      oldSignature: oldRootSignature.trim(),
      newSignature: newRootSignature.trim(),
    });
    if (!response.ok) {
      setMessage(ja ? "ルート鍵を変更できません。署名と有効期限を確認してください。" : "Root-key rotation failed. Check both signatures and the expiry.");
      return;
    }
    const receipt = await response.json() as {
      rotationId: string;
      newKeyThumbprint: string;
      revokedDeviceCount: number;
      completedAt: string;
    };
    setRotation(null);
    setNewRootPublicKey("");
    setOldRootSignature("");
    setNewRootSignature("");
    setRotationConfirmation("");
    setMessage(ja
      ? `ルート鍵を変更しました。端末鍵${receipt.revokedDeviceCount}件を失効しました。Receipt: ${receipt.rotationId}`
      : `Root key rotated. ${receipt.revokedDeviceCount} device keys were revoked. Receipt: ${receipt.rotationId}`);
    await reload();
  }

  async function saveRelays() {
    const relays = relayText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const response = await fetch("/api/core/personal-node", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relays }),
    });
    setMessage(response.ok
      ? ja ? "Relayの優先順を保存しました。" : "Relay preference saved."
      : ja ? "Relayを保存できません。" : "Could not save relay preference.");
    if (response.ok) await reload();
  }

  async function revoke() {
    const response = await fetch("/api/core/personal-node", {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (response.ok) {
      setMessage(ja ? "Personal Node連携を失効しました。" : "Personal Node connection revoked.");
      await reload();
    }
  }

  return (
    <div className="settings-card">
      <PersonalNodeLocalClient
        locale={locale}
        nodeStatus={!stateLoaded ? "loading" : state.node === null ? "unregistered" : state.node.status}
        onRegistered={reload}
      />
      <div className="settings-note">
        <strong>Personal Node</strong>
        <p>{ja
          ? "Personal NodeはID・データ・AI・鍵・権限の正本です。Hubは署名済みの活動と公開索引、一時配送だけを扱い、秘密鍵は受け取りません。"
          : "Your Personal Node is the authority for identity, data, AI, keys, and permissions. Hub handles signed activity, public indexing, and temporary delivery only."}</p>
      </div>
      <PersonalNodeVideoSettings
        locale={locale}
        nodeActive={state.node?.status === "active"}
      />

      {state.node?.status === "active" ? (
        <>
          <div className="settings-note">
            <strong>{state.node.nodeUrl}</strong>
            <p>{ja ? "ルート鍵識別子" : "Root key thumbprint"}: {state.node.keyThumbprint}</p>
          </div>

          <label className="setting-row">
            <span><strong>{ja ? "Relayの優先順" : "Relay priority"}</strong><small>{ja ? "1行に1件、最大3件。Relayは暗号化されたデータを一時保管するだけです。" : "One per line, up to three. Relays only keep encrypted envelopes temporarily."}</small></span>
            <textarea value={relayText} onChange={(event) => setRelayText(event.target.value)} rows={3} />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={() => void saveRelays()}>{ja ? "Relayを保存" : "Save relays"}</button>
            <a href="/api/core/personal-node/export" download>{ja ? "署名済みデータを書き出す" : "Export signed data"}</a>
          </div>

          <div className="settings-note">
            <strong>{ja ? "この論理Nodeを構成する端末" : "Devices in this logical node"}</strong>
            <p>{ja ? "端末ごとに子鍵と最小権限を与えます。紛失時はその端末だけ失効できます。" : "Each device receives a scoped child key and can be revoked independently."}</p>
          </div>
          <PersonalNodeDevicePairing locale={locale} onRegistered={reload} />
          {state.devices.map((device) => (
            <div className="setting-row" key={device.deviceId}>
              <span>
                <strong>{device.label}</strong>
                <small>{device.deviceType} · {device.scopes.join(", ")} · {device.status}</small>
              </span>
              {device.status === "active"
                ? <button type="button" onClick={() => void revokeDevice(device.deviceId)}>{ja ? "失効" : "Revoke"}</button>
                : null}
            </div>
          ))}

          <label className="setting-row">
            <span><strong>{ja ? "端末名" : "Device label"}</strong><small>{ja ? "例：自宅PC" : "Example: Home PC"}</small></span>
            <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "端末種別" : "Device type"}</strong></span>
            <select value={deviceType} onChange={(event) => setDeviceType(event.target.value as Device["deviceType"])}>
              <option value="mobile">{ja ? "スマートフォン" : "Mobile"}</option>
              <option value="computer">PC</option>
              <option value="server">{ja ? "自宅サーバー" : "Server"}</option>
              <option value="backup">{ja ? "暗号化バックアップ" : "Encrypted backup"}</option>
              <option value="agent">AI Agent</option>
            </select>
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "端末の公開JWK" : "Device public JWK"}</strong><small>P-256 / EC</small></span>
            <textarea value={devicePublicKey} onChange={(event) => setDevicePublicKey(event.target.value)} rows={4} />
          </label>
          <fieldset className="settings-note">
            <legend>{ja ? "端末の権限" : "Device permissions"}</legend>
            {scopeOptions.map(([scope, label]) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  checked={deviceScopes.includes(scope)}
                  onChange={(event) => setDeviceScopes((current) =>
                    event.target.checked ? [...current, scope] : current.filter((value) => value !== scope))}
                />
                {ja ? label : scope}
              </label>
            ))}
          </fieldset>
          <div className="settings-actions">
            <button type="button" onClick={() => void createDeviceChallenge()}>{ja ? "端末承認を開始" : "Start device approval"}</button>
          </div>
          {deviceChallenge ? (
            <>
              <label className="setting-row">
                <span><strong>{ja ? "ルート鍵で署名する内容" : "Root-key challenge"}</strong><small>{deviceChallenge.expiresAt}</small></span>
                <textarea value={deviceChallenge.challenge} readOnly rows={8} />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "承認署名" : "Authorization signature"}</strong><small>Base64URL ECDSA P-256 / SHA-256</small></span>
                <textarea value={deviceSignature} onChange={(event) => setDeviceSignature(event.target.value)} rows={3} />
              </label>
              <button type="button" onClick={() => void registerDevice()}>{ja ? "端末を追加" : "Register device"}</button>
            </>
          ) : null}

          <div className="settings-note">
            <strong>{ja ? "ルート鍵を変更" : "Rotate root key"}</strong>
            <p>{ja
              ? "これは本人性を変更する重要操作です。旧鍵と新鍵の両方の署名が必要です。完了すると、現在有効な端末子鍵はすべて失効し、取り消せません。"
              : "This changes the node authority. Both old and new keys must sign. All active device child keys will be revoked and this cannot be undone."}</p>
          </div>
          <label className="setting-row">
            <span><strong>{ja ? "新しいルート公開JWK" : "New root public JWK"}</strong><small>P-256 / EC</small></span>
            <textarea value={newRootPublicKey} onChange={(event) => setNewRootPublicKey(event.target.value)} rows={4} />
          </label>
          <button type="button" onClick={() => void startRootKeyRotation()}>
            {ja ? "変更内容をプレビュー" : "Preview rotation"}
          </button>
          {rotation ? (
            <>
              <div className="settings-note" role="alert">
                <strong>{ja ? "確定前の影響" : "Impact before confirmation"}</strong>
                <p>{ja ? "旧鍵" : "Old key"}: {rotation.oldKeyThumbprint}</p>
                <p>{ja ? "新鍵" : "New key"}: {rotation.newKeyThumbprint}</p>
                <p>{ja ? "失効する端末鍵" : "Device keys to revoke"}: {rotation.revokedDeviceCount}</p>
                <p>{ja ? "署名期限" : "Signing deadline"}: {rotation.expiresAt}</p>
              </div>
              <label className="setting-row">
                <span><strong>{ja ? "両方の鍵で署名する内容" : "Challenge for both keys"}</strong></span>
                <textarea value={rotation.challenge} readOnly rows={10} />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "旧ルート鍵の署名" : "Old root signature"}</strong></span>
                <textarea value={oldRootSignature} onChange={(event) => setOldRootSignature(event.target.value)} rows={3} />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "新ルート鍵の署名" : "New root signature"}</strong></span>
                <textarea value={newRootSignature} onChange={(event) => setNewRootSignature(event.target.value)} rows={3} />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "確認のため ROTATE と入力" : "Type ROTATE to confirm"}</strong></span>
                <input value={rotationConfirmation} onChange={(event) => setRotationConfirmation(event.target.value)} autoComplete="off" />
              </label>
              <button
                type="button"
                disabled={rotationConfirmation !== "ROTATE" || !oldRootSignature.trim() || !newRootSignature.trim()}
                onClick={() => void completeRootKeyRotation()}
              >
                {ja ? "ルート鍵を変更し端末鍵を失効" : "Rotate root key and revoke devices"}
              </button>
            </>
          ) : null}

          <PersonalNodeRecoverySettings locale={locale} />
          <PersonalNodeRestore locale={locale} />

          <div className="settings-actions">
            <button type="button" onClick={() => void revoke()}>{ja ? "論理Node連携を失効" : "Revoke logical node"}</button>
          </div>
        </>
      ) : stateLoaded && state.node === null ? (
        <>
          <label className="setting-row">
            <span><strong>Node URL</strong><small>https://node.example/</small></span>
            <input value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} inputMode="url" />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "ルート公開JWK" : "Root public JWK"}</strong><small>P-256 / EC</small></span>
            <textarea value={publicKey} onChange={(event) => setPublicKey(event.target.value)} rows={4} />
          </label>
          <button type="button" onClick={() => void createChallenge()}>{ja ? "所有確認を開始" : "Create challenge"}</button>
          {challenge ? (
            <>
              <label className="setting-row">
                <span><strong>{ja ? "署名対象" : "Challenge"}</strong><small>{challenge.expiresAt}</small></span>
                <textarea value={challenge.challenge} readOnly rows={6} />
              </label>
              <label className="setting-row">
                <span><strong>{ja ? "署名" : "Signature"}</strong><small>Base64URL ECDSA P-256 / SHA-256</small></span>
                <textarea value={signature} onChange={(event) => setSignature(event.target.value)} rows={3} />
              </label>
              <button type="button" onClick={() => void register()}>{ja ? "登録を完了" : "Complete registration"}</button>
            </>
          ) : null}
        </>
      ) : state.node?.status === "revoked" ? (
        <div className="settings-note" role="status">
          <strong>{ja ? "Personal Node連携は失効済みです" : "Personal Node connection revoked"}</strong>
          <p>{ja
            ? "失効した論理Nodeは初回登録で置き換えられません。現在のルート鍵復旧機能は有効なNode専用のため、失効済みの連携を再有効化できません。端末内の鍵は上の端末鍵欄で確認・消去できます。"
            : "A revoked logical node cannot be replaced through initial registration. Root-key recovery currently supports active nodes only and cannot reactivate this connection. You can inspect or erase this device's local key above."}</p>
          <p>{state.node.nodeUrl}</p>
        </div>
      ) : <p className="settings-note" role="status">{ja ? "Personal Nodeの状態を確認しています。" : "Checking Personal Node status."}</p>}
      <p className="settings-note" role="status">{message}</p>
    </div>
  );
}

function parseJwk(
  value: string,
  setMessage: (message: string) => void,
  ja: boolean,
): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    setMessage(ja ? "公開JWKが正しいJSONではありません。" : "The public JWK is not valid JSON.");
    return null;
  }
}

function postAction(body: Record<string, unknown>) {
  return fetch("/api/core/personal-node", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
