export function getThreadAnonymousLabel(threadId: string, authorProfileId: string): string {
  let hash = 0x811c9dc5;
  const input = `${threadId}\u0000${authorProfileId}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `匿名 ${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 4)}`;
}
