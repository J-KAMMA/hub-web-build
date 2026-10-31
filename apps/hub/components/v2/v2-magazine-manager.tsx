"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { V2State } from "@/components/v2/v2-state";

type MagazineSummary = { id: string; title: string; description: string; articleCount: number };
type MagazineArticle = { id: string; title: string; status: string; authorName: string };
type MagazineDetail = { id: string; title: string; description: string; articles: MagazineArticle[] };

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

/** 貼られたURLまたはidから記事idを取り出す。 */
function articleIdFrom(value: string): string {
  const text = value.trim();
  const match = text.match(/\/articles\/([A-Za-z0-9_-]{1,80})(?:[/?#]|$)/);
  return match ? match[1] : text;
}

/*
 * マガジンの管理。誰の公開記事でも集められる。記事は読む画面の「マガジンに追加」からも足せる。
 * 並べ替えは上下ボタン。並び順の正本は常にサーバー。
 * 画面の下に、自分の記事を他人のマガジンへ入れてよいかの設定を置く。
 */
export function V2MagazineManager({ authenticated, japanese = true }: { authenticated: boolean; japanese?: boolean }) {
  const [magazines, setMagazines] = useState<MagazineSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MagazineDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowAdding, setAllowAdding] = useState<boolean | null>(null);
  const t = (ja: string, en: string) => (japanese ? ja : en);

  const refresh = useCallback(async () => {
    try {
      setMagazines((await call<{ magazines: MagazineSummary[] }>("/api/articles/magazines", "GET")).magazines);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refresh();
    call<{ allowAdding: boolean }>("/api/articles/magazines/settings", "GET").then((data) => setAllowAdding(data.allowAdding)).catch(() => undefined);
  }, [authenticated, refresh]);

  const open = useCallback(async (id: string | null) => {
    setOpenId(id);
    setDetail(null);
    if (!id) return;
    try {
      setDetail((await call<{ magazine: MagazineDetail }>(`/api/articles/magazines/${encodeURIComponent(id)}`, "GET")).magazine);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "");
    }
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("操作できませんでした。", "Something went wrong."));
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const created = await call<{ magazine: MagazineSummary }>("/api/articles/magazines", "POST", {
        title: data.get("title"),
        description: data.get("description"),
      });
      form.reset();
      await open(created.magazine.id);
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    void run(async () => {
      setDetail((await call<{ magazine: MagazineDetail }>(`/api/articles/magazines/${encodeURIComponent(detail.id)}`, "PATCH", {
        title: data.get("title"),
        description: data.get("description"),
      })).magazine);
    });
  }

  function move(index: number, delta: -1 | 1) {
    if (!detail) return;
    const order = detail.articles.map((article) => article.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void run(async () => {
      setDetail((await call<{ magazine: MagazineDetail }>(`/api/articles/magazines/${encodeURIComponent(detail.id)}/articles`, "PUT", { order })).magazine);
    });
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const articleId = articleIdFrom(String(new FormData(form).get("article") ?? ""));
    if (!articleId) return;
    void run(async () => {
      setDetail((await call<{ magazine: MagazineDetail }>(`/api/articles/magazines/${encodeURIComponent(detail.id)}/articles`, "POST", { articleId })).magazine);
      form.reset();
    });
  }

  function remove(articleId: string) {
    if (!detail) return;
    void run(async () => {
      setDetail((await call<{ magazine: MagazineDetail }>(`/api/articles/magazines/${encodeURIComponent(detail.id)}/articles?articleId=${encodeURIComponent(articleId)}`, "DELETE")).magazine);
    });
  }

  function destroy() {
    if (!detail || !window.confirm(t("このマガジンを消します。記事は消えません。", "Delete this magazine? The articles stay."))) return;
    void run(async () => {
      await call(`/api/articles/magazines/${encodeURIComponent(detail.id)}`, "DELETE");
      await open(null);
    });
  }

  function toggleAllow(next: boolean) {
    setAllowAdding(next);
    call<{ allowAdding: boolean }>("/api/articles/magazines/settings", "PUT", { allowAdding: next })
      .then((data) => setAllowAdding(data.allowAdding))
      .catch((cause) => {
        setAllowAdding(!next);
        setError(cause instanceof Error ? cause.message : t("設定を保存できませんでした。", "Could not save the setting."));
      });
  }

  if (!authenticated) {
    return <V2State kind="signedOut" next="/v2/articles/magazines" japanese={japanese} title={t("ログインしてマガジンを管理する", "Sign in to manage magazines")} />;
  }

  return (
    <div className="v2-magazine-manager">
      <form onSubmit={create} aria-label={t("マガジンを作る", "Create a magazine")}>
        <input name="title" required maxLength={100} placeholder={t("マガジンの題", "Magazine title")} aria-label={t("マガジンの題", "Magazine title")} />
        <textarea name="description" rows={2} maxLength={400} placeholder={t("説明（任意）", "Description (optional)")} aria-label={t("説明", "Description")} />
        <div className="v2-magazine-manager__row">
          <button className="v2-button v2-button--primary" type="submit" disabled={busy}>{t("マガジンを作る", "Create magazine")}</button>
        </div>
      </form>
      {error ? <p className="v2-magazine-manager__error" role="alert">{error}</p> : null}
      {status === "loading" ? <V2State kind="loading" compact rows={3} japanese={japanese} /> : null}
      {status === "failed" ? <V2State kind="error" compact japanese={japanese} title={t("マガジンを読み込めませんでした。", "Could not load magazines.")} action={{ label: t("もう一度読み込む", "Try again"), onClick: () => void refresh() }} /> : null}
      {status === "ready" && !magazines.length ? <V2State kind="empty" icon="bookmark" compact japanese={japanese} title={t("マガジンはまだありません。", "No magazines yet.")} note={t("気に入った公開記事を、書き手を問わず集められます。", "Collect published articles from any author.")} /> : null}
      {magazines.map((item) => (
        <section className="v2-magazine-manager__card" key={item.id} aria-label={item.title}>
          <div className="v2-magazine-manager__row">
            <strong>{item.title}</strong>
            <span className="v2-magazine-manager__note">{t(`${item.articleCount}本`, `${item.articleCount}`)}</span>
            <Link href={`/v2/articles/magazines/${encodeURIComponent(item.id)}`}>{t("公開ページ", "Public page")}</Link>
            <button className="v2-button v2-button--text" type="button" aria-expanded={openId === item.id} onClick={() => void open(openId === item.id ? null : item.id)}>
              {openId === item.id ? t("閉じる", "Close") : t("編集", "Edit")}
            </button>
          </div>
          {openId === item.id && detail?.id === item.id ? (
            <>
              <form onSubmit={save} key={`${detail.id}:${detail.title}:${detail.description}`}>
                <input name="title" required maxLength={100} defaultValue={detail.title} aria-label={t("マガジンの題", "Magazine title")} />
                <textarea name="description" rows={2} maxLength={400} defaultValue={detail.description} aria-label={t("説明", "Description")} />
                <div className="v2-magazine-manager__row">
                  <button className="v2-button v2-button--text" type="submit" disabled={busy}>{t("題と説明を保存", "Save")}</button>
                  <button className="v2-button v2-button--text" type="button" disabled={busy} onClick={destroy}>{t("マガジンを消す", "Delete magazine")}</button>
                </div>
              </form>
              <ol className="v2-magazine-manager__items">
                {detail.articles.map((article, index) => (
                  <li key={article.id}>
                    <span>{index + 1}. {article.title}（{article.authorName}）{article.status !== "published" ? t("（取り下げ中）", " (withdrawn)") : ""}</span>
                    <span className="v2-magazine-manager__row">
                      <button className="v2-button v2-button--text" type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t(`${article.title}を上へ`, `Move ${article.title} up`)}>{t("上へ", "Up")}</button>
                      <button className="v2-button v2-button--text" type="button" disabled={busy || index === detail.articles.length - 1} onClick={() => move(index, 1)} aria-label={t(`${article.title}を下へ`, `Move ${article.title} down`)}>{t("下へ", "Down")}</button>
                      <button className="v2-button v2-button--text" type="button" disabled={busy} onClick={() => remove(article.id)} aria-label={t(`${article.title}を外す`, `Remove ${article.title}`)}>{t("外す", "Remove")}</button>
                    </span>
                  </li>
                ))}
              </ol>
              <form onSubmit={add}>
                <div className="v2-magazine-manager__row">
                  <input name="article" required maxLength={300} placeholder={t("記事のURLかID", "Article URL or ID")} aria-label={t("追加する記事のURLかID", "Article URL or ID to add")} />
                  <button className="v2-button v2-button--text" type="submit" disabled={busy}>{t("末尾に追加", "Add to end")}</button>
                </div>
                <p className="v2-magazine-manager__note">{t("読む画面の「マガジンに追加」からも足せます。", "You can also add from the button on an article page.")}</p>
              </form>
            </>
          ) : null}
        </section>
      ))}
      <section className="v2-magazine-manager__card" aria-label={t("自分の記事の受け入れ", "Accepting your articles")}>
        <label className="v2-magazine-manager__setting">
          <input type="checkbox" checked={allowAdding ?? true} disabled={allowAdding === null} onChange={(event) => toggleAllow(event.target.checked)} />
          <span>{t("自分の記事を、他の人のマガジンに追加してもらう", "Let others add my articles to their magazines")}</span>
        </label>
        <p className="v2-magazine-manager__note">{t("切ると、新しい追加を受け付けません。すでに入っている記事は、各マガジンのページから自分で外せます。", "When off, no new additions are accepted. You can remove existing ones from each magazine page.")}</p>
      </section>
    </div>
  );
}
