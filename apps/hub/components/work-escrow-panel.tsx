"use client";

import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, keccak256, parseAbi, stringToHex } from "viem";
import { useHubWallet } from "@/components/hub-wallet-provider";

const API = "/shopping/api/commerce/api/v1";
const AMOY_CHAIN_ID = 80002;
const ZERO = "0x0000000000000000000000000000000000000000";
const ABI = parseAbi([
  "function fundNative(bytes32 agreementId,address worker,address arbitrator,uint64 deliverBy,uint64 reviewPeriod) payable",
  "function submitDeliverable(bytes32 agreementId,bytes32 deliverableHash)",
  "function requestRevision(bytes32 agreementId,bytes32 reasonHash,uint64 revisedDeliverBy)",
  "function acceptDeliverable(bytes32 agreementId)",
  "function releaseAfterReview(bytes32 agreementId)",
  "function refundUndelivered(bytes32 agreementId)",
  "function cancelByWorker(bytes32 agreementId)",
  "function openDispute(bytes32 agreementId,bytes32 evidenceHash)",
  "function proposeResolution(bytes32 agreementId,uint128 clientAmount,uint128 workerGrossAmount)",
  "function acceptResolution(bytes32 agreementId,uint128 expectedClientAmount,uint128 expectedWorkerGrossAmount)",
]);

type EscrowState =
  | "awaiting_funding"
  | "funded"
  | "submitted"
  | "revision_requested"
  | "disputed"
  | "released"
  | "refunded";
type EscrowRecord = {
  id: string;
  agreementHash: `0x${string}`;
  contractAddress: `0x${string}`;
  clientAddress: string;
  workerAddress: string;
  amountWei: string;
  deliverBy: number;
  reviewPeriod: number;
  state: EscrowState;
  lastTransactionHash?: string;
  accessToken: string;
  workerInviteToken?: string;
};
type ApiAgreement = {
  id: string;
  agreementHash: `0x${string}`;
  contractAddress: `0x${string}`;
  clientAddress: string;
  workerAddress: string;
  amountAtomic: string;
  deliverBy: string;
  reviewPeriodSeconds: number;
  state: EscrowState;
  lastTransactionHash?: string | null;
};
type Config = {
  available: boolean;
  chainId: number;
  contractAddress: `0x${string}` | null;
  feeBps: number;
};
type ConfigResponse = {
  contract?: {
    chainId: number;
    address: `0x${string}`;
    feeBps: number;
  };
  error?: string;
};

