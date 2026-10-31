"use client";

import { settingsSectionHref } from "@/lib/settings-section-href";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  personalNodeTranslationMode,
  setPersonalNodeTranslationMode,
  type PersonalNodeTranslationMode,
} from "@/lib/personal-node-translation-client";

import styles from "./personal-node-dashboard.module.css";

type HubNodeState = {
  node: { nodeUrl: string; status: "active" | "revoked" } | null;
  relays?: Array<{ relayUrl: string }>;
  devices?: Array<{ deviceId: string; status: "active" | "revoked" }>;
};

type DesktopNodeState = {
  nodeId: string;
  deviceName: string;
  enabled: boolean;
  storagePath: string;
  syncState: string;
  lastSyncAt: number | null;
  queuedItems: number;
};

type LoadState = "loading" | "ready" | "unavailable";

const capabilities = [
  { title: "端末と復旧", body: "このPCの権限、接続端末、復旧方法を管理します。", section: "personal-node", action: "端末を管理" },
  { title: "投稿とコミュニティ", body: "公開投稿、スレッド、フォローを他のノードと直接連合します。", section: "federation", action: "連合を設定" },
  { title: "保存先と配信元", body: "動画、画像、音楽、Vaultなどの原本を置くノードを選びます。", section: "distributed-network", action: "保存先を選ぶ" },
  { title: "AIエージェント", body: "CodexやローカルAIへ、読み取りや下書きなど必要な権限だけを委任します。", section: "agent-access", action: "権限を管理" },
  { title: "移行と復旧", body: "暗号化したデータを書き出し、別のノードやクライアントへ移行します。", section: "data-portability", action: "データを管理" },
] as const;

const accessModes = [
  {
    title: "このPCだけで使う",
    badge: "ドメイン不要",
    body: "投稿の下書き、ファイル、個人AIを端末内に置きます。外部のFediverseからは見えません。",
    section: "personal-node",
    action: "端末を設定",
  },
  {
    title: "Hubの公開入口を使う",
    badge: "独自ドメイン不要",
    body: "HubのHTTPS入口と中継を任意で使い、端末のノードを外部から見つけられるようにします。",
    section: "federation",
    action: "公開方法を設定",
  },
  {
    title: "自分のドメインを使う",
    badge: "最も自立",
    body: "公開名を自分のドメインに置き、接続先やHubクライアントを変更しても同じ名前を維持します。",
    section: "domain-alias",
    action: "ドメインを設定",
  },
] as const;

const protocolRows = [
  { name: "ActivityPub", role: "公開投稿、フォロー、返信、ノード間要求", state: "利用可能", tone: "ready" },
  { name: "WebFinger", role: "@user@domain から公開アカウントを発見", state: "公開設定で利用", tone: "ready" },
  { name: "AT Protocol", role: "外部アカウントの接続と公開フィード", state: "試験運用", tone: "preview" },
  { name: "NodeInfo", role: "ノードの種類と対応機能を公開", state: "利用可能", tone: "ready" },
  { name: "Nostr / Matrix", role: "外部リレーと暗号化チャットの追加接続", state: "未対応", tone: "pending" },
] as const;

