import "server-only";

import { drizzle } from "drizzle-orm/d1";

import { getHubD1 } from "@/lib/server/hub-d1";
import * as schema from "./schema";

export function getDb() {
  return drizzle(getHubD1(), { schema });
}
