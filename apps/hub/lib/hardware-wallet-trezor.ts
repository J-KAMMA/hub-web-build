// Trezor adapter for the hardware signer (@trezor/connect-web).
//
// It exposes the same LedgerEthApp shape as the Ledger transport, so createHardwareEvmProvider
// applies one set of strict field checks, the chain snapshot, the Hub summary and the recover-and-compare
// step to both. Trezor Connect talks to the device through a popup/iframe served from connect.trezor.io
// (and Trezor Bridge or the WebUSB transport); the private key never reaches Hub.

import { parseTransaction } from "viem";
import { HardwareWalletError, type HardwareSignature, type LedgerEthApp } from "@/lib/hardware-wallet";

type TrezorResponse<T> = { success: true; payload: T } | { success: false; payload: { error?: string; code?: string } };

/** The subset of the TrezorConnect object that Hub uses; a mock implements the same shape in tests. */
export type TrezorConnectLike = {
  ethereumGetAddress(params: { path: string; showOnTrezor: boolean }): Promise<TrezorResponse<{ address: string }>>;
  ethereumGetAddress(params: { bundle: Array<{ path: string; showOnTrezor: boolean }> }): Promise<TrezorResponse<Array<{ address: string }>>>;
  ethereumSignMessage(params: { path: string; message: string; hex: boolean }): Promise<TrezorResponse<{ address: string; signature: string }>>;
  ethereumSignTypedData(params: { path: string; data: unknown; metamask_v4_compat: boolean }): Promise<TrezorResponse<{ address: string; signature: string }>>;
  ethereumSignTransaction(params: { path: string; transaction: Record<string, string | undefined> }): Promise<TrezorResponse<{ v: string; r: string; s: string }>>;
  dispose?(): void;
};

const CANCEL_CODES = new Set(["Failure_ActionCancelled", "Method_Cancel", "Method_Interrupted", "Popup_Closed", "Failure_PinCancelled", "Failure_PinInvalid"]);
const BRIDGE_CODES = new Set(["Transport_Missing", "Init_NotInitialized", "Init_ManifestMissing"]);
const GONE_CODES = new Set(["Device_NotFound", "Device_Disconnected", "Device_UsedElsewhere", "Device_CallInProgress", "Device_InvalidState"]);

function unwrap<T>(response: TrezorResponse<T>): T {
  if (response.success) return response.payload;
  const code = response.payload?.code ?? "";
  const error = response.payload?.error ?? "";
  const detail = /^[A-Za-z_]{1,64}$/.test(code) ? code : undefined;
  if (CANCEL_CODES.has(code) || /cancelled|canceled|popup closed|closed.*popup|rejected/i.test(error)) throw new HardwareWalletError("user_rejected", 4001, detail);
  if (BRIDGE_CODES.has(code) || /bridge|transport/i.test(error)) throw new HardwareWalletError("hardware_bridge_missing", 4900, detail);
  if (GONE_CODES.has(code) || /disconnected|not found|device/i.test(error)) throw new HardwareWalletError("hardware_wallet_disconnected", 4900, detail);
  throw new HardwareWalletError("hardware_wallet_failed", -32603, detail);
}

function splitSignature(signature: string): HardwareSignature {
  const hex = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) throw new HardwareWalletError("hardware_signature_invalid", -32603);
  return { r: hex.slice(0, 64), s: hex.slice(64, 128), v: Number.parseInt(hex.slice(128), 16) };
}

const hexOf = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;

export function createTrezorApp(connect: TrezorConnectLike): LedgerEthApp {
  return {
    async getAddress(path) {
      return { address: unwrap(await connect.ethereumGetAddress({ path, showOnTrezor: false })).address };
    },
    async getAddresses(paths) {
      const out = unwrap(await connect.ethereumGetAddress({ bundle: paths.map((path) => ({ path, showOnTrezor: false })) }));
      return out.map((item) => ({ address: item.address }));
    },
    async signPersonalMessage(path, messageHex) {
      const out = unwrap(await connect.ethereumSignMessage({ path, message: messageHex, hex: true }));
      return splitSignature(out.signature);
    },
    async signEIP712Message(path, message) {
      const out = unwrap(await connect.ethereumSignTypedData({ path, data: message, metamask_v4_compat: true }));
      return splitSignature(out.signature);
    },
    async signTransaction(path, rawTxHex) {
      // The provider hands over the exact bytes it validated and reviewed; decode them back to fields so the
      // device signs the same values (the provider re-parses the signed result and compares).
      const tx = parseTransaction(`0x${rawTxHex}` as `0x02${string}`);
      if (tx.type !== "eip1559" || !tx.to || tx.chainId === undefined) throw new HardwareWalletError("hardware_tx_unsupported", -32602);
      const out = unwrap(
        await connect.ethereumSignTransaction({
          path,
          transaction: {
            to: tx.to,
            value: hexOf(tx.value ?? 0n),
            gasLimit: hexOf(tx.gas ?? 0n),
            nonce: hexOf(tx.nonce ?? 0),
            data: tx.data ?? "0x",
            chainId: tx.chainId,
            maxFeePerGas: hexOf(tx.maxFeePerGas ?? 0n),
            maxPriorityFeePerGas: hexOf(tx.maxPriorityFeePerGas ?? 0n),
          } as unknown as Record<string, string | undefined>,
        }),
      );
      return { v: out.v, r: out.r, s: out.s };
    },
    async close() {
      // The shared popup/iframe stays alive for the page; nothing per-call to release.
    },
  };
}

let initialised = false;

/** Loads @trezor/connect-web lazily (browser only) and returns an app. appUrl only; no email is sent. */
export async function openTrezorEthApp(): Promise<LedgerEthApp> {
  if (typeof window === "undefined") throw new HardwareWalletError("hardware_wallet_failed", -32603);
  let mod;
  try {
    // @ts-ignore -- resolved once the pinned package is installed
    mod = await import("@trezor/connect-web");
  } catch {
    throw new HardwareWalletError("hardware_wallet_failed", -32603, "Connect_LoadFailed");
  }
  const connect = (mod.default ?? mod) as unknown as TrezorConnectLike & { init(options: Record<string, unknown>): Promise<void> };
  if (!initialised) {
    try {
      await connect.init({
        // Connect 10 rejects the manifest unless email, appUrl and appName are all strings. No contact
        // address has been chosen for Hub, so email stays empty rather than naming a person.
        manifest: { appName: "Hub", appUrl: window.location.origin, email: "" },
        lazyLoad: true,
        popup: true,
      });
      initialised = true;
    } catch (reason) {
      if (/already initialized/i.test(String((reason as Error)?.message))) initialised = true;
      else {
        const code = String((reason as { code?: unknown })?.code ?? "");
        throw new HardwareWalletError("hardware_bridge_missing", 4900, /^[A-Za-z_]{1,64}$/.test(code) ? code : "Init_Failed");
      }
    }
  }
  return createTrezorApp(connect);
}
