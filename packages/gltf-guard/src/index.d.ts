export type Budget = {
  bytes: number;
  jsonBytes: number;
  vertices: number;
  triangles: number;
  nodes: number;
  meshes: number;
  images: number;
  imageBytes: number;
  animations: number;
  joints: number;
  materials: number;
};

export type Counted = {
  bytes: number;
  jsonBytes: number;
  vertices: number;
  triangles: number;
  nodes: number;
  meshes: number;
  images: number;
  imageBytes: number;
  animations: number;
  materials: number;
  joints: number;
};

export type Inspected =
  | { ok: true; counted: Counted; doc: Record<string, unknown>; bin: Uint8Array | null }
  | { ok: false; reason: string };

export type Cleaned =
  | { ok: true; counted: Counted; bytes: Uint8Array }
  | { ok: false; reason: string };

export declare const WORLD_BUDGET: Budget;
export declare const ALLOWED_EXTENSIONS: Set<string>;

export declare function inspect(input: Uint8Array | ArrayBuffer, budget?: Budget): Inspected;
export declare function clean(input: Uint8Array | ArrayBuffer, budget?: Budget): Cleaned;
