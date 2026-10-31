"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BYOK_BILLING_NOTE,
  BYOK_PRIVACY_NOTE,
  byokErrorMessage,
  nativeByokManager,
  type ByokConnection,
  type ByokProviderInfo,
  type ByokProviderKind,
  type ByokStatus,
} from "@/lib/native-byok";
import runner from "./ai-local-runner-panel.module.css";
import styles from "./ai-connections-panel.module.css";

type Draft = {
  /** 空なら新規。あれば編集。 */
  id: string;
  kind: ByokProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};

const EMPTY_DRAFT: Draft = { id: "", kind: "anthropic", label: "", baseUrl: "", apiKey: "", enabled: true };

function providerLabel(providers: ByokProviderInfo[], kind: ByokProviderKind) {
  return providers.find((provider) => provider.kind === kind)?.label ?? kind;
}

/**
 * 「AIの接続」。自分のAPIキーを登録し、接続を試し、使う/使わないを決める。
 * キーは送信した瞬間にネイティブ側が封じ、この画面には末尾の印しか戻ってこない。
 */
export function AiConnectionsPanel({ onClose, onChanged }: { onClose(): void; onChanged?(): void }) {
  const [status, setStatus] = useState<ByokStatus | null>(null);
  const [connections, setConnections] = useState<ByokConnection[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState("");

  const refresh = useCallback(async () => {
    const manager = nativeByokManager();
    if (!manager) {
      setStatus(null);
      return;
    }
    try {
      const nextStatus = await manager.status();
      setStatus(nextStatus);
      setConnections(nextStatus.available ? await manager.listConnections() : []);
    } catch (error) {
      setNotice({ tone: "error", text: byokErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handleReady = () => { void refresh(); };
    window.addEventListener("hub-native-byok-ready", handleReady);
    return () => window.removeEventListener("hub-native-byok-ready", handleReady);
  }, [refresh]);

  const manager = nativeByokManager();
  const providers = status?.providers ?? [];
  const selectedProvider = draft ? providers.find((provider) => provider.kind === draft.kind) : undefined;

  function startAdd() {
    setNotice(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  function startEdit(connection: ByokConnection) {
    setNotice(null);
    setDraft({
      id: connection.id,
      kind: connection.kind,
      label: connection.label,
      baseUrl: connection.kind === "openai-compatible" ? connection.baseUrl : "",
      apiKey: "",
      enabled: connection.enabled,
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!manager || !draft) return;
    setBusy("save");
    setNotice(null);
    try {
      if (draft.id) {
        const current = connections.find((connection) => connection.id === draft.id);
        const endpointChanged = draft.kind === "openai-compatible" && draft.baseUrl.trim() !== (current?.baseUrl ?? "");
        await manager.updateConnection({
          id: draft.id,
          label: draft.label,
          enabled: draft.enabled,
          ...(endpointChanged ? { baseUrl: draft.baseUrl } : {}),
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        });
      } else {
        await manager.addConnection({
          kind: draft.kind,
          label: draft.label,
          apiKey: draft.apiKey,
          enabled: draft.enabled,
          ...(draft.kind === "openai-compatible" ? { baseUrl: draft.baseUrl } : {}),
        });
      }
      // 入力欄のキーは保存した直後に捨てる。
      setDraft(null);
      setNotice({ tone: "ok", text: "保存しました。キーはこの端末の安全な領域に封じられ、画面には戻りません。" });
      await refresh();
      onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: byokErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function toggle(connection: ByokConnection) {
    if (!manager) return;
    setBusy(connection.id);
    try {
      await manager.updateConnection({ id: connection.id, enabled: !connection.enabled });
      await refresh();
      onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: byokErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function test(connection: ByokConnection) {
    if (!manager) return;
    setBusy(connection.id);
    setNotice(null);
    try {
      const result = await manager.testConnection(connection.id);
      setNotice(result.ok
        ? { tone: "ok", text: `${connection.label}: 接続できました（モデル${result.modelCount}件）。` }
        : { tone: "error", text: `${connection.label}: ${byokErrorMessage(result.code ?? "")}` });
    } catch (error) {
      setNotice({ tone: "error", text: byokErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function remove(connection: ByokConnection) {
    if (!manager) return;
    setBusy(connection.id);
    try {
      await manager.removeConnection(connection.id);
      setConfirmRemove("");
      setNotice({ tone: "ok", text: `${connection.label} を削除しました。保存していたキーも端末から消えます。` });
      await refresh();
      onChanged?.();
    } catch (error) {
      setNotice({ tone: "error", text: byokErrorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  const unavailable = !manager || (status !== null && !status.available);
  const unavailableText = !manager
    ? "自分のAPIキーでの利用は、Hubアプリ（Android）でだけ使えます。"
    : byokErrorMessage(`byok_${status?.reason ?? "unavailable"}`);

  return (
    <section className={runner.overlay} aria-label="AIの接続">
      <div className={runner.panel}>
        <header>
          <div><strong>AIの接続</strong><small>自分のAPIキーで、好きな提供元のAIを使います</small></div>
          <button type="button" onClick={onClose}>閉じる</button>
        </header>

        {unavailable ? <p className={styles.note} role="status">{unavailableText}</p> : (
          <>
            <p className={styles.note}>{BYOK_PRIVACY_NOTE}</p>
            <p className={styles.note}>{BYOK_BILLING_NOTE}</p>

            {connections.length ? (
              <ul className={styles.list}>
                {connections.map((connection) => (
                  <li key={connection.id} className={styles.item}>
                    <div className={styles.itemHead}>
                      <strong>{connection.label}</strong>
                      <span className={`${styles.badge} ${connection.enabled ? styles.badgeOn : ""}`}>{connection.enabled ? "有効" : "無効"}</span>
                    </div>
                    <p className={styles.meta}>
                      {providerLabel(providers, connection.kind)} · キー {connection.keyMask}
                      {connection.kind === "openai-compatible" ? ` · ${connection.baseUrl}` : ""}
                    </p>
                    <div className={styles.row}>
                      <button type="button" disabled={busy !== ""} onClick={() => { void test(connection); }}>{busy === connection.id ? "確認中…" : "接続を試す"}</button>
                      <button type="button" disabled={busy !== ""} onClick={() => { void toggle(connection); }}>{connection.enabled ? "無効にする" : "有効にする"}</button>
                      <button type="button" disabled={busy !== ""} onClick={() => startEdit(connection)}>編集</button>
                      {confirmRemove === connection.id
                        ? <>
                            <button type="button" disabled={busy !== ""} onClick={() => { void remove(connection); }}>削除する</button>
                            <button type="button" onClick={() => setConfirmRemove("")}>やめる</button>
                          </>
                        : <button type="button" disabled={busy !== ""} onClick={() => setConfirmRemove(connection.id)}>削除…</button>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : !draft ? <p className={styles.note}>接続はまだありません。「接続を追加」から、使いたい提供元のAPIキーを登録してください。</p> : null}

            {draft ? (
              <form className={styles.form} onSubmit={(event) => { void save(event); }} autoComplete="off">
                <strong>{draft.id ? "接続を編集" : "接続を追加"}</strong>
                <label>
                  提供元
                  <select value={draft.kind} disabled={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ByokProviderKind })}>
                    {providers.map((provider) => <option key={provider.kind} value={provider.kind}>{provider.label}</option>)}
                  </select>
                </label>
                <label>
                  名前
                  <input value={draft.label} maxLength={40} required onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="例: 仕事用" />
                </label>
                {selectedProvider?.customEndpoint ? (
                  <label>
                    接続先URL
                    <input type="url" inputMode="url" value={draft.baseUrl} required maxLength={300} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://openrouter.ai/api/v1" autoCapitalize="none" spellCheck={false} />
                    <small className={styles.meta}>https のURL。端末内のサーバーだけ http://127.0.0.1 も使えます。接続先を変えるときはキーの入れ直しが必要です。</small>
                  </label>
                ) : null}
                <label>
                  APIキー
                  <input type="password" value={draft.apiKey} required={!draft.id} maxLength={512} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={draft.id ? "変えるときだけ入力" : "sk-…"} autoComplete="off" autoCapitalize="none" spellCheck={false} />
                  <small className={styles.meta}>保存すると端末の安全な領域に封じられます。もう一度表示することはできません。</small>
                </label>
                <label className={styles.check}>
                  <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                  この接続を有効にする
                </label>
                <div className={styles.row}>
                  <button type="submit" disabled={busy !== ""}>{busy === "save" ? "保存中…" : "保存"}</button>
                  <button type="button" disabled={busy !== ""} onClick={() => setDraft(null)}>キャンセル</button>
                </div>
              </form>
            ) : connections.length < (status?.maxConnections ?? 8) ? (
              <button type="button" onClick={startAdd}>接続を追加</button>
            ) : <p className={styles.note}>接続の上限に達しています。</p>}
          </>
        )}

        {notice ? <p className={notice.tone === "ok" ? styles.ok : runner.error} role={notice.tone === "ok" ? "status" : "alert"}>{notice.text}</p> : null}
      </div>
    </section>
  );
}
