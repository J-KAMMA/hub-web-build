"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Monitor,
  MousePointer2,
  RotateCcw,
  Smartphone,
  Tablet,
  WandSparkles
} from "lucide-react";
import {
  DEFAULT_UI_ADJUSTMENT_VALUES,
  buildAdjustmentBrief,
  normalizePreviewPath,
  previewRule,
  type UiAdjustmentValues
} from "@/lib/ui-adjustment-spec";
import styles from "./ui-adjustment-studio.module.css";

const STYLE_ID = "hub-ui-adjustment-preview";
const STORAGE_KEY = "hub.ui-adjustment-studio.v1";
const VIEWPORTS = [
  { label: "スマホ", width: 390, icon: Smartphone },
  { label: "タブレット", width: 900, icon: Tablet },
  { label: "デスクトップ", width: 1440, icon: Monitor }
] as const;
const BACKGROUND_OPTIONS = [
  ["変更しない", ""],
  ["標準面", "var(--surface-raised)"],
  ["控えめな面", "var(--surface-sunken)"],
  ["操作面", "var(--interactive)"],
  ["選択面", "var(--selected)"],
  ["薄い強調面", "var(--emphasis-soft)"],
] as const;
const TEXT_OPTIONS = [
  ["変更しない", ""],
  ["本文", "var(--text)"],
  ["補助文字", "var(--muted)"],
  ["強調", "var(--emphasis)"],
  ["リンク", "var(--link-color)"]
] as const;

type SavedState = {
  pagePath: string;
  viewportWidth: number;
  selector: string;
  values: UiAdjustmentValues;
};

