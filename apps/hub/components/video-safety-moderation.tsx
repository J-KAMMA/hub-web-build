"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { VideoSafetyQueue as Queue } from "@/lib/server/hub-video-review";
import styles from "./copyright-moderation.module.css";

async function post(path: string, body: unknown): Promise<string> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (response.ok) return "";
  const payload = await response.json().catch(() => ({})) as { message?: string };
  return payload.message ?? "操作できませんでした。";
}

const REPORT_PATH = "/api/admin/moderation/video-safety/report";
const REVIEW_PATH = "/api/admin/moderation/video-safety/review";

export function VideoSafetyQueue() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/moderation/video-safety/queue", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "運営としてログインしていません。" : "一覧を取得できませんでした。");
      setQueue(await response.json() as Queue);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "一覧を取得できませんでした。");
      setQueue({ reviews: [], reports: [] });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (path: string, body: unknown) => {
    setBusy(true);
    const message = await post(path, body);
    setBusy(false);
    setError(message);
    await load();
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>運営</span>
          <h1>動画の審査と通報</h1>
          <p>最初の動画は、承認するまで本人以外には配りません。性的な自作動画は禁止です。</p>
        </div>
        <Link className={styles.link} href="/admin/moderation">運営の画面へ</Link>
      </header>
      {error ? <div className={`${styles.banner} ${styles.bannerDanger}`} role="alert">{error}</div> : null}

      <section className={styles.card} aria-labelledby="vs-reports">
        <h2 id="vs-reports">通報</h2>
        {queue === null ? <p className={styles.muted}>読み込み中…</p> : queue.reports.length === 0 ? <p className={styles.empty}>未対応の通報はありません。</p> : (
          <ul className={styles.list}>
            {queue.reports.map((item) => (
              <li key={item.reportId} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>
                    <span className={`${styles.chip} ${item.reasonCode === "child_sexual" ? styles.chipDanger : item.reasonCode === "sexual_content" ? styles.chipWarning : ""}`}>{item.reasonLabel}</span>{" "}
                    {item.title}
                  </p>
                  <p className={styles.rowMeta}>@{item.creatorHandle} / {item.createdAt.slice(0, 16).replace("T", " ")}{item.safetyHold ? " / 配信停止中" : ""}{item.ageRestricted ? " / 年齢制限あり" : ""}</p>
                </div>
                <div className={styles.formButtons}>
                  <button type="button" className={`${styles.actionButton} ${styles.actionDanger}`} disabled={busy} onClick={() => void act(REPORT_PATH, { reportId: item.reportId, resolution: "remove" })}>取り下げる</button>
                  <button type="button" className={styles.actionButton} disabled={busy || item.ageRestricted} onClick={() => void act(REPORT_PATH, { reportId: item.reportId, resolution: "age_restrict" })}>年齢制限にする</button>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void act(REPORT_PATH, { reportId: item.reportId, resolution: "dismiss" })}>問題なし</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card} aria-labelledby="vs-reviews">
        <h2 id="vs-reviews">最初の動画の審査待ち</h2>
        {queue === null ? <p className={styles.muted}>読み込み中…</p> : queue.reviews.length === 0 ? <p className={styles.empty}>審査待ちの動画はありません。</p> : (
          <ul className={styles.list}>
            {queue.reviews.map((item) => (
              <li key={item.videoId} className={styles.row}>
                <div>
                  <p className={styles.rowTitle}>{item.title}</p>
                  <p className={styles.rowMeta}>@{item.creatorHandle}（{item.creatorDisplayName}） / {item.requestedAt?.slice(0, 16).replace("T", " ") ?? ""}{item.ageRestricted ? " / 年齢制限" : ""}{item.openReports > 0 ? ` / 通報${item.openReports}件` : ""}</p>
                </div>
                <div className={styles.formButtons}>
                  <button type="button" className={`${styles.actionButton} ${styles.actionPrimary}`} disabled={busy} onClick={() => void act(REVIEW_PATH, { videoId: item.videoId, decision: "approve" })}>承認して公開</button>
                  <button type="button" className={`${styles.actionButton} ${styles.actionDanger}`} disabled={busy} onClick={() => void act(REVIEW_PATH, { videoId: item.videoId, decision: "reject" })}>公開しない</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
