"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type DraftItem = { id: string; title: string; updatedAt: string; status: "draft" | "scheduled"; publishAt: string | null; scheduleError: string | null };
type ArticleItem = { id: string; title: string; status: "published" | "withdrawn"; audience: "general" | "adult"; updatedAt: string; moderated: boolean };

function when(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ArticleDraftsList() {
  const [drafts, setDrafts] = useState<DraftItem[] | null>(null);
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/articles/drafts", { cache: "no-store" });
      if (response.status === 401) { setMessage("ログインすると下書きが見られます。"); setDrafts([]); return; }
      if (!response.ok) throw new Error("load");
      const body = await response.json() as { drafts: DraftItem[]; articles: ArticleItem[] };
      setDrafts(body.drafts);
      setArticles(body.articles);
    } catch {
      setMessage("読み込めませんでした。");
      setDrafts([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm("この下書きを削除します。元に戻せません。")) return;
    const response = await fetch(`/api/articles/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) setDrafts((list) => (list ?? []).filter((item) => item.id !== id));
    else setMessage("削除できませんでした。");
  };

  return <div className="hub-composer hub-drafts">
    <div className="hub-composer__actions hub-drafts__head">
      <Link href="/v2/articles/new" className="hub-composer__primary">新しく書く</Link>
      <Link href="/v2/articles" className="hub-composer__ghost">記事一覧へ</Link>
    </div>
    {message ? <p className="hub-composer__notice" role="status">{message}</p> : null}

    <section aria-labelledby="drafts-title">
      <h2 id="drafts-title" className="hub-composer__panel-title">下書き{drafts ? `（${drafts.length}）` : ""}</h2>
      {drafts === null ? <p className="hub-composer__requirement">読み込み中…</p> : drafts.length === 0 ? <p className="hub-composer__requirement">下書きはありません。</p> : (
        <ul className="hub-drafts__list">
          {drafts.map((item) => (
            <li key={item.id}>
              <Link href={`/v2/articles/new?draft=${encodeURIComponent(item.id)}`}>
                <b>{item.title.trim() || "（無題）"}</b>
                <small>
                  {item.status === "scheduled" && item.publishAt ? `${when(item.publishAt)} に公開予定` : `更新 ${when(item.updatedAt)}`}
                  {item.scheduleError ? ` ・ 予約が公開できませんでした` : ""}
                </small>
              </Link>
              <button type="button" className="hub-composer__ghost" onClick={() => void remove(item.id)}>削除</button>
            </li>
          ))}
        </ul>
      )}
    </section>

    <section aria-labelledby="mine-title">
      <h2 id="mine-title" className="hub-composer__panel-title">自分の記事{`（${articles.length}）`}</h2>
      {articles.length === 0 ? <p className="hub-composer__requirement">公開した記事はまだありません。</p> : (
        <ul className="hub-drafts__list">
          {articles.map((item) => (
            <li key={item.id}>
              <Link href={`/v2/articles/new?article=${encodeURIComponent(item.id)}`}>
                <b>{item.title}</b>
                <small>{item.moderated ? "運営が非表示" : item.status === "published" ? "公開中" : "取り下げ済み"} ・ 更新 {when(item.updatedAt)}</small>
              </Link>
              {item.status === "published" && !item.moderated ? <Link className="hub-composer__ghost" href={item.audience === "adult" ? `/v2/adult/articles/${item.id}` : `/v2/articles/${item.id}`}>開く</Link> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>;
}
