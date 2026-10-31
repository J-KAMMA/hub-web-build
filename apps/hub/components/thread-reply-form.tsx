"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ExternalLinkCard } from "@/components/external-link-card";
import { BBS_LIMITS, validateReplyContent } from "@/lib/bbs-content-quality";
import { optimizePostImageFile } from "@/lib/client-image-optimizer";
import { ROLE_LABELS,THREAD_POST_ROLES,type ThreadPostRole,type ThreadSource } from "@/lib/thread-knowledge";
import {
  THREAD_LANGUAGE_LABELS,
  THREAD_REGION_LABELS,
  type ThreadLanguage,
  type ThreadRegion,
} from "@/lib/thread-scope";
import {
  THREAD_LANGUAGE_TAG_LABELS,
  type ThreadLanguageTag,
} from "@/lib/thread-fine-scope";
import type { ThreadType } from "@/lib/thread-type";

interface ThreadReplyFormProps {
  threadId: string;
  replyToPostId?: string | null;
  replyToNo?: number | null;
  onSuccess?: () => void;
  authenticated?: boolean;
  allowedLanguages?: ThreadLanguage[];
  targetRegion?: ThreadRegion;
  allowedLanguageTags?: ThreadLanguageTag[];
  allowedCountryCodes?: string[];
  threadType?: ThreadType;
}

const REPLY_GUIDANCE: Record<ThreadType, string> = {
  question: "回答には理由や手順を添えてください。作成者は回答を採用できますが、採用は公式な正解を意味しません。",
  information: "補足や訂正には出典を添えると、あとから検証しやすくなります。",
  discussion: "賛否だけでなく、前提・根拠・判断基準を添えると論点を整理しやすくなります。",
  recruitment: "参加条件、期限、現在の募集状況を確認してから返信してください。",
  issue: "再現条件、利用環境、試した回避策を添えてください。解決したら訂正や解決状態を残せます。",
  chat: "相手の文脈を確かめ、必要なら返信や引用で話の流れを残してください。",
};

