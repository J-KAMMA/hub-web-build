export type AiProviderId = "openai" | "anthropic" | "gemini" | "grok" | "deepseek" | "mistral" | "perplexity" | "kimi" | "qwen" | "glm" | "minimax" | "cohere";

type Capability = "reasoning" | "coding" | "longContext" | "multilingual" | "groundedResearch" | "writing" | "enterprise" | "agentic" | "social" | "speed" | "reliability";
export type AiRequiredCapability = "groundedSearch" | "imageGeneration" | "videoGeneration" | "musicGeneration" | "localCodeExecution";

export type AiRoutingProvider = {
  id: AiProviderId;
  priceUsd?: string | number;
  available?: boolean;
  capabilities?: AiRequiredCapability[];
};

export type AiProviderTelemetry = {
  sampleCount: number;
  successRate?: number;
  latencyScore?: number;
};

export type AiRoutingDecision = {
  providerId: AiProviderId;
  score: number;
  confidence: number;
  reasons: string[];
  ranking: Array<{ providerId: AiProviderId; score: number }>;
  requiredCapabilities: AiRequiredCapability[];
  missingCapabilities: AiRequiredCapability[];
};

type Profile = Record<Capability, number>;

// Calibrated priors, not live benchmark values. Runtime telemetry is blended in as samples accumulate.
const PROFILES: Record<AiProviderId, Profile> = {
  openai:     { reasoning: .94, coding: .94, longContext: .82, multilingual: .86, groundedResearch: .20, writing: .90, enterprise: .86, agentic: .95, social: .20, speed: .72, reliability: .92 },
  anthropic:  { reasoning: .95, coding: .92, longContext: .96, multilingual: .82, groundedResearch: .18, writing: .97, enterprise: .91, agentic: .93, social: .15, speed: .62, reliability: .93 },
  gemini:     { reasoning: .90, coding: .88, longContext: .94, multilingual: .96, groundedResearch: .22, writing: .86, enterprise: .84, agentic: .88, social: .18, speed: .93, reliability: .88 },
  grok:       { reasoning: .91, coding: .91, longContext: .82, multilingual: .78, groundedResearch: .30, writing: .82, enterprise: .72, agentic: .86, social: 1.00, speed: .74, reliability: .82 },
  deepseek:   { reasoning: .92, coding: .98, longContext: .80, multilingual: .79, groundedResearch: .12, writing: .76, enterprise: .72, agentic: .87, social: .10, speed: .88, reliability: .82 },
  mistral:    { reasoning: .84, coding: .84, longContext: .78, multilingual: .94, groundedResearch: .12, writing: .87, enterprise: .84, agentic: .78, social: .10, speed: .84, reliability: .85 },
  perplexity: { reasoning: .83, coding: .70, longContext: .74, multilingual: .81, groundedResearch: 1.00, writing: .78, enterprise: .76, agentic: .74, social: .72, speed: .78, reliability: .87 },
  kimi:       { reasoning: .94, coding: .90, longContext: 1.00, multilingual: .88, groundedResearch: .16, writing: .88, enterprise: .84, agentic: .91, social: .12, speed: .70, reliability: .84 },
  qwen:       { reasoning: .91, coding: .92, longContext: .93, multilingual: .98, groundedResearch: .14, writing: .86, enterprise: .82, agentic: .90, social: .12, speed: .82, reliability: .84 },
  glm:        { reasoning: .92, coding: .95, longContext: .86, multilingual: .88, groundedResearch: .14, writing: .82, enterprise: .81, agentic: 1.00, social: .12, speed: .78, reliability: .82 },
  minimax:    { reasoning: .86, coding: .84, longContext: .87, multilingual: .86, groundedResearch: .12, writing: .82, enterprise: .76, agentic: .83, social: .10, speed: .96, reliability: .80 },
  cohere:     { reasoning: .80, coding: .73, longContext: .84, multilingual: .86, groundedResearch: .26, writing: .84, enterprise: 1.00, agentic: .76, social: .08, speed: .82, reliability: .90 }
};

const LABELS: Record<Capability, string> = {
  reasoning: "複雑な推論",
  coding: "コード",
  longContext: "長文理解",
  multilingual: "多言語",
  groundedResearch: "検索・出典",
  writing: "文章品質",
  enterprise: "業務文書",
  agentic: "ツール実行",
  social: "Xの話題",
  speed: "応答速度",
  reliability: "安定性"
};

