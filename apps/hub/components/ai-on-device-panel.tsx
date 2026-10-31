"use client";

import { useEffect, useRef, useState } from "react";
import {
  onDeviceAiBridge,
  onDeviceGemmaManager,
  validateOnDeviceModel,
  type NativeGemmaCatalogItem,
  type OnDeviceModel,
} from "@/lib/on-device-ai";
import styles from "./ai-local-runner-panel.module.css";

type PanelStatus = "loading" | "ready" | "installing" | "importing" | "running" | "unavailable";
type ChatEntry = { id: number; role: "user" | "assistant"; text: string; model?: string };
type ScreenWakeLock = { release(): Promise<void> };
type ModelFilter = "recommended" | "installed" | "all";
type RoutingMode = "speed" | "balanced" | "quality";

const TASK_PRESETS = [
  { label: "質問", prompt: "" },
  { label: "要約", prompt: "次の内容を簡潔に要約してください。\n\n" },
  { label: "文章作成", prompt: "次の条件で読みやすい文章を作成してください。\n\n" },
  { label: "翻訳", prompt: "次の文章を自然な日本語に翻訳してください。\n\n" },
  { label: "コード", prompt: "次のコードまたは要件を分析し、改善案を示してください。\n\n" },
] as const;

const AUTO_PRIORITY = [
  "gemma-4-e2b-it",
  "qwen-2.5-1.5b-it",
  "gemma-3-1b-it",
  "qwen-3-0.6b-it",
  "gemma-3-270m-it",
  "smollm2-360m-it",
  "smollm2-135m-it",
];
const SPEED_PRIORITY = ["smollm2-135m-it", "gemma-3-270m-it", "smollm2-360m-it", "qwen-3-0.6b-it"];
const BALANCED_PRIORITY = ["gemma-3-1b-it", "qwen-3-0.6b-it", "smollm2-360m-it", ...AUTO_PRIORITY];

function formatBytes(bytes: number) {
  return bytes >= 1_000_000_000
    ? `${(bytes / 1_000_000_000).toFixed(1)} GB`
    : `${Math.ceil(bytes / 1_000_000)} MB`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "計算中";
  if (seconds < 60) return `約${Math.max(1, Math.ceil(seconds))}秒`;
  if (seconds < 3_600) return `約${Math.ceil(seconds / 60)}分`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return `約${hours}時間${minutes ? `${minutes}分` : ""}`;
}

function nativeErrorCode(reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason ?? "");
  return [
    "gemma_unmetered_network_required",
    "gemma_storage_insufficient",
    "gemma_hash_mismatch",
    "gemma_size_mismatch",
    "gemma_download_paused",
    "gemma_not_installed",
    "gemma_generation_busy",
    "gemma_import_cancelled",
  ].find((code) => text.includes(code)) ?? "";
}

function downloadErrorMessage(reason: unknown) {
  const code = nativeErrorCode(reason);
  if (code === "gemma_unmetered_network_required") return "モバイル通信では大容量モデルを取得しません。Wi‑Fiに接続して「再開」を押してください。";
  if (code === "gemma_storage_insufficient") return "端末の空き容量が不足しています。不要なファイルを整理してから「再開」を押してください。";
  if (code === "gemma_hash_mismatch" || code === "gemma_size_mismatch") return "取得したファイルの検証に失敗しました。不正なモデルは保存していません。通信を確認して再試行してください。";
  if (code === "gemma_download_paused") return "ダウンロードを一時停止しました。途中から再開できます。";
  return "ダウンロードを完了できませんでした。途中データは保持されています。Wi‑Fiと空き容量を確認して「再開」を押してください。";
}

function chooseModelForPrompt(prompt: string, installedIds: string[], fallback: string, routingMode: RoutingMode) {
  const has = (id: string) => installedIds.includes(id);
  if (routingMode === "speed") return SPEED_PRIORITY.find(has) ?? fallback;
  if (routingMode === "quality") return AUTO_PRIORITY.find(has) ?? fallback;
  if (/(コード|実装|バグ|数式|数学|論理|code|debug|typescript|python)/i.test(prompt)) {
    if (has("phi-4-mini-it")) return "phi-4-mini-it";
    if (has("qwen-2.5-1.5b-it")) return "qwen-2.5-1.5b-it";
  }
  if (/(翻訳|英語|日本語|中国語|translate)/i.test(prompt)) {
    if (has("qwen-2.5-1.5b-it")) return "qwen-2.5-1.5b-it";
    if (has("qwen-3-0.6b-it")) return "qwen-3-0.6b-it";
  }
  if (prompt.length < 160) {
    if (has("smollm2-360m-it")) return "smollm2-360m-it";
    if (has("gemma-3-270m-it")) return "gemma-3-270m-it";
  }
  return has(fallback) ? fallback : installedIds[0] ?? fallback;
}

