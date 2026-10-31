import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import kuromoji from "kuromoji";

import { VIEWABLE_SEED_ARTICLES } from "../lib/encyclopedia/seed/index.ts";

const require = createRequire(import.meta.url);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dictionaryPath = path.join(path.dirname(require.resolve("kuromoji")), "..", "dict");

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: dictionaryPath }).build((error, tokenizer) => {
      if (error) reject(error);
      else resolve(tokenizer);
    });
  });
}

function toHiragana(value) {
  return value.normalize("NFKC").replace(/[\u30a1-\u30f6]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60));
}

const latinLetterReadings = {
  A: "えー", B: "びー", C: "しー", D: "でぃー", E: "いー", F: "えふ", G: "じー",
  H: "えいち", I: "あい", J: "じぇー", K: "けー", L: "える", M: "えむ", N: "えぬ",
  O: "おー", P: "ぴー", Q: "きゅー", R: "あーる", S: "えす", T: "てぃー", U: "ゆー",
  V: "ぶい", W: "だぶりゅー", X: "えっくす", Y: "わい", Z: "ぜっと",
};

function expandLatinAcronyms(value) {
  return value.replace(/[A-Z]{1,5}/g, (acronym) =>
    [...acronym].map((letter) => latinLetterReadings[letter]).join(""));
}

const tokenizer = await buildTokenizer();
const readings = Object.fromEntries(
  VIEWABLE_SEED_ARTICLES
    .map((article) => {
      const sourceTitles = [...new Set([article.title, article.canonicalName].filter(Boolean))];
      const baseReading = sourceTitles
        .map((title) => tokenizer.tokenize(title).map((token) => token.reading ?? token.surface_form).join(""))
        .map(toHiragana)
        .join(" ");
      const expandedReading = expandLatinAcronyms(baseReading);
      const reading = expandedReading === baseReading ? baseReading : `${baseReading} ${expandedReading}`;
      return [article.slug, reading];
    })
    .sort(([left], [right]) => left.localeCompare(right)),
);

const outputPath = path.resolve(scriptDirectory, "../lib/encyclopedia/article-readings.generated.json");
const output = `${JSON.stringify(readings, null, 2)}\n`;
const existing = await readFile(outputPath, "utf8").catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
// A running Windows dev server may still have this generated file open.
// Leave identical content in place; changed content must still be written.
if (existing !== output) await writeFile(outputPath, output, "utf8");
console.log(`Generated readings for ${Object.keys(readings).length} Hubpedia articles.`);
