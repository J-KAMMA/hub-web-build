"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import { useCallback, useEffect, useState } from "react";

type Device = { id: string; label: string; thumbprint: string; registeredAt: string; lastUsedAt: string | null };

export function DesktopDeviceList() {
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const [devices, setDevices] = useState<Device[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/account/api/v1/desktop/devices", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => null) as { devices?: Device[] } | null;
      if (!response.ok || !Array.isArray(body?.devices)) throw new Error("unavailable");
      setDevices(body.devices);
      setMessage("");
    } catch { setMessage("Desktop端末の一覧を確認できませんでした。登録状態は変更されていません。"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revoke(device: Device) {
    if (busy || !window.confirm(`${device.label} のDesktop認証を失効します。\n\n鍵の指紋: ${device.thumbprint}\n\nこの端末は新しい認証票を取得できなくなります。端末内のデータは削除されません。続けますか？`)) return;
    setBusy(device.id); setMessage("");
    try {
      const response = await fetch(`/account/api/v1/desktop/devices/${device.id}`, { method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (body?.error === "recent_authentication_required") {
        setMessage("失効前にAccountのパスキーでもう一度本人確認してください。"); return;
      }
      if (!response.ok) throw new Error("failed");
      setDevices((current) => current.filter((item) => item.id !== device.id));
      setMessage(`${device.label} のDesktop認証を失効しました。`);
    } catch { setMessage("Desktop端末を失効できませんでした。登録状態は変更されていません。"); }
    finally { setBusy(null); }
  }

  return <section className="hub-account__section" id="desktop-devices" aria-labelledby="desktop-devices-title">
    <header><div><h2 id="desktop-devices-title">Desktop端末</h2><p className="hub-account__lead">ブラウザCookieとは別の端末鍵で接続したPCを管理します。</p></div></header>
    {loading ? <div className="settings-note" aria-busy="true"><strong>端末を確認中…</strong></div> : devices.length === 0 ? <div className="settings-note"><strong>登録済み端末はありません</strong></div> : devices.map((device) => <article className="settings-note" key={device.id}>
      <strong>{device.label}</strong><code>{device.thumbprint}</code>
      <small>登録: {new Date(device.registeredAt).toLocaleString("ja-JP")} · 最終利用: {device.lastUsedAt ? new Date(device.lastUsedAt).toLocaleString("ja-JP") : "未使用"}</small>
      <button type="button" className="settings-reset" disabled={busy === device.id} onClick={() => void revoke(device)}>{busy === device.id ? "失効中…" : "この端末を失効"}</button>
    </article>)}
    {message ? <p role="status" aria-live="polite">{message} {message.includes("本人確認") ? <a href={`${hubSurfacePath(surface, "/auth")}?reauth=1&next=%2Faccount%23desktop-devices`}>本人確認へ進む</a> : null}</p> : null}
  </section>;
}
