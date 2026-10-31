export type DappRequestRisk = "low" | "medium" | "high";
export type DappRequestReview = {
  method: string;
  risk: DappRequestRisk;
  title: string;
  warnings: string[];
  destination: string | null;
  valueHex: string | null;
};

const allowedMethods = new Set([
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
]);
const unlimitedUint256 =
  /^0x0*ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff$/i;

export function reviewDappRequest(value: unknown): DappRequestReview {
  if (!value || typeof value !== "object")
    throw new Error("dapp_request_invalid");
  const input = value as { method?: unknown; params?: unknown };
  if (typeof input.method !== "string" || !allowedMethods.has(input.method))
    throw new Error("dapp_method_not_allowed");
  if (!Array.isArray(input.params)) throw new Error("dapp_params_invalid");
  if (input.method === "personal_sign")
    return {
      method: input.method,
      risk: "medium",
      title: "メッセージ署名",
      warnings: [
        "署名内容がログインや権限付与に使われる可能性があります。内容と接続元を確認してください。",
      ],
      destination: null,
      valueHex: null,
    };
  if (input.method === "eth_signTypedData_v4")
    return {
      method: input.method,
      risk: "high",
      title: "構造化データ署名",
      warnings: [
        "トークン利用許可や注文を含む可能性があります。ドメイン、期限、数量を確認してください。",
      ],
      destination: null,
      valueHex: null,
    };
  const transaction = input.params[0];
  if (!transaction || typeof transaction !== "object")
    throw new Error("dapp_transaction_invalid");
  const tx = transaction as Record<string, unknown>;
  const destination =
    typeof tx.to === "string" && /^0x[0-9a-fA-F]{40}$/.test(tx.to)
      ? tx.to
      : null;
  if (!destination) throw new Error("dapp_destination_invalid");
  const data =
    typeof tx.data === "string" && /^0x[0-9a-fA-F]*$/.test(tx.data)
      ? tx.data
      : "0x";
  const valueHex =
    typeof tx.value === "string" && /^0x[0-9a-fA-F]+$/.test(tx.value)
      ? tx.value
      : "0x0";
  const warnings: string[] = [];
  let risk: DappRequestRisk = "medium";
  if (BigInt(valueHex) > 0n)
    warnings.push(
      "ネイティブトークンを送る要求です。金額をウォレット側でも確認してください。",
    );
  if (data !== "0x")
    warnings.push(
      "コントラクトを実行する要求です。Hubは実行結果を保証できません。",
    );
  const selector = data.slice(0, 10).toLocaleLowerCase("en");
  if (selector === "0x095ea7b3") {
    risk = "high";
    const amount = `0x${data.slice(74, 138)}`;
    warnings.push(
      unlimitedUint256.test(amount)
        ? "トークンの無制限利用許可を求めています。"
        : "トークン利用許可を求めています。数量と許可先を確認してください。",
    );
  }
  if (selector === "0xa22cb465") {
    risk = "high";
    warnings.push(
      "NFTコレクション全体の操作許可を求めている可能性があります。",
    );
  }
  if (
    ["0x38ed1739", "0x7ff36ab5", "0x18cbafe5", "0x5c11d795"].includes(selector)
  ) {
    risk = "high";
    warnings.push(
      "外部dAppが作成した交換関連の要求である可能性があります。Hubは交換先や経路を選択していません。",
    );
  }
  if (!warnings.length) {
    risk = "low";
    warnings.push(
      "金額を伴わない通常のトランザクション要求です。宛先を確認してください。",
    );
  }
  return {
    method: input.method,
    risk,
    title: "トランザクション要求",
    warnings,
    destination,
    valueHex,
  };
}
