"use client";

import { Download, Link2, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { UiButton, UiSelect, UiStatePanel } from "@/components/ui/primitives";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

type ProtocolLink = {
  id: string;
  protocol: "activitypub" | "atproto";
  remoteIdentifier: string;
  direction: "export" | "import" | "bidirectional";
  status: "active" | "paused" | "revoked";
};

type LoadPhase = "loading" | "ready" | "error";
type PendingAction =
  | { kind: "connect" }
  | { kind: "revoke"; id: string }
  | { kind: "follow" }
  | null;

const requestTimeoutMs = 15_000;

async function readErrorCode(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : "";
  } catch {
    return "";
  }
}

function requestFailureMessage(error: unknown, fallback: string) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "応答に時間がかかっています。通信状況を確認して、もう一度お試しください。";
  }
  if (error instanceof TypeError) {
    return "Hubへ通信できませんでした。接続を確認して、もう一度お試しください。";
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function responseFailureMessage(status: number, code: string, fallback: string) {
  if (status === 401) return "ログイン状態を確認して、もう一度お試しください。";
  if (status === 403) return "この操作を実行できません。ページを再読み込みしてから、もう一度お試しください。";
  if (status === 409 || code === "link_already_exists") {
    return "この接続先はすでに登録されています。一覧を確認してください。";
  }
  if (code === "invalid_protocol_link") {
    return "外部識別子を確認してください。ActivityPubはHTTPS URLまたは@user@host、AT ProtocolはDIDまたはハンドルを使用します。";
  }
  if (code === "invalid_atproto_actor") {
    return "AT ProtocolのハンドルまたはDIDを確認して、もう一度お試しください。";
  }
  if (status === 503) {
    return "外部サービスへ接続できませんでした。時間をおいて、もう一度お試しください。";
  }
  return fallback;
}

export function ExternalProtocolSettings() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [links, setLinks] = useState<ProtocolLink[]>([]);
  const [protocol, setProtocol] = useState<"activitypub" | "atproto">("activitypub");
  const [identifier, setIdentifier] = useState("");
  const [followActor, setFollowActor] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadPhase, setLoadPhase] = useState<LoadPhase>("loading");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const load = useCallback(async () => {
    setLoadPhase("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/core/external-protocols", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        const code = await readErrorCode(response);
        throw new Error(responseFailureMessage(
          response.status,
          code,
          "外部プロトコルの接続一覧を読み込めませんでした。",
        ));
      }
      const payload = await response.json() as { links?: unknown };
      if (!Array.isArray(payload.links)) {
        throw new Error("外部プロトコルの接続一覧を確認できませんでした。");
      }
      setLinks(payload.links as ProtocolLink[]);
      setLoadPhase("ready");
    } catch (error) {
      setLoadError(requestFailureMessage(
        error,
        "外部プロトコルの接続一覧を読み込めませんでした。",
      ));
      setLoadPhase("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    if (pendingAction || loadPhase !== "ready" || !identifier.trim()) return;
    setPendingAction({ kind: "connect" });
    setNotice("");
    setActionError("");
    try {
      const response = await fetch("/api/core/external-protocols", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ protocol, remoteIdentifier: identifier.trim(), direction: "export" }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const payload = await response.json().catch(() => null) as {
        authorizationUrl?: unknown;
        link?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(responseFailureMessage(
          response.status,
          typeof payload?.error === "string" ? payload.error : "",
          "外部プロトコルへ接続できませんでした。入力内容を確認して、もう一度お試しください。",
        ));
      }
      if (protocol === "atproto") {
        if (typeof payload?.authorizationUrl !== "string") {
          throw new Error("AT Protocolの認証を開始できませんでした。時間をおいて、もう一度お試しください。");
        }
        window.location.assign(payload.authorizationUrl);
        return;
      }
      const link = payload?.link;
      if (
        !link
        || typeof link !== "object"
        || typeof (link as ProtocolLink).id !== "string"
      ) {
        throw new Error("接続は完了した可能性がありますが、接続情報を確認できませんでした。一覧を再読み込みしてください。");
      }
      const confirmedLink = link as ProtocolLink;
      setLinks((current) => [
        confirmedLink,
        ...current.filter((item) => item.id !== confirmedLink.id),
      ]);
      setIdentifier("");
      setNotice("接続先を登録しました。");
    } catch (error) {
      setActionError(requestFailureMessage(error, "外部プロトコルへ接続できませんでした。"));
    } finally {
      setPendingAction(null);
    }
  }

  async function revoke(id: string) {
    if (pendingAction) return;
    setPendingAction({ kind: "revoke", id });
    setNotice("");
    setActionError("");
    try {
      const response = await fetch(`/api/core/external-protocols?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        const code = await readErrorCode(response);
        throw new Error(responseFailureMessage(
          response.status,
          code,
          "接続を解除できませんでした。もう一度お試しください。",
        ));
      }
      setLinks((current) => current.filter((link) => link.id !== id));
      setNotice("接続を解除しました。");
    } catch (error) {
      setActionError(requestFailureMessage(error, "接続を解除できませんでした。"));
    } finally {
      setPendingAction(null);
    }
  }

  async function followExternalActor() {
    if (pendingAction || !followActor.trim()) return;
    setPendingAction({ kind: "follow" });
    setNotice("");
    setActionError("");
    try {
      const response = await fetch(
        "/api/core/external-protocols/atproto/follow",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actor: followActor.trim() }),
          signal: AbortSignal.timeout(requestTimeoutMs),
        },
      );
      const payload = await response.json().catch(() => null) as {
        followed?: { handle?: unknown };
        error?: unknown;
      } | null;
      if (!response.ok) {
        throw new Error(responseFailureMessage(
          response.status,
          typeof payload?.error === "string" ? payload.error : "",
          "AT Protocolアカウントをフォローできませんでした。入力内容を確認して、もう一度お試しください。",
        ));
      }
      const handle = typeof payload?.followed?.handle === "string"
        ? payload.followed.handle
        : followActor.trim();
      setFollowActor("");
      setNotice(`${handle}をフォローしました。`);
    } catch (error) {
      setActionError(requestFailureMessage(
        error,
        "AT Protocolアカウントをフォローできませんでした。",
      ));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      <div className="settings-note">
        <strong>外部プロトコル</strong>
        <p>公開プロフィールの移行先を登録します。非公開メッセージ、Account ID、ウォレット情報は共有しません。</p>
      </div>
      <label className="setting-select">
        <span><strong>接続方式</strong><small>ActivityPubまたはAT Protocolを選択します</small></span>
        <UiSelect
          aria-label="接続方式"
          value={protocol}
          disabled={pendingAction?.kind === "connect"}
          onChange={(event) => {
            setProtocol(event.target.value as "activitypub" | "atproto");
            setActionError("");
          }}
        >
          <option value="activitypub">ActivityPub</option>
          <option value="atproto">AT Protocol</option>
        </UiSelect>
      </label>
      <label className="setting-select">
        <span>
          <strong>外部識別子</strong>
          <small>{protocol === "activitypub" ? "@user@host または HTTPS URL" : "did:plc:... またはハンドル"}</small>
        </span>
        <input
          value={identifier}
          disabled={pendingAction?.kind === "connect"}
          onChange={(event) => {
            setIdentifier(event.target.value);
            setActionError("");
          }}
          placeholder={protocol === "activitypub" ? "@name@example.social" : "name.bsky.social"}
        />
      </label>
      <UiButton
        type="button"
        pending={pendingAction?.kind === "connect"}
        pendingLabel={protocol === "atproto" ? "認証を開始中…" : "接続先を登録中…"}
        disabled={Boolean(pendingAction) || loadPhase !== "ready" || !identifier.trim()}
        onClick={() => void connect()}
      >
        <Link2 aria-hidden="true" />
        {protocol === "atproto" ? "AT Protocolで認証" : "接続先を登録"}
      </UiButton>
      {loadPhase === "loading" ? (
        <UiStatePanel
          state="loading"
          title="外部プロトコルの接続を読み込み中"
          description="登録済みの接続先を確認しています。"
        />
      ) : null}
      {loadPhase === "error" ? (
        <UiStatePanel
          state="error"
          title="外部プロトコルの接続を読み込めませんでした"
          description={loadError}
          action={(
            <UiButton type="button" onClick={() => void load()}>
              一覧を再読み込み
            </UiButton>
          )}
        />
      ) : null}
      {loadPhase === "ready" && links.filter((link) => link.status !== "revoked").length === 0 ? (
        <UiStatePanel
          state="empty"
          title="登録済みの接続先はありません"
          description="接続方式と外部識別子を入力すると、公開プロフィールの移行先を登録できます。"
        />
      ) : null}
      {links.filter((link) => link.status !== "revoked").map((link) => (
        <div className="setting-row" key={link.id}>
          <span>
            <strong>{link.protocol === "activitypub" ? "ActivityPub" : "AT Protocol"}</strong>
            <small>{link.remoteIdentifier}</small>
          </span>
          <UiButton
            type="button"
            pending={pendingAction?.kind === "revoke" && pendingAction.id === link.id}
            pendingLabel="解除中…"
            disabled={Boolean(pendingAction)}
            onClick={() => void revoke(link.id)}
            aria-label={`${link.remoteIdentifier}との接続を解除`}
          >
            <Trash2 aria-hidden="true" />
          </UiButton>
        </div>
      ))}
      {links.some((link) =>
        link.protocol === "atproto" && link.status === "active"
      ) ? (
        <>
          <label className="setting-select">
            <span>
              <strong>外部SNSをフォロー</strong>
              <small>AT ProtocolのハンドルまたはDID</small>
            </span>
            <input
              value={followActor}
              disabled={pendingAction?.kind === "follow"}
              onChange={(event) => {
                setFollowActor(event.target.value);
                setActionError("");
              }}
              placeholder="name.bsky.social"
            />
          </label>
          <UiButton
            type="button"
            pending={pendingAction?.kind === "follow"}
            pendingLabel="フォロー中…"
            disabled={Boolean(pendingAction) || !followActor.trim()}
            onClick={() => void followExternalActor()}
          >
            <Link2 aria-hidden="true" />
            フォロー
          </UiButton>
          <a
            className="settings-reset"
            href={hubSurfacePath(surface, "/feed/external")}
          >
            外部SNSフィードを見る
          </a>
        </>
      ) : null}
      <a className="settings-reset" href="/api/core/portability/export" download>
        <Download aria-hidden="true" />
        Hubデータを書き出す
      </a>
      {notice ? <p className="settings-note" role="status">{notice}</p> : null}
      {actionError ? <p className="settings-note" role="alert">{actionError}</p> : null}
    </>
  );
}
