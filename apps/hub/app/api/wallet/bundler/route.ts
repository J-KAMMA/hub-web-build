// Hub運用の最小バンドラー。ページ内ウォレットの UserOperation を受け、
// 設定された上流バンドラーへ転送するか、運用 executor 鍵で EntryPoint の
// depositTo + handleOps を直接呼ぶ。同一オリジン＋Hubログイン必須、
// 送信はプロフィールあたり日次で制限。設定が無ければ 503 で閉じる。
//
// 環境変数:
//   HUB_WALLET_BUNDLER_CHAIN_ID             ?chain= 未指定時の既定（初期値 "0x2019" = Kaia mainnet）
//   HUB_WALLET_BUNDLER_UPSTREAM_URL         設定時は上流バンドラーへ転送
//   HUB_WALLET_BUNDLER_UPSTREAM_URL_<id>    チェーン別上流（10進chainId、例: _137）
//   HUB_WALLET_EXECUTOR_PRIVATE_KEY         設定時は executor モード（送信可能チェーンのみ）

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { kairos, polygon, mainnet, avalanche, kaia } from "viem/chains";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { assertTransactionNetwork, ENTRY_POINT_V08, safeRpcUrl, type HubWalletNetwork } from "@/lib/wallet/networks";
import { HARD_GAS_CEILINGS } from "@/lib/wallet/gas-policy";
import { assertOperation, localUserOperationHash, maximumUserOperationCost, packUserOperation, type WalletUserOperation } from "@/lib/wallet/user-operation";
import { postJsonRpc } from "@/lib/wallet/json-rpc";

const CHAINS: Record<string, Chain> = { "0x3e9": kairos, "0x89": polygon, "0x1": mainnet, "0xa86a": avalanche, "0x2019": kaia };
const MAX_BODY_BYTES = 32_768;
const SEND_DAILY_LIMIT = 20;
const RPC_DAILY_LIMIT = 600;
const HASH = /^0x[0-9a-fA-F]{64}$/;

const ENTRY_POINT_ABI = parseAbi([
  "function depositTo(address account) payable",
  "function balanceOf(address account) view returns (uint256)",
  "function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary) payable",
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
]);
const FACTORY_ABI = parseAbi(["function getAddress(uint256 qx, uint256 qy, uint256 salt) view returns (address)"]);

// Workersでは getCloudflareContext().env、ローカルの next dev では process.env を読む。
function env(name: string): string | undefined {
  try {
    const value = (getCloudflareContext().env as unknown as Record<string, unknown>)[name];
    if (typeof value === "string" && value) return value;
  } catch { /* ローカル実行 */ }
  return process.env[name];
}

function reply(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "cache-control": "no-store" } });
}

function rpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message: message.slice(0, 200) } }, { headers: { "cache-control": "no-store" } });
}

// クライアントは /api/wallet/bundler?chain=0x… でチェーンを指定する。
// 未指定時は HUB_WALLET_BUNDLER_CHAIN_ID、それも無ければ既定チェーン。
function configuredNetwork(request: Request): HubWalletNetwork | null {
  const requested = new URL(request.url).searchParams.get("chain") ?? env("HUB_WALLET_BUNDLER_CHAIN_ID") ?? "0x2019";
  try {
    return assertTransactionNetwork(requested);
  } catch {
    return null;
  }
}

// 上流バンドラーはチェーンごとに env を分けられる
// （HUB_WALLET_BUNDLER_UPSTREAM_URL_137 等。汎用の HUB_WALLET_BUNDLER_UPSTREAM_URL にフォールバック）。
function upstreamUrl(network: HubWalletNetwork): string | undefined {
  return env(`HUB_WALLET_BUNDLER_UPSTREAM_URL_${Number(normalizeChainIdDecimal(network.chainId))}`) ?? env("HUB_WALLET_BUNDLER_UPSTREAM_URL");
}

