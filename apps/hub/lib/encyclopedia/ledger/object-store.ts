import { createHash } from "node:crypto";

/*
 * Object storage for the Hubpedia ledger (docs/hubpedia-ledger.md, "Storage").
 *
 * Source bodies and term-net snapshot files are immutable text objects keyed by their SHA-256.
 * D1 keeps only the key, the hash and the byte length; chunks keep char offsets and a chunk hash.
 * Every read verifies the hash and fails closed (throws LedgerObjectError) on a missing object or a mismatch.
 */

export interface LedgerObjectStore {
  has(key: string): Promise<boolean>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<string | null>;
  put(key: string, body: string): Promise<void>;
}

export type LedgerObjectErrorCode = "missing" | "mismatch" | "no-store" | "range";

export class LedgerObjectError extends Error {
  constructor(readonly code: LedgerObjectErrorCode, message: string) {
    super(message);
    this.name = "LedgerObjectError";
  }
}

export const sha256Text = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const HASH = /^[0-9a-f]{64}$/u;

export const SNAPSHOT_PREFIX = "hubpedia-ledger/snapshots/";
export const TERM_NET_PREFIX = "hubpedia-ledger/term-net/";
export const snapshotObjectKey = (sha256: string) => `${SNAPSHOT_PREFIX}${sha256}.txt`;
export const termNetObjectKey = (sha256: string) => `${TERM_NET_PREFIX}${sha256}.jsonl`;

export interface ObjectRef {
  key: string;
  sha256: string;
  bytes: number;
}

/** Writes `text` under its content hash. Identical bodies share one object; an existing object is never rewritten. */
async function putByHash(store: LedgerObjectStore, keyOf: (sha: string) => string, text: string): Promise<ObjectRef & { stored: boolean }> {
  const sha256 = sha256Text(text);
  const key = keyOf(sha256);
  const bytes = Buffer.byteLength(text, "utf8");
  if (await store.has(key)) return { key, sha256, bytes, stored: false };
  await store.put(key, text);
  return { key, sha256, bytes, stored: true };
}

export const putSnapshotBody = (store: LedgerObjectStore, text: string) => putByHash(store, snapshotObjectKey, text);
export const putTermNetSnapshot = (store: LedgerObjectStore, text: string) => putByHash(store, termNetObjectKey, text);

/** Reads an object and checks it against the hash D1 recorded. */
export async function readVerifiedObject(store: LedgerObjectStore | undefined, ref: { key: string; sha256: string }): Promise<string> {
  if (!store) throw new LedgerObjectError("no-store", `No object store is configured; cannot read ${ref.key}.`);
  if (!HASH.test(ref.sha256)) throw new LedgerObjectError("mismatch", `Invalid recorded hash for ${ref.key}.`);
  const body = await store.get(ref.key);
  if (body === null) throw new LedgerObjectError("missing", `Object ${ref.key} is missing.`);
  if (sha256Text(body) !== ref.sha256) throw new LedgerObjectError("mismatch", `Object ${ref.key} does not match its recorded SHA-256.`);
  return body;
}

export interface ChunkLocator {
  /** Snapshot body location; null for a legacy chunk whose text still lives in D1. */
  bodyKey: string | null;
  bodySha256: string | null;
  startOffset: number;
  endOffset: number;
  contentHash: string | null;
  /** text_content column; '' for ledger chunks. */
  legacyText: string | null;
}

/**
 * Reads chunk text for the verbatim checks. Each snapshot body is fetched and hash-checked once per reader,
 * then sliced by offsets; the slice must reproduce the chunk hash.
 */
export class SnapshotReader {
  private readonly bodies = new Map<string, Promise<string>>();
  constructor(private readonly store: LedgerObjectStore | undefined, private readonly maxCached = 8) {}

  body(ref: { key: string; sha256: string }): Promise<string> {
    const cached = this.bodies.get(ref.key);
    if (cached) return cached;
    if (this.bodies.size >= this.maxCached) this.bodies.delete(this.bodies.keys().next().value as string);
    const pending = readVerifiedObject(this.store, ref);
    this.bodies.set(ref.key, pending);
    pending.catch(() => this.bodies.delete(ref.key));
    return pending;
  }

  async chunkText(locator: ChunkLocator): Promise<string> {
    if (!locator.bodyKey) {
      if (locator.legacyText) return locator.legacyText;
      throw new LedgerObjectError("missing", "Chunk has neither a body reference nor stored text.");
    }
    if (!locator.bodySha256) throw new LedgerObjectError("mismatch", `Snapshot ${locator.bodyKey} has no recorded hash.`);
    const body = await this.body({ key: locator.bodyKey, sha256: locator.bodySha256 });
    if (locator.startOffset < 0 || locator.endOffset < locator.startOffset || locator.endOffset > body.length) {
      throw new LedgerObjectError("range", `Chunk offsets ${locator.startOffset}-${locator.endOffset} fall outside ${locator.bodyKey}.`);
    }
    const text = body.slice(locator.startOffset, locator.endOffset);
    if (locator.contentHash && sha256Text(text) !== locator.contentHash) {
      throw new LedgerObjectError("mismatch", `Chunk text at ${locator.startOffset}-${locator.endOffset} does not match its recorded hash.`);
    }
    return text;
  }
}

/** SQL fragment: the columns a reader needs to build a ChunkLocator from a chunk row and its snapshot row. */
export const chunkLocatorColumns = (chunk = "ch", snapshot = "sn") =>
  `${chunk}.start_offset AS startOffset, ${chunk}.end_offset AS endOffset, ${chunk}.content_hash AS contentHash, ${chunk}.text_content AS legacyText, ${snapshot}.body_object_key AS bodyKey, ${snapshot}.body_sha256 AS bodySha256`;

/* ---------- adapters ---------- */

/** Structural subset of Cloudflare's R2Bucket, so this module needs no Workers types. */
export interface R2BucketLike {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export function r2ObjectStore(bucket: R2BucketLike): LedgerObjectStore {
  return {
    async has(key) { return (await bucket.head(key)) !== null; },
    async get(key) { const object = await bucket.get(key); return object ? object.text() : null; },
    async put(key, body) { await bucket.put(key, body, { httpMetadata: { contentType: "text/plain; charset=utf-8" } }); },
  };
}

/** In-memory store for tests. */
export function memoryObjectStore(): LedgerObjectStore & { objects: Map<string, string>; puts: number } {
  const objects = new Map<string, string>();
  const store = {
    objects,
    puts: 0,
    async has(key: string) { return objects.has(key); },
    async get(key: string) { return objects.get(key) ?? null; },
    async put(key: string, body: string) { store.puts += 1; objects.set(key, body); },
  };
  return store;
}
