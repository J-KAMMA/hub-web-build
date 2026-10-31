"use client";

import { type ChangeEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { getCommunityCategoryOptions } from "@/lib/community-categories";
import { UiButton, UiInput, UiSelect, UiTextarea } from "@/components/ui/primitives";
import { optimizeImageFile, SQUARE_AVATAR_PRESET } from "@/lib/client-image-optimizer";

/*
 * コミュニティを作る（2026-09-04、旦那様の「古いUIを出さない」）。
 *
 * 既存では community-workspace.tsx（6,328行）の中の modal に埋まっていて、
 * v2 からは /community?create=1 へ渡していた。押すと古いUIへ出る。
 *
 * **切り出さずに書き起こした。** あの部品は作成の状態と、参加中の
 * コミュニティ・チャンネル・会話・運営の状態を同じ場所で持っている。
 * 作成だけを抜くには全体を組み替えることになり、触る量に見合わない。
 * 送り先と検証は既存と一字一句同じにする——そこがずれると、片方でだけ
 * 作れるコミュニティができる。
 *
 *   POST /api/communities { name, description, category, imageUrl?, visibility }
 *   名前は3文字以上、説明は10文字以上（既存と同じ）
 *   画像は 8MB まで・WebP へ最適化（SQUARE_AVATAR_PRESET）
 */
const VISIBILITIES = [
  ["public", "公開", "誰でもすぐ参加できます"],
  ["approval", "承認制", "参加には管理者の承認が必要です"],
  ["private", "招待制", "招待された人だけ参加できます"],
] as const;

type Visibility = (typeof VISIBILITIES)[number][0];

export function V2CommunityCreate({ knownCategories }: { knownCategories: string[] }) {
  const router = useRouter();
  const categories = getCommunityCategoryOptions(knownCategories);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(categories[0] ?? "");
  const [imageUrl, setImageUrl] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [imageName, setImageName] = useState("");
  const [preparingImage, setPreparingImage] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setImageName(file.name);
    setPreparingImage(true);
    try {
      setImageUrl((await optimizeImageFile(file, SQUARE_AVATAR_PRESET)).dataUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像を確認できませんでした。");
    } finally {
      setPreparingImage(false);
    }
  };

  const create = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 3 || description.trim().length < 10) {
      setError("コミュニティ名は3文字以上、説明は10文字以上で入力してください。");
      return;
    }
    setError("");
    startTransition(async () => {
      const response = await fetch("/api/communities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          category,
          imageUrl: imageUrl || undefined,
          visibility,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        community?: { id: string; slug?: string };
      };
      if (!response.ok || !payload.community) {
        setError(payload.error ?? "コミュニティを作成できませんでした。");
        return;
      }
      /* 作った先へ入る。一覧へ戻すと、作ったものを自分で探すことになる。 */
      router.push(`/v2/community?community=${encodeURIComponent(payload.community.slug ?? payload.community.id)}`);
      router.refresh();
    });
  };

  return (
    <form className="v2-community-create" onSubmit={create}>
      <p className="v2-note">
        新しいコミュニティには「一般」チャンネルが自動で作成されます。
        公開原本の保存先は作成後に運営センターの「保存・配信」で選べます。
      </p>

      <label className="v2-profile__field">
        <span>コミュニティ名 <small>{name.trim().length}/100</small></span>
        <UiInput value={name} maxLength={100} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label className="v2-profile__field">
        <span>説明 <small>{description.trim().length}/2000</small></span>
        <UiTextarea value={description} maxLength={2000} rows={4} onChange={(event) => setDescription(event.target.value)} required />
      </label>

      <label className="v2-profile__field">
        <span>カテゴリ</span>
        <UiSelect value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((option) => <option key={option} value={option}>{option}</option>)}
        </UiSelect>
      </label>

      <label className="v2-profile__field">
        <span>画像 <small>8MBまで・WebPへ最適化</small></span>
        <span className="v2-community-create__file">
          <input className="v2-community-create__file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} disabled={preparingImage} />
          <span className="v2-community-create__file-button">{imageUrl ? "画像を変える" : "画像を選ぶ"}</span>
          <span className="v2-community-create__help">{imageName || "選ばれていません"}</span>
        </span>
        {preparingImage ? <small className="v2-community-create__help">処理中…</small> : null}
        {imageUrl ? <img className="v2-community-create__preview" src={imageUrl} alt="選択中のコミュニティ画像" /> : null}
      </label>

      <fieldset className="v2-profile__fieldset">
        <legend>公開範囲</legend>
        {VISIBILITIES.map(([value, label, help]) => (
          <label key={value} className="v2-community-create__choice">
            <input type="radio" name="v2-community-visibility" value={value} checked={visibility === value} onChange={() => setVisibility(value)} />
            <span><strong>{label}</strong><small>{help}</small></span>
          </label>
        ))}
      </fieldset>

      {error ? <p className="v2-note v2-note--error" role="alert">{error}</p> : null}

      <div className="v2-community-create__footer">
        <UiButton
          type="submit"
          tone="primary"
          pending={pending}
          disabled={pending || preparingImage || !name.trim() || !description.trim()}
        >
          {pending ? "作成中…" : "コミュニティを作る"}
        </UiButton>
      </div>
    </form>
  );
}
