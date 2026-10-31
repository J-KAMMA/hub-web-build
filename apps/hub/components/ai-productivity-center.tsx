"use client";

import React, { useMemo, useRef, useState } from "react";
import { Bot, Brain, CalendarClock, Download, FileUp, FolderKanban, Link2, ListChecks, Pin, Plus, ShieldCheck, Trash2, Upload, WalletCards, X } from "lucide-react";
import styles from "./ai-productivity-center.module.css";
import { AiWorkSystemPanel } from "./ai-work-system-panel";
import { AiConnectorSettings } from "./ai-connector-settings";
import { AiAgentNetworkPanel } from "./ai-agent-network-panel";

export type AiWorkSettings = {
  deliverable: string;
  workflow: string;
  evidence: boolean;
  budgetUsd: number;
  attachmentContext: string;
};

type Props = {
  initialTab?: "work" | "jobs";
  project: string;
  projects: string[];
  pinnedChats: Array<{ id: string; title: string; project: string; pinned?: boolean }>;
  runtimeReadiness?: { ready: boolean; missing: string[]; providers: { enabled: number; total: number } };
  settings: AiWorkSettings;
  onChange: (settings: AiWorkSettings) => void;
  onUsePrompt: (prompt: string) => void;
  onSelectProject: (project: string) => void;
  onCreateProject: () => void;
  onTogglePin: (id: string) => void;
  memories: Array<{ id: string; content: string }>;
  onAddMemory: () => void;
  onDeleteMemory: (id: string) => void;
  onClearMemories: () => void;
  onExportMemory: () => void;
  onImportMemory: (file: File | undefined) => void;
  onClose: () => void;
  /** Paid (x402) execution is off by default; see lib/ai-paid-execution.ts. */
  paidExecution?: boolean;
};

