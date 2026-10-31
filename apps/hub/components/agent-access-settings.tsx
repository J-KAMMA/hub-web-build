"use client";

import React, { useCallback, useEffect, useState } from "react";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";

type Grant = {
  id: string; label: string; source: string; scopes: string;
  expires_at: string; last_used_at: string | null;
};
type Draft = {
  id: string; body: string; destination_type: string; status: "draft" | "approved";
  created_at: string; agent_label: string; agent_source: string;
};

const sources = [
  ["codex", "Codex"], ["chatgpt", "ChatGPT"], ["claude", "Claude"],
  ["local_ai", "ローカルAI"], ["custom", "Gemini・OpenClaw・その他"],
] as const;
const scopeOptions = [
  ["social.read", "フィードと公開投稿を読む"],
  ["notifications.read", "通知を読む"],
  ["social.draft", "投稿・返信の下書きを作る"],
  ["social.publish", "承認済み下書きを公開する"],
  ["hubpedia.propose", "Hubpediaへ検証前の記憶候補を提案する"],
] as const;
const requestTimeoutMs = 15_000;

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `request_failed_${response.status}`);
  return data;
}

export function AgentAccessSettings() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [label, setLabel] = useState("Codex");
  const [source, setSource] = useState("codex");
  const [scopes, setScopes] = useState<string[]>(["social.read", "social.draft", "notifications.read"]);
  const [token, setToken] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const load = useCallback(async () => {
    setPhase("loading"); setError("");
    try {
      const [grantData, draftData] = await Promise.all([
        fetchJson<{ grants: Grant[] }>("/api/agent/grants", { cache: "no-store" }),
        fetchJson<{ drafts: Draft[] }>("/api/agent/drafts", { cache: "no-store" }),
      ]);
      setGrants(grantData.grants); setDrafts(draftData.drafts); setPhase("ready");
    } catch {
      setError("AI接続の情報を読み込めませんでした。通信状態を確認して再試行してください。");
      setPhase("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function chooseSource(next: string) {
    setSource(next);
    const display = sources.find(([value]) => value === next)?.[1];
    if (display) setLabel(display);
  }

  function toggleScope(scope: string) {
    setScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  }

  async function createGrant() {
    if (!label.trim() || scopes.length === 0 || pending) return;
    setPending("create"); setError(""); setToken("");
    try {
      const data = await fetchJson<{ id: string; token: string; scopes: string[]; expiresAt: string }>("/api/agent/grants", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim(), source, scopes }),
      });
      setToken(data.token);
      setGrants((current) => [{
        id: data.id, label: label.trim(), source, scopes: data.scopes.join(" "),
        expires_at: data.expiresAt, last_used_at: null,
      }, ...current]);
    } catch {
      setError("AI接続を作成できませんでした。入力内容を確認して再試行してください。");
    } finally { setPending(""); }
  }

  async function revokeGrant(id: string) {
    if (pending) return; setPending(`grant:${id}`); setError("");
    try {
      await fetchJson(`/api/agent/grants/${encodeURIComponent(id)}`, { method: "DELETE" });
      setGrants((current) => current.filter((grant) => grant.id !== id));
    } catch { setError("接続を解除できませんでした。再試行してください。"); }
    finally { setPending(""); }
  }

  async function decideDraft(id: string, decision: "approve" | "cancel") {
    if (pending) return; setPending(`draft:${id}`); setError("");
    try {
      await fetchJson(`/api/agent/drafts/${encodeURIComponent(id)}${decision === "approve" ? "/approve" : ""}`, {
        method: decision === "approve" ? "POST" : "DELETE",
      });
      setDrafts((current) => decision === "approve"
        ? current.map((draft) => draft.id === id ? { ...draft, status: "approved" } : draft)
        : current.filter((draft) => draft.id !== id));
    } catch { setError("下書きの状態を変更できませんでした。再試行してください。"); }
    finally { setPending(""); }
  }

  return (
    <div className="settings-card" id="agent-access">
      <div className="settings-note">
        <strong>AI接続</strong>
        <p>Codex、ChatGPT、Claude、Gemini、ローカルAIなどへHub専用の限定権限を委任します。購入・決済・ウォレット署名は委任できません。</p>
      </div>

      <label className="setting-select">
        <span><strong>接続するAI</strong><small>同じMCP接続口を利用します</small></span>
        <select value={source} onChange={(event) => chooseSource(event.target.value)}>
          {sources.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <label className="setting-select">
        <span><strong>接続名</strong><small>端末や用途を区別する名前</small></span>
        <input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <fieldset className="settings-note">
        <legend><strong>許可する操作</strong></legend>
        {scopeOptions.map(([value, text]) => (
          <label className="setting-row" key={value}>
            <span>{text}</span>
            <input type="checkbox" checked={scopes.includes(value)} onChange={() => toggleScope(value)} />
          </label>
        ))}
      </fieldset>
      <UiButton type="button" className="settings-reset" pending={pending === "create"}
        disabled={Boolean(pending) || phase !== "ready" || !label.trim() || scopes.length === 0}
        onClick={() => void createGrant()}>
        AI接続を作成
      </UiButton>

      {token ? (
        <div className="settings-note" role="status">
          <strong>接続トークン（今回だけ表示）</strong>
          <code>{token}</code>
          <p>MCP URL: <code>{location.origin}/mcp</code></p>
          <p>このトークンを接続先AIの安全な資格情報ストアへ保存してください。</p>
        </div>
      ) : null}
      {error ? <p className="settings-note" role="alert">{error}</p> : null}
      {phase === "loading" ? <UiStatePanel state="loading" title="AI接続を読み込み中" /> : null}
      {phase === "error" ? <UiStatePanel state="error" title="AI接続を読み込めませんでした"
        description={error} action={<UiButton type="button" onClick={() => void load()}>再読み込み</UiButton>} /> : null}

      {phase === "ready" ? <>
        <h3>承認待ちの下書き</h3>
        {drafts.length === 0 ? <p>承認待ちの下書きはありません。</p> : drafts.map((draft) => (
          <div className="settings-note" key={draft.id}>
            <strong>{draft.agent_label}からの{draft.destination_type === "reply" ? "返信" : "投稿"}</strong>
            <p>{draft.body}</p>
            <small>{new Date(draft.created_at).toLocaleString()}</small>
            <div className="setting-row">
              {draft.status === "draft" ? <UiButton type="button" disabled={Boolean(pending)}
                onClick={() => void decideDraft(draft.id, "approve")}>公開を承認</UiButton> : <span>承認済み・AIから公開待ち</span>}
              <UiButton type="button" disabled={Boolean(pending)}
                onClick={() => void decideDraft(draft.id, "cancel")}>取り消す</UiButton>
            </div>
          </div>
        ))}

        <h3>有効な接続</h3>
        {grants.length === 0 ? <p>有効なAI接続はありません。</p> : grants.map((grant) => (
          <div className="setting-row" key={grant.id}>
            <span><strong>{grant.label}</strong><small>{grant.scopes.replaceAll(" ", "・")} / 期限 {new Date(grant.expires_at).toLocaleDateString()}</small></span>
            <UiButton type="button" pending={pending === `grant:${grant.id}`} disabled={Boolean(pending)}
              onClick={() => void revokeGrant(grant.id)}>接続を解除</UiButton>
          </div>
        ))}
      </> : null}
    </div>
  );
}
