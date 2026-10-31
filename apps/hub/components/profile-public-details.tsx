"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { FOLLOW_STATE_EVENT, type FollowStateEventDetail } from "@/lib/follow-client";
import type {
  ProfileCommunityItem,
  ProfileLinkItem,
  ProfileWalletItem,
} from "@/lib/server/profile-page-data";

const BLOCKED_PROFILES_KEY = "hub.blockedProfileIds";
const MUTED_PROFILES_KEY = "hub.mutedProfileIds";
const PROFILE_CONTROL_EVENT = "hub-profile-controls-changed";

function mirrorProfileControl(key: string, profileId: string, enabled: boolean) {
  if (typeof window === "undefined") return;
  const ids = new Set<string>();
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    if (Array.isArray(stored)) {
      for (const id of stored) if (typeof id === "string") ids.add(id);
    }
  } catch {
    // Replace malformed device-local state with the server-confirmed setting.
  }
  if (enabled) ids.add(profileId);
  else ids.delete(profileId);
  window.localStorage.setItem(key, JSON.stringify([...ids]));
}

export function ProfileConnections({
  postCount,
  followerCount,
  followingCount,
  profileId,
  profileHandle,
}: {
  postCount: number;
  followerCount: number;
  followingCount: number;
  profileId?: string;
  profileHandle?: string;
}) {
  const [liveFollowerCount, setLiveFollowerCount] = useState(followerCount);

  useEffect(() => {
    setLiveFollowerCount(followerCount);
  }, [followerCount]);

  useEffect(() => {
    if (!profileId) return;
    const updateFollowerCount = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.targetProfileId !== profileId || detail.followerDelta === 0) return;
      setLiveFollowerCount((current) => Math.max(0, current + detail.followerDelta));
    };
    window.addEventListener(FOLLOW_STATE_EVENT, updateFollowerCount);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, updateFollowerCount);
  }, [profileId]);

  return (
    <div className="profile-card-simple__stats">
      <div><strong>{postCount}</strong><span>投稿</span></div>
      <a href={`/profile/${encodeURIComponent(profileHandle ?? "")}/following`}>
        <strong>{followingCount}</strong><span>フォロー中</span>
      </a>
      <a href={`/profile/${encodeURIComponent(profileHandle ?? "")}/followers`}>
        <strong>{liveFollowerCount}</strong><span>フォロワー</span>
      </a>
    </div>
  );
}