const FALLBACK_ORDER: AiProviderId[] = ["openai", "gemini", "anthropic", "kimi", "qwen", "glm", "minimax", "cohere", "grok", "deepseek", "mistral", "perplexity"];
const PROVIDER_IDS = new Set<AiProviderId>(FALLBACK_ORDER);
const EXECUTION_CAPABILITIES: Record<AiRequiredCapability, readonly AiProviderId[]> = {
  groundedSearch: ["perplexity"],
  imageGeneration: ["openai"],
  videoGeneration: ["gemini"],
  musicGeneration: [],
  localCodeExecution: []
};

export function routeAiProvider(
  toolId: string,
  prompt: string,
  providers: readonly (AiRoutingProvider | AiProviderId)[],
  telemetry: Partial<Record<AiProviderId, AiProviderTelemetry>> = {}
): AiRoutingDecision {
  // The provider catalog is supplied by another service at runtime. Treat it as
  // untrusted input even though callers have a narrow TypeScript type: a newer
  // provider must not make the entire Hub shell fail while this client is older.
  const normalized = (providers as readonly unknown[]).flatMap(normalizeRoutingProvider);
  const available = normalized.filter((provider) => provider.available !== false);
  const requiredCapabilities = detectRequiredCapabilities(toolId, prompt);
  const supports = (provider: AiRoutingProvider, capability: AiRequiredCapability) => provider.capabilities ? provider.capabilities.includes(capability) : EXECUTION_CAPABILITIES[capability].includes(provider.id);
  const capable = available.filter((provider) => requiredCapabilities.every((capability) => supports(provider, capability)));
  const missingCapabilities = requiredCapabilities.filter((capability) => !available.some((provider) => supports(provider, capability)));
  const candidates = capable.length > 0 ? capable : available.length > 0 ? available : normalized;
  const usable: AiRoutingProvider[] = candidates.length > 0 ? candidates : FALLBACK_ORDER.map((id) => ({ id, available: false }));
  const { weights, costWeight, focus } = taskWeights(toolId, prompt);
  const prices = usable.map((provider) => numericPrice(provider.priceUsd)).filter((price): price is number => price !== null);
  const minPrice = prices.length ? Math.min(...prices) : .02;
  const maxPrice = prices.length ? Math.max(...prices) : .06;

  const ranking = usable.map((provider) => {
    const profile = withTelemetry(PROFILES[provider.id], telemetry[provider.id]);
    const capabilityWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
    const capabilityScore = (Object.entries(weights) as Array<[Capability, number]>)
      .reduce((sum, [capability, weight]) => sum + profile[capability] * weight, 0) / capabilityWeight;
    const price = numericPrice(provider.priceUsd);
    const priceScore = price === null || maxPrice === minPrice ? .7 : 1 - ((price - minPrice) / (maxPrice - minPrice));
    const score = capabilityScore * (1 - costWeight) + priceScore * costWeight + specializationBonus(toolId, prompt, provider.id);
    return { providerId: provider.id, score: round(score) };
  }).sort((left, right) => right.score - left.score || FALLBACK_ORDER.indexOf(left.providerId) - FALLBACK_ORDER.indexOf(right.providerId));

  const winner = ranking[0];
  const runnerUp = ranking[1];
  const winningProfile = PROFILES[winner.providerId];
  const reasons = focus
    .filter((capability) => winningProfile[capability] >= .8)
    .slice(0, 2)
    .map((capability) => LABELS[capability]);
  if (costWeight >= .22 && reasons.length < 2) reasons.push("低コスト");
  if (reasons.length === 0) reasons.push("総合バランス");

  return {
    providerId: winner.providerId,
    score: winner.score,
    confidence: round(Math.min(1, Math.max(0, (winner.score - (runnerUp?.score ?? 0)) * 4))),
    reasons,
    ranking,
    requiredCapabilities,
    missingCapabilities
  };
}

