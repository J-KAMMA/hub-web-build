export const HUB_API_ERROR_CATEGORIES = [
  "validation_error",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "dependency_unavailable",
  "internal_error",
] as const;

export type HubApiErrorCategory = typeof HUB_API_ERROR_CATEGORIES[number];
export type HubApiErrorBody = {
  error: {
    code: string;
    category: HubApiErrorCategory;
    message: string;
    requestId: string;
    details: Record<string, unknown> | unknown[] | null;
  };
};

const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

/** Read current structured errors and older string errors without rendering objects. */
export function hubApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function createHubApiError(input: {
  code: string;
  category: HubApiErrorCategory;
  message: string;
  requestId: string;
  details?: Record<string, unknown> | unknown[] | null;
}): HubApiErrorBody {
  if (!SAFE_CODE.test(input.code)) throw new TypeError("Hub API error code must be upper snake case.");
  return {
    error: {
      code: input.code,
      category: input.category,
      message: input.message,
      requestId: input.requestId,
      details: input.details ?? null,
    },
  };
}

export function hubApiErrorResponse(
  input: Parameters<typeof createHubApiError>[0],
  status: number,
  headers: HeadersInit = {},
): Response {
  return Response.json(createHubApiError(input), {
    status,
    headers: { "cache-control": "no-store", "x-request-id": input.requestId, ...headers },
  });
}
