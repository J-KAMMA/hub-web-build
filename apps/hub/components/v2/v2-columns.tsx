"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { V2Icon } from "./v2-icons";
import { V2ChromeProvider, V2ComposeFab, V2MenuTrigger, useScrollChrome, type V2MenuConfig } from "./v2-chrome";

/*
 * 列はナビ・タブの列・本文・右列（2026-10-11）。画面ごとの目録（directory）は
 * ナビの右の列に縦のタブとして並べる（デスクトップと同じ。ユーザー指定）。ナビは1本の列で、上端のハンバーガーが
 * アイコンだけ（56〜64px）と、アイコン＋文字（約208px）を切り替える。
 * 画面幅では切り替えない。開閉は従来のキー hub.v2.nav-collapsed に保存する。
 * 閉じていても同じ要素をDOMに保つ（未読数・フォーカスを捨てない）。
 */

const NAV_KEY = "hub.v2.nav-collapsed";
/* 上端の帯の「列の開閉」で内側の列（side の目録）を隠したかどうか（2026-10-18、Desktop と同じ）。 */
const TABS_KEY = "hub.v2.tabs-hidden";

function alignPanel(workspace: HTMLElement, panel: HTMLElement) {
  workspace.scrollLeft = Math.max(0, workspace.scrollLeft + panel.getBoundingClientRect().left - workspace.getBoundingClientRect().left - 8);
}

export function V2ColumnHead({
  title,
  heading = false,
  action,
  lead,
  className,
}: {
  title: ReactNode;
  heading?: boolean;
  action?: ReactNode;
  /* 見出しの前に置く操作（右列の戻る・進む）。 */
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `v2-top-title ${className}` : "v2-top-title"}>
      <V2MenuTrigger />
      {lead}
      {title == null ? null : heading
        ? <h1 className="v2-top-title__label">{title}</h1>
        : <p className="v2-top-title__label">{title}</p>}
      {action ? <div className="v2-top-title__action">{action}</div> : null}
    </div>
  );
}

/* 本体が見出しを持つ画面では、枠が同じページ名をもう一度出さない。 */
export function V2PageHeader({ title, panelOwnsHeading = false, action }: {
  title: ReactNode;
  panelOwnsHeading?: boolean;
  action?: ReactNode;
}) {
  if (panelOwnsHeading) return action ? <div className="v2-page__context">{action}</div> : null;
  return <V2ColumnHead heading title={title} action={action} />;
}

