import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";

/*
 * v2 のボタンは3種だけ。高さは全部 32px、角も線も同じ。
 *   icon    記号だけ。名前は読み上げと title に残す。数があれば右に添える
 *   text    文字の札。押すと何かが起きるが、記号では伝わらないもの（続きを読む など）
 *   primary 塗り。その画面の主操作（送る・登録・フォロー）
 * 押した状態（aria-pressed）は色で見せる。
 *
 * 旦那様の指摘（2026-09-02）: 取っ手・文字の札・作品の操作がばらばらだった。
 * ここに寄せて、部品ごとに形を決めない。
 */
type Common = {
  label: string;
  icon?: V2IconName;
  count?: number | string;
  pressed?: boolean;
  variant?: "icon" | "text" | "primary";
  className?: string;
  title?: string;
};

type ButtonProps = Common & {
  href?: undefined;
  type?: "button" | "submit";
  disabled?: boolean;
  expanded?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

type LinkProps = Common & {
  href: string;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

function classes({ variant, icon, className }: Common) {
  const kind = variant ?? (icon ? "icon" : "text");
  return ["v2-button", `v2-button--${kind}`, className ?? ""].filter(Boolean).join(" ");
}

function body({ label, icon, count, variant }: Common): ReactNode {
  const kind = variant ?? (icon ? "icon" : "text");
  return (
    <>
      {icon ? <V2Icon name={icon} /> : null}
      {kind === "icon" ? <span className="v2-sr">{label}</span> : <span className="v2-button__label">{label}</span>}
      {count !== undefined && count !== 0 && count !== "" ? <span className="v2-button__count">{count}</span> : null}
    </>
  );
}

export function V2Button(props: ButtonProps | LinkProps) {
  const kind = props.variant ?? (props.icon ? "icon" : "text");
  const title = props.title ?? (kind === "icon" ? props.label : undefined);
  if (props.href !== undefined) {
    const { href, external, onClick } = props;
    if (external) {
      return (
        <a className={classes(props)} href={href} target="_blank" rel="noopener noreferrer" title={title} onClick={onClick}>
          {body(props)}
        </a>
      );
    }
    return (
      <Link className={classes(props)} href={href} title={title} onClick={onClick}>
        {body(props)}
      </Link>
    );
  }
  const { type = "button", disabled, expanded, onClick } = props;
  return (
    <button
      type={type}
      className={classes(props)}
      title={title}
      aria-pressed={props.pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {body(props)}
    </button>
  );
}
