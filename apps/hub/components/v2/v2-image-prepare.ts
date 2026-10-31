/*
 * 添付画像の下ごしらえと送信。投稿欄・コミュニティの欄が同じものを使う。
 *
 * 既存の投稿欄と同じ手順: 端末で WebP に描き直し（1600px以下）、縮小版（480px以下）も
 * 作り、POST /api/media/images（image / thumbnail / width / height / altText …）へ。
 * **API は位置情報を除いた WebP しか受け取らない**（そのまま送ると400）。
 * Chrome の canvas は WebP に色プロファイル（ICCP）を付けることがあるので、
 * EXIF / XMP / ICCP の塊を外し、RIFF の長さと VP8X の旗を直してから送る。
 *
 * ブラウザでしか動かない（canvas・createImageBitmap）。クライアント部品から呼ぶ。
 */

export type PickedImage = {
  key: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  thumbnail: Blob;
  thumbnailWidth: number;
  thumbnailHeight: number;
  altText: string;
};

export const IMAGE_LIMIT = 4;
const IMAGE_MAX = 1600;
const THUMBNAIL_MAX = 480;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const STRIPPED_CHUNKS = new Set(["EXIF", "XMP ", "ICCP"]);

async function stripWebpMetadata(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = (start: number) => String.fromCharCode(...bytes.slice(start, start + 4));
  if (bytes.length < 12 || text(0) !== "RIFF" || text(8) !== "WEBP") return blob;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [];
  let offset = 12;
  let removed = false;
  while (offset + 8 <= bytes.length) {
    const name = text(offset);
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size % 2);
    if (STRIPPED_CHUNKS.has(name)) removed = true;
    else kept.push(bytes.slice(offset, Math.min(end, bytes.length)));
    offset = end;
  }
  if (!removed) return blob;
  const body = kept.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(bytes.slice(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  let cursor = 12;
  for (const chunk of kept) {
    out.set(chunk, cursor);
    /* VP8X の旗: ICC 0x20 / EXIF 0x08 / XMP 0x04 を落とす */
    if (String.fromCharCode(...chunk.slice(0, 4)) === "VP8X") out[cursor + 8] &= ~0x2c;
    cursor += chunk.length;
  }
  return new Blob([out], { type: "image/webp" });
}

async function draw(source: ImageBitmap | Blob, width: number, height: number, quality: number): Promise<Blob> {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0, width, height);
  if (source instanceof Blob) bitmap.close();
  const encoded = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("blob"))), "image/webp", quality);
  });
  return stripWebpMetadata(encoded);
}

/* 失敗の理由は "type" / "size" / それ以外。呼び手が文言にする。 */
export async function prepareImage(file: File): Promise<PickedImage> {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("type");
  if (file.size > 5 * 1024 * 1024) throw new Error("size");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const processed = await draw(bitmap, width, height, 0.82);
  bitmap.close();
  const thumbnailScale = Math.min(1, THUMBNAIL_MAX / Math.max(width, height));
  const thumbnailWidth = Math.max(1, Math.round(width * thumbnailScale));
  const thumbnailHeight = Math.max(1, Math.round(height * thumbnailScale));
  const thumbnail = await draw(processed, thumbnailWidth, thumbnailHeight, 0.72);
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return {
    key: `${file.name}:${file.size}:${file.lastModified}`,
    file: new File([processed], `${base}.webp`, { type: "image/webp" }),
    previewUrl: URL.createObjectURL(processed),
    width,
    height,
    thumbnail: new File([thumbnail], `${base}.thumb.webp`, { type: "image/webp" }),
    thumbnailWidth,
    thumbnailHeight,
    altText: "",
  };
}

export function imageErrorMessage(caught: unknown, japanese: boolean): string {
  const reason = caught instanceof Error ? caught.message : "";
  if (reason === "type") return japanese ? "JPEG・PNG・WebP の画像だけ選べます。" : "Only JPEG, PNG and WebP images can be attached.";
  if (reason === "size") return japanese ? "画像は1枚5MBまでです。" : "Images must be 5MB or smaller.";
  return japanese ? "画像を読み込めませんでした。" : "Could not read the image.";
}

/* 順に送って id を返す。1枚でも失敗したらその文言で投げる。
   endpoint は既定が投稿用——DM は /api/media/dm-images（pending 画像の表が別）。 */
export async function uploadPickedImages(images: PickedImage[], japanese: boolean, endpoint = "/api/media/images", scope?: { expectedViewer: string; isCurrent: () => boolean }): Promise<string[]> {
  const expectedViewer = scope?.expectedViewer, isCurrent = scope?.isCurrent;
  const assertCurrent = () => {
    if (!scope) return;
    let current = false;
    try { current = typeof expectedViewer === "string" && expectedViewer.length > 0 && isCurrent?.() === true; } catch { /* A failed scope check is stale. */ }
    if (!current) throw new Error("image_scope_changed");
  };
  assertCurrent();
  const ids: string[] = [];
  for (const picked of images) {
    const form = new FormData();
    form.append("image", picked.file);
    form.append("thumbnail", picked.thumbnail);
    form.append("width", String(picked.width));
    form.append("height", String(picked.height));
    form.append("altText", picked.altText);
    form.append("thumbnailWidth", String(picked.thumbnailWidth));
    form.append("thumbnailHeight", String(picked.thumbnailHeight));
    assertCurrent();
    const upload = await fetch(endpoint, { method: "POST", body: form, ...(scope ? { headers: { "X-Hub-Expected-Viewer": expectedViewer! } } : {}) });
    assertCurrent();
    const uploaded = await upload.json().catch(() => null) as { image?: { id: string }; error?: string } | null;
    assertCurrent();
    if (!upload.ok || !uploaded?.image?.id) {
      throw new Error(uploaded?.error ?? (japanese ? "画像を送れませんでした。" : "Could not upload the image."));
    }
    ids.push(uploaded.image.id);
  }
  return ids;
}
