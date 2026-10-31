/** Pure helpers for the Hub games list and detail screens (no server imports, safe in client components). */

const PLATFORM_BADGES: Record<string, string> = {
  PC: "PC",
  Windows: "Windows",
  macOS: "macOS",
  Linux: "Linux",
  "PlayStation 5": "PS5",
  "PlayStation 4": "PS4",
  "Xbox Series X|S": "Xbox Series",
  "Xbox One": "Xbox One",
  "Nintendo Switch": "Switch",
  iOS: "iOS",
  Android: "Android",
};

/** Short label for a platform badge. Unknown names are shown as given (trimmed to 16 characters). */
export function gamePlatformBadge(name: string): string {
  if (Object.hasOwn(PLATFORM_BADGES, name)) return PLATFORM_BADGES[name];
  const trimmed = name.trim();
  return trimmed.length > 16 ? `${trimmed.slice(0, 15)}…` : trimmed;
}

/** "2026-10-18" or a full ISO time -> "2026年10月18日" / "Oct 18, 2026". Returns null for anything unparseable. */
export function formatGameReleaseDate(value: string | null | undefined, japanese: boolean): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return /^\d{4}$/.test(value) ? value : null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  if (japanese) return `${year}年${Number(month)}月${Number(day)}日`;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
