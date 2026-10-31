export function normalizeLastReadPostNo(lastReadPostNo: number, postCount: number): number {
  if (!Number.isFinite(lastReadPostNo) || !Number.isFinite(postCount)) return 0;
  return Math.max(0, Math.min(Math.max(0, Math.floor(postCount)), Math.floor(lastReadPostNo)));
}

export function getThreadUnreadState(lastReadPostNo: number, postCount: number) {
  const normalizedLastRead = normalizeLastReadPostNo(lastReadPostNo, postCount);
  const normalizedPostCount = Math.max(0, Math.floor(postCount));
  if (normalizedLastRead === 0 || normalizedLastRead >= normalizedPostCount) {
    return { firstUnreadPostNo: null, unreadCount: 0 };
  }
  return {
    firstUnreadPostNo: normalizedLastRead + 1,
    unreadCount: normalizedPostCount - normalizedLastRead
  };
}
