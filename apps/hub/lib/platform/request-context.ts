const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

function incomingId(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.trim();
  return value && SAFE_ID.test(value) ? value : null;
}

export type HubRequestContext = {
  requestId: string;
  correlationId: string;
  traceparent: string | null;
  startedAt: number;
};

export function createHubRequestContext(request: Request): HubRequestContext {
  const requestId = incomingId(request, "x-request-id") ?? `req_${crypto.randomUUID()}`;
  return {
    requestId,
    correlationId: incomingId(request, "x-correlation-id") ?? requestId,
    traceparent: request.headers.get("traceparent"),
    startedAt: performance.now(),
  };
}

export function hubContextHeaders(context: HubRequestContext): HeadersInit {
  return {
    "x-request-id": context.requestId,
    "x-correlation-id": context.correlationId,
  };
}
