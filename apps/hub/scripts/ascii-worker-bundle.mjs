/**
 * Rewrites a JavaScript bundle so that its source text is pure ASCII.
 *
 * Why: V8 stores a script's source as a two-byte (UTF-16) string as soon as it
 * contains a single non-Latin-1 character. The Hub Worker bundle is ~53 MB and
 * carried ~30 000 non-ASCII bytes (Japanese regex literals, legal comments),
 * so its source alone took ~106 MB of the 128 MB isolate limit. Above the
 * limit the Workers runtime discards the isolate after each request, and every
 * request then pays the full cold start (2-4 s).
 *
 * Every non-ASCII character is replaced by an equivalent escape:
 * - string literals, regular expressions, identifiers: \uXXXX (surrogate
 *   pairs for astral characters, which is equivalent with and without the
 *   `u`/`v` flags);
 * - comments: the same text escape (comments carry no semantics);
 * - untagged template literals: \uXXXX in the cooked text.
 * Tagged templates are left untouched because their raw text is observable;
 * the script reports how many characters remain so the caller can decide.
 *
 * Usage: node ascii-worker-bundle.mjs <file> [<file>...]   (rewrites in place)
 *        node ascii-worker-bundle.mjs --check <file>        (reports only)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

const NON_ASCII = /[^\x00-\x7f]/;

function hex4(code) {
  return `\\u${code.toString(16).padStart(4, "0")}`;
}

/** Escapes every non-ASCII UTF-16 unit; drops a redundant identity-escape backslash. */
function escapeLiteralText(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out += text[i];
      continue;
    }
    // `\é` is an identity escape that means `é`; `\\u00e9` would not.
    let backslashes = 0;
    for (let j = out.length - 1; j >= 0 && out[j] === "\\"; j -= 1) backslashes += 1;
    if (backslashes % 2 === 1) out = out.slice(0, -1);
    out += hex4(code);
  }
  return out;
}

function escapeCommentText(text) {
  return text.replace(/[^\x00-\x7f]/g, (ch) => hex4(ch.charCodeAt(0)));
}

export function asciiBundle(source) {
  if (!NON_ASCII.test(source)) return { output: source, remaining: 0, edits: 0 };
  const edits = [];
  const comments = [];
  const tt = acorn.tokTypes;
  const tokenizer = acorn.tokenizer(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    onComment: (_block, _text, start, end) => comments.push([start, end]),
  });
  // Template stack: { tagged, inText, depth } per open template literal.
  const templates = [];
  let previous = null;
  const endsExpression = (token) => {
    if (!token) return false;
    const p = token.type;
    return p === tt.name || p === tt.parenR || p === tt.bracketR || p === tt.backQuote
      || p === tt.string || p === tt.num || p === tt.privateId || p === tt.regexp
      || p === tt._this || p === tt._super;
  };
  for (const token of tokenizer) {
    const type = token.type;
    const top = templates[templates.length - 1];
    if (type === tt.backQuote) {
      if (top && top.inText) {
        templates.pop();
      } else {
        templates.push({ tagged: endsExpression(previous), inText: true, depth: 0 });
      }
    } else if (type === tt.dollarBraceL && top && top.inText) {
      top.inText = false;
      top.depth = 0;
    } else if (top && !top.inText && (type === tt.braceL || type === tt.dollarBraceL)) {
      top.depth += 1;
    } else if (top && !top.inText && type === tt.braceR) {
      if (top.depth === 0) top.inText = true;
      else top.depth -= 1;
    }
    const slice = source.slice(token.start, token.end);
    if (NON_ASCII.test(slice)) {
      if (type === tt.string || type === tt.regexp || type === tt.name || type === tt.privateId) {
        edits.push([token.start, token.end, escapeLiteralText(slice)]);
      } else if ((type === tt.template || type === tt.invalidTemplate) && top && !top.tagged) {
        edits.push([token.start, token.end, escapeLiteralText(slice)]);
      }
    }
    previous = token;
  }
  for (const [start, end] of comments) {
    const slice = source.slice(start, end);
    if (NON_ASCII.test(slice)) edits.push([start, end, escapeCommentText(slice)]);
  }
  edits.sort((a, b) => a[0] - b[0]);
  const parts = [];
  let cursor = 0;
  for (const [start, end, replacement] of edits) {
    if (start < cursor) continue;
    parts.push(source.slice(cursor, start), replacement);
    cursor = end;
  }
  parts.push(source.slice(cursor));
  const output = parts.join("");
  const remaining = (output.match(/[^\x00-\x7f]/g) ?? []).length;
  return { output, remaining, edits: edits.length };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const files = check ? args.slice(1) : args;
  let failed = false;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const before = (source.match(/[^\x00-\x7f]/g) ?? []).length;
    const { output, remaining, edits } = asciiBundle(source);
    if (!check && output !== source) writeFileSync(file, output);
    console.log(JSON.stringify({ file, nonAsciiBefore: before, edits, nonAsciiAfter: remaining, written: !check && output !== source }));
    if (remaining > 0) failed = true;
  }
  if (failed) process.exitCode = check ? 1 : 0;
}
