"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { displayInitial } from "@/lib/display-initial";

/*
 * 他のハブの人を @名前@ハブ でフォローする。POST /api/federation/follows が WebFinger で相手を引き、
 * Follow を送る。相手が承認する（Accept）まで「承認待ち」。送ったフォローの状態は GET で並べる。
 */
type Item = { profileId: string; profileHandle: string; handle: string; displayName: string; host: string; state: "pending" | "accepted" | "rejected" };

export function V2RemoteFollow({ japanese }: { japanese: boolean }) {
  const [handle, setHandle] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/federation/follows", { credentials: "same-origin", signal: AbortSignal.timeout(30_000) });
      const payload = await response.json().catch(() => ({})) as { follows?: Item[] };
      if (response.ok && payload.follows) setItems(payload.follows);
    } catch { /* 一覧は補助。フォロー自体は動く。 */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const label = (state: Item["state"]) => state === "accepted"
    ? (japanese ? "フォロー中" : "Following")
    : state === "pending" ? (japanese ? "承認待ち" : "Pending") : (japanese ? "断られました" : "Declined");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = handle.trim();
    if (!value || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/federation/follows", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: value }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<Item> & { error?: string };
      if (!response.ok) throw new Error(payload.error || String(response.status));
      setNotice({
        kind: "ok",
        text: payload.state === "accepted"
          ? (japanese ? `${payload.displayName ?? value} をフォローしました。` : `Now following ${payload.displayName ?? value}.`)
          : (japanese ? "フォローを申し込みました。相手の承認を待っています。" : "Follow request sent. Waiting for approval."),
      });
      setHandle("");
      await load();
    } catch (caught) {
      setNotice({ kind: "error", text: caught instanceof Error && caught.message ? caught.message : (japanese ? "フォローできませんでした。" : "Could not follow.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v2-remote-follow" aria-label={japanese ? "他のハブの人をフォロー" : "Follow someone on another Hub"}>
      <form className="v2-search__form" onSubmit={submit}>
        <input
          type="text"
          value={handle}
          maxLength={320}
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="@name@hub.example"
          aria-label={japanese ? "他のハブの人をフォロー（@名前@ハブ）" : "Follow someone on another Hub (@name@hub)"}
          onChange={(event) => setHandle(event.target.value)}
        />
        <V2Button type="submit" variant="primary" label={japanese ? "フォロー" : "Follow"} disabled={busy || !handle.trim()} />
      </form>
      <p className="v2-note">{japanese ? "他のハブの人をフォロー（@名前@ハブ）。相手が承認すると、その人の投稿がタイムラインに届きます。" : "Follow someone on another Hub (@name@hub). Their posts arrive once they approve."}</p>
      {notice ? <p className={notice.kind === "error" ? "v2-error" : "v2-note"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}
      {items.length ? (
        <ul className="v2-people">
          {items.map((item) => (
            <li key={item.profileId} className="v2-person">
              <span className="v2-post__avatar v2-post__avatar--placeholder" data-initial={displayInitial(item.displayName)} aria-hidden="true" />
              <Link className="v2-person__body" href={`/v2/profile/${encodeURIComponent(item.profileHandle)}`}>
                <span className="v2-post__name">{item.displayName}</span>
                <span className="v2-post__handle">@{item.handle}</span>
              </Link>
              <span className="v2-badge" data-state={item.state}>{label(item.state)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
