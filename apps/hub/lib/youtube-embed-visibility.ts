/*
 * YouTube の埋め込みは、再生している間ずっと見えていなければならない。
 *   - 音だけの再生・隠した再生をしない
 *   - 他の要素で覆わない
 *   - 200×200 CSS px より小さくしない
 * 出典: YouTube API Services の規約・開発者ポリシーの該当条項。【要確認】
 *   （この変更では原文を読んでいない。条番号を確かめるまで、ここに番号は書かない。）
 * 満たせないときは隠さず止める。再生中でなくても、始める前にここで確かめる。
 */
export const YOUTUBE_MIN_EMBED_PX = 200;

export type YouTubeEmbedVisibility = { visible: true } | { visible: false; reason: "tab-hidden" | "too-small" | "off-screen" | "covered" | "not-rendered" };

/* 絵の矩形のうち、画面の中に出ている部分。 */
function shown(rect: DOMRect, viewportWidth: number, viewportHeight: number) {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, viewportWidth);
  const bottom = Math.min(rect.bottom, viewportHeight);
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function checkYouTubeEmbedVisible(frame: Element | null, doc: Document = document): YouTubeEmbedVisibility {
  if (!frame || !frame.isConnected) return { visible: false, reason: "not-rendered" };
  if (doc.hidden) return { visible: false, reason: "tab-hidden" };
  const view = doc.defaultView;
  if (!view) return { visible: false, reason: "not-rendered" };
  const style = view.getComputedStyle(frame);
  if (style.display === "none" || style.visibility === "hidden" || (style.opacity !== "" && Number(style.opacity) === 0)) return { visible: false, reason: "not-rendered" };
  const rect = frame.getBoundingClientRect();
  if (rect.width < YOUTUBE_MIN_EMBED_PX || rect.height < YOUTUBE_MIN_EMBED_PX) return { visible: false, reason: "too-small" };
  const part = shown(rect, view.innerWidth, view.innerHeight);
  if (part.width < YOUTUBE_MIN_EMBED_PX || part.height < YOUTUBE_MIN_EMBED_PX) return { visible: false, reason: "off-screen" };
  /* 覆われていないか。見えている部分の四隅の少し内側と中心を調べる。 */
  const inset = 4;
  const points: Array<[number, number]> = [
    [(part.left + part.right) / 2, (part.top + part.bottom) / 2],
    [part.left + inset, part.top + inset],
    [part.right - inset, part.top + inset],
    [part.left + inset, part.bottom - inset],
    [part.right - inset, part.bottom - inset],
  ];
  for (const [x, y] of points) {
    const top = doc.elementFromPoint(x, y);
    if (top && top !== frame && !frame.contains(top)) return { visible: false, reason: "covered" };
  }
  return { visible: true };
}
