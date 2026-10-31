import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database, Queue, R2Bucket } from "@cloudflare/workers-types";

import { r2ObjectStore, type LedgerObjectStore, type R2BucketLike } from "@/lib/encyclopedia/ledger/object-store";

function isD1Database(value: unknown): value is D1Database {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "prepare") === "function";
}

function isR2Bucket(value: unknown): value is R2Bucket {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "put") === "function";
}

function isQueue(value: unknown): value is Queue {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "send") === "function";
}

export class HubD1UnavailableError extends Error {
  constructor(message = "HUB_DATABASE D1 binding is unavailable.") {
    super(message);
    this.name = "HubD1UnavailableError";
  }
}

export class HubMediaUnavailableError extends Error {
  constructor(message = "HUB_MEDIA R2 binding is unavailable.") {
    super(message);
    this.name = "HubMediaUnavailableError";
  }
}

function getBinding(name: "HUB_DATABASE" | "HUB_MEDIA" | "HUB_LEDGER_SOURCES" | "HUB_JOBS" | "HUB_ADS_QUARANTINE" | "HUB_ADS_ASSETS"): unknown {
  return Reflect.get(getCloudflareContext().env, name);
}

/**
 * Returns the Hub-only D1 binding from the current Worker request context.
 * Hub data must never be read from Vault or Identity databases.
 */
export function getHubD1(): D1Database {
  const database = getBinding("HUB_DATABASE");
  if (!isD1Database(database)) {
    throw new HubD1UnavailableError();
  }
  return database;
}

/** Returns null in the plain Next.js local preview where Worker bindings do not exist. */
export function getOptionalHubD1(): D1Database | null {
  try {
    const database = getBinding("HUB_DATABASE");
    return isD1Database(database) ? database : null;
  } catch {
    return null;
  }
}

export function getHubMedia(): R2Bucket {
  const bucket = getBinding("HUB_MEDIA");
  if (!isR2Bucket(bucket)) {
    throw new HubMediaUnavailableError();
  }
  return bucket;
}

/**
 * The Hubpedia ledger's source-body bucket (HUB_LEDGER_SOURCES), wrapped as a ledger object store.
 * undefined when the binding is absent: readers then fail closed and show no ledger body.
 */
export function getOptionalHubLedgerObjects(): LedgerObjectStore | undefined {
  try {
    const bucket = getBinding("HUB_LEDGER_SOURCES");
    return isR2Bucket(bucket) ? r2ObjectStore(bucket as unknown as R2BucketLike) : undefined;
  } catch {
    return undefined;
  }
}

export function getHubAdsQuarantine(): R2Bucket {
  const bucket = getBinding("HUB_ADS_QUARANTINE");
  if (!isR2Bucket(bucket)) throw new Error("HUB_ADS_QUARANTINE R2 binding is not configured.");
  return bucket;
}

export function getHubAdsAssets(): R2Bucket {
  const bucket = getBinding("HUB_ADS_ASSETS");
  if (!isR2Bucket(bucket)) throw new Error("HUB_ADS_ASSETS R2 binding is not configured.");
  return bucket;
}

export function getHubJobsQueue(): Queue {
  const queue = getBinding("HUB_JOBS");
  if (!isQueue(queue)) {
    throw new Error("HUB_JOBS Queue binding is not configured.");
  }
  return queue;
}
