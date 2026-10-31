/*
 * v2 の記号。既存のアイコンと同じ描き方（fill: none / stroke: currentColor /
 * 太さ1.75px / 端は丸）。全部 24×24 の座標で描き、大きさは CSS が決める
 * （20 / 22 / 24 の3段、--icon-sm / -md / -lg）。線は vector-effect:
 * non-scaling-stroke で、どの大きさでも 1.75px（v2-foundation.css）。
 * "use client" を付けない。サーバーの部品からもクライアントの部品からも使う。
 *
 * 旦那様の方針「ボタンはマーク化される」（2026-09-02）。名前は消さず、
 * V2Button が読み上げと title に残す。
 */

import { createElement } from "react";

export type V2IconName =
  | "heart"
  | "bookmark"
  | "reply"
  | "quote"
  | "play"
  | "pause"
  | "external"
  | "edit"
  | "trash"
  | "flag"
  | "pin"
  | "mute"
  | "block"
  | "message"
  | "plus"
  | "check"
  | "close"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "link-off"
  | "open"
  | "repeat"
  | "share"
  | "more"
  | "home"
  | "search"
  | "bell"
  | "mail"
  | "people"
  | "threads"
  | "research"
  | "game"
  | "list"
  | "book"
  | "article"
  | "video"
  | "music"
  | "store"
  | "wallet"
  | "settings"
  | "user"
  | "sparkle"
  | "ai"
  | "clock"
  | "lock"
  | "trending"
  | "globe"
  | "volume"
  | "volume-off"
  | "grip"
  | "menu"
  | "apps"
  | "timeline"
  | "shorts"
  | "history"
  | "playlist"
  | "compose"
  | "alert"
  | "help"
  | "refresh"
  | "inbox";

/*
 * 複数の図形でできた記号。デスクトップ（apps/hub-desktop/ui/index.html）の
 * 左レールの図形をそのまま写す。ずれないよう v2-icons-desktop.test.ts が
 * 照合する。色は currentColor のみ。
 */
export type V2Shape =
  | { tag: "path"; d: string; fill?: string }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx?: number }
  | { tag: "circle"; cx: number; cy: number; r: number };

