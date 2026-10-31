"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { UiButton, UiInput } from "@/components/ui/primitives";
import { recordPersonalNodeEvent } from "@/lib/personal-node-local-keystore";

type Settings = { terms: string[]; showSensitive: boolean };
type Phase = "loading" | "ready" | "saving" | "load-error" | "save-error";

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Settings>;
  return (
    Array.isArray(candidate.terms)
    && candidate.terms.every((term) => typeof term === "string")
    && typeof candidate.showSensitive === "boolean"
  );
}

async function readSettings(response: Response) {
  if (!response.ok) throw new Error("settings_request_failed");
  const payload: unknown = await response.json();
  if (!isSettings(payload)) throw new Error("settings_response_invalid");
  return payload;
}

export function ContentSafetySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [terms, setTerms] = useState("");
  const [showSensitive, setShowSensitive] = useState(false);
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
      const response = await fetch("/api/settings/content-safety", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await readSettings(response);
      setSettings(payload);
      setTerms(payload.terms.join(", "));
      setShowSensitive(payload.showSensitive);
      setPhase("ready");
    } catch {
      setPhase("load-error");
      setMessage("コンテンツ安全設定を読み込めませんでした。設定は変更されていません。再試行してください。");
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const beginEditing = () => {
    if (phase !== "save-error") return;
    setPhase("ready");
    setMessage("");
    setRetrySettings(null);
  };

  async function save(retry: Settings | null = null) {
    if (!settings || (phase !== "ready" && phase !== "save-error") || inFlight.current) return;
    const next = retry ?? {
      terms: terms.split(/[,\n]/).map((term) => term.trim()).filter(Boolean),
      showSensitive,
    };
    inFlight.current = true;
    setPhase("saving");
    setMessage("");
    setRetrySettings(null);
    try {
      const response = await fetch("/api/settings/content-safety", {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(15_000),
      });
      const saved = await readSettings(response);
      setSettings(saved);
      setTerms(saved.terms.join(", "));
      setShowSensitive(saved.showSensitive);
      setMessage("コンテンツ安全設定を保存しました。");
      void recordPersonalNodeEvent("hub.preference.update", {
        namespace: "content-safety",
        value: saved,
      });
      setPhase("ready");
    } catch {
      setRetrySettings(next);
      setMessage("コンテンツ安全設定を保存できませんでした。入力内容は保持されています。再試行してください。");
      setPhase("save-error");
    } finally {
      inFlight.current = false;
    }
  }

  const busy = phase === "loading" || phase === "saving";
  const hasError = phase === "load-error" || phase === "save-error";
  const statusText = phase === "loading"
    ? "設定を読み込んでいます。"
    : phase === "saving"
      ? "設定を保存しています。"
      : message;

  return (
    <div className="settings-note" aria-busy={busy}>
      <strong>コンテンツ安全設定</strong>
      {settings
        ? (
            <>
              <label>
                ミュートワード
                <UiInput
                  value={terms}
                  disabled={busy}
                  onChange={(event) => {
                    beginEditing();
                    setTerms(event.target.value);
                  }}
                  placeholder="カンマ区切り、最大50件"
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showSensitive}
                  disabled={busy}
                  onChange={(event) => {
                    beginEditing();
                    setShowSensitive(event.target.checked);
                  }}
                />
                センシティブな内容を確認付きで表示する
              </label>
              <UiButton
                type="button"
                size="compact"
                pending={phase === "saving"}
                pendingLabel="保存中…"
                disabled={busy}
                onClick={() => void save()}
              >
                保存
              </UiButton>
            </>
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
      <small
        role={hasError ? "alert" : "status"}
        aria-live={hasError ? "assertive" : "polite"}
      >
        {statusText}
      </small>
    </div>
  );
}
