import React, { type ButtonHTMLAttributes, type ReactNode } from "react";
import { UiButton } from "@/components/ui/primitives";

type AsyncActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingLabel: string;
  children: ReactNode;
};

export function AsyncActionButton({
  pending = false,
  pendingLabel,
  children,
  className,
  disabled,
  type = "button",
  ...props
}: AsyncActionButtonProps) {
  const classes = ["async-action-button", className].filter(Boolean).join(" ");

  return (
    <UiButton
      {...props}
      type={type}
      className={classes}
      disabled={disabled}
      pending={pending}
      pendingLabel={pendingLabel}
      aria-busy={pending}
      data-pending={pending ? "true" : undefined}
    >
      <span className="async-action-button__label">{children}</span>
    </UiButton>
  );
}