const SHAPES = {
  apps: [
    { tag: "rect", x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
    { tag: "rect", x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
    { tag: "rect", x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
    { tag: "rect", x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
  ],
  mail: [
    { tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
    { tag: "path", d: "m3 7 9 6 9-6" },
  ],
  video: [
    { tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
    { tag: "path", d: "m10 9 5 3-5 3V9Z" },
  ],
  music: [
    { tag: "path", d: "M9 17V5l10-2v12M9 7l10-2" },
    { tag: "circle", cx: 6.5, cy: 18, r: 2.5 },
    { tag: "circle", cx: 16.5, cy: 16, r: 2.5 },
  ],
  ai: [
    { tag: "rect", x: 3, y: 3, width: 18, height: 18, rx: 5 },
    { tag: "path", fill: "none", d: "M7.5 16.5 10.25 8l2.75 8.5M8.5 13.3H12M16.5 8v8.5" },
  ],
  wallet: [
    { tag: "path", d: "M4 7V5.5A2.5 2.5 0 0 1 6.5 3H18M5 7h14a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" },
    { tag: "path", d: "M16 12h5v5h-5a2.5 2.5 0 0 1 0-5Z" },
  ],
  compose: [
    { tag: "path", d: "M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" },
    { tag: "path", d: "m10 14 7.5-7.5a1.8 1.8 0 0 1 2.5 2.5L12.5 16.5 9 17l1-3Z" },
  ],
} as const satisfies Record<string, readonly V2Shape[]>;

/*
 * 右端の帯の記号。デスクトップの右列の帯（.rail-mark）の図形。
 * 左レールと同じ行き先でも、帯では別の絵（通知・メッセージ・コミュニティ）。
 */
export const V2_STRIP_SHAPES = {
  ai: SHAPES.ai,
  search: [
    { tag: "circle", cx: 11, cy: 11, r: 6 },
    { tag: "path", d: "m20 20-4.5-4.5" },
  ],
  notifications: [{ tag: "path", d: "M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15ZM10 21h4" }],
  messages: [
    { tag: "rect", x: 4, y: 6, width: 16, height: 12 },
    { tag: "path", d: "m4 7 8 6 8-6" },
  ],
  community: [
    { tag: "circle", cx: 9, cy: 9, r: 3 },
    { tag: "circle", cx: 17, cy: 10, r: 2.2 },
    { tag: "path", d: "M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15.5 14.4c2.6-.4 5 1.1 5 4.1" },
  ],
  music: [
    { tag: "path", d: "M9 18V6l10-2v12" },
    { tag: "circle", cx: 6.5, cy: 18, r: 2.5 },
    { tag: "circle", cx: 16.5, cy: 16, r: 2.5 },
  ],
  wallet: SHAPES.wallet,
} as const satisfies Record<string, readonly V2Shape[]>;

export function V2Shapes({ shapes }: { shapes: readonly V2Shape[] }) {
  return (
    <>
      {shapes.map((shape, index) => {
        const { tag, ...attrs } = shape;
        return createElement(tag, { key: index, ...attrs });
      })}
    </>
  );
}

const PATHS: Record<Exclude<V2IconName, keyof typeof SHAPES>, string> = {
  /* ナビの開閉（ハンバーガー）、すべての機能（4つの角丸）、タイムライン（吹き出し。SNS の入口。家は不動産に残す）。 */
  menu: "M4 6h16M4 12h16M4 18h16",
  timeline: "M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 20.5l1.5-5.3A8.5 8.5 0 1 1 21 11.5ZM8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01",
  research: "M8 4h8M10 4v6l-6 9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-9V4M8 15h8",
  game: "M7 8h10a4 4 0 0 1 4 4v1.5a3.5 3.5 0 0 1-6.2 2.2L13.5 14h-3l-1.3 1.7A3.5 3.5 0 0 1 3 13.5V12a4 4 0 0 1 4-4ZM8 10.5v3M6.5 12h3M16 11.5h.01M18 13h.01",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  bookmark: "M7 4h10v16l-5-3.5L7 20V4Z",
  reply: "M10 8 5 12l5 4M5 12h9a5 5 0 0 1 5 5v1",
  quote: "M8 7H5v5h3V7ZM8 12c0 3-2 4-3 4M19 7h-3v5h3V7ZM19 12c0 3-2 4-3 4",
  play: "M8 5v14l11-7L8 5Z",
  pause: "M8 5v14M16 5v14",
  external: "M14 4h6v6M20 4l-9 9M18 13v6H5V6h6",
  edit: "M4 20h4l11-11-4-4L4 16v4ZM13 7l4 4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  flag: "M6 21V4h11l-2 4 2 4H6",
  pin: "M12 17v5M8 17h8l-1-5 2-2V4H7v6l2 2-1 5Z",
  mute: "M6 9a6 6 0 0 1 12 0v4l2 3H4l2-3V9ZM10 19h4M4 4l16 16",
  block: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.5 5.5l13 13",
  message: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z",
  plus: "M12 5v14M5 12h14",
  check: "m5 12 4 4 10-10",
  close: "M6 6l12 12M18 6 6 18",
  "chevron-left": "m14 6-6 6 6 6",
  "chevron-right": "m10 6 6 6-6 6",
  "chevron-down": "m6 10 6 6 6-6",
  "link-off": "M10 14 4 20M14 10l6-6M9 6l1-1a4 4 0 0 1 6 6l-1 1M15 18l-1 1a4 4 0 0 1-6-6l1-1M4 4l16 16",
  open: "M5 12h14M13 6l6 6-6 6",
  repeat: "M17 3l4 4-4 4M21 7H8a4 4 0 0 0-4 4v1M7 21l-4-4 4-4M3 17h13a4 4 0 0 0 4-4v-1",
  share: "M12 3v12M8 7l4-4 4 4M5 13v6h14v-6",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  /* ナビの行き先。右端の帯（v2-aside）と同じ描き方で、同じ場所は同じ形。 */
  home: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z",
  search: "M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm9.5 16-4.5-4.5",
  bell: "M18 9a6 6 0 0 0-12 0c0 5-2.5 6-2.5 8h17c0-2-2.5-3-2.5-8ZM10 20h4",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 19a6 6 0 0 1 12 0M16 4a3.5 3.5 0 0 1 0 7M14 18a4 4 0 0 1 7 0",
  threads: "M20 15a3 3 0 0 1-3 3H8l-4 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3ZM8 9h8M8 13h5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  book: "M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4Zm16 0h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7V4Z",
  article: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h6M9 16h6",
  store: "m3 10 2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 13v7h14v-7M9 20v-5h6v5",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  /* AI。四つ星。 */
  /* つかむ取っ手。点を6つ。 */
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  volume: "M4 9h3l4-3v12l-4-3H4V9ZM15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11",
  "volume-off": "M4 9h3l4-3v12l-4-3H4V9ZM16 9l5 6M21 9l-5 6",
  sparkle: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3ZM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z",
  /* AI。角丸の板に「AI」の二文字。吹き出し（threads）と取り違えない。 */
  lock: "M6 11h12v9H6v-9ZM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  trending: "m4 17 6-6 4 4 6-9M14 6h6v6",
  /* ブラウザ。地球儀——外の網の場所へ行く行き先。 */
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z",
  shorts: "M8 3.5h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2ZM10.5 9.5v5l4-2.5z",
  history: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7M12 8v4.5l3 1.8",
  playlist: "M4 6.5h12M4 11h12M4 15.5h7M15 14v6l5-3z",
  /* 状態表示用（V2State）。警告・ヘルプ・再試行・受信箱。 */
  alert: "M12 3.5 2.8 19.5h18.4L12 3.5ZM12 10v4.5M12 17.2h.01",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8h.01",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4",
  inbox: "M4 13.5 6.5 5h11l2.5 8.5V19H4v-5.5ZM4 13.5h4.5l1 2h5l1-2H20",
};

export function V2Icon({ name, className }: { name: V2IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className ? `v2-icon ${className}` : "v2-icon"}>
      {name in SHAPES ? <V2Shapes shapes={SHAPES[name as keyof typeof SHAPES]} /> : <path d={PATHS[name as Exclude<V2IconName, keyof typeof SHAPES>]} />}
    </svg>
  );
}

/** 描画と同じ図形の一覧。デスクトップとの照合テストが使う。 */
export function v2IconShapes(name: V2IconName): readonly V2Shape[] {
  return name in SHAPES
    ? SHAPES[name as keyof typeof SHAPES]
    : [{ tag: "path", d: PATHS[name as Exclude<V2IconName, keyof typeof SHAPES>] }];
}
