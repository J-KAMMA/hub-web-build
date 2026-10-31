"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { useMemo, useState, useTransition } from "react";

import type {
  OnboardingCommunityOption,
  OnboardingPageData,
  OnboardingProfileOption
} from "@/lib/server/onboarding-page-data";
import { recordHubInterests } from "@/lib/hub-interest-profile";
import { safeHubReturnPath } from "@/lib/auth-return-path";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";
import { AsyncActionButton } from "./async-action-button";

import styles from "./onboarding-form.module.css";

function toggleSelection(values: string[], value: string, maximum: number) {
  if (values.includes(value)) return values.filter((entry) => entry !== value);
  if (values.length >= maximum) return values;
  return [...values, value];
}

function ProfileOption({ profile, selected, onToggle }: {
  profile: OnboardingProfileOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return <button type="button" className={`${styles.optionCard} ${selected ? styles.selected : ""}`} aria-pressed={selected} onClick={onToggle}>
    <span className={styles.avatar}>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" /> : profile.displayName.slice(0, 1)}</span>
    <span className={styles.optionCopy}>
      <strong>{profile.displayName}</strong>
      <small>@{profile.handle} · {profile.followerCount}フォロワー</small>
      <span>{profile.bio}</span>
    </span>
    <i aria-hidden="true">{selected ? "✓" : "+"}</i>
  </button>;
}

function CommunityOption({ community, selected, onToggle }: {
  community: OnboardingCommunityOption;
  selected: boolean;
  onToggle: () => void;
}) {
  return <button type="button" className={`${styles.optionCard} ${selected ? styles.selected : ""}`} aria-pressed={selected} onClick={onToggle}>
    <span className={`${styles.avatar} ${styles.communityAvatar}`}>{community.imageUrl ? <img src={community.imageUrl} alt="" /> : community.name.slice(0, 1)}</span>
    <span className={styles.optionCopy}>
      <strong>{community.name}</strong>
      <small>{community.category || "コミュニティ"} · {community.memberCount}人</small>
      <span>{community.description}</span>
    </span>
    <i aria-hidden="true">{selected ? "✓" : "+"}</i>
  </button>;
}

export function OnboardingForm({ data, returnTo }: { data: OnboardingPageData; returnTo?: string }) {
  const router = useRouter();
  const surface = useHubUiSurface();
  const resumeTo = returnTo === undefined ? null : hubSurfacePath(surface, safeHubReturnPath(returnTo));
  const home = hubSurfacePath(surface, "/");
  const [interestIds, setInterestIds] = useState<string[]>(data.selectedInterests);
  const [profileIds, setProfileIds] = useState<string[]>(data.profiles.filter((profile) => profile.selected).map((profile) => profile.id));
  const [communityIds, setCommunityIds] = useState<string[]>(data.communities.filter((community) => community.selected).map((community) => community.id));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const totalSelections = useMemo(() => interestIds.length + profileIds.length + communityIds.length, [communityIds.length, interestIds.length, profileIds.length]);

  const submit = () => {
    if (interestIds.length === 0) {
      setError("興味のある分野を1つ以上選んでください。");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interests: interestIds, profileIds, communityIds })
        });
        const payload = await response.json().catch(() => null) as { error?: string; next?: string } | null;
        if (!response.ok) {
          setError(payload?.error ?? "選択内容を保存できませんでした。");
          return;
        }
        recordHubInterests("onboarding", data.interests.filter((interest) => interestIds.includes(interest.id)).flatMap((interest) => [interest.id, interest.label]), 4);
        localStorage.setItem("hub.home.feed", "following");
        const suggested = typeof payload?.next === "string" ? payload.next : "/?feed=following";
        router.push(resumeTo ?? hubSurfacePath(surface, safeHubReturnPath(suggested)));
        router.refresh();
      } catch {
        setError("通信できませんでした。もう一度お試しください。");
      }
    });
  };

  return <section className={styles.page}>
    <header className={styles.hero}>
      <h1 className={styles.title}>Hubをはじめる</h1>
      <p>興味・人・コミュニティを選ぶと、あなた向けのタイムラインができます。</p>
    </header>

    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span>01</span><h2>興味のある分野</h2></div><small>1つ以上・最大8つ</small></div>
      <div className={styles.interestGrid}>
        {data.interests.map((interest) => {
          const selected = interestIds.includes(interest.id);
          return <button key={interest.id} type="button" className={`${styles.interest} ${selected ? styles.selected : ""}`} aria-pressed={selected} onClick={() => setInterestIds((current) => toggleSelection(current, interest.id, data.interests.length))}>
            <strong>{interest.label}</strong><span>{interest.description}</span><i aria-hidden="true">{selected ? "✓" : "+"}</i>
          </button>;
        })}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span>02</span><h2>おすすめユーザー</h2></div><small>最大5人</small></div>
      <div className={styles.optionGrid}>
        {data.profiles.map((profile) => <ProfileOption key={profile.id} profile={profile} selected={profileIds.includes(profile.id)} onToggle={() => setProfileIds((current) => toggleSelection(current, profile.id, 5))} />)}
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeading}><div><span>03</span><h2>おすすめコミュニティ</h2></div><small>最大5件</small></div>
      <div className={styles.optionGrid}>
        {data.communities.map((community) => <CommunityOption key={community.id} community={community} selected={communityIds.includes(community.id)} onToggle={() => setCommunityIds((current) => toggleSelection(current, community.id, 5))} />)}
      </div>
    </section>

    <footer className={styles.footer}>
      <span>{totalSelections}件を選択中</span>
      {error ? <p role="alert">{error}</p> : null}
      <div><a href={resumeTo ?? home}>あとで設定する</a><AsyncActionButton type="button" onClick={submit} disabled={interestIds.length === 0} pending={pending} pendingLabel="保存中…">この内容で始める</AsyncActionButton></div>
    </footer>
  </section>;
}
