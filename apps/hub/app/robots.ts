import type { MetadataRoute } from "next";
import { getInstanceOrigin } from "@/lib/instance-origin";

const NON_PUBLIC_PATHS = [
  "/api/",
  "/admin/",
  "/auth",
  "/bookmarks",
  "/lists",
  "/messages",
  "/notifications",
  "/settings",
  "/vault",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: ["Mediapartners-Google", "Google-Display-Ads-Bot"],
        allow: ["/", "/hubpedia", "/hubpedia/", "/ads.txt"],
        disallow: NON_PUBLIC_PATHS,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: NON_PUBLIC_PATHS,
      },
    ],
    sitemap: [`${getInstanceOrigin()}/sitemap.xml`, `${getInstanceOrigin()}/games/sitemap.xml`],
  };
}
