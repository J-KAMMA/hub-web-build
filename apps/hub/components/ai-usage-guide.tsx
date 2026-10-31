"use client";
import React from "react";
import { Building2, Code2, HelpCircle, Image, Laptop, MessageSquare, Search, Smartphone } from "lucide-react";
import styles from "./ai-usage-guide.module.css";

export type AiUsageAction = "chat" | "research" | "image" | "organization" | "pc-local" | "on-device" | "develop";
const choices: Array<{ id: AiUsageAction; title: string; description: string; meta: string; icon: typeof HelpCircle }> = [
  { id: "chat", title: "質問・相談", description: "文章作成、要約、比較、アイデア整理を最適なAIへ任せます。", meta: "クラウドAI · x402従量課金", icon: MessageSquare },
  { id: "research", title: "最新情報を調査", description: "検索能力が接続されたAIだけを使い、出典付き回答を依頼します。", meta: "検索対応AI · x402従量課金", icon: Search },
  { id: "image", title: "画像を作る", description: "用途、構図、雰囲気を入力して画像生成を開始します。", meta: "生成前に最大料金を表示", icon: Image },
  { id: "organization", title: "AI組織を作る", description: "複数の役割、担当AI、順序、予算上限を決めます。", meta: "役割ごとに予算管理", icon: Building2 },
  { id: "pc-local", title: "PCのAIを使う", description: "OllamaやLM StudioをLocal Runner経由で使います。", meta: "無料 · PC内処理", icon: Laptop },
  { id: "on-device", title: "スマホ内AIを使う", description: "対応Hubアプリ内でGemma 4を端末実行します。", meta: "無料 · オフライン対応", icon: Smartphone },
  { id: "develop", title: "開発を任せる", description: "契約しているClaudeとCodexが、選んだフォルダの中でコードを書き、動かします。", meta: "追加課金なし · PC内処理", icon: Code2 }
];

export function AiUsageGuide({ onClose, onChoose, paidExecution = false }: { onClose(): void; onChoose(action: AiUsageAction): void; paidExecution?: boolean }) {
  const visible = paidExecution ? choices : choices.filter((choice) => choice.id !== "image").map((choice) => choice.id === "chat" || choice.id === "research" ? { ...choice, meta: choice.id === "chat" ? "端末内AI · 接続PC · 無料" : "検索対応の接続PC · 無料" } : choice);
  return <section className={styles.overlay} aria-label="AIタブの使い方"><div className={styles.panel}><div className={styles.header}><div><h2>今日は何をしますか？</h2><p>目的を選ぶと、必要なAI・ツール・入力例を自動で準備します。</p></div><button type="button" onClick={onClose}>閉じる</button></div><div className={styles.grid}>{visible.map((choice) => { const Icon = choice.icon; return <button className={styles.card} type="button" key={choice.id} onClick={() => onChoose(choice.id)}><span className={styles.icon}><Icon aria-hidden="true" /></span><span><strong>{choice.title}</strong><small>{choice.description}</small><span className={styles.meta}>{choice.meta}</span></span></button>; })}</div><div className={styles.notes}>{paidExecution ? <><div className={styles.note}>自動選択は必要能力を先に確認し、その後に品質・速度・料金を比較します。</div><div className={styles.note}>クラウド実行は署名前に最大料金を表示し、上限を超える支払いを拒否します。</div></> : null}<div className={styles.note}>PC・スマホ内AIのプロンプトはHubサーバーやAI Workerへ送りません。</div></div></div></section>;
}
