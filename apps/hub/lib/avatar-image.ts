/*
 * Every user image stored for public delivery (avatar, game guide, community) must arrive as a WebP the browser
 * re-drew on a canvas. The server cannot strip metadata itself, so it refuses anything that still carries an
 * EXIF / XMP / ICCP chunk (GPS, device, author) and anything that is not WebP at all.
 */
const AVATAR_MIME_TYPES = new Set(["image/webp"]);
const METADATA_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);

export function webpCarriesMetadata(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (METADATA_CHUNKS.has(name)) return true;
    offset += 8 + size + (size % 2);
  }
  // A chunk running past the end is malformed; treat it as unsafe.
  return offset > bytes.length;
}

export const MAX_AVATAR_BYTES = 500 * 1024;
export const MAX_AVATAR_DATA_URL_LENGTH = 700_000;

function hasExpectedSignature(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }

  if (mimeType === "image/png") {
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function validateAvatarDataUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_AVATAR_DATA_URL_LENGTH) {
    throw new Error("プロフィール画像が大きすぎます。");
  }

  const match =
    /^data:(image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match || !AVATAR_MIME_TYPES.has(match[1])) {
    throw new Error("WebPの画像を選択してください。");
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
    throw new Error("プロフィール画像は500KB以下にしてください。");
  }

  if (!hasExpectedSignature(bytes, match[1])) {
    throw new Error("画像ファイルを確認できませんでした。");
  }

  if (webpCarriesMetadata(bytes)) {
    throw new Error("位置情報などのメタデータを含む画像は使えません。");
  }

  return value;
}

export function decodeAvatarDataUrl(value: unknown): { bytes: Uint8Array; contentType: "image/jpeg" | "image/png" | "image/webp" } {
  const validated = validateAvatarDataUrl(value);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/u.exec(validated);
  if (!match) throw new Error("画像ファイルを確認できませんでした。");
  return {
    bytes: new Uint8Array(Buffer.from(match[2], "base64")),
    contentType: match[1] as "image/jpeg" | "image/png" | "image/webp",
  };
}

export function validateOptimizedImageDataUrl(value: unknown): string {
  const validated = validateAvatarDataUrl(value);
  if (!validated.startsWith("data:image/webp;base64,")) {
    throw new Error("画像はWebPへ最適化してから送信してください。");
  }
  return validated;
}
