import { displayInitial } from "@/lib/display-initial";

import { cx } from "./cx";

/*
 * Avatar (SPEC 3). Five sizes. People are circles; communities and places are
 * rounded squares (--radius-sm). Without an image, the initial is taken past
 * brackets and punctuation (displayInitial). Images always carry width/height,
 * lazy decoding, and a srcset so a 1254px original is never sent for a 40px face.
 */
export const AVATAR_SIZES = [24, 32, 40, 48, 96] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

export type AvatarProps = {
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  /** "person" is a circle, "place" a rounded square (communities, groups). */
  shape?: "person" | "place";
  /**
   * Returns a URL of the image resized to the given pixel width. When omitted the
   * original `src` is used with width/height attributes only.
   */
  srcFor?: (width: number) => string;
  priority?: boolean;
  /** Alt text for the image. Decorative (empty) unless the caller names the person. */
  alt?: string;
  className?: string;
};

export function avatarSrcSet(srcFor: (width: number) => string, size: number): { src: string; srcSet: string; sizes: string } {
  const widths = [size, size * 2, size * 3];
  return {
    src: srcFor(size * 2),
    srcSet: widths.map((w, i) => `${srcFor(w)} ${i + 1}x`).join(", "),
    sizes: `${size}px`,
  };
}

/** Stable tint 1..6 for the initial fallback (--avatar-N / --avatar-N-text in color-system.css). */
export function avatarTint(name: string | null | undefined): number {
  let hash = 0;
  for (const char of Array.from((name ?? "").trim())) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return (hash % 6) + 1;
}

export function Avatar({ name, src, size = 40, shape = "person", srcFor, priority = false, alt = "", className }: AvatarProps) {
  const cls = cx("ui-avatar", `ui-avatar--${size}`, shape === "place" && "ui-avatar--place", className);
  if (!src) {
    // 名前が無い（未ログインなど）ときは色分けせず、配色に合わせた人の形を出す。
    if (!(name ?? "").trim()) {
      return (
        <span className={cx(cls, "ui-avatar--initial", "ui-avatar--anonymous")} aria-hidden="true">
          <svg className="ui-avatar__person" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="8.5" r="3.5" />
            <path d="M5 19.5c1.4-3.2 4-4.8 7-4.8s5.6 1.6 7 4.8" />
          </svg>
        </span>
      );
    }
    return (
      <span className={cx(cls, "ui-avatar--initial")} data-tint={avatarTint(name)} aria-hidden="true">
        <span className="ui-avatar__initial">{displayInitial(name)}</span>
      </span>
    );
  }
  const set = srcFor ? avatarSrcSet(srcFor, size) : { src, srcSet: undefined, sizes: undefined };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={cls}
      src={set.src}
      srcSet={set.srcSet}
      sizes={set.sizes}
      width={size}
      height={size}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
    />
  );
}
