"use client";

// ハブの閲覧条件（GohoToken のトークン）を満たすためのトークンを、ハブの中で購入する。
// 売り手は GohoToken 側（販売元 GohoToken）。ハブは販売者ではなく、価格・確認・表示・返金は GohoToken が持つ。
// 表示は「このコンテンツの購入」。交換・価格比較・経路選択の画面ではない。
// 購入先は GohoToken V3 だけ（2026-10-15）。V2 の販売は「購入できません」と表示して買わせない。
// 流れ: 販売・売り手・見積の取得 → 居住国の申告 → 購入確認（署名・規約同意）→ V3 税見積（EIP-712）の検証 →
//       approve（必要額ちょうど）→ buyWithTaxQuote → Purchased の確認と購入の記録 → 確定待ち → ハブの閲覧条件の再確認。
// どの API 呼び出しが失敗しても、想定外の形が返っても「準備中」へ閉じる（fail closed）。
// 購入後の「開いてよいか」はハブのサーバー側の閲覧条件の確認だけが決める。この部品は成功を根拠にしない。

import { useEffect, useRef, useState } from "react";
import { formatUnits, getAddress, isAddress, stringToHex } from "viem";

import type { PublicAccessGate } from "@/lib/access-gates/types";
import { gohoBuyLabel } from "@/lib/access-gates/token-pass";

import {
  getGohoTokenPurchaseApi,
  residenceIsActive,
  SITE_TERMS_URL,
  SITE_TERMS_VERSION,
  type GohoTokenPurchaseApi,
  type MarketScope,
  type SaleInfo,
  type SellerInfo,
  type WalletSigner,
} from "@/lib/gohotoken/api";
import { findPurchasedLogIndex, prepareGohoPurchase } from "@/lib/gohotoken/flow";
import {
  formatAtomic,
  parseDecimalToAtomic,
  paymentTokenLabel,
  PurchaseError,
  type PurchaseRequest,
} from "@/lib/gohotoken/purchase";
import { clearPurchaseIntent, registerPurchaseIntent } from "@/lib/gohotoken/purchase-display";
import { AVALANCHE_CHAIN_ID, AVALANCHE_CHAIN_ID_HEX, GOHO_TOKEN_DECIMALS } from "@/lib/gohotoken/vending";

type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };

export type GohoPurchaseContent = {
  title: string;
  chainId: number;
  saleAddress?: string;
  /** 閲覧条件の ERC20 契約。販売のトークンがこれと違えば購入させない。 */
  tokenAddress?: string;
  requiredBalance: string;
  requiredBalanceDecimals: number;
};

/** GohoToken の販売ページ（作成者が入手先として指定したもの）。Avalanche の販売だけを扱う。 */
const GOHOTOKEN_SALE_PAGE = /^https:\/\/(?:www\.)?gohotoken\.com\/token\/43114\/(0x[0-9a-fA-F]{40})\/?$/;

/**
 * 閲覧条件から、ハブ内で買える GohoToken の販売を取り出す。作成者の入手先リンクが GohoToken の
 * 販売ページで、条件がその Avalanche の ERC20 ひとつで満たせるときだけ返す。それ以外は null
 * （作成者の外部リンクだけを示す）。販売のトークンが条件の契約と同じかは、購入画面が読み取りで確かめる。
 */
export function gohoTokenPurchaseForGate(gate: PublicAccessGate, title = ""): GohoPurchaseContent | null {
  const match = gate.acquisitionUrl ? GOHOTOKEN_SALE_PAGE.exec(gate.acquisitionUrl) : null;
  if (!match) return null;
  const candidates = gate.conditions.filter(
    (condition) =>
      condition.kind === "erc20" &&
      condition.chainId === AVALANCHE_CHAIN_ID &&
      (condition.decimals ?? GOHO_TOKEN_DECIMALS) === GOHO_TOKEN_DECIMALS,
  );
  if (candidates.length !== 1) return null;
  if (gate.match === "all" && gate.conditions.length !== 1) return null;
  const condition = candidates[0]!;
  if (!/^[1-9][0-9]{0,77}$/.test(condition.minRaw)) return null;
  return {
    title,
    chainId: AVALANCHE_CHAIN_ID,
    saleAddress: match[1],
    tokenAddress: condition.contract,
    requiredBalance: formatUnits(BigInt(condition.minRaw), GOHO_TOKEN_DECIMALS),
    requiredBalanceDecimals: GOHO_TOKEN_DECIMALS,
  };
}

type Phase = "loading" | "unavailable" | "not_purchasable" | "ready" | "working" | "waiting" | "done" | "error";

type Loaded = {
  sale: SaleInfo;
  seller: SellerInfo;
  scope: MarketScope;
  totalPayment: bigint;
};

