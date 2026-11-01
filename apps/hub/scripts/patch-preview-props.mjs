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
  writeFileSync(handler, source);
  return { patched: count };
}
