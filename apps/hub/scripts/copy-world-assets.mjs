/**
 * 3Dワールドの資産を、この app の public へ写す。
 *
 * **2箇所に置いて両方を記録しない。** 8MB を二重に持つと容量が惜しいだけでなく、
 * 片方だけ彫り直したときに食い違う。正本は apps/hub-world/public で、ここへは
 * 組み上げのたびに写す。
 *
 *   node scripts/copy-world-assets.mjs
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FROM = join(HERE, "..", "..", "hub-world", "public");
const TO = join(HERE, "..", "public");

if (!existsSync(FROM)) {
  // 資産が無くても組み上げは通す。**入れないよりまし**——読めなければ
  // 素の地面へ落ちる作りにしてある。
  console.warn("3Dワールドの資産が無い。写さずに進む。");
  process.exit(0);
}

mkdirSync(join(TO, "zones"), { recursive: true });

/**
 * 写すもの。**足したら、ここへも足す。**
 *
 * 数え上げなので、新しい棚を作って書き忘れると黙って落ちる。前に一度、
 * この写しが本番の道から呼ばれておらず、**glb が全部 404 になった**。
 * 型もテストも通ったまま、画面だけが素の地面になる出方をする。
 */
const WANTED = [
  ["zones", "彫った区画"],
  ["avatar.glb", "既定の住人"],
  ["street-resident.glb", "Blenderで新規制作した住人"],
  ["street-architecture.glb", "Blenderで新規制作した街の建築"],
  ["looks/", "選べる姿"],
  ["items.glb", "置ける品"]
];

let count = 0;
const missing = [];
for (const [name, what] of WANTED) {
  const from = join(FROM, name.replace(/\/$/u, ""));
  if (!existsSync(from)) { missing.push(`${name}（${what}）`); continue; }
  cpSync(from, join(TO, name.replace(/\/$/u, "")), { recursive: true });
  count += 1;
}
console.log(`3Dワールドの資産を写した: ${count}件 / ${WANTED.length}件`);
// **黙って減らさない。** 減ったことに気付けるのは、ここだけ。
if (missing.length) console.warn(`写せなかった: ${missing.join("、")}`);
