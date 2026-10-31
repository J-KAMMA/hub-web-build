"use client";

import {
  CONTENT_LICENSE_IDS,
  contentLicenseName,
  isContentLicenseId,
  isGateCompatibleLicense,
  type ContentLicenseId,
  type ContentLicenseTargetType,
} from "@/lib/content-license";

import "./v2-content-license.css";

/*
 * ライセンスの選択欄。作成面は選んだ値を親へ渡し、親は保存に成功したあと
 * applyContentLicense を呼ぶ（閲覧条件の付け方と同じ）。
 * 閲覧条件が付く作品では全権利留保しか選べない。サーバーも同じ規則で拒む。
 */

export type ApplyLicenseResult = { ok: true } | { ok: false; message: string };

export async function applyContentLicense(targetType: ContentLicenseTargetType, targetId: string, license: ContentLicenseId): Promise<ApplyLicenseResult> {
  if (license === "arr") return { ok: true }; // no row means all rights reserved
  try {
    const response = await fetch("/api/content-licenses", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetType, targetId, license }),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, message: typeof payload?.error === "string" && payload.error ? payload.error : "ライセンスを設定できませんでした。" };
  } catch {
    return { ok: false, message: "通信できませんでした。" };
  }
}

type Props = {
  value: ContentLicenseId;
  onChange: (license: ContentLicenseId) => void;
  japanese?: boolean;
  disabled?: boolean;
  /** The work carries (or will carry) a token gate: only all rights reserved is allowed. */
  gated?: boolean;
  /** Show the "already published" wording (CC cannot be withdrawn). */
  editing?: boolean;
};

export function V2ContentLicensePicker({ value, onChange, japanese = true, disabled = false, gated = false, editing = false }: Props) {
  const open = value !== "arr";
  return (
    <div className="v2-license-picker">
      <label className="v2-license-picker__field">
        <span>{japanese ? "ライセンス" : "License"}</span>
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => { if (isContentLicenseId(event.target.value)) onChange(event.target.value); }}
        >
          {CONTENT_LICENSE_IDS.map((id) => (
            <option key={id} value={id} disabled={gated && !isGateCompatibleLicense(id)}>{contentLicenseName(id, japanese)}</option>
          ))}
        </select>
      </label>
      {gated ? <p className="v2-license-picker__note">{japanese ? "閲覧条件が付く作品は、全権利留保のままにします。" : "Gated works stay all rights reserved."}</p> : null}
      {open ? (
        <p className="v2-license-picker__note">
          {japanese
            ? "自分が権利を持つものだけに付けられます。CCライセンスは取り消せません。あとで厳しい条件へ変えても、すでに受け取った人の許可は消えません。"
            : "Choose this only for works you hold the rights to. CC licenses cannot be withdrawn: a stricter license later does not revoke permission already given."}
        </p>
      ) : null}
      {editing && !open ? (
        <p className="v2-license-picker__note">{japanese ? "CCライセンスを選ぶと、再配布が認められます。" : "A CC license allows others to redistribute the work."}</p>
      ) : null}
    </div>
  );
}
