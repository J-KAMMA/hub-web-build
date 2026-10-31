import type { ReactNode } from "react";

import { Button, ButtonLink } from "@/components/v2/ui/button";
import { SkeletonList } from "@/components/v2/ui/skeleton";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";

/*
 * 画面の状態表示（2026-10-29、トップティアUI仕様 G1）。
 * 空・未ログイン・失敗・読み込み中を1つの部品で出す。
 *   empty      まだ何も無い。次の一手は1つだけ
 *   signedOut  ログインが必要。既定の行き先は /v2/auth?next=<next>
 *   error      失敗。記号の円だけを警告色にし、ブロック全体は塗らない。既定の押し手は「再試行」
 *   loading    読み込み中。骨組みの行を出す（文字だけの「読み込んでいます」にしない）
 * 中央寄せ・最大幅 var(--state-max)・枠も箱も無い。compact は枠の中・節の中用で余白が小さい。
 * サーバーでもクライアントでも使える（"use client" を付けない）。
 */
export type V2StateKind = "empty" | "signedOut" | "error" | "loading";

export type V2StateAction = { label: string; href: string } | { label: string; onClick: () => void };

export type V2StateProps = {
  kind: V2StateKind;
  icon?: V2IconName;
  title?: string;
  note?: ReactNode;
  action?: V2StateAction;
  secondaryAction?: V2StateAction;
  /** 枠や節の中で使う小さな余白。 */
  compact?: boolean;
  /** signedOut の既定の行き先に渡す戻り先（例 "/v2/messages"）。 */
  next?: string;
  japanese?: boolean;
  /** 読み込み中の骨組みの行数。 */
  rows?: number;
  className?: string;
};

const DEFAULT_ICON: Record<V2StateKind, V2IconName> = {
  empty: "inbox",
  signedOut: "lock",
  error: "alert",
  loading: "clock",
};

function authHref(next: string | undefined) {
  return next ? `/v2/auth?next=${encodeURIComponent(next)}` : "/v2/auth";
}

function ActionButton({ action, variant }: { action: V2StateAction; variant: "primary" | "plain" }) {
  return "href" in action
    ? <ButtonLink variant={variant} href={action.href} label={action.label} />
    : <Button variant={variant} onClick={action.onClick} label={action.label} />;
}

export function V2State({
  kind,
  icon,
  title,
  note,
  action,
  secondaryAction,
  compact = false,
  next,
  japanese = true,
  rows = 6,
  className,
}: V2StateProps) {
  if (kind === "loading") {
    return (
      <div className={["v2-state", "v2-state--loading", compact ? "v2-state--compact" : "", className ?? ""].filter(Boolean).join(" ")}>
        <SkeletonList count={rows} label={title ?? (japanese ? "読み込んでいます" : "Loading")} />
      </div>
    );
  }

  const resolvedTitle = title ?? (kind === "signedOut" ? (japanese ? "ログインが必要です" : "Sign-in required") : kind === "error" ? (japanese ? "読み込めませんでした" : "Could not load") : "");
  const resolvedAction: V2StateAction | undefined =
    action ?? (kind === "signedOut" ? { label: japanese ? "ログイン" : "Sign in", href: authHref(next) } : undefined);

  return (
    <div
      className={["v2-state", `v2-state--${kind}`, compact ? "v2-state--compact" : "", className ?? ""].filter(Boolean).join(" ")}
      role={kind === "error" ? "alert" : "status"}
    >
      <div className="v2-state__body">
        <span className="v2-state__disc" aria-hidden="true">
          <V2Icon name={icon ?? DEFAULT_ICON[kind]} />
        </span>
        {resolvedTitle ? <p className="v2-state__title">{resolvedTitle}</p> : null}
        {note ? <p className="v2-state__note">{note}</p> : null}
        {resolvedAction || secondaryAction ? (
          <div className="v2-state__actions">
            {resolvedAction ? <ActionButton action={resolvedAction} variant="primary" /> : null}
            {secondaryAction ? <ActionButton action={secondaryAction} variant="plain" /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
