import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

type Question = { id: string; prompt: string; required: number };

export async function getCommunityOnboarding(database:D1Database,communityId:string,viewerId:string|null){
  return (await import('./community-join')).readCommunityJoin(database,communityId,viewerId);
}

export async function loadCommunityOnboardingContent(database:D1Database,communityId:string){
  const [rules, questions] = await Promise.all([
    database.prepare(`SELECT id, title, body, required FROM community_rules
      WHERE community_id = ? ORDER BY position, created_at, id`).bind(communityId).all<{ id: string; title: string; body: string; required: number }>(),
    database.prepare(`SELECT id, prompt, required FROM community_onboarding_questions
      WHERE community_id = ? ORDER BY position, created_at, id`).bind(communityId).all<Question>(),
  ]);
  return { rules: rules.results, questions: questions.results };
}

export function onboardingAnswers(payload: unknown, questions: Question[], requireConsent=true) {
  if (!payload || typeof payload !== "object" || !("acceptedRules" in payload) || (requireConsent && payload.acceptedRules !== true)) {
    throw new Error("コミュニティルールへの同意が必要です。");
  }
  const input = "answers" in payload ? payload.answers : [];
  if (!Array.isArray(input) || input.length > 20) throw new Error("参加質問の回答は20件以内で指定してください。");
  const known = new Set(questions.map(question => question.id));
  const answers = new Map<string, string>();
  for (const item of input) {
    if (!item || typeof item.questionId !== "string" || typeof item.answer !== "string"
      || !known.has(item.questionId) || answers.has(item.questionId)) throw new Error("参加質問の指定が正しくありません。");
    if(item.answer.length>1000||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(item.answer))throw new Error('回答の文字数または文字が正しくありません。');
    const answer = item.answer.normalize("NFKC").trim();
    if (answer.length > 1000) throw new Error("回答は1000文字以内で入力してください。");
    answers.set(item.questionId, answer);
  }
  if (questions.some(question => question.required && !answers.get(question.id))) throw new Error("必須の参加質問に回答してください。");
  return answers;
}

export async function completeCommunityOnboarding(database:D1Database,actor:Profile,communityId:string,payload:unknown){
  return (await import('./community-join')).completeCommunityJoin(database,actor,communityId,payload);
}
