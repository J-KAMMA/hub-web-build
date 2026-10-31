"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Sheet } from "@/components/v2/ui";

/*
 * キーボードの近道（2026-09-03、2026-10-14 に SPEC 1.7 へ広げた）。
 * パソコン幅が主なので、手をマウスへ戻さずに動けるようにする。
 *
 *   /   検索欄へ（その画面に無ければ検索の画面へ）
 *   n   投稿欄へ（フィード以外では投稿欄のあるフィードへ）
 *   j k 次の投稿・前の投稿を選ぶ（画面の中に入れる。選んだ投稿には輪郭が出る）
 *   o   選んだ投稿を開く
 *   l   選んだ投稿にいいね（もう一度で取り消し）
 *   r   選んだ投稿の返信へ
 *   t   選んだ投稿のリポストの操作を開く（その場でリポストはしない。メニューで選ぶ）
 *   b   選んだ投稿を保存（もう一度で外す）
 *   Esc 選択を外す
 *   ?   この一覧を出す
 *
 * 文字を打っている間（input・textarea・contenteditable）と、修飾キー付きは何もしない。
 * 開いているシートやダイアログの背後でも作動しない。焦点の移動は既存の article に
 * tabIndex を足して行い、DOM を書き換えるのは焦点と data-kbd-selected だけ。
 * 操作の押し手は本文側の部品に任せ、ここは押し手の名前（title）で探して押すだけにする
 * （投稿の部品がどう変わっても、名前が同じなら動く）。
 */

const HELP_EVENT = "v2:shortcuts-open";

const KEYS: [string, string, string][] = [
  ["/", "検索欄へ", "Focus search"],
  ["n", "投稿欄へ", "Focus compose"],
  ["j / k", "次・前の投稿を選ぶ", "Next / previous post"],
  ["o", "選んだ投稿を開く", "Open the post"],
  ["l", "いいね", "Like"],
  ["r", "返信", "Reply"],
  ["t", "リポスト", "Repost"],
  ["b", "保存", "Save"],
  ["Esc", "選択を外す・閉じる", "Clear selection / close"],
  ["?", "この一覧", "This list"],
];

const SELECTED = "data-kbd-selected";

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable
    || element.getAttribute?.("role") === "textbox";
}

function openHelp() {
  window.dispatchEvent(new Event(HELP_EVENT));
}

function postsOnPage() {
  return [...document.querySelectorAll<HTMLElement>("article.v2-post:not(.v2-post--removed)")];
}

/* 選択中の投稿。焦点のある投稿を先に、無ければ data-kbd-selected の付いたもの。 */
function currentPost(): HTMLElement | null {
  const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("article.v2-post");
  return focused ?? document.querySelector<HTMLElement>(`article.v2-post[${SELECTED}]`);
}

function clearSelection() {
  for (const node of document.querySelectorAll(`[${SELECTED}]`)) node.removeAttribute(SELECTED);
}

function select(post: HTMLElement) {
  clearSelection();
  post.setAttribute(SELECTED, "true");
  if (!post.hasAttribute("tabindex")) post.setAttribute("tabindex", "-1");
  post.focus({ preventScroll: true });
  post.scrollIntoView({ block: "center" });
}

/* 押し手を名前（title、無ければ字）で探す。名前は日英の両方を受ける。 */
function actionIn(post: HTMLElement, names: string[]): HTMLElement | null {
  const wanted = new Set(names);
  for (const control of post.querySelectorAll<HTMLElement>(".v2-post__actions button, .v2-post__actions a")) {
    const label = control.getAttribute("title") ?? control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "";
    if (wanted.has(label) && !(control as HTMLButtonElement).disabled) return control;
  }
  return null;
}

export function V2Hotkeys({ japanese }: { japanese: boolean }) {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onHelp = () => setHelpOpen(true);
    window.addEventListener(HELP_EVENT, onHelp);
    return () => window.removeEventListener(HELP_EVENT, onHelp);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      if (typing(event.target)) return;

      if (event.key === "Escape") {
        if (document.querySelector(`[${SELECTED}]`)) {
          clearSelection();
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        const inputs = [
          ...document.querySelectorAll<HTMLInputElement>('.v2__main input[type="search"]'),
          ...document.querySelectorAll<HTMLInputElement>('input[type="search"]'),
        ];
        const search = inputs.find(input => !input.disabled && !input.closest("[inert]")
          && input.getClientRects().length > 0 && getComputedStyle(input).visibility === "visible");
        if (search) { search.focus(); search.select(); } else router.push("/v2/search");
        return;
      }
      if (event.key === "n") {
        event.preventDefault();
        const compose = document.querySelector<HTMLTextAreaElement>("#compose textarea");
        if (compose) { compose.focus(); compose.scrollIntoView({ block: "center" }); } else router.push("/v2#compose");
        return;
      }
      if (event.key === "j" || event.key === "k") {
        const posts = postsOnPage();
        if (!posts.length) return;
        event.preventDefault();
        const selected = currentPost();
        const current = selected ? posts.indexOf(selected) : -1;
        const next = event.key === "j" ? Math.min(posts.length - 1, current + 1) : Math.max(0, current === -1 ? 0 : current - 1);
        select(posts[next]);
        return;
      }
      if (event.key === "o") {
        const post = currentPost();
        const link = post?.querySelector<HTMLAnchorElement>("a[href^='/v2/posts/']");
        if (link) { event.preventDefault(); router.push(link.getAttribute("href") ?? "/v2"); }
        return;
      }
      if (event.key === "l" || event.key === "r" || event.key === "t" || event.key === "b") {
        const post = currentPost();
        if (!post) return;
        const control = event.key === "l" ? actionIn(post, ["いいね", "Like"])
          : event.key === "r" ? actionIn(post, ["返信", "Reply"])
          : event.key === "t" ? actionIn(post, ["リポストの操作", "Repost options"])
          : actionIn(post, ["保存", "保存済み", "Save", "Saved"]);
        if (!control) return;
        event.preventDefault();
        control.click();
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        openHelp();
      }
    };
    const onPointer = () => clearSelection();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [router]);

  const title = japanese ? "キーボードの近道" : "Keyboard shortcuts";
  return (
    <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title={title} className="v2-hotkeys__sheet">
      <dl className="v2-hotkeys__list">
        {KEYS.map(([key, ja, en]) => (
          <div key={key}><dt><kbd>{key}</kbd></dt><dd>{japanese ? ja : en}</dd></div>
        ))}
      </dl>
      <p className="v2-note">{japanese ? "入力中は作動しません。Escでも閉じられます。" : "Inactive while typing. Press Esc to close."}</p>
      <button type="button" className="v2-button v2-button--text v2-hotkeys__close" onClick={() => setHelpOpen(false)}>
        <span className="v2-button__label">{japanese ? "閉じる" : "Close"}</span>
      </button>
    </Sheet>
  );
}

export function V2ShortcutButton({ japanese }: { japanese: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const label = japanese ? "キーボードの近道" : "Keyboard shortcuts";
  return <button type="button" className="v2-nav__item v2-nav__shortcut" title={label}
    aria-haspopup="dialog" disabled={!ready} onClick={openHelp}>
    <span className="v2-nav__icon v2-nav__shortcut-mark" aria-hidden="true">?</span>
    <span className="v2-nav__label">{japanese ? "ショートカット" : "Shortcuts"}</span>
  </button>;
}
