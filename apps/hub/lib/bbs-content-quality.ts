export const BBS_LIMITS = {
  titleMin: 8,
  titleMax: 100,
  threadBodyMin: 30,
  bodyMax: 4000,
  replyBodyMin: 2,
  displayNameMax: 40
} as const;

export type BbsIdentityMode = "anonymous" | "named" | "account";

export function validateThreadContent(input: { title?: string; body?: string }): string | null {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";

  if (!title || !body) return "タイトルと本文を入力してください。";
  if (title.length < BBS_LIMITS.titleMin) {
    return `タイトルは${BBS_LIMITS.titleMin}文字以上で入力してください。`;
  }
  if (title.length > BBS_LIMITS.titleMax) {
    return `タイトルは${BBS_LIMITS.titleMax}文字以内で入力してください。`;
  }
  if (body.length < BBS_LIMITS.threadBodyMin) {
    return `本文は${BBS_LIMITS.threadBodyMin}文字以上で、背景や知りたいことを添えてください。`;
  }
  if (body.length > BBS_LIMITS.bodyMax) {
    return `本文は${BBS_LIMITS.bodyMax}文字以内で入力してください。`;
  }
  return null;
}

export function validateReplyContent(body?: string): string | null {
  const value = body?.trim() ?? "";
  if (!value) return "本文を入力してください。";
  if (value.length < BBS_LIMITS.replyBodyMin) {
    return `返信は${BBS_LIMITS.replyBodyMin}文字以上で入力してください。`;
  }
  if (value.length > BBS_LIMITS.bodyMax) {
    return `返信は${BBS_LIMITS.bodyMax}文字以内で入力してください。`;
  }
  return null;
}

export function validateIdentity(
  mode: unknown,
  displayName?: string,
  allowed: readonly BbsIdentityMode[] = ["anonymous", "named", "account"]
): string | null {
  if (typeof mode !== "string" || !allowed.includes(mode as BbsIdentityMode)) {
    return "投稿者の種類が正しくありません。";
  }
  if (mode === "named" && !displayName?.trim()) return "表示名を入力してください。";
  if ((displayName?.trim().length ?? 0) > BBS_LIMITS.displayNameMax) {
    return `表示名は${BBS_LIMITS.displayNameMax}文字以内で入力してください。`;
  }
  return null;
}
