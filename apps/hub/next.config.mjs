import path from "node:path";
import { fileURLToPath } from "node:url";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.CLOUDFLARE_BINDINGS_LOCAL === "true") {
  /*
   * 2 Hub 試験台（Hub B、ポート3030）は、設定ファイルと Wrangler の永続先を別にする。
   * HUB_WRANGLER_CONFIG / HUB_WRANGLER_PERSIST_DIR は scripts/dev-hub-b.mjs だけが渡す。
   * 永続先は .wrangler/state-hub-b/ の下に限る（3020 の .wrangler/state は読まない・書かない）。
   * 未指定の通常の開発サーバーは従来どおり。
   */
  const persistDir = process.env.HUB_WRANGLER_PERSIST_DIR;
  const configPath = process.env.HUB_WRANGLER_CONFIG || "wrangler.dev.jsonc";
  if (persistDir) {
    const parts = path.resolve(persistDir).split(path.sep);
    const at = parts.indexOf(".wrangler");
    if (at < 0 || parts[at + 1] !== "state-hub-b") {
      throw new Error("HUB_WRANGLER_PERSIST_DIR must be under .wrangler/state-hub-b");
    }
  }
  await initOpenNextCloudflareForDev({
    configPath,
    // getPlatformProxy は渡した場所にそのまま d1/ r2/ を作る。wrangler の --persist-to と同じ v3/ の下に揃える。
    ...(persistDir ? { persist: { path: path.join(path.resolve(persistDir), "v3") } } : {}),
  });
}

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, "../..");
const configuredBuildCpus = Number.parseInt(process.env.HUB_BUILD_CPUS ?? "", 10);
const buildCpus = Number.isSafeInteger(configuredBuildCpus) && configuredBuildCpus > 0
  ? Math.min(configuredBuildCpus, 8)
  : null;

function nextDistDir() {
  const configured = process.env.NEXT_DIST_DIR;
  if (!configured) return process.env.NODE_ENV === "development" ? ".next-dev" : ".next";
  if (!/^\.next(?:-[a-z0-9-]+)?$/.test(configured)) {
    throw new Error("NEXT_DIST_DIR must be a .next-prefixed directory name");
  }
  return configured;
}

function vaultDevOrigin() {
  const configured = process.env.HUB_VAULT_DEV_ORIGIN ?? "http://127.0.0.1:8796";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_VAULT_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }

  return url.origin;
}

function musicDevOrigin() {
  const configured = process.env.HUB_MUSIC_DEV_ORIGIN ?? "http://127.0.0.1:8788";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_MUSIC_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }

  return url.origin;
}

function aiDevOrigin() {
  const configured = process.env.HUB_AI_DEV_ORIGIN ?? "http://127.0.0.1:8789";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const isStagingWorker =
    url.protocol === "https:" &&
    url.hostname === "jkamma-ai-staging.jammakamma0.workers.dev";
  if (
    (!isLoopback && !isStagingWorker) ||
    (isLoopback && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.pathname !== "/"
  ) {
    throw new Error("HUB_AI_DEV_ORIGIN must be the AI staging Worker or an HTTP loopback origin without a path");
  }
  return url.origin;
}

function federationDevOrigin() {
  const configured = process.env.HUB_FEDERATION_DEV_ORIGIN ?? "http://127.0.0.1:8787";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_FEDERATION_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }
  return url.origin;
}

function accountDevOrigin() {
  const configured = process.env.HUB_ACCOUNT_DEV_ORIGIN ?? "http://127.0.0.1:8791";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const isStagingWorker = url.protocol === "https:" && url.hostname === "jkamma-account-dev.jammakamma0.workers.dev";
  if ((!isLoopback && !isStagingWorker) || (isLoopback && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_ACCOUNT_DEV_ORIGIN must be the Account staging Worker or an HTTP loopback origin without a path");
  }
  return url.origin;
}

function identityDevOrigin() {
  const configured = process.env.HUB_IDENTITY_DEV_ORIGIN ?? "http://127.0.0.1:8795";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_IDENTITY_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }
  return url.origin;
}

