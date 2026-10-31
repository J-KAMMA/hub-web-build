// apps/wallet-extension/src/passkey.js の移植。
// WebAuthn P-256 パスキーの作成・署名・DERパース・署名エンコード。
// navigator.credentials を注入可能にしてテストできる形は拡張機能と同じ。

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): `0x${string}` {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function bytesFromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (item) => item.charCodeAt(0));
}

function abiWord(value: string): string {
  const raw = value.replace(/^0x/, "");
  return raw.padStart(64, "0");
}

function abiBytes(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const body = hex(bytes).slice(2);
  return `${abiWord(`0x${bytes.length.toString(16)}`)}${body.padEnd(Math.ceil(body.length / 64) * 64, "0")}`;
}

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const P256_SPKI_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

export function dummyWebAuthnSignature(userOpHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash ?? "")) throw new Error("invalid_dummy_user_operation_hash");
  const challenge = base64Url(Uint8Array.from(userOpHash.slice(2).match(/../g) ?? [], (item) => Number.parseInt(item, 16)));
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://wallet.jkamma.com"}`;
  const authenticatorData = new Uint8Array(37); authenticatorData[32] = 0x05;
  const authTail = abiBytes(authenticatorData); const clientTail = abiBytes(clientDataJSON); const headSize = 6 * 32;
  return `0x${abiWord("0x1")}${abiWord("0x1")}${abiWord(`0x${clientDataJSON.indexOf('"challenge":"').toString(16)}`)}${abiWord(`0x${clientDataJSON.indexOf('"type":"webauthn.get"').toString(16)}`)}${abiWord(`0x${headSize.toString(16)}`)}${abiWord(`0x${(headSize + authTail.length / 2).toString(16)}`)}${authTail}${clientTail}`;
}

export function parseP256Der(signature: ArrayBuffer | Uint8Array): { r: string; s: string } {
  const bytes = new Uint8Array(signature);
  if (bytes.length < 8 || bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2 || bytes[2] !== 0x02) throw new Error("invalid_passkey_signature");
  const rLength = bytes[3]; const sTag = 4 + rLength;
  if (!rLength || bytes[sTag] !== 0x02) throw new Error("invalid_passkey_signature");
  const sLength = bytes[sTag + 1]; const sStart = sTag + 2;
  if (!sLength || sStart + sLength !== bytes.length) throw new Error("invalid_passkey_signature");
  const integer = (part: Uint8Array) => BigInt(`0x${hex(part).slice(2) || "0"}`);
  const r = integer(bytes.slice(4, sTag)); let s = integer(bytes.slice(sStart));
  if (s > P256_N / 2n) s = P256_N - s;
  return { r: `0x${r.toString(16).padStart(64, "0")}`, s: `0x${s.toString(16).padStart(64, "0")}` };
}

export function encodeWebAuthnSignature({ authenticatorData, clientDataJSON, signature }: { authenticatorData: ArrayBuffer | Uint8Array; clientDataJSON: string; signature: ArrayBuffer | Uint8Array }): string {
  const { r, s } = parseP256Der(signature);
  const challengeIndex = clientDataJSON.indexOf('"challenge":"'); const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  if (challengeIndex < 0 || typeIndex < 0) throw new Error("invalid_client_data_json");
  const authTail = abiBytes(new Uint8Array(authenticatorData)); const clientTail = abiBytes(clientDataJSON);
  const headSize = 6 * 32;
  return `0x${abiWord(r)}${abiWord(s)}${abiWord(`0x${challengeIndex.toString(16)}`)}${abiWord(`0x${typeIndex.toString(16)}`)}${abiWord(`0x${headSize.toString(16)}`)}${abiWord(`0x${(headSize + authTail.length / 2).toString(16)}`)}${authTail}${clientTail}`;
}

