"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { V2ImageButton, V2ImageList } from "@/components/v2/v2-image-picker";
import { IMAGE_LIMIT, imageErrorMessage, prepareImage, uploadPickedImages, type PickedImage } from "@/components/v2/v2-image-prepare";
import { BBS_LIMITS, validateReplyContent } from "@/lib/bbs-content-quality";
import { ROLE_LABELS, THREAD_POST_ROLES, type ThreadPostRole, type ThreadSource } from "@/lib/thread-knowledge";
import { THREAD_LANGUAGE_TAG_LABELS, type ThreadLanguageTag } from "@/lib/thread-fine-scope";
import { THREAD_LANGUAGE_LABELS, THREAD_REGION_LABELS, type ThreadLanguage, type ThreadRegion } from "@/lib/thread-scope";
import { withSocialStreamReturn } from "@/lib/social-stream-return";

type ReplyProps = {
  threadId: string; authenticated: boolean; language: ThreadLanguage; region: ThreadRegion;
  languageTag: ThreadLanguageTag; countryCode: string | null; japanese: boolean;
  allowedLanguages?: ThreadLanguage[]; allowedLanguageTags?: ThreadLanguageTag[];
  allowedCountryCodes?: string[]; postTargets?: { id: string; no: number }[];
  page?: number; returnTo?: string;
};
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
const validText = (value: unknown): value is string => typeof value === "string" && !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

export function V2ThreadReply(props: ReplyProps) {
  return <V2ThreadReplyEditor key={`${props.threadId}:${props.authenticated}`} {...props} />;
}

