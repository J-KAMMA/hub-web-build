"use client";

import React, { useState } from "react";
import {
  AuthRequestTimeoutError,
  fetchAuthRequest,
} from "@/lib/auth-client-request";
import { AsyncActionButton } from "./async-action-button";

const REAUTHENTICATION_URL =
  "/auth?reauth=1&next=%2Faccount%23account-recovery";

export function AccountRecoveryPanel() {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [requiresReauthentication, setRequiresReauthentication] = useState(false);

  const rotate = async () => {
    setPending(true);
    setError("");
    setRequiresReauthentication(false);
    try {
      const response = await fetchAuthRequest("/account/api/v1/recovery/codes", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => null) as { recoveryCodes?: unknown; error?: string } | null;
      if (!response.ok) {
        const needsLogin = body?.error === "recent_authentication_required"
          || body?.error === "unauthorized";
        setRequiresReauthentication(needsLogin);
        setError(needsLogin
          ? "安全のため、共通Accountのパスキーでもう一度本人確認してから作り直してください。"
          : "復旧コードを作り直せず、コード更新の成否を確認できません。以前のコードを使用せず、もう一度作り直して最後に表示されたコードだけを保存してください。");
        return;
      }
      const nextCodes = Array.isArray(body?.recoveryCodes)
        ? body.recoveryCodes.filter((code): code is string => typeof code === "string")
        : [];
      if (nextCodes.length === 0) {
        setError("新しい復旧コードを確認できず、以前のコードが有効か判断できません。もう一度作り直し、最後に表示されたコードだけを保存してください。");
        return;
      }
      setCodes(nextCodes);
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof AuthRequestTimeoutError
        ? "Accountからの応答が時間切れになり、コード更新の成否を確認できません。以前のコードを使用せず、もう一度作り直して最後に表示されたコードだけを保存してください。"
        : "Accountへ接続できず、コード更新の成否を確認できません。以前のコードを使用せず、もう一度作り直して最後に表示されたコードだけを保存してください。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section id="account-recovery" className="hub-account__section account-recovery-panel" aria-labelledby="account-recovery-heading">
      <header>
        <div>
          <h2 id="account-recovery-heading">アカウント復旧</h2>
          <p>パスキーを使えない場合に、未使用の復旧コードから新しいパスキーを作れます。</p>
        </div>
      </header>
      {codes.length > 0 ? <>
        <p className="account-recovery-panel__warning">以前のコードは無効になりました。このコードは今だけ表示されます。</p>
        <ul className="account-recovery-panel__codes">
          {codes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ul>
      </> : confirming ? <>
        <p>作り直すと、以前の未使用コードもすべて無効になります。</p>
        <div className="account-recovery-panel__actions">
          <button type="button" onClick={() => setConfirming(false)} disabled={pending}>キャンセル</button>
          <AsyncActionButton type="button" pending={pending} pendingLabel="作成中…" onClick={rotate}>
            作り直す
          </AsyncActionButton>
        </div>
      </> : <button type="button" onClick={() => setConfirming(true)}>復旧コードを作り直す</button>}
      {error && <p role="alert" className="hub-auth-error">{error}</p>}
      {requiresReauthentication ? (
        <a href={REAUTHENTICATION_URL}>
          パスキーでもう一度本人確認する
        </a>
      ) : null}
    </section>
  );
}