export async function signUserOperationHash(credentialId: string, userOpHash: string, credentials: CredentialsContainer | undefined = typeof navigator !== "undefined" ? navigator.credentials : undefined): Promise<string> {
  if (!credentials?.get) throw new Error("webauthn_unavailable");
  if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) throw new Error("invalid_user_operation_hash");
  const assertion = await credentials.get({ publicKey: { challenge: Uint8Array.from(userOpHash.slice(2).match(/../g) ?? [], (item) => Number.parseInt(item, 16)) as BufferSource, allowCredentials: [{ id: bytesFromBase64Url(credentialId) as BufferSource, type: "public-key", transports: ["internal", "hybrid"] }], userVerification: "required", timeout: 60_000 } }) as PublicKeyCredential | null;
  if (!assertion) throw new Error("passkey_signing_cancelled");
  const response = assertion.response as AuthenticatorAssertionResponse;
  return encodeWebAuthnSignature({ authenticatorData: response.authenticatorData, clientDataJSON: new TextDecoder().decode(response.clientDataJSON), signature: response.signature });
}

export async function signWalletHash(state: { passkeyCredentialId?: string | null; activePasskeyCredentialId?: string | null; activePasskeyCredentialHash?: string | null; allowRecoverySignature?: boolean }, hash: string, credentials?: CredentialsContainer): Promise<string> {
  // Recovery keys are purpose-limited by the smart-account contract. Never use
  // one for ordinary messages or transactions; only the explicit promotion
  // flow may opt in to the recovery-signature envelope.
  const useRecovery = state.allowRecoverySignature === true;
  const credentialId = useRecovery
    ? state.activePasskeyCredentialId
    : state.passkeyCredentialId;
  if (!credentialId) throw new Error("passkey_signer_not_configured");
  const signature = await signUserOperationHash(credentialId, hash, credentials);
  const credentialHash = useRecovery ? state.activePasskeyCredentialHash : null;
  if (!credentialHash) return signature;
  if (!/^0x[0-9a-fA-F]{64}$/.test(credentialHash)) throw new Error("invalid_recovery_credential_hash");
  return `${credentialHash}${signature.slice(2)}`;
}

export function extractP256PublicKey(spki: ArrayBuffer | Uint8Array): { qx: string; qy: string } {
  const bytes = new Uint8Array(spki);
  if (bytes.length !== 91 || hex(bytes.slice(0, 26)).slice(2) !== P256_SPKI_PREFIX) throw new Error("invalid_passkey_public_key");
  const point = bytes.slice(-65);
  if (point[0] !== 4) throw new Error("unsupported_passkey_curve");
  const qx = hex(point.slice(1, 33)), qy = hex(point.slice(33, 65)), x = BigInt(qx), y = BigInt(qy);
  if (x >= P256_P || y >= P256_P || y * y % P256_P !== (x * x % P256_P * x - 3n * x + P256_B + 3n * P256_P) % P256_P) throw new Error("invalid_passkey_public_key");
  return { qx, qy };
}

export async function createWalletPasskey(credentials: CredentialsContainer | undefined = typeof navigator !== "undefined" ? navigator.credentials : undefined): Promise<{ credentialId: string; qx: string; qy: string; createdAt: string }> {
  if (!credentials?.create) throw new Error("webauthn_unavailable");
  const userId = crypto.getRandomValues(new Uint8Array(32));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await credentials.create({ publicKey: {
    challenge: challenge as BufferSource,
    rp: { name: "Hub Wallet" },
    user: { id: userId as BufferSource, name: `wallet-${base64Url(userId)}`, displayName: "Hub Wallet" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    attestation: "none",
    timeout: 60_000,
  } }) as PublicKeyCredential | null;
  if (!credential || credential.type !== "public-key") throw new Error("passkey_creation_cancelled");
  const response = credential.response as AuthenticatorAttestationResponse;
  const publicKey = response.getPublicKey?.();
  if (!publicKey) throw new Error("passkey_public_key_unavailable");
  return { credentialId: base64Url(new Uint8Array(credential.rawId)), ...extractP256PublicKey(publicKey), createdAt: new Date().toISOString() };
}
