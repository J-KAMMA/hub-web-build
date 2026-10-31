"use client";

import { useState } from "react";

type Provider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

const DEFAULT_FEE_RECIPIENT = "0x307e6115eddb7ca3996804e30c3396034e04cb0d";

export function PhysicalEscrowDeployer() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "商品・サービス本体の1%だけをHubへ分配するv6をAmoyへ配置します。",
  );
  const [feeRecipient, setFeeRecipient] = useState(DEFAULT_FEE_RECIPIENT);
  const [address, setAddress] = useState("");
  const [hash, setHash] = useState("");

  async function deploy() {
    setBusy(true);
    try {
      const provider = (window as Window & { ethereum?: Provider }).ethereum;
      if (!provider) throw new Error("MetaMaskが見つかりません。");
      const response = await fetch(
        `/api/dev/physical-escrow-deployment?feeRecipient=${encodeURIComponent(feeRecipient.trim())}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        deploymentData?: string;
        error?: string;
      };
      if (!response.ok || !body.deploymentData) {
        throw new Error(body.error ?? "デプロイデータを取得できません。");
      }
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const from =
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? accounts[0]
          : null;
      if (!from) throw new Error("アカウントを確認できません。");
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x13882" }],
      });
      setMessage("手数料受取先と配置内容をMetaMaskで確認してください。");
      const sent = await provider.request({
        method: "eth_sendTransaction",
        params: [{ from, data: body.deploymentData }],
      });
      if (typeof sent !== "string") throw new Error("送信結果を確認できません。");
      setHash(sent);
      for (let attempt = 0; attempt < 90; attempt += 1) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 2_000));
        const receipt = (await provider.request({
          method: "eth_getTransactionReceipt",
          params: [sent],
        })) as { status?: string; contractAddress?: string } | null;
        if (!receipt) continue;
        if (receipt.status !== "0x1" || !receipt.contractAddress) {
          throw new Error("配置に失敗しました。");
        }
        setAddress(receipt.contractAddress);
        setMessage("v3の配置が完了しました。次にCommerceへ登録します。");
        return;
      }
      throw new Error("送信済みですが確定待ちです。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "配置できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="commerce-order-page">
      <header>
        <small>AMOY TESTNET・VERSION 6</small>
        <h1>物販エスクローを配置</h1>
        <p>返金時は手数料なし、販売者への支払いが成立した部分だけ1%を分配します。</p>
      </header>
      <section className="commerce-order-return">
        <label>
          Hub手数料受取先
          <input
            value={feeRecipient}
            onChange={(event) => setFeeRecipient(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p role="status">{message}</p>
        <button disabled={busy} onClick={() => void deploy()}>
          {busy ? "処理中…" : "MetaMaskでv3をデプロイ"}
        </button>
        {hash ? (
          <p>
            トランザクション：
            <a
              href={`https://amoy.polygonscan.com/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
            >
              {hash}
            </a>
          </p>
        ) : null}
        {address ? <p>コントラクト：<strong>{address}</strong></p> : null}
      </section>
    </section>
  );
}
