"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { V2Button } from "@/components/v2/v2-button";
import dynamic from "next/dynamic";
import type { ProfileCommunityItem, ProfileWalletItem } from "@/lib/server/profile-page-data";
import type { ProfileLinkItem } from "@/lib/server/profile-page-data";

/* viem is heavy; keep it out of the profile route initial bundle. */
const WalletTipControl = dynamic(() => import("@/components/wallet-tip-control").then((m) => m.WalletTipControl), { ssr: false });

/*
 * アバター。既存と同じ契約: 端末で 256px 以下の WebP に描き直し、
 * data URL で PUT /api/profile/avatar（500KB まで、JPEG/PNG/WebP）。
 */
const AVATAR_MAX = 256;

async function prepareAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(AVATAR_MAX, side);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  /* 正方形に切り出す。中心を残す。 */
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("blob"))), "image/webp", 0.85));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/webp;base64,${btoa(binary)}`;
}

/*
 * 本人のプロフィールの編集。既存の profile-edit-form / profile-public-details から
 * 名前・自己紹介・外部リンクの3つを抜いた。上限はサーバーと同じ
 * （名前40字、自己紹介180字。lib/profile-privacy.ts）。
 *
 * 投げ銭の受け取り口とコミュニティ・ウォレットの公開設定は 2026-09-04 に
 * 足した（旦那様の「古いUIを出さない」）。送り先は既存と同じ。
 */
const NAME_MAX = 40;
const BIO_MAX = 180;
const LINK_MAX = 5;

export function V2ProfileEdit({
  initialDisplayName,
  initialBio,
  initialLinks,
  initialCommunities,
  initialWallets,
  handle,
  locale,
}: {
  initialCommunities: ProfileCommunityItem[];
  initialWallets: ProfileWalletItem[];
  /* 投げ銭の受け取り口は自分の @ で出す。 */
  handle: string;
  initialDisplayName: string;
  initialBio: string;
  initialLinks: ProfileLinkItem[];
  locale: string;
}) {
  const ja = locale === "ja";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [links, setLinks] = useState<ProfileLinkItem[]>(initialLinks.length ? initialLinks : [{ label: "", url: "" }]);
  const [communities, setCommunities] = useState(initialCommunities);
  /* ウォレットは全部まとめて1つの札。既存も「すべて公開か、すべて非公開か」だった。 */
  const [walletPublished, setWalletPublished] = useState(
    initialWallets.length > 0 && initialWallets.every((wallet) => wallet.published),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const avatarInput = useRef<HTMLInputElement | null>(null);

  const changeAvatar = (files: FileList | null) => {
    const file = files?.[0];
    if (!file || pending) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage(ja ? "JPEG・PNG・WebP の画像だけ選べます。" : "Only JPEG, PNG and WebP images can be used.");
      return;
    }
    startTransition(async () => {
      try {
        const avatarUrl = await prepareAvatar(file);
        const response = await fetch("/api/profile/avatar", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarUrl }),
        });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(payload.error || String(response.status));
        setMessage(ja ? "画像を差し替えました。" : "Avatar updated.");
        router.refresh();
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "画像を差し替えられませんでした。" : "Could not update the avatar."));
      } finally {
        if (avatarInput.current) avatarInput.current.value = "";
      }
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || !displayName.trim()) return;
    startTransition(async () => {
      try {
        const profile = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim(), bio }),
        });
        const profilePayload = await profile.json().catch(() => ({})) as { error?: string };
        if (!profile.ok) throw new Error(profilePayload.error || String(profile.status));
        const cleaned = links.filter((link) => link.label.trim() || link.url.trim());
        const linkResponse = await fetch("/api/profile/links", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ links: cleaned }),
        });
        const linkPayload = await linkResponse.json().catch(() => ({})) as { error?: string };
        if (!linkResponse.ok) throw new Error(linkPayload.error || String(linkResponse.status));
        /* 公開設定は変わったものだけ送る。全部送ると無駄な書き込みになる。 */
        for (const community of communities) {
          const before = initialCommunities.find((item) => item.id === community.id);
          if (before && before.published === community.published) continue;
          const response = await fetch("/api/profile/community-visibility", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ communityId: community.id, published: community.published }),
          });
          const payload = await response.json().catch(() => ({})) as { error?: string };
          if (!response.ok) throw new Error(payload.error || String(response.status));
        }
        const walletWas = initialWallets.length > 0 && initialWallets.every((wallet) => wallet.published);
        if (initialWallets.length > 0 && walletPublished !== walletWas) {
          const response = await fetch("/api/profile/wallet-visibility", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ published: walletPublished }),
          });
          const payload = await response.json().catch(() => ({})) as { error?: string };
          if (!response.ok) throw new Error(payload.error || String(response.status));
        }
        setMessage(ja ? "保存しました。" : "Saved.");
        setOpen(false);
        router.refresh();
      } catch (caught) {
        setMessage(caught instanceof Error && caught.message ? caught.message : (ja ? "保存できませんでした。" : "Could not save."));
      }
    });
  };

  return (
    <div className="v2-profile__actions">
      <div className="v2-post__actions">
        <button type="button" className="v2-toggle v2-toggle--text" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? (ja ? "編集をやめる" : "Cancel") : (ja ? "プロフィールを編集" : "Edit profile")}
        </button>
        <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => changeAvatar(event.target.files)} />
        <V2Button icon="edit" variant="text" label={pending ? (ja ? "送っています…" : "Sending…") : (ja ? "画像を変える" : "Change avatar")} disabled={pending} onClick={() => avatarInput.current?.click()} />
      </div>
      {message ? <p className="v2-note" role="status">{message}</p> : null}
      <WalletTipControl handle={handle} isCurrentUser />
      {open ? (
        <form className="v2-profile__edit" onSubmit={save}>
          <label className="v2-profile__field">
            <span>{ja ? "名前" : "Name"} <small>{displayName.length}/{NAME_MAX}</small></span>
            <input className="v2-reply__input" value={displayName} maxLength={NAME_MAX} onChange={(event) => setDisplayName(event.target.value)} required />
          </label>
          <label className="v2-profile__field">
            <span>{ja ? "自己紹介" : "Bio"} <small>{bio.length}/{BIO_MAX}</small></span>
            <textarea className="v2-reply__input" value={bio} maxLength={BIO_MAX} rows={3} onChange={(event) => setBio(event.target.value)} />
          </label>
          <fieldset className="v2-profile__links">
            <legend>{ja ? "外部リンク" : "Links"}</legend>
            {links.map((link, index) => (
              <div key={index} className="v2-profile__link-row">
                <input className="v2-reply__input" placeholder={ja ? "表示名" : "Label"} value={link.label} maxLength={40} onChange={(event) => setLinks((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                <input className="v2-reply__input" type="url" placeholder="https://" value={link.url} maxLength={500} onChange={(event) => setLinks((current) => current.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} />
                <button type="button" className="v2-action" onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}>{ja ? "削除" : "Remove"}</button>
              </div>
            ))}
            {links.length < LINK_MAX ? (
              <button type="button" className="v2-action" onClick={() => setLinks((current) => [...current, { label: "", url: "" }])}>{ja ? "リンクを足す" : "Add a link"}</button>
            ) : null}
          </fieldset>
          {/*
            * 公開設定（2026-09-04）。既存の profile-edit-form と同じ送り先。
            * 何も持っていない人には節ごと出さない——空の枠は迷いを増やす。
            */}
          {communities.length ? (
            <fieldset className="v2-profile__fieldset">
              <legend>{ja ? "プロフィールに出すコミュニティ" : "Communities on your profile"}</legend>
              {communities.map((community) => (
                <label key={community.id} className="v2-filter__row">
                  <input
                    type="checkbox"
                    checked={community.published}
                    onChange={(event) => setCommunities((current) => current.map((item) => (
                      item.id === community.id ? { ...item, published: event.target.checked } : item
                    )))}
                  />
                  <span>{community.name}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {initialWallets.length ? (
            <fieldset className="v2-profile__fieldset">
              <legend>{ja ? "ウォレット" : "Wallet"}</legend>
              <label className="v2-filter__row">
                <input type="checkbox" checked={walletPublished} onChange={(event) => setWalletPublished(event.target.checked)} />
                <span>{ja ? `プロフィールに出す（${initialWallets.length}件）` : `Show on your profile (${initialWallets.length})`}</span>
              </label>
            </fieldset>
          ) : null}
          <div className="v2-reply__footer">
            <button type="submit" className="v2-reply__submit" disabled={pending || !displayName.trim()}>{ja ? "保存" : "Save"}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
