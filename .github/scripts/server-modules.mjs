// Sizes webpack modules inside the Next server entries and chunks. Needs a
// build made with HUB_NAMED_MODULES=true so module ids are source paths.
// Size = function source length summed over every copy found in every file,
// i.e. what the final bundle carries before esbuild (approximate).
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
const inst = new Map(); // id -> { size, copies }
let files = 0;

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js") && !/manifest|webpack-runtime/.test(e.name)) load(p);
  }
}
function load(p) {
  const src = fs.readFileSync(p, "utf8");
  const m = { exports: {} };
  globalThis.__cap = null;
  try {
    new Function("exports", "require", "module", src.replace("var a={};", "var a=globalThis.__cap={};"))(m.exports, () => stub, m);
  } catch (e) {
    return;
  }
  const mods = (globalThis.__cap && globalThis.__cap.modules) || m.exports.modules;
  if (!mods) return;
  files++;
  for (const [id, fn] of Object.entries(mods)) {
    if (typeof fn !== "function") continue;
    const size = fn.toString().length;
    const cur = inst.get(id) || { size, copies: 0 };
    cur.copies++;
    inst.set(id, cur);
  }
}
walk(root);

const pk = new Map();
const dr = new Map();
const rows = [];
let total = 0;
let unique = 0;
const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
for (const [id, { size, copies }] of inst) {
  const n = size * copies;
  total += n;
  unique += size;
  rows.push([n, copies, size, id]);
  const s = id.split("\\").join("/");
  const i = s.lastIndexOf("node_modules/");
  if (i >= 0) {
    const r = s.slice(i + 13).split("/");
    add(pk, r[0].startsWith("@") ? r[0] + "/" + r[1] : r[0], n);
  } else {
    add(dr, s.replace(/^(\.\.\/)+|^\.\//, "").split("/").slice(0, 3).join("/"), n);
  }
}
console.log("files:", files, "modules:", inst.size, "total chars incl. copies (approximate):", total, "unique:", unique);
const top = (m, t, c = 40) => {
  console.log("== " + t);
  [...m].sort((a, b) => b[1] - a[1]).slice(0, c).forEach(([k, v]) => console.log(String(v).padStart(10), k));
};
top(pk, "top 40 npm packages (approximate)");
top(dr, "top 40 source dirs (approximate)");
console.log("== top 40 modules by total size (bytes copies size id)");
rows.sort((a, b) => b[0] - a[0]).slice(0, 40).forEach((r) => console.log(r.join(" ")));
