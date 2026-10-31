"use client";

// スマホ(Hub Web / モバイルアプリのWebView)から、自分のPCのHub Desktop「AIの接続」を使う。
// 既存のペアリング済みWebRTC(P2PTransferPanel)に AI 用チャネルを載せるだけで、新しい経路は作らない。
// 依頼と返答はスマホとPCの間だけを通り、Hubサーバーには届かない。キー・CLIのログイン情報・パスは受け取らない。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { P2PTransferPanel } from "./p2p-transfer-panel";
import { PAIRING_RELAY_ORIGIN } from "@/lib/p2p-pairing.mjs";
import { RemoteAiClientPeer, errorText, type RemoteEvent } from "@/lib/remote-ai-client.mjs";
import type { RemoteSource } from "@/lib/remote-ai-protocol.mjs";

export const REMOTE_SETUP_VALUE = "remote:setup";
export type RemoteChoice = { source: "api" | "cli"; sourceId: string; modelId: string };
export type RemoteModel = RemoteChoice & { name: string };

export const remoteModelValue = (choice: RemoteChoice) => `remote:${choice.source}:${choice.sourceId}/${choice.modelId}`;
export function parseRemoteModelValue(value: string): RemoteChoice | null {
  const match = /^remote:(api|cli):([-a-zA-Z0-9]{1,40})\/(.{1,80})$/.exec(value);
  return match ? { source: match[1] as "api" | "cli", sourceId: match[2], modelId: match[3] } : null;
}
export function remoteModels(sources: RemoteSource[]): RemoteModel[] {
  return sources.flatMap((source) => {
    const models = source.models.length ? source.models : source.defaultModel ? [source.defaultModel] : [];
    return models.map((modelId) => ({ source: source.source, sourceId: source.id, modelId, name: source.name }));
  });
}

type Messages = { role: "user" | "assistant"; content: string }[];
export type RemotePc = ReturnType<typeof useRemoteAiPc>;

export function useRemoteAiPc() {
  const peer = useRef<RemoteAiClientPeer | null>(null);
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sources, setSources] = useState<RemoteSource[]>([]);
  const [selection, setSelectionState] = useState<RemoteChoice | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSupported(typeof RTCPeerConnection !== "undefined" && Boolean(globalThis.crypto?.subtle));
    // The desktop's invitation link lands here with #pair=…; the panel reads and clears it.
    if (location.hash.startsWith("#pair=") && typeof RTCPeerConnection !== "undefined") setOpen(true);
    return () => { peer.current?.close(); peer.current = null; };
  }, []);

  const onRemote = useCallback((event: RemoteEvent) => {
    if (event.type === "sources") { setSources(event.sources); setConnected(true); setNotice(event.sources.length ? "" : "PCで「スマホから使える」をオンにした接続がありません。"); }
    else if (event.type === "listing") setNotice("PCの接続を確認しています…");
    else if (event.type === "error") setNotice(errorText(event.code));
    else if (event.type === "closed") { setConnected(false); setSources([]); setSelectionState(null); peer.current = null; }
  }, []);

  const createPeer = useCallback((configuration: RTCConfiguration, onChange: ConstructorParameters<typeof RemoteAiClientPeer>[1]) => {
    peer.current?.close();
    const next = new RemoteAiClientPeer(configuration, onChange, onRemote);
    peer.current = next;
    return next;
  }, [onRemote]);

  const models = remoteModels(sources);
  const chosen = selection ? models.find((model) => model.source === selection.source && model.sourceId === selection.sourceId && model.modelId === selection.modelId) : undefined;

  /** Streams one answer. Resolves when the PC ends the run; rejects with a readable message. */
  const run = useCallback((messages: Messages, onDelta: (text: string) => void, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const current = peer.current;
    if (!current || !selection) { reject(new Error("PCに接続してください。")); return; }
    try {
      current.start({ source: selection.source, sourceId: selection.sourceId, model: selection.modelId }, messages, {
        delta: onDelta,
        end: () => resolve(),
        error: (code) => reject(new Error(errorText(code))),
      });
    } catch (error) { reject(error instanceof Error ? error : new Error("依頼を送れませんでした。")); return; }
    signal.addEventListener("abort", () => current.cancel(), { once: true });
  }), [selection]);

  const panel: ReactNode = open
    ? <div className="ai-remote-pc" role="dialog" aria-modal="true" aria-label="自分のPCのAIにつなぐ" style={{ position: "fixed", inset: 0, zIndex: 100, overflow: "auto", padding: 16, color: "var(--text)", background: "var(--surface-raised)" }}>
        <P2PTransferPanel purpose="ai" createPeer={createPeer} allowRelaySelection pairOrigin={PAIRING_RELAY_ORIGIN} invitationUrl={`${location.origin}/ai`} />
        {notice ? <p role="status">{notice}</p> : null}
        <button type="button" onClick={() => setOpen(false)}>閉じる</button>
      </div>
    : null;

  return {
    supported, open, setOpen, connected, models, selection: chosen ? selection : null, chosen, notice, panel,
    select: (choice: RemoteChoice | null) => setSelectionState(choice),
    usable: Boolean(connected && chosen),
    run,
    refresh: () => { try { peer.current?.refresh(); } catch { /* not connected */ } },
  };
}

/** Options for the native <select> in the model picker. */
export function RemoteNativeOptions({ remote }: { remote: RemotePc }) {
  if (!remote.supported) return null;
  return <>
    {remote.models.map((model) => <option key={remoteModelValue(model)} value={remoteModelValue(model)}>{model.name} · {model.modelId} · 自分のPC</option>)}
    <option value={REMOTE_SETUP_VALUE}>{remote.connected ? "自分のPCのAIを更新…" : "自分のPCのAIにつなぐ…"}</option>
  </>;
}

/** Entries for the custom model menu. `pick` closes the menu and selects the value. */
export function RemoteMenuItems({ remote, activeValue, pick, check }: { remote: RemotePc; activeValue: string; pick: (value: string, event: React.MouseEvent<HTMLButtonElement>) => void; check: ReactNode }) {
  if (!remote.supported) return null;
  return <>
    <p>自分のPCのAI</p>
    {remote.models.map((model) => {
      const value = remoteModelValue(model);
      return <button type="button" key={value} className={activeValue === value ? "is-selected" : ""} onClick={(event) => pick(value, event)} role="option" aria-selected={activeValue === value}>
        <span className="ai-model-picker__check">{activeValue === value ? check : null}</span>
        <span><strong>{model.name}</strong><small>{model.modelId} · PCが提供元へ直接送信</small></span>
        <em>PCの請求</em>
      </button>;
    })}
    <button type="button" onClick={(event) => pick(REMOTE_SETUP_VALUE, event)} role="option" aria-selected={false}>
      <span className="ai-model-picker__check" />
      <span><strong>{remote.connected ? "自分のPCのAIを更新" : "自分のPCのAIにつなぐ"}</strong><small>Hub Desktopの「スマホから使える」をオンにした接続だけ</small></span>
      <em>設定</em>
    </button>
  </>;
}
