"use client";

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { MerchantDynamicQr } from "@/components/merchant-dynamic-qr";
import { MerchantWalletPanel } from "@/components/merchant-wallet-panel";
import { MerchantTeamPanel } from "@/components/merchant-team-panel";
import { MerchantGasBudgetPanel } from "@/components/merchant-gas-budget-panel";
import { MerchantPaymentExceptions } from "@/components/merchant-payment-exceptions";
import { MerchantAssetTaxLedger } from "@/components/merchant-asset-tax-ledger";
import { MerchantTaxRegistrations } from "@/components/merchant-tax-registrations";
import { MerchantChainDestinations } from "@/components/merchant-chain-destinations";
import { MerchantOperationsPanel } from "@/components/merchant-operations-panel";
import { MerchantPosReadiness } from "@/components/merchant-pos-readiness";
import { MerchantMediaBillingPanel } from "@/components/merchant-media-billing-panel";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { HUB_MARKETPLACE_FEE_PERCENT } from "@/lib/commercial-pricing-policy";
import { SellerVerificationPanel } from "@/components/seller-verification-panel";
import { commerceApiUrl } from "@/lib/commerce-client";
import { V2TagInput } from "@/components/v2/v2-tag-input";

type FulfillmentType = "pickup" | "seller_shipping" | "platform_3pl";
type GasPayerPolicy = "merchant" | "buyer" | "merchant_above_threshold";
type SellerProduct = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceJpyc: number;
  fulfillmentType: FulfillmentType;
  stockQuantity: number | null;
  shippingJpyc: number | null;
  status: string;
  hubProductId?: string | null;
  gasPayerPolicy: GasPayerPolicy;
  gasSponsorThresholdJpy: number | null;
  tags?: Array<{ key: string; display: string }>;
};
type SellerMedia = {
  id: string;
  contentType: string;
  byteLength: number;
  status: "pending_scan" | "clean" | "rejected";
  url: string | null;
  createdAt: string;
};
type SellerOrder = {
  id: string;
  productTitle: string;
  quantity: number;
  amountJpyc: number;
  shippingJpyc: number;
  status: string;
  fulfillmentType: FulfillmentType;
  fulfillmentStatus: string | null;
  shippingCarrier: string | null;
  trackingNumber: string | null;
  returnStatus: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  escrowState: string | null;
  escrowShipBy: string | null;
  escrowReleaseAt: string | null;
  amountAtomic: string | null;
  escrowAmountAtomic?: string | null;
  disputeResolutionDeadline?: string | null;
  escrowSubmissionFailed?: boolean;
  hasOpenPaymentException?: boolean;
  returnReason?: string | null;
  recentEvents?: string[];
  proposalProposedBy: "buyer" | "seller" | null;
  proposalBuyerAmountAtomic: string | null;
  proposalSellerAmountAtomic: string | null;
};

type ShippingObjective =
  | "lowest_total_cost"
  | "earliest_delivery"
  | "lowest_delivery_risk"
  | "lowest_estimated_emissions";
type SellerShippingQuote = {
  provider: string;
  serviceCode: string;
  amountMinor: string;
  currency?: string;
  estimatedDeliveryDate?: string;
  reliabilityBps?: number;
  emissionsGramsCo2e?: number;
  validUntil?: string;
  sourceRef?: string;
  rank?: number;
  selectedObjective?: ShippingObjective;
  explanation?: string;
};
type ShippingQuoteState = {
  status: "idle" | "loading" | "unavailable" | "verified-empty" | "ready";
  quotes: SellerShippingQuote[];
};

const API = commerceApiUrl("/seller");
const fulfillmentLabels: Record<FulfillmentType, string> = {
  pickup: "店頭・対面受取",
  seller_shipping: "販売者が発送",
  platform_3pl: "提携倉庫（3PL）から発送",
};
const shippingObjectives: Array<{ value: ShippingObjective; label: string }> = [
  { value: "lowest_total_cost", label: "合計費用が最も低い" },
  { value: "earliest_delivery", label: "到着が最も早い" },
  { value: "lowest_delivery_risk", label: "配送リスクが最も低い" },
  { value: "lowest_estimated_emissions", label: "推定排出量が最も少ない" },
];

