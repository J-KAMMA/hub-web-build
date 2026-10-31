import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, encodePacked, getContractAddress, hexToBytes, isAddress, keccak256, stringToHex } from "viem";
import { HUB_SIGNATURE_AGILE_FACTORY_ABI, HUB_SIGNATURE_AGILE_RECOVERY_ABI, HUB_SIGNATURE_AGILE_RECOVERY_PROOF_ABI } from "./generated/hub-signature-agile-v2";
import deploymentManifest from "../../smart-wallet-contracts/deployments/kairos/HubSignatureAgileAccountFactory.json";

// 2026-08-22: AmoyのテストPOLが得られずKaia Kairosへ移行。配備実体もKairos側が active。
export const HUB_WALLET_CHAIN_ID = 1001;
export const HUB_ENTRY_POINT = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
export type HubSignatureAgileDeployment = {
  version: 2;
  status: "not-deployed" | "active";
  chainId: typeof HUB_WALLET_CHAIN_ID;
  entryPoint: `0x${string}`;
  factory: `0x${string}` | null;
  implementation: `0x${string}` | null;
  validator: `0x${string}` | null;
  policy: `0x${string}` | null;
};
if(deploymentManifest.chainId!==HUB_WALLET_CHAIN_ID||(deploymentManifest.status!=="active"&&deploymentManifest.status!=="not-deployed"))throw new Error("invalid_signature_agile_manifest");
export const HUB_SIGNATURE_AGILE_DEPLOYMENT:HubSignatureAgileDeployment={version:2,status:deploymentManifest.status,chainId:HUB_WALLET_CHAIN_ID,entryPoint:deploymentManifest.entryPoint as `0x${string}`,factory:deploymentManifest.factory as `0x${string}`|null,implementation:deploymentManifest.implementation as `0x${string}`|null,validator:deploymentManifest.validator as `0x${string}`|null,policy:deploymentManifest.policy as `0x${string}`|null};
export const HUB_GAS_TREASURY = "0x794E77370E4cEcb8AeE6579eB180fcFab933cf56";
export const HUB_ORDER_PAYMASTER = "0x2D225b9Ba0EBCfcc4fdCC7e87E2DB680Cacf57Bb";
export const HUB_PASSKEY_STORAGE_KEY = "hub.wallet.passkey.kairos.v2";
export const HUB_MERCHANT_ACCOUNT_STORAGE_KEY = "hub.wallet.merchant-account.kairos.v2";
const HUB_WALLET_RPC_URL = "https://public-en-kairos.node.kaia.io";
const NATIVE_PASSKEY_RP_ID = "jkamma-passkey-dev-association.jammakamma0.workers.dev";
const FACTORY_ABI = HUB_SIGNATURE_AGILE_FACTORY_ABI;
const ACCOUNT_RECOVERY_ABI = HUB_SIGNATURE_AGILE_RECOVERY_ABI;

export const HUB_SIGNATURE_POLICY_VERSION = 1 as const;
export type HubSignatureAlgorithm = "webauthn-p256" | "ml-dsa-65" | "slh-dsa-sha2-128s";
export type HubSignaturePolicy = {
  version: typeof HUB_SIGNATURE_POLICY_VERSION;
  activeAlgorithm: "webauthn-p256";
  permittedAlgorithms: readonly ["webauthn-p256"];
  upgradeMode: "v2-account-migration-required";
};

export const HUB_SIGNATURE_ALGORITHMS: ReadonlyArray<{
  id: HubSignatureAlgorithm;
  label: string;
  availability: "active" | "future";
}> = [
  { id: "webauthn-p256", label: "WebAuthn P-256", availability: "active" },
  { id: "ml-dsa-65", label: "ML-DSA-65", availability: "future" },
  { id: "slh-dsa-sha2-128s", label: "SLH-DSA-SHA2-128s", availability: "future" },
];

