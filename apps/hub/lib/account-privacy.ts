export type AccountArea =
  | "public_profile"
  | "market_transaction"
  | "identity"
  | "commerce"
  | "digital";

export type DisclosurePurpose =
  | "public_display"
  | "verified_purchase"
  | "shipping"
  | "job_application"
  | "vehicle_transaction"
  | "real_estate_application";

const PUBLIC_PROFILE_FIELDS = new Set(["displayName", "handle", "avatar", "bio"]);
const PROOF_ONLY_FIELDS = new Set(["verified", "verifiedAt", "verificationType"]);

export function mayExposeAccountField(area: AccountArea, purpose: DisclosurePurpose, field: string) {
  if (purpose === "public_display") return area === "public_profile" && PUBLIC_PROFILE_FIELDS.has(field);
  if (purpose === "verified_purchase") return area === "commerce" && PROOF_ONLY_FIELDS.has(field);
  if (purpose === "shipping") return area === "identity" && ["recipientName", "postalAddress"].includes(field);
  if (purpose === "job_application") return area === "identity" && ["applicationName", "selectedContact", "selectedCareer"].includes(field);
  if (purpose === "vehicle_transaction") return area === "identity" && ["contractName", "selectedContact"].includes(field);
  if (purpose === "real_estate_application") return area === "identity" && ["applicationName", "selectedContact", "screeningReference"].includes(field);
  return false;
}

export function accountAreaLabel(area: AccountArea) {
  return {
    public_profile: "プロフィール",
    market_transaction: "取引",
    identity: "本人・事業者確認",
    commerce: "支払いと売上",
    digital: "デジタルライブラリ",
  }[area];
}
