"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 成人表示の確認。
 *
 * 本文を差し替えるのではなく、**本文の上に重ねる**。
 * 理由は検索索引に載せるためで、記事のHTMLは誰に対しても同じものを返す必要がある
 * ——クローラーにだけ本文を見せる作りにすると、それはクローキングになる。
 *
 * したがってこれは遮断ではなく表示上の確認である。本文はHTMLに含まれており、
 * 開発者ツールを開けば読める。「未成年に絶対に見せない」仕組みではない。
 * その線引きで良いかは運用側の判断で、ここは判断の結果を実装しているだけ。
 */
export function AdultOptInGate({ next }: { next: string }) {
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const noun = "記事";

  useEffect(() => {
    setMounted(true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    dialogRef.current?.querySelector<HTMLElement>("button, a")?.focus();
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={dialogRef}
      className="hub-adult-gate-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hub-adult-gate-heading"
      onKeyDown={(event) => keepFocusInside(event, dialogRef.current)}
    >
      <div className="hub-adult-gate">
        <p className="hub-adult-gate__eyebrow">18歳以上</p>
        <h2 id="hub-adult-gate-heading">成人向けの{noun}です</h2>
        <p>
          この{noun}は成人向けの内容を含みます。18歳未満の方はご利用いただけません。
        </p>
        <p className="hub-adult-gate__note">
          ログインは不要です。有効にすると、この端末で成人向けコンテンツを表示できるようになります。設定はいつでも解除できます。
        </p>
        <form method="post" action="/adult/opt-in">
          <input type="hidden" name="next" value={next} />
          <button type="submit" name="enable" value="yes">
            18歳以上
          </button>
        </form>
        <p className="hub-adult-gate__note">
          <a href="/">Hubのトップへ戻る</a>
        </p>
      </div>
    </div>,
    document.body,
  );
}

function keepFocusInside(event: React.KeyboardEvent, container: HTMLDivElement | null) {
  if (event.key !== "Tab" || !container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
