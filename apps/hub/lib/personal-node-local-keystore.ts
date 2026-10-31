"use client";

const DATABASE_NAME = "hub.personal-node";
const DATABASE_VERSION = 2;
const STORE_NAME = "keys";
const EVENT_MARKER_STORE_NAME = "event-markers";
const ROOT_KEY_ID = "root";
const PENDING_ROOT_KEY_ID = "pending-recovery-root";
const BACKUP_FORMAT = "hub.personal-node.recovery-key";
const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;

export type PublicP256Jwk = JsonWebKey & {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
};

type StoredRootKey = {
  id: string;
  privateKey: CryptoKey;
  publicKeyJwk: PublicP256Jwk;
  createdAt: string;
  scopes?: string[];
};

export type EncryptedRecoveryKey = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  label: string;
  publicKeyJwk: PublicP256Jwk;
  kdf: "PBKDF2-SHA-256";
  iterations: typeof PBKDF2_ITERATIONS;
  salt: string;
  cipher: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  createdAt: string;
};

function requireBrowserCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    throw new Error("local_keystore_unavailable");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  requireBrowserCrypto();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(EVENT_MARKER_STORE_NAME)) {
        request.result.createObjectStore(EVENT_MARKER_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("local_keystore_open_failed"));
  });
}

async function readRootRecord(): Promise<StoredRootKey | null> {
  return readKeyRecord(ROOT_KEY_ID);
}

async function readKeyRecord(id: string): Promise<StoredRootKey | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(id);
      request.onsuccess = () => resolve((request.result as StoredRootKey | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("local_keystore_read_failed"));
    });
  } finally {
    database.close();
  }
}

async function writeRootRecord(record: StoredRootKey): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("local_keystore_write_failed"));
    });
  } finally {
    database.close();
  }
}

async function listKeyRecords(): Promise<StoredRootKey[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .getAll();
      request.onsuccess = () => resolve(request.result as StoredRootKey[]);
      request.onerror = () => reject(request.error ?? new Error("local_keystore_list_failed"));
    });
  } finally {
    database.close();
  }
}

async function hasEventMarker(id: string): Promise<boolean> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(EVENT_MARKER_STORE_NAME, "readonly")
        .objectStore(EVENT_MARKER_STORE_NAME)
        .getKey(id);
      request.onsuccess = () => resolve(request.result != null);
      request.onerror = () => reject(request.error ?? new Error("event_marker_read_failed"));
    });
  } finally {
    database.close();
  }
}

async function writeEventMarker(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(EVENT_MARKER_STORE_NAME, "readwrite")
        .objectStore(EVENT_MARKER_STORE_NAME)
        .put({ id, recordedAt: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("event_marker_write_failed"));
    });
  } finally {
    database.close();
  }
}

export async function readLocalRootKey(): Promise<Omit<StoredRootKey, "privateKey"> | null> {
  const record = await readRootRecord();
  return record
    ? { id: record.id, publicKeyJwk: record.publicKeyJwk, createdAt: record.createdAt }
    : null;
}

export async function createLocalRootKey(): Promise<Omit<StoredRootKey, "privateKey">> {
  requireBrowserCrypto();
  if (await readRootRecord()) throw new Error("local_root_key_exists");
  const record = await generateStoredKey(ROOT_KEY_ID);
  await writeRootRecord(record);
  return { id: record.id, publicKeyJwk: record.publicKeyJwk, createdAt: record.createdAt };
}

export async function signWithLocalRootKey(message: string): Promise<string> {
  const record = await readRootRecord();
  if (!record) throw new Error("local_root_key_missing");
  return signWithStoredKey(record, message);
}

export async function createPendingRecoveryRootKey(): Promise<PublicP256Jwk> {
  const record = await generateStoredKey(PENDING_ROOT_KEY_ID);
  await writeRootRecord(record);
  return record.publicKeyJwk;
}

export async function signWithPendingRecoveryRootKey(message: string): Promise<string> {
  const record = await readKeyRecord(PENDING_ROOT_KEY_ID);
  if (!record) throw new Error("pending_recovery_root_missing");
  return signWithStoredKey(record, message);
}

export async function promotePendingRecoveryRootKey(): Promise<void> {
  const pending = await readKeyRecord(PENDING_ROOT_KEY_ID);
  if (!pending) throw new Error("pending_recovery_root_missing");
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put({ ...pending, id: ROOT_KEY_ID });
      store.delete(PENDING_ROOT_KEY_ID);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("pending_recovery_root_promotion_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("pending_recovery_root_promotion_failed"));
    });
  } finally {
    database.close();
  }
}

export async function discardPendingRecoveryRootKey(): Promise<void> {
  await deleteKeyRecord(PENDING_ROOT_KEY_ID);
}

export async function deleteLocalRootKey(): Promise<void> {
  await deleteKeyRecord(ROOT_KEY_ID);
}

async function deleteKeyRecord(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite")
        .objectStore(STORE_NAME)
        .delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("local_keystore_delete_failed"));
    });
  } finally {
    database.close();
  }
}

