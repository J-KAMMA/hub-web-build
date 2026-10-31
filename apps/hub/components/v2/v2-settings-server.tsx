"use client";

import { useEffect, useState } from "react";
import { V2Skeleton } from "@/components/v2/v2-skeleton";

/*
 * サーバーに置く設定2つ。既存の notification-settings / content-safety-settings
 * から機能だけを抜いた。APIの形は既存と同じ:
 *   GET/PUT /api/settings/notifications { notifications: {…}, directMessages }
 *   GET/PUT /api/settings/content-safety { terms: string[], showSensitive }
 */

type NotificationPrefs = {
  replies: boolean;
  reactions: boolean;
  follows: boolean;
  messages: boolean;
  commercePayments: boolean;
  commerceDelivery: boolean;
  commerceReturns: boolean;
};
type DmPolicy = "mutuals" | "following" | "nobody";

const NOTIFICATION_ROWS: { key: keyof NotificationPrefs; ja: string; en: string }[] = [
  { key: "replies", ja: "返信", en: "Replies" },
  { key: "reactions", ja: "リアクション", en: "Reactions" },
  { key: "follows", ja: "フォロー", en: "Follows" },
  { key: "messages", ja: "メッセージ", en: "Messages" },
  { key: "commercePayments", ja: "支払い（コマース）", en: "Payments (commerce)" },
  { key: "commerceDelivery", ja: "配送（コマース）", en: "Delivery (commerce)" },
  { key: "commerceReturns", ja: "返品（コマース）", en: "Returns (commerce)" },
];

export function V2SettingsNotifications({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [dm, setDm] = useState<DmPolicy>("mutuals");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { notifications: NotificationPrefs; directMessages: DmPolicy };
        setPrefs(payload.notifications);
        setDm(payload.directMessages);
      })
      .catch(() => setStatus(ja ? "通知設定を読み込めませんでした。" : "Could not load notification settings."));
  }, [ja]);

  const save = async (nextPrefs: NotificationPrefs, nextDm: DmPolicy) => {
    const before = { prefs, dm };
    setPrefs(nextPrefs);
    setDm(nextDm);
    try {
      /* 通知の設定は PATCH、コンテンツの安全は PUT。既存の route がそう分かれている。 */
      const response = await fetch("/api/settings/notifications", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notifications: nextPrefs, directMessages: nextDm }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setStatus(ja ? "保存しました" : "Saved");
    } catch {
      setPrefs(before.prefs);
      setDm(before.dm);
      setStatus(ja ? "保存できませんでした。" : "Could not save.");
    }
  };

  if (!prefs) return status ? <p className="v2-note">{status}</p> : <V2Skeleton kind="lines" count={4} japanese={ja} />;

  return (
    <div className="v2-settings__group">
      <p className="v2-settings__saved" role="status" aria-live="polite">{status ?? ""}</p>
      <fieldset className="v2-settings__field"><legend>{ja ? "受け取る通知" : "Notifications to receive"}</legend>
        {NOTIFICATION_ROWS.map((row) => (
          <label key={row.key} className="v2-filter__row v2-choice">
            <input type="checkbox" checked={prefs[row.key]} onChange={(event) => void save({ ...prefs, [row.key]: event.target.checked }, dm)} />
            <span>{ja ? row.ja : row.en}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="v2-settings__field"><legend>{ja ? "メッセージを受け取る相手" : "Who can message you"}</legend>
        {([["mutuals", ja ? "相互フォローのみ" : "Mutual follows"], ["following", ja ? "フォローしている相手" : "People I follow"], ["nobody", ja ? "受け取らない" : "Nobody"]] as const).map(([value, label]) => (
          <label key={value} className="v2-choice">
            <input type="radio" name="dm" value={value} checked={dm === value} onChange={() => void save(prefs, value)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function V2SettingsSafety({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const [terms, setTerms] = useState<string[] | null>(null);
  const [showSensitive, setShowSensitive] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/content-safety", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { terms: string[]; showSensitive: boolean };
        setTerms(payload.terms);
        setShowSensitive(payload.showSensitive);
      })
      .catch(() => setStatus(ja ? "設定を読み込めませんでした。" : "Could not load."));
  }, [ja]);

  const save = async (nextTerms: string[], nextShow: boolean) => {
    const before = { terms, showSensitive };
    setTerms(nextTerms);
    setShowSensitive(nextShow);
    try {
      const response = await fetch("/api/settings/content-safety", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: nextTerms, showSensitive: nextShow }),
      });
      const payload = await response.json().catch(() => ({})) as { terms?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      if (payload.terms) setTerms(payload.terms);
      setStatus(ja ? "保存しました" : "Saved");
    } catch (caught) {
      setTerms(before.terms);
      setShowSensitive(before.showSensitive);
      setStatus(caught instanceof Error && caught.message ? caught.message : (ja ? "保存できませんでした。" : "Could not save."));
    }
  };

  if (!terms) return status ? <p className="v2-note">{status}</p> : <V2Skeleton kind="lines" count={4} japanese={ja} />;

  return (
    <div className="v2-settings__group">
      <p className="v2-settings__saved" role="status" aria-live="polite">{status ?? ""}</p>
      <label className="v2-filter__row v2-choice">
        <input type="checkbox" checked={showSensitive} onChange={(event) => void save(terms, event.target.checked)} />
        <span>{ja ? "注意が要る内容を最初から表示する" : "Show sensitive content without a warning"}</span>
      </label>
      <fieldset className="v2-settings__field"><legend>{ja ? "ミュートする語（2〜80字、50件まで）" : "Muted terms (2–80 chars, up to 50)"}</legend>
        {terms.length ? (
          <ul className="v2-settings__terms">
            {terms.map((term) => (
              <li key={term}>
                <span className="v2-badge">{term}</span>
                <button type="button" className="v2-action" onClick={() => void save(terms.filter((item) => item !== term), showSensitive)}>{ja ? "外す" : "Remove"}</button>
              </li>
            ))}
          </ul>
        ) : <p className="v2-note">{ja ? "まだありません。" : "None yet."}</p>}
        <form className="v2-dm__start-row" onSubmit={(event) => { event.preventDefault(); const value = draft.trim(); if (value.length < 2 || value.length > 80 || terms.includes(value) || terms.length >= 50) return; void save([...terms, value], showSensitive); setDraft(""); }}>
          <input className="v2-reply__input" value={draft} maxLength={80} placeholder={ja ? "語を足す" : "Add a term"} aria-label={ja ? "ミュートする語" : "Muted term"} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="v2-toggle v2-toggle--text" disabled={draft.trim().length < 2}>{ja ? "足す" : "Add"}</button>
        </form>
      </fieldset>
    </div>
  );
}
