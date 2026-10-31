"use client";

export const IMAGE_OPTIMIZER_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ImageOptimizationPreset {
  width: number;
  height: number;
  maxSourceBytes: number;
  maxSourcePixels: number;
  maxOutputBytes: number;
  mimeType: "image/webp";
  qualitySteps: readonly number[];
  sizeSteps: readonly number[];
}

export interface OptimizedImage {
  dataUrl: string;
  width: number;
  height: number;
  sourceBytes: number;
  outputBytes: number;
  mimeType: "image/webp";
}

export const SQUARE_AVATAR_PRESET: ImageOptimizationPreset = {
  width: 512,
  height: 512,
  maxSourceBytes: 8 * 1024 * 1024,
  maxSourcePixels: 40_000_000,
  maxOutputBytes: 500 * 1024,
  mimeType: "image/webp",
  qualitySteps: [0.82, 0.72, 0.62, 0.52],
  sizeSteps: [1, 0.875, 0.75, 0.625],
};

export const POST_IMAGE_MAX_DIMENSION = 1600;
export const POST_IMAGE_THUMBNAIL_DIMENSION = 480;
export const POST_IMAGE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface OptimizedPostImage {
  image: File;
  thumbnail: File;
  width: number;
  height: number;
  thumbnailWidth: number;
  thumbnailHeight: number;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob || blob.type !== "image/webp") reject(new Error("このブラウザではWebP画像を生成できません。"));
    else resolve(blob);
  }, "image/webp", quality));
}

/** Re-encoding through canvas removes source EXIF/location metadata. */
export async function optimizePostImageFile(file: File): Promise<OptimizedPostImage> {
  validateImageSource(file, { ...SQUARE_AVATAR_PRESET, maxSourceBytes: 8 * 1024 * 1024 });
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > SQUARE_AVATAR_PRESET.maxSourcePixels) {
      throw new Error("画像の解像度が大きすぎます。");
    }
    const scale = Math.min(1, POST_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const render = async (targetWidth: number, targetHeight: number, quality: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth; canvas.height = targetHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("画像を処理できませんでした。");
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      return canvasBlob(canvas, quality);
    };
    let image = await render(width, height, 0.82);
    if (image.size > POST_IMAGE_MAX_OUTPUT_BYTES) image = await render(width, height, 0.68);
    if (image.size > POST_IMAGE_MAX_OUTPUT_BYTES) throw new Error("画像を2MB以下に圧縮できませんでした。");
    const thumbScale = Math.min(1, POST_IMAGE_THUMBNAIL_DIMENSION / Math.max(width, height));
    const thumbnailWidth = Math.max(1, Math.round(width * thumbScale));
    const thumbnailHeight = Math.max(1, Math.round(height * thumbScale));
    const thumbnail = await render(thumbnailWidth, thumbnailHeight, 0.72);
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return {
      image: new File([image], `${base}.webp`, { type: "image/webp" }),
      thumbnail: new File([thumbnail], `${base}.thumb.webp`, { type: "image/webp" }),
      width, height, thumbnailWidth, thumbnailHeight,
    };
  } finally { bitmap.close(); }
}

export function validateImageSource(
  file: Pick<File, "type" | "size">,
  preset: ImageOptimizationPreset,
) {
  if (!IMAGE_OPTIMIZER_ALLOWED_TYPES.has(file.type)) {
    throw new Error("JPEG、PNG、WebPの画像を選んでください。");
  }
  if (file.size <= 0 || file.size > preset.maxSourceBytes) {
    throw new Error(
      `元画像は${Math.floor(preset.maxSourceBytes / 1024 / 1024)}MB以下にしてください。`,
    );
  }
}

export function calculateCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return {
      x: (sourceWidth - width) / 2,
      y: 0,
      width,
      height: sourceHeight,
    };
  }

  const height = sourceWidth / targetRatio;
  return {
    x: 0,
    y: (sourceHeight - height) / 2,
    width: sourceWidth,
    height,
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/webp",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画像を変換できませんでした。"));
          return;
        }
        if (blob.type !== mimeType) {
          reject(new Error("このブラウザはWebP変換に対応していません。"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(blob);
  });
}

export async function optimizeImageFile(
  file: File,
  preset: ImageOptimizationPreset = SQUARE_AVATAR_PRESET,
): Promise<OptimizedImage> {
  validateImageSource(file, preset);

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width * bitmap.height > preset.maxSourcePixels
    ) {
      throw new Error("画像の解像度が大きすぎます。");
    }

    const crop = calculateCoverCrop(
      bitmap.width,
      bitmap.height,
      preset.width,
      preset.height,
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした。");

    for (const sizeScale of preset.sizeSteps) {
      const width = Math.max(1, Math.round(preset.width * sizeScale));
      const height = Math.max(1, Math.round(preset.height * sizeScale));
      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.clearRect(0, 0, width, height);
      context.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        width,
        height,
      );

      for (const quality of preset.qualitySteps) {
        const output = await canvasToBlob(canvas, preset.mimeType, quality);
        if (output.size > preset.maxOutputBytes) continue;
        return {
          dataUrl: await blobToDataUrl(output),
          width,
          height,
          sourceBytes: file.size,
          outputBytes: output.size,
          mimeType: preset.mimeType,
        };
      }
    }

    throw new Error(
      `画像を${Math.floor(preset.maxOutputBytes / 1024)}KB以下に圧縮できませんでした。`,
    );
  } finally {
    bitmap.close();
  }
}
