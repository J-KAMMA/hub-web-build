import { getInstanceOrigin } from "@/lib/instance-origin";

// 既定は同一オリジンの端経路 <この Hub のオリジン>/shopping/api/commerce/*（Commerce Worker へ直送）。
// ブラウザでは window.location.origin、サーバーでは HUB_PUBLIC_ORIGIN（lib/instance-origin.ts）。
// NEXT_PUBLIC_COMMERCE_API_ORIGIN を指定したときだけ、その Commerce オリジンへ直接つなぐ。
const SAME_ORIGIN_COMMERCE_PATH = "/shopping/api/commerce";
const API_PREFIX = "/api/v1";

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function hubOrigin() {
  return typeof window !== "undefined" ? window.location.origin : getInstanceOrigin();
}

export function commerceOrigin(value = process.env.NEXT_PUBLIC_COMMERCE_API_ORIGIN) {
  const candidate = value?.trim() || hubOrigin();
  const url = new URL(candidate);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback(url.hostname)))
  ) {
    throw new Error("invalid_commerce_origin");
  }
  return url.origin;
}

export function commerceApiUrl(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("invalid_commerce_path");
  }
  const override = process.env.NEXT_PUBLIC_COMMERCE_API_ORIGIN?.trim();
  const base = override ? commerceOrigin() : `${commerceOrigin()}${SAME_ORIGIN_COMMERCE_PATH}`;
  return `${base}${API_PREFIX}${path}`;
}

export async function commerceRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(commerceApiUrl(path), {
    ...init,
    cache: "no-store",
  });
  const body = (await response.json()) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "commerce_unavailable",
    );
  }
  return body;
}

