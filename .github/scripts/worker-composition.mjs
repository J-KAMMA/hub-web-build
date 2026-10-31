// Approximate composition of the Worker bundle from a source map.
// Sizes are the lengths of sourcesContent entries (pre-minification source
// text), so they approximate each source's share of the bundle and are NOT
// exact bytes of the emitted file.
import fs from "node:fs";
const mapPath = process.argv[2] || "dist/worker-dry-run/custom-worker.js.map";
if (!fs.existsSync(mapPath)) {
  console.log("no source map at " + mapPath);
  process.exit(0);
}
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const pkgs = new Map();
const dirs = new Map();
let total = 0;
const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
map.sources.forEach((src, i) => {
  const content = (map.sourcesContent || [])[i];
  const n = content ? Buffer.byteLength(content) : 0;
  total += n;
  const s = src.replace(/\\/g, "/");
  const nm = s.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const rest = s.slice(nm + 13).split("/");
    const name = rest[0].startsWith("@") ? rest[0] + "/" + rest[1] : rest[0];
    add(pkgs, "pkg " + name, n);
  } else {
    const parts = s.replace(/^(\.\.\/)+/, "").split("/");
    const key = parts.slice(0, parts[0] === "apps" ? 4 : 2).join("/");
    add(dirs, "dir " + key, n);
  }
});
const top = (m, label) => {
  console.log(`== top 40 ${label} (approximate: sourcesContent bytes) ==`);
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    .forEach(([k, v]) => console.log(String(v).padStart(10), k));
};
console.log("sources:", map.sources.length, "sourcesContent total (approx):", total);
top(pkgs, "npm packages");
top(dirs, "app directories");
