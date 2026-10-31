// apps/wallet-extension/src/wallet-engine.js の移植。
// UserOperation の準備・ガス上限・署名・送信までの一連の流れ。

import { BundlerClient, encodeCreateAccount, encodeEmptyV2Execution } from "./bundler";
import { assertTransactionNetwork, normalizeChainId, type HubWalletNetwork } from "./networks";
import { dummyWebAuthnSignature, signWalletHash } from "./passkey";
import { createTransferUserOperation, encodeContractCall, encodeContractCalls, getAccountNonce, getAuthorizationEpoch, rebindAuthorizationEpoch } from "./transaction";
import { applyFeeCeilings, applyGasEstimate, assertEstimateWithinCeilings, getUserOperationHash, maximumUserOperationCost, type WalletUserOperation } from "./user-operation";
import { AlchemyGasManagerClient, PaymasterClient } from "./paymaster";
import { requestCommerceSponsorship, type CommerceSponsorshipRequest } from "./commerce-sponsorship";
import { verifyWalletDeployment } from "./onchain-verification";
import { readApprovedMaximumNetworkFee } from "./transaction-request";
import type { NativeWalletState } from "./storage";
import type { WalletFetcher } from "./json-rpc";

type Fetcher = WalletFetcher;
type StateGuard = (phase: "before_prepare" | "before_sign" | "after_sign" | "before_submit") => Promise<void> | void;

async function guard(stateGuard: StateGuard | null | undefined, phase: Parameters<StateGuard>[0]) {
  if (stateGuard) await stateGuard(phase);
}

function activeSender(state: NativeWalletState, chainId: string): string {
  const sender = state.smartAccountAddresses?.[chainId] ?? (state as { smartAccountAddress?: string }).smartAccountAddress;
  const active = state.activeSmartAccounts?.[chainId];
  if (!sender || active?.address?.toLowerCase() !== sender.toLowerCase()) throw new Error("smart_wallet_not_activated");
  return sender.toLowerCase();
}

export function assertApprovedMaximumCost(operation: WalletUserOperation, approvedMaximumCostAtomic: bigint | string): true {
  const approvedMaximum = BigInt(approvedMaximumCostAtomic);
  if (approvedMaximum <= 0n || maximumUserOperationCost(operation) > approvedMaximum) throw new Error("transaction_fee_changed_requires_approval");
  return true;
}

export function assertActivationOperation(operation: WalletUserOperation, state: NativeWalletState, chainId: string, network: HubWalletNetwork): true {
  const sender = state.smartAccountAddresses?.[chainId] ?? (state as { smartAccountAddress?: string }).smartAccountAddress;
  const configuredFactory = (state as { factoryAddresses?: Record<string, string> }).factoryAddresses?.[chainId];
  if (!sender || operation?.sender?.toLowerCase() !== sender.toLowerCase()) throw new Error("activation_sender_mismatch");
  if (!network?.smartAccountFactory || operation?.factory?.toLowerCase() !== network.smartAccountFactory.toLowerCase()) throw new Error("activation_factory_mismatch");
  if (configuredFactory && configuredFactory.toLowerCase() !== network.smartAccountFactory.toLowerCase()) throw new Error("activation_factory_configuration_mismatch");
  if (!state.passkeyQx || !state.passkeyQy) throw new Error("activation_signer_unavailable");
  if (operation.factoryData?.toLowerCase() !== encodeCreateAccount(state.passkeyQx, state.passkeyQy, 0n).toLowerCase()) throw new Error("activation_factory_data_mismatch");
  if (operation.callData?.toLowerCase() !== encodeEmptyV2Execution(1n).toLowerCase() || BigInt(operation.nonce ?? -1) !== 0n || operation.signature !== "0x") throw new Error("activation_operation_invalid");
  return true;
}

