/**
 * Test-only: deterministic Bitcoin keys and signers for the wallet-link, tip and gate tests. Never imported by
 * production code. BIP-322 proofs are signed through @scure/btc-signer's Transaction (an independent
 * implementation of the sighash from the verifier in bitcoin-bip322.ts), BIP-137 through @noble directly.
 */
import { secp256k1, schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import { Address, OutScript, p2pkh, p2sh, p2tr, p2wpkh, RawWitness, Script, TEST_NETWORK, Transaction } from "@scure/btc-signer";
import { bip322ToSpendTxid } from "./bitcoin-bip322";
import { bitcoinSignedMessageHash } from "./bitcoin-bip137";

export const BTC_MAINNET_REF = "bip122:000000000019d6689c085ae165831e93";
export const BTC_TESTNET4_REF = "bip122:00000000da84f2bafbbc53dee25a72ae";
export const BTC_SIGNET_REF = "bip122:00000008819873e925422c1ff0f99f7c";

export function testKey(label: string) {
  const priv = sha256(new TextEncoder().encode(`hub bitcoin test key ${label}`));
  const pub = secp256k1.getPublicKey(priv, true);
  const xonly = schnorr.getPublicKey(priv);
  const net = TEST_NETWORK; // tb / 0x6f / 0xc4
  return {
    priv,
    pub,
    xonly,
    p2pkh: p2pkh(pub, net).address!,
    p2wpkh: p2wpkh(pub, net).address!,
    p2shP2wpkh: p2sh(p2wpkh(pub, net), net).address!,
    p2tr: p2tr(xonly, undefined, net).address!,
  };
}

export function scriptHexOfAddress(address: string): string {
  const out = OutScript.encode(Address(TEST_NETWORK).decode(address));
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign a BIP-322 simple proof for a P2WPKH or P2TR address (testnet-format addresses). */
export function signBip322Simple(key: ReturnType<typeof testKey>, kind: "p2wpkh" | "p2tr", message: string): string {
  const address = kind === "p2wpkh" ? key.p2wpkh : key.p2tr;
  const script = OutScript.encode(Address(TEST_NETWORK).decode(address));
  const toSpendTxid = Uint8Array.from(bip322ToSpendTxid(message, script)).reverse();
  const tx = new Transaction({ version: 0, allowUnknownOutputs: true, disableScriptCheck: true });
  tx.addInput({
    txid: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { script, amount: 0n },
    ...(kind === "p2tr" ? { tapInternalKey: key.xonly } : {}),
  });
  tx.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  tx.sign(key.priv);
  tx.finalize();
  const witness = tx.getInput(0).finalScriptWitness as Uint8Array[];
  return base64.encode(RawWitness.encode(witness));
}

export function signBip137(key: ReturnType<typeof testKey>, message: string, headerBase: number): string {
  const sig = secp256k1.sign(bitcoinSignedMessageHash(message), key.priv, { lowS: true });
  return base64.encode(concatBytes(Uint8Array.of(headerBase + sig.recovery), sig.toCompactRawBytes()));
}
