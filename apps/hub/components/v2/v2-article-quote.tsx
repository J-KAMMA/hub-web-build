"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { articleQuotePostBody, mergeQuoteIntoDraft, normalizeArticleQuote } from "@/lib/article-quote";
import { contentShareHref } from "@/lib/content-share";
import "./v2-article-quote.css";

/*
 * 記事の本文で一節を選ぶと、近くに「引用して投稿」を出す。押すと、投稿の下書き
 * （V2Compose と同じ localStorage の鍵）に「> 引用」と記事のリンクを入れて投稿画面へ移る。
 * 鍵付きの記事には置かない（v2-article-quote-gate.tsx が判定して出さない）。
 * スマホは選択の端をドラッグし終わるまで selectionchange が続くので、少し待ってから出す。
 */

const SETTLE_MS = 250;
const BODY_SELECTOR = ".v2-reader__content .v2-reader__body";
const BUTTON_WIDTH = 150;

type Anchor = { text: string; x: number; y: number };

function insideBody(node: Node | null): boolean {
  const body = document.querySelector(BODY_SELECTOR);
  if (!body || !node) return false;
  return body.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

export function V2ArticleQuoteButton({ articleId, viewerId, japanese = true }: { articleId: string; viewerId: string | null; japanese?: boolean }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const timer = useRef<number | null>(null);
  const articlePath = `/v2/articles/${articleId}`;

  const evaluate = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) { setAnchor(null); return; }
    const range = selection.getRangeAt(0);
    if (!insideBody(range.startContainer) || !insideBody(range.endContainer)) { setAnchor(null); return; }
    const text = normalizeArticleQuote(selection.toString());
    if (!text) { setAnchor(null); return; }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { setAnchor(null); return; }
    const margin = 8;
    const width = Math.min(BUTTON_WIDTH, window.innerWidth - margin * 2);
    const x = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, margin), window.innerWidth - width - margin);
    // 端末の選択メニューは選択の上に出ることが多いので、下に置く。足りなければ上。
    const below = rect.bottom + 10;
    const y = below + 44 < window.innerHeight ? below : Math.max(margin, rect.top - 54);
    setAnchor({ text, x, y });
  }, []);

  useEffect(() => {
    const schedule = (delay: number) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(evaluate, delay);
    };
    const onChange = () => schedule(SETTLE_MS);
    const onPointerEnd = () => schedule(0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnchor(null);
      else if (event.shiftKey) schedule(SETTLE_MS);
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("mouseup", onPointerEnd);
    document.addEventListener("keyup", onKey);
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("mouseup", onPointerEnd);
      document.removeEventListener("keyup", onKey);
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [evaluate]);

  if (!anchor) return null;

  const label = japanese ? "引用して投稿" : "Quote in a post";
  const fullLabel = japanese ? "選んだ文章を引用して投稿する" : "Quote the selected text in a post";

  const quote = () => {
    const body = articleQuotePostBody(anchor.text, articlePath, window.location.origin);
    const shareHref = contentShareHref(articlePath);
    if (!body || !shareHref) { setAnchor(null); return; }
    if (!viewerId) {
      // 未ログインは下書きを置けないので、紹介リンクつきでログインへ。
      router.push(`/v2/auth?next=${encodeURIComponent(shareHref)}`);
      return;
    }
    try {
      const key = `hub.post-draft.${viewerId}`;
      window.localStorage.setItem(key, mergeQuoteIntoDraft(window.localStorage.getItem(key), body));
      window.localStorage.removeItem(`${key}.v2-metadata`);
      router.push("/v2?social=post&feed=latest#compose");
    } catch {
      // 端末の保存が使えないときは、記事へのリンクだけを持って投稿画面を開く。
      router.push(shareHref);
    }
    setAnchor(null);
  };

  return (
    <div className="v2-article-quote" style={{ left: anchor.x, top: anchor.y }} role="presentation">
      <button
        type="button"
        className="v2-article-quote__button"
        aria-label={fullLabel}
        title={fullLabel}
        // 押した瞬間に選択が外れないようにする。
        onMouseDown={(event) => event.preventDefault()}
        onClick={quote}
      >
        {label}
      </button>
    </div>
  );
}
