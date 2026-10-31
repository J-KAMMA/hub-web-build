import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hubDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("npm_execpath is unavailable. Run this script through npm run build:hubpedia-local.");
  process.exit(1);
}
const result = spawnSync(process.execPath, [npmCli, "run", "build"], {
  cwd: hubDirectory,
  env: { ...process.env, NEXT_DIST_DIR: ".next-hubpedia-3000" },
  stdio: "inherit",
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
