"use client";

import React, {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";

import { Button } from "@/components/v2/ui/button";

import type {
  MarketTicketEvent,
  MarketTicketReservation,
} from "@/lib/server/market-tickets";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import styles from "./market-ticket-system.module.css";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function getDialogFocusableElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      !element.hasAttribute("hidden"),
  );
}

/*
 * 入場確認の経路の根（2026-09-04）。
 *
 * 主催者が受付を開くと、この部品が QR に焼く URL を組み立てる。行き先を
 * "/market/tickets/check-in" に焼き込んでいたため、v2 の主催者が出した QR は
 * 来場者を v2 の外へ送っていた。/v2/market/tickets/check-in は画面が在るのに
 * どこからも辿り着けなかった。
 */
const DEFAULT_TICKETS_BASE = "/market/tickets";

export function MarketTicketSystem({
  initialEvents,
  initialCreating = false,
  creatorOnly = false,
  basePath = DEFAULT_TICKETS_BASE,
}: {
  initialEvents: MarketTicketEvent[];
  initialCreating?: boolean;
  creatorOnly?: boolean;
  basePath?: string;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [creating, setCreating] = useState(initialCreating);
  /* 見ている面の中に留まる。主催者の名前も同じ面のプロフィールへ。 */
  const surface = useHubUiSurface();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingRefundId, setConfirmingRefundId] = useState<string | null>(
    null,
  );
  const [reservations, setReservations] = useState<MarketTicketReservation[]>(
    [],
  );
  const [gate, setGate] = useState<{
    url: string;
    qr: string;
    expiresAt: string;
  } | null>(null);
  const gateDialogRef = useRef<HTMLElement>(null);
  const gateCloseButtonRef = useRef<HTMLButtonElement>(null);
  const gateTriggerRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!gate) return;

    const dialog = gateDialogRef.current;
    const dialogRoot = dialog?.closest<HTMLElement>(
      "[data-market-ticket-dialog-root]",
    );
    if (!dialog || !dialogRoot) return;

    const priorBodyOverflow = document.body.style.overflow;
    const backgroundElements = Array.from(document.body.children)
      .filter((element) => element !== dialogRoot)
      .map((element) => ({
        element,
        ariaHidden: element.getAttribute("aria-hidden"),
        inert: element.getAttribute("inert"),
      }));

    document.body.style.overflow = "hidden";
    for (const { element } of backgroundElements) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }

    const keepFocusInside = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) {
        gateCloseButtonRef.current?.focus();
      }
    };

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setGate(null);
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getDialogFocusableElements(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("focusin", keepFocusInside);
    document.addEventListener("keydown", handleDialogKeyDown);
    gateCloseButtonRef.current?.focus();

    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      document.removeEventListener("keydown", handleDialogKeyDown);
      document.body.style.overflow = priorBodyOverflow;
      for (const { element, ariaHidden, inert } of backgroundElements) {
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
        if (inert === null) element.removeAttribute("inert");
        else element.setAttribute("inert", inert);
      }
      gateTriggerRef.current?.focus();
    };
  }, [gate]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (
      query.get("create") === "1" ||
      window.location.hash === "#market-ticket-create-form"
    ) {
      setCreating(true);
    }
  }, []);

  async function refreshReservations() {
    const response = await fetch("/api/market/tickets/reservations", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const result = (await response.json()) as {
      reservations: MarketTicketReservation[];
    };
    setReservations(result.reservations);
  }

  useEffect(() => {
    void refreshReservations();
  }, []);

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/market/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error);
      const refreshed = (await fetch("/api/market/tickets", {
        cache: "no-store",
      }).then((item) => item.json())) as { events: MarketTicketEvent[] };
      setEvents(refreshed.events);
      form.reset();
      setCreating(creatorOnly);
      setStatus("イベントを公開しました。");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "登録できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/market/tickets/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as {
        error?: string;
        reservation?: {
          totalMinor: number;
          currency: string;
          holdExpiresAt: string;
        };
      };
      if (!response.ok || !result.reservation) throw new Error(result.error);
      setStatus(
        `${money(result.reservation.totalMinor, result.reservation.currency)}分を10分間確保しました。決済完了までは入場券は発行されません。`,
      );
      await refreshReservations();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "確保できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function requestRefund(reservationId: string) {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/market/tickets/reservations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reservationId }),
      });
      const result = (await response.json()) as {
        error?: string;
        refund?: { requiresBurn: boolean };
      };
      if (!response.ok || !result.refund) throw new Error(result.error);
      setStatus(
        result.refund.requiresBurn
          ? "返金申請を受け付けました。入場券の無効化を確認後、元の支払いへ返金します。"
          : "申込をキャンセルし、確保していた在庫を戻しました。",
      );
      setConfirmingRefundId(null);
      await refreshReservations();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "返金を申請できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function openGate(eventId: string, trigger: HTMLButtonElement) {
    gateTriggerRef.current = trigger;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/market/tickets/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", eventId }),
      });
      const result = (await response.json()) as {
        error?: string;
        challenge?: { id: string; nonce: string; expiresAt: string };
      };
      if (!response.ok || !result.challenge) throw new Error(result.error);
      const url = `${window.location.origin}${basePath}/check-in?challenge=${encodeURIComponent(result.challenge.id)}&nonce=${encodeURIComponent(result.challenge.nonce)}`;
      setGate({
        url,
        expiresAt: result.challenge.expiresAt,
        qr: await QRCode.toDataURL(url, { width: 280, margin: 2 }),
      });
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "受付を開始できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function writeGateToNfc() {
    const Reader = Reflect.get(window, "NDEFReader") as
      | undefined
      | (new () => {
          write: (message: {
            records: Array<{ recordType: string; data: string }>;
          }) => Promise<void>;
        });
    if (!gate || !Reader)
      return setStatus(
        "この端末ではNFC書き込みを利用できません。QRをご利用ください。",
      );
    try {
      await new Reader().write({
        records: [{ recordType: "url", data: gate.url }],
      });
      setStatus("60秒間有効な受付URLをNFCへ書き込みました。");
    } catch {
      setStatus("NFCへ書き込めませんでした。QRをご利用ください。");
    }
  }

  return (
    <>
      <div className={styles.page}>
      {!creatorOnly ? (
        <header className={styles.hero}>
          <div>
            <p>イベントを探し、主催者から直接申し込めます。</p>
          </div>
          {events.length || creating ? (
            <Button
              variant={creating ? "secondary" : "primary"}
              aria-expanded={creating}
              aria-controls="market-ticket-create-form"
              onClick={() => setCreating((value) => !value)}
              label={creating ? "閉じる" : "イベントを掲載"}
            />
          ) : null}
        </header>
      ) : null}
      {status ? (
        <p className={styles.status} role="status">
          {status}
        </p>
      ) : null}
      {creating ? (
        <form
          id="market-ticket-create-form"
          className={styles.form}
          onSubmit={createEvent}
        >
          <h2>イベントと最初の券種</h2>
          <label>
            イベント名
            <input name="title" required maxLength={120} />
          </label>
          <label>
            概要
            <textarea name="summary" required maxLength={1000} />
          </label>
          <label>
            会場
            <input name="venueName" required maxLength={160} />
          </label>
          <div>
            <label>
              開始
              <input name="startsAt" type="datetime-local" required />
            </label>
            <label>
              終了
              <input name="endsAt" type="datetime-local" required />
            </label>
          </div>
          <div>
            <label>
              販売開始
              <input name="saleStartsAt" type="datetime-local" required />
            </label>
            <label>
              販売終了
              <input name="saleEndsAt" type="datetime-local" required />
            </label>
          </div>
          <div>
            <label>
              券種名
              <input
                name="ticketName"
                required
                maxLength={80}
                placeholder="一般"
              />
            </label>
            <label>
              価格（円）
              <input name="priceMinor" type="number" min="0" required />
            </label>
          </div>
          <div>
            <label>
              販売枚数
              <input
                name="totalQuantity"
                type="number"
                min="1"
                max="100000"
                required
              />
            </label>
            <label>
              1回の上限
              <input
                name="maxPerOrder"
                type="number"
                min="1"
                max="20"
                defaultValue="4"
                required
              />
            </label>
          </div>
          <p>
            主催者による一次販売のみです。入場券は決済後に発行され、購入者本人だけが利用できます。譲渡・転売や、旅行・宿泊・輸送との抱き合わせには使用できません。
          </p>
          <Button variant="primary" type="submit" disabled={busy} label={busy ? "登録中…" : "イベントを公開"} />
        </form>
      ) : null}
      {!creatorOnly ? (
        <>
          <section className={styles.list} aria-label="販売中のイベント">
        {events.map((item) => (
          <article className={styles.card} key={item.id}>
            <header>
              <div>
                <small>
                  {new Date(item.startsAt).toLocaleString("ja-JP")} ·{" "}
                  {item.venueName}
                </small>
                <h2>{item.title}</h2>
                <p>{item.summary}</p>
                <span className={styles.tokenBadge}>
                  購入者本人のみ利用可能
                </span>
              </div>
              <div className={styles.organizer}>
                <a
                  href={hubSurfacePath(surface, `/profile/${encodeURIComponent(item.organizerHandle)}`)}
                >
                  {item.organizerName}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(event) =>
                    void openGate(item.id, event.currentTarget)
                  }
                >
                  入場受付
                </button>
              </div>
            </header>
            <div className={styles.types}>
              {item.ticketTypes.map((ticket) => (
                <form key={ticket.id} onSubmit={reserve}>
                  <input type="hidden" name="ticketTypeId" value={ticket.id} />
                  <span>
                    <strong>{ticket.name}</strong>
                    <small>残り{ticket.remaining}枚 · 決済前に10分間確保</small>
                  </span>
                  <b>{money(ticket.priceMinor, ticket.currency)}</b>
                  <label>
                    枚数
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      max={Math.min(item.maxPerOrder, ticket.remaining)}
                      defaultValue="1"
                    />
                  </label>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={busy || ticket.remaining < 1}
                    label={ticket.remaining < 1 ? "売り切れ" : "枚数を確保"}
                  />
                </form>
              ))}
            </div>
          </article>
        ))}
        {!events.length ? (
          <div className={styles.empty}>
            <strong>販売中のチケットはありません</strong>
            <p>主催者がイベントを公開すると、ここに表示されます。</p>
            <Button variant="primary" onClick={() => setCreating(true)} label="イベントを掲載する" />
          </div>
        ) : null}
          </section>
          {reservations.length ? (
        <section
          className={styles.history}
          aria-labelledby="ticket-history-title"
        >
          <h2 id="ticket-history-title">申込履歴</h2>
          {reservations.map((reservation) => (
            <article key={reservation.id}>
              <span>
                <strong>{reservation.eventTitle}</strong>
                <small>
                  {reservation.ticketTypeName} × {reservation.quantity}
                </small>
              </span>
              <span className={styles.historyAction}>
                <strong>
                  {money(reservation.totalMinor, reservation.currency)}
                </strong>
                <small>
                  {reservation.refundStatus === "burn_pending"
                    ? "入場券の無効化を確認中"
                    : reservation.refundStatus === "refunded"
                      ? "返金済み"
                      : reservation.token?.status === "issued"
                        ? `入場券発行済み · #${reservation.token.tokenId}`
                        : reservation.token?.status === "revoked"
                          ? "入場券は無効です"
                          : reservation.status === "held"
                            ? "決済待ち"
                            : reservation.status === "expired"
                              ? "確保期限切れ"
                              : "状態を確認中"}
                </small>
                {reservation.status === "held" ||
                (reservation.status === "issued" &&
                  reservation.token?.status === "issued" &&
                  !reservation.refundStatus) ? (
                  confirmingRefundId === reservation.id ? (
                    <div
                      className={styles.confirmAction}
                      role="group"
                      aria-label="取消の確認"
                    >
                      <p>
                        {reservation.status === "held"
                          ? "確保した枚数を戻します。"
                          : "入場券を無効にして返金を申請します。"}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingRefundId(null)}
                      >
                        戻る
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void requestRefund(reservation.id)}
                      >
                        {reservation.status === "held"
                          ? "申込を取り消す"
                          : "無効化して返金を申請"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmingRefundId(reservation.id)}
                    >
                      {reservation.status === "held"
                        ? "申込を取り消す"
                        : "返金を申請"}
                    </button>
                  )
                ) : null}
              </span>
            </article>
          ))}
        </section>
          ) : null}
        </>
      ) : null}
      </div>
      {gate && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.gateBackdrop}
              data-market-ticket-dialog-root
            >
              <section
                ref={gateDialogRef}
                className={styles.gate}
                role="dialog"
                aria-modal="true"
                aria-labelledby="market-ticket-gate-title"
                aria-describedby="market-ticket-gate-description"
                tabIndex={-1}
              >
                <button
                  ref={gateCloseButtonRef}
                  type="button"
                  aria-label="受付を閉じる"
                  onClick={() => setGate(null)}
                >
                  ×
                </button>
                <h2 id="market-ticket-gate-title">タッチ受付</h2>
                <img src={gate.qr} alt="入場用QRコード" />
                <p id="market-ticket-gate-description">
                  この受付は
                  {new Date(gate.expiresAt).toLocaleTimeString("ja-JP")}
                  までの一回限りです。
                </p>
                <Button variant="primary" onClick={() => void writeGateToNfc()} label="NFCへ書き込む" />
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