export function defaultHubSignaturePolicy(): HubSignaturePolicy {
  return {
    version: HUB_SIGNATURE_POLICY_VERSION,
    activeAlgorithm: "webauthn-p256",
    permittedAlgorithms: ["webauthn-p256"],
    upgradeMode: "v2-account-migration-required",
  };
}

export function isHubSignatureAlgorithmAvailable(
  policy: HubSignaturePolicy,
  algorithm: HubSignatureAlgorithm,
): boolean {
  return policy.permittedAlgorithms.includes(algorithm as "webauthn-p256");
}

export type HubPasskeyAccount = {
  address: `0x${string}`;
  chainId: typeof HUB_WALLET_CHAIN_ID;
  credentialId: string;
  qx: `0x${string}`;
  qy: `0x${string}`;
  salt: `0x${string}`;
  rpId: string;
  rpOrigin: string;
  createdAt: string;
  signaturePolicy: HubSignaturePolicy;
  accountVersion: 2;
  backupCredentialId?: string;
  backupQx?: `0x${string}`;
  backupQy?: `0x${string}`;
  backupOnchainRegisteredAt?: string;
  backupOnchainValidAfter?: string;
};
export type HubPasskeyAccountDescriptor = { version:1;account:HubPasskeyAccount;checksum:`0x${string}` };
export type HubMerchantAccount = { address:`0x${string}`;chainId:number;salt:`0x${string}`;createdAt:string;ownerAddress:`0x${string}`;ownerPublicKeyHash:`0x${string}`;factoryAddress:`0x${string}`;implementation:`0x${string}`;factoryCodeHash:`0x${string}`;accountVersion:2 };

declare global {
  interface Window {
    hubNativePasskey?: {
      readonly isHubNativePasskey: true;
      create(requestJson: string): Promise<{ credentialId: string; qx: `0x${string}`; qy: `0x${string}` }>;
    };
  }
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function fromBase64Url(value:string):Uint8Array{const normalized=value.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(value.length/4)*4,"=");return Uint8Array.from(atob(normalized),character=>character.charCodeAt(0))}

export function extractP256PublicKey(spki: ArrayBuffer): { qx: `0x${string}`; qy: `0x${string}` } {
  const bytes = new Uint8Array(spki);
  const expectedPrefix="3059301306072a8648ce3d020106082a8648ce3d030107034200";
  if (bytes.length!==91||bytesToHex(bytes.slice(0,26)).slice(2)!==expectedPrefix) throw new Error("passkey_public_key_invalid");
  const point = bytes.slice(-65);
  if (point[0] !== 4) throw new Error("passkey_curve_unsupported");
  return { qx: bytesToHex(point.slice(1, 33)), qy: bytesToHex(point.slice(33, 65)) };
}
async function validateP256Point(qx:`0x${string}`,qy:`0x${string}`):Promise<void>{try{const spki=hexToBytes(`0x3059301306072a8648ce3d020106082a8648ce3d03010703420004${qx.slice(2)}${qy.slice(2)}`);await crypto.subtle.importKey("spki",spki,{name:"ECDSA",namedCurve:"P-256"},false,["verify"])}catch{throw new Error("passkey_public_key_invalid")}}

export async function deriveHubSmartAccountAddress(
  input: { qx: `0x${string}`; qy: `0x${string}`; salt: `0x${string}` },
  fetcher: typeof fetch = fetch,
  deployment:HubSignatureAgileDeployment=HUB_SIGNATURE_AGILE_DEPLOYMENT,
): Promise<`0x${string}`> {
  if(deployment.status!=="active"||!deployment.factory)throw new Error("signature_agile_v2_not_deployed");
  const localAddress = deriveHubSmartAccountAddressLocally(input,deployment);
  const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: "getAddress", args: [input.qx, input.qy, BigInt(input.salt)] });
  const response = await fetcher(HUB_WALLET_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: deployment.factory, data }, "latest"] }),
  });
  if (!response.ok) throw new Error("wallet_rpc_unavailable");
  const payload = await response.json() as { result?: string; error?: unknown };
  if (payload.error || !payload.result || !/^0x[0-9a-fA-F]{64}$/.test(payload.result)) throw new Error("factory_address_unavailable");
  const rpcAddress = `0x${payload.result.slice(-40)}` as `0x${string}`;
  if (!isAddress(rpcAddress) || rpcAddress.toLowerCase() !== localAddress.toLowerCase()) throw new Error("factory_address_mismatch");
  return localAddress;
}

