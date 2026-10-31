#!/usr/bin/env node
// Fills apps/hub and apps/federation self-host templates into
// wrangler.selfhost.jsonc (gitignored). No network access, no secrets.
//
// CLI:  node scripts/materialize-selfhost-config.mjs --input selfhost.json
//       node scripts/materialize-selfhost-config.mjs --origin https://hub.example.org \
//            --name "My Hub" --contact admin@example.org --d1-hub-id <id> --d1-federation-id <id>
// Options: --profile production|local   local drops routes/assets/alias/crons/observability, environment=development,
//                                       D1 ids optional (for `wrangler dev --local` / `next dev`)
//          --out-dir <dir>              write <dir>/hub/wrangler.jsonc and <dir>/federation/wrangler.jsonc with absolute paths
//          --name-prefix <slug>         resource-name prefix (default: host plus non-default port)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const hubDir = path.resolve(here, "..");
export const federationDir = path.resolve(hubDir, "..", "federation");

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates and normalizes an origin. Throws Error with a plain message. */
export function parseOrigin(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("origin is not a valid URL");
  }
  if (url.username || url.password) throw new Error("origin must not contain credentials");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("origin must not contain a path, query or fragment");
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("origin must be https (http is allowed only for loopback)");
  }
  const host = url.hostname.toLowerCase();
  if (host === "jkamma.com" || host.endsWith(".jkamma.com")) {
    throw new Error("a self-hosted Hub must not use a jkamma.com host");
  }
  return { origin: url.origin, host: url.host, hostname: host, port: url.port, loopback };
}

// A non-default port is part of the slug so http://127.0.0.1:3030 and :8797 never share resource names.
function slugOf(hostname, port = "") {
  const base = port ? `${hostname}-${port}` : hostname;
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "") || "hub";
}

const PROFILES = new Set(["production", "local"]);
const NAME_PREFIX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const LOCAL_D1_HUB_ID = "00000000-0000-4000-8000-0000000000a1";
const LOCAL_D1_FEDERATION_ID = "00000000-0000-4000-8000-0000000000a2";

function defaultZone(hostname) {
  const parts = hostname.split(".");
  return parts.length <= 2 ? hostname : parts.slice(-2).join(".");
}

