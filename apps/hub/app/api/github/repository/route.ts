import { parseGitHubRepositoryInput } from "@/lib/github-repository";
import { readGitHubPublicRepository } from "@/lib/server/github-public-repository";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const target = query.size === 1 && query.has("repo") ? parseGitHubRepositoryInput(query.get("repo")) : null;
    if (!target) return Response.json({ status: "invalid_target" }, { status: 400, headers });
    const result = await readGitHubPublicRepository(target, request.signal);
    const status = result.status === "unavailable" ? 503 : result.status === "rate_limited" ? 429 : 200;
    return Response.json(result, { status, headers: { ...headers,
      "Cache-Control": result.status === "ok" ? "public, max-age=30" : "no-store" } });
  } catch {
    return Response.json({ status: "unavailable", repository: null, issues: null, pullRequests: null, commits: null,
      categoryStatuses: { issues: "unavailable", pullRequests: "unavailable", commits: "unavailable" } }, { status: 503, headers });
  }
}
