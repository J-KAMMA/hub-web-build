import "server-only";

import { cookies, headers } from "next/headers";

import { HUB_LOCALE_COOKIE, localeFromAcceptLanguage, resolveHubLocale } from "@/lib/i18n";

export async function getHubLocale() {
  const cookieLocale = (await cookies()).get(HUB_LOCALE_COOKIE)?.value;
  if (cookieLocale) return resolveHubLocale(cookieLocale);
  return localeFromAcceptLanguage((await headers()).get("accept-language"));
}
