"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";

type SwitchProfile = {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  contextLabel: string;
};

export function AccountProfileSwitcher({
  currentProfile,
  collapsed,
}: {
  currentProfile: { id: string; handle: string; displayName: string; avatarUrl?: string };
  collapsed: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [profiles, setProfiles] = useState<SwitchProfile[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "switching" | "creating" | "failed">("idle");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!dialog.current?.open) return;
    const onCancel = () => setShowCreate(false);
    dialog.current.addEventListener("close", onCancel);
    return () => dialog.current?.removeEventListener("close", onCancel);
  }, []);

  const open = async () => {
    setState("loading");
    setError("");
    dialog.current?.showModal();
    try {
      const response = await fetch("/api/profiles/account", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { profiles: SwitchProfile[]; canCreate: boolean };
      setProfiles(payload.profiles);
      setCanCreate(payload.canCreate);
      setState("idle");
    } catch {
      setError("プロフィールを読み込めませんでした。");
      setState("failed");
    }
  };

  const switchTo = async (profile: SwitchProfile) => {
    if (state === "switching") return;
    const profilePath = `/profile/${encodeURIComponent(profile.handle)}`;
    if (profile.id === currentProfile.id) {
      dialog.current?.close();
      window.location.assign(profilePath);
      return;
    }
    setState("switching");
    setError("");
    try {
      const response = await fetch("/api/profiles/account", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      if (!response.ok) throw new Error();
      window.location.assign(profilePath);
    } catch {
      setError("切り替えられませんでした。現在のプロフィールを維持しています。");
      setState("failed");
    }
  };

  const create = async (formData: FormData) => {
    setState("creating");
    setError("");
    try {
      const response = await fetch("/api/profiles/account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(formData)),
      });
      const payload = await response.json() as { profile?: SwitchProfile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error);
      setProfiles((current) => [...current, payload.profile!]);
      setShowCreate(false);
      setState("idle");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "handle_unavailable"
        ? "そのユーザー名は使用されています。" : "プロフィールを作成できませんでした。");
      setState("failed");
    }
  };

  return <>
    <button
      type="button"
      className="account-profile-switcher__trigger"
      onClick={() => void open()}
      aria-label={`${currentProfile.displayName}。プロフィールを切り替える`}
      title={collapsed ? currentProfile.displayName : undefined}
    >
      <span className="sidebar__nav-icon sidebar__profile-avatar">
        {currentProfile.avatarUrl
          ? <img src={currentProfile.avatarUrl} alt="" />
          : <span aria-hidden="true">{currentProfile.displayName.slice(0, 1)}</span>}
      </span>
      {!collapsed && <span className="account-profile-switcher__identity">
        <strong>{currentProfile.displayName}</strong>
        <small>@{currentProfile.handle}</small>
      </span>}
    </button>
    <dialog ref={dialog} className="account-profile-switcher">
      <header>
        <div><strong>プロフィールを切り替える</strong><small>投稿・フォロー・通知はプロフィールごとに分かれます</small></div>
        <button type="button" className="hub-icon-button" onClick={() => dialog.current?.close()} aria-label="閉じる"><X /></button>
      </header>
      <div className="account-profile-switcher__list" aria-live="polite">
        {state === "loading" ? <p>読み込み中…</p> : profiles.map((profile) =>
          <button type="button" key={profile.id} onClick={() => void switchTo(profile)} disabled={state === "switching"}>
            <span className="sidebar__profile-avatar">
              {profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.displayName.slice(0, 1)}
            </span>
            <span><strong>{profile.displayName}</strong><small>@{profile.handle}{profile.contextLabel ? ` · ${profile.contextLabel}` : ""}</small></span>
            {profile.id === currentProfile.id && <Check aria-label="使用中" />}
          </button>)}
      </div>
      {error && <p className="account-profile-switcher__error" role="alert">{error}</p>}
      {showCreate ? <form action={(formData) => void create(formData)}>
        <label>表示名<input name="displayName" required maxLength={80} /></label>
        <label>ユーザー名<input name="handle" required minLength={3} maxLength={32} pattern="[a-z0-9_]+" /></label>
        <label>自分用のラベル<input name="contextLabel" maxLength={40} placeholder="仕事、趣味など（公開されません）" /></label>
        <div><button type="button" onClick={() => setShowCreate(false)}>キャンセル</button><button type="submit" disabled={state === "creating"}>{state === "creating" ? "作成中…" : "作成する"}</button></div>
      </form> : canCreate && profiles.length < 5
        ? <button type="button" className="account-profile-switcher__create" onClick={() => setShowCreate(true)}><Plus />プロフィールを追加</button>
        : null}
    </dialog>
  </>;
}
