"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

import { sha256OfFile } from "@/lib/client-sha256";

/*
 * ゲームのビルド（2026-10-18）。ストアの設定の中。管理者だけが、遊ぶ人に配る実行ファイルを載せる。
 * 流れ：ブラウザで SHA-256 を求める → /api/content-files の札でファイル部品へ直接送る → /api/games/{id}/builds で登録。
 * 登録するとハブがファイル部品に公開を頼み、部品の検査と SHA-256 が合えばその場で公開になる。
 * 公開を止めるときは取り下げる（同じファイルを再公開するにはもう一度送る）。本体はハブを通らない。
 */

const PLATFORM_LABELS = { windows: "Windows", macos: "macOS", linux: "Linux" } as const;
type Platform = keyof typeof PLATFORM_LABELS;
type Build = { id: string; version: string; platform: Platform; kind: "full" | "demo"; channel: "stable" | "beta"; sha256: string; sizeBytes: number; notes: string | null; createdAt: string };
type Attempt = { key: number; label: string; state: "hashing" | "uploading" | "scanning" | "rejected"; detail?: string };

const ERRORS: Record<string, string> = {
  forbidden: "連携コミュニティの管理者だけがビルドを載せられます。",
  invalid_version: "バージョンは英数字・日本語・空白と . _ + - ( ) で64文字までです。",
  invalid_platform: "機種を選んでください。",
  invalid_sha256: "ファイルの指紋を確認できませんでした。もう一度選んでください。",
  invalid_file: "ファイルを受け付けられませんでした。もう一度送ってください。",
  identity_required: "実行ファイルの配布には販売者確認が必要です。上の「確認を取り込む」から済ませてください。",
  build_not_publishable: "検査で公開できないと判断されました。ファイルを確かめてください。",
  sha256_mismatch: "送ったファイルと指紋が合いません。もう一度送ってください。",
  size_mismatch: "送ったファイルの大きさが合いません。もう一度送ってください。",
  files_unavailable: "ファイルの受け付けが今は使えません。少し待ってからやり直してください。",
  storage_unavailable: "保存の容量を確保できませんでした。",
  file_too_large: "ファイルが大きすぎます（1GBまで）。",
  login_required: "ログインしてください。",
};

function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${value} B`;
}

const STATE_LABEL: Record<Attempt["state"], string> = {
  hashing: "指紋を計算中",
  uploading: "送信中",
  scanning: "検査中",
  rejected: "公開できません",
};

async function errorCode(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export function GameBuildsPanel({ gameId }: { gameId: string }) {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base = `/api/games/${encodeURIComponent(gameId)}/builds`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(base, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { builds?: Build[] } | null;
      setBuilds(response.ok && Array.isArray(body?.builds) ? body.builds : []);
    } catch {
      setBuilds([]);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const track = (key: number, patch: Partial<Attempt>) =>
    setAttempts((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    const key = Date.now();
    const chosen = file;
    setBusy(true);
    setMessage("");
    setAttempts((current) => [{ key, label: `${chosen.name}（${PLATFORM_LABELS[platform]} ${version.trim()}）`, state: "hashing" }, ...current]);
    const fail = (code: string) => track(key, { state: "rejected", detail: ERRORS[code] ?? "登録できませんでした。" });
    try {
      const sha256 = await sha256OfFile(chosen);
      track(key, { state: "uploading" });
      const ticketResponse = await fetch("/api/content-files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: chosen.name, sizeBytes: chosen.size }),
      });
      if (!ticketResponse.ok) return fail(await errorCode(ticketResponse, "invalid_file"));
      const { upload } = await ticketResponse.json() as { upload: { fileId: string; ticket: string; header: string; path: string } };
      if (!upload.path.startsWith("/vault/api/files/")) return fail("invalid_file");
      const form = new FormData();
      form.append("file", chosen);
      const stored = await fetch(upload.path, { method: "POST", headers: { [upload.header]: upload.ticket }, body: form });
      if (stored.status !== 201) return fail("invalid_file");
      track(key, { state: "scanning" });
      const registered = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileId: upload.fileId, version: version.trim(), platform, sha256 }),
      });
      if (!registered.ok) return fail(await errorCode(registered, "invalid_file"));
      setAttempts((current) => current.filter((item) => item.key !== key));
      setMessage("ビルドを公開しました。");
      setFile(null);
      setVersion("");
      await load();
    } catch {
      fail("files_unavailable");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(build: Build) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}/${encodeURIComponent(build.id)}`, { method: "DELETE" });
      if (!response.ok) setMessage(ERRORS[await errorCode(response, "")] ?? "取り下げられませんでした。");
      else setMessage("取り下げました。新しいダウンロードは出ません。");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="game-builds-panel" aria-label="ビルド">
      <h3>ビルド（{builds.length}）</h3>
      <p className="game-builds-panel__note">送ったファイルは検査を通ると公開されます。公開を止めるときは取り下げます。ファイルの本体はハブを通りません。</p>
      {builds.length ? (
        <ul className="game-builds-panel__list">
          {builds.map((build) => (
            <li key={build.id}>
              <span>{PLATFORM_LABELS[build.platform] ?? build.platform} {build.version}</span>
              <small>公開中 ・ {formatBytes(build.sizeBytes)} ・ SHA-256 {build.sha256.slice(0, 12)}…</small>
              <button type="button" onClick={() => void withdraw(build)} disabled={busy}>取り下げる</button>
            </li>
          ))}
        </ul>
      ) : <p className="game-builds-panel__note">公開中のビルドはありません。</p>}
      {attempts.length ? (
        <ul className="game-builds-panel__list" aria-live="polite">
          {attempts.map((item) => (
            <li key={item.key} data-state={item.state}>
              <span>{item.label}</span>
              <small>{STATE_LABEL[item.state]}{item.detail ? ` ・ ${item.detail}` : ""}</small>
              {item.state === "rejected" ? <button type="button" onClick={() => setAttempts((current) => current.filter((entry) => entry.key !== item.key))}>消す</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="game-builds-panel__form">
        <label><span>機種</span>
          <select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
            {(Object.keys(PLATFORM_LABELS) as Platform[]).map((name) => <option key={name} value={name}>{PLATFORM_LABELS[name]}</option>)}
          </select>
        </label>
        <label><span>バージョン</span>
          <input value={version} maxLength={64} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" />
        </label>
        <label><span>ビルドのファイル（1GBまで）</span>
          <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={busy || !file || !version.trim()}>ビルドを送って公開</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