export function deriveHubSmartAccountAddressLocally(
  input: { qx: `0x${string}`; qy: `0x${string}`; salt: `0x${string}` },
  deployment:HubSignatureAgileDeployment=HUB_SIGNATURE_AGILE_DEPLOYMENT,
): `0x${string}` {
  if(deployment.status!=="active"||!deployment.factory||!deployment.implementation)throw new Error("signature_agile_v2_not_deployed");
  const deploymentSalt = deriveHubSignatureAgileDeploymentSalt(input);
  const cloneBytecode = encodePacked(
    ["bytes", "bytes", "address", "bytes"],
    ["0x3d602d80600a3d3981f3", "0x363d3d373d3d3d363d73", deployment.implementation, "0x5af43d82803e903d91602b57fd5bf3"],
  );
  const localAddress = getContractAddress({
    bytecodeHash: keccak256(cloneBytecode),
    from: deployment.factory,
    opcode: "CREATE2",
    salt: deploymentSalt,
  });
  return localAddress;
}

export function deriveHubSignatureAgileDeploymentSalt(input:{qx:`0x${string}`;qy:`0x${string}`;salt:`0x${string}`}):`0x${string}`{
 const publicKeyHash=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[input.qx,input.qy]));
 return keccak256(encodeAbiParameters([{type:"bytes32"},{type:"uint256"}],[publicKeyHash,BigInt(input.salt)]));
}

function descriptorChecksum(account:HubPasskeyAccount):`0x${string}`{
  return keccak256(stringToHex(JSON.stringify(account)));
}

export function exportHubPasskeyAccountDescriptor(account:HubPasskeyAccount):string{
  const publicAccount={...account,backupOnchainRegisteredAt:undefined};
  return JSON.stringify({version:1,account:publicAccount,checksum:descriptorChecksum(publicAccount)} satisfies HubPasskeyAccountDescriptor,null,2);
}

function derP256SignatureToRaw(signature:Uint8Array):Uint8Array{
 if(signature.length<8||signature[0]!==0x30)throw new Error("descriptor_signature_invalid");let offset=2;if(signature[1]&0x80)offset=2+(signature[1]&0x7f);
 if(signature[offset++]!==0x02)throw new Error("descriptor_signature_invalid");const rLength=signature[offset++],r=signature.slice(offset,offset+rLength);offset+=rLength;
 if(signature[offset++]!==0x02)throw new Error("descriptor_signature_invalid");const sLength=signature[offset++],s=signature.slice(offset,offset+sLength);
 const raw=new Uint8Array(64);raw.set(r.slice(Math.max(0,r.length-32)),32-Math.min(32,r.length));const normalizedS=new Uint8Array(32);normalizedS.set(s.slice(Math.max(0,s.length-32)),32-Math.min(32,s.length));const order=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,sValue=BigInt(bytesToHex(normalizedS)),lowS=sValue>order/2n?order-sValue:sValue;raw.set(hexToBytes(`0x${lowS.toString(16).padStart(64,"0")}`),32);return raw;
}
async function sha256(value:BufferSource):Promise<ArrayBuffer>{return crypto.subtle.digest("SHA-256",value)}
async function proveDescriptorOwnership(account:HubPasskeyAccount,challenge:`0x${string}`):Promise<void>{
 if(!navigator.credentials?.get)throw new Error("passkey_unavailable");
 const credential=await navigator.credentials.get({publicKey:{challenge:hexToBytes(challenge),rpId:account.rpId,allowCredentials:[{id:fromBase64Url(account.credentialId),type:"public-key"}],userVerification:"required",timeout:60_000}})as PublicKeyCredential|null;
 if(!credential||credential.id!==account.credentialId)throw new Error("descriptor_ownership_unverified");
 const response=credential.response as AuthenticatorAssertionResponse,authenticatorData=new Uint8Array(response.authenticatorData),clientDataBytes=new Uint8Array(response.clientDataJSON);
 if(authenticatorData.length<37||(authenticatorData[32]&0x05)!==0x05)throw new Error("descriptor_ownership_unverified");
 const expectedRpHash=new Uint8Array(await sha256(new TextEncoder().encode(account.rpId)));if(!expectedRpHash.every((value,index)=>value===authenticatorData[index]))throw new Error("descriptor_ownership_unverified");
 const client=JSON.parse(new TextDecoder().decode(clientDataBytes))as{type?:string;challenge?:string;origin?:string};
 if(client.type!=="webauthn.get"||client.challenge!==base64Url(hexToBytes(challenge))||client.origin!==account.rpOrigin)throw new Error("descriptor_ownership_unverified");
 const clientHash=new Uint8Array(await sha256(clientDataBytes)),signed=new Uint8Array(authenticatorData.length+clientHash.length);signed.set(authenticatorData);signed.set(clientHash,authenticatorData.length);
 const spki=hexToBytes(`0x3059301306072a8648ce3d020106082a8648ce3d03010703420004${account.qx.slice(2)}${account.qy.slice(2)}`);const key=await crypto.subtle.importKey("spki",spki,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
 if(!await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,derP256SignatureToRaw(new Uint8Array(response.signature)),signed))throw new Error("descriptor_ownership_unverified");
}

