"use client";

import { useEffect, useState } from "react";
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Cloud, Download, Link2Off, LogOut, ShieldCheck, Trash2, Upload, X } from "lucide-react";

type Memory = { id: string; content: string };
const ACCOUNT = "/account/api/v1";

async function account(path: string, init?: RequestInit) {
  const response = await fetch(`${ACCOUNT}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : "account_unavailable",
    );
  return body;
}
async function aiAssertion() {
  const body = await account("/assertions/ai", { method: "POST" });
  if (typeof body.assertion !== "string")
    throw new Error("assertion_unavailable");
  return body.assertion;
}

export function AiAccountSyncPanel({ onClose }: { onClose: () => void }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [syncEnabled, setSyncEnabledState] = useState(false);
  const [linked, setLinked] = useState(false);
  const [deviceMemories, setDeviceMemories] = useState<Memory[]>([]);
  const [accountMemoryCount, setAccountMemoryCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Accountへ接続しています。");

  function setSyncEnabled(value: boolean) {
    setSyncEnabledState(value);
    if (value) window.sessionStorage.setItem("ai.account-sync", "on");
    else window.sessionStorage.removeItem("ai.account-sync");
    window.dispatchEvent(new Event("ai-account-sync-changed"));
  }

  useEffect(() => {
    void refresh();
  }, []);
  async function refresh() {
    try {
      const session = await account("/session");
      setAuthenticated(true);
      setDisplayName(
        String(
          (session.account as { displayName?: unknown })?.displayName ??
            "Account",
        ),
      );
      const link = await account("/links/ai");
      setLinked(link.linked === true);
      setMessage(link.linked === true ? "AIとAccountは連携済みです。同期は端末ごとにONにできます。" : "Accountにログインしています。AI連携はまだOFFです。");
    } catch {
      setAuthenticated(false);
      setLinked(false);
      setMessage(
        "パスキーでAccountへログインすると、AIメモリを端末間で同期できます。",
      );
    }
    fetch("/ai/api/memory", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { memories: [] }))
      .then((body) =>
        setDeviceMemories(Array.isArray(body.memories) ? body.memories : []),
      )
      .catch(() => undefined);
  }
  async function register() {
    if (!displayName.trim()) return setMessage("表示名を入力してください。");
    setBusy(true);
    try {
      const begin = await account("/passkeys/register/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() }),
      });
      const response = await startRegistration({
        optionsJSON: begin.options as never,
      });
      await account("/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(response),
      });
      await refresh();
      setMessage("Accountを作成しました。同期はまだOFFです。");
    } catch (error) {
      setMessage(
        `登録できませんでした: ${error instanceof Error ? error.message : "registration_failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    setBusy(true);
    try {
      const begin = await account("/passkeys/authenticate/options", {
        method: "POST",
      });
      const response = await startAuthentication({
        optionsJSON: begin.options as never,
      });
      await account("/passkeys/authenticate/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(response),
      });
      await refresh();
      setMessage("ログインしました。同期するデータを確認してください。");
    } catch (error) {
      setMessage(
        `ログインできませんでした: ${error instanceof Error ? error.message : "authentication_failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function enableSync() {
    setBusy(true);
    try {
      if (!linked) {
        await account("/links/ai", { method: "POST" });
        setLinked(true);
      }
      const assertion = await aiAssertion();
      const response = await fetch("/ai/api/memory", {
        headers: { authorization: `Bearer ${assertion}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("ai_sync_unavailable");
      const body = (await response.json()) as { memories?: Memory[] };
      setAccountMemoryCount(body.memories?.length ?? 0);
      setSyncEnabled(true);
      window.sessionStorage.setItem("ai.account-sync", "on");
      window.dispatchEvent(new Event("ai-account-sync-changed"));
      setMessage(
        "Account同期をONにしました。端末メモリは確認後に移行できます。",
      );
    } catch (error) {
      setMessage(
        `同期を開始できませんでした: ${error instanceof Error ? error.message : "sync_failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function unlinkAi() {
    if (!window.confirm("AIとAccountの連携を解除しますか？AI側のデータは削除されません。")) return;
    setBusy(true);
    try {
      await account("/links/ai", { method: "DELETE" });
      setLinked(false);
      disableSync();
      setMessage("AI連携を解除しました。AI側データの削除は別操作です。");
    } catch (error) {
      setMessage(`連携を解除できませんでした: ${error instanceof Error ? error.message : "unlink_failed"}`);
    } finally { setBusy(false); }
  }
  async function migrate() {
    if (
      !window.confirm(
        `端末内のメモリ${deviceMemories.length}件をAccountへコピーします。続けますか？`,
      )
    )
      return;
    setBusy(true);
    try {
      for (const memory of deviceMemories) {
        const assertion = await aiAssertion();
        const response = await fetch("/ai/api/memory", {
          method: "POST",
          headers: {
            authorization: `Bearer ${assertion}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content: memory.content }),
        });
        if (!response.ok && response.status !== 409)
          throw new Error("migration_failed");
      }
      setAccountMemoryCount((count) => Math.max(count, deviceMemories.length));
      setMessage(
        "端末メモリをAccountへ移行しました。端末側の削除は別操作です。",
      );
    } catch (error) {
      setMessage(
        `移行できませんでした: ${error instanceof Error ? error.message : "migration_failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function deleteSynced() {
    if (!window.confirm("Accountに同期したメモリ、会話、プロジェクト、設定を完全に削除しますか？"))
      return;
    setBusy(true);
    try {
      const assertion = await aiAssertion();
      const response = await fetch("/ai/api/account-data", {
        method: "DELETE",
        headers: { authorization: `Bearer ${assertion}` },
      });
      if (!response.ok) throw new Error("delete_failed");
      setAccountMemoryCount(0);
      disableSync();
      setMessage("Account側のAIデータを完全に削除しました。");
    } catch (error) {
      setMessage(
        `削除できませんでした: ${error instanceof Error ? error.message : "delete_failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function exportSynced() {
    setBusy(true);
    try {
      const assertion = await aiAssertion();
      const response = await fetch("/ai/api/account-data", { headers: { authorization: `Bearer ${assertion}` }, cache: "no-store" });
      if (!response.ok) throw new Error("export_failed");
      const source = await response.json() as unknown;
      const passphrase=window.prompt("暗号化パスフレーズを入力してください（12文字以上）。紛失すると復元できません。");
      if(!passphrase)return;
      const {encryptAiMemoryBundle}=await import("@/lib/ai-memory-transfer");
      const encrypted=await encryptAiMemoryBundle(source,passphrase);
      const blob = new Blob([JSON.stringify(encrypted)],{type:"application/json"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `jkamma-ai-account-${new Date().toISOString().slice(0, 10)}.jkai`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("AIアカウントデータを書き出しました。");
    } catch (error) {
      setMessage(`書き出せませんでした: ${error instanceof Error ? error.message : "export_failed"}`);
    } finally { setBusy(false); }
  }
  async function importEncrypted(){
    const picker=document.createElement("input");picker.type="file";picker.accept=".jkai,application/json";
    picker.onchange=async()=>{const file=picker.files?.[0];if(!file)return;setBusy(true);try{if(file.size>2_000_000)throw new Error("file_too_large");const passphrase=window.prompt("この記憶ファイルのパスフレーズを入力してください。");if(!passphrase)return;const bundle=JSON.parse(await file.text());const {decryptAiMemoryBundle}=await import("@/lib/ai-memory-transfer");const source=await decryptAiMemoryBundle(bundle,passphrase) as {memories?:unknown[]};if(!Array.isArray(source.memories))throw new Error("invalid_import");let assertion=await aiAssertion();let response=await fetch("/ai/api/memory/import-preview",{method:"POST",headers:{authorization:`Bearer ${assertion}`,"content-type":"application/json"},body:JSON.stringify({memories:source.memories})});if(!response.ok)throw new Error("preview_failed");const preview=await response.json() as {preview:{total:number;newCount:number;duplicates:number;conflicts:number};fingerprint:string;memories:unknown[]};if(!window.confirm(`記憶${preview.preview.total}件を確認しました。\n新規 ${preview.preview.newCount}件・重複 ${preview.preview.duplicates}件・競合候補 ${preview.preview.conflicts}件\n取り込みますか？`))return;assertion=await aiAssertion();response=await fetch("/ai/api/memory/import",{method:"POST",headers:{authorization:`Bearer ${assertion}`,"content-type":"application/json"},body:JSON.stringify({memories:preview.memories,fingerprint:preview.fingerprint})});if(!response.ok)throw new Error("import_failed");const result=await response.json() as {imported:number;skipped:number};setMessage(`記憶を${result.imported}件取り込み、${result.skipped}件の重複を除外しました。`);await refresh();}catch(error){setMessage(`インポートできませんでした: ${error instanceof Error?error.message:"import_failed"}`);}finally{setBusy(false);}};picker.click();
  }
  function disableSync() {
    setSyncEnabled(false);
    window.sessionStorage.removeItem("ai.account-sync");
    window.dispatchEvent(new Event("ai-account-sync-changed"));
  }
  async function logout() {
    await account("/session", { method: "DELETE" }).catch(() => undefined);
    setAuthenticated(false);
    disableSync();
    setMessage("この端末からログアウトしました。");
  }

  return (
    <div
      className="ai-account"
      role="dialog"
      aria-modal="true"
      aria-label="AIアカウント同期"
    >
      <button
        type="button"
        className="ai-account__backdrop"
        onClick={onClose}
        aria-label="閉じる"
      />
      <section>
        <header>
          <div>
            <small>ACCOUNT × AI</small>
            <h2>AIアカウント同期</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる">
            <X aria-hidden="true" />
          </button>
        </header>
        {authenticated === false ? (
          <div className="ai-account__auth">
            <ShieldCheck aria-hidden="true" />
            <h3>パスキーで保護</h3>
            <p>
              パスワードやウォレットをAIへ渡さず、AccountのAI専用匿名IDで同期します。
            </p>
            <label>
              Account表示名
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void register()}
            >
              新しいAccountを作成
            </button>
            <button
              type="button"
              disabled={busy}
              className="is-secondary"
              onClick={() => void login()}
            >
              パスキーでログイン
            </button>
          </div>
        ) : authenticated ? (
          <>
            <div className="ai-account__identity">
              <span>
                <Cloud aria-hidden="true" />
                <strong>{displayName}</strong>
              </span>
              <button type="button" onClick={() => void logout()}>
                <LogOut aria-hidden="true" />
                ログアウト
              </button>
            </div>
            <div className="ai-account__cards">
              <article>
                <small>同期状態</small>
                <strong>{syncEnabled ? "ON" : "OFF"}</strong>
                <p>
                  メモリ、会話、プロジェクト、設定はAI
                  Workerだけに保存されます。
                </p>
                <button
                  type="button"
                  disabled={busy || syncEnabled}
                  onClick={() => void enableSync()}
                >
                  同期をONにする
                </button>
                {syncEnabled ? (
                  <button
                    type="button"
                    className="is-secondary"
                    onClick={() => setSyncEnabled(false)}
                  >
                    同期をOFFにする
                  </button>
                ) : null}
                {linked ? (
                  <button type="button" className="is-secondary" disabled={busy} onClick={() => void unlinkAi()}>
                    <Link2Off aria-hidden="true" />
                    AI連携を解除
                  </button>
                ) : null}
              </article>
              <article>
                <small>端末メモリ</small>
                <strong>{deviceMemories.length}件</strong>
                <p>移行前に件数を確認し、元データは自動削除しません。</p>
                <button
                  type="button"
                  disabled={busy || !syncEnabled || deviceMemories.length === 0}
                  onClick={() => void migrate()}
                >
                  Accountへコピー
                </button>
              </article>
              <article>
                <small>Accountデータ</small>
                <strong>{accountMemoryCount}件</strong>
                <p>メモリ、会話、プロジェクト、設定を書き出し、または完全削除できます。</p>
                <button type="button" className="is-secondary" disabled={busy || !syncEnabled} onClick={() => void exportSynced()}>
                  <Download aria-hidden="true" />
                  エクスポート
                </button>
                <button
                  type="button"
                  className="is-secondary"
                  disabled={busy || !syncEnabled}
                  onClick={() => void importEncrypted()}
                >
                  <Upload aria-hidden="true" />
                  暗号化ファイルを取り込む
                </button>
                <button
                  type="button"
                  className="is-danger"
                  disabled={busy || !syncEnabled}
                  onClick={() => void deleteSynced()}
                >
                  <Trash2 aria-hidden="true" />
                  完全削除
                </button>
              </article>
            </div>
          </>
        ) : (
          <div className="ai-account__loading">確認しています…</div>
        )}
        <p className="ai-account__status" role="status">
          {message}
        </p>
      </section>
    </div>
  );
}
