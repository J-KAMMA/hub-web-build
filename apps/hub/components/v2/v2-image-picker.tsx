"use client";

import { useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { IMAGE_LIMIT, imageErrorMessage, prepareImage, uploadPickedImages, type PickedImage } from "@/components/v2/v2-image-prepare";

/*
 * 画像を選ぶ・外す・送る、の3つをまとめた小さな部品。返信欄とスレッドの返信欄が使う。
 * 下ごしらえと送信は v2-image-prepare（投稿欄・コミュニティの欄と同じ）。
 */
export function useV2Images(japanese: boolean, onError: (message: string) => void) {
  const [images, setImages] = useState<PickedImage[]>([]);
  const input = useRef<HTMLInputElement | null>(null);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files).slice(0, Math.max(0, IMAGE_LIMIT - images.length));
    if (!chosen.length) return;
    try {
      const prepared = await Promise.all(chosen.map(prepareImage));
      setImages((current) => {
        const known = new Set(current.map((item) => item.key));
        return [...current, ...prepared.filter((item) => !known.has(item.key))].slice(0, IMAGE_LIMIT);
      });
    } catch (caught) {
      onError(imageErrorMessage(caught, japanese));
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const drop = (key: string) => {
    setImages((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  };

  const describe = (key: string, altText: string) => {
    setImages((current) => current.map((item) => (item.key === key ? { ...item, altText } : item)));
  };

  const clear = () => {
    images.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setImages([]);
  };

  /* 送って id を返す。失敗は文言で投げる。 */
  const upload = () => (images.length ? uploadPickedImages(images, japanese) : Promise.resolve([] as string[]));

  return { images, input, pick, drop, describe, clear, upload, open: () => input.current?.click() };
}

export function V2ImageList({ images, onDrop, onDescribe, japanese }: {
  images: PickedImage[];
  onDrop: (key: string) => void;
  onDescribe: (key: string, altText: string) => void;
  japanese: boolean;
}) {
  if (!images.length) return null;
  return (
    <ul className="v2-compose__images">
      {images.map((item) => (
        <li key={item.key} className="v2-compose__image">
          <img src={item.previewUrl} alt="" width={item.thumbnailWidth} height={item.thumbnailHeight} />
          <input
            type="text"
            value={item.altText}
            maxLength={200}
            placeholder={japanese ? "画像の説明（読み上げ用）" : "Describe the image"}
            aria-label={japanese ? "画像の説明" : "Image description"}
            onChange={(event) => onDescribe(item.key, event.target.value)}
          />
          <V2Button icon="close" label={japanese ? "画像を外す" : "Remove image"} onClick={() => onDrop(item.key)} />
        </li>
      ))}
    </ul>
  );
}

export function V2ImageButton({ picker, disabled, japanese }: {
  picker: ReturnType<typeof useV2Images>;
  disabled?: boolean;
  japanese: boolean;
}) {
  return (
    <>
      <input ref={picker.input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => void picker.pick(event.target.files)} />
      <V2Button
        icon="plus"
        label={japanese ? `画像を足す（${picker.images.length}/${IMAGE_LIMIT}）` : `Add image (${picker.images.length}/${IMAGE_LIMIT})`}
        disabled={disabled || picker.images.length >= IMAGE_LIMIT}
        onClick={picker.open}
      />
    </>
  );
}
