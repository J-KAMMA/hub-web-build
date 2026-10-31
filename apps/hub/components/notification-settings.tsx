"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { UiButton, UiSelect } from "@/components/ui/primitives";
import { recordPersonalNodeEvent } from "@/lib/personal-node-local-keystore";

type Preferences = {
  replies: boolean;
  reactions: boolean;
  follows: boolean;
  messages: boolean;
  commercePayments: boolean;
  commerceDelivery: boolean;
  commerceReturns: boolean;
};
type DirectMessages = "mutuals" | "following" | "nobody";
type Settings = { notifications: Preferences; directMessages: DirectMessages };
type Phase = "loading" | "ready" | "saving" | "load-error" | "save-error";

const preferenceKeys = [
  "replies",
  "reactions",
  "follows",
  "messages",
  "commercePayments",
  "commerceDelivery",
  "commerceReturns",
] as const satisfies ReadonlyArray<keyof Preferences>;

const labels: Array<[keyof Preferences, string, string]> = [
  ["replies", "返信", "投稿やスレッドへの返信を通知"],
  ["reactions", "いいね", "投稿へのいいねを通知"],
  ["follows", "新しいフォロワー", "フォローされたときに通知"],
  ["messages", "メッセージ", "新しいDMを通知"],
  ["commercePayments", "支払い", "支払いの確定や失敗の状況を通知"],
  ["commerceDelivery", "配送", "配送状況の更新を通知"],
  ["commerceReturns", "返品", "返品申請や返金処理の更新を通知"],
];

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Settings>;
  if (!candidate.notifications || typeof candidate.notifications !== "object") return false;
  if (!["mutuals", "following", "nobody"].includes(String(candidate.directMessages))) return false;
  return preferenceKeys.every((key) => typeof candidate.notifications?.[key] === "boolean");
}

async function readSettings(response: Response) {
  if (!response.ok) throw new Error("settings_request_failed");
  const payload: unknown = await response.json();
  if (!isSettings(payload)) throw new Error("settings_response_invalid");
  return payload;
}

export function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [retrySettings, setRetrySettings] = useState<Settings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("loading");
    setMessage("");
    setRetrySettings(null);
    setSettings(null);
    try {
      const response = await fetch("/api/settings/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      setSettings(await readSettings(response));
      setPhase("ready");
    } catch {
      setPhase("load-error");
      setMessage("通知設定を読み込めませんでした。設定は変更されていません。再試行してください。");
    } finally {
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: Settings) => {
    if (inFlight.current || (phase !== "ready" && phase !== "save-error")) return;
    inFlight.current = true;
    setPhase("saving");
    setMessage("");
    setRetrySettings(null);
    try {
      const response = await fetch("/api/settings/notifications", {
        method: "PATCH",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(15_000),
      });
      const saved = await readSettings(response);
      setSettings(saved);
      void recordPersonalNodeEvent("hub.preference.update", {
        namespace: "notifications",
        value: saved,
      });
      setMessage("通知設定を保存しました。");
      setPhase("ready");
    } catch {
      // Keep the last confirmed values visible until the retry succeeds.
      setRetrySettings(next);
      setMessage("通知設定を保存できませんでした。現在表示している設定は保存済みの内容です。再試行してください。");
      setPhase("save-error");
    } finally {
      inFlight.current = false;
    }
  };

  const busy = phase === "loading" || phase === "saving";
  const hasError = phase === "load-error" || phase === "save-error";
  const statusText = phase === "loading"
    ? "通知設定を読み込んでいます。"
    : phase === "saving"
      ? "通知設定を保存しています。"
      : message;

  return (
    <div className="notification-settings" aria-busy={busy}>
      {settings
        ? labels.map(([key, label, description]) => (
            <label className="setting-row" key={key}>
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
              <input
                type="checkbox"
                checked={settings.notifications[key]}
                disabled={busy}
                onChange={(event) => void save({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    [key]: event.target.checked,
                  },
                })}
              />
              <i aria-hidden="true" />
            </label>
          ))
        : null}
      {settings
        ? (
            <label className="setting-select">
              <span>
                <strong>DMを受け取る相手</strong>
                <small>新しい会話を開始できる相手を選びます。</small>
              </span>
              <UiSelect
                value={settings.directMessages}
                disabled={busy}
                onChange={(event) => void save({
                  ...settings,
                  directMessages: event.target.value as DirectMessages,
                })}
              >
                <option value="mutuals">相互フォロー</option>
                <option value="following">自分がフォロー中</option>
                <option value="nobody">受け取らない</option>
              </UiSelect>
            </label>
          )
        : null}
      {phase === "load-error"
        ? <UiButton type="button" size="compact" onClick={() => void load()}>再試行</UiButton>
        : null}
      {retrySettings
        ? (
            <UiButton
              type="button"
              size="compact"
              disabled={busy}
              onClick={() => void save(retrySettings)}
            >
              保存を再試行
            </UiButton>
          )
        : null}
      <p
        className="settings-inline-status"
        role={hasError ? "alert" : "status"}
        aria-live={hasError ? "assertive" : "polite"}
      >
        {statusText}
      </p>
    </div>
  );
}
