// ページ内ウォレットの承認ブリッジ。プロバイダ（非React）が署名・送信前に
// 人間可読な承認を求めるとき、Reactホストが登録したハンドラーへ委譲する。
// ハンドラー不在・拒否・タイムアウトはすべて不承認として扱う（フェイルクローズ）。

import type { SigningRisk } from "./security-analysis";

export type WalletApprovalRequest = {
  title: string;
  detailLabel?: string;
  detail?: string;
  risk: SigningRisk;
  warning?: string;
  account: string;
  chainId: string;
  fee?: { atomic: bigint; display: string };
};

export type WalletApprovalHandler = (request: WalletApprovalRequest) => Promise<boolean>;

let handler: WalletApprovalHandler | null = null;

export function setWalletApprovalHandler(next: WalletApprovalHandler | null) {
  handler = next;
}

export async function requestWalletApproval(request: WalletApprovalRequest): Promise<boolean> {
  if (!handler) return false;
  try {
    return await handler(request) === true;
  } catch {
    return false;
  }
}
