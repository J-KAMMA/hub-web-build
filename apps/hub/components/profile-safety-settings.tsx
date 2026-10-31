"use client";

import React, { useEffect, useState } from "react";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";

type ProfileControl = {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  muted: boolean;
  blocked: boolean;
  updatedAt: string;
};

const BLOCKED_PROFILES_KEY = "hub.blockedProfileIds";
const MUTED_PROFILES_KEY = "hub.mutedProfileIds";
const PROFILE_CONTROL_EVENT = "hub-profile-controls-changed";

function mirrorControl(key: string, profileId: string, enabled: boolean) {
  const ids = new Set<string>();
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (Array.isArray(stored)) for (const value of stored) if (typeof value === "string") ids.add(value);
  } catch {
    // Replace malformed device-local mirrors with the server-confirmed state.
  }
  if (enabled) ids.add(profileId);
  else ids.delete(profileId);
  localStorage.setItem(key, JSON.stringify([...ids]));
}

export function ProfileSafetySettings() {
  const [controls, setControls] = useState<ProfileControl[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/profile/safety", { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json() as { controls?: ProfileControl[]; error?: string };
      if (!response.ok || !payload.controls) throw new Error(payload.error ?? "安全設定を取得できませんでした。");
      setControls(payload.controls);
      setStatus("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "安全設定を取得できませんでした。");
      setStatus("failed");
    }
  };

  useEffect(() => { void load(); }, []);

  const disable = async (control: ProfileControl, action: "mute" | "block") => {
    const operationId = `${control.profileId}:${action}`;
    setBusyId(operationId);
    setMessage("");
    try {
      const response = await fetch("/api/profile/safety", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetProfileId: control.profileId, action, enabled: false }),
      });
      const payload = await response.json() as { control?: { muted: boolean; blocked: boolean }; error?: string };
      if (!response.ok || !payload.control) throw new Error(payload.error ?? "設定を解除できませんでした。");
      mirrorControl(BLOCKED_PROFILES_KEY, control.profileId, payload.control.blocked);
      mirrorControl(MUTED_PROFILES_KEY, control.profileId, payload.control.muted);
      window.dispatchEvent(new CustomEvent(PROFILE_CONTROL_EVENT));
      setControls((current) => current
        .map((item) => item.profileId === control.profileId ? { ...item, ...payload.control } : item)
        .filter((item) => item.blocked || item.muted));
      setMessage(action === "block" ? "ブロックを解除しました。" : "ミュートを解除しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定を解除できませんでした。");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="profile-safety-settings">
      <div className="settings-note">
        <strong>ミュート・ブロック管理</strong>
        <p>ミュートした相手の投稿は表示されません。ブロックした相手とはフォロー、返信、通知、メッセージが遮断されます。</p>
      </div>
      {status === "loading" ? <UiStatePanel className="profile-safety-settings__state" state="loading" title="安全設定を読み込んでいます" /> : null}
      {status === "failed" ? <UiStatePanel className="profile-safety-settings__state" state="error" title="安全設定を取得できませんでした" description={message} action={<UiButton type="button" onClick={() => void load()}>再試行</UiButton>} /> : null}
      {status === "ready" && controls.length === 0 ? <UiStatePanel className="profile-safety-settings__state" state="empty" title="ミュート・ブロック中のユーザーはいません" /> : null}
      {controls.map((control) => (
        <div className="profile-safety-settings__row" key={control.profileId}>
          <a href={`/profile/${encodeURIComponent(control.handle)}`}>
            <span className="profile-safety-settings__avatar" aria-hidden="true">
              {control.avatarUrl ? <img src={control.avatarUrl} alt="" /> : control.displayName.slice(0, 1)}
            </span>
            <span><strong>{control.displayName}</strong><small>@{control.handle}</small></span>
          </a>
          <div>
            {control.muted ? <UiButton type="button" pending={busyId === `${control.profileId}:mute`} pendingLabel="解除中…" disabled={Boolean(busyId)} onClick={() => void disable(control, "mute")}>ミュート解除</UiButton> : null}
            {control.blocked ? <UiButton type="button" pending={busyId === `${control.profileId}:block`} pendingLabel="解除中…" disabled={Boolean(busyId)} onClick={() => void disable(control, "block")}>ブロック解除</UiButton> : null}
          </div>
        </div>
      ))}
      {status === "ready" && message ? <p className="profile-safety-settings__message" role="status">{message}</p> : null}
    </div>
  );
}