function storageKey(listingId: string) {
  return `hub.work-escrow.${listingId}`;
}
function hashText(value: string) {
  return keccak256(stringToHex(value.trim()));
}
function weiFromPol(value: string) {
  const [whole = "0", fraction = ""] = value.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > 18)
    throw new Error("金額を正しく入力してください。");
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}
function polFromWei(value: string) {
  const amount = BigInt(value);
  const whole = amount / 10n ** 18n;
  const fraction = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction.slice(0, 6)}` : whole.toString();
}

export function WorkEscrowPanel({
  listingId,
  suggestedBudget: _suggestedBudget,
  intentId,
  suggestedWorkerAddress = "",
  suggestedAmountAtomic,
}: {
  listingId: string;
  suggestedBudget: number | null;
  intentId?: string;
  suggestedWorkerAddress?: string;
  suggestedAmountAtomic?: string;
}) {
  const wallet = useHubWallet();
  const [config, setConfig] = useState<Config | null>(null);
  const [record, setRecord] = useState<EscrowRecord | null>(null);
  const [workerAddress, setWorkerAddress] = useState(suggestedWorkerAddress);
  const [amount, setAmount] = useState(
    suggestedAmountAtomic ? polFromWei(suggestedAmountAtomic) : "0.001",
  );
  const [deliveryDays, setDeliveryDays] = useState("14");
  const [reviewDays, setReviewDays] = useState("7");
  const [content, setContent] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"text" | "external_link">("text");
  const [importId, setImportId] = useState("");
  const [importToken, setImportToken] = useState("");
  const [activity, setActivity] = useState<Array<{ action?: string; eventType?: string; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(storageKey(listingId));
    if (saved) {
      try {
        setRecord(JSON.parse(saved) as EscrowRecord);
      } catch {
        localStorage.removeItem(storageKey(listingId));
      }
    }
    void fetch(`${API}/work-escrow/config?chainId=${AMOY_CHAIN_ID}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as ConfigResponse;
        if (!response.ok) throw new Error(body.error ?? "設定を取得できません。");
        setConfig({
          available: Boolean(body.contract?.address),
          chainId: body.contract?.chainId ?? AMOY_CHAIN_ID,
          contractAddress: body.contract?.address ?? null,
          feeBps: body.contract?.feeBps ?? 0,
        });
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "設定を取得できません。"));
  }, [listingId]);

  const role = useMemo(() => {
    const current = wallet.address?.toLowerCase();
    if (!record || !current) return "viewer";
    if (current === record.clientAddress.toLowerCase()) return "client";
    if (current === record.workerAddress.toLowerCase()) return "worker";
    return "viewer";
  }, [record, wallet.address]);

  function persist(next: EscrowRecord) {
    setRecord(next);
    localStorage.setItem(storageKey(listingId), JSON.stringify(next));
  }
  async function returnIntentResult(
    agreementId: string,
    accessToken: string,
  ) {
    if (!intentId) return;
    const resultResponse = await fetch(
      `${API}/work-agreements/${encodeURIComponent(agreementId)}/intent-result`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    const resultBody = await resultResponse.json().catch(() => null) as {
      proof?: string;
      error?: string;
    } | null;
    if (!resultResponse.ok || !resultBody?.proof) {
      throw new Error(resultBody?.error ?? "履行結果を確認できませんでした。");
    }
    const hubResponse = await fetch("/api/core/intents/owner-result", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proof: resultBody.proof }),
    });
    const hubBody = await hubResponse.json().catch(() => null) as {
      error?: string;
    } | null;
    if (!hubResponse.ok && hubBody?.error !== "owner_result_replayed") {
      throw new Error(hubBody?.error ?? "Hubへ履行結果を返せませんでした。");
    }
  }
  async function refresh(target = record) {
    if (!target) return;
    const response = await fetch(`${API}/work-agreements/${target.id}`, {
      headers: { authorization: `Bearer ${target.accessToken}` },
      cache: "no-store",
    });
    const body = (await response.json()) as {
      agreement?: ApiAgreement & { role?: string };
      actions?: Array<{ action: string; createdAt: string }>;
      notifications?: Array<{ eventType: string; createdAt: string }>;
      error?: string;
    };
    if (!response.ok || !body.agreement) throw new Error(body.error ?? "契約を取得できません。");
    const apiAgreement = body.agreement;
    const parsedDeliverBy = Math.floor(new Date(apiAgreement.deliverBy).getTime() / 1000);
    persist({
      ...target,
      id: apiAgreement.id,
      agreementHash: apiAgreement.agreementHash,
      contractAddress: apiAgreement.contractAddress,
      clientAddress: apiAgreement.clientAddress,
      workerAddress: apiAgreement.workerAddress,
      amountWei: apiAgreement.amountAtomic,
      deliverBy: Number.isFinite(parsedDeliverBy) ? parsedDeliverBy : target.deliverBy,
      reviewPeriod: apiAgreement.reviewPeriodSeconds,
      state: apiAgreement.state,
      lastTransactionHash: apiAgreement.lastTransactionHash ?? undefined,
      accessToken: target.accessToken,
      workerInviteToken: target.workerInviteToken,
    });
    setActivity([...(body.notifications ?? []), ...(body.actions ?? [])]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 12));
    if (
      intentId
      && (apiAgreement.state === "released" || apiAgreement.state === "refunded")
    ) {
      await returnIntentResult(
        apiAgreement.id,
        target.accessToken,
      );
    }
  }
  async function importAgreement() {
    if (!/^[0-9a-f-]{36}$/.test(importId) || !/^[0-9a-f]{64}$/.test(importToken))
      throw new Error("契約IDと招待トークンを確認してください。");
    const target = {
      id: importId,
      accessToken: importToken,
    } as EscrowRecord;
    await refresh(target);
    setMessage("契約を読み込みました。");
  }
  async function ensureWallet() {
    if (wallet.address) return wallet.address;
    const connected = await wallet.connect("smart");
    if (!connected) throw new Error("ウォレットを接続してください。");
    throw new Error("接続後にもう一度操作してください。");
  }
  async function waitForReceipt(hash: `0x${string}`) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = (await wallet.getTransactionReceipt(hash)) as
        | { status?: string }
        | null;
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("トランザクションが失敗しました。");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("送信済みです。確定後に状態を更新してください。");
  }
  async function fund() {
    if (!config?.available || !config.contractAddress)
      throw new Error("現在エスクローを利用できません。");
    const client = await ensureWallet();
    if (!/^0x[0-9a-fA-F]{40}$/.test(workerAddress) || workerAddress.toLowerCase() === client.toLowerCase())
      throw new Error("受注者のウォレットアドレスを確認してください。");
    const value = weiFromPol(amount);
    if (value <= 0n) throw new Error("報酬は0より大きくしてください。");
    const delivery = Number(deliveryDays);
    const review = Number(reviewDays);
    if (!Number.isInteger(delivery) || delivery < 1 || delivery > 365)
      throw new Error("納期は1〜365日で指定してください。");
    if (!Number.isInteger(review) || review < 1 || review > 30)
      throw new Error("検収期間は1〜30日で指定してください。");
    await wallet.switchChain(AMOY_CHAIN_ID);
    let intentHandoffProof: string | undefined;
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
      const handoffBody = await handoffResponse.json().catch(() => null) as {
        proof?: string;
        error?: string;
      } | null;
      if (!handoffResponse.ok || !handoffBody?.proof) {
        throw new Error(
          handoffBody?.error ?? "Commerceへの安全な引き渡しを準備できませんでした。",
        );
      }
      intentHandoffProof = handoffBody.proof;
    }
    const preparedResponse = await fetch(`${API}/work-agreements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        listingReference: listingId,
        clientAddress: client,
        workerAddress,
        amountAtomic: value.toString(),
        deliveryDays: delivery,
        reviewDays: review,
        ...(intentHandoffProof ? { intentHandoffProof } : {}),
      }),
    });
    const prepared = (await preparedResponse.json()) as {
      agreement?: ApiAgreement;
      transaction?: { to: `0x${string}`; data: `0x${string}`; value: `0x${string}` };
      access?: { clientToken: string; workerToken: string };
      error?: string;
    };
    if (!preparedResponse.ok || !prepared.agreement || !prepared.transaction || !prepared.access)
      throw new Error(prepared.error ?? "契約を準備できませんでした。");
    const hash = await wallet.sendContractTransactionWithValue(
      prepared.transaction.to,
      prepared.transaction.data,
      prepared.transaction.value,
    );
    setMessage("入金の確定を待っています。");
    await waitForReceipt(hash);
    const confirmResponse = await fetch(`${API}/work-agreements/${prepared.agreement.id}/funding`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${prepared.access.clientToken}`,
      },
      body: JSON.stringify({ transactionHash: hash }),
    });
    const confirmed = (await confirmResponse.json()) as { error?: string };
    if (!confirmResponse.ok) throw new Error(confirmed.error ?? "入金を確認できませんでした。");
    const next: EscrowRecord = {
      id: prepared.agreement.id,
      agreementHash: prepared.agreement.agreementHash,
      contractAddress: prepared.agreement.contractAddress,
      clientAddress: prepared.agreement.clientAddress,
      workerAddress: prepared.agreement.workerAddress,
      amountWei: prepared.agreement.amountAtomic ?? value.toString(),
      deliverBy: Math.floor(new Date(prepared.agreement.deliverBy).getTime() / 1000),
      reviewPeriod: prepared.agreement.reviewPeriodSeconds ?? review * 86400,
      state: "funded",
      lastTransactionHash: hash,
      accessToken: prepared.access.clientToken,
      workerInviteToken: prepared.access.workerToken,
    };
    persist(next);
    setMessage("エスクローへ入金しました。");
  }
  async function action(
    name:
      | "submitDeliverable"
      | "requestRevision"
      | "acceptDeliverable"
      | "releaseAfterReview"
      | "refundUndelivered"
      | "cancelByWorker"
      | "openDispute",
    nextState: EscrowState,
  ) {
    if (!record) return;
    await ensureWallet();
    await wallet.switchChain(AMOY_CHAIN_ID);
    const actionName = ({
      submitDeliverable: "submit",
      requestRevision: "request_revision",
      acceptDeliverable: "accept",
      releaseAfterReview: "release",
      refundUndelivered: "refund_undelivered",
      cancelByWorker: "cancel_by_worker",
      openDispute: "dispute",
    } as const)[name];
    let prepared: { transaction?: { to: `0x${string}`; data: `0x${string}` }; error?: string };
    if (actionName === "submit") {
      const deliveryResponse = await fetch(`${API}/work-agreements/${record.id}/deliveries`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${record.accessToken}`,
        },
        body: JSON.stringify({ mode: deliveryMode, content }),
      });
      prepared = await deliveryResponse.json();
      if (!deliveryResponse.ok) throw new Error(prepared.error ?? "納品を準備できませんでした。");
    } else {
      const prepareResponse = await fetch(`${API}/work-agreements/${record.id}/actions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${record.accessToken}`,
        },
        body: JSON.stringify({
          action: actionName,
          content,
          revisedDeliverBy:
            actionName === "request_revision"
              ? Math.floor(Date.now() / 1000) + Math.max(1, Number(deliveryDays)) * 86400
              : undefined,
        }),
      });
      prepared = await prepareResponse.json();
      if (!prepareResponse.ok) throw new Error(prepared.error ?? "操作を準備できませんでした。");
    }
    if (!prepared.transaction) throw new Error("トランザクションを準備できませんでした。");
    const hash = await wallet.sendContractTransaction(prepared.transaction.to, prepared.transaction.data);
    setMessage("トランザクションの確定を待っています。");
    await waitForReceipt(hash);
    const confirmResponse = await fetch(`${API}/work-agreements/${record.id}/actions/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${record.accessToken}`,
      },
      body: JSON.stringify({ action: actionName, transactionHash: hash }),
    });
    const confirmed = (await confirmResponse.json()) as { error?: string };
    if (!confirmResponse.ok) throw new Error(confirmed.error ?? "オンチェーン状態を確認できませんでした。");
    persist({ ...record, state: nextState, lastTransactionHash: hash });
    setContent("");
    setMessage("状態を更新しました。");
  }
  async function resolution(actionName: "propose_resolution" | "accept_resolution") {
    if (!record) return;
    await ensureWallet();
    await wallet.switchChain(AMOY_CHAIN_ID);
    const amount = BigInt(record.amountWei);
    const clientAmount = amount / 2n;
    const workerGrossAmount = amount - clientAmount;
    const prepareResponse = await fetch(`${API}/work-agreements/${record.id}/actions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${record.accessToken}`,
      },
      body: JSON.stringify({
        action: actionName,
        clientAmount: clientAmount.toString(),
        workerGrossAmount: workerGrossAmount.toString(),
      }),
    });
    const prepared = (await prepareResponse.json()) as {
      transaction?: { to: `0x${string}`; data: `0x${string}` };
      error?: string;
    };
    if (!prepareResponse.ok || !prepared.transaction)
      throw new Error(prepared.error ?? "解決案を準備できませんでした。");
    const hash = await wallet.sendContractTransaction(prepared.transaction.to, prepared.transaction.data);
    await waitForReceipt(hash);
    const confirmResponse = await fetch(`${API}/work-agreements/${record.id}/actions/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${record.accessToken}`,
      },
      body: JSON.stringify({ action: actionName, transactionHash: hash }),
    });
    const confirmed = (await confirmResponse.json()) as { error?: string };
    if (!confirmResponse.ok) throw new Error(confirmed.error ?? "解決処理を確認できませんでした。");
    persist({
      ...record,
      state: actionName === "accept_resolution" ? "released" : "disputed",
      lastTransactionHash: hash,
    });
    setMessage(actionName === "accept_resolution" ? "解決案を承認しました。" : "50%ずつの解決案を提示しました。");
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "処理を完了できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  if (!record) {
    return (
      <section className="work-escrow-panel" aria-label="エスクロー契約">
        <h3>1%エスクローで依頼する</h3>
        <p>報酬はスマートコントラクトへ直接預け、検収完了時に受注者99%、Hub 1%へ分配します。</p>
        <label>受注者ウォレット<input value={workerAddress} onChange={(event) => setWorkerAddress(event.target.value)} placeholder="0x…" /></label>
        <div className="work-escrow-panel__grid">
          <label>報酬（Amoy POL）<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /></label>
          <label>納期（日）<input value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} type="number" min="1" max="365" /></label>
          <label>検収期間（日）<input value={reviewDays} onChange={(event) => setReviewDays(event.target.value)} type="number" min="1" max="30" /></label>
        </div>
        <button type="button" disabled={busy || config?.available !== true} onClick={() => void run(fund)}>
          {busy ? "処理中…" : "条件を確認して入金"}
        </button>
        <details>
          <summary>受注者として契約を読み込む</summary>
          <label>契約ID<input value={importId} onChange={(event) => setImportId(event.target.value)} /></label>
          <label>招待トークン<input value={importToken} onChange={(event) => setImportToken(event.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => void run(importAgreement)}>契約を読み込む</button>
        </details>
        {message ? <p role="status">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="work-escrow-panel" aria-label="エスクロー進行">
      <header><h3>エスクロー</h3><strong>{record.state}</strong></header>
      <dl>
        <div><dt>報酬</dt><dd>{polFromWei(record.amountWei)} POL</dd></div>
        <div><dt>手数料</dt><dd>1%（消費税込み）</dd></div>
        <div><dt>自分の役割</dt><dd>{role === "client" ? "発注者" : role === "worker" ? "受注者" : "閲覧者"}</dd></div>
      </dl>
      {(role === "worker" && ["funded", "revision_requested"].includes(record.state)) ||
      (role === "client" && record.state === "submitted") ||
      (["funded", "submitted", "revision_requested"].includes(record.state) && role !== "viewer") ? (
        <label>
          {role === "worker" ? "納品内容" : "修正理由・紛争証拠"}
          <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={4000} />
        </label>
      ) : null}
      <div className="work-escrow-panel__actions">
        {role === "worker" && ["funded", "revision_requested"].includes(record.state) ? <button disabled={busy} onClick={() => void run(() => action("submitDeliverable", "submitted"))}>納品を記録</button> : null}
        {role === "client" && record.state === "submitted" ? <>
          <button disabled={busy} onClick={() => void run(() => action("requestRevision", "revision_requested"))}>修正を依頼</button>
          <button disabled={busy} onClick={() => void run(() => action("acceptDeliverable", "released"))}>検収して支払う</button>
        </> : null}
        {record.state === "submitted" && role !== "viewer" ? <button disabled={busy} onClick={() => void run(() => action("releaseAfterReview", "released"))}>検収期限後に支払う</button> : null}
        {role === "client" && ["funded", "revision_requested"].includes(record.state) ? <button disabled={busy} onClick={() => void run(() => action("refundUndelivered", "refunded"))}>納期超過を返金</button> : null}
        {role === "worker" && record.state === "funded" ? <button disabled={busy} onClick={() => void run(() => action("cancelByWorker", "refunded"))}>受注を辞退</button> : null}
        {role !== "viewer" && ["funded", "submitted", "revision_requested"].includes(record.state) ? <button disabled={busy} onClick={() => void run(() => action("openDispute", "disputed"))}>紛争を開始</button> : null}
        {role !== "viewer" && record.state === "disputed" ? <>
          <button disabled={busy} onClick={() => void run(() => resolution("propose_resolution"))}>50%ずつの解決案を提示</button>
          <button disabled={busy} onClick={() => void run(() => resolution("accept_resolution"))}>相手の解決案を承認</button>
        </> : null}
      </div>
      {role === "worker" && ["funded", "revision_requested"].includes(record.state) ? (
        <label>
          納品方法
          <select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "text" | "external_link")}>
            <option value="text">テキスト</option>
            <option value="external_link">HTTPS外部リンク</option>
          </select>
        </label>
      ) : null}
      {record.workerInviteToken && role === "client" ? (
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(`${record.id}\n${record.workerInviteToken}`)}
        >
          受注者用の契約情報をコピー
        </button>
      ) : null}
      <button type="button" disabled={busy} onClick={() => void run(() => refresh())}>状態を更新</button>
      {activity.length ? (
        <ol className="work-escrow-panel__history" aria-label="契約履歴">
          {activity.map((item, index) => (
            <li key={`${item.createdAt}-${index}`}>
              <span>{item.eventType ?? item.action}</span>
              <time>{new Date(item.createdAt).toLocaleString("ja-JP")}</time>
            </li>
          ))}
        </ol>
      ) : null}
      {record.lastTransactionHash ? <a href={`https://amoy.polygonscan.com/tx/${record.lastTransactionHash}`} target="_blank" rel="noreferrer">最新の取引を確認</a> : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
