"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmPeer,
  decryptPeerContent,
  deliverPeerEvent,
  deliverPendingEvents,
  listPeers,
  listPeerInbox,
  preparePublicArtifact,
  previewPeer,
  previewPrivateContent,
  previewPublicContent,
  queuePublicContent,
  registerThisMachine,
  type ArtifactKind,
  type PeerPreview,
  type PeerInboxItem,
  type PinnedPeer,
  type PublicContentPreview
} from "@/lib/personal-node-registration";
import styles from "./this-machine-panel.module.css";

const RUNNER = "http://127.0.0.1:43127";

type Health = { status: string; isolation: string; checkpoint: string };
type Workspace = { enabled: boolean; workspace: string | null };
type Node = {
  deviceName?: string;
  queuedItems?: number;
  lastSyncAt?: string | null;
  shareCompute?: boolean;
  keyThumbprint?: string | null;
  hubUrl?: string;
};
type Pending = {
  runs: Array<{ id: string; language: string; workspaceRoot: string; expiresInSeconds: number }>;
  fileWrites: Array<{ id: string; relativePath: string; workspaceRoot: string; expiresInSeconds: number }>;
};

const ISOLATION: Record<string, string> = {
  docker: "Docker隔離 利用可能",
  unavailable: "Docker隔離 未設定"
};

/**
 * このPCの状態を Hub の中に出す。
 *
 * 承認だけはここに出せない。実行を要求するのはこのページで、同じページが
 * 承認まで押せるなら人が確かめる段は存在しないのと同じになる。だから
 * **何が待っているかは見せて、押すのは端末の窓に任せる。**「承認画面を開く」で
 * その窓が前に出る。窓を前に出すのは人の目に触れさせる方向の動作でしかない。
 */
