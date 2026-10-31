"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { registerNativeWalletProvider } from "@/lib/wallet/native-provider";
import { setWalletApprovalHandler, type WalletApprovalRequest } from "@/lib/wallet/approval-bridge";
import { walletNetwork } from "@/lib/wallet/networks";

type PendingApproval = {
  request: WalletApprovalRequest;
  resolve: (approved: boolean) => void;
};

function riskClass(risk: WalletApprovalRequest["risk"]): string {
  if (risk === "danger") return "v2-wallet-approval__risk--danger";
  if (risk === "warning" || risk === "caution") return "v2-wallet-approval__risk--warning";
  return "";
}

/**
 * ページ内ウォレットのホスト。
 * - 既存ウォレット状態があれば window.hubNativeWallet へプロバイダを登録する
 * - 署名・送信要求ごとに承認ダイアログを出し、明示承認だけを通す
 * HubWalletProvider の内側で1つだけマウントする。
 */
export function NativeWalletHost() {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const pending = useRef<PendingApproval | null>(null);
  const [visible, setVisible] = useState<PendingApproval | null>(null);

  const settle = useCallback((approved: boolean) => {
    const current = pending.current;
    pending.current = null;
    setVisible(null);
    dialog.current?.close();
    current?.resolve(approved);
  }, []);

  useEffect(() => {
    registerNativeWalletProvider();
    setWalletApprovalHandler((request) => new Promise<boolean>((resolve) => {
      // 同時要求は1件だけ。並ぶ要求は不承認として返し、処理は側で失敗させる。
      if (pending.current) {
        resolve(false);
        return;
      }
      const item = { request, resolve };
      pending.current = item;
      setVisible(item);
      requestAnimationFrame(() => dialog.current?.showModal());
    }));
    return () => {
      setWalletApprovalHandler(null);
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, []);

  const request = visible?.request;
  return (
    <dialog
      ref={dialog}
      className="v2-wallet-approval__dialog"
      aria-labelledby="v2-wallet-approval-title"
      onCancel={(event) => { event.preventDefault(); settle(false); }}
      onClick={(event) => { if (event.target === event.currentTarget) settle(false); }}
    >
      {request ? (
        <div className="v2-wallet-approval">
          <h2 id="v2-wallet-approval-title">{request.title}</h2>
          <dl className="v2-wallet-approval__fields">
            <div>
              <dt>アカウント</dt>
              <dd className="v2-wallet-approval__mono">{request.account.slice(0, 10)}…{request.account.slice(-8)}</dd>
            </div>
            <div>
              <dt>ネットワーク</dt>
              <dd>{(() => { const n = walletNetwork(request.chainId); return n ? `${n.name}${n.testnet ? "（テストネット）" : ""}` : request.chainId; })()}</dd>
            </div>
            {request.detail ? (
              <div>
                <dt>{request.detailLabel ?? "内容"}</dt>
                <dd className="v2-wallet-approval__detail">{request.detail}</dd>
              </div>
            ) : null}
            {request.fee ? (
              <div>
                <dt>最大ネットワーク料金</dt>
                <dd className="v2-wallet-approval__mono">{request.fee.display}</dd>
              </div>
            ) : null}
          </dl>
          <p className={`v2-wallet-approval__risk ${riskClass(request.risk)}`}>{request.warning ?? "内容を確認してから承認してください。"}</p>
          <div className="v2-wallet-approval__actions">
            <button type="button" className="v2-button v2-button--text" onClick={() => settle(false)}>拒否</button>
            <button type="button" className="v2-button v2-button--primary" autoFocus onClick={() => settle(true)}>承認して署名</button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
