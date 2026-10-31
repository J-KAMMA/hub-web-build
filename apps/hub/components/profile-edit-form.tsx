"use client";

import { useRouter } from "next/navigation";
import React, { ChangeEvent, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { optimizeImageFile, SQUARE_AVATAR_PRESET } from "@/lib/client-image-optimizer";
import { recordPersonalNodeEvent } from "@/lib/personal-node-local-keystore";
import type { ProfileCommunityItem, ProfileLinkItem, ProfileWalletItem } from "@/lib/server/profile-page-data";

type Props = {
  initialDisplayName: string;
  initialBio: string;
  initialAvatarUrl?: string;
  initialLinks: ProfileLinkItem[];
  initialCommunities: ProfileCommunityItem[];
  initialWallets: ProfileWalletItem[];
};

type SaveState = "idle" | "saving" | "partial" | "failed";

type SavedProfile = {
  displayName: string;
  bio: string;
  avatarUrl?: string;
  links: ProfileLinkItem[];
  communities: ProfileCommunityItem[];
  walletPublished: boolean;
};

class ProfileResponseError extends Error {}

const emptyLink = (): ProfileLinkItem => ({ label: "", url: "" });
const editableLinks = (links: ProfileLinkItem[]) => links.length
  ? links.map((link) => ({ ...link }))
  : [emptyLink()];
const editableCommunities = (communities: ProfileCommunityItem[]) =>
  communities.map((community) => ({ ...community }));

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  return payload?.error ?? fallback;
}

async function profileRequest(path: string, init: RequestInit, fallback: string) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15_000);

  try {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProfileResponseError(await responseError(response, fallback));
    }
    return response;
  } catch (error) {
    if (error instanceof ProfileResponseError) throw error;
    if (timedOut) {
      throw new Error("通信が時間切れになりました。");
    }
    throw new Error("サーバーに接続できませんでした。");
  } finally {
    clearTimeout(timeout);
  }
}

