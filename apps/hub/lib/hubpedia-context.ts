export const HUBPEDIA_CONTEXT_EVENT = "hub:open-hubpedia-context";

export type HubpediaContextDetail = {
  content: string;
  targetId: string;
  targetType: "social_post" | "thread_post" | "community_message";
};

export function openHubpediaContext(detail: HubpediaContextDetail) {
  window.dispatchEvent(new CustomEvent<HubpediaContextDetail>(HUBPEDIA_CONTEXT_EVENT, { detail }));
}