export async function importHubPasskeyAccountDescriptor(serialized:string,options?:{deployment?:HubSignatureAgileDeployment;proveOwnership?:(account:HubPasskeyAccount,challenge:`0x${string}`)=>Promise<void>}):Promise<HubPasskeyAccount>{
  const descriptor=JSON.parse(serialized) as HubPasskeyAccountDescriptor;
  if(descriptor.version!==1||!descriptor.account||descriptor.checksum!==descriptorChecksum(descriptor.account))throw new Error("account_descriptor_invalid");
  const account=descriptor.account;
  const expectedRpId=window.hubNativePasskey?.isHubNativePasskey?NATIVE_PASSKEY_RP_ID:location.hostname;
  if(account.chainId!==HUB_WALLET_CHAIN_ID||account.rpId!==expectedRpId||!isAddress(account.address)||!/^0x[0-9a-fA-F]{64}$/.test(account.qx)||!/^0x[0-9a-fA-F]{64}$/.test(account.qy)||!/^0x[0-9a-fA-F]{64}$/.test(account.salt))throw new Error("account_descriptor_invalid");
  const deployment=options?.deployment??HUB_SIGNATURE_AGILE_DEPLOYMENT;
  const expected=await deriveHubSmartAccountAddress({qx:account.qx,qy:account.qy,salt:account.salt},fetch,deployment);
  if(expected.toLowerCase()!==account.address.toLowerCase())throw new Error("account_descriptor_address_mismatch");
  await (options?.proveOwnership??proveDescriptorOwnership)(account,descriptor.checksum);
  const verified={...account,backupOnchainRegisteredAt:undefined};
  localStorage.setItem(HUB_PASSKEY_STORAGE_KEY,JSON.stringify(verified));
  return verified;
}

