import type { ThreadSummary } from "@/lib/domain";

export const THREAD_TYPES = ["question", "information", "discussion", "recruitment", "issue", "chat"] as const;
export type ThreadType = typeof THREAD_TYPES[number];

export const THREAD_TYPE_LABELS: Record<ThreadType, string> = {
  question: "質問",
  information: "情報共有",
  discussion: "議題整理",
  recruitment: "募集",
  issue: "不具合報告",
  chat: "雑談",
};

export function isThreadType(value: string): value is ThreadType {
  return (THREAD_TYPES as readonly string[]).includes(value);
}

export function getThreadType(thread: Pick<ThreadSummary, "threadType" | "bestAnswerPostId">): ThreadType {
  return thread.threadType ?? (thread.bestAnswerPostId ? "question" : "chat");
}