export async function submitWalletUserOperation({ chainId, state, callData, baseOperation = null, allowRecoverySignature = false, credentials, fetcher = fetch as Fetcher, stateGuard = null, hashOptions = {}, verifyDeployment = true, hubGasSponsorship = null, approvedMaximumCostAtomic = null }: {
  chainId: string | number | bigint;
  state: NativeWalletState;
  callData: string;
  baseOperation?: WalletUserOperation | null;
  allowRecoverySignature?: boolean;
  credentials?: CredentialsContainer;
  fetcher?: Fetcher;
  stateGuard?: StateGuard | null;
  hashOptions?: { entryPoint?: `0x${string}`; crossCheck?: boolean; minimumResponses?: number };
  verifyDeployment?: boolean;
  hubGasSponsorship?: (CommerceSponsorshipRequest & { expectedPaymaster?: string | null }) | null;
  approvedMaximumCostAtomic?: bigint | null;
}): Promise<string> {
  await guard(stateGuard, "before_prepare");
  const network = assertTransactionNetwork(chainId);
  const chainKey = normalizeChainId(chainId);
  const sender = baseOperation?.sender?.toLowerCase() ?? activeSender(state, chainKey);
  if (!state.passkeyCredentialId && !allowRecoverySignature) throw new Error("wallet_signer_unavailable");
  if (allowRecoverySignature) throw new Error("recovery_signer_unavailable");
  const bundlerUrl = state.bundlerUrls?.[chainKey]; if (!bundlerUrl) throw new Error("bundler_not_configured");
  if (baseOperation?.factory) {
    assertActivationOperation(baseOperation, state, chainKey, network);
    const deployment = await verifyWalletDeployment({
      rpcUrls: network.rpcUrls,
      chainId,
      account: sender,
      factory: network.smartAccountFactory as string,
      entryPoint: network.entryPoint ?? undefined,
      entryPointRuntimeCodeHash: network.entryPointRuntimeCodeHash,
      smartAccountFactoryRuntimeCodeHash: network.smartAccountFactoryRuntimeCodeHash,
      smartAccountImplementationRuntimeCodeHash: network.smartAccountImplementationRuntimeCodeHash,
      fetcher,
      allowUndeployed: true,
    });
    if (deployment.deployed) throw new Error("smart_account_already_deployed");
  } else if (verifyDeployment) {
    await verifyWalletDeployment({
      rpcUrls: network.rpcUrls,
      chainId,
      account: sender,
      factory: network.smartAccountFactory as string,
      entryPoint: network.entryPoint ?? undefined,
      entryPointRuntimeCodeHash: network.entryPointRuntimeCodeHash,
      smartAccountFactoryRuntimeCodeHash: network.smartAccountFactoryRuntimeCodeHash,
      smartAccountImplementationRuntimeCodeHash: network.smartAccountImplementationRuntimeCodeHash,
      fetcher,
    });
  }
  const client = new BundlerClient(bundlerUrl, fetcher);
  await Promise.all([client.assertEntryPoint(), client.assertNetwork(chainId)]);
  const nonce = baseOperation?.nonce ?? await getAccountNonce(network.rpcUrls, chainId, sender, fetcher);
  const epoch = baseOperation?.factory ? 1n : await getAuthorizationEpoch(network.rpcUrls, chainId, sender, fetcher);
  const epochBoundCallData = rebindAuthorizationEpoch(baseOperation?.callData ?? callData, epoch);
  let operation = baseOperation ? { ...baseOperation, nonce, callData: epochBoundCallData } : createTransferUserOperation({ sender, nonce, callData: epochBoundCallData });
  operation = await applyFeeCeilings(network.rpcUrls, chainId, operation, fetcher, { ...(state.gasPolicies?.[chainKey] ?? {}), minimumPriorityFeePerGas: network.minimumPriorityFeePerGas });
  const estimateHash = await getUserOperationHash(network.rpcUrls, chainId, operation, fetcher, hashOptions);
  if (hubGasSponsorship) {
    const estimate = await client.estimate({ ...operation, signature: dummyWebAuthnSignature(estimateHash) });
    operation = applyGasEstimate(operation, estimate);
    operation = await requestCommerceSponsorship(operation, { ...hubGasSponsorship, expectedPaymaster: network.paymaster }, fetcher);
  } else if ((state as { gasManagerConfigs?: Record<string, { url: string; policyId: string }> }).gasManagerConfigs?.[chainKey]) {
    const config = (state as { gasManagerConfigs?: Record<string, { url: string; policyId: string }> }).gasManagerConfigs?.[chainKey] as { url: string; policyId: string };
    operation = await new AlchemyGasManagerClient(config.url, config.policyId, fetcher).sponsor(operation, dummyWebAuthnSignature(estimateHash));
  } else if ((state as { paymasterUrls?: Record<string, string> }).paymasterUrls?.[chainKey]) {
    operation = await new PaymasterClient((state as { paymasterUrls?: Record<string, string> }).paymasterUrls?.[chainKey] as string, fetcher).sponsor(operation, chainId);
  } else {
    const estimate = await client.estimate({ ...operation, signature: dummyWebAuthnSignature(estimateHash) });
    operation = applyGasEstimate(operation, estimate);
  }
  if (approvedMaximumCostAtomic != null) {
    assertApprovedMaximumCost(operation, approvedMaximumCostAtomic);
  }
  const hash = await getUserOperationHash(network.rpcUrls, chainId, operation, fetcher, hashOptions);
  await guard(stateGuard, "before_sign");
  operation = { ...operation, signature: await signWalletHash({ ...state, allowRecoverySignature }, hash, credentials) };
  await guard(stateGuard, "after_sign");
  const estimate = await client.estimate(operation);
  assertEstimateWithinCeilings(operation, estimate);
  await guard(stateGuard, "before_submit");
  return client.send(operation, hash);
}

