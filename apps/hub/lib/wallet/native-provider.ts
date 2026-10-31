// Web版Hubウォレットの EIP-1193/Hub プロバイダ。
// window.hubNativeWallet として登録され、hub-wallet-provider.tsx の既存の
// kind="native" 経路にそのまま乗る。署名・送信はすべて
// approval-bridge 経由の明示承認 → パスキー署名 → UserOperation 送信。

import { DEFAULT_CHAIN_ID, ENTRY_POINT_V08, normalizeChainId, walletNetwork, assertTransactionNetwork } from "./networks";
import { rpcRequest } from "./rpc-client";
import { resolveSmartAccount } from "./smart-account";
import { BundlerClient, createActivationUserOperation } from "./bundler";
import { prepareSigningRequest } from "./signing";
import { signWalletHash } from "./passkey";
import { analyzeTransactionData } from "./security-analysis";
import { assertSupportedMethod, RPC_READ_METHODS } from "./policy";
import { estimateMaximumNetworkFee, clearApprovedMaximumNetworkFee, formatNativeQuantity, parseDappTransactionRequest, parseHubBatchRequest, parseHubPrepareRequest } from "./transaction-request";
import { previewSponsoredCallData } from "./transaction";
import { submitDappCalls, submitDappTransaction, submitWalletUserOperation } from "./engine";
import { requestWalletApproval, type WalletApprovalRequest } from "./approval-bridge";
import { loadNativeWalletState, saveNativeWalletState, type NativeWalletState } from "./storage";
import { verifyUserOperationOnChain } from "./onchain-verification";
import { describePurchaseCall } from "../gohotoken/purchase-display";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const APPROVAL_REJECTED = () => Object.assign(new Error("wallet_rejected"), { code: 4001 });

export type ProviderEvent = "accountsChanged" | "chainChanged";
type Listener = (value: unknown) => void;

type ProviderRequest = { method: string; params?: unknown[] | object };

function stateOrThrow(): NativeWalletState {
  const state = loadNativeWalletState();
  if (!state) throw Object.assign(new Error("wallet_not_created"), { code: 4100 });
  return state;
}

function activeAddress(state: NativeWalletState): string | null {
  const value = state.smartAccountAddresses[state.chainId];
  return value && ADDRESS.test(value) ? value.toLowerCase() : null;
}

async function ensureAccountAddress(state: NativeWalletState): Promise<string> {
  const existing = activeAddress(state);
  if (existing) return existing;
  const network = walletNetwork(state.chainId);
  if (!network?.smartAccountFactory) throw new Error("wallet_network_unavailable");
  const account = await resolveSmartAccount({
    rpcUrls: network.rpcUrls,
    chainId: state.chainId,
    factoryAddress: network.smartAccountFactory,
    qx: state.passkeyQx,
    qy: state.passkeyQy,
    salt: BigInt(state.passkeySalt),
  });
  state.smartAccountAddresses[state.chainId] = account;
  saveNativeWalletState(state);
  return account;
}

function isActivated(state: NativeWalletState, account: string): boolean {
  return state.activeSmartAccounts[state.chainId]?.address?.toLowerCase() === account.toLowerCase();
}

/** Hub運用バンドラーの既定URL（チェーンスコープの絶対URL。BundlerClientのsafeRpcUrl検査を通す）。 */
export function defaultBundlerUrl(chainId: string): string {
  const url = new URL("/api/wallet/bundler", typeof location !== "undefined" ? location.origin : "https://hub.jkamma.com");
  url.searchParams.set("chain", chainId);
  return url.toString();
}

function bundlerClient(state: NativeWalletState): BundlerClient {
  return new BundlerClient(state.bundlerUrls[state.chainId] ?? defaultBundlerUrl(state.chainId));
}

export type NativeWalletProvider = {
  isHubNativeWallet: true;
  request(input: ProviderRequest): Promise<unknown>;
  on(event: ProviderEvent, listener: Listener): void;
  removeListener(event: ProviderEvent, listener: Listener): void;
};