function normalizeChainIdDecimal(chainId: string): number {
  return Number(BigInt(chainId));
}

async function consumeRateLimit(db: NonNullable<ReturnType<typeof getOptionalHubD1>>, profileId: string, action: "send" | "rpc", limit: number) {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const result = await db.prepare(`INSERT INTO hub_wallet_bundler_rate_limits
      (profile_id, action, window_started_at, request_count, expires_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, action, window_started_at) DO UPDATE SET
        request_count = request_count + 1
      WHERE request_count < ?`)
    .bind(profileId, action, dayStart.toISOString(), new Date(dayStart.getTime() + 86_400_000).toISOString(), limit).run();
  if (!result.meta.changes) throw new Error("rate_limited");
}

function assertSendableOperation(operation: WalletUserOperation, network: HubWalletNetwork, gasPrice: bigint) {
  assertOperation(operation);
  if (!operation.signature || operation.signature === "0x") throw new Error("unsigned_user_operation");
  for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas"] as const) {
    if (BigInt(operation[field]) <= 0n || BigInt(operation[field]) > HARD_GAS_CEILINGS[field]) throw new Error(`user_operation_gas_out_of_range:${field}`);
  }
  // executor の支出上限：ガス価格の3倍を超える maxFee は拒否。
  if (BigInt(operation.maxFeePerGas) <= 0n || BigInt(operation.maxFeePerGas) > gasPrice * 3n) throw new Error("user_operation_fee_out_of_range");
  if (operation.factory && network.smartAccountFactory && operation.factory.toLowerCase() !== network.smartAccountFactory.toLowerCase()) throw new Error("user_operation_factory_mismatch");
}

function publicClient(network: HubWalletNetwork, chain: Chain) {
  return createPublicClient({ chain, transport: http(network.rpcUrls[0], { retryCount: 1, timeout: 15_000 }) });
}

// 有効化opの factoryData から qx/qy/salt を読み、ファクトリの getAddress と
// sender が一致するか照合する。Executor が第三者のアカウントを勝手に
// デプロイ・給油する経路を塞ぐための確認。
async function assertActivationSender(operation: WalletUserOperation, network: HubWalletNetwork, client: ReturnType<typeof publicClient>) {
  if (!operation.factory || !operation.factoryData || !network.smartAccountFactory) throw new Error("invalid_activation_operation");
  const body = operation.factoryData.slice(2);
  if (!/^0b7eb161[0-9a-fA-F]{192}$/.test(body)) throw new Error("invalid_activation_factory_data");
  const expected = await client.readContract({
    address: network.smartAccountFactory as `0x${string}`, abi: FACTORY_ABI, functionName: "getAddress",
    args: [BigInt(`0x${body.slice(8, 72)}`), BigInt(`0x${body.slice(72, 136)}`), BigInt(`0x${body.slice(136, 200)}`)],
  });
  if (String(expected).toLowerCase() !== operation.sender.toLowerCase()) throw new Error("activation_sender_mismatch");
}

