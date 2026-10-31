"use client";

import React from "react";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { NavIcon } from "@/components/sidebar";
import { UiStatePanel } from "@/components/ui/primitives";
import {
  HUB_SERVICE_GROUPS,
  HUB_SERVICE_PURPOSES,
  HUB_SERVICES,
  searchHubServices,
  type HubServiceDefinition,
  type HubServicePurpose,
} from "@/lib/hub-services";
import type { HubServiceStateCounts } from "@/lib/server/services-page-data";
import { v2ServiceHref } from "@/lib/v2-service-href";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

const PINNED_KEY = "hub.services.pinned";
const RECENT_KEY = "hub.services.recent";
const MAX_PINNED = 4;
const pinnableIds = new Set(HUB_SERVICES.filter((service) => service.href).map((service) => service.id));

function readIds(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && pinnableIds.has(item)))] : [];
  } catch {
    return [];
  }
}

function ServiceCard({
  service,
  pinned,
  stateLabel,
  onPin,
  onOpen,
  onMove,
  pinDisabled = false,
  moveBackDisabled = false,
  moveForwardDisabled = false,
}: {
  service: HubServiceDefinition;
  pinned: boolean;
  stateLabel?: string;
  onPin: () => void;
  onOpen: () => void;
  onMove?: (direction: -1 | 1) => void;
  pinDisabled?: boolean;
  moveBackDisabled?: boolean;
  moveForwardDisabled?: boolean;
}) {
  const copy = <><span className="services-directory__icon"><NavIcon href={service.iconHref} /></span><span className="services-directory__card-copy"><strong>{service.label}</strong><small>{service.description}</small>{stateLabel || service.stateLabel ? <em data-state={service.state ?? "available"}>{stateLabel ?? service.stateLabel}</em> : null}</span></>;
  return <article className="services-directory__card" data-disabled={!service.href || undefined}>
    {service.href ? <Link href={service.href} prefetch={false} onClick={onOpen}>{copy}<span className="services-directory__arrow" aria-hidden="true">→</span></Link> : <div className="services-directory__disabled">{copy}</div>}
    {service.href ? <button
      type="button"
      className="services-directory__pin"
      onClick={onPin}
      aria-pressed={pinned}
      aria-label={pinned ? `${service.label}の固定を解除` : pinDisabled ? "固定は4件までです。別の固定を解除してください" : `${service.label}を固定`}
      title={pinDisabled ? "固定は4件までです" : undefined}
      disabled={pinDisabled}
    >{pinned ? "★" : "☆"}</button> : null}
    {onMove ? <span className="services-directory__move">
      <button type="button" onClick={() => onMove(-1)} aria-label={`${service.label}を前へ`} disabled={moveBackDisabled}>←</button>
      <button type="button" onClick={() => onMove(1)} aria-label={`${service.label}を後ろへ`} disabled={moveForwardDisabled}>→</button>
    </span> : null}
  </article>;
}

/*
 * preferV2: v2 の中から開いたときに、対応する v2 の画面が在ればそちらへ渡す
 * （2026-09-04）。目録の行き先はすべて既存の道なので、そのままだと押した瞬間に
 * v2 の外へ出てしまう。関数は渡せない（サーバーからクライアントへ渡らない）ので
 * 真偽値で受け、差し替えはここでする。
 */
