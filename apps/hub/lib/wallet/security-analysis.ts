// apps/wallet-extension/src/security-analysis.js の移植。
// 署名・トランザクション要求の人間可読な解析（承認UI表示用）。

const MAX_UINT256 = (1n << 256n) - 1n;

export type SigningRisk = "normal" | "warning" | "caution" | "danger";

export type SigningAnalysis = {
  summary: string;
  risk: SigningRisk;
  warning: string;
};

function compact(value: unknown, depth = 0): string {
  if (depth > 2) return "…";
  if (value == null || ["boolean", "number", "bigint"].includes(typeof value)) return String(value);
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (Array.isArray(value)) return `[${value.slice(0, 5).map((item) => compact(item, depth + 1)).join(", ")}${value.length > 5 ? ", …" : ""}]`;
  if (typeof value === "object") return Object.entries(value).slice(0, 8).map(([key, item]) => `${key}: ${compact(item, depth + 1)}`).join("\n");
  return "解析不能";
}

export function analyzeTypedData(payload: { primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> }): SigningAnalysis {
  const primary = payload.primaryType.toLowerCase(); const message = payload.message ?? {};
  const permit = primary.includes("permit") || primary.includes("authorization");
  const unlimited = [message.value, message.amount, message.allowedAmount].some((value) => { try { return value != null && BigInt(value as string) === MAX_UINT256; } catch { return false; } });
  const operator = message.spender ?? message.operator ?? message.delegate ?? null;
  const risks: string[] = [];
  if (permit) risks.push("この署名はトークン利用権限を付与する可能性があります。");
  if (unlimited) risks.push("無制限のトークン利用許可が要求されています。");
  if (message.approved === true || message.approved === "true") risks.push("NFTの一括操作権限が要求されています。");
  return { summary: [`domain: ${payload.domain.name ?? "名称なし"}`, `type: ${payload.primaryType}`, operator ? `operator: ${operator}` : null, compact(message)].filter(Boolean).join("\n"), risk: unlimited || message.approved === true ? "danger" : permit ? "warning" : "normal", warning: risks.join(" ") || "署名すると、表示された内容をコントラクトがERC-1271で検証できます。" };
}

export function analyzeTransactionData(data: string): SigningAnalysis {
  if (!data || data === "0x") return { summary: "コントラクトデータなし", risk: "normal", warning: "送信先と数量を確認してください。" };
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length % 2 !== 0) return { summary: "不正な16進データ", risk: "danger", warning: "解析できないデータです。承認しないでください。" };
  const selector = data.slice(0, 10).toLowerCase(); const words = data.slice(10).match(/.{64}/g) ?? [];
  if (selector === "0x095ea7b3" && words.length >= 2) {
    const spender = `0x${words[0]!.slice(24)}`; const amount = BigInt(`0x${words[1]!}`); const unlimited = amount === MAX_UINT256;
    return { summary: `ERC-20 approve\nspender: ${spender}\namount: ${amount}`, risk: unlimited ? "danger" : "warning", warning: unlimited ? "無制限のトークン利用許可です。信頼できる送信先以外では拒否してください。" : "指定した数量のトークン利用権限を付与します。" };
  }
  if (selector === "0xa22cb465" && words.length >= 2) {
    const operator = `0x${words[0]!.slice(24)}`; const approved = BigInt(`0x${words[1]!}`) !== 0n;
    return { summary: `NFT setApprovalForAll\noperator: ${operator}\napproved: ${approved}`, risk: approved ? "danger" : "normal", warning: approved ? "このアドレスがコレクション内の全NFTを操作できるようになります。" : "NFT一括操作権限を解除します。" };
  }
  return { summary: `${selector} / ${(data.length - 2) / 2} bytes`, risk: "warning", warning: "このコントラクト操作は詳細解析できません。要求元と送信先を慎重に確認してください。" };
}

export function analyzePersonalMessage(bytes: Uint8Array): SigningAnalysis {
  const value = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const controls = [...value].some((char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)));
  const readable = !value.includes("�") && !controls;
  return { summary: readable && bytes.length <= 1024 ? value : `${bytes.length} bytes（可読テキストではありません）`, risk: readable ? "warning" : "danger", warning: readable ? "メッセージ署名はログインや権限付与に使われる場合があります。内容と要求元を確認してください。" : "内容を安全に表示できません。意図が明確でなければ拒否してください。" };
}
