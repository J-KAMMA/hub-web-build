"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { readOrderAccessToken } from "@/lib/commerce-order-records";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

const API = "/shopping/api/commerce/api/v1";
type Order = {
  id: string;
  status: string;
  quantity: number;
  amountJpyc: number;
  paidAt: string | null;
  fulfillmentType?: string | null;
  fulfillmentStatus: string | null;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  logisticsStatus: string | null;
  returnStatus: string | null;
};
type Event = { eventType: string; publicMessage: string; createdAt: string };
type ReturnRequest = {
  id: string;
  reasonCode: string;
  detail: string | null;
  status: string;
  requestedAt: string;
  updatedAt: string;
};
type PhysicalEscrow = {
  state: string;
  networkKey: string;
  contractAddress: string;
  amountAtomic: string;
  shipBy: string;
  releaseAt: string;
  lockTransactionHash: string | null;
  releaseTransactionHash: string | null;
  refundTransactionHash: string | null;
  disputeResolutionDeadline?: string | null;
};
type EscrowProposal = {
  proposedBy: "buyer" | "seller";
  buyerAmountAtomic: string;
  sellerAmountAtomic: string;
  proposedAt: string;
  status: string;
};
type Refund = {
  id: string;
  status: "submitted" | "confirmed" | "rejected";
  refundAmountAtomic: string;
  sellerRefundTransactionHash: string | null;
  hubFeeTransactionHash: string | null;
  sellerConfirmedAt: string | null;
  hubFeeConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type RefundAttempt = {
  refundId: string;
  role: "seller" | "hub_fee";
  transactionHash: string;
  status: "submitted" | "confirmed" | "rejected";
  failureReason: string | null;
  submittedAt: string;
  resolvedAt: string | null;
};
type PreparedAction = {
  action: string;
  chainId: number;
  to: string;
  data: `0x${string}`;
  value: `0x${string}`;
};
type PaymentException = {
  id: string;
  expectedAtomic: string;
  observedAtomic: string;
  exceptionType: "underpaid" | "overpaid";
  status: string;
  detectedAt: string;
  resolutionTransfer: {
    chainId: number;
    from: string;
    to: string;
    value: `0x${string}`;
    data: `0x${string}`;
    amountAtomic: string;
  } | null;
};

export function CommerceOrderTracker({ orderId }: { orderId: string }) {
  /* 見ている面の中に留まる。注文詳細は v1 と v2 の両方から開く。 */
  const surface = useHubUiSurface();
  const wallet = useHubWallet();
  const [order, setOrder] = useState<Order | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [returnRequest, setReturnRequest] = useState<ReturnRequest | null>(null),
    [physicalEscrow, setPhysicalEscrow] = useState<PhysicalEscrow | null>(null);
  const [escrowProposal, setEscrowProposal] = useState<EscrowProposal | null>(
    null,
  );
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [refundAttempts, setRefundAttempts] = useState<RefundAttempt[]>([]);
  const [paymentException, setPaymentException] =
    useState<PaymentException | null>(null);
  const [escrowSubmissionFailed, setEscrowSubmissionFailed] = useState(false);
  const [message, setMessage] = useState("注文情報を読み込んでいます。"),
    [loadState, setLoadState] = useState<
      "loading" | "ready" | "no-access" | "error"
    >("loading"),
    [busy, setBusy] = useState(false);
  const token = () => readOrderAccessToken(orderId) ?? "";
  const load = useCallback(async () => {
    setLoadState("loading");
    const accessToken = token();
    if (!accessToken) {
      setMessage("この端末に注文の閲覧権限がありません。");
      setLoadState("no-access");
      return;
    }
    try {
      const response = await fetch(`${API}/orders/${orderId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const body = (await response.json()) as {
        order?: Order;
        events?: Event[];
        returnRequest?: ReturnRequest | null;
        physicalEscrow?: PhysicalEscrow | null;
        escrowProposal?: EscrowProposal | null;
        refund?: Refund | null;
        refunds?: Refund[];
        refundAttempts?: RefundAttempt[];
        paymentException?: PaymentException | null;
        escrowSubmissions?: { status: string }[];
        error?: string;
      };
      if (!response.ok || !body.order) {
        setMessage(body.error ?? "注文情報を読み込めませんでした。");
        setLoadState("error");
        return;
      }
      setOrder(body.order);
      setEvents(body.events ?? []);
      setReturnRequest(body.returnRequest ?? null);
      setPhysicalEscrow(body.physicalEscrow ?? null);
      setEscrowProposal(body.escrowProposal ?? null);
      setRefunds(body.refunds ?? (body.refund ? [body.refund] : []));
      setRefundAttempts(body.refundAttempts ?? []);
      setPaymentException(body.paymentException ?? null);
      setEscrowSubmissionFailed(
        body.escrowSubmissions?.some(
          (submission) => submission.status === "failed",
        ) ?? false,
      );
      setMessage("");
      setLoadState("ready");
    } catch {
      setMessage("注文情報を読み込めませんでした。");
      setLoadState("error");
    }
  }, [orderId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function escrowAction(
    action:
      | "confirm"
      | "release"
      | "refund_unshipped"
      | "dispute"
      | "propose_resolution"
      | "accept_resolution"
      | "finalize_expired_dispute",
  ) {
    setBusy(true);
    try {
      if (!wallet.address && !(await wallet.connect()))
        throw new Error("ウォレットへ接続できません。");
      const payload: Record<string, string> = { action };
      if (action === "propose_resolution") {
        const buyer = window.prompt(
          "購入者へ返す最小単位の金額",
          physicalEscrow?.amountAtomic ?? "",
        );
        if (buyer === null) return;
        const seller = (
          BigInt(physicalEscrow!.amountAtomic) - BigInt(buyer)
        ).toString();
        payload.buyerAmountAtomic = buyer;
        payload.sellerAmountAtomic = seller;
      }
      const preparedResponse = await fetch(
          `${API}/orders/${orderId}/escrow/actions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        ),
        preparedBody = (await preparedResponse.json()) as {
          action?: PreparedAction;
          error?: string;
        };
      if (!preparedResponse.ok || !preparedBody.action)
        throw new Error(
          preparedBody.error === "escrow_action_unavailable"
            ? "この操作はまだ利用できません。"
            : (preparedBody.error ?? "操作を準備できません。"),
        );
      await wallet.switchChain(preparedBody.action.chainId);
      const transactionHash = await wallet.sendContractTransaction(
        preparedBody.action.to,
        preparedBody.action.data,
      );
      let confirmed = false,
        lastError = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (attempt)
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const submitResponse = await fetch(
            `${API}/orders/${orderId}/escrow/actions/submit`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token()}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ ...payload, transactionHash }),
            },
          ),
          submitBody = (await submitResponse.json()) as { error?: string };
        if (submitResponse.ok) {
          confirmed = true;
          break;
        }
        lastError = submitBody.error ?? "操作を確認できません。";
        if (lastError !== "transaction_not_confirmed") break;
      }
      if (!confirmed)
        throw new Error(
          lastError === "transaction_not_confirmed"
            ? "送信済みですが、確定監視が時間内に完了しませんでした。"
            : lastError,
        );
      await load();
      setMessage("エスクロー操作を確認しました。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "操作を完了できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  /* 不足分の追加入金。送金specはCommerce生成で、解決照合もon-chain実測。 */
  async function supplementPayment() {
    const spec = paymentException?.resolutionTransfer;
    if (!spec) return;
    setBusy(true);
    try {
      if (!wallet.address && !(await wallet.connect()))
        throw new Error("ウォレットへ接続できません。");
      if (
        spec.from &&
        wallet.address &&
        wallet.address.toLowerCase() !== spec.from.toLowerCase()
      )
        throw new Error(
          "接続中のウォレットは購入時のウォレットと違います。購入に使ったウォレットに切り替えてください。",
        );
      await wallet.switchChain(spec.chainId);
      const transactionHash = await wallet.sendContractTransactionWithValue(
        spec.to,
        spec.data,
        spec.value,
      );
      let confirmed = false,
        lastError = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (attempt)
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const response = await fetch(
            `${API}/orders/${orderId}/payment-exception/resolve`,
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${token()}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ transactionHash }),
            },
          ),
          body = (await response.json()) as { error?: string };
        if (response.ok) {
          confirmed = true;
          break;
        }
        lastError = body.error ?? "取引を確認できません。";
        if (lastError !== "transaction_not_confirmed") break;
      }
      if (!confirmed)
        throw new Error(
          lastError === "transaction_not_confirmed"
            ? "送信済みですが、確定監視が時間内に完了しませんでした。"
            : lastError,
        );
      await load();
      setMessage("不足分の入金を確認し、注文を確定しました。");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "追加入金を完了できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API}/orders/${orderId}/returns`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            reasonCode: form.get("reasonCode"),
            detail: String(form.get("detail") ?? "").trim() || null,
          }),
        }),
        body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "return_failed");
      await load();
      setMessage("返品申請を受け付けました。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `返品申請を完了できませんでした: ${error.message}`
          : "返品申請を完了できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function registerReturnShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(
          `${API}/orders/${orderId}/returns/shipment`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              shippingCarrier: form.get("shippingCarrier"),
              trackingNumber: form.get("trackingNumber"),
            }),
          },
        ),
        body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "shipment_failed");
      await load();
      setMessage("返送の追跡情報を登録しました。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `追跡情報を登録できませんでした: ${error.message}`
          : "追跡情報を登録できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="commerce-order-page">
      <header>
        <div>
          <h1>注文詳細</h1>
          <p>支払い、発送、受取、返品の状況を確認できます。</p>
        </div>
        <a href={hubSurfacePath(surface, "/market/orders")}>注文・返品へ</a>
      </header>
      {message && order ? (
        <p className="commerce-order-message" role="status">
          {message}
        </p>
      ) : null}
      {!order ? (
        <section
          className="commerce-order-empty"
          role="status"
          aria-live="polite"
        >
          <strong>{message}</strong>
          <p>
            {loadState === "loading"
              ? "しばらくお待ちください。"
              : loadState === "no-access"
                ? "購入時に使用した端末の注文・返品から注文を開いてください。"
                : "接続を確認して、もう一度お試しください。"}
          </p>
          {loadState === "no-access" ? (
            <a href={hubSurfacePath(surface, "/market/orders")}>注文・返品から開く</a>
          ) : loadState === "error" ? (
            <button type="button" onClick={() => void load()}>
              もう一度試す
            </button>
          ) : null}
        </section>
      ) : null}
      {order ? (
        <>
          <section className="commerce-order-overview">
            <div>
              <span>注文</span>
              <b>{order.id}</b>
            </div>
            <div>
              <span>支払い</span>
              <b>
                {physicalEscrow
                  ? escrowStateLabel(physicalEscrow.state)
                  : orderStatusLabel(order.status)}
              </b>
            </div>
            <div>
              <span>{order.fulfillmentType === "digital" ? "商品" : "配送"}</span>
              <b>
                {order.fulfillmentType === "digital"
                  ? "デジタル商品"
                  : fulfillmentStatusLabel(order.fulfillmentStatus)}
              </b>
            </div>
            <div>
              <span>合計</span>
              <b>{order.amountJpyc.toLocaleString()} JPYC</b>
            </div>
            {physicalEscrow ? (
              <>
                <div>
                  <span>発送期限</span>
                  <b>
                    {new Date(physicalEscrow.shipBy).toLocaleString("ja-JP")}
                  </b>
                </div>
                <div>
                  <span>自動解除予定</span>
                  <b>
                    {new Date(physicalEscrow.releaseAt).toLocaleString("ja-JP")}
                  </b>
                </div>
              </>
            ) : null}
            {order.trackingNumber ? (
              <div>
                <span>追跡</span>
                <b>
                  {order.shippingCarrier} ·{" "}
                  {(() => {
                    const url = trackingUrl(
                      order.shippingCarrier,
                      order.trackingNumber,
                    );
                    return url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        {order.trackingNumber}
                      </a>
                    ) : (
                      order.trackingNumber
                    );
                  })()}
                </b>
              </div>
            ) : null}
          </section>
          {paymentException ? (
            <section className="commerce-order-return" aria-label="支払いの確認">
              <h2>支払いの確認が必要です</h2>
              {paymentException.exceptionType === "underpaid" ? (
                <>
                  <p>
                    請求額との差額が不足しています。購入時のウォレットから
                    不足分（最小単位で{" "}
                    {(
                      BigInt(paymentException.expectedAtomic) -
                      BigInt(paymentException.observedAtomic)
                    ).toString()}
                    ）を追加で送金してください。
                  </p>
                  {paymentException.resolutionTransfer ? (
                    <button
                      className="commerce-order-action--primary"
                      disabled={busy}
                      onClick={() => void supplementPayment()}
                    >
                      不足分を送金する
                    </button>
                  ) : (
                    <p>送金方法を準備できません。販売者へお問い合わせください。</p>
                  )}
                </>
              ) : (
                <p>
                  請求額を超える入金がありました。店舗が差額の返送処理を行います。
                </p>
              )}
            </section>
          ) : null}
          <ol className="commerce-order-progress" aria-label="注文の進捗">
            <li data-complete>支払い確認</li>
            <li
              data-complete={
                ["shipped", "released"].includes(physicalEscrow?.state ?? "") ||
                order.fulfillmentStatus === "shipped" ||
                undefined
              }
              aria-current={
                physicalEscrow?.state === "funded" ? "step" : undefined
              }
            >
              発送
            </li>
            <li
              data-complete={physicalEscrow?.state === "released" || undefined}
              aria-current={
                physicalEscrow?.state === "shipped" ? "step" : undefined
              }
            >
              受取完了
            </li>
          </ol>
          {refunds.length ? (
            <section className="commerce-order-return" aria-label="返金履歴">
              <h2>返金履歴</h2>
              <ol>
                {refunds.map((refund, index) => (
                  <li key={refund.id}>
                    <p>
                      <b>{index + 1}回目：</b>
                      {refund.status === "confirmed"
                        ? "返金完了"
                        : refund.status === "rejected"
                          ? "確認不成立"
                          : "オンチェーン照合待ち"}
                    </p>
                    <p>
                      販売者からの返金：
                      <b>
                        {refund.sellerRefundTransactionHash
                          ? "送信済み"
                          : "未送信"}
                      </b>
                    </p>
                    <p>
                      Hub手数料の返還：
                      <b>
                        {refund.hubFeeTransactionHash ? "送信済み" : "未送信"}
                      </b>
                    </p>
                    {refund.status === "rejected" ? (
                      <p>
                        安全確認に失敗したため、返金完了として扱っていません。
                      </p>
                    ) : null}
                    {refundAttempts.filter(
                      (attempt) => attempt.refundId === refund.id,
                    ).length ? (
                      <ul aria-label={`${index + 1}回目の取引確認履歴`}>
                        {refundAttempts
                          .filter((attempt) => attempt.refundId === refund.id)
                          .map((attempt) => (
                            <li
                              key={`${attempt.role}-${attempt.transactionHash}`}
                            >
                              <b>
                                {attempt.role === "seller" ? "店舗" : "Hub"}：
                              </b>
                              {attempt.status === "confirmed"
                                ? "確認済み"
                                : attempt.status === "rejected"
                                  ? refundFailureLabel(attempt.failureReason)
                                  : "確認中"}
                              <small> {attempt.transactionHash}</small>
                            </li>
                          ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {physicalEscrow ? (
            <section className="commerce-order-return commerce-order-actions">
              <h2>代金ロックの操作</h2>
              <p>
                実行前に対象と結果を確認してください。送信内容はウォレットの署名画面でも確認できます。
              </p>
              {escrowSubmissionFailed ? (
                <p className="meta">
                  直前のオンチェーン操作は確定しませんでした。操作をやり直してください。
                </p>
              ) : null}
              {escrowProposal?.status === "open" ? (
                <p>
                  未承認の配分案：購入者へ {escrowProposal.buyerAmountAtomic}
                  、店舗へ {escrowProposal.sellerAmountAtomic}（提案者：
                  {escrowProposal.proposedBy === "buyer" ? "購入者" : "店舗"}）
                </p>
              ) : null}
              {physicalEscrow.state === "shipped" ? (
                <button
                  className="commerce-order-action--primary"
                  disabled={busy}
                  onClick={() => void escrowAction("confirm")}
                >
                  受取を確認して店舗へ支払う
                </button>
              ) : null}
              {physicalEscrow.state === "funded" &&
              Date.now() > Date.parse(physicalEscrow.shipBy) ? (
                <button
                  className="commerce-order-action--danger"
                  disabled={busy}
                  onClick={() => void escrowAction("refund_unshipped")}
                >
                  未発送のため返金する
                </button>
              ) : null}
              {["funded", "shipped"].includes(physicalEscrow.state) ? (
                <button
                  className="commerce-order-action--danger"
                  disabled={busy}
                  onClick={() => void escrowAction("dispute")}
                >
                  問題を報告して支払いを停止
                </button>
              ) : null}
              {physicalEscrow.state === "disputed" ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => void escrowAction("propose_resolution")}
                  >
                    返金・支払いの配分を提案
                  </button>
                  {escrowProposal?.status === "open" &&
                  escrowProposal.proposedBy === "seller" ? (
                    <button
                      disabled={busy}
                      onClick={() => void escrowAction("accept_resolution")}
                    >
                      相手の提案を承認
                    </button>
                  ) : null}
                  {physicalEscrow.disputeResolutionDeadline ? (
                    Date.now() >=
                    Date.parse(physicalEscrow.disputeResolutionDeadline) ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void escrowAction("finalize_expired_dispute")
                        }
                      >
                        異議の解決期限が経過 — 異議前の状態へ戻す
                      </button>
                    ) : (
                      <p className="meta">
                        仲裁の解決期限：
                        {new Date(
                          physicalEscrow.disputeResolutionDeadline,
                        ).toLocaleString("ja-JP")}
                        （期限経過後は異議前の状態へ戻せます）
                      </p>
                    )
                  ) : (
                    // 期限が読めない（RPC不調）だけで確定操作を隠すと
                    // 期限経過後に永久に詰まる——サーバー側がprepareで判定する。
                    <button
                      disabled={busy}
                      onClick={() =>
                        void escrowAction("finalize_expired_dispute")
                      }
                    >
                      異議の解決期限が過ぎた場合、異議前の状態へ戻す
                    </button>
                  )}
                </>
              ) : null}
            </section>
          ) : null}
          <section className="commerce-order-events">
            <h2>更新履歴</h2>
            {events.length ? (
              <ol>
                {events.map((item) => (
                  <li key={`${item.eventType}-${item.createdAt}`}>
                    <time>
                      {new Date(item.createdAt).toLocaleString("ja-JP")}
                    </time>
                    <b>{item.publicMessage}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p>更新はまだありません。</p>
            )}
          </section>
          <section className="commerce-order-return">
            <h2>返品</h2>
            {returnRequest ? (
              <>
                <p>
                  状態：
                  <b>
                    {{
                      requested: "申請中",
                      approved: "承認済み・返送可",
                      rejected: "受付不可",
                      in_transit: "返送中",
                      received: "販売者が受領",
                      refunded: "返金済み",
                    }[returnRequest.status] ?? returnRequest.status}
                  </b>
                </p>
                {returnRequest.status === "requested" &&
                physicalEscrow &&
                ["funded", "shipped"].includes(physicalEscrow.state) ? (
                  <p>
                    店舗が応答しない場合は、上の「問題を報告して支払いを停止」
                    から異議を開くことができます。
                  </p>
                ) : null}
                {returnRequest.status === "approved" ? (
                  <form onSubmit={registerReturnShipment}>
                    <p>
                      返送する商品の配送業者と追跡番号を登録してください。
                    </p>
                    <label>
                      配送業者
                      <input
                        name="shippingCarrier"
                        required
                        maxLength={80}
                        placeholder="例：ヤマト運輸"
                      />
                    </label>
                    <label>
                      追跡番号
                      <input
                        name="trackingNumber"
                        required
                        maxLength={100}
                      />
                    </label>
                    <button disabled={busy}>返送情報を登録</button>
                  </form>
                ) : null}
              </>
            ) : ["paid", "partially_refunded"].includes(order.status) ? (
              <>
                {(() => {
                  const deadline = order.paidAt
                    ? new Date(Date.parse(order.paidAt) + 30 * 86_400_000)
                    : null;
                  const expired = deadline && deadline.getTime() < Date.now();
                  return expired ? (
                    <p>
                      返品申請期間（支払い確定から30日）を過ぎています。
                    </p>
                  ) : (
                    <>
                      {deadline ? (
                        <p className="meta">
                          返品申請は{deadline.toLocaleDateString("ja-JP")}
                          まで受け付けています。
                        </p>
                      ) : null}
                      <form onSubmit={requestReturn}>
                        <label>
                          理由
                          <select name="reasonCode" required>
                            <option value="damaged">破損</option>
                            <option value="wrong_item">商品違い</option>
                            <option value="not_as_described">
                              説明との相違
                            </option>
                            <option value="other">その他</option>
                          </select>
                        </label>
                        <label>
                          詳細
                          <textarea name="detail" maxLength={1000} />
                        </label>
                        <button disabled={busy}>返品を申請</button>
                      </form>
                    </>
                  );
                })()}
              </>
            ) : (
              <p>支払い確定後に返品条件を確認できます。</p>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}

function refundFailureLabel(reason: string | null) {
  if (
    reason === "seller_transaction_reverted" ||
    reason === "hub_fee_transaction_reverted"
  )
    return "オンチェーンで不成立";
  if (
    reason === "seller_transfer_mismatch" ||
    reason === "hub_fee_transfer_mismatch"
  )
    return "送金内容が見積と不一致";
  return "確認できない取引";
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "支払い待ち",
    submitted: "支払い確認中",
    paid: "支払い済み",
    partially_refunded: "一部返金済み",
    refunded: "返金済み",
    cancelled: "キャンセル済み",
  };
  return labels[status] ?? "状況を確認中";
}

function fulfillmentStatusLabel(status: string | null) {
  if (!status) return "発送準備前";
  const labels: Record<string, string> = {
    pending: "発送準備中",
    preparing: "発送準備中",
    shipped: "発送済み",
    delivered: "配達完了",
    cancelled: "発送取消",
  };
  return labels[status] ?? "配送状況を確認中";
}

function escrowStateLabel(state: string) {
  const labels: Record<string, string> = {
    funded: "代金を安全に保管中",
    shipped: "発送済み・受取確認待ち",
    released: "販売者への支払い完了",
    refunded: "購入者へ返金済み",
    disputed: "問題の確認中・支払い停止",
  };
  return labels[state] ?? "支払い状況を確認中";
}

/* 配送業者が自由記入なので、分かる業者のときだけ追跡URLを組み立てる。 */
function trackingUrl(carrier: string | null, trackingNumber: string) {
  if (!carrier || !/^[A-Za-z0-9-]{6,32}$/.test(trackingNumber)) return null;
  const name = carrier.toLowerCase();
  const number = encodeURIComponent(trackingNumber);
  if (
    name.includes("ヤマト") ||
    name.includes("yamato") ||
    name.includes("kuroneko")
  )
    return `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${number}`;
  if (name.includes("佐川") || name.includes("sagawa"))
    return `https://k2k.sagawa-exp.co.jp/p/web/okurihosearch.do?okurihoNo=${number}`;
  if (
    name.includes("郵便") ||
    name.includes("ゆうパック") ||
    name.includes("japan post") ||
    name.includes("japanpost")
  )
    return `https://trackings.post.japanpost.jp/services/srv/search/direct?searchKind=S002&locale=ja&reqCodeNo1=${number}`;
  return null;
}
