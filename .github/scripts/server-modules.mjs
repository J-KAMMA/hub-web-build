// Sizes webpack modules inside the Next server chunks (needs a build made with
// HUB_NAMED_MODULES=true so module ids are paths). Size = function source
// length, so it is approximate and measured before the final esbuild pass.
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const mods = new Map();
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js") && !/manifest/.test(e.name)) load(p);
  }
}
function load(p) {
  const src = fs.readFileSync(p, "utf8");
  if (!src.includes("exports.modules")) return;
  const m = { exports: {} };
  try {
    new Function("exports", "require", "module", "__filename", "__dirname", src)(m.exports, () => ({}), m, p, path.dirname(p));
  } catch (e) { return; }
  for (const [id, fn] of Object.entries(m.exports.modules || {})) {
    if (typeof fn === "function" && !mods.has(id)) mods.set(id, fn.toString().length);
  }
}
walk(root);
const pk = new Map(), dr = new Map(), big = [];
let total = 0;
const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
for (const [id, n] of mods) {
  total += n;
  big.push([n, id]);
  const s = id.replace(/\/g, "/");
  const i = s.lastIndexOf("node_modules/");
  if (i >= 0) {
    const r = s.slice(i + 13).split("/");
    add(pk, r[0].startsWith("@") ? r[0] + "/" + r[1] : r[0], n);
  } else add(dr, s.replace(/^(\.\.\/)+|^\.\//, "").split("/").slice(0, 3).join("/"), n);
}
console.log("modules:", mods.size, "total function chars (approximate):", total);
const top = (m, t, c = 40) => { console.log("== " + t); [...m].sort((a, b) => b[1] - a[1]).slice(0, c).forEach(([k, v]) => console.log(String(v).padStart(10), k)); };
top(pk, "top 40 npm packages (server webpack modules, approximate)");
top(dr, "top 40 source dirs (approximate)");
console.log("== top 30 single modules");
big.sort((a, b) => b[0] - a[0]).slice(0, 30).forEach(([n, id]) => console.log(String(n).padStart(10), id));
