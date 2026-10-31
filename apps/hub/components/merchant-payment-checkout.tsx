"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  getHubEvmProvider,
  type HubContractCall,
  type HubPendingTransactionSubmission,
  useHubWallet,
} from "@/components/hub-wallet-provider";
import { WalletConnectivityStatus } from "@/components/wallet-connectivity-status";
import {
  recordOrderReceipt,
  saveOrderAccessToken,
} from "@/lib/commerce-order-records";
import { saveWalletOrderSession } from "@/lib/wallet-order-session";

type CheckoutReceipt = {
  id: string;
  productId: string;
  title: string;
  amountJpyc: number;
  transactionHash?: string;
  status: string;
  fulfillmentType?: string | null;
  expiresAt?: string | null;
  createdAt: string;
};
import { commerceApiUrl } from "@/lib/commerce-client";

type Product = {
  id: string;
  title: string;
  priceJpyc: number;
  fulfillmentType?: string;
  gasPayerPolicy: "merchant" | "buyer" | "merchant_above_threshold";
  seller: { publicName: string };
};
export type Asset = {
  currency: string;
  chainId: number;
  chainName: string;
  assetKind: "native" | "erc20";
  merchantFeeAvailable?: boolean;
};
export type PaymentRequest = {
  sellerId: string;
  items: Array<{ productId: string; quantity: number }>;
  billingCountry: string;
  currency: "JPYC" | "USDC";
  chainId: number;
  discountBps: number;
  expiresAt: number;
  requestId: string;
};
type Intent = {
  hash: string;
  merchantName: string;
  productTitle: string;
  quantity: number;
  paymentAmount: string;
  payTo: string;
};
export type Order = {
  id: string;
  status?: string;
  currency: string;
  paymentAmount: string;
  subtotalJpyc: number;
  shippingJpyc: number;
  taxJpyc: number;
  taxRateBps: number;
  chainId: number;
  chainName: string;
  assetKind: "native" | "erc20";
  tokenContract: string;
  transferData: `0x${string}`;
  valueAtomic: string;
  accessToken: string;
  expiresAt: string;
  gasPayer: "merchant" | "buyer";
  intent: Intent;
  payment: {
    contractAddress: string;
    orderHash: string;
    approval: { tokenContract: string; data: `0x${string}` } | null;
  } | null;
  moneyFlow: {
    feeBaseJpyc: number;
    hubFeeJpyc: number;
    sellerReceivesJpyc: number;
    taxPassThroughJpyc: number;
    shippingPassThroughJpyc: number;
    networkGasCoveredByHubFee: boolean;
    networkGasIncludedInOrderTotal: boolean;
    networkProcessingCostJpyc: number;
    networkProcessingCostPaidByMerchant: boolean;
    policy: "zero-v4" | "unified-v3";
  };
};
type Phase =
  | "loading"
  | "choose"
  | "review"
  | "wallet-unsupported"
  | "signing"
  | "confirming"
  | "confirmation-needed"
  | "complete"
  | "error";
type ConfirmationPollResult =
  | { state: "paid" }
  | { state: "terminal"; orderStatus: string }
  | { state: "recoverable"; reason: "network" | "response" | "timeout" };
type ConfirmationPollOptions = {
  attempts?: number;
  delayMs?: number;
  fetcher?: typeof fetch;
  wait?: (delayMs: number) => Promise<void>;
};

export function paymentAssetForRequest(
  request: Pick<PaymentRequest, "currency" | "chainId">,
  assets: Asset[],
) {
  return (
    assets.find(
      (asset) =>
        asset.currency === request.currency && asset.chainId === request.chainId,
    ) ?? null
  );
}

export function checkoutSnapshotMatches(
  request: PaymentRequest,
  selected: Asset,
  current: Order,
  nowMs = Date.now(),
) {
  return (
    current.currency === selected.currency &&
    current.chainId === selected.chainId &&
    current.intent.quantity === quantity(request) &&
    current.intent.paymentAmount === current.paymentAmount &&
    /^\d+(?:\.\d+)?$/u.test(current.paymentAmount) &&
    Number.isFinite(Number(current.paymentAmount)) &&
    Number(current.paymentAmount) > 0 &&
    Number.isFinite(Date.parse(current.expiresAt)) &&
    Date.parse(current.expiresAt) > nowMs
  );
}

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const quantity = (request: PaymentRequest | null) =>
  request?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
const formatNativeAtomic = (value: string) => {
  const amount = BigInt(value);
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
};
const terminalOrderStatuses = new Set([
  "expired",
  "failed",
  "payment_failed",
  "cancelled",
  "refunded",
]);

function paymentCalls(current: Order): HubContractCall[] {
  const value =
    `0x${BigInt(current.valueAtomic).toString(16)}` as `0x${string}`;
  return current.assetKind === "native"
    ? [{ to: current.intent.payTo, data: current.transferData, value }]
    : [
        ...(current.payment?.approval
          ? [
              {
                to: current.payment.approval.tokenContract,
                data: current.payment.approval.data,
                value: "0x0" as `0x${string}`,
              },
            ]
          : []),
        {
          to: current.intent.payTo,
          data: current.transferData,
          value: "0x0" as `0x${string}`,
        },
      ];
}

