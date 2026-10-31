import type { ReactNode } from "react";

import { V2State } from "@/components/v2/v2-state";

/*
 * 空の状態（2026-09-03）。2026-10-29 から V2State kind="empty" の薄い包み。
 * 呼び出し側（53箇所）の書き方は変えない。次の一手は1つだけ。
 * 旧い `.v2-empty` の指定（一覧の中で幅や余白を変える規則）が効くよう、根の class は残す。
 * サーバーでもクライアントでも使える（"use client" を付けない）。
 */
export function V2Empty({
  title,
  note,
  action,
}: {
  title: string;
  note?: ReactNode;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
}) {
  return <V2State kind="empty" className="v2-empty" title={title} note={note} action={action} />;
}
