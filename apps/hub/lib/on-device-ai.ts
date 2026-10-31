export type OnDeviceModelFamily = "gemma" | "qwen" | "smollm" | "phi";
export type OnDeviceModel = { id: string; name: string; family: OnDeviceModelFamily; capabilities: Array<"text" | "image" | "audio">; contextTokens: number; estimatedMemoryMb: number };
export type OnDeviceGenerateInput = { modelId: string; prompt: string; maxOutputTokens: number; temperature: number };
export type OnDeviceGenerateResult = { output: string; inputTokens?: number; outputTokens?: number; elapsedMs: number };

export interface OnDeviceAiBridge {
  version: 1;
  listModels(): Promise<OnDeviceModel[]>;
  generate(input: OnDeviceGenerateInput): Promise<OnDeviceGenerateResult>;
  generateStream?(input: OnDeviceGenerateInput, onChunk: (chunk: string) => void): Promise<OnDeviceGenerateResult>;
  cancel?(): Promise<void>;
}

export type NativeGemmaStatus = {
  available: boolean;
  supported: boolean;
  installed: boolean;
  model: string;
  backend: string;
  reason?: "arm64_required" | "memory_insufficient";
  modelBytes: number;
  partialBytes: number;
  freeBytes: number;
};

export type NativeGemmaCatalogItem = NativeGemmaStatus & {
  modelId: string;
  name: string;
  downloadBytes: number;
  estimatedMemoryMb: number;
  contextTokens: number;
  family: OnDeviceModelFamily;
  purpose: string;
};

export interface NativeGemmaManager {
  isOnDevice: true;
  catalog(): Promise<NativeGemmaCatalogItem[]>;
  status(modelId: string): Promise<NativeGemmaStatus>;
  install(modelId: string): Promise<NativeGemmaStatus>;
  cancelInstall(): Promise<void>;
  cancelGeneration(): Promise<void>;
  importModel(modelId: string): Promise<NativeGemmaStatus>;
  generate(modelId: string, prompt: string): Promise<{ text: string; model: string; backend: string }>;
  deleteModel(modelId: string): Promise<NativeGemmaStatus>;
}

declare global {
  interface Window {
    JKammaOnDeviceAI?: OnDeviceAiBridge;
    hubNativeGemma?: NativeGemmaManager;
  }
}

export function onDeviceAiBridge(): OnDeviceAiBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.JKammaOnDeviceAI;
  return bridge?.version === 1 ? bridge : null;
}

export function onDeviceGemmaManager(): NativeGemmaManager | null {
  if (typeof window === "undefined") return null;
  return window.hubNativeGemma?.isOnDevice === true ? window.hubNativeGemma : null;
}

export function validateOnDeviceModel(value: unknown): OnDeviceModel | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Partial<OnDeviceModel>;
  if (typeof model.id !== "string" || !/^[A-Za-z0-9._:/-]{1,200}$/.test(model.id) || typeof model.name !== "string") return null;
  if (model.family !== "gemma" && model.family !== "qwen" && model.family !== "smollm" && model.family !== "phi") return null;
  if (!Number.isInteger(model.contextTokens) || Number(model.contextTokens) < 1024 || !Number.isFinite(model.estimatedMemoryMb) || Number(model.estimatedMemoryMb) < 256) return null;
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities.filter((item): item is "text" | "image" | "audio" => item === "text" || item === "image" || item === "audio") : [];
  if (!capabilities.includes("text")) return null;
  return { id: model.id, name: model.name.slice(0, 100), family: model.family, capabilities, contextTokens: Number(model.contextTokens), estimatedMemoryMb: Number(model.estimatedMemoryMb) };
}
