export interface TokenRankingInput {
  title: string;
  symbol: string;
  network: string;
  contractAddress?: string;
  description: string;
}

export function parseTokenRankingInput(input: unknown): TokenRankingInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("ランキング情報が必要です。");
  }

  const record = input as Record<string, unknown>;
  const allowedFields = new Set(["title", "symbol", "network", "contractAddress", "description"]);
  const unsupportedFields = Object.keys(record).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) throw new Error("未対応の項目が含まれています。");
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
  const network = typeof record.network === "string" ? record.network.trim() : "";
  const contractAddress = typeof record.contractAddress === "string" ? record.contractAddress.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";

  if (!title || title.length > 60) throw new Error("ランキング名は1〜60文字で入力してください。");
  if (!/^[A-Z0-9._-]{1,16}$/.test(symbol)) throw new Error("シンボルは英数字など16文字以内で入力してください。");
  if (!network || network.length > 40) throw new Error("ネットワークは1〜40文字で入力してください。");
  if (contractAddress.length > 128) throw new Error("コントラクトアドレスが長すぎます。");
  if (contractAddress && !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error("コントラクトアドレスは0xから始まるEVMアドレスで入力してください。");
  }
  if (description.length > 180) throw new Error("説明は180文字以内で入力してください。");

  return { title, symbol, network, contractAddress: contractAddress || undefined, description };
}
