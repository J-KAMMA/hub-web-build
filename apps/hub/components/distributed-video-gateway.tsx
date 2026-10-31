"use client";

import { useState, type FormEvent } from "react";
import type { PublicDistributedVideo } from "@/lib/server/distributed-videos";

const cacheLabels = { denied: "キャッシュ不可", temporary: "一時キャッシュ可", allowed: "ミラー可" } as const;
const aiLabels = { denied: "AI学習不可", allowed: "AI学習可", attribution: "表示付きでAI学習可", "consent-required": "AI学習は個別許可" } as const;

export function DistributedVideoGateway({ initialVideos, authenticated }: { initialVideos: PublicDistributedVideo[]; authenticated: boolean }) {
  const [videos, setVideos] = useState(initialVideos);
  const [manifestUrl, setManifestUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/videos/distributed", { method:"POST", credentials:"same-origin", headers:{ "content-type":"application/json" }, body:JSON.stringify({ manifestUrl }) });
      const payload = await response.json() as { video?:PublicDistributedVideo;error?:string };
      if (!response.ok || !payload.video) throw new Error(payload.error ?? "登録できませんでした。");
      setVideos((current)=>[payload.video!,...current]); setManifestUrl(""); setMessage("分散動画ノードを登録しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "登録できませんでした。"); }
    finally { setBusy(false); }
  }

  return <section className="settings-card video-federation" aria-labelledby="distributed-video-heading">
    <div className="settings-section-heading">
      <div><h2 id="distributed-video-heading">分散動画</h2><p>動画は配信元が所有し、Hubは検索・推薦・再生入口を提供します。</p></div>
      <a className="text-link" href="/api/videos/index-export">公開インデックス</a>
    </div>
    {authenticated ? <form className="settings-inline-form" onSubmit={submit}>
      <label className="field-label" htmlFor="distributed-manifest-url">動画マニフェストURL</label>
      <div className="settings-inline-controls"><input id="distributed-manifest-url" type="url" value={manifestUrl} onChange={(event)=>setManifestUrl(event.target.value)} placeholder="https://creator.example/videos/123/manifest.json" required /><button className="primary-button" type="submit" disabled={busy}>{busy?"確認中":"ノードを追加"}</button></div>
      {message ? <p role="status" className="form-message">{message}</p> : null}
    </form> : null}
    {videos.length ? <div className="video-federation-grid">{videos.slice(0,6).map((video)=><article className="video-federation-card" key={video.id}>
      {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" /> : null}
      <div><span className="video-provider">分散ノード</span><h3><a href={video.videoId}>{video.title}</a></h3><p>{video.channel} · {new URL(video.origin).hostname}</p><div className="video-federation-policies"><span>{cacheLabels[video.cachePolicy]}</span><span>{aiLabels[video.aiTraining]}</span><span>{video.license}</span></div></div>
    </article>)}</div> : <p className="empty-state">登録済みの分散動画はまだありません。</p>}
  </section>;
}
