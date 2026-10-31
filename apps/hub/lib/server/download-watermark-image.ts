/**
 * Per-download watermark for post images (2026-10-17; docs/hub-downloads/DESIGN.md section 3).
 *
 * Embeds an XMP packet carrying only the opaque download ID (the grant ID). JPEG: an APP1 segment
 * right after SOI. PNG: an iTXt chunk right after IHDR. WebP: an `XMP ` chunk, adding a VP8X
 * header when the file is in the simple format. The pixels are untouched, so the mark does not
 * survive re-encoding or metadata stripping; it identifies files shared as downloaded.
 *
 * Returns null when the bytes do not parse; the caller then fails closed.
 */

export const DOWNLOAD_XMP_NAMESPACE = "urn:jkamma-hub:ns:download:1";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function downloadXmpPacket(downloadId: string): string {
  if (!UUID_V4.test(downloadId)) throw new Error("invalid_download_id");
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + `<rdf:Description rdf:about="" xmlns:hubdl="${DOWNLOAD_XMP_NAMESPACE}" hubdl:downloadId="${downloadId}"/>`
    + "</rdf:RDF></x:xmpmeta>"
    + '<?xpacket end="r"?>'
  );
}

/** Reads the download ID back out of any bytes that carry the packet (tests and investigations). */
export function readDownloadId(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const match = /hubdl:downloadId="([0-9a-f-]{36})"/.exec(text);
  return match ? match[1]! : null;
}

const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function jpeg(bytes: Uint8Array, xmp: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const signature = encoder.encode("http://ns.adobe.com/xap/1.0/\0");
  const length = 2 + signature.length + xmp.length;
  if (length > 0xffff) return null;
  const segment = concat([new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff]), signature, xmp]);
  return concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(bytes: Uint8Array, xmp: Uint8Array): Uint8Array | null {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const afterIhdr = 8 + 12 + 13;
  // iTXt: keyword, null, compression flag 0, method 0, empty language, null, empty translation, null, text.
  const data = concat([encoder.encode("XML:com.adobe.xmp"), new Uint8Array([0, 0, 0, 0, 0]), xmp]);
  const typeAndData = concat([encoder.encode("iTXt"), data]);
  const chunk = new Uint8Array(12 + data.length);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  chunkView.setUint32(8 + data.length, crc32(typeAndData));
  return concat([bytes.subarray(0, afterIhdr), chunk, bytes.subarray(afterIhdr)]);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function riffChunk(type: string, data: Uint8Array): Uint8Array {
  const padded = data.length % 2 === 1 ? 1 : 0;
  const out = new Uint8Array(8 + data.length + padded);
  out.set(encoder.encode(type), 0);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function webp(bytes: Uint8Array, xmp: Uint8Array): Uint8Array | null {
  if (bytes.length < 30 || fourcc(bytes, 0) !== "RIFF" || fourcc(bytes, 8) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 > bytes.length) return null;
  const first = fourcc(bytes, 12);
  let body: Uint8Array;
  if (first === "VP8X") {
    body = bytes.slice(12, 8 + view.getUint32(4, true));
    if (body[8]! & 0x04) return null; // already carries XMP: never stack a second packet
    body[8] = body[8]! | 0x04;
  } else {
    // Simple format: build a VP8X header from the bitstream's own dimensions.
    let width: number;
    let height: number;
    let alpha = 0;
    if (first === "VP8L") {
      if (bytes[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
      alpha = (bits >>> 28) & 1 ? 0x10 : 0;
    } else if (first === "VP8 ") {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else {
      return null;
    }
    const header = new Uint8Array(10);
    header[0] = 0x04 | alpha;
    const w = width - 1;
    const h = height - 1;
    header.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 4);
    body = concat([riffChunk("VP8X", header), bytes.subarray(12, 8 + view.getUint32(4, true))]);
  }
  const payload = concat([body, riffChunk("XMP ", xmp)]);
  const head = new Uint8Array(12);
  head.set(encoder.encode("RIFF"), 0);
  new DataView(head.buffer).setUint32(4, payload.length + 4, true);
  head.set(encoder.encode("WEBP"), 8);
  return concat([head, payload]);
}

export function embedImageDownloadId(bytes: Uint8Array, mimeType: string, downloadId: string): Uint8Array | null {
  const xmp = encoder.encode(downloadXmpPacket(downloadId));
  if (mimeType === "image/jpeg") return jpeg(bytes, xmp);
  if (mimeType === "image/png") return png(bytes, xmp);
  if (mimeType === "image/webp") return webp(bytes, xmp);
  return null;
}
