import React from "react";
import { forwardRef } from "react";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { clsx } from "@/lib/format";

/*
 * Button final form (2026-10-30): UiButton / UiLinkButton are the only button.
 * tone: primary | secondary | ghost | danger ("default" is a deprecated alias of secondary).
 * size: compact (32) | standard (40, 44 on touch) | large (48, deprecated: prefer standard).
 * Disabled and pending states come from design-system.css; never restyle them per page.
 */
export type UiTone = "default" | "secondary" | "primary" | "ghost" | "danger";
type UiSize = "compact" | "standard" | "large";

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: UiTone;
  size?: UiSize;
  pending?: boolean;
  pendingLabel?: string;
};

export const UiButton = forwardRef<HTMLButtonElement, UiButtonProps>(function UiButton({
  className,
  tone = "default",
  size = "standard",
  pending = false,
  pendingLabel = "処理中…",
  children,
  disabled,
  ...props
}, ref) {
  return <button
    ref={ref}
    className={clsx("ui-button", `ui-button--${tone}`, `ui-button--${size}`, className)}
    disabled={disabled || pending}
    aria-busy={pending || undefined}
    {...props}
  >{pending ? pendingLabel : children}</button>;
});

export function UiLinkButton({
  className,
  tone = "default",
  size = "standard",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: UiTone; size?: UiSize }) {
  return <a className={clsx("ui-button", `ui-button--${tone}`, `ui-button--${size}`, className)} {...props} />;
}

export const UiInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function UiInput({ className, invalid, ...props }, ref) {
    return <input ref={ref} className={clsx("ui-control", className)} aria-invalid={invalid || undefined} {...props} />;
  },
);

export function UiSelect({ className, invalid, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select className={clsx("ui-control", className)} aria-invalid={invalid || undefined} {...props} />;
}

export function UiTextarea({ className, invalid, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={clsx("ui-control", "ui-control--textarea", className)} aria-invalid={invalid || undefined} {...props} />;
}

export function UiCheckbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return <label className={clsx("ui-checkbox", className)}>
    <input type="checkbox" {...props} />
    <span aria-hidden="true" />
    <strong>{label}</strong>
  </label>;
}

export function UiField({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return <label className={clsx("ui-field", className)}>
    <span className="ui-field__label">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
    {children}
    {error ? <span className="ui-field__error">{error}</span> : hint ? <span className="ui-field__hint">{hint}</span> : null}
  </label>;
}

export function UiCard({ className, interactive = false, ...props }: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return <article className={clsx("ui-card", interactive && "ui-card--interactive", className)} {...props} />;
}

export function UiTabs({
  label,
  items,
  className,
}: {
  label: string;
  items: Array<{ label: ReactNode; href: string; selected?: boolean; count?: number }>;
  className?: string;
}) {
  return <nav className={clsx("ui-tabs", className)} aria-label={label}>
    {items.map((item) => <a key={item.href} href={item.href} aria-current={item.selected ? "page" : undefined}>
      <span>{item.label}</span>{typeof item.count === "number" ? <strong>{item.count}</strong> : null}
    </a>)}
  </nav>;
}

/*
 * titleAs exists because a panel is sometimes the whole screen. Where a page
 * shows nothing but this — an admin screen refusing an unauthorised visitor —
 * its title is the page`s heading, and rendering it as strong left five
 * screens with no heading at all. The appearance does not change.
 */
export function UiStatePanel({
  state,
  title,
  titleAs: Title = "strong",
  description,
  action,
  className,
}: {
  state: "empty" | "loading" | "error" | "forbidden" | "success";
  title: ReactNode;
  titleAs?: "strong" | "h1" | "h2";
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return <section className={clsx("ui-state", `ui-state--${state}`, className)} role={state === "error" ? "alert" : state === "loading" ? "status" : undefined} aria-live={state === "loading" ? "polite" : undefined}>
    <span className="ui-state__mark" aria-hidden="true" />
    <Title className="ui-state__title">{title}</Title>
    {description ? <p>{description}</p> : null}
    {action ? <div>{action}</div> : null}
  </section>;
}

export function UiConfirmationDialog({
  title,
  description,
  cancel,
  confirm,
  danger = false,
}: {
  title: ReactNode;
  description: ReactNode;
  cancel: ReactNode;
  confirm: ReactNode;
  danger?: boolean;
}) {
  return <div className="ui-confirmation" role="dialog" aria-modal="true" aria-labelledby="ui-confirmation-title">
    <section className="ui-confirmation__panel">
      <span className={clsx("ui-confirmation__mark", danger && "ui-confirmation__mark--danger")} aria-hidden="true" />
      <h2 id="ui-confirmation-title">{title}</h2>
      <div className="ui-confirmation__description">{description}</div>
      <div className="ui-confirmation__actions">{cancel}{confirm}</div>
    </section>
  </div>;
}
