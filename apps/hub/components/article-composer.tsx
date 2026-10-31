"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import type { ArticleAudience } from "@/lib/article-content";
import { articleCharacterCount, normalizeArticleTags } from "@/lib/article-body";
import { V2TagInput } from "@/components/v2/v2-tag-input";
import { MARKDOWN_IMPORT_BODY_MAX, MARKDOWN_IMPORT_MAX_BYTES, importMarkdown, type MarkdownImportResult } from "@/lib/article-markdown-import";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { ArticleBodyView } from "@/components/article-body-view";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2State } from "@/components/v2/v2-state";
import { V2AccessGateAttachToggle } from "@/components/v2/v2-access-gate-attach";
import { V2ContentLicensePicker } from "@/components/v2/v2-content-license-picker";
import { V2ContentDownloadEditor } from "@/components/v2/v2-content-download";
import { isContentLicenseId, type ContentLicenseId } from "@/lib/content-license";
import { imageErrorMessage, prepareImage, uploadPickedImages } from "@/components/v2/v2-image-prepare";
import "./article-markdown-import.css";

/*
 * 記事を書く（2026-10-14 作り直し）。題・表紙・本文を中央1列に置き、上の帯に
 * 保存の状態と「公開設定」「プレビュー」「公開する」を常に出す。
 * 下書きはサーバー（/api/articles/drafts）へ自動保存する。公開後の記事は
 * ?article=ID で開き、更新と取り下げができる（履歴はサーバーが残す）。
 * 購入・価格の選択肢は持たない。閲覧条件はトークンゲート（V2AccessGateAttachToggle）だけ。
 */

const LEGACY_DRAFT_KEY = "hub.article-composer.draft.v1";
const AUTOSAVE_MS = 1200;
const SUMMARY_GUIDE = 120;
const DRAFTS_ENDPOINT = "/api/articles/drafts";

type Fields = {
  title: string;
  summary: string;
  body: string;
  publicPreface: string;
  tags: string;
  coverImageId: string | null;
  audience: ArticleAudience;
  accessGateId: string | null;
  license: ContentLicenseId;
};

const EMPTY: Fields = { title: "", summary: "", body: "", publicPreface: "", tags: "", coverImageId: null, audience: "general", accessGateId: null, license: "arr" };

type Mode = { kind: "draft" } | { kind: "article"; status: "published" | "withdrawn" };
type SaveState = "idle" | "saving" | "saved" | "updated" | "error" | "signin";
type Notice =
  | { kind: "none" }
  | { kind: "published"; href: string }
  | { kind: "scheduled"; at: string }
  | { kind: "withdrawn" }
  | { kind: "error"; message: string };
type Ask = { kind: "link" | "youtube"; value: string } | null;

type ServerDraft = {
  id: string; title: string; summary: string; body: string; publicPreface?: string; tags: string[]; coverImageId: string | null;
  audience: ArticleAudience; accessGateId: string | null; license?: string; publishAt: string | null; status: "draft" | "scheduled"; scheduleError: string | null;
};
type ServerArticle = {
  id: string; title: string; summary: string; body: string; publicPreface?: string; tags: string[]; coverImageId: string | null;
  audience: ArticleAudience; accessGateId: string | null; license?: string; status: "published" | "withdrawn";
};

/** 読み込み後に出す案内。画像は取り込めないので、上げ直しが要ることを最初に伝える。 */
function describeMarkdownImport(result: MarkdownImportResult, name: string): string[] {
  const lines = [`「${name}」を読み込みました。`];
  if (result.images) lines.push(`外部の画像 ${result.images} 枚は取り込めません。リンクの行に置き換えたので、Hubに画像をアップロードして差し替えてください。`);
  if (result.tables) lines.push(`表 ${result.tables} 個は、崩れないよう等幅のコードブロックにしました。`);
  if (result.htmlRemoved) lines.push("HTMLのタグは取り除き、文字だけを残しました。");
  if (result.droppedLinks) lines.push(`開けない・安全でないリンク ${result.droppedLinks} 件は、文字だけにしました。`);
  if (result.longLines) lines.push(`長すぎる行 ${result.longLines} 行を途中で切りました。`);
  if (result.truncated) lines.push(`本文が${MARKDOWN_IMPORT_BODY_MAX.toLocaleString("ja-JP")}字を超えたため、後ろを切りました。`);
  return lines;
}

/** 鍵が付いているときだけ出る、鍵の手前に見せる部分。鍵を外すと隠れるが、書いた内容は保存されたまま残る。 */
export function ComposerPublicPreface({ gated, value, onChange, disabled }: { gated: boolean; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  if (!gated) return null;
  return (
    <>
      <label className="hub-composer__preface">
        <span>鍵の手前に見せる部分（誰でも読めます）</span>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} aria-label="鍵の手前に見せる部分（誰でも読めます）" disabled={disabled} />
      </label>
      <div className="hub-composer__lockline" role="separator" aria-label="ここから先は鍵つきです"><span>ここから先は鍵つきです</span></div>
    </>
  );
}

