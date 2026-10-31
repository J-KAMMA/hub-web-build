"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";

type Phase = "idle" | "working" | "done" | "error";

/** URL の # 以降のトークンを読み、パスキー登録と最初の運営者の確定を行う。トークンは保存もログもしない。 */
export function SetupAdminForm() {
  const [token, setToken] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const value = window.location.hash.replace(/^#/, "");
    setToken(value);
    if (value) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/setup/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, token }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string; options?: unknown };
    if (!response.ok) throw new Error(response.status === 404 ? "この手順は利用できません。" : data.error ?? "処理できませんでした。");
    return data;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPhase("working");
    setMessage("");
    try {
      const begin = await post({ step: "options", handle, displayName });
      const credential = await startRegistration({
        optionsJSON: begin.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
      });
      await post({ step: "verify", response: credential });
      setPhase("done");
      setMessage("最初の運営者として登録しました。この手順はもう使えません。");
      setToken("");
    } catch (error) {
      setPhase("error");
      setMessage(error instanceof Error ? error.message : "処理できませんでした。");
    }
  }

  const field = {
    display: "block",
    width: "100%",
    marginTop: 4,
    padding: "8px 10px",
    border: "var(--divider)",
    borderRadius: 8,
    background: "var(--surface-raised)",
    color: "var(--text)",
  } as const;

  return (
    <div style={{ maxWidth: 480, margin: "64px auto", padding: "0 16px", color: "var(--text)" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>最初の運営者を登録</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>
        このハブの最初の運営者になるパスキーを登録します。登録が済むと、この画面は使えなくなります。
      </p>
      {!token && phase !== "done" ? (
        <p role="alert" style={{ color: "var(--danger-text)" }}>
          セットアップ用のURL（# 以降のトークンを含む）から開いてください。
        </p>
      ) : (
        <form onSubmit={submit}>
          <label style={{ display: "block", marginBottom: 16 }}>
            ユーザーID
            <input style={field} value={handle} onChange={(e) => setHandle(e.target.value)} required autoComplete="username" />
          </label>
          <label style={{ display: "block", marginBottom: 16 }}>
            表示名
            <input style={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
          <button
            type="submit"
            disabled={phase === "working" || phase === "done"}
            style={{ padding: "10px 16px", borderRadius: 8, border: "none", background: "var(--emphasis)", color: "var(--bg)" }}
          >
            パスキーを登録する
          </button>
        </form>
      )}
      {message ? (
        <p role={phase === "error" ? "alert" : "status"} style={{ marginTop: 16, color: phase === "error" ? "var(--danger-text)" : "var(--text)" }}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
