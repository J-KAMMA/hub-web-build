"use client";

import React, { useEffect, useState } from "react";

import {
  FOLLOW_STATE_EVENT,
  publishFollowState,
  type FollowStateEventDetail,
} from "@/lib/follow-client";
import { recordPersonalNodeEvent } from "@/lib/personal-node-local-keystore";

export function FollowToggleButton({
  initiallyFollowing,
  targetProfileId
}: {
  initiallyFollowing: boolean;
  targetProfileId: string;
}) {
  const [following, setFollowing] = useState(initiallyFollowing);
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const syncFollowState = (event: Event) => {
      const detail = (event as CustomEvent<FollowStateEventDetail>).detail;
      if (detail.targetProfileId === targetProfileId) setFollowing(detail.following);
    };
    window.addEventListener(FOLLOW_STATE_EVENT, syncFollowState);
    return () => window.removeEventListener(FOLLOW_STATE_EVENT, syncFollowState);
  }, [targetProfileId]);

  const toggleFollowing = async () => {
    if (isPending) return;
    const previous = following;
    const optimistic = !previous;
    setError("");
    setIsPending(true);
    setFollowing(optimistic);
    publishFollowState({
      targetProfileId,
      following: optimistic,
      followerDelta: optimistic ? 1 : -1,
    });

    try {
      const response = await fetch("/api/follows/toggle", {
        method: optimistic ? "PUT" : "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          target_profile_id: targetProfileId,
          active: optimistic
        })
      });
      const payload = (await response.json().catch(() => null)) as { following?: boolean; error?: string } | null;
      if (!response.ok || typeof payload?.following !== "boolean") {
        throw new Error(payload?.error ?? "フォロー状態の更新に失敗しました。");
      }
      if (payload.following !== optimistic) {
        setFollowing(payload.following);
        publishFollowState({
          targetProfileId,
          following: payload.following,
          followerDelta: payload.following ? 1 : -1,
        });
      }
      void recordPersonalNodeEvent(
        payload.following ? "hub.follow.create" : "hub.follow.delete",
        { targetProfileId },
      );
    } catch (followError) {
      setFollowing(previous);
      publishFollowState({
        targetProfileId,
        following: previous,
        followerDelta: previous ? 1 : -1,
      });
      setError(followError instanceof Error ? followError.message : "フォロー状態の更新に失敗しました。");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="inline-flex flex-col gap-2">
      <button
        type="button"
        className={`button profile-follow-button${following ? "" : " button--primary"}`}
        aria-pressed={following}
        disabled={isPending}
        onClick={() => void toggleFollowing()}
      >
        {isPending ? "更新中…" : following ? "フォロー中" : "フォロー"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