export function ThisMachinePanel({ onClose, onDevelop }: { onClose(): void; onDevelop(): void }) {
  const [token, setToken] = useState("");
  const [offline, setOffline] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [node, setNode] = useState<Node | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [raised, setRaised] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registration, setRegistration] = useState<string | null>(null);
  const [contentKind, setContentKind] = useState("memory");
  const [contentTitle, setContentTitle] = useState("");
  const [contentBody, setContentBody] = useState("");
  const [contentPreview, setContentPreview] = useState<PublicContentPreview | null>(null);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [contentStatus, setContentStatus] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [peers, setPeers] = useState<PinnedPeer[]>([]);
  const [selectedPeerIds, setSelectedPeerIds] = useState<string[]>([]);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerPreviewState, setPeerPreviewState] = useState<PeerPreview | null>(null);
  const [peerFingerprintConfirmed, setPeerFingerprintConfirmed] = useState(false);
  const [peerStatus, setPeerStatus] = useState<string | null>(null);
  const [inbox, setInbox] = useState<PeerInboxItem[]>([]);
  const [openedContent, setOpenedContent] = useState<Record<string, string>>({});
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactKind, setArtifactKind] = useState<ArtifactKind>("file");
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactProgress, setArtifactProgress] = useState("");
  const [artifactPreview, setArtifactPreview] = useState<PublicContentPreview | null>(null);
  const [artifactConfirmed, setArtifactConfirmed] = useState(false);
  const [artifactStatus, setArtifactStatus] = useState<string | null>(null);
  const pairing = useRef(false);

  const load = useCallback(async (sessionToken: string) => {
    const headers = { authorization: `Bearer ${sessionToken}` };
    const read = async <T,>(path: string): Promise<T | null> => {
      const response = await fetch(`${RUNNER}${path}`, { headers, cache: "no-store" });
      return response.ok ? ((await response.json()) as T) : null;
    };
    const [nextHealth, nextWorkspace, nextNode, nextPending] = await Promise.all([
      read<Health>("/health"),
      read<Workspace>("/dev/workspace"),
      read<Node>("/node/status"),
      read<Pending>("/pending")
    ]);
    setHealth(nextHealth);
    setWorkspace(nextWorkspace);
    setNode(nextNode);
    setPending(nextPending);
    try {
      const [nextPeers, nextInbox] = await Promise.all([listPeers(sessionToken), listPeerInbox(sessionToken)]);
      setPeers(nextPeers); setInbox(nextInbox);
    } catch { setPeers([]); setInbox([]); }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (pairing.current) return;
        pairing.current = true;
        const paired = await fetch(`${RUNNER}/pair`, { method: "POST" });
        const body = (await paired.json()) as { sessionToken?: string };
        if (!paired.ok || !body.sessionToken) throw new Error("pair_failed");
        setToken(body.sessionToken);
        await load(body.sessionToken);
      } catch {
        // デスクトップアプリが動いていないのは、故障ではなく普通の状態。
        setOffline(true);
      }
    })();
  }, [load]);

  // 承認待ちは時間で消える（期限がある）ので、開いている間は見続ける。
  useEffect(() => {
    if (!token) return undefined;
    const timer = setInterval(() => void load(token), 3000);
    return () => clearInterval(timer);
  }, [token, load]);

  async function showApprovals() {
    if (!token) return;
    await fetch(`${RUNNER}/local-window/show`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    setRaised(true);
  }

  /** この端末のネイティブブラウザ窓を開く。描画・遷移は端末のWebViewが担う。 */
  async function showBrowser() {
    if (!token) return;
    await fetch(`${RUNNER}/browser-window/show`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}"
    });
    setRaised(true);
  }

  /**
   * この端末をノードとして登録する。
   *
   * 鍵は端末、サインインはこの画面。どちらも相手へ渡さず、署名だけを
   * 端末に頼む。
   */
  async function register() {
    if (!token || !node?.hubUrl) return;
    setRegistering(true);
    const result = await registerThisMachine(token, node.hubUrl);
    setRegistration(result.ok ? `登録しました（${result.keyThumbprint.slice(0, 16)}…）` : result.reason);
    if (result.ok) await load(token);
    setRegistering(false);
  }

  /** 積んだものを流す。1つ失敗したらそこで止まる。連鎖なので順番を崩せない。 */
  async function deliver() {
    if (!token) return;
    setRegistering(true);
    const result = await deliverPendingEvents(token);
    setRegistration(
      result.stoppedBecause
        ? `${result.delivered}件送って止まりました: ${result.stoppedBecause}`
        : `${result.delivered}件送りました`
    );
    await load(token);
    setRegistering(false);
  }

  function invalidateContentPreview() {
    setContentPreview(null);
    setContentConfirmed(false);
  }

  async function previewContent() {
    if (!token) return;
    setRegistering(true);
    setContentStatus(null);
    try {
      const draft = {
        kind: contentKind,
        title: contentTitle,
        body: contentBody,
        language: "ja"
      };
      setContentPreview(visibility === "private"
        ? await previewPrivateContent(token, { ...draft, recipientPeerIds: selectedPeerIds })
        : await previewPublicContent(token, draft));
      setContentConfirmed(false);
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistering(false);
    }
  }

  async function queueContent() {
    if (!token || !contentPreview || !contentConfirmed) return;
    setRegistering(true);
    try {
      const receipt = await queuePublicContent(token, contentPreview.previewId);
      if (contentPreview.visibility === "private") {
        const results = await Promise.all(selectedPeerIds.map((peerId) => deliverPeerEvent(token, peerId, receipt.sequence)));
        setContentStatus(`暗号化して${results.length}ノードへ配送しました · #${receipt.sequence} · ${results.every((item) => item.status === "ready") ? "復号検証済み" : "受信済み"}`);
      } else {
        setContentStatus(`公開配信待ちへ追加しました · #${receipt.sequence} · ${receipt.contentId}`);
      }
      setContentPreview(null);
      setContentConfirmed(false);
      setContentTitle("");
      setContentBody("");
      await load(token);
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistering(false);
    }
  }

  async function inspectPeer() {
    if (!token || !peerUrl.trim()) return;
    setRegistering(true); setPeerStatus(null);
    try { setPeerPreviewState(await previewPeer(token, peerUrl.trim())); setPeerFingerprintConfirmed(false); }
    catch (error) { setPeerStatus(error instanceof Error ? error.message : String(error)); }
    finally { setRegistering(false); }
  }

  async function pinPeer() {
    if (!token || !peerPreviewState || !peerFingerprintConfirmed) return;
    setRegistering(true);
    try {
      const peer = await confirmPeer(token, peerPreviewState.previewId);
      setPeers(await listPeers(token)); setPeerPreviewState(null); setPeerFingerprintConfirmed(false); setPeerUrl("");
      setPeerStatus(`鍵を固定しました · ${peer.nodeId}`);
    } catch (error) { setPeerStatus(error instanceof Error ? error.message : String(error)); }
    finally { setRegistering(false); }
  }

  async function openReceived(item: PeerInboxItem) {
    if (!token || item.status !== "ready") return;
    setRegistering(true);
    try {
      const content = await decryptPeerContent(token, item.deliveryId);
      setOpenedContent((current) => ({ ...current, [item.deliveryId]: content.text ?? `base64url: ${content.data}` }));
    } catch (error) { setPeerStatus(error instanceof Error ? error.message : String(error)); }
    finally { setRegistering(false); }
  }

  function selectArtifact(file: File | null) {
    setArtifactFile(file);
    setArtifactPreview(null);
    setArtifactConfirmed(false);
    setArtifactStatus(null);
    setArtifactProgress("");
    if (file?.type.startsWith("image/")) setArtifactKind("image");
    else if (file?.type.startsWith("audio/")) setArtifactKind("audio");
    else if (file?.type.startsWith("video/")) setArtifactKind("video");
  }

  async function prepareArtifact() {
    if (!token || !artifactFile) return;
    setRegistering(true);
    setArtifactStatus(null);
    try {
      const preview = await preparePublicArtifact(
        token,
        artifactFile,
        { kind: artifactKind, title: artifactTitle, language: "ja" },
        (done, total) => setArtifactProgress(`${done} / ${total}断片を検証中`),
        fetch,
        visibility === "private" ? selectedPeerIds : []
      );
      setArtifactPreview(preview);
      setArtifactConfirmed(false);
      setArtifactProgress("");
      setArtifactStatus("端末へ保存済み・未公開です。内容を確認してください。");
    } catch (error) {
      setArtifactStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistering(false);
    }
  }

  async function queueArtifact() {
    if (!token || !artifactPreview || !artifactConfirmed) return;
    setRegistering(true);
    try {
      const receipt = await queuePublicContent(token, artifactPreview.previewId);
      if (artifactPreview.visibility === "private") {
        const results = await Promise.all(selectedPeerIds.map((peerId) => deliverPeerEvent(token, peerId, receipt.sequence)));
        setArtifactStatus(`暗号化ファイルを${results.length}ノードへ配送しました · #${receipt.sequence}`);
      } else setArtifactStatus(`公開配信待ちへ追加しました · #${receipt.sequence} · ${receipt.contentId}`);
      setArtifactPreview(null);
      setArtifactConfirmed(false);
      setArtifactFile(null);
      setArtifactTitle("");
      await load(token);
    } catch (error) {
      setArtifactStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRegistering(false);
    }
  }

  const waiting = (pending?.runs.length ?? 0) + (pending?.fileWrites.length ?? 0);

  return (
    <section className={styles.overlay} aria-label="このPC">
      <div className={styles.panel}>
        <div className={styles.header}>
          <div>
            <h2>このPC</h2>
            <p>{offline ? "デスクトップアプリが起動していません。" : "この端末でできることと、いまの状態。"}</p>
          </div>
          <button type="button" onClick={onClose}>閉じる</button>
        </div>

        {offline ? (
          <p className={styles.note}>
            承認、開発、ローカルAIはデスクトップアプリが受け持ちます。起動してください。
          </p>
        ) : (
          <>
            <dl className={styles.state}>
              <div>
                <dt>隔離環境</dt>
                <dd className={health?.isolation === "docker" ? undefined : styles.warn}>
                  {health ? ISOLATION[health.isolation] ?? health.isolation : "確認中…"}
                </dd>
              </div>
              <div>
                <dt>作業フォルダ</dt>
                <dd className={workspace?.enabled ? styles.path : styles.warn}>
                  {workspace?.enabled ? workspace.workspace : "未設定（アプリの窓で指定します）"}
                </dd>
              </div>
              <div>
                <dt>この端末</dt>
                <dd>{node?.deviceName ?? "—"}</dd>
              </div>
            </dl>

            <section className={styles.block}>
              <div className={styles.blockHead}>
                <strong>承認待ち {waiting}件</strong>
                <span style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={showBrowser}>ブラウザを開く</button>
                  {waiting > 0 ? (
                    <button type="button" className={styles.primary} onClick={showApprovals}>承認画面を開く</button>
                  ) : null}
                </span>
              </div>
              {waiting === 0 ? (
                <p className={styles.quiet}>待っているものはありません。</p>
              ) : (
                <ul className={styles.list}>
                  {pending?.runs.map((run) => (
                    <li key={run.id}>
                      <code>{run.language === "python" ? "Python" : "JavaScript"}</code> の実行
                      <small>あと{run.expiresInSeconds}秒</small>
                    </li>
                  ))}
                  {pending?.fileWrites.map((write) => (
                    <li key={write.id}>
                      <code>保存</code> {write.relativePath}
                      <small>あと{write.expiresInSeconds}秒</small>
                    </li>
                  ))}
                </ul>
              )}
              <p className={styles.note}>
                押すのはこの端末の窓だけです。要求を出した画面が自分で承認できると、
                確かめる意味が無くなるためです。{raised ? "窓を前に出しました。" : ""}
              </p>
            </section>

            <section className={styles.block}>
              <div className={styles.blockHead}><strong>信頼するノードを追加</strong></div>
              <p className={styles.quiet}>相手の公開HTTPS URLから署名鍵と暗号鍵を取得し、指紋を人が確認して固定します。鍵変更は自動承認しません。</p>
              <div className={styles.contentFields}>
                <input value={peerUrl} onChange={(event) => { setPeerUrl(event.target.value); setPeerPreviewState(null); }} placeholder="https://node.example.com" aria-label="相手ノードの公開URL" />
                <button type="button" onClick={() => void inspectPeer()} disabled={registering || !peerUrl.trim()}>鍵指紋を確認</button>
              </div>
              {peerPreviewState ? <div className={styles.publicPreview}>
                <p>{peerPreviewState.nodeId}</p>
                <pre>署名 {peerPreviewState.signingKeyThumbprint}{"\n"}暗号 {peerPreviewState.encryptionKeyThumbprint}</pre>
                <label><input type="checkbox" checked={peerFingerprintConfirmed} onChange={(event) => setPeerFingerprintConfirmed(event.target.checked)} /> 別経路で相手に確認した鍵指紋と一致する</label>
                <div className={styles.entryActions}><button type="button" onClick={() => void pinPeer()} disabled={!peerFingerprintConfirmed || registering}>この鍵を固定する</button></div>
              </div> : null}
              {peerStatus ? <p className={styles.quiet} role="status">{peerStatus}</p> : null}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHead}><strong>受信した共通原本 {inbox.length}件</strong></div>
              {inbox.length === 0 ? <p className={styles.quiet}>受信した原本はありません。</p> : <ul className={styles.list}>
                {inbox.map((item) => <li key={item.deliveryId}>
                  <span>{item.title || item.kind} · {item.mediaType} · {item.byteLength}バイト</span>
                  <small>{item.status === "ready" ? "暗号文取得・復号認証済み" : "受信済み・本文取得待ち"} · {item.senderNodeId}</small>
                  {item.status === "ready" ? <button type="button" onClick={() => void openReceived(item)} disabled={registering}>この端末で復号して開く</button> : null}
                  {openedContent[item.deliveryId] ? <pre>{openedContent[item.deliveryId]}</pre> : null}
                </li>)}
              </ul>}
              <p className={styles.note}>平文は復号要求への応答だけに載せ、受信保存層には暗号文を保持します。</p>
            </section>

            <section className={styles.block}>
              <div className={styles.blockHead}><strong>共通原本を作る</strong></div>
              <p className={styles.quiet}>投稿・記憶・記事・文書を同じContent Envelopeで扱います。公開か、指定ノードだけが復号できるE2E暗号化かを選べます。</p>
              <div className={styles.contentFields}>
                <select value={visibility} onChange={(event) => { setVisibility(event.target.value as "public" | "private"); invalidateContentPreview(); setArtifactPreview(null); }} aria-label="共有範囲">
                  <option value="public">公開・複製可能</option><option value="private">指定ノードだけ・E2E暗号化</option>
                </select>
                <select value={contentKind} onChange={(event) => { setContentKind(event.target.value); invalidateContentPreview(); }} aria-label="コンテンツの種類">
                  <option value="memory">記憶</option><option value="post">投稿</option><option value="article">記事</option><option value="document">文書</option>
                </select>
                <input value={contentTitle} onChange={(event) => { setContentTitle(event.target.value); invalidateContentPreview(); }} maxLength={240} placeholder="題名（任意）" />
                <textarea value={contentBody} onChange={(event) => { setContentBody(event.target.value); invalidateContentPreview(); }} maxLength={1_048_576} rows={5} placeholder="人やAIと共有する原本を書く" />
                <button type="button" onClick={() => void previewContent()} disabled={registering || !contentBody.trim() || (visibility === "private" && selectedPeerIds.length === 0)}>公開前に確認</button>
              </div>
              {visibility === "private" ? <fieldset>
                <legend>復号できるノード</legend>
                {peers.length === 0 ? <p className={styles.warn}>先に相手ノードの鍵を固定してください。</p> : peers.map((peer) => <label key={peer.peerId}>
                  <input type="checkbox" checked={selectedPeerIds.includes(peer.peerId)} onChange={(event) => { setSelectedPeerIds((current) => event.target.checked ? [...current, peer.peerId] : current.filter((id) => id !== peer.peerId)); invalidateContentPreview(); setArtifactPreview(null); }} /> {peer.nodeId}
                </label>)}
              </fieldset> : null}
              {contentPreview ? <div className={styles.publicPreview}>
                <p>{contentPreview.kind} · {contentPreview.characterCount}文字 / {contentPreview.byteLength}バイト · {contentPreview.visibility === "private" ? `E2E暗号化 · ${contentPreview.recipientIds.length}ノード限定` : "公開 · ミラー許可 · AI学習は同意必須"}</p>
                <pre>{contentPreview.title ? `${contentPreview.title}\n\n` : ""}{contentPreview.body}</pre>
                <p className={styles.warn}>{contentPreview.visibility === "private" ? "宛先を追加・変更するには、新しい暗号文として作り直します。" : "複製された公開原本は、あとから完全には回収できません。"}</p>
                <label><input type="checkbox" checked={contentConfirmed} onChange={(event) => setContentConfirmed(event.target.checked)} /> この内容を端末へ保存し、配信待ちへ追加する</label>
                <div className={styles.entryActions}><button type="button" onClick={() => void queueContent()} disabled={!contentConfirmed || registering}>確認して配信待ちへ追加</button></div>
              </div> : null}
              {contentStatus ? <p className={styles.quiet} role="status">{contentStatus}</p> : null}

              <div className={styles.blockHead}><strong>ファイル原本</strong></div>
              <p className={styles.quiet}>画像・音声・動画・本・ゲームなども同じEnvelopeで扱います。本体は512KiBごとに検証して端末へ保存し、EnvelopeにはP2P URIとSHA-256だけを入れます。</p>
              <div className={styles.contentFields}>
                <select value={artifactKind} onChange={(event) => { setArtifactKind(event.target.value as ArtifactKind); setArtifactPreview(null); setArtifactConfirmed(false); }} aria-label="ファイル原本の種類">
                  <option value="file">ファイル</option><option value="image">画像</option><option value="audio">音声</option><option value="video">動画</option><option value="book">本</option><option value="document">文書</option><option value="game">ゲーム</option><option value="software">ソフトウェア</option><option value="product">商品</option><option value="catalog">カタログ</option>
                </select>
                <input value={artifactTitle} onChange={(event) => { setArtifactTitle(event.target.value); setArtifactPreview(null); setArtifactConfirmed(false); }} maxLength={240} placeholder="題名（任意）" aria-label="ファイル原本の題名" />
                <input type="file" onChange={(event) => selectArtifact(event.target.files?.[0] ?? null)} aria-label="共有するファイル" />
                <button type="button" onClick={() => void prepareArtifact()} disabled={registering || !artifactFile || (visibility === "private" && selectedPeerIds.length === 0)}>端末へ保存して確認</button>
              </div>
              {artifactProgress ? <p className={styles.quiet} role="status">{artifactProgress}</p> : null}
              {artifactPreview?.artifact ? <div className={styles.publicPreview}>
                <p>{artifactPreview.kind} · {artifactPreview.artifact.fileName} · {artifactPreview.artifact.byteLength}バイト · {artifactPreview.artifact.chunkCount}断片</p>
                <pre>{artifactPreview.title ? `${artifactPreview.title}\n` : ""}{artifactPreview.artifact.mediaType}{"\n"}SHA-256 {artifactPreview.artifact.digest}{"\n"}{artifactPreview.artifact.blobUri}</pre>
                <p className={styles.warn}>{artifactPreview.visibility === "private" ? "本体は宛先ごとの鍵で暗号化済みです。宛先変更には作り直しが必要です。" : "本体は端末へ保存済みですが、まだ公開イベントはありません。公開後に複製された原本は完全には回収できません。"}</p>
                <label><input type="checkbox" checked={artifactConfirmed} onChange={(event) => setArtifactConfirmed(event.target.checked)} /> このファイル原本を{artifactPreview.visibility === "private" ? "暗号化配送" : "公開"}の待ち行列へ追加する</label>
                <div className={styles.entryActions}><button type="button" onClick={() => void queueArtifact()} disabled={!artifactConfirmed || registering}>確認して配信待ちへ追加</button></div>
              </div> : null}
              {artifactStatus ? <p className={styles.quiet} role="status">{artifactStatus}</p> : null}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHead}>
                <strong>ノードとして登録</strong>
                <button type="button" onClick={() => void register()} disabled={registering || !node?.keyThumbprint || !node?.hubUrl}>
                  {registering ? "登録中…" : "登録する"}
                </button>
              </div>
              <p className={styles.quiet}>
                {node?.keyThumbprint
                  ? `身元鍵 ${node.keyThumbprint.slice(0, 16)}…（EC P-256）。秘密鍵はこの端末から出ません——署名だけを頼みます。`
                  : "この端末に身元鍵がありません。デスクトップアプリを起動してください。"}
                {node?.keyThumbprint && !node?.hubUrl ? " 公開URLはDesktopのPersonal Node設定で指定します。PC内だけで使う場合は不要です。" : ""}
              </p>
              {registration ? <p className={styles.quiet}>{registration}</p> : null}
              {(node?.queuedItems ?? 0) > 0 ? (
                <div className={styles.entryActions}>
                  <button type="button" onClick={() => void deliver()} disabled={registering}>
                    送っていない{node?.queuedItems}件を流す
                  </button>
                </div>
              ) : null}
            </section>

            <section className={styles.block}>
              <div className={styles.blockHead}>
                <strong>開発を任せる</strong>
                <button type="button" onClick={onDevelop}>開く</button>
              </div>
              <p className={styles.quiet}>
                この端末にログイン済みの Claude と Codex が、選んだフォルダの中で作業します。
              </p>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