export function ProfilePublicDetails({
  initialLinks,
  initialCommunities,
  initialWallets,
  isCurrentUser,
  showOwnerControls,
}: {
  initialLinks: ProfileLinkItem[];
  initialCommunities: ProfileCommunityItem[];
  initialWallets: ProfileWalletItem[];
  isCurrentUser: boolean;
  showOwnerControls?: boolean;
}) {
  const ownerControls = showOwnerControls ?? isCurrentUser;
  const [links, setLinks] = useState(initialLinks);
  const [draftLinks, setDraftLinks] = useState<ProfileLinkItem[]>(initialLinks.length ? initialLinks : [{ label: "", url: "" }]);
  const [editingLinks, setEditingLinks] = useState(false);
  const [communities, setCommunities] = useState(initialCommunities);
  const [wallets, setWallets] = useState(initialWallets);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const saveLinks = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/profile/links", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ links: draftLinks }) });
      const payload = await response.json() as { links?: ProfileLinkItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "リンクを保存できませんでした。");
      setLinks(payload.links ?? []); setDraftLinks(payload.links?.length ? payload.links : [{ label: "", url: "" }]); setEditingLinks(false); setMessage("外部リンクを保存しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "リンクを保存できませんでした。"); }
    finally { setBusy(false); }
  };

  const toggleCommunity = async (communityId: string, published: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/profile/community-visibility", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ communityId, published }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "公開設定を更新できませんでした。");
      setCommunities((current) => current.map((item) => item.id === communityId ? { ...item, published } : item));
      setMessage(published ? "コミュニティをプロフィールに公開しました。" : "コミュニティを非公開にしました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "公開設定を更新できませんでした。"); }
    finally { setBusy(false); }
  };

  const toggleWallets = async (published: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/profile/wallet-visibility", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ published }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "ウォレット公開設定を更新できませんでした。");
      setWallets((current) => current.map((item) => ({ ...item, published })));
      setMessage(published ? "ウォレットを公開しました。" : "ウォレットを非公開にしました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "公開設定を更新できませんでした。"); }
    finally { setBusy(false); }
  };

  const publicCommunities = isCurrentUser ? communities : communities.filter((item) => item.published);
  const publicWallets = isCurrentUser ? wallets : wallets.filter((item) => item.published);
  const hasVisibleDetails = isCurrentUser || links.length > 0 || publicCommunities.length > 0 || publicWallets.length > 0;
  if (!hasVisibleDetails && !message) return null;
  return (
    <div className="profile-public-details">
      {(links.length || isCurrentUser) ? <section className="profile-detail-section">
        <header><h2>リンク</h2>{ownerControls ? <button type="button" onClick={() => setEditingLinks((value) => !value)}>{editingLinks ? "閉じる" : "編集"}</button> : null}</header>
        {links.length ? <div className="profile-external-links">{links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer nofollow ugc"><span>{link.label}</span><small>{new URL(link.url).hostname}</small><b aria-hidden="true">↗</b></a>)}</div> : !editingLinks ? <p className="profile-details-empty">公開リンクはまだありません。</p> : null}
        {editingLinks ? <form className="profile-links-form" onSubmit={saveLinks}>
          {draftLinks.map((link, index) => <div key={index}><input value={link.label} maxLength={40} placeholder="リンク名" aria-label={`リンク${index + 1}の名前`} onChange={(event) => setDraftLinks((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} /><input value={link.url} maxLength={2048} inputMode="url" placeholder="https://example.com" aria-label={`リンク${index + 1}のURL`} onChange={(event) => setDraftLinks((current) => current.map((item, i) => i === index ? { ...item, url: event.target.value } : item))} /><button type="button" className="hub-icon-button" onClick={() => setDraftLinks((current) => current.filter((_, i) => i !== index))} aria-label={`リンク${index + 1}を削除`} title="リンクを削除"><X aria-hidden="true" /></button></div>)}
          <footer>{draftLinks.length < 3 ? <button type="button" className="hub-icon-button" onClick={() => setDraftLinks((current) => [...current, { label: "", url: "" }])} aria-label="リンクを追加" title="リンクを追加"><Plus aria-hidden="true" /></button> : <span /> }<button type="submit" disabled={busy}>保存</button></footer>
        </form> : null}
      </section> : null}

      {(publicCommunities.length || isCurrentUser) ? <section className="profile-detail-section">
        <header><h2>コミュニティ</h2><span>{publicCommunities.filter((item) => item.published).length}件公開</span></header>
        <div className="profile-community-list">{publicCommunities.length ? publicCommunities.map((community) => <div key={community.id}><a href={`/community?community=${community.slug}`}>{community.imageUrl ? <img src={community.imageUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{community.name.slice(0, 1)}</span>}<strong>{community.name}</strong></a>{ownerControls ? <label><input type="checkbox" checked={community.published} disabled={busy} onChange={(event) => void toggleCommunity(community.id, event.target.checked)} /><i aria-hidden="true" /><span>{community.published ? "公開" : "非公開"}</span></label> : null}</div>) : <p className="profile-details-empty">参加中のコミュニティはありません。</p>}</div>
      </section> : null}

      {publicWallets.length ? <section className="profile-detail-section">
        <header><h2>ウォレット</h2>{ownerControls ? <label className="profile-wallet-visibility"><input type="checkbox" checked={wallets.every((item) => item.published)} disabled={busy} onChange={(event) => void toggleWallets(event.target.checked)} /><i aria-hidden="true" /><span>{wallets.every((item) => item.published) ? "公開" : "非公開"}</span></label> : null}</header>
        <div className="profile-wallet-list">{publicWallets.map((wallet) => <div key={`${wallet.network}:${wallet.address}`}><span>{wallet.network}</span><code>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</code></div>)}</div>
        {ownerControls ? <p className="profile-privacy-note">初期設定は非公開です。公開するとプロフィールと公開アドレスの関係が表示されます。</p> : null}
      </section> : null}
      <p className="profile-details-message" aria-live="polite">{message}</p>
    </div>
  );
}

export function ProfileSafetyMenu({
  targetProfileId,
  initialControl,
}: {
  targetProfileId: string;
  initialControl: { muted: boolean; blocked: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [control, setControl] = useState(initialControl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const updateControl = async (action: "mute" | "block", enabled: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/profile/safety", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetProfileId, action, enabled }) });
      const payload = await response.json() as { control?: { muted: boolean; blocked: boolean }; error?: string };
      if (!response.ok || !payload.control) throw new Error(payload.error ?? "設定を更新できませんでした。");
      setControl(payload.control);
      mirrorProfileControl(MUTED_PROFILES_KEY, targetProfileId, payload.control.muted);
      mirrorProfileControl(BLOCKED_PROFILES_KEY, targetProfileId, payload.control.blocked);
      window.dispatchEvent(new CustomEvent(PROFILE_CONTROL_EVENT));
      setMessage(action === "mute" ? (enabled ? "ミュートしました。" : "ミュートを解除しました。") : (enabled ? "ブロックしました。" : "ブロックを解除しました。"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "設定を更新できませんでした。"); }
    finally { setBusy(false); }
  };

  const report = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/profile/safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetProfileId, reason: form.get("reason"), details: form.get("details") }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "通報できませんでした。");
      setMessage("通報を受け付けました。"); setReportOpen(false); setOpen(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "通報できませんでした。"); }
    finally { setBusy(false); }
  };

  return <div className="profile-safety-menu"><button type="button" className="profile-safety-menu__toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="プロフィールの操作">•••</button>{open ? <div className="profile-safety-menu__panel"><button type="button" disabled={busy} onClick={() => void updateControl("mute", !control.muted)}>{control.muted ? "ミュートを解除" : "ミュート"}</button><button type="button" disabled={busy} onClick={() => void updateControl("block", !control.blocked)}>{control.blocked ? "ブロックを解除" : "ブロック"}</button><button type="button" onClick={() => setReportOpen((value) => !value)}>通報</button>{reportOpen ? <form onSubmit={report}><select name="reason" aria-label="通報理由" defaultValue="spam"><option value="spam">スパム</option><option value="harassment">嫌がらせ</option><option value="impersonation">なりすまし</option><option value="privacy">プライバシー</option><option value="other">その他</option></select><textarea name="details" maxLength={500} placeholder="状況を入力（任意）" /><button type="submit" disabled={busy}>送信</button></form> : null}</div> : null}<span className="profile-safety-menu__message" role="status">{message}</span></div>;
}
