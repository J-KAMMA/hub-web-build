"use client";

import Link from "next/link";

import { V2Icon } from "@/components/v2/v2-icons";

/*
 * 左のナビの「投稿する」（2026-10-15 所有者指定）。主な画面の列と下の列（プロフィール・設定）のあいだ。
 * 動きは n キー・携帯の丸いボタンと同じ: 投稿欄がこの画面にあればそこへ、無ければ投稿欄のある
 * タイムライン（/v2#compose）へ。リンクにしてあるので、スクリプトが無くても同じ場所へ行ける。
 * 畳んだナビでは字を隠して記号だけになり、読み上げには名前が残る（.v2-nav__label の既存の規則）。
 */
export function V2NavPost({ label }: { label: string }) {
  return (
    <Link
      href="/v2#compose"
      className="v2-nav__post"
      title={label}
      onClick={(event) => {
        const compose = document.querySelector<HTMLTextAreaElement>("#compose textarea");
        if (!compose) return;
        event.preventDefault();
        compose.focus();
        compose.scrollIntoView({ block: "center" });
      }}
    >
      <V2Icon name="compose" className="v2-nav__post-icon" />
      <span className="v2-nav__label">{label}</span>
    </Link>
  );
}
