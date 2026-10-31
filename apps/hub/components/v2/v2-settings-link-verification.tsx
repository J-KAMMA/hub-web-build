"use client";

import { useCallback, useEffect, useState } from "react";

import { V2Skeleton } from "@/components/v2/v2-skeleton";

/*
 * プロフィールのリンクの本人確認（rel="me"）。設定の節。
 * リンク先のページに、このプロフィールへ向かう rel="me" のリンクがあると「確認済み」になる。
 * 確かめるのは、リンクを保存したときと、ここの「確認する」を押したときだけ。
 * 結果の読み出し（GET）は保存済みの結果を返すだけで、外へは取りに行かない。
 */

type Status = "verified" | "unverified" | "error";
type Payload = {
  handle: string;
  links: { label: string; url: string }[];
  verifications: Record<string, { status: Status; checkedAt: string }>;
};

export function V2SettingsLinkVerification({ locale, origin }: { locale: string; origin: string }) {
  const ja = locale === "ja";
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/profile/links/verification", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json() as Payload);
    } catch {
      setMessage(ja ? "リンクを読み込めませんでした。" : "Could not load your links.");
    }
  }, [ja]);

  useEffect(() => { void load(); }, [load]);

  const verify = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/links/verification", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json() as Payload);
    } catch {
      setMessage(ja ? "確認できませんでした。" : "Could not verify.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return message ? <p className="v2-note">{message}</p> : <V2Skeleton kind="lines" count={3} japanese={ja} />;

  const profileUrl = `${origin}/profile/${data.handle}`;
  const label = (status: Status | undefined) => {
    if (status === "verified") return ja ? "確認済み" : "Verified";
    if (status === "unverified") return ja ? "逆リンクが見つかりません" : "No back-link found";
    if (status === "error") return ja ? "ページを確認できませんでした" : "Could not read the page";
    return ja ? "未確認" : "Not checked";
  };

  return (
    <div className="v2-settings__group v2-linkverify">
      <p className="v2-note">
        {ja
          ? "リンク先のページに、次のリンクを rel=\"me\" 付きで置くと「確認済み」になります。"
          : "Add this link, with rel=\"me\", to the linked page to get a verified mark."}
      </p>
      <code className="v2-linkverify__snippet">{`<a rel="me" href="${profileUrl}">Hub</a>`}</code>
      {data.links.length ? (
        <ul className="v2-linkverify__list">
          {data.links.map((link) => {
            const status = data.verifications[link.url]?.status;
            return (
              <li key={link.url} className="v2-linkverify__row">
                <span className="v2-linkverify__url">{link.label || link.url}<span className="v2-people__acct"> {link.url}</span></span>
                <span className={status === "verified" ? "v2-badge v2-badge--verified" : "v2-badge"}>{label(status)}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="v2-note">{ja ? "プロフィールに外部リンクがまだありません。" : "No links on your profile yet."}</p>}
      {data.links.length ? (
        <button type="button" className="v2-toggle v2-toggle--text" disabled={busy} onClick={() => void verify()}>
          {busy ? (ja ? "確認中" : "Checking") : (ja ? "確認する" : "Verify")}
        </button>
      ) : null}
      <p className="v2-settings__saved" role="status" aria-live="polite">{message ?? ""}</p>
    </div>
  );
}