export async function createEncryptedRecoveryKey(
  label: string,
  passphrase: string,
): Promise<EncryptedRecoveryKey> {
  if (passphrase.length < 16) throw new Error("recovery_passphrase_too_short");
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.publicKey) as Promise<PublicP256Jwk>,
    crypto.subtle.exportKey("jwk", pair.privateKey),
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(privateKeyJwk)),
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    label: label.trim() || "Recovery key",
    publicKeyJwk,
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: base64Url(salt),
    cipher: "AES-256-GCM",
    iv: base64Url(iv),
    ciphertext: base64Url(new Uint8Array(ciphertext)),
    createdAt: new Date().toISOString(),
  };
}

export async function signWithEncryptedRecoveryKey(
  bundle: EncryptedRecoveryKey,
  passphrase: string,
  message: string,
): Promise<string> {
  validateRecoveryBundle(bundle);
  const key = await deriveBackupKey(passphrase, fromBase64Url(bundle.salt), ["decrypt"]);
  let privateKeyJwk: JsonWebKey;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(bundle.iv) },
      key,
      fromBase64Url(bundle.ciphertext),
    );
    privateKeyJwk = JSON.parse(new TextDecoder().decode(plaintext)) as JsonWebKey;
  } catch {
    throw new Error("recovery_key_decryption_failed");
  }
  if (privateKeyJwk.kty !== "EC" || privateKeyJwk.crv !== "P-256" ||
      privateKeyJwk.x !== bundle.publicKeyJwk.x ||
      privateKeyJwk.y !== bundle.publicKeyJwk.y ||
      typeof privateKeyJwk.d !== "string") {
    throw new Error("recovery_key_bundle_mismatch");
  }
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(message),
  );
  return base64Url(new Uint8Array(signature));
}

export async function recoveryKeyThumbprint(publicKeyJwk: PublicP256Jwk): Promise<string> {
  const canonical = JSON.stringify({
    crv: publicKeyJwk.crv,
    kty: publicKeyJwk.kty,
    x: publicKeyJwk.x,
    y: publicKeyJwk.y,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type LocalDevicePairing = {
  protocol: "hub.personal-node.device-pair";
  version: 1;
  pairingId: string;
  label: string;
  deviceType: "mobile" | "computer" | "server" | "backup" | "agent";
  scopes: string[];
  publicKeyJwk: PublicP256Jwk;
  keyThumbprint: string;
  createdAt: string;
  expiresAt: string;
};

export async function createLocalDevicePairing(input: {
  label: string;
  deviceType: LocalDevicePairing["deviceType"];
  scopes: string[];
}): Promise<LocalDevicePairing> {
  const pairingId = crypto.randomUUID();
  const record = await generateStoredKey(`device-draft:${pairingId}`);
  await writeRootRecord({ ...record, scopes: [...input.scopes].sort() });
  const createdAt = new Date();
  return {
    protocol: "hub.personal-node.device-pair",
    version: 1,
    pairingId,
    label: input.label.trim(),
    deviceType: input.deviceType,
    scopes: [...input.scopes].sort(),
    publicKeyJwk: record.publicKeyJwk,
    keyThumbprint: await recoveryKeyThumbprint(record.publicKeyJwk),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 10 * 60_000).toISOString(),
  };
}

export function parseLocalDevicePairing(value: string): LocalDevicePairing {
  const parsed = JSON.parse(decodeBase64UrlText(value)) as LocalDevicePairing;
  const deviceTypes = new Set(["mobile", "computer", "server", "backup", "agent"]);
  const scopes = new Set([
    "profile:write", "post:write", "follow:write", "preference:write",
    "agent:delegate", "relay:receive",
  ]);
  if (parsed.protocol !== "hub.personal-node.device-pair" || parsed.version !== 1 ||
      !/^[0-9a-f-]{36}$/i.test(parsed.pairingId) ||
      !parsed.label || parsed.label.length > 80 ||
      !deviceTypes.has(parsed.deviceType) ||
      !parsed.publicKeyJwk || parsed.publicKeyJwk.kty !== "EC" ||
      parsed.publicKeyJwk.crv !== "P-256" || !parsed.publicKeyJwk.x ||
      !parsed.publicKeyJwk.y || parsed.publicKeyJwk.d != null ||
      !Array.isArray(parsed.scopes) || parsed.scopes.length < 1 ||
      parsed.scopes.some((scope) => !scopes.has(scope)) ||
      new Set(parsed.scopes).size !== parsed.scopes.length ||
      !Number.isFinite(Date.parse(parsed.expiresAt)) ||
      Date.parse(parsed.expiresAt) <= Date.now() ||
      Date.parse(parsed.expiresAt) > Date.now() + 11 * 60_000) {
    throw new Error("device_pairing_invalid");
  }
  return parsed;
}

export function encodeLocalDevicePairing(pairing: LocalDevicePairing): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(pairing)));
}

