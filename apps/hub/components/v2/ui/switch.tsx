"use client";

import { useId } from "react";

import { cx } from "./cx";

/*
 * Switch (SPEC 3): 44 x 26 track, 22px thumb. role="switch" on a real button so
 * Space/Enter work and the accessible name is the visible label. Controlled.
 */
export type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
};

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const labelId = useId();
  const descId = useId();
  return (
    <div className={cx("ui-switch-row", className)}>
      <span className="ui-switch-row__text">
        <span id={labelId} className="ui-switch-row__label">{label}</span>
        {description ? <span id={descId} className="ui-switch-row__desc">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        className="ui-switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
