"use client";

import { useEffect, useRef, useState } from "react";

/*
 * 投稿の画像の拡大表示（2026-10-18）。Hub Desktop の openMediaLightbox と同じ振る舞い:
 * 縦横比を保って窓に収め、←→ で送り、Esc・背景・× で閉じて、開いた画像へ焦点を戻す。
 * 画像は投稿に載っている URL（あれば fullUrl）だけを使う。
 */
export type V2LightboxImage = { id: string; url: string; fullUrl?: string; altText: string };

export function V2ImageLightbox({
  images,
  index: start,
  japanese,
  onClose,
}: {
  images: V2LightboxImage[];
  index: number;
  japanese: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(start);
  const image = images[index];

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal?.();
    close.current?.focus();
    return () => { if (node.open && typeof node.close === "function") node.close(); };
  }, []);

  if (!image) return null;
  const many = images.length > 1;
  /* 閉じると onClose（dialog の close 事象）。close を持たない環境では直接呼ぶ。 */
  const shut = () => { const node = dialog.current; if (node && typeof node.close === "function" && node.open) node.close(); else onClose(); };
  const step = (delta: number) => setIndex((value) => Math.min(images.length - 1, Math.max(0, value + delta)));

  return (
    <dialog
      ref={dialog}
      className="v2-lightbox"
      aria-label={japanese ? "画像" : "Image"}
      onClose={onClose}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === "FIGURE") shut();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
        else if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      }}
    >
      <figure className="v2-lightbox__figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="v2-lightbox__image" src={image.fullUrl ?? image.url} alt={image.altText} />
        {image.altText ? <figcaption className="v2-lightbox__caption">{image.altText}</figcaption> : null}
      </figure>
      {many ? <p className="v2-lightbox__count">{index + 1} / {images.length}</p> : null}
      {many ? (
        <>
          <button type="button" className="v2-lightbox__nav v2-lightbox__nav--prev" aria-label={japanese ? "前の画像" : "Previous image"} disabled={index === 0} onClick={() => step(-1)}>‹</button>
          <button type="button" className="v2-lightbox__nav v2-lightbox__nav--next" aria-label={japanese ? "次の画像" : "Next image"} disabled={index === images.length - 1} onClick={() => step(1)}>›</button>
        </>
      ) : null}
      <button ref={close} type="button" className="v2-lightbox__close" aria-label={japanese ? "閉じる" : "Close"} onClick={() => shut()}>×</button>
    </dialog>
  );
}
