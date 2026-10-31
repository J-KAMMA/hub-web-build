export type TrustRequestReviewAction = "start_review" | "accept" | "reject";

export type TrustRequestReviewInput = {
  id: string;
  action: TrustRequestReviewAction;
  note: string;
};

export function parseTrustRequestReviewInput(value: unknown): TrustRequestReviewInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const action = typeof input.action === "string" ? input.action : "";
  const note = typeof input.note === "string"
    ? input.note.replace(/\s+/g, " ").trim()
    : "";

  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (!["start_review", "accept", "reject"].includes(action)) return null;
  if (note.length > 1000) return null;
  if (action !== "start_review" && note.length < 5) return null;

  return { id, action: action as TrustRequestReviewAction, note };
}