export async function activateLocalDevicePairing(
  pairingId: string,
  deviceId: string,
  expectedThumbprint: string,
): Promise<void> {
  const draft = await readKeyRecord(`device-draft:${pairingId}`);
  if (!draft || await recoveryKeyThumbprint(draft.publicKeyJwk) !== expectedThumbprint) {
    throw new Error("device_pairing_key_missing");
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put({ ...draft, id: `device:${deviceId}` });
      store.delete(`device-draft:${pairingId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("device_pairing_activation_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("device_pairing_activation_failed"));
    });
  } finally {
    database.close();
  }
}

export async function discardLocalDevicePairing(pairingId: string): Promise<void> {
  await deleteKeyRecord(`device-draft:${pairingId}`);
}

export type PortableEventType =
  | "hub.post.create"
  | "hub.post.update"
  | "hub.post.delete"
  | "hub.follow.create"
  | "hub.follow.delete"
  | "hub.profile.update"
  | "hub.preference.update"
  | "hub.agent.permission.update"
  | "hub.translation.publish";

export async function recordPersonalNodeEvent(
  type: PortableEventType,
  payload: Record<string, unknown>,
): Promise<"signed" | "unavailable" | "failed"> {
  try {
    const signer = await findEventSigner(type);
    if (!signer) return "unavailable";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headResponse = await personalNodeAction({ action: "event_head" });
      if (!headResponse.ok) return headResponse.status === 503 ? "unavailable" : "failed";
      const head = await headResponse.json() as { sequence: number; eventHash: string | null };
      const event = {
        id: crypto.randomUUID(),
        sequence: head.sequence + 1,
        ...(head.eventHash ? { previousHash: head.eventHash } : {}),
        type,
        payload,
        createdAt: new Date().toISOString(),
      };
      const signature = await signWithStoredKey(signer.record, canonicalJson(event));
      const response = await personalNodeAction({
        action: "event",
        event,
        signature,
        keyId: signer.keyId,
      });
      if (response.ok) return "signed";
    }
    return "failed";
  } catch {
    return "unavailable";
  }
}

/**
 * Records an event once for an idempotent client operation.  The marker is
 * deliberately device-local: Federation remains the verifier and source of
 * the signed event chain, while this marker only prevents a browser retry
 * from appending the same user action twice.
 */
export async function recordPersonalNodeEventOnce(
  type: PortableEventType,
  operationId: string,
  payload: Record<string, unknown>,
): Promise<"signed" | "unavailable" | "failed"> {
  const normalizedOperationId = operationId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalizedOperationId)) return "failed";
  const markerKey = `hub.personal-node.event.${type}.${normalizedOperationId}`;
  try {
    if (await hasEventMarker(markerKey)) return "signed";
  } catch {
    // Federation still verifies the signed chain when the optimization store fails.
  }
  const result = await recordPersonalNodeEvent(type, {
    ...payload,
    operationId: normalizedOperationId,
  });
  if (result === "signed") {
    try {
      await writeEventMarker(markerKey);
    } catch {
      // A missing optimization marker must not invalidate a signed event.
    }
  }
  return result;
}

function validateRecoveryBundle(bundle: EncryptedRecoveryKey) {
  if (bundle.format !== BACKUP_FORMAT || bundle.version !== BACKUP_VERSION ||
      bundle.iterations !== PBKDF2_ITERATIONS || bundle.kdf !== "PBKDF2-SHA-256" ||
      bundle.cipher !== "AES-256-GCM" || !bundle.ciphertext ||
      fromBase64Url(bundle.salt).length !== 16 || fromBase64Url(bundle.iv).length !== 12) {
    throw new Error("recovery_key_bundle_invalid");
  }
}

async function deriveBackupKey(
  passphrase: string,
  salt: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

async function generateStoredKey(id: string): Promise<StoredRootKey> {
  requireBrowserCrypto();
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicKeyJwk, privateKeyJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", generated.publicKey) as Promise<PublicP256Jwk>,
    crypto.subtle.exportKey("jwk", generated.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return { id, privateKey, publicKeyJwk, createdAt: new Date().toISOString() };
}

async function signWithStoredKey(record: StoredRootKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    record.privateKey,
    new TextEncoder().encode(message),
  );
  return base64Url(new Uint8Array(signature));
}

async function findEventSigner(type: PortableEventType): Promise<{
  keyId: string;
  record: StoredRootKey;
} | null> {
  const requiredScope = type.startsWith("hub.post.")
    ? "post:write"
    : type.startsWith("hub.follow.")
      ? "follow:write"
      : type === "hub.profile.update"
        ? "profile:write"
        : type === "hub.agent.permission.update"
          ? "agent:delegate"
          : "preference:write";
  const records = await listKeyRecords();
  const device = records.find((record) =>
    record.id.startsWith("device:") && record.scopes?.includes(requiredScope));
  if (device) return { keyId: device.id.slice("device:".length), record: device };
  const root = records.find((record) => record.id === ROOT_KEY_ID);
  return root ? { keyId: "root", record: root } : null;
}

function personalNodeAction(body: Record<string, unknown>) {
  return fetch("/api/core/personal-node", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1_500),
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("base64url_invalid");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeBase64UrlText(value: string): string {
  return new TextDecoder().decode(fromBase64Url(value));
}
