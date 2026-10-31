import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const hubRoot = resolve(import.meta.dirname, "..");
const artifactRoot = resolve(hubRoot, process.env.HUB_RELEASE_ARTIFACT_ROOT ?? ".open-next");
const configPath = resolve(hubRoot, process.env.HUB_RELEASE_CONFIG ?? "wrangler.production.jsonc");
const manifestPath = resolve(hubRoot, process.env.HUB_RELEASE_MANIFEST ?? "hub-cloudflare-release-manifest.json");
const expectedRevision = String(process.env.GITHUB_SHA ?? process.env.HUB_RELEASE_SOURCE_REVISION ?? "").trim();

if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(expectedRevision)) {
  throw new Error("GITHUB_SHA or HUB_RELEASE_SOURCE_REVISION must identify the approved immutable revision.");
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Release artifacts must not contain symbolic links: ${path}`);
    }
    if (metadata.isDirectory()) files.push(...collectFiles(path));
    else if (metadata.isFile()) files.push(path);
  }
  return files;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.format !== "jkamma-hub-cloudflare-release-v1") throw new Error("Unsupported release manifest format.");
if (manifest.sourceRevision !== expectedRevision) throw new Error("Release manifest source revision does not match the approved revision.");
if (manifest.deployable !== false) throw new Error("Readiness artifacts must not self-authorize deployment.");
if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("Release manifest has no files.");

const actualPaths = [configPath, ...collectFiles(artifactRoot)];
const actualRelativePaths = actualPaths
  .map((path) => relative(hubRoot, path).replaceAll("\\", "/"))
  .sort();
const declaredPaths = manifest.files.map((file) => file.path).sort();
if (JSON.stringify(actualRelativePaths) !== JSON.stringify(declaredPaths)) {
  throw new Error("Release artifact file set differs from the manifest.");
}

await Promise.all(manifest.files.map(async (file) => {
  if (
    typeof file.path !== "string"
    || file.path.startsWith("/")
    || file.path.includes("\\")
    || file.path.split("/").includes("..")
  ) {
    throw new Error("Release manifest contains an unsafe path.");
  }
  const path = resolve(hubRoot, file.path);
  if (path !== hubRoot && !path.startsWith(`${hubRoot}${sep}`)) {
    throw new Error("Release manifest path escapes the Hub root.");
  }
  const contents = await readFile(path);
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (contents.byteLength !== file.bytes || sha256 !== file.sha256) {
    throw new Error(`Release artifact checksum mismatch: ${file.path}`);
  }
}));

console.log(JSON.stringify({
  verified: true,
  sourceRevision: expectedRevision,
  files: manifest.files.length,
  deploymentAuthorized: false,
}));
