/*
 * Take one superseded rule out of a stylesheet, safely.
 *
 * The first attempt at this split a stylesheet on "}" and rebuilt it, which
 * works until a rule is nested inside a media query — then the braces no
 * longer balance and the file stops parsing. It did exactly that: 106 open
 * against 127 closed, and the page rendered nothing. The snapshot diff
 * caught it immediately (twelve elements "gone"), which is the only reason
 * it cost a minute instead of a release.
 *
 * So this does not parse CSS. It finds one rule by its exact selector at the
 * top level of the file, checks the braces balance before and after, and
 * refuses to write anything if they do not. One rule per run, verified by a
 * snapshot diff, is slower than a clever sweep and is the only version of
 * this that can be trusted.
 *
 *   node scripts/strip-superseded-rules.mjs app/home.css ".home-feed__stream .tweet__name"
 *   node scripts/strip-superseded-rules.mjs --list app/home.css
 */

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const listing = args[0] === "--list";
const file = listing ? args[1] : args[0];
const selector = args[1];

if (!file) {
  console.error("使い方: node scripts/strip-superseded-rules.mjs <file.css> <selector>");
  process.exit(1);
}

const source = readFileSync(file, "utf8");
const balanced = (text) => (text.match(/\{/gu) ?? []).length === (text.match(/\}/gu) ?? []).length;

if (!balanced(source)) {
  console.error(`${file} の波括弧が既に釣り合っていません。先に直してください。`);
  process.exit(1);
}

/*
 * Walks the file counting braces, so a rule inside a media query is never
 * mistaken for a top-level one and a nested block is never half-removed.
 */
function topLevelRules(text) {
  const rules = [];
  let depth = 0;
  let ruleStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") {
      if (depth === 0) ruleStart = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        /* The selector runs back to the end of the previous rule or comment. */
        let from = ruleStart;
        while (from > 0 && text[from - 1] !== "}" && text[from - 1] !== "/") from -= 1;
        rules.push({ selector: text.slice(from, ruleStart).trim(), from, to: index + 1 });
      }
    }
  }
  return rules;
}

const rules = topLevelRules(source);

if (listing) {
  const posts = rules.filter((rule) => /\.tweet\b|\.tweet__/u.test(rule.selector));
  console.log(`${file}: 最上位の規則 ${rules.length}件、うちポストに触るもの ${posts.length}件`);
  for (const rule of posts) console.log(`  ${rule.selector.replace(/\s+/gu, " ").slice(0, 110)}`);
  process.exit(0);
}

const target = rules.find((rule) => rule.selector.replace(/\s+/gu, " ").trim() === selector.replace(/\s+/gu, " ").trim());
if (!target) {
  console.error(`最上位にその規則が見つかりません: ${selector}`);
  console.error("メディアクエリの中にあるかもしれません。--list で確認してください。");
  process.exit(1);
}

const stripped = source.slice(0, target.from) + source.slice(target.to).replace(/^\s*\n/u, "");
if (!balanced(stripped)) {
  console.error("外すと波括弧が釣り合わなくなります。書き込みませんでした。");
  process.exit(1);
}

writeFileSync(file, stripped);
const declarations = (source.slice(target.from, target.to).match(/:/gu) ?? []).length;
console.log(`${file} から ${declarations}宣言を外しました: ${selector}`);
console.log("npm run measure -- --snapshot で描画が動いていないことを確かめてください。");
