# Hub web build mirror

History-less mirror of the Hub web app (AGPL-3.0-only, see `apps/hub/LICENSE`)
plus the workspace packages it imports, used only to run the OpenNext
Cloudflare build on GitHub Actions. Push a tag `web-build-*` or run the
workflow manually; the build artifact is kept for 7 days. Nothing is deployed
from here and no secrets are used.

Third-party code keeps its own licences. `apps/federation/src/validation.ts`
and `types.ts` are included from Federation (AGPL-3.0-only, `apps/federation/LICENSE`).
