import Link from "next/link";
import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";

import { cx } from "./cx";

/*
 * Button primitive (SPEC 3). Heights: 36 desktop / 44 touch, set in v2-foundation.css.
 *   primary    filled with --action; one per screen
 *   secondary  --interactive surface
 *   plain      no surface until hover
 *   danger     --danger-text on --danger-bg; destructive actions only (never filled black)
 *   icon       36 square, 20px glyph; label is required for the accessible name
 * Pressing never disables the button: aria-pressed only changes appearance.
 * `busy` keeps the control focusable and announces aria-busy instead of disabling.
 */
export type ButtonVariant = "primary" | "secondary" | "plain" | "icon" | "danger";

type Shared = {
  variant?: ButtonVariant;
  /** Visible text, or the accessible name when variant is "icon". */
  label: string;
  /** Glyph shown before the label (or alone for icon buttons). */
  icon?: ReactNode;
  className?: string;
  busy?: boolean;
};

export type ButtonProps = Shared &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className" | "aria-label"> & {
    pressed?: boolean;
  };

export type ButtonLinkProps = Shared & {
  href: string;
  external?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

function classes(variant: ButtonVariant, className?: string) {
  return cx("ui-button", `ui-button--${variant}`, className);
}

function content({ variant = "secondary", label, icon }: Shared) {
  return (
    <>
      {icon ? <span className="ui-button__icon" aria-hidden="true">{icon}</span> : null}
      {variant === "icon" ? <span className="ui-sr">{label}</span> : <span className="ui-button__label">{label}</span>}
    </>
  );
}

export function Button({ variant = "secondary", label, icon, className, busy, pressed, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, className)}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      title={rest.title ?? (variant === "icon" ? label : undefined)}
    >
      {content({ variant, label, icon })}
    </button>
  );
}

export function ButtonLink({ variant = "secondary", label, icon, className, href, external, onClick, busy }: ButtonLinkProps) {
  const inner = content({ variant, label, icon });
  const title = variant === "icon" ? label : undefined;
  if (external) {
    return (
      <a className={classes(variant, className)} href={href} target="_blank" rel="noopener noreferrer" title={title} onClick={onClick} aria-busy={busy || undefined}>
        {inner}
      </a>
    );
  }
  return (
    <Link className={classes(variant, className)} href={href} title={title} onClick={onClick} aria-busy={busy || undefined}>
      {inner}
    </Link>
  );
}
