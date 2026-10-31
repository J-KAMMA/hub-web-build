"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

type Prefs = {
  replies: boolean;
  corrections: boolean;
  bestAnswers: boolean;
  stateChanges: boolean;
  summaryPromotions: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preferences: Prefs };

type FailedUpdate = {
  key: keyof Prefs;
  value: boolean;
};

const REQUEST_TIMEOUT_MS = 12_000;
const preferenceKeys = [
  "replies",
  "corrections",
  "bestAnswers",
  "stateChanges",
  "summaryPromotions",
] as const satisfies readonly (keyof Prefs)[];
const labels: Record<keyof Prefs, string> = {
  replies: "返信",
  corrections: "訂正",
  bestAnswers: "回答の採用",
  stateChanges: "状態変更",
  summaryPromotions: "読み方ガイド掲載",
};

function isPreferences(value: unknown): value is Prefs {
  if (!value || typeof value !== "object") return false;
  return preferenceKeys.every((key) => typeof (value as Partial<Prefs>)[key] === "boolean");
}

async function responseError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function readableRequestError(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "通信がタイムアウトしました。接続を確認して再試行してください。";
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function ThreadEventPreferences({ threadId }: { threadId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pendingKey, setPendingKey] = useState<keyof Prefs | null>(null);
  const [saveError, setSaveError] = useState("");
  const [failedUpdate, setFailedUpdate] = useState<FailedUpdate | null>(null);
  const generationRef = useRef(0);
  const mutationControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    mutationControllerRef.current?.abort();
    setPendingKey(null);
    setSaveError("");
    setFailedUpdate(null);
    setLoadState({ status: "loading" });

    void (async () => {
      try {
        const response = await fetch(
          `/api/bbs/threads/${encodeURIComponent(threadId)}/notification-preferences`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(await responseError(response, "通知設定を取得できませんでした。"));
        }
        const body = await response.json() as { preferences?: unknown };
        if (!isPreferences(body.preferences)) {
          throw new Error("通知設定の応答を確認できませんでした。");
        }
        if (generation === generationRef.current) {
          setLoadState({ status: "ready", preferences: body.preferences });
        }
      } catch (error) {
        if (generation !== generationRef.current) return;
        setLoadState({
          status: "error",
          message: readableRequestError(error, "通知設定を取得できませんでした。"),
        });
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [loadAttempt, threadId]);

  useEffect(() => () => mutationControllerRef.current?.abort(), []);

  const update = useCallback(async (key: keyof Prefs, value: boolean) => {
    if (loadState.status !== "ready" || pendingKey) return;

    const generation = generationRef.current;
    const previous = loadState.preferences;
    const next = { ...previous, [key]: value };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = controller;
    setLoadState({ status: "ready", preferences: next });
    setPendingKey(key);
    setSaveError("");
    setFailedUpdate(null);

    try {
      const response = await fetch(
        `/api/bbs/threads/${encodeURIComponent(threadId)}/notification-preferences`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "通知設定を保存できませんでした。"));
      }
      const body = await response.json() as { preferences?: unknown };
      if (!isPreferences(body.preferences)) {
        throw new Error("保存結果を確認できませんでした。");
      }
      if (generation === generationRef.current) {
        setLoadState({ status: "ready", preferences: body.preferences });
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      setLoadState({ status: "ready", preferences: previous });
      setSaveError(readableRequestError(error, "通知設定を保存できませんでした。"));
      setFailedUpdate({ key, value });
    } finally {
      window.clearTimeout(timeout);
      if (generation === generationRef.current) {
        mutationControllerRef.current = null;
        setPendingKey(null);
      }
    }
  }, [loadState, pendingKey, threadId]);

  if (loadState.status === "loading") {
    return (
      <div className="thread-event-preferences thread-event-preferences__status" role="status" aria-live="polite">
        通知設定を読み込み中…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="thread-event-preferences thread-event-preferences__status" role="alert">
        <p>{loadState.message}</p>
        <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          再試行
        </button>
      </div>
    );
  }

  return (
    <details className="thread-event-preferences">
      <summary>通知する内容</summary>
      <div aria-busy={Boolean(pendingKey)}>
        {preferenceKeys.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={loadState.preferences[key]}
              disabled={Boolean(pendingKey)}
              onChange={(event) => void update(key, event.target.checked)}
            />
            {labels[key]}
          </label>
        ))}
      </div>
      <div className="thread-event-preferences__feedback" aria-live="polite">
        {pendingKey ? <p role="status">{labels[pendingKey]}の設定を保存中…</p> : null}
        {saveError ? (
          <p role="alert">
            {saveError}
            {failedUpdate ? (
              <button
                type="button"
                onClick={() => void update(failedUpdate.key, failedUpdate.value)}
              >
                再試行
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </details>
  );
}
