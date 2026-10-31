"use client";

import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { V2Empty } from "@/components/v2/v2-empty";
import { HubActionCard } from "@/components/hub-action-card";
import {
  UiButton,
  UiConfirmationDialog,
  UiField,
  UiInput,
  UiSelect,
  UiTextarea,
} from "@/components/ui/primitives";
import {
  PUBLIC_LISTING_CATEGORIES,
  PUBLIC_LISTING_KIND_LABELS,
  type PublicListing,
  type PublicListingKind,
} from "@/lib/public-listings";
import { getMarketTaxonomySection } from "@/lib/market-taxonomy";
import { listingMarketProjection } from "@/lib/specialist-market-projection";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import styles from "./public-listings-market.module.css";

type PublicEventDetail = Pick<
  PublicListing,
  "id" | "title" | "providerLabel" | "providerUrl" | "region" | "locality" | "startsAt" | "organizerName" | "cancelledAt" | "cancellationReason" | "updatedAt"
>;

const OWNED_LISTING_STATUS_LABELS: Record<PublicListing["status"], string> = {
  draft: "下書き",
  pending: "審査待ち",
  published: "公開中",
  paused: "公開停止中",
  rejected: "審査で非承認",
};

const EVENT_START_FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "medium",
  timeStyle: "short",
});

function eventStartLabel(startsAt: string | null) {
  if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return null;
  return `${EVENT_START_FORMATTER.format(new Date(startsAt))} JST`;
}

function eventStartsAtPayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value;
  return `${value.length === 16 ? `${value}:00` : value}+09:00`;
}

