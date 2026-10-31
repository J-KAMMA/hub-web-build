export type ConnectionAttempt = { id: number; zone: string };

/** Keeps only the newest explicit connection attempt active. */
export function createConnectionRetryGate() {
  let closed = false;
  let nextId = 0;
  let current: ConnectionAttempt | null = null;
  let connectingZone: string | null = null;

  return {
    start(zone: string): ConnectionAttempt | null {
      if (closed || connectingZone === zone) return null;
      const attempt = { id: ++nextId, zone };
      current = attempt;
      connectingZone = zone;
      return attempt;
    },
    isCurrent(attempt: ConnectionAttempt): boolean {
      return !closed && current?.id === attempt.id;
    },
    finish(attempt: ConnectionAttempt): void {
      if (current?.id === attempt.id) connectingZone = null;
    },
    zone(): string | null {
      return current?.zone ?? null;
    },
    dispose(): void {
      closed = true;
      connectingZone = null;
      current = null;
    },
  };
}