async function executeLocally(operation: WalletUserOperation, network: HubWalletNetwork, chain: Chain, userOpHash: string, db: NonNullable<ReturnType<typeof getOptionalHubD1>>) {
  const key = env("HUB_WALLET_EXECUTOR_PRIVATE_KEY");
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("bundler_not_configured");
  const account = privateKeyToAccount(key as Hex);
  const client = publicClient(network, chain);
  const wallet = createWalletClient({ account, chain, transport: http(network.rpcUrls[0], { retryCount: 1, timeout: 15_000 }) });
  const entryPoint = { address: ENTRY_POINT_V08 as `0x${string}`, abi: ENTRY_POINT_ABI } as const;
  const packed = packUserOperation(operation);

  if (operation.factory) await assertActivationSender(operation, network, client);

  // 口座の prefund 預金が足りない分だけ補う（paymaster無しopのみ）。
  if (!operation.paymaster) {
    const required = maximumUserOperationCost(operation);
    const deposited = await client.readContract({ ...entryPoint, functionName: "balanceOf", args: [operation.sender as `0x${string}`] });
    if (deposited < required) {
      const topUp = await wallet.writeContract({ ...entryPoint, functionName: "depositTo", args: [operation.sender as `0x${string}`], value: required - deposited });
      await client.waitForTransactionReceipt({ hash: topUp, timeout: 60_000 });
    }
  }

  const txHash = await wallet.writeContract({
    ...entryPoint, functionName: "handleOps",
    args: [[{ ...packed, nonce: BigInt(packed.nonce), preVerificationGas: BigInt(packed.preVerificationGas) }], account.address],
    gas: 5_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
  await db.prepare("INSERT OR REPLACE INTO hub_wallet_user_operations (user_op_hash, transaction_hash, sender, chain_id, success) VALUES (?, ?, ?, ?, ?)")
    .bind(userOpHash.toLowerCase(), txHash.toLowerCase(), operation.sender.toLowerCase(), network.chainId, receipt.status === "success" ? 1 : 0).run();
  return userOpHash;
}

async function localReceipt(userOpHash: string, network: HubWalletNetwork, chain: Chain, db: NonNullable<ReturnType<typeof getOptionalHubD1>>) {
  const row = await db.prepare("SELECT transaction_hash, sender, success FROM hub_wallet_user_operations WHERE user_op_hash = ? AND chain_id = ?")
    .bind(userOpHash.toLowerCase(), network.chainId).first<{ transaction_hash: string; sender: string | null; success: number }>();
  if (!row) return null;
  const client = publicClient(network, chain);
  const receipt = await client.getTransactionReceipt({ hash: row.transaction_hash as Hex });
  const event = receipt.logs.map((log) => {
    try {
      return decodeEventLog({ abi: ENTRY_POINT_ABI, data: log.data, topics: log.topics });
    } catch {
      return null;
    }
  }).find((decoded) => decoded?.eventName === "UserOperationEvent" && (decoded.args as { userOpHash?: string }).userOpHash?.toLowerCase() === userOpHash.toLowerCase());
  const args = (event?.args ?? {}) as { sender?: string; nonce?: bigint; actualGasCost?: bigint; actualGasUsed?: bigint; paymaster?: string; success?: boolean };
  return {
    userOpHash: userOpHash.toLowerCase(),
    entryPoint: ENTRY_POINT_V08,
    // The stored sender is cleared one year after confirmation (privacy-retention.ts); the chain still has it.
    sender: row.sender ?? args.sender?.toLowerCase() ?? null,
    nonce: `0x${(args.nonce ?? 0n).toString(16)}`,
    paymaster: args.paymaster ?? "0x0000000000000000000000000000000000000000",
    actualGasCost: `0x${(args.actualGasCost ?? 0n).toString(16)}`,
    actualGasUsed: `0x${(args.actualGasUsed ?? 0n).toString(16)}`,
    success: args.success ?? row.success === 1,
    logs: [],
    receipt: {
      transactionHash: receipt.transactionHash,
      transactionIndex: `0x${receipt.transactionIndex.toString(16)}`,
      blockHash: receipt.blockHash,
      blockNumber: `0x${receipt.blockNumber.toString(16)}`,
      from: receipt.from,
      to: receipt.to,
      cumulativeGasUsed: `0x${receipt.cumulativeGasUsed.toString(16)}`,
      gasUsed: `0x${receipt.gasUsed.toString(16)}`,
      status: receipt.status === "success" ? "0x1" : "0x0",
      logs: [],
      logsBloom: receipt.logsBloom,
    },
  };
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return rpcError(null, 403, "forbidden");
  const db = getOptionalHubD1();
  if (!db) return rpcError(null, 503, "bundler_unavailable");
  let profile;
  try {
    profile = await requireHubViewerProfile(request, db);
  } catch {
    return rpcError(null, 401, "authentication_required");
  }
  const network = configuredNetwork(request);
  const chain = network ? CHAINS[network.chainId] : undefined;
  if (!network || !chain) return rpcError(null, 503, "bundler_not_configured");

  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) return rpcError(null, 413, "request_too_large");
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const id = body?.id ?? null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string" || Array.isArray(body) || (body.params != null && !Array.isArray(body.params))) {
    return rpcError(id, -32600, "invalid request");
  }
  const params = body.params ?? [];
  const upstream = upstreamUrl(network);
  const executorConfigured = Boolean(env("HUB_WALLET_EXECUTOR_PRIVATE_KEY"));
  if (!upstream && !executorConfigured) return rpcError(id, 503, "bundler_not_configured");

  try {
    switch (body.method) {
      case "eth_supportedEntryPoints": {
        await consumeRateLimit(db, profile.id, "rpc", RPC_DAILY_LIMIT);
        if (upstream) return reply(id, await postJsonRpc({ url: safeRpcUrl(upstream), method: body.method, params }));
        return reply(id, [ENTRY_POINT_V08]);
      }
      case "eth_chainId": {
        await consumeRateLimit(db, profile.id, "rpc", RPC_DAILY_LIMIT);
        if (upstream) return reply(id, await postJsonRpc({ url: safeRpcUrl(upstream), method: body.method, params }));
        return reply(id, network.chainId);
      }
      case "eth_estimateUserOperationGas": {
        await consumeRateLimit(db, profile.id, "rpc", RPC_DAILY_LIMIT);
        if (upstream) return reply(id, await postJsonRpc({ url: safeRpcUrl(upstream), method: body.method, params }));
        const operation = params[0] as WalletUserOperation | undefined;
        if (!operation || typeof operation !== "object") return rpcError(id, -32602, "invalid params");
        // EntryPoint v0.8の実測に基づく固定見積（カウンターファクチュアル
        // デプロイ込み）。クライアント側のハード上限内に収める。
        return reply(id, { callGasLimit: "0x186a0", verificationGasLimit: "0x1e8480", preVerificationGas: "0x14c08" });
      }
      case "eth_sendUserOperation": {
        await consumeRateLimit(db, profile.id, "send", SEND_DAILY_LIMIT);
        const operation = params[0] as WalletUserOperation | undefined;
        const entryPoint = String(params[1] ?? "");
        if (!operation || typeof operation !== "object" || entryPoint.toLowerCase() !== ENTRY_POINT_V08.toLowerCase()) {
          return rpcError(id, -32602, "invalid params");
        }
        const gasPrice = await publicClient(network, chain).getGasPrice();
        assertSendableOperation(operation, network, gasPrice);
        const userOpHash = localUserOperationHash(network.chainId, operation).toLowerCase();
        if (upstream) {
          const returned = await postJsonRpc({ url: safeRpcUrl(upstream), method: body.method, params });
          if (String(returned).toLowerCase() !== userOpHash) throw new Error("bundler_user_operation_hash_mismatch");
          return reply(id, userOpHash);
        }
        return reply(id, await executeLocally(operation, network, chain, userOpHash, db));
      }
      case "eth_getUserOperationReceipt": {
        await consumeRateLimit(db, profile.id, "rpc", RPC_DAILY_LIMIT);
        const userOpHash = String(params[0] ?? "");
        if (!HASH.test(userOpHash)) return rpcError(id, -32602, "invalid params");
        if (upstream) return reply(id, await postJsonRpc({ url: safeRpcUrl(upstream), method: body.method, params }));
        return reply(id, await localReceipt(userOpHash, network, chain, db));
      }
      default:
        return rpcError(id, -32601, "method not found");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "bundler_error";
    const status = message === "rate_limited" ? 429 : -32000;
    return rpcError(id, status, message);
  }
}
