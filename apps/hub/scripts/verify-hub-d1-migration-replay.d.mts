export type SchemaManifest = {
  entries: Array<{ type: string; name: string; sql: string }>;
  fingerprint: string;
};

export function findDanglingTriggerReferences(schema: SchemaManifest): Array<{
  trigger: string;
  missingRelation: string;
}>;

export function findDanglingForeignKeyReferences(schema: SchemaManifest): Array<{
  sourceTable: string;
  missingRelation: string;
}>;

export function replayMigrationFiles(migrationDir: string, names: string[]): {
  status: "ok" | "blocked";
  databaseChanged: false;
  replayedCount: number;
  failedMigration: string | null;
  failure: string | null;
  schema: SchemaManifest;
  danglingTriggerReferences: Array<{ trigger: string; missingRelation: string }>;
  danglingForeignKeyReferences: Array<{ sourceTable: string; missingRelation: string }>;
};

export function compareSchemas(activeSchema: SchemaManifest, replaySchema: SchemaManifest): {
  activeOnly: string[];
  replayOnly: string[];
  definitionMismatches: string[];
};

export function verifyLocalMigrationReplay(
  projectDir: string,
  binding?: string,
  options?: { all?: boolean },
): unknown;
