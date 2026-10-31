"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHubWallet } from "@/components/hub-wallet-provider";
import { commerceApiUrl, commerceRequest } from "@/lib/commerce-client";
import {
  mergeOrderReceipts,
  ORDER_HISTORY_KEY as ORDERS_KEY,
  readOrderAccessToken,
  saveOrderAccessToken,
} from "@/lib/commerce-order-records";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { SkeletonList } from "@/components/v2/ui/skeleton";
import {
  availablePhysicalProduct,
  PRODUCT_SORTS,
  productLineEstimate,
  productPriceLabels,
  productShippingLabel,
  productStockLabel,
  publicId,
  publicMoney,
  readPublicProduct,
  type Product,
  type ProductSort,
} from "@/lib/commerce-product";

const CART_KEY = "hub.shopping.cart.v1";
type CartItem = { productId: string; quantity: number };
type Order = {
  id: string;
  productId: string;
  status: string;
  fulfillmentType?: string | null;
  subtotalJpyc: number;
  shippingJpyc: number;
  taxJpyc: number;
  taxRateBps: number;
  taxCountry: string;
  taxLiabilityParty: "seller" | "platform";
  amountJpyc: number;
  chainId: number;
  chainName: string;
  currency: string;
  paymentAmount: string;
  assetKind: "native" | "erc20";
  tokenContract: string;
  transferData: `0x${string}`;
  valueAtomic: string;
  gasPayer: "merchant" | "buyer";
  accessToken: string;
  moneyFlow: {
    hubFeeJpyc: number;
    sellerReceivesJpyc: number;
    networkGasCoveredByHubFee: boolean;
  };
  escrow?: {
    contractAddress: string;
    state: string;
    shipBy: string;
    releaseAt: string;
    approval: { tokenContract: string; data: `0x${string}` } | null;
  } | null;
  fulfillmentStatus?: string | null;
  shippingCarrier?: string | null;
  trackingNumber?: string | null;
  returnStatus?: string | null;
  returnShippingCarrier?: string | null;
  returnTrackingNumber?: string | null;
  expiresAt?: string | null;
};
type Receipt = {
  id: string;
  productId: string;
  title: string;
  amountJpyc: number;
  transactionHash?: string;
  status: string;
  fulfillmentType?: string | null;
  fulfillmentStatus?: string | null;
  shippingCarrier?: string | null;
  trackingNumber?: string | null;
  returnStatus?: string | null;
  returnShippingCarrier?: string | null;
  returnTrackingNumber?: string | null;
  paymentException?: { exceptionType: "underpaid" | "overpaid" } | null;
  escrow?: { state: string; shipBy: string; releaseAt: string } | null;
  expiresAt?: string | null;
  createdAt: string;
};
type PreparedLine = {
  product: Product;
  item: CartItem;
  order: Order;
  maximumGasAtomic: string;
};
type PaymentAsset = {
  currency: string;
  chainId: number;
  chainName: string;
  assetKind: "native" | "erc20";
  tokenContract: string;
  decimals: number;
};

async function commerce(path: string, init?: RequestInit) {
  return commerceRequest<Record<string, unknown>>(path, init);
}
function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function formatNativeAtomic(value: string) {
  const amount = BigInt(value);
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function nativeSymbol(chainId: number) {
  const symbols: Record<number, string> = {
    1: "ETH",
    137: "POL",
    8217: "KAIA",
    43114: "AVAX",
    84532: "ETH",
    80002: "POL",
    1001: "KAIA",
  };
  return symbols[chainId] ?? "native";
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    awaiting_payment: "支払い待ち",
    submitted: "送金を確認中",
    paid: "支払い済み",
    partially_refunded: "一部返金済み",
    refunded: "返金済み",
    cancelled: "キャンセル済み",
    expired: "支払い期限切れ",
    payment_failed: "支払いに失敗",
  };
  return labels[status] ?? `状態を確認中（${status}）`;
}

