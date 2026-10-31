// Hub-owned work over the paired runner session.
//
// Hub work builds on Pi for every new run. Saved DSH sessions retain their
// original loop only when explicitly resumed; Hub owns tools and permissions.
// The endpoint accepts no script path, workspace path, or custom model
// connection — the machine decides those; the session only names model,
// prompt and permission flags.

const RUNNER = "http://127.0.0.1:43127";

export type PiPendingAction = {
  id: string;
  tool: string;
  summary: string;
  /** Runtime-produced file preview or purchase specification; never a permission grant. */
  detail?: { productId?: string; quantity?: number; path?: string; before?: string; after?: string; previousSha256?: string | null } | null;
  proposedAtMs: number;
};
export type PiToolCall = {
  id: string;
  name: string;
  /** What the call acts on — path, command line, URL or query. */
  detail?: string;
  ok?: boolean;
  /** Bounded result excerpt; live run only, not in persisted history. */
  preview?: string;
};
export type PiRunState = {
  verification?: { status: string; attempts: number } | null;
  engine?: "pi" | "dsh";
  usage?: { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number };
  finalOutput?: string;
  continuation?: { available: boolean; resumedFrom: string | null; error: string | null };
  id: string;
  workspace: string;
  model: string;
  prompt: string;
  allowWrite: boolean;
  allowExec: boolean;
  allowHttp: boolean;
  allowTest: boolean;
  status: string;
  hello?: { proto: number; activeTools: string[]; model?: string | null; available?: string[] } | null;
  toolCalls: PiToolCall[];
  pendingActions: PiPendingAction[];
  agentEvents: number;
  /** Live tail of streamed assistant text while the run is active. */
  partialOutput: string;
  outcome?: { ok: boolean; exitCode?: number | null; error?: string } | null;
  stderrTail: string;
  startedAtMs: number;
  endedAtMs?: number | null;
};

type ApiError = { error?: string };

function headers(token: string, json = false) {
  return { authorization: `Bearer ${token}`, ...(json ? { "content-type": "application/json" } : {}) };
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNNER}${path}`, { ...init, headers: { ...headers(token, init?.body != null), ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(body.error ?? `http_${response.status}`);
  return body;
}

/** The machine's pi model registry, flattened to "provider/id" for the
 *  picker. `default` is the spec a bare start would run; an empty `models`
 *  means no registry — the picker degrades to a free-text field. `ready`
 *  is the subset whose provider auth resolved and can run now; it is absent
 *  when the runner could not probe auth, which means unknown — not empty. */
export type PiWorkModels = { models: string[]; ready?: string[]; default: string; locations?: Record<string, "local" | "api"> | null };

export const piWork = {
  list: (token: string) => request<PiRunState[]>("/pi-work/runs", token),
  models: (token: string, refresh = false) => request<PiWorkModels>(`/pi-work/models${refresh ? "?refresh=1" : ""}`, token),
  status: (token: string, id: string) => request<PiRunState>(`/pi-work/runs/${encodeURIComponent(id)}`, token),
  /** Long-poll: resolves when the run's version moves past `since` (or the
   *  runner's deadline expires unchanged). One in-flight call replaces the
   *  status poll loop. */
  watch: async (token: string, id: string, since: number) => {
    const response = await fetch(`${RUNNER}/pi-work/runs/${encodeURIComponent(id)}?since=${since}`, { headers: headers(token), cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as PiRunState & ApiError;
    if (!response.ok) throw new Error(body.error ?? `http_${response.status}`);
    return { run: body, version: Number(response.headers.get("x-run-version") ?? 0) };
  },
  start: (token: string, body: { prompt: string; model?: string; engine?: "pi" | "dsh"; resumeRunId?: string; allowWrite?: boolean; allowExec?: boolean; allowHttp?: boolean; verification?: { program: string; args: string[] } }) =>
    request<PiRunState>("/pi-work/runs", token, { method: "POST", body: JSON.stringify(body) }),
  decide: (token: string, id: string, actionId: string, approve: boolean, outcome?: unknown) =>
    request<PiRunState>(`/pi-work/runs/${encodeURIComponent(id)}/decide`, token, { method: "POST", body: JSON.stringify({ actionId, approve, ...(outcome !== undefined ? { outcome } : {}) }) }),
  cancel: (token: string, id: string) => request<PiRunState>(`/pi-work/runs/${encodeURIComponent(id)}/cancel`, token, { method: "POST" })
};