function normalizeRoutingProvider(provider: unknown): AiRoutingProvider[] {
  if (typeof provider === "string") {
    return PROVIDER_IDS.has(provider as AiProviderId)
      ? [{ id: provider as AiProviderId, available: true }]
      : [];
  }
  if (!provider || typeof provider !== "object") return [];
  const candidate = provider as {
    id?: unknown;
    priceUsd?: unknown;
    available?: unknown;
    capabilities?: unknown;
  };
  if (typeof candidate.id !== "string" || !PROVIDER_IDS.has(candidate.id as AiProviderId)) return [];
  return [{
    id: candidate.id as AiProviderId,
    priceUsd: typeof candidate.priceUsd === "string" || typeof candidate.priceUsd === "number"
      ? candidate.priceUsd
      : undefined,
    available: typeof candidate.available === "boolean" ? candidate.available : true,
    capabilities: Array.isArray(candidate.capabilities)
      ? candidate.capabilities.filter(isRequiredCapability)
      : undefined
  }];
}

function isRequiredCapability(value: unknown): value is AiRequiredCapability {
  return value === "groundedSearch"
    || value === "imageGeneration"
    || value === "videoGeneration"
    || value === "musicGeneration"
    || value === "localCodeExecution";
}

export function detectRequiredCapabilities(toolId: string, prompt: string): AiRequiredCapability[] {
  const text = `${toolId} ${prompt}`.toLowerCase();
  return /(最新|現在|今日|ニュース|調査|検索|出典|ソース|引用|research|latest|current|news|search|source|citation)/i.test(text) ? ["groundedSearch"] : [];
}

export function chooseAiProviderId(toolId: string, prompt: string, availableIds: readonly AiProviderId[]): AiProviderId {
  return routeAiProvider(toolId, prompt, availableIds).providerId;
}

function taskWeights(toolId: string, prompt: string): { weights: Record<Capability, number>; costWeight: number; focus: Capability[] } {
  const text = prompt.toLowerCase();
  const weights: Record<Capability, number> = toolId === "translate"
    ? { reasoning: .06, coding: .01, longContext: .10, multilingual: .34, groundedResearch: .01, writing: .19, enterprise: .04, agentic: .01, social: .01, speed: .11, reliability: .12 }
    : toolId === "summarize"
      ? { reasoning: .12, coding: .01, longContext: .25, multilingual: .06, groundedResearch: .01, writing: .22, enterprise: .08, agentic: .01, social: .01, speed: .10, reliability: .13 }
      : { reasoning: .25, coding: .07, longContext: .11, multilingual: .04, groundedResearch: .07, writing: .10, enterprise: .06, agentic: .08, social: .02, speed: .08, reliability: .12 };
  let costWeight = .10;
  const focus: Capability[] = toolId === "translate" ? ["multilingual", "writing"] : toolId === "summarize" ? ["longContext", "writing"] : ["reasoning", "reliability"];

  boost(/(最新|現在|今日|ニュース|調査|検索|出典|ソース|research|latest|current|news|source|citation)/i, "groundedResearch", .46);
  boost(/(x\.com|twitter|ツイート|ポスト.*分析|x上|xの)/i, "social", .48);
  boost(/(コード|プログラム|バグ|実装|関数|typescript|javascript|python|sql|regex|api|アルゴリズム|数学|数式|code|debug)/i, "coding", .36);
  boost(/(長大|大量|全文|複数.*資料|長い資料|long context|long document|knowledge work)/i, "longContext", .34);
  boost(/(中国語|簡体字|繁体字|中文|英語|翻訳|french|german|spanish|italian|portuguese|multilingual)/i, "multilingual", .30);
  boost(/(エージェント|ツール実行|自律実行|agentic|tool use|agent workflow)/i, "agentic", .38);
  boost(/(企業文書|社内文書|ナレッジ|検索拡張|rag|enterprise|retrieval)/i, "enterprise", .34);
  boost(/(推論|比較|戦略|計画|原因|reasoning|strategy|plan|analy[sz]e)/i, "reasoning", .24);
  boost(/(文章|コピー|メール|記事|自然な|丁寧|writing|rewrite|email)/i, "writing", .22);

  const length = [...prompt].length;
  if (length >= 6_000) add("longContext", .55);
  else if (length >= 3_000) add("longContext", .30);
  if (/(低コスト|安く|費用重視|cheap|low cost|budget)/i.test(text)) costWeight = .34;
  if (/(高速優先|すぐに|速度重視|fast|quick|low latency)/i.test(text)) add("speed", .34);
  if (/(品質優先|精度優先|最高品質|quality|accurate|best answer)/i.test(text)) { add("reasoning", .20); add("reliability", .18); costWeight = .04; }

  return { weights, costWeight, focus: [...new Set(focus)] };

  function boost(pattern: RegExp, capability: Capability, amount: number) {
    if (pattern.test(text)) add(capability, amount);
  }
  function add(capability: Capability, amount: number) {
    weights[capability] += amount;
    if (!focus.includes(capability)) focus.unshift(capability);
  }
}