function elementSelector(element: Element): string {
  const rootTag = element.tagName.toLowerCase();
  if (rootTag === "html" || rootTag === "body") return rootTag;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const className = [...element.classList].find((name) => !name.startsWith("__next"));
  if (className) return `.${CSS.escape(className)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName.toLowerCase() !== "body" && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter((sibling) => sibling.tagName === current?.tagName)
      : [];
    const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
    parts.unshift(`${tag}${suffix}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  onChange(value: number): void;
}) {
  return (
    <label className={styles.range}>
      <span>{label}<output>{value === 0 ? "変更なし" : `${value}${unit}`}</output></span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

export function UiAdjustmentStudio() {
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);
  const [pageInput, setPageInput] = useState("/");
  const [pagePath, setPagePath] = useState("/");
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [selector, setSelector] = useState("");
  const [values, setValues] = useState<UiAdjustmentValues>(DEFAULT_UI_ADJUSTMENT_VALUES);
  const [picking, setPicking] = useState(false);
  const [frameRevision, setFrameRevision] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewHeight, setPreviewHeight] = useState(720);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("対象ページを読み込み、要素を選んでください。");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedState;
      const safePath = normalizePreviewPath(saved.pagePath);
      if (!safePath) return;
      setPageInput(safePath);
      setPagePath(safePath);
      setViewportWidth(saved.viewportWidth);
      setSelector(saved.selector);
      setValues({ ...DEFAULT_UI_ADJUSTMENT_VALUES, ...saved.values });
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ pagePath, viewportWidth, selector, values }));
  }, [pagePath, selector, values, viewportWidth]);

  const applyPreview = useCallback(() => {
    try {
      const document = previewFrameRef.current?.contentDocument;
      if (!document) return;
      let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = STYLE_ID;
        document.head.append(style);
      }
      style.textContent = previewRule(selector, values);
    } catch {
      setPreviewOpen(false);
    }
  }, [selector, values]);

  useEffect(() => applyPreview(), [applyPreview]);

  useLayoutEffect(() => {
    const preview = previewFrameRef.current;
    let document: Document | null = null;
    try {
      document = preview?.contentDocument ?? null;
    } catch {
      document = null;
    }
    if (!preview || !document || !picking) return;

    const clearHighlight = () => {
      if (!highlightedRef.current) return;
      highlightedRef.current.style.removeProperty("outline");
      highlightedRef.current.style.removeProperty("outline-offset");
      highlightedRef.current = null;
    };
    const hover = (event: Event) => {
      clearHighlight();
      const target = event.target as HTMLElement | null;
      if (!target || typeof target.style?.setProperty !== "function") return;
      highlightedRef.current = target;
      target.style.setProperty("outline", "2px solid var(--emphasis)", "important");
      target.style.setProperty("outline-offset", "2px", "important");
    };
    const choose = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as Element | null;
      if (!target || typeof target.tagName !== "string") return;
      const nextSelector = elementSelector(target);
      clearHighlight();
      setSelector(nextSelector);
      setPicking(false);
      setStatus(`選択しました: ${nextSelector}`);
    };
    document.addEventListener("mouseover", hover, true);
    document.addEventListener("click", choose, true);
    return () => {
      document.removeEventListener("mouseover", hover, true);
      document.removeEventListener("click", choose, true);
      clearHighlight();
    };
  }, [frameRevision, pagePath, picking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(1, Math.max(0.2, (rect.width - 32) / viewportWidth));
      setPreviewScale(scale);
      setPreviewHeight(Math.max(560, (rect.height - 32) / scale));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [viewportWidth]);

  const brief = useMemo(
    () => buildAdjustmentBrief({ pagePath, viewportWidth, selector, values }),
    [pagePath, selector, values, viewportWidth]
  );

  function openPreview(requestedPath = pageInput) {
    const safePath = normalizePreviewPath(requestedPath);
    if (!safePath) {
      setStatus("Hub内のパスを / から入力してください。この調整画面自身は開けません。");
      return;
    }
    setPicking(false);
    setSelector("");
    setValues(DEFAULT_UI_ADJUSTMENT_VALUES);
    setPagePath(safePath);
    setPreviewOpen(true);
    setStatus(`${safePath} を中央キャンバスに読み込んでいます。`);
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      setStatus("Codexへ渡す変更指示をコピーしました。");
    } catch {
      setStatus("コピーできませんでした。下の変更指示を選択してコピーしてください。");
    }
  }

  function update<K extends keyof UiAdjustmentValues>(key: K, value: UiAdjustmentValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className={styles.studio}>
      <header className={styles.topbar}>
        <div className={styles.productTitle}>
          <a href="/v2/ai" aria-label="AIへ戻る"><ArrowLeft size={17} /></a>
          <WandSparkles size={17} aria-hidden="true" />
          <strong>UI調整</strong>
          <span>開発ツール</span>
        </div>
        <div className={styles.viewportChoices} aria-label="画面幅">
          {VIEWPORTS.map((viewport) => {
            const Icon = viewport.icon;
            return (
              <button
                type="button"
                key={viewport.width}
                aria-label={`${viewport.label} ${viewport.width}px`}
                title={`${viewport.label} ${viewport.width}px`}
                aria-pressed={viewportWidth === viewport.width}
                onClick={() => setViewportWidth(viewport.width)}
              >
                <Icon size={16} />
                <span>{viewport.width}</span>
              </button>
            );
          })}
        </div>
        <button className={styles.openButton} type="button" onClick={() => openPreview()}>
          <Monitor size={15} />
          プレビュー
        </button>
      </header>

      <div className={styles.workspace}>
        <nav className={styles.toolRail} aria-label="調整ツール">
          <button
            type="button"
            aria-label={picking ? "要素選択を中止" : "画面から要素を選ぶ"}
            title={picking ? "要素選択を中止" : "画面から要素を選ぶ"}
            aria-pressed={picking}
            onClick={() => {
              if (!previewOpen) {
                openPreview(pagePath);
                setStatus("プレビューを読み込んでいます。表示後にもう一度押すと要素選択を開始します。");
                return;
              }
              setPicking((current) => !current);
            }}
          >
            <MousePointer2 size={18} />
          </button>
          <span />
          <button
            type="button"
            aria-label="調整値をリセット"
            title="調整値をリセット"
            onClick={() => {
              setValues(DEFAULT_UI_ADJUSTMENT_VALUES);
              setStatus("調整値をリセットしました。");
            }}
          >
            <RotateCcw size={17} />
          </button>
        </nav>

        <section className={styles.previewPanel} aria-label="ページプレビュー">
          <div className={styles.addressBar}>
            <span className={styles.statusDot} data-open={previewOpen || undefined} aria-hidden="true" />
            <label>
              <span className={styles.srOnly}>対象ページ</span>
              <input value={pageInput} onChange={(event) => setPageInput(event.currentTarget.value)} placeholder="/timeline" />
            </label>
            <button type="button" onClick={() => openPreview()} aria-label="このページをプレビューで開く">
              <ArrowRight size={15} />
            </button>
          </div>
          <div className={styles.canvas} ref={canvasRef} data-picking={picking || undefined}>
            {previewOpen ? (
              <div
                className={styles.frameViewport}
                style={{ width: viewportWidth * previewScale, height: previewHeight * previewScale } as CSSProperties}
              >
                <iframe
                  ref={previewFrameRef}
                  className={styles.previewFrame}
                  src={pagePath}
                  title={`${pagePath} のUIプレビュー`}
                  style={{
                    width: viewportWidth,
                    height: previewHeight,
                    transform: `scale(${previewScale})`
                  } as CSSProperties}
                  onLoad={() => {
                    setFrameRevision((current) => current + 1);
                    applyPreview();
                    setStatus(`${pagePath} を中央キャンバスに表示しています。`);
                  }}
                />
                {picking ? <span className={styles.pickingBadge}><MousePointer2 size={14} /> 選択中</span> : null}
              </div>
            ) : (
              <div className={styles.canvasMessage}>
                <div className={styles.canvasIcon}><Monitor size={24} /></div>
                <p className={styles.eyebrow}>実画面エディタ</p>
                <h2>実画面を見ながら調整</h2>
                <p>Hubのページを中央に読み込み、変更候補をその場で試せます。</p>
                <button type="button" className={styles.primaryAction} onClick={() => openPreview(pageInput)}>
                  <Monitor size={16} />
                  プレビューを表示
                </button>
                <small>{pagePath} · {viewportWidth}px</small>
              </div>
            )}
          </div>
          <div className={styles.handoffDock}>
            <div>
              <WandSparkles size={17} aria-hidden="true" />
              <span><strong>Codexへ反映</strong><small>{selector ? `${selector} の変更指示を作成済み` : "要素を選ぶと変更指示を作成します"}</small></span>
            </div>
            <button type="button" onClick={() => void copyBrief()} disabled={!selector}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "コピー済み" : "指示をコピー"}
            </button>
          </div>
        </section>

        <aside className={styles.inspector} aria-label="調整値">
          <div className={styles.inspectorHeading}>
            <div><span>インスペクタ</span><strong>スタイル</strong></div>
            <button
              type="button"
              aria-label="調整値をリセット"
              title="調整値をリセット"
              onClick={() => {
                setValues(DEFAULT_UI_ADJUSTMENT_VALUES);
                setStatus("調整値をリセットしました。");
              }}
            ><RotateCcw size={15} /></button>
          </div>
          <section className={styles.inspectorSection}>
            <div className={styles.sectionTitle}><span>選択中</span><small>{selector ? "1要素" : "未選択"}</small></div>
            <label className={styles.selectorField}>
              <span className={styles.srOnly}>CSSセレクター</span>
              <input value={selector} onChange={(event) => setSelector(event.currentTarget.value)} placeholder=".tweet__body" />
            </label>
          </section>
          <section className={styles.inspectorSection}>
            <div className={styles.sectionTitle}><span>レイアウト</span></div>
            <div className={styles.controls}>
            <RangeControl label="内側の余白" value={values.padding} min={0} max={64} unit="px" onChange={(value) => update("padding", value)} />
            <RangeControl label="要素間の余白" value={values.gap} min={0} max={48} unit="px" onChange={(value) => update("gap", value)} />
            <RangeControl label="幅" value={values.width} min={0} max={1200} step={10} unit="px" onChange={(value) => update("width", value)} />
            <RangeControl label="最小の高さ" value={values.minHeight} min={0} max={800} step={10} unit="px" onChange={(value) => update("minHeight", value)} />
            </div>
          </section>
          <section className={styles.inspectorSection}>
            <div className={styles.sectionTitle}><span>文字と外観</span></div>
            <div className={styles.controls}>
            <RangeControl label="文字サイズ" value={values.fontSize} min={0} max={48} unit="px" onChange={(value) => update("fontSize", value)} />
            <RangeControl label="行の高さ" value={values.lineHeight} min={0} max={2.4} step={0.1} unit="" onChange={(value) => update("lineHeight", value)} />
            <RangeControl label="角丸" value={values.borderRadius} min={0} max={40} unit="px" onChange={(value) => update("borderRadius", value)} />
            </div>
            <div className={styles.tokenControls}>
              <label><span>背景</span><select value={values.background} onChange={(event) => update("background", event.currentTarget.value)}>{BACKGROUND_OPTIONS.map(([label, value]) => <option key={`bg-${label}`} value={value}>{label}</option>)}</select></label>
              <label><span>文字</span><select value={values.color} onChange={(event) => update("color", event.currentTarget.value)}>{TEXT_OPTIONS.map(([label, value]) => <option key={`fg-${label}`} value={value}>{label}</option>)}</select></label>
            </div>
          </section>
          <textarea className={styles.srOnly} readOnly value={brief} aria-label="Codexへの変更指示" />
        </aside>
      </div>
      <p className={styles.status} role="status"><span data-open={previewOpen || undefined} />{status}</p>
    </div>
  );
}