export function createNativeWalletProvider(): NativeWalletProvider {
  const listeners: Record<ProviderEvent, Set<Listener>> = { accountsChanged: new Set(), chainChanged: new Set() };
  const emit = (event: ProviderEvent, value: unknown) => {
    for (const listener of listeners[event]) {
      try { listener(value); } catch { /* listener errors must not break the provider */ }
    }
  };

  const approve = async (request: WalletApprovalRequest): Promise<true> => {
    if (!(await requestWalletApproval(request))) {
      clearApprovedMaximumNetworkFee(request.chainId);
      throw APPROVAL_REJECTED();
    }
    return true;
  };

  const request = async ({ method, params }: ProviderRequest): Promise<unknown> => {
    assertSupportedMethod(method);
    const rpcParams = Array.isArray(params) ? params : params == null ? [] : [params];

    if (method === "eth_chainId") return stateOrThrow().chainId;
    if (method === "eth_accounts") {
      const state = loadNativeWalletState();
      const account = state ? activeAddress(state) : null;
      return account ? [account] : [];
    }
    if (method === "eth_requestAccounts") {
      const state = stateOrThrow();
      return [await ensureAccountAddress(state)];
    }
    if (method === "net_version") return String(Number(normalizeChainId(stateOrThrow().chainId)));
    if (method === "wallet_revokePermissions") {
      emit("accountsChanged", []);
      return null;
    }
    if (method === "wallet_switchEthereumChain") {
      const requested = normalizeChainId((rpcParams[0] as { chainId?: string })?.chainId ?? "");
      const state = stateOrThrow();
      if (requested !== state.chainId) {
        const network = walletNetwork(requested);
        if (!network || network.transactionEnabled !== true) throw Object.assign(new Error("unsupported_chain"), { code: 4902 });
        state.chainId = requested;
        saveNativeWalletState(state);
      }
      emit("chainChanged", requested);
      return null;
    }
    if (method === "wallet_addEthereumChain") throw Object.assign(new Error("unsupported_chain"), { code: 4902 });
    if (method === "wallet_getCapabilities") {
      const chainId = stateOrThrow().chainId;
      return { [chainId]: { atomic: { status: "supported" }, paymasterService: { supported: false } } };
    }

    const state = stateOrThrow();
    const network = walletNetwork(state.chainId);
    if (!network) throw new Error("wallet_network_unavailable");

    if (RPC_READ_METHODS.has(method)) {
      if (method === "eth_getTransactionReceipt") {
        const hash = String(rpcParams[0] ?? "");
        if (HASH.test(hash)) {
          const bundlerReceipt = await bundlerClient(state).receipt(hash).catch(() => null) as { receipt?: { transactionHash?: string }; userOpHash?: string; sender?: string; success?: boolean } | null;
          if (bundlerReceipt?.receipt?.transactionHash) {
            const { result } = await rpcRequest(network.rpcUrls, state.chainId, "eth_getTransactionReceipt", [bundlerReceipt.receipt.transactionHash]);
            if (result && typeof result === "object") return { ...(result as object), userOperationHash: hash.toLowerCase() };
          }
        }
        const { result } = await rpcRequest(network.rpcUrls, state.chainId, method, rpcParams);
        return result;
      }
      const { result } = await rpcRequest(network.rpcUrls, state.chainId, method, rpcParams);
      return result;
    }

    const account = await ensureAccountAddress(state);

    if (method === "personal_sign" || method === "eth_signTypedData_v4" || method === "hub_signProfileLink") {
      const prepared = prepareSigningRequest(
        { method, params: rpcParams },
        { chainId: state.chainId, smartAccountAddresses: state.smartAccountAddresses, activeSmartAccounts: state.activeSmartAccounts },
        { origin: typeof location !== "undefined" ? location.origin : "" },
      );
      await approve({ title: prepared.title, detailLabel: prepared.detailLabel, detail: prepared.detail, risk: prepared.risk, warning: prepared.warning, account: prepared.account, chainId: state.chainId });
      return signWalletHash(state, prepared.hash, navigator.credentials);
    }

    if (method === "hub_prepareSponsoredCall") {
      const parsed = parseHubPrepareRequest({ method, params: rpcParams }, { account, chainId: state.chainId, trustedHubOrigin: true });
      return previewSponsoredCallData({ rpcUrls: network.rpcUrls, chainId: state.chainId, account, calls: parsed.calls });
    }

    if (method === "eth_sendTransaction" || method === "hub_sendBatchTransaction" || method === "wallet_sendCalls") {
      assertTransactionNetwork(state.chainId);
      state.bundlerUrls[state.chainId] ??= defaultBundlerUrl(state.chainId);
      const fee = await estimateMaximumNetworkFee(network, state.chainId);
      if (method === "eth_sendTransaction") {
        const parsed = parseDappTransactionRequest({ method, params: rpcParams }, { account, chainId: state.chainId, trustedHubOrigin: true });
        const dataAnalysis = describePurchaseCall(parsed, state.chainId) ?? analyzeTransactionData(parsed.data);
        const value = BigInt(parsed.value);
        await approve({
          title: "トランザクションの確認",
          detailLabel: "送信内容",
          detail: `to: ${parsed.to}\nvalue: ${formatNativeQuantity(value, network)}\n${dataAnalysis.summary}`,
          risk: dataAnalysis.risk === "normal" ? "caution" : dataAnalysis.risk,
          warning: dataAnalysis.warning,
          account,
          chainId: state.chainId,
          fee,
        });
        return submitDappTransaction({
          chainId: state.chainId,
          transaction: { from: parsed.from, to: parsed.to, value: parsed.value, data: parsed.data, hubGasSponsorship: parsed.hubGasSponsorship ?? undefined },
          state,
          credentials: navigator.credentials,
        });
      }
      const calls = method === "hub_sendBatchTransaction"
        ? (() => {
            const parsed = parseHubBatchRequest({ method, params: rpcParams }, { account, chainId: state.chainId, trustedHubOrigin: true });
            return { calls: parsed.calls, hubGasSponsorship: parsed.hubGasSponsorship };
          })()
        : (() => {
            const input = (rpcParams[0] ?? {}) as { from?: string; chainId?: string; calls?: { to?: string; value?: string; data?: string }[] };
            const parsed = parseHubBatchRequest({ method: "hub_sendBatchTransaction", params: [{ from: input.from ?? account, chainId: state.chainId, calls: input.calls }] }, { account, chainId: state.chainId, trustedHubOrigin: true });
            return { calls: parsed.calls, hubGasSponsorship: null };
          })();
      const totalValue = calls.calls.reduce((sum, call) => sum + BigInt(call.value), 0n);
      const analyses = calls.calls.map((call) => analyzeTransactionData(call.data));
      const risk = analyses.some((item) => item.risk === "danger") ? "danger" : analyses.some((item) => item.risk === "warning") ? "warning" : "caution";
      await approve({
        title: method === "wallet_sendCalls" ? "バッチ実行の確認" : "注文支払いの確認",
        detailLabel: "呼び出し",
        detail: `${calls.calls.length}件の呼び出し / 合計 ${formatNativeQuantity(totalValue, network)}\n${analyses.map((item, index) => `${index + 1}. ${item.summary}`).join("\n")}`,
        risk,
        warning: analyses.map((item) => item.warning).filter(Boolean).join(" ") || "内容を確認してから承認してください。",
        account,
        chainId: state.chainId,
        fee,
      });
      const userOpHash = await submitDappCalls({
        chainId: state.chainId,
        from: account,
        calls: calls.calls,
        state,
        credentials: navigator.credentials,
        hubGasSponsorship: calls.hubGasSponsorship ?? undefined,
        approvedMaximumCostAtomic: fee.atomic,
      });
      if (method === "wallet_sendCalls") return { id: userOpHash };
      return userOpHash;
    }

    if (method === "wallet_getCallsStatus") {
      const hash = String(rpcParams[0] ?? "");
      if (!HASH.test(hash)) throw new Error("invalid_user_operation_hash");
      const receipt = await bundlerClient(state).receipt(hash).catch(() => null) as { success?: boolean; receipt?: { transactionHash?: string; blockHash?: string; blockNumber?: string } } | null;
      if (!receipt) return { status: 100, atomic: true, chainId: state.chainId, id: hash, receipts: [] };
      if (receipt.success !== true) return { status: 400, atomic: true, chainId: state.chainId, id: hash, receipts: receipt.receipt ? [{ status: "0x0", transactionHash: receipt.receipt.transactionHash, blockHash: receipt.receipt.blockHash, blockNumber: receipt.receipt.blockNumber }] : [] };
      return { status: 200, atomic: true, chainId: state.chainId, id: hash, receipts: [{ status: "0x1", transactionHash: receipt.receipt?.transactionHash, blockHash: receipt.receipt?.blockHash, blockNumber: receipt.receipt?.blockNumber }] };
    }

    throw Object.assign(new Error("unsupported_method"), { code: 4200 });
  };

  return {
    isHubNativeWallet: true,
    request,
    on(event, listener) { listeners[event].add(listener); },
    removeListener(event, listener) { listeners[event].delete(listener); },
  };
}

