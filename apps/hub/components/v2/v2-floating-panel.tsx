"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Icon } from "@/components/v2/v2-icons";

/*
 * 浮かせる盤（2026-09-03、旦那様「つかんでいどうできるようにしたい」→「動画側も」）。
 * 音楽と動画で同じ物を使う。中身だけが違う。
 *
 * つかむのは**取っ手だけ**。絵（YouTube の iframe）の上には何も置かない決まりなので、
 * 絵そのものを掴ませることはできない。
 * 取っ手が指を捕まえる（setPointerCapture）ので、絵の上を通っても付いてくる。
 * 捕まえないと iframe に指を取られて、そこで止まる。
 */

/* 端から離しておく余白。掴んで動かしても盤が画面の外へ出ない。 */
const EDGE = 8;

/*
 * 机上（760px 以上）では盤を浮かせない。右列が開いていればその底に、閉じていれば右の帯の
 * 左に置いて、本文には重ねない（2026-10-17、プレーヤーが画面から切れて本文を覆っていた）。
 * 重ならないぶんは、盤が html に書く寸法で空ける。
 *   data-v2-dock="aside"  右列の底。--v2-dock-reserve ＝ 盤の高さ分を右列の中身の下に空ける
 *   data-v2-dock="edge"   右列が閉じている間。--v2-dock-reserve ＝ 盤の幅分を本文の右に空ける
 * 携帯（760 未満）は従来どおり浮かせ、掴んで動かせる（端から出ないよう clamp 済み）。
 */
const DOCK_MIN_WIDTH = 760;
const DOCK_GAP = 12;
const DOCK_ASIDE_PAD = 16;
const DOCK_WIDTH = 380;
const DOCK_LIST_FLOOR = 96;

