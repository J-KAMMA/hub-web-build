#!/usr/bin/env bash
# Local smoke test of the built Worker: empty local D1, no credentials, no secrets.
set -uo pipefail
cd apps/hub
echo "== diag preview-props =="; find .next .open-next -name "preview-props*" 2>/dev/null | head; grep -oE "preview-props[^\"]{0,40}" .open-next/server-functions/default/apps/hub/handler.mjs | sort | uniq -c | head; ls .open-next/server-functions/default/apps/hub/.next/server | head -30
node -e '
const fs=require("fs");
const t=fs.readFileSync("wrangler.production.jsonc","utf8").replace(/^\s*\/\/.*$/gm,"");
const c=JSON.parse(t);
delete c.routes; delete c.ai; delete c.vectorize; delete c.observability; delete c.triggers; delete c.queues;
c.vars={...c.vars,HUB_MAINTENANCE_MODE:"false",HUB_DEPLOYMENT_ENVIRONMENT:"development",HUB_PUBLIC_ORIGIN:"http://127.0.0.1:8787"};
c.d1_databases[0].database_id="11111111-1111-1111-1111-111111111111";
fs.writeFileSync("wrangler.smoke.jsonc",JSON.stringify(c,null,2));
'
npx wrangler d1 migrations apply HUB_DATABASE --local --config wrangler.smoke.jsonc 2>&1 | tail -5
npx wrangler dev --local --config wrangler.smoke.jsonc --port 8787 --ip 127.0.0.1 > ../../dist/smoke-worker.log 2>&1 &
WPID=$!
for i in $(seq 1 60); do
  if grep -q "Ready on" ../../dist/smoke-worker.log; then break; fi
  sleep 2
done
tail -5 ../../dist/smoke-worker.log
FAIL=0
mkdir -p ../../dist/smoke
n=0
for r in / /v2 /v2/community /v2/wallet /v2/settings /v2/research /v2/world /v2/world/servers /v2/videos /v2/articles /music /ai /v2/profile/smoke /v2/music /v2/hubpedia /v2/search /api/health /api/core /api/feed /api/hubpedia /robots.txt /definitely-not-a-route-404; do
  n=$((n+1)); f=../../dist/smoke/$n.html
  code=$(curl -s -m 60 -o "$f" -w '%{http_code}' "http://127.0.0.1:8787$r" || echo 000)
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  bad=""
  case "$code" in 500|502|503|000) bad="BAD-STATUS";; esac
  if grep -qiE "Application error|Internal Server Error" "$f" 2>/dev/null; then bad="$bad BAD-BODY"; fi
  echo "SMOKE $code $size $r $bad"
  [ -n "$bad" ] && FAIL=1
  if ! kill -0 $WPID 2>/dev/null; then echo "worker crashed"; FAIL=1; break; fi
done
echo "== worker log error scan =="
if grep -nE "is not a function|Cannot read properties|Module not found|ChunkLoadError|ReferenceError|TypeError|Cannot find module|No such module" ../../dist/smoke-worker.log | head -40; then FAIL=1; fi
kill $WPID 2>/dev/null || true
tail -60 ../../dist/smoke-worker.log
exit $FAIL
