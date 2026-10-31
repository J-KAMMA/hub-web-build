"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { displayInitial } from "@/lib/display-initial";
import type { SidebarChannel, SidebarKind, SidebarPage } from "@/lib/server/client-sidebar";
import "@/app/v2/v2-media-column.css";

/*
 * 動画・音楽・フィード・記事の内側の列（2026-10-16、Hub Desktop の 2026-10-15 の形に合わせる）。
 * 上の段 → （動画だけ）「フォロー中 ›」と顔つきの行。マイページの節は無い（2026-10-18）。ブックマーク・リストなどは本人のプロフィールから開く。
 * アイコンの列にある行き先（プロフィールなど）は繰り返さない。
 * フォロー中は1頁30件のキーセットで、最後の行が見えたら続きを読む（OFFSET なし）。
 */

export type V2MediaRow = {
  key: string;
  label: string;
  icon: V2IconName;
  href: string;
  selected?: boolean;
  /* 登録の行だけ。並べ替えで保存する相手。 */
  nav?: { type: "list" | "community"; id: string };
  /* コミュニティの公開画像。https:// か / で始まる URL だけ。読めなければ人のアイコンに戻す。 */
  imageUrl?: string;
  /* 上の段の行だけ。直下に字下げして並ぶ子の行（フィード・リスト・コミュニティ）。 */
  children?: V2MediaRow[];
};

export type V2MediaColumnProps = {
  kind: SidebarKind;
  japanese: boolean;
  topRows: V2MediaRow[];
  /* 見出しを押したときの行き先。無ければ見出しは文字だけ。 */
  subscriptionsHref?: string;
  subscriptionsSelected?: boolean;
  /* ログイン中だけ。null ならフォロー中の節は出さない。 */
  initial: Pick<SidebarPage, "channels" | "nextCursor"> | null;
  /* フォロー中の行の行き先（サーバーから関数は渡せないので、前置きの文字列で渡す）。 */
  profileBase?: string;
  videoChannelBase?: string;
  selectedChannelId?: string;
};

function RowIcon({ row }: { row: V2MediaRow }) {
  const [broken, setBroken] = useState(false);
  if (row.imageUrl && !broken && (row.imageUrl.startsWith("/") || row.imageUrl.startsWith("https://"))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="v2-mc__thumb" src={row.imageUrl} width={20} height={20} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  }
  return <V2Icon name={row.icon} className="v2-mc__icon" />;
}

function Row({ row }: { row: V2MediaRow }) {
  return (
    <Link
      className="v2-mc__row"
      href={row.href}
      aria-current={row.selected ? "page" : undefined}
      title={row.label}
    >
      <RowIcon row={row} />
      <span className="v2-mc__label">{row.label}</span>
    </Link>
  );
}

/*
 * 上の段の直下の子の行。字下げして並ぶ。「並べ替える」の編集中は、リストとコミュニティの行に ↑ / ↓ が出る（動かせる行が 1 つだけの子の列には出さない）。
 */
function SubRows({ parent, rows, editing, japanese, onMove }: { parent: string; rows: V2MediaRow[]; editing: boolean; japanese: boolean; onMove: (parent: string, index: number, delta: -1 | 1) => void }) {
  const t = (ja: string, en: string) => (japanese ? ja : en);
  const movable = rows.filter((row) => row.nav);
  return (
    <div className="v2-mc__sub" data-sub={parent}>
      {rows.map((row) => {
        const index = movable.indexOf(row);
        return editing && row.nav && movable.length >= 2 ? (
          <div key={row.key} className="v2-mc__row v2-mc__row--edit">
            <RowIcon row={row} />
            <span className="v2-mc__label">{row.label}</span>
            <button type="button" className="v2-mc__step" disabled={index === 0} aria-label={t(`${row.label}を上へ`, `Move ${row.label} up`)} onClick={() => onMove(parent, index, -1)}>↑</button>
            <button type="button" className="v2-mc__step" disabled={index === movable.length - 1} aria-label={t(`${row.label}を下へ`, `Move ${row.label} down`)} onClick={() => onMove(parent, index, 1)}>↓</button>
          </div>
        ) : <Row key={row.key} row={row} />;
      })}
    </div>
  );
}

function Avatar({ channel }: { channel: SidebarChannel }) {
  const src = channel.type === "profile" ? channel.avatarUrl : null;
  const [broken, setBroken] = useState(false);
  if (src && !broken && (src.startsWith("/") || src.startsWith("https://"))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="v2-mc__avatar" src={src} width={28} height={28} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
  }
  return <span className="v2-mc__avatar v2-mc__avatar--initial" aria-hidden="true">{displayInitial(channel.name)}</span>;
}

