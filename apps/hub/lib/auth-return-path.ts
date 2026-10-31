export function safeHubReturnPath(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (
    !candidate
    || candidate.length > 2048
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return "/";
  }
  return candidate;
}

export function hubReauthenticationRequested(
  value: string | string[] | undefined,
): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}
