"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

import { UiButton } from "@/components/ui/primitives";

type State = { enabled: boolean; discoverable: boolean; actorUrl: string | null };
type Status = "loading" | "ready" | "saving" | "load-error" | "save-error";

function isFederationState(value: unknown): value is State {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<State>;
  return (
    typeof candidate.enabled === "boolean"
    && typeof candidate.discoverable === "boolean"
    && (candidate.actorUrl === null || typeof candidate.actorUrl === "string")
  );
}

async function readFederationState(response: Response) {
  if (!response.ok) throw new Error("federation_request_failed");
  const payload: unknown = await response.json();
  if (!isFederationState(payload)) throw new Error("federation_response_invalid");
  return payload;
}

export function FederationSettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [state, setState] = useState<State | null>(null);
  const [retryState, setRetryState] = useState<State | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const copy = ja
    ? {
        title: "Fediverse連携",
        retry: "再試行",
        retrySave: "保存を再試行",
        checking: "設定を読み込んでいます。",
        saving: "設定を保存しています。",
        loadError: "Fediverse連携設定を読み込めませんでした。設定は変更されていません。再試行してください。",
        saveError: "Fediverse連携設定を保存できませんでした。現在表示している設定は保存済みの内容です。再試行してください。",
        saved: "Fediverse連携設定を保存しました。",
        enable: "外部サーバーからのフォローを許可する",
        enableDescription: "いつでも無効にできます。外部サーバー上の既存コピーは削除できません。",
        discoverable: "外部検索に表示する",
        discoverableDescription: "有効な間、WebFingerで見つけられるようになります。",
      }
    : {
        title: "Fediverse connection",
        retry: "Retry",
        retrySave: "Retry save",
        checking: "Checking settings.",
        saving: "Saving settings.",
        loadError: "Federation settings could not be loaded. Your settings have not been changed. Please retry.",
        saveError: "Federation settings could not be saved. The settings shown are the last saved values. Please retry.",
        saved: "Federation settings saved.",
        enable: "Allow follows from external social servers",
        enableDescription: "You can turn this off anytime. Remote copies cannot be forcibly removed.",
        discoverable: "Show in external search",
        discoverableDescription: "Makes your account discoverable through WebFinger while enabled.",
      };

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus("loading");
    setMessage("");
    setRetryState(null);
    setState(null);
    try {
      const response = await fetch("/api/core/federation", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15_000),
      });
      setState(await readFederationState(response));
      setStatus("ready");
    } catch {
      setStatus("load-error");
      setMessage(copy.loadError);
    } finally {
      inFlight.current = false;
    }
  }, [ja]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: State) {
    if (!state || (status !== "ready" && status !== "save-error") || inFlight.current) return;
    inFlight.current = true;
    setStatus("saving");
    setMessage("");
    setRetryState(null);
    try {
      const response = await fetch("/api/core/federation", {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: next.enabled,
          discoverable: next.discoverable,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      setState(await readFederationState(response));
      setMessage(copy.saved);
      setStatus("ready");
    } catch {
      setRetryState(next);
      setMessage(copy.saveError);
      setStatus("save-error");
    } finally {
      inFlight.current = false;
    }
  }

  const busy = status === "loading" || status === "saving";
  const hasError = status === "load-error" || status === "save-error";
  const statusText = status === "loading"
    ? copy.checking
    : status === "saving"
      ? copy.saving
      : message;

  return (
    <div className="settings-card" aria-busy={busy}>
      <div className="settings-note">
        <strong>{copy.title}</strong>
        <p>
          {ja
            ? "公開プロフィールと、連携を有効にした後に公開した投稿だけをActivityPubへ共有します。ウォレット、支払い、非公開メッセージ、AIデータは共有しません。"
            : "Only your public profile and public posts created after opt-in are shared. Wallet, payment, private message, and AI data stay private."}
        </p>
      </div>
      {state
        ? (
            <>
              <label className="setting-row">
                <span>
                  <strong>{copy.enable}</strong>
                  <small>{copy.enableDescription}</small>
                </span>
                <input
                  type="checkbox"
                  checked={state.enabled}
                  disabled={busy}
                  onChange={(event) => void save({
                    ...state,
                    enabled: event.target.checked,
                    discoverable: event.target.checked && state.discoverable,
                  })}
                />
                <i aria-hidden="true" />
              </label>
              <label className="setting-row">
                <span>
                  <strong>{copy.discoverable}</strong>
                  <small>{copy.discoverableDescription}</small>
                </span>
                <input
                  type="checkbox"
                  checked={state.discoverable}
                  disabled={!state.enabled || busy}
                  onChange={(event) => void save({
                    ...state,
                    discoverable: event.target.checked,
                  })}
                />
                <i aria-hidden="true" />
              </label>
              {state.actorUrl
                ? (
                    <p className="settings-note">
                      <strong>{state.actorUrl}</strong>
                    </p>
                  )
                : null}
            </>
          )
        : null}
      {status === "load-error"
        ? <UiButton type="button" size="compact" onClick={() => void load()}>{copy.retry}</UiButton>
        : null}
      {retryState
        ? (
            <UiButton
              type="button"
              size="compact"
              disabled={busy}
              onClick={() => void save(retryState)}
            >
              {copy.retrySave}
            </UiButton>
          )
        : null}
      <p
        className="settings-note"
        role={hasError ? "alert" : "status"}
        aria-live={hasError ? "assertive" : "polite"}
      >
        {statusText}
      </p>
    </div>
  );
}
