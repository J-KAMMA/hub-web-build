"use client";

import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import styles from "./compute-workbench.module.css";
import {
  UiButton,
  UiInput,
  UiSelect,
  UiStatePanel,
  UiTextarea
} from "./ui/primitives";

type Availability = "checking" | "ready" | "unavailable" | "error";
type OffersState = "loading" | "ready" | "empty" | "error";
type PaymentLinkState = "checking" | "unlinked" | "linking" | "linked" | "account-required" | "error";
type JobResult = {
  jobId: string;
  state: "COMPLETED";
  output: string;
  specHash: string;
  resultHash: string;
  charged: false;
};
type Offer = {
  id: string;
  resource_class: "cpu";
  template_id: string;
  minimum_reservation_rate_atomic: string;
  minimum_rate_atomic: string;
  settlement_asset: string;
  maximum_duration_seconds: number;
  startup_seconds: number;
  capacity_units: number;
};
type ReservationResult = { reservationId: string; status: "requested"; maximumChargeAtomic: string };
type ReservationSummary = {
  id: string;
  resource_class: "cpu";
  capacity_units: number;
  starts_at: string;
  ends_at: string;
  maximum_reservation_rate_atomic: string;
  maximum_execution_rate_atomic: string;
  settlement_asset: string;
  status: string;
  assigned_offer_id: string | null;
  charged_atomic: string | null;
  completed_at: string | null;
};
type ReservationJob = {
  jobId: string;
  state: string;
  specHash: string;
  resultHash: string | null;
  usage: { wallTimeMillis?: number } | null;
  startedAt: string | null;
  completedAt: string | null;
  output: string | null;
};
const RESERVATION_STATUS: Record<string, string> = {
  requested: "受付済み",
  matching: "照合中",
  reserved: "割り当て済み",
  dispatch_due: "開始準備中",
  running: "実行中",
  completed: "完了",
  cancelled: "取消済み",
  failed: "成立せず終了"
};