export async function createHubPasskeyAccount(): Promise<HubPasskeyAccount> {
  if(HUB_SIGNATURE_AGILE_DEPLOYMENT.status!=="active")throw new Error("signature_agile_v2_not_deployed");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(32));
  const saltBytes = crypto.getRandomValues(new Uint8Array(32));
  if (window.hubNativePasskey?.isHubNativePasskey) {
    const requestJson = JSON.stringify({
      challenge: base64Url(challenge),
      rp: { id: NATIVE_PASSKEY_RP_ID, name: "JKamma Hub Wallet (Kairos)" },
      user: { id: base64Url(userId), name: `hub-wallet-${base64Url(userId)}`, displayName: "JKamma Hub Wallet" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      attestation: "none",
      timeout: 60_000,
    });
    const native = await window.hubNativePasskey.create(requestJson);
    await validateP256Point(native.qx,native.qy);
    const salt = bytesToHex(saltBytes);
    const account: HubPasskeyAccount = {
      address: await deriveHubSmartAccountAddress({ qx: native.qx, qy: native.qy, salt }),
      chainId: HUB_WALLET_CHAIN_ID,
      credentialId: native.credentialId,
      qx: native.qx,
      qy: native.qy,
      salt,
      rpId: NATIVE_PASSKEY_RP_ID,
      rpOrigin: `https://${NATIVE_PASSKEY_RP_ID}`,
      createdAt: new Date().toISOString(),
      signaturePolicy: defaultHubSignaturePolicy(),
      accountVersion: 2,
    };
    localStorage.setItem(HUB_PASSKEY_STORAGE_KEY, JSON.stringify(account));
    return account;
  }
  if (!navigator.credentials?.create || !window.PublicKeyCredential) throw new Error("passkey_unavailable");
  const credential = await navigator.credentials.create({ publicKey: {
    challenge,
    rp: { id: location.hostname, name: "JKamma Hub Wallet" },
    user: { id: userId, name: `hub-wallet-${base64Url(userId)}`, displayName: "JKamma Hub Wallet" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    attestation: "none",
    timeout: 60_000,
  } }) as PublicKeyCredential | null;
  if (!credential || credential.type !== "public-key") throw new Error("passkey_creation_cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();
  if (!publicKey) throw new Error("passkey_public_key_unavailable");
  const { qx, qy } = extractP256PublicKey(publicKey);
  await validateP256Point(qx,qy);
  const salt = bytesToHex(saltBytes);
  const account: HubPasskeyAccount = {
    address: await deriveHubSmartAccountAddress({ qx, qy, salt }),
    chainId: HUB_WALLET_CHAIN_ID,
    credentialId: base64Url(new Uint8Array(credential.rawId)),
    qx,
    qy,
    salt,
    rpId: location.hostname,
    rpOrigin: location.origin,
    createdAt: new Date().toISOString(),
    signaturePolicy: defaultHubSignaturePolicy(),
    accountVersion: 2,
  };
  localStorage.setItem(HUB_PASSKEY_STORAGE_KEY, JSON.stringify(account));
  return account;
}

export function readHubPasskeyAccount(): HubPasskeyAccount | null {
  try {
    if(HUB_SIGNATURE_AGILE_DEPLOYMENT.status!=="active"||!HUB_SIGNATURE_AGILE_DEPLOYMENT.factory||!HUB_SIGNATURE_AGILE_DEPLOYMENT.implementation)return null;
    const raw = localStorage.getItem(HUB_PASSKEY_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Omit<HubPasskeyAccount, "signaturePolicy"> & { signaturePolicy?: HubSignaturePolicy };
    const signaturePolicy = stored.signaturePolicy?.version === HUB_SIGNATURE_POLICY_VERSION
      && stored.signaturePolicy.activeAlgorithm === "webauthn-p256"
      && stored.signaturePolicy.permittedAlgorithms.length === 1
      && stored.signaturePolicy.permittedAlgorithms[0] === "webauthn-p256"
      ? stored.signaturePolicy
      : defaultHubSignaturePolicy();
    const value: HubPasskeyAccount = { ...stored, signaturePolicy, backupOnchainRegisteredAt: undefined };
    const expectedRpId = window.hubNativePasskey?.isHubNativePasskey ? NATIVE_PASSKEY_RP_ID : location.hostname;
    const expectedOrigin=window.hubNativePasskey?.isHubNativePasskey?`https://${NATIVE_PASSKEY_RP_ID}`:location.origin;
    if (value.accountVersion !== 2 || value.chainId !== HUB_WALLET_CHAIN_ID || !isAddress(value.address) || value.rpId !== expectedRpId||value.rpOrigin!==expectedOrigin) return null;
    if (!stored.signaturePolicy) localStorage.setItem(HUB_PASSKEY_STORAGE_KEY, JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
}

export async function readOrCreateHubMerchantAccount(owner:HubPasskeyAccount,network:{chainId:number;factoryAddress:`0x${string}`;implementation:`0x${string}`;validator:`0x${string}`;policy:`0x${string}`;factoryCodeHash:`0x${string}`;accountVersion:2},derive:(input:{qx:`0x${string}`;qy:`0x${string}`;salt:`0x${string}`})=>Promise<`0x${string}`>):Promise<HubMerchantAccount>{
 const storageKey=`${HUB_MERCHANT_ACCOUNT_STORAGE_KEY}.${network.chainId}.${network.factoryAddress.toLowerCase()}`;
 const ownerPublicKeyHash=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[owner.qx,owner.qy]));
 try{const raw=localStorage.getItem(storageKey);if(raw){const value=JSON.parse(raw)as HubMerchantAccount;const expected=deriveHubSmartAccountAddressLocally({qx:owner.qx,qy:owner.qy,salt:value.salt},{version:2,status:"active",chainId:HUB_WALLET_CHAIN_ID,entryPoint:HUB_ENTRY_POINT,factory:network.factoryAddress,implementation:network.implementation,validator:network.validator,policy:network.policy});if(value.chainId===network.chainId&&value.accountVersion===2&&value.ownerAddress.toLowerCase()===owner.address.toLowerCase()&&value.ownerPublicKeyHash===ownerPublicKeyHash&&value.factoryAddress.toLowerCase()===network.factoryAddress.toLowerCase()&&value.implementation.toLowerCase()===network.implementation.toLowerCase()&&value.factoryCodeHash===network.factoryCodeHash&&value.address.toLowerCase()===expected.toLowerCase()&&isAddress(value.address)&&/^0x[0-9a-fA-F]{64}$/.test(value.salt))return value}}catch{/* derive a fresh owner-bound account */}
 const salt=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));const input={qx:owner.qx,qy:owner.qy,salt} as const;const local=deriveHubSmartAccountAddressLocally(input,{version:2,status:"active",chainId:HUB_WALLET_CHAIN_ID,entryPoint:HUB_ENTRY_POINT,factory:network.factoryAddress,implementation:network.implementation,validator:network.validator,policy:network.policy});const remote=await derive(input);if(remote.toLowerCase()!==local.toLowerCase())throw new Error("merchant_factory_address_mismatch");const account:HubMerchantAccount={address:local,chainId:network.chainId,salt,createdAt:new Date().toISOString(),ownerAddress:owner.address,ownerPublicKeyHash,factoryAddress:network.factoryAddress,implementation:network.implementation,factoryCodeHash:network.factoryCodeHash,accountVersion:2};localStorage.setItem(storageKey,JSON.stringify(account));return account;
}

export async function addHubBackupPasskey(account:HubPasskeyAccount):Promise<HubPasskeyAccount>{
 if(!navigator.credentials?.create||!window.PublicKeyCredential)throw new Error("passkey_unavailable");
 const challenge=crypto.getRandomValues(new Uint8Array(32)),userId=crypto.getRandomValues(new Uint8Array(32));
  const credential=await navigator.credentials.create({publicKey:{challenge,rp:{id:account.rpId,name:"JKamma Hub Wallet Recovery"},user:{id:userId,name:`hub-recovery-${base64Url(userId)}`,displayName:"Hub Wallet Backup"},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{residentKey:"required",requireResidentKey:true,userVerification:"required"},attestation:"none",timeout:60_000,excludeCredentials:[{id:fromBase64Url(account.credentialId),type:"public-key"}]}})as PublicKeyCredential|null;
 if(!credential)throw new Error("backup_passkey_cancelled");const response=credential.response as AuthenticatorAttestationResponse;const publicKey=response.getPublicKey?.();if(!publicKey)throw new Error("passkey_public_key_unavailable");const{qx,qy}=extractP256PublicKey(publicKey);const updated={...account,backupCredentialId:base64Url(new Uint8Array(credential.rawId)),backupQx:qx,backupQy:qy};localStorage.setItem(HUB_PASSKEY_STORAGE_KEY,JSON.stringify(updated));return updated;
}

export function encodeHubBackupRegistration(account:HubPasskeyAccount,recoveryProof:`0x${string}`,deployment:HubSignatureAgileDeployment=HUB_SIGNATURE_AGILE_DEPLOYMENT):`0x${string}`{
 const validator=deployment.validator;if(deployment.status!=="active"||!validator)throw new Error("signature_agile_v2_not_deployed");
 if(!account.backupCredentialId||!account.backupQx||!account.backupQy)throw new Error("backup_passkey_missing");
 const publicKey=encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[account.backupQx,account.backupQy]);
 if(recoveryProof==="0x")throw new Error("backup_proof_missing");return encodeFunctionData({abi:ACCOUNT_RECOVERY_ABI,functionName:"addRecoveryConfiguration",args:[validator,publicKey,recoveryProof]});
}