type Receipt = { status?: string; transactionHash?: string; logs?: { address?: string; topics?: string[]; data?: string; logIndex?: string | number }[] };

const RECEIPT_TIMEOUT_MS = 180_000;
const RECEIPT_POLL_MS = 3_000;
const SUBDIVISION_COUNTRIES = new Set(["US", "CA", "IN"]);

function walletProvider(): Provider | null {
  const host = window as Window & { hubNativeWallet?: Provider; ethereum?: Provider };
  return host.hubNativeWallet ?? host.ethereum ?? null;
}

async function waitForSuccessfulReceipt(provider: Provider, hash: string, signal: { cancelled: boolean }): Promise<Receipt> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.cancelled) throw new Error("cancelled");
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as Receipt | null;
    if (receipt) {
      if (receipt.status === "0x1") return receipt;
      throw new Error("transaction_failed");
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }
  throw new Error("receipt_timeout");
}

function blockedMessage(reason: string): string {
  if (/country|residence|jurisdiction|subdivision/i.test(reason)) {
    return "お住まいの国・地域では、この購入をご利用いただけません。";
  }
  if (reason.startsWith("tax_quote_")) {
    return "税込み価格を確認できなかったため、購入を中止しました。もう一度お試しください。";
  }
  return "この条件では購入を進められません。時間をおいてもう一度お試しください。";
}

