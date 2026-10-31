import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";

export type SurfaceKind = "concrete" | "stucco" | "stone" | "asphalt" | "wood" | "metal" | "glass" | "leaf" | "bark" | "paint" | "terracotta";
const surfaces = new WeakMap<Scene, Map<SurfaceKind, PBRMaterial>>();
const colors: Record<SurfaceKind, [number, number, number]> = {
  concrete: [0.58, 0.57, 0.53], stucco: [0.82, 0.79, 0.70], stone: [0.62, 0.61, 0.56],
  asphalt: [0.15, 0.16, 0.17], wood: [0.34, 0.21, 0.12], metal: [0.21, 0.23, 0.24],
  glass: [0.24, 0.39, 0.43], leaf: [0.16, 0.28, 0.10], bark: [0.30, 0.23, 0.16],
  paint: [0.86, 0.84, 0.73], terracotta: [0.61, 0.36, 0.29]
};
function noise(x: number, y: number) {
  let n = Math.imul(x + 413, 374761393) + Math.imul(y + 79, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Three independently authored maps: colour, tangent normal and surface roughness. */
export function streetMaterial(scene: Scene, kind: SurfaceKind): PBRMaterial {
  let cache = surfaces.get(scene);
  if (!cache) { cache = new Map(); surfaces.set(scene, cache); }
  const existing = cache.get(kind);
  if (existing) return existing;
  const mat = new PBRMaterial(`street:surface:${kind}`, scene);
  mat.albedoColor = new Color3(...colors[kind]);
  mat.metallic = kind === "metal" ? 0.85 : 0;
  mat.roughness = kind === "glass" ? 0.13 : kind === "metal" ? 0.32 : 0.84;
  if (kind === "leaf") { mat.backFaceCulling = false; mat.twoSidedLighting = true; }
  if (kind === "glass") {
    mat.metallic = 0.22;
    mat.environmentIntensity = 1.3;
    mat.clearCoat.isEnabled = true; mat.clearCoat.intensity = 0.8; mat.clearCoat.roughness = 0.08;
  } else {
    const size = 256, albedo = new Uint8Array(size * size * 4), normal = new Uint8Array(albedo.length), rough = new Uint8Array(albedo.length);
    const height = (x: number, y: number) => {
      x = (x + size) % size; y = (y + size) % size;
      const grain = noise(x, y);
      if (kind === "wood" || kind === "bark") return 0.5 + Math.sin(x * 0.42 + Math.sin(y * 0.03) * 1.3) * 0.16 + grain * 0.13;
      if (kind === "stone") return y % 64 < 2 || (x + (Math.floor(y / 64) % 2) * 64) % 128 < 2 ? 0.12 : 0.64 + grain * 0.12;
      return 0.52 + grain * (kind === "asphalt" ? 0.3 : 0.14);
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, h = height(x, y), grain = noise(x, y);
      const value = Math.round(Math.min(1, 0.77 + h * 0.2 + grain * 0.035) * 255);
      albedo.set([value, value, value, 255], i);
      const dx = (height(x - 1, y) - height(x + 1, y)) * 0.45;
      const dy = (height(x, y - 1) - height(x, y + 1)) * 0.45;
      const norm = Math.hypot(dx, dy, 1);
      normal.set([Math.round((dx / norm * 0.5 + 0.5) * 255), Math.round((dy / norm * 0.5 + 0.5) * 255), Math.round((1 / norm * 0.5 + 0.5) * 255), 255], i);
      rough.set([255, Math.round((0.7 + grain * 0.22) * 255), kind === "metal" ? 220 : 0, 255], i);
    }
    const texture = (name: string, data: Uint8Array, gamma: boolean) => {
      const tex = new RawTexture(data, size, size, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
      tex.name = `street:${kind}:${name}`; tex.gammaSpace = gamma; tex.anisotropicFilteringLevel = 8;
      return tex;
    };
    mat.albedoTexture = texture("albedo", albedo, true);
    mat.bumpTexture = texture("normal", normal, false);
    mat.metallicTexture = texture("roughness-metallic", rough, false);
    mat.useRoughnessFromMetallicTextureAlpha = false; mat.useRoughnessFromMetallicTextureGreen = true;
    mat.useMetallnessFromMetallicTextureBlue = true;
  }
  cache.set(kind, mat);
  mat.onDisposeObservable.addOnce(() => { if (cache?.get(kind) === mat) cache.delete(kind); });
  return mat;
}

/** Local environment illumination; no remote HDR or pre-existing asset. */
export function createStreetEnvironment(scene: Scene) {
  const size = 64, faces: Uint8Array[] = [];
  for (let face = 0; face < 6; face++) {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
      const direction = [[1,-v,-u],[-1,-v,u],[u,1,v],[u,-1,-v],[u,-v,1],[-u,-v,-1]][face]!;
      const length = Math.hypot(...direction), height = direction[1]! / length;
      const t = Math.pow(Math.max(0, height), 0.6);
      const sky = height > 0 ? [0.76 - t * 0.4, 0.79 - t * 0.22, 0.80 - t * 0.03] : [0.28, 0.26, 0.22];
      const sun = Math.pow(Math.max(0, (-direction[0]! * 0.4 + direction[1]! * 0.72 - direction[2]! * 0.56) / length), 100) * 0.45;
      data.set(sky.map((c, i) => Math.min(255, Math.round((c + sun * [1,0.86,0.67][i]!) * 255))).concat(255), (y * size + x) * 4);
    }
    faces.push(data);
  }
  const environment = new RawCubeTexture(scene, faces, size, Constants.TEXTUREFORMAT_RGBA, Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  environment.name = "street:authored-environment"; environment.gammaSpace = true;
  scene.environmentTexture = environment; scene.environmentIntensity = 0.85;
  return environment;
}