export function V2FloatingPanel({
  label,
  positionKey,
  title,
  subtitle,
  onClose,
  closeLabel,
  className,
  children,
}: {
  label: string;
  /* 置いた場所を覚える鍵。音楽と動画で別にする。 */
  positionKey: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
  closeLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const grabRef = useRef<{ dx: number; dy: number } | null>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  positionRef.current = position;

  /* 画面の中に収める。盤の大きさは中身で変わるので、そのつど測る。 */
  const clamp = useCallback((x: number, y: number) => {
    const panel = panelRef.current;
    const width = panel?.offsetWidth ?? 380;
    const height = panel?.offsetHeight ?? 360;
    return {
      x: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    };
  }, []);

  const remember = useCallback((next: { x: number; y: number } | null) => {
    try {
      if (next) window.localStorage.setItem(positionKey, JSON.stringify(next));
      else window.localStorage.removeItem(positionKey);
    } catch {
      /* 覚えられなくても、その場では動く */
    }
  }, [positionKey]);

  /* 前に置いた場所を思い出す。 */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(positionKey);
      const parsed = raw ? JSON.parse(raw) as unknown : null;
      if (parsed && typeof parsed === "object" && "x" in parsed && "y" in parsed) {
        const { x, y } = parsed as { x: number; y: number };
        if (Number.isFinite(x) && Number.isFinite(y)) setPosition({ x, y });
      }
    } catch {
      /* 読めなければ既定の右下 */
    }
  }, [positionKey]);

  /* 窓の大きさが変わったら、はみ出したぶんだけ戻す。 */
  useEffect(() => {
    const onResize = () => {
      const current = positionRef.current;
      if (!current) return;
      setPosition(clamp(current.x, current.y));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const root = document.documentElement;
    const vars = ["--dock-left", "--dock-right", "--dock-width", "--dock-bottom", "--dock-max-h"];
    const release = () => {
      panel.removeAttribute("data-dock");
      for (const name of vars) panel.style.removeProperty(name);
      root.removeAttribute("data-v2-dock");
      root.style.removeProperty("--v2-dock-reserve");
    };
    let frame = 0;
    const place = () => {
      frame = 0;
      if (window.innerWidth < DOCK_MIN_WIDTH) { release(); return; }
      const aside = document.querySelector<HTMLElement>(".v2__aside:not([hidden])");
      for (const name of vars) panel.style.removeProperty(name);
      if (aside) {
        const box = aside.getBoundingClientRect();
        const width = Math.round(box.width - DOCK_ASIDE_PAD * 2);
        panel.style.setProperty("--dock-left", `${Math.round(box.left + DOCK_ASIDE_PAD)}px`);
        panel.style.setProperty("--dock-width", `${width}px`);
        panel.style.setProperty("--dock-bottom", `${Math.round(window.innerHeight - box.bottom + DOCK_ASIDE_PAD)}px`);
        panel.style.setProperty("--dock-max-h", `${Math.max(200, Math.round(box.height - DOCK_ASIDE_PAD * 2 - DOCK_LIST_FLOOR))}px`);
        panel.setAttribute("data-dock", "aside");
        root.setAttribute("data-v2-dock", "aside");
        root.style.setProperty("--v2-dock-reserve", `${panel.offsetHeight + DOCK_ASIDE_PAD}px`);
        return;
      }
      const strip = document.querySelector<HTMLElement>(".v2__aside-strip:not([data-pending])");
      const stripBox = strip && strip.offsetWidth > 0 ? strip.getBoundingClientRect() : null;
      const right = stripBox ? Math.round(window.innerWidth - stripBox.left + DOCK_GAP) : DOCK_GAP;
      const width = Math.min(DOCK_WIDTH, window.innerWidth - right - DOCK_GAP);
      panel.style.setProperty("--dock-right", `${right}px`);
      panel.style.setProperty("--dock-width", `${width}px`);
      panel.style.setProperty("--dock-bottom", `${DOCK_GAP}px`);
      panel.style.setProperty("--dock-max-h", `${window.innerHeight - DOCK_GAP * 2}px`);
      panel.setAttribute("data-dock", "edge");
      root.setAttribute("data-v2-dock", "edge");
      root.style.setProperty("--v2-dock-reserve", `${width + DOCK_GAP * 2}px`);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(place); };
    place();
    window.addEventListener("resize", schedule);
    const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    sizes?.observe(panel);
    const watch = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    const workspace = document.querySelector(".v2__workspace") ?? document.body;
    watch?.observe(workspace, { attributes: true, attributeFilter: ["hidden", "style", "data-state"], childList: true, subtree: true });
    return () => {
      window.removeEventListener("resize", schedule);
      sizes?.disconnect();
      watch?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      release();
    };
  }, []);

  const grabStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const panel = panelRef.current;
    if (!panel || event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    grabRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setPosition(clamp(rect.left, rect.top));
  };

  const grabMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const grab = grabRef.current;
    if (!grab) return;
    event.preventDefault();
    setPosition(clamp(event.clientX - grab.dx, event.clientY - grab.dy));
  };

  const grabEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!grabRef.current) return;
    grabRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    remember(positionRef.current);
  };

  /* 矢印キーでも動かす（16px、Shift で48px）。Esc で既定の右下へ戻す。 */
  const grabKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const rect = panelRef.current?.getBoundingClientRect();
    const from = positionRef.current ?? (rect ? { x: rect.left, y: rect.top } : null);
    if (event.key === "Escape" || event.key === "Home") {
      event.preventDefault();
      setPosition(null);
      remember(null);
      return;
    }
    if (!from) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const next = clamp(from.x + move[0], from.y + move[1]);
    setPosition(next);
    remember(next);
  };

  return (
    <aside
      ref={panelRef}
      className={className ? `v2-player ${className}` : "v2-player"}
      aria-label={label}
      data-dragging={dragging ? "true" : undefined}
      style={position ? { left: `${position.x}px`, top: `${position.y}px`, right: "auto", bottom: "auto" } : undefined}
    >
      <header className="v2-player__head">
        <button
          type="button"
          className="v2-player__grip"
          aria-label={`${label}をつかんで動かす。矢印キーでも動かせます。Escで右下へ戻ります`}
          title="つかんで動かす"
          onPointerDown={grabStart}
          onPointerMove={grabMove}
          onPointerUp={grabEnd}
          onPointerCancel={grabEnd}
          onKeyDown={grabKey}
        >
          <V2Icon name="grip" />
        </button>
        <div className="v2-player__now">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        <V2Button icon="close" label={closeLabel} onClick={onClose} />
      </header>
      {children}
    </aside>
  );
}
