import Link from "next/link";
import React from "react";

import { Avatar } from "@/components/v2/ui/avatar";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2LibraryPopularTags } from "@/components/v2/v2-library-popular";
import { V2TagChip } from "@/components/v2/v2-tag-chip";
import { V2LibraryCartCount, V2LibraryPin } from "@/components/v2/v2-library-pin";
import { V2State } from "@/components/v2/v2-state";
import type { LibraryColumnData, LibraryGroup, LibraryItem } from "@/lib/library-column";
import "@/app/v2/v2-library-column.css";

/*
 * 左の列の「自分のもの」(2026-10-29)。節（タイムライン・記事・動画・音楽・マーケット・ゲーム・研究）の既存の目録の下に置く。
 * 行は 36px（24px の顔またはアイコン＋ラベル）。1つの群に最大 6 行、あふれたら「すべて見る」。
 * 空の群は薄い1行と1つの行動、未ログインは V2State signedOut を1つ。
 * サーバーでも描ける。固定の押し手とカート件数だけがクライアント。
 */
function Face({ item }: { item: LibraryItem }) {
  if (item.imageUrl || item.shape === "person") return <Avatar name={item.label} src={item.imageUrl} size={24} shape={item.shape ?? "person"} className="v2-lib__face" />;
  return <span className="v2-lib__icon" aria-hidden="true"><V2Icon name={item.icon ?? "list"} /></span>;
}

function Row({ item, section, japanese }: { item: LibraryItem; section: LibraryColumnData["section"]; japanese: boolean }) {
  return (
    <li className="v2-lib__row" data-pinned={item.pinned ? "true" : undefined}>
      {item.tag ? <div className="v2-lib__link v2-lib__link--tag"><V2TagChip tag={item.tag} kind={item.chipKind} /></div> : <Link className="v2-lib__link" href={item.href} title={item.label}>
        <Face item={item} />
        <span className="v2-lib__label">{item.label}</span>
        {item.key === "cart:local" ? <V2LibraryCartCount /> : item.count ? <span className="v2-lib__count">{item.count >= 100 ? "99+" : item.count}</span> : null}
      </Link>}
      {item.pinnable === false ? null : <V2LibraryPin section={section} itemKey={item.key} label={item.label} pinned={Boolean(item.pinned)} japanese={japanese} />}
    </li>
  );
}

function Group({ group, section, japanese }: { group: LibraryGroup; section: LibraryColumnData["section"]; japanese: boolean }) {
  return (
    <section className="v2-lib__group" aria-labelledby={`v2-lib-${section}-${group.id}`}>
      <h2 className="v2-lib__heading" id={`v2-lib-${section}-${group.id}`}>{group.title}</h2>
      {group.items.length ? (
        <ul className="v2-lib__list">
          {group.items.map((item) => <Row key={item.key} item={item} section={section} japanese={japanese} />)}
        </ul>
      ) : (
        <p className="v2-lib__empty">
          <span>{group.empty.text}</span>{" "}
          <Link className="v2-lib__empty-action" href={group.empty.action.href}>{group.empty.action.label}</Link>
        </p>
      )}
      {group.seeAllHref && group.items.length ? <Link className="v2-lib__all" href={group.seeAllHref}>{japanese ? "すべて見る" : "See all"}</Link> : null}
    </section>
  );
}

export function V2LibraryColumn({ data, signedIn, japanese = true, next }: { data: LibraryColumnData | null; signedIn: boolean; japanese?: boolean; next?: string }) {
  if (!signedIn) {
    return (
      <div className="v2-lib" data-state="signed-out">
        <V2State kind="signedOut" compact japanese={japanese} next={next} title={japanese ? "ログインすると、あなたのものが並びます" : "Sign in to see your library"} />
      </div>
    );
  }
  if (!data) return null;
  /* 空の群が2つ以上なら1枚の「はじめに」にまとめる。積み重なった「まだ…ありません」を出さない（監査 S8）。 */
  const isEmpty = (group: LibraryGroup) => group.items.length === 0 && Boolean(group.empty.action.label);
  const emptyGroups = data.groups.filter(isEmpty);
  const collapse = emptyGroups.length >= 2;
  return (
    <div className="v2-lib" data-section={data.section}>
      {data.groups.map((group) => {
        if (collapse && isEmpty(group)) {
          if (group !== emptyGroups[0]) return null;
          return (
            <section key="getting-started" className="v2-lib__group" aria-labelledby={`v2-lib-${data.section}-start`}>
              <h2 className="v2-lib__heading" id={`v2-lib-${data.section}-start`}>{japanese ? "はじめに" : "Getting started"}</h2>
              <ul className="v2-lib__list">
                {emptyGroups.map((empty) => (
                  <li key={empty.id} className="v2-lib__row">
                    <Link className="v2-lib__link v2-lib__start-link" href={empty.empty.action.href}><span className="v2-lib__label">{empty.empty.action.label}</span></Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        }
        return (
          <React.Fragment key={group.id}>
            <Group group={group} section={data.section} japanese={japanese} />
            {group.id === "tags" && data.popular ? <V2LibraryPopularTags popular={data.popular} japanese={japanese} /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