function withTelemetry(profile: Profile, telemetry: AiProviderTelemetry | undefined): Profile {
  if (!telemetry || telemetry.sampleCount <= 0) return profile;
  const observedWeight = Math.min(.45, telemetry.sampleCount / (telemetry.sampleCount + 40));
  return {
    ...profile,
    reliability: blend(profile.reliability, telemetry.successRate, observedWeight),
    speed: blend(profile.speed, telemetry.latencyScore, observedWeight)
  };
}

function specializationBonus(toolId: string, prompt: string, providerId: AiProviderId): number {
  const text = prompt.toLowerCase();
  const requestsChineseAi = /(中国(?:製|発|系|の)?(?:ai|モデル)|中国ai|中国モデル|chinese ai|china(?:-based)? model)/i.test(text);
  const chineseProviders: readonly AiProviderId[] = ["deepseek", "kimi", "qwen", "glm", "minimax"];
  let bonus = toolId === "summarize" && providerId === "anthropic"
    ? .07
    : toolId === "translate" && providerId === "gemini"
      ? .07
      : toolId === "analyze" && providerId === "openai"
        ? .04
        : 0;

  if (/(最新|現在|今日|ニュース|調査|検索|出典|ソース|research|latest|current|news|source|citation)/i.test(text)) {
    if (providerId === "perplexity") bonus += .28;
    else if (providerId === "openai") bonus += .07;
    else if (providerId === "gemini") bonus += .02;
  }
  if (/(x\.com|twitter|ツイート|ポスト.*分析|x上|xの)/i.test(text) && providerId === "grok") bonus += .28;
  if (/(コード|プログラム|バグ|実装|関数|typescript|javascript|python|sql|regex|api|アルゴリズム|数学|数式|code|debug)/i.test(text) && providerId === "deepseek") bonus += .20;
  if (/(フランス語|ドイツ語|スペイン語|イタリア語|ポルトガル語|french|german|spanish|italian|portuguese)/i.test(text) && providerId === "mistral") bonus += .20;
  if (/(中国語|簡体字|繁体字|中文|chinese)/i.test(text) && providerId === "qwen") bonus += .22;
  if (/(長大|大量|全文|複数.*資料|長い資料|long context|long document|knowledge work)/i.test(text) && providerId === "kimi") bonus += .17;
  if (/(エージェント|ツール実行|自律実行|agentic|tool use|agent workflow)/i.test(text) && providerId === "glm") bonus += .21;
  if (/(企業文書|社内文書|ナレッジ|検索拡張|rag|enterprise|retrieval)/i.test(text) && providerId === "cohere") bonus += .21;
  if (/(低コスト|安く|費用重視|高速優先|cheap|low cost|budget|fast response)/i.test(text) && providerId === "minimax") bonus += .20;

  if (requestsChineseAi && chineseProviders.includes(providerId)) {
    bonus += .12;
    if (/(コード|プログラム|バグ|実装|typescript|javascript|python|sql|code|debug)/i.test(text) && providerId === "deepseek") bonus += .22;
    else if (/(長大|大量|全文|複数.*資料|長い資料|long context|long document)/i.test(text) && providerId === "kimi") bonus += .20;
    else if (/(エージェント|ツール実行|自律実行|agentic|tool use)/i.test(text) && providerId === "glm") bonus += .22;
    else if (/(低コスト|安く|費用重視|高速優先|速度重視|cheap|low cost|budget|fast|quick)/i.test(text) && providerId === "minimax") bonus += .20;
    else if (providerId === "qwen") bonus += .10;
  }
  return bonus;
}

function blend(prior: number, observed: number | undefined, weight: number): number {
  return observed === undefined ? prior : prior * (1 - weight) + clamp(observed) * weight;
}

function numericPrice(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function clamp(value: number): number { return Math.min(1, Math.max(0, value)); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
