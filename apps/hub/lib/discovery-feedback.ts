export const DISCOVERY_FEEDBACK_KEY = "hub.discovery-hidden.v1";
export const DISCOVERY_FEEDBACK_EVENT = "hub:discovery-feedback";
const LIMIT = 500;

export function resetDiscoveryFeedback(kind: "items" | "authors", storage: Pick<Storage, "getItem" | "setItem">) {
  // A reset must not replace unreadable preferences with an empty set.
  const stored: unknown = JSON.parse(storage.getItem(DISCOVERY_FEEDBACK_KEY) ?? "[]");
  if (!Array.isArray(stored) || stored.some(key => typeof key !== "string")) throw new Error("Unreadable discovery preferences");
  const next = (stored as string[]).filter(key => {
    const author = /^[^:]+:author:/.test(key);
    return kind === "authors" ? !author : author;
  });
  storage.setItem(DISCOVERY_FEEDBACK_KEY, JSON.stringify(next));
  return next;
}

export function readDiscoveryHidden(storage: Pick<Storage, "getItem">, strict = false): string[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(DISCOVERY_FEEDBACK_KEY) ?? "[]");
    if(strict&&(!Array.isArray(value)||value.some(id=>typeof id!=="string")))throw new Error("Unreadable discovery preferences");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 250))].slice(-LIMIT) : [];
  } catch(error) { if(strict)throw error;return []; }
}

export function setDiscoveryHidden(key: string, hidden: boolean, storage: Pick<Storage, "getItem" | "setItem">) {
  if (!key || key.length > 250) throw new Error("Invalid discovery key");
  const next = readDiscoveryHidden(storage,true).filter((id) => id !== key);
  if (hidden) next.push(key);
  const bounded = next.slice(-LIMIT);
  storage.setItem(DISCOVERY_FEEDBACK_KEY, JSON.stringify(bounded));
  return bounded;
}
