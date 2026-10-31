"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { AppPicker } from "@/components/app-picker";
import { ExternalLinkCard } from "@/components/external-link-card";
import { ThreadComposerAdvisor } from "@/components/thread-composer-advisor";
import { BBS_LIMITS, validateThreadContent } from "@/lib/bbs-content-quality";
import { Board } from "@/lib/domain";
import { getBoardCategory } from "@/lib/bbs-board-catalog";
import { THREAD_TYPES, THREAD_TYPE_LABELS, type ThreadType } from "@/lib/thread-type";
import { parseThreadTagInput, THREAD_TAG_LENGTH_LIMIT, THREAD_TAG_LIMIT } from "@/lib/thread-tags";
import {
  THREAD_LANGUAGES,
  THREAD_LANGUAGE_LABELS,
  THREAD_REGIONS,
  THREAD_REGION_LABELS,
  type ThreadLanguage,
  type ThreadRegion
} from "@/lib/thread-scope";
import {
  THREAD_COUNTRY_CODES,
  THREAD_LANGUAGE_TAG_LABELS,
  THREAD_LANGUAGE_TAGS,
  type ThreadLanguageTag,
} from "@/lib/thread-fine-scope";

interface Props {
  boardKey?: string;
  boards?: Board[];
  currentUserDisplayName: string;
  defaultLanguage?: ThreadLanguage;
  authenticated?: boolean;
}

const TEMPLATES = [
  { threadType: "question", label: "質問", body: "背景：\n\n困っていること：\n\n試したこと・知りたいこと：" },
  { threadType: "information", label: "情報共有", body: "共有したいこと：\n\n役立ちそうな人：\n\n補足・参照先：" },
  { threadType: "discussion", label: "議題整理", body: "論点：\n\n前提・背景：\n\n判断したいこと：\n\n根拠・参照先：" },
  { threadType: "recruitment", label: "募集", body: "募集したいこと：\n\n対象・条件：\n\n期限・補足：" },
  { threadType: "issue", label: "不具合報告", body: "発生した問題：\n\n再現手順：\n1. \n2. \n\n環境：\n\n期待する結果：\n\n実際の結果：" },
  { threadType: "chat", label: "雑談", body: "話したいこと：\n\nきっかけ：\n\nみんなに聞きたいこと：" }
] as const;

