import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 「核は描画を読まない」を、書いた文章ではなくテストで守らせる。
 *
 * この規則が、このリポジトリでゲームをAIに作らせられるかどうかを決めている。
 * 試合や盤面の計算が Babylon や three や DOM を読んだ瞬間、その部分は
 * ブラウザを開かないと確かめられなくなる。確かめられないものは、
 * ハーネスから直させられない。人間が毎回目で見ることになる。
 *
 * 逆に核が素の TypeScript / JavaScript のままなら、
 * 「直す → テストを走らせる → 生ログを読む」が回る。描画は state を読むだけの
 * 薄い層にしておき、そこだけを目で確かめる。
 *
 * 実測でこの差は大きい。sovereign-football を Unity から移すとき、
 * WebGLビルドのログが v99 まで積まれていた。ビルドを通すこと自体が仕事に
 * なっていて、中身の検証はその後だった。
 */

/** 核が読んではいけないもの。 */
const RENDERERS = [
  "@babylonjs", "babylonjs", "three", "phaser", "pixi.js", "playcanvas",
  "react", "react-dom", "svelte", "vue"
];

/** 核が触ってはいけない、ブラウザにしか無いもの。 */
const BROWSER_GLOBALS = [
  "document.", "window.", "navigator.", "localStorage", "sessionStorage",
  "requestAnimationFrame", "HTMLCanvasElement", "WebGL"
];

const SOURCE = /\.(ts|tsx|js|mjs|jsx)$/;
const IMPORT = /(?:^|\n)\s*(?:import\b[^;\n]*?from\s*|import\s*|export\b[^;\n]*?from\s*)["']([^"']+)["']/g;
const REQUIRE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

/**
 * パスで読み込まれた描画を見つける。
 *
 * 名前で読むとは限らない。`apps/nexus-city` は three を
 * `/vendor/three.module.js` として配っており、裸の `"three"` を探すだけでは
 * 素通りする。実測でそうなっていた。
 *
 * パスの各区切りを、拡張子と配布形式の接尾辞（.module / .min / .esm / .core）を
 * 落としてから突き合わせる。部分一致ではなく完全一致にしているのは、
 * `./three-lane-board.js` のような無関係な名前を巻き込まないため。
 */
function pathSegmentsOf(specifier) {
  return specifier
    .split(/[\\/]/)
    .filter(Boolean)
    .map((segment) => segment.replace(/\.(ts|tsx|js|mjs|cjs|jsx)$/, "").replace(/\.(module|min|esm|core)$/g, ""));
}

async function filesUnder(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else if (SOURCE.test(entry.name) && !entry.name.includes(".test.")) found.push(path);
  }
  return found;
}

/**
 * 核のディレクトリを調べ、違反を返す。空配列なら合格。
 *
 * `allow` に挙げたものは見逃す。核が乱数や共通部品を読むのは当然なので、
 * 既定でも相対パスと `@jkamma/` は通す。
 */
export async function findRendererImports(coreDirectory, options = {}) {
  const forbidden = options.renderers ?? RENDERERS;
  const allow = options.allow ?? [];
  const problems = [];

  for (const file of await filesUnder(coreDirectory)) {
    const source = await readFile(file, "utf8");

    for (const pattern of [IMPORT, REQUIRE]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1];
        if (allow.includes(specifier)) continue;
        const byName = forbidden.find(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        );
        // 相対・絶対のパスで配られている描画も同じ違反として扱う。
        const segments = /^[./]/.test(specifier) ? pathSegmentsOf(specifier) : [];
        const byPath = forbidden.find((name) => segments.includes(name));
        if (byName || byPath) problems.push({ file, kind: "import", detail: specifier });
      }
    }

    if (options.allowBrowserGlobals !== true) {
      for (const global of BROWSER_GLOBALS) {
        if (source.includes(global)) problems.push({ file, kind: "browser", detail: global });
      }
    }
  }
  return problems;
}

/** テストから呼ぶ用。違反があれば、どこで何を読んだかを並べて投げる。 */
export async function assertCoreIsPure(coreDirectory, options = {}) {
  const problems = await findRendererImports(coreDirectory, options);
  if (problems.length === 0) return;
  const lines = problems.map(
    (problem) => `  ${problem.file}: ${problem.kind === "import" ? "読んでいる" : "触っている"} ${problem.detail}`
  );
  throw new Error(
    `核が描画に依存している。ここが素のままでないと、テストだけで確かめられなくなる:\n${lines.join("\n")}`
  );
}
