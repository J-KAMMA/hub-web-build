"use client";

import { useState } from "react";
import { keccak256 } from "viem";

type Provider = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
};

const DEFAULT_FEE_RECIPIENT = "0x307e6115eddb7ca3996804e30c3396034e04cb0d";

export function MarketplacePaymentDeployer() {
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState(
    "商品・サービス本体の1%だけをHubへ分配する決済コントラクトを配置します。",
  );
  const [feeRecipient,setFeeRecipient]=useState(DEFAULT_FEE_RECIPIENT);
  const [registration,setRegistration]=useState<Record<string,unknown>|null>(null);

  async function deploy() {
    setBusy(true);
    setRegistration(null);
    try {
      const provider=(window as Window&{ethereum?:Provider}).ethereum;
      if(!provider)throw new Error("対応ウォレットが見つかりません。");
      const response=await fetch(
        `/api/dev/marketplace-payment-deployment?feeRecipient=${encodeURIComponent(feeRecipient.trim())}`,
        {cache:"no-store"},
      );
      const body=await response.json() as {
        deploymentData?:string;feeRecipient?:string;error?:string;
      };
      if(!response.ok||!body.deploymentData||!body.feeRecipient)
        throw new Error(body.error??"配置データを取得できません。");
      const accounts=await provider.request({method:"eth_requestAccounts"});
      const from=Array.isArray(accounts)&&typeof accounts[0]==="string"
        ?accounts[0]:null;
      if(!from)throw new Error("ウォレットアカウントを確認できません。");
      await provider.request({
        method:"wallet_switchEthereumChain",
        params:[{chainId:"0x13882"}],
      });
      setMessage("配置内容とガス代をウォレットで確認してください。");
      const transactionHash=await provider.request({
        method:"eth_sendTransaction",
        params:[{from,data:body.deploymentData}],
      });
      if(typeof transactionHash!=="string")
        throw new Error("トランザクションを送信できませんでした。");
      for(let attempt=0;attempt<90;attempt+=1){
        if(attempt)await new Promise(resolve=>setTimeout(resolve,2_000));
        const receipt=await provider.request({
          method:"eth_getTransactionReceipt",
          params:[transactionHash],
        }) as {status?:string;contractAddress?:string}|null;
        if(!receipt)continue;
        if(receipt.status!=="0x1"||!receipt.contractAddress)
          throw new Error("コントラクト配置に失敗しました。");
        const runtimeCode=await provider.request({
          method:"eth_getCode",
          params:[receipt.contractAddress,"latest"],
        });
        if(typeof runtimeCode!=="string"||!/^0x[0-9a-f]{10,}$/i.test(runtimeCode))
          throw new Error("配置済みコードを検証できません。");
        setRegistration({
          networkKey:"eip155:80002",
          chainId:80002,
          contractAddress:receipt.contractAddress,
          contractVersion:1,
          deploymentTransactionHash:transactionHash,
          runtimeCodeHash:keccak256(runtimeCode as `0x${string}`),
          feeRecipient:body.feeRecipient,
          feeBps:100,
          reviewDigest:"marketplace-payment-v1",
        });
        setMessage("配置が完了しました。登録JSONをCommerce管理APIへ登録してください。");
        return;
      }
      throw new Error("送信済みです。チェーンでの確定を待っています。");
    }catch(error){
      setMessage(error instanceof Error?error.message:"配置できませんでした。");
    }finally{
      setBusy(false);
    }
  }

  async function copyRegistration(){
    if(!registration)return;
    await navigator.clipboard.writeText(JSON.stringify(registration,null,2));
    setMessage("Commerce登録用JSONをコピーしました。");
  }

  return <section className="commerce-order-page">
    <header>
      <small>AMOY TESTNET・VERSION 1</small>
      <h1>1%分配決済を配置</h1>
      <p>購入者の支払額を預からず、販売対象額の99%相当を販売者へ、1%をHubへ原子的に分配します。送料と税は手数料の計算対象外です。販売手数料は本体価格の1%（消費税込み）です。</p>
    </header>
    <section className="commerce-order-return">
      <label>
        Hub手数料受取先
        <input value={feeRecipient} onChange={event=>setFeeRecipient(event.target.value)}
          autoComplete="off" spellCheck={false}/>
      </label>
      <p role="status">{message}</p>
      <button disabled={busy} onClick={()=>void deploy()}>
        {busy?"処理中…":"ウォレットでAmoyへ配置"}
      </button>
      {registration?<>
        <pre>{JSON.stringify(registration,null,2)}</pre>
        <button type="button" onClick={()=>void copyRegistration()}>
          登録JSONをコピー
        </button>
      </>:null}
    </section>
  </section>;
}