export function PersonalNodeDashboard() {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [hubLoadState, setHubLoadState] = useState<LoadState>("loading");
  const [hubNode, setHubNode] = useState<HubNodeState>({ node: null });
  const [desktopLoadState, setDesktopLoadState] = useState<LoadState>("loading");
  const [desktopNode, setDesktopNode] = useState<DesktopNodeState | null>(null);
  const [translationMode, setTranslationMode] = useState<PersonalNodeTranslationMode>("off");

  useEffect(() => {
    setTranslationMode(personalNodeTranslationMode());
    const controller = new AbortController();
    void fetch("/api/core/personal-node", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("node_status_unavailable");
        setHubNode(await response.json() as HubNodeState);
        setHubLoadState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHubLoadState("unavailable");
      });

    void connectDesktopNode(controller.signal)
      .then((node) => {
        setDesktopNode(node);
        setDesktopLoadState("ready");
      })
      .catch(() => setDesktopLoadState("unavailable"));
    return () => controller.abort();
  }, []);

  const active = hubLoadState === "ready" && hubNode.node?.status === "active";
  const activeDevices = hubNode.devices?.filter((device) => device.status === "active").length ?? 0;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>PERSONAL NODE</span>
        <h1>自分のデータとAIを、自分のPCで動かす</h1>
        <p>Hubは操作画面です。公開コンテンツ、個人AI、ファイルの原本はPersonal Nodeに置き、対応ノード同士で直接つながります。</p>

        <div className={styles.statusCard} aria-live="polite">
          <div>
            <span className={styles.statusLabel}>PCアプリ</span>
            <strong>{desktopLoadState === "loading" ? "確認中" : desktopNode?.enabled ? `${desktopNode.deviceName}で稼働中` : "接続されていません"}</strong>
            <p>{desktopNode ? `Node ${desktopNode.nodeId.slice(0, 8)} · 待機 ${desktopNode.queuedItems}件 · 保存先 ${desktopNode.storagePath}` : "Hub Personal Nodeアプリを起動すると、このPCを保存・AI・同期の実行場所として使えます。"}</p>
          </div>
          <span className={`${styles.badge} ${desktopNode?.enabled ? styles.badgeActive : ""}`}>{desktopNode?.enabled ? "PC接続済み" : "アプリが必要"}</span>
        </div>

        <div className={styles.statusCard} aria-live="polite">
          <div>
            <span className={styles.statusLabel}>公開ノード登録</span>
            <strong>{hubLoadState === "loading" ? "確認中" : active ? "登録済み" : hubLoadState === "unavailable" ? "状態を取得できません" : "未登録"}</strong>
            <p>{active ? `${hubNode.node?.nodeUrl} · 有効な端末 ${activeDevices}台 · Relay ${hubNode.relays?.length ?? 0}件` : "外部ノードと直接通信するときだけ、公開HTTPS URLを登録します。PC内だけで使う場合は必須ではありません。"}</p>
          </div>
          <span className={`${styles.badge} ${active ? styles.badgeActive : ""}`}>{active ? "連合可能" : "任意設定"}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>公開方法を選ぶ</h2>
          <p>Personal Nodeはドメインなしでも使えます。外部と連合するときだけ、安定したHTTPSの公開名を選びます。</p>
        </div>
        <div className={styles.modeGrid}>
          {accessModes.map((mode) => (
            <Link className={styles.modeCard} href={settingsSectionHref(surface, mode.section)} key={mode.title}>
              <span className={styles.modeBadge}>{mode.badge}</span>
              <h3>{mode.title}</h3>
              <p>{mode.body}</p>
              <strong>{mode.action} →</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>接続規格</h2>
          <p>Hub内部の共通モデルへ変換して表示します。未対応の規格を利用可能とは表示しません。</p>
        </div>
        <div className={styles.protocolList}>
          {protocolRows.map((protocol) => (
            <div className={styles.protocolRow} key={protocol.name}>
              <div><strong>{protocol.name}</strong><span>{protocol.role}</span></div>
              <span className={styles.protocolState} data-tone={protocol.tone}>{protocol.state}</span>
            </div>
          ))}
        </div>
        <Link className={styles.inlineLink} href={settingsSectionHref(surface, "external-protocols")}>外部接続を管理 →</Link>
      </section>

      <section className={styles.section} id="commerce">
        <div className={styles.sectionHeader}>
          <h2>ノード間取引</h2>
          <p>通信規格と資金移動を分離します。ActivityPubの通知だけで支払い済みにはせず、決済先で確定を確認します。</p>
        </div>
        <div className={styles.commerceGrid}>
          <article>
            <span className={styles.commerceFee}>0%</span>
            <h3>直接取引</h3>
            <p>購入者と販売者のノードが直接やり取りします。Hubの検索、注文管理、保証を使わない取引にHub手数料はかかりません。</p>
            <Link href={settingsSectionHref(surface, "distributed-network")}>ノード間通信を設定 →</Link>
          </article>
          <article>
            <span className={styles.commerceFee}>1%</span>
            <h3>Hub支援取引</h3>
            <p>Hubの検索・商品一覧・注文管理から成立した対象取引は、販売者負担の販売手数料（本体価格の1%、消費税込み）を適用します。</p>
            <Link href={hubSurfacePath(surface, "/market")}>マーケットを見る →</Link>
          </article>
          <article>
            <span className={styles.commerceFee}>任意</span>
            <h3>保護を追加</h3>
            <p>エスクロー、紛争対応、配送連携など、選択した付加サービスだけ別条件を確認して利用します。</p>
            <Link href={hubSurfacePath(surface, "/market/orders")}>注文と保護を確認 →</Link>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>分散翻訳</h2>
          <p>ローカルAIの翻訳結果を端末だけで使うか、公開投稿の共有翻訳としてHubへ提供するかを選べます。</p>
        </div>
        <label className={styles.translationSetting}>
          <span>
            <strong>翻訳結果の扱い</strong>
            <small>非公開文、DM、AIメモリはどの設定でも共有されません。</small>
          </span>
          <select
            value={translationMode}
            onChange={(event) => {
              const mode = event.target.value as PersonalNodeTranslationMode;
              setPersonalNodeTranslationMode(mode);
              setTranslationMode(mode);
            }}
          >
            <option value="private">端末内だけで使う</option>
            <option value="shared">公開投稿の翻訳を共有する</option>
            <option value="off">Personal Node翻訳を使わない</option>
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>できること</h2><p>目的から選ぶと、該当する設定へ移動します。</p></div>
        <div className={styles.grid}>
          {capabilities.map((capability) => (
            <Link className={styles.card} href={settingsSectionHref(surface, capability.section)} key={capability.title}>
              <h3>{capability.title}</h3><p>{capability.body}</p><span>{capability.action} →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><h2>責任の分離</h2><p>分散化しても、決済や安全確認の責任主体は曖昧にしません。</p></div>
        <div className={styles.boundary}>
          <div><strong>Personal Node</strong><span>鍵、原本、個人AI、端末権限</span></div>
          <div><strong>ノード間プロトコル</strong><span>投稿、依頼、状態通知、移行</span></div>
          <div><strong>責任サービス</strong><span>認証、決済確定、返金、安全審査</span></div>
        </div>
      </section>
    </div>
  );
}

async function connectDesktopNode(signal: AbortSignal): Promise<DesktopNodeState> {
  const pair = await fetch("http://127.0.0.1:43127/pair", { method: "POST", signal });
  if (!pair.ok) throw new Error("desktop_pair_failed");
  const { sessionToken } = await pair.json() as { sessionToken: string };
  try {
    const status = await fetch("http://127.0.0.1:43127/node/status", {
      cache: "no-store",
      headers: { authorization: `Bearer ${sessionToken}` },
      signal,
    });
    if (!status.ok) throw new Error("desktop_status_failed");
    return status.json() as Promise<DesktopNodeState>;
  } finally {
    void fetch("http://127.0.0.1:43127/disconnect", {
      method: "POST",
      headers: { authorization: `Bearer ${sessionToken}` },
    }).catch(() => undefined);
  }
}
