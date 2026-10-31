"use client";

import React, { useEffect, useMemo, useState } from "react";

type DeliveryPreference = {
  version: 1;
  peerAssist: boolean;
  cacheFallback: "popular" | "offline";
  encryptedBackup: boolean;
  uplinkLimitMbps: number;
};

const STORAGE_KEY = "hub.personal-node.video-delivery";
const DEFAULT_PREFERENCE: DeliveryPreference = {
  version: 1,
  peerAssist: false,
  cacheFallback: "offline",
  encryptedBackup: false,
  uplinkLimitMbps: 100,
};

export function PersonalNodeVideoSettings({
  locale,
  nodeActive,
}: {
  locale: "ja" | "en";
  nodeActive: boolean;
}) {
  const ja = locale === "ja";
  const [preference, setPreference] = useState(DEFAULT_PREFERENCE);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (!value) return;
      const parsed = JSON.parse(value) as Partial<DeliveryPreference>;
      if (parsed.version !== 1) return;
      setPreference({
        ...DEFAULT_PREFERENCE,
        ...parsed,
        uplinkLimitMbps: normalizeUplinkLimit(parsed.uplinkLimitMbps),
      });
    } catch {
      // A damaged device-only preference must not prevent Personal Node setup.
    }
  }, []);

  const estimatedViewers = useMemo(
    () => Math.max(1, Math.floor((preference.uplinkLimitMbps * 0.8) / 5)),
    [preference.uplinkLimitMbps],
  );

  function update(next: Partial<DeliveryPreference>) {
    setPreference((current) => ({ ...current, ...next }));
    setSaved(false);
  }

  function save() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    setSaved(true);
  }

  return (
    <section className="personal-video-settings" aria-labelledby="personal-video-settings-title">
      <header className="personal-video-settings__header">
        <div>
          <strong id="personal-video-settings-title">
            {ja ? "動画配信" : "Video delivery"}
          </strong>
          <p>
            {ja
              ? "原本はPersonal Nodeから配信し、混雑時だけ視聴者とHubの補助を使います。"
              : "Serve the original from your Personal Node and use viewer or Hub assistance only when needed."}
          </p>
        </div>
        <span className={nodeActive ? "is-ready" : "is-unavailable"}>
          {nodeActive ? (ja ? "接続済み" : "Connected") : (ja ? "Node未接続" : "Node required")}
        </span>
      </header>

      <div className="personal-video-settings__flow" aria-label={ja ? "動画の配信経路" : "Video delivery path"}>
        <span>{ja ? "個人ノード" : "Personal Node"}</span>
        <i aria-hidden="true">→</i>
        <span>{ja ? "視聴者P2P" : "Viewer P2P"}</span>
        <i aria-hidden="true">→</i>
        <span>{ja ? "Hubキャッシュ" : "Hub cache"}</span>
        <i aria-hidden="true">→</i>
        <span>{ja ? "暗号化バックアップ" : "Encrypted backup"}</span>
      </div>

      <label className="setting-row">
        <span>
          <strong>{ja ? "視聴者による配信補助" : "Viewer-assisted delivery"}</strong>
          <small>
            {ja
              ? "同じ動画の視聴者同士で断片を共有します。参加者のIPアドレスが相互に見える場合があります。"
              : "Viewers of the same video share segments. Participants may be able to see each other's IP addresses."}
          </small>
        </span>
        <input
          type="checkbox"
          checked={preference.peerAssist}
          disabled={!nodeActive}
          onChange={(event) => update({ peerAssist: event.target.checked })}
        />
        <i aria-hidden="true" />
      </label>

      <label className="setting-select">
        <span>
          <strong>{ja ? "Hubキャッシュを使う条件" : "Use Hub cache when"}</strong>
          <small>
            {ja
              ? "個人ノードの負荷が高い動画、または停止時の一時配信に限定します。"
              : "Limit Hub cache to busy videos or temporary delivery while the node is offline."}
          </small>
        </span>
        <select
          value={preference.cacheFallback}
          disabled={!nodeActive}
          onChange={(event) => update({ cacheFallback: event.target.value as DeliveryPreference["cacheFallback"] })}
        >
          <option value="offline">{ja ? "Node停止時のみ" : "Only while offline"}</option>
          <option value="popular">{ja ? "混雑時と停止時" : "When busy or offline"}</option>
        </select>
      </label>

      <label className="setting-row">
        <span>
          <strong>{ja ? "暗号化バックアップ" : "Encrypted backup"}</strong>
          <small>
            {ja
              ? "復旧用の暗号化コピーを外部ストレージへ保存します。保存先の接続後に有効になります。"
              : "Keep an encrypted recovery copy in external storage. This becomes active after a provider is connected."}
          </small>
        </span>
        <input
          type="checkbox"
          checked={preference.encryptedBackup}
          disabled={!nodeActive}
          onChange={(event) => update({ encryptedBackup: event.target.checked })}
        />
        <i aria-hidden="true" />
      </label>

      <label className="setting-select">
        <span>
          <strong>{ja ? "動画に使う上り回線" : "Upload bandwidth for video"}</strong>
          <small>
            {ja
              ? `1080p・5Mbps換算で、余裕を含め約${estimatedViewers}人の同時視聴`
              : `About ${estimatedViewers} simultaneous 1080p viewers at 5 Mbps with headroom`}
          </small>
        </span>
        <select
          value={preference.uplinkLimitMbps}
          disabled={!nodeActive}
          onChange={(event) => update({ uplinkLimitMbps: Number(event.target.value) })}
        >
          {[25, 50, 100, 300, 500].map((value) => (
            <option key={value} value={value}>{value} Mbps</option>
          ))}
        </select>
      </label>

      <footer className="personal-video-settings__footer">
        <p role="status" aria-live="polite">
          {saved
            ? (ja ? "この端末の配信設定を保存しました。" : "Video delivery settings saved on this device.")
            : (ja ? "設定はこの端末だけに保存されます。" : "Preferences are stored only on this device.")}
        </p>
        <button type="button" disabled={!nodeActive} onClick={save}>
          {ja ? "配信設定を保存" : "Save delivery settings"}
        </button>
      </footer>
    </section>
  );
}

function normalizeUplinkLimit(value: unknown) {
  return [25, 50, 100, 300, 500].includes(Number(value))
    ? Number(value)
    : DEFAULT_PREFERENCE.uplinkLimitMbps;
}
