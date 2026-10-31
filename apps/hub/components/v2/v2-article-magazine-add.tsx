"use client";

import Link from "next/link";
import { useState } from "react";

import "../../app/v2/v2-article-magazines.css";

type Magazine = { id: string; title: string; containsArticle?: boolean };

async function call<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "操作できませんでした。");
  return data;
}

/*
 * 読む画面の「マガジンに追加」。ログイン中の人が、自分のマガジンのひとつへこの記事を足す。
 * 開くまでは何も読み込まない（記事の表示を重くしない）。
 */
export function V2ArticleMagazineAdd({ articleId, authenticated, japanese = true }: { articleId: string; authenticated: boolean; japanese?: boolean }) {
  const t = (ja: string, en: string) => (japanese ? ja : en);
  const [open, setOpen] = useState(false);
  const [magazines, setMagazines] = useState<Magazine[] | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  if (!authenticated) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    setDone("");
    setError("");
    if (!next || magazines) return;
    try {
      setMagazines((await call<{ magazines: Magazine[] }>(`/api/articles/magazines?articleId=${encodeURIComponent(articleId)}`, "GET")).magazines);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("読み込めませんでした。", "Could not load."));
    }
  }

  async function add() {
    if (!pick) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      await call(`/api/articles/magazines/${encodeURIComponent(pick)}/articles`, "POST", { articleId });
      const target = magazines?.find((item) => item.id === pick);
      setMagazines((current) => current?.map((item) => (item.id === pick ? { ...item, containsArticle: true } : item)) ?? current);
      setDone(t(`「${target?.title ?? ""}」に追加しました。`, `Added to "${target?.title ?? ""}".`));
      setPick("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("追加できませんでした。", "Could not add."));
    } finally {
      setBusy(false);
    }
  }

  const candidates = (magazines ?? []).filter((item) => !item.containsArticle);
  return (
    <section className="v2-magazine-add" aria-label={t("マガジンに追加", "Add to magazine")}>
      <div className="v2-magazine-add__row">
        <button className="v2-button v2-button--text" type="button" aria-expanded={open} onClick={() => void toggle()}>
          {t("マガジンに追加", "Add to magazine")}
        </button>
      </div>
      {open ? (
        <>
          {magazines === null && !error ? <p className="v2-magazine-add__note" role="status">{t("読み込み中…", "Loading…")}</p> : null}
          {magazines && !magazines.length ? (
            <p className="v2-magazine-add__note">
              {t("マガジンがまだありません。", "You have no magazines yet.")} <Link href="/v2/articles/magazines">{t("マガジンを作る", "Create one")}</Link>
            </p>
          ) : null}
          {magazines && magazines.length && !candidates.length ? (
            <p className="v2-magazine-add__note">{t("どのマガジンにも追加済みです。", "Already in all of your magazines.")}</p>
          ) : null}
          {candidates.length ? (
            <div className="v2-magazine-add__row">
              <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label={t("追加するマガジン", "Magazine")}>
                <option value="">{t("マガジンを選ぶ", "Choose a magazine")}</option>
                {candidates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
              <button className="v2-button v2-button--text" type="button" disabled={busy || !pick} onClick={() => void add()}>{t("追加", "Add")}</button>
            </div>
          ) : null}
          {done ? <p className="v2-magazine-add__note" role="status">{done}</p> : null}
          {error ? <p className="v2-magazine-add__error" role="alert">{error}</p> : null}
        </>
      ) : null}
    </section>
  );
}