export function ServicesDirectory({ notificationCount = 0, profileHref = "/profile/me", stateCounts, preferV2 = false, hiddenServiceIds = [] }: { notificationCount?: number; profileHref?: string; stateCounts: HubServiceStateCounts; preferV2?: boolean; hiddenServiceIds?: readonly string[] }) {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState<HubServicePurpose | null>(null);
  const [tab, setTab] = useState<"mine" | "all">("mine");
  const [pinned, setPinned] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setPinned(readIds(PINNED_KEY).slice(0, MAX_PINNED));
    setRecent(readIds(RECENT_KEY).slice(0, 12));
    setReady(true);
  }, []);

  const services = useMemo(() => HUB_SERVICES.filter((service) => !hiddenServiceIds.includes(service.id)).map((service) => {
    if (service.id === "profile") return { ...service, href: profileHref };
    return preferV2 ? { ...service, href: v2ServiceHref(service.href) } : service;
  }), [profileHref, preferV2, hiddenServiceIds]);
  const byId = useMemo(() => new Map(services.map((service) => [service.id, service])), [services]);
  const frequent = useMemo(() => {
    const ids = [...pinned, ...recent, "feed", "search", "hubpedia", "communities"];
    return [...new Set(ids)].flatMap((id) => byId.get(id) ? [byId.get(id)!] : []).slice(0, 4);
  }, [byId, pinned, recent]);
  const results = useMemo(() => searchHubServices(query, services)
    .filter((service) => !purpose || service.purposes.includes(purpose)), [purpose, query, services]);

  const persist = (key: string, ids: string[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      setStorageError(true);
    }
  };
  const togglePin = (id: string) => {
    if (!pinned.includes(id) && pinned.length >= MAX_PINNED) return;
    const next = pinned.includes(id) ? pinned.filter((item) => item !== id) : [...pinned, id];
    setPinned(next);
    persist(PINNED_KEY, next);
  };
  const remember = (id: string) => {
    const next = [id, ...recent.filter((item) => item !== id)].slice(0, 12);
    setRecent(next);
    persist(RECENT_KEY, next);
  };
  const movePinned = (id: string, direction: -1 | 1) => {
    const from = pinned.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= pinned.length) return;
    const next = [...pinned];
    [next[from], next[to]] = [next[to], next[from]];
    setPinned(next);
    persist(PINNED_KEY, next);
  };
  const stateLabel = (service: HubServiceDefinition) => {
    if (service.id === "notifications" && notificationCount > 0) return `${notificationCount > 99 ? "99+" : notificationCount}件の未読`;
    if (service.id === "communities" && stateCounts.communities > 0) return `${stateCounts.communities}件に参加中`;
    if (service.id === "bookmarks" && stateCounts.bookmarks > 0) return `${stateCounts.bookmarks}件を保存`;
    if (service.id === "feed" && stateCounts.scheduledPosts > 0) return `${stateCounts.scheduledPosts}件を予約中`;
    if (service.id === "work" && stateCounts.workManaged > 0) return `${stateCounts.workManaged}件を管理中`;
    return undefined;
  };
  const filtered = Boolean(query || purpose);
  const pinLimitReached = pinned.length >= MAX_PINNED;
  const selectTab = (next: "mine" | "all") => {
    setTab(next);
    tabRefs.current[next === "mine" ? 0 : 1]?.focus();
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? 1
        : event.key === "ArrowRight"
          ? (index + 1) % 2
          : (index - 1 + 2) % 2;
    selectTab(nextIndex === 0 ? "mine" : "all");
  };

  return <section className="services-directory">
    {storageError ? <p role="status">この端末に設定を保存できませんでした。今の画面では使えますが、再訪時には反映されない場合があります。</p> : null}
    <header className="services-directory__header">
      <p>やりたいことから、Hubの機能へすぐ移動できます。</p>
      <label className="services-directory__search">
        <NavIcon href={hubSurfacePath(surface, "/search")} />
        <span className="sr-only">サービスを検索</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="サービス名や「要約」「内覧」などで検索" autoComplete="off" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="検索語を消去">消去</button> : null}
      </label>
    </header>

    <section className="services-directory__purposes" aria-label="目的から探す">
      {HUB_SERVICE_PURPOSES.map((item) => <button type="button" key={item.id} aria-pressed={purpose === item.id} onClick={() => setPurpose((current) => current === item.id ? null : item.id)}>
        <strong>{item.label}</strong><small>{item.description}</small>
      </button>)}
    </section>

    {!query && !purpose ? <section className="services-directory__frequent">
      <header><div><h2>よく使うサービス</h2><p>最大4件。星で自分用に固定できます。</p></div><span>{pinned.length}/{MAX_PINNED} 固定</span></header>
      <div className="services-directory__grid">{frequent.map((service) => <ServiceCard key={service.id} service={service} pinned={pinned.includes(service.id)} pinDisabled={pinLimitReached && !pinned.includes(service.id)} stateLabel={stateLabel(service)} onPin={() => togglePin(service.id)} onOpen={() => remember(service.id)} />)}</div>
    </section> : null}

    {!filtered ? <div className="services-directory__tabs" role="tablist" aria-label="サービス表示">
      <button id="services-tab-mine" ref={(node) => { tabRefs.current[0] = node; }} type="button" role="tab" aria-selected={tab === "mine"} aria-controls="services-panel-mine" tabIndex={tab === "mine" ? 0 : -1} onKeyDown={(event) => onTabKeyDown(event, 0)} onClick={() => setTab("mine")}>自分のサービス</button>
      <button id="services-tab-all" ref={(node) => { tabRefs.current[1] = node; }} type="button" role="tab" aria-selected={tab === "all"} aria-controls="services-panel-all" tabIndex={tab === "all" ? 0 : -1} onKeyDown={(event) => onTabKeyDown(event, 1)} onClick={() => setTab("all")}>すべてのサービス</button>
    </div> : <div className="services-directory__filter-status" role="status">
      <strong>検索結果</strong>
      <button type="button" onClick={() => { setQuery(""); setPurpose(null); }}>条件を解除</button>
    </div>}

    {tab === "mine" && !filtered ? <section id="services-panel-mine" role="tabpanel" aria-labelledby="services-tab-mine" className="services-directory__mine">
      {!ready ? <UiStatePanel state="loading" title="固定したサービスを読み込んでいます" /> : pinned.length === 0 ? <div className="services-directory__empty"><strong>固定したサービスはまだありません</strong><p>カードの星を押すと、ここに最大4件を並べられます。</p><button type="button" onClick={() => selectTab("all")}>サービスを選ぶ</button></div> :
        <div className="services-directory__grid">{pinned.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []).map((service, index, pinnedServices) => <ServiceCard key={service.id} service={service} pinned stateLabel={stateLabel(service)} onPin={() => togglePin(service.id)} onOpen={() => remember(service.id)} onMove={(direction) => movePinned(service.id, direction)} moveBackDisabled={index === 0} moveForwardDisabled={index === pinnedServices.length - 1} />)}</div>}
    </section> : null}

    {(tab === "all" || filtered) ? <div id={!filtered ? "services-panel-all" : undefined} role={!filtered ? "tabpanel" : undefined} aria-labelledby={!filtered ? "services-tab-all" : undefined} className="services-directory__groups">
      {HUB_SERVICE_GROUPS.map((group) => {
        const items = results.filter((service) => service.group === group.id);
        if (!items.length) return null;
        return <section className="services-directory__group" key={group.id}>
          <header><div><h2>{group.label}</h2><p>{group.description}</p></div><span>{items.length}件</span></header>
          <div className="services-directory__grid">{items.map((service) => <ServiceCard key={service.id} service={service} pinned={pinned.includes(service.id)} pinDisabled={pinLimitReached && !pinned.includes(service.id)} stateLabel={stateLabel(service)} onPin={() => togglePin(service.id)} onOpen={() => remember(service.id)} />)}</div>
        </section>;
      })}
      {!results.length ? <div className="services-directory__empty"><strong>一致するサービスがありません</strong><p>別の言葉で検索するか、目的の選択を解除してください。</p></div> : null}
    </div> : null}
  </section>;
}
