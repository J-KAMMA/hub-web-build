"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/v2/ui/avatar";
import { V2Button } from "@/components/v2/v2-button";
import type { Profile } from "@/lib/domain";

/*
 * 連絡先。既存の contacts-directory.tsx から機能だけを抜いた:
 * 名前・ユーザー名・自己紹介での絞り込み、名前順、人数、プロフィールへ、会話を始める
 * （既存と同じ POST /api/messages/start → /v2/messages?conversation=）。
 */
export function V2Contacts({ currentProfileId, profiles, japanese }: { currentProfileId: string; profiles: Profile[]; japanese: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    return profiles
      .filter((profile) => profile.id !== currentProfileId)
      .filter((profile) => !normalized || [profile.displayName, profile.handle, profile.bio].some((value) => (value ?? "").toLocaleLowerCase("ja").includes(normalized)))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
  }, [currentProfileId, profiles, query]);

  const startMessage = async (profile: Profile) => {
    if (busy) return;
    setBusy(profile.id);
    try {
      const response = await fetch("/api/messages/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target_profile_id: profile.id }) });
      const payload = await response.json().catch(() => ({})) as { conversation_id?: string; error?: string };
      if (!response.ok || !payload.conversation_id) throw new Error(payload.error || String(response.status));
      router.push(`/v2/messages?conversation=${encodeURIComponent(payload.conversation_id)}`);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : (japanese ? "会話を始められませんでした。" : "Could not start a conversation."));
      setBusy(null);
    }
  };

  return (
    <div className="v2-contacts">
      <div className="v2-search__form" role="search">
        <input type="search" value={query} maxLength={80} placeholder={japanese ? "名前かユーザー名で絞り込む" : "Filter by name or handle"} aria-label={japanese ? "連絡先を絞り込む" : "Filter contacts"} onChange={(event) => setQuery(event.target.value)} />
        {query ? <V2Button variant="text" label={japanese ? "消す" : "Clear"} onClick={() => setQuery("")} /> : null}
      </div>
      <p className="v2-contacts__count">{japanese ? `${contacts.length}人` : `${contacts.length} people`}</p>
      {error ? <p className="v2-error" role="alert">{error}</p> : null}
      {contacts.length ? (
        <ul className="v2-people">
          {contacts.map((profile) => (
            <li key={profile.id} className="v2-person v2-person--with-action">
              <Avatar name={profile.displayName} src={profile.avatarUrl} size={48} />
              <Link className="v2-person__body" href={`/v2/profile/${encodeURIComponent(profile.handle)}`}>
                <span className="v2-post__name">{profile.displayName}</span>
                <span className="v2-post__handle">@{profile.handle}</span>
                {profile.bio ? <span className="v2-aside__item-body">{profile.bio}</span> : null}
              </Link>
              <V2Button icon="message" label={japanese ? `${profile.displayName} にメッセージ` : `Message ${profile.displayName}`} disabled={busy === profile.id} onClick={() => void startMessage(profile)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="v2-note">{query ? (japanese ? "一致する連絡先がありません。" : "No contacts matched.") : (japanese ? "連絡先はまだありません。検索で相手を見つけてフォローすると、ここから会話を始められます。" : "No contacts yet. Find and follow people to start conversations here.")}</p>
      )}
    </div>
  );
}