function V2ThreadReplyEditor({ threadId, authenticated, language, region, languageTag, countryCode, japanese,
  allowedLanguages = [language], allowedLanguageTags = [languageTag], allowedCountryCodes = countryCode ? [countryCode] : [], postTargets = [], page = 1, returnTo }: ReplyProps) {
  const router = useRouter();
  const returnPath = withSocialStreamReturn(`/v2/threads/${encodeURIComponent(threadId)}${Number.isSafeInteger(page) && page > 1 ? `?page=${page}` : ''}`, returnTo);
  const defaults = { anonymous: false, language: allowedLanguages.includes(language) ? language : allowedLanguages[0] ?? language,
    region, languageTag: allowedLanguageTags.includes(languageTag) ? languageTag : allowedLanguageTags[0] ?? languageTag,
    countryCode: allowedCountryCodes.includes(countryCode ?? "") ? countryCode! : allowedCountryCodes[0] ?? "",
    role: "unspecified" as ThreadPostRole, supersedes: "", sourceUrl: "", sourceKind: "other" as ThreadSource["kind"] };
  const [settings, setSettings] = useState(defaults), [body, setBody] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]), [error, setError] = useState("");
  const [pending, setPending] = useState(false), [preparing, setPreparing] = useState(false), [unknown, setUnknown] = useState(false);
  const [hydrated, setHydrated] = useState(false), [previewing, setPreviewing] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; no: number } | null>(null);
  const input = useRef<HTMLInputElement | null>(null), busy = useRef(false), preparingRef = useRef(false), unknownRef = useRef(false);
  const revision = useRef(0), scope = useRef<object | null>(null), textState = useRef(""), imageState = useRef<PickedImage[]>([]), auth = useRef(authenticated);
  auth.current = authenticated;
  const draftKey = `hub.thread.${threadId}.draft`, disabled = pending || preparing || unknown;
  const targets = postTargets.filter(target => validId(target.id) && Number.isSafeInteger(target.no) && target.no > 0);
  const current = () => scope.current !== null && auth.current;
  const capture = () => { const token = scope.current; return () => token !== null && token === scope.current && auth.current; };
  const editable = () => current() && !busy.current && !preparingRef.current && !unknownRef.current;
  const changeBody = (value: string) => { if (editable()) { ++revision.current; textState.current = value; setBody(value); setHydrated(true); } };
  const changeSettings = (patch: Partial<typeof settings>) => { if (editable()) setSettings(value => ({ ...value, ...patch })); };
  const clearImages = () => { imageState.current.forEach(image => URL.revokeObjectURL(image.previewUrl)); imageState.current = []; setImages([]); };

  useEffect(() => {
    scope.current = {};
    const stillCurrent = capture();
    const draftRevision = revision.current;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved && validText(saved) && saved.length <= BBS_LIMITS.bodyMax) { textState.current = saved; setBody(saved); setHydrated(true); }
      else if (authenticated) void fetch(`/api/bbs/drafts?type=reply&context=${encodeURIComponent(threadId)}`)
        .then(response => response.ok ? response.json() : null)
        .then((payload: { draft?: { body?: unknown } } | null) => {
          const savedBody = payload?.draft?.body;
          if (stillCurrent() && revision.current === draftRevision && validText(savedBody) && savedBody.length <= BBS_LIMITS.bodyMax) { textState.current = savedBody; setBody(savedBody); }
        }).catch(() => undefined).finally(() => { if (stillCurrent()) setHydrated(true); });
      else setHydrated(true);
    } catch { setHydrated(true); /* An unavailable draft store does not prevent posting. */ }
    const receiveQuote = (event: Event) => {
      if (!editable()) return;
      const detail = (event as CustomEvent<{ threadId?: unknown; postId?: unknown; no?: unknown; text?: unknown }>).detail;
      if (!detail || !Number.isSafeInteger(detail.no) || Number(detail.no) <= 0 || !validText(detail.text) || detail.text.length > 500) return;
      const scoped = Object.hasOwn(detail, "threadId") || Object.hasOwn(detail, "postId");
      if (scoped && (detail.threadId !== threadId || !validId(detail.postId))) return;
      const value = textState.current, next = `${value.trimEnd()}${value ? "\n\n" : ""}>>${detail.no}\n> ${detail.text.replace(/\n/g, "\n> ")}\n`;
      if (next.length > BBS_LIMITS.bodyMax) return;
      ++revision.current; textState.current = next; setBody(next); setHydrated(true);
      if (scoped) setReplyTo({ id: detail.postId as string, no: Number(detail.no) });
    };
    window.addEventListener("hub:thread-quote", receiveQuote);
    return () => { scope.current = null; window.removeEventListener("hub:thread-quote", receiveQuote); imageState.current.forEach(image => URL.revokeObjectURL(image.previewUrl)); };
  }, [authenticated, draftKey, threadId]);

  useEffect(() => {
    if (!hydrated) return;
    try { if (body) window.localStorage.setItem(draftKey, body); else window.localStorage.removeItem(draftKey); } catch { /* Local draft storage is optional. */ }
  }, [body, draftKey, hydrated]);
  useEffect(() => {
    if (!authenticated || !hydrated) return;
    const timer = window.setTimeout(() => { if (current()) void fetch("/api/bbs/drafts", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "reply", contextId: threadId, body }) }).catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer);
  }, [authenticated, body, hydrated, threadId]);

  const picker = {
    images, input,
    open: () => { if (editable()) input.current?.click(); },
    pick: async (files: FileList | null) => {
      if (!editable() || !files?.length) return;
      const stillCurrent = capture();
      preparingRef.current = true; setPreparing(true);
      const picked = await Promise.allSettled(Array.from(files).slice(0, Math.max(0, IMAGE_LIMIT - imageState.current.length)).map(prepareImage));
      const prepared = picked.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      const failure = picked.find(result => result.status === "rejected");
      if (!stillCurrent() || failure) prepared.forEach(image => URL.revokeObjectURL(image.previewUrl));
      else {
        const known = new Set(imageState.current.map(image => image.key));
        const added = prepared.filter(image => !known.has(image.key));
        prepared.filter(image => known.has(image.key)).forEach(image => URL.revokeObjectURL(image.previewUrl));
        imageState.current = [...imageState.current, ...added]; setImages(imageState.current);
      }
      preparingRef.current = false;
      if (stillCurrent()) { setPreparing(false); if (failure?.status === "rejected") setError(imageErrorMessage(failure.reason, japanese)); if (input.current) input.current.value = ""; }
    },
    drop: (key: string) => { if (!editable()) return; const removed = imageState.current.find(image => image.key === key); if (removed) URL.revokeObjectURL(removed.previewUrl); imageState.current = imageState.current.filter(image => image.key !== key); setImages(imageState.current); },
    describe: (key: string, altText: string) => { if (!editable()) return; imageState.current = imageState.current.map(image => image.key === key ? { ...image, altText } : image); setImages(imageState.current); },
    clear: clearImages,
    upload: () => uploadPickedImages(imageState.current, japanese),
  };

  const submit = async () => {
    if (!editable() || unknownRef.current) return;
    const problem = validateReplyContent(body);
    if (problem || !validText(body)) { setError(problem ?? (japanese ? "本文を確認してください。" : "Check the reply text.")); return; }
    if (settings.role === "correction" && !targets.some(target => target.id === settings.supersedes)) { setError(japanese ? "訂正する投稿を選んでください。" : "Select the post to correct."); return; }
    let sourceUrl = settings.sourceUrl.trim();
    if (sourceUrl) {
      try { const parsed = new URL(sourceUrl); if (sourceUrl.length > 2048 || parsed.href.length > 2048 || /[\u0000-\u001f\u007f-\u009f]/u.test(sourceUrl) || parsed.protocol !== "https:" || parsed.username || parsed.password) throw Error(); sourceUrl = parsed.href; }
      catch { setError(japanese ? "出典はHTTPSのURLを入力してください。" : "Enter an HTTPS source URL."); return; }
    }
    busy.current = true; setPending(true); setError("");
    const stillCurrent = capture();
    const content = { body: body.trim(), identity_mode: settings.anonymous ? "anonymous" : "account", reply_to_post_id: replyTo?.id ?? null,
      language: settings.language, region: settings.region, language_tag: settings.languageTag, country_code: settings.countryCode || null,
      role: settings.role, supersedes_post_id: settings.role === "correction" ? settings.supersedes : null,
      sources: sourceUrl ? [{ url: sourceUrl, label: "", kind: settings.sourceKind }] : [] };
    let posted = false;
    try {
      const imageIds = await picker.upload();
      if (!stillCurrent()) return;
      posted = true;
      const response = await fetch(`/api/bbs/threads/${encodeURIComponent(threadId)}/posts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...content, image_ids: imageIds }) });
      if (!stillCurrent()) return;
      if ([400, 401, 403, 429].includes(response.status)) { setError(japanese ? "返信を送れませんでした。内容とログイン状態を確認してください。" : "Could not post. Check the reply and your sign-in state."); return; }
      const payload = await response.json().catch(() => null) as { post?: { id?: unknown; threadId?: unknown } } | null;
      if (!stillCurrent()) return;
      if (response.status !== 201 || !validId(payload?.post?.id) || payload?.post?.threadId !== threadId) throw Error();
      ++revision.current; textState.current = ""; setBody(""); clearImages(); setSettings(defaults); setReplyTo(null); setPreviewing(false);
      try { window.localStorage.removeItem(draftKey); } catch { /* Local draft storage is optional. */ }
      void fetch(`/api/bbs/drafts?type=reply&context=${encodeURIComponent(threadId)}`, { method: "DELETE" }).catch(() => undefined);
      router.refresh();
    } catch {
      if (!stillCurrent()) return;
      if (posted) { unknownRef.current = true; setUnknown(true); setError(japanese ? "投稿結果を確認できません。再送せず、投稿一覧を確認してください。" : "The posting result is unknown. Check the posts before sending again."); }
      else setError(japanese ? "画像を送れませんでした。草稿は保持しています。" : "Could not upload the images. Your draft is retained.");
    } finally { busy.current = false; if (stillCurrent()) setPending(false); }
  };

  if (!authenticated) return <section className="v2-card v2-reply-auth" aria-labelledby="v2-thread-reply-auth"><p className="v2-card__name" id="v2-thread-reply-auth">{japanese ? "返信するにはログインが必要です" : "Sign in to reply"}</p><p className="v2-card__meta">{japanese ? "メールアドレス不要のHub専用アカウントです。" : "A Hub account needs no email address."}</p><a className="v2-card__link" href={`/v2/auth?next=${encodeURIComponent(returnPath)}`}>{japanese ? "ログイン・新規登録" : "Sign in or sign up"}</a></section>;
  return <section id="v2-thread-reply" className="v2-treply" aria-label={japanese ? "返信を書く" : "Write a reply"}>
    <fieldset className="v2-treply__fields" disabled={disabled}>
      {replyTo && <p className="v2-treply__target">{`>>${replyTo.no} ${japanese ? "に返信" : "reply target"}`} <button type="button" onClick={() => { if (editable()) setReplyTo(null); }}>{japanese ? "返信先を解除" : "Clear reply target"}</button></p>}
      <textarea className="v2-reply__input" value={body} maxLength={BBS_LIMITS.bodyMax} placeholder={japanese ? "返信を書く（2文字以上）" : "Write a reply (2+ characters)"} aria-label={japanese ? "返信の本文" : "Reply body"} onChange={event => changeBody(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.repeat && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="v2-treply__scope">
        <label>{japanese ? "投稿言語" : "Language"}<select value={settings.language} onChange={event => changeSettings({ language: event.target.value as ThreadLanguage })}>{allowedLanguages.map(value => <option key={value} value={value}>{THREAD_LANGUAGE_LABELS[value]}</option>)}</select></label>
        <label>{japanese ? "言語・方言" : "Language variant"}<select value={settings.languageTag} onChange={event => changeSettings({ languageTag: event.target.value as ThreadLanguageTag })}>{allowedLanguageTags.map(value => <option key={value} value={value}>{THREAD_LANGUAGE_TAG_LABELS[value]}</option>)}</select></label>
        {allowedCountryCodes.length > 0 && <label>{japanese ? "対象国・地域" : "Country"}<select value={settings.countryCode} onChange={event => changeSettings({ countryCode: event.target.value })}>{allowedCountryCodes.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        <label>{japanese ? "対象地域" : "Region"}<select value={settings.region} disabled={region !== "global"} onChange={event => changeSettings({ region: event.target.value as ThreadRegion })}>{(region === "global" ? Object.keys(THREAD_REGION_LABELS) as ThreadRegion[] : [region]).map(value => <option key={value} value={value}>{THREAD_REGION_LABELS[value]}</option>)}</select></label>
      </div>
      <details className="thread-reply-options"><summary>{japanese ? "レスの種類・訂正・出典を追加" : "Reply role, correction and source"}</summary><div className="thread-reply-metadata">
        <label>{japanese ? "レスの種類" : "Reply role"}<select value={settings.role} onChange={event => changeSettings({ role: event.target.value as ThreadPostRole })}>{THREAD_POST_ROLES.map(value => <option key={value} value={value}>{ROLE_LABELS[value]}</option>)}</select></label>
        {settings.role === "correction" && <label>{japanese ? "訂正する投稿" : "Post to correct"}<select value={settings.supersedes} onChange={event => changeSettings({ supersedes: event.target.value })}><option value="">{japanese ? "投稿を選ぶ" : "Select a post"}</option>{targets.map(target => <option key={target.id} value={target.id}>{`>>${target.no}`}</option>)}</select></label>}
        <label>{japanese ? "出典URL（任意）" : "Source URL (optional)"}<input type="url" maxLength={2048} value={settings.sourceUrl} placeholder="https://" onChange={event => changeSettings({ sourceUrl: event.target.value })} /></label>
        <label>{japanese ? "出典の種類" : "Source kind"}<select value={settings.sourceKind} onChange={event => changeSettings({ sourceKind: event.target.value as ThreadSource["kind"] })}>{([['primary','一次資料'],['news','報道'],['personal','個人の記録'],['other','その他']] as const).map(([value,label]) => <option key={value} value={value}>{japanese ? label : value}</option>)}</select></label>
      </div></details>
      {previewing && <section className="thread-post-preview v2-treply__preview" aria-label={japanese ? "返信プレビュー" : "Reply preview"}><strong>{japanese ? "送信前プレビュー" : "Preview before posting"}</strong><p>{body.trim() || (japanese ? "本文を入力してください。" : "Enter the reply text.")}</p></section>}
      <V2ImageList images={picker.images} onDrop={picker.drop} onDescribe={picker.describe} japanese={japanese} />
      <div className="v2-reply__footer"><label className="v2-treply__anon"><input type="checkbox" checked={settings.anonymous} onChange={event => changeSettings({ anonymous: event.target.checked })} />{japanese ? "匿名で投稿" : "Post anonymously"}</label><V2ImageButton picker={picker} disabled={disabled} japanese={japanese} /><span className="v2-reply__remaining" aria-live="polite">{BBS_LIMITS.bodyMax - body.length}</span><button type="button" onClick={() => { if (editable()) setPreviewing(value => !value); }}>{previewing ? (japanese ? "編集に戻る" : "Edit") : (japanese ? "プレビュー" : "Preview")}</button><button type="button" className="v2-reply__submit" disabled={disabled || unknown || !body.trim()} onClick={() => void submit()}>{pending ? (japanese ? "送っています…" : "Sending…") : (japanese ? "返信する" : "Reply")}</button></div>
    </fieldset>
    {error && <p className="v2-error" role="alert">{error}</p>}
    {unknown && <button type="button" className="v2-card__link" onClick={() => router.refresh()}>{japanese ? "投稿一覧を確認" : "Check the posts"}</button>}
  </section>;
}
