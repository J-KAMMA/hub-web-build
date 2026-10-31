import React, { type Ref } from "react";
import { CircleAlert, LoaderCircle, SearchX } from "lucide-react";

import { UiButton, UiCard, UiLinkButton } from "@/components/ui/primitives";
import styles from "@/components/route-recovery-panel.module.css";

export type RouteRecoveryKind = "not-found" | "loading" | "error";

const RECOVERY_COPY = {
  "not-found": {
    eyebrow: "404 · ページが見つかりません",
    title: "このページは見つかりません",
    description: "URLが変わったか、ページが移動または削除された可能性があります。",
  },
  loading: {
    eyebrow: "Hub",
    title: "ページを準備しています",
    description: "内容を読み込んでいます。このまま少しお待ちください。",
  },
  error: {
    eyebrow: "一時的な問題",
    title: "画面を読み込めませんでした",
    description: "接続を確認して、もう一度お試しください。入力途中の内容は、可能な限り端末に保持されます。",
  },
} as const;

const RECOVERY_ICON = {
  "not-found": SearchX,
  loading: LoaderCircle,
  error: CircleAlert,
} as const;

export function RouteRecoveryPanel({
  kind,
  onRetry,
  headingRef,
}: {
  kind: RouteRecoveryKind;
  onRetry?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const copy = RECOVERY_COPY[kind];
  const Icon = RECOVERY_ICON[kind];
  const headingId = `route-recovery-${kind}-heading`;
  const kindClassName = kind === "error" ? styles.error : kind === "loading" ? styles.loading : "";

  return (
    <section
      className={`${styles.stage} ${kindClassName}`.trim()}
      data-route-recovery={kind}
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      aria-live={kind === "loading" ? "polite" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
      aria-label={kind === "loading" ? "Hubを読み込み中" : undefined}
      aria-labelledby={headingId}
    >
      <UiCard className={styles.card}>
        <span className={styles.mark} aria-hidden="true">
          <Icon />
        </span>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 className={styles.heading} id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
            {copy.title}
          </h1>
          <p className={styles.description}>{copy.description}</p>
        </div>

        {kind === "loading" ? (
          <div className={styles.preview} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className={styles.actions}>
            {kind === "error" ? (
              <UiButton type="button" tone="primary" onClick={onRetry}>
                もう一度試す
              </UiButton>
            ) : (
              <UiLinkButton href="/" tone="primary">
                ホームへ戻る
              </UiLinkButton>
            )}
            <UiLinkButton href={kind === "error" ? "/" : "/search"}>
              {kind === "error" ? "ホームへ戻る" : "Hub内を検索"}
            </UiLinkButton>
          </div>
        )}
      </UiCard>
    </section>
  );
}
