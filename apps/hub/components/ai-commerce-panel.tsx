"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  Search,
  ShieldCheck,
  ShoppingBag,
  X,
} from "lucide-react";

import { useHubWallet } from "@/components/hub-wallet-provider";
import {
  agentCommercePolicyFailure,
  candidateTotalJpyc,
  DEFAULT_AGENT_COMMERCE_POLICY,
  INITIAL_AGENT_COMMERCE_STATE,
  reduceAgentCommerce,
  type AgentCommerceCandidate,
} from "@/lib/agent-commerce";
import { commerceRequest } from "@/lib/commerce-client";
import {
  buildBasicProductValueProfile,
  type ProductValueProfile,
} from "@/lib/product-value-model";

type Product = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  priceJpyc: number;
  shippingJpyc: number | null;
  stockQuantity: number | null;
  fulfillmentType: string;
  seller: { publicName: string; legalDisplayUrl: string };
  valueProfile?: ProductValueProfile;
};

type Order = {
  id: string;
  productId: string;
  quantity: number;
  subtotalJpyc: number;
  shippingJpyc: number;
  taxJpyc: number;
  taxRateBps: number;
  taxCountry: string;
  taxLiabilityParty: "seller" | "platform";
  amountJpyc: number;
  chainId: number;
  assetKind: "native" | "erc20";
  paymentDestination: string;
  transferData: `0x${string}`;
  valueAtomic: string;
  accessToken: string;
  expiresAt: string;
  payment: {
    contractAddress: string;
    approval: { tokenContract: string; data: `0x${string}` } | null;
  } | null;
};

type OrderTracking = {
  status: string;
  updatedAt?: string | null;
  paidAt?: string | null;
  fulfillmentStatus?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
};

type Receipt = {
  orderId: string;
  status: string;
  seller: string;
  product: string;
  quantity: number;
  amountJpyc: number;
  currency: string;
  transactionHash: string | null;
  paidAt: string | null;
};

const COPY: Record<string, string> = {
  invalid_quantity: "数量を1〜20の範囲で指定してください。",
  insufficient_stock: "選択した数量の在庫がありません。",
  purchase_limit_exceeded: "設定した1回の購入上限を超えています。",
  invalid_fulfillment_assertion: "配送先の確認情報が商品条件と一致しません。",
  fulfillment_assertion_already_used: "配送先の確認情報は使用済みです。",
  payments_not_enabled: "現在、この商品の決済は利用できません。",
  wallet_not_connected: "支払いに使うウォレットを接続してください。",
  commerce_unavailable: "Commerceへ接続できません。時間を置いて再試行してください。",
};

function asCandidate(product: Product): AgentCommerceCandidate {
  const physical = ["seller_shipping", "platform_3pl"].includes(
    product.fulfillmentType,
  );
  return {
    id: product.id,
    title: product.title,
    seller: product.seller.publicName,
    priceJpyc: product.priceJpyc,
    shippingJpyc: physical ? product.shippingJpyc ?? 0 : 0,
    stockQuantity: product.stockQuantity,
    fulfillmentType: product.fulfillmentType,
  };
}

function relevance(product: Product, query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  if (!terms.length) return 0;
  const title = product.title.toLocaleLowerCase();
  const body =
    `${product.description} ${product.seller.publicName}`.toLocaleLowerCase();
  return terms.reduce(
    (score, term) =>
      score + (title.includes(term) ? 8 : 0) + (body.includes(term) ? 3 : 0),
    0,
  );
}

async function commerce<T>(path: string, init?: RequestInit) {
  return commerceRequest<T>(path, init);
}

