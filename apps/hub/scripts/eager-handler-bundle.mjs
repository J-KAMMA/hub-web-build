/**
 * Marks the lazily initialised OpenNext handler for eager compilation.
 *
 * Why: Wrangler bundles `.open-next/worker.js`, whose `await import(handler)`
 * becomes an esbuild `__esm` wrapper around the whole 45 MiB server bundle:
 *
 *     var init = __esm(async () => { <45 MiB> });
 *
 * V8 pre-parses that arrow function when the script is compiled (isolate
 * start) and, because it is not marked as "likely called", parses and
 * compiles its whole body a second time on the first request. Measured in
 * Node 24 and in workerd (docs/hub-worker-size/MEASURE.md, section 7) that
 * second pass is ~0.8 s of the ~2 s first-request cost.
 *
 * V8 compiles a function eagerly, once, when it is a function expression that
 * is parenthesised (`(async function () {...})`, the "PIFE" hint). Arrow
 * functions do not get the hint. So this script rewrites
 *
 *     f(async () => { BODY })   ->   f((async function () { BODY }))
 *
 * for zero-parameter async arrow functions of at least `--min-bytes` that are
 * call arguments. Nothing else changes: no code moves, no scope changes.
 *
 * Semantics: an arrow and a function differ in `this`, `arguments`,
 * `new.target`, `super`, constructability and `name`. `super` cannot occur at
 * a module top level. For `this`, `arguments` and `new.target` the script
 * looks for a reference at the wrapper's own level (inside nested arrows too,
 * which inherit them; not inside nested non-arrow functions, static blocks or
 * class field initialisers) and leaves the arrow alone if it finds one.
 *
 * Usage: node eager-handler-bundle.mjs [--min-bytes N] <file>         (rewrites in place)
 *        node eager-handler-bundle.mjs [--min-bytes N] --check <file> (re-parses; exit 1 if no eager wrapper)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

export const DEFAULT_MIN_BYTES = 4 * 1024 * 1024;

function parse(source) {
  return acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    preserveParens: true,
  });
}

const isNode = (value) => value !== null && typeof value === "object" && typeof value.type === "string";

function forEachChild(node, visit) {
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) visit(item, node, key);
    } else if (isNode(value)) {
      visit(value, node, key);
    }
  }
}

/**
 * Returns "this", "new.target" or "arguments" when the wrapper body references
 * it at its own level, else null. Arrows are walked (they inherit all three);
 * nested non-arrow functions, static blocks and class field initialisers (own
 * `this`) are not.
 */
function referencesFunctionBindings(root) {
  let found = null;
  const walk = (node, parent, key) => {
    if (found) return;
    if (node.type === "FunctionExpression" || node.type === "FunctionDeclaration" || node.type === "StaticBlock") return;
    if (parent?.type === "PropertyDefinition" && key === "value") return;
    if (node.type === "ThisExpression") {
      found = "this";
      return;
    }
    if (node.type === "MetaProperty" && node.meta.name === "new") {
      found = "new.target";
      return;
    }
    if (node.type === "Identifier") {
      if (node.name !== "arguments") return;
      const isPropertyName =
        (parent?.type === "MemberExpression" && key === "property" && !parent.computed)
        || ((parent?.type === "Property" || parent?.type === "PropertyDefinition" || parent?.type === "MethodDefinition")
          && key === "key" && !parent.computed);
      if (!isPropertyName) found = "arguments";
      return;
    }
    forEachChild(node, walk);
  };
  forEachChild(root, walk);
  return found;
}

/**
 * Finds big zero-parameter async function wrappers passed as call arguments.
 * Only nodes that can contain such a function (size >= minBytes) are visited.
 */
function findWrappers(ast, minBytes) {
  const found = [];
  const visit = (node, parent, key, grandparent) => {
    if (node.end - node.start < minBytes) return;
    const parenthesised = parent?.type === "ParenthesizedExpression";
    const callParent = parenthesised ? grandparent : parent;
    const isCandidate =
      (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression")
      && node.async === true
      && !node.generator
      && node.params.length === 0
      && node.body.type === "BlockStatement"
      && callParent?.type === "CallExpression"
      && callParent.callee !== (parenthesised ? parent : node);
    if (isCandidate) {
      found.push({ node, parenthesised });
      return;
    }
    forEachChild(node, (child, p, k) => visit(child, p, k, parent));
  };
  forEachChild(ast, (child, p, k) => visit(child, p, k, ast));
  return found;
}

export function eagerHandlerBundle(source, { minBytes = DEFAULT_MIN_BYTES } = {}) {
  const wrappers = findWrappers(parse(source), minBytes);
  const edits = [];
  const skipped = [];
  let alreadyEager = 0;
  for (const { node, parenthesised } of wrappers) {
    const bytes = node.end - node.start;
    if (node.type === "FunctionExpression" && parenthesised) {
      alreadyEager += 1;
      continue;
    }
    const unsafe = node.type === "ArrowFunctionExpression" ? referencesFunctionBindings(node.body) : null;
    if (unsafe) {
      skipped.push({ bytes, reason: `references ${unsafe}` });
      continue;
    }
    if (node.type === "ArrowFunctionExpression") {
      edits.push([node.start, node.body.start, "async function()"]);
    }
    if (!parenthesised) {
      edits.push([node.start, node.start, "("]);
      edits.push([node.end, node.end, ")"]);
    }
  }
  if (edits.length === 0) {
    return { output: source, edits: 0, converted: 0, alreadyEager, skipped, wrapperBytes: wrappers.map((w) => w.node.end - w.node.start) };
  }
  // Same-position inserts keep their insertion order: "(" before the head replacement.
  const ordered = edits.map((edit, index) => [...edit, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3]);
  const parts = [];
  let cursor = 0;
  for (const [start, end, text] of ordered) {
    parts.push(source.slice(cursor, start), text);
    cursor = end;
  }
  parts.push(source.slice(cursor));
  return {
    output: parts.join(""),
    edits: edits.length,
    converted: wrappers.length - alreadyEager - skipped.length,
    alreadyEager,
    skipped,
    wrapperBytes: wrappers.map((w) => w.node.end - w.node.start),
  };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let args = process.argv.slice(2);
  let minBytes = DEFAULT_MIN_BYTES;
  const minIndex = args.indexOf("--min-bytes");
  if (minIndex !== -1) {
    minBytes = Number(args[minIndex + 1]);
    args = [...args.slice(0, minIndex), ...args.slice(minIndex + 2)];
  }
  const check = args[0] === "--check";
  const files = check ? args.slice(1) : args;
  let failed = false;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const result = eagerHandlerBundle(source, { minBytes });
    if (check) {
      // The check parses the file again, so a rewrite that broke syntax fails here.
      const eager = result.alreadyEager;
      console.log(JSON.stringify({ file, eagerWrappers: eager, lazyWrappers: result.converted + result.skipped.length, skipped: result.skipped }));
      if (eager < 1 || result.edits > 0) failed = true;
    } else {
      if (result.output !== source) writeFileSync(file, result.output);
      console.log(JSON.stringify({ file, converted: result.converted, alreadyEager: result.alreadyEager, skipped: result.skipped, wrapperBytes: result.wrapperBytes, written: result.output !== source }));
    }
  }
  if (failed) process.exitCode = 1;
}
