import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postcss from "postcss";

const cssPath = path.resolve(process.cwd(), "app/mobile-app.css");
const source = fs.readFileSync(cssPath, "utf8");
const root = postcss.parse(source, { from: cssPath });
const changed = [];

function isKeyframeRule(rule) {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === "atrule" && parent.name === "keyframes") return true;
    parent = parent.parent;
  }
  return false;
}

function splitSelectorList(selector) {
  const entries = [];
  let current = "";
  let roundDepth = 0;
  let squareDepth = 0;
  let quote = "";
  let escaped = false;

  for (const character of selector) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      current += character;
      quote = character;
      continue;
    }
    if (character === "(") roundDepth += 1;
    if (character === ")") roundDepth -= 1;
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth -= 1;
    if (character === "," && roundDepth === 0 && squareDepth === 0) {
      entries.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}

function scopeSelector(selector) {
  return splitSelectorList(selector)
    .map((entry) => {
      if (entry.includes('data-hub-surface="app"')) return entry;
      if (/^html(?=[.#[:\s>+~]|$)/.test(entry)) {
        return entry.replace(/^html/, 'html[data-hub-surface="app"]');
      }
      if (/^:root(?=[.#[:\s>+~]|$)/.test(entry)) {
        return entry.replace(/^:root/, 'html[data-hub-surface="app"]');
      }
      return `html[data-hub-surface="app"] ${entry}`;
    })
    .join(", ");
}

root.walkRules((rule) => {
  if (isKeyframeRule(rule) || rule.selector.includes('data-hub-surface="app"')) return;
  const previous = rule.selector;
  rule.selector = scopeSelector(previous);
  changed.push({ line: rule.source?.start?.line ?? 0, previous, next: rule.selector });
});

if (process.argv.includes("--write")) {
  fs.writeFileSync(cssPath, root.toString());
  process.stdout.write(`Scoped ${changed.length} mobile-app selectors.\n`);
} else if (changed.length) {
  for (const item of changed) process.stderr.write(`${item.line}: ${item.previous}\n`);
  process.stderr.write(`Found ${changed.length} unscoped mobile-app selectors.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("All mobile-app selectors are app-scoped.\n");
}