export function GohoTokenPurchasePanel(props: {
  content: GohoPurchaseContent;
  /** 分かっていれば、接続中のウォレットがこれと違うときに止める。 */
  walletAddress?: string | null;
  /** 分かっていれば、購入ボタンに出すトークン名（「gohotokenで〈名前〉を買う」）。 */
  tokenName?: string | null;
  /** ハブのサーバー側の閲覧条件の確認を呼び直し、許可されたかを返す。 */
  recheckAccess: () => Promise<boolean>;
  api?: GohoTokenPurchaseApi;
  /** 閲覧条件ではない場面（研究支援など）では false にして、閲覧条件の注記を出さない。 */
  showGateNote?: boolean;
}) {
  const api = props.api ?? getGohoTokenPurchaseApi();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [country, setCountry] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState("");
  const cancel = useRef({ cancelled: false });

  const { chainId, saleAddress, tokenAddress, requiredBalance, requiredBalanceDecimals } = props.content;
  const requiredAtomic = parseDecimalToAtomic(requiredBalance, requiredBalanceDecimals);
  const supported =
    chainId === AVALANCHE_CHAIN_ID &&
    typeof saleAddress === "string" &&
    isAddress(saleAddress, { strict: false }) &&
    requiredAtomic !== null &&
    requiredAtomic > 0n &&
    requiredBalanceDecimals === GOHO_TOKEN_DECIMALS &&
    typeof tokenAddress === "string" &&
    isAddress(tokenAddress, { strict: false });

  useEffect(() => {
    cancel.current = { cancelled: false };
    return () => {
      cancel.current.cancelled = true;
    };
  }, []);

  // 販売・売り手・市場範囲・見積（署名不要の読み取りだけ）。
  useEffect(() => {
    let active = true;
    if (!supported || !saleAddress || requiredAtomic === null) {
      setPhase("unavailable");
      return;
    }
    setPhase("loading");
    const ref = { chainId, saleAddress };
    (async () => {
      const sale = await api.getSale(ref);
      if (sale.status !== "ok") return sale.reason === "sale_not_purchasable" ? ("not_purchasable" as const) : null;
      // 作成者の販売ページが、閲覧条件と別のトークンを売っていれば閉じる。
      if (!tokenAddress || sale.value.tokenAddress.toLowerCase() !== tokenAddress.toLowerCase()) return null;
      const [seller, scope, quote] = await Promise.all([
        api.getSeller(sale.value.creatorWallet),
        api.getMarketScope(),
        api.getBuyQuote(ref, requiredAtomic),
      ]);
      if (seller.status !== "ok" || scope.status !== "ok" || quote.status !== "ok") return null;
      return { sale: sale.value, seller: seller.value, scope: scope.value, totalPayment: quote.value.paymentAmount };
    })()
      .then((result) => {
        if (!active) return;
        if (!result) {
          setPhase("unavailable");
          return;
        }
        if (result === "not_purchasable") {
          setPhase("not_purchasable");
          return;
        }
        setLoaded(result);
        setPhase("ready");
      })
      .catch(() => {
        if (active) setPhase("unavailable");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, chainId, saleAddress, tokenAddress, requiredBalance, requiredBalanceDecimals]);

  async function send(provider: Provider, from: string, request: PurchaseRequest): Promise<Receipt> {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from, to: request.to, data: request.data, value: request.value }],
    });
    if (typeof hash !== "string") throw new Error("transaction_not_submitted");
    setPhase("waiting");
    const receipt = await waitForSuccessfulReceipt(provider, hash, cancel.current);
    setPhase("working");
    return { ...receipt, transactionHash: receipt.transactionHash ?? hash };
  }

  const countryInput = country.trim().toUpperCase();
  const subdivisionNeeded = SUBDIVISION_COUNTRIES.has(countryInput);
  const countryAllowed = (code: string) =>
    /^[A-Z]{2}$/.test(code) &&
    (!loaded?.scope.buyerCountries || loaded.scope.buyerCountries.includes(code)) &&
    !loaded?.scope.notSellableNowCountries.includes(code);

  async function purchase() {
    if (phase !== "ready" || !supported || !saleAddress || requiredAtomic === null || !loaded || !agreed) return;
    const provider = walletProvider();
    if (!provider) {
      setMessage("購入にはウォレットが必要です。ウォレットを接続してください。");
      return;
    }
    setPhase("working");
    setMessage("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const from = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      if (!from || !isAddress(from, { strict: false })) throw new Error("wallet_account_unavailable");
      if (props.walletAddress && from.toLowerCase() !== props.walletAddress.toLowerCase()) {
        throw new Error("wallet_account_mismatch");
      }
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: AVALANCHE_CHAIN_ID_HEX }] });
      const buyer = getAddress(from.toLowerCase());
      const signer: WalletSigner = {
        address: buyer,
        signMessage: async (text) => {
          const signature = await provider.request({ method: "personal_sign", params: [stringToHex(text), buyer] });
          if (typeof signature !== "string") throw new Error("signature_unavailable");
          return signature;
        },
      };

      // 申告の読み取りも署名が要る（本人の分だけ読める）。無ければ入力した国で申告する。
      const existing = await api.getResidence(signer);
      if (existing.status !== "ok") {
        setPhase("unavailable");
        return;
      }
      const current = residenceIsActive(existing.value) ? existing.value : null;
      let countryCode = current ? current.countryCode : countryInput;
      if (!current) {
        if (!countryAllowed(countryCode)) {
          setPhase("ready");
          setMessage("お住まいの国・地域を2文字の国コード（例: JP）で入力してください。販売対象外の国・地域では購入できません。");
          return;
        }
        if (subdivisionNeeded && !/^[A-Z0-9]{1,3}$/.test(subdivision.trim().toUpperCase())) {
          setPhase("ready");
          setMessage("州・地域コードを入力してください。");
          return;
        }
      }
      if (!current) {
        const declared = await api.declareResidence(signer, {
          countryCode,
          subdivisionCode: subdivisionNeeded ? subdivision.trim().toUpperCase() : undefined,
        });
        if (declared.status !== "ok" || !residenceIsActive(declared.value)) {
          setPhase("unavailable");
          return;
        }
        countryCode = declared.value.countryCode;
      }
      if (!countryAllowed(countryCode)) {
        setPhase("ready");
        setMessage("お住まいの国・地域では、この購入をご利用いただけません。");
        return;
      }

      const ref = { chainId, saleAddress };
      const prepared = await prepareGohoPurchase({
        api,
        signer,
        sale: ref,
        saleInfo: loaded.sale,
        seller: loaded.seller,
        requiredAtomic,
        residenceCountryCode: countryCode,
        ethCall: async (to, data) => {
          const result = await provider.request({ method: "eth_call", params: [{ to, data }, "latest"] });
          if (typeof result !== "string") throw new Error("eth_call_failed");
          return result;
        },
      });
      if (prepared.status === "unavailable") {
        setPhase("unavailable");
        return;
      }
      if (prepared.status === "blocked") {
        setPhase("ready");
        setMessage(blockedMessage(prepared.reason));
        return;
      }

      const { requests, intentId, taxQuote } = prepared;
      registerPurchaseIntent(requests, props.content.title);
      await send(provider, from, requests.approve);
      if (prepared.taxQuoteDeadline !== undefined && prepared.taxQuoteDeadline <= BigInt(Math.floor(Date.now() / 1000)) + 15n) {
        throw new PurchaseError("tax_quote_expired");
      }
      const buyReceipt = await send(provider, from, requests.buy);
      clearPurchaseIntent();

      // 記録は GohoToken 側の帳簿のため。失敗してもアクセス判定には影響しない（確定は GohoToken API がチェーンと照合する）。
      const logIndex = findPurchasedLogIndex(buyReceipt, saleAddress, buyer, taxQuote);
      if (logIndex !== null && buyReceipt.transactionHash) {
        await api
          .recordPurchase(signer, {
            buyerWallet: buyer,
            chainId,
            saleAddress,
            intentId,
            transactionHash: buyReceipt.transactionHash,
            logIndex,
          })
          .catch(() => undefined);
      }
      const granted = await props.recheckAccess();
      setPhase(granted ? "done" : "error");
      if (!granted) {
        setMessage("購入は確認できましたが、ハブでの保有確認はまだ完了していません。購入したウォレットがハブに連携されているかを確かめ、少し待ってから「もう一度確かめる」をお試しください。");
      }
    } catch (error) {
      clearPurchaseIntent();
      setPhase("ready");
      setMessage(
        error instanceof PurchaseError && error.code === "tax_quote_expired"
          ? "税込み価格の有効期限が切れました。もう一度お試しください。"
          : error instanceof PurchaseError
            ? "購入内容を確認できなかったため、購入を中止しました。"
            : error instanceof Error && error.message === "wallet_account_mismatch"
              ? "接続中のウォレットが、ハブに連携したウォレットと異なります。"
              : error instanceof Error && error.message === "wallet_rejected"
                ? "購入は取り消されました。"
                : "購入を完了できませんでした。時間をおいてもう一度お試しください。",
      );
    }
  }

  const busy = phase === "working" || phase === "waiting";
  const paymentLabel = loaded ? paymentTokenLabel(loaded.sale.paymentSymbol, loaded.sale.paymentToken) : "";
    return (
    <section className="v2-gate-purchase" aria-label="閲覧条件のトークンを購入する">
      <h3>閲覧条件のトークンを購入する</h3>
      <p className="v2-gate-purchase__seller">
        販売元: GohoToken。この購入は GohoToken での取引です。価格・購入の確認・表示・返金は GohoToken が受け持ち、ハブは販売者ではありません。
      </p>
      {phase === "loading" ? <p>購入情報を確認しています…</p> : null}
      {phase === "unavailable" ? (
        <p className="v2-note" role="status">
          購入の準備中です。作成者が指定した外部のページから購入できます。
        </p>
      ) : null}
      {phase === "not_purchasable" ? (
        <p className="v2-note" role="status">
          このトークンは現在購入できません。
        </p>
      ) : null}
      {phase !== "loading" && phase !== "unavailable" && phase !== "not_purchasable" && loaded ? (
        <>
          <dl>
            <div>
              <dt>出品者（GohoToken の表示）</dt>
              <dd>{loaded.seller.name}</dd>
            </div>
            {loaded.seller.address ? (
              <div>
                <dt>所在地</dt>
                <dd>{loaded.seller.address}</dd>
              </div>
            ) : null}
            {loaded.seller.contact ? (
              <div>
                <dt>連絡先</dt>
                <dd>{loaded.seller.contact}</dd>
              </div>
            ) : null}
            {loaded.seller.refundPolicyText ? (
              <div>
                <dt>返品・キャンセル</dt>
                <dd>{loaded.seller.refundPolicyText}</dd>
              </div>
            ) : null}
            <div>
              <dt>支払総額（内税）</dt>
              <dd>
                {formatAtomic(loaded.totalPayment, loaded.sale.paymentDecimals)} {paymentLabel}
              </dd>
            </div>
          </dl>
          {
            <div>
              <label>
                居住国（2文字の国コード。例: JP。申告が済んでいる場合は申告済みの国を使います）
                <input
                  type="text"
                  value={country}
                  maxLength={2}
                  autoCapitalize="characters"
                  disabled={busy || phase === "done"}
                  onChange={(event) => setCountry(event.target.value.toUpperCase())}
                />
              </label>
              {subdivisionNeeded ? (
                <label>
                  州・地域コード
                  <input
                    type="text"
                    value={subdivision}
                    maxLength={3}
                    disabled={busy || phase === "done"}
                    onChange={(event) => setSubdivision(event.target.value.toUpperCase())}
                  />
                </label>
              ) : null}
              <small>居住国はウォレット署名で申告します。購入のたびに国・地域の確認が行われます。</small>
            </div>
          }
          <a href={SITE_TERMS_URL} target="_blank" rel="noopener noreferrer">
            販売条件・規約（{SITE_TERMS_VERSION}）
          </a>
          <label>
            <input
              type="checkbox"
              checked={agreed}
              disabled={busy || phase === "done"}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            規約と支払総額に同意します
          </label>
          <small>
            ウォレットで、購入内容の署名と、支払いの許可・購入の取引について、内容を確認します。
          </small>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => void purchase()}
        disabled={phase !== "ready" || !agreed}
      >
        {phase === "working"
          ? "処理中…"
          : phase === "waiting"
            ? "取引の確定を待っています…"
            : phase === "done"
              ? "購入済み"
              : props.tokenName
                ? gohoBuyLabel(props.tokenName)
                : "購入する"}
      </button>
      {phase === "ready" && props.showGateNote !== false ? (
        <small>購入したウォレットをハブに連携していないと、閲覧条件は満たされません。</small>
      ) : null}
      {message ? (
        <p className="v2-note" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
