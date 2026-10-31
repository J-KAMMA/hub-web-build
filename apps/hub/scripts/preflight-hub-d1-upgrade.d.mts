export function classifySchemaObjects(schemaRows: Array<{ type: string; name: string; sql: string }>): {
  tables: Array<{ type: string; name: string; sql: string }>;
  virtualTables: Array<{ type: string; name: string; sql: string }>;
  indexes: Array<{ type: string; name: string; sql: string }>;
  triggers: Array<{ type: string; name: string; sql: string }>;
  views: Array<{ type: string; name: string; sql: string }>;
  skippedShadowTables: string[];
};

export function buildActiveCloneSql(input: {
  schemaRows: Array<{ type: string; name: string; sql: string }>;
  tables: Array<{ name: string; rows: Array<Record<string, unknown>> }>;
  ledgerRows: Array<{ id: number; name: string }>;
  ledgerTableSql: string;
}): { sql: string; classified: ReturnType<typeof classifySchemaObjects> };

export function runUpgradePreflight(hubDirectory: string, archive: string): unknown;