function computeDevOrigin() {
  const configured = process.env.HUB_COMPUTE_DEV_ORIGIN ?? "http://127.0.0.1:8794";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_COMPUTE_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }
  return url.origin;
}

function commerceDevOrigin() {
  const configured = process.env.HUB_COMMERCE_DEV_ORIGIN ?? "http://127.0.0.1:8790";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  const isStagingWorker = url.protocol === "https:" && url.hostname === "jkamma-commerce-staging.jammakamma0.workers.dev";
  if ((!isLoopback && !isStagingWorker) || (isLoopback && url.protocol !== "http:") || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_COMMERCE_DEV_ORIGIN must be the Commerce staging Worker or an HTTP loopback origin without a path");
  }
  return url.origin;
}

function mailDevOrigin() {
  const configured = process.env.HUB_MAIL_DEV_ORIGIN ?? "http://127.0.0.1:8797";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_MAIL_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }
  return url.origin;
}

function socialPublisherDevOrigin() {
  const configured = process.env.HUB_SOCIAL_PUBLISHER_DEV_ORIGIN ?? "http://127.0.0.1:8799";
  const url = new URL(configured);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !isLoopback || url.username || url.password || url.pathname !== "/") {
    throw new Error("HUB_SOCIAL_PUBLISHER_DEV_ORIGIN must be an HTTP loopback origin without a path");
  }
  return url.origin;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Desktop and local browser checks use the loopback IP as well as localhost.
  allowedDevOrigins: ['127.0.0.1'],
  // The 3D world ships as TypeScript source from the workspace, so Next must
  // compile it rather than expect a prebuilt bundle.
  transpilePackages: ["@jkamma/hub-world", "@jkamma/content-tags"],
  // Keep the local development cache separate from production builds.
  // This prevents `next build` from replacing files used by a running preview.
  distDir: nextDistDir(),
  outputFileTracingRoot: workspaceRoot,
  // Cloudflare serves the already-sized Hub media directly. Disabling the
  // Node-native Next image optimizer keeps Sharp's native binaries out of the
  // workerd bundle; the normal VPS build retains its existing optimizer.
  images: {
    unoptimized: process.env.HUB_CLOUDFLARE_BUILD === "true",
  },
  // Next dev records its generated route types under the development dist
  // directory. Production builds use an isolated config so stale dev route
  // unions cannot conflict with freshly generated `.next/types`.
  typescript: {
    // Constrained builders can run the same check as a separate process before
    // webpack starts. This releases the TypeScript heap before Next assembles
    // the production artifact instead of running both phases in one process.
    ignoreBuildErrors: process.env.HUB_BUILD_SEPARATE_TYPECHECK === "true",
    tsconfigPath: process.env.NODE_ENV === "production"
      ? "tsconfig.next-build.json"
      : "tsconfig.json",
  },
  // Hub has many route-specific surfaces and styles. Let Webpack release
  // intermediate compiler data sooner so the constrained VPS dev runtime
  // does not reach its heap ceiling while routes are compiled on demand.
  experimental: {
    webpackMemoryOptimizations: true,
    ...(process.env.HUB_BUILD_WEBPACK_WORKER === "true" ? { webpackBuildWorker: true } : {}),
    ...(buildCpus ? { cpus: buildCpus } : {}),
  },
  // The VPS development runtime is memory constrained. Retaining one inactive
  // page is enough for normal navigation while allowing large product routes
  // to be disposed before another route is compiled.
  onDemandEntries: {
    maxInactiveAge: 1_000,
    pagesBufferLength: 1,
  },
  webpack(config, { dev }) {
    // Analysis builds only (web-analyze-* tags): keep module paths in the
    // server chunks so .github/scripts/server-modules.mjs can size them.
    if (process.env.HUB_NAMED_MODULES === "true") {
      config.optimization = { ...config.optimization, moduleIds: "named" };
    }
    // Source maps are useful for focused debugging but retain a large amount
    // of module graph data in this monorepo. Keep them opt-in on the
    // constrained VPS development runtime; production builds are unchanged.
    if (dev && process.env.HUB_DEV_SOURCE_MAPS !== "true") {
      config.devtool = false;
    }
    // Retained build outputs (.next-goal-*, .next-refund*, .next-dev and the
    // like) are not source and must not be watched: they hold hundreds of
    // thousands of files and the dev watcher had nothing stopping it walking
    // them. Additive: whatever Next already ignores is preserved.
    if (dev) {
      const existing = config.watchOptions?.ignored;
      // Webpack accepts `ignored` as a RegExp OR an array of glob strings, but
      // not a mixed array. Next's own default is a RegExp covering
      // node_modules/.git/.next, which the globs below already subsume, so
      // only string entries are carried over.
      const keep = (Array.isArray(existing) ? existing : existing ? [existing] : [])
        .filter((item) => typeof item === "string" && item.length > 0);
      config.watchOptions = {
        ...(config.watchOptions ?? {}),
        ignored: [
          ...keep,
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "**/.next-*/**",
          "**/.open-next/**",
        ],
      };
    }
    return config;
  },
  devIndicators: { position: "bottom-right" },
  async rewrites() {
    const localServiceRewritesEnabled =
      process.env.NODE_ENV === "development" ||
      process.env.HUB_ENABLE_LOCAL_SERVICE_REWRITES === "true";
    if (!localServiceRewritesEnabled) return [];

    const vaultOrigin = vaultDevOrigin();
    const musicOrigin = musicDevOrigin();
    const aiOrigin = aiDevOrigin();
    const identityOrigin = identityDevOrigin();
    const commerceOrigin = commerceDevOrigin();
    const computeOrigin = computeDevOrigin();
    const mailOrigin = mailDevOrigin();
    const socialPublisherOrigin = socialPublisherDevOrigin();
    const federationOrigin = federationDevOrigin();
    return {
      beforeFiles: [
        { source: "/vault/api/:path*", destination: `${vaultOrigin}/api/:path*` },
        { source: "/music/api/:path*", destination: `${musicOrigin}/music/api/:path*` },
        { source: "/ai/api/:path*", destination: `${aiOrigin}/ai/api/:path*` },
        { source: "/identity/api/:path*", destination: `${identityOrigin}/:path*` },
        { source: "/compute/api/:path*", destination: `${computeOrigin}/compute/:path*` },
        { source: "/ai/mcp/:path*", destination: `${aiOrigin}/ai/mcp/:path*` },
        { source: "/ai/mcp", destination: `${aiOrigin}/ai/mcp` },
        { source: "/shopping/api/commerce/:path*", destination: `${commerceOrigin}/:path*` },
        { source: "/commerce/api/:path*", destination: `${commerceOrigin}/api/:path*` },
        { source: "/mail/api/:path*", destination: `${mailOrigin}/mail/api/:path*` },
        { source: "/social-publisher/api/:path*", destination: `${socialPublisherOrigin}/social-publisher/api/:path*` },
        /*
         * ActivityPub の公開面は apps/federation だけが返す（本番は端で同じ道を Federation へ回す）。
         * 手元でも同じ配置にして、Hub 内の第二の actor / WebFinger を無くす（DESIGN.md 8.0）。
         */
        { source: "/users/:path*", destination: `${federationOrigin}/users/:path*` },
        { source: "/objects/:path*", destination: `${federationOrigin}/objects/:path*` },
        // コミュニティの Group actor（段階4）。/c/{slug}、その inbox・outbox・channels・objects。
        { source: "/c/:path*", destination: `${federationOrigin}/c/:path*` },
        { source: "/nodeinfo/:path*", destination: `${federationOrigin}/nodeinfo/:path*` },
        { source: "/.well-known/webfinger", destination: `${federationOrigin}/.well-known/webfinger` },
        { source: "/.well-known/nodeinfo", destination: `${federationOrigin}/.well-known/nodeinfo` }
      ],
      afterFiles: [],
      fallback: []
    };
  }
};

export default nextConfig;
