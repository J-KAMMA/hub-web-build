import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildTemplateDatabase, SHARED_TEMPLATE_ENV } from "./sqlite-d1";

/*
 * 全 migration の適用は、負荷のかかった staging gate では worker 内で 60 秒を超えて同期的に走る。
 * その間 worker は RPC の応答も timer も処理できず、vitest が固定 60 秒で打ち切って
 * "Timeout calling onTaskUpdate" になる（設定で伸ばせない）。雛形を main process で 1 回だけ作り、
 * worker はそのコピーを開くだけにする。worker は pool の起動時に env を受け継ぐ。
 */
export default function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hub-sqlite-d1-shared-"));
  const file = path.join(dir, "template.sqlite");
  buildTemplateDatabase(process.cwd(), file);
  process.env[SHARED_TEMPLATE_ENV] = file;
  return () => {
    delete process.env[SHARED_TEMPLATE_ENV];
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
}