const DELIVERABLES = ["回答", "調査レポート", "企画書", "コード", "表", "スライド構成", "画像", "動画"];
const WORKFLOWS = [
  { id: "direct", name: "そのまま回答", steps: "最適なAI → 回答" },
  { id: "research", name: "深い調査", steps: "検索 → 複数AIで分析 → 矛盾確認 → 出典付きレポート" },
  { id: "create", name: "成果物を作る", steps: "要件整理 → 下書き → 批評 → 完成版" },
  { id: "team", name: "AIチーム", steps: "調査役 → 作成役 → 検証役 → 統合" }
];
export function AiProductivityCenter({ initialTab = "work", project, projects, pinnedChats, runtimeReadiness, settings, onChange, onUsePrompt, onSelectProject, onCreateProject, onTogglePin, memories, onAddMemory, onDeleteMemory, onClearMemories, onExportMemory, onImportMemory, onClose, paidExecution = false }: Props) {
  const deliverables = paidExecution ? DELIVERABLES : DELIVERABLES.filter((item) => item !== "画像" && item !== "動画");
  const [tab, setTab] = useState<"work" | "jobs" | "agents" | "projects" | "pins" | "files" | "memory" | "cost" | "connections" | "schedule">(initialTab);
  const [schedule, setSchedule] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const estimate = useMemo(() => settings.workflow === "research" ? 0.72 : settings.workflow === "team" ? 0.80 : settings.workflow === "create" ? 0.48 : 0.24, [settings.workflow]);

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    const accepted: string[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > 2_000_000 || (!file.type.startsWith("text/") && !/\.(md|txt|csv|json|ts|tsx|js|jsx|py|css|html)$/i.test(file.name))) continue;
      accepted.push(`\n[添付: ${file.name}]\n${(await file.text()).slice(0, 12_000)}`);
    }
    onChange({ ...settings, attachmentContext: accepted.join("\n").slice(0, 24_000) });
  }

  function apply() {
    const workflow = WORKFLOWS.find((item) => item.id === settings.workflow)?.steps ?? WORKFLOWS[0].steps;
    const evidence = settings.evidence ? "事実には出典URLと確認日を付け、推測と確認済み情報を分けてください。" : "";
    onUsePrompt(`成果物: ${settings.deliverable}\n進め方: ${workflow}\n${evidence}${paidExecution ? `\n予算上限: $${settings.budgetUsd.toFixed(2)} USDC` : ""}\n依頼内容:\n${settings.attachmentContext}`.trim());
  }

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={styles.panel} role="dialog" aria-modal="true" aria-label="AI仕事設定">
      <header><div><strong>仕事を設定</strong><small>{project}プロジェクト</small></div><button type="button" onClick={onClose} aria-label="閉じる"><X /></button></header>
      <nav aria-label="仕事設定">
        <button data-active={tab === "work"} onClick={() => setTab("work")}><FolderKanban />成果物</button>
        <button data-active={tab === "jobs"} onClick={() => setTab("jobs")}><ListChecks />実行</button>
        <button data-active={tab === "agents"} onClick={() => setTab("agents")}><Bot />Agent</button>
        <button data-active={tab === "projects"} onClick={() => setTab("projects")}><FolderKanban />プロジェクト</button>
        <button data-active={tab === "pins"} onClick={() => setTab("pins")}><Pin />ピン留め</button>
        <button data-active={tab === "files"} onClick={() => setTab("files")}><FileUp />ファイル</button>
        <button data-active={tab === "memory"} onClick={() => setTab("memory")}><Brain />メモリ</button>
        {paidExecution ? <button data-active={tab === "cost"} onClick={() => setTab("cost")}><WalletCards />費用</button> : null}
        <button data-active={tab === "connections"} onClick={() => setTab("connections")}><Link2 />連携</button>
        <button data-active={tab === "schedule"} onClick={() => setTab("schedule")}><CalendarClock />定期実行</button>
      </nav>
      <div className={styles.body}>
        {tab === "jobs" ? <AiWorkSystemPanel project={project} /> : null}
        {tab === "agents" ? <AiAgentNetworkPanel /> : null}
        {tab === "work" ? <>
          <h2>何を完成させますか</h2><div className={styles.choices}>{deliverables.map((item) => <button key={item} data-active={settings.deliverable === item} onClick={() => onChange({ ...settings, deliverable: item })}>{item}</button>)}</div>
          <h2>どう進めますか</h2><div className={styles.workflows}>{WORKFLOWS.map((item) => <button key={item.id} data-active={settings.workflow === item.id} onClick={() => onChange({ ...settings, workflow: item.id })}><strong>{item.name}</strong><small>{item.steps}</small></button>)}</div>
          <label className={styles.check}><input type="checkbox" checked={settings.evidence} onChange={(event) => onChange({ ...settings, evidence: event.target.checked })} /><ShieldCheck />根拠・URL・確認日を付ける</label>
        </> : null}
        {tab === "projects" ? <><div className={styles.sectionHeading}><div><h2>プロジェクト</h2><small>{projects.length}件</small></div><button className={styles.secondary} onClick={onCreateProject}><Plus />新規</button></div><div className={styles.settingList}>{projects.map((item) => <button key={item} data-active={item === project} onClick={() => onSelectProject(item)}><FolderKanban /><span><strong>{item}</strong><small>{item === project ? "使用中" : "切り替える"}</small></span></button>)}</div><p className={styles.note}>チャット履歴と仕事設定はプロジェクトごとに分けて表示します。</p></> : null}
        {tab === "pins" ? <><div className={styles.sectionHeading}><div><h2>ピン留めしたチャット</h2><small>{pinnedChats.length}件</small></div></div><div className={styles.settingList}>{pinnedChats.length ? pinnedChats.map((chat) => <button key={chat.id} data-active="true" onClick={() => onTogglePin(chat.id)}><Pin /><span><strong>{chat.title}</strong><small>{chat.project}・クリックで解除</small></span></button>) : <p className={styles.note}>まだありません。左列のチャット履歴からピン留めできます。</p>}</div></> : null}
        {tab === "files" ? <><h2>手元の資料を使う</h2><button className={styles.drop} onClick={() => fileInput.current?.click()}><FileUp />テキスト・Markdown・CSV・コードを選択<small>最大5件・各2MB。内容は実行時だけAIへ渡します。</small></button><input ref={fileInput} hidden type="file" multiple onChange={(event) => void readFiles(event.target.files)} />{settings.attachmentContext ? <p className={styles.ready}>資料を読み込みました。プロンプトへ添付できます。</p> : null}<p className={styles.note}>PDF・Office・画像の安全な解析は、隔離スキャン付きアップロードAPI接続後に有効化します。</p></> : null}
        {tab === "memory" ? <><div className={styles.sectionHeading}><div><h2>AIが覚えていること</h2><small>{memories.length}/50件</small></div><button className={styles.secondary} onClick={onAddMemory}><Plus />追加</button></div><div className={styles.memories}>{memories.length ? memories.map((memory) => <div key={memory.id}><span>{memory.content}</span><button onClick={() => onDeleteMemory(memory.id)} aria-label={`${memory.content}を削除`}><Trash2 /></button></div>) : <p className={styles.note}>まだメモリはありません。回答の好みや前提を追加できます。</p>}</div><div className={styles.memoryActions}><button onClick={onExportMemory}><Download />エクスポート</button><label><Upload />インポート<input hidden type="file" accept="application/json,.json" onChange={(event) => { onImportMemory(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>{memories.length ? <button onClick={onClearMemories}><Trash2 />すべて削除</button> : null}</div><p className={styles.note}>メモリはAI設定として管理します。プロンプトや回答本文を自動でメモリには保存しません。</p></> : null}
        {paidExecution && tab === "cost" ? <><h2>実行予算</h2><label className={styles.range}>1回の上限: <strong>${settings.budgetUsd.toFixed(2)} USDC</strong><input type="range" min="0.10" max="5" step="0.10" value={settings.budgetUsd} onChange={(event) => onChange({ ...settings, budgetUsd: Number(event.target.value) })} /></label><div className={styles.metric}><span>選択フローの概算</span><strong>${estimate.toFixed(2)}</strong></div><p className={estimate > settings.budgetUsd ? styles.warning : styles.ready}>{estimate > settings.budgetUsd ? "予算内に収まりません。安いAIまたは短いフローへ自動調整します。" : "予算内で実行できます。署名前に確定最大額を表示します。"}</p></> : null}
        {tab === "connections" ? <>{paidExecution ? <><h2>AI接続状況</h2><div className={styles.runtimeStatus} data-ready={runtimeReadiness?.ready === true}><strong>{runtimeReadiness?.ready ? "実行可能" : "準備中"}</strong><span>クラウドAI {runtimeReadiness?.providers.enabled ?? 0}/{runtimeReadiness?.providers.total ?? 0}</span><small>{runtimeReadiness?.missing.map((item) => ({ sales: "x402販売", recipient: "受取先", facilitator: "決済確認", network: "ネットワーク", provider: "AI API" })[item] ?? item).join("・") || "すべて接続済み"}</small></div></> : null}<h2>外部サービス</h2><AiConnectorSettings compact /></> : null}
        {tab === "schedule" ? <><h2>繰り返す仕事</h2><label className={styles.field}>実行内容<textarea value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="毎朝、競合ニュースを調べて変化だけ報告" /></label><button className={styles.secondary} disabled={!schedule.trim()} onClick={() => onUsePrompt(`定期実行の設定案を作成してください。\n${schedule}`)}><ListChecks />設定案を作る</button><p className={styles.note}>実際の自動実行には、通知先とバックグラウンド実行基盤の接続が必要です。まず安全な設定案を作成します。</p></> : null}
      </div>
      <footer>{paidExecution ? <span>概算 ${estimate.toFixed(2)} / 上限 ${settings.budgetUsd.toFixed(2)} USDC</span> : <span />}<button type="button" onClick={apply}>この設定で始める</button></footer>
    </section>
  </div>;
}