function paymentSponsorship(current: Order) {
  return current.gasPayer === "merchant"
    ? {
        orderId: current.id,
        accessToken: current.accessToken,
        url: commerceApiUrl(`/orders/${current.id}/gas-sponsorship`),
      }
    : undefined;
}

function unsupportedWalletGuidance(current: Order) {
  if (current.gasPayer === "merchant")
    return "この注文は店舗負担のネットワーク手数料を安全に適用するため、Hubウォレットが必要です。現在のウォレットには送信していません。Hubウォレットへ切り替えるか、対応状況を再確認してください。";
  if (paymentCalls(current).length > 1)
    return "この支払いは承認と決済を同時に完了する必要があります。現在のウォレットは安全な一括実行に対応していないため、送信していません。wallet_sendCalls対応ウォレットまたはHubウォレットに切り替えてください。";
  return "現在のウォレットでは、この支払いを安全に送信できません。Hubウォレットへ切り替えるか、ウォレットの対応状況を再確認してください。";
}

export async function pollOrderConfirmation(
  current: { id: string; accessToken: string },
  options: ConfirmationPollOptions = {},
): Promise<ConfirmationPollResult> {
  const attempts = Math.max(1, options.attempts ?? 30);
  const delayMs = Math.max(0, options.delayMs ?? 2_000);
  const fetcher = options.fetcher ?? fetch;
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(
        commerceApiUrl(`/orders/${encodeURIComponent(current.id)}`),
        {
          headers: { authorization: `Bearer ${current.accessToken}` },
          cache: "no-store",
        },
      );
    } catch {
      return { state: "recoverable", reason: "network" };
    }
    if (!response.ok)
      return { state: "recoverable", reason: "response" };

    let body: { order?: { status?: unknown } };
    try {
      body = (await response.json()) as { order?: { status?: unknown } };
    } catch {
      return { state: "recoverable", reason: "response" };
    }
    const status = body.order?.status;
    if (typeof status !== "string")
      return { state: "recoverable", reason: "response" };
    if (status === "paid") return { state: "paid" };
    if (terminalOrderStatuses.has(status))
      return { state: "terminal", orderStatus: status };
    if (attempt + 1 < attempts) await wait(delayMs);
  }
  return { state: "recoverable", reason: "timeout" };
}

function friendlyError(value: unknown) {
  const code = value instanceof Error ? value.message : String(value);
  const messages: Record<string, string> = {
    merchant_gas_sponsorship_unavailable:
      "この支払方法では店舗によるネットワーク手数料負担を利用できません。別の支払方法を選んでください。",
    physical_escrow_asset_not_reviewed:
      "この資産は配送商品の安全な支払いにまだ対応していません。別の支払方法を選んでください。",
    physical_escrow_arbitrator_unavailable:
      "配送商品の保護機能を準備中です。現在は支払いを開始できません。",
    order_expired:
      "価格の有効時間が終了しました。内容を変えずに、新しい価格を取得できます。",
    wallet_not_connected:
      "ウォレットへ接続できませんでした。接続状態を確認して、もう一度お試しください。",
    wallet_atomic_batch_unsupported:
      "現在のウォレットでは、承認と決済を安全に一括実行できません。対応ウォレットへ切り替えてください。",
    merchant_sponsorship_requires_hub_wallet:
      "店舗負担のネットワーク手数料を利用するには、Hubウォレットへ切り替えてください。",
    payment_method_unavailable:
      "この支払い依頼で指定された通貨とネットワークは現在利用できません。別の方法へ自動変更せず、店舗で新しい支払い依頼を作成してください。",
    checkout_snapshot_mismatch:
      "Commerceから返された注文内容が確認した支払い依頼と一致しません。支払いは送信していません。注文履歴で状態を確認してください。",
    user_rejected:
      "ウォレットで支払いが取り消されました。資金は移動していません。",
  };
  const match = Object.entries(messages).find(([key]) =>
    code.toLowerCase().includes(key),
  );
  return (
    match?.[1] ??
    (code && code !== "undefined"
      ? code
      : "処理を完了できませんでした。入力内容は保持されています。もう一度お試しください。")
  );
}

