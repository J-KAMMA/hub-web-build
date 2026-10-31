"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import { useState } from "react";
import styles from "./purchased-library.module.css";

const RUNNER = "http://127.0.0.1:43127";

export function PurchasedLibrary() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [state, setState] = useState<"idle" | "opening" | "offline" | "error">("idle");

  async function openGameLauncher() {
    setState("opening");
    let token = "";
    try {
      const paired = await fetch(`${RUNNER}/pair`, { method: "POST" });
      const body = await paired.json() as { sessionToken?: string };
      if (!paired.ok || !body.sessionToken) throw new Error("pair_failed");
      token = body.sessionToken;
      const opened = await fetch(`${RUNNER}/game-window/show`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!opened.ok) throw new Error("open_failed");
      setState("idle");
    } catch {
      setState("offline");
    } finally {
      if (token) {
        void fetch(`${RUNNER}/disconnect`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }).catch(() => setState("error"));
      }
    }
  }

  const isOpening = state === "opening";

  return <section className={styles.library} aria-labelledby="purchased-title">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>購入済みライブラリ</p>
        <h1 id="purchased-title" >購入済み</h1>
        <span className={styles.intro}>購入したコンテンツを、いつでもここから確認できます。</span>
      </div>
      <a className={styles.backLink} href={hubSurfacePath(surface, "/market")}>マーケットへ戻る</a>
    </header>
    <div className={styles.sectionHeading}>
      <h2>ゲーム</h2>
      <span>デスクトップ連携</span>
    </div>
    <article className={styles.gameCard} aria-labelledby="game-library-title">
      <div className={styles.gameIcon} aria-hidden="true">▣</div>
      <div className={styles.gameCopy}>
        <span className={styles.category}>ゲーム</span>
        <h3 id="game-library-title">ゲームライブラリ</h3>
        <p>購入済みゲームを、このPCのHubランチャーから起動します。</p>
      </div>
      <button
        className={styles.launchButton}
        type="button"
        onClick={() => void openGameLauncher()}
        disabled={isOpening}
        aria-describedby="launcher-help"
      >
        {isOpening ? "接続中…" : "ランチャーを開く"}
      </button>
    </article>
    <p id="launcher-help" className={styles.helper}>デスクトップ版Hubが起動しているときに利用できます。</p>
    {state === "offline" ? <p className={`${styles.notice} ${styles.noticeOffline}`} role="status" aria-live="polite">Hubデスクトップを起動して、もう一度お試しください。</p> : null}
    {state === "error" ? <p className={`${styles.notice} ${styles.noticeError}`} role="status" aria-live="polite">接続を終了できませんでした。デスクトップ側で状態を確認してください。</p> : null}
    <p className={styles.boundary}>購入情報はCommerceが管理します。Hubは購入済みの入口とランチャーへの接続だけを受け持ちます。</p>
  </section>;
}
