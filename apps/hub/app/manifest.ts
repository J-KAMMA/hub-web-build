import type { MetadataRoute } from "next";

import { getInstanceName } from "@/lib/instance-origin";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: getInstanceName(process.env, "JKamma Hub"),
    short_name: getInstanceName(process.env, "Hub").slice(0, 12),
    description:
      "Community, Hubpedia, music, video, Vault, AI tools, and commerce in one app.",
    start_url: "/?source=installed-app",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    background_color: "#f5f5f2",
    theme_color: "#f5f5f2",
    orientation: "any",
    categories: [
      "social",
      "news",
      "music",
      "productivity",
      "finance",
      "shopping",
    ],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "タイムライン",
        short_name: "タイムライン",
        url: "/timeline?source=app-shortcut",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "Hubpedia",
        short_name: "Hubpedia",
        url: "/hubpedia?source=app-shortcut",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "音楽",
        short_name: "音楽",
        url: "/music?source=app-shortcut",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "AI Tools",
        short_name: "AI",
        url: "/ai?source=app-shortcut",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      {
        name: "ウォレットで支払う",
        short_name: "支払う",
        url: "/v2/wallet/pay?source=app-shortcut",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
      },
    ],
  };
}