export function CommerceSellerDashboard() {
  const wallet = useHubWallet();
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sellerUnavailable, setSellerUnavailable] = useState(false);
  const [fulfillmentType, setFulfillmentType] =
    useState<FulfillmentType>("seller_shipping");
  const [gasPayerPolicy, setGasPayerPolicy] =
    useState<GasPayerPolicy>("merchant");
  const [message, setMessage] = useState("販売者情報を確認しています…");
  const [busy, setBusy] = useState(false);
  const [productTags, setProductTags] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [media, setMedia] = useState<SellerMedia[]>([]);
  const [mediaNextCursor, setMediaNextCursor] = useState<string | null>(null);
  const [mediaLoadingMore, setMediaLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [productsNextCursor, setProductsNextCursor] = useState<string | null>(
    null,
  );
  const [productsLoadingMore, setProductsLoadingMore] = useState(false);
  const [ordersNextCursor, setOrdersNextCursor] = useState<string | null>(null);
  const [ordersLoadingMore, setOrdersLoadingMore] = useState(false);
  const [ordersReady, setOrdersReady] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [ordersFilter, setOrdersFilter] = useState<"all" | "attention">("attention");
  const [shippingQuoteStates, setShippingQuoteStates] = useState<
    Record<string, ShippingQuoteState>
  >({});
  const [selectedShippingQuotes, setSelectedShippingQuotes] = useState<
    Record<string, number | null>
  >({});
  const formRef = useRef<HTMLFormElement>(null);
  const physical =
    fulfillmentType === "seller_shipping" || fulfillmentType === "platform_3pl";
  // sellerが介入を要する注文だけ先に出す。発送期限超過・異議中・返品申請中・
  // 支払い例外・failed提出を「要対応」としてまとめる。
  const orderNeedsAttention = (order: SellerOrder) =>
    order.escrowState === "disputed" ||
    order.returnStatus === "requested" ||
    Boolean(order.hasOpenPaymentException) ||
    Boolean(order.escrowSubmissionFailed) ||
    (order.escrowState === "funded" &&
      Boolean(order.escrowShipBy) &&
      new Date(order.escrowShipBy!) <= new Date());
  const filteredOrders =
    ordersFilter === "attention" ? orders.filter(orderNeedsAttention) : orders;

  async function loadOrders() {
    setOrdersReady(false);
    setOrdersError(false);
    try {
      const response = await fetch(`${API}/orders`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("seller_orders_unavailable");
      const result = (await response.json()) as {
        orders: SellerOrder[];
        nextCursor?: string | null;
      };
      setOrders(result.orders);
      setOrdersNextCursor(result.nextCursor ?? null);
      setOrdersReady(true);
      // 異議中と返品申請中の注文だけ詳細を取り、解決期限・返品理由を
      // 一覧へ反映する。
      const enriched = result.orders.filter(
        (order) =>
          order.escrowState === "disputed" ||
          order.returnStatus === "requested",
      );
      if (enriched.length) {
        const details = await Promise.all(
          enriched.map(async (order) => {
            try {
              const detail = await fetch(`${API}/orders/${order.id}`, {
                credentials: "include",
                cache: "no-store",
              });
              if (!detail.ok) return null;
              const body = (await detail.json()) as {
                physicalEscrow?: {
                  disputeResolutionDeadline?: string | null;
                } | null;
                returnRequest?: {
                  reasonCode?: string;
                  detail?: string;
                } | null;
                events?: { eventType: string; publicMessage: string | null }[];
              };
              return {
                id: order.id,
                disputeResolutionDeadline:
                  body.physicalEscrow?.disputeResolutionDeadline ?? null,
                returnReason: body.returnRequest?.detail
                  ? `${body.returnRequest.reasonCode ?? ""}：${body.returnRequest.detail}`
                  : (body.returnRequest?.reasonCode ?? null),
                recentEvents: (body.events ?? [])
                  .slice(-3)
                  .map((event) => event.publicMessage ?? event.eventType),
              };
            } catch {
              return null;
            }
          }),
        );
        const enrichment = new Map(
          details.filter((d): d is NonNullable<typeof d> => d !== null)
            .map((d) => [
              d.id,
              {
                disputeResolutionDeadline: d.disputeResolutionDeadline,
                returnReason: d.returnReason,
                recentEvents: d.recentEvents,
              },
            ]),
        );
        if (enrichment.size)
          setOrders((current) =>
            current.map((order) =>
              enrichment.has(order.id)
                ? { ...order, ...enrichment.get(order.id) }
                : order,
            ),
          );
      }
    } catch {
      setOrdersError(true);
    }
  }

  // 一覧は200件ごと。古い注文はカーソルで辿る。
  async function loadMoreOrders() {
    if (!ordersNextCursor || ordersLoadingMore) return;
    setOrdersLoadingMore(true);
    try {
      const response = await fetch(
        `${API}/orders?before=${encodeURIComponent(ordersNextCursor)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("seller_orders_unavailable");
      const result = (await response.json()) as {
        orders: SellerOrder[];
        nextCursor?: string | null;
      };
      setOrders((current) => {
        const known = new Set(current.map((order) => order.id));
        return [
          ...current,
          ...result.orders.filter((order) => !known.has(order.id)),
        ];
      });
      setOrdersNextCursor(result.nextCursor ?? null);
    } catch {
      setOrdersError(true);
    } finally {
      setOrdersLoadingMore(false);
    }
  }

  async function loadProducts() {
    setSellerUnavailable(false);
    const response = await fetch(`${API}/products`, {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 401) {
      setAuthenticated(false);
      setMessage("");
      return;
    }
    if (response.status === 404 || response.status === 503) {
      setAuthenticated(null);
      setSellerUnavailable(true);
      setMessage("");
      return;
    }
    if (!response.ok) throw new Error("seller_products_unavailable");
    const result = (await response.json()) as {
      products: SellerProduct[];
      nextCursor?: string | null;
    };
    setProducts(result.products);
    setProductsNextCursor(result.nextCursor ?? null);
    const mediaResponse = await fetch(`${API}/media`, {
      credentials: "include",
      cache: "no-store",
    });
    if (mediaResponse.ok) {
      const mediaResult = (await mediaResponse.json()) as {
        media: SellerMedia[];
        nextCursor?: string | null;
      };
      setMedia(mediaResult.media);
      setMediaNextCursor(mediaResult.nextCursor ?? null);
    }
    setAuthenticated(true);
    setSellerUnavailable(false);
    setMessage("");
    await loadOrders();
  }

  // 商品一覧も200件ごと。古い商品はカーソルで辿る。
  async function loadMoreProducts() {
    if (!productsNextCursor || productsLoadingMore) return;
    setProductsLoadingMore(true);
    try {
      const response = await fetch(
        `${API}/products?before=${encodeURIComponent(productsNextCursor)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("seller_products_unavailable");
      const result = (await response.json()) as {
        products: SellerProduct[];
        nextCursor?: string | null;
      };
      setProducts((current) => {
        const known = new Set(current.map((product) => product.id));
        return [
          ...current,
          ...result.products.filter((product) => !known.has(product.id)),
        ];
      });
      setProductsNextCursor(result.nextCursor ?? null);
    } catch {
      setMessage("商品の続きを読み込めませんでした。");
    } finally {
      setProductsLoadingMore(false);
    }
  }

  async function downloadOrdersCsv() {
    try {
      const response = await fetch(`${API}/orders.csv`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("csv_failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setMessage("CSVの取得に失敗しました。");
    }
  }

  async function fetchShippingQuotes(
    event: FormEvent<HTMLFormElement>,
    order: SellerOrder,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weightGrams = Number(form.get("weightGrams"));
    const dimensionsMm = {
      length: Number(form.get("lengthMm")),
      width: Number(form.get("widthMm")),
      height: Number(form.get("heightMm")),
    };
    const objective = String(
      form.get("shippingObjective") ?? "lowest_total_cost",
    ) as ShippingObjective;
    setShippingQuoteStates((current) => ({
      ...current,
      [order.id]: { status: "loading", quotes: [] },
    }));
    setSelectedShippingQuotes((current) => ({ ...current, [order.id]: null }));
    try {
      const response = await fetch(`${API}/orders/${order.id}/shipping-quotes`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weightGrams, dimensionsMm, objective }),
      });
      const result = (await response.json().catch(() => null)) as {
        quotes?: SellerShippingQuote[];
        objective?: ShippingObjective;
      } | null;
      if (!response.ok || !Array.isArray(result?.quotes)) throw new Error();
      if (result.objective !== undefined && result.objective !== objective)
        throw new Error();
      const now = Date.now();
      const quotes = result.quotes.filter((quote) => {
        const validUntil = Date.parse(quote.validUntil ?? "");
        return (
          /^[a-z0-9_]{2,40}$/.test(quote.provider) &&
          /^[A-Za-z0-9._:-]{1,80}$/.test(quote.serviceCode) &&
          /^(0|[1-9][0-9]{0,30})$/.test(quote.amountMinor) &&
          quote.currency === "JPYC" &&
          typeof quote.sourceRef === "string" &&
          quote.sourceRef.trim().length > 0 &&
          Number.isFinite(validUntil) &&
          validUntil > now &&
          quote.selectedObjective === objective
        );
      });
      setShippingQuoteStates((current) => ({
        ...current,
        [order.id]: {
          status: quotes.length ? "ready" : "verified-empty",
          quotes,
        },
      }));
    } catch {
      setShippingQuoteStates((current) => ({
        ...current,
        [order.id]: { status: "unavailable", quotes: [] },
      }));
    }
  }

  function copyShippingQuote(orderId: string, quote: SellerShippingQuote) {
    const form = [...document.querySelectorAll("form[data-shipment-order]")].find(
      (candidate) => candidate.getAttribute("data-shipment-order") === orderId,
    );
    const field = form?.querySelector(
      'input[name="shippingCarrier"]',
    ) as HTMLInputElement | null;
    if (field) field.value = `${quote.provider}・${quote.serviceCode}`;
    setSelectedShippingQuotes((current) => ({
      ...current,
      [orderId]: (shippingQuoteStates[orderId]?.quotes ?? []).indexOf(quote),
    }));
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length || authenticated !== true) return;
    const selected = [...files].slice(0, 8);
    if (
      selected.some(
        (file) =>
          file.size > 5 * 1024 * 1024 ||
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      setMessage("画像はJPEG・PNG・WebP、1枚5MB以下で選択してください。");
      return;
    }
    setUploading(true);
    try {
      for (const file of selected) {
        const response = await fetch(`${API}/media`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": file.type },
          body: file,
        });
        if (!response.ok) throw new Error("media_upload_failed");
      }
      await loadProducts();
      setMessage(
        "画像を隔離領域へアップロードしました。安全確認後に商品画像として選択できます。",
      );
    } catch {
      setMessage("画像をアップロードできませんでした。");
    } finally {
      setUploading(false);
    }
  }

  // メディア庫は100件ごと。古い画像はカーソルで辿る。
  async function loadMoreMedia() {
    if (!mediaNextCursor || mediaLoadingMore) return;
    setMediaLoadingMore(true);
    try {
      const response = await fetch(
        `${API}/media?before=${encodeURIComponent(mediaNextCursor)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error("seller_media_unavailable");
      const result = (await response.json()) as {
        media: SellerMedia[];
        nextCursor?: string | null;
      };
      setMedia((current) => {
        const known = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...result.media.filter((item) => !known.has(item.id)),
        ];
      });
      setMediaNextCursor(result.nextCursor ?? null);
    } catch {
      setMessage("画像の続きを読み込めませんでした。");
    } finally {
      setMediaLoadingMore(false);
    }
  }

  async function deleteMedia(item: SellerMedia) {
    try {
      const response = await fetch(`${API}/media/${item.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("media_delete_failed");
      setMedia((current) => current.filter((entry) => entry.id !== item.id));
      setMessage("画像を削除しました。");
    } catch {
      setMessage("画像を削除できませんでした。");
    }
  }

  function chooseMedia(item: SellerMedia) {
    if (!item.url || !formRef.current) return;
    const field = formRef.current.elements.namedItem(
      "imageUrl",
    ) as HTMLInputElement | null;
    if (field) field.value = item.url;
    setMessage("審査済み画像を商品のメイン画像に設定しました。");
  }

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const identityAssertion = fragment.get("identity_assertion");
    const exchange = async () => {
      if (identityAssertion) {
        window.history.replaceState(null, "", window.location.pathname);
        const response = await fetch(`${API}/session`, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identityAssertion }),
        });
        if (!response.ok) throw new Error("seller_session_failed");
      }
      await loadProducts();
    };
    void exchange().catch(() => {
      setAuthenticated(null);
      setSellerUnavailable(true);
      setMessage("");
    });
  }, []);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const status = submitter?.value === "draft" ? "draft" : "active";
    const payload = {
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      imageUrl: String(form.get("imageUrl") ?? "").trim() || null,
      hubProductId: String(form.get("hubProductId") ?? "").trim() || null,
      priceJpyc: Number(form.get("priceJpyc")),
      fulfillmentType,
      stockQuantity: physical ? Number(form.get("stockQuantity")) : null,
      shippingJpyc: physical ? Number(form.get("shippingJpyc")) : null,
      gasPayerPolicy: "merchant" as const,
      gasSponsorThresholdJpy: null,
      tags: productTags,
      status,
    };
    try {
      const response = await fetch(
        editingId ? `${API}/products/${editingId}` : `${API}/products`,
        {
          method: editingId ? "PATCH" : "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error("product_create_failed");
      formElement.reset();
      setProductTags([]);
      setFulfillmentType("seller_shipping");
      setGasPayerPolicy("merchant");
      setEditingId(null);
      await loadProducts();
      setMessage(
        status === "draft"
          ? "下書きを保存しました。"
          : editingId
            ? "商品情報を更新しました。"
            : "商品を公開しました。マーケットの商品ページから購入できます。",
      );
    } catch {
      setMessage(
        "商品を登録できませんでした。入力内容と販売者確認の状態を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }

  function editProduct(product: SellerProduct) {
    const form = formRef.current;
    if (!form) return;
    const setValue = (
      name: string,
      value: string | number | null | undefined,
    ) => {
      const field = form.elements.namedItem(name) as
        HTMLInputElement | HTMLTextAreaElement | null;
      if (field) field.value = value == null ? "" : String(value);
    };
    setValue("title", product.title);
    setValue("description", product.description);
    setValue("imageUrl", product.imageUrl);
    setValue("hubProductId", product.hubProductId);
    setValue("priceJpyc", product.priceJpyc);
    setValue("stockQuantity", product.stockQuantity);
    setValue("shippingJpyc", product.shippingJpyc);
    setValue("gasSponsorThresholdJpy", product.gasSponsorThresholdJpy);
    setFulfillmentType(product.fulfillmentType);
    setProductTags((product.tags ?? []).map((tag) => tag.display));
    setGasPayerPolicy("merchant");
    setEditingId(product.id);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function changeProductStatus(product: SellerProduct) {
    setBusy(true);
    const status = product.status === "active" ? "archived" : "active";
    try {
      const response = await fetch(`${API}/products/${product.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("product_status_failed");
      await loadProducts();
      setMessage(
        status === "active"
          ? "商品を再公開しました。"
          : "商品の公開を停止しました。",
      );
    } catch {
      setMessage("商品の公開状態を変更できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  // 出品者側のエスクロー操作。calldataはCommerceが組み立て、ここでは
  // ウォレットへ渡して署名させるだけ——提案配分・期限・宛先はサーバー確定値。
  async function sellerEscrowAction(
    order: SellerOrder,
    action:
      | "ship"
      | "release"
      | "refund_by_seller"
      | "dispute"
      | "propose_resolution"
      | "accept_resolution"
      | "finalize_expired_dispute",
  ) {
    if (!wallet.address && !(await wallet.connect()))
      throw new Error("wallet_not_connected");
    const payload: Record<string, string> = { action };
    if (action === "propose_resolution") {
      const total = order.escrowAmountAtomic ?? order.amountAtomic;
      if (!total) throw new Error("escrow_amount_unavailable");
      const buyer = window.prompt("購入者へ返す最小単位の金額", total);
      if (buyer === null) throw new Error("cancelled");
      payload.buyerAmountAtomic = buyer;
      payload.sellerAmountAtomic = (BigInt(total) - BigInt(buyer)).toString();
    }
    const prepared = await fetch(
        `${API}/orders/${order.id}/escrow/actions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
      preparedBody = (await prepared.json()) as {
        action?: { chainId: number; to: string; data: `0x${string}` };
        proposal?: { buyerAmountAtomic: string; sellerAmountAtomic: string };
        error?: string;
      };
    if (!prepared.ok || !preparedBody.action)
      throw new Error(
        preparedBody.error === "escrow_action_unavailable"
          ? "escrow_action_unavailable"
          : (preparedBody.error ?? "escrow_prepare_failed"),
      );
    if (
      action === "accept_resolution" &&
      preparedBody.proposal &&
      !window.confirm(
        `相手の配分案を承認します。購入者へ ${preparedBody.proposal.buyerAmountAtomic}、貴店へ ${preparedBody.proposal.sellerAmountAtomic}（最小単位）を支払います。よろしいですか？`,
      )
    )
      throw new Error("cancelled");
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
      const submitted = await fetch(
          `${API}/orders/${order.id}/escrow/actions/submit`,
          {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, transactionHash }),
          },
        ),
        submitBody = (await submitted.json()) as { error?: string };
      if (submitted.ok) {
        confirmed = true;
        break;
      }
      lastError = submitBody.error ?? "escrow_submit_failed";
      if (lastError !== "transaction_not_confirmed") break;
    }
    if (!confirmed)
      throw new Error(
        lastError === "transaction_not_confirmed"
          ? "escrow_confirmation_timeout"
          : lastError,
      );
  }

  async function run(
    order: SellerOrder,
    action:
      | "release"
      | "refund_by_seller"
      | "dispute"
      | "propose_resolution"
      | "accept_resolution"
      | "finalize_expired_dispute",
  ) {
    setBusy(true);
    try {
      await sellerEscrowAction(order, action);
      await loadOrders();
      setMessage("エスクローを更新しました。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(
        code === "cancelled"
          ? "操作を取りやめました。"
          : code === "escrow_action_unavailable"
            ? "この操作はまだ利用できません。"
            : code === "escrow_confirmation_timeout"
              ? "送信済みですが、確定監視が時間内に完了しませんでした。"
              : "エスクロー操作に失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewReturn(
    order: SellerOrder,
    status: "approved" | "rejected" | "received",
  ) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/orders/${order.id}/returns`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("return_review_failed");
      await loadOrders();
      setMessage(
        status === "approved"
          ? "返品を承認しました。"
          : status === "received"
            ? "返品を受領しました。"
            : "返品を却下しました。",
      );
    } catch {
      setMessage("返品の状態を更新できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function updateShipment(
    event: FormEvent<HTMLFormElement>,
    order: SellerOrder,
  ) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (order.escrowState === "funded") await sellerEscrowAction(order, "ship");
      const response = await fetch(`${API}/orders/${order.id}/fulfillment`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fulfillmentStatus: "shipped",
          shippingCarrier: String(form.get("shippingCarrier") ?? "").trim(),
          trackingNumber: String(form.get("trackingNumber") ?? "").trim(),
        }),
      });
      if (!response.ok) throw new Error("shipment_update_failed");
      await loadProducts();
      await loadOrders();
      setMessage("発送情報を登録しました。");
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(
        code === "cancelled"
          ? "操作を取りやめました。"
          : code === "escrow_confirmation_timeout"
            ? "発送記録は送信済みですが、確定監視が時間内に完了しませんでした。"
            : "発送情報を登録できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function markPickupDelivered(order: SellerOrder) {
    setBusy(true);
    try {
      const response = await fetch(`${API}/orders/${order.id}/fulfillment`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fulfillmentStatus: "delivered" }),
      });
      if (!response.ok) throw new Error("delivery_update_failed");
      await loadOrders();
      setMessage("引き渡し済みにしました。");
    } catch {
      setMessage("引き渡し記録を登録できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="commerce-seller-page">
      <section className="commerce-seller-shell">
        <header className="commerce-seller-hero">
          <h2 className="commerce-seller-hero__title">実物商品を出品</h2>
          <nav className="commerce-seller-subnav" aria-label="販売管理">
            <a href="#products">商品登録</a>
            <a href="#seller-items">出品中</a>
            <a href="#orders">注文</a>
            <a href="#merchant-settings">販売設定</a>
          </nav>
        </header>
        {message ? (
          <p
            className="commerce-seller-message"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}

        {sellerUnavailable ? (
          <section className="commerce-seller-service-state" role="status">
            <div>
              <h2>販売サービスへ接続できません</h2>
              <p>
                入力内容は準備できます。接続が戻ってから販売者確認と公開を行ってください。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMessage("販売者情報を確認しています…");
                void loadProducts().catch(() => {
                  setAuthenticated(null);
                  setSellerUnavailable(true);
                  setMessage("");
                });
              }}
            >
              もう一度試す
            </button>
          </section>
        ) : authenticated === false ? (
          <SellerVerificationPanel onSellerSessionCreated={loadProducts} />
        ) : null}

        <MerchantPaymentExceptions />
        <div className="commerce-seller-grid">
          <form
            id="products"
            ref={formRef}
            className="commerce-product-form"
            onSubmit={createProduct}
          >
            <div className="commerce-form-heading">
              <div>
                <h2>{editingId ? "商品を編集" : "新しい商品を出品"}</h2>
                {editingId ? null : <p>すべて税込前のJPYC価格です</p>}
              </div>
              {editingId ? (
                <button
                  type="button"
                  onClick={() => {
                    formRef.current?.reset();
                    setEditingId(null);
                    setFulfillmentType("seller_shipping");
                  }}
                >
                  編集をやめる
                </button>
              ) : null}
            </div>
            <fieldset>
              <legend>1. 商品情報</legend>
              <label>
                商品名<span>購入者に伝わる正式名称を入力</span>
                <input
                  name="title"
                  required
                  maxLength={120}
                  placeholder="例：オリジナルレザーポーチ"
                />
              </label>
              <label>
                商品説明<span>内容、状態、サイズ、注意事項など</span>
                <textarea
                  name="description"
                  required
                  maxLength={2000}
                  rows={6}
                  placeholder="商品の特徴と購入前に必要な情報を入力してください"
                />
              </label>
              <V2TagInput
                value={productTags}
                onChange={setProductTags}
                sources={["hub"]}
                disabled={busy}
              />
              <div className="commerce-media-field">
                <label>
                  商品画像URL<span>自分で利用権を持つHTTPS画像を指定</span>
                  <input
                    name="imageUrl"
                    type="url"
                    inputMode="url"
                    pattern="https://.*"
                    placeholder="https://example.com/product.jpg"
                  />
                </label>
                <label className="commerce-media-upload">
                  <b>{uploading ? "アップロード中…" : "画像を選択"}</b>
                  <span>JPEG・PNG・WebP／1枚5MBまで／最大8枚</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={uploading || authenticated !== true}
                    onChange={(event) => {
                      void uploadImages(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {media.length ? (
                  <div
                    className="commerce-media-grid"
                    aria-label="アップロードした画像"
                  >
                    {media.map((item) => (
                      <article key={item.id} className={`is-${item.status}`}>
                        {item.url ? (
                          <img src={item.url} alt="" loading="lazy" />
                        ) : (
                          <div aria-hidden="true">画像</div>
                        )}
                        <small>
                          {item.status === "clean"
                            ? "利用できます"
                            : item.status === "pending_scan"
                              ? "安全確認中"
                              : "利用できません"}
                        </small>
                        {item.status === "clean" ? (
                          <button
                            type="button"
                            onClick={() => chooseMedia(item)}
                          >
                            メイン画像にする
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="commerce-pos-secondary"
                          onClick={() => void deleteMedia(item)}
                        >
                          削除
                        </button>
                      </article>
                    ))}
                    {mediaNextCursor ? (
                      <button
                        type="button"
                        disabled={mediaLoadingMore}
                        onClick={() => void loadMoreMedia()}
                      >
                        {mediaLoadingMore
                          ? "読み込み中…"
                          : "さらに古い画像を表示"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </fieldset>
            <fieldset>
              <legend>2. 価格と提供方法</legend>
              <div className="commerce-field-pair">
                <label>
                  販売価格（JPYC）
                  <input
                    name="priceJpyc"
                    type="number"
                    min="1"
                    max="10000000"
                    required
                    placeholder="3000"
                  />
                </label>
                <label>
                  提供方法
                  <select
                    name="fulfillmentType"
                    value={fulfillmentType}
                    onChange={(event) =>
                      setFulfillmentType(event.target.value as FulfillmentType)
                    }
                  >
                    {Object.entries(fulfillmentLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {physical ? (
                <div className="commerce-field-pair">
                  <label>
                    在庫数
                    <input
                      name="stockQuantity"
                      type="number"
                      min="0"
                      max="1000000"
                      required
                      defaultValue="1"
                    />
                  </label>
                  <label>
                    送料（JPYC）
                    <input
                      name="shippingJpyc"
                      type="number"
                      min="0"
                      max="10000000"
                      required
                      defaultValue="0"
                    />
                  </label>
                </div>
              ) : (
                <p className="commerce-form-note">
                  購入後に販売者と受取場所を確認する商品として登録します。送料と在庫数は設定しません。
                </p>
              )}
              <div className="commerce-field-pair" hidden>
                <label>
                  ネットワーク手数料
                  <select
                    name="gasPayerPolicy"
                    value={gasPayerPolicy}
                    onChange={(event) =>
                      setGasPayerPolicy(event.target.value as GasPayerPolicy)
                    }
                  >
                    <option value="merchant">店舗が負担（初期設定）</option>
                    <option value="buyer">購入者が負担</option>
                    <option value="merchant_above_threshold">
                      設定金額以上は店舗が負担
                    </option>
                  </select>
                </label>
                {gasPayerPolicy === "merchant_above_threshold" ? (
                  <label>
                    店舗負担になる注文額（JPY）
                    <input
                      name="gasSponsorThresholdJpy"
                      type="number"
                      min="1"
                      max="10000000"
                      required
                      defaultValue="3000"
                    />
                  </label>
                ) : null}
              </div>
              <p className="commerce-form-fee">
                販売手数料は本体価格の{HUB_MARKETPLACE_FEE_PERCENT}%（消費税込み）
              </p>
              <details className="commerce-form-details">
                <summary>手数料の詳細</summary>
                <p>
                  販売手数料は商品種別・売上規模・広告経由の有無にかかわらず一律です。対応ネットワークの決済ガス代はこの手数料に含まれ、購入者や販売者へ別途請求しません。広告料金は広告サービス側だけで請求し、販売手数料には加算しません。
                </p>
                <p>
                  店舗負担には対応チェーンのスポンサー決済が必要です。利用不能時に購入者負担へ自動変更しません。
                </p>
              </details>
            </fieldset>
            <details className="commerce-advanced-fields">
              <summary>価格比較ページと連携する</summary>
              <label>
                Hub商品ID
                <span>既存の商品ページに販売価格を追加する場合のみ入力</span>
                <input
                  name="hubProductId"
                  maxLength={180}
                  pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
                  placeholder="product-id"
                />
              </label>
            </details>
            <div className="commerce-publish-row">
              <p>
                {authenticated
                  ? "下書き保存するか、商品ページへ公開できます。"
                  : "販売者確認が完了すると、保存と公開ができます。"}
              </p>
              <div>
                <button
                  type="submit"
                  name="intent"
                  value="draft"
                  disabled={busy || authenticated !== true}
                >
                  下書き保存
                </button>
                <button
                  type="submit"
                  name="intent"
                  value="active"
                  disabled={busy || authenticated !== true}
                >
                  {busy
                    ? "処理しています…"
                    : editingId
                      ? "変更を公開"
                      : authenticated
                        ? "商品を公開する"
                        : "販売者確認後に公開"}
                </button>
              </div>
            </div>
          </form>

          <aside id="seller-items" className="commerce-product-list">
            <div className="commerce-list-heading">
              <div>
                <h2>出品中の商品</h2>
              </div>
              <b>{products.length}件</b>
            </div>
            {products.length ? (
              products.map((product) => (
                <article key={product.id}>
                  <div className="commerce-list-product">
                    <div
                      className="commerce-list-placeholder"
                      aria-hidden="true"
                    >
                      商品
                    </div>
                    <div>
                      <b>{product.title}</b>
                      <small>
                        {fulfillmentLabels[product.fulfillmentType]}
                        {product.stockQuantity != null
                          ? `・在庫 ${product.stockQuantity}`
                          : ""}
                        ・ガス代{" "}
                        {product.gasPayerPolicy === "buyer"
                          ? "購入者負担"
                          : product.gasPayerPolicy ===
                              "merchant_above_threshold"
                            ? `${product.gasSponsorThresholdJpy?.toLocaleString()}円以上は店舗負担`
                            : "店舗負担"}
                      </small>
                    </div>
                  </div>
                  <div>
                    <strong>{product.priceJpyc.toLocaleString()} JPYC</strong>
                    <span>
                      {product.status === "active"
                        ? "公開中"
                        : product.status === "draft"
                          ? "下書き"
                          : "公開停止"}
                    </span>
                    <div className="commerce-list-actions">
                      <button
                        type="button"
                        onClick={() => editProduct(product)}
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void changeProductStatus(product)}
                      >
                        {product.status === "active" ? "公開停止" : "公開する"}
                      </button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="commerce-empty-products">
                <b>まだ商品がありません</b>
                <p>上のフォームから最初の商品を公開できます。</p>
              </div>
            )}
            {productsNextCursor ? (
              <button
                type="button"
                disabled={productsLoadingMore}
                onClick={() => void loadMoreProducts()}
              >
                {productsLoadingMore
                  ? "読み込み中…"
                  : "さらに古い商品を表示"}
              </button>
            ) : null}
          </aside>
        </div>
        {authenticated ? (
          <section id="orders" className="commerce-order-panel">
            <header>
              <div>
                <h2>注文・発送管理</h2>
                <p>購入者の住所やウォレット情報はHubには表示されません。</p>
              </div>
              <button
                type="button"
                className="commerce-pos-secondary"
                onClick={() => void downloadOrdersCsv()}
              >
                CSV
              </button>
              <div className="commerce-order-scope">
                <button
                  type="button"
                  data-active={ordersFilter === "attention"}
                  onClick={() => setOrdersFilter("attention")}
                >
                  要対応
                </button>
                <button
                  type="button"
                  data-active={ordersFilter === "all"}
                  onClick={() => setOrdersFilter("all")}
                >
                  すべて
                </button>
              </div>
              <b>
                {ordersReady
                  ? `${filteredOrders.length}件`
                  : ordersError
                    ? "未取得"
                    : "確認中"}
              </b>
            </header>
            {ordersError ? (
              <div className="commerce-seller-service-state" role="alert">
                <div>
                  <b>注文を取得できませんでした</b>
                  <p>
                    発送待ちの注文を見落とさないよう、最新の注文一覧を再取得してください。
                  </p>
                </div>
                <button type="button" onClick={() => void loadOrders()}>
                  もう一度試す
                </button>
              </div>
            ) : !ordersReady ? (
              <div
                className="commerce-empty-products"
                role="status"
                aria-live="polite"
              >
                <b>注文を確認しています</b>
                <p>最新の入金済み注文を取得しています。</p>
              </div>
            ) : filteredOrders.length ? (
              <div className="commerce-order-list">
                {filteredOrders.map((order) => (
                  <article key={order.id}>
                    <div className="commerce-order-summary">
                      <small>注文 {order.id.slice(0, 8)}</small>
                      <b>{order.productTitle}</b>
                      {order.paidAt &&
                      Date.now() - Date.parse(order.paidAt) < 86_400_000 &&
                      order.fulfillmentStatus !== "shipped" ? (
                        <small className="commerce-order-new">新規</small>
                      ) : null}
                      <span>
                        数量 {order.quantity}・
                        {order.amountJpyc.toLocaleString()} JPYC
                        {order.status === "refunded"
                          ? "・返金済み"
                          : order.status === "partially_refunded"
                            ? "・一部返金済み"
                            : ""}
                      </span>
                      <time>
                        {order.escrowState
                          ? `資金ロック：${order.escrowState}`
                          : order.paidAt
                            ? new Date(order.paidAt).toLocaleDateString("ja-JP")
                            : "入金確認済み"}
                      </time>
                      {order.escrowShipBy ? (
                        <small>
                          発送期限{" "}
                          {new Date(order.escrowShipBy).toLocaleString("ja-JP")}
                        </small>
                      ) : null}
                      {order.escrowState === "funded" &&
                      order.escrowShipBy &&
                      new Date(order.escrowShipBy) <= new Date() ? (
                        <p className="commerce-order-note">
                          発送期限を過ぎています。購入者が未発送返金を
                          請求できる状態です。
                        </p>
                      ) : null}
                      {order.returnStatus === "received" &&
                      order.status === "paid" ? (
                        <p className="commerce-order-note">
                          返品商品を受領済みです。返金操作を行ってください。
                          {order.escrowState === "funded" ||
                          order.escrowState === "shipped"
                            ? "「購入者へ返金」でエスクロー内の資金を返せます。"
                            : "返金メニューから購入者への送金を実行してください。"}
                        </p>
                      ) : null}
                    </div>
                    {order.fulfillmentType === "seller_shipping" ||
                    order.fulfillmentType === "platform_3pl" ? (
                      order.fulfillmentStatus === "shipped" ? (
                        <div className="commerce-shipped">
                          <b>発送済み</b>
                          <span>
                            {order.shippingCarrier}・{order.trackingNumber}
                          </span>
                          <details className="commerce-shipping-quotes">
                            <summary>追跡情報を修正</summary>
                            <form
                              onSubmit={(event) =>
                                void updateShipment(event, order)
                              }
                            >
                              <label>
                                配送会社
                                <input
                                  name="shippingCarrier"
                                  required
                                  maxLength={80}
                                  defaultValue={order.shippingCarrier ?? ""}
                                />
                              </label>
                              <label>
                                追跡番号
                                <input
                                  name="trackingNumber"
                                  required
                                  maxLength={100}
                                  defaultValue={order.trackingNumber ?? ""}
                                />
                              </label>
                              <button type="submit" disabled={busy}>
                                修正を登録
                              </button>
                            </form>
                          </details>
                        </div>
                      ) : (
                        <>
                          <details className="commerce-shipping-quotes">
                            <summary>配送見積を比較（任意）</summary>
                            <p>
                              表示される金額・日数は目安です。発送手配は貴店と配送業者との契約となります。Hubの配送マージンは0%です。
                            </p>
                            <form
                              className="commerce-shipping-quote-form"
                              onSubmit={(event) =>
                                void fetchShippingQuotes(event, order)
                              }
                            >
                              <label>
                                重量（g）
                                <input name="weightGrams" type="number" min="1" max="100000" required />
                              </label>
                              <label>
                                長さ（mm）
                                <input name="lengthMm" type="number" min="1" max="3000" required />
                              </label>
                              <label>
                                幅（mm）
                                <input name="widthMm" type="number" min="1" max="3000" required />
                              </label>
                              <label>
                                高さ（mm）
                                <input name="heightMm" type="number" min="1" max="3000" required />
                              </label>
                              <label>
                                比較基準
                                <select name="shippingObjective" defaultValue="lowest_total_cost">
                                  {shippingObjectives.map((objective) => (
                                    <option key={objective.value} value={objective.value}>
                                      {objective.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <button type="submit" disabled={shippingQuoteStates[order.id]?.status === "loading"}>
                                {shippingQuoteStates[order.id]?.status === "loading" ? "見積を取得中…" : "見積を取得"}
                              </button>
                            </form>
                            {shippingQuoteStates[order.id]?.status === "unavailable" ? (
                              <p className="commerce-shipping-quote-state" role="alert">配送見積を取得できませんでした。配送会社へ直接ご確認ください。</p>
                            ) : shippingQuoteStates[order.id]?.status === "verified-empty" ? (
                              <p className="commerce-shipping-quote-state" role="status">条件に一致する有効な見積はありませんでした。</p>
                            ) : shippingQuoteStates[order.id]?.status === "ready" ? (
                              <div className="commerce-shipping-quote-list" role="radiogroup" aria-label="配送見積">
                                {shippingQuoteStates[order.id].quotes.map((quote, index) => (
                                  <div className="commerce-shipping-quote" key={`${quote.provider}-${quote.serviceCode}-${index}`}>
                                    <label>
                                      <input
                                        type="radio"
                                        name={`shippingQuote-${order.id}`}
                                        checked={selectedShippingQuotes[order.id] === index}
                                        onChange={() => copyShippingQuote(order.id, quote)}
                                      />
                                      <span>
                                        <b>{quote.provider}・{quote.serviceCode}</b>
                                        <small>
                                          {quote.amountMinor} {quote.currency ?? "JPYC"}
                                          {quote.estimatedDeliveryDate ? `・到着目安 ${quote.estimatedDeliveryDate}` : ""}
                                          {quote.reliabilityBps !== undefined
                                            ? `・信頼性 ${(quote.reliabilityBps / 100).toFixed(1)}%`
                                            : ""}
                                          {quote.emissionsGramsCo2e !== undefined
                                            ? `・推定CO₂ ${quote.emissionsGramsCo2e} g`
                                            : ""}
                                          {quote.sourceRef ? "・根拠確認済み" : ""}
                                        </small>
                                        {quote.validUntil ? (
                                          <small>
                                            有効期限 {new Date(quote.validUntil).toLocaleString("ja-JP")}
                                          </small>
                                        ) : null}
                                        {quote.explanation ? <small>{quote.explanation}</small> : null}
                                      </span>
                                    </label>
                                    <button type="button" onClick={() => copyShippingQuote(order.id, quote)}>
                                      この配送方法を選ぶ
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </details>
                          <form
                            data-shipment-order={order.id}
                            onSubmit={(event) =>
                              void updateShipment(event, order)
                            }
                          >
                          <label>
                            配送会社
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
                              autoComplete="off"
                            />
                          </label>
                          <button type="submit" disabled={busy}>
                            発送済みにする
                          </button>
                          </form>
                        </>
                      )
                    ) : order.fulfillmentStatus === "delivered" ? (
                      <div className="commerce-shipped">
                        <b>店頭受取・引き渡し済み</b>
                      </div>
                    ) : (
                      <div className="commerce-shipped">
                        <b>店頭受取</b>
                        <span>購入者へ商品を渡したら記録してください</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void markPickupDelivered(order)}
                        >
                          引き渡し済みにする
                        </button>
                      </div>
                    )}
                    {order.returnStatus ? (
                      <div className="commerce-order-actions">
                        {order.returnReason ? (
                          <p className="commerce-order-note">
                            返品の申し出：{order.returnReason}
                          </p>
                        ) : null}
                        {order.returnStatus === "requested" ? (
                          <>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void reviewReturn(order, "approved")
                              }
                            >
                              返品を承認
                            </button>
                            <button
                              className="commerce-order-action--danger"
                              disabled={busy}
                              onClick={() =>
                                void reviewReturn(order, "rejected")
                              }
                            >
                              返品を却下
                            </button>
                          </>
                        ) : null}
                        {["approved", "in_transit"].includes(
                          order.returnStatus,
                        ) ? (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void reviewReturn(order, "received")
                            }
                          >
                            返品を受領した
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {order.hasOpenPaymentException ? (
                      <p className="commerce-order-note">
                        支払いの整合が取れていません。支払い例外の一覧で内容を確認してください。
                      </p>
                    ) : null}
                    {order.escrowState ? (
                      <div className="commerce-order-actions">
                        {order.escrowSubmissionFailed ? (
                          <p className="commerce-order-note">
                            直前のオンチェーン操作は確定しませんでした。
                            操作をやり直してください。
                          </p>
                        ) : null}
                        {["funded", "shipped"].includes(order.escrowState) ? (
                          <>
                            {order.escrowState === "shipped" &&
                            order.escrowReleaseAt &&
                            new Date(order.escrowReleaseAt) <= new Date() ? (
                              <button
                                disabled={busy}
                                onClick={() => void run(order, "release")}
                              >
                                受取期限が過ぎたため代金を回収
                              </button>
                            ) : null}
                            <button
                              className="commerce-order-action--danger"
                              disabled={busy}
                              onClick={() =>
                                void run(order, "refund_by_seller")
                              }
                            >
                              エスクローから全額返金
                            </button>
                            <button
                              className="commerce-order-action--danger"
                              disabled={busy}
                              onClick={() => void run(order, "dispute")}
                            >
                              問題を報告して支払いを停止
                            </button>
                          </>
                        ) : null}
                        {order.escrowState === "disputed" ? (
                          <>
                            {order.disputeResolutionDeadline ? (
                              <p className="commerce-order-note">
                                異議の解決期限：
                                {new Date(
                                  order.disputeResolutionDeadline,
                                ).toLocaleString("ja-JP")}
                              </p>
                            ) : null}
                            {order.recentEvents?.length ? (
                              <details className="commerce-order-note">
                                <summary>経緯を見る</summary>
                                <ul>
                                  {order.recentEvents.map((event, index) => (
                                    <li key={index}>{event}</li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(order, "propose_resolution")
                              }
                            >
                              返金・支払いの配分を提案
                            </button>
                            {order.proposalProposedBy === "buyer" ? (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(order, "accept_resolution")
                                }
                              >
                                購入者の提案を承認（購入者{" "}
                                {order.proposalBuyerAmountAtomic}・貴店{" "}
                                {order.proposalSellerAmountAtomic}）
                              </button>
                            ) : null}
                            {!order.disputeResolutionDeadline ||
                            new Date(order.disputeResolutionDeadline) <=
                              new Date() ? (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(order, "finalize_expired_dispute")
                                }
                              >
                                異議の解決期限が過ぎた場合、異議前の状態へ戻す
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}
                {ordersNextCursor ? (
                  <button
                    type="button"
                    disabled={ordersLoadingMore}
                    onClick={() => void loadMoreOrders()}
                  >
                    {ordersLoadingMore
                      ? "読み込み中…"
                      : "さらに古い注文を表示"}
                  </button>
                ) : null}
              </div>
            ) : orders.length && ordersFilter === "attention" ? (
              <div className="commerce-empty-products">
                <b>要対応の注文はありません</b>
                <p>すべての注文を確認するには「すべて」タブを開いてください。</p>
              </div>
            ) : (
              <div className="commerce-empty-products">
                <b>入金済みの注文はありません</b>
                <p>注文が確定するとここに表示されます。</p>
              </div>
            )}
          </section>
        ) : null}
        {authenticated ? <MerchantPosReadiness /> : null}
        {authenticated ? <MerchantDynamicQr products={products} /> : null}
        {authenticated ? <MerchantOperationsPanel /> : null}
        {authenticated ? (
          <section id="merchant-settings" className="commerce-seller-settings">
            <header>
              <h2>販売設定</h2>
              <p>受取先、税務情報、運用メンバーを管理します。</p>
            </header>
            <div className="commerce-seller-settings__grid">
              <MerchantChainDestinations />
              <MerchantTaxRegistrations />
              <MerchantAssetTaxLedger />
              <MerchantMediaBillingPanel />
              <MerchantGasBudgetPanel />
              <MerchantWalletPanel />
              <MerchantTeamPanel />
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
