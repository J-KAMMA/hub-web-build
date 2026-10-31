"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { useHubSurfaceNavigation } from "@/lib/use-hub-surface-navigation";

type SessionProfile = { handle: string; displayName: string };
type LoadPhase = "loading" | "ready" | "error";
type AccountAction = "logout" | "logout-all" | "delete" | "cancel-delete" | null;
/* 削除の予約。実行は申請の30日後（lib/server/profile-deletion.ts）。 */
type DeletionSchedule = { scheduled: boolean; executeAfter?: string; state?: "scheduled" | "running" | "completed"; canCancel?: boolean };

function formatExecuteDate(iso: string | undefined): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return "予定日";
  return new Date(time).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function accountRequest(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "操作を完了できませんでした。");
  }
  return response;
}

/*
 * アカウントの経路の根（2026-09-04）。
 *
 * 行き先を "/account" に焼き込んでいた。この部品を描いているのは今は
 * /v2/account だけなので、v2 の利用者が「アカウントを管理」「取引を管理」を
 * 押すと既存の画面へ出て、左列も右列も変わっていた。
 */
const DEFAULT_ACCOUNT_BASE = "/account";

export function HubAccountControls({ basePath = DEFAULT_ACCOUNT_BASE }: { basePath?: string } = {}) {
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const navigateHubRoute = useHubSurfaceNavigation();
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [action, setAction] = useState<AccountAction>(null);
  const [activeSessionCount, setActiveSessionCount] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [deletion, setDeletion] = useState<DeletionSchedule | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setStatus("");
    setActiveSessionCount(null);
    setDeletion(null);
    try {
      const response = await accountRequest("/api/auth/session");
      const payload = await response.json().catch(() => null) as { profile?: SessionProfile | null } | null;
      const nextProfile = payload?.profile ?? null;
      setProfile(nextProfile);
      setPhase("ready");
      if (nextProfile) {
        try {
          const sessionResponse = await accountRequest("/api/auth/sessions");
          const sessionPayload = await sessionResponse.json().catch(() => null) as { activeCount?: number } | null;
          setActiveSessionCount(typeof sessionPayload?.activeCount === "number" ? sessionPayload.activeCount : null);
        } catch {
          setActiveSessionCount(null);
        }
        try {
          const deletionResponse = await accountRequest("/api/account/deletion-request");
          setDeletion(await deletionResponse.json().catch(() => null) as DeletionSchedule | null);
        } catch {
          setDeletion(null);
        }
      }
    } catch {
      setPhase("error");
      setStatus("ログイン状態を確認できませんでした。現在のセッションは変更されていません。");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const logout = async () => {
    if (action) return;
    setAction("logout");
    setStatus("");
    try {
      await accountRequest("/api/auth/logout", { method: "POST" });
      setProfile(null);
      navigateHubRoute("/auth", { replace: true, refresh: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ログアウトできませんでした。");
    } finally {
      setAction(null);
    }
  };

  const logoutEverywhere = async () => {
    if (!window.confirm("すべての端末からログアウトしますか？")) return;
    if (action) return;
    setAction("logout-all");
    setStatus("");
    try {
      await accountRequest("/api/auth/sessions", { method: "DELETE" });
      setProfile(null);
      navigateHubRoute("/auth", { replace: true, refresh: true });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "全端末ログアウトを実行できませんでした。");
    } finally {
      setAction(null);
    }
  };
  const requestDeletion = async () => {
    if (!window.confirm("プロフィールの削除を申請しますか？\n30日後に、プロフィールと個人に結びつくデータが削除されます。ほかの人のスレッドへのコメントなどは「削除されたユーザー」の名前で残り、取引など法令上必要な記録も残ります。\n30日たつまでは取り消せます。")) return;
    if (action) return;
    setAction("delete");
    setStatus("");
    try {
      const response = await accountRequest("/api/account/deletion-request", { method: "POST" });
      const schedule = await response.json().catch(() => null) as DeletionSchedule | null;
      setDeletion(schedule?.scheduled ? schedule : null);
      setStatus(schedule?.scheduled ? `削除を予約しました。${formatExecuteDate(schedule.executeAfter)}に実行されます。それまでは取り消せます。` : "削除申請を受け付けました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "削除申請を送信できませんでした。");
    } finally {
      setAction(null);
    }
  };

  const cancelDeletion = async () => {
    if (action) return;
    setAction("cancel-delete");
    setStatus("");
    try {
      await accountRequest("/api/account/deletion-request", { method: "DELETE" });
      setDeletion({ scheduled: false });
      setStatus("削除の申請を取り消しました。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "削除の申請を取り消せませんでした。");
    } finally {
      setAction(null);
    }
  };

  if (phase === "loading") return <div className="settings-note" aria-busy="true"><strong>アカウントを確認中…</strong></div>;
  if (phase === "error") return <div className="settings-note" role="alert">
    <strong>アカウントを確認できません</strong>
    <p>{status}</p>
    <button type="button" className="button" onClick={() => void load()}>再試行</button>
  </div>;
  if (!profile) return <Link href={hubSurfacePath(surface, "/auth")}>ログイン・新規登録 <span aria-hidden="true">›</span></Link>;

  return (
    <div className="settings-note">
      <strong>{profile.displayName} <small>@{profile.handle}</small></strong>
      <p>このHubアカウントでプロフィールと取引を利用できます。公開情報と取引情報は分離されます。</p>
      <p>{activeSessionCount === null ? "有効なログインを確認できません。" : `有効なログイン：${activeSessionCount}件`}</p>
      <div className="hub-account__session-actions">
      <button type="button" className="settings-reset" disabled={Boolean(action)} onClick={() => void logout()}>
        {action === "logout" ? "ログアウト中…" : "ログアウト"}
      </button>
      <button type="button" className="settings-reset" disabled={Boolean(action)} onClick={() => void logoutEverywhere()}>
        {action === "logout-all" ? "処理中…" : "すべての端末からログアウト"}
      </button>
      </div>
      <ul className="hub-account__link-rows">
      <li><a href="/api/account/data-export" download>Hubデータをエクスポート</a></li>
      <li><Link href={basePath}>アカウントを管理 <span aria-hidden="true">›</span></Link></li>
      <li><Link href={`${basePath}/transactions`}>取引を管理 <span aria-hidden="true">›</span></Link></li>
      </ul>
      {deletion?.scheduled ? (
        <div className="settings-note" role="group" aria-label="プロフィール削除の予約">
          <strong>プロフィールの削除を予約しています</strong>
          {deletion.state === "scheduled" && deletion.canCancel ? (
            <>
              <p>{formatExecuteDate(deletion.executeAfter)}に実行されます。それまでは取り消せます。</p>
              <button type="button" className="settings-reset" disabled={Boolean(action)} onClick={() => void cancelDeletion()}>
                {action === "cancel-delete" ? "取り消し中…" : "削除の申請を取り消す"}
              </button>
            </>
          ) : (
            <p>{deletion.state === "completed" ? "削除は完了しました。" : "削除を実行しています。この段階では取り消せません。"}</p>
          )}
        </div>
      ) : (
        <button type="button" className="settings-reset" disabled={Boolean(action)} onClick={() => void requestDeletion()}>
          {action === "delete" ? "申請中…" : "プロフィール削除を申請"}
        </button>
      )}
      {status ? <p role="status" aria-live="polite">{status}</p> : null}
    </div>
  );
}
