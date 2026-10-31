import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "lib", "ui-copy.ts");
const outputPath = path.join(root, "lib", "ui-copy-locales.generated.ts");
const source = await readFile(sourcePath, "utf8");
const match = source.match(/const copy = (\{[\s\S]*\}) as const;/);
if (!match) throw new Error("Could not extract the base UI copy object.");

const baseCopy = Function(`"use strict"; return (${match[1]});`)();
const english = baseCopy.en;
const targets = {
  ko: "Korean",
  "zh-CN": "Simplified Chinese",
  es: "Spanish",
  "pt-BR": "Brazilian Portuguese",
  fr: "French",
  de: "German",
  id: "Indonesian",
  hi: "Hindi",
  ar: "Arabic",
  ru: "Russian",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
};

function sameShape(base, translated, trail = "") {
  if (!base || typeof base !== "object" || Array.isArray(base)) return typeof translated === "string";
  if (!translated || typeof translated !== "object" || Array.isArray(translated)) return false;
  const baseKeys = Object.keys(base);
  const translatedKeys = Object.keys(translated);
  if (baseKeys.length !== translatedKeys.length || baseKeys.some((key) => !Object.hasOwn(translated, key))) return false;
  return baseKeys.every((key) => sameShape(base[key], translated[key], `${trail}.${key}`));
}

async function translateValues(locale, language, values) {
  if (values.length === 1) {
    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen2.5:1.5b", stream: false, keep_alive: "30m", options: { temperature: 0, num_ctx: 1024, num_predict: 100 }, messages: [{ role: "user", content: `Translate this social-platform UI text into natural, concise ${language}. Return the translation only without quotes or explanation. Keep Hub, Hubpedia, Vault, AI, Ctrl+Enter, and @ unchanged.\n${values[0]}` }] }),
    });
    if (!response.ok) throw new Error(`${locale}: local translation request failed (${response.status})`);
    const body = await response.json();
    const translated = String(body.message?.content ?? "").trim().replace(/^['\"]|['\"]$/g, "");
    if (translated) return [translated];
    throw new Error(`${locale}: empty local translation`);
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch("http://127.0.0.1:11434/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5:1.5b",
        stream: false,
        format: "json",
        keep_alive: "30m",
        options: { temperature: 0, num_ctx: 2048, num_predict: 700 },
        messages: [{ role: "user", content: [
          `Translate these ${values.length} social-platform UI strings from English to natural, concise ${language}.`,
          `Return JSON only as {"translations":[...]} with exactly ${values.length} strings in the same order.`,
          "Keep Hub, Hubpedia, Vault, AI, Ctrl+Enter, and @ unchanged. Do not explain.",
          JSON.stringify(values),
        ].join("\n") }],
      }),
    });
    if (!response.ok) { await new Promise((resolve) => setTimeout(resolve, attempt * 1000)); continue; }
    const body = await response.json();
    try {
      const parsed = JSON.parse(body.message?.content ?? "null");
      if (Array.isArray(parsed?.translations) && parsed.translations.length === values.length && parsed.translations.every((item) => typeof item === "string" && item.trim().length > 0)) return parsed.translations.map((item) => item.trim());
    } catch {}
  }
  if (values.length > 1) {
    const middle = Math.ceil(values.length / 2);
    return [...await translateValues(locale, language, values.slice(0, middle)), ...await translateValues(locale, language, values.slice(middle))];
  }
  throw new Error(`${locale}: translated copy length differs after retries`);
}

function flatten(value, prefix = [], result = []) {
  for (const [key, child] of Object.entries(value)) {
    const path = [...prefix, key];
    if (typeof child === "string") result.push({ path, value: child });
    else flatten(child, path, result);
  }
  return result;
}

function assignPath(target, pathParts, value) {
  let cursor = target;
  pathParts.forEach((part, index) => {
    if (index === pathParts.length - 1) cursor[part] = value;
    else cursor = cursor[part] ??= {};
  });
}

const leaves = flatten(english);

async function translateLocale(locale, language) {
  const localized = {};
  process.stdout.write(`${locale} (${language})... `);
  const chunkSize = 8;
  for (let offset = 0; offset < leaves.length; offset += chunkSize) {
    const chunk = leaves.slice(offset, offset + chunkSize);
    const translated = await translateValues(locale, language, chunk.map((item) => item.value));
    chunk.forEach((item, index) => assignPath(localized, item.path, translated[index]));
  }
  for (const item of leaves) {
    if (/^(Hub|Hubpedia|Vault|AI|Ctrl\+Enter|@|m|h|d)$/.test(item.value)) assignPath(localized, item.path, item.value);
  }
  process.stdout.write("done\n");
  if (!sameShape(english, localized)) throw new Error(`${locale}: reconstructed copy shape differs`);
  return localized;
}

const generated = {};
for (const [locale, language] of Object.entries(targets)) {
  generated[locale] = await translateLocale(locale, language);
  const checkpoint = "// Generated by scripts/generate-ui-copy-locales.mjs using the local translation model.\n// Review changes before committing.\n";
  await writeFile(outputPath, `${checkpoint}export const generatedUiCopy = ${JSON.stringify(generated, null, 2)} as const;\n`, "utf8");
}

const banner = "// Generated by scripts/generate-ui-copy-locales.mjs using the local translation model.\n// Review changes before committing.\n";
await writeFile(outputPath, `${banner}export const generatedUiCopy = ${JSON.stringify(generated, null, 2)} as const;\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath)}`);
