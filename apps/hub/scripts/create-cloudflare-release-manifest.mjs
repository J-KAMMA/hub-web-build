import { createHash } from "node:crypto";
import { lstatSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const hubRoot = resolve(import.meta.dirname, "..");
const artifactRoot = resolve(hubRoot, process.env.HUB_RELEASE_ARTIFACT_ROOT ?? ".open-next");
const configPath = resolve(hubRoot, process.env.HUB_RELEASE_CONFIG ?? "wrangler.production.jsonc");
const outputPath = resolve(hubRoot, process.env.HUB_RELEASE_MANIFEST ?? "hub-cloudflare-release-manifest.json");
const sourceRevision = String(process.env.GITHUB_SHA ?? process.env.HUB_RELEASE_SOURCE_REVISION ?? "").trim();

if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/iu.test(sourceRevision)) {
  throw new Error("GITHUB_SHA or HUB_RELEASE_SOURCE_REVISION must be an immutable 40- or 64-character revision.");
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

const paths = [configPath, ...collectFiles(artifactRoot)];
const files = (await Promise.all(paths.map(async (path) => {
    const contents = await readFile(path);
    return {
    path: relative(hubRoot, path).replaceAll("\\", "/"),
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
    };
  })))
  .sort((left, right) => left.path.localeCompare(right.path));

const manifest = {
  format: "jkamma-hub-cloudflare-release-v1",
  sourceRevision,
  deployable: false,
  files,
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  manifest: relative(hubRoot, outputPath).replaceAll("\\", "/"),
  sourceRevision,
  files: files.length,
  deployable: false,
}));
