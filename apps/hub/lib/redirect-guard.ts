/**
 * Cloudflare Workers (workerd) reject `fetch(..., { redirect: "error" })` with a TypeError,
 * so server code uses `redirect: "manual"` and treats any redirect as a failure (fail closed).
 */
export function isRedirectResponse(response: { status: number; type?: string }): boolean {
  return response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}
