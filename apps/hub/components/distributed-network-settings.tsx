"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  AUTHORITATIVE_HUB_DOMAINS,
  DISTRIBUTED_KIND_COPY,
  DISTRIBUTED_NODE_GROUPS,
  nodeModeLabel,
  type DistributedNodeMode,
} from "@/lib/distributed-node-policy";
import type { DistributedResourceKind } from "@/lib/distributed-resource-manifest";
import type { FederatedServiceOperation } from "@/lib/server/federation-gateway";

import styles from "./distributed-network-settings.module.css";
import { HubNetworkSettings } from './hub-network';

type Preference = { kind: DistributedResourceKind; mode: DistributedNodeMode; providerResourceId: string | null };
type Provider = { id: string; kind: DistributedResourceKind; title: string; origin: string };
type Draft = {
  remoteActorId: string; targetInboxUrl: string; capability: FederatedServiceOperation["capability"];
  action: string; resource: string; inputRef: string;
};

const EMPTY_DRAFT: Draft = {
  remoteActorId: "", targetInboxUrl: "", capability: "social", action: "post.request", resource: "", inputRef: "",
};

function hostname(origin: string) { try { return new URL(origin).hostname; } catch { return origin; } }
function stateLabel(state: FederatedServiceOperation["deliveryState"], ja: boolean) {
  const labels = ja
    ? { received: "受信", awaiting_confirmation: "確認待ち", queued: "送信待ち", delivered: "送達済み", retrying: "再試行中", completed: "完了", failed: "失敗", cancelled: "取消済み" }
    : { received: "Received", awaiting_confirmation: "Needs confirmation", queued: "Queued", delivered: "Delivered", retrying: "Retrying", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
  return labels[state];
}

export function DistributedNetworkSettings({ locale }: { locale: "ja" | "en" }) {
  const ja = locale === "ja";
  const [manifestUrl, setManifestUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [operations, setOperations] = useState<FederatedServiceOperation[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<{ requestId: string; capability: string; action: string; target: string } | null>(null);
  const [personalNodeReady, setPersonalNodeReady] = useState(false);
  const [personalNodeUrl, setPersonalNodeUrl] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [preferenceResponse, providerResponse, operationResponse] = await Promise.all([
      fetch("/api/core/distributed-preferences", { cache: "no-store", credentials: "same-origin", signal }),
      fetch("/api/distributed/resources?limit=50", { cache: "no-store", credentials: "same-origin", signal }),
      fetch("/api/core/service-operations", { cache: "no-store", credentials: "same-origin", signal }),
    ]);
    if (!preferenceResponse.ok || !providerResponse.ok) throw new Error("load_failed");
    const preferenceBody = await preferenceResponse.json() as { preferences?: Preference[]; personalNodeReady?: boolean; personalNodeUrl?: string | null };
    const providerBody = await providerResponse.json() as { resources?: Provider[] };
    setPreferences(preferenceBody.preferences ?? []);
    setPersonalNodeReady(preferenceBody.personalNodeReady === true);
    setPersonalNodeUrl(preferenceBody.personalNodeUrl ?? null);
    setProviders(providerBody.resources ?? []);
    if (operationResponse.ok) setOperations(((await operationResponse.json()) as { operations?: FederatedServiceOperation[] }).operations ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") setMessage(ja ? "ネットワーク設定を読み込めませんでした。" : "Network settings could not be loaded.");
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [ja, load]);

  const providersByKind = useMemo(() => {
    const result = new Map<DistributedResourceKind, Provider[]>();
    for (const provider of providers) result.set(provider.kind, [...(result.get(provider.kind) ?? []), provider]);
    return result;
  }, [providers]);

  function current(kind: DistributedResourceKind): Preference {
    return preferences.find((item) => item.kind === kind) ?? { kind, mode: "hub-standard", providerResourceId: null };
  }

  async function save(kind: DistributedResourceKind, mode: DistributedNodeMode, providerResourceId?: string | null) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/core/distributed-preferences", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ kind, mode, providerResourceId }) });
      const body = await response.json() as { preference?: Preference; error?: string };
      if (!response.ok || !body.preference) throw new Error(body.error ?? "save_failed");
      setPreferences((items) => [...items.filter((item) => item.kind !== kind), body.preference!]);
      setMessage(ja ? "保存しました。" : "Preference saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : (ja ? "保存できませんでした。" : "Save failed.")); }
    finally { setBusy(false); }
  }

  async function makePersonalNodePrimary() {
    if (!personalNodeReady || busy) return;
    setBusy(true);
    try {
      const kinds: DistributedResourceKind[] = ["post", "thread", "community"];
      const saved = await Promise.all(kinds.map(async (kind) => {
        const response = await fetch("/api/core/distributed-preferences", { method: "PUT", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ kind, mode: "local" }) });
        const body = await response.json() as { preference?: Preference; error?: string };
        if (!response.ok || !body.preference) throw new Error(body.error ?? "save_failed");
        return body.preference;
      }));
      setPreferences((items) => [...items.filter((item) => !kinds.includes(item.kind)), ...saved]);
      setMessage(ja ? "公開投稿・スレッド・コミュニティの原本をPersonal Node優先にしました。" : "Personal Node now owns public social originals.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "switch_failed"); }
    finally { setBusy(false); }
  }

  async function register() {
    if (!manifestUrl.trim() || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/distributed/resources", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ manifestUrl: manifestUrl.trim() }) });
      const body = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "registration_failed");
      setManifestUrl(""); setMessage(body.message ?? (ja ? "確認待ちとして登録しました。" : "Registered for review."));
    } catch (error) { setMessage(error instanceof Error ? error.message : "registration_failed"); }
    finally { setBusy(false); }
  }

  async function prepareOperation() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/core/service-operations", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ ...draft, resource: draft.resource || undefined, inputRef: draft.inputRef || undefined, idempotencyKey: crypto.randomUUID() }) });
      const body = await response.json() as { operation?: { requestId: string }; error?: string };
      if (!response.ok || !body.operation) throw new Error(body.error ?? "prepare_failed");
      setPreview({ requestId: body.operation.requestId, capability: draft.capability, action: draft.action, target: draft.remoteActorId });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "prepare_failed"); }
    finally { setBusy(false); }
  }

  async function mutate(requestId: string, action: "confirm" | "cancel" | "retry") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/core/service-operations/${encodeURIComponent(requestId)}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "operation_failed");
      setPreview(null); await load();
      setMessage(ja ? "操作状態を更新しました。" : "Operation updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "operation_failed"); }
    finally { setBusy(false); }
  }

  return <div className={styles.panel}>
    <HubNetworkSettings />
    <section className={styles.section}>
      <h3>{ja ? "Personal Nodeネットワーク" : "Personal Node network"}</h3>
      <p>{ja ? "Personal Node同士がActivityPubで直接つながります。Hubは任意の公式クライアントであり、必須の中継サーバーではありません。" : "Personal Nodes connect directly over ActivityPub. Hub is an optional official client."}</p>
      <div className={styles.nodeStatus}><span className={personalNodeReady ? styles.ready : styles.pending} aria-hidden="true" /><div><strong>{personalNodeReady ? (ja ? "接続済み" : "Connected") : (ja ? "未接続" : "Not connected")}</strong><small>{personalNodeReady ? personalNodeUrl : (ja ? "この端末または常時稼働サーバーでノードを作成してください。" : "Create a node on this device or an always-on server.")}</small></div><button type="button" disabled={!personalNodeReady} aria-busy={busy} onClick={() => void makePersonalNodePrimary()}>{ja ? "交流をNode優先にする" : "Use node for social data"}</button></div>
    </section>

    <div className={styles.principles}><div><strong>{ja ? "所有・保管・配信" : "Ownership and delivery"}</strong><span>Personal Node</span></div><div><strong>{ja ? "検索・推薦" : "Search and recommendations"}</strong><span>{ja ? "提供者を選択可能" : "Provider-selectable"}</span></div><div><strong>{ja ? "直接連合" : "Direct federation"}</strong><span>{ja ? "Hub停止中も継続" : "Continues without Hub"}</span></div></div>

    <section className={styles.section}>
      <h3>{ja ? "ノード間サービス要求" : "Direct node service requests"}</h3>
      <p>{ja ? "相手ノードへ公開参照だけを送ります。決済、住所、AI入力、秘密鍵は送信しません。作成後に内容を確認してから配送します。" : "Only public references are sent. Payments, addresses, AI inputs, and keys never enter ActivityPub. Every request requires confirmation."}</p>
      <div className={styles.operationForm}>
        <label><span>Actor URL</span><input type="url" value={draft.remoteActorId} onChange={(e) => setDraft({ ...draft, remoteActorId: e.target.value })} placeholder="https://node.example/users/alice" /></label>
        <label><span>Inbox URL</span><input type="url" value={draft.targetInboxUrl} onChange={(e) => setDraft({ ...draft, targetInboxUrl: e.target.value })} placeholder="https://node.example/users/alice/inbox" /></label>
        <label><span>{ja ? "機能" : "Capability"}</span><select value={draft.capability} onChange={(e) => setDraft({ ...draft, capability: e.target.value as Draft["capability"] })}>{["social","knowledge","commerce","payment","delivery","vault","media","ai","secure-data"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>{ja ? "操作" : "Action"}</span><input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="post.request" /></label>
        <label><span>{ja ? "公開リソースURL（任意）" : "Public resource URL (optional)"}</span><input type="url" value={draft.resource} onChange={(e) => setDraft({ ...draft, resource: e.target.value })} /></label>
        <label><span>{ja ? "暗号化入力への参照（任意）" : "Encrypted input reference (optional)"}</span><input type="url" value={draft.inputRef} onChange={(e) => setDraft({ ...draft, inputRef: e.target.value })} /></label>
      </div>
      <button className={styles.primaryAction} type="button" disabled={busy || !draft.remoteActorId || !draft.targetInboxUrl || !draft.action} onClick={() => void prepareOperation()}>{ja ? "確認画面を作る" : "Prepare confirmation"}</button>
      {preview ? <div className={styles.confirmation} role="alert"><strong>{ja ? "送信前の確認" : "Confirm before sending"}</strong><dl><div><dt>{ja ? "相手" : "Target"}</dt><dd>{preview.target}</dd></div><div><dt>{ja ? "要求" : "Request"}</dt><dd>{preview.capability} / {preview.action}</dd></div></dl><div><button type="button" disabled={busy} onClick={() => void mutate(preview.requestId, "confirm")}>{ja ? "確認して送信" : "Confirm and send"}</button><button type="button" disabled={busy} onClick={() => void mutate(preview.requestId, "cancel")}>{ja ? "取り消す" : "Cancel"}</button></div></div> : null}
      <div className={styles.operations}>{operations.length === 0 ? <p>{ja ? "サービス要求はまだありません。" : "No service requests yet."}</p> : operations.map((operation) => <article key={operation.activityId}><div><strong>{operation.capability} / {operation.action}</strong><span>{stateLabel(operation.deliveryState, ja)}</span></div><small>{hostname(operation.remoteActorId)} · {operation.direction === "outbound" ? (ja ? "送信" : "Outbound") : (ja ? "受信" : "Inbound")}</small>{operation.lastErrorCategory ? <small>{operation.lastErrorCategory}</small> : null}<footer>{["failed","retrying"].includes(operation.deliveryState) ? <button type="button" disabled={busy} onClick={() => void mutate(operation.requestId, "retry")}>{ja ? "再試行" : "Retry"}</button> : null}{!["completed","cancelled"].includes(operation.deliveryState) ? <button type="button" disabled={busy} onClick={() => void mutate(operation.requestId, "cancel")}>{ja ? "取消" : "Cancel"}</button> : null}</footer></article>)}</div>
    </section>

    <section className={styles.section}><h3>{ja ? "種類ごとの保存・実行先" : "Storage and execution by type"}</h3><p>{ja ? "Hub、Personal Node、審査済み外部ノードから選択します。" : "Choose Hub, Personal Node, or a verified external node."}</p><div className={styles.groups}>{DISTRIBUTED_NODE_GROUPS.map((group) => <details className={styles.group} key={group.id} open={group.id === "social"}><summary>{group.label}<span>{group.kinds.length}</span></summary><div className={styles.preferences}>{group.kinds.map((kind) => { const item = current(kind); const available = providersByKind.get(kind) ?? []; const value = item.mode === "external" ? `external:${item.providerResourceId ?? ""}` : item.mode; const copy = DISTRIBUTED_KIND_COPY[kind]; return <div className={styles.preference} key={kind}><div><strong>{copy.label}</strong><small>{copy.description}</small></div><select aria-label={`${copy.label} node`} value={value} disabled={busy || loading} onChange={(event) => { const next = event.target.value; if (next.startsWith("external:")) void save(kind, "external", next.slice(9)); else void save(kind, next as DistributedNodeMode); }}><option value="hub-standard">Hub</option><option value="local" disabled={!personalNodeReady}>Personal Node</option>{available.map((provider) => <option key={provider.id} value={`external:${provider.id}`}>{provider.title} · {hostname(provider.origin)}</option>)}</select><span className={styles.mode}>{nodeModeLabel(item.mode)}</span></div>; })}</div></details>)}</div></section>

    <section className={styles.section}><h3>{ja ? "統制を維持する領域" : "Authoritative domains"}</h3><p>{ja ? "認証、決済確定、安全管理などは責任主体を明確にしたサービス内で管理します。" : "Authentication, payment finality, and safety remain in accountable services."}</p><div className={styles.boundary}>{AUTHORITATIVE_HUB_DOMAINS.map((domain) => <span key={domain}>{domain}</span>)}</div></section>
    <section className={styles.section}><h3>{ja ? "公開ノードを登録" : "Register a public node"}</h3><p>{ja ? "公開HTTPS上のHub Resource Manifest v1を登録します。審査完了後に選択できます。" : "Register a public HTTPS Hub Resource Manifest v1."}</p><div className={styles.form}><input type="url" value={manifestUrl} onChange={(event) => setManifestUrl(event.target.value)} placeholder="https://node.example/.well-known/hub-resource.json" /><button type="button" disabled={busy || !manifestUrl.trim()} onClick={() => void register()}>{ja ? "確認して登録" : "Check and register"}</button></div><p className={styles.message} role="status">{loading ? (ja ? "読み込み中…" : "Loading…") : message}</p></section>
  </div>;
}
