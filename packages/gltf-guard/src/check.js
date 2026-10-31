#!/usr/bin/env node
/**
 * 手元で確かめる。**出す前に、通るかどうかが分かるように。**
 *
 * 断られてから理由を探すのでは、直すのに何往復もかかる。
 *
 *   node packages/gltf-guard/src/check.js model.glb
 *   node packages/gltf-guard/src/check.js --write out.glb model.glb
 *
 * --write を付けると、**知っている項目だけで書き直したもの**を出す。
 * 世界へ配るのはこの形。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

import { WORLD_BUDGET, clean, inspect } from "./index.js";

function main(argv) {
  const args = [...argv];
  let out = null;
  const at = args.indexOf("--write");
  if (at >= 0) {
    out = args[at + 1];
    if (!out) {
      console.error("--write の後に、書き出す先が要ります");
      return 2;
    }
    args.splice(at, 2);
  }
  if (args.length === 0) {
    console.error("使い方: check.js [--write 出す先] <model.glb ...>");
    return 2;
  }
  if (out && args.length > 1) {
    console.error("--write は1つずつ。まとめて書き出すと、どれがどれか分からなくなります");
    return 2;
  }

  let refused = 0;
  for (const path of args) {
    let bytes;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch (error) {
      console.log(`✗ ${basename(path)}  読めません: ${error.message}`);
      refused += 1;
      continue;
    }

    const done = out ? clean(bytes) : inspect(bytes);
    if (!done.ok) {
      console.log(`✗ ${basename(path)}  ${done.reason}`);
      refused += 1;
      continue;
    }
    const c = done.counted;
    const room = (key) => `${c[key]}/${WORLD_BUDGET[key]}`;
    console.log(
      `○ ${basename(path)}  頂点 ${room("vertices")}  面 ${room("triangles")}  ` +
      `絵 ${room("images")}  節点 ${room("nodes")}  ` +
      `大きさ ${(c.bytes / 1024).toFixed(0)}/${(WORLD_BUDGET.bytes / 1024).toFixed(0)}KB`
    );
    if (out) {
      writeFileSync(out, done.bytes);
      console.log(`  書き直しました: ${out}（${(done.bytes.length / 1024).toFixed(0)}KB）`);
    }
  }
  return refused === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
