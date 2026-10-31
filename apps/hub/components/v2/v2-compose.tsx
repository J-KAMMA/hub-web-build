"use client";

import { hubApiErrorMessage } from "@/lib/platform/api-error";

import { useEffect, useRef, useState } from "react";

import { Avatar, Button, MediaFrame } from "@/components/v2/ui";
import { V2Button } from "@/components/v2/v2-button";
import { useV2Mentions, V2MentionList } from "@/components/v2/v2-mentions";
import { recordPersonalNodeEventOnce } from "@/lib/personal-node-local-keystore";
import type { PostPageTimelinePost } from "@/lib/server/post-page-data";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { V2AccessGateAttachToggle } from "@/components/v2/v2-access-gate-attach";
import { applyAccessGate } from "@/components/v2/v2-access-gate-shared";
import { V2ContentLicensePicker, applyContentLicense } from "@/components/v2/v2-content-license-picker";
import { V2ContentDownloadSetting, applyContentDownloadSetting } from "@/components/v2/v2-content-download";
import { suggestedContentDownloadPolicy, type ContentDownloadPolicy } from "@/lib/content-download-policy";
import type { ContentLicenseId } from "@/lib/content-license";
import { IMAGE_LIMIT, imageErrorMessage, prepareImage, uploadPickedImages, type PickedImage } from "@/components/v2/v2-image-prepare";
import { appendContentShare, contentShareHref, contentShareReference } from '@/lib/content-share';

/*
 * 投稿を書く欄。フィードの先頭に置く。既存の timeline-client.tsx の投稿欄
 * （3,384行の一部）から機能だけを抜いた。
 *
 * 落とさなかったもの:
 *   - 下書きは localStorage の同じ鍵（hub.post-draft.{profile}）。v1で書きかけた
 *     本文がv2にも出る。v1は素の文字列で保存するので、ここも同じ形で保存する
 *   - 二重送信の防止。同じ本文には同じ client_request_id を使う
 *   - 送る前に端末側の記録（recordPersonalNodeEventOnce）
 *   - Ctrl+Enter で送る
 *   - 画像4枚まで（代替テキスト付き）。既存と同じく、縮小版は端末で作って
 *     POST /api/media/images（image / thumbnail / width / height / altText …）へ
 *   - 公開範囲（全員 / フォロワー）。audience として送る
 *   - ナビの「投稿する」（/v2#compose）で来たら、この欄に焦点を置く
 *   - 予約投稿（本文のみ）。scheduled_at を付けると /api/social/posts が
 *     予約として受け取り、{ post } ではなく { scheduled } を返す
 *
 * まだ無いもの: クロスポスト、メンション補完、切り抜き比率。
 */

type Submission =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string }
  | { status: "done"; message: string };