export function ProfileEditForm({
  initialDisplayName,
  initialBio,
  initialAvatarUrl,
  initialLinks,
  initialCommunities,
  initialWallets,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const serverChangedRef = useRef(false);
  const initialWalletPublished = initialWallets.length > 0
    && initialWallets.every((wallet) => wallet.published);
  const saved = useRef<SavedProfile>({
    displayName: initialDisplayName,
    bio: initialBio,
    avatarUrl: initialAvatarUrl,
    links: editableLinks(initialLinks),
    communities: editableCommunities(initialCommunities),
    walletPublished: initialWalletPublished,
  });
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [avatarChanged, setAvatarChanged] = useState(false);
  const [links, setLinks] = useState<ProfileLinkItem[]>(() => editableLinks(initialLinks));
  const [communities, setCommunities] = useState(() => editableCommunities(initialCommunities));
  const [walletPublished, setWalletPublished] = useState(initialWalletPublished);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const isPending = saveState === "saving";

  const close = () => {
    if (submittingRef.current) return;
    const baseline = saved.current;
    setDisplayName(baseline.displayName);
    setBio(baseline.bio);
    setAvatarUrl(baseline.avatarUrl);
    setAvatarChanged(false);
    setLinks(editableLinks(baseline.links));
    setCommunities(editableCommunities(baseline.communities));
    setWalletPublished(baseline.walletPublished);
    setError("");
    setSaveState("idle");
    setOpen(false);
    if (serverChangedRef.current) {
      serverChangedRef.current = false;
      router.refresh();
    }
  };

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const optimized = await optimizeImageFile(file, SQUARE_AVATAR_PRESET);
      setAvatarUrl(optimized.dataUrl);
      setAvatarChanged(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画像を読み込めませんでした。");
    } finally {
      event.target.value = "";
    }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setSaveState("saving");
    const completed: string[] = [];
    const portableProfilePatch: Record<string, unknown> = {};

    try {
      if (
        saved.current.displayName !== displayName
        || saved.current.bio !== bio
      ) {
        const profileResponse = await profileRequest("/api/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName, bio }),
        }, "基本情報を更新できませんでした。");
        const payload = await profileResponse.json().catch(() => null) as {
          profile?: { displayName?: unknown; bio?: unknown };
        } | null;
        const storedDisplayName = typeof payload?.profile?.displayName === "string"
          ? payload.profile.displayName
          : displayName;
        const storedBio = typeof payload?.profile?.bio === "string"
          ? payload.profile.bio
          : bio;
        saved.current.displayName = storedDisplayName;
        saved.current.bio = storedBio;
        setDisplayName(storedDisplayName);
        setBio(storedBio);
        portableProfilePatch.displayName = storedDisplayName;
        portableProfilePatch.bio = storedBio;
        serverChangedRef.current = true;
        completed.push("基本情報");
      }

      if (avatarChanged && avatarUrl && saved.current.avatarUrl !== avatarUrl) {
        const avatarResponse = await profileRequest("/api/profile/avatar", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ avatarUrl }),
        }, "プロフィール画像を更新できませんでした。");
        const payload = await avatarResponse.json().catch(() => null) as {
          profile?: { avatarUrl?: unknown };
        } | null;
        const storedAvatarUrl = typeof payload?.profile?.avatarUrl === "string"
          ? payload.profile.avatarUrl
          : avatarUrl;
        saved.current.avatarUrl = storedAvatarUrl;
        setAvatarUrl(storedAvatarUrl);
        setAvatarChanged(false);
        portableProfilePatch.avatarUpdated = true;
        serverChangedRef.current = true;
        completed.push("プロフィール画像");
      }

      if (JSON.stringify(saved.current.links) !== JSON.stringify(links)) {
        const linksResponse = await profileRequest("/api/profile/links", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ links }),
        }, "外部リンクを更新できませんでした。");
        const payload = await linksResponse.json().catch(() => null) as {
          links?: ProfileLinkItem[];
        } | null;
        const nextLinks = editableLinks(payload?.links ?? links);
        saved.current.links = editableLinks(nextLinks);
        setLinks(nextLinks);
        portableProfilePatch.links = nextLinks;
        serverChangedRef.current = true;
        completed.push("外部リンク");
      }

      for (const community of communities) {
        const savedCommunity = saved.current.communities.find(
          (item) => item.id === community.id,
        );
        if (savedCommunity?.published === community.published) continue;
        await profileRequest("/api/profile/community-visibility", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            communityId: community.id,
            published: community.published,
          }),
        }, "コミュニティの公開設定を更新できませんでした。");
        if (savedCommunity) {
          savedCommunity.published = community.published;
        } else {
          saved.current.communities.push({ ...community });
        }
        portableProfilePatch.communities = communities.map(({ id, published }) => ({ id, published }));
        serverChangedRef.current = true;
        completed.push(`「${community.name}」の公開設定`);
      }

      if (
        initialWallets.length
        && saved.current.walletPublished !== walletPublished
      ) {
        await profileRequest("/api/profile/wallet-visibility", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ published: walletPublished }),
        }, "ウォレットの公開設定を更新できませんでした。");
        saved.current.walletPublished = walletPublished;
        portableProfilePatch.walletPublished = walletPublished;
        serverChangedRef.current = true;
        completed.push("ウォレットの公開設定");
      }

      if (Object.keys(portableProfilePatch).length > 0) {
        void recordPersonalNodeEvent("hub.profile.update", portableProfilePatch);
      }
      serverChangedRef.current = false;
      setSaveState("idle");
      setOpen(false);
      router.refresh();
    } catch (caught) {
      const partial = completed.length > 0;
      setSaveState(partial ? "partial" : "failed");
      const reason = caught instanceof Error
        ? caught.message
        : "プロフィールを更新できませんでした。";
      const result = partial
        ? `一部の変更は保存されました（${completed.join("、")}）。`
        : "変更を保存できませんでした。";
      setError(`${result}${reason} 入力は保持されています。保存を再試行してください。`);
    } finally {
      submittingRef.current = false;
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="button"
        onClick={() => {
          setError("");
          setSaveState("idle");
          setOpen(true);
        }}
      >
        プロフィールを編集
      </button>
    );
  }

  return (
    <div className="profile-editor-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
      <button
        type="button"
        className="profile-editor-overlay__backdrop"
        onClick={close}
        aria-label="閉じる"
        disabled={isPending}
      />
      <section className="profile-editor">
        <header>
          <div><h2 id="profile-editor-title">プロフィールを編集</h2><p>公開情報と公開範囲をまとめて管理します。</p></div>
          <button type="button" className="hub-icon-button" onClick={close} aria-label="閉じる" title="閉じる" disabled={isPending}><X aria-hidden="true" /></button>
        </header>
        <div className="profile-editor__body" aria-busy={isPending} inert={isPending}>
          <section className="profile-editor__section profile-editor__identity">
            <h3>基本情報</h3>
            <button type="button" className="profile-editor__avatar" onClick={() => fileRef.current?.click()}>
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{displayName.slice(0, 2)}</span>}
              <b>画像を変更</b>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void chooseAvatar(event)} />
            <label><span>表示名</span><input value={displayName} maxLength={40} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label><span>自己紹介</span><textarea value={bio} maxLength={180} onChange={(event) => setBio(event.target.value)} /><small>{bio.length}/180</small></label>
          </section>

          <section className="profile-editor__section">
            <div className="profile-editor__section-heading"><h3>外部リンク</h3><span>最大3件・HTTPSのみ</span></div>
            <div className="profile-editor__links">
              {links.map((link, index) => <div key={index}>
                <input value={link.label} maxLength={40} placeholder="リンク名" aria-label={`リンク${index + 1}の名前`} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} />
                <input value={link.url} maxLength={2048} inputMode="url" placeholder="https://example.com" aria-label={`リンク${index + 1}のURL`} onChange={(event) => setLinks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} />
                <button type="button" className="hub-icon-button" onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`リンク${index + 1}を削除`} title="リンクを削除"><X aria-hidden="true" /></button>
              </div>)}
              {links.length < 3 ? <button type="button" className="hub-icon-button" onClick={() => setLinks((current) => [...current, { label: "", url: "" }])} aria-label="リンクを追加" title="リンクを追加"><Plus aria-hidden="true" /></button> : null}
            </div>
          </section>

          <section className="profile-editor__section">
            <div className="profile-editor__section-heading"><h3>所属コミュニティ</h3><span>公開するものだけ選択</span></div>
            <div className="profile-editor__toggles">
              {communities.length ? communities.map((community) => <label key={community.id}><span>{community.name}</span><input type="checkbox" checked={community.published} onChange={(event) => setCommunities((current) => current.map((item) => item.id === community.id ? { ...item, published: event.target.checked } : item))} /></label>) : <p>参加中のコミュニティはありません。</p>}
            </div>
          </section>

          {initialWallets.length ? <section className="profile-editor__section">
            <div className="profile-editor__section-heading"><h3>ウォレット</h3><span>初期設定は非公開</span></div>
            <label className="profile-editor__wallet"><span>プロフィールに短縮アドレスを表示</span><input type="checkbox" checked={walletPublished} onChange={(event) => setWalletPublished(event.target.checked)} /></label>
          </section> : null}
          {error ? <p className="inline-error" role="alert" aria-live="assertive">{error}</p> : null}
        </div>
        <footer>
          <button type="button" className="button" onClick={close} disabled={isPending}>キャンセル</button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={isPending || !displayName.trim()}
          >
            {isPending
              ? "保存中…"
              : saveState === "partial" || saveState === "failed"
                ? "保存を再試行"
                : "変更を保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}