function GlyphIcon({ children }: { children: ReactNode }) {
  return <svg className="hub-composer__glyph" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}

const TOOL_ICONS: Record<string, ReactNode> = {
  "見出し": <GlyphIcon><path d="M6 5v14M18 5v14M6 12h12" /></GlyphIcon>,
  "太字": <GlyphIcon><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7.5a3.5 3.5 0 0 1 0 7H7z" /></GlyphIcon>,
  "リンク": <GlyphIcon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></GlyphIcon>,
  "引用": <V2Icon name="quote" />,
  "コード": <GlyphIcon><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" /></GlyphIcon>,
  "箇条書き": <V2Icon name="list" />,
  "画像": <GlyphIcon><path d="M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01" /></GlyphIcon>,
  "YouTube": <GlyphIcon><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM10 9.5v5l4.5-2.5z" /></GlyphIcon>,
};

const imagePath = (id: string) => `/api/articles/images/${encodeURIComponent(id)}`;

function toFields(source: { title: string; summary: string; body: string; publicPreface?: string; tags: string[]; coverImageId: string | null; audience: ArticleAudience; accessGateId: string | null; license?: string }): Fields {
  return {
    title: source.title, summary: source.summary, body: source.body, publicPreface: source.publicPreface ?? "", tags: source.tags.join("、"),
    coverImageId: source.coverImageId, audience: source.audience, accessGateId: source.accessGateId,
    license: isContentLicenseId(source.license) ? source.license : "arr",
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}T${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

function clockLabel(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function formatWhen(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? iso : time.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || `${fallback}（${response.status}）`;
}

export function ArticleComposer({ draftId = null, articleId = null, openSettings = false, presetGateId = null }: { draftId?: string | null; articleId?: string | null; openSettings?: boolean; presetGateId?: string | null }) {
  const surface = useHubUiSurface();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [mode, setMode] = useState<Mode>(articleId ? { kind: "article", status: "published" } : { kind: "draft" });
  const [loading, setLoading] = useState(Boolean(draftId || articleId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // 「鍵つきの記事を書く」から来たときは、鍵の欄がある公開設定を開いておく。
  const [settingsOpen, setSettingsOpen] = useState(openSettings);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [notice, setNotice] = useState<Notice>({ kind: "none" });
  const [busy, setBusy] = useState<null | "publish" | "schedule" | "update" | "withdraw" | "image">(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [scheduleInput, setScheduleInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [done, setDone] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  const fieldsRef = useRef<Fields>(EMPTY);
  const idRef = useRef<string | null>(articleId ? null : draftId);
  const loadedGateRef = useRef<string | null>(null);
  const loadedLicenseRef = useRef<ContentLicenseId>("arr");
  const editedRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filePurposeRef = useRef<"body" | "cover">("body");
  const [autosaveTick, setAutosaveTick] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownFileRef = useRef<HTMLInputElement | null>(null);
  const [markdownReview, setMarkdownReview] = useState<{ name: string; result: MarkdownImportResult } | null>(null);
  const [markdownReport, setMarkdownReport] = useState<string[] | null>(null);

  const isArticle = mode.kind === "article";
  const locked = done || (isArticle && mode.status === "withdrawn");

  /* ---------- コメントの受け付け設定（記事・下書きのidごと。既定はオン） ---------- */
  useEffect(() => {
    const id = articleId ?? draftId;
    if (!id) return;
    let cancelled = false;
    void fetch(`/api/articles/${encodeURIComponent(id)}/comments/settings`, { cache: "no-store" })
      .then(async (response) => (response.ok ? await response.json() as { commentsEnabled?: boolean } : null))
      .then((body) => { if (!cancelled && typeof body?.commentsEnabled === "boolean") setCommentsEnabled(body.commentsEnabled); })
      .catch(() => { /* 取れなければ既定のオンのまま */ });
    return () => { cancelled = true; };
  }, [articleId, draftId]);

  const changeComments = async (next: boolean) => {
    const previous = commentsEnabled;
    setCommentsEnabled(next);
    setCommentsError(null);
    try {
      /* 下書きがまだ無ければ、先に下書きを作ってそのidに設定を結ぶ（公開しても同じidが記事になる）。 */
      if (!articleId && !idRef.current && !(await persist())) throw new Error("save");
      const id = articleId ?? idRef.current;
      if (!id) throw new Error("id");
      const response = await post(`/api/articles/${encodeURIComponent(id)}/comments/settings`, { method: "PUT", body: JSON.stringify({ commentsEnabled: next }) });
      if (!response.ok) throw new Error("put");
    } catch {
      setCommentsEnabled(previous);
      setCommentsError("コメントの設定を保存できませんでした。");
    }
  };

  /* ---------- 読み込み ---------- */
  useEffect(() => {
    let cancelled = false;
    const apply = (next: Fields) => { fieldsRef.current = next; setFields(next); };
    const run = async () => {
      try {
        if (articleId) {
          const response = await fetch(`/api/articles/mine/${encodeURIComponent(articleId)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(response.status === 401 ? "ログインが必要です。" : "記事を開けませんでした。");
          const body = await response.json() as { article: ServerArticle; revisions: unknown[] };
          if (cancelled) return;
          loadedGateRef.current = body.article.accessGateId;
          loadedLicenseRef.current = isContentLicenseId(body.article.license) ? body.article.license : "arr";
          apply(toFields(body.article));
          setMode({ kind: "article", status: body.article.status });
          setRevisionCount(body.revisions.length);
        } else if (draftId) {
          const response = await fetch(`${DRAFTS_ENDPOINT}/${encodeURIComponent(draftId)}`, { cache: "no-store" });
          if (!response.ok) throw new Error(response.status === 401 ? "ログインが必要です。" : "下書きを開けませんでした。");
          const body = await response.json() as { draft: ServerDraft };
          if (cancelled) return;
          apply(toFields(body.draft));
          setScheduledAt(body.draft.status === "scheduled" ? body.draft.publishAt : null);
          setScheduleInput(toLocalInput(body.draft.publishAt));
          setScheduleError(body.draft.scheduleError);
        } else {
          // 以前の端末内の下書きがあれば、サーバー側の下書きとして引き継ぐ。
          try {
            const raw = window.localStorage.getItem(LEGACY_DRAFT_KEY);
            if (raw) {
              const old = JSON.parse(raw) as Partial<{ title: string; summary: string; body: string; tags: string }>;
              if (old.title || old.body) {
                apply({ ...EMPTY, title: old.title ?? "", summary: old.summary ?? "", body: old.body ?? "", tags: old.tags ?? "" });
                editedRef.current = true;
                setAutosaveTick((tick) => tick + 1);
              }
            }
          } catch { /* 端末の保存が使えなくても書ける */ }
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "開けませんでした。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [articleId, draftId]);

  const update = useCallback((patch: Partial<Fields>) => {
    const next = { ...fieldsRef.current, ...patch };
    fieldsRef.current = next;
    setFields(next);
    setNotice({ kind: "none" });
    setSaveState((state) => (state === "saved" || state === "updated" || state === "error" ? "idle" : state));
    editedRef.current = true;
    setAutosaveTick((tick) => tick + 1);
  }, []);

  /* ---------- 保存（下書き）。同時に走らせず、順に1本ずつ ---------- */
  const persist = useCallback((): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      const current = fieldsRef.current;
      setSaveState("saving");
      try {
        const payload = JSON.stringify({
          title: current.title, summary: current.summary, body: current.body, publicPreface: current.publicPreface, tags: normalizeArticleTags(current.tags),
          coverImageId: current.coverImageId, audience: current.audience, accessGateId: current.accessGateId, license: current.license,
        });
        const headers = { "content-type": "application/json", accept: "application/json" };
        const id = idRef.current;
        const response = id
          ? await fetch(`${DRAFTS_ENDPOINT}/${encodeURIComponent(id)}`, { method: "PUT", headers, body: payload })
          : await fetch(DRAFTS_ENDPOINT, { method: "POST", headers, body: payload });
        if (response.status === 401) { setSaveState("signin"); return false; }
        if (!response.ok) { setSaveMessage(await readError(response, "保存できませんでした")); setSaveState("error"); return false; }
        if (!id) {
          const body = await response.json() as { draft: { id: string } };
          idRef.current = body.draft.id;
          try {
            window.history.replaceState(null, "", `${window.location.pathname}?draft=${encodeURIComponent(body.draft.id)}`);
            window.localStorage.removeItem(LEGACY_DRAFT_KEY);
          } catch { /* 無くても動く */ }
        }
        setSaveState("saved");
        setSavedAt(clockLabel());
        return true;
      } catch {
        setSaveMessage("通信できませんでした。");
        setSaveState("error");
        return false;
      }
    };
    const next = chainRef.current.then(run, run);
    chainRef.current = next;
    return next as Promise<boolean>;
  }, []);

  useEffect(() => {
    if (isArticle || locked || loading || !editedRef.current) return;
    const current = fieldsRef.current;
    if (!idRef.current && !current.title.trim() && !current.body.trim()) return;
    const timer = window.setTimeout(() => { void persist(); }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveTick, isArticle, locked, loading, persist]);

  /* ---------- 画像 ---------- */
  const chooseImage = (purpose: "body" | "cover") => {
    filePurposeRef.current = purpose;
    fileRef.current?.click();
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("image");
    setNotice({ kind: "none" });
    try {
      // 画像の付け先になる下書きが無ければ先に作る（記事の編集中は記事そのものが付け先）。
      let targetId = isArticle ? articleId : idRef.current;
      if (!targetId) {
        if (!(await persist())) throw new Error("下書きを保存できなかったため、画像を付けられませんでした。");
        targetId = idRef.current;
      }
      const picked = await prepareImage(file);
      const [imageId] = await uploadPickedImages([picked], true);
      const response = await fetch("/api/articles/images", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId, imageId }),
      });
      if (!response.ok) throw new Error(await readError(response, "画像を付けられませんでした"));
      const body = await response.json() as { image: { id: string; url: string } };
      if (filePurposeRef.current === "cover") {
        update({ coverImageId: body.image.id });
      } else {
        insertText(`\n\n![${file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "画像の説明"}](${body.image.url})\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error && !["type", "size"].includes(error.message) && error.message !== "blob"
        ? error.message : imageErrorMessage(error, true);
      setNotice({ kind: "error", message });
    } finally {
      setBusy(null);
    }
  };

  /* ---------- Markdownの読み込み ---------- */
  const applyMarkdown = (result: MarkdownImportResult, name: string, mode: "replace" | "append") => {
    const current = fieldsRef.current;
    const body = mode === "append" && current.body.trim() ? `${current.body.trimEnd()}\n\n${result.body}` : result.body;
    if (articleCharacterCount(body) > MARKDOWN_IMPORT_BODY_MAX) {
      setMarkdownReview(null);
      setNotice({ kind: "error", message: `追加すると本文が${MARKDOWN_IMPORT_BODY_MAX.toLocaleString("ja-JP")}字を超えます。` });
      return;
    }
    const patch: Partial<Fields> = { body };
    if (!current.title.trim() && result.title) patch.title = result.title;
    if (!current.summary.trim() && result.summary) patch.summary = result.summary;
    if (result.tags.length) patch.tags = normalizeArticleTags([...normalizeArticleTags(current.tags), ...result.tags]).join("、");
    update(patch);
    setMarkdownReview(null);
    setMarkdownReport(describeMarkdownImport(result, name));
  };

  const readMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const fail = (message: string) => setNotice({ kind: "error", message });
    if (file.size > MARKDOWN_IMPORT_MAX_BYTES) { fail("読み込めるのは1MBまでのファイルです。"); return; }
    if (!/\.(?:md|markdown|txt)$/iu.test(file.name) && !/^text\//u.test(file.type)) { fail("読み込めるのは .md または .txt のファイルです。"); return; }
    let text: string;
    try { text = await file.text(); } catch { fail("ファイルを読めませんでした。"); return; }
    if (text.includes("\u0000")) { fail("テキストのファイルではないようです。"); return; }
    const result = importMarkdown(text, { useTitle: !fieldsRef.current.title.trim() });
    if (!result.body && !result.title) { fail("取り込める本文がありませんでした。"); return; }
    setNotice({ kind: "none" });
    setMarkdownReport(null);
    if (fieldsRef.current.body.trim()) setMarkdownReview({ name: file.name, result });
    else applyMarkdown(result, file.name, "replace");
  };

  /* ---------- 本文の書式ボタン ---------- */
  const insertText = (text: string) => {
    const area = textareaRef.current;
    const value = fieldsRef.current.body;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    update({ body: value.slice(0, start) + text + value.slice(end) });
    window.requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(start + text.length, start + text.length); });
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const area = textareaRef.current;
    const value = fieldsRef.current.body;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || placeholder;
    update({ body: value.slice(0, start) + before + selected + after + value.slice(end) });
    window.requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  /** 選択範囲の各行の頭に記号を付ける（見出し・引用・箇条書き）。付いていれば外す。 */
  const prefixLines = (prefix: string) => {
    const area = textareaRef.current;
    const value = fieldsRef.current.body;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIndex = value.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const allPrefixed = lines.every((line) => line.startsWith(prefix));
    const next = lines.map((line) => (allPrefixed ? line.slice(prefix.length) : `${prefix}${line}`)).join("\n");
    update({ body: value.slice(0, lineStart) + next + value.slice(lineEnd) });
    window.requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(lineStart, lineStart + next.length); });
  };

  const insertCode = () => {
    const area = textareaRef.current;
    const value = fieldsRef.current.body;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    if (selected.includes("\n")) wrapSelection("\n```\n", "\n```\n", "コード");
    else wrapSelection("`", "`", "コード");
  };

  const submitAsk = () => {
    if (!ask) return;
    const url = ask.value.trim();
    if (!url) { setAsk(null); return; }
    if (ask.kind === "link") wrapSelection("[", `](${url})`, "リンクの文字");
    else insertText(`\n\n${url}\n\n`);
    setAsk(null);
  };

  /* ---------- 公開・予約・更新・取り下げ ---------- */
  const tags = useMemo(() => normalizeArticleTags(fields.tags), [fields.tags]);
  const bodyLength = articleCharacterCount(fields.body);
  const summaryLength = articleCharacterCount(fields.summary);
  const ready = Boolean(fields.title.trim()) && bodyLength > 0;
  const post = (url: string, init: RequestInit) => fetch(url, { ...init, headers: { "content-type": "application/json", accept: "application/json" } });

  const publishNow = async () => {
    if (!ready || busy) return;
    setBusy("publish");
    setNotice({ kind: "none" });
    try {
      if (!(await persist())) { setBusy(null); return; }
      const response = await post(`${DRAFTS_ENDPOINT}/${encodeURIComponent(idRef.current!)}/publish`, { method: "POST", body: "{}" });
      if (response.status === 401) { setSaveState("signin"); return; }
      if (!response.ok) { setNotice({ kind: "error", message: await readError(response, "公開できませんでした") }); return; }
      const body = await response.json() as { href: string };
      setDone(true);
      setSettingsOpen(false);
      setNotice({ kind: "published", href: body.href });
    } catch {
      setNotice({ kind: "error", message: "通信できませんでした。接続を確認して、もう一度試してください。" });
    } finally {
      setBusy(null);
    }
  };

  const schedule = async () => {
    if (!ready || busy || !scheduleInput) return;
    const time = new Date(scheduleInput);
    if (Number.isNaN(time.getTime())) { setNotice({ kind: "error", message: "公開日時が正しくありません。" }); return; }
    setBusy("schedule");
    setNotice({ kind: "none" });
    try {
      if (!(await persist())) return;
      const response = await post(`${DRAFTS_ENDPOINT}/${encodeURIComponent(idRef.current!)}/publish`, { method: "POST", body: JSON.stringify({ publishAt: time.toISOString() }) });
      if (!response.ok) { setNotice({ kind: "error", message: await readError(response, "予約できませんでした") }); return; }
      const body = await response.json() as { publishAt: string };
      setScheduledAt(body.publishAt);
      setScheduleError(null);
      setNotice({ kind: "scheduled", at: body.publishAt });
    } catch {
      setNotice({ kind: "error", message: "通信できませんでした。" });
    } finally {
      setBusy(null);
    }
  };

  const cancelSchedule = async () => {
    if (!idRef.current || busy) return;
    setBusy("schedule");
    try {
      const response = await post(`${DRAFTS_ENDPOINT}/${encodeURIComponent(idRef.current)}/publish`, { method: "DELETE" });
      if (response.ok) { setScheduledAt(null); setNotice({ kind: "none" }); }
      else setNotice({ kind: "error", message: await readError(response, "予約を取り消せませんでした") });
    } finally {
      setBusy(null);
    }
  };

  const updatePublished = async () => {
    if (!articleId || !ready || busy) return;
    setBusy("update");
    setNotice({ kind: "none" });
    try {
      const current = fieldsRef.current;
      const gateChanged = current.accessGateId !== loadedGateRef.current;
      const licenseChanged = current.license !== loadedLicenseRef.current;
      const response = await post(`/api/articles/${encodeURIComponent(articleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: current.title, summary: current.summary, body: current.body, publicPreface: current.publicPreface, tags: normalizeArticleTags(current.tags),
          coverImageId: current.coverImageId, audience: current.audience,
          ...(gateChanged ? { accessGateId: current.accessGateId } : {}),
          ...(licenseChanged ? { license: current.license } : {}),
        }),
      });
      if (response.status === 401) { setSaveState("signin"); return; }
      if (!response.ok) { setNotice({ kind: "error", message: await readError(response, "更新できませんでした") }); return; }
      loadedGateRef.current = current.accessGateId;
      loadedLicenseRef.current = current.license;
      setRevisionCount((count) => count + 1);
      setSaveState("updated");
      setSavedAt(clockLabel());
    } catch {
      setNotice({ kind: "error", message: "通信できませんでした。" });
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    if (!articleId || busy) return;
    if (!window.confirm("この記事の公開をやめます。記事は消えず、いつでも下書きの一覧から内容を確認できます。取り下げますか？")) return;
    setBusy("withdraw");
    try {
      const response = await post(`/api/articles/${encodeURIComponent(articleId)}`, { method: "DELETE" });
      if (!response.ok) { setNotice({ kind: "error", message: await readError(response, "取り下げられませんでした") }); return; }
      setMode({ kind: "article", status: "withdrawn" });
      setSettingsOpen(false);
      setNotice({ kind: "withdrawn" });
    } finally {
      setBusy(null);
    }
  };

  /* ---------- 表示 ---------- */
  const statusText = loading ? "読み込み中…"
    : locked ? (isArticle ? "取り下げ済み" : "公開しました")
      : saveState === "saving" ? "保存中…"
        : saveState === "saved" ? `保存しました${savedAt ? ` ${savedAt}` : ""}`
          : saveState === "updated" ? `更新しました${savedAt ? ` ${savedAt}` : ""}`
            : saveState === "signin" ? "ログインすると保存できます"
              : saveState === "error" ? (saveMessage || "保存できませんでした")
                : isArticle ? `公開中の記事${revisionCount ? ` ・ 編集履歴 ${revisionCount}件` : ""}`
                  : scheduledAt ? `${formatWhen(scheduledAt)} に公開予定` : "自動で保存されます";

  const toolbar: Array<[string, string, () => void]> = [
    ["見出し", "H", () => prefixLines("## ")],
    ["太字", "B", () => wrapSelection("**", "**", "太字")],
    ["リンク", "link", () => setAsk({ kind: "link", value: "" })],
    ["引用", "”", () => prefixLines("> ")],
    ["コード", "</>", insertCode],
    ["箇条書き", "・", () => prefixLines("- ")],
    ["画像", "img", () => chooseImage("body")],
    ["YouTube", "▶", () => setAsk({ kind: "youtube", value: "" })],
  ];

  /* 題と本文は中身の高さに合わせて伸ばす（固定の箱にしない）。 */
  useLayoutEffect(() => {
    for (const element of [titleRef.current, textareaRef.current]) {
      if (!element) continue;
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
  }, [fields.title, fields.body, preview, loading]);

  const onBodyKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() === "b") { event.preventDefault(); wrapSelection("**", "**", "太字"); }
    else if (event.key.toLowerCase() === "k") { event.preventDefault(); setAsk({ kind: "link", value: "" }); }
  };

  if (loadError) {
    const needsSignIn = loadError === "ログインが必要です。";
    return <div className="hub-composer">
      <V2State
        kind={needsSignIn ? "signedOut" : "error"}
        next={needsSignIn ? "/v2/articles/new" : undefined}
        title={loadError}
        action={needsSignIn ? undefined : { label: "下書きの一覧へ", href: "/v2/articles/drafts" }}
      />
    </div>;
  }

  return <div className="hub-composer">
    <header className="hub-composer__bar">
      <p className="hub-composer__status" role="status" aria-live="polite" data-state={saveState}>{statusText}</p>
      <div className="hub-composer__actions">
        <Link href="/v2/articles/drafts" className="hub-composer__quiet hub-composer__wide">下書き・自分の記事</Link>
        <button type="button" className="hub-composer__quiet hub-composer__wide" aria-expanded={settingsOpen} aria-controls="composer-settings" onClick={() => setSettingsOpen((open) => !open)} disabled={locked}>公開設定</button>
        <button type="button" className="hub-composer__quiet hub-composer__wide" aria-pressed={preview} onClick={() => setPreview((open) => !open)}>{preview ? "編集に戻る" : "プレビュー"}</button>
        <div className="hub-composer__overflow">
          <button type="button" className="hub-composer__icon" aria-label="その他のメニュー" title="その他" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)}><V2Icon name="more" /></button>
          {menuOpen ? (
            <div className="hub-composer__menu" role="menu" onClick={() => setMenuOpen(false)}>
              <Link href="/v2/articles/drafts" role="menuitem">下書き・自分の記事</Link>
              <button type="button" role="menuitem" aria-expanded={settingsOpen} aria-controls="composer-settings" onClick={() => setSettingsOpen((open) => !open)} disabled={locked}>公開設定</button>
              <button type="button" role="menuitem" aria-pressed={preview} onClick={() => setPreview((open) => !open)}>{preview ? "編集に戻る" : "プレビュー"}</button>
            </div>
          ) : null}
        </div>
        {isArticle
          ? <button type="button" className="hub-composer__primary" onClick={updatePublished} disabled={!ready || locked || busy !== null || loading}>{busy === "update" ? "更新中…" : "更新する"}</button>
          : <button type="button" className="hub-composer__primary" onClick={publishNow} disabled={!ready || locked || busy !== null || loading}>{busy === "publish" ? "公開中…" : "公開する"}</button>}
      </div>

      {settingsOpen && !locked ? (
        <section id="composer-settings" className="hub-composer__settings" aria-label="公開設定">
          <label className="hub-composer__field">
            <span>{fields.accessGateId ? "要約（鍵つきの記事では、一覧と検索に出ません）" : "要約（一覧と検索に出ます。空なら本文の頭から作ります）"}</span>
            <textarea value={fields.summary} onChange={(event) => update({ summary: event.target.value })} rows={2} />
            <small className={summaryLength > SUMMARY_GUIDE ? "hub-composer__count hub-composer__count--over" : "hub-composer__count"}>{summaryLength} / {SUMMARY_GUIDE}字</small>
          </label>
          <div className="hub-composer__field">
            <V2TagInput value={tags} onChange={(next) => update({ tags: next.join("、") })} />
          </div>
          <fieldset className="hub-composer__choices">
            <legend>閲覧区分</legend>
            {([["general", "一般"], ["adult", "成人向け（18+）"]] as const).map(([value, label]) => (
              <label key={value} className={fields.audience === value ? "hub-composer__choice hub-composer__choice--on" : "hub-composer__choice"}>
                <input type="radio" name="composer-audience" value={value} checked={fields.audience === value} onChange={() => update({ audience: value })} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <V2AccessGateAttachToggle targetType="article" preselectGateId={articleId || draftId ? null : presetGateId} gateId={fields.accessGateId} onChange={(gateId) => update(gateId ? { accessGateId: gateId, license: "arr" } : { accessGateId: gateId })} disabled={busy !== null} />
          <V2ContentLicensePicker value={fields.license} onChange={(license) => update({ license })} disabled={busy !== null} gated={Boolean(fields.accessGateId)} editing={Boolean(articleId)} />
          {articleId ? (
            <V2ContentDownloadEditor targetType="article" targetId={articleId} license={fields.license} gated={Boolean(fields.accessGateId)} />
          ) : (
            <p className="v2-download-setting__note">公開したあと、この画面でダウンロードの許可を選べます。決めるまではダウンロードできません。</p>
          )}
          <fieldset className="hub-composer__choices">
            <legend>コメント</legend>
            {([[true, "受け付ける"], [false, "受け付けない"]] as const).map(([value, label]) => (
              <label key={label} className={commentsEnabled === value ? "hub-composer__choice hub-composer__choice--on" : "hub-composer__choice"}>
                <input type="radio" name="composer-comments" checked={commentsEnabled === value} onChange={() => { void changeComments(value); }} disabled={busy !== null} />
                <span>{label}</span>
              </label>
            ))}
            {commentsError ? <p className="hub-composer__requirement">{commentsError}</p> : null}
          </fieldset>
          {!isArticle ? (
            <div className="hub-composer__schedule">
              <label className="hub-composer__field">
                <span>予約公開（日時を決めて、その時刻に自動で公開します）</span>
                <input type="datetime-local" value={scheduleInput} onChange={(event) => setScheduleInput(event.target.value)} />
              </label>
              <div className="hub-composer__schedule-actions">
                <button type="button" className="hub-composer__ghost" onClick={schedule} disabled={!ready || !scheduleInput || busy !== null}>{busy === "schedule" ? "処理中…" : "この日時に予約"}</button>
                {scheduledAt ? <button type="button" className="hub-composer__ghost" onClick={cancelSchedule} disabled={busy !== null}>予約を取り消す</button> : null}
              </div>
              {scheduleError ? <p className="hub-composer__requirement">前回の予約は公開できませんでした：{scheduleError}</p> : null}
            </div>
          ) : (
            <div className="hub-composer__schedule">
              <button type="button" className="hub-composer__ghost hub-composer__danger" onClick={withdraw} disabled={busy !== null}>{busy === "withdraw" ? "処理中…" : "この記事を取り下げる"}</button>
              <p className="hub-composer__requirement">取り下げると一覧・検索・記事ページから見えなくなります。直前の内容は履歴に残ります。</p>
            </div>
          )}
        </section>
      ) : null}
    </header>

    {notice.kind !== "none" ? (
      <div className={`hub-composer__notice${notice.kind === "published" || notice.kind === "scheduled" ? " hub-composer__notice--done" : ""}`} role="status">
        <span>
          {notice.kind === "published" ? "記事を公開しました。" : null}
          {notice.kind === "scheduled" ? `${formatWhen(notice.at)} に公開します。それまで下書きとして残ります。` : null}
          {notice.kind === "withdrawn" ? "取り下げました。" : null}
          {notice.kind === "error" ? notice.message : null}
        </span>
        {notice.kind === "published" ? <Link href={notice.href}>記事を開く</Link> : null}
        {saveState === "signin" ? <Link href={hubSurfacePath(surface, "/auth")}>ログイン</Link> : null}
      </div>
    ) : null}
    {saveState === "signin" && notice.kind === "none" ? (
      <div className="hub-composer__notice" role="status"><span>保存にはログインが必要です。</span><Link href={hubSurfacePath(surface, "/auth")}>ログイン</Link></div>
    ) : null}

    {preview ? (
      <div className="v2-reader hub-composer__reader">
        <article className="hub-composer__preview" aria-label="記事のプレビュー">
          {fields.coverImageId ? <img className="hub-composer__preview-cover" src={imagePath(fields.coverImageId)} alt="" /> : null}
          <h2 className="v2-reader__title">{fields.title.trim() || "（無題）"}</h2>
          {fields.audience === "adult" ? <p className="hub-composer__preview-kicker">18+</p> : null}
          {tags.length ? <ul className="hub-composer__preview-tags">{tags.map((tag) => <li key={tag}>{tag}</li>)}</ul> : null}
          {bodyLength ? <ArticleBodyView body={fields.body} className="v2-reader__body hub-composer__preview-body" />
            : <p className="hub-composer__preview-empty">本文がまだありません。</p>}
        </article>
      </div>
    ) : (
      <div className="hub-composer__editor">
        <div className="hub-composer__cover">
          {fields.coverImageId ? (
            <>
              <img src={imagePath(fields.coverImageId)} alt="表紙の画像" />
              <div className="hub-composer__cover-actions">
                <button type="button" className="hub-composer__quiet" onClick={() => chooseImage("cover")} disabled={locked || busy !== null}>{busy === "image" ? "アップロード中…" : "変更"}</button>
                <button type="button" className="hub-composer__quiet" onClick={() => update({ coverImageId: null })} disabled={locked}>外す</button>
              </div>
            </>
          ) : (
            <button type="button" className="hub-composer__quiet" onClick={() => chooseImage("cover")} disabled={locked || busy !== null}>{busy === "image" ? "アップロード中…" : "表紙を追加"}</button>
          )}
        </div>
        <textarea
          ref={titleRef} rows={1} className="hub-composer__title" value={fields.title} onChange={(event) => update({ title: event.target.value.replace(/\n/g, " ") })}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); textareaRef.current?.focus(); } }}
          placeholder="タイトル" maxLength={120} autoComplete="off" aria-label="記事のタイトル" disabled={locked || loading}
        />
        <div className="hub-composer__toolbar" role="toolbar" aria-label="本文の書式">
          {toolbar.map(([label, , action]) => (
            <button type="button" key={label} title={label === "太字" ? "太字 (Ctrl+B)" : label === "リンク" ? "リンク (Ctrl+K)" : label} aria-label={label} onClick={action} disabled={locked || loading || (label === "画像" && busy === "image")}>{TOOL_ICONS[label]}</button>
          ))}
          <button type="button" className="hub-composer__import" onClick={() => markdownFileRef.current?.click()} disabled={locked || loading} title="Markdown（.md / .txt、1MBまで）を本文に読み込む">Markdownを読み込む</button>
          <span className="hub-composer__count">{bodyLength}字</span>
        </div>
        {markdownReview ? (
          <section className="hub-composer__import-review" aria-label="Markdownの読み込みの確認">
            <p><strong>「{markdownReview.name}」を読み込みます。</strong>いま書いている本文があります。どうしますか。</p>
            <dl>
              {markdownReview.result.title && !fields.title.trim() ? <><dt>題</dt><dd>{markdownReview.result.title}</dd></> : null}
              <dt>取り込む本文</dt><dd>{articleCharacterCount(markdownReview.result.body).toLocaleString("ja-JP")}字（いま {bodyLength.toLocaleString("ja-JP")}字）</dd>
            </dl>
            <pre className="hub-composer__import-preview" aria-label="取り込む本文の先頭">{Array.from(markdownReview.result.body).slice(0, 600).join("")}{articleCharacterCount(markdownReview.result.body) > 600 ? "\n…" : ""}</pre>
            {describeMarkdownImport(markdownReview.result, markdownReview.name).slice(1).map((line) => <p key={line} className="hub-composer__import-note">{line}</p>)}
            <div className="hub-composer__import-actions">
              <button type="button" className="hub-composer__primary" onClick={() => applyMarkdown(markdownReview.result, markdownReview.name, "replace")}>いまの本文を置き換える</button>
              <button type="button" className="hub-composer__ghost" onClick={() => applyMarkdown(markdownReview.result, markdownReview.name, "append")}>末尾に追加する</button>
              <button type="button" className="hub-composer__ghost" onClick={() => setMarkdownReview(null)}>やめる</button>
            </div>
          </section>
        ) : null}
        {markdownReport ? (
          <div className="hub-composer__import-report" role="status">
            <ul>{markdownReport.map((line) => <li key={line}>{line}</li>)}</ul>
            <button type="button" className="hub-composer__ghost" onClick={() => setMarkdownReport(null)}>閉じる</button>
          </div>
        ) : null}
        {ask ? (
          <form className="hub-composer__ask" onSubmit={(event) => { event.preventDefault(); submitAsk(); }}>
            <input
              type="url" autoFocus value={ask.value} onChange={(event) => setAsk({ ...ask, value: event.target.value })}
              placeholder={ask.kind === "link" ? "リンク先のURL（https://…）" : "YouTubeのURL"} aria-label={ask.kind === "link" ? "リンク先のURL" : "YouTubeのURL"}
              onKeyDown={(event) => { if (event.key === "Escape") setAsk(null); }}
            />
            <button type="submit" className="hub-composer__ghost">入れる</button>
            <button type="button" className="hub-composer__ghost" onClick={() => setAsk(null)}>やめる</button>
          </form>
        ) : null}
        <ComposerPublicPreface gated={Boolean(fields.accessGateId)} value={fields.publicPreface} onChange={(publicPreface) => update({ publicPreface })} disabled={locked || loading} />
        <textarea
          ref={textareaRef} className="hub-composer__body" value={fields.body} onChange={(event) => update({ body: event.target.value })}
          onKeyDown={onBodyKeyDown} placeholder="本文を書く…" aria-label="本文" disabled={locked || loading}
        />
      </div>
    )}
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={uploadImage} />
    <input ref={markdownFileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={readMarkdown} aria-label="Markdownのファイルを選ぶ" />
  </div>;
}