export async function requestHubBackupEnrollmentProof(account:HubPasskeyAccount,fetcher:typeof fetch=fetch,deployment:HubSignatureAgileDeployment=HUB_SIGNATURE_AGILE_DEPLOYMENT):Promise<`0x${string}`>{
 if(deployment.status!=="active"||!deployment.validator||!account.backupCredentialId||!account.backupQx||!account.backupQy)throw new Error("backup_passkey_missing");
 const publicKey=encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[account.backupQx,account.backupQy]);const data=encodeFunctionData({abi:HUB_SIGNATURE_AGILE_RECOVERY_PROOF_ABI,functionName:"recoveryEnrollmentProofHash",args:[deployment.validator,publicKey]});
 const rpc=await fetcher(HUB_WALLET_RPC_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:account.address,data},"latest"]})});const payload=await rpc.json()as{result?:`0x${string}`;error?:unknown};if(!rpc.ok||payload.error||!payload.result)throw new Error("recovery_proof_hash_unavailable");const challenge=decodeFunctionResult({abi:HUB_SIGNATURE_AGILE_RECOVERY_PROOF_ABI,functionName:"recoveryEnrollmentProofHash",data:payload.result});
 const credential=await navigator.credentials.get({publicKey:{challenge:hexToBytes(challenge),rpId:account.rpId,allowCredentials:[{id:fromBase64Url(account.backupCredentialId),type:"public-key"}],userVerification:"required",timeout:60_000}})as PublicKeyCredential|null;if(!credential||credential.id!==account.backupCredentialId)throw new Error("backup_ownership_unverified");const response=credential.response as AuthenticatorAssertionResponse,clientDataJSON=new TextDecoder().decode(response.clientDataJSON),challengeIndex=clientDataJSON.indexOf('"challenge":"'),typeIndex=clientDataJSON.indexOf('"type":"webauthn.get"');if(challengeIndex<0||typeIndex<0)throw new Error("backup_ownership_unverified");const raw=derP256SignatureToRaw(new Uint8Array(response.signature));return encodeAbiParameters([{type:"bytes32",name:"r"},{type:"bytes32",name:"s"},{type:"uint256",name:"challengeIndex"},{type:"uint256",name:"typeIndex"},{type:"bytes",name:"authenticatorData"},{type:"string",name:"clientDataJSON"}],[bytesToHex(raw.slice(0,32)),bytesToHex(raw.slice(32)),BigInt(challengeIndex),BigInt(typeIndex),bytesToHex(new Uint8Array(response.authenticatorData)),clientDataJSON]);
}

