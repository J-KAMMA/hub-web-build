import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AdminAccessRequired } from "@/components/admin-access-required";

import catalog from "@/lib/platform/service-catalog.generated.json";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export default async function PlatformServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceName: string }>;
}) {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) {
    return <AdminAccessRequired />;
  }

  const { serviceName } = await params;
  const service = catalog.services.find((candidate) => candidate.name === serviceName);
  if (!service) notFound();
  const validationWarnings = service.validationWarnings as Array<{ field: string; reason: string }>;

  return (
    <section className="platform-catalog platform-catalog--detail">
      <header>
        <p><Link href="/admin/platform/services">Service Catalog</Link> / {service.domain}</p>
        <h1>{service.displayName}</h1>
        <code>{service.name}</code>
      </header>

      <section className="platform-catalog__detail-grid" aria-label="サービス概要">
        <dl>
          <div><dt>Owner</dt><dd>{service.owner}</dd></div>
          <div><dt>Domain</dt><dd>{service.domain}</dd></div>
          <div><dt>Type</dt><dd>{service.type}</dd></div>
          <div><dt>Lifecycle</dt><dd>{service.lifecycle}</dd></div>
          <div><dt>Tier</dt><dd>{service.tier}</dd></div>
          <div><dt>Scorecard</dt><dd>{service.scorecard.status}</dd></div>
        </dl>
      </section>

      <section className="platform-catalog__detail-section">
        <h2>実装と運用</h2>
        <dl>
          <div><dt>Repository</dt><dd><code>{service.repositoryPath}</code></dd></div>
          <div><dt>Entrypoint</dt><dd><code>{service.entrypoint}</code></dd></div>
          <div><dt>Runbook</dt><dd><code>{service.runbook}</code></dd></div>
          <div><dt>SLO</dt><dd>{service.slo.availabilityPercent}% / p95 {service.slo.latencyP95Ms}ms</dd></div>
        </dl>
      </section>

      <section className="platform-catalog__detail-section">
        <h2>契約と依存関係</h2>
        <dl>
          <div><dt>OpenAPI</dt><dd>{service.contracts.openapi.length ? service.contracts.openapi.map((item) => <code key={item}>{item}</code>) : "なし"}</dd></div>
          <div><dt>AsyncAPI</dt><dd>{service.contracts.asyncapi.length ? service.contracts.asyncapi.map((item) => <code key={item}>{item}</code>) : "なし"}</dd></div>
          <div><dt>Dependencies</dt><dd>{service.dependencies.length ? service.dependencies.join(", ") : "なし"}</dd></div>
          <div><dt>Dependents</dt><dd>{service.dependents.length ? service.dependents.join(", ") : "なし"}</dd></div>
          <div><dt>Produces</dt><dd>{service.produces.length ? service.produces.join(", ") : "なし"}</dd></div>
          <div><dt>Consumes</dt><dd>{service.consumes.length ? service.consumes.join(", ") : "なし"}</dd></div>
        </dl>
      </section>

      <section className="platform-catalog__detail-section">
        <h2>Security</h2>
        <dl>
          {Object.entries(service.security).map(([name, value]) => (
            <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>
          ))}
        </dl>
      </section>

      <section className="platform-catalog__detail-section">
        <h2>Scorecard</h2>
        <ul className="platform-catalog__scorecard">
          {Object.entries(service.scorecard.checks).map(([name, check]) => (
            <li key={name} data-status={check.status}>
              <span>{name}</span><strong>{check.status}</strong><small>{check.detail}</small>
            </li>
          ))}
        </ul>
        {validationWarnings.length > 0 ? (
          <>
            <h3>Validation warnings</h3>
            <ul>{validationWarnings.map((warning) => <li key={`${warning.field}:${warning.reason}`}>{warning.field}: {warning.reason}</li>)}</ul>
          </>
        ) : <p>Validation warningsはありません。</p>}
      </section>
    </section>
  );
}