type ComposeProps = {
  viewerId: string; viewerName: string; viewerAvatarUrl?: string; japanese: boolean;
  onCreated: (post: PostPageTimelinePost) => void; shareHref?: string;
};
export function V2Compose(props: ComposeProps) {
  return <V2ComposeForViewer key={props.viewerId} {...props} />;
}
function V2ComposeForViewer({
  viewerId,
  viewerName,
  viewerAvatarUrl,
  japanese,
  onCreated,
  shareHref,
}: ComposeProps) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [audience, setAudience] = useState<"public" | "followers">("public");
  const [accessGateId, setAccessGateId] = useState<string | null>(null);
  /* 画像つきの投稿だけライセンスを選べる。既定は全権利留保。閲覧条件が付くと全権利留保に戻す。 */
  const [license, setLicense] = useState<ContentLicenseId>("arr");
  useEffect(() => { if (accessGateId) setLicense("arr"); }, [accessGateId]);
  /* ダウンロードの許可。作者が選ぶまではライセンスに合わせる（CCなら「誰でも」）。 */
  const [downloadPolicy, setDownloadPolicy] = useState<ContentDownloadPolicy>("none");
  const [downloadTouched, setDownloadTouched] = useState(false);
  useEffect(() => { if (!downloadTouched) setDownloadPolicy(suggestedContentDownloadPolicy(license)); }, [license, downloadTouched]);
  /* 予約日時。datetime-local の値（"YYYY-MM-DDTHH:mm"、端末の地域時刻）。
     行を閉じると消えるので、scheduledAt が入っている間は行も開いている。 */
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState(false);
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const inFlight = useRef(false);
  const attempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const resize = () => {
      /* 最小の高さはCSS（閉じて1行・開いて3行弱）が持つ。 */
      field.style.height = "auto";
      const least = Number.parseFloat(getComputedStyle(field).minHeight) || 40;
      field.style.height = `${Math.min(320, Math.max(least, field.scrollHeight))}px`;
    };
    resize(); window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [body, focused, images.length, scheduleOpen]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const draftKey = `hub.post-draft.${viewerId || "guest"}`;
  const metadataKey = `${draftKey}.v2-metadata`;
  const fingerprint = JSON.stringify([body.trim(), audience, scheduledAt, images.map((image) => [image.key, image.altText])]);
  const mentions = useV2Mentions(body, setBody, input);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement | null>(null);
  const scope = useRef<object | null>(null), imageRef = useRef(images);
  imageRef.current = images;
  useEffect(() => {
    const token = {}; scope.current = token;
    return () => { if (scope.current === token) scope.current = null; imageRef.current.forEach(image => URL.revokeObjectURL(image.previewUrl)); };
  }, []);
  const reference = contentShareReference(shareHref);
  const [usedReference, setUsedReference] = useState('');
  function addReference() {
    if (!viewerId || !ready || inFlight.current || !scope.current || !reference) return;
    try {
      setBody(appendContentShare(body, reference.href, window.location.origin));
      setUsedReference(reference.href); input.current?.focus();
    } catch {
      setSubmission({ status: 'failed', message: japanese ? '紹介リンクを含めると本文が上限を超えます。草稿を短くしてから追加してください。' : 'The link exceeds the post limit. Shorten the draft before adding it.' });
    }
  }

  /* ＋の一覧は外を押すか Esc で閉じる。 */
  useEffect(() => {
    if (!plusOpen) return;
    const onPointer = (event: MouseEvent) => { if (!plusRef.current?.contains(event.target as Node)) setPlusOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPlusOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [plusOpen]);

  /* 書いている場所に文字を差し込み、続きを打てるように焦点を戻す。 */
  const insertAtCaret = (text: string) => {
    setPlusOpen(false);
    const element = input.current;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const lead = before.length && !/\s$/.test(before) ? " " : "";
    const next = `${before}${lead}${text}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const caret = start + lead.length + text.length;
      element.setSelectionRange(caret, caret);
    });
  };

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setBody(saved);
      const rawMetadata = window.localStorage.getItem(metadataKey);
      const metadata = rawMetadata ? JSON.parse(rawMetadata) : null;
      if (typeof saved === "string" && metadata?.version === 1 && metadata.body === saved) {
        const restoredAudience = metadata.audience === "followers" ? "followers" : "public";
        setAudience(restoredAudience);
        const restoredScheduledAt = typeof metadata.scheduledAt === "string" ? metadata.scheduledAt : "";
        setScheduledAt(restoredScheduledAt);
        if (restoredScheduledAt) setScheduleOpen(true);
        const restoredFingerprint = JSON.stringify([saved.trim(), restoredAudience, restoredScheduledAt, []]);
        if (metadata.attempt?.fingerprint === restoredFingerprint
          && typeof metadata.attempt.requestId === "string"
          && /^[0-9a-f-]{36}$/i.test(metadata.attempt.requestId)) {
          attempt.current = metadata.attempt;
        }
      }
    } catch {
      /* 保存できない環境でも投稿はできる。 */
    } finally {
      setReady(true);
    }
    if (window.location.hash === "#compose") input.current?.focus();
    const onHash = () => { if (window.location.hash === "#compose") input.current?.focus(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [draftKey, metadataKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (body.trim()) {
        window.localStorage.setItem(draftKey, body);
        window.localStorage.setItem(metadataKey, JSON.stringify({ version: 1, body, audience, scheduledAt,
          attempt: attempt.current?.fingerprint === fingerprint ? attempt.current : null }));
      } else {
        window.localStorage.removeItem(draftKey);
        window.localStorage.removeItem(metadataKey);
      }
    } catch {
      /* 保存できない環境でも投稿はできる。 */
    }
  }, [body, audience, scheduledAt, fingerprint, draftKey, metadataKey, ready]);

  const pickImages = async (files: FileList | null) => {
    /* 予約投稿は本文だけ。API も画像つきの予約を 400 で弾く。 */
    if (!files?.length || scheduledAt) return;
    const token = scope.current;
    if (!token) return;
    const room = IMAGE_LIMIT - images.length;
    const chosen = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!chosen.length) return;
    try {
      const prepared = await Promise.all(chosen.map(prepareImage));
      if (scope.current !== token) { prepared.forEach(image => URL.revokeObjectURL(image.previewUrl)); return; }
      setImages((current) => {
        const known = new Set(current.map((item) => item.key));
        return [...current, ...prepared.filter((item) => !known.has(item.key))].slice(0, IMAGE_LIMIT);
      });
      setSubmission({ status: "idle" });
    } catch (caught) {
      setSubmission({ status: "failed", message: imageErrorMessage(caught, japanese) });
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const dropImage = (key: string) => {
    setImages((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };

  const submit = async () => {
    const token = scope.current, active = () => scope.current === token;
    if (!viewerId || !token) return;
    const normalized = body.trim();
    if ((!normalized && !images.length) || inFlight.current) return;
    /* 繋がっていないときは送らない。下書きは残るので、戻ってから送り直せる。 */
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSubmission({ status: "failed", message: japanese ? "オフラインです。繋がってから送ってください。下書きは残っています。" : "You are offline. The draft is kept; send it once you are back online." });
      return;
    }
    if (normalized.length > HUB_SOCIAL_POST_MAX_CHARACTERS) {
      setSubmission({ status: "failed", message: japanese ? `本文は${HUB_SOCIAL_POST_MAX_CHARACTERS}文字までです。` : `Posts are limited to ${HUB_SOCIAL_POST_MAX_CHARACTERS} characters.` });
      return;
    }
    if (scheduledAt && images.length) {
      setSubmission({ status: "failed", message: japanese
        ? "予約投稿は本文のみ対応しています。画像を削除するか、予約日時を解除してください。"
        : "Scheduled posts support text only. Remove the images or clear the scheduled time." });
      return;
    }
    /* API は Date が解釈できて 60 秒以上先の予約だけを受け付ける。 */
    const scheduledTime = scheduledAt ? new Date(scheduledAt).getTime() : 0;
    if (scheduledAt && (!Number.isFinite(scheduledTime) || scheduledTime < Date.now() + 60_000)) {
      setSubmission({ status: "failed", message: japanese
        ? "予約日時は1分後以降を指定してください。"
        : "Pick a time at least a minute from now." });
      return;
    }
    const current = attempt.current?.fingerprint === fingerprint && attempt.current
      ? attempt.current
      : { fingerprint, requestId: crypto.randomUUID() };
    attempt.current = current;
    try {
      window.localStorage.setItem(draftKey, body);
      window.localStorage.setItem(metadataKey, JSON.stringify({ version: 1, body, audience, scheduledAt, attempt: current }));
    } catch {
      /* Storage may be unavailable; the current page still retains the retry key. */
    }

    inFlight.current = true;
    setSubmission({ status: "submitting" });
    try {
      let imageIds: string[] = [];
      try {
        imageIds = await uploadPickedImages(images, japanese, undefined, { expectedViewer: viewerId, isCurrent: active });
      } catch (caught) {
        if (!active()) return;
        setSubmission({ status: "failed", message: caught instanceof Error && caught.message === 'image_scope_changed' ? (japanese ? 'ログイン状態が変わりました。草稿を開き直してから送信してください。' : 'The signed-in profile changed. Reopen the draft before sending.') : caught instanceof Error && caught.message ? caught.message : (japanese ? "画像を送れませんでした。" : "Could not upload the image.") });
        return;
      }
      if (!active()) return;
      /* 予約はまだ投稿していないので、端末側の記録（hub.post.create）は付けない。 */
      if (!scheduledAt) {
        await recordPersonalNodeEventOnce("hub.post.create", current.requestId, {
          canonicalPostId: `urn:uuid:${current.requestId}`,
          body: normalized,
          audience,
          imageIds,
        });
      }
      if (!active()) return;
      const response = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "content-type": "application/json", 'X-Hub-Expected-Viewer': viewerId },
        body: JSON.stringify({
          body: normalized,
          identity_mode: "account",
          image_ids: imageIds,
          audience,
          scheduled_at: scheduledAt ? new Date(scheduledTime).toISOString() : null,
          client_request_id: current.requestId,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: unknown;
        post?: PostPageTimelinePost;
        scheduled?: { id: string; scheduledAt: string; status: string };
      } | null;
      if (!active()) return;
      if (!response.ok || (!payload?.post && !payload?.scheduled)) {
        setSubmission({ status: "failed", message: hubApiErrorMessage(payload?.error, japanese
          ? (scheduledAt ? "予約投稿を保存できませんでした。" : "投稿できませんでした。")
          : (scheduledAt ? "Could not schedule the post." : "Could not post.")) });
        return;
      }
      attempt.current = null;
      /* 閲覧条件は投稿が保存できたあとに付ける。付けられなくても投稿は残る。 */
      if (payload.post && accessGateId) void applyAccessGate("post", payload.post.id, accessGateId);
      /* ライセンスは画像があるときだけ。付けられなくても投稿は残るので、あとで気付けるよう知らせる。 */
      let licenseFailure = "";
      if (payload.post && images.length && !accessGateId && license !== "arr") {
        const applied = await applyContentLicense("post", payload.post.id, license);
        if (!applied.ok) licenseFailure = applied.message;
      }
      /* ダウンロードの許可。保存しなければ「させない」のまま（行が無ければ none）。 */
      if (payload.post && (images.length || accessGateId) && downloadPolicy !== "none") {
        const applied = await applyContentDownloadSetting("post", payload.post.id, downloadPolicy);
        if (!applied.ok && !licenseFailure) licenseFailure = applied.message;
      }
      setAccessGateId(null);
      setLicense("arr");
      setDownloadTouched(false);
      try {
        window.localStorage.removeItem(draftKey);
        window.localStorage.removeItem(metadataKey);
      } catch {
        /* 送れたあとの下書きは次の入力で消える。 */
      }
      images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setImages([]);
      setBody("");
      setScheduledAt("");
      setScheduleOpen(false);
      if (payload.post) {
        setSubmission(licenseFailure
          ? { status: "failed", message: japanese ? `投稿しましたが、ライセンスは設定できませんでした。${licenseFailure}` : `Posted, but the license could not be set. ${licenseFailure}` }
          : { status: "idle" });
        onCreated(payload.post);
      } else {
        /* 予約分は一覧にまだ出ない。保存できたことだけ伝える。 */
        const when = payload.scheduled ? new Date(payload.scheduled.scheduledAt) : null;
        const label = when && Number.isFinite(when.getTime())
          ? when.toLocaleString(japanese ? "ja-JP" : "en-US")
          : "";
        setSubmission({ status: "done", message: japanese
          ? `予約投稿を保存しました。${label ? `${label} に公開されます。` : ""}`
          : `Scheduled post saved.${label ? ` It will be published at ${label}.` : ""}` });
      }
    } catch {
      if (active()) setSubmission({ status: "failed", message: japanese ? "通信できませんでした。" : "Could not reach the server." });
    } finally {
      inFlight.current = false;
    }
  };

  const submitting = submission.status === "submitting";
  const remaining = HUB_SOCIAL_POST_MAX_CHARACTERS - body.length;
  const canSubmit = Boolean(viewerId) && (body.trim().length > 0 || images.length > 0) && !submitting;
  /* datetime-local は端末の地域時刻。API は 60 秒以上先を要求するので、
     選べる最小を次の分の境目（61〜120秒先）にしておく。UTC の ISO をそのまま
     渡すと時差ぶんずれるので、offset だけずらしてから切り出す。 */
  const scheduleMin = (() => {
    const earliest = new Date(Math.ceil((Date.now() + 60_000) / 60_000) * 60_000);
    return new Date(earliest.getTime() - earliest.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  })();
  const showReference = Boolean(reference && usedReference !== reference.href);
  /* 閉じて64px・開いて128px。書き始め・画像・予約・通知のどれかがあれば開く。 */
  const open = focused || body.length > 0 || images.length > 0 || scheduleOpen || plusOpen || showReference || submission.status !== "idle";
  const ring = 2 * Math.PI * 8;

  return (
    <section
      id="compose"
      className="v2-reply v2-compose"
      data-open={open ? "true" : undefined}
      aria-label={japanese ? "投稿を書く" : "Write a post"}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
    >
      <Avatar className="v2-compose__avatar" name={viewerName} src={viewerAvatarUrl} size={40} priority />
      <div className="v2-reply__body">
        {showReference && reference ? <div className="v2-note" aria-label={japanese ? '紹介する対象' : 'Reference to share'}>
          <a href={reference.href} target={reference.origin?"_blank":undefined} rel={reference.origin?"noopener noreferrer":undefined}>{reference.kind === 'github' ? (japanese ? 'GitHubの参照を紹介' : 'Share the GitHub reference') : reference.kind === 'git' ? (japanese ? (reference.base ? 'コードの二版比較' : 'コードの変更') : (reference.base ? 'Git comparison' : 'Git commit')) : reference.kind === 'research' ? (japanese ? `研究の公開版 v${reference.version}` : `Public research v${reference.version}`) : reference.kind === 'post' ? (japanese?'投稿を紹介':'Share the post') : reference.kind==='project'?(japanese?'プロジェクトを紹介':'Share the project'):reference.kind === 'article' ? (japanese ? '記事を紹介' : 'Share the article') : reference.kind==='music'?(japanese?'音楽を紹介':'Share the music'):(japanese ? '動画を紹介' : 'Share the video')}</a>
          {reference.origin ? <small>{japanese ? "配信元: " : "Source: "}{reference.origin}</small> : null}
          {viewerId ? <button type="button" className="v2-button" disabled={!ready || submitting} onClick={addReference}>{japanese ? '紹介リンクを追加' : 'Add reference link'}</button> : <a href={`/v2/auth?next=${encodeURIComponent(contentShareHref(reference.href)!)}`}>{japanese ? 'ログインして紹介' : 'Sign in to share'}</a>}
        </div> : null}
        <textarea
          ref={input}
          className="v2-reply__input"
          value={body}
          maxLength={HUB_SOCIAL_POST_MAX_CHARACTERS}
          disabled={submitting}
          rows={1}
          placeholder={japanese ? "いまどうしてる？" : "What is happening?"}
          aria-label={japanese ? "投稿の本文" : "Post body"}
          aria-controls={mentions.suggestions.length ? "v2-compose-mentions" : undefined}
          onChange={(event) => {
            if (submission.status === "failed" || submission.status === "done") setSubmission({ status: "idle" });
            mentions.onChange(event);
          }}
          onKeyDown={(event) => {
            if (mentions.onKeyDown(event)) return;
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
          }}
        />
        <V2MentionList id="v2-compose-mentions" suggestions={mentions.suggestions} selected={mentions.selected} onChoose={mentions.choose} japanese={japanese} />
        {images.length ? (
          <ul className="v2-compose__images">
            {images.map((item) => (
              <li key={item.key} className="v2-compose__image">
                <MediaFrame src={item.previewUrl} ratio="4/3" width={item.thumbnailWidth} height={item.thumbnailHeight} radius="sm" className="v2-compose__thumb" />
                <input
                  type="text"
                  value={item.altText}
                  maxLength={200}
                  placeholder={japanese ? "画像の説明（読み上げ用）" : "Describe the image"}
                  aria-label={japanese ? "画像の説明" : "Image description"}
                  onChange={(event) => setImages((current) => current.map((entry) => entry.key === item.key ? { ...entry, altText: event.target.value } : entry))}
                />
                <V2Button icon="close" label={japanese ? "画像を外す" : "Remove image"} onClick={() => dropImage(item.key)} />
              </li>
            ))}
          </ul>
        ) : null}
        {scheduleOpen ? (
          <div className="v2-compose__schedule">
            <label>
              <span>{japanese ? "公開日時" : "Publish at"}</span>
              <input
                type="datetime-local"
                value={scheduledAt}
                min={scheduleMin}
                step={60}
                disabled={submitting}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next && images.length) {
                    setSubmission({ status: "failed", message: japanese
                      ? "予約投稿は本文のみ対応しています。画像を削除するか、予約日時を解除してください。"
                      : "Scheduled posts support text only. Remove the images or clear the scheduled time." });
                    return;
                  }
                  setScheduledAt(next);
                  if (submission.status === "failed" || submission.status === "done") setSubmission({ status: "idle" });
                }}
              />
            </label>
            <small>{japanese ? "予約投稿は本文のみ対応しています。" : "Scheduled posts support text only."}</small>
          </div>
        ) : null}
        {images.length ? (
          <V2ContentLicensePicker value={license} onChange={setLicense} japanese={japanese} disabled={submitting} gated={Boolean(accessGateId)} />
        ) : null}
        {images.length || accessGateId ? (
          <V2ContentDownloadSetting
            value={downloadPolicy}
            onChange={(policy) => { setDownloadTouched(true); setDownloadPolicy(policy); }}
            license={license}
            target="post"
            japanese={japanese}
            disabled={submitting}
            gated={Boolean(accessGateId)}
          />
        ) : null}
        <div className="v2-reply__footer">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            onChange={(event) => void pickImages(event.target.files)}
          />
          {/* ＋の中身（2026-09-03、旦那様「ほかに必要なuiは」→「やって」の6手目）。画像・@・#。投票は API に無いので出さない。予約は隣の時計で。 */}
          <div className="v2-post__more" ref={plusRef}>
            <V2Button icon="plus" label={japanese ? "足す" : "Add"} expanded={plusOpen} disabled={submitting} onClick={() => setPlusOpen((current) => !current)} />
            {plusOpen ? (
              <div className="v2-menu" role="menu">
                <button type="button" role="menuitem" className="v2-menu__item" disabled={images.length >= IMAGE_LIMIT || Boolean(scheduledAt)} onClick={() => { setPlusOpen(false); fileInput.current?.click(); }}>{japanese ? `画像を足す（${images.length}/${IMAGE_LIMIT}）` : `Add image (${images.length}/${IMAGE_LIMIT})`}</button>
                <button type="button" role="menuitem" className="v2-menu__item" onClick={() => insertAtCaret("@")}>{japanese ? "@ で人を呼ぶ" : "@ mention someone"}</button>
                <button type="button" role="menuitem" className="v2-menu__item" onClick={() => insertAtCaret("#")}>{japanese ? "# タグを付ける" : "# add a tag"}</button>
              </div>
            ) : null}
          </div>
          {/* 予約投稿の日時を選ぶ欄を開く・畳む。畳むと選んだ日時も外れる。 */}
          <V2Button icon="clock" label={japanese ? "予約日時" : "Schedule"} pressed={scheduleOpen} disabled={submitting}
            onClick={() => { setScheduleOpen((current) => !current); if (scheduleOpen) setScheduledAt(""); }} />
          {/* 鍵は投稿IDができてから付ける。予約投稿は公開時までIDが無いので、予約中は選べない（実制約）。日本語のみは、鍵まわりの文言が未翻訳のため。 */}
          {japanese ? <V2AccessGateAttachToggle targetType="post" gateId={accessGateId} onChange={setAccessGateId} disabled={submitting || Boolean(scheduledAt)} /> : null}
          <select
            className="v2-compose__audience"
            value={audience}
            disabled={submitting}
            aria-label={japanese ? "公開範囲" : "Audience"}
            onChange={(event) => setAudience(event.target.value === "followers" ? "followers" : "public")}
          >
            <option value="public">{japanese ? "全員" : "Everyone"}</option>
            <option value="followers">{japanese ? "フォロワー" : "Followers"}</option>
          </select>
          {/* 残りは円で示し、残り20字からだけ数字を出す。読み上げには常に数字がある。 */}
          <span className="v2-reply__remaining v2-count" data-warn={remaining <= 20 ? "true" : undefined} aria-live="polite">
            <svg className="v2-count__ring" viewBox="0 0 20 20" aria-hidden="true">
              <circle className="v2-count__track" cx="10" cy="10" r="8" />
              <circle className="v2-count__bar" cx="10" cy="10" r="8" strokeDasharray={ring} strokeDashoffset={ring * (1 - Math.min(1, body.length / HUB_SOCIAL_POST_MAX_CHARACTERS))} />
            </svg>
            <span className={remaining <= 20 ? "v2-count__number" : "v2-sr"}>{remaining}</span>
          </span>
          <Button
            variant="primary"
            className="v2-compose__submit"
            disabled={!canSubmit}
            busy={submitting}
            label={submitting
              ? (japanese ? "送っています…" : "Sending…")
              : scheduledAt
                ? (japanese ? "予約する" : "Schedule")
                : (japanese ? "投稿する" : "Post")}
            onClick={() => void submit()}
          />
        </div>
        {submission.status === "failed" ? (
          <p className="v2-error" role="alert">{submission.message}</p>
        ) : null}
        {submission.status === "done" ? (
          <p className="v2-note v2-compose__status" role="status">{submission.message}</p>
        ) : null}
      </div>
    </section>
  );
}
