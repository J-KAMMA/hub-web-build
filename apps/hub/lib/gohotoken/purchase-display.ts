// 確認画面用: Hub が組み立てた購入リクエストと完全一致する呼び出しだけに、
// 宛先ラベル・トークン・額・購入コンテンツ名を付ける。一致しない呼び出しは従来の汎用表示のまま。
// 意図は短命（5分）でメモリ内のみ。ラベルを信用するのは Hub 自身が登録したものに限る。
// 表示はコンテンツの購入代金の支払い。交換・見積比較・経路選択の語は使わない。

import { GOHO_TOKEN_DECIMALS } from "./vending";
import { formatAtomic, type PurchaseRequests } from "./purchase";

const TTL_MS = 5 * 60_000;

type Intent = { requests: PurchaseRequests; contentTitle: string; chainId: number; registeredAt: number };
let intent: Intent | null = null;

export function registerPurchaseIntent(requests: PurchaseRequests, contentTitle: string, now = Date.now()) {
  intent = { requests, contentTitle, chainId: requests.approve.chainId, registeredAt: now };
}

export function clearPurchaseIntent() {
  intent = null;
}

export type PurchaseDisplay = { summary: string; risk: "caution"; warning: string };

/** 登録済み購入と完全一致する呼び出しなら読める形の説明を返す。 */
export function describePurchaseCall(
  call: { to: string; data: string; value?: string },
  chainId: string | number,
  now = Date.now(),
): PurchaseDisplay | null {
  if (!intent || now - intent.registeredAt > TTL_MS || now < intent.registeredAt) return null;
  let numericChain: number;
  try {
    numericChain = typeof chainId === "number" ? chainId : Number(BigInt(chainId));
  } catch {
    return null;
  }
  if (numericChain !== intent.chainId) return null;
  if (call.value && BigInt(call.value) !== 0n) return null;
  const { requests, contentTitle } = intent;
  const label = requests.paymentLabel;
  const total = `${formatAtomic(requests.totalPayment, requests.paymentDecimals)} ${label}`;
  const to = call.to.toLowerCase();
  const data = call.data.toLowerCase();

  if (to === requests.approve.to.toLowerCase() && data === requests.approve.data.toLowerCase()) {
    return {
      summary: [
        `購入するコンテンツ: ${contentTitle}`,
        "手順1/2: 支払いの利用許可（approve）",
        `トークン: ${label}（${requests.paymentToken}）`,
        `許可先: GohoToken販売コントラクト（${requests.spender}）`,
        `許可する額: ${total}（購入に必要な額ちょうど）`,
      ].join("\n"),
      risk: "caution",
      warning: "この許可は上記の額までです。無制限の許可ではありません。",
    };
  }
  if (to === requests.buy.to.toLowerCase() && data === requests.buy.data.toLowerCase()) {
    return {
      summary: [
        `購入するコンテンツ: ${contentTitle}`,
        "手順2/2: コンテンツの購入（署名済みの税込み価格・buyWithTaxQuote）",
        `宛先: GohoToken販売コントラクト（${requests.spender}）`,
        `支払い: ${total}（内税込みの総額。うち税額 ${formatAtomic(requests.taxAmount, requests.paymentDecimals)} ${label}）`,
        `受け取る数量: ${formatAtomic(requests.tokenAmount, GOHO_TOKEN_DECIMALS)} トークン`,
      ].join("\n"),
      risk: "caution",
      warning: `このコンテンツの購入として、上記の額までの${label}が支払われます。`,
    };
  }
  return null;
}
