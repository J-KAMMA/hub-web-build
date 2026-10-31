"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import styles from "./admin.module.css";
import { entityFrom, fmt, type Source, type Topic } from "./types";

export function TopicDetail({ id }: { id: string }) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => fetch(`/api/admin/encyclopedia/topics/${id}`)
    .then(async (response) => {
      if (!response.ok) throw new Error("項目を取得できませんでした");
      return response.json();
    })
    .then((data) => setTopic(entityFrom<Topic>(data, "topic")))
    .catch((cause) => setError(cause instanceof Error ? cause.message : "取得に失敗しました")), [id]);

  useEffect(() => { void load(); }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setAdding(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/encyclopedia/topics/${id}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data as { error?: string })?.error || "情報源を追加できませんでした");
      setUrl("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "追加に失敗しました");
    } finally {
      setAdding(false);
    }
  }

  if (!topic && !error) return <div className={styles.card}>読み込み中…</div>;
  if (!topic) return <div className={styles.error}>{error}</div>;
  const sources = topic.sources ?? [];
  const latestRevision = topic.article?.revisions?.[0];

  return <>
    {error && <div className={styles.error}>{error}</div>}
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>{topic.topicType} · {topic.status}</p><h1 className={styles.title}>{topic.canonicalName}</h1><p className={styles.copy}>{topic.description || "説明はまだありません。"}</p></div>
    </header>
    <section className={styles.card}><div className={styles.meta}><span>slug: {topic.slug}</span><span>再調査: {topic.freshnessIntervalHours ?? "—"}時間</span><span>最終調査: {fmt(topic.lastResearchedAt)}</span><span>最終検証: {fmt(topic.lastVerifiedAt)}</span></div></section>
    {latestRevision && <section className={styles.section}>
      <div className={styles.sectionHead}><h2>レビュー対象の記事</h2><span className={styles.badge}>{topic.article?.status} · revision {latestRevision.revisionNumber}</span></div>
      <article className={styles.card}><h3>{latestRevision.title}</h3><p className={styles.copy}>{latestRevision.summary}</p><div className={styles.pre}>{latestRevision.bodyMarkdown}</div><div className={styles.meta}><span>作成: {latestRevision.createdBy || "不明"}</span><span>{fmt(latestRevision.createdAt)}</span></div></article>
      {latestRevision.translations?.map((translation) => <article className={styles.card} key={translation.id}><div className={styles.meta}><span className={styles.badge}>{translation.locale} · {translation.status}</span><span>{fmt(translation.updatedAt)}</span></div><h3>{translation.title}</h3><p className={styles.copy}>{translation.summary}</p><div className={styles.pre}>{translation.bodyMarkdown}</div></article>)}
    </section>}
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>情報源</h2><span className={styles.badge}>{sources.length}件</span></div>
      <form className={`${styles.card} ${styles.actions}`} onSubmit={add}><input className={styles.input} type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/source" aria-label="情報源URL" required /><button className={`${styles.button} ${styles.buttonPrimary}`} disabled={adding}>{adding ? "追加中…" : "URLを追加"}</button></form>
      <div className={styles.grid}>{sources.map((source: Source) => <Link className={`${styles.card} ${styles.cardLink}`} href={`/admin/encyclopedia/sources/${source.id}`} key={source.id}><div className={styles.meta}><span className={styles.badge}>{source.sourceType || "web"}</span><span>{source.publisher || "発行者不明"}</span><span>{source.reliabilityTier || "信頼性未設定"}</span></div><h3>{source.title || source.url}</h3><p className={styles.copy}>{source.url}</p></Link>)}{!sources.length && <div className={`${styles.card} ${styles.empty}`}>情報源を追加してください。</div>}</div>
    </section>
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>パイプライン履歴</h2></div>
      <div className={styles.card}>{topic.pipelineRuns?.length ? <table className={styles.table}><thead><tr><th>処理</th><th>状態</th><th>開始</th><th>完了</th><th>エラー</th></tr></thead><tbody>{topic.pipelineRuns.map((run) => <tr key={run.id}><td>{run.runType}</td><td><span className={styles.badge}>{run.status}</span></td><td>{fmt(run.startedAt)}</td><td>{fmt(run.completedAt)}</td><td>{run.error ? JSON.stringify(run.error) : "—"}</td></tr>)}</tbody></table> : <div className={styles.empty}>実行履歴はありません。</div>}</div>
    </section>
  </>;
}
