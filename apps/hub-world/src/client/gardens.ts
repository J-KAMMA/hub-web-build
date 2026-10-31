import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTube } from "@babylonjs/core/Meshes/Builders/tubeBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { gardenTrees } from "../world/gardens";

export function buildGarden(scene: Scene, zone: string, radius: number) {
  const material = (name: string, hex: string) => {
    const skin = new StandardMaterial(`garden:${name}`, scene);
    skin.diffuseColor = Color3.FromHexString(hex); skin.specularColor.set(0.02, 0.02, 0.02);
    return skin;
  };
  const stone = material("stone", "#c5bba2"), bark = material("bark", "#68563d");
  const leaves = ["#667753", "#7d8a5d", "#4d6b50"].map((hex, i) => material(`leaves-${i}`, hex));
  for (const leaf of leaves) leaf.backFaceCulling = false;
  const land = material("land", zone === "shore" ? "#d8c69d" : "#81916d");
  const finish = (mesh: Mesh, skin: StandardMaterial, cast = true) => {
    mesh.material = skin; mesh.isPickable = false; mesh.receiveShadows = true;
    mesh.metadata = { castShadow: cast }; mesh.freezeWorldMatrix(); return mesh;
  };
  const ground = CreateGround("garden:ground", { width: radius * 2.2, height: radius * 2.2 }, scene);
  finish(ground, land, false);
  const path = CreateBox("garden:path", { width: 5, depth: radius * 2, height: 0.02 }, scene);
  path.position.y = 0.005; finish(path, stone, false);
  for (const [i, tree] of gardenTrees(zone).entries()) {
    const bed = CreateCylinder(`garden:bed-${i}`, { diameter: 2.6, height: 0.34, tessellation: 24 }, scene);
    bed.position.set(tree.x, 0.17, tree.z); finish(bed, stone);
    const trunk = CreateCylinder(`garden:trunk-${i}`, { diameterBottom: 0.46, diameterTop: 0.2, height: tree.size * 0.74, tessellation: 9 }, scene);
    trunk.position.set(tree.x, tree.size * 0.37, tree.z); finish(trunk, bark);
    if (tree.palm) {
      for (let j = 0; j < 10; j++) {
        const angle = j * Math.PI * 2 / 10 + i;
        const positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8; const distance = t * 4.4;
          const width = Math.sin(t * Math.PI) * 0.52;
          const y = tree.size * 0.74 + Math.sin(t * Math.PI) * 1.4 - t * 1.4;
          for (const sign of [-1, 1]) {
            positions.push(tree.x + Math.cos(angle) * distance + Math.sin(angle) * width * sign, y,
              tree.z + Math.sin(angle) * distance - Math.cos(angle) * width * sign);
            uvs.push(sign < 0 ? 0 : 1, t);
          }
          if (k < 8) { const n = k * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
        }
        const data = new VertexData(); data.positions = positions; data.indices = indices; data.uvs = uvs;
        VertexData.ComputeNormals(positions, indices, normals); data.normals = normals;
        const frond = new Mesh(`garden:frond-${i}-${j}`, scene); data.applyToMesh(frond); finish(frond, leaves[j % 3]!);
      }
    } else {
      for (let j = 0; j < 9; j++) {
        const angle = j * 2.4 + i; const spread = 1.1 + j % 3 * 0.5;
        const end = new Vector3(tree.x + Math.cos(angle) * spread, tree.size * 0.66 + (j % 3) * 0.55, tree.z + Math.sin(angle) * spread);
        const branch = CreateTube(`garden:branch-${i}-${j}`, { path: [new Vector3(tree.x, tree.size * 0.48, tree.z), end], radius: 0.09, tessellation: 5 }, scene);
        finish(branch, bark);
        const crown = CreateSphere(`garden:leaf-${i}-${j}`, { diameter: 2.8, segments: 5 }, scene);
        crown.position.copyFrom(end); crown.scaling.set(1, 0.8, 0.9); finish(crown, leaves[j % 3]!);
      }
    }
  }
  // Merge only static opaque surfaces; tree silhouettes remain geometry, not billboards.
  for (const skin of [stone, bark, ...leaves, land]) {
    const meshes = scene.meshes.filter(mesh => mesh.name.startsWith("garden:") && mesh.material === skin) as Mesh[];
    if (meshes.length > 1) {
      const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
      if (merged) { merged.name = `garden:merged-${skin.name}`; merged.receiveShadows = true; merged.metadata = { castShadow: skin !== land && skin !== stone }; }
    }
  }
}
