export type TagBackfillStatement = { sql: string; params: unknown[] };

export type TagBackfillDb = {
  all: (sql: string, params?: unknown[]) => Promise<Record<string, any>[]> | Record<string, any>[];
};

export type TagBackfillCounts = {
  tagsRenamed: number;
  tagsMerged: number;
  tagsSkippedInvalid: number;
  linksAdded: Record<string, number>;
  linksRemoved: Record<string, number>;
  followsKeyed: number;
  statements: number;
};

export function runTagBackfill(
  db: TagBackfillDb,
  options?: {
    dryRun?: boolean;
    batchSize?: number;
    now?: string;
    onBatch?: (statements: TagBackfillStatement[]) => Promise<void> | void;
  },
): Promise<TagBackfillCounts>;

export function statementToSql(statement: TagBackfillStatement): string;
