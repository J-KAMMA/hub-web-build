import type { Blocker } from "./collide";

/**
 * Shared footprint records for the social plaza.
 *
 * Coordinates are x/z in the renderer and x/y in `Blocker`. The client builds
 * every low solid from these records so rendered furniture cannot drift away
 * from the server collision map.
 */
export type PlazaSolid = {
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

export type PlazaBuilding = PlazaSolid & {
  kind: "box";
  width: number;
  depth: number;
  turn: number;
  height: number;
  palette: "cream" | "terracotta";
  roof: "flat" | "gable";
  style: "arcade" | "landmark" | "storefront";
};

export type PlazaPlanter = PlazaSolid & {
  kind: "circle";
  radius: number;
  height: number;
  tree: "olive";
};

export type PlazaBench = PlazaSolid & {
  kind: "box";
  width: number;
  depth: number;
  turn: number;
  height: number;
  facing: number;
};

export type PlazaCafePocket = PlazaSolid & {
  kind: "circle";
  radius: number;
  height: number;
  canopy: "ochre" | "teal";
};

/**
 * The north composition stays clear of both five metre approach paths. The
 * landmark is deliberately slim and tall, while the arcade and storefronts
 * establish a human-scale street wall around it.
 */
export const PLAZA_BUILDINGS: readonly PlazaBuilding[] = [
  {
    id: "north-limestone-arcade",
    kind: "box",
    x: -14,
    z: 22,
    width: 14,
    depth: 6.4,
    turn: 0,
    height: 6.8,
    palette: "cream",
    roof: "flat",
    style: "arcade"
  },
  {
    id: "three-storey-slim-landmark",
    kind: "box",
    x: -27,
    z: 29,
    width: 7.2,
    depth: 6.8,
    turn: 0,
    height: 9.2,
    palette: "cream",
    roof: "gable",
    style: "landmark"
  },
  {
    id: "west-terracotta-storefront",
    kind: "box",
    x: -24,
    z: 18,
    width: 10.5,
    depth: 6.4,
    turn: 0,
    height: 5.8,
    palette: "terracotta",
    roof: "flat",
    style: "storefront"
  },
  {
    id: "east-cream-storefront",
    kind: "box",
    x: 24,
    z: 18,
    width: 10.5,
    depth: 6.4,
    turn: 0,
    height: 5.8,
    palette: "cream",
    roof: "flat",
    style: "storefront"
  }
];

/** Conversation pockets flank the centre while leaving both cross paths open. */
export const PLAZA_PLANTERS: readonly PlazaPlanter[] = [
  { id: "planter-west-north", kind: "circle", x: -13, z: 8, radius: 1.9, height: 0.62, tree: "olive" },
  { id: "planter-east-north", kind: "circle", x: 13, z: 8, radius: 1.9, height: 0.62, tree: "olive" },
  { id: "planter-west-south", kind: "circle", x: -13, z: -11, radius: 1.9, height: 0.62, tree: "olive" },
  { id: "planter-east-south", kind: "circle", x: 13, z: -11, radius: 1.9, height: 0.62, tree: "olive" }
];

export const PLAZA_BENCHES: readonly PlazaBench[] = [
  { id: "bench-west-north", kind: "box", x: -13, z: 11.8, width: 4.8, depth: 0.9, turn: 0, height: 0.78, facing: 0 },
  { id: "bench-east-north", kind: "box", x: 13, z: 11.8, width: 4.8, depth: 0.9, turn: 0, height: 0.78, facing: 0 },
  { id: "bench-west-south", kind: "box", x: -13, z: -14.8, width: 4.8, depth: 0.9, turn: Math.PI, height: 0.78, facing: Math.PI },
  { id: "bench-east-south", kind: "box", x: 13, z: -14.8, width: 4.8, depth: 0.9, turn: Math.PI, height: 0.78, facing: Math.PI }
];

/** Outdoor cafe geometry is entirely contained by these shared circles. */
export const PLAZA_CAFE_POCKETS: readonly PlazaCafePocket[] = [
  { id: "cafe-west-terrace", kind: "circle", x: -24, z: 11.1, radius: 2.35, height: 0.82, canopy: "ochre" },
  { id: "cafe-east-terrace", kind: "circle", x: 24, z: 11.1, radius: 2.35, height: 0.82, canopy: "teal" }
];

/** A detailed stone fountain, intentionally offset from the spawn axis. */
export const PLAZA_FOUNTAIN: PlazaSolid = {
  id: "fountain",
  kind: "circle",
  x: 8,
  z: 11,
  radius: 3,
  height: 0.7
};

export const PLAZA_SOLIDS: readonly PlazaSolid[] = [
  ...PLAZA_BUILDINGS,
  ...PLAZA_PLANTERS,
  ...PLAZA_BENCHES,
  ...PLAZA_CAFE_POCKETS,
  PLAZA_FOUNTAIN
];

function blockerOf(solid: PlazaSolid): Blocker {
  if (solid.kind === "circle") {
    return { kind: "circle", x: solid.x, y: solid.z, radius: solid.radius! };
  }
  return {
    kind: "box",
    x: solid.x,
    y: solid.z,
    width: solid.width!,
    depth: solid.depth!,
    turn: solid.turn!
  };
}

/** Server and renderer share this exact list. */
export const PLAZA_BLOCKERS: Blocker[] = PLAZA_SOLIDS.map(blockerOf);
