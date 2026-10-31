import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // OpenNext is invoked from the monorepo root so it can resolve Next's
  // standalone output at `.next/standalone/apps/hub` correctly.
  appPath: "apps/hub",
  buildOutputPath: "apps/hub",
  packageJsonPath: "apps/hub/package.json",
  // Hub retains a deliberate Webpack configuration. OpenNext still owns the
  // complete build so its standalone tracing and runtime patches stay intact.
  buildCommand: "next build --webpack",
};