export async function submitDappTransaction({ chainId, transaction, state, credentials, fetcher = fetch as Fetcher, stateGuard = null, hashOptions = {}, approvedMaximumCostAtomic = null }: {
  chainId: string | number | bigint;
  transaction: { from?: string; to?: string; value?: string; data?: string; hubGasSponsorship?: (CommerceSponsorshipRequest & { expectedPaymaster?: string | null }) | null };
  state: NativeWalletState;
  credentials?: CredentialsContainer;
  fetcher?: Fetcher;
  stateGuard?: StateGuard | null;
  hashOptions?: { entryPoint?: `0x${string}`; crossCheck?: boolean; minimumResponses?: number };
  approvedMaximumCostAtomic?: bigint | null;
}): Promise<string> {
  const sender = activeSender(state, normalizeChainId(chainId));
  if (transaction.from?.toLowerCase() !== sender) throw new Error("transaction_sender_mismatch");
  if (!/^0x[0-9a-fA-F]{40}$/.test(transaction.to ?? "")) throw new Error("invalid_transaction_recipient");
  const network = assertTransactionNetwork(chainId);
  const approvedMaximum = approvedMaximumCostAtomic ?? readApprovedMaximumNetworkFee(chainId);
  if (approvedMaximum == null) throw new Error("transaction_fee_approval_missing");
  const value = BigInt(transaction.value ?? "0x0");
  const callData = encodeContractCall(transaction.to as string, value, (transaction.data ?? "0x") as `0x${string}`);
  return submitWalletUserOperation({ chainId, state, callData, credentials, fetcher, stateGuard, hashOptions, verifyDeployment: network.transactionEnabled, hubGasSponsorship: transaction.hubGasSponsorship ?? null, approvedMaximumCostAtomic: approvedMaximum });
}

// wallet_sendCalls / hub_sendBatchTransaction: バッチを1つのUserOperationとして送る（パスキー確認1回）。
export async function submitDappCalls({ chainId, from, calls, state, credentials, fetcher = fetch as Fetcher, stateGuard = null, hashOptions = {}, hubGasSponsorship = null, approvedMaximumCostAtomic = null }: {
  chainId: string | number | bigint;
  from: string;
  calls: { to?: string; target?: string; value?: string | bigint; data?: string }[];
  state: NativeWalletState;
  credentials?: CredentialsContainer;
  fetcher?: Fetcher;
  stateGuard?: StateGuard | null;
  hashOptions?: { entryPoint?: `0x${string}`; crossCheck?: boolean; minimumResponses?: number };
  hubGasSponsorship?: (CommerceSponsorshipRequest & { expectedPaymaster?: string | null }) | null;
  approvedMaximumCostAtomic?: bigint | null;
}): Promise<string> {
  const sender = activeSender(state, normalizeChainId(chainId));
  if (String(from ?? "").toLowerCase() !== sender) throw new Error("calls_sender_mismatch");
  const network = assertTransactionNetwork(chainId);
  const callData = encodeContractCalls(calls.map((call) => ({ to: call.to, value: BigInt(call.value ?? "0x0"), data: call.data ?? "0x" })));
  return submitWalletUserOperation({ chainId, state, callData, credentials, fetcher, stateGuard, hashOptions, verifyDeployment: network.transactionEnabled, hubGasSponsorship, approvedMaximumCostAtomic });
}