function clean(value, label, max) {
  const text = String(value ?? "").trim();
  if (/[\u0000-\u001f"\\]/.test(text)) throw new Error(`${label} must not contain control characters, quotes or backslashes`);
  if (text.length > max) throw new Error(`${label} is too long (max ${max})`);
  return text;
}

/** Builds the placeholder values from operator input. */
export function buildValues(input, { allowMissingIds = false } = {}) {
  const o = parseOrigin(input.origin);
  const name = clean(input.name || o.hostname, "name", 80);
  if (!name) throw new Error("name is required");
  const contact = clean(input.contact, "contact", 200);
  if (!contact) throw new Error("contact is required");
  const profile = input.profile ?? "production";
  if (!PROFILES.has(profile)) throw new Error("profile must be production or local");
  const namePrefix = input.namePrefix == null || input.namePrefix === "" ? "" : String(input.namePrefix);
  if (namePrefix && !NAME_PREFIX.test(namePrefix)) {
    throw new Error("name-prefix must be 1-40 lowercase letters, digits or hyphens, not starting or ending with a hyphen");
  }
  const slug = namePrefix || slugOf(o.hostname, o.port);
  const sourceUrl = clean(input.sourceUrl ?? "", "source-url", 300);
  if (sourceUrl && !/^https:\/\//.test(sourceUrl)) throw new Error("source-url must be an https URL");
  const zone = clean(input.zone || defaultZone(o.hostname), "zone", 253);
  // The local profile never talks to Cloudflare, so the D1 ids only have to be well-formed.
  const hubId = input.d1HubId || (profile === "local" ? LOCAL_D1_HUB_ID : "");
  const fedId = input.d1FederationId || (profile === "local" ? LOCAL_D1_FEDERATION_ID : "");
  for (const [label, id] of [["d1-hub-id", hubId], ["d1-federation-id", fedId]]) {
    if (id && !UUID.test(id)) throw new Error(`${label} must be a UUID`);
    if (!id && !allowMissingIds) throw new Error(`${label} is required`);
  }
  return {
    HUB_PUBLIC_ORIGIN: o.origin,
    HUB_HOST: o.host,
    ZONE_NAME: zone,
    HUB_INSTANCE_NAME: name,
    HUB_ADMIN_CONTACT: contact,
    HUB_SOURCE_URL: sourceUrl,
    HUB_WORKER_NAME: `${slug}-hub`,
    FEDERATION_WORKER_NAME: `${slug}-federation`,
    HUB_D1_NAME: `${slug}-hub-db`,
    FEDERATION_D1_NAME: `${slug}-federation-db`,
    HUB_MEDIA_BUCKET: `${slug}-media`,
    HUB_JOBS_QUEUE: `${slug}-jobs`,
    HUB_JOBS_DLQ: `${slug}-jobs-dlq`,
    FEDERATION_QUEUE: `${slug}-federation-delivery`,
    FEDERATION_DLQ: `${slug}-federation-delivery-dead`,
    RATELIMIT_NS_READ: String(input.ratelimitNamespaceRead ?? 51001),
    RATELIMIT_NS_MUTATION: String(input.ratelimitNamespaceMutation ?? 51002),
    D1_HUB_ID: hubId || "<D1_HUB_ID>",
    D1_FEDERATION_ID: fedId || "<D1_FEDERATION_ID>",
  };
}

/** Replaces ${NAME} placeholders; fails on any unresolved one. */
export function renderTemplate(text, values) {
  const out = text.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, key) => {
    if (!(key in values)) throw new Error(`unresolved placeholder: ${key}`);
    return values[key];
  });
  return out;
}

export function templatePaths() {
  return {
    hub: path.join(hubDir, "wrangler.selfhost.template.jsonc"),
    federation: path.join(federationDir, "wrangler.selfhost.template.jsonc"),
  };
}

/**
 * Without outDir the configs go next to each app (production: wrangler.selfhost.jsonc,
 * local: wrangler.selfhost.local.jsonc). With outDir they go to <outDir>/hub/wrangler.jsonc and
 * <outDir>/federation/wrangler.jsonc, so each app gets its own directory for a neighbouring .dev.vars.
 */
export function outputPaths({ outDir, profile = "production" } = {}) {
  if (outDir) {
    const root = path.resolve(outDir);
    return {
      hub: path.join(root, "hub", "wrangler.jsonc"),
      federation: path.join(root, "federation", "wrangler.jsonc"),
    };
  }
  const file = profile === "local" ? "wrangler.selfhost.local.jsonc" : "wrangler.selfhost.jsonc";
  return { hub: path.join(hubDir, file), federation: path.join(federationDir, file) };
}

const LOCAL_DROPPED_KEYS = ["routes", "assets", "alias", "triggers", "observability"];

/** Rewrites paths that are relative to the app directory into absolute ones. Mutates and returns config. */
function absolutizePaths(config, appDir) {
  const abs = (value) => (typeof value === "string" && !path.isAbsolute(value) ? path.join(appDir, value) : value);
  delete config.$schema; // relative to the app directory; meaningless elsewhere
  if (config.main) config.main = abs(config.main);
  for (const entry of config.d1_databases ?? []) {
    if (entry.migrations_dir) entry.migrations_dir = abs(entry.migrations_dir);
  }
  if (config.assets?.directory) config.assets.directory = abs(config.assets.directory);
  for (const [key, value] of Object.entries(config.alias ?? {})) {
    if (typeof value === "string" && value.startsWith(".")) config.alias[key] = abs(value);
  }
  return config;
}

/** Local profile: what `wrangler dev --local` / `next dev` can run. No routes, assets, alias, crons or observability. */
function applyLocalProfile(config) {
  for (const key of LOCAL_DROPPED_KEYS) delete config[key];
  if (config.vars && "HUB_DEPLOYMENT_ENVIRONMENT" in config.vars) config.vars.HUB_DEPLOYMENT_ENVIRONMENT = "development";
  return config;
}

/**
 * Pure: returns { hub, federation } rendered text.
 * options.profile "local" strips the production-only parts; options.absolutePaths (implied by outDir
 * elsewhere than the app directory) rewrites relative paths to absolute ones.
 */
export function renderConfigs(values, { profile = "production", absolutePaths = false } = {}) {
  if (!PROFILES.has(profile)) throw new Error("profile must be production or local");
  const t = templatePaths();
  const texts = {
    hub: renderTemplate(readFileSync(t.hub, "utf8"), values),
    federation: renderTemplate(readFileSync(t.federation, "utf8"), values),
  };
  if (profile === "production" && !absolutePaths) return texts;
  const dirs = { hub: hubDir, federation: federationDir };
  const out = {};
  for (const app of ["hub", "federation"]) {
    const config = JSON.parse(texts[app]);
    if (profile === "local") applyLocalProfile(config);
    if (absolutePaths) absolutizePaths(config, dirs[app]);
    out[app] = JSON.stringify(config, null, 2) + "\n";
  }
  return out;
}

export function materialize(input, { write = true } = {}) {
  const profile = input.profile ?? "production";
  const values = buildValues(input);
  const out = outputPaths({ outDir: input.outDir, profile });
  const rendered = renderConfigs(values, { profile, absolutePaths: Boolean(input.outDir) });
  if (write) {
    for (const app of ["hub", "federation"]) {
      mkdirSync(path.dirname(out[app]), { recursive: true });
      writeFileSync(out[app], rendered[app]);
    }
  }
  return { values, rendered, out };
}

const FLAGS = {
  "--origin": "origin", "--name": "name", "--contact": "contact", "--zone": "zone",
  "--source-url": "sourceUrl", "--d1-hub-id": "d1HubId", "--d1-federation-id": "d1FederationId",
  "--profile": "profile", "--out-dir": "outDir", "--name-prefix": "namePrefix",
};

function main(argv) {
  const input = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      const file = argv[++i];
      if (!file || !existsSync(file)) throw new Error("--input file not found");
      Object.assign(input, JSON.parse(readFileSync(file, "utf8")));
    } else if (FLAGS[arg]) {
      input[FLAGS[arg]] = argv[++i];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  const { out } = materialize(input);
  process.stdout.write(`wrote ${out.hub}\nwrote ${out.federation}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`materialize-selfhost-config: ${error.message}\n`);
    process.exit(1);
  }
}
