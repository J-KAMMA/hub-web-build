"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { V2State } from "@/components/v2/v2-state";

type SeriesSummary = { id: string; title: string; description: string; articleCount: number };
type SeriesArticle = { id: string; title: string; status: string };
type SeriesDetail = { id: string; title: string; description: string; articles: SeriesArticle[] };
type Addable = { id: string; title: string };

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
 * 著者のシリーズ管理。自分の公開記事だけを束ねる。並べ替えは上下ボタン。
 * 開いたシリーズは API から読み直し、並び順の正本は常にサーバー。
 */
export function V2SeriesManager({ authenticated, japanese = true }: { authenticated: boolean; japanese?: boolean }) {
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [addable, setAddable] = useState<Addable[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const t = (ja: string, en: string) => (japanese ? ja : en);

  const refresh = useCallback(async () => {
    try {
      const data = await call<{ series: SeriesSummary[]; addable: Addable[] }>("/api/articles/series", "GET");
      setSeries(data.series);
      setAddable(data.addable);
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  }, []);

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);

  const open = useCallback(async (id: string | null) => {
    setOpenId(id);
    setDetail(null);
    setPick("");
    if (!id) return;
    try {
      setDetail((await call<{ series: SeriesDetail }>(`/api/articles/series/${encodeURIComponent(id)}`, "GET")).series);
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
      const created = await call<{ series: SeriesSummary }>("/api/articles/series", "POST", {
        title: data.get("title"),
        description: data.get("description"),
      });
      form.reset();
      await open(created.series.id);
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    void run(async () => {
      const result = await call<{ series: SeriesDetail }>(`/api/articles/series/${encodeURIComponent(detail.id)}`, "PATCH", {
        title: data.get("title"),
        description: data.get("description"),
      });
      setDetail(result.series);
    });
  }

  function move(index: number, delta: -1 | 1) {
    if (!detail) return;
    const order = detail.articles.map((article) => article.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    void run(async () => {
      setDetail((await call<{ series: SeriesDetail }>(`/api/articles/series/${encodeURIComponent(detail.id)}/articles`, "PUT", { order })).series);
    });
  }

  function add() {
    if (!detail || !pick) return;
    void run(async () => {
      setDetail((await call<{ series: SeriesDetail }>(`/api/articles/series/${encodeURIComponent(detail.id)}/articles`, "POST", { articleId: pick })).series);
      setPick("");
    });
  }

  function remove(articleId: string) {
    if (!detail) return;
    void run(async () => {
      setDetail((await call<{ series: SeriesDetail }>(`/api/articles/series/${encodeURIComponent(detail.id)}/articles?articleId=${encodeURIComponent(articleId)}`, "DELETE")).series);
    });
  }

  function destroy() {
    if (!detail || !window.confirm(t("このシリーズを消します。記事は消えません。", "Delete this series? The articles stay."))) return;
    void run(async () => {
      await call(`/api/articles/series/${encodeURIComponent(detail.id)}`, "DELETE");
      await open(null);
    });
  }

  if (!authenticated) {
    return <V2State kind="signedOut" next="/v2/articles/series" japanese={japanese} title={t("ログインしてシリーズを管理する", "Sign in to manage series")} />;
  }

  return (
    <div className="v2-series-manager">
      <form onSubmit={create} aria-label={t("シリーズを作る", "Create a series")}>
        <input name="title" required maxLength={100} placeholder={t("シリーズの題", "Series title")} aria-label={t("シリーズの題", "Series title")} />
        <textarea name="description" rows={2} maxLength={400} placeholder={t("説明（任意）", "Description (optional)")} aria-label={t("説明", "Description")} />
        <div className="v2-series-manager__row">
          <button className="v2-button v2-button--primary" type="submit" disabled={busy}>{t("シリーズを作る", "Create series")}</button>
        </div>
      </form>
      {error ? <p className="v2-series-manager__error" role="alert">{error}</p> : null}
      {status === "loading" ? <V2State kind="loading" compact rows={3} japanese={japanese} /> : null}
      {status === "failed" ? <V2State kind="error" compact japanese={japanese} title={t("シリーズを読み込めませんでした。", "Could not load series.")} action={{ label: t("もう一度読み込む", "Try again"), onClick: () => void refresh() }} /> : null}
      {status === "ready" && !series.length ? <V2State kind="empty" icon="book" compact japanese={japanese} title={t("シリーズはまだありません。", "No series yet.")} note={t("自分の公開記事を順番に束ねられます。", "Group your own published articles in order.")} /> : null}
      {series.map((item) => (
        <section className="v2-series-manager__card" key={item.id} aria-label={item.title}>
          <div className="v2-series-manager__row">
            <strong>{item.title}</strong>
            <span className="v2-series-manager__note">{t(`${item.articleCount}本`, `${item.articleCount}`)}</span>
            <Link href={`/v2/articles/series/${encodeURIComponent(item.id)}`}>{t("公開ページ", "Public page")}</Link>
            <button className="v2-button v2-button--text" type="button" aria-expanded={openId === item.id} onClick={() => void open(openId === item.id ? null : item.id)}>
              {openId === item.id ? t("閉じる", "Close") : t("編集", "Edit")}
            </button>
          </div>
          {openId === item.id && detail?.id === item.id ? (
            <>
              <form onSubmit={save} key={`${detail.id}:${detail.title}:${detail.description}`}>
                <input name="title" required maxLength={100} defaultValue={detail.title} aria-label={t("シリーズの題", "Series title")} />
                <textarea name="description" rows={2} maxLength={400} defaultValue={detail.description} aria-label={t("説明", "Description")} />
                <div className="v2-series-manager__row">
                  <button className="v2-button v2-button--text" type="submit" disabled={busy}>{t("題と説明を保存", "Save")}</button>
                  <button className="v2-button v2-button--text" type="button" disabled={busy} onClick={destroy}>{t("シリーズを消す", "Delete series")}</button>
                </div>
              </form>
              <ol className="v2-series-manager__items">
                {detail.articles.map((article, index) => (
                  <li key={article.id}>
                    <span>{index + 1}. {article.title}{article.status !== "published" ? t("（取り下げ中）", " (withdrawn)") : ""}</span>
                    <span className="v2-series-manager__row">
                      <button className="v2-button v2-button--text" type="button" disabled={busy || index === 0} onClick={() => move(index, -1)} aria-label={t(`${article.title}を上へ`, `Move ${article.title} up`)}>{t("上へ", "Up")}</button>
                      <button className="v2-button v2-button--text" type="button" disabled={busy || index === detail.articles.length - 1} onClick={() => move(index, 1)} aria-label={t(`${article.title}を下へ`, `Move ${article.title} down`)}>{t("下へ", "Down")}</button>
                      <button className="v2-button v2-button--text" type="button" disabled={busy} onClick={() => remove(article.id)} aria-label={t(`${article.title}を外す`, `Remove ${article.title}`)}>{t("外す", "Remove")}</button>
                    </span>
                  </li>
                ))}
              </ol>
              {addable.length ? (
                <div className="v2-series-manager__row">
                  <select value={pick} onChange={(event) => setPick(event.target.value)} aria-label={t("追加する記事", "Article to add")}>
                    <option value="">{t("追加する記事を選ぶ", "Choose an article")}</option>
                    {addable.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
                  </select>
                  <button className="v2-button v2-button--text" type="button" disabled={busy || !pick} onClick={add}>{t("末尾に追加", "Add to end")}</button>
                </div>
              ) : <p className="v2-series-manager__note">{t("追加できる公開記事はありません（ほかのシリーズに入っている記事は先に外してください）。", "No published articles available to add.")}</p>}
            </>
          ) : null}
        </section>
      ))}
    </div>
  );
}
