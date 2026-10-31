"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { NativeVideoPlayer } from "@/components/native-video-player";
import { Button } from "@/components/v2/ui/button";
import { V2ContentLicensePicker } from "@/components/v2/v2-content-license-picker";
import { V2ContentDownloadEditor, V2ContentDownloadSetting, applyContentDownloadSetting } from "@/components/v2/v2-content-download";
import type { ContentLicenseId } from "@/lib/content-license";
import { suggestedContentDownloadPolicy, type ContentDownloadPolicy } from "@/lib/content-download-policy";
import {
  declaredMinutes,
  deleteNativeVideo,
  formatBytes,
  formatClock,
  getNativeVideo,
  listNativeVideos,
  NativeVideoClientError,
  pickerLicenseId,
  publishNativeVideo,
  readVideoDurationSeconds,
  sendNativeUpload,
  startNativeUpload,
  unpublishNativeVideo,
  updateNativeVideo,
  videoLicenseId,
  type NativeUploadSession,
  type NativeVideo,
  type NativeVideoQuota,
  type NativeVideoVisibility,
  type UploadProgress,
} from "@/lib/native-video-client";

import { V2TagInput } from "@/components/v2/v2-tag-input";

import "./native-video.css";

/*
 * Upload page and "my videos" for Hub self-made videos (docs/hub-video/PLAN.md 4.2).
 * The browser sends the file straight to the Video Worker; Hub only issues the ticket and
 * keeps the video's rows. Processing is polled through Hub. Nothing is stored in the browser.
 */

const VISIBILITY_LABELS: Record<NativeVideoVisibility, string> = {
  public: "公開",
  unlisted: "限定公開（URLを知っている人）",
  followers: "フォロワーのみ",
  gated: "ゲート付き（トークン保有者）",
};

const STATE_LABELS: Record<NativeVideo["state"], string> = {
  upload_issued: "アップロード待ち",
  processing: "処理中",
  ready: "公開できます",
  published: "公開中",
  unpublished: "非公開",
  rejected: "受け付けられませんでした",
  failed: "処理に失敗しました",
  deleted: "削除済み",
};

const FAILURE_LABELS: Record<string, string> = {
  duration_mismatch: "申告した長さと実際の長さが大きく違いました。",
  upload_size_mismatch: "送ったファイルの大きさが申告と違いました。",
  upload_too_large: "ファイルが大きすぎました。",
  unsupported: "対応していない形式です。",
};

const poll = (state: NativeVideo["state"]) => state === "upload_issued" || state === "processing";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof NativeVideoClientError ? error.message : fallback;
}