export function PublicListingsMarket({
  kind,
  initialListings,
  initialCategory = "all",
  initialQuery = "",
  initialCreateOpen = false,
  initialListingId = "",
}: {
  kind: PublicListingKind;
  initialListings: PublicListing[];
  initialCategory?: string;
  initialQuery?: string;
  initialCreateOpen?: boolean;
  initialListingId?: string;
}) {
  const surface = useHubUiSurface();
  const selectedCategory =
    initialCategory === "all"
      ? ""
      : (getMarketTaxonomySection(kind)?.groups.find(
          (group) => group.id === initialCategory,
        )?.title ?? initialCategory);
  const [listings, setListings] = useState(initialListings);
  const query = initialQuery;
  const category = selectedCategory;
  const [createOpen, setCreateOpen] = useState(initialCreateOpen);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ownedListings, setOwnedListings] = useState<PublicListing[] | null>(null);
  const [ownedListingsError, setOwnedListingsError] = useState("");
  const [ownerAuthenticationRequired, setOwnerAuthenticationRequired] = useState(false);
  const [ownedListingsRetry, setOwnedListingsRetry] = useState(0);
  const [cancelledEvent, setCancelledEvent] = useState<PublicEventDetail | null>(null);
  const [cancellationTarget, setCancellationTarget] = useState<PublicListing | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancellationError, setCancellationError] = useState("");
  const [cancelledEventError, setCancelledEventError] = useState("");
  const [cancelledEventRetry, setCancelledEventRetry] = useState(0);
  const cancellationRequest = useRef(0);
  const label = PUBLIC_LISTING_KIND_LABELS[kind];
  const visible = useMemo(() => {
    const normalized = query.normalize("NFKC").toLocaleLowerCase("ja").trim();
    return listings.filter(
      (listing) =>
        (!category || listing.category === category) &&
        (!normalized ||
          [
            listing.title,
            listing.summary,
            listing.providerLabel,
            listing.region,
            listing.locality,
          ]
            .join(" ")
            .normalize("NFKC")
            .toLocaleLowerCase("ja")
            .includes(normalized)),
    );
  }, [category, listings, query]);

  useEffect(() => {
    if (kind !== "events") {
      setOwnedListings(null);
      setOwnedListingsError("");
      setOwnerAuthenticationRequired(false);
      return;
    }
    let active = true;
    void fetch("/api/listings?kind=events&mine=1", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("authentication_required");
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<{ listings?: unknown }>;
      })
      .then((payload) => {
        if (!active) return;
        if (!Array.isArray(payload.listings)) throw new Error("invalid_payload");
        setOwnedListings(payload.listings as PublicListing[]);
        setOwnedListingsError("");
        setOwnerAuthenticationRequired(false);
      })
      .catch((error) => {
        if (!active) return;
        setOwnedListings(null);
        setOwnerAuthenticationRequired(error instanceof Error && error.message === "authentication_required");
        setOwnedListingsError(error instanceof Error && error.message === "authentication_required"
          ? "自分の掲載を確認するにはログインが必要です。"
          : "自分の掲載を読み込めませんでした。公開中の掲載は引き続き確認できます。");
      });
    return () => { active = false; };
  }, [kind, ownedListingsRetry]);

  useEffect(() => {
    cancellationRequest.current += 1;
    setCancellationTarget(null);
    setCancellationReason("");
    setCancelling(false);
    setCancellationError("");
    if (kind !== "events" || !initialListingId) {
      setCancelledEvent(null);
      setCancelledEventError("");
      return;
    }
    let active = true;
    setCancelledEvent(null);
    setCancelledEventError("");
    void fetch(`/api/listings/${encodeURIComponent(initialListingId)}`, { credentials: "same-origin" })
      .then(async (response) => {
        if (response.ok) return response.json() as Promise<{ listing?: PublicEventDetail }>;
        if (response.status === 404) throw new Error("not_found");
        throw new Error("unavailable");
      })
      .then((payload) => {
        if (!active) return;
        if (payload?.listing) setCancelledEvent(payload.listing);
        else setCancelledEventError("掲載情報を取得できませんでした。接続を確認して、再試行してください。");
      })
      .catch((error) => {
        if (!active) return;
        setCancelledEventError(
          error instanceof Error && error.message === "not_found"
            ? "この掲載情報は公開されていません。掲載元の最新情報を確認してください。"
            : "掲載情報を取得できませんでした。接続を確認して、再試行してください。",
        );
      });
    return () => { active = false; };
  }, [kind, initialListingId, cancelledEventRetry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          category: form.get("category"),
          title: form.get("title"),
          summary: form.get("summary"),
          providerLabel: form.get("providerLabel"),
          providerUrl: form.get("providerUrl"),
          region: form.get("region"),
          locality: form.get("locality"),
          priceLabel: form.get("priceLabel"),
          ...(kind === "events" ? {
            startsAt: eventStartsAtPayload(form.get("startsAt")),
            organizerName: form.get("organizerName"),
          } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        listing?: PublicListing;
        error?: string;
      } | null;
      if (response.ok && payload?.listing) {
        setListings((current) => [payload.listing!, ...current]);
        if (kind === "events") {
          setOwnedListings((current) => current ? [payload.listing!, ...current] : current);
        }
        setNotice("掲載を審査へ送りました。公開までは自分だけが確認できます。");
        setCreateOpen(false);
        formElement.reset();
      } else {
        setNotice(
          payload?.error === "authentication_required"
            ? "掲載にはログインが必要です。"
            : "入力内容と掲載元のHTTPS URLを確認してください。内容は保持されています。",
        );
      }
    } catch {
      setNotice(
        "通信できませんでした。入力内容は保持されています。接続を確認して、もう一度送信してください。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelEvent() {
    if (!cancellationTarget || !cancellationReason.trim() || cancelling) return;
    const target = cancellationTarget;
    const request = ++cancellationRequest.current;
    setCancelling(true);
    setCancellationError("");
    try {
      const response = await fetch(`/api/listings/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancellationReason }),
      });
      const payload = await response.json().catch(() => null) as { listing?: PublicListing } | null;
      if (
        request !== cancellationRequest.current ||
        !response.ok ||
        payload?.listing?.id !== target.id ||
        !payload.listing.cancelledAt
      ) {
        if (request !== cancellationRequest.current) return;
        setCancellationError("掲載を取り消せませんでした。理由を確認して、もう一度お試しください。");
        return;
      }
      setOwnedListings((current) => current?.map((listing) => (
        listing.id === payload.listing!.id ? payload.listing! : listing
      )) ?? current);
      setListings((current) => current.filter((listing) => listing.id !== payload.listing!.id));
      setCancelledEvent((current) => current?.id === payload.listing!.id ? payload.listing! : current);
      setCancellationTarget(null);
      setCancellationReason("");
      setNotice(
        payload.listing.status === "published"
          ? "掲載を取り消しました。共有した再訪用URLでは掲載取消済みと表示されます。"
          : "掲載を取り消しました。現在公開されていないため、再訪用URLには表示されません。",
      );
    } catch {
      if (request !== cancellationRequest.current) return;
      setCancellationError("通信できませんでした。掲載の取消状態を確認して、もう一度お試しください。");
    } finally {
      if (request === cancellationRequest.current) setCancelling(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{label}</h1>
          <p>Hub内では掲載・比較・広告のみ。申込みと決済は公式サイトで。</p>
        </div>
        <UiButton type="button" tone={createOpen ? "default" : "primary"} onClick={() => setCreateOpen((open) => !open)}>
          {createOpen ? "閉じる" : "情報を掲載"}
        </UiButton>
      </header>

      {kind === "events" && cancelledEvent ? (
        <section className={styles.cancelled} role="status" aria-label="イベント掲載の取消">
          <strong>{cancelledEvent.cancelledAt ? "このイベント掲載は取消済みです" : "イベント掲載情報"}</strong>
          <span>{cancelledEvent.title}</span>
          {eventStartLabel(cancelledEvent.startsAt) ? <p>開始: {eventStartLabel(cancelledEvent.startsAt)}</p> : null}
          {cancelledEvent.organizerName ? <p>主催: {cancelledEvent.organizerName}</p> : null}
          {cancelledEvent.cancelledAt && cancelledEvent.cancellationReason ? <p>{cancelledEvent.cancellationReason}</p> : null}
          <small>{cancelledEvent.cancelledAt ? `掲載取消 ${new Date(cancelledEvent.cancelledAt).toLocaleString("ja-JP")} · ` : ""}最終更新 {new Date(cancelledEvent.updatedAt).toLocaleString("ja-JP")} · {cancelledEvent.providerLabel}</small>
          <a href={cancelledEvent.providerUrl} target="_blank" rel="noopener noreferrer nofollow ugc">掲載元の最新情報を確認</a>
        </section>
      ) : null}
      {kind === "events" && cancelledEventError ? (
        <section className={styles.cancelled} role="alert">
          <p>{cancelledEventError}</p>
          {cancelledEventError.includes("再試行") ? (
            <UiButton type="button" onClick={() => setCancelledEventRetry((current) => current + 1)}>
              掲載情報を再試行
            </UiButton>
          ) : null}
        </section>
      ) : null}

      {createOpen ? (
        <form className={styles.form} onSubmit={submit}>
          <h2>{label}の情報を掲載</h2>
          <UiField label="カテゴリ" required>
            <UiSelect name="category" required>
              {PUBLIC_LISTING_CATEGORIES[kind].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </UiSelect>
          </UiField>
          <UiField label="タイトル" required>
            <UiInput name="title" maxLength={160} required />
          </UiField>
          <UiField label="概要" required>
            <UiTextarea
              name="summary"
              minLength={20}
              maxLength={1000}
              rows={5}
              required
            />
          </UiField>
          <UiField label="掲載元の名称" required>
            <UiInput name="providerLabel" maxLength={120} required />
          </UiField>
          <UiField label="掲載元の公式URL" hint="HTTPSで公開されている公式ページを指定してください。" required>
            <UiInput
              name="providerUrl"
              type="url"
              inputMode="url"
              placeholder="https://…"
              required
            />
          </UiField>
          <div className={styles.formRow}>
            <label>
              地域
              <UiInput name="region" maxLength={80} />
            </label>
            <label>
              市区町村・場所
              <UiInput name="locality" maxLength={120} />
            </label>
          </div>
          {kind === "events" ? <>
            <UiField label="開始日時" hint="日本時間（JST）で入力します。">
              <UiInput aria-label="開始日時" name="startsAt" type="datetime-local" step={60} />
            </UiField>
            <UiField label="主催者">
              <UiInput aria-label="主催者" name="organizerName" maxLength={120} />
            </UiField>
          </> : null}
          <label>
            参考価格・料金
            <UiInput name="priceLabel" maxLength={64} placeholder="任意" />
          </label>
          <UiButton tone="primary" pending={busy} pendingLabel="送信中…">審査へ送る</UiButton>
        </form>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {kind === "events" && ownedListings?.length ? (
        <section className={styles.owned} aria-label="自分のイベント掲載">
          <h2>自分のイベント掲載</h2>
          {ownedListings.map((listing) => (
            <article key={listing.id}>
              <div>
                <strong>{listing.title}</strong>
                {listing.cancelledAt ? (
                  <p>掲載取消済み · {listing.cancellationReason || "理由は掲載元で確認してください。"}</p>
                ) : (
                  <p>{OWNED_LISTING_STATUS_LABELS[listing.status]}</p>
                )}
                {listing.startsAt ? <small>開始: {eventStartLabel(listing.startsAt)}</small> : null}
                {listing.organizerName ? <small>主催: {listing.organizerName}</small> : null}
                {listing.cancelledAt ? <small>{new Date(listing.cancelledAt).toLocaleString("ja-JP")} に取り消しました</small> : null}
              </div>
              {listing.status === "published" ? (
                <a className={styles.detailLink} href={hubSurfacePath(surface, `/events?listing=${encodeURIComponent(listing.id)}`)}>
                  {listing.cancelledAt ? "掲載取消済みを確認" : "掲載情報"}
                </a>
              ) : null}
              {!listing.cancelledAt ? (
                <UiButton type="button" tone="danger" onClick={() => { cancellationRequest.current += 1; setCancellationReason(""); setCancellationError(""); setCancellationTarget(listing); }}>
                  掲載を取り消す
                </UiButton>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {kind === "events" && ownedListingsError ? (
        <section className={styles.owned} role={ownerAuthenticationRequired ? "status" : "alert"}>
          <p>{ownedListingsError}</p>
          {!ownerAuthenticationRequired ? (
            <UiButton type="button" onClick={() => setOwnedListingsRetry((current) => current + 1)}>
              自分の掲載を再試行
            </UiButton>
          ) : null}
        </section>
      ) : null}

      {visible.length ? (
        <section className={styles.results} aria-label={`${label}の掲載`}>
          {visible.map((listing) => {
            const projection = listingMarketProjection({
              id: listing.id,
              title: listing.title,
              summary: [
                listing.category,
                listing.startsAt ? `開始 ${eventStartLabel(listing.startsAt)}` : "",
                listing.organizerName ? `主催 ${listing.organizerName}` : "",
                listing.region,
                listing.locality,
                listing.summary,
              ]
                .filter(Boolean)
                .join(" · "),
              listingKind: kind,
              providerLabel: listing.providerLabel,
              external: true,
              href: listing.providerUrl,
              priceLabel: listing.priceLabel,
              trustStatus: listing.trustStatus,
              observedAt: listing.updatedAt,
            });
            return (
              <article className={styles.result} key={listing.id}>
                <HubActionCard action={projection.action} />
                <footer>
                  <span>{projection.rights.label}</span>
                  <span>{projection.trust.label}</span>
                  {kind === "events" ? <a className={styles.detailLink} href={hubSurfacePath(surface, `/events?listing=${encodeURIComponent(listing.id)}`)}>掲載情報</a> : null}
                </footer>
              </article>
            );
          })}
        </section>
      ) : (
        <V2Empty title="公開中の掲載はまだありません" />
      )}
      {cancellationTarget ? (
        <UiConfirmationDialog
          danger
          title="イベント掲載を取り消しますか？"
          description={<>
            <p>取消後は通常の検索結果から外れます。再訪した人が掲載の取消理由を確認できるよう、理由を入力してください。外部イベントや予約そのものは掲載元で確認してください。</p>
            {cancellationError ? <p role="alert">{cancellationError}</p> : null}
            <UiField label="取消理由" required>
              <UiTextarea aria-label="取消理由" value={cancellationReason} maxLength={500} rows={3} onChange={(event) => setCancellationReason(event.target.value)} />
            </UiField>
          </>}
          cancel={<UiButton type="button" disabled={cancelling} onClick={() => { cancellationRequest.current += 1; setCancellationTarget(null); setCancellationReason(""); }}>戻る</UiButton>}
          confirm={<UiButton type="button" tone="danger" pending={cancelling} pendingLabel="取消中…" disabled={!cancellationReason.trim()} onClick={() => void cancelEvent()}>掲載の取消を確定</UiButton>}
        />
      ) : null}
    </div>
  );
}