export function markHubBackupRegistered(account:HubPasskeyAccount,confirmedAt:string):HubPasskeyAccount{
 if(!account.backupCredentialId||!account.backupQx||!account.backupQy)throw new Error("backup_passkey_missing");
 const updated={...account,backupOnchainRegisteredAt:confirmedAt};
 localStorage.setItem(HUB_PASSKEY_STORAGE_KEY,JSON.stringify(updated));
 return updated;
}

export async function verifyHubBackupRegistration(account:HubPasskeyAccount,fetcher:typeof fetch=fetch,deployment:HubSignatureAgileDeployment=HUB_SIGNATURE_AGILE_DEPLOYMENT):Promise<HubPasskeyAccount>{
 if(deployment.status!=="active"||!deployment.validator)throw new Error("signature_agile_v2_not_deployed");
 if(!account.backupQx||!account.backupQy)throw new Error("backup_passkey_missing");
 const publicKey=encodeAbiParameters([{type:"bytes32"},{type:"bytes32"}],[account.backupQx,account.backupQy]);
 const recoveryId=keccak256(encodeAbiParameters([{type:"address"},{type:"bytes32"}],[deployment.validator,keccak256(publicKey)]));
 const data=encodeFunctionData({abi:ACCOUNT_RECOVERY_ABI,functionName:"recoveryConfiguration",args:[recoveryId]});
 const response=await fetcher(HUB_WALLET_RPC_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:account.address,data},"latest"]})});
 if(!response.ok)throw new Error("recovery_status_unavailable");const payload=await response.json()as{result?:`0x${string}`;error?:unknown};if(payload.error||!payload.result)throw new Error("recovery_status_unavailable");
 const [validator,,returnedPublicKey,,validAfter,active]=decodeFunctionResult({abi:ACCOUNT_RECOVERY_ABI,functionName:"recoveryConfiguration",data:payload.result});
 const confirmed=active&&validator.toLowerCase()===deployment.validator.toLowerCase()&&returnedPublicKey.toLowerCase()===publicKey.toLowerCase();
 const configured=validator.toLowerCase()===deployment.validator.toLowerCase()&&returnedPublicKey.toLowerCase()===publicKey.toLowerCase()&&validAfter>0n;
 const updated={...account,backupOnchainRegisteredAt:confirmed?new Date().toISOString():undefined,backupOnchainValidAfter:configured?new Date(Number(validAfter)*1000).toISOString():undefined};localStorage.setItem(HUB_PASSKEY_STORAGE_KEY,JSON.stringify(updated));return updated;
}

