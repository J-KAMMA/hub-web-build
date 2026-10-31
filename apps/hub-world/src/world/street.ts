import type { Blocker } from "./collide";

/** A compact, human-scale coastal street composition.  These footprints are
 * the single source used by both the server and renderer for ground-level
 * solids.  The road and square intentionally have no blockers. */
export type StreetSolid = {
  id: string;
  kind: "box" | "circle";
  x: number;
  z: number;
  width?: number;
  depth?: number;
  radius?: number;
  turn?: number;
  height: number;
};

export type StreetBuilding = StreetSolid & {
  kind: "box";
  width: number;
  depth: number;
  turn: number;
  height: number;
  side: "west" | "east";
  facade: "stucco" | "concrete";
  floors: 2 | 3;
};

export type StreetBench = StreetSolid & {
  kind: "box";
  width: number;
  depth: number;
  turn: number;
  height: number;
};

export type StreetPalm = StreetSolid & {
  kind: "circle";
  radius: number;
  height: number;
};

/** Two continuous, detailed street walls.  Their inner edges are x=-14 and
 * x=14, leaving an eight metre asphalt carriageway and two broad sidewalks. */
export const STREET_BUILDINGS: readonly StreetBuilding[] = [
  {
    id: "west-art-deco-wall",
    kind: "box",
    x: -19,
    z: 20,
    width: 10,
    depth: 30,
    turn: 0,
    height: 10.8,
    side: "west",
    facade: "stucco",
    floors: 3
  },
  {
    id: "east-art-deco-wall",
    kind: "box",
    x: 19,
    z: 20,
    width: 10,
    depth: 30,
    turn: 0,
    height: 9.4,
    side: "east",
    facade: "concrete",
    floors: 2
  }
];

export const STREET_BENCHES: readonly StreetBench[] = [
  { id: "square-bench-west", kind: "box", x: -8.2, z: 13.2, width: 3.6, depth: 0.72, turn: 0, height: 0.82 },
  { id: "square-bench-east", kind: "box", x: 8.2, z: 13.2, width: 3.6, depth: 0.72, turn: 0, height: 0.82 },
  { id: "square-bench-west-north", kind: "box", x: -8.2, z: 25.2, width: 3.6, depth: 0.72, turn: Math.PI, height: 0.82 },
  { id: "square-bench-east-north", kind: "box", x: 8.2, z: 25.2, width: 3.6, depth: 0.72, turn: Math.PI, height: 0.82 }
];

export const STREET_PALMS: readonly StreetPalm[] = [
  { id: "palm-west-square", kind: "circle", x: -9.2, z: 10.3, radius: 0.82, height: 0.78 },
  { id: "palm-east-square", kind: "circle", x: 9.2, z: 10.3, radius: 0.82, height: 0.78 },
  { id: "palm-west-north", kind: "circle", x: -9.2, z: 28.3, radius: 0.82, height: 0.78 },
  { id: "palm-east-north", kind: "circle", x: 9.2, z: 28.3, radius: 0.82, height: 0.78 }
];

export const STREET_SOLIDS: readonly StreetSolid[] = [
  ...STREET_BUILDINGS,
  ...STREET_BENCHES,
  ...STREET_PALMS
];

function blockerOf(solid: StreetSolid): Blocker {
  if (solid.kind === "circle") return { kind: "circle", x: solid.x, y: solid.z, radius: solid.radius! };
  return {
    kind: "box",
    x: solid.x,
    y: solid.z,
    width: solid.width!,
    depth: solid.depth!,
    turn: solid.turn!
  };
}

/** Shared by server movement and the Babylon scene. */
export const STREET_BLOCKERS: Blocker[] = STREET_SOLIDS.map(blockerOf);
