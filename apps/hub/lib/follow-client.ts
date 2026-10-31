export const FOLLOW_STATE_EVENT = "hub:follow-state-changed";

export type FollowStateEventDetail = {
  targetProfileId: string;
  following: boolean;
  followerDelta: -1 | 0 | 1;
};

export function publishFollowState(detail: FollowStateEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FollowStateEventDetail>(FOLLOW_STATE_EVENT, { detail }));
}
