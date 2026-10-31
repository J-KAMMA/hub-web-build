"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { cx } from "./cx";

/*
 * Media frame (SPEC 3). Always owns an aspect-ratio, so the box exists before the
 * image does. The image fills it (object-fit: cover), sits on an --interactive
 * ground until loaded, then fades in over 200ms. A thin inner outline keeps white
 * artwork from dissolving into the page. Overlays (duration badges) are children.
 */
export type MediaRatio = "16/9" | "1/1" | "4/3" | "3/1" | "9/16";

export type MediaFrameProps = {
  src?: string | null;
  srcSet?: string;
  sizes?: string;
  alt?: string;
  ratio?: MediaRatio;
  /** Intrinsic size hints (reserve layout even without CSS). */
  width: number;
  height: number;
  radius?: "xs" | "sm" | "md" | "lg" | "none";
  priority?: boolean;
  className?: string;
  /** Set to "no-referrer" for third-party thumbnails. */
  referrerPolicy?: "no-referrer" | "same-origin";
  /** Called when the image cannot be loaded, so the caller can drop the frame. */
  onError?: () => void;
  children?: ReactNode;
};

export function MediaFrame({
  src,
  srcSet,
  sizes,
  alt = "",
  ratio = "16/9",
  width,
  height,
  radius = "md",
  priority = false,
  className,
  referrerPolicy,
  onError,
  children,
}: MediaFrameProps) {
  const [loaded, setLoaded] = useState(false);
  const style = { "--ui-media-ratio": ratio.replace("/", " / ") } as CSSProperties;
  return (
    <div className={cx("ui-media", `ui-media--r-${radius}`, loaded && "ui-media--loaded", className)} style={style}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="ui-media__img"
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
          referrerPolicy={referrerPolicy}
          onLoad={() => setLoaded(true)}
          onError={onError}
          ref={(node) => {
            if (node?.complete && node.naturalWidth > 0) setLoaded(true);
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** Duration / live badge for the lower-right corner of a MediaFrame. */
export function MediaBadge({ children, tone = "media" }: { children: ReactNode; tone?: "media" | "live" }) {
  return <span className={cx("ui-media__badge", tone === "live" && "ui-media__badge--live")}>{children}</span>;
}