function fulfillmentStatusLabel(status: string | null | undefined) {
  if (!status) return "配送状況を確認中";
  const labels: Record<string, string> = {
    processing: "発送準備中",
    shipped: "発送済み",
  };
  return labels[status] ?? `状態を確認中（${status}）`;
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

function returnStatusLabel(status: string | null | undefined) {
  if (!status) return null;
  const labels: Record<string, string> = {
    requested: "返品を申請済み",
    approved: "返品承認済み",
    rejected: "返品を受け付けられませんでした",
    in_transit: "返送中",
    received: "返品を受領済み",
    refunded: "返品分の返金が完了しました",
  };
  return labels[status] ?? `状態を確認中（${status}）`;
}

export function PhysicalCommerce({
  view = "cart",
}: {
  view?: "cart" | "orders" | "products";
}) {
  /* 見ている面の中に留まる。v2 に無い画面は既存の道のまま返る。 */
  const surface = useHubUiSurface();
  const wallet = useHubWallet();
  const [accountVersion, setAccountVersion] = useState(0);
  const query = typeof window === "undefined" ? "" : window.location.search;
  let authority = ""; try { authority = commerceApiUrl("/"); } catch { /* The read below reports an invalid configured origin. */ }
  const readScope = JSON.stringify([query, authority, surface, view, wallet.address, accountVersion]);
  const [catalogScope, setCatalogScope] = useState(readScope);
  const [cartReady, setCartReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [country, setCountry] = useState("JP");
  const [assertions, setAssertions] = useState<Record<string, string>>({});
  const [fulfillmentConfirmed, setFulfillmentConfirmed] = useState<
    Record<string, string>
  >({});
  const [confirmingProduct, setConfirmingProduct] = useState<string | null>(
    null,
  );
  const [paymentAssets, setPaymentAssets] = useState<PaymentAsset[]>([]);
  const [assetKey, setAssetKey] = useState("");
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sellerFilter, setSellerFilter] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  // 並べ替えと絞り込みは Commerce 側（索引とカーソル）。読み込んだ頁だけを手元で並べ替えると未読込の頁が外れる。
  const [catalogSort, setCatalogSort] = useState<ProductSort>("new");
  const [catalogInStock, setCatalogInStock] = useState(false);
  const [catalogFreeShipping, setCatalogFreeShipping] = useState(false);
  const [storedCatalogState, setCatalogState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const catalogState = catalogScope === readScope ? storedCatalogState : "loading";
  const [catalogRetryKey, setCatalogRetryKey] = useState(0);
  // 商品の取得に失敗した理由は、その失敗を示す枠の中で1回だけ見せる（上の通知帯には出さない）。
  const [catalogError, setCatalogError] = useState("");
  // productsビューはサーバー側の検索・絞り込み・ページングで辿る。
  const [catalogResults, setCatalogResults] = useState<Product[]>([]);
  const [catalogListState, setCatalogListState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(
    null,
  );
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const catalogRequest = useRef(0);
  const [receiptFilter, setReceiptFilter] = useState<
    "all" | "attention" | "open" | "done"
  >("all");
  const [receiptSearch, setReceiptSearch] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [intentId, setIntentId] = useState("");
  const [preparedLines, setPreparedLines] = useState<PreparedLine[]>([]);
  const [returnTrackingDrafts, setReturnTrackingDrafts] = useState<
    Record<string, { shippingCarrier: string; trackingNumber: string }>
  >({});
  const [returnTrackingPreviews, setReturnTrackingPreviews] = useState<
    Record<string, { shippingCarrier: string; trackingNumber: string }>
  >({});
  const checkoutKeys = useRef(new Map<string, string>());
  const signingOrders = useRef(new Map<string, Set<number>>());
  const checkoutEpoch = useRef(0), checkoutFlight = useRef<number | null>(null), checkoutMounted = useRef(false);
  const checkoutContext = JSON.stringify([readScope, catalogRetryKey, catalogState, paymentsEnabled, cart, products, assertions, fulfillmentConfirmed, country, assetKey, paymentAssets, intentId, wallet.kind]);
  const checkoutCurrent = useRef(checkoutContext), previousCheckout = useRef(checkoutContext);
  const checkoutScope = useRef(readScope);
  checkoutCurrent.current = checkoutContext;
  checkoutScope.current = readScope;
  useEffect(() => { checkoutMounted.current = true; return () => { checkoutMounted.current = false; checkoutEpoch.current++; checkoutFlight.current = null; }; }, []);
  useEffect(() => { if (previousCheckout.current !== checkoutContext) { previousCheckout.current = checkoutContext; invalidateCheckout(); setConfirmingProduct(null); } }, [checkoutContext]);
  useEffect(() => { const changed = () => setAccountVersion(value => value + 1); window.addEventListener("hub-account-changed", changed); return () => window.removeEventListener("hub-account-changed", changed); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const storedCart = readStored<CartItem[]>(CART_KEY, []);
    const params = new URLSearchParams(query);
    const requested = view === "cart" ? params.get("product") : null;
    // An AI purchase proposal opens the cart with ?product=&quantity= (2026-10-17);
    // the buyer still reviews and confirms every line here.
    const requestedQuantity = requested !== null ? Number(params.get("quantity") ?? "1") : 1;
    setCatalogScope(readScope); setCartReady(false); setPaymentsEnabled(false);
    setAssertions({}); setFulfillmentConfirmed({}); setReviewing(false); setPreparedLines([]);
    controller.signal.addEventListener("abort", () => { if (active) { setPaymentsEnabled(false); setCatalogState("error"); setCatalogError("商品を確認できませんでした。保存したカートは保持しています。"); } });
    setIntentId(new URLSearchParams(window.location.search).get("intent") ?? "");
    const storedReceipts = readStored<Receipt[]>(ORDERS_KEY, []);
    setReceipts(storedReceipts);
    // 支払い待ち(期限切れの反映)と送金確認中の注文を再照合する。
    // 不足・超過入金の例外はこの状態遷移中に検出されるため、一覧でも
    // 気付けるようにする。paid以降はエスクロー未取得のものだけ取り直す。
    for (const receipt of storedReceipts)
      if (
        receipt.status === "awaiting_payment" ||
        receipt.status === "submitted" ||
        (["paid", "partially_refunded", "refunded"].includes(receipt.status) &&
          !receipt.escrow)
      )
        void refreshOrder(receipt, true);
    setCatalogState("loading"); setCatalogError("");
    setMessage("");
    Promise.all([
      commerce("/products", { signal: controller.signal, credentials: "omit", redirect: "error" }),
      commerce("/health", { signal: controller.signal, credentials: "omit", redirect: "error" }),
    ])
      .then(async ([body, health]) => {
        if (!active || controller.signal.aborted) return;
        if (typeof health.paymentsEnabled !== "boolean") throw Error("invalid_commerce_health");
        const assets = health.paymentsEnabled ? await commerce("/payment/assets", { signal: controller.signal, credentials: "omit", redirect: "error" }) : { assets: [] };
        if (!active || controller.signal.aborted) return;
        if (!Array.isArray(assets.assets)) throw Error("invalid_payment_assets");
        if (commerceApiUrl("/") !== authority || !Array.isArray(body.products) || body.products.length > 100 || !Array.isArray(storedCart) || storedCart.some(item => !item || !publicId(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) || new Set(storedCart.map(item => item.productId)).size !== storedCart.length || params.getAll("product").length > 1 || requested !== null && !publicId(requested) || params.getAll("quantity").length > 1 || !Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > 20) throw Error("invalid_cart_product");
        const all = new Map(body.products.map(item => { const product = readPublicProduct(item); return [product.id, product] as const; }));
        if (all.size !== body.products.length) throw Error("invalid_public_product");
        const wanted = view === "cart" ? new Set([...storedCart.map(item => item.productId), ...(requested ? [requested] : [])]) : new Set<string>();
        await Promise.all([...wanted].filter(id => !all.has(id)).map(async id => {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(id)) throw Error("invalid_cart_product");
          const detail = await commerce(`/products/${encodeURIComponent(id)}`, { signal: controller.signal, credentials: "omit", redirect: "error" });
          if (!active || controller.signal.aborted) return;
          all.set(id, readPublicProduct(detail.product, id));
        }));
        if (!active || controller.signal.aborted || commerceApiUrl("/") !== authority) return;
        if ([...wanted].some(id => !all.has(id) || !availablePhysicalProduct(all.get(id)!))) throw Error("cart_product_unavailable");
        const enabled = health.paymentsEnabled && assets.assets.length > 0;
        setPaymentsEnabled(enabled);
        const listed = Array.isArray(assets.assets)
          ? (assets.assets as PaymentAsset[])
          : [];
        setPaymentAssets(listed);
        if (listed.length === 1)
          setAssetKey(`${listed[0].chainId}:${listed[0].currency}`);
        const available = [...all.values()].filter(availablePhysicalProduct);
        setProducts(available);
        const requestedSeller = params.get("sellerId");
        const sellerProduct = requestedSeller
          ? available.find((item) => item.seller.id === requestedSeller)
          : undefined;
        // 初頁にその販売者の商品が無くても絞り込みは有効にする。
        // 店名はカタログ側の結果から補う。
        if (requestedSeller)
          setSellerFilter({
            id: requestedSeller,
            name: sellerProduct?.seller.publicName ?? "",
          });
        const next =
          requested &&
          available.some((item) => item.id === requested) &&
          !storedCart.some((item) => item.productId === requested)
            ? [...storedCart, { productId: requested, quantity: requestedQuantity }]
            : storedCart;
        if (view === "cart" && (next.some(item => item.quantity > (all.get(item.productId)?.stockQuantity ?? 0)) || !publicMoney(next.reduce((total, item) => { const product = all.get(item.productId)!; return total + product.priceJpyc * item.quantity + (product.shippingJpyc ?? 0); }, 0)))) throw Error("cart_product_unavailable");
        setCart(next); setCartReady(true);
        setCatalogState("ready");
        setMessage(
          !enabled
            ? "現在は決済メンテナンス中です。商品とカートは確認できます。"
            : next.length
              ? "数量を確認し、商品ごとに「配送先を確認」を押してください。"
              : "",
        );
      })
      .catch(error => {
        if (!active || controller.signal.aborted) return;
        setPaymentsEnabled(false);
        setCatalogState("error");
        setCatalogError(error instanceof Error && error.message === "cart_product_unavailable" ? "一部の商品は在庫切れ、または配送条件を確認できません。保存したカートは保持しています。" : "商品を確認できませんでした。保存したカートは保持しています。");
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [catalogRetryKey, readScope]);

  async function fetchCatalogPage(
    before: string | null,
    query: string,
    seller: string | null,
    signal?: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (seller) params.set("sellerId", seller);
    if (catalogSort !== "new") params.set("sort", catalogSort);
    params.set("kind", "physical");
    if (catalogInStock) params.set("inStock", "1");
    if (catalogFreeShipping) params.set("freeShipping", "1");
    if (before) params.set("before", before);
    const suffix = params.size ? `?${params}` : "";
    if (commerceApiUrl("/") !== authority) throw Error("invalid_commerce_origin");
    const body = await commerce(`/products${suffix}`, { signal, credentials: "omit", redirect: "error" });
    if (!Array.isArray(body.products)) throw Error("invalid_public_product");
    return { products: body.products.map(item => readPublicProduct(item)), nextCursor: body.nextCursor as string | null | undefined };
  }

  // カタログ面の検索と販売者絞り込みはサーバー側で行い、
  // 未読込の頁も対象に含める。
  useEffect(() => {
    if (view !== "products") return;
    const seq = ++catalogRequest.current;
    const controller = new AbortController();
    setCatalogListState("loading");
    const timer = window.setTimeout(() => {
      fetchCatalogPage(null, catalogQuery.trim(), sellerFilter?.id ?? null, controller.signal)
        .then((body) => {
          if (catalogRequest.current !== seq) return;
          const listed = Array.isArray(body.products) ? body.products : [];
          setCatalogResults(listed);
          setCatalogNextCursor(body.nextCursor ?? null);
          setCatalogListState("ready");
          // sellerId指定で飛んできた場合、初頁に無くても店名を結果から補う。
          setSellerFilter((current) =>
            current && !current.name && listed[0]?.seller.id === current.id
              ? { id: current.id, name: listed[0].seller.publicName }
              : current,
          );
        })
        .catch(() => {
          if (catalogRequest.current === seq) setCatalogListState("error");
        });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); if (catalogRequest.current === seq) catalogRequest.current++; };
  }, [view, catalogQuery, sellerFilter, catalogSort, catalogInStock, catalogFreeShipping, catalogRetryKey, readScope]);

  async function loadMoreCatalog() {
    const cursor = catalogNextCursor;
    if (!cursor || catalogLoadingMore) return;
    setCatalogLoadingMore(true);
    const seq = catalogRequest.current;
    try {
      const body = await fetchCatalogPage(
        cursor,
        catalogQuery.trim(),
        sellerFilter?.id ?? null,
      );
      if (catalogRequest.current !== seq) return;
      const fresh = Array.isArray(body.products) ? body.products : [];
      setCatalogResults((current) => {
        const known = new Set(current.map((product) => product.id));
        return [
          ...current,
          ...fresh.filter((product) => !known.has(product.id)),
        ];
      });
      setCatalogNextCursor(body.nextCursor ?? null);
    } catch {
      if (catalogRequest.current === seq) setMessage("商品の続きを読み込めませんでした。");
    } finally {
      if (catalogRequest.current === seq) setCatalogLoadingMore(false);
    }
  }

  useEffect(() => {
    if (typeof window !== "undefined" && cartReady && catalogScope === readScope && catalogState === "ready")
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
  }, [cart, cartReady, catalogScope, readScope, catalogState]);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem(
        ORDERS_KEY,
        JSON.stringify(mergeOrderReceipts<Receipt>(receipts)),
      );
  }, [receipts]);
  const lines = useMemo(
    () =>
      cart
        .map((item) => ({
          item,
          product: products.find((product) => product.id === item.productId),
        }))
        .filter((line): line is { item: CartItem; product: Product } =>
          Boolean(line.product),
        ),
    [cart, products],
  );
  const selectedAsset = useMemo(
    () =>
      paymentAssets.find(
        (asset) => `${asset.chainId}:${asset.currency}` === assetKey,
      ) ?? null,
    [paymentAssets, assetKey],
  );
  // 購入者側の「動ける注文」: 支払い待ち・支払い例外・返品の進行・
  // 異議中・受取確認待ち（発送済みのロック）。
  const receiptAttention = (receipt: Receipt) =>
    receipt.status === "awaiting_payment" ||
    Boolean(receipt.paymentException) ||
    receipt.returnStatus === "requested" ||
    receipt.returnStatus === "approved" ||
    receipt.returnStatus === "in_transit" ||
    receipt.escrow?.state === "disputed" ||
    receipt.escrow?.state === "shipped";
  const receiptDone = (receipt: Receipt) =>
    ["refunded", "expired", "cancelled"].includes(receipt.status) ||
    receipt.fulfillmentStatus === "delivered" ||
    receipt.escrow?.state === "released" ||
    // デジタル商品は配送を伴わず、支払い確定が履行になる。
    (receipt.fulfillmentType === "digital" && receipt.status === "paid");
  const visibleReceipts = receipts
    .filter((receipt) =>
      receiptFilter === "all"
        ? true
        : receiptFilter === "attention"
          ? receiptAttention(receipt)
          : receiptFilter === "open"
            ? !receiptAttention(receipt) && !receiptDone(receipt)
            : receiptDone(receipt),
    )
    .filter((receipt) => {
      const query = receiptSearch.trim().toLowerCase();
      if (!query) return true;
      return [receipt.title, receipt.id, receipt.transactionHash, receipt.trackingNumber]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));
    });
  // レシートは端末ローカルの記録なので、CSVも表示中の絞り込みから作る。
  function exportReceiptCsv() {
    const rows = [
      ["id", "createdAt", "title", "amountJpyc", "status", "fulfillment", "return", "tx"],
      ...visibleReceipts.map((receipt) => [
        receipt.id,
        receipt.createdAt,
        receipt.title,
        String(receipt.amountJpyc),
        receipt.status,
        receipt.fulfillmentStatus ?? "",
        receipt.returnStatus ?? "",
        receipt.transactionHash ?? "",
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  const shippingPending = lines.some(({ product }) => product.shippingJpyc === null);
  // 税込の目安。確定額は注文時に Commerce が出す（注文はまとめて税をかけるので1円単位でずれうる）。
  const knownEstimate = lines.reduce(
    (total, line) => total + productLineEstimate(line.product, line.item.quantity),
    0,
  );
  const estimateTaxIncluded = lines.every(({ product }) => product.taxIncluded?.status === "determined");
  function cancelPreparedOrders(linesToCancel = preparedLines) {
    if (!linesToCancel.length) return;
    void Promise.allSettled(
      linesToCancel.filter(({ order }) => !signingOrders.current.has(commerceApiUrl(`/orders/${order.id}/submit`))).map(async ({ order }) => {
        await commerce(`/orders/${order.id}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${order.accessToken}` },
        });
        if (intentId) await completeIntentWhenFinal(order);
      }),
    );
  }
  function resetReview() {
    cancelPreparedOrders();
    invalidateCheckout();
  }
  function invalidateCheckout() {
    checkoutEpoch.current++;
    if (checkoutFlight.current !== null) { setBusy(false); setMessage("購入内容が変わりました。確定金額をもう一度確認してください。"); }
    checkoutFlight.current = null;
    checkoutKeys.current.clear();
    setReviewing(false);
    setPreparedLines([]);
  }
  function add(productId: string) {
    resetReview();
    setCart((current) =>
      current.some((item) => item.productId === productId)
        ? current
        : [...current, { productId, quantity: 1 }],
    );
  }
  function quantity(productId: string, value: number) {
    resetReview();
    setCart((current) =>
      current.map((item) =>
        item.productId === productId
          ? { ...item, quantity: Math.max(1, Math.min(20, value)) }
          : item,
      ),
    );
  }
  function remove(productId: string) {
    resetReview();
    setCart((current) =>
      current.filter((item) => item.productId !== productId),
    );
    setAssertions((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setFulfillmentConfirmed((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }
  async function confirmFulfillment(product: Product) {
    resetReview();
    const generation = checkoutEpoch.current, context = checkoutCurrent.current;
    const current = () => checkoutMounted.current && checkoutEpoch.current === generation && checkoutCurrent.current === context;
    setConfirmingProduct(product.id);
    setMessage(`${product.title}の配送先をIdentityで確認しています…`);
    try {
      const response = await fetch("/api/dev/commerce-fulfillment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          fulfillmentMode: product.fulfillmentType,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | {
            assertion?: string;
            destinationZone?: string;
            error?: string;
          }
        | null;
      if (!current()) return;
      if (!response.ok || !body?.assertion) {
        const known: Record<string, string> = {
          identity_demo_unavailable:
            "Identityのローカルサービスが起動していません。",
          identity_quote_unavailable:
            "Identityで配送先を確認できませんでした。しばらくしてから再度お試しください。",
          invalid_product: "この商品は配送承認に対応していません。",
        };
        throw new Error(
          known[body?.error ?? ""] ??
            "配送先を確認できませんでした。Identityの設定を確認してください。",
        );
      }
      setAssertions((current) => ({
        ...current,
        [product.id]: body.assertion as string,
      }));
      setFulfillmentConfirmed((current) => ({
        ...current,
        [product.id]: body.destinationZone ?? "",
      }));
      setMessage(
        `${product.title}の配送先を確認しました。確認情報は5分間有効です。`,
      );
    } catch (error) {
      if (!current()) return;
      setMessage(
        error instanceof Error
          ? error.message
          : "配送先を確認できませんでした。",
      );
    } finally {
      if (checkoutEpoch.current === generation && checkoutMounted.current) setConfirmingProduct(null);
    }
  }
  function orderCalls(order: Order) {
    if (!order.escrow) throw new Error("physical_escrow_unavailable");
    return order.escrow.approval
      ? [
          {
            to: order.escrow.approval.tokenContract,
            data: order.escrow.approval.data,
            value: "0x0" as `0x${string}`,
          },
          {
            to: order.escrow.contractAddress,
            data: order.transferData,
            value: "0x0" as `0x${string}`,
          },
        ]
      : [
          {
            to: order.escrow.contractAddress,
            data: order.transferData,
            value:
              `0x${BigInt(order.valueAtomic).toString(16)}` as `0x${string}`,
          },
        ];
  }
  async function checkout() {
    if (!checkoutMounted.current || checkoutFlight.current !== null) return;
    const recoveryMessage = "支払い結果を確認できません。注文履歴で状態を確認してください。再署名・自動取消は行いません。";
    if (reviewing && preparedLines.some(({ order }) => signingOrders.current.has(commerceApiUrl(`/orders/${order.id}/submit`)))) return setMessage(recoveryMessage);
    if (confirmingProduct !== null) return setMessage("配送先の確認が終わってから、確定金額を確認してください。");
    if (!paymentsEnabled) return setMessage("現在は決済メンテナンス中です。");
    if (!lines.length) return setMessage("カートに商品がありません。");
    if (intentId && lines.length !== 1)
      return setMessage("Intentからの購入は商品を1件だけ選択してください。");
    const billingCountry = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(billingCountry))
      return setMessage("請求先国を2文字の国コードで入力してください。");
    if (!selectedAsset)
      return setMessage("支払いに使う資産を選択してください。");
    const missing = lines.find((line) => !assertions[line.product.id]?.trim());
    if (missing)
      return setMessage(
        `${missing.product.title}の配送先確認が必要です。「配送先を確認」を押してください。`,
      );
    const operation = ++checkoutEpoch.current, context = checkoutCurrent.current, scope = readScope;
    const current = () => checkoutMounted.current && checkoutEpoch.current === operation && checkoutCurrent.current === context;
    const sameBuyerScope = () => checkoutMounted.current && checkoutScope.current === scope;
    const ownedSigning = new Set<string>();
    let uncertainReceipt: Receipt | null = null;
    checkoutFlight.current = operation;
    setBusy(true);
    try {
      const connected = wallet.address ? true : await wallet.connect();
      if (!current()) return;
      if (!connected || !wallet.address)
        throw new Error("wallet_not_connected");
      if (!reviewing) {
        const prepared: PreparedLine[] = [];
        for (const { product, item } of lines) {
          let paymentRequestToken: string | undefined;
          let key =
            checkoutKeys.current.get(product.id) ?? crypto.randomUUID();
          if (intentId) {
            const handoffResponse = await fetch(
              `/api/core/intents/${encodeURIComponent(intentId)}/handoff`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ service: "commerce" }),
              },
            );
            const handoffBody = (await handoffResponse.json().catch(() => null)) as
              | { proof?: string; error?: string }
              | null;
            if (!current()) return;
            if (!handoffResponse.ok || !handoffBody?.proof)
              throw new Error(
                handoffBody?.error ?? "intent_handoff_unavailable",
              );
            const paymentRequestResponse = await fetch(
              commerceApiUrl(
                `/products/${encodeURIComponent(product.id)}/payment-request`,
              ),
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  quantity: item.quantity,
                  billingCountry,
                  currency: "JPYC",
                  intentHandoffProof: handoffBody.proof,
                }),
              },
            );
            const paymentRequestBody = (await paymentRequestResponse
              .json()
              .catch(() => null)) as
              | {
                  paymentRequest?: { token?: string; requestId?: string };
                  error?: string;
                }
              | null;
            if (!current()) return;
            if (
              !paymentRequestResponse.ok ||
              !paymentRequestBody?.paymentRequest?.token ||
              !paymentRequestBody.paymentRequest.requestId
            )
              throw new Error(
                paymentRequestBody?.error ?? "payment_request_failed",
              );
            paymentRequestToken = paymentRequestBody.paymentRequest.token;
            key = paymentRequestBody.paymentRequest.requestId;
          }
          checkoutKeys.current.set(product.id, key);
          setMessage(`${product.title}の確定金額をCommerceから取得しています…`);
          const body = await commerce("/orders", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify({
              productId: product.id,
              quantity: item.quantity,
              buyerWallet: wallet.address,
              billingCountry,
              customerType: "consumer",
              paymentCurrency: selectedAsset.currency,
              paymentChainId: selectedAsset.chainId,
              fulfillmentAssertion: assertions[product.id].trim(),
              ...(paymentRequestToken
                ? { paymentRequestToken, items: [item] }
                : {}),
            }),
          });
          if (!current()) return;
          const order = body.order as Order;
          if (!order.escrow) throw new Error("physical_escrow_unavailable");
          saveOrderAccessToken(order.id, order.accessToken);
          await wallet.switchChain(order.chainId);
          if (!current()) return;
          const maximumGasAtomic =
            order.gasPayer === "merchant"
              ? "0"
              : await wallet.estimateContractTransactionsMaximumCost(
                  orderCalls(order),
                );
          if (!current()) return;
          prepared.push({ product, item, order, maximumGasAtomic });
        }
        if (!current()) return;
        setPreparedLines(prepared);
        setReviewing(true);
        setMessage(
          "支払内容を確認してください。まだ署名・送金は行われていません。",
        );
        return;
      }
      const completed = new Set<string>();
      for (const { product, order } of preparedLines) {
        if (!current()) return;
        setMessage(`${product.title}の税込総額を確認しています。`);
        if (!order.escrow) throw new Error("physical_escrow_unavailable");
        await wallet.switchChain(order.chainId);
        if (!current()) return;
        const submitUrl = commerceApiUrl(`/orders/${order.id}/submit`);
        const owners = signingOrders.current.get(submitUrl) ?? new Set<number>();
        owners.add(operation); signingOrders.current.set(submitUrl, owners); ownedSigning.add(submitUrl);
        uncertainReceipt = { id: order.id, productId: product.id, title: product.title, amountJpyc: order.amountJpyc, status: "awaiting_payment", fulfillmentType: product.fulfillmentType, createdAt: new Date().toISOString() };
        let transactionHash: `0x${string}`;
        let userOperationHash: `0x${string}` | null = null;
        if (order.gasPayer === "merchant") {
          setMessage(
            `${product.title}の承認とロック入金を店舗負担で一括処理しています…`,
          );
          const calls = orderCalls(order);
          const operationHash = await wallet.sendBatchContractTransactions(
            calls,
            {
              orderId: order.id,
              accessToken: order.accessToken,
              url: commerceApiUrl(`/orders/${order.id}/gas-sponsorship`),
            },
          );
          const submission =
            await wallet.resolveTransactionSubmission(operationHash);
          transactionHash = submission.transactionHash;
          userOperationHash = submission.userOperationHash;
        } else {
          if (order.escrow.approval) {
            setMessage(`${product.title}のロック入金を承認しています…`);
            await wallet.sendContractTransaction(
              order.escrow.approval.tokenContract,
              order.escrow.approval.data,
            );
            if (!current()) return;
          }
          setMessage(`${product.title}の代金を受取確認までロックしています…`);
          transactionHash =
            order.assetKind === "native"
              ? await wallet.sendContractTransactionWithValue(
                  order.escrow.contractAddress,
                  order.transferData,
                  `0x${BigInt(order.valueAtomic).toString(16)}` as `0x${string}`,
                )
              : await wallet.sendContractTransaction(
                  order.escrow.contractAddress,
                  order.transferData,
                );
        }
        uncertainReceipt = { ...uncertainReceipt, transactionHash, status: "submitted" };
        const submissionResponse = await fetch(submitUrl, {
          method: "POST",
          cache: "no-store", redirect: "error",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${order.accessToken}`,
          },
          body: JSON.stringify({ transactionHash, userOperationHash }),
        });
        const submissionBody = await submissionResponse.json() as { error?: unknown };
        if (!submissionResponse.ok) throw Error(typeof submissionBody.error === "string" ? submissionBody.error : "commerce_unavailable");
        owners.delete(operation); if (owners.size === 0) signingOrders.current.delete(submitUrl); ownedSigning.delete(submitUrl); uncertainReceipt = null;
        if (intentId) void completeIntentWhenFinal(order);
        if (sameBuyerScope()) setReceipts((current) => sameBuyerScope() ? [
          {
            id: order.id,
            productId: product.id,
            title: product.title,
            amountJpyc: order.amountJpyc,
            transactionHash,
            status: "submitted",
            fulfillmentType: product.fulfillmentType,
            createdAt: new Date().toISOString(),
          },
          ...current.filter((entry) => entry.id !== order.id),
        ] : current);
        completed.add(product.id);
        if (current()) checkoutKeys.current.delete(product.id);
      }
      if (!current()) return;
      setCart((current) =>
        current.filter((item) => !completed.has(item.productId)),
      );
      setAssertions({});
      setFulfillmentConfirmed({});
      setPreparedLines([]);
      setReviewing(false);
      setMessage(
        "すべての支払いを送信しました。確認後、販売者ごとに発送されます。",
      );
    } catch (error) {
      if (ownedSigning.size) {
        const receipt = uncertainReceipt;
        if (receipt && sameBuyerScope()) setReceipts(previous => sameBuyerScope() ? [receipt, ...previous.filter(entry => entry.id !== receipt.id)] : previous);
        if (current()) setMessage(recoveryMessage);
        return;
      }
      if (!current()) return;
      const code =
        error instanceof Error ? error.message : "commerce_unavailable";
      const known: Record<string, string> = {
        location_evidence_unavailable:
          "接続元の国を確認できないため、課税地域を確定できませんでした。ネットワーク接続を確認して、もう一度お試しください。",
        location_evidence_conflict:
          "申告した居住国と接続元の国が一致しません。VPNやプロキシを確認するか、居住国を修正してください。",
        merchant_gas_sponsorship_unavailable:
          "店舗負担のネットワーク手数料を安全に処理できないため、現在このチェーンでは支払えません。",
        invalid_fulfillment_assertion:
          "配送承認が商品・配送方法と一致しません。",
        fulfillment_assertion_already_used:
          "配送承認は使用済みです。新しく発行してください。",
        insufficient_stock: "在庫が不足しています。",
        unsupported_payment_asset:
          "選択した資産ではこの商品を購入できません。別の支払い資産を選んでください。",
        payments_not_enabled: "開発環境の決済は停止中です。",
        checkout_cancelled:
          "残りの購入を中止しました。完了済みの支払いは注文履歴で確認できます。",
      };
      setMessage(known[code] ?? `購入処理を完了できませんでした: ${code}`);
    } finally {
      if (checkoutMounted.current && checkoutFlight.current === operation) { checkoutFlight.current = null; setBusy(false); }
    }
  }

  async function completeIntentWhenFinal(order: Order) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      const orderResponse = await fetch(
        commerceApiUrl(`/orders/${encodeURIComponent(order.id)}`),
        {
          headers: { authorization: `Bearer ${order.accessToken}` },
          cache: "no-store",
        },
      );
      if (!orderResponse.ok) continue;
      const orderBody = (await orderResponse.json().catch(() => null)) as
        | { order?: { status?: string } }
        | null;
      const resultResponse = await fetch(
        commerceApiUrl(
          `/orders/${encodeURIComponent(order.id)}/intent-result`,
        ),
        {
          method: "POST",
          headers: { authorization: `Bearer ${order.accessToken}` },
          cache: "no-store",
        },
      );
      const resultBody = (await resultResponse.json().catch(() => null)) as
        | { proof?: string }
        | null;
      if (resultResponse.status === 409) {
        if (
          ["cancelled", "refunded", "expired", "payment_failed"].includes(
            orderBody?.order?.status ?? "",
          )
        )
          return;
        continue;
      }
      if (!resultResponse.ok || !resultBody?.proof) return;
      const accepted = await fetch("/api/core/intents/owner-result", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proof: resultBody.proof }),
      });
      if (accepted.ok)
        window.dispatchEvent(new CustomEvent("hub:intent-updated"));
      return;
    }
  }

  async function refreshOrder(receipt: Receipt, silent = false) {
    const token = readOrderAccessToken(receipt.id);
    if (!token)
      return silent
        ? undefined
        : setMessage(
            "この注文の確認用トークンはセッション終了後に破棄されました。注文IDを控えて販売者へお問い合わせください。",
          );
    try {
      const body = await commerce(`/orders/${receipt.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const order = body.order as Order;
      const exception = body.paymentException as
        | { exceptionType?: string; status?: string }
        | null
        | undefined;
      const escrow = body.physicalEscrow as
        | { state?: string; shipBy?: string; releaseAt?: string }
        | null
        | undefined;
      setReceipts((current) =>
        current.map((entry) =>
          entry.id === receipt.id
            ? {
                ...entry,
                status: order.status,
                fulfillmentType: order.fulfillmentType ?? entry.fulfillmentType,
                fulfillmentStatus: order.fulfillmentStatus,
                shippingCarrier: order.shippingCarrier,
                trackingNumber: order.trackingNumber,
                returnStatus: order.returnStatus,
                expiresAt: order.expiresAt ?? entry.expiresAt,
                returnShippingCarrier: order.returnShippingCarrier,
                returnTrackingNumber: order.returnTrackingNumber,
                paymentException:
                  exception?.status === "open"
                    ? {
                        exceptionType:
                          exception.exceptionType === "overpaid"
                            ? "overpaid"
                            : "underpaid",
                      }
                    : null,
                escrow:
                  escrow?.state && escrow.shipBy && escrow.releaseAt
                    ? {
                        state: escrow.state,
                        shipBy: escrow.shipBy,
                        releaseAt: escrow.releaseAt,
                      }
                    : entry.escrow ?? null,
              }
            : entry,
        ),
      );
      if (!silent) setMessage("注文状態を更新しました。");
    } catch (error) {
      if (!silent)
        setMessage(
          `注文状態を更新できませんでした: ${error instanceof Error ? error.message : "unknown"}`,
        );
    }
  }
  async function requestReturn(receipt: Receipt) {
    const token = readOrderAccessToken(receipt.id);
    if (!token)
      return setMessage("返品申請用トークンの有効なセッションがありません。");
    const detail = window.prompt("返品理由を入力してください");
    if (!detail) return;
    try {
      await commerce(`/orders/${receipt.id}/returns`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reasonCode: "other", detail }),
      });
      setReceipts((current) =>
        current.map((entry) =>
          entry.id === receipt.id
            ? { ...entry, returnStatus: "requested" }
            : entry,
        ),
      );
      setMessage("返品申請を受け付けました。");
    } catch (error) {
      setMessage(
        `返品申請を送信できませんでした: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  async function cancelReceipt(receipt: Receipt) {
    const token = readOrderAccessToken(receipt.id);
    if (!token)
      return setMessage(
        "注文を取り消すための有効なセッションがありません。注文IDを控えて販売者へお問い合わせください。",
      );
    if (!window.confirm(`「${receipt.title}」の未払い注文を取り消しますか？`))
      return;
    try {
      await commerce(`/orders/${receipt.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      setReceipts((current) =>
        current.map((entry) =>
          entry.id === receipt.id ? { ...entry, status: "cancelled" } : entry,
        ),
      );
      setMessage("注文を取り消しました。");
    } catch (error) {
      setMessage(
        `注文を取り消せませんでした: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  function updateReturnTrackingDraft(
    receiptId: string,
    field: "shippingCarrier" | "trackingNumber",
    value: string,
  ) {
    setReturnTrackingDrafts((current) => ({
      ...current,
      [receiptId]: {
        shippingCarrier: current[receiptId]?.shippingCarrier ?? "",
        trackingNumber: current[receiptId]?.trackingNumber ?? "",
        [field]: value,
      },
    }));
    setReturnTrackingPreviews((current) => {
      const next = { ...current };
      delete next[receiptId];
      return next;
    });
  }
  function previewReturnTracking(receipt: Receipt) {
    const draft = returnTrackingDrafts[receipt.id];
    const shippingCarrier = draft?.shippingCarrier.trim() ?? "";
    const trackingNumber = draft?.trackingNumber.trim() ?? "";
    if (!shippingCarrier || !trackingNumber)
      return setMessage("配送会社と追跡番号を入力してください。");
    setReturnTrackingPreviews((current) => ({
      ...current,
      [receipt.id]: { shippingCarrier, trackingNumber },
    }));
    setMessage("返送情報を確認し、内容が正しい場合だけ登録してください。");
  }
  async function submitReturnTracking(
    receipt: Receipt,
    confirmed: { shippingCarrier: string; trackingNumber: string },
  ) {
    const token = readOrderAccessToken(receipt.id);
    if (!token)
      return setMessage("返品配送登録用トークンの有効なセッションがありません。");
    const draft = returnTrackingDrafts[receipt.id];
    const shippingCarrier = draft?.shippingCarrier.trim() ?? "";
    const trackingNumber = draft?.trackingNumber.trim() ?? "";
    if (
      shippingCarrier !== confirmed.shippingCarrier ||
      trackingNumber !== confirmed.trackingNumber
    ) {
      setReturnTrackingPreviews((current) => {
        const next = { ...current };
        delete next[receipt.id];
        return next;
      });
      return setMessage("入力内容が変わりました。もう一度確認してください。");
    }
    setBusy(true);
    try {
      const body = await commerce(`/orders/${receipt.id}/returns/shipment`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ shippingCarrier, trackingNumber }),
      });
      const returnShipment = body.returnShipment as
        | {
            shippingCarrier?: string;
            trackingNumber?: string;
            status?: string;
          }
        | undefined;
      setReceipts((current) =>
        current.map((entry) =>
          entry.id === receipt.id
            ? {
                ...entry,
                returnShippingCarrier:
                  returnShipment?.shippingCarrier ?? shippingCarrier,
                returnTrackingNumber:
                  returnShipment?.trackingNumber ?? trackingNumber,
                returnStatus: returnShipment?.status ?? "in_transit",
              }
            : entry,
        ),
      );
      setMessage("返品配送情報を登録しました。");
    } catch (error) {
      setMessage(
        `返品配送情報を登録できませんでした: ${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function downloadReceipt(receipt: Receipt) {
    const token = readOrderAccessToken(receipt.id);
    if (!token)
      return setMessage(
        "領収書を取得するための有効な注文セッションがありません。",
      );
    try {
      const body = await commerce(`/orders/${receipt.id}/receipt`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const blob = new Blob([JSON.stringify(body.receipt, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hub-receipt-${receipt.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Commerce発行の領収書を保存しました。");
    } catch (error) {
      setMessage(
        `領収書を取得できませんでした: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  const inCart = (productId: string) =>
    cart.some((item) => item.productId === productId);
  /*
   * 商品の札（2026-10-18 作り直し）。Booth の格子に寄せ、絵・名前・店・価格（税込）・送料と在庫だけを置く。
   * 絵と名前は商品ページへ。説明と販売条件・返品は商品ページで読む。
   */
  const productCard = (product: Product) => {
    const stock = product.stockQuantity ?? 0;
    const price = productPriceLabels(product);
    const href = hubSurfacePath(surface, `/market/products/${encodeURIComponent(product.id)}`);
    return (
      <article className="digital-commerce__card physical-product-card" key={product.id}>
        <a className="physical-product-card__media" href={href} aria-label={`${product.title}の商品ページ`} tabIndex={-1}>
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="digital-commerce__placeholder" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="32" height="32"><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V7a3 3 0 0 1 6 0v1" /></svg>
          </div>
        )}
        </a>
        <div>
          <h2><a href={href}>{product.title}</a></h2>
          <button
            type="button"
            className="physical-seller-link"
            title="この販売者の商品だけ表示"
            onClick={() =>
              setSellerFilter({
                id: product.seller.id,
                name: product.seller.publicName,
              })
            }
          >
            {product.seller.publicName}
          </button>
          <strong className="physical-product-card__price">
            {price.main}<span>{price.mainSuffix}</span>
          </strong>
          <small className="physical-product-card__base">{price.note}</small>
          <small className="physical-product-card__sub">
            <span>{productShippingLabel(product)}</span>
            <span data-low={stock <= 3 ? "" : undefined}>{productStockLabel(product)}</span>
          </small>
          <button
            type="button"
            disabled={inCart(product.id)}
            onClick={() => add(product.id)}
          >
            {inCart(product.id) ? "カートに入っています" : "カートに入れる"}
          </button>
        </div>
      </article>
    );
  };
  return (
    <section className="digital-commerce physical-commerce">
      <header className="digital-commerce__header">
        <div>
          <h1>
            {view === "cart"
              ? "カート"
              : view === "products"
                ? "商品"
                : "注文・返品"}
          </h1>
          <span>
            {view === "cart"
              ? "商品と合計を確認してから支払いへ進みます。"
              : view === "products"
                ? "販売中の商品を探してカートに入れます。"
                : "購入履歴、配送状況、領収書、返品申請を確認します。"}
          </span>
        </div>
        <a href={hubSurfacePath(surface, view === "cart" ? "/market/products" : "/market/cart")}>
          {view === "cart" ? "買い物を続ける" : "カートを見る"}
        </a>
      </header>
      {view === "cart" && catalogState === "ready" && lines.length ? (
        <ol className="physical-cart-steps" aria-label="購入手順">
          <li aria-current={!reviewing ? "step" : undefined}>カート</li>
          <li aria-current={reviewing ? "step" : undefined}>支払い</li>
        </ol>
      ) : null}
      {message ? (
        <p
          className="digital-commerce__status"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      <div hidden={view !== "cart"}>
        {catalogState === "loading" ? (
          <section className="physical-cart-layout" data-empty>
            <div className="physical-cart-lines">
              <div className="physical-cart-empty" role="status">
                <strong>カートを読み込んでいます</strong>
              </div>
            </div>
          </section>
        ) : catalogState === "error" ? (
          <section className="physical-cart-layout" data-empty>
            <div className="physical-cart-lines">
              <div className="physical-cart-empty" role="status">
                <strong>カートを読み込めませんでした</strong>
                <p>{catalogError || "接続を確認して、もう一度お試しください。"}</p>
                <button
                  type="button"
                  onClick={() => setCatalogRetryKey((key) => key + 1)}
                >
                  もう一度試す
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section
            className="physical-cart-layout"
            data-empty={!lines.length || undefined}
          >
            <div className="physical-cart-lines">
              <h2>商品 {lines.length}件</h2>
              {lines.length ? (
                lines.map(({ product, item }) => (
                  <article key={product.id}>
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="physical-cart-thumb" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V7a3 3 0 0 1 6 0v1" /></svg></div>
                    )}
                    <section>
                      <small>
                        <button
                          type="button"
                          className="physical-seller-link"
                          onClick={() =>
                            setSellerFilter({
                              id: product.seller.id,
                              name: product.seller.publicName,
                            })
                          }
                        >
                          {product.seller.publicName}
                        </button>
                      </small>
                      <h3>
                        <a href={hubSurfacePath(surface, `/market/products/${encodeURIComponent(product.id)}`)}>{product.title}</a>
                      </h3>
                      <strong>
                        {productPriceLabels(product).main}
                        <span>{productPriceLabels(product).mainSuffix}</span>
                      </strong>
                      <small className="physical-cart-line__base">{productPriceLabels(product).note}</small>
                      <small>{productShippingLabel(product)}</small>
                      <label>
                        数量
                        <input
                          type="number"
                          min={1}
                          max={Math.min(20, product.stockQuantity ?? 20)}
                          value={item.quantity}
                          onChange={(event) =>
                            quantity(product.id, Number(event.target.value))
                          }
                        />
                      </label>
                      <div className="physical-cart-fulfillment">
                        <span>配送先</span>
                        {assertions[product.id] ? (
                          <p
                            className="physical-cart-fulfillment__confirmed"
                            role="status"
                          >
                            Identityで確認済み
                            {fulfillmentConfirmed[product.id]
                              ? `（${fulfillmentConfirmed[product.id]}宛）`
                              : ""}
                            。氏名・住所はHubに保存されません。
                            <button
                              type="button"
                              className="physical-cart-fulfillment__refresh"
                              disabled={confirmingProduct === product.id}
                              onClick={() => void confirmFulfillment(product)}
                            >
                              再確認
                            </button>
                          </p>
                        ) : (
                          <>
                            <p>
                              Identityで配送先を安全に確認します。氏名・住所はHubに保存されません。
                            </p>
                            <button
                              type="button"
                              className="physical-cart-fulfillment__action"
                              disabled={
                                busy || confirmingProduct === product.id
                              }
                              onClick={() => void confirmFulfillment(product)}
                            >
                              {confirmingProduct === product.id
                                ? "確認中…"
                                : "配送先を確認"}
                            </button>
                          </>
                        )}
                      </div>
                      <div>
                        <a
                          href={product.seller.legalDisplayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          販売条件・返品
                        </a>
                        <button
                          type="button"
                          onClick={() => remove(product.id)}
                        >
                          削除
                        </button>
                      </div>
                    </section>
                  </article>
                ))
              ) : (
                <div className="physical-cart-empty">
                  <strong>カートは空です</strong>
                  <p>商品を追加すると、ここで合計と配送方法を確認できます。</p>
                  <a href={hubSurfacePath(surface, "/market/products")}>商品を探す</a>
                </div>
              )}
            </div>
            {lines.length ? (
              <aside
                className="physical-cart-summary"
                data-reviewing={reviewing || undefined}
              >
                <h2>注文内容</h2>
                <label>
                  請求先国
                  <input
                    aria-label="通常居住する国（2文字の国コード）"
                    value={country}
                    maxLength={2}
                    onChange={(event) => {
                      resetReview();
                      setCountry(event.target.value.toUpperCase());
                    }}
                  />
                </label>
                <p className="physical-cart-summary__tax-note">
                  通常居住する国を2文字の国コードで入力してください（例：JP）。Commerceが接続元の国と照合し、課税地域だけを確定します。Hubには氏名、住所、生のIPアドレスを保存しません。
                </p>
                <label>
                  支払い資産
                  <select
                    aria-label="支払いに使う資産"
                    value={assetKey}
                    onChange={(event) => {
                      resetReview();
                      setAssetKey(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    {paymentAssets.map((asset) => (
                      <option
                        key={`${asset.chainId}:${asset.currency}`}
                        value={`${asset.chainId}:${asset.currency}`}
                      >
                        {asset.currency}（{asset.chainName}）
                      </option>
                    ))}
                  </select>
                </label>
                <dl>
                  <div>
                    <dt>
                      {shippingPending ? "商品・確認済み送料" : "商品・送料"}
                      {estimateTaxIncluded ? "（税込・目安）" : "（目安）"}
                    </dt>
                    <dd>
                      {knownEstimate.toLocaleString()} JPYC
                      {shippingPending ? " ＋ 未確定送料（注文時に確認）" : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>税</dt>
                    <dd>{estimateTaxIncluded ? "目安に含む。確定額は注文時にCommerceが表示" : "注文確定前に計算"}</dd>
                  </div>
                  <div>
                    <dt>Hub手数料</dt>
                    <dd>販売者負担・本体価格の1%（消費税込み）</dd>
                  </div>
                  <div>
                    <dt>ネットワーク手数料</dt>
                    <dd>商品条件に従い販売者または購入者が負担</dd>
                  </div>
                </dl>
                {reviewing ? (
                  <section className="physical-cart-review" role="status">
                    <strong>支払い前の確認</strong>
                    <p>
                      以下はCommerceが確定した支払内容です。次の操作で初めてウォレット署名へ進みます。
                    </p>
                    {preparedLines.map(
                      ({ product, item, order, maximumGasAtomic }) => (
                        <dl
                          className="physical-cart-review__quote"
                          key={order.id}
                        >
                          <div>
                            <dt>販売者</dt>
                            <dd>{product.seller.publicName}</dd>
                          </div>
                          <div>
                            <dt>商品</dt>
                            <dd>
                              {product.title} × {item.quantity}
                            </dd>
                          </div>
                          <div>
                            <dt>合計</dt>
                            <dd>{order.amountJpyc.toLocaleString()} JPYC</dd>
                          </div>
                          <div>
                            <dt>課税地域</dt>
                            <dd>{order.taxCountry}</dd>
                          </div>
                          <div>
                            <dt>税額</dt>
                            <dd>
                              {order.taxJpyc.toLocaleString()} JPYC（
                              {(order.taxRateBps / 100).toLocaleString()}%）
                            </dd>
                          </div>
                          <div>
                            <dt>Hub手数料</dt>
                            <dd>
                              {order.moneyFlow.hubFeeJpyc.toLocaleString()}{" "}
                              JPYC（販売者負担）
                            </dd>
                          </div>
                          <div>
                            <dt>支払額</dt>
                            <dd>
                              {order.paymentAmount} {order.currency}（
                              {order.chainName}）
                            </dd>
                          </div>
                          <div>
                            <dt>購入者の最大ガス見積</dt>
                            <dd>
                              {order.gasPayer === "merchant"
                                ? "0（販売者負担）"
                                : `${formatNativeAtomic(maximumGasAtomic)} ${nativeSymbol(order.chainId)}`}
                            </dd>
                          </div>
                        </dl>
                      ),
                    )}
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={resetReview}
                    >
                      内容を変更
                    </button>
                  </section>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !lines.length || !paymentsEnabled}
                  onClick={() => {
                    void checkout();
                  }}
                >
                  {busy
                    ? "処理中…"
                    : !paymentsEnabled
                      ? "決済メンテナンス中"
                      : reviewing
                        ? "ウォレットで確認して支払う"
                        : "確定金額を確認"}
                </button>
                <small>Hubは配送先住所、秘密鍵、資金を保持しません。</small>
              </aside>
            ) : null}
          </section>
        )}
      </div>
      {receipts.length ? (
        <section className="physical-order-history">
          <div className="physical-catalog__tools">
            <h2>注文履歴</h2>
            {(
              [
                ["all", "すべて"],
                ["attention", "要対応"],
                ["open", "進行中"],
                ["done", "完了・終了"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={receiptFilter === key}
                onClick={() => setReceiptFilter(key)}
              >
                {label}
              </button>
            ))}
            <input
              type="search"
              maxLength={100}
              placeholder="商品名・注文ID・TXで検索"
              aria-label="注文履歴を検索"
              value={receiptSearch}
              onChange={(event) => setReceiptSearch(event.target.value)}
            />
            <button type="button" onClick={exportReceiptCsv}>CSV出力</button>
          </div>
          {visibleReceipts.length ? visibleReceipts.map((receipt) => (
            <article key={receipt.id}>
              <div>
                <a href={hubSurfacePath(surface, `/market/orders/${receipt.id}`)}>
                  <strong>{receipt.title}</strong>
                </a>
                <small>
                  {new Intl.DateTimeFormat("ja-JP", {
                    dateStyle: "medium",
                  }).format(new Date(receipt.createdAt))}
                  ・{receipt.id}
                </small>
              </div>
              <span>{receipt.amountJpyc.toLocaleString()} JPYC</span>
              <p>
                支払い：{paymentStatusLabel(receipt.status)}
                {receipt.status === "awaiting_payment" && receipt.expiresAt
                  ? `（期限 ${new Date(receipt.expiresAt).toLocaleString("ja-JP")}）`
                  : ""}
                {receipt.fulfillmentType === "digital"
                  ? "・デジタル商品"
                  : receipt.fulfillmentType === "pickup"
                    ? "・店頭受取"
                    : ""}
              </p>
              {receipt.paymentException ? (
                <p role="alert">
                  {receipt.paymentException.exceptionType === "underpaid"
                    ? "支払い額が不足しています。詳細を開いて不足分を送金してください。"
                    : "支払い額が超過しています。詳細を開いて状況を確認してください。"}
                </p>
              ) : null}
              {receipt.escrow ? (
                <p>
                  資金ロック：{escrowStateLabel(receipt.escrow.state)}
                  {receipt.escrow.state === "funded" &&
                  receipt.escrow.shipBy
                    ? `・発送期限 ${new Date(receipt.escrow.shipBy).toLocaleDateString("ja-JP")}`
                    : receipt.escrow.state === "shipped" &&
                        receipt.escrow.releaseAt
                      ? `・受取期限 ${new Date(receipt.escrow.releaseAt).toLocaleDateString("ja-JP")}`
                      : ""}
                </p>
              ) : null}
              <p>
                配送：{fulfillmentStatusLabel(receipt.fulfillmentStatus)}
                {receipt.shippingCarrier ? `・${receipt.shippingCarrier}` : ""}
                {receipt.trackingNumber ? `・${receipt.trackingNumber}` : ""}
              </p>
              {returnStatusLabel(receipt.returnStatus) ? (
                <p>返品：{returnStatusLabel(receipt.returnStatus)}</p>
              ) : null}
              {receipt.returnShippingCarrier || receipt.returnTrackingNumber ? (
                <p>
                  返品配送：{receipt.returnShippingCarrier ?? "配送会社未登録"}
                  {receipt.returnTrackingNumber
                    ? `・${receipt.returnTrackingNumber}`
                    : ""}
                </p>
              ) : null}
              {receipt.returnStatus === "approved" &&
              !receipt.returnTrackingNumber ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    previewReturnTracking(receipt);
                  }}
                >
                  <fieldset disabled={busy}>
                    <legend>返品承認済み：返送情報を登録</legend>
                    <label>
                      配送会社
                      <input
                        value={returnTrackingDrafts[receipt.id]?.shippingCarrier ?? ""}
                        onChange={(event) =>
                          updateReturnTrackingDraft(
                            receipt.id,
                            "shippingCarrier",
                            event.target.value,
                          )
                        }
                        placeholder="例：ヤマト運輸"
                        autoComplete="organization"
                      />
                    </label>
                    <label>
                      追跡番号
                      <input
                        value={returnTrackingDrafts[receipt.id]?.trackingNumber ?? ""}
                        onChange={(event) =>
                          updateReturnTrackingDraft(
                            receipt.id,
                            "trackingNumber",
                            event.target.value,
                          )
                        }
                        placeholder="実際の追跡番号"
                        autoComplete="off"
                      />
                    </label>
                    <button type="submit">入力内容を確認</button>
                  </fieldset>
                </form>
              ) : null}
              {returnTrackingPreviews[receipt.id] ? (
                <section role="alert" aria-label="返送情報の確認">
                  <strong>登録する返送情報</strong>
                  <dl>
                    <div>
                      <dt>配送会社</dt>
                      <dd>{returnTrackingPreviews[receipt.id].shippingCarrier}</dd>
                    </div>
                    <div>
                      <dt>追跡番号</dt>
                      <dd>{returnTrackingPreviews[receipt.id].trackingNumber}</dd>
                    </div>
                  </dl>
                  <p>登録後に別の内容へ変更する場合はサポート確認が必要です。</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void submitReturnTracking(
                        receipt,
                        returnTrackingPreviews[receipt.id],
                      )
                    }
                  >
                    この返送情報を登録
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setReturnTrackingPreviews((current) => {
                        const next = { ...current };
                        delete next[receipt.id];
                        return next;
                      })
                    }
                  >
                    入力に戻る
                  </button>
                </section>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void refreshOrder(receipt);
                }}
              >
                更新
              </button>
              {["paid", "partially_refunded", "refunded"].includes(
                receipt.status,
              ) ? (
                <button
                  type="button"
                  onClick={() => {
                    void downloadReceipt(receipt);
                  }}
                >
                  領収書
                </button>
              ) : null}
              {receipt.status === "paid" && !receipt.returnStatus ? (
                <button
                  type="button"
                  onClick={() => {
                    void requestReturn(receipt);
                  }}
                >
                  返品申請
                </button>
              ) : null}
              {receipt.status === "awaiting_payment" ? (
                <button
                  type="button"
                  onClick={() => {
                    void cancelReceipt(receipt);
                  }}
                >
                  注文を取り消す
                </button>
              ) : null}
            </article>
          )) : (
            <div className="physical-cart-empty">
              <strong>
                {receiptFilter === "attention"
                  ? "対応が必要な注文はありません"
                  : receiptFilter === "open"
                    ? "進行中の注文はありません"
                    : "完了・終了した注文はありません"}
              </strong>
            </div>
          )}
        </section>
      ) : view === "orders" ? (
        <section className="physical-order-history physical-cart-empty">
          <strong>注文履歴はありません</strong>
          <p>購入が完了すると、配送状況や返品申請をここで確認できます。</p>
          <a href={hubSurfacePath(surface, "/market/products")}>商品を探す</a>
        </section>
      ) : null}
      {view === "products" ? (
        <section className="physical-catalog">
          <div className="physical-catalog__tools">
            <input
              type="search"
              value={catalogQuery}
              placeholder="商品名・説明で検索"
              aria-label="商品を検索"
              onChange={(event) => setCatalogQuery(event.target.value)}
            />
            {sellerFilter ? (
              <button type="button" onClick={() => setSellerFilter(null)}>
                {sellerFilter.name
                  ? `${sellerFilter.name}の商品 · 解除`
                  : "この販売者の商品 · 解除"}
              </button>
            ) : null}
            {catalogListState === "ready" && catalogResults.length ? (
              <span className="physical-catalog__count" aria-live="polite">
                {catalogResults.length.toLocaleString()}件{catalogNextCursor ? "以上" : ""}
              </span>
            ) : null}
          </div>
          <div className="physical-catalog__filters" role="group" aria-label="並べ替えと絞り込み">
            <label>
              並べ替え
              <select
                value={catalogSort}
                onChange={(event) => setCatalogSort(event.target.value as ProductSort)}
              >
                {PRODUCT_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-pressed={catalogInStock}
              onClick={() => setCatalogInStock((value) => !value)}
            >
              在庫あり
            </button>
            <button
              type="button"
              aria-pressed={catalogFreeShipping}
              onClick={() => setCatalogFreeShipping((value) => !value)}
            >
              送料無料
            </button>
          </div>
          {catalogListState === "loading" ? (
            <SkeletonList kind="tile" count={8} label="商品を読み込んでいます" />
          ) : catalogListState === "error" ? (
            <div className="physical-cart-empty" role="status">
              <strong>商品を読み込めませんでした</strong>
              <p>接続を確認して、もう一度お試しください。</p>
              <button
                type="button"
                onClick={() => setCatalogRetryKey((key) => key + 1)}
              >
                もう一度試す
              </button>
            </div>
          ) : catalogResults.length ? (
            <>
              <div className="digital-commerce__grid">
                {catalogResults.map(productCard)}
              </div>
              {catalogNextCursor ? (
                <button
                  type="button"
                  disabled={catalogLoadingMore}
                  onClick={() => void loadMoreCatalog()}
                >
                  {catalogLoadingMore ? "読み込み中…" : "さらに表示"}
                </button>
              ) : null}
            </>
          ) : (
            <div className="physical-cart-empty">
              <strong>
                {catalogQuery.trim() || sellerFilter || catalogInStock || catalogFreeShipping
                  ? "条件に合う商品はありません"
                  : "販売中の商品はまだありません"}
              </strong>
              <p>
                {catalogQuery.trim() || sellerFilter || catalogInStock || catalogFreeShipping
                  ? "検索条件やフィルターを変えてみてください。"
                  : "販売者が商品を公開するとここに並びます。"}
              </p>
            </div>
          )}
        </section>
      ) : null}
      {view === "cart" && catalogState === "ready" &&
      products.some(
        (product) =>
          !cart.some((item) => item.productId === product.id) &&
          (!sellerFilter || product.seller.id === sellerFilter.id),
      ) ? (
        <section className="physical-cart-recommendations">
          <header>
            <h2>
              {sellerFilter ? `${sellerFilter.name}の商品` : "おすすめ商品"}
            </h2>
            {sellerFilter ? (
              <button
                type="button"
                onClick={() => setSellerFilter(null)}
              >
                フィルターを解除
              </button>
            ) : (
              <a href={hubSurfacePath(surface, "/market/products")}>
                すべて見る
              </a>
            )}
          </header>
          <div className="digital-commerce__grid">
            {products
              .filter(
                (product) =>
                  !inCart(product.id) &&
                  (!sellerFilter || product.seller.id === sellerFilter.id),
              )
              .map(productCard)}
          </div>
        </section>
      ) : null}
    </section>
  );
}
