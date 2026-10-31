export interface PseudonymousProfileUpdate {
  displayName: string;
  bio: string;
}

const ALLOWED_PROFILE_FIELDS = new Set(["displayName", "bio"]);

export function parsePseudonymousProfileUpdate(input: unknown): PseudonymousProfileUpdate {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Profile update must be an object.");
  }

  const record = input as Record<string, unknown>;
  const unsupportedFields = Object.keys(record).filter(
    (field) => !ALLOWED_PROFILE_FIELDS.has(field)
  );

  if (unsupportedFields.length > 0) {
    throw new Error(`Unsupported profile fields: ${unsupportedFields.join(", ")}.`);
  }

  if (typeof record.displayName !== "string" || !record.displayName.trim()) {
    throw new Error("displayName is required.");
  }

  if (typeof record.bio !== "string") {
    throw new Error("bio is required.");
  }

  if (record.displayName.length > 40) {
    throw new Error("displayName must be 40 characters or fewer.");
  }

  if (record.bio.length > 180) {
    throw new Error("bio must be 180 characters or fewer.");
  }

  return {
    displayName: record.displayName.trim(),
    bio: record.bio
  };
}