export function V2Columns({
  nav,
  directoryRail,
  directoryTitle,
  directory,
  directoryEssential = false,
  aside,
  children,
  labels,
  menu,
  measure = "wide",
  layout = "workspace",
  composeLabel,
  hideDirectory = false,
  directoryPlacement = "top",
  hideSearch = false,
  defaultNavOpen = false,
}: {
  nav: ReactNode;
  /* 目録タブの行に添える汎用の部品（戻る・作る・検索）。 */
  directoryRail?: ReactNode;
  directoryTitle?: ReactNode;
  /* ナビの右の列に縦のタブとして出す目録。 */
  directory?: ReactNode;
  /* 旧・内側左列を既定で開く画面の印。今は全画面が同じタブなので見た目は変えない。 */
  directoryEssential?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  labels: { open: string; close: string; nav: string; directory?: string; aside?: string; pin?: string; search?: string; columns?: string };
  /* 携帯のメニュー（縦の帯の代わり）の中身。無ければメニューの押し手は出ない。 */
  menu?: V2MenuConfig;
  /* 本文の測り。narrow は 600px の1列（タイムライン型）、wide は可変（一覧・動画・記事型）。 */
  measure?: "narrow" | "wide";
  /* 読む幅（フォーム・設定・記事）か、全幅（カードの格子）か。docs/hub-content-width.md */
  layout?: "reading" | "workspace";
  /* 携帯の新規投稿の丸の名前。渡した画面（タイムライン）にだけ出る。 */
  composeLabel?: string;
  /* 目録の列を出さない画面（動画: 本文を広く取り、絞り込みは画面の中のチップが持つ）。 */
  hideDirectory?: boolean;
  /* top: 本文の見出しの下の上端タブ（SPEC 4.1 / L2）。side: 一覧と詳細が並ぶ画面（設定・Hubpedia）だけの内側左列。 */
  directoryPlacement?: "top" | "side";
  /* 検索の画面は本文に検索欄を持つので、上の帯の欄は出さない（欄を1つにする）。 */
  hideSearch?: boolean;
  /* 保存が無い端末で、ナビを名前つきで開いて始める（タイムラインの新しい見た目、2026-10-30）。 */
  defaultNavOpen?: boolean;
}) {
  /*
   * 最初の描画は「既定の形」（アイコンだけに畳む）。サーバーとクライアントで同じ形になるよう、
   * localStorage は効果の中でだけ読む。覚えが「開く」の端末だけが水和後に動く。
   */
  const [collapsed, setCollapsed] = useState(!defaultNavOpen);
  const [ready, setReady] = useState(false);
  /* ☰ を水和前に押した利用者の選択を、覚えの読み込みで上書きしない。 */
  const touchedNav = useRef(false);
  const touchedTabs = useRef(false);
  /* 行き先の画面が届くまでの「押した」印（上端の細い棒と main の aria-busy）。 */
  const [pending, setPending] = useState(false);
  const pendingFrom = useRef("");
  const [tabsHidden, setTabsHidden] = useState(false);
  const directoryRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  useScrollChrome(frameRef);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NAV_KEY);
      if (stored !== null && !touchedNav.current) setCollapsed(stored === "true");
      if (!touchedTabs.current) setTabsHidden(window.localStorage.getItem(TABS_KEY) === "true");
    } catch {
      /* 読めない環境でも初期状態のまま操作できる。 */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    let previousWidth = window.innerWidth;
    let frame = 0;
    const onResize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (window.innerWidth === previousWidth) return;
        previousWidth = window.innerWidth;
        const workspace = workspaceRef.current;
        if (!workspace) return;
        const focusedPanel = document.activeElement?.closest<HTMLElement>(".v2__nav, .v2__main, .v2__aside, .v2__aside-strip");
        const panel = focusedPanel && workspace.contains(focusedPanel)
          ? focusedPanel
          : workspace.querySelector<HTMLElement>(".v2__main");
        if (!panel) return;
        const bounds = panel.getBoundingClientRect();
        const visible = workspace.getBoundingClientRect();
        // 横向きで失われた横スクロールを戻し、操作中の列を画面内に保つ。
        if (bounds.left < visible.left || bounds.right > visible.right) alignPanel(workspace, panel);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.cancelAnimationFrame(frame);
    };
  }, [ready]);

  /* 別のタブで畳んだり開いたりしたら、こちらも合わせる。 */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === NAV_KEY) setCollapsed(event.newValue !== "false");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* 道が変わったら（同じ枠のまま絞り込みだけ変わる画面も含む）、または 15 秒たったら印を外す。遷移が失敗しても棒を出し続けない。 */
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.location.href !== pendingFrom.current || Date.now() - started > 15000) setPending(false);
    }, 150);
    return () => window.clearInterval(timer);
  }, [pending]);

  /* リンクを押した瞬間に印を付ける。ナビ・タブ・メニューのどのリンクにも効く（各リンクの部品には手を入れない）。 */
  const markPending = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    pendingFrom.current = window.location.href;
    setPending(true);
  };

  const toggle = () => {
    touchedNav.current = true;
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(NAV_KEY, String(next));
      } catch {
        /* 覚えられなくても、その場では畳める。 */
      }
      return next;
    });
  };

  const toggleTabs = () => {
    touchedTabs.current = true;
    setTabsHidden((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(TABS_KEY, String(next));
      } catch {
        /* 覚えられなくても、その場では隠せる。 */
      }
      return next;
    });
  };

  const hasDirectory = !hideDirectory && (Boolean(directory) || Boolean(directoryRail));
  const hasAside = Boolean(aside);
  const top = directoryPlacement === "top";
  /* 目録の入れ物。side は本文の左隣の列、top は本文の中の見出しの直下。 */
  const directoryBlock = hasDirectory ? (
        <aside className={top ? "v2__tabs-column v2__tabs-column--top" : "v2__tabs-column"} ref={directoryRef}
          aria-label={typeof directoryTitle === "string" && directoryTitle ? directoryTitle : labels.directory}>
            {directoryTitle ? <p className="v2__tabs-column-title">{directoryTitle}</p> : null}
            {directoryRail ? <div className="v2-main-directory__tools" onClick={event => {
              const focus = (event.target as HTMLElement).closest<HTMLElement>("[data-rail-focus]");
              if (!focus) return;
              const selector = (focus.dataset.railFocus ?? "search") === "search" ? 'input[type="search"]' : "input";
              const input = document.querySelector<HTMLInputElement>(".v2__main " + selector);
              input?.focus(); input?.select();
            }}>{directoryRail}</div> : null}
            {directory}
        </aside>
  ) : null;
  /* 上端のタブが横に溢れる幅では、選ばれているタブを見える位置へ（携帯で最後の項目が切れる対策）。 */
  const currentTabKey = useRef("");
  useEffect(() => {
    const root = directoryRef.current;
    if (!root || !top) return;
    const rows = Array.from(root.querySelectorAll<HTMLElement>(":scope > nav, :scope > .v2-main-directory__tools"));
    const key = rows.map((row) => row.querySelector("[aria-current]:not([aria-current=\"false\"])")?.getAttribute("href") ?? "").join("|");
    if (key === currentTabKey.current) return;
    currentTabKey.current = key;
    for (const row of rows) {
      const active = row.querySelector<HTMLElement>("[aria-current]:not([aria-current=\"false\"])");
      if (!active || row.scrollWidth <= row.clientWidth) continue;
      const target = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
      row.scrollLeft = Math.max(0, target);
    }
  });
  const toggleLabel = collapsed ? labels.open : labels.close;

  return (
    <V2ChromeProvider menu={menu}>
    <div className="v2__workspace" ref={workspaceRef} onClickCapture={markPending} data-pending={pending ? "true" : undefined}>
    <div className="v2-progress" aria-hidden="true" />
    {/*
      * 上端の帯（2026-10-18、Hub Desktop と同じ骨組み）。☰・内側の列の開閉・左寄せの検索。
      * 机上幅だけに出す（携帯は既存の上下の帯）。☰ は列の中の押し手と同じ状態を切り替える。
      */}
    <header className="v2-titlebar">
      <button type="button" className="v2-titlebar__button" data-titlebar="nav"
        aria-expanded={!collapsed} onClick={toggle} title={toggleLabel + ": " + labels.nav}>
        <V2Icon name="menu" className="v2-titlebar__mark" />
        <span className="v2-sr">{toggleLabel}: {labels.nav}</span>
      </button>
      {hasDirectory && !top ? (
        <button type="button" className="v2-titlebar__button" data-titlebar="columns"
          aria-pressed={!tabsHidden} onClick={toggleTabs} title={labels.columns ?? labels.directory}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="v2-icon v2-titlebar__mark"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>
          <span className="v2-sr">{labels.columns ?? labels.directory}</span>
        </button>
      ) : null}
      {hideSearch ? null : (
        <form className="v2-titlebar__search" role="search" action="/v2/search" method="get">
          <V2Icon name="search" className="v2-titlebar__mark" />
          <input type="search" name="q" maxLength={100} autoComplete="off" placeholder={labels.search} aria-label={labels.search} />
        </form>
      )}
    </header>
    <div
      ref={frameRef}
      data-measure={measure}
      data-layout={layout}
      className={["v2__frame", hasAside ? "v2__frame--with-aside" : ""].filter(Boolean).join(" ")}
      data-nav={collapsed ? "collapsed" : "open"}
      data-directory-essential={directoryEssential ? "true" : undefined}
      data-tabs={hasDirectory && !top && tabsHidden ? "hidden" : undefined}
    >
      <nav className="v2__nav v2__nav--unified" aria-label="Hub">
        <button type="button" className="v2-nav__burger" data-column="nav"
          aria-expanded={!collapsed} onClick={toggle}
          title={toggleLabel + ": " + labels.nav}>
          <V2Icon name="menu" className="v2-nav__burger-mark" />
          <span className="v2-sr">{toggleLabel}: {labels.nav}</span>
        </button>
        {nav}
      </nav>

      {/*
        * id は既存の根のレイアウトが持つ「本文へ飛ぶ」リンク（#hub-main）の
        * 行き先に合わせる。v2 で別の id にすると、Tab の最初の跳び先が無くなる。
        */}
      {top ? null : directoryBlock}

      <main className="v2__main" id="hub-main" tabIndex={-1} data-scroll="document" aria-busy={pending || undefined}>
        {top ? directoryBlock : null}
        {/* 携帯だけ。左の列の目録は、画面名の下の横タブとして本文の中にも置く（S7）。 */}
        {!top && hasDirectory ? (
          <aside className="v2__tabs-column v2__tabs-column--top v2__tabs-column--mobile"
            aria-label={typeof directoryTitle === "string" && directoryTitle ? directoryTitle : labels.directory}>
            {directoryRail ? <div className="v2-main-directory__tools">{directoryRail}</div> : null}
            {directory}
          </aside>
        ) : null}
        {children}
      </main>

      {/*
        * 右列は入れ物に包んで単独の子にする（2026-09-08）。サーバーの画面が作った
        * <V2Aside/> をこの並びにそのまま置くと、水和時に「key が無い」と鳴った
        * （React はサーバーから来た要素を配列の子として検証する）。入れ物は
        * display: contents なので、列と帯は今までどおり枠の flex の項目のまま。
        */}
      {aside ? <div className="v2__aside-slot">{aside}</div> : null}
    </div>
    </div>
    {composeLabel ? <V2ComposeFab label={composeLabel} /> : null}
    </V2ChromeProvider>
  );
}