export async function passkeyPublicKeyHash(qx:`0x${string}`,qy:`0x${string}`):Promise<`0x${string}`>{
 const bytes=new Uint8Array([...qx.slice(2),...qy.slice(2)].map((_,index,all)=>index%2===0?parseInt(all.slice(index,index+2).join(""),16):-1).filter(value=>value>=0));
 return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
}

export async function createMerchantMemberPasskey():Promise<{credentialId:string;publicKeyX:`0x${string}`;publicKeyY:`0x${string}`;credentialHash:`0x${string}`}>{
 if(!navigator.credentials?.create||!window.PublicKeyCredential)throw new Error("passkey_unavailable");const challenge=crypto.getRandomValues(new Uint8Array(32)),userId=crypto.getRandomValues(new Uint8Array(32));const credential=await navigator.credentials.create({publicKey:{challenge,rp:{id:location.hostname,name:"JKamma 店舗ウォレット"},user:{id:userId,name:`merchant-member-${base64Url(userId)}`,displayName:"店舗ウォレット メンバー"},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{residentKey:"required",requireResidentKey:true,userVerification:"required"},attestation:"none",timeout:60_000}})as PublicKeyCredential|null;if(!credential)throw new Error("passkey_creation_cancelled");const response=credential.response as AuthenticatorAttestationResponse,publicKey=response.getPublicKey?.();if(!publicKey)throw new Error("passkey_public_key_unavailable");const{qx,qy}=extractP256PublicKey(publicKey);return{credentialId:base64Url(new Uint8Array(credential.rawId)),publicKeyX:qx,publicKeyY:qy,credentialHash:await passkeyPublicKeyHash(qx,qy)};
}
