import type { PublicSourcedRecord } from "./seed/public-snapshot";
import { loadWorkerData, type WorkerDataEnv } from "../server/worker-data";

/*
 * Claim graph (sources + provenance) of approved sourced factory records, for
 * the MCP claim view. Generated at build time by
 * scripts/generate-hubpedia-public-seed.mjs; see public-seed.ts for why request
 * paths must not import the full factory catalog, and for why this is read from
 * a static asset on first use instead of imported.
 */
export function getPublicSourcedFactoryRecords(env?: WorkerDataEnv | null): Promise<PublicSourcedRecord[]> {
  return loadWorkerData("hubpedia-public-claims", (value) => {
    if (!Array.isArray(value)) throw new Error("The public Hubpedia claim graph has an unexpected shape.");
    return value as unknown as PublicSourcedRecord[];
  }, env);
}
