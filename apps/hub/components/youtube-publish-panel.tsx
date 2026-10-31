"use client";

import { useEffect, useState } from "react";
import {
  commitYouTubePublish,
  disconnectSocialProvider,
  getSocialConnections,
  prepareYouTubePublish,
  reconcileYouTubePublish,
  startSocialOAuth,
  uploadYouTubeChunk,
  type YouTubePreview,
  type YouTubeUploadProgress,
} from "@/lib/social-publisher-client";

const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_VIDEO_SIZE = 256 * 1024 * 1024 * 1024;
const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function videoChunkDigests(file: File, onProgress: (value: number) => void) {
  const digests: string[] = [];
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    digests.push(await sha256Hex(file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size))));
    onProgress(Math.min(1, (offset + CHUNK_SIZE) / file.size));
  }
  return digests;
}

async function createHubVideoPost(body: string, audience: "public" | "followers", requestId: string) {
  const response = await fetch("/api/social/posts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, identity_mode: "account", image_ids: [], audience, scheduled_at: null, client_request_id: requestId }),
  });
  if (!response.ok) throw new Error("YouTubeへの投稿は完了しましたが、Hubポストを作成できませんでした。");
}

export function YouTubePublishPanel({ authenticated }: { authenticated: boolean }) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [publishHub, setPublishHub] = useState(false);
  const [hubAudience, setHubAudience] = useState<"public" | "followers">("public");
  const [preview, setPreview] = useState<YouTubePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pendingHubPost, setPendingHubPost] = useState<{ body: string; audience: "public" | "followers"; requestId: string } | null>(null);
  const [hubFinalConfirmed, setHubFinalConfirmed] = useState(false);
  const [youtubeAccepted, setYouTubeAccepted] = useState(false);

  const invalidate = () => { setPreview(null); setConfirmed(false); setYouTubeAccepted(false); setStatus(""); setError(""); setProgress(0); setRequestId(crypto.randomUUID()); };

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    setChecking(true);
    getSocialConnections().then((items) => { if (active) setConnected(items.some((item) => item.provider === "youtube")); })
      .catch(() => { if (active) setConnected(false); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [authenticated]);

  async function buildPreview() {
    if (!file || busy) return;
    if (!ACCEPTED_VIDEO_TYPES.has(file.type)) { setError("MP4、WebM、QuickTimeの動画を選択してください。"); return; }
    if (file.size <= 0 || file.size > MAX_VIDEO_SIZE) { setError("動画は256GB以下にしてください。"); return; }
    if (!title.trim()) { setError("YouTubeのタイトルを入力してください。"); return; }
    if (publishHub && privacy === "private") { setError("非公開動画はHubへ同時投稿できません。限定公開または公開を選ぶか、Hub同時投稿をオフにしてください。"); return; }
    setBusy(true); setError(""); setStatus("動画を読み取り、送信内容を固定しています…"); setProgress(0);
    try {
      const chunkSha256 = await videoChunkDigests(file, setProgress);
      const hubBody = publishHub ? `${title.trim()}\n\n（YouTubeへのアップロード完了後、この位置に動画URLを追加します）` : null;
      const created = await prepareYouTubePublish(requestId, {
        title: title.trim(), description, privacyStatus: privacy, fileName: file.name,
        videoSize: file.size, contentType: file.type, chunkSize: CHUNK_SIZE, chunkSha256,
        hubPost: hubBody ? { audience: hubAudience, body: hubBody } : null,
      });
      setPreview(created);
      setStatus("プレビューを作成しました。送信先・公開範囲・本文を確認してください。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "YouTube投稿のプレビューを作成できませんでした。");
    } finally { setBusy(false); }
  }

  async function uploadFromOffset(initial: YouTubeUploadProgress) {
    if (!file || !preview) throw new Error("確定した動画ファイルがありません。");
    let current = initial;
    while (current.status !== "succeeded" && current.nextOffset < file.size) {
      const start = current.nextOffset;
      const chunk = file.slice(start, Math.min(start + preview.rendered.chunkSize, file.size), file.type);
      try {
        current = await uploadYouTubeChunk(preview.previewId, chunk, start, file.size);
      } catch (cause) {
        if (!(cause instanceof Error) || !(cause as Error & { reconciliationRequired?: boolean }).reconciliationRequired) throw cause;
        current = await reconcileYouTubePublish(preview.previewId);
      }
      setProgress(current.nextOffset / file.size);
    }
    return current;
  }

  async function publish() {
    if (!preview || !file || !confirmed || busy) return;
    setBusy(true); setError(""); setStatus("YouTubeへ再開可能アップロードを開始しています…");
    try {
      const started = await commitYouTubePublish(preview.previewId);
      const result = await uploadFromOffset(started);
      if (result.status !== "succeeded" || !result.externalUrl) throw new Error("YouTubeの確定結果を確認できませんでした。自動再送は行いません。");
      setYouTubeAccepted(true);
      const hubPost = preview.rendered.hubPost;
      if (hubPost) {
        const exactBody = hubPost.body.replace("（YouTubeへのアップロード完了後、この位置に動画URLを追加します）", result.externalUrl);
        const hubRequestId = crypto.randomUUID();
        setPendingHubPost({ body: exactBody, audience: hubPost.audience, requestId: hubRequestId });
        setHubFinalConfirmed(false);
        setStatus("YouTubeが動画を受け付けました。処理中の可能性があります。実際の動画URLを含むHub本文を確認して、Hub投稿を確定してください。");
      } else {
        setStatus("YouTubeが動画を受け付けました。YouTube側では処理中の可能性があります。");
      }
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "YouTubeへの動画投稿を完了できませんでした。");
    } finally { setBusy(false); }
  }

  if (!authenticated) return <section className="youtube-publish" aria-labelledby="youtube-publish-title"><div><small>PUBLISH A VIDEO</small><h2 id="youtube-publish-title">HubからYouTubeへ投稿</h2><p><a href="/auth?next=%2Fvideos">ログイン</a>すると利用できます。</p></div></section>;

  return <section className="youtube-publish" aria-labelledby="youtube-publish-title">
    <header><div><small>PUBLISH A VIDEO</small><h2 id="youtube-publish-title">HubからYouTubeへ投稿</h2></div><p>自分のYouTube認証を使います。動画やトークンはHubへ保存しません。</p></header>
    {!connected ? <div className="youtube-publish__connect">
      <p>{checking ? "YouTube接続を確認中…" : "最初に投稿先のYouTubeチャンネルを接続します。"}</p>
      <button type="button" disabled={checking} onClick={() => { setError(""); void startSocialOAuth("youtube").catch((cause) => setError(cause instanceof Error ? cause.message : "YouTubeへ接続できませんでした。")); }}>YouTubeを接続</button>
    </div> : <>
      <div className="youtube-publish__connection"><strong>YouTube接続済み</strong><button type="button" disabled={busy} onClick={() => { void disconnectSocialProvider("youtube").then(() => { setConnected(false); invalidate(); }).catch((cause) => setError(cause instanceof Error ? cause.message : "接続を解除できませんでした。")); }}>接続を解除</button></div>
      <div className="youtube-publish__form">
        <label><span>動画ファイル</span><input type="file" accept="video/mp4,video/webm,video/quicktime" disabled={busy || Boolean(preview)} onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); invalidate(); }} /></label>
        <label><span>YouTubeタイトル</span><input value={title} maxLength={100} disabled={busy || Boolean(preview)} onChange={(event) => { setTitle(event.target.value); invalidate(); }} /></label>
        <label className="youtube-publish__wide"><span>説明</span><textarea value={description} maxLength={5000} disabled={busy || Boolean(preview)} onChange={(event) => { setDescription(event.target.value); invalidate(); }} /></label>
        <label><span>YouTube公開範囲</span><select value={privacy} disabled={busy || Boolean(preview)} onChange={(event) => { setPrivacy(event.target.value === "public" ? "public" : event.target.value === "unlisted" ? "unlisted" : "private"); invalidate(); }}><option value="private">非公開</option><option value="unlisted">限定公開</option><option value="public">公開</option></select></label>
        <label className="youtube-publish__check"><input type="checkbox" checked={publishHub} disabled={busy || Boolean(preview)} onChange={(event) => { setPublishHub(event.target.checked); invalidate(); }} /><span>完了後、動画URLをHubにも投稿する</span></label>
        {publishHub ? <label><span>Hub公開範囲</span><select value={hubAudience} disabled={busy || Boolean(preview)} onChange={(event) => { setHubAudience(event.target.value === "followers" ? "followers" : "public"); invalidate(); }}><option value="public">全員</option><option value="followers">フォロワー</option></select></label> : null}
      </div>
      {!preview ? <button type="button" className="youtube-publish__primary" disabled={busy || !file || !title.trim()} onClick={() => void buildPreview()}>{busy ? "プレビュー作成中…" : "送信内容を確認"}</button> : <div className="youtube-publish__preview">
        <strong>確定プレビュー</strong>
        <dl><div><dt>送信先</dt><dd>YouTube{preview.rendered.hubPost ? " + Hub" : ""}</dd></div><div><dt>ファイル</dt><dd>{preview.rendered.fileName}（{(preview.rendered.videoSize / 1024 / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} MiB）</dd></div><div><dt>YouTube</dt><dd>{preview.rendered.title}・{preview.rendered.privacyStatus === "public" ? "公開" : preview.rendered.privacyStatus === "unlisted" ? "限定公開" : "非公開"}</dd></div>{preview.rendered.hubPost ? <div><dt>Hub本文</dt><dd>{preview.rendered.hubPost.body}</dd></div> : null}</dl>
        <label className="youtube-publish__check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>送信先、公開範囲、ファイル、本文を確認しました</span></label>
        <div className="youtube-publish__actions"><button type="button" disabled={busy} onClick={() => invalidate()}>編集へ戻る</button><button type="button" className="youtube-publish__primary" disabled={busy || !confirmed || youtubeAccepted} onClick={() => void publish()}>{youtubeAccepted ? "YouTube受付済み" : busy ? "送信中…" : preview.rendered.hubPost ? "YouTubeへ投稿（Hubは次に確認）" : "YouTubeへ投稿"}</button></div>
      </div>}
      {busy || progress > 0 ? <div className="youtube-publish__progress" role="status"><progress max={1} value={progress} /><span>{Math.floor(progress * 100)}%</span></div> : null}
      {pendingHubPost ? <div className="youtube-publish__preview youtube-publish__hub-confirm">
        <strong>Hubへ送る最終本文</strong>
        <p>{pendingHubPost.body}</p>
        <small>公開範囲: {pendingHubPost.audience === "public" ? "全員" : "フォロワー"}</small>
        <label className="youtube-publish__check"><input type="checkbox" checked={hubFinalConfirmed} disabled={busy} onChange={(event) => setHubFinalConfirmed(event.target.checked)} /><span>実際のYouTube URLを含む本文と公開範囲を確認しました</span></label>
        <button type="button" className="youtube-publish__primary" disabled={busy || !hubFinalConfirmed} onClick={() => { setBusy(true); void createHubVideoPost(pendingHubPost.body, pendingHubPost.audience, pendingHubPost.requestId).then(() => { setPendingHubPost(null); setHubFinalConfirmed(false); setStatus("既存のYouTube動画をHubへ投稿しました。"); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Hub投稿を再試行できませんでした。")).finally(() => setBusy(false)); }}>この本文でHubへ投稿</button>
      </div> : null}
    </>}
    {error ? <p className="youtube-publish__error" role="alert">{error}</p> : null}
    {status ? <p className="youtube-publish__status" role="status">{status}</p> : null}
    <p className="youtube-publish__notice">外部書き込みが有効になるまでは実送信されません。未審査のYouTube APIプロジェクトでは公開指定でも非公開に制限される場合があります。</p>
  </section>;
}
