"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { useCallback, useEffect, useRef, useState } from "react";

type LinkPhase = "loading" | "linked" | "unlinked" | "error";

function reauthenticationHref() {
  return `/auth?reauth=1&next=${encodeURIComponent("/account#account-link")}`;
}

async function accountLinkRequest(init?: RequestInit) {
  const response = await fetch("/account/api/v1/links/hub", {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "account_link_unavailable");
  }
  return response;
}

export function HubAccountLinkSettings() {
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const [phase, setPhase] = useState<LinkPhase>("loading");
  const [linkedAt, setLinkedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const actionRef = useRef(false);

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage("");
    try {
      const response = await accountLinkRequest();
      const payload = await response.json().catch(() => null) as {
        linked?: boolean;
        linkedAt?: string | null;
      } | null;
      setLinkedAt(typeof payload?.linkedAt === "string" ? payload.linkedAt : null);
      setPhase(payload?.linked ? "linked" : "unlinked");
    } catch {
      setPhase("error");
      setMessage("Accountとの連携状態を確認できませんでした。現在の連携は変更されていません。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function unlink() {
    if (actionRef.current || !window.confirm(
      "共通Accountとの連携を解除しますか？現在のHubセッションは維持されますが、次回からAccount経由でログインできなくなります。",
    )) return;
    actionRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await accountLinkRequest({ method: "DELETE" });
      setLinkedAt(null);
      setPhase("unlinked");
      setMessage("Accountとの連携を解除しました。Hubの公開プロフィールと投稿は削除されません。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "account_link_unavailable";
      setMessage(code === "recent_authentication_required"
        ? "連携解除の前に、Accountでもう一度本人確認してください。"
        : "Accountとの連携を解除できませんでした。現在の連携は変更されていません。");
    } finally {
      actionRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="hub-account__section" id="account-link" aria-labelledby="account-link-title">
      <header>
        <div>
          <h2 id="account-link-title">共通Accountとの連携</h2>
          <p>HubにはAccount IDを保存せず、Hub専用の匿名識別子だけを使います。</p>
        </div>
      </header>

      {phase === "loading" ? (
        <div className="settings-note" aria-busy="true"><strong>連携状態を確認中…</strong></div>
      ) : phase === "error" ? (
        <div className="settings-note" role="alert">
          <strong>連携状態を確認できません</strong>
          <p>{message}</p>
          <button type="button" className="button" onClick={() => void load()}>再試行</button>
        </div>
      ) : phase === "linked" ? (
        <div className="settings-note">
          <strong>連携済み</strong>
          <p>
            AccountのパスキーでHubへログインできます。
            {linkedAt ? ` 連携日：${new Date(linkedAt).toLocaleDateString("ja-JP")}` : ""}
          </p>
          <button type="button" className="settings-reset" disabled={busy} onClick={() => void unlink()}>
            {busy ? "解除中…" : "Accountとの連携を解除"}
          </button>
          {message ? (
            <p role="status" aria-live="polite">
              {message}
              {message.includes("本人確認") ? <><br /><a href={reauthenticationHref()}>本人確認へ進む</a></> : null}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="settings-note">
          <strong>未連携</strong>
          <p>Hubの現在のセッションは利用できます。Account経由の次回ログインには再連携が必要です。</p>
          <a href={`${hubSurfacePath(surface, "/auth")}?mode=login&next=%2Faccount`}>Accountで連携する</a>
          {message ? <p role="status" aria-live="polite">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
