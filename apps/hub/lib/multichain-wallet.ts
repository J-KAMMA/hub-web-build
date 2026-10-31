import { normalizeSolanaAddress } from "@/lib/chains/address/solana";
/**
 * Case rules by address family. Only EVM (and the bech32-style families) may be lowercased; base58 families
 * (Solana, Bitcoin P2PKH/P2SH, TRON, XRPL, ...) are case-sensitive and must be compared exactly.
 * bech32/bech32m is lowercase per BIP-173/350: all-lowercase or all-uppercase input is accepted and stored
 * lowercase, mixed case is rejected.
 */
export function normalizeBech32Text(value:string,hrpPattern:string,body:RegExp):string|null{const v=value.trim();if(v!==v.toLowerCase()&&v!==v.toUpperCase())return null;const lower=v.toLowerCase();return new RegExp("^"+hrpPattern).test(lower)&&body.test(lower)?lower:null}
export function normalizeBitcoinMainnetAddress(value:string):string|null{const v=value.trim();if(/^bc1/i.test(v))return normalizeBech32Text(v,"bc1",/^bc1[ac-hj-np-z02-9]{11,71}$/);return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v)?v:null}
/** The only function allowed to lowercase an address for the EVM tables (profile_wallet_links is COLLATE NOCASE). Returns null for anything that is not 0x + 40 hex. */
export function normalizeEvmAddressForStorage(value:unknown):string|null{return typeof value==="string"&&/^0x[0-9a-fA-F]{40}$/.test(value.trim())?value.trim().toLowerCase():null}

export type WalletVerificationStatus="verified"|"watch_only";

export type ChainAdapterDefinition={namespace:string;label:string;addressExample:string;normalize(address:string):string|null};

const trimmed=(value:string)=>value.trim();
const exact=(pattern:RegExp,transform:(value:string)=>string=trimmed)=>(address:string)=>{const value=transform(address);return pattern.test(value)?value:null};

export const CHAIN_ADAPTERS:readonly ChainAdapterDefinition[]=[
 {namespace:"eip155",label:"EVM",addressExample:"0x…",normalize:exact(/^0x[0-9a-fA-F]{40}$/,(v)=>v.trim().toLowerCase())},
 {namespace:"bip122",label:"Bitcoin",addressExample:"bc1… / 1… / 3…",normalize:normalizeBitcoinMainnetAddress},
 {namespace:"solana",label:"Solana",addressExample:"Base58 address",normalize:normalizeSolanaAddress},
 {namespace:"cosmos",label:"Cosmos SDK",addressExample:"prefix1…",normalize:exact(/^[a-z][a-z0-9]{1,30}1[023456789acdefghjklmnpqrstuvwxyz]{20,100}$/,(v)=>v.trim().toLowerCase())},
 {namespace:"xrpl",label:"XRP Ledger",addressExample:"r…",normalize:exact(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/)},
 {namespace:"cardano",label:"Cardano",addressExample:"addr1…",normalize:exact(/^addr(?:_test)?1[0-9a-z]{20,120}$/,(v)=>v.trim().toLowerCase())},
 {namespace:"ton",label:"TON",addressExample:"EQ… / UQ…",normalize:exact(/^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/)},
 {namespace:"sui",label:"Sui",addressExample:"0x…",normalize:exact(/^0x[0-9a-fA-F]{64}$/,(v)=>v.trim().toLowerCase())},
 {namespace:"aptos",label:"Aptos",addressExample:"0x…",normalize:exact(/^0x[0-9a-fA-F]{1,64}$/,(v)=>`0x${v.trim().slice(2).toLowerCase().padStart(64,"0")}`)},
 {namespace:"substrate",label:"Polkadot / Substrate",addressExample:"SS58 address",normalize:exact(/^[1-9A-HJ-NP-Za-km-z]{46,49}$/)},
 {namespace:"near",label:"NEAR",addressExample:"name.near",normalize:exact(/^(?:[a-z0-9_-]+\.)*[a-z0-9_-]{2,64}$/,(v)=>v.trim().toLowerCase())},
 {namespace:"tron",label:"TRON",addressExample:"T…",normalize:exact(/^T[1-9A-HJ-NP-Za-km-z]{33}$/)},
 {namespace:"stellar",label:"Stellar",addressExample:"G…",normalize:exact(/^G[A-Z2-7]{55}$/)},
 {namespace:"algorand",label:"Algorand",addressExample:"58 character address",normalize:exact(/^[A-Z2-7]{58}$/)},
 {namespace:"tezos",label:"Tezos",addressExample:"tz1… / tz2… / tz3…",normalize:exact(/^tz[123][1-9A-HJ-NP-Za-km-z]{33}$/)},
] as const;

export function getChainAdapter(namespace:string){return CHAIN_ADAPTERS.find(adapter=>adapter.namespace===namespace)}
export function normalizeWatchOnlyAccount(namespace:unknown,address:unknown){if(typeof namespace!=="string"||typeof address!=="string")return null;const adapter=getChainAdapter(namespace);if(adapter){const normalized=adapter.normalize(address);return normalized?{namespace:adapter.namespace,normalized,display:address.trim(),known:true}:null}if(!/^[a-z][a-z0-9-]{1,31}$/.test(namespace)||address.trim().length<3||address.trim().length>256||/[\u0000-\u001f\u007f]/.test(address))return null;return{namespace,normalized:address.trim(),display:address.trim(),known:false}}
export function normalizeNetworkReference(value:unknown){return typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value)?value:null}
