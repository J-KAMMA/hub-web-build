// OpenNext 1.20.2 inlines only `*-manifest.json`, `required-server-files.json`
// and `prefetch-hints.json` into the Worker. Next 16.3 also reads
// `.next/server/preview-props.json` while constructing the server, so every
// request failed with "Unexpected loadManifest(.../preview-props.json)".
// Inline that one file too, in the same way OpenNext inlines the others.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function patchPreviewProps(appDir) {
  const handler = join(appDir, ".open-next/server-functions/default/apps/hub/handler.mjs");
  const manifest = join(appDir, ".open-next/server-functions/default/apps/hub/.next/server/preview-props.json");
  if (!existsSync(handler) || !existsSync(manifest)) return { patched: 0, reason: "missing files" };
  const value = JSON.stringify(JSON.parse(readFileSync(manifest, "utf8")));
  let source = readFileSync(handler, "utf8");
  if (source.includes("/* hub-preview-props */")) return { patched: 0, reason: "already patched" };
  let count = 0;
  const guard = (v) => `if(String(${v}).replaceAll("\\\\","/").endsWith("/server/preview-props.json"))return ${value};/* hub-preview-props */`;
  source = source.replace(
    /throw new Error\(`Unexpected loadManifest\(\$\{([\w$]+)\}\) call!`\)/g,
    (m, v) => { count++; return `${guard(v)}${m}`; },
  );
  source = source.replace(
    /throw new Error\("Unexpected loadManifest\("\+([\w$]+)\+"\) call!"\)/g,
    (m, v) => { count++; return `${guard(v)}${m}`; },
  );
  if (count === 0) throw new Error("preview-props patch: loadManifest guard not found in handler.mjs");
  // OpenNext 1.20.2 patches loadCustomCacheHandlers for Next <= 16.3 only. With
  // Next 16.4 the rule no longer matches, the default cacheHandlers entries
  // reach formatDynamicImportPath and every request dies with
  // "startsWith is not a function". Hub uses no "use cache", so skip loading.
  let cacheHandlersSkipped = 0;
  {
    const at = source.indexOf("loadCustomCacheHandlers");
    console.log("loadCustomCacheHandlers context:", JSON.stringify(source.slice(Math.max(0, at - 40), at + 260)));
    source = source.replace(/(loadCustomCacheHandlers\s*\(\s*\)\s*\{)/g, (m) => { cacheHandlersSkipped++; return m + "return;/* hub-no-cache-handlers */"; });
  }
  writeFileSync(handler, source);
  return { patched: count, cacheHandlersSkipped };
}
