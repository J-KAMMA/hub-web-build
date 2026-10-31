"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { V2Skeleton } from "@/components/v2/v2-skeleton";

/*
 * ブロック・ミュートした相手の一覧（設定）。2種類を別の一覧で出し、頁送りと解除ができる。
 * データは本人のセッションの行だけ（GET /api/profile/safety/accounts）。解除は既存の
 * PATCH /api/profile/safety。他のハブの人は handle@host で見せる。
 * この一覧は本人以外には出ない（API が呼んだ人の行しか返さない）。
 */

type Kind = "blocked" | "muted";
type Entry = {
  profileId: string;
  handle: string;
  host: string | null;
  acct: string;
  displayName: string;
  avatarUrl: string | null;
};
type PageState = { entries: Entry[]; nextCursor: string | null; loaded: boolean; busy: boolean; error: string | null };

const EMPTY: PageState = { entries: [], nextCursor: null, loaded: false, busy: false, error: null };

const COPY = {
  blocked: {
    ja: "ブロックした相手", en: "Blocked accounts",
    emptyJa: "ブロックしている相手はいません。", emptyEn: "You have not blocked anyone.",
    actionJa: "ブロックを解除", actionEn: "Unblock",
    action: "block" as const,
  },
  muted: {
    ja: "ミュートした相手", en: "Muted accounts",
    emptyJa: "ミュートしている相手はいません。", emptyEn: "You have not muted anyone.",
    actionJa: "ミュートを解除", actionEn: "Unmute",
    action: "mute" as const,
  },
};

function PeopleList({ kind, ja, version, onReleased }: { kind: Kind; ja: boolean; version: number; onReleased: () => void }) {
  const copy = COPY[kind];
  const [state, setState] = useState<PageState>(EMPTY);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setState((current) => ({ ...current, busy: true, error: null }));
    try {
      const query = new URLSearchParams({ kind });
      if (cursor) query.set("cursor", cursor);
      const response = await fetch(`/api/profile/safety/accounts?${query}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { entries: Entry[]; nextCursor: string | null };
      setState((current) => {
        const seen = new Set(cursor ? current.entries.map((entry) => entry.profileId) : []);
        const base = cursor ? current.entries : [];
        return { entries: [...base, ...payload.entries.filter((entry) => !seen.has(entry.profileId))], nextCursor: payload.nextCursor, loaded: true, busy: false, error: null };
      });
    } catch {
      setState((current) => ({ ...current, loaded: true, busy: false, error: ja ? "一覧を読み込めませんでした。" : "Could not load the list." }));
    }
  }, [kind, ja]);

  // version が変わったら（もう一方の一覧で解除したら）頭から読み直す。
  useEffect(() => { void load(null); }, [load, version]);

  const release = async (entry: Entry) => {
    setWorking(entry.profileId);
    try {
      const response = await fetch("/api/profile/safety", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetProfileId: entry.profileId, action: copy.action, enabled: false }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setState((current) => ({ ...current, entries: current.entries.filter((item) => item.profileId !== entry.profileId), error: null }));
      // ブロックを外すと、ミュートが残る人はミュートの一覧に移るので、両方を読み直す。
      if (kind === "blocked") onReleased();
    } catch {
      setState((current) => ({ ...current, error: ja ? "解除できませんでした。" : "Could not remove it." }));
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="v2-people" aria-label={ja ? copy.ja : copy.en}>
      <h3 className="v2-people__title">{ja ? copy.ja : copy.en}</h3>
      {!state.loaded ? <V2Skeleton kind="lines" count={2} japanese={ja} /> : null}
      {state.loaded && state.entries.length === 0 && !state.error ? <p className="v2-note">{ja ? copy.emptyJa : copy.emptyEn}</p> : null}
      {state.error ? <p className="v2-error" role="status">{state.error}</p> : null}
      {state.entries.length ? (
        <ul className="v2-people__list">
          {state.entries.map((entry) => (
            <li key={entry.profileId} className="v2-people__row">
              {entry.avatarUrl
                ? <img className="v2-post__avatar" src={entry.avatarUrl} alt="" width={36} height={36} />
                : <span className="v2-post__avatar" aria-hidden="true" />}
              <span className="v2-people__who">
                <Link className="v2-post__name" href={`/v2/profile/${encodeURIComponent(entry.handle)}`}>{entry.displayName}</Link>
                <span className="v2-people__acct">@{entry.acct}</span>
                {entry.host ? <span className="v2-badge">{ja ? "他のハブ" : "Remote"}</span> : null}
              </span>
              <button type="button" className="v2-action" disabled={working === entry.profileId} onClick={() => void release(entry)}>
                {ja ? copy.actionJa : copy.actionEn}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {state.nextCursor ? (
        <button type="button" className="v2-toggle v2-toggle--text" disabled={state.busy} onClick={() => void load(state.nextCursor)}>
          {state.busy ? (ja ? "読み込み中" : "Loading") : (ja ? "もっと見る" : "Load more")}
        </button>
      ) : null}
    </section>
  );
}

export function V2SettingsPeople({ locale }: { locale: string }) {
  const ja = locale === "ja";
  const [version, setVersion] = useState(0);
  return (
    <div className="v2-settings__group">
      <p className="v2-note">{ja ? "この一覧はあなたにだけ見えます。相手には知らされません。" : "Only you can see these lists. The other person is not told."}</p>
      <PeopleList kind="blocked" ja={ja} version={version} onReleased={() => setVersion((value) => value + 1)} />
      <PeopleList kind="muted" ja={ja} version={version} onReleased={() => setVersion((value) => value + 1)} />
    </div>
  );
}
