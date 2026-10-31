export type LocalOrchestrationModel = { id: string; name: string; runtime: string };

export type LocalOrchestrationStep = {
  id: "plan" | "solve" | "challenge" | "verify" | "finalize";
  label: string;
  model: LocalOrchestrationModel;
  output: string;
};

type RunOptions = {
  request: string;
  models: LocalOrchestrationModel[];
  call(model: LocalOrchestrationModel, prompt: string): Promise<string>;
  onStep?(step: LocalOrchestrationStep): void;
  maxPromptCharacters?: number;
};

const ROLES = ["plan", "solve", "challenge", "verify", "finalize"] as const;
const LABELS: Record<(typeof ROLES)[number], string> = {
  plan: "計画",
  solve: "実行案",
  challenge: "反証",
  verify: "検証",
  finalize: "最終統合",
};

export function assignLocalOrchestrationModels(models: LocalOrchestrationModel[]): LocalOrchestrationModel[] {
  if (models.length === 0) return [];
  return ROLES.map((_, index) => models[index % models.length]);
}

export async function runLocalOrchestration(options: RunOptions): Promise<{ output: string; steps: LocalOrchestrationStep[] }> {
  if (options.models.length === 0) throw new Error("local_models_unavailable");
  const limit = Math.max(2_000, Math.min(options.maxPromptCharacters ?? 8_000, 8_000));
  const assigned = assignLocalOrchestrationModels(options.models);
  const steps: LocalOrchestrationStep[] = [];

  const run = async (index: number, instruction: string, context = "") => {
    const id = ROLES[index];
    const model = assigned[index];
    const prompt = [
      "あなたはPC内だけで動くAIチームの一員です。外部サービスの利用を提案せず、与えられた情報だけで作業してください。",
      `担当: ${LABELS[id]}`,
      instruction,
      `依頼:\n${options.request}`,
      context ? `前工程:\n${context}` : "",
    ].filter(Boolean).join("\n\n").slice(-limit);
    const output = await options.call(model, prompt);
    const step = { id, label: LABELS[id], model, output } satisfies LocalOrchestrationStep;
    steps.push(step);
    options.onStep?.(step);
    return output;
  };

  const plan = await run(0, "依頼を完了条件、制約、手順に分解してください。曖昧な点は安全な仮定として明記してください。");
  const solution = await run(1, "計画に従って具体的な成果物または回答案を作ってください。", plan);
  const challenge = await run(2, "回答案の誤り、抜け、危険な仮定、実行不能な点を厳しく指摘し、修正案を示してください。", solution);
  const verification = await run(3, "依頼、計画、回答案、反証を照合し、完了条件ごとに合否を判定してください。推測は推測と明示してください。", [plan, solution, challenge].join("\n\n"));
  const output = await run(4, "検証結果を反映し、依頼への最終回答だけを作ってください。工程説明や内部役割名は出さないでください。", [solution, challenge, verification].join("\n\n"));
  return { output, steps };
}