type HostWindow = Window & { hubNativeWallet?: NativeWalletProvider };

/** 既存ウォレット状態があるときだけプロバイダを window へ登録する。
 *  デスクトップアプリが注入した hubNativeWallet が既にある場合はそちらを優先する。 */
export function registerNativeWalletProvider(): NativeWalletProvider | null {
  if (typeof window === "undefined") return null;
  const host = window as HostWindow;
  if (host.hubNativeWallet?.isHubNativeWallet) return host.hubNativeWallet;
  if (!loadNativeWalletState()) return null;
  const provider = createNativeWalletProvider();
  host.hubNativeWallet = provider;
  return provider;
}

/** ウォレット新規作成直後に呼ぶ。状態ができているので登録を確実に行う。 */
export function installNativeWalletProvider(): NativeWalletProvider {
  if (typeof window === "undefined") throw new Error("wallet_unavailable");
  const host = window as HostWindow;
  if (host.hubNativeWallet?.isHubNativeWallet) return host.hubNativeWallet;
  const provider = createNativeWalletProvider();
  host.hubNativeWallet = provider;
  return provider;
}

/** アカウント有効化（最初のUserOperation）。未デプロイ時のみ呼ぶ。
 *  料金上限の見積→承認→署名→送信を一連で行う。 */
