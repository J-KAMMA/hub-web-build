export const REPOST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export class RepostCooldownError extends Error {
  readonly retryAt: string;

  constructor(retryAt: string) {
    super("この投稿は24時間に1回リポストできます。");
    this.name = "RepostCooldownError";
    this.retryAt = retryAt;
  }
}

export function repostRetryAt(previousRepostAt: string) {
  return new Date(new Date(previousRepostAt).getTime() + REPOST_COOLDOWN_MS).toISOString();
}
