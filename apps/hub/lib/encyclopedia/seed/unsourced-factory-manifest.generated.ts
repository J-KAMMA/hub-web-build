import unsourcedBatch0 from "./unsourced-factory-unsourced-01.bilingual.json";

import type { FactoryUnsourcedRecord } from "@/lib/encyclopedia/factory-research";

export type UnsourcedFactoryRecord = FactoryUnsourcedRecord;

export const UNSOURCED_FACTORY_BATCHES: ReadonlyArray<{
  fileName: string;
  records: UnsourcedFactoryRecord[];
}> = [
  { fileName: "unsourced-factory-unsourced-01.bilingual.json", records: unsourcedBatch0 as UnsourcedFactoryRecord[] },
];

export const UNSOURCED_FACTORY_RECORDS = UNSOURCED_FACTORY_BATCHES.flatMap((batch) => batch.records);