export async function activateNativeWallet(): Promise<string> {
  const state = stateOrThrow();
  const network = assertTransactionNetwork(state.chainId);
  const account = await ensureAccountAddress(state);
  if (!network.smartAccountFactory) throw new Error("wallet_network_unavailable");
  const baseOperation = createActivationUserOperation({
    sender: account,
    factory: network.smartAccountFactory,
    qx: state.passkeyQx,
    qy: state.passkeyQy,
    salt: BigInt(state.passkeySalt),
  });
  const fee = await estimateMaximumNetworkFee(network, state.chainId);
  if (!(await requestWalletApproval({
    title: "ウォレットの有効化",
    detailLabel: "アカウント",
    detail: `${account}\n${network.name}上にスマートアカウントを作成します。`,
    risk: "caution",
    warning: "パスキー署名で最初のUserOperationを送信します。",
    account,
    chainId: state.chainId,
    fee,
  }))) {
    clearApprovedMaximumNetworkFee(state.chainId);
    throw APPROVAL_REJECTED();
  }
  state.bundlerUrls[state.chainId] ??= defaultBundlerUrl(state.chainId);
  const userOpHash = await submitWalletUserOperation({
    chainId: state.chainId,
    state,
    callData: baseOperation.callData,
    baseOperation,
    credentials: navigator.credentials,
    approvedMaximumCostAtomic: fee.atomic,
  });
  state.activeSmartAccounts[state.chainId] = { address: account, activatedAt: new Date().toISOString(), userOperationHash: userOpHash };
  saveNativeWalletState(state);
  return userOpHash;
}

/** 送信済みUserOperationのオンチェーン確認。 */
export async function confirmNativeWalletOperation(userOperationHash: string): Promise<{ transactionHash: string; success: true }> {
  const state = stateOrThrow();
  const network = assertTransactionNetwork(state.chainId);
  const account = activeAddress(state);
  if (!account) throw new Error("wallet_not_created");
  const bundlerReceipt = await bundlerClient(state).receipt(userOperationHash) as { receipt?: { transactionHash?: string }; userOpHash?: string; sender?: string; success?: boolean } | null;
  if (!bundlerReceipt) throw new Error("user_operation_receipt_pending");
  const verified = await verifyUserOperationOnChain({
    rpcUrls: network.rpcUrls,
    chainId: state.chainId,
    userOperationHash,
    expectedSender: account,
    bundlerReceipt,
  });
  return { transactionHash: verified.transactionHash, success: true };
}
