// Real Ledger transport (WebHID). Loaded lazily and only in a browser that exposes WebHID,
// so the packages never enter server bundles and the mocked-transport tests never import this file.
// Exact versions are pinned in package.json (@ledgerhq/hw-transport-webhid, @ledgerhq/hw-app-eth).

import type { LedgerEthApp } from "@/lib/hardware-wallet";

export function webHidAvailable(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export async function openLedgerEthApp(): Promise<LedgerEthApp & { resolveTransaction(rawTxHex: string): Promise<unknown> }> {
  if (!webHidAvailable()) throw Object.assign(new Error("webhid_unavailable"), { name: "TransportInterfaceNotAvailable" });
  // @ts-ignore -- resolved once the pinned packages are installed
  const [{ default: TransportWebHID }, { default: Eth, ledgerService }] = await Promise.all([
    // @ts-ignore
    import("@ledgerhq/hw-transport-webhid"),
    // @ts-ignore
    import("@ledgerhq/hw-app-eth"),
  ]);
  const transport = await TransportWebHID.create();
  const eth = new Eth(transport);
  return {
    getAddress: (path, display) => eth.getAddress(path, display ?? false),
    signPersonalMessage: (path, hex) => eth.signPersonalMessage(path, hex),
    // The provider has already validated the typed data and the resolution came from ledgerService.
    signEIP712Message: (path, message) => eth.signEIP712Message(path, message as unknown as Parameters<typeof eth.signEIP712Message>[1]),
    signTransaction: (path, rawHex, resolution) => eth.signTransaction(path, rawHex, resolution as Parameters<typeof eth.signTransaction>[2]),
    resolveTransaction: (rawHex) => ledgerService.resolveTransaction(rawHex, eth.loadConfig, { externalPlugins: true, erc20: true, nft: false }),
    close: () => transport.close(),
  };
}
