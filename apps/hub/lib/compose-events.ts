/*
 * The composer lives inside the timeline, but the control that opens it sits
 * in the shell's sidebar, which is a sibling rather than an ancestor. A window
 * event keeps the two from needing a shared provider for one boolean.
 */

export const HUB_COMPOSE_OPEN_EVENT = "hub:compose-open";

/* The hash the sidebar navigates to when the timeline is not mounted yet. */
export const HUB_COMPOSE_HASH = "#home-compose";

export function requestHubCompose() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HUB_COMPOSE_OPEN_EVENT));
}