export function AiCommercePanel({
  initialQuery = "",
  onClose,
}: {
  initialQuery?: string;
  onClose: () => void;
}) {
  const wallet = useHubWallet();
  const dialogRef = useRef<HTMLElement>(null);
  const [state, dispatch] = useReducer(reduceAgentCommerce, {
    ...INITIAL_AGENT_COMMERCE_STATE,
    query: initialQuery,
    stage: initialQuery.trim() ? "compare" : "discover",
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [country, setCountry] = useState("JP");
  const [fulfillmentAssertion, setFulfillmentAssertion] = useState("");
  const [maximumPerPurchaseJpyc, setMaximumPerPurchaseJpyc] = useState(
    DEFAULT_AGENT_COMMERCE_POLICY.maximumPerPurchaseJpyc,
  );
  const [order, setOrder] = useState<Order | null>(null);
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("購入可能な商品を確認しています。");

  useEffect(() => {
    commerce<{ products?: Product[] }>("/products")
      .then((body) => {
        const available = (body.products ?? []).filter(
          (product) =>
            product.fulfillmentType !== "pickup" &&
            (product.stockQuantity === null || product.stockQuantity > 0),
        );
        setProducts(available);
        setMessage(
          available.length
            ? "候補を比較してから、Commerceの確定見積へ進みます。"
            : "現在購入できる商品はありません。",
        );
      })
      .catch(() => {
        dispatch({ type: "failed", error: "commerce_unavailable" });
        setMessage(COPY.commerce_unavailable);
      });
  }, []);

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    if (state.stage !== "submitted" || !order) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const authorization = { authorization: `Bearer ${order.accessToken}` };
    const poll = async () => {
      try {
        const body = await commerce<{ order: OrderTracking }>(
          `/orders/${order.id}`,
          { headers: authorization },
        );
        if (stopped) return;
        setTracking(body.order);
        if (["paid", "partially_refunded", "refunded"].includes(body.order.status)) {
          const receiptBody = await commerce<{ receipt: Receipt }>(
            `/orders/${order.id}/receipt`,
            { headers: authorization },
          );
          if (!stopped) {
            setReceipt(receiptBody.receipt);
            setMessage("決済が確定しました。領収書を確認できます。");
          }
          return;
        }
        if (["failed", "cancelled", "expired"].includes(body.order.status)) {
          setMessage("注文は確定しませんでした。状態を確認して再試行してください。");
          return;
        }
        timer = setTimeout(poll, 3_000);
      } catch {
        if (!stopped) {
          setMessage("注文状態を取得できません。決済を再送せず、しばらくして更新してください。");
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [order, state.stage]);

  const matches = useMemo(
    () =>
      products
        .map((product) => ({ product, score: relevance(product, state.query) }))
        .filter(({ score }) => !state.query.trim() || score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.product.priceJpyc - right.product.priceJpyc,
        ),
    [products, state.query],
  );
  const selected =
    products.find((product) => product.id === state.selectedProductId) ?? null;
  const candidate = selected ? asCandidate(selected) : null;
  const valueProfile = selected
    ? selected.valueProfile ?? buildBasicProductValueProfile({
        description: selected.description,
        price: selected.priceJpyc,
        currency: "JPYC",
        delivery: ["seller_shipping", "platform_3pl"].includes(selected.fulfillmentType)
          ? "配送条件は確定見積もりで確認"
          : "デジタル提供",
        stock: selected.stockQuantity,
        seller: selected.seller.publicName,
      })
    : null;
  const physical = candidate
    ? ["seller_shipping", "platform_3pl"].includes(candidate.fulfillmentType)
    : false;
  const estimate = candidate
    ? candidateTotalJpyc(candidate, state.quantity)
    : 0;
  const policyFailure = candidate
    ? agentCommercePolicyFailure(candidate, state.quantity, {
        maximumPerPurchaseJpyc,
        requireConfirmation: true,
      })
    : null;

  async function createQuote() {
    if (!selected || !candidate) return;
    if (policyFailure) {
      setMessage(COPY[policyFailure] ?? policyFailure);
      return;
    }
    const billingCountry = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/u.test(billingCountry)) {
      setMessage("請求国を2文字の国コードで入力してください。");
      return;
    }
    if (physical && !fulfillmentAssertion.trim()) {
      setMessage("実物商品にはIdentityが発行した配送先確認情報が必要です。");
      return;
    }
    setBusy(true);
    try {
      const connected = wallet.address ? true : await wallet.connect();
      if (!connected || !wallet.address) throw new Error("wallet_not_connected");
      const body = await commerce<{ order: Order }>("/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          quantity: state.quantity,
          buyerWallet: wallet.address,
          billingCountry,
          customerType: "consumer",
          fulfillmentAssertion: physical
            ? fulfillmentAssertion.trim()
            : undefined,
        }),
      });
      if (
        body.order.amountJpyc > maximumPerPurchaseJpyc ||
        body.order.productId !== selected.id ||
        body.order.quantity !== state.quantity
      ) {
        throw new Error("quote_policy_mismatch");
      }
      setOrder(body.order);
      dispatch({ type: "quote_created", quoteId: body.order.id });
      setMessage("確定見積を取得しました。まだ支払いは行われていません。");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "commerce_unavailable";
      dispatch({ type: "failed", error: code });
      setMessage(
        code === "quote_policy_mismatch"
          ? "見積が選択内容または購入上限と一致しないため停止しました。"
          : COPY[code] ?? `見積を作成できませんでした: ${code}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function authorizePayment() {
    if (!order || !selected) return;
    if (
      order.amountJpyc > maximumPerPurchaseJpyc ||
      order.productId !== selected.id ||
      order.quantity !== state.quantity ||
      new Date(order.expiresAt).getTime() <= Date.now()
    ) {
      setMessage("見積が期限切れ、または現在の選択内容と一致しません。");
      return;
    }
    setBusy(true);
    dispatch({ type: "authorization_started" });
    try {
      await wallet.switchChain(order.chainId);
      const calls =
        order.assetKind === "native"
          ? [
              {
                to: order.paymentDestination,
                data: order.transferData,
                value: `0x${BigInt(order.valueAtomic).toString(16)}` as `0x${string}`,
              },
            ]
          : [
              ...(order.payment?.approval
                ? [
                    {
                      to: order.payment.approval.tokenContract,
                      data: order.payment.approval.data,
                      value: "0x0" as `0x${string}`,
                    },
                  ]
                : []),
              {
                to: order.paymentDestination,
                data: order.transferData,
                value: "0x0" as `0x${string}`,
              },
            ];
      const transactionHash =
        await wallet.sendBatchContractTransactions(calls);
      await commerce(`/orders/${order.id}/submit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${order.accessToken}`,
        },
        body: JSON.stringify({ transactionHash }),
      });
      dispatch({ type: "submitted", transactionHash });
      setMessage(
        "送信を受け付けました。Commerceがオンチェーン確認後に注文と配送状態を更新します。",
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "payment_failed";
      dispatch({ type: "failed", error: code });
      setMessage(`支払いを完了できませんでした: ${code}`);
    } finally {
      setBusy(false);
    }
  }

  const restart = () => {
    setOrder(null);
    setTracking(null);
    setReceipt(null);
    setFulfillmentAssertion("");
    dispatch({ type: "reset" });
    setMessage("新しい条件を入力してください。");
  };

  return (
    <div className="ai-commerce" role="dialog" aria-modal="true" aria-label="AIで商品を探して購入">
      <button type="button" className="ai-commerce__backdrop" onClick={onClose} aria-label="閉じる" />
      <section ref={dialogRef} tabIndex={-1}>
        <header>
          <div>
            <small>AI × COMMERCE</small>
            <h2>探す・比較する・購入する</h2>
            <p>AIは候補を整理します。注文・決済・領収書はCommerceが管理し、署名はウォレットで行います。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる"><X aria-hidden="true" /></button>
        </header>

        <ol className="ai-commerce__steps" aria-label="購入手順">
          {["候補", "条件", "見積", "承認", "完了"].map((label, index) => {
            const active = state.stage === "submitted" ? 4
              : state.stage === "authorizing" ? 3
                : state.stage === "quoted" ? 2
                  : state.stage === "configure" ? 1 : 0;
            return <li key={label} data-active={index <= active}><span>{index < active ? <Check aria-hidden="true" /> : index + 1}</span>{label}</li>;
          })}
        </ol>

        {state.stage === "submitted" ? (
          <div className="ai-commerce__complete">
            <ShieldCheck aria-hidden="true" />
            <h3>注文を送信しました</h3>
            <p>{message}</p>
            <dl>
              <div><dt>注文ID</dt><dd>{order?.id}</dd></div>
              <div><dt>注文状態</dt><dd>{tracking?.status ?? "確認中"}</dd></div>
              {tracking?.fulfillmentStatus ? <div><dt>配送状態</dt><dd>{tracking.fulfillmentStatus}</dd></div> : null}
              {tracking?.carrier ? <div><dt>配送会社</dt><dd>{tracking.carrier}</dd></div> : null}
              {tracking?.trackingNumber ? <div><dt>追跡番号</dt><dd>{tracking.trackingNumber}</dd></div> : null}
              <div><dt>トランザクション</dt><dd>{state.transactionHash}</dd></div>
              {receipt ? <><div><dt>領収金額</dt><dd>{receipt.amountJpyc.toLocaleString()} JPYC</dd></div><div><dt>決済日時</dt><dd>{receipt.paidAt ? new Date(receipt.paidAt).toLocaleString("ja-JP") : "確認中"}</dd></div></> : null}
            </dl>
            <div><button type="button" onClick={restart}>別の商品を探す</button><button type="button" className="ai-commerce__primary" onClick={onClose}>閉じる</button></div>
          </div>
        ) : order ? (
          <div className="ai-commerce__confirm">
            <small>COMMERCEの確定見積</small>
            <h3>{selected?.title}</h3>
            <dl>
              <div><dt>販売者</dt><dd>{selected?.seller.publicName}</dd></div>
              <div><dt>数量</dt><dd>{order.quantity}</dd></div>
              <div><dt>商品</dt><dd>{order.subtotalJpyc.toLocaleString()} JPYC</dd></div>
              <div><dt>送料</dt><dd>{order.shippingJpyc.toLocaleString()} JPYC</dd></div>
              <div><dt>税</dt><dd>{order.taxJpyc.toLocaleString()} JPYC</dd></div>
              <div className="is-total"><dt>支払い上限</dt><dd>{order.amountJpyc.toLocaleString()} JPYC</dd></div>
              <div><dt>有効期限</dt><dd>{new Date(order.expiresAt).toLocaleString("ja-JP")}</dd></div>
            </dl>
            <p>送金先・商品・数量・合計を固定した見積です。AIが代理で署名することはありません。</p>
            <div>
              <button type="button" onClick={() => { setOrder(null); dispatch({ type: "select", productId: selected?.id ?? "" }); }} disabled={busy}><ChevronLeft aria-hidden="true" />戻る</button>
              <button type="button" className="ai-commerce__primary" onClick={() => void authorizePayment()} disabled={busy}>{busy ? "ウォレットで確認中…" : "内容を確認して署名"}</button>
            </div>
          </div>
        ) : (
          <>
            <label className="ai-commerce__search">
              <Search aria-hidden="true" />
              <input type="search" value={state.query} onChange={(event) => dispatch({ type: "search", query: event.target.value })} placeholder="欲しい商品、用途、販売者を入力" autoFocus />
            </label>
            <div className="ai-commerce__policy">
              <label>1回の購入上限<input type="number" min={1} step={100} value={maximumPerPurchaseJpyc} onChange={(event) => setMaximumPerPurchaseJpyc(Math.max(1, Number(event.target.value) || 1))} /> JPYC</label>
              <span><ShieldCheck aria-hidden="true" />購入前の確認は常に必要です</span>
            </div>
            <div className="ai-commerce__products">
              {matches.map(({ product, score }) => (
                <button type="button" key={product.id} className={selected?.id === product.id ? "is-selected" : ""} onClick={() => dispatch({ type: "select", productId: product.id })}>
                  <span className="ai-commerce__image">{product.imageUrl ? <img src={product.imageUrl} alt="" referrerPolicy="no-referrer" /> : <ShoppingBag aria-hidden="true" />}</span>
                  <span><small>{product.seller.publicName}{state.query.trim() && score > 0 ? ` · 関連度 ${score}` : ""}</small><strong>{product.title}</strong><em>{product.priceJpyc.toLocaleString()} JPYC</em></span>
                </button>
              ))}
            </div>
            {state.query.trim() && matches.length === 0 ? <p className="ai-commerce__empty">条件に一致する購入可能な商品はありません。</p> : null}
            {selected && candidate ? (
              <div className="ai-commerce__proposal">
                <div><small>選択中</small><strong>{selected.title}</strong><p>{selected.seller.publicName} · <a href={selected.seller.legalDisplayUrl} target="_blank" rel="noreferrer">販売条件・返品 <ExternalLink aria-hidden="true" /></a></p></div>
                {valueProfile ? (
                  <div className="ai-commerce__value-profile">
                    <section aria-labelledby="ai-commerce-facts-title">
                      <strong id="ai-commerce-facts-title">比較条件</strong>
                      <dl>
                        {valueProfile.comparisonFacts.map((fact) => (
                          <div key={fact.key}>
                            <dt>{fact.label}</dt>
                            <dd>{String(fact.value)}{fact.unit ? ` ${fact.unit}` : ""}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                    {valueProfile.mode !== "comparable" ? (
                      <section aria-labelledby="ai-commerce-context-title">
                        <strong id="ai-commerce-context-title">背景・魅力</strong>
                        <p>{valueProfile.story ?? "購入前に内容を確認してください。"}</p>
                        <small>この項目は数値だけで決めず、本人が確認します。</small>
                      </section>
                    ) : null}
                  </div>
                ) : null}
                <label>数量<input type="number" min={1} max={Math.min(20, selected.stockQuantity ?? 20)} value={state.quantity} onChange={(event) => dispatch({ type: "configure", quantity: Number(event.target.value) })} /></label>
                <label>請求国<input value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} /></label>
                {physical ? <label className="ai-commerce__assertion">配送先確認情報<textarea value={fulfillmentAssertion} onChange={(event) => setFulfillmentAssertion(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Identityで配送先を選択して発行" /></label> : null}
                <div className="ai-commerce__estimate"><span>税計算前の上限目安</span><strong>{Number.isFinite(estimate) ? estimate.toLocaleString() : "—"} JPYC + 税</strong></div>
                {policyFailure ? <p className="ai-commerce__policy-error" role="alert">{COPY[policyFailure]}</p> : null}
                <button type="button" className="ai-commerce__primary" disabled={busy || Boolean(policyFailure)} onClick={() => void createQuote()}>{busy ? "見積を確認中…" : "Commerceで確定見積を取得"}</button>
              </div>
            ) : null}
          </>
        )}
        <p className="ai-commerce__status" role="status" aria-live="polite">{message}</p>
      </section>
    </div>
  );
}
