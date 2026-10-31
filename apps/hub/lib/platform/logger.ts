import type { HubRequestContext } from "./request-context";

const SENSITIVE_KEY = /authorization|cookie|set-cookie|password|secret|token|api[-_]?key|private[-_]?key|mnemonic|seed|email|phone|address|prompt|response|body/i;
const REDACTED = "[REDACTED]";

export function redactHubLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactHubLogValue(item, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    SENSITIVE_KEY.test(key) ? REDACTED : redactHubLogValue(child, seen),
  ]));
}

export type HubLogSink = (record: Record<string, unknown>) => void;

export function createHubLogger(service: string, sink: HubLogSink = (record) => console.info(JSON.stringify(record))) {
  const write = (level: "info" | "warn" | "error", event: string, context?: HubRequestContext, metadata: Record<string, unknown> = {}) => {
    sink(redactHubLogValue({
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      durationMs: context ? Math.max(0, Math.round(performance.now() - context.startedAt)) : undefined,
      ...metadata,
    }) as Record<string, unknown>);
  };
  return {
    info: (event: string, context?: HubRequestContext, metadata?: Record<string, unknown>) => write("info", event, context, metadata),
    warn: (event: string, context?: HubRequestContext, metadata?: Record<string, unknown>) => write("warn", event, context, metadata),
    error: (event: string, context?: HubRequestContext, metadata?: Record<string, unknown>) => write("error", event, context, metadata),
  };
}
