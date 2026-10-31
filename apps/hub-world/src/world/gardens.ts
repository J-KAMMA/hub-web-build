import type { Blocker } from "./collide";

export type GardenTree = { x: number; z: number; size: number; palm: boolean };
export function gardenTrees(zone: string): GardenTree[] {
  if (zone === "route") return [-1, 1].flatMap(side => Array.from({ length: 8 }, (_, i) => ({
    x: side * (10 + (i % 2) * 3), z: -35 + i * 10, size: 5.5 + (i % 3) * 0.4, palm: false
  })));
  if (zone === "shore") return [-1, 1].flatMap(side => Array.from({ length: 5 }, (_, i) => ({
    x: side * (13 + (i % 2) * 5), z: -24 + i * 11, size: 7 + (i % 3), palm: true
  })));
  return Array.from({ length: 36 }, (_, i) => {
    const angle = i * 2.399963;
    const radius = 10 + (i % 5) * 5.2;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, size: 6 + (i % 4), palm: false };
  });
}
export function gardenBlockers(zone: string): Blocker[] {
  return gardenTrees(zone).map(tree => ({ kind: "circle", x: tree.x, y: tree.z, radius: 1.3 }));
}
