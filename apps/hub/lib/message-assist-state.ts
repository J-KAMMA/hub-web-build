export type MessageCompositionMode = "direct" | "assist";
export type MessageAssistAction = "clarify" | "soften" | "shorten";

export type MessageAssistState =
  | { status: "idle" }
  | { status: "generating"; requestId: string; source: string; action: MessageAssistAction }
  | {
      status: "preview";
      requestId: string;
      source: string;
      candidate: string;
      action: MessageAssistAction;
    }
  | { status: "error"; message: string };

export type MessageAssistEvent =
  | { type: "started"; requestId: string; source: string; action: MessageAssistAction }
  | { type: "succeeded"; requestId: string; candidate: string }
  | { type: "failed"; requestId: string; message: string }
  | { type: "source_changed" }
  | { type: "candidate_dismissed" };

export const initialMessageAssistState: MessageAssistState = { status: "idle" };

export function messageAssistReducer(
  state: MessageAssistState,
  event: MessageAssistEvent,
): MessageAssistState {
  switch (event.type) {
    case "started":
      return {
        status: "generating",
        requestId: event.requestId,
        source: event.source,
        action: event.action,
      };
    case "succeeded":
      if (state.status !== "generating" || state.requestId !== event.requestId) return state;
      return {
        status: "preview",
        requestId: state.requestId,
        source: state.source,
        candidate: event.candidate,
        action: state.action,
      };
    case "failed":
      if (state.status !== "generating" || state.requestId !== event.requestId) return state;
      return { status: "error", message: event.message };
    case "source_changed":
    case "candidate_dismissed":
      return initialMessageAssistState;
  }
}

type LocalLanguageModelSession = {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
};

type LocalLanguageModelApi = {
  create(options: { systemPrompt: string }): Promise<LocalLanguageModelSession>;
};

const ACTION_INSTRUCTIONS: Record<MessageAssistAction, string> = {
  clarify: "意味と事実を変えず、読み手が理解しやすい日本語に整えてください。",
  soften: "要求と事実を変えず、相手への配慮が伝わる穏やかな日本語に整えてください。",
  shorten: "重要な意味と条件を残し、簡潔な日本語にしてください。",
};

export async function generateLocalMessageCandidate(
  source: string,
  action: MessageAssistAction,
): Promise<string> {
  const languageModel = (
    globalThis as typeof globalThis & { LanguageModel?: LocalLanguageModelApi }
  ).LanguageModel;
  if (!languageModel) {
    throw new Error("この端末ではローカルAIを利用できません。Directならそのまま送信できます。");
  }

  const session = await languageModel.create({
    systemPrompt:
      "あなたは私信の編集補助です。新しい事実、約束、日付、金額、感情、権限を追加せず、原文の意味を保ってください。候補文だけを返してください。",
  });

  try {
    const candidate = (
      await session.prompt(`${ACTION_INSTRUCTIONS[action]}\n\n原文:\n${source}`)
    ).trim();
    if (!candidate) throw new Error("候補を生成できませんでした。");
    if (candidate.length > 280) {
      throw new Error("候補が長すぎます。短くしてからもう一度お試しください。");
    }
    return candidate;
  } finally {
    session.destroy?.();
  }
}