export function ThreadReplyForm({ threadId, replyToPostId, replyToNo, onSuccess, authenticated = true, allowedLanguages = ["ja"], targetRegion = "global", allowedLanguageTags = ["ja-JP"], allowedCountryCodes = [], threadType = "chat" }: ThreadReplyFormProps) {
  const router = useRouter();
  const [body, setBody] = useState(replyToNo ? `>>${replyToNo}\n` : "");
  const [anonymous, setAnonymous] = useState(false);
  const [language, setLanguage] = useState<ThreadLanguage>(allowedLanguages[0] ?? "ja");
  const [region, setRegion] = useState<ThreadRegion>(targetRegion);
  const [languageTag, setLanguageTag] = useState<ThreadLanguageTag>(allowedLanguageTags[0] ?? "ja-JP");
  const [countryCode, setCountryCode] = useState(allowedCountryCodes[0] ?? "");
  const [previewing, setPreviewing] = useState(false);
  const [role,setRole]=useState<ThreadPostRole>("unspecified");
  const [supersedes,setSupersedes]=useState("");
  const [sourceUrl,setSourceUrl]=useState("");
  const [sourceKind,setSourceKind]=useState<ThreadSource["kind"]>("other");
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [imageAltTexts, setImageAltTexts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const draftKey = `hub.thread.${threadId}.draft`;

  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey);
    if (saved && !replyToNo) setBody(saved);
    else if (!replyToNo && authenticated) void fetch(`/api/bbs/drafts?type=reply&context=${encodeURIComponent(threadId)}`).then((response)=>response.ok?response.json():null).then((payload:{draft?:{body?:string}}|null)=>{if(payload?.draft?.body)setBody(payload.draft.body);});
    const receiveQuote = (event: Event) => {
      const detail = (event as CustomEvent<{ no: number; text: string }>).detail;
      if (detail) setBody((current) => `${current.trimEnd()}${current ? "\n\n" : ""}>>${detail.no}\n> ${detail.text.slice(0, 500).replace(/\n/g, "\n> ")}\n`);
    };
    window.addEventListener("hub:thread-quote", receiveQuote);
    return () => window.removeEventListener("hub:thread-quote", receiveQuote);
  }, [authenticated, draftKey, replyToNo, threadId]);

  useEffect(() => { if (!replyToNo) window.localStorage.setItem(draftKey, body); }, [body, draftKey, replyToNo]);
  useEffect(() => { if (replyToNo || !authenticated) return; const timer=window.setTimeout(()=>{void fetch("/api/bbs/drafts",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"reply",contextId:threadId,body})});},800);return()=>window.clearTimeout(timer);},[authenticated,body,replyToNo,threadId]);

  const uploadImages = async (files: FileList | null) => {
    for (const file of Array.from(files ?? []).slice(0, 4 - imageIds.length)) {
      try {
        const optimized = await optimizePostImageFile(file);
        const form = new FormData();
        form.set("image", optimized.image); form.set("thumbnail", optimized.thumbnail);
        form.set("width", String(optimized.width)); form.set("height", String(optimized.height));
        form.set("thumbnailWidth", String(optimized.thumbnailWidth)); form.set("thumbnailHeight", String(optimized.thumbnailHeight)); form.set("altText", file.name);
        const response = await fetch("/api/media/images", { method: "POST", body: form });
        const payload = await response.json() as { image?: { id: string }; error?: string };
        if (!response.ok || !payload.image) throw new Error(payload.error ?? "画像を追加できませんでした。");
        setImageIds((current) => [...current, payload.image!.id]);
        setImageNames((current) => [...current, file.name]);
        setImageAltTexts((current) => [...current, file.name]);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "画像を追加できませんでした。"); }
    }
  };

  const saveImageAltText = async (index: number) => {
    const imageId = imageIds[index];
    if (!imageId) return;
    const response = await fetch(`/api/media/images/${encodeURIComponent(imageId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ altText: imageAltTexts[index] ?? "" }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error ?? "画像の説明を保存できませんでした。");
    }
  };

  const submit = () => {
    const contentError = validateReplyContent(body);
    if (contentError) {
      setError(contentError ?? "入力内容を確認してください。");
      return;
    }

    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/bbs/threads/${threadId}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          identity_mode: anonymous ? "anonymous" : "account",
          reply_to_post_id: replyToPostId ?? null
          ,language
          ,region
          ,language_tag: languageTag
          ,country_code: countryCode || null
          ,image_ids: imageIds
          ,role
          ,supersedes_post_id:supersedes||null
          ,sources:sourceUrl?[{url:sourceUrl,label:"",kind:sourceKind}]:[]
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setError(payload.error ?? "返信に失敗しました。");
        return;
      }

      setBody("");
      window.localStorage.removeItem(draftKey);
      void fetch(`/api/bbs/drafts?type=reply&context=${encodeURIComponent(threadId)}`,{method:"DELETE"});
      setImageIds([]); setImageNames([]); setImageAltTexts([]);
      setRole("unspecified");setSupersedes("");setSourceUrl("");setSourceKind("other");
      onSuccess?.();
      router.refresh();
    });
  };

  if (!authenticated) return <div className="bbs-auth-required"><strong>返信するにはログインが必要です</strong><span>メールアドレス不要のHub専用アカウントです。</span><a href="/auth">ログイン・新規登録</a></div>;

  return (
    <div className="composer flow-item thread-reply-composer">
      <label className="composer__label" htmlFor="thread-reply-body">
        <span className="section-heading__eyebrow">
          {replyToNo ? `>>${replyToNo} に返信` : "書き込む"}
        </span>
      </label>

      <textarea
        id="thread-reply-body"
        className="composer__input"
        placeholder="理由や経験を添えて返信… (Ctrl+Enter で送信)"
        maxLength={BBS_LIMITS.bodyMax}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
        disabled={isPending}
      />
      <ExternalLinkCard body={body} />
      <div className="thread-reply-scope">
        <label>
          投稿言語
          <select value={language} onChange={(event) => setLanguage(event.target.value as ThreadLanguage)} disabled={isPending}>
            {allowedLanguages.map((value) => <option value={value} key={value}>{THREAD_LANGUAGE_LABELS[value]}</option>)}
          </select>
        </label>
        <label>
          言語・方言
          <select value={languageTag} onChange={(event) => setLanguageTag(event.target.value as ThreadLanguageTag)} disabled={isPending}>
            {allowedLanguageTags.map((value) => <option value={value} key={value}>{THREAD_LANGUAGE_TAG_LABELS[value]}</option>)}
          </select>
        </label>
        {allowedCountryCodes.length > 0 && <label>
          対象国・地域
          <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} disabled={isPending}>
            {allowedCountryCodes.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>}
        <label>
          対象地域
          <select value={region} onChange={(event) => setRegion(event.target.value as ThreadRegion)} disabled={isPending || targetRegion !== "global"}>
            {targetRegion === "global"
              ? Object.entries(THREAD_REGION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)
              : <option value={targetRegion}>{THREAD_REGION_LABELS[targetRegion]}</option>}
          </select>
        </label>
        <small>許可されていない言語・対象地域の投稿は送信できません。</small>
      </div>
      <details className="thread-reply-options"><summary>{threadType === "information" ? "補足・訂正・出典を追加" : "レスの種類・出典を追加"}</summary><div className="thread-reply-metadata"><label>レスの種類<select value={role} onChange={event=>setRole(event.target.value as ThreadPostRole)}>{THREAD_POST_ROLES.map(value=><option value={value} key={value}>{ROLE_LABELS[value]}</option>)}</select></label>{role==="correction"&&<label>訂正するレス番号<input inputMode="numeric" value={supersedes} onChange={event=>setSupersedes(event.target.value.replace(/\D/g,""))} placeholder="例: 12"/></label>}<label>出典URL（任意）<input type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)} placeholder="https://"/></label></div></details>
      <label className="thread-image-upload"><span>画像を添付</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void uploadImages(event.target.files)} disabled={isPending || imageIds.length >= 4} /><small>JPEG・PNG・WebP、1枚5MBまで、最大4枚</small></label>
      {imageNames.length > 0 && <div className="thread-image-upload__list">{imageNames.map((name, index) => <span key={`${name}-${index}`}><strong>{name}</strong><label>画像の説明（任意）<input value={imageAltTexts[index] ?? ""} maxLength={300} aria-label={`${name}の画像説明`} onChange={(event) => setImageAltTexts((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} onBlur={() => void saveImageAltText(index)} /></label><button type="button" onClick={() => { setImageNames((current) => current.filter((_, itemIndex) => itemIndex !== index)); setImageIds((current) => current.filter((_, itemIndex) => itemIndex !== index)); setImageAltTexts((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}>削除</button></span>)}</div>}
      {previewing && <section className="thread-post-preview" aria-label="返信プレビュー"><strong>送信前プレビュー</strong><p>{body.trim() || "本文を入力してください。"}</p></section>}
      <label className="thread-reply-anonymous">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(event) => setAnonymous(event.target.checked)}
          disabled={isPending}
        />
        <span>
          <strong>匿名で投稿</strong>
          <small>同じスレッド内では共通の匿名記号で表示されます。別のスレッドでは記号が変わります。運営は荒らし対策のため投稿者を確認できます。</small>
        </span>
      </label>
      <div className="composer__footer">
        <span className="composer__counter">
          {body.length}/{BBS_LIMITS.bodyMax} ・ {anonymous ? "匿名投稿" : "通常投稿"}
        </span>
        <button type="button" className="button" onClick={() => setPreviewing((current) => !current)} disabled={isPending}>{previewing ? "編集に戻る" : "プレビュー"}</button>
        <button
          type="button"
          className="button button--primary"
          onClick={submit}
          disabled={isPending || !body.trim()}
        >
          {isPending ? "送信中…" : "書き込む"}
        </button>
      </div>
      <p className="bbs-reply-guidance">{REPLY_GUIDANCE[threadType]}</p>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
