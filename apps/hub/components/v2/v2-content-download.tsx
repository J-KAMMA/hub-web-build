"use client";

import { useEffect, useState } from "react";

import {
  contentDownloadChoices,
  contentDownloadNoneNotice,
  contentDownloadPolicyLabel,
  contentDownloadWatermarkNotice,
  creativeCommonsDownloadNotice,
  isContentDownloadPolicy,
  needsCreativeCommonsDownloadNotice,
  suggestedContentDownloadPolicy,
  type ContentDownloadKind,
  type ContentDownloadPolicy,
  type ContentDownloadTargetType,
} from "@/lib/content-download-policy";

import "./v2-content-download.css";

/*
 * ダウンロードの許可（2026-10-17）。作成・編集の欄は選んだ値を親へ渡し、親は作品の保存に
 * 成功したあと applyContentDownloadSetting を呼ぶ（ライセンスと同じ流れ）。
 * 可否は毎回サーバーが確かめる。ここでの表示は案内にすぎない。
 */

export type ApplyDownloadResult = { ok: true } | { ok: false; message: string };

export async function applyContentDownloadSetting(
  targetType: ContentDownloadTargetType,
  targetId: string,
  policy: ContentDownloadPolicy,
): Promise<ApplyDownloadResult> {
  try {
    const response = await fetch("/api/content-download-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType, targetId, policy }),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, message: typeof payload?.error === "string" && payload.error ? payload.error : "ダウンロードの設定を保存できませんでした。" };
  } catch {
    return { ok: false, message: "通信できませんでした。" };
  }
}

/** The saved setting of a Hub work, or null while loading or when unreadable. */
export function useContentDownloadSetting(targetType: ContentDownloadTargetType, targetId: string | null) {
  const [policy, setPolicy] = useState<ContentDownloadPolicy | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    const query = new URLSearchParams({ targetType, targetId });
    fetch(`/api/content-download-settings?${query}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { policy?: unknown; saved?: unknown } | null) => {
        if (cancelled || !body) return;
        if (isContentDownloadPolicy(body.policy)) setPolicy(body.policy);
        setSaved(body.saved === true);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [targetType, targetId]);
  return { policy, saved };
}

type SettingProps = {
  value: ContentDownloadPolicy;
  onChange: (policy: ContentDownloadPolicy) => void;
  /** The work's license id; CC works lean towards "anyone". */
  license?: string;
  target: ContentDownloadTargetType | "music";
  japanese?: boolean;
  disabled?: boolean;
  gated?: boolean;
};

export function V2ContentDownloadSetting({ value, onChange, license, target, japanese = true, disabled = false, gated = false }: SettingProps) {
  const choices = contentDownloadChoices(target);
  return (
    <div className="v2-download-setting">
      <label className="v2-download-setting__field">
        <span>{japanese ? "ダウンロード" : "Downloads"}</span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => { if (isContentDownloadPolicy(event.target.value)) onChange(event.target.value); }}
        >
          {choices.map((policy) => (
            <option key={policy} value={policy}>{contentDownloadPolicyLabel(policy, japanese)}</option>
          ))}
        </select>
      </label>
      {needsCreativeCommonsDownloadNotice(license, value) ? (
        <p className="v2-download-setting__notice" role="note">{creativeCommonsDownloadNotice(japanese)}</p>
      ) : null}
      {value === "none" ? <p className="v2-download-setting__note">{contentDownloadNoneNotice(japanese)}</p> : null}
      {value === "entitled" && !gated ? (
        <p className="v2-download-setting__note">
          {japanese ? "閲覧条件が付いていない作品では、作者のほかは誰もダウンロードできません。" : "Without an access condition, only you can download this work."}
        </p>
      ) : null}
      {gated && value === "anyone" ? (
        <p className="v2-download-setting__note">
          {japanese ? "閲覧条件が先に効きます。条件を満たした人だけがダウンロードできます。" : "The access condition applies first: only viewers who meet it can download."}
        </p>
      ) : null}
      {value !== "none" ? <p className="v2-download-setting__note">{contentDownloadWatermarkNotice(japanese)}</p> : null}
    </div>
  );
}

type ButtonProps = {
  kind: ContentDownloadKind;
  id: string;
  /** null hides the button and shows the "downloads not allowed" line instead. */
  allowed: boolean | null;
  japanese?: boolean;
  label?: string;
};

/**
 * Asks Hub for a single-use download URL and opens it. Hub checks the setting and the
 * viewer's entitlement again on every press.
 */
export function V2DownloadButton({ kind, id, allowed, japanese = true, label }: ButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (allowed === null) return null;
  if (!allowed) return <p className="v2-download__note">{contentDownloadNoneNotice(japanese)}</p>;
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/downloads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      const payload = (await response.json().catch(() => null)) as { download?: { url?: unknown }; error?: unknown } | null;
      const url = payload?.download?.url;
      if (!response.ok || typeof url !== "string" || !url.startsWith("/")) {
        setError(typeof payload?.error === "string" ? payload.error : japanese ? "ダウンロードできませんでした。" : "The download could not start.");
        return;
      }
      window.location.assign(url);
    } catch {
      setError(japanese ? "通信できませんでした。" : "Could not connect.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="v2-download">
      <button type="button" className="v2-gate__button" onClick={() => void start()} disabled={busy}>
        {label ?? (japanese ? "ダウンロード" : "Download")}
      </button>
      <p className="v2-download__note">{contentDownloadWatermarkNotice(japanese)}</p>
      {error ? <p className="v2-download__error" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * Self-contained editor for a saved work: loads the setting, proposes "anyone" for an unsaved CC
 * work, and saves on demand. For edit forms and the author's view of a work.
 */
export function V2ContentDownloadEditor({ targetType, targetId, license, gated = false, japanese = true }: {
  targetType: ContentDownloadTargetType;
  targetId: string;
  license?: string;
  gated?: boolean;
  japanese?: boolean;
}) {
  const loaded = useContentDownloadSetting(targetType, targetId);
  const [value, setValue] = useState<ContentDownloadPolicy | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = loaded.policy === null ? null : loaded.saved ? loaded.policy : suggestedContentDownloadPolicy(license);
  const current = value ?? base;
  if (!current) return null;
  const save = async () => {
    setBusy(true);
    setMessage("");
    const result = await applyContentDownloadSetting(targetType, targetId, current);
    setBusy(false);
    setMessage(result.ok ? (japanese ? "ダウンロードの設定を保存しました。" : "Saved.") : result.message);
  };
  return (
    <form className="v2-download-setting" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <V2ContentDownloadSetting value={current} onChange={setValue} license={license} target={targetType} japanese={japanese} disabled={busy} gated={gated} />
      <button type="submit" className="v2-gate__button" disabled={busy || (loaded.saved && current === loaded.policy)}>
        {japanese ? "ダウンロードの設定を保存" : "Save download setting"}
      </button>
      {message ? <p className="v2-download-setting__note" role="status">{message}</p> : null}
    </form>
  );
}
