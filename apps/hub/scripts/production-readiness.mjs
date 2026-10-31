import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const failures = [];
const hubRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(hubRoot, "../..");
let approvedRecord = null;
const requiredEnvironment = [
  "HUB_PRODUCTION_MONITORING_OWNER",
  "HUB_PRODUCTION_ALERT_DESTINATION",
  "HUB_PRODUCTION_ROLLBACK_VERSION",
];

for (const name of requiredEnvironment) {
  if (!String(process.env[name] ?? "").trim())
    failures.push(`${name}: missing`);
}

const rollbackVersion = String(process.env.HUB_PRODUCTION_ROLLBACK_VERSION ?? "").trim();
if (rollbackVersion && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(rollbackVersion))
  failures.push("HUB_PRODUCTION_ROLLBACK_VERSION: must be an immutable Cloudflare Worker version UUID");

const reviewApproved = process.env.HUB_PRODUCTION_REVIEW_APPROVED === "true";
if (!reviewApproved) {
  failures.push(
    "HUB_PRODUCTION_REVIEW_APPROVED: explicit security, legal/privacy and operations approval is required",
  );
}

if (reviewApproved) {
  const approvalPath = resolve(
    hubRoot,
    process.env.HUB_PRODUCTION_APPROVAL_RECORD ??
      "../../docs/HUB_PRODUCTION_APPROVAL.json",
  );
  if (!existsSync(approvalPath)) {
    failures.push(`production approval record missing: ${approvalPath}`);
  } else {
    try {
      const approval = JSON.parse(readFileSync(approvalPath, "utf8"));
      approvedRecord = approval;
      const currentRevision = execFileSync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: repositoryRoot, encoding: "utf8" },
      ).trim();
      const nonEmpty = (value) =>
        typeof value === "string" && value.trim().length > 0;
      const validReview = (review) => {
        if (!review || !nonEmpty(review.name)) return false;
        const reviewedAt = Date.parse(review.reviewedAt ?? "");
        const expiresAt = Date.parse(review.expiresAt ?? "");
        return Number.isFinite(reviewedAt) && Number.isFinite(expiresAt) &&
          reviewedAt <= Date.now() && expiresAt > Date.now();
      };

      if (approval.format !== "jkamma-hub-production-approval-v1")
        failures.push("production approval record: unsupported format");
      if (approval.surface !== "hub-sns-core" || approval.environment !== "production")
        failures.push("production approval record: wrong surface or environment");
      if (approval.decision !== "accept")
        failures.push("production approval record: decision must be accept");
      if (approval.sourceRevision !== currentRevision)
        failures.push("production approval record: source revision does not match HEAD");
      if (!Array.isArray(approval.domains) || !approval.domains.includes("hub.jkamma.com"))
        failures.push("production approval record: hub.jkamma.com is not in scope");
      for (const role of ["security", "legalPrivacy", "operations"]) {
        if (!validReview(approval.reviewers?.[role]))
          failures.push(`production approval record: ${role} review is missing or expired`);
      }
      if (!Array.isArray(approval.evidence) || approval.evidence.length === 0 ||
          approval.evidence.some((item) => !nonEmpty(item)))
        failures.push("production approval record: evidence paths are required");
      else {
        for (const item of approval.evidence) {
          if (/^https:\/\//u.test(item)) continue;
          const evidencePath = resolve(repositoryRoot, item);
          if (!evidencePath.startsWith(`${repositoryRoot}${sep}`) || !existsSync(evidencePath))
            failures.push(`production approval record: evidence does not exist: ${item}`);
        }
      }
      if (!Array.isArray(approval.providerAccounts) || approval.providerAccounts.length === 0 ||
          approval.providerAccounts.some((item) => !nonEmpty(item)))
        failures.push("production approval record: provider accounts are required");
      if (approval.dependencies?.accountOrigin !== "https://account.jkamma.com")
        failures.push("production approval record: production Account origin is required");
      const requiredSecretBindings = new Set([
        "ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI",
        "HUB_MODERATION_TOTP_SECRET",
      ]);
      for (const name of Array.isArray(approval.secretBindings) ? approval.secretBindings : [])
        requiredSecretBindings.delete(name);
      for (const name of requiredSecretBindings)
        failures.push(`production approval record: secret binding ${name} is not confirmed`);
      const secretsConfirmedAt = Date.parse(approval.secretInventoryConfirmedAt ?? "");
      if (!nonEmpty(approval.secretInventoryOperator) ||
          !Number.isFinite(secretsConfirmedAt) || secretsConfirmedAt > Date.now() ||
          Date.now() - secretsConfirmedAt > 30 * 24 * 60 * 60 * 1000)
        failures.push("production approval record: secret inventory confirmation is missing or stale");
      for (const resource of ["d1Database", "mediaBucket", "jobsQueue", "jobsDlq"]) {
        if (!nonEmpty(approval.resources?.[resource]))
          failures.push(`production approval record: resource ${resource} is required`);
      }
      if (!Array.isArray(approval.residualRisks))
        failures.push("production approval record: residualRisks must be recorded");
      if (!nonEmpty(approval.incidentContact) || !nonEmpty(approval.errorBudget))
        failures.push("production approval record: incident contact and error budget are required");
      const drill = approval.recoveryDrill;
      const drillRestoredAt = Date.parse(drill?.restoredAt ?? "");
      const drillVerifiedAt = Date.parse(drill?.verifiedAt ?? "");
      if (drill?.format !== "jkamma-hub-d1-recovery-drill-v1")
        failures.push("production approval record: a D1 recovery drill is required");
      if (!nonEmpty(drill?.operator))
        failures.push("production approval record: recovery drill operator is required");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(drill?.recoveryDatabaseId ?? "") ||
          drill?.recoveryDatabaseId === approval.resources?.d1Database)
        failures.push("production approval record: recovery drill must use an independent D1 database");
      if (!Number.isFinite(drillRestoredAt) || !Number.isFinite(drillVerifiedAt) ||
          drillRestoredAt > drillVerifiedAt || drillVerifiedAt > Date.now() ||
          Date.now() - drillVerifiedAt > 30 * 24 * 60 * 60 * 1000)
        failures.push("production approval record: recovery drill verification must be valid and no older than 30 days");
      if (drill?.productionWasOverwritten !== false)
        failures.push("production approval record: recovery drill must confirm production was not overwritten");
      if (drill?.checks?.schemaMigrations !== true ||
          drill?.checks?.queryIntegrity !== true ||
          !drill?.checks?.criticalTableCounts ||
          Object.keys(drill.checks.criticalTableCounts).length === 0 ||
          Object.values(drill.checks.criticalTableCounts).some(
            (count) => !Number.isInteger(count) || count < 0,
          ))
        failures.push("production approval record: recovery drill integrity checks are incomplete");
      if (!nonEmpty(drill?.backupManifest)) {
        failures.push("production approval record: recovery drill backup manifest is required");
      } else {
        const backupPath = resolve(repositoryRoot, drill.backupManifest);
        if (!backupPath.startsWith(`${repositoryRoot}${sep}`) || !existsSync(backupPath)) {
          failures.push("production approval record: recovery drill backup manifest does not exist");
        } else {
          try {
            const backup = JSON.parse(readFileSync(backupPath, "utf8"));
            const recoveryPoint = backup.export?.sha256 ?? backup.recovery?.bookmark;
            if (drill.backupSourceRevision !== backup.sourceRevision ||
                drill.recoveryPoint !== recoveryPoint)
              failures.push("production approval record: recovery drill does not match its backup manifest");
          } catch {
            failures.push("production approval record: recovery drill backup manifest is invalid");
          }
        }
      }
      const thresholds = approval.monitoring?.thresholds;
      const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
      const nonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
      const thresholdChecks = [
        ["availability.windowMinutes", positive(thresholds?.availability?.windowMinutes)],
        ["availability.minimumPercent", positive(thresholds?.availability?.minimumPercent) && thresholds.availability.minimumPercent <= 100],
        ["latency.p95Ms", positive(thresholds?.latency?.p95Ms)],
        ["serverErrors.maximumPercent", nonNegative(thresholds?.serverErrors?.maximumPercent) && thresholds.serverErrors.maximumPercent <= 100],
        ["authentication.maximumFailures", nonNegative(thresholds?.authentication?.maximumFailures)],
        ["d1.maximumLatencyMs", positive(thresholds?.d1?.maximumLatencyMs)],
        ["r2.maximumAuthorizationFailures", nonNegative(thresholds?.r2?.maximumAuthorizationFailures)],
        ["queue.maximumLagSeconds", nonNegative(thresholds?.queue?.maximumLagSeconds)],
        ["dlq.maximumDepth", nonNegative(thresholds?.dlq?.maximumDepth)],
        ["dlq.maximumOldestAgeSeconds", nonNegative(thresholds?.dlq?.maximumOldestAgeSeconds)],
        ["backup.maximumAgeHours", positive(thresholds?.backup?.maximumAgeHours)],
        ["storage.maximumDailyGrowthPercent", positive(thresholds?.storage?.maximumDailyGrowthPercent)],
        ["moderation.maximumOldestOpenMinutes", positive(thresholds?.moderation?.maximumOldestOpenMinutes)],
      ];
      for (const [name, valid] of thresholdChecks) {
        if (!valid) failures.push(`production approval record: monitoring threshold ${name} is required`);
      }

      const requiredAlertSignals = new Set([
        "availability",
        "latency",
        "server-errors",
        "authentication-boundary",
        "d1",
        "r2-authorization",
        "queue-lag",
        "dlq",
        "backup-age",
        "storage-growth",
        "moderation-backlog",
      ]);
      const alertRules = Array.isArray(approval.monitoring?.alertRules)
        ? approval.monitoring.alertRules
        : [];
      for (const rule of alertRules) {
        if (typeof rule?.signal === "string") requiredAlertSignals.delete(rule.signal);
        if (!nonEmpty(rule?.owner) || rule.owner !== approval.monitoringOwner)
          failures.push(`production approval record: alert ${rule?.signal ?? "unknown"} owner must match monitoring owner`);
        if (!positive(rule?.responseMinutes))
          failures.push(`production approval record: alert ${rule?.signal ?? "unknown"} responseMinutes is required`);
        if (!new Set(["page", "ticket"]).has(rule?.severity))
          failures.push(`production approval record: alert ${rule?.signal ?? "unknown"} severity must be page or ticket`);
        if (!nonEmpty(rule?.runbook)) {
          failures.push(`production approval record: alert ${rule?.signal ?? "unknown"} runbook is required`);
        } else if (!/^https:\/\//u.test(rule.runbook)) {
          const runbookPath = resolve(repositoryRoot, rule.runbook);
          if (!runbookPath.startsWith(`${repositoryRoot}${sep}`) || !existsSync(runbookPath))
            failures.push(`production approval record: alert runbook does not exist: ${rule.runbook}`);
        }
        if (!nonEmpty(rule?.failClosedAction))
          failures.push(`production approval record: alert ${rule?.signal ?? "unknown"} failClosedAction is required`);
      }
      for (const signal of requiredAlertSignals)
        failures.push(`production approval record: alert rule ${signal} is required`);
      if (approval.monitoringOwner !== process.env.HUB_PRODUCTION_MONITORING_OWNER)
        failures.push("production approval record: monitoring owner does not match environment");
      if (approval.alertDestination !== process.env.HUB_PRODUCTION_ALERT_DESTINATION)
        failures.push("production approval record: alert destination does not match environment");
      if (approval.rollbackVersion !== process.env.HUB_PRODUCTION_ROLLBACK_VERSION)
        failures.push("production approval record: rollback version does not match environment");
    } catch (error) {
      failures.push(`production approval record is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}
const configPath = resolve(
  hubRoot,
  process.env.HUB_PRODUCTION_WRANGLER_CONFIG ?? "wrangler.production.jsonc",
);
if (!existsSync(configPath)) {
  failures.push(`production Wrangler config missing: ${configPath}`);
} else {
  const config = readFileSync(configPath, "utf8");
  const configSha256 = createHash("sha256").update(config).digest("hex");
  let parsedConfig = {};
  try {
    parsedConfig = JSON.parse(config);
  } catch {
    failures.push("production Wrangler config must be valid JSON");
  }
  const database = Array.isArray(parsedConfig.d1_databases)
    ? parsedConfig.d1_databases.find((item) => item?.binding === "HUB_DATABASE")
    : undefined;
  const mediaBucket = Array.isArray(parsedConfig.r2_buckets)
    ? parsedConfig.r2_buckets.find((item) => item?.binding === "HUB_MEDIA")
    : undefined;
  const jobsProducer = Array.isArray(parsedConfig.queues?.producers)
    ? parsedConfig.queues.producers.find((item) => item?.binding === "HUB_JOBS")
    : undefined;
  const jobsConsumer = Array.isArray(parsedConfig.queues?.consumers)
    ? parsedConfig.queues.consumers.find(
        (item) => item?.queue === jobsProducer?.queue,
      )
    : undefined;
  const requiredConfigValues = [
    [
      "HUB_PRODUCTION_DATABASE_ID",
      database?.database_id ?? "",
      /^[0-9a-f-]{36}$/iu,
    ],
    [
      "HUB_PRODUCTION_MEDIA_BUCKET",
      mediaBucket?.bucket_name ?? "",
      /^jkamma-hub-production-/u,
    ],
    [
      "HUB_PRODUCTION_JOBS_QUEUE",
      jobsProducer?.queue ?? "",
      /^jkamma-hub-production-jobs$/u,
    ],
    [
      "HUB_PRODUCTION_JOBS_DLQ",
      jobsConsumer?.dead_letter_queue ?? "",
      /^jkamma-hub-production-jobs-dlq$/u,
    ],
  ];

  for (const [environmentName, configValue, pattern] of requiredConfigValues) {
    if (!pattern.test(configValue))
      failures.push(
        `${environmentName}: invalid or missing in production Wrangler config`,
      );
    const assertedValue = String(process.env[environmentName] ?? "").trim();
    if (assertedValue && assertedValue !== configValue) {
      failures.push(
        `${environmentName}: does not match production Wrangler config`,
      );
    }
  }

  if (approvedRecord) {
    if (approvedRecord.wranglerConfigSha256 !== configSha256)
      failures.push("production approval record: Wrangler config checksum does not match");
    const resourceValues = {
      d1Database: requiredConfigValues[0][1],
      mediaBucket: requiredConfigValues[1][1],
      jobsQueue: requiredConfigValues[2][1],
      jobsDlq: requiredConfigValues[3][1],
    };
    for (const [name, value] of Object.entries(resourceValues)) {
      if (approvedRecord.resources?.[name] !== value)
        failures.push(`production approval record: resource ${name} does not match Wrangler config`);
    }
  }

  const publicOrigin = parsedConfig.vars?.HUB_PUBLIC_ORIGIN ?? "";
  try {
    const origin = new URL(publicOrigin);
    if (
      origin.protocol !== "https:" ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password
    ) {
      failures.push(
        "HUB_PRODUCTION_PUBLIC_ORIGIN: production Wrangler config must contain a credential-free HTTPS origin",
      );
    }
  } catch {
    failures.push(
      "HUB_PRODUCTION_PUBLIC_ORIGIN: invalid or missing in production Wrangler config",
    );
  }
  const assertedOrigin = String(
    process.env.HUB_PRODUCTION_PUBLIC_ORIGIN ?? "",
  ).trim();
  if (assertedOrigin && assertedOrigin !== publicOrigin) {
    failures.push(
      "HUB_PRODUCTION_PUBLIC_ORIGIN: does not match production Wrangler config",
    );
  }

  for (const pattern of [
    /"CLOUDFLARE_DEPLOYMENT_PHASE"\s*:\s*"scaffold"/,
    /"HUB_DEPLOYMENT_ENVIRONMENT"\s*:\s*"staging"/,
    /jkamma-hub-staging/,
    /static-demo/,
  ]) {
    if (pattern.test(config))
      failures.push(
        `production Wrangler config contains forbidden staging value: ${pattern}`,
      );
  }
  if (parsedConfig.vars?.CLOUDFLARE_DEPLOYMENT_PHASE !== "ready") {
    failures.push(
      'production Wrangler config must set CLOUDFLARE_DEPLOYMENT_PHASE to "ready"',
    );
  }
  if (parsedConfig.vars?.HUB_DEPLOYMENT_ENVIRONMENT !== "production") {
    failures.push(
      'production Wrangler config must set HUB_DEPLOYMENT_ENVIRONMENT to "production"',
    );
  }
  if (parsedConfig.workers_dev !== false)
    failures.push("production Wrangler config must disable workers.dev");
  if (parsedConfig.preview_urls !== false)
    failures.push("production Wrangler config must disable preview URLs");
  if (parsedConfig.observability?.enabled !== true)
    failures.push("production Wrangler config must enable observability");
  if (!jobsConsumer?.dead_letter_queue)
    failures.push(
      "production Wrangler config must configure a dead-letter queue",
    );
  if (parsedConfig.vars?.HUB_MAINTENANCE_MODE !== "true") {
    failures.push("initial production config must deploy in maintenance mode");
  }
  if (parsedConfig.vars?.HUB_SNS_CORE_ONLY !== "true") {
    failures.push(
      "initial production config must restrict traffic to the reviewed SNS core",
    );
  }
  for (const disabled of ["HUB_TIPS_ENABLED", "HUB_ADVERTISING_ENABLED"]) {
    if (parsedConfig.vars?.[disabled] !== "false") {
      failures.push(`initial production config must keep ${disabled} disabled`);
    }
  }
}

if (failures.length) {
  console.error(`Hub production readiness failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  "Hub production readiness: configuration and approval gate passed.",
);
