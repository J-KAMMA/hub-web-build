import Link from "next/link";
import { AdminAccessRequired } from "@/components/admin-access-required";
import { cookies } from "next/headers";
import catalog from "@/lib/platform/service-catalog.generated.json";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export default async function PlatformServicesPage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) {
    return <AdminAccessRequired />;
  }
  return (
    <section className="platform-catalog">
      <header>
        <p>Hub Platform Foundation</p>
        <h1>Service Catalog</h1>
        <p>manifestから決定的に生成された読み取り専用カタログです。</p>
      </header>
      <div className="platform-catalog__summary"><strong>{catalog.services.length}</strong><span>registered services</span></div>
      <div className="platform-catalog__list">
        {catalog.services.map((service) => (
          <article id={service.name} key={service.name}>
            <div>
              <h2><Link href={`/admin/platform/services/${service.name}`}>{service.displayName}</Link></h2>
              <code>{service.name}</code>
            </div>
            <dl>
              <div><dt>Domain</dt><dd>{service.domain}</dd></div>
              <div><dt>Owner</dt><dd>{service.owner}</dd></div>
              <div><dt>Lifecycle</dt><dd>{service.lifecycle}</dd></div>
              <div><dt>Tier</dt><dd>{service.tier}</dd></div>
              <div><dt>Scorecard</dt><dd>{service.scorecard.status}</dd></div>
              <div><dt>Dependencies</dt><dd>{service.dependencies.length}</dd></div>
            </dl>
            <details>
              <summary>概要を表示</summary>
              <p><strong>Entrypoint:</strong> <code>{service.entrypoint}</code></p>
              <p><strong>Runbook:</strong> <code>{service.runbook}</code></p>
              <p><strong>SLO:</strong> {service.slo.availabilityPercent}% / p95 {service.slo.latencyP95Ms}ms</p>
              <ul>{Object.entries(service.scorecard.checks).map(([name, check]) => <li key={name}><strong>{name}</strong>: {check.status} — {check.detail}</li>)}</ul>
            </details>
            <Link className="platform-catalog__detail-link" href={`/admin/platform/services/${service.name}`}>
              サービス詳細を開く
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
