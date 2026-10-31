"use client";

import React from "react";
import { createContext, type ReactNode, startTransition, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { normalizeWalletAddress, parseChainId } from "@/lib/hub-wallet";
import { DEFAULT_CHAIN_ID } from "@/lib/wallet/networks";
import { createHardwareEvmProvider, listHardwareAccounts as listLedgerAccounts, type HardwareAccount, type HardwareDevice, type HardwareEvmProvider } from "@/lib/hardware-wallet";
import { HardwareSigningDialog } from "@/components/hardware-signing-dialog";
import { requestHardwareConfirmation } from "@/lib/hardware-wallet-prompt";
import { walletConnectErrorMessage, walletSwitchChainErrorMessage } from "@/lib/wallet-request-error";

export type HubEvmProvider = {
  request(input: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void): void;
};
type WalletStatus = "checking" | "idle" | "connecting" | "connected" | "unavailable" | "error";
export type HubWalletKind = "native" | "browser" | "external" | "none";
export type HubTransactionSubmission = {
  transactionHash: `0x${string}`;
  userOperationHash: `0x${string}` | null;
};
export type HubContractCall = {
  to: string;
  data: `0x${string}`;
  value?: `0x${string}`;
};
export type HubSponsorshipRequest = {
  orderId: string;
  accessToken: string;
  url: string;
  // Grant-bound orders whose grant declares a session key: an EIP-191
  // signature over {orderId, chainId, keccak256(callData)} produced by the
  // desktop-held session key. Commerce re-verifies it against the submitted
  // UserOperation's callData. Since 2026-10-17 no Hub caller sets it: AI
  // purchase proposals only open the cart, where the human checks out.
  sessionKeySignature?: `0x${string}`;
};
export type HubSponsoredCallPreview = {
  callData: `0x${string}`;
  callDataHash: `0x${string}`;
};
export type HubAtomicBatchCapability =
  | "hub-batch"
  | "single-contract"
  | "wallet-send-calls"
  | "unsupported";
export type HubPendingTransactionSubmission =
  | { kind: "transaction" | "hub-operation"; id: `0x${string}` }
  | { kind: "wallet-calls"; id: string };
type HubWalletValue = {
  address: string | null;
  chainId: number | null;
  status: WalletStatus;
  error: string;
  kind: HubWalletKind;
  connect(preference?: "smart" | "external" | "hardware"): Promise<boolean>;
  connectHardware(path?: string, device?: HardwareDevice): Promise<boolean>;
  listHardwareAccounts(device?: HardwareDevice): Promise<HardwareAccount[]>;
  signMessage(message: string): Promise<string>;
  signTypedData(payload: string): Promise<string>;
  signProfileLink(payload: string): Promise<string>;
  switchChain(chainId: number): Promise<void>;
  estimateNativeTransaction(to: string, value: `0x${string}`): Promise<`0x${string}`>;
  sendNativeTransaction(to: string, value: `0x${string}`): Promise<`0x${string}`>;
  sendContractTransaction(to: string, data: `0x${string}`): Promise<`0x${string}`>;
  sendContractTransactionWithValue(to:string,data:`0x${string}`,value:`0x${string}`):Promise<`0x${string}`>;
  estimateContractTransactionsMaximumCost(calls:HubContractCall[]):Promise<string>;
  getAtomicBatchCapability(chainId:number,calls:HubContractCall[],sponsorship?:HubSponsorshipRequest):Promise<HubAtomicBatchCapability>;
  sendAtomicContractTransactions(chainId:number,calls:HubContractCall[],sponsorship?:HubSponsorshipRequest):Promise<HubPendingTransactionSubmission>;
  resolveAtomicContractTransaction(submission:HubPendingTransactionSubmission):Promise<HubTransactionSubmission>;
  prepareSponsoredCalls(calls:HubContractCall[]):Promise<HubSponsoredCallPreview>;
  sendBatchContractTransactions(calls:HubContractCall[],sponsorship?:HubSponsorshipRequest):Promise<`0x${string}`>;
  sendSponsoredContractTransaction(to:string,data:`0x${string}`,sponsorship:HubSponsorshipRequest):Promise<`0x${string}`>;
  sendSponsoredNativeTransaction(to:string,value:`0x${string}`,sponsorship:HubSponsorshipRequest):Promise<`0x${string}`>;
  resolveTransactionSubmission(hash:`0x${string}`):Promise<HubTransactionSubmission>;
  getTransactionReceipt(hash: `0x${string}`): Promise<unknown>;
  hide(): void;
};

const disconnectedWallet: HubWalletValue = {
  address: null,
  chainId: null,
  status: "unavailable",
  error: "",
  kind: "none",
  connect: async () => false,
  connectHardware: async () => false,
  listHardwareAccounts: async () => { throw new Error("wallet_unavailable"); },
  signMessage: async () => {
    throw new Error("wallet_unavailable");
  },
  signTypedData: async () => { throw new Error("wallet_unavailable"); },
  signProfileLink: async () => { throw new Error("wallet_unavailable"); },
  switchChain: async () => {
    throw new Error("wallet_unavailable");
  },
  estimateNativeTransaction: async () => {
    throw new Error("wallet_unavailable");
  },
  sendNativeTransaction: async () => {
    throw new Error("wallet_unavailable");
  },
  sendContractTransaction: async () => {
    throw new Error("wallet_unavailable");
  },
  sendContractTransactionWithValue:async()=>{throw new Error("wallet_unavailable");},
  estimateContractTransactionsMaximumCost:async()=>{throw new Error("wallet_unavailable");},
  getAtomicBatchCapability:async()=>{throw new Error("wallet_unavailable");},
  sendAtomicContractTransactions:async()=>{throw new Error("wallet_unavailable");},
  resolveAtomicContractTransaction:async()=>{throw new Error("wallet_unavailable");},
  prepareSponsoredCalls:async()=>{throw new Error("wallet_unavailable");},
  sendBatchContractTransactions:async()=>{throw new Error("wallet_unavailable");},
  sendSponsoredContractTransaction: async () => { throw new Error("wallet_unavailable"); },
  sendSponsoredNativeTransaction: async () => { throw new Error("wallet_unavailable"); },
  resolveTransactionSubmission: async () => { throw new Error("wallet_unavailable"); },
  getTransactionReceipt: async () => null,
  hide: () => {},
};
const HubWalletContext = createContext<HubWalletValue>(disconnectedWallet);

let activeProviderPreference: "smart" | "external" | "hardware" | null = null;
let hardwareProvider: HardwareEvmProvider | null = null;
function selectedProvider(preference = activeProviderPreference): { provider: HubEvmProvider; kind: Exclude<HubWalletKind,"none"> } | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & { ethereum?: HubEvmProvider;hubNativeWallet?:HubEvmProvider&{isHubNativeWallet?:boolean};hubBrowserWallet?:HubEvmProvider&{isHubBrowserWallet?:boolean} };
  if(preference==="hardware")return hardwareProvider?{provider:hardwareProvider,kind:"external"}:null;
  if(preference==="external")return host.ethereum?{provider:host.ethereum,kind:"external"}:null;
  if(host.hubNativeWallet?.isHubNativeWallet)return {provider:host.hubNativeWallet,kind:"native"};
  if(host.hubBrowserWallet?.isHubBrowserWallet)return {provider:host.hubBrowserWallet,kind:"browser"};
  if(preference==="smart")return null;
  return host.ethereum?{provider:host.ethereum,kind:"external"}:null;
}

function validTransactionHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function validCallBundleId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 8_192
  );
}

function validContractCalls(calls: HubContractCall[]) {
  return (
    calls.length > 0 &&
    calls.length <= 4 &&
    calls.every(
      (call) =>
        /^0x[0-9a-fA-F]{40}$/.test(call.to) &&
        /^0x(?:[0-9a-fA-F]{2})*$/.test(call.data) &&
        (call.value == null || /^0x[0-9a-fA-F]+$/.test(call.value)),
    )
  );
}

function capabilityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function atomicCapabilityStatus(value: unknown) {
  const status = capabilityRecord(value).status;
  return status === "supported" || status === "ready" ? status : null;
}

export function getHubEvmProvider(): HubEvmProvider | null {
  return selectedProvider()?.provider ?? null;
}

export function encodePersonalSignMessage(message: string): `0x${string}` {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function HubWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<HubWalletKind>("none");

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    const bind = () => {
      const selected = selectedProvider();
      if (!selected) {
        // Initial provider discovery must not interrupt hydration of the page's
        // streamed Suspense boundary. Explicit wallet actions remain immediate.
        startTransition(() => setStatus("unavailable"));
        return;
      }
      const { provider } = selected;
      startTransition(() => setKind(selected.kind));
      const accountsChanged = (value: unknown) => {
        const accounts = Array.isArray(value) ? value : [];
        const nextAddress = normalizeWalletAddress(accounts[0]);
        setAddress(nextAddress);
        setError("");
        setStatus(nextAddress ? "connected" : "idle");
      };
      const chainChanged = (value: unknown) => setChainId(parseChainId(value));
      provider.on?.("accountsChanged", accountsChanged);
      provider.on?.("chainChanged", chainChanged);
      detach = () => {
        provider.removeListener?.("accountsChanged", accountsChanged);
        provider.removeListener?.("chainChanged", chainChanged);
      };
    };
    // ページ内ネイティブウォレットは状態が残っているときだけ登録される。
    // エンジン全体を初期バンドルに含めないよう動的 import にする。
    void import("@/lib/wallet/native-provider").then((module) => {
      if (cancelled) return;
      module.registerNativeWalletProvider();
      bind();
    }).catch(() => {
      if (!cancelled) bind();
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  const connect = useCallback(async (preference?:"smart"|"external"|"hardware") => {
    const selected = selectedProvider(preference??null);
    if (!selected) {
      setStatus("unavailable");
      setError("利用できるウォレットが見つかりません。");
      return false;
    }
    const { provider } = selected;
    activeProviderPreference=preference??(selected.kind==="external"?"external":"smart");
    setKind(selected.kind);
    setStatus("connecting");
    setError("");
    try {
      const accountsResult = await provider.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(accountsResult) ? accountsResult : [];
      const nextAddress = normalizeWalletAddress(accounts[0]);
      if (!nextAddress) throw new Error("wallet_account_missing");
      const chainResult = await provider.request({ method: "eth_chainId" });
      setAddress(nextAddress);
      setChainId(parseChainId(chainResult));
      setStatus("connected");
      return true;
    } catch (reason) {
      activeProviderPreference = null;
      setAddress(null);
      setStatus("error");
      // 断ったのか壊れているのかを言い分ける。同じ文言にすると、自分で断った人に
      // 再試行を迫る画面になる。番号の対応は lib/wallet-request-error.ts が持つ。
      setError(walletConnectErrorMessage(reason));
      return false;
    }
  }, []);

  const openHardwareApp = async (device: HardwareDevice) => {
    if (device === "trezor") return (await import("@/lib/hardware-wallet-trezor")).openTrezorEthApp();
    return (await import("@/lib/hardware-wallet-ledger")).openLedgerEthApp();
  };

  const listHardwareAccounts = useCallback(async (device: HardwareDevice = "ledger") => {
    const app = await openHardwareApp(device);
    try {
      return await listLedgerAccounts(app);
    } finally {
      try { await app.close?.(); } catch { /* device already gone */ }
    }
  }, []);

  const connectHardware = useCallback(async (path?: string, device: HardwareDevice = "ledger") => {
    void hardwareProvider?.close();
    hardwareProvider = createHardwareEvmProvider({
      openApp: () => openHardwareApp(device),
      path,
      chainId: DEFAULT_CHAIN_ID,
      confirm: requestHardwareConfirmation,
    });
    return connect("hardware");
  }, [connect]);

  const hide = useCallback(() => {
    void hardwareProvider?.close();
    hardwareProvider = null;
    activeProviderPreference = null;
    setAddress(null);
    setChainId(null);
    const selected = selectedProvider();
    setStatus(selected ? "idle" : "unavailable");
    setKind(selected?.kind ?? "none");
    setError("");
  }, []);

  const signMessage = useCallback(async (message: string) => {
    const provider = selectedProvider()?.provider;
    if (!provider || !address) throw new Error("wallet_not_connected");
    const signature = await provider.request({
      method: "personal_sign",
      params: [encodePersonalSignMessage(message), address],
    });
    if (typeof signature !== "string") throw new Error("wallet_signature_missing");
    return signature;
  }, [address]);

  const signTypedData = useCallback(async (payload: string) => {
    const provider = selectedProvider()?.provider;
    if (!provider || !address) throw new Error("wallet_not_connected");
    const signature = await provider.request({ method: "eth_signTypedData_v4", params: [address, payload] });
    if (typeof signature !== "string") throw new Error("wallet_signature_missing");
    return signature;
  }, [address]);
  const signProfileLink = useCallback(async (payload: string) => {
    const selected = selectedProvider();
    if (!selected || !address) throw new Error("wallet_not_connected");
    const method = selected.kind === "external" ? "eth_signTypedData_v4" : "hub_signProfileLink";
    const signature = await selected.provider.request({ method, params: [address, payload] });
    if (typeof signature !== "string") throw new Error("wallet_signature_missing");
    return signature;
  }, [address]);

  const switchChain = useCallback(async (nextChainId: number) => {
    const provider = selectedProvider()?.provider;
    if (!provider) throw new Error("wallet_unavailable");
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${nextChainId.toString(16)}` }],
      });
    } catch (reason) {
      // 断られたら元のチェーンに留まる。許可リスト外でも追加を促さない。
      setError(walletSwitchChainErrorMessage(reason));
      throw reason;
    }
    // 切り替えたつもりで進めない。実際の値を読み直してから反映する。
    const confirmed = parseChainId(await provider.request({ method: "eth_chainId" }));
    setChainId(confirmed);
    if (confirmed !== nextChainId) throw new Error("wallet_chain_mismatch");
  }, []);

  const sendNativeTransaction = useCallback(async (
    to: string,
    value: `0x${string}`,
  ) => {
    const provider = selectedProvider()?.provider;
    if (!provider || !address) throw new Error("wallet_not_connected");
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: address, to, value }],
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error("transaction_hash_missing");
    }
    return hash as `0x${string}`;
  }, [address]);

  const estimateNativeTransaction = useCallback(async (
    to: string,
    value: `0x${string}`,
  ) => {
    const provider = selectedProvider()?.provider;
    if (!provider || !address) throw new Error("wallet_not_connected");
    const estimate = await provider.request({ method: "eth_estimateGas", params: [{ from: address, to, value }] });
    if (typeof estimate !== "string" || !/^0x[0-9a-fA-F]+$/.test(estimate) || BigInt(estimate) <= 0n) throw new Error("transaction_simulation_failed");
    return estimate as `0x${string}`;
  }, [address]);

  const getTransactionReceipt = useCallback(async (hash: `0x${string}`) => {
    const provider = selectedProvider()?.provider;
    if (!provider) throw new Error("wallet_unavailable");
    return provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
  }, []);

  const resolveTransactionSubmission = useCallback(async (
    hash: `0x${string}`,
  ): Promise<HubTransactionSubmission> => {
    if (kind === "external") {
      return { transactionHash: hash, userOperationHash: null };
    }
    const provider = selectedProvider()?.provider;
    if (!provider) throw new Error("wallet_unavailable");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      });
      if (receipt && typeof receipt === "object") {
        const transactionHash = Reflect.get(receipt, "transactionHash");
        const userOperationHash = Reflect.get(receipt, "userOperationHash");
        if (
          typeof transactionHash === "string" &&
          /^0x[0-9a-fA-F]{64}$/.test(transactionHash) &&
          transactionHash.toLowerCase() !== hash.toLowerCase() &&
          (userOperationHash == null ||
            (typeof userOperationHash === "string" &&
              /^0x[0-9a-fA-F]{64}$/.test(userOperationHash) &&
              userOperationHash.toLowerCase() === hash.toLowerCase()))
        ) {
          return {
            transactionHash: transactionHash as `0x${string}`,
            userOperationHash: hash,
          };
        }
        throw new Error("invalid_user_operation_receipt");
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error("user_operation_receipt_timeout");
  }, [kind]);

  const sendContractTransaction = useCallback(async (to: string, data: `0x${string}`) => {
    const provider = selectedProvider()?.provider;
    if (!provider || !address) throw new Error("wallet_not_connected");
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: address, to, data, value: "0x0" }],
    });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("transaction_hash_missing");
    return hash as `0x${string}`;
  }, [address]);
  const sendContractTransactionWithValue=useCallback(async(to:string,data:`0x${string}`,value:`0x${string}`)=>{
    const provider=selectedProvider()?.provider;
    if(!provider||!address)throw new Error("wallet_not_connected");
    const hash=await provider.request({method:"eth_sendTransaction",params:[{from:address,to,data,value}]});
    if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("transaction_hash_missing");
    return hash as `0x${string}`;
  },[address]);
  const estimateContractTransactionsMaximumCost=useCallback(async(calls:HubContractCall[])=>{
    const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");
    if(!validContractCalls(calls))throw new Error("invalid_transaction_batch");
    const [gasPrice,...gasLimits]=await Promise.all([
      selected.provider.request({method:"eth_gasPrice",params:[]}),
      ...calls.map(call=>selected.provider.request({method:"eth_estimateGas",params:[{from:address,to:call.to,data:call.data,value:call.value??"0x0"}]})),
    ]);
    if(typeof gasPrice!=="string"||!/^0x[0-9a-fA-F]+$/.test(gasPrice)||gasLimits.some(value=>typeof value!=="string"||!/^0x[0-9a-fA-F]+$/.test(value as string)))throw new Error("gas_estimate_unavailable");
    const totalGas=gasLimits.reduce<bigint>((sum,value)=>sum+BigInt(value as string),0n);
    return ((totalGas*BigInt(gasPrice)*120n+99n)/100n).toString();
  },[address]);

  const getAtomicBatchCapability=useCallback(async(
    nextChainId:number,
    calls:HubContractCall[],
    sponsorship?:HubSponsorshipRequest,
  ):Promise<HubAtomicBatchCapability>=>{
    const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");
    if(!Number.isSafeInteger(nextChainId)||nextChainId<=0||!validContractCalls(calls))throw new Error("invalid_transaction_batch");
    if(selected.kind!=="external")return "hub-batch";
    if(!sponsorship&&calls.length===1)return "single-contract";
    // Commerce sponsorship requires an authenticated Hub-wallet exchange and
    // must not be forwarded to an arbitrary injected wallet.
    if(sponsorship)return "unsupported";
    const chainIdHex=`0x${nextChainId.toString(16)}`;
    try{
      const result=capabilityRecord(await selected.provider.request({
        method:"wallet_getCapabilities",
        params:[address,[chainIdHex]],
      }));
      const globalCapabilities=capabilityRecord(result["0x0"]);
      const chainEntry=Object.entries(result).find(([key])=>key.toLowerCase()===chainIdHex.toLowerCase())?.[1];
      const chainCapabilities=capabilityRecord(chainEntry);
      const atomic=chainCapabilities.atomic??globalCapabilities.atomic;
      return atomicCapabilityStatus(atomic)?"wallet-send-calls":"unsupported";
    }catch{
      return "unsupported";
    }
  },[address]);

  const sendAtomicContractTransactions=useCallback(async(
    nextChainId:number,
    calls:HubContractCall[],
    sponsorship?:HubSponsorshipRequest,
  ):Promise<HubPendingTransactionSubmission>=>{
    const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");
    const capability=await getAtomicBatchCapability(nextChainId,calls,sponsorship);
    if(capability==="unsupported")throw new Error("wallet_atomic_batch_unsupported");
    if(capability==="single-contract"){
      const call=calls[0];
      const result=await selected.provider.request({
        method:"eth_sendTransaction",
        params:[{from:address,to:call.to,data:call.data,value:call.value??"0x0"}],
      });
      if(!validTransactionHash(result))throw new Error("transaction_hash_missing");
      return {kind:"transaction",id:result};
    }
    if(capability==="hub-batch"){
      const result=await selected.provider.request({
        method:"hub_sendBatchTransaction",
        params:[{
          from:address,
          calls:calls.map(call=>({...call,value:call.value??"0x0"})),
          hubGasSponsorship:sponsorship??null,
        }],
      });
      if(!validTransactionHash(result))throw new Error("transaction_hash_missing");
      return {kind:"hub-operation",id:result};
    }
    const result=await selected.provider.request({
      method:"wallet_sendCalls",
      params:[{
        version:"2.0.0",
        from:address,
        chainId:`0x${nextChainId.toString(16)}`,
        atomicRequired:true,
        calls:calls.map(call=>({...call,value:call.value??"0x0"})),
      }],
    });
    const id=capabilityRecord(result).id;
    if(!validCallBundleId(id))throw new Error("wallet_call_bundle_id_missing");
    return {kind:"wallet-calls",id};
  },[address,getAtomicBatchCapability]);

  const resolveAtomicContractTransaction=useCallback(async(
    submission:HubPendingTransactionSubmission,
  ):Promise<HubTransactionSubmission>=>{
    if(submission.kind==="transaction"){
      if(!validTransactionHash(submission.id))throw new Error("transaction_hash_missing");
      return {transactionHash:submission.id,userOperationHash:null};
    }
    const selected=selectedProvider(
      submission.kind==="wallet-calls"?"external":"smart",
    );
    if(!selected)throw new Error("wallet_unavailable");
    if(submission.kind==="hub-operation"){
      for(let attempt=0;attempt<60;attempt+=1){
        const receipt=await selected.provider.request({
          method:"eth_getTransactionReceipt",
          params:[submission.id],
        });
        if(receipt&&typeof receipt==="object"){
          const transactionHash=Reflect.get(receipt,"transactionHash");
          const userOperationHash=Reflect.get(receipt,"userOperationHash");
          if(
            validTransactionHash(transactionHash)&&
            transactionHash.toLowerCase()!==submission.id.toLowerCase()&&
            (userOperationHash==null||
              (validTransactionHash(userOperationHash)&&
                userOperationHash.toLowerCase()===submission.id.toLowerCase()))
          )return {transactionHash,userOperationHash:submission.id};
          throw new Error("invalid_user_operation_receipt");
        }
        await new Promise(resolve=>setTimeout(resolve,2_000));
      }
      throw new Error("user_operation_receipt_timeout");
    }
    for(let attempt=0;attempt<60;attempt+=1){
      let result:Record<string,unknown>;
      try{
        result=capabilityRecord(await selected.provider.request({
          method:"wallet_getCallsStatus",
          params:[submission.id],
        }));
      }catch{
        throw new Error("wallet_call_status_unavailable");
      }
      const status=result.status;
      if(typeof status==="number"&&status>=400)throw new Error("wallet_call_batch_failed");
      if(status===200){
        if(result.atomic!==true)throw new Error("wallet_call_batch_not_atomic");
        const receipts=Array.isArray(result.receipts)?result.receipts:[];
        const receipt=receipts.at(-1);
        const transactionHash=capabilityRecord(receipt).transactionHash;
        const transactionStatus=capabilityRecord(receipt).status;
        if(transactionStatus!=="0x1"||!validTransactionHash(transactionHash))
          throw new Error("wallet_call_batch_receipt_invalid");
        return {transactionHash,userOperationHash:null};
      }
      await new Promise(resolve=>setTimeout(resolve,2_000));
    }
    throw new Error("wallet_call_batch_confirmation_timeout");
  },[]);

  const prepareSponsoredCalls=useCallback(async(calls:HubContractCall[]):Promise<HubSponsoredCallPreview>=>{
    const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");
    if(selected.kind==="external")throw new Error("merchant_sponsorship_requires_hub_wallet");
    if(!validContractCalls(calls))throw new Error("invalid_transaction_batch");
    const result=await selected.provider.request({method:"hub_prepareSponsoredCall",params:[{from:address,calls:calls.map(call=>({...call,value:call.value??"0x0"}))}]});
    const record=capabilityRecord(result);
    if(!/^0x(?:[0-9a-fA-F]{2})*$/.test(String(record.callData??""))||!validTransactionHash(record.callDataHash))throw new Error("sponsored_call_preview_invalid");
    return {callData:String(record.callData) as `0x${string}`,callDataHash:record.callDataHash};
  },[address]);
  const sendBatchContractTransactions=useCallback(async(calls:HubContractCall[],sponsorship?:HubSponsorshipRequest)=>{
    const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");
    if(!validContractCalls(calls))throw new Error("invalid_transaction_batch");
    if(selected.kind==="external"){
      if(sponsorship)throw new Error("merchant_sponsorship_requires_hub_wallet");
      if(calls.length!==1)throw new Error("wallet_atomic_batch_unsupported");
      const call=calls[0];
      const result=await selected.provider.request({
        method:"eth_sendTransaction",
        params:[{from:address,to:call.to,data:call.data,value:call.value??"0x0"}],
      });
      if(!validTransactionHash(result))throw new Error("transaction_hash_missing");
      return result;
    }
    const result=await selected.provider.request({method:"hub_sendBatchTransaction",params:[{from:address,calls:calls.map(call=>({...call,value:call.value??"0x0"})),hubGasSponsorship:sponsorship??null}]});
    if(!validTransactionHash(result))throw new Error("transaction_hash_missing");
    return result;
  },[address]);
  const sendSponsoredContractTransaction=useCallback(async(to:string,data:`0x${string}`,sponsorship:HubSponsorshipRequest)=>{const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");if(selected.kind==="external")throw new Error("merchant_sponsorship_requires_hub_wallet");const hash=await selected.provider.request({method:"eth_sendTransaction",params:[{from:address,to,data,value:"0x0",hubGasSponsorship:sponsorship}]});if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("transaction_hash_missing");return hash as `0x${string}`},[address]);
  const sendSponsoredNativeTransaction=useCallback(async(to:string,value:`0x${string}`,sponsorship:HubSponsorshipRequest)=>{const selected=selectedProvider();if(!selected||!address)throw new Error("wallet_not_connected");if(selected.kind==="external")throw new Error("merchant_sponsorship_requires_hub_wallet");const hash=await selected.provider.request({method:"eth_sendTransaction",params:[{from:address,to,data:"0x",value,hubGasSponsorship:sponsorship}]});if(typeof hash!=="string"||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error("transaction_hash_missing");return hash as `0x${string}`},[address]);

  const value = useMemo(
    () => ({
      address,
      chainId,
      status,
      error,
      kind,
      connect,
      connectHardware,
      listHardwareAccounts,
      signMessage,
      signTypedData,
      signProfileLink,
      switchChain,
      estimateNativeTransaction,
      sendNativeTransaction,
      sendContractTransaction,
      sendContractTransactionWithValue,
      estimateContractTransactionsMaximumCost,
      getAtomicBatchCapability,
      sendAtomicContractTransactions,
      resolveAtomicContractTransaction,
      prepareSponsoredCalls,
      sendBatchContractTransactions,
      sendSponsoredContractTransaction,
      sendSponsoredNativeTransaction,
      resolveTransactionSubmission,
      getTransactionReceipt,
      hide,
    }),
    [
      address,
      chainId,
      status,
      error,
      kind,
      connect,
      connectHardware,
      listHardwareAccounts,
      signMessage,
      signTypedData,
      signProfileLink,
      switchChain,
      estimateNativeTransaction,
      sendNativeTransaction,
      sendContractTransaction,
      sendContractTransactionWithValue,
      estimateContractTransactionsMaximumCost,
      getAtomicBatchCapability,
      sendAtomicContractTransactions,
      resolveAtomicContractTransaction,
      prepareSponsoredCalls,
      sendBatchContractTransactions,
      sendSponsoredContractTransaction,
      sendSponsoredNativeTransaction,
      resolveTransactionSubmission,
      getTransactionReceipt,
      hide,
    ],
  );
  return <HubWalletContext.Provider value={value}>{children}<HardwareSigningDialog /></HubWalletContext.Provider>;
}

export function useHubWallet(): HubWalletValue {
  return useContext(HubWalletContext);
}