export function NewThreadForm({ boardKey, boards = [], currentUserDisplayName, defaultLanguage = "ja", authenticated = true }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [threadType, setThreadType] = useState<ThreadType>("question");
  const [deadline, setDeadline] = useState("");
  const [selected, setSelected] = useState(boardKey ?? boards[0]?.key ?? "");
  const [language, setLanguage] = useState<ThreadLanguage>(defaultLanguage);
  const [allowedLanguages, setAllowedLanguages] = useState<ThreadLanguage[]>([defaultLanguage]);
  const [allowedLanguageTags, setAllowedLanguageTags] = useState<ThreadLanguageTag[]>(["ja-JP"]);
  const [allowedCountryCodes, setAllowedCountryCodes] = useState<string[]>([]);
  const [ipMode, setIpMode] = useState<"none" | "allow" | "deny">("none");
  const [ipRules, setIpRules] = useState("");
  const [region, setRegion] = useState<ThreadRegion>("global");
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [similarThreads, setSimilarThreads] = useState<Array<{ id: string; title: string; boardTitle: string }>>([]);
  const [pending, startTransition] = useTransition();
  const resolvedBoard = boardKey ?? selected;
  const draftKey = `hub.thread.new.${boardKey ?? "all"}`;
  const tags = useMemo(() => parseThreadTagInput(tagInput), [tagInput]);
  const options = useMemo(() => boards.map((item) => ({
    value: item.key,
    label: `${getBoardCategory(item.key)?.name ?? "その他"} / ${item.title}`,
  })), [boards]);

  useEffect(() => {
    const saved = window.localStorage.getItem(draftKey);
    if (!saved) { if(authenticated) void fetch(`/api/bbs/drafts?type=thread&context=${encodeURIComponent(boardKey??"all")}`).then((response)=>response.ok?response.json():null).then((payload:{draft?:{title?:string;body?:string;metadataJson?:string}}|null)=>{if(!payload?.draft)return;setTitle(payload.draft.title??"");setBody(payload.draft.body??"");try{const metadata=JSON.parse(payload.draft.metadataJson??"{}") as {tagInput?:string;anonymous?:boolean};setTagInput(metadata.tagInput??"");setAnonymous(Boolean(metadata.anonymous));}catch{/* optional metadata */}}); return; }
    try {
      const draft = JSON.parse(saved) as { title?: string; body?: string; tagInput?: string; anonymous?: boolean };
      setTitle(draft.title ?? ""); setBody(draft.body ?? ""); setTagInput(draft.tagInput ?? ""); setAnonymous(Boolean(draft.anonymous));
    } catch { window.localStorage.removeItem(draftKey); }
  }, [authenticated, boardKey, draftKey]);

  useEffect(() => {
    window.localStorage.setItem(draftKey, JSON.stringify({ title, body, tagInput, anonymous }));
  }, [anonymous, body, draftKey, tagInput, title]);
  useEffect(() => { if(!authenticated)return;const timer=window.setTimeout(()=>{void fetch("/api/bbs/drafts",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"thread",contextId:boardKey??"all",title,body,metadata:{tagInput,selected,language,region,threadType,anonymous}})});},800);return()=>window.clearTimeout(timer);},[anonymous,authenticated,boardKey,body,language,region,selected,tagInput,threadType,title]);

  useEffect(() => {
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 4) {
      setSimilarThreads([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/bbs/threads/similar?title=${encodeURIComponent(normalizedTitle)}`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { threads?: Array<{ id: string; title: string; boardTitle: string }> };
        setSimilarThreads(payload.threads ?? []);
      } catch (fetchError) {
        if (!(fetchError instanceof DOMException && fetchError.name === "AbortError")) setSimilarThreads([]);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [title]);

  if (!authenticated) return <div className="bbs-auth-required"><strong>投稿するにはログインが必要です</strong><span>Hub専用の仮名アカウントで参加できます。</span><a href="/auth">ログイン・新規登録</a></div>;

  const submit = () => {
    if (!resolvedBoard) {
      setError("投稿先を選んでください。");
      return;
    }
    const contentError = validateThreadContent({ title, body });
    if (contentError) {
      setError(contentError ?? "入力内容を確認してください。");
      return;
    }

    setError("");
    startTransition(async () => {
      const response = await fetch("/api/bbs/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board_key: resolvedBoard,
          title: title.trim(),
          body: body.trim(),
          identity_mode: anonymous ? "anonymous" : "account",
          language,
          allowed_languages: allowedLanguages,
          allowed_language_tags: allowedLanguageTags,
          allowed_country_codes: allowedCountryCodes,
          write_ip_policy: {
            mode: ipMode,
            cidrs: ipRules.split(/[\s,]+/u).map((value) => value.trim()).filter(Boolean),
          },
          region,
          thread_type: threadType,
          deadline: threadType === "recruitment" && deadline ? deadline : null,
          tags
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; thread?: { id: string } };
      if (!response.ok || !payload.thread) {
        setError(payload.error ?? "スレッドを作成できませんでした。");
        return;
      }
      router.push(`/threads/${payload.thread.id}`);
      window.localStorage.removeItem(draftKey);
      void fetch(`/api/bbs/drafts?type=thread&context=${encodeURIComponent(boardKey??"all")}`,{method:"DELETE"});
      router.refresh();
    });
  };

  return (
    <div className="bbs-composer">
      <div className="bbs-composer__intro">
        <strong>新しい話題を共有する</strong>
        <span>背景と知りたいことを添えると、具体的な返信が集まりやすくなります。</span>
      </div>

      <div className="bbs-template-row" aria-label="本文の型を選ぶ">
        <span>書き出しを選ぶ</span>
        {TEMPLATES.map((template) => (
          <button key={template.label} type="button" aria-pressed={threadType === template.threadType} onClick={() => { setThreadType(template.threadType); setBody(template.body); }} disabled={pending}>
            {template.label}
          </button>
        ))}
      </div>

      <div className="bbs-picker-row">
        {!boardKey && <AppPicker label="投稿先" value={selected} options={options} onChange={setSelected} disabled={pending} minWidth={220} />}
        <AppPicker
          label="スレッド種別"
          value={threadType}
          options={THREAD_TYPES.map((value) => ({ value, label: THREAD_TYPE_LABELS[value] }))}
          onChange={setThreadType}
          disabled={pending}
          minWidth={160}
        />
        <span className="bbs-composer__identity">投稿者 {anonymous ? "匿名" : currentUserDisplayName}</span>
      </div>
      {threadType === "recruitment" && <label className="bbs-field">
        <span>募集期限 <small>任意</small></span>
        <input className="composer__input" type="date" value={deadline} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDeadline(event.target.value)} disabled={pending} />
      </label>}

      <details className="thread-scope-advanced">
        <summary>詳細設定（匿名・言語・地域・タグ・接続元ネットワーク）</summary>
        <div className="bbs-picker-row">
          <AppPicker
            label="主な言語"
            value={language}
            options={THREAD_LANGUAGES.map((value) => ({ value, label: THREAD_LANGUAGE_LABELS[value] }))}
            onChange={(value) => {
              const next = value as ThreadLanguage;
              setLanguage(next);
              setAllowedLanguages((current) => current.includes(next) ? current : [next, ...current].slice(0, 5));
            }}
            disabled={pending}
            minWidth={170}
          />
          <AppPicker
            label="対象地域"
            value={region}
            options={THREAD_REGIONS.map((value) => ({ value, label: THREAD_REGION_LABELS[value] }))}
            onChange={(value) => setRegion(value as ThreadRegion)}
            disabled={pending}
            minWidth={190}
          />
        </div>
        <label className="thread-reply-anonymous">
          <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} disabled={pending} />
          <span>
            <strong>匿名でスレッドを作成</strong>
            <small>同じスレッド内では共通の匿名記号で表示されます。別のスレッドでは記号が変わります。運営は荒らし対策のため投稿者を確認できます。</small>
          </span>
        </label>
        <fieldset className="thread-scope-languages">
          <legend>このスレッドで許可する言語</legend>
          <p>主な言語は必ず許可されます。最大5言語まで選べます。</p>
          <div>
            {THREAD_LANGUAGES.map((value) => {
              const required = value === language;
              const checked = allowedLanguages.includes(value);
              return (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending || required || (!checked && allowedLanguages.length >= 5)}
                    onChange={(event) => setAllowedLanguages((current) => event.target.checked
                      ? [...current, value]
                      : current.filter((item) => item !== value))}
                  />
                  {THREAD_LANGUAGE_LABELS[value]}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend>許可する言語・方言</legend>
          <div className="thread-scope-option-grid">
            {THREAD_LANGUAGE_TAGS.map((value) => <label key={value}>
              <input type="checkbox" checked={allowedLanguageTags.includes(value)}
                disabled={pending || (!allowedLanguageTags.includes(value) && allowedLanguageTags.length >= 8)}
                onChange={(event) => setAllowedLanguageTags((current) => event.target.checked
                  ? [...current, value] : current.filter((item) => item !== value))} />
              {THREAD_LANGUAGE_TAG_LABELS[value]}
            </label>)}
          </div>
        </fieldset>
        <label>
          対象国・地域（未選択ならすべて）
          <select multiple size={8} value={allowedCountryCodes}
            onChange={(event) => setAllowedCountryCodes(Array.from(event.currentTarget.selectedOptions, (option) => option.value).slice(0, 32))}>
            {THREAD_COUNTRY_CODES.map((code) => <option value={code} key={code}>{code}</option>)}
          </select>
          <small>Ctrl／⌘キーで複数選択。最大32件です。</small>
        </label>
        <fieldset>
          <legend>接続元IPによる書き込み制限</legend>
          <select value={ipMode} onChange={(event) => setIpMode(event.target.value as typeof ipMode)}>
            <option value="none">制限しない</option>
            <option value="allow">指定IPだけ許可</option>
            <option value="deny">指定IPを拒否</option>
          </select>
          {ipMode !== "none" && <label>
            IPまたはIPv4 CIDR
            <textarea value={ipRules} onChange={(event) => setIpRules(event.target.value)}
              placeholder={"例：203.0.113.10\n198.51.100.0/24"} rows={4} />
          </label>}
          <small>高度なネットワーク制限です。個人を識別する機能ではありません。投稿者のIPはスレッド作成者へ表示・保存されません。最大20件です。</small>
        </fieldset>
        <label className="bbs-field bbs-tag-field">
          <span>タグ <small>最大{THREAD_TAG_LIMIT}個・1個{THREAD_TAG_LENGTH_LIMIT}文字まで</small></span>
          <input
            className="composer__input"
            maxLength={160}
            placeholder="例：AI、防災、英語（カンマ区切り）"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            disabled={pending}
          />
          {tags.length > 0 && <span className="thread-tag-list" aria-label="追加するタグ">
            {tags.map((tag) => <em className="thread-tag" key={tag}>#{tag}</em>)}
          </span>}
        </label>
      </details>

      <label className="bbs-field">
        <span>タイトル <small>{title.length}/{BBS_LIMITS.titleMax}（{BBS_LIMITS.titleMin}文字以上）</small></span>
        <input
          id="new-thread-title"
          className="composer__input"
          maxLength={BBS_LIMITS.titleMax}
          placeholder="例：異なる地域へ防災情報を届ける工夫を共有したい"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={pending}
        />
      </label>
      {similarThreads.length > 0 && <aside className="bbs-similar-threads" aria-live="polite">
        <strong>似たスレッドがあります</strong>
        <span>新しく作る前に、すでに回答がないか確認できます。</span>
        <ul>{similarThreads.map((thread) => <li key={thread.id}>
          <a href={`/threads/${thread.id}`} target="_blank" rel="noreferrer">{thread.title}</a>
          <small>{thread.boardTitle}</small>
        </li>)}</ul>
      </aside>}
      <label className="bbs-field">
        <span>本文 <small>{body.length}/{BBS_LIMITS.bodyMax}（{BBS_LIMITS.threadBodyMin}文字以上）</small></span>
        <textarea
          className="composer__input"
          maxLength={BBS_LIMITS.bodyMax}
          placeholder="背景、知りたいこと、すでに確認した情報などを書いてください。"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submit(); }}
          disabled={pending}
        />
      </label>
      <ExternalLinkCard body={body} />
      <ThreadComposerAdvisor title={title} body={body} />
      {previewing && <section className="thread-post-preview" aria-label="スレッドプレビュー"><strong>{title.trim() || "タイトル未入力"}</strong><p>{body.trim() || "本文を入力してください。"}</p></section>}
      <div className="composer__footer">
        <span className="bbs-composer__hint">個人情報は書かず、異なる意見にも敬意を払いましょう。</span>
        <button type="button" className="button" onClick={() => setPreviewing((current) => !current)} disabled={pending}>{previewing ? "編集に戻る" : "プレビュー"}</button>
        <button type="button" className="button button--primary" onClick={submit} disabled={pending || !resolvedBoard || !title.trim() || !body.trim()}>
          {pending ? "作成中…" : "スレッドを作る"}
        </button>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  );
}
