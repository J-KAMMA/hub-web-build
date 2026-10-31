const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 5 * 1024 * 1024;
const KNOWN_CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const PRESERVED_ANCILLARY = new Set(["cHRM", "gAMA", "sRGB", "tRNS"]);
const REJECTED_CHUNKS = new Set(["acTL", "fcTL", "fdAT"]);

export class InvalidPngError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function readU32(data: Uint8Array, offset: number): number {
  return ((data[offset] * 0x1000000) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3]) >>> 0;
}

function crc32(data: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= data[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunkName(data: Uint8Array, offset: number): string {
  let value = "";
  for (let index = 0; index < 4; index += 1) {
    const byte = data[offset + index];
    if (!((byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) throw new InvalidPngError("invalid_chunk_type");
    value += String.fromCharCode(byte);
  }
  return value;
}

export interface SanitizedPng { bytes: Uint8Array; width: number; height: number; }

/** Validates PNG framing/CRCs and removes every non-rendering metadata chunk. */
export function sanitizeHubAdPng(input: Uint8Array): SanitizedPng {
  if (input.byteLength < 45 || input.byteLength > MAX_BYTES) throw new InvalidPngError("invalid_size");
  if (!PNG_SIGNATURE.every((byte, index) => input[index] === byte)) throw new InvalidPngError("invalid_signature");
  const kept: Uint8Array[] = [input.slice(0, 8)];
  let offset = 8; let width = 0; let height = 0; let sawHeader = false; let sawData = false; let sawEnd = false;
  while (offset < input.byteLength) {
    if (offset + 12 > input.byteLength) throw new InvalidPngError("truncated_chunk");
    const length = readU32(input, offset); const dataStart = offset + 8; const chunkEnd = dataStart + length; const fullEnd = chunkEnd + 4;
    if (length > MAX_BYTES || fullEnd > input.byteLength || fullEnd < offset) throw new InvalidPngError("invalid_chunk_length");
    const type = chunkName(input, offset + 4);
    if (readU32(input, chunkEnd) !== crc32(input, offset + 4, chunkEnd)) throw new InvalidPngError("crc_mismatch");
    if (!sawHeader && type !== "IHDR") throw new InvalidPngError("header_not_first");
    if (sawEnd) throw new InvalidPngError("data_after_end");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new InvalidPngError("invalid_header");
      sawHeader = true; width = readU32(input, dataStart); height = readU32(input, dataStart + 4);
      const bitDepth = input[dataStart + 8]; const colorType = input[dataStart + 9];
      const allowedDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS
        || !allowedDepths[colorType]?.includes(bitDepth) || input[dataStart + 10] !== 0 || input[dataStart + 11] !== 0
        || input[dataStart + 12] > 1) throw new InvalidPngError("unsupported_header");
    } else if (type === "IDAT") sawData = true;
    else if (type === "IEND") {
      if (length !== 0 || !sawData) throw new InvalidPngError("invalid_end");
      sawEnd = true;
    } else if (REJECTED_CHUNKS.has(type)) throw new InvalidPngError("animated_png_not_allowed");
    else if ((input[offset + 4] & 32) === 0 && !KNOWN_CRITICAL.has(type)) throw new InvalidPngError("unknown_critical_chunk");
    if (KNOWN_CRITICAL.has(type) || PRESERVED_ANCILLARY.has(type)) kept.push(input.slice(offset, fullEnd));
    offset = fullEnd;
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== input.byteLength) throw new InvalidPngError("incomplete_png");
  const size = kept.reduce((sum, part) => sum + part.byteLength, 0); const bytes = new Uint8Array(size);
  let cursor = 0; for (const part of kept) { bytes.set(part, cursor); cursor += part.byteLength; }
  return { bytes, width, height };
}
