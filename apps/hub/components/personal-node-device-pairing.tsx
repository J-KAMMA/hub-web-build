"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import {
  activateLocalDevicePairing,
  createLocalDevicePairing,
  discardLocalDevicePairing,
  encodeLocalDevicePairing,
  parseLocalDevicePairing,
  recoveryKeyThumbprint,
  signWithLocalRootKey,
  type LocalDevicePairing,
} from "@/lib/personal-node-local-keystore";

type Device = {
  deviceId: string;
  keyThumbprint: string;
  status: "active" | "revoked";
};

type FlowState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "displaying"; pairing: LocalDevicePairing; qr: string }
  | { status: "approving"; pairing: LocalDevicePairing }
  | { status: "approved"; deviceId: string }
  | { status: "failed"; message: string };

const allowedScopes = [
  "profile:write",
  "post:write",
  "follow:write",
  "preference:write",
  "agent:delegate",
  "relay:receive",
] as const;

export function PersonalNodeDevicePairing({
  locale,
  onRegistered,
}: {
  locale: "ja" | "en";
  onRegistered: () => Promise<void>;
}) {
  const ja = locale === "ja";
  const [flow, setFlow] = useState<FlowState>({ status: "idle" });
  const [label, setLabel] = useState("");
  const [deviceType, setDeviceType] = useState<LocalDevicePairing["deviceType"]>("mobile");
  const [scopes, setScopes] = useState<string[]>(["post:write", "relay:receive"]);
  const [approval, setApproval] = useState("");
  const [incoming, setIncoming] = useState<LocalDevicePairing | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const encoded = new URL(window.location.href).searchParams.get("personalNodePair");
    if (!encoded) return;
    try {
      setIncoming(parseLocalDevicePairing(encoded));
    } catch {
      setFlow({
        status: "failed",
        message: ja ? "QR承認情報が無効か期限切れです。" : "The QR approval is invalid or expired.",
      });
    }
  }, [ja]);

  const grantedScopeLabels = useMemo(
    () => incoming?.scopes.join(", ") ?? "",
    [incoming],
  );

  async function generatePairing() {
    if (!label.trim() || scopes.length === 0) return;
    setFlow({ status: "generating" });
    setNotice("");
    try {
      const pairing = await createLocalDevicePairing({
        label: label.trim(),
        deviceType,
        scopes,
      });
      const encoded = encodeLocalDevicePairing(pairing);
      const url = new URL("/settings", window.location.origin);
      url.searchParams.set("personalNodePair", encoded);
      const qr = await QRCode.toDataURL(url.toString(), {
        width: 280,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      setFlow({ status: "displaying", pairing, qr });
    } catch {
      setFlow({
        status: "failed",
        message: ja ? "端末追加用QRを作成できませんでした。" : "Could not create a device-pairing QR.",
      });
    }
  }

  async function approveIncoming() {
    if (!incoming || approval !== "ADD") return;
    setFlow({ status: "approving", pairing: incoming });
    try {
      if (incoming.scopes.some((scope) => !allowedScopes.includes(scope as typeof allowedScopes[number])) ||
          await recoveryKeyThumbprint(incoming.publicKeyJwk) !== incoming.keyThumbprint) {
        throw new Error("pairing_tampered");
      }
      const challengeResponse = await postAction({
        action: "device_challenge",
        label: incoming.label,
        deviceType: incoming.deviceType,
        publicKeyJwk: incoming.publicKeyJwk,
        scopes: incoming.scopes,
      });
      if (!challengeResponse.ok) throw new Error("challenge_failed");
      const challenge = await challengeResponse.json() as {
        challengeId: string;
        challenge: string;
        deviceId: string;
      };
      const signature = await signWithLocalRootKey(challenge.challenge);
      const completionResponse = await postAction({
        action: "device_register",
        challengeId: challenge.challengeId,
        signature,
      });
      if (!completionResponse.ok) throw new Error("registration_failed");
      const receipt = await completionResponse.json() as { deviceId: string };
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("personalNodePair");
      window.history.replaceState(null, "", cleanUrl);
      setIncoming(null);
      setApproval("");
      setFlow({ status: "approved", deviceId: receipt.deviceId });
      await onRegistered();
    } catch {
      setFlow({
        status: "failed",
        message: ja
          ? "端末を承認できませんでした。ルート鍵、期限、権限を確認してください。"
          : "Could not approve the device. Check the root key, expiry, and permissions.",
      });
    }
  }

  async function checkRegistration() {
    if (flow.status !== "displaying") return;
    try {
      const response = await fetch("/api/core/personal-node", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("status_failed");
      const state = await response.json() as { devices?: Device[] };
      const device = state.devices?.find((candidate) =>
        candidate.status === "active" &&
        candidate.keyThumbprint === flow.pairing.keyThumbprint);
      if (!device) {
        setNotice(ja
          ? "まだ承認されていません。承認端末で操作を完了してから再確認してください。"
          : "Not approved yet. Complete approval on the root device and check again.");
        return;
      }
      await activateLocalDevicePairing(
        flow.pairing.pairingId,
        device.deviceId,
        device.keyThumbprint,
      );
      setFlow({ status: "approved", deviceId: device.deviceId });
      await onRegistered();
    } catch {
      setNotice(ja ? "登録状態を確認できませんでした。再試行できます。" : "Could not check the registration state. You can retry.");
    }
  }

  async function cancelPairing() {
    if (flow.status !== "displaying") return;
    await discardLocalDevicePairing(flow.pairing.pairingId).catch(() => undefined);
    setNotice("");
    setFlow({ status: "idle" });
  }

  return (
    <section className="settings-note" aria-labelledby="personal-node-pairing-title">
      <strong id="personal-node-pairing-title">
        {ja ? "QRで端末を追加" : "Add a device with QR"}
      </strong>
      <p>{ja
        ? "追加する端末でQRを作り、現在のルート端末で読み取ります。QRには公開鍵・端末名・要求権限・10分の期限だけが入り、秘密鍵は含まれません。"
        : "Create the QR on the new device and scan it with the current root device. It contains only a public key, device label, requested permissions, and a 10-minute expiry—never a private key."}</p>

      {incoming ? (
        <div className="settings-card">
          <div className="settings-note" role="alert">
            <strong>{ja ? "端末追加の確認" : "Review device addition"}</strong>
            <p>{ja ? "端末" : "Device"}: {incoming.label}</p>
            <p>{ja ? "種類" : "Type"}: {incoming.deviceType}</p>
            <p>{ja ? "許可する操作" : "Requested permissions"}: {grantedScopeLabels}</p>
            <p>{ja ? "有効期限" : "Expires"}: {new Date(incoming.expiresAt).toLocaleString(locale)}</p>
            <p>{ja
              ? "承認すると、この端末は表示された権限でPersonal Nodeを操作できます。"
              : "After approval, this device can operate the Personal Node with the permissions shown above."}</p>
          </div>
          <label className="setting-row">
            <span><strong>{ja ? "承認するには ADD と入力" : "Type ADD to approve"}</strong></span>
            <input value={approval} onChange={(event) => setApproval(event.target.value)} autoComplete="off" />
          </label>
          <button
            type="button"
            disabled={approval !== "ADD" || flow.status === "approving"}
            onClick={() => void approveIncoming()}
          >
            {flow.status === "approving"
              ? (ja ? "承認中…" : "Approving…")
              : (ja ? "この端末を追加" : "Add this device")}
          </button>
        </div>
      ) : null}

      {!incoming && flow.status !== "displaying" ? (
        <>
          <label className="setting-row">
            <span><strong>{ja ? "追加する端末名" : "New device label"}</strong><small>{ja ? "例：スマートフォン" : "Example: Phone"}</small></span>
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="setting-row">
            <span><strong>{ja ? "端末の種類" : "Device type"}</strong></span>
            <select value={deviceType} onChange={(event) => setDeviceType(event.target.value as LocalDevicePairing["deviceType"])}>
              <option value="mobile">{ja ? "スマートフォン" : "Mobile"}</option>
              <option value="computer">PC</option>
              <option value="server">{ja ? "自宅サーバー" : "Server"}</option>
              <option value="backup">{ja ? "バックアップ端末" : "Backup device"}</option>
              <option value="agent">AI Agent</option>
            </select>
          </label>
          <fieldset className="settings-note">
            <legend>{ja ? "要求する権限" : "Requested permissions"}</legend>
            {allowedScopes.map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(event) => setScopes((current) =>
                    event.target.checked
                      ? [...current, scope]
                      : current.filter((value) => value !== scope))}
                />
                {scope}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={!label.trim() || scopes.length === 0 || flow.status === "generating"}
            onClick={() => void generatePairing()}
          >
            {flow.status === "generating"
              ? (ja ? "作成中…" : "Creating…")
              : (ja ? "この端末のQRを作成" : "Create this device QR")}
          </button>
        </>
      ) : null}

      {flow.status === "displaying" ? (
        <div className="settings-card">
          <img src={flow.qr} width={280} height={280} alt={ja ? "端末追加用QRコード" : "Device-pairing QR code"} />
          <p>{ja ? "期限" : "Expires"}: {new Date(flow.pairing.expiresAt).toLocaleString(locale)}</p>
          <div className="settings-actions">
            <button type="button" onClick={() => void checkRegistration()}>
              {ja ? "承認済みか確認" : "Check approval"}
            </button>
            <button type="button" onClick={() => void cancelPairing()}>
              {ja ? "取り消す" : "Cancel"}
            </button>
          </div>
        </div>
      ) : null}

      {flow.status === "approved" ? (
        <p role="status">{ja ? `端末を追加しました。Receipt: ${flow.deviceId}` : `Device added. Receipt: ${flow.deviceId}`}</p>
      ) : null}
      {flow.status === "failed" ? <p role="alert">{flow.message}</p> : null}
      {notice ? <p role="status" aria-live="polite">{notice}</p> : null}
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
