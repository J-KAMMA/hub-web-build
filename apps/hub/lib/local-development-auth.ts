const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type LocalDevelopmentAuthEnv = {
  NODE_ENV?: string;
  HUB_DEPLOYMENT_ENVIRONMENT?: string;
  HUB_ENABLE_LOCAL_AUTO_LOGIN?: string;
  HUB_LOCAL_AUTO_LOGIN_HANDLE?: string;
};

function hostnameFromHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(`http://${value.split(",", 1)[0]?.trim()}`).hostname;
  } catch {
    return null;
  }
}

export function isLocalDevelopmentRequest(
  request: Request
): boolean {
  try {
    const requestHostname = new URL(request.url).hostname;
    const forwardedHostname = hostnameFromHeader(request.headers.get("x-forwarded-host"));
    const hostHostname = hostnameFromHeader(request.headers.get("host"));
    return LOCAL_HOSTS.has(requestHostname)
      && (!forwardedHostname || LOCAL_HOSTS.has(forwardedHostname))
      && (!hostHostname || LOCAL_HOSTS.has(hostHostname));
  } catch {
    return false;
  }
}

export function localDevelopmentAutoLoginHandle(
  request: Request,
  env: LocalDevelopmentAuthEnv,
): string | null {
  if (env.NODE_ENV !== "development") return null;
  if (env.HUB_ENABLE_LOCAL_AUTO_LOGIN !== "true") return null;
  if (env.HUB_DEPLOYMENT_ENVIRONMENT && env.HUB_DEPLOYMENT_ENVIRONMENT !== "development") return null;
  if (!isLocalDevelopmentRequest(request)) return null;
  const handle = env.HUB_LOCAL_AUTO_LOGIN_HANDLE?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
  return /^[a-z0-9_]{3,32}$/u.test(handle) ? handle : null;
}
