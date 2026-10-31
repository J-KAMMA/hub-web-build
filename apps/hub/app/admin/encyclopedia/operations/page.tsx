import styles from "@/components/encyclopedia/admin.module.css";
import { getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getAutomationControl,getHubpediaOperationsSnapshot } from "@/lib/server/hubpedia-quality-operations";

const number=(value:unknown)=>Number(value??0).toLocaleString("ja-JP");
export default async function EncyclopediaOperationsPage(){const db=getHubD1(),PUBLIC_READER_READY_SEED_ARTICLES=await getPublicReaderReadySeedArticles(),[control,snapshot]=await Promise.all([getAutomationControl(db),getHubpediaOperationsSnapshot(db,PUBLIC_READER_READY_SEED_ARTICLES.length)]),usage=snapshot.usage as Record<string,unknown>;
 return <><header className={styles.header}><div><p className={styles.eyebrow}>Quality operations</p><h1 className={styles.title}>Hubpedia 運用状況</h1><p className={styles.copy}>記事移行、根拠、鮮度、修復、MCP利用状況をまとめて確認します。</p></div></header>
 <section className={styles.card}><h2>自動運用</h2><p>{control.enabled?"稼働中":"停止中"} / 連続失敗 {number(control.consecutiveFailures)}件{control.reason?` / ${control.reason}`:""}</p></section>
 <section className={styles.card}><h2>記事とDB移行</h2><p>シード {number(snapshot.articles.seedTotal)}件 / DB {number(snapshot.articles.databaseTotal)}件 / 公開 {number(snapshot.articles.published)}件 / 移行率 {number(snapshot.articles.migrationPercent)}% / 品質遮断 {number(snapshot.articles.blocked)}件</p></section>
 <section className={styles.card}><h2>主張と根拠</h2><p>主張 {number(snapshot.evidence.claims)}件 / 根拠あり {number(snapshot.evidence.evidenced)}件 / 根拠充足率 {number(snapshot.evidence.coverage)}% / 有効出典 {number(snapshot.evidence.activeSources)}件</p></section>
 <section className={styles.card}><h2>鮮度と修復</h2><p>未解決の鮮度イベント {number(snapshot.freshness.openEvents)}件</p><ul>{snapshot.repairs.map((row)=><li key={String((row as Record<string,unknown>).status)}>{String((row as Record<string,unknown>).status)}: {number((row as Record<string,unknown>).count)}件</li>)}</ul></section>
 <section className={styles.card}><h2>MCP（直近30日）</h2><p>要求 {number(usage.requests)}件 / エラー {number(usage.errors)}件 / 平均 {number(usage.averageMilliseconds)}ms</p></section>
 <section className={styles.card}><h2>外部報告</h2><ul>{snapshot.reports.length?snapshot.reports.map((row)=><li key={String((row as Record<string,unknown>).status)}>{String((row as Record<string,unknown>).status)}: {number((row as Record<string,unknown>).reports)}件</li>):<li>報告はありません。</li>}</ul></section></>;
}
