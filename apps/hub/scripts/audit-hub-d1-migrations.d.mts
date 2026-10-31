export type MigrationManifestEntry = {
  name: string;
  prefix: string;
  sha256: string;
};

export type MigrationManifest = {
  entries: MigrationManifestEntry[];
  duplicatePrefixes: Array<{ prefix: string; names: string[] }>;
  fingerprint: string;
};

export type MigrationAuditBlocker = {
  code: string;
  detail: unknown;
};

export type MigrationAuditResult = {
  status: "ok" | "pending" | "blocked";
  databaseChanged: false;
  appliedCount: number;
  lastAppliedName: string | null;
  pending: string[];
  retroactivePending: string[];
  canonicalOnly: string[];
  runtimeOnly: string[];
  hashMismatches: string[];
  duplicatePrefixes: Array<{ prefix: string; names: string[] }>;
  runtimeManifestFingerprint: string;
  canonicalManifestFingerprint: string;
  schema: { objectCount: number; fingerprint: string };
  blockers: MigrationAuditBlocker[];
};

export function createMigrationManifest(migrationDir: string): MigrationManifest;

export function auditMigrationSnapshot(input: {
  runtimeManifest: MigrationManifest;
  canonicalManifest?: MigrationManifest;
  ledgerRows: Array<{ id: number; name: string }>;
  schemaRows?: Array<{ type: string; name: string; sql: string }>;
}): MigrationAuditResult;

export function runLocalAudit(projectDir: string, binding?: string): MigrationAuditResult;