export function AiOnDevicePanel({ onClose }: { onClose(): void }) {
  const [catalog, setCatalog] = useState<NativeGemmaCatalogItem[]>([]);
  const [models, setModels] = useState<OnDeviceModel[]>([]);
  const [modelId, setModelId] = useState("auto");
  const [modelFilter, setModelFilter] = useState<ModelFilter>("recommended");
  const [routingMode, setRoutingMode] = useState<RoutingMode>("balanced");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [conversation, setConversation] = useState<ChatEntry[]>([]);
  const [compareModels, setCompareModels] = useState(false);
  const [online, setOnline] = useState(true);
  const stopRequested = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [partialBytes, setPartialBytes] = useState(0);
  const [downloadBytesPerSecond, setDownloadBytesPerSecond] = useState(0);
  const [status, setStatus] = useState<PanelStatus>("loading");
  const wakeLock = useRef<ScreenWakeLock | null>(null);

  async function refresh() {
    const bridge = onDeviceAiBridge();
    const manager = onDeviceGemmaManager();
    if (!bridge || !manager) {
      setStatus("unavailable");
      return;
    }
    const [available, installed] = await Promise.all([manager.catalog(), bridge.listModels()]);
    const valid = installed.map(validateOnDeviceModel).filter((item): item is OnDeviceModel => Boolean(item));
    setCatalog(available);
    setModels(valid);
    setStatus("ready");
  }

  useEffect(() => {
    const markUnavailable = (reason: unknown) => {
      // The reason may embed prompt or model text; log only its kind.
      console.error("on_device_ai_refresh_failed", reason instanceof Error ? reason.name : "unknown");
      setStatus("unavailable");
    };
    void refresh().catch(markUnavailable);
    const handleReady = () => { void refresh().catch(markUnavailable); };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh().catch(markUnavailable);
    };
    window.addEventListener("hub-native-gemma-ready", handleReady);
    document.addEventListener("visibilitychange", handleVisibility);
    const retry = window.setTimeout(handleReady, 1200);
    return () => {
      window.removeEventListener("hub-native-gemma-ready", handleReady);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(retry);
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const selectedPriority = routingMode === "speed" ? SPEED_PRIORITY : routingMode === "quality" ? AUTO_PRIORITY : BALANCED_PRIORITY;
  const autoInstalled = selectedPriority.find((id) => models.some((model) => model.id === id));
  const autoDownloadPriority = routingMode === "speed"
    ? SPEED_PRIORITY
    : routingMode === "quality"
      ? AUTO_PRIORITY
      : ["gemma-3-1b-it", "qwen-3-0.6b-it", ...BALANCED_PRIORITY];
  const autoDownload = autoDownloadPriority.find((id) => catalog.some((item) => item.modelId === id && item.supported))
    ?? catalog.find((item) => item.supported)?.modelId
    ?? "";
  const effectiveModelId = modelId === "auto" ? (autoInstalled ?? autoDownload) : modelId;
  const selected = catalog.find((item) => item.modelId === effectiveModelId);
  const selectedInstalled = models.some((model) => model.id === effectiveModelId);
  const visibleCatalog = catalog.filter((item) => {
    if (modelFilter === "installed") return item.installed;
    if (modelFilter === "recommended") return item.supported && (SPEED_PRIORITY.includes(item.modelId) || item.modelId === "gemma-3-1b-it" || item.modelId === "gemma-4-e2b-it");
    return true;
  });
  const downloaded = status === "installing" ? partialBytes : (selected?.partialBytes ?? 0);
  const progress = selected?.downloadBytes
    ? Math.min(100, Math.round((downloaded / selected.downloadBytes) * 100))
    : 0;
  const remainingSeconds = selected && downloadBytesPerSecond > 0
    ? Math.max(0, (selected.downloadBytes - downloaded) / downloadBytesPerSecond)
    : 0;

  async function install() {
    const manager = onDeviceGemmaManager();
    if (!manager || !effectiveModelId) return;
    setStatus("installing");
    setError("");
    setPartialBytes(selected?.partialBytes ?? 0);
    setDownloadBytesPerSecond(0);
    const startedAt = performance.now();
    let lastMeasuredAt = startedAt;
    let lastMeasuredBytes = selected?.partialBytes ?? 0;
    try {
      const wakeLockApi = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<ScreenWakeLock> } }).wakeLock;
      wakeLock.current = wakeLockApi ? await wakeLockApi.request("screen") : null;
    } catch {
      wakeLock.current = null;
    }
    const timer = window.setInterval(() => {
      void manager.status(effectiveModelId)
        .then((current) => {
          setPartialBytes(current.partialBytes);
          const now = performance.now();
          const elapsedSeconds = (now - lastMeasuredAt) / 1_000;
          const addedBytes = current.partialBytes - lastMeasuredBytes;
          if (elapsedSeconds >= 1 && addedBytes >= 0) {
            const currentRate = addedBytes / elapsedSeconds;
            setDownloadBytesPerSecond((previous) => previous > 0 ? previous * 0.65 + currentRate * 0.35 : currentRate);
            lastMeasuredAt = now;
            lastMeasuredBytes = current.partialBytes;
          }
        })
        .catch(() => undefined);
    }, 1_000);
    try {
      await manager.install(effectiveModelId);
      await refresh();
    } catch (reason) {
      setError(downloadErrorMessage(reason));
      setStatus("ready");
      const current = await manager.status(effectiveModelId).catch(() => null);
      if (current) setPartialBytes(current.partialBytes);
    } finally {
      window.clearInterval(timer);
      await wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
    }
  }

  async function pauseInstall() {
    const manager = onDeviceGemmaManager();
    if (!manager) return;
    await manager.cancelInstall().catch(() => undefined);
  }

  async function importLocalModel() {
    const manager = onDeviceGemmaManager();
    if (!manager || !effectiveModelId) return;
    setStatus("importing");
    setError("");
    try {
      await manager.importModel(effectiveModelId);
      await refresh();
    } catch (reason) {
      if (String(reason).includes("gemma_import_cancelled")) {
        setStatus("ready");
        return;
      }
      setError("モデルを取り込めませんでした。選択したモデルと同じ公式ファイルか、容量とSHA-256を確認してください。");
      setStatus("ready");
    }
  }

  async function removeInstalledModel() {
    const manager = onDeviceGemmaManager();
    if (!manager || !effectiveModelId) return;
    setStatus("installing");
    setError("");
    try {
      await manager.deleteModel(effectiveModelId);
      setOutput("");
      setPartialBytes(0);
      setDeleteConfirmation("");
      setConfirmingDelete(false);
      await refresh();
    } catch {
      setError("モデルを削除できませんでした。もう一度お試しください。");
      setStatus("ready");
    }
  }

  async function run() {
    const bridge = onDeviceAiBridge();
    if (!bridge || !effectiveModelId || !prompt.trim()) return;
    const submitted = prompt.trim();
    setStatus("running");
    stopRequested.current = false;
    setOutput("");
    setError("");
    setPrompt("");
    setConversation((current) => [...current, { id: Date.now(), role: "user", text: submitted }]);
    try {
      const context = conversation.slice(-6).map((entry) => `${entry.role === "user" ? "ユーザー" : "AI"}: ${entry.text}`).join("\n\n");
      const input = `${context ? `${context}\n\n` : ""}ユーザー: ${submitted}\n\nAI:`.slice(-8_000);
      const installedIds = [...new Set([...AUTO_PRIORITY, ...models.map((model) => model.id)])]
        .filter((id) => models.some((model) => model.id === id));
      const routedModelId = modelId === "auto" ? chooseModelForPrompt(submitted, installedIds, effectiveModelId, routingMode) : effectiveModelId;
      const targets = compareModels
        ? installedIds.slice(0, 3)
        : [routedModelId];
      const results: ChatEntry[] = [];
      for (const target of targets) {
        if (stopRequested.current) break;
        const modelName = catalog.find((item) => item.modelId === target)?.name ?? target;
        const assistantId = Date.now() + results.length + 1;
        let streamedOutput = "";
        setConversation((current) => [...current, { id: assistantId, role: "assistant", text: "", model: modelName }]);
        const request = { modelId: target, prompt: input, maxOutputTokens: 2_048, temperature: 0.7 };
        const result = bridge.generateStream
          ? await bridge.generateStream(request, (chunk) => {
              if (stopRequested.current || !chunk) return;
              streamedOutput += chunk;
              setConversation((current) => current.map((entry) => (
                entry.id === assistantId ? { ...entry, text: streamedOutput } : entry
              )));
              setOutput(streamedOutput);
            })
          : await bridge.generate(request);
        const finalOutput = result.output || streamedOutput;
        const completed = { id: assistantId, role: "assistant" as const, text: finalOutput, model: modelName };
        results.push(completed);
        setConversation((current) => current.map((entry) => entry.id === assistantId ? completed : entry));
        setOutput(results.map((entry) => `${entry.model}\n${entry.text}`).join("\n\n"));
        if (stopRequested.current) break;
      }
    } catch (reason) {
      if (!stopRequested.current) {
        const code = nativeErrorCode(reason);
        setError(code === "gemma_not_installed"
          ? "選択したモデルが端末にありません。モデルをダウンロードしてから再試行してください。"
          : code === "gemma_generation_busy"
            ? "別の回答を生成中です。停止してからもう一度お試しください。"
            : "端末内AIを実行できませんでした。モデルと端末の空きメモリを確認してください。");
      }
    } finally {
      setStatus("ready");
    }
  }

  async function attachTextFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000 || !/\.(txt|md|csv|json)$/i.test(file.name)) {
      setError("1MB以下のTXT・Markdown・CSV・JSONファイルを選んでください。");
      return;
    }
    const text = await file.text();
    setPrompt((current) => `${current}${current ? "\n\n" : ""}ファイル: ${file.name}\n${text}`.slice(0, 8_000));
    setError("");
  }

  function useAnswer(entry: ChatEntry, instruction = "") {
    setPrompt(`${instruction}${entry.text}`.slice(0, 8_000));
  }

  return (
    <section className={styles.overlay} aria-label="この端末内AI">
      <div className={styles.panel}>
        <header>
          <div><strong>この端末内AI</strong><small>今使っているスマホまたはPCの中だけで処理します</small></div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>
        <div className={styles.deviceState} role="status">
          <span>{online ? "オンライン" : "オフライン"}</span>
          <span>{models.length}モデル利用可能</span>
          <span>{selectedInstalled ? "このAIは通信なしで実行可能" : "モデル取得にはWi‑Fiが必要"}</span>
        </div>

        <div className={styles.modelFilters} aria-label="モデルの表示">
          {(["recommended", "installed", "all"] as const).map((filter) => (
            <button type="button" key={filter} className={modelFilter === filter ? styles.selected : ""} aria-pressed={modelFilter === filter} onClick={() => setModelFilter(filter)}>
              {filter === "recommended" ? "おすすめ" : filter === "installed" ? `インストール済み（${models.length}）` : "すべて"}
            </button>
          ))}
        </div>

        <div className={styles.routingMode}>
          <span>自動選択</span>
          {(["speed", "balanced", "quality"] as const).map((mode) => (
            <button type="button" key={mode} className={routingMode === mode ? styles.selected : ""} aria-pressed={routingMode === mode} onClick={() => setRoutingMode(mode)}>
              {mode === "speed" ? "速度" : mode === "quality" ? "品質" : "バランス"}
            </button>
          ))}
        </div>

        <label>
          モデル
          <select value={modelId} disabled={status === "installing" || status === "importing" || status === "running"} onChange={(event) => setModelId(event.target.value)}>
            <option value="auto">自動（推奨）</option>
            {visibleCatalog.map((item) => (
              <option key={item.modelId} value={item.modelId} disabled={!item.supported}>
                {item.name} · 約{Math.ceil(item.downloadBytes / 1_000_000)}MB{item.installed ? " · インストール済み" : ""}
              </option>
            ))}
          </select>
        </label>

        {selected ? (
          <div className={styles.modelStatus}>
            <strong>{selected.name}</strong>
            <span>{selected.purpose}</span>
            <dl>
              <div><dt>ダウンロード</dt><dd>{formatBytes(selected.downloadBytes)}</dd></div>
              <div><dt>端末の空き容量</dt><dd>{formatBytes(selected.freeBytes)}</dd></div>
              <div><dt>必要メモリ</dt><dd>{formatBytes(selected.estimatedMemoryMb * 1_000_000)}</dd></div>
              <div><dt>状態</dt><dd>{selectedInstalled ? "利用可能" : downloaded > 0 ? `${progress}%まで取得済み` : selected.supported ? "利用可能" : "非対応"}</dd></div>
            </dl>
          </div>
        ) : null}

        {status === "loading" ? <p>端末を確認しています…</p> : null}
        {status === "importing" ? <p role="status">選択したモデルを検証して取り込んでいます。画面を閉じずにお待ちください。</p> : null}
        {status === "installing" && selected ? (
          <div className={styles.installProgress} role="status">
            <progress max={selected.downloadBytes} value={downloaded} />
            <strong>{progress}%</strong>
            <span>
              {formatBytes(downloaded)} / {formatBytes(selected.downloadBytes)}
              {downloadBytesPerSecond > 0 ? ` · ${formatBytes(downloadBytesPerSecond)}/秒 · 残り${formatDuration(remainingSeconds)}` : " · 速度を測定中"}
            </span>
            <small>ダウンロード中は画面のスリープを抑止します。完了後に容量とSHA-256を検証します。</small>
            <button type="button" onClick={() => { void pauseInstall(); }}>一時停止</button>
          </div>
        ) : null}

        {!selectedInstalled && status !== "loading" && status !== "installing" && status !== "importing" ? (
          <div className={styles.downloadActions}>
            <p>{selected?.supported === false ? "この端末では選択したモデルを実行できません。" : downloaded > 0 ? "前回の続きから安全に再開できます。" : "モデルはまだ端末にありません。Wi‑Fi接続時に取得します。"}</p>
            {selected?.supported ? (
              <>
                <button type="button" disabled={!online} onClick={() => { void install(); }}>
                  {downloaded > 0 ? `ダウンロードを再開（${progress}%）` : `${formatBytes(selected.downloadBytes)}をダウンロード`}
                </button>
                <button type="button" onClick={() => { void importLocalModel(); }}>端末のファイルから取り込む</button>
              </>
            ) : null}
          </div>
        ) : null}

        {selectedInstalled ? (
          <>
            <div className={styles.installedActions}>
              <span>入力と結果は端末内で処理され、Hubへ保存されません。</span>
              {!confirmingDelete ? (
                <button type="button" disabled={status === "running" || status === "installing"} onClick={() => setConfirmingDelete(true)}>モデルを削除…</button>
              ) : (
                <div role="alert">
                  <strong>{selected?.name}を端末から完全に削除しますか？</strong>
                  <p>再び使うには、モデルの再ダウンロードまたはファイルからの取り込みが必要です。</p>
                  <label>
                    確認のため「削除」と入力
                    <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
                  </label>
                  <button type="button" onClick={() => { setDeleteConfirmation(""); setConfirmingDelete(false); }}>キャンセル</button>
                  <button type="button" disabled={deleteConfirmation !== "削除" || status === "running" || status === "installing"} onClick={() => { void removeInstalledModel(); }}>
                    {selected?.name}を完全に削除
                  </button>
                </div>
              )}
            </div>
            <div className={styles.taskPresets} aria-label="AIの用途">
              {TASK_PRESETS.map((preset) => <button type="button" key={preset.label} onClick={() => setPrompt((current) => `${preset.prompt}${current}`.slice(0, 8_000))}>{preset.label}</button>)}
            </div>
            {conversation.length ? <div className={styles.conversation} aria-live="polite">
              {conversation.map((entry) => <article key={entry.id} data-role={entry.role}>
                <small>{entry.role === "user" ? "あなた" : entry.model ?? "端末内AI"}</small>
                <p>{entry.text}</p>
                {entry.role === "assistant" ? <div className={styles.answerActions}>
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(entry.text); }}>コピー</button>
                  <button type="button" onClick={() => { if (navigator.share) void navigator.share({ text: entry.text }); }}>共有</button>
                  <button type="button" onClick={() => useAnswer(entry, "次の回答を短くしてください。\n\n")}>短く</button>
                  <button type="button" onClick={() => useAnswer(entry, "次の回答を詳しくしてください。\n\n")}>詳しく</button>
                  <button type="button" onClick={() => useAnswer(entry)}>採用</button>
                </div> : null}
              </article>)}
            </div> : null}
            <label>
              メッセージ
              <textarea rows={5} maxLength={8_000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="端末内AIに聞く" />
            </label>
            <div className={styles.actions}>
              <label className={styles.compareToggle}><input type="checkbox" checked={compareModels} disabled={models.length < 2} onChange={(event) => setCompareModels(event.target.checked)} />インストール済みAIを比較（最大3つ）</label>
              <div className={styles.runActions}>
                <input ref={fileInput} type="file" hidden accept=".txt,.md,.csv,.json,text/plain,text/csv,application/json" onChange={(event) => { void attachTextFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                <button type="button" disabled={status === "running"} onClick={() => fileInput.current?.click()}>ファイル</button>
                {status === "running"
                  ? <button type="button" onClick={() => { stopRequested.current = true; void onDeviceAiBridge()?.cancel?.().catch(() => undefined); }}>停止</button>
                  : <button type="button" disabled={!prompt.trim()} onClick={() => { void run(); }}>端末で実行</button>}
              </div>
            </div>
            {conversation.length ? <button type="button" disabled={status === "running"} onClick={() => { setConversation([]); setOutput(""); }}>会話を消去</button> : null}
            {output ? <span className={styles.srOnly} aria-live="polite">回答を生成しました</span> : null}
          </>
        ) : null}
        {status === "unavailable" ? <p role="alert">端末内AIを利用できません。Androidアプリを最新版に更新してください。</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
