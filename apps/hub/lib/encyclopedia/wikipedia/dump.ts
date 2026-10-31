import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

/*
 * Reading the Wikipedia multistream dump: the index (offset:pageid:title), the byte-range streams and the
 * <page> elements inside them. Decompression uses the system bzip2 when present (several times faster) and
 * the pure-JS unbzip2-stream otherwise.
 */

export interface DumpPage {
  pageId: number;
  title: string;
  ns: number;
  redirectTitle: string | null;
  revisionId: number;
  timestamp: string;
  text: string;
}

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const unescapeXml = (value: string) => value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/giu, (whole, body: string) => {
  if (body[0] === "#") {
    const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    return Number.isSafeInteger(code) && code >= 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  }
  return XML_ENTITIES[body.toLowerCase()] ?? whole;
});

/** Parses every <page> element of an XML fragment. Pages without a revision are skipped. */
export function parsePages(xml: string): DumpPage[] {
  const pages: DumpPage[] = [];
  const pattern = /<page>([\s\S]*?)<\/page>/gu;
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    const body = match[1];
    const revisionStart = body.indexOf("<revision>");
    if (revisionStart < 0) continue;
    const head = body.slice(0, revisionStart);
    const revision = body.slice(revisionStart);
    const title = /<title>([\s\S]*?)<\/title>/u.exec(head)?.[1];
    const ns = /<ns>(\d+)<\/ns>/u.exec(head)?.[1];
    const pageId = /<id>(\d+)<\/id>/u.exec(head)?.[1];
    const revisionId = /<id>(\d+)<\/id>/u.exec(revision)?.[1];
    const timestamp = /<timestamp>([^<]+)<\/timestamp>/u.exec(revision)?.[1];
    if (title === undefined || ns === undefined || !pageId || !revisionId || !timestamp) continue;
    const redirect = /<redirect\s+title="([^"]*)"/u.exec(head)?.[1] ?? null;
    const textMatch = /<text\b[^>]*?(?:\/>|>([\s\S]*?)<\/text>)/u.exec(revision);
    pages.push({
      pageId: Number(pageId),
      title: unescapeXml(title),
      ns: Number(ns),
      redirectTitle: redirect === null ? null : unescapeXml(redirect),
      revisionId: Number(revisionId),
      timestamp,
      text: textMatch?.[1] ? unescapeXml(textMatch[1]) : "",
    });
  }
  return pages;
}

/* ---------- bz2 ---------- */

export type Bz2Decoder = "auto" | "system" | "js";
let systemBzip2: boolean | undefined;
export const hasSystemBzip2 = () => (systemBzip2 ??= spawnSync("bzip2", ["--help"], { stdio: "ignore" }).error === undefined);

function viaSystem(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("bzip2", ["-dc"], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`bzip2 exited with ${code}`))));
    child.stdin.on("error", () => undefined);
    child.stdin.end(buffer);
  });
}

function viaJs(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const unbzip2 = createRequire(import.meta.url)("unbzip2-stream") as () => NodeJS.ReadWriteStream;
    const stream = unbzip2();
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.end(buffer);
  });
}

export function decompressBz2(buffer: Buffer, decoder: Bz2Decoder = "auto"): Promise<Buffer> {
  if (decoder === "js") return viaJs(buffer);
  if (decoder === "system" || hasSystemBzip2()) return viaSystem(buffer);
  return viaJs(buffer);
}

/* ---------- index and streams ---------- */

export interface IndexEntry { offset: number; pageId: number; title: string }

export function parseIndexLine(line: string): IndexEntry | null {
  const first = line.indexOf(":");
  const second = first < 0 ? -1 : line.indexOf(":", first + 1);
  if (second < 0) return null;
  const offset = Number(line.slice(0, first));
  const pageId = Number(line.slice(first + 1, second));
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(pageId)) return null;
  return { offset, pageId, title: line.slice(second + 1) };
}

/**
 * Distinct stream offsets of the index, ascending. `indexFile` is the .txt.bz2 (or a plain .txt for tests).
 * `maxStreams` stops reading early, so a smoke test does not decompress the whole index.
 */
export async function readStreamOffsets(indexFile: string, maxStreams = Number.POSITIVE_INFINITY, decoder: Bz2Decoder = "auto"): Promise<number[]> {
  const offsets: number[] = [];
  let last = -1;
  const { lines, stop } = indexFile.endsWith(".bz2")
    ? bz2Lines(indexFile, decoder)
    : { lines: createInterface({ input: createReadStream(indexFile, "utf8"), crlfDelay: Infinity }), stop: () => undefined };
  try {
    for await (const line of lines) {
      const entry = parseIndexLine(line);
      if (!entry || entry.offset === last) continue;
      if (offsets.length >= maxStreams + 1) break; /* one extra offset marks where the last wanted stream ends */
      offsets.push(entry.offset);
      last = entry.offset;
    }
  } finally {
    lines.close();
    stop();
  }
  return offsets;
}

function bz2Lines(file: string, decoder: Bz2Decoder) {
  if (decoder === "js" || !hasSystemBzip2()) {
    const unbzip2 = createRequire(import.meta.url)("unbzip2-stream") as () => NodeJS.ReadWriteStream;
    const source = createReadStream(file).pipe(unbzip2());
    return { lines: createInterface({ input: source as unknown as NodeJS.ReadableStream, crlfDelay: Infinity }), stop: () => (source as unknown as { destroy?: () => void }).destroy?.() };
  }
  const child = spawn("bzip2", ["-dc", file], { stdio: ["ignore", "pipe", "ignore"] });
  return { lines: createInterface({ input: child.stdout, crlfDelay: Infinity }), stop: () => { child.kill(); } };
}

/** Reads and decompresses the bytes [offset, end) of the dump (end null = to the end of the file). */
export async function readStreamXml(dumpFile: string, offset: number, end: number | null, decoder: Bz2Decoder = "auto"): Promise<string> {
  const handle = await open(dumpFile, "r");
  try {
    const size = end ?? (await handle.stat()).size;
    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    return (await decompressBz2(buffer, decoder)).toString("utf8");
  } finally {
    await handle.close();
  }
}