export function MerchantPaymentCheckout() {
  const params = useSearchParams();
  const wallet = useHubWallet();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmationInFlightRef = useRef(false);
  const paymentExecutionRef = useRef(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [reportingCurrencies, setReportingCurrencies] = useState<
    Array<{ code: string; minorUnits: number }>
  >([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [preparedWalletAddress, setPreparedWalletAddress] = useState<
    string | null
  >(null);
  const [assetKey, setAssetKey] = useState("");
  const [settlementBaseCurrency, setSettlementBaseCurrency] = useState("JPY");
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("支払い内容を確認しています。");
  const [remaining, setRemaining] = useState(0);
  const [maximumGasAtomic, setMaximumGasAtomic] = useState<string | null>(null);
  const [pendingSubmission, setPendingSubmission] =
    useState<HubPendingTransactionSubmission | null>(null);
  const [transactionHash, setTransactionHash] = useState<`0x${string}` | null>(
    null,
  );
  const [userOperationHash, setUserOperationHash] = useState<
    `0x${string}` | null
  >(null);
  const [submissionAttempted, setSubmissionAttempted] = useState(false);
  const requestToken = useMemo(() => params.get("request") ?? "", [params]);
  const intentId = useMemo(() => params.get("intent") ?? "", [params]);
  const selected =
    assets.find((asset) => `${asset.chainId}:${asset.currency}` === assetKey) ??
    null;
  const busy = ["loading", "signing", "confirming"].includes(phase);

  useEffect(() => {
    if (!requestToken) {
      setPhase("error");
      setMessage(
        "有効な支払い依頼がありません。店舗でQRコードをもう一度表示してください。",
      );
      return;
    }
    const controller = new AbortController();
    void fetch(commerceApiUrl("/payment-requests/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: requestToken }),
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "この支払い依頼は期限切れか、内容が変更されています。店舗で新しいQRコードを表示してください。",
          );
        const verified = (await response.json()) as {
          paymentRequest: PaymentRequest;
        };
        const [productResponse, assetResponse, currencyResponse] =
          await Promise.all([
            fetch(
              commerceApiUrl(
                `/products/${encodeURIComponent(verified.paymentRequest.items[0].productId)}`,
              ),
              { cache: "no-store", signal: controller.signal },
            ),
            fetch(commerceApiUrl("/payment/assets"), {
              cache: "no-store",
              signal: controller.signal,
            }),
            fetch(commerceApiUrl("/payment/fiat-currencies"), {
              cache: "no-store",
              signal: controller.signal,
            }),
          ]);
        if (!productResponse.ok || !assetResponse.ok || !currencyResponse.ok)
          throw new Error(
            "商品または支払方法を読み込めませんでした。もう一度お試しください。",
          );
        const loadedProduct = (await productResponse.json()) as {
          product: Product;
        };
        const loadedAssets = (await assetResponse.json()) as {
          assets: Asset[];
        };
        const loadedCurrencies = (await currencyResponse.json()) as {
          currencies: Array<{ code: string; minorUnits: number }>;
        };
        const preferred = paymentAssetForRequest(
          verified.paymentRequest,
          loadedAssets.assets,
        );
        if (!preferred) throw new Error("payment_method_unavailable");
        setRequest(verified.paymentRequest);
        setProduct(loadedProduct.product);
        // A signed payment request binds the currency and chain. Never offer a
        // different method as a fallback because Commerce will still enforce
        // the signed values when creating the order.
        setAssets([preferred]);
        setReportingCurrencies(loadedCurrencies.currencies);
        setAssetKey(`${preferred.chainId}:${preferred.currency}`);
        setMessage("");
        setPhase("choose");
      })
      .catch((error) => {
        if ((error as Error).name === "AbortError") return;
        setMessage(friendlyError(error));
        setPhase("error");
      });
    return () => controller.abort();
  }, [requestToken]);

  useEffect(() => {
    if (
      !order ||
      phase === "confirming" ||
      phase === "confirmation-needed" ||
      phase === "complete"
    ) {
      setRemaining(0);
      return;
    }
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(order.expiresAt) - Date.now()) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0) {
        void cancelOrderRecord(order);
        setOrder(null);
        setPreparedWalletAddress(null);
        paymentExecutionRef.current = false;
        setPendingSubmission(null);
        setTransactionHash(null);
        setUserOperationHash(null);
        setSubmissionAttempted(false);
        setPhase("choose");
        setMessage(
          "価格の有効時間が終了しました。選択内容は保持されています。新しい価格を取得してください。",
        );
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [order, phase]);

  useEffect(() => {
    if (
      ["review", "wallet-unsupported", "confirmation-needed", "complete", "error"].includes(
        phase,
      )
    )
      headingRef.current?.focus();
  }, [phase]);

  async function connectedAddress() {
    if (
      (wallet.status !== "connected" || !wallet.address) &&
      !(await wallet.connect())
    )
      throw new Error("wallet_not_connected");
    if (wallet.address) return wallet.address;
    const accounts = await getHubEvmProvider()?.request({
      method: "eth_accounts",
    });
    if (Array.isArray(accounts) && typeof accounts[0] === "string")
      return accounts[0];
    throw new Error("wallet_not_connected");
  }

  async function prepare() {
    if (!request || !product || !selected) return;
    setPhase("loading");
    setMessage("安全な支払い内容を作成しています。");
    try {
      const buyerWallet = await connectedAddress();
      await wallet.switchChain(selected.chainId);
      const response = await fetch(commerceApiUrl("/orders"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": request.requestId,
        },
        body: JSON.stringify({
          productId: request.items[0].productId,
          quantity: request.items[0].quantity,
          items: request.items,
          paymentRequestToken: requestToken,
          buyerWallet,
          billingCountry: request.billingCountry,
          customerType: "consumer",
          paymentCurrency: selected.currency,
          paymentChainId: selected.chainId,
          settlementBaseCurrency,
        }),
      });
      const body = (await response.json()) as { order?: Order; error?: string };
      if (!response.ok || !body.order)
        throw new Error(body.error ?? "order_failed");
      const current = body.order;
      if (!checkoutSnapshotMatches(request, selected, current))
        throw new Error("checkout_snapshot_mismatch");
      const calls = paymentCalls(current);
      setMaximumGasAtomic(
        current.gasPayer === "merchant"
          ? "0"
          : await wallet.estimateContractTransactionsMaximumCost(calls),
      );
      setOrder(current);
      setPreparedWalletAddress(buyerWallet.toLowerCase());
      paymentExecutionRef.current = false;
      setPendingSubmission(null);
      setTransactionHash(null);
      setUserOperationHash(null);
      setSubmissionAttempted(false);
      saveWalletOrderSession({
        orderId: current.id,
        accessToken: current.accessToken,
        productTitle: product.title,
        createdAt: new Date().toISOString(),
      });
      // 注文履歴が同じ一覧へ出るよう、カート経由と同じ確認用記録を残す。
      saveOrderAccessToken(current.id, current.accessToken);
      recordOrderReceipt<CheckoutReceipt>({
        id: current.id,
        productId: product.id,
        title: product.title,
        amountJpyc:
          current.subtotalJpyc + current.shippingJpyc + current.taxJpyc,
        status: current.status ?? "awaiting_payment",
        fulfillmentType: product.fulfillmentType ?? null,
        expiresAt: current.expiresAt,
        createdAt: new Date().toISOString(),
      });
      const capability = await wallet.getAtomicBatchCapability(
        current.chainId,
        calls,
        paymentSponsorship(current),
      );
      if (capability === "unsupported") {
        setMessage(unsupportedWalletGuidance(current));
        setPhase("wallet-unsupported");
      } else {
        setMessage("");
        setPhase("review");
      }
    } catch (error) {
      setMessage(friendlyError(error));
      setPhase("error");
    }
  }

  async function checkWalletCompatibility(current: Order) {
    setMessage("ウォレットの安全な一括実行への対応状況を確認しています。");
    try {
      if (
        !preparedWalletAddress ||
        !wallet.address ||
        wallet.address.toLowerCase() !== preparedWalletAddress
      ) {
        setMessage(
          "注文を作成した後にウォレットのアカウントが変わりました。現在のアカウントには送信していません。元のアカウントへ戻して再確認するか、支払方法を選び直してください。",
        );
        setPhase("wallet-unsupported");
        return false;
      }
      if (wallet.chainId !== current.chainId)
        await wallet.switchChain(current.chainId);
      const capability = await wallet.getAtomicBatchCapability(
        current.chainId,
        paymentCalls(current),
        paymentSponsorship(current),
      );
      if (capability === "unsupported") {
        setMessage(unsupportedWalletGuidance(current));
        setPhase("wallet-unsupported");
        return false;
      }
      setMessage("");
      setPhase("review");
      return true;
    } catch (error) {
      setMessage(friendlyError(error));
      setPhase("wallet-unsupported");
      return false;
    }
  }

  async function switchToHubWallet(current: Order) {
    setMessage("Hubウォレットへ切り替えています。");
    const connected = await wallet.connect("smart");
    if (!connected) {
      setMessage(
        "Hubウォレットへ切り替えられませんでした。ウォレットを準備してから、もう一度お試しください。",
      );
      setPhase("wallet-unsupported");
      return;
    }
    try {
      // The order is bound to the wallet used when it was created. Recreate it
      // after a provider switch so a different smart-wallet address can never
      // submit an order prepared for the prior external address.
      await cancelOrderRecord(current);
      setOrder(null);
      setPreparedWalletAddress(null);
      paymentExecutionRef.current = false;
      setMaximumGasAtomic(null);
      setPendingSubmission(null);
      setTransactionHash(null);
      setUserOperationHash(null);
      setSubmissionAttempted(false);
      setMessage(
        "Hubウォレットへ切り替えました。ウォレットに合わせて、安全な支払い内容をもう一度作成してください。",
      );
      setPhase("choose");
    } catch (error) {
      setMessage(friendlyError(error));
      setPhase("wallet-unsupported");
    }
  }

  async function applyConfirmationResult(
    current: Order,
    confirmation: ConfirmationPollResult,
  ) {
    if (confirmation.state === "paid") {
      recordOrderReceipt<CheckoutReceipt>({ id: current.id, status: "paid" });
      if (intentId) {
        try {
          await reportIntentResult(current);
        } catch {
          // The Commerce payment is authoritative. Intent reconciliation can
          // recover independently without misreporting a paid order.
        }
      }
      setMessage("店舗への支払いが確認され、注文が確定しました。");
      setPhase("complete");
      return;
    }
    if (confirmation.state === "terminal") {
      recordOrderReceipt<CheckoutReceipt>({
        id: current.id,
        status: confirmation.orderStatus,
      });
      if (intentId) {
        try {
          await reportIntentResult(current);
        } catch {
          // Keep the payment evidence available even if intent sync is late.
        }
      }
      setMessage(
        "注文は支払い完了になっていません。送信済みの記録を保持しています。注文履歴を確認するか、支払い状況を再確認してください。",
      );
      setPhase("confirmation-needed");
      return;
    }
    setMessage(
      confirmation.reason === "timeout"
        ? "支払いは送信済みですが、確認に時間がかかっています。送信記録は保持されています。注文履歴を確認するか、支払い状況を再確認してください。"
        : "支払いは送信済みですが、現在は注文状況を取得できません。送信記録は保持されています。通信状態を確認して再確認してください。",
    );
    setPhase("confirmation-needed");
  }

  async function continueConfirmation(
    current: Order,
    submittedOperation: HubPendingTransactionSubmission | null,
    knownTransactionHash: `0x${string}` | null,
    knownUserOperationHash: `0x${string}` | null,
  ) {
    if (confirmationInFlightRef.current) return;
    confirmationInFlightRef.current = true;
    setPhase("confirming");
    setMessage(
      "支払いの送信結果を確認しています。画面を閉じても注文履歴から再確認できます。",
    );
    try {
      let nextTransactionHash = knownTransactionHash;
      let nextUserOperationHash = knownUserOperationHash;
      if (!nextTransactionHash) {
        if (!submittedOperation) {
          await applyConfirmationResult(
            current,
            await pollOrderConfirmation(current, { attempts: 1 }),
          );
          return;
        }
        const submission =
          await wallet.resolveAtomicContractTransaction(submittedOperation);
        nextTransactionHash = submission.transactionHash;
        nextUserOperationHash = submission.userOperationHash;
        setTransactionHash(nextTransactionHash);
        setUserOperationHash(nextUserOperationHash);
      }

      const response = await fetch(
        commerceApiUrl(`/orders/${current.id}/submit`),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${current.accessToken}`,
          },
          body: JSON.stringify({
            transactionHash: nextTransactionHash,
            userOperationHash: nextUserOperationHash,
          }),
        },
      );
      recordOrderReceipt<CheckoutReceipt>({
        id: current.id,
        status: "submitted",
        transactionHash: nextTransactionHash,
      });
      if (!response.ok) {
        // A prior submit may have succeeded even when its response was lost.
        // Read the authoritative order before falling back to recovery.
        await applyConfirmationResult(
          current,
          await pollOrderConfirmation(current, { attempts: 1 }),
        );
        return;
      }

      const confirmation = await pollOrderConfirmation(current);
      await applyConfirmationResult(current, confirmation);
    } catch {
      setMessage(
        "支払いの送信記録は保持されていますが、確認を完了できませんでした。同じ支払いを再送せず、注文履歴を確認するか支払い状況を再確認してください。",
      );
      setPhase("confirmation-needed");
    } finally {
      confirmationInFlightRef.current = false;
    }
  }

  async function reportIntentResult(current: Order) {
    const resultResponse = await fetch(
      commerceApiUrl(`/orders/${encodeURIComponent(current.id)}/intent-result`),
      {
        method: "POST",
        headers: { authorization: `Bearer ${current.accessToken}` },
        cache: "no-store",
      },
    );
    const resultBody = (await resultResponse.json().catch(() => null)) as
      | { proof?: string; error?: string }
      | null;
    if (!resultResponse.ok || !resultBody?.proof)
      throw new Error(resultBody?.error ?? "intent_result_unavailable");
    const accepted = await fetch("/api/core/intents/owner-result", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: resultBody.proof }),
    });
    if (!accepted.ok) throw new Error("intent_result_not_accepted");
    window.dispatchEvent(new CustomEvent("hub:intent-updated"));
  }

  async function cancelOrderRecord(current: Order) {
    const response = await fetch(
      commerceApiUrl(`/orders/${encodeURIComponent(current.id)}`),
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${current.accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok && response.status !== 409)
      throw new Error("order_cancellation_failed");
    // 409(支払いが先に進んだ)ときは履歴側の状態を触らず再照合に任せる。
    if (response.ok)
      recordOrderReceipt<CheckoutReceipt>({
        id: current.id,
        status: "cancelled",
      });
    if (intentId) await reportIntentResult(current);
  }

  async function cancelCurrentOrder() {
    if (
      !order ||
      phase === "signing" ||
      phase === "confirming" ||
      submissionAttempted ||
      pendingSubmission ||
      transactionHash
    )
      return;
    setMessage("未送信の注文を取り消しています。");
    try {
      await cancelOrderRecord(order);
      setOrder(null);
      setPreparedWalletAddress(null);
      paymentExecutionRef.current = false;
      setMaximumGasAtomic(null);
      setPendingSubmission(null);
      setTransactionHash(null);
      setUserOperationHash(null);
      setSubmissionAttempted(false);
      setMessage("");
      setPhase("choose");
    } catch (error) {
      setMessage(friendlyError(error));
      setPhase("error");
    }
  }

  async function pay() {
    if (
      !order ||
      paymentExecutionRef.current ||
      submissionAttempted ||
      pendingSubmission ||
      transactionHash
    )
      return;
    paymentExecutionRef.current = true;
    setPhase("signing");
    setMessage(
      "ウォレットで内容を確認してください。支払いは承認するまで実行されません。",
    );
    let walletRequestStarted = false;
    try {
      if (Date.parse(order.expiresAt) <= Date.now())
        throw new Error("order_expired");
      if (
        !preparedWalletAddress ||
        !wallet.address ||
        wallet.address.toLowerCase() !== preparedWalletAddress
      ) {
        paymentExecutionRef.current = false;
        setMessage(
          "注文を作成した後にウォレットのアカウントが変わりました。支払いは送信していません。元のアカウントへ戻して再確認するか、支払方法を選び直してください。",
        );
        setPhase("wallet-unsupported");
        return;
      }
      if (wallet.chainId !== order.chainId)
        await wallet.switchChain(order.chainId);
      const calls = paymentCalls(order);
      const sponsorship = paymentSponsorship(order);
      const capability = await wallet.getAtomicBatchCapability(
        order.chainId,
        calls,
        sponsorship,
      );
      if (capability === "unsupported") {
        paymentExecutionRef.current = false;
        setMessage(unsupportedWalletGuidance(order));
        setPhase("wallet-unsupported");
        return;
      }
      walletRequestStarted = true;
      setSubmissionAttempted(true);
      const operation = await wallet.sendAtomicContractTransactions(
        order.chainId,
        calls,
        sponsorship,
      );
      setPendingSubmission(operation);
      await continueConfirmation(
        order,
        operation,
        null,
        operation.kind === "hub-operation" ? operation.id : null,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code.includes("wallet_atomic_batch_unsupported")) {
        paymentExecutionRef.current = false;
        setSubmissionAttempted(false);
        setMessage(unsupportedWalletGuidance(order));
        setPhase("wallet-unsupported");
        return;
      }
      if (
        code.toLowerCase().includes("user_rejected") ||
        code.includes("4001")
      ) {
        paymentExecutionRef.current = false;
        setSubmissionAttempted(false);
        setMessage(friendlyError(error));
        setPhase("error");
        return;
      }
      if (walletRequestStarted) {
        setMessage(
          "ウォレットへの送信要求後に結果を取得できませんでした。同じ支払いを再送せず、注文履歴を確認するか支払い状況を再確認してください。",
        );
        setPhase("confirmation-needed");
        return;
      }
      paymentExecutionRef.current = false;
      setMessage(friendlyError(error));
      setPhase("error");
    }
  }

  function retry() {
    setMessage("");
    if (
      order &&
      (submissionAttempted || pendingSubmission || transactionHash)
    ) {
      void continueConfirmation(
        order,
        pendingSubmission,
        transactionHash,
        userOperationHash,
      );
      return;
    }
    if (order) {
      void checkWalletCompatibility(order);
      return;
    }
    setPhase("choose");
  }

  function readConfirmation() {
    if (!order || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const text = `支払い合計 ${order.paymentAmount} ${order.currency}。ネットワーク ${order.chainName}。店舗 ${order.intent.merchantName}。送金先末尾 ${order.intent.payTo.slice(-6)}。`;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  async function downloadReceipt(current: Order) {
    try {
      const response = await fetch(
        commerceApiUrl(`/orders/${current.id}/receipt`),
        {
          headers: { authorization: `Bearer ${current.accessToken}` },
          cache: "no-store",
        },
      );
      const body = (await response.json()) as {
        receipt?: unknown;
        error?: string;
      };
      if (!response.ok || !body.receipt)
        throw new Error(body.error ?? "receipt_unavailable");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body.receipt, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `hub-receipt-${current.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage(
        "Commerce発行の領収書を取得できませんでした。購入履歴から再試行してください。",
      );
    }
  }

  if (phase === "complete" && order)
    return (
      <section className="commerce-payment-checkout wallet-light-surface">
        <section className="commerce-payment-complete" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <small>PAYMENT COMPLETE</small>
          <h1 ref={headingRef} tabIndex={-1}>
            支払いが完了しました
          </h1>
          <strong>
            {order.paymentAmount} {order.currency}
          </strong>
          <p>
            {order.intent.merchantName}への支払いを確認し、注文を確定しました。
          </p>
          <dl>
            <div>
              <dt>内容</dt>
              <dd>
                {order.intent.productTitle} × {order.intent.quantity}
              </dd>
            </div>
            <div>
              <dt>注文番号</dt>
              <dd>{order.id.slice(0, 8)}</dd>
            </div>
            {transactionHash ? (
              <div>
                <dt>取引ハッシュ</dt>
                <dd title={transactionHash}>{short(transactionHash)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="commerce-payment-actions">
            <a href="/v2/market/orders">領収書と購入履歴を見る</a>
            <button
              type="button"
              onClick={() => {
                void downloadReceipt(order);
              }}
            >
              領収書を保存
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => window.print()}
            >
              印刷する
            </button>
            <a className="secondary" href="/v2/market">
              買い物を続ける
            </a>
          </div>
        </section>
      </section>
    );

  return (
    <section
      className="commerce-payment-checkout wallet-light-surface"
      aria-busy={busy}
    >
      <section>
        <header className="commerce-payment-header">
          <div>
            <small>SECURE CHECKOUT</small>
            <h2 ref={headingRef} tabIndex={-1}>
              {product?.title ?? "お支払い"}
            </h2>
          </div>
          <ol aria-label="支払いの進行状況">
            <li aria-current={phase === "choose" ? "step" : undefined}>方法</li>
            <li
              aria-current={
                phase === "review" ||
                phase === "wallet-unsupported" ||
                phase === "signing"
                  ? "step"
                  : undefined
              }
            >
              確認
            </li>
            <li
              aria-current={
                phase === "confirming" || phase === "confirmation-needed"
                  ? "step"
                  : undefined
              }
            >
              完了
            </li>
          </ol>
        </header>
        <WalletConnectivityStatus />

        {phase === "choose" && message ? (
          <div className="commerce-payment-state" role="status">
            <p>{message}</p>
          </div>
        ) : null}

        {phase === "loading" ? (
          <div className="commerce-payment-state" role="status">
            <span className="commerce-payment-spinner" aria-hidden="true" />
            <p>{message}</p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div
            className="commerce-payment-state commerce-payment-state--error"
            role="alert"
          >
            <h2>続行できませんでした</h2>
            <p>{message}</p>
            {product || order ? (
              <button type="button" onClick={retry}>
                内容を保持して戻る
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "choose" && product && request ? (
          <div className="commerce-payment-layout">
            <div className="commerce-payment-primary">
              <div className="commerce-payment-merchant">
                <span>支払先</span>
                <strong>{product.seller.publicName}</strong>
              </div>
              <h2>支払方法を選ぶ</h2>
              <fieldset className="commerce-payment-methods">
                <legend className="sr-only">支払方法</legend>
                {assets.map((asset) => {
                  const key = `${asset.chainId}:${asset.currency}`;
                  return (
                    <label key={key} data-selected={assetKey === key}>
                      <input
                        type="radio"
                        name="payment-method"
                        value={key}
                        checked={assetKey === key}
                        onChange={() => setAssetKey(key)}
                      />
                      <span>
                        <strong>{asset.currency}</strong>
                        <small>{asset.chainName}</small>
                      </span>
                      <em>
                        {asset.merchantFeeAvailable
                          ? "ネットワーク手数料は店舗負担"
                          : "ネットワーク手数料が必要"}
                      </em>
                    </label>
                  );
                })}
              </fieldset>
              <details className="commerce-payment-advanced">
                <summary>税務記録の通貨</summary>
                <label>
                  売上記録の基準通貨
                  <select
                    value={settlementBaseCurrency}
                    onChange={(event) =>
                      setSettlementBaseCurrency(event.target.value)
                    }
                  >
                    {reportingCurrencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>
                        {currency.code}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  支払額には影響しません。店舗の税務・会計記録にだけ使用します。
                </p>
              </details>
            </div>
            <aside className="commerce-payment-summary" aria-label="注文内容">
              <h2>注文内容</h2>
              <dl>
                <div>
                  <dt>商品</dt>
                  <dd>{quantity(request)}点</dd>
                </div>
                {request.discountBps > 0 ? (
                  <div>
                    <dt>店舗割引</dt>
                    <dd>{(request.discountBps / 100).toFixed(0)}%</dd>
                  </div>
                ) : null}
                <div>
                  <dt>税の判定国</dt>
                  <dd>{request.billingCountry}</dd>
                </div>
              </dl>
              <p>正確な税額と最終支払額は、次の画面で送信前に確認できます。</p>
              <button
                type="button"
                disabled={!selected}
                onClick={() => void prepare()}
              >
                最終金額を確認する
              </button>
            </aside>
          </div>
        ) : null}

        {order &&
        [
          "review",
          "wallet-unsupported",
          "signing",
          "confirming",
          "confirmation-needed",
        ].includes(phase) ? (
          <div className="commerce-payment-layout">
            <div className="commerce-payment-primary">
              <div className="commerce-payment-merchant">
                <span>支払先</span>
                <strong>{order.intent.merchantName}</strong>
              </div>
              <h2>
                {phase === "wallet-unsupported"
                  ? "対応ウォレットが必要です"
                  : phase === "confirming" || phase === "confirmation-needed"
                    ? "支払い状況を確認"
                    : "支払い内容を確認"}
              </h2>
              <div className="commerce-payment-total">
                <span>支払い合計</span>
                <strong>
                  {order.paymentAmount} {order.currency}
                </strong>
              </div>
              <dl className="commerce-payment-breakdown">
                <div>
                  <dt>商品・送料</dt>
                  <dd>
                    {(order.subtotalJpyc + order.shippingJpyc).toLocaleString()}
                    円
                  </dd>
                </div>
                <div>
                  <dt>税（{(order.taxRateBps / 100).toFixed(2)}%）</dt>
                  <dd>{order.taxJpyc.toLocaleString()}円</dd>
                </div>
                <div>
                  <dt>Hub手数料（販売者負担・本体価格の1%、消費税込み）</dt>
                  <dd>{order.moneyFlow.hubFeeJpyc.toLocaleString()}円</dd>
                </div>
                <div>
                  <dt>販売者受取額</dt>
                  <dd>
                    {order.moneyFlow.sellerReceivesJpyc.toLocaleString()}円
                  </dd>
                </div>
                <div>
                  <dt>ネットワーク処理費</dt>
                  <dd>
                    {order.moneyFlow.networkProcessingCostPaidByMerchant
                      ? "店舗負担"
                      : "購入者負担"}
                  </dd>
                </div>
                <div>
                  <dt>ネットワーク</dt>
                  <dd>{order.chainName}</dd>
                </div>
                <div>
                  <dt>最大ガス負担</dt>
                  <dd>
                    {order.gasPayer === "merchant"
                      ? "0（Hub手数料に含む）"
                      : maximumGasAtomic === null
                        ? "取得できません"
                        : `${formatNativeAtomic(maximumGasAtomic)} POL（最大見積）`}
                  </dd>
                </div>
              </dl>
              {phase === "confirming" ? (
                <div className="commerce-payment-state" role="status">
                  <span
                    className="commerce-payment-spinner"
                    aria-hidden="true"
                  />
                  <p>{message}</p>
                </div>
              ) : phase === "wallet-unsupported" ? (
                <div
                  className="commerce-payment-state commerce-payment-state--error"
                  role="alert"
                >
                  <p>{message}</p>
                  <p>未対応の方法へ分割送信することはありません。</p>
                  <div className="commerce-payment-actions">
                    <button
                      type="button"
                      onClick={() => void switchToHubWallet(order)}
                    >
                      Hubウォレットへ切り替える
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void checkWalletCompatibility(order)}
                    >
                      対応状況を再確認
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void cancelCurrentOrder()}
                    >
                      支払方法を選び直す
                    </button>
                  </div>
                </div>
              ) : phase === "confirmation-needed" ? (
                <div
                  className="commerce-payment-state commerce-payment-state--error"
                  role="alert"
                >
                  <p>{message}</p>
                  {transactionHash ? (
                    <p>
                      取引ハッシュ:{" "}
                      <code title={transactionHash}>
                        {short(transactionHash)}
                      </code>
                    </p>
                  ) : pendingSubmission ? (
                    <p>
                      送信識別子:{" "}
                      <code title={pendingSubmission.id}>
                        {short(pendingSubmission.id)}
                      </code>
                    </p>
                  ) : null}
                  <div className="commerce-payment-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void continueConfirmation(
                          order,
                          pendingSubmission,
                          transactionHash,
                          userOperationHash,
                        )
                      }
                    >
                      支払い状況を再確認
                    </button>
                    <a
                      className="secondary"
                      href="/v2/market/orders"
                    >
                      注文履歴を見る
                    </a>
                  </div>
                </div>
              ) : (
                <>
                  <p className="commerce-payment-consequence">
                    パスキーまたはウォレットで承認すると、上記金額が送信されます。ブロックチェーン送信後は取り消せません。
                  </p>
                  <div className="commerce-payment-actions">
                    <button
                      type="button"
                      disabled={phase === "signing"}
                      onClick={() => void pay()}
                    >
                      {phase === "signing"
                        ? "ウォレットで確認中…"
                        : `${order.paymentAmount} ${order.currency}を支払う`}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={phase === "signing"}
                      onClick={() => void cancelCurrentOrder()}
                    >
                      支払いをやめる
                    </button>
                  </div>
                </>
              )}
            </div>
            <aside className="commerce-payment-summary">
              <h2>安全確認</h2>
              <dl>
                <div>
                  <dt>内容</dt>
                  <dd>
                    {order.intent.productTitle} × {order.intent.quantity}
                  </dd>
                </div>
                <div>
                  <dt>有効時間</dt>
                  <dd>
                    {phase === "confirming" ||
                    phase === "confirmation-needed"
                      ? "送信済み"
                      : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
                  </dd>
                </div>
              </dl>
              <details className="commerce-payment-advanced">
                <summary>技術情報</summary>
                <dl>
                  <div>
                    <dt>送金先</dt>
                    <dd title={order.intent.payTo}>
                      {short(order.intent.payTo)}
                    </dd>
                  </div>
                  <div>
                    <dt>請求識別子</dt>
                    <dd>{short(order.intent.hash)}</dd>
                  </div>
                  <div>
                    <dt>注文番号</dt>
                    <dd title={order.id}>{short(order.id)}</dd>
                  </div>
                  {transactionHash ? (
                    <div>
                      <dt>取引ハッシュ</dt>
                      <dd title={transactionHash}>
                        {short(transactionHash)}
                      </dd>
                    </div>
                  ) : pendingSubmission ? (
                    <div>
                      <dt>送信識別子</dt>
                      <dd title={pendingSubmission.id}>
                        {short(pendingSubmission.id)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </details>
              <button
                className="secondary"
                type="button"
                onClick={readConfirmation}
              >
                内容を読み上げる
              </button>
            </aside>
          </div>
        ) : null}
      </section>
    </section>
  );
}
