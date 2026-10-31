"use client";

/*
 * 設定の入切（2026-09-05）。
 *
 * もとは settings-panel.tsx の中の非公開の関数だった。v2 の設定でも同じ
 * 見た目が要るが、あの 900 行の板ごと v2 の束へ持ち込みたくないので、
 * 見た目だけをここへ出す。字は .setting-row（app/ の全体CSS）が決める。
 */
export function SettingToggle({ label, description, value, onChange, disabled = false }: {
  label: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