export function NativeVideoStudio({ initialVideos, initialQuota }: { initialVideos?: NativeVideo[]; initialQuota?: NativeVideoQuota | null } = {}) {
  const [videos, setVideos] = useState<NativeVideo[]>(initialVideos ?? []);
  const [quota, setQuota] = useState<NativeVideoQuota | null>(initialQuota ?? null);
  const [loaded, setLoaded] = useState(initialVideos !== undefined);
  const [gate, setGate] = useState<"ok" | "login" | "disabled" | "error">("ok");

  const reload = useCallback(async () => {
    try {
      const result = await listNativeVideos();
      setVideos(result.videos);
      setQuota(result.quota);
      setGate("ok");
    } catch (error) {
      if (error instanceof NativeVideoClientError && error.status === 401) setGate("login");
      else if (error instanceof NativeVideoClientError && error.status === 404) setGate("disabled");
      else setGate("error");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (initialVideos === undefined) void reload();
  }, [initialVideos, reload]);

  // Videos still uploading or processing: ask Hub (which asks the Video Worker) every few seconds.
  const waiting = videos.filter((video) => poll(video.state)).map((video) => video.id).join(",");
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    const timer = window.setInterval(async () => {
      for (const id of waiting.split(",")) {
        try {
          const fresh = await getNativeVideo(id);
          if (stopped) return;
          setVideos((current) => current.map((video) => (video.id === fresh.id ? fresh : video)));
          if (!poll(fresh.state)) void reload();
        } catch {
          // A failed poll is not a failed video.
        }
      }
    }, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [waiting, reload]);

  if (gate === "login") {
    return (
      <div className="nv-studio">
        <section className="nv-card">
          <h2 className="nv-card__title">ログインが必要です</h2>
          <p className="nv-note">動画を投稿するにはログインしてください。</p>
          <div className="nv-actions"><Link className="ui-button ui-button--primary" href="/v2/auth"><span className="ui-button__label">ログイン</span></Link></div>
        </section>
      </div>
    );
  }
  if (gate === "disabled") {
    return (
      <div className="nv-studio">
        <section className="nv-card"><p className="nv-note">このHubでは、動画の投稿は使えません。</p></section>
      </div>
    );
  }

  return (
    <div className="nv-studio">
      <QuotaCard quota={quota} loaded={loaded} />
      <UploadCard quota={quota} onUploaded={() => void reload()} />
      <section className="nv-card" aria-labelledby="nv-mine">
        <h2 className="nv-card__title" id="nv-mine">自分の動画</h2>
        {gate === "error" ? <p className="nv-note nv-note--error" role="alert">動画の一覧を読み込めませんでした。<button className="nv-link" type="button" onClick={() => void reload()}>もう一度読み込む</button></p> : null}
        {!loaded ? <p className="nv-note" role="status">読み込み中…</p> : null}
        {loaded && gate === "ok" && videos.length === 0 ? <p className="nv-note">まだ動画がありません。上のフォームから投稿できます。</p> : null}
        <ul className="nv-list">
          {videos.map((video) => (
            <MyVideo key={video.id} video={video} onChanged={(next) => setVideos((current) => current.map((item) => (item.id === next.id ? next : item)))} onRemoved={() => { setVideos((current) => current.filter((item) => item.id !== video.id)); void reload(); }} onReload={() => void reload()} />
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ quota */

function QuotaCard({ quota, loaded }: { quota: NativeVideoQuota | null; loaded: boolean }) {
  if (!quota) {
    return (
      <section className="nv-card" aria-label="アップロードできる時間">
        <p className="nv-note">{loaded ? "プランの残り時間を確かめられませんでした。共通アカウントとの連携が必要です。" : "残り時間を確かめています…"}</p>
      </section>
    );
  }
  const used = Math.min(quota.minutesCap, quota.minutesUsed);
  const percent = quota.minutesCap > 0 ? Math.round((used / quota.minutesCap) * 100) : 100;
  return (
    <section className="nv-card nv-quota" aria-label="アップロードできる時間">
      <div className="nv-quota__head">
        <span>30日間の残り</span>
        <span><span className="nv-quota__number">{quota.minutesRemaining}</span> 分 / {quota.minutesCap} 分</span>
      </div>
      <div className="nv-meter" role="progressbar" aria-valuemin={0} aria-valuemax={quota.minutesCap} aria-valuenow={used} aria-label="30日間に使った時間">
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="nv-note">
        1本あたり {quota.maxMinutesPerVideo} 分まで。ブラウザからの投稿で変換が必要な分は、あと {quota.webMinutesRemaining} 分です。最大 {quota.maxHeight}p で配信します。
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ upload */

type Phase = "idle" | "starting" | "uploading" | "failed" | "waiting";

function UploadCard({ quota, onUploaded }: { quota: NativeVideoQuota | null; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [manualDuration, setManualDuration] = useState("");
  const [readingLength, setReadingLength] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<NativeVideoVisibility>("public");
  const [license, setLicense] = useState<ContentLicenseId>("arr");
  const [ageRestricted, setAgeRestricted] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  // null = untouched: the choice follows the license (CC proposes "anyone", otherwise "none").
  const [downloadChoice, setDownloadChoice] = useState<ContentDownloadPolicy | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const session = useRef<NativeUploadSession | null>(null);

  const gated = visibility === "gated";
  const downloadPolicy = downloadChoice ?? suggestedContentDownloadPolicy(gated ? "arr" : license);
  const effectiveSeconds = seconds ?? parseClock(manualDuration);
  const minutes = effectiveSeconds ? declaredMinutes(effectiveSeconds) : null;
  const busy = phase === "starting" || phase === "uploading";
  const overCap = quota !== null && minutes !== null && minutes > quota.minutesRemaining;
  const overLength = quota !== null && minutes !== null && minutes > quota.maxMinutesPerVideo;
  const canStart = Boolean(file) && title.trim().length > 0 && effectiveSeconds !== null && !busy && phase !== "waiting" && !overCap && !overLength;

  const pick = async (next: File | null) => {
    setFile(next);
    setSeconds(null);
    setManualDuration("");
    setError("");
    setNotice("");
    session.current = null;
    setPhase("idle");
    if (!next) return;
    if (!title.trim()) setTitle(next.name.replace(/\.[^.]+$/u, "").slice(0, 100));
    setReadingLength(true);
    setSeconds(await readVideoDurationSeconds(next));
    setReadingLength(false);
  };

  const run = async () => {
    if (!file || effectiveSeconds === null) return;
    setError("");
    setNotice("");
    let downloadWarning = "";
    try {
      if (!session.current) {
        setPhase("starting");
        session.current = await startNativeUpload({
          file,
          title: title.trim(),
          description: description.trim(),
          visibility,
          license: gated ? "arr" : videoLicenseId(license),
          ageRestricted,
          commentsEnabled,
          durationSeconds: effectiveSeconds,
        });
        if (downloadPolicy !== "none") {
          const applied = await applyContentDownloadSetting("video", session.current.videoId, downloadPolicy);
          if (!applied.ok) downloadWarning = "ダウンロードの設定は保存できませんでした。公開する前に、下の一覧の編集から設定してください。";
        }
      }
      setPhase("uploading");
      await sendNativeUpload(session.current, file, setProgress);
      setPhase("waiting");
      setNotice("アップロードできました。サーバーで確認と変換をしています。終わると下の一覧で公開できます。" + (downloadWarning ? ` ${downloadWarning}` : ""));
      setDownloadChoice(null);
      session.current = null;
      setFile(null);
      setSeconds(null);
      setManualDuration("");
      setTitle("");
      setDescription("");
      setInputKey((value) => value + 1);
      onUploaded();
    } catch (failure) {
      setPhase("failed");
      setError(messageOf(failure, "アップロードできませんでした。"));
      // A start that never produced a session cannot be resumed; a started one can.
      if (failure instanceof NativeVideoClientError && ["upload_token_invalid", "upload_expired"].includes(failure.code)) session.current = null;
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canStart || phase === "failed") void run();
  };

  const percent = progress && progress.totalBytes > 0 ? Math.round((progress.sentBytes / progress.totalBytes) * 100) : 0;

  return (
    <section className="nv-card" aria-labelledby="nv-upload">
      <h2 className="nv-card__title" id="nv-upload">動画を投稿する</h2>
      <form className="nv-form" onSubmit={submit}>
        <label className="nv-drop">
          <input key={inputKey} type="file" accept="video/*" disabled={busy} onChange={(event) => void pick(event.target.files?.[0] ?? null)} />
          {file ? (
            <>
              <strong>{file.name}</strong>
              <span>{formatBytes(file.size)}{readingLength ? "・長さを読み取っています…" : seconds !== null ? `・長さ ${formatClock(seconds)}` : ""}</span>
              <span className="nv-note">押して選び直す</span>
            </>
          ) : (
            <>
              <strong>動画ファイルを選ぶ</strong>
              <span className="nv-note">MP4・MOV・WebMなど。1本60分まで。</span>
            </>
          )}
        </label>

        {file && !readingLength && seconds === null ? (
          <label className="nv-field">
            <span>長さ（分:秒）</span>
            <input type="text" inputMode="numeric" placeholder="例 12:30" value={manualDuration} onChange={(event) => setManualDuration(event.target.value)} />
            <span className="nv-note">ブラウザがこの形式の長さを読めませんでした。実際の長さを入れてください。大きく違うと受け付けられません。</span>
          </label>
        ) : null}
        {minutes !== null ? (
          <p className={`nv-note${overCap || overLength ? " nv-note--error" : ""}`} role={overCap || overLength ? "alert" : undefined}>
            {overLength ? `1本は ${quota?.maxMinutesPerVideo ?? 60} 分までです。` : overCap ? `この動画は ${minutes} 分と数えます。30日間の残り ${quota?.minutesRemaining ?? 0} 分を超えています。` : `この動画は ${minutes} 分と数えます。${quota ? `投稿後の残りは ${Math.max(0, quota.minutesRemaining - minutes)} 分です。` : ""}`}
          </p>
        ) : null}

        <label className="nv-field">
          <span>題名</span>
          <input type="text" maxLength={100} required value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="nv-field">
          <span>説明</span>
          <textarea maxLength={5000} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <div className="nv-row">
          <label className="nv-field">
            <span>公開範囲</span>
            <select value={visibility} disabled={busy} onChange={(event) => { const next = event.target.value as NativeVideoVisibility; setVisibility(next); if (next === "gated") setLicense("arr"); }}>
              {(Object.keys(VISIBILITY_LABELS) as NativeVideoVisibility[]).map((key) => <option key={key} value={key}>{VISIBILITY_LABELS[key]}</option>)}
            </select>
          </label>
          <V2ContentLicensePicker value={license} onChange={setLicense} disabled={busy} gated={gated} />
        </div>
        <V2ContentDownloadSetting value={downloadPolicy} onChange={setDownloadChoice} license={gated ? "arr" : license} target="video" disabled={busy} gated={gated} />
        {gated ? <p className="nv-note">ゲート付きは、公開する前に <Link href="/v2/creator/gates">閲覧条件の画面</Link> でゲートを付けます。</p> : null}
        <div className="nv-row">
          <label className="nv-check"><input type="checkbox" checked={ageRestricted} disabled={busy} onChange={(event) => setAgeRestricted(event.target.checked)} />年齢制限（成人向け表示を有効にした人だけ再生）</label>
          <label className="nv-check"><input type="checkbox" checked={commentsEnabled} disabled={busy} onChange={(event) => setCommentsEnabled(event.target.checked)} />コメントを受け付ける</label>
        </div>
        <p className="nv-note">自分が権利を持つ動画だけを投稿してください。投稿した動画は、権利者からの通知で非公開になることがあります。</p>

        {busy && progress ? (
          <div className="nv-progress" role="status" aria-live="polite">
            <div className="nv-progress__line">
              <span>{phase === "starting" ? "準備しています…" : progress.stage === "finishing" ? "仕上げています…" : `送信中 ${progress.part} / ${progress.partCount}`}</span>
              <span>{percent}% ・ {formatBytes(progress.sentBytes)} / {formatBytes(progress.totalBytes)}</span>
            </div>
            <div className="nv-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="送信の進み具合"><span style={{ width: `${percent}%` }} /></div>
            {progress.retry > 0 ? <p className="nv-note nv-note--warn">通信が不安定なため、もう一度送っています（{progress.retry}回目）。</p> : null}
          </div>
        ) : null}
        {error ? <p className="nv-note nv-note--error" role="alert">{error}</p> : null}
        {notice ? <p className="nv-note" role="status">{notice}</p> : null}

        <div className="nv-actions">
          {phase === "failed" && session.current ? (
            <Button variant="primary" label="続きから再開する" type="submit" />
          ) : (
            <Button variant="primary" label={busy ? "送信中…" : "アップロード"} type="submit" busy={busy} disabled={!canStart} />
          )}
        </div>
      </form>
    </section>
  );
}

function parseClock(text: string): number | null {
  const match = /^\s*(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s*$/u.exec(text);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return total > 0 ? total : null;
}

/* ------------------------------------------------------------------ my videos */

function MyVideo({ video, onChanged, onRemoved, onReload }: {
  video: NativeVideo;
  onChanged: (video: NativeVideo) => void;
  onRemoved: () => void;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [visibility, setVisibility] = useState(video.visibility);
  const [ageRestricted, setAgeRestricted] = useState(video.ageRestricted);
  const [commentsEnabled, setCommentsEnabled] = useState(video.commentsEnabled);
  const [tags, setTags] = useState<string[]>(video.tags ?? []);

  const act = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(messageOf(error, fallback));
      onReload();
    } finally {
      setBusy(false);
    }
  };

  const canPublish = (video.state === "ready" || video.state === "unpublished") && !video.held
    && video.reviewStatus !== "pending" && video.reviewStatus !== "rejected";
  const tone = poll(video.state) ? "processing" : video.state;

  return (
    <li className="nv-item" data-video-state={video.state}>
      <div className={`nv-item__cover${video.kind === "short" || (video.height && video.width && video.height > video.width) ? " nv-item__cover--tall" : ""}`} aria-hidden="true">
        {video.state === "upload_issued" ? "アップロード待ち" : video.state === "processing" ? "処理中…" : video.title}
      </div>
      <div className="nv-item__body">
        <h3 className="nv-item__title">{video.title}</h3>
        <div className="nv-item__meta">
          <span className={`nv-status nv-status--${tone}`}>{video.held ? "確認中" : video.reviewStatus === "pending" ? "審査待ち" : video.reviewStatus === "rejected" ? "公開不可" : STATE_LABELS[video.state]}</span>
          <span>{VISIBILITY_LABELS[video.visibility].split("（")[0]}</span>
          {video.durationMs ? <span>{formatClock(video.durationMs / 1000)}</span> : null}
          {video.ageRestricted ? <span>年齢制限</span> : null}
          {video.shortEligible ? <span>ショート向き</span> : null}
          {video.storedBytes ? <span>{formatBytes(video.storedBytes)}</span> : null}
        </div>
        {video.failure ? <p className="nv-note nv-note--error">{FAILURE_LABELS[video.failure] ?? "処理できませんでした。別のファイルでやり直してください。"}</p> : null}
        {/* まだ届いていない動画に「変換しています」とは書かない（2026-10-18）。 */}
        {video.state === "upload_issued" ? <p className="nv-note" role="status">ファイルがまだ届いていません。送信が止まったときは、もう一度アップロードしてください。</p> : null}
        {video.state === "processing" ? <p className="nv-note" role="status">サーバーで確認と変換をしています。このページを開いたままでも、閉じても続きます。</p> : null}
        {message ? <p className="nv-note nv-note--error" role="alert">{message}</p> : null}

        {previewing ? <NativeVideoPlayer videoId={video.id} title={video.title} preview owner="hub-video-studio-preview" compact /> : null}
        <div className="nv-actions">
          {(video.state === "ready" || video.state === "unpublished") && !video.held ? <Button variant="plain" label={previewing ? "下見を閉じる" : "下見"} pressed={previewing} onClick={() => setPreviewing((value) => !value)} /> : null}
          {video.state === "published" ? <Link className="ui-button ui-button--secondary" href={`/v2/videos/${video.id}`}><span className="ui-button__label">見る</span></Link> : null}
          {canPublish ? <Button variant="primary" label="公開する" busy={busy} onClick={() => void act(async () => onChanged(await publishNativeVideo(video.id)), "公開できませんでした。")} /> : null}
          {video.state === "published" ? <Button label="非公開にする" busy={busy} onClick={() => void act(async () => { await unpublishNativeVideo(video.id); onChanged({ ...video, state: "unpublished" }); onReload(); }, "非公開にできませんでした。")} /> : null}
          {!poll(video.state) && video.state !== "rejected" && video.state !== "failed" ? <Button variant="plain" label={editing ? "編集を閉じる" : "編集"} pressed={editing} onClick={() => setEditing((value) => !value)} /> : null}
          {confirming ? (
            <>
              <Button variant="primary" label="削除する" busy={busy} onClick={() => void act(async () => { await deleteNativeVideo(video.id); onRemoved(); }, "削除できませんでした。")} />
              <Button variant="plain" label="やめる" onClick={() => setConfirming(false)} />
            </>
          ) : (
            <Button variant="plain" label="削除" onClick={() => setConfirming(true)} />
          )}
        </div>
        {confirming ? <p className="nv-note nv-note--warn">削除すると元に戻せません。動画のデータも消え、保存容量が戻ります。</p> : null}
        {video.visibility === "gated" && canPublish ? <p className="nv-note">ゲート付きの動画は、<Link href="/v2/creator/gates">閲覧条件の画面</Link>でゲートを付けてから公開できます。</p> : null}

        {editing ? (
          <form
            className="nv-edit"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                onChanged(await updateNativeVideo(video.id, { title: title.trim(), description: description.trim(), visibility, ageRestricted, commentsEnabled, tags }));
                setEditing(false);
              }, "変更を保存できませんでした。");
            }}
          >
            <label className="nv-field"><span>題名</span><input type="text" maxLength={100} required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="nv-field"><span>説明</span><textarea maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="nv-field"><V2TagInput value={tags} onChange={setTags} /></div>
            <label className="nv-field">
              <span>公開範囲</span>
              <select value={visibility} onChange={(event) => setVisibility(event.target.value as NativeVideoVisibility)}>
                {(Object.keys(VISIBILITY_LABELS) as NativeVideoVisibility[]).map((key) => <option key={key} value={key}>{VISIBILITY_LABELS[key]}</option>)}
              </select>
            </label>
            <label className="nv-check"><input type="checkbox" checked={ageRestricted} onChange={(event) => setAgeRestricted(event.target.checked)} />年齢制限</label>
            <label className="nv-check"><input type="checkbox" checked={commentsEnabled} onChange={(event) => setCommentsEnabled(event.target.checked)} />コメントを受け付ける</label>
            {video.state === "published" ? <p className="nv-note">公開範囲を狭めると、見ている人の再生は1分ほどで止まります。</p> : null}
            <div className="nv-actions"><Button variant="primary" type="submit" label="保存する" busy={busy} /></div>
          </form>
        ) : null}
        {editing ? <V2ContentDownloadEditor targetType="video" targetId={video.id} license={pickerLicenseId(video.license)} gated={visibility === "gated"} /> : null}
      </div>
    </li>
  );
}