async function account(path: string, init?: RequestInit) {
  return fetch(`/account/api/v1${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store"
  });
}

async function computeAssertion(fundingReference?: string): Promise<string> {
  const init = fundingReference ? {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fundingReference })
  } : { method: "POST" };
  let response = await account("/assertions/compute", init);
  if (response.status === 403) {
    const linked = await account("/links/compute", { method: "POST" });
    if (!linked.ok) throw new Error(linked.status === 403 ? "recent_authentication_required" : "compute_link_failed");
    response = await account("/assertions/compute", init);
  }
  if (!response.ok) throw new Error(response.status === 401 ? "account_required" : "assertion_failed");
  const body = await response.json() as { assertion?: string };
  if (!body.assertion) throw new Error("assertion_failed");
  return body.assertion;
}

export function ComputeWorkbench() {
  /* 読み手が居る面。v2 から描かれたら入口も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const [availability, setAvailability] = useState<Availability>("checking");
  const [text, setText] = useState("Hub Computeを試します");
  const [operation, setOperation] = useState<"uppercase" | "lowercase">("uppercase");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<JobResult | null>(null);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"demo" | "reserve">("demo");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersState, setOffersState] = useState<OffersState>("loading");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [startsAt, setStartsAt] = useState(() => {
    const value = new Date(Date.now() + 3_600_000);
    value.setMinutes(0, 0, 0);
    return value.toISOString().slice(0, 16);
  });
  const [durationHours, setDurationHours] = useState(1);
  const capacityUnits = 1;
  const [reservationStep, setReservationStep] = useState<"edit" | "confirm" | "submitting" | "receipt">("edit");
  const [reservationMessage, setReservationMessage] = useState("");
  const [reservation, setReservation] = useState<ReservationResult | null>(null);
  const [paymentLink, setPaymentLink] = useState<PaymentLinkState>("checking");
  const [reservations, setReservations] = useState<ReservationSummary[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reservationJobs, setReservationJobs] = useState<Record<string, ReservationJob>>({});
  const [jobText, setJobText] = useState("予約したComputeで実行します");
  const [jobOperation, setJobOperation] = useState<"uppercase" | "lowercase">("uppercase");
  const [submittingJobId, setSubmittingJobId] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const historyRequestRef = useRef(0);
  const healthRequestRef = useRef(0);
  const offersRequestRef = useRef(0);
  const paymentLinkRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    void loadHealth(controller.signal);
    void loadOffers(controller.signal);
    void loadPaymentLink(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (mode === "reserve" && historyState === "idle") void loadReservations();
  }, [mode, historyState]);

  useEffect(() => {
    if (mode !== "reserve" || historyState !== "ready") return;
    const timer = window.setTimeout(() => { void loadReservations(true); }, 15_000);
    return () => window.clearTimeout(timer);
  }, [mode, historyState, reservations]);

  const selectedOffer = offers.find((offer) => offer.id === selectedOfferId) ?? null;
  const maximumCharge = useMemo(() => selectedOffer
    ? (BigInt(selectedOffer.minimum_reservation_rate_atomic) + BigInt(selectedOffer.minimum_rate_atomic)) *
      BigInt(capacityUnits) * BigInt(durationHours)
    : 0n, [selectedOffer, capacityUnits, durationHours]);

  async function loadHealth(signal?: AbortSignal) {
    const requestId = ++healthRequestRef.current;
    setAvailability("checking");
    try {
      const response = await fetch("/compute/api/v1/health", { cache: "no-store", signal });
      if (!response.ok) throw new Error("health_failed");
      const body = await response.json() as { demoAvailable?: boolean };
      if (!mountedRef.current || requestId !== healthRequestRef.current) return;
      setAvailability(body.demoAvailable ? "ready" : "unavailable");
    } catch (error) {
      if (signal?.aborted || !mountedRef.current || requestId !== healthRequestRef.current) return;
      setAvailability("error");
    }
  }

  async function loadOffers(signal?: AbortSignal) {
    const requestId = ++offersRequestRef.current;
    setOffersState("loading");
    try {
      const response = await fetch("/compute/api/v1/offers", { cache: "no-store", signal });
      if (!response.ok) throw new Error("offers_failed");
      const body = await response.json() as { offers?: Offer[] };
      const nextOffers = body.offers ?? [];
      if (!mountedRef.current || requestId !== offersRequestRef.current) return;
      setOffers(nextOffers);
      setSelectedOfferId((current) =>
        nextOffers.some((offer) => offer.id === current) ? current : nextOffers[0]?.id ?? ""
      );
      setOffersState(nextOffers.length > 0 ? "ready" : "empty");
    } catch {
      if (signal?.aborted || !mountedRef.current || requestId !== offersRequestRef.current) return;
      setOffersState("error");
    }
  }

  async function loadPaymentLink(signal?: AbortSignal) {
    const requestId = ++paymentLinkRequestRef.current;
    setPaymentLink("checking");
    try {
      const response = await account("/links/payment", { signal });
      if (!mountedRef.current || requestId !== paymentLinkRequestRef.current) return;
      if (response.status === 401) return setPaymentLink("account-required");
      if (!response.ok) return setPaymentLink("error");
      const body = await response.json() as { linked?: boolean };
      if (!mountedRef.current || requestId !== paymentLinkRequestRef.current) return;
      setPaymentLink(body.linked ? "linked" : "unlinked");
    } catch {
      if (signal?.aborted || !mountedRef.current || requestId !== paymentLinkRequestRef.current) return;
      setPaymentLink("error");
    }
  }

  async function linkPaymentAccount() {
    if (paymentLink === "linking" || paymentLink === "linked") return;
    setPaymentLink("linking");
    setReservationMessage("Payment Accountの連携を確認しています。");
    try {
      const response = await account("/links/payment", { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "payment_link_failed");
      if (!mountedRef.current) return;
      setPaymentLink("linked");
      setReservationMessage("Payment Accountを連携しました。予約時の資金承認に利用できます。");
    } catch (error) {
      if (!mountedRef.current) return;
      const reason = error instanceof Error ? error.message : "payment_link_failed";
      setPaymentLink(reason === "unauthorized" ? "account-required" : "unlinked");
      setReservationMessage(
        reason === "unauthorized" ? "先にAccountへログインしてください。予約内容は保持されています。" :
        reason === "recent_authentication_required" ? "安全のためAccountへ再ログインしてから連携してください。予約内容は保持されています。" :
        "Payment Accountを連携できませんでした。予約は作成されていません。"
      );
    }
  }

  async function loadReservations(background = false) {
    const requestId = ++historyRequestRef.current;
    if (!background) setHistoryState("loading");
    try {
      const assertion = await computeAssertion();
      const response = await fetch("/compute/api/v1/reservations", {
        headers: { authorization: `Bearer ${assertion}` },
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({})) as { reservations?: ReservationSummary[] };
      if (!response.ok || !body.reservations) throw new Error("history_failed");
      if (!mountedRef.current || requestId !== historyRequestRef.current) return;
      setReservations(body.reservations);
      const jobEntries = await Promise.all(body.reservations
        .filter((item) => ["dispatch_due", "running", "completed"].includes(item.status))
        .map(async (item) => {
          const jobResponse = await fetch(`/compute/api/v1/reservations/${encodeURIComponent(item.id)}/job`, {
            headers: { authorization: `Bearer ${assertion}` },
            cache: "no-store"
          });
          return jobResponse.ok ? [item.id, await jobResponse.json() as ReservationJob] as const : null;
        }));
      if (!mountedRef.current || requestId !== historyRequestRef.current) return;
      setReservationJobs(Object.fromEntries(jobEntries.filter((entry): entry is readonly [string, ReservationJob] => entry !== null)));
      setHistoryState("ready");
    } catch {
      if (!mountedRef.current || requestId !== historyRequestRef.current) return;
      setHistoryState("error");
    }
  }

  async function submitReservationJob(reservationId: string) {
    if (!jobText.trim() || submittingJobId) return;
    setSubmittingJobId(reservationId);
    setReservationMessage("予約したNodeへ計算ジョブを送信しています。");
    try {
      const assertion = await computeAssertion();
      const response = await fetch(`/compute/api/v1/reservations/${encodeURIComponent(reservationId)}/jobs/text`, {
        method: "POST",
        headers: { authorization: `Bearer ${assertion}`, "content-type": "application/json" },
        body: JSON.stringify({
          jobId: `job_${crypto.randomUUID().replaceAll("-", "")}`,
          text: jobText.trim(),
          operation: jobOperation
        })
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "job_failed");
      if (!mountedRef.current) return;
      setReservationMessage("計算ジョブを受け付けました。Nodeの実行結果を自動確認します。");
      await loadReservations();
    } catch {
      if (!mountedRef.current) return;
      setReservationMessage("計算ジョブを開始できませんでした。予約状態を更新して再試行してください。");
    } finally {
      if (mountedRef.current) setSubmittingJobId(null);
    }
  }

  async function cancelReservation(reservationId: string) {
    if (cancellingId) return;
    setCancellingId(reservationId);
    try {
      const assertion = await computeAssertion();
      const response = await fetch(`/compute/api/v1/reservations/${encodeURIComponent(reservationId)}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${assertion}` }
      });
      if (!response.ok) throw new Error("cancel_failed");
      if (!mountedRef.current) return;
      setCancelId(null);
      setReservationMessage("予約を取り消し、未使用の資金枠を解放しました。");
      await loadReservations();
    } catch {
      if (!mountedRef.current) return;
      setReservationMessage("予約を取り消せませんでした。状態を再読み込みして確認してください。");
      setHistoryState("error");
    } finally {
      if (mountedRef.current) setCancellingId(null);
    }
  }

  async function submitReservation() {
    if (!selectedOffer || reservationStep !== "confirm") return;
    setReservationStep("submitting");
    setReservationMessage("Accountを確認し、最大料金の資金枠を確保しています。");
    const fundingReference = `funding_${crypto.randomUUID().replaceAll("-", "")}`;
    const reservationId = `reservation_${crypto.randomUUID().replaceAll("-", "")}`;
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + durationHours * 3_600_000);
    try {
      if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) throw new Error("invalid_start");
      const identityAssertion = await computeAssertion(fundingReference);
      const paymentResponse = await account("/assertions/payment-compute-funding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fundingReference,
          maximumChargeAtomic: maximumCharge.toString(),
          asset: selectedOffer.settlement_asset,
          reservationEndsAt: end.toISOString()
        })
      });
      const paymentBody = await paymentResponse.json().catch(() => ({})) as { assertion?: string; error?: string };
      if (!paymentResponse.ok || !paymentBody.assertion) throw new Error(paymentBody.error ?? "payment_authorization_failed");
      const fundingResponse = await fetch("/shopping/api/commerce/api/v1/compute/funding-grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorization: paymentBody.assertion })
      });
      const fundingBody = await fundingResponse.json().catch(() => ({})) as { grant?: string; error?: string };
      if (!fundingResponse.ok || !fundingBody.grant) throw new Error(fundingBody.error ?? "funding_failed");
      const response = await fetch("/compute/api/v1/reservations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${identityAssertion}`,
          "x-compute-funding": fundingBody.grant,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          reservationId,
          offerId: selectedOffer.id,
          templateId: selectedOffer.template_id,
          resourceClass: selectedOffer.resource_class,
          capacityUnits,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          dispatchSeconds: selectedOffer.startup_seconds,
          maximumReservationRateAtomic: selectedOffer.minimum_reservation_rate_atomic,
          maximumExecutionRateAtomic: selectedOffer.minimum_rate_atomic,
          settlementAsset: selectedOffer.settlement_asset,
          fundingReference
        })
      });
      const body = await response.json().catch(() => ({})) as ReservationResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "reservation_failed");
      if (!mountedRef.current) return;
      setReservation(body);
      setReservationStep("receipt");
      setReservationMessage("予約リクエストを受け付けました。まだ計算資源の割り当ては確定していません。");
      void loadReservations();
    } catch (error) {
      if (!mountedRef.current) return;
      const reason = error instanceof Error ? error.message : "reservation_failed";
      setReservationStep("confirm");
      setReservationMessage(
        reason === "account_required" ? "Accountへのログインが必要です。予約内容は保持されています。" :
        reason === "recent_authentication_required" ? "安全のためAccountへ再ログインしてください。予約内容は保持されています。" :
        reason === "payment_link_required" ? "Payment Accountの連携が必要です。予約は作成されていません。" :
        reason === "compute_funding_unavailable" ? "現在、Computeの資金確保を利用できません。予約は作成されておらず、料金も発生していません。" :
        reason === "invalid_start" ? "開始日時を現在より後に設定してください。" :
        "予約を受け付けられませんでした。予約は作成されておらず、入力内容は保持されています。"
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = text.trim();
    if (!input || submitting || availability !== "ready") return;
    setSubmitting(true);
    setMessage("Accountを確認し、無料の開発ジョブを開始しています。");
    setResult(null);
    try {
      const assertion = await computeAssertion();
      const response = await fetch("/compute/api/v1/demo/text", {
        method: "POST",
        headers: {
          authorization: `Bearer ${assertion}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ text: input, operation })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "execution_failed");
      }
      const body = await response.json() as JobResult;
      if (!mountedRef.current) return;
      setResult(body);
      setMessage("計算が完了しました。料金は発生していません。");
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (error) {
      if (!mountedRef.current) return;
      const reason = error instanceof Error ? error.message : "execution_failed";
      setMessage(
        reason === "account_required" ? "Accountへのログインが必要です。入力内容はこの画面に残っています。" :
        reason === "recent_authentication_required" ? "安全のため、Accountへ再ログインしてからもう一度お試しください。入力内容は残っています。" :
        "計算を完了できませんでした。料金は発生していません。入力を確認して再試行できます。"
      );
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <h1>計算を依頼する</h1>
          <p>承認済みテンプレートを、隔離された計算ジョブとして実行します。</p>
        </div>
      </header>

      <aside data-state={availability} aria-live="polite">
        <strong>
          {availability === "checking"
            ? "接続を確認中"
            : availability === "ready"
              ? "無料開発枠を利用できます"
              : availability === "unavailable"
                ? "無料開発枠は停止中です"
                : "接続状態を確認できません"}
        </strong>
        <span>
          {availability === "error"
            ? "入力内容は保持されています。接続を確認して再試行できます。"
            : "この体験では決済・外部マイニング・任意コード実行を行いません。"}
        </span>
        {(availability === "error" || availability === "unavailable") && (
          <UiButton type="button" size="compact" onClick={() => void loadHealth()}>
            接続を再確認
          </UiButton>
        )}
      </aside>

      <nav className={styles.modeSwitch} aria-label="Computeの利用方法">
        <button type="button" aria-current={mode === "demo" ? "page" : undefined} onClick={() => setMode("demo")}>今すぐ試す</button>
        <button type="button" aria-current={mode === "reserve" ? "page" : undefined} onClick={() => setMode("reserve")}>容量を予約</button>
      </nav>

      {mode === "demo" && <form className={styles.card} onSubmit={submit}>
        <div className={styles.cardHeader}>
          <div>
            <h2>テキスト変換</h2>
            <p>入力した文字を大文字または小文字へ変換します。</p>
          </div>
          <span className={styles.price}>今回の料金　0円</span>
        </div>

        <label>
          変換するテキスト
          <UiTextarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={4000}
            rows={7}
            aria-describedby="compute-text-help"
          />
          <small id="compute-text-help">{text.length.toLocaleString("ja-JP")} / 4,000文字。ジョブ実行に必要な範囲でComputeへ送信します。</small>
        </label>

        <fieldset>
          <legend>変換方法</legend>
          <label><input type="radio" name="operation" value="uppercase" checked={operation === "uppercase"} onChange={() => setOperation("uppercase")} />大文字にする</label>
          <label><input type="radio" name="operation" value="lowercase" checked={operation === "lowercase"} onChange={() => setOperation("lowercase")} />小文字にする</label>
        </fieldset>

        <div className={styles.actions}>
          <UiButton
            type="submit"
            tone="primary"
            pending={submitting}
            pendingLabel="計算しています…"
            disabled={!text.trim() || availability !== "ready"}
          >
            無料でテキストを変換
          </UiButton>
          <span>
            {availability === "checking"
              ? "接続確認が終わると実行できます。入力内容は保持されます。"
              : availability !== "ready"
                ? "Computeへ接続できるまで実行できません。入力内容は保持されます。"
                : "処理中も入力内容を保持します。失敗時に料金は発生しません。"}
          </span>
        </div>

        {message && <p className={styles.notice} role="status" aria-live="polite">{message}</p>}
      </form>}

      {mode === "demo" && result && (
        <section className={styles.result} ref={resultRef} tabIndex={-1} aria-labelledby="compute-result-title">
          <div>
            <span>COMPLETED</span>
            <h2 id="compute-result-title">変換が完了しました</h2>
          </div>
          <output>{result.output}</output>
          <details>
            <summary>検証情報</summary>
            <dl>
              <div><dt>Job</dt><dd>{result.jobId}</dd></div>
              <div><dt>Spec hash</dt><dd>{result.specHash}</dd></div>
              <div><dt>Result hash</dt><dd>{result.resultHash}</dd></div>
            </dl>
          </details>
        </section>
      )}

      {mode === "reserve" && (
        <>
        <section className={styles.card} aria-labelledby="reservation-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="reservation-title">計算容量を予約</h2>
              <p>公開オファーから上限料金を確認し、利用時間を確保します。</p>
            </div>
            <span className={styles.price}>
              {offersState === "ready" && selectedOffer
                ? `最大 ${maximumCharge.toString()} ${selectedOffer.settlement_asset}`
                : "料金を確認中"}
            </span>
          </div>

          {reservationStep === "receipt" && reservation ? (
            <div className={styles.receipt} tabIndex={-1}>
              <span>REQUESTED</span>
              <h3>予約リクエストを受け付けました</h3>
              <p>次にComputeが空き容量を照合します。受付時点では割り当て未確定です。</p>
              <dl>
                <div><dt>予約ID</dt><dd>{reservation.reservationId}</dd></div>
                <div><dt>状態</dt><dd>マッチング待ち</dd></div>
                <div><dt>最大料金</dt><dd>{reservation.maximumChargeAtomic} {selectedOffer?.settlement_asset}</dd></div>
              </dl>
            </div>
          ) : (
            <>
              <div className={styles.connection} data-state={paymentLink}>
                <div>
                  <strong>{paymentLink === "linked" ? "Payment Account 連携済み" : "予約にはPayment Account連携が必要です"}</strong>
                  <span>Compute予約の資金承認にだけ使用します。Hubへ支払情報やPayment内部IDは渡りません。連携はAccountから解除できます。</span>
                </div>
                {paymentLink === "account-required" ? (
                  <a href={hubSurfacePath(surface, "/auth")}>Accountへログイン</a>
                ) : paymentLink === "error" ? (
                  <UiButton type="button" size="compact" onClick={() => void loadPaymentLink()}>
                    連携状態を再確認
                  </UiButton>
                ) : paymentLink !== "linked" && (
                  <UiButton
                    type="button"
                    size="compact"
                    onClick={linkPaymentAccount}
                    pending={paymentLink === "linking"}
                    pendingLabel="連携しています…"
                    disabled={paymentLink === "checking"}
                  >
                    {paymentLink === "checking" ? "状態を確認中…" : "Payment Accountを連携"}
                  </UiButton>
                )}
              </div>
              {offersState === "loading" && (
                <UiStatePanel
                  state="loading"
                  title="利用できる計算枠を確認しています"
                  description="予約内容はこの画面に保持されます。"
                />
              )}
              {offersState === "error" && (
                <UiStatePanel
                  state="error"
                  title="計算枠を読み込めませんでした"
                  description="予約は作成されておらず、料金も発生していません。"
                  action={<UiButton type="button" size="compact" onClick={() => void loadOffers()}>再試行</UiButton>}
                />
              )}
              {offersState === "empty" && (
                <UiStatePanel
                  state="empty"
                  title="現在予約できる計算枠はありません"
                  description="時間をおいて再確認してください。入力した日時と利用時間は保持されます。"
                  action={<UiButton type="button" size="compact" onClick={() => void loadOffers()}>空き状況を更新</UiButton>}
                />
              )}
              {offersState === "ready" && (
                <label>
                  オファー
                  <UiSelect
                    value={selectedOfferId}
                    onChange={(event) => {
                      setSelectedOfferId(event.target.value);
                      setReservationStep("edit");
                    }}
                    disabled={reservationStep === "submitting"}
                    aria-describedby="compute-offer-help"
                  >
                    {offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.resource_class.toUpperCase()} · {offer.template_id}</option>)}
                  </UiSelect>
                  <small id="compute-offer-help">
                    {reservationStep === "submitting" ? "予約処理中のため変更できません。" : "料金と起動目安を確認して選択してください。"}
                  </small>
                </label>
              )}
              {offersState === "ready" && selectedOffer && <div className={styles.offerFacts}>
                <span>実行枠 <strong>1 CPUスロット</strong></span>
                <span>予約 <strong>{selectedOffer.minimum_reservation_rate_atomic} {selectedOffer.settlement_asset}/unit時</strong></span>
                <span>実行 <strong>{selectedOffer.minimum_rate_atomic} {selectedOffer.settlement_asset}/unit時</strong></span>
                <span>起動目安 <strong>{selectedOffer.startup_seconds}秒</strong></span>
              </div>}
              <div className={styles.fieldGrid}>
                <label>開始日時<UiInput type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setReservationStep("edit"); }} disabled={reservationStep === "submitting"} /><small>{reservationStep === "submitting" ? "予約処理中のため変更できません。" : "現在より後の日時を指定してください。"}</small></label>
                <label>利用時間<UiInput type="number" min="1" max={selectedOffer ? Math.floor(selectedOffer.maximum_duration_seconds / 3600) : 24} value={durationHours} onChange={(event) => { setDurationHours(Math.max(1, Number(event.target.value))); setReservationStep("edit"); }} disabled={reservationStep === "submitting"} /><small>{reservationStep === "submitting" ? "予約処理中のため変更できません。" : "1時間単位"}</small></label>
                <label>容量<UiInput type="text" value="1 CPUスロット" readOnly aria-readonly="true" /><small>このMVPは1 Node IDにつき1直列実行枠です</small></label>
              </div>

              {reservationStep === "confirm" || reservationStep === "submitting" ? (
                <div className={styles.confirmation}>
                  <h3>予約内容の最終確認</h3>
                  <p>最大 <strong>{maximumCharge.toString()} {selectedOffer?.settlement_asset}</strong> の資金枠を確保します。実際の請求額は予約料金と実行時間に基づき、この上限を超えません。</p>
                  <div className={styles.actions}>
                    <UiButton
                      type="button"
                      tone="primary"
                      onClick={submitReservation}
                      pending={reservationStep === "submitting"}
                      pendingLabel="資金を確認しています…"
                    >
                      最大 {maximumCharge.toString()} {selectedOffer?.settlement_asset} で申し込む
                    </UiButton>
                    <UiButton className={styles.secondary} type="button" onClick={() => setReservationStep("edit")} disabled={reservationStep === "submitting"}>内容を修正</UiButton>
                  </div>
                </div>
              ) : (
                <div className={styles.actions}>
                  <UiButton
                    type="button"
                    tone="primary"
                    disabled={!selectedOffer || !startsAt || paymentLink !== "linked" || offersState !== "ready"}
                    onClick={() => {
                      setReservationMessage("");
                      setReservationStep("confirm");
                    }}
                  >
                    予約内容を確認
                  </UiButton>
                  <span>
                    {offersState === "loading"
                      ? "計算枠の確認が終わると進めます。"
                      : offersState === "error"
                        ? "計算枠を再読み込みしてください。"
                        : offersState === "empty"
                          ? "予約できる計算枠がありません。"
                          : paymentLink !== "linked"
                            ? "Payment Accountの連携を完了すると進めます。"
                            : "確認だけでは資金確保や予約作成は行いません。"}
                  </span>
                </div>
              )}
            </>
          )}
          {reservationMessage && <p className={styles.notice} role="status" aria-live="polite">{reservationMessage}</p>}
        </section>
        <section className={styles.card} aria-labelledby="reservation-history-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="reservation-history-title">予約履歴</h2>
              <p>最新50件の受付・割り当て・完了状態をComputeから確認します。</p>
            </div>
            <UiButton
              className={styles.compactButton}
              type="button"
              size="compact"
              pending={historyState === "loading"}
              pendingLabel="更新中…"
              onClick={() => { void loadReservations(); }}
            >
              履歴を更新
            </UiButton>
          </div>
          {historyState === "idle" && <UiStatePanel state="empty" title="予約履歴をまだ取得していません" description="本人の予約だけを取得します。" />}
          {historyState === "loading" && <UiStatePanel state="loading" title="予約履歴を読み込んでいます" description="現在の入力や予約設定は保持されます。" />}
          {historyState === "error" && (
            <UiStatePanel
              state="error"
              title="予約履歴を確認できませんでした"
              description="入力内容は保持されています。接続を確認して再試行してください。"
              action={<UiButton type="button" size="compact" onClick={() => void loadReservations()}>再試行</UiButton>}
            />
          )}
          {historyState === "ready" && reservations.length === 0 && <UiStatePanel state="empty" title="予約履歴はありません" description="新しい予約を作成すると、ここで状態を確認できます。" />}
          {reservations.length > 0 && <div className={styles.reservationList}>
            {reservations.map((item) => {
              const cancellable = ["requested", "matching", "reserved"].includes(item.status);
              const reservationJob = reservationJobs[item.id];
              const maximum = (BigInt(item.maximum_reservation_rate_atomic) + BigInt(item.maximum_execution_rate_atomic)) *
                BigInt(item.capacity_units) *
                BigInt(Math.ceil((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 3_600_000));
              return <article key={item.id}>
                <div>
                  <span>{item.resource_class.toUpperCase()} · {item.capacity_units} unit</span>
                  <strong>{new Date(item.starts_at).toLocaleString("ja-JP")}から</strong>
                  <small>
                    {item.charged_atomic !== null
                      ? `確定 ${item.charged_atomic} ${item.settlement_asset} · 最大 ${maximum.toString()} ${item.settlement_asset}`
                      : `最大 ${maximum.toString()} ${item.settlement_asset}`}
                    {" · "}{item.assigned_offer_id ? "割り当て済み" : "割り当て待ち"}
                  </small>
                  {item.completed_at && <small>完了 {new Date(item.completed_at).toLocaleString("ja-JP")}</small>}
                </div>
                <div className={styles.reservationStatus}>
                  <strong>{RESERVATION_STATUS[item.status] ?? "状態確認中"}</strong>
                  {cancellable && cancelId !== item.id && <button type="button" onClick={() => setCancelId(item.id)}>予約を取り消す</button>}
                </div>
                {cancelId === item.id && <div className={styles.cancelConfirmation}>
                  <p>この予約を取り消し、未使用の資金枠を解放します。取り消した予約は元に戻せません。</p>
                  <button type="button" onClick={() => cancelReservation(item.id)} disabled={Boolean(cancellingId)}>
                    {cancellingId === item.id ? "取り消しています…" : "予約を取り消して資金枠を解放"}
                  </button>
                  <button type="button" onClick={() => setCancelId(null)} disabled={Boolean(cancellingId)}>戻る</button>
                </div>}
                {item.status === "dispatch_due" && !reservationJob && <div className={styles.reservationExecution}>
                  <label>実行するテキスト<UiTextarea value={jobText} maxLength={4000} rows={3} onChange={(event) => setJobText(event.target.value)} /></label>
                  <fieldset>
                    <legend>変換方法</legend>
                    <label><input type="radio" checked={jobOperation === "uppercase"} onChange={() => setJobOperation("uppercase")} />大文字</label>
                    <label><input type="radio" checked={jobOperation === "lowercase"} onChange={() => setJobOperation("lowercase")} />小文字</label>
                  </fieldset>
                  <UiButton
                    type="button"
                    tone="primary"
                    onClick={() => submitReservationJob(item.id)}
                    disabled={!jobText.trim() || Boolean(submittingJobId)}
                    pending={submittingJobId === item.id}
                    pendingLabel="Nodeへ送信中…"
                  >
                    予約したNodeで実行
                  </UiButton>
                  {submittingJobId && submittingJobId !== item.id && <small>別の予約へジョブを送信中のため、完了後に実行できます。</small>}
                </div>}
                {reservationJob && <div className={styles.jobResult}>
                  <strong>Job {reservationJob.state}</strong>
                  {reservationJob.output !== null
                    ? <output>{reservationJob.output}</output>
                    : <span>Nodeの実行結果を待っています。</span>}
                  {reservationJob.resultHash && <small>Result {reservationJob.resultHash}</small>}
                </div>}
              </article>;
            })}
          </div>}
        </section>
        </>
      )}
    </section>
  );
}