export function V2MediaColumn({
  kind,
  japanese,
  topRows,
  subscriptionsHref,
  subscriptionsSelected = false,
  initial,
  profileBase = "/v2/profile/",
  videoChannelBase = "/v2/videos?q=",
  selectedChannelId,
}: V2MediaColumnProps) {
  const [channels, setChannels] = useState<SidebarChannel[]>(initial?.channels ?? []);
  const [next, setNext] = useState<string | null>(initial?.nextCursor ?? null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const sentinel = useRef<HTMLDivElement | null>(null);
  const t = (ja: string, en: string) => (japanese ? ja : en);

  /* 子の行の並び（上の段の key ごと）。並べ替えはその子の中だけで動く。 */
  const [subs, setSubs] = useState<Record<string, V2MediaRow[]>>({});
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  const saveSeq = useRef(0);
  const signature = topRows.map((row) => `${row.key}=${(row.children ?? []).map((child) => child.key).join(",")}`).join("|");
  useEffect(() => {
    setSubs(Object.fromEntries(topRows.map((row) => [row.key, row.children ?? []])));
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const childrenOf = (row: V2MediaRow) => subs[row.key] ?? row.children ?? [];
  const canReorder = topRows.some((row) => childrenOf(row).filter((child) => child.nav).length >= 2);

  const move = (parent: string, index: number, delta: -1 | 1) => {
    const current = subs[parent] ?? [];
    const movable = current.filter((row) => row.nav);
    const target = index + delta;
    if (target < 0 || target >= movable.length) return;
    const swapped = movable.slice();
    [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
    let cursor = 0;
    const nextRows = current.map((row) => (row.nav ? swapped[cursor++] : row));
    const nextSubs = { ...subs, [parent]: nextRows };
    setSubs(nextSubs);
    const seq = ++saveSeq.current;
    /* 保存は並び全体の置き換えなので、リスト → コミュニティの順で全部送る。 */
    const body = ["list", "community"].flatMap((type) =>
      topRows.flatMap((row) => (nextSubs[row.key] ?? row.children ?? []).flatMap((child) => (child.nav && child.nav.type === type ? [child.nav] : []))));
    fetch("/api/account/nav-order", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((response) => { if (seq === saveSeq.current) setFailed(!response.ok); })
      .catch(() => { if (seq === saveSeq.current) setFailed(true); });
  };

  const more = useCallback(async () => {
    if (!next || status === "loading") return;
    setStatus("loading");
    try {
      const response = await fetch(`/api/client/sidebar/${kind}/${next}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const page = await response.json() as Pick<SidebarPage, "channels" | "nextCursor">;
      setChannels((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...page.channels.filter((item) => !known.has(item.id))];
      });
      setNext(typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : null);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }, [kind, next, status]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !next || status !== "idle" || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void more();
    }, { root: node.closest(".v2__tabs-column"), rootMargin: "0px 0px 240px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [next, status, more]);

  return (
    <div className="v2-mc" data-kind={kind}>
      <nav className="v2-mc__group" aria-label={t("表示", "Views")}>
        {topRows.map((row) => (
          <React.Fragment key={row.key}>
            <Row row={row} />
            {childrenOf(row).length ? <SubRows parent={row.key} rows={childrenOf(row)} editing={editing} japanese={japanese} onMove={move} /> : null}
          </React.Fragment>
        ))}
      </nav>
      {failed ? <p className="v2-mc__note" role="status">{t("並びを保存できませんでした", "Could not save the order")}</p> : null}
      {canReorder ? (
        <button type="button" className="v2-mc__text-button" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>
          {editing ? t("完了", "Done") : t("並べ替える", "Reorder")}
        </button>
      ) : null}
      {initial ? (
        <>
          {kind === "videos" ? (
            <>
          <hr className="v2-mc__divider" />
          <section className="v2-mc__group" aria-label={t("フォロー中", "Following")}>
            {subscriptionsHref ? (
              <Link className="v2-mc__heading v2-mc__heading--link" href={subscriptionsHref} aria-current={subscriptionsSelected ? "page" : undefined}>
                <span>{t("フォロー中", "Following")}</span>
                <span className="v2-mc__chevron" aria-hidden="true">›</span>
              </Link>
            ) : <p className="v2-mc__heading">{t("フォロー中", "Following")}</p>}
            {channels.map((channel) => (
              <Link
                key={channel.id}
                className="v2-mc__row v2-mc__row--channel"
                href={channel.type === "profile" ? profileBase + encodeURIComponent(channel.handle) : videoChannelBase + encodeURIComponent(channel.name)}
                title={channel.name}
                aria-current={selectedChannelId === channel.id ? "page" : undefined}
              >
                <Avatar channel={channel} />
                <span className="v2-mc__label">{channel.name}</span>
              </Link>
            ))}
            {!channels.length ? <p className="v2-mc__note">{t("まだ登録していません", "Nothing yet")}</p> : null}
            {status === "failed" ? (
              <button type="button" className="v2-mc__row v2-mc__retry" onClick={() => setStatus("idle")}>
                <span className="v2-mc__label">{t("読み込めませんでした。もう一度", "Could not load. Try again")}</span>
              </button>
            ) : null}
            {next ? <div ref={sentinel} className="v2-mc__more" aria-hidden="true" /> : null}
          </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
