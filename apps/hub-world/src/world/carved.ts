import { STREET_BLOCKERS } from "./street";
import { gardenBlockers } from "./gardens";

/** Current authored geometry is the source of truth; no legacy GLB blockers are loaded. */
export const CARVED: Record<string, unknown[]> = {
  city: STREET_BLOCKERS,
  route: gardenBlockers("route"),
  forest: gardenBlockers("forest"),
  shore: gardenBlockers("shore")
};
