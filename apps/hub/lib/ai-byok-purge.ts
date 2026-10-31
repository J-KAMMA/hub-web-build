// Web BYOK was removed (2026-10-15 owner decision): using one's own provider API key is Hub Desktop only.
// Hub never receives provider keys. This removes anything an earlier build could have left in the browser.
const LEGACY_BYOK_PREFIXES = ["hub.ai.byok", "hub.byok", "ai.byok", "byok"];

function matchesLegacyByokKey(key: string) {
  const lower = key.toLowerCase();
  return LEGACY_BYOK_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function purgeStorage(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && matchesLegacyByokKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function purgeLegacyByokKeys() {
  if (typeof window === "undefined") return;
  for (const read of [() => window.localStorage, () => window.sessionStorage]) {
    try { purgeStorage(read()); } catch { /* storage unavailable */ }
  }
  try {
    for (const entry of document.cookie.split(";")) {
      const name = entry.split("=")[0]?.trim();
      if (name && matchesLegacyByokKey(name)) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Strict`;
    }
  } catch { /* cookies unavailable */ }
  try {
    if (typeof indexedDB !== "undefined") {
      for (const name of ["hub.ai.byok", "hub.byok"]) indexedDB.deleteDatabase(name);
    }
  } catch { /* indexedDB unavailable */ }
}
