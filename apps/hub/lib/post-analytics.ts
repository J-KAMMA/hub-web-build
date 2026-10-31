export const SOCIAL_POST_ANALYTICS_EVENTS = [
  "viewable_impression",
  "link_transition",
] as const;

export type SocialPostAnalyticsEvent = typeof SOCIAL_POST_ANALYTICS_EVENTS[number];

export type SocialPostAnalyticsPayload = {
  eventId: string;
  postId: string;
  eventType: SocialPostAnalyticsEvent;
};

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSocialPostAnalyticsPayload(value: unknown): SocialPostAnalyticsPayload | null {
  if (!value || typeof value !== "object") return null;
  const eventId = Reflect.get(value, "eventId");
  const postId = Reflect.get(value, "postId");
  const eventType = Reflect.get(value, "eventType");
  if (
    typeof eventId !== "string" ||
    !eventIdPattern.test(eventId) ||
    typeof postId !== "string" ||
    !identifierPattern.test(postId) ||
    !SOCIAL_POST_ANALYTICS_EVENTS.includes(eventType as SocialPostAnalyticsEvent)
  ) return null;
  return { eventId, postId, eventType: eventType as SocialPostAnalyticsEvent };
}

