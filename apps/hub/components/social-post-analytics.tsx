"use client";

import { useEffect } from "react";

import type { SocialPostAnalyticsEvent } from "@/lib/post-analytics";

const postSelector = "[data-post-context-id]";
const trackedLinkSelector = [
  ".external-link-card",
  ".external-media-card a",
  ".external-image-card a",
  ".external-image-site-card a",
  ".hub-action-card a",
].join(",");

function eventStorageKey(postId: string, eventType: SocialPostAnalyticsEvent): string {
  return `hub.analytics.post.${eventType}.${postId}`;
}

function send(postId: string, eventType: SocialPostAnalyticsEvent): void {
  const storageKey = eventStorageKey(postId, eventType);
  if (window.sessionStorage.getItem(storageKey)) return;
  const payload = JSON.stringify({
    eventId: crypto.randomUUID(),
    postId,
    eventType,
  });
  const queued = navigator.sendBeacon(
    "/api/posts/analytics",
    new Blob([payload], { type: "application/json" }),
  );
  if (queued) window.sessionStorage.setItem(storageKey, "sent");
}

export function SocialPostAnalytics() {
  useEffect(() => {
    const timers = new Map<Element, number>();
    const observed = new WeakSet<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const existing = timers.get(entry.target);
        if (existing) {
          window.clearTimeout(existing);
          timers.delete(entry.target);
        }
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
        const timer = window.setTimeout(() => {
          const postId = (entry.target as HTMLElement).dataset.postContextId;
          if (postId) send(postId, "viewable_impression");
          timers.delete(entry.target);
        }, 1_000);
        timers.set(entry.target, timer);
      }
    }, { threshold: [0.5] });

    const observePosts = (root: ParentNode) => {
      const posts = root instanceof HTMLElement && root.matches(postSelector)
        ? [root]
        : [...root.querySelectorAll(postSelector)];
      for (const post of posts) {
        if (observed.has(post)) continue;
        observed.add(post);
        observer.observe(post);
      }
    };
    observePosts(document);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement) observePosts(node);
        }
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>(trackedLinkSelector);
      const post = link?.closest<HTMLElement>(postSelector);
      const postId = post?.dataset.postContextId;
      if (postId) send(postId, "link_transition");
    };
    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      observer.disconnect();
      mutations.disconnect();
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);
  return null;
}

