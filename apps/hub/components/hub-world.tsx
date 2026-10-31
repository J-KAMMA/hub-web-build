"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Hub の中で 3D の世界を開く。
 *
 * **Babylon をこの頁だけに閉じ込める。** 直に import すると、投稿や設定など
 * 3D と関係の無い頁の組み上げにも数MBが乗る。だから `import()` で、
 * 画面が出てから読む。
 *
 * 世界の中身は `@jkamma/hub-world` にある。ここはその入れ物で、
 * **規則も描画もここには書かない**——単体の頁と同じ物を動かすため。
 */

type Props = {
  /** 世界のサーバ。ws:// か wss://。 */
  address: string;
  /** 彫った資産の置き場。 */
  assets: string;
  zone?: string;
  /** 第三者が建てたサーバの名前。**許可の宛先がそのサーバ専用になる。** */
  server?: string | null;
};

export function HubWorld({ address, assets, zone, server }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const roster = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLDivElement>(null);
  const doors = useRef<HTMLDivElement>(null);
  const shelf = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const sayForm = useRef<HTMLFormElement>(null);
  const line = useRef<HTMLInputElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let close: (() => void) | null = null;
    // **途中で頁を移られる。** 読み終える頃には要らなくなっていることがあるので、
    // 印を立てておいて、その場合は開かずに閉じる。
    let gone = false;

    void (async () => {
      try {
        const { openWorld } = await import("@jkamma/hub-world/client");
        if (gone) return;
        const stage = {
          canvas: canvas.current!, roster: roster.current!, banner: banner.current!,
          doors: doors.current!, shelf: shelf.current!,
          log: log.current!, sayForm: sayForm.current!, line: line.current!, controls: controls.current!
        };
        close = openWorld(stage, { address, assets, zone, server: server ?? undefined });
      } catch (error) {
        // The error may carry the wallet address passed to openWorld; log only its kind.
        console.error("hub_world_open_failed", error instanceof Error ? error.name : "unknown");
        setFailed("世界を開けませんでした。時間をおいて開き直してください。");
      }
    })();

    return () => { gone = true; close?.(); };
  }, [address, assets, zone, server]);

  return (
    <div className="hub-world">
      <canvas ref={canvas} className="hub-world__stage" tabIndex={0} />
      <div ref={banner} className="hub-world__banner" role="status" aria-live="polite">
        {failed ?? "世界へ繋いでいます"}
      </div>
      <div ref={doors} className="hub-world__doors" aria-label="行き先" />
      <div className="hub-world__walking">
        <div ref={controls} className="hub-world__controls" aria-label="移動" />
        <p>画面を選んで WASD / 矢印キーで歩く · ドラッグで見回す</p>
      </div>
      <details className="hub-world__tools">
        <summary>家具・着替え</summary>
        <div ref={shelf} className="hub-world__shelf" aria-label="置ける物" />
      </details>
      <aside className="hub-world__side">
        <h2>この場所で話す</h2>
        <div ref={roster} className="hub-world__roster" aria-label="いま居る人" />
        <div ref={log} className="hub-world__log" role="log" aria-live="polite" />
        <form ref={sayForm} className="hub-world__say">
          <label htmlFor="hub-world-line" className="hub-sr-only">話す</label>
          <input ref={line} id="hub-world-line" autoComplete="off" maxLength={140} placeholder="話す" />
          <button type="submit">言う</button>
        </form>
      </aside>
    </div>
  );
}
