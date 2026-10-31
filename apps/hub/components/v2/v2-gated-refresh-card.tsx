"use client";

import { useRouter } from "next/navigation";

import { V2GatedLockedCard, type GatedLockedCardProps } from "@/components/v2/v2-gated-locked-card";

/* 鍵付きカード + 再確認が通ったらページを取り直す。router はここだけで使う（鍵付きのときだけ描かれる）。 */
export function V2GatedRefreshCard(props: Omit<GatedLockedCardProps, "onUnlocked">) {
  const router = useRouter();
  return <V2GatedLockedCard {...props} onUnlocked={() => router.refresh()} />;
}
