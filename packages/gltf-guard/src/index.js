/**
 * 持ち込みの .glb を検める。
 *
 * **走査器はマルウェアを見るが、glTF そのものの罠は見ない。** MetaDefender を
 * 通っても、次のものは素通りする:
 *
 * - 実際の長さと食い違う長さを名乗るファイル（読む側が範囲外を読む）
 * - 元のバッファをはみ出す参照（同上）
 * - 外の場所を指す uri（開いた人の browser に、こちらの知らない所へ取りに行かせる）
 * - 圧縮拡張（Draco / meshopt / KTX2）——**解く器がそのまま攻撃面**になる
 * - 桁外れの頂点数・テクスチャ量（開いた全員の画面が落ちる）
 *
 * ここは**バイト列と数だけ**を見る。描画も、取得も、ファイル系も読まない。
 * Worker でも Node でも同じように動く。
 *
 * 使い方は2段:
 *
 *   inspect(bytes, budget)  … 通るかどうかと、その理由
 *   clean(bytes, budget)    … 通ったものを、**知っている項目だけで書き直す**
 *
 * 書き直すのが要点。検めを通っても、知らない項目や詰め物に何かが残っている
 * ことはある。**受け取ったバイト列をそのまま配らない。**
 */

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/**
 * 世界で使う既定の予算。
 *
 * **1人の買い物で、その区画に居る全員の画面が落ちる。** 上限は品物ごとに
 * 決めるのではなく、置かれる場所の側が決める。
 */
export const WORLD_BUDGET = {
  /** ファイル全体（バイト）。 */
  bytes: 2 * 1024 * 1024,
  /** JSON の部分（バイト）。ここだけで数百MBのものがある。 */
  jsonBytes: 512 * 1024,
  /**
   * 頂点の総数。
   *
   * **街1つぶんより軽くする。** 実測で、彫った街が 57,476 頂点、道路が 73,992。
   * 置かれる物1つがそれに並ぶと、立っている街より重い物が道端にあることになる。
   */
  vertices: 20_000,
  /** 面の総数。 */
  triangles: 40_000,
  /** 節点の数。多いと、それだけで描画が詰まる。 */
  nodes: 400,
  /** メッシュの数。**描画呼び出しの数がこれで決まる。** */
  meshes: 40,
  /** 絵の数と、その合計バイト。 */
  images: 8,
  imageBytes: 1536 * 1024,
  /** 動きの数と、骨の数。 */
  animations: 8,
  joints: 128,
  /** 材質の数。 */
  materials: 24
};

/**
 * 通してよい拡張。
 *
 * **圧縮系は入れない。** Draco も meshopt も KTX2 も、解く器を通ることになる。
 * 解く器は C で書かれた大きな塊で、そこが破られると、開いた全員が巻き込まれる。
 * 見た目のための拡張だけを通す。
 */
export const ALLOWED_EXTENSIONS = new Set([
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_texture_transform",
  "KHR_materials_unlit"
]);

/** 型ごとの成分数。accessor の大きさを出すのに要る。 */
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
/** 成分の型ごとのバイト数。 */
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

class Refusal extends Error {}

function refuse(reason) {
  throw new Refusal(reason);
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  refuse("バイト列ではありません");
}

/**
 * 殻を開ける。**名乗った長さを信じない。**
 *
 * 実際の長さより大きい長さを名乗るファイルは、読む側に範囲外を読ませる
 * ための古い手。ここで落とす。
 */
function open(bytes, budget) {
  if (bytes.length < 12) refuse("短すぎます");
  if (bytes.length > budget.bytes) refuse(`大きすぎます（${budget.bytes} バイトまで）`);

  const head = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (head.getUint32(0, true) !== MAGIC) refuse("glb ではありません");
  if (head.getUint32(4, true) !== 2) refuse("glTF 2.0 ではありません");
  const declared = head.getUint32(8, true);
  if (declared !== bytes.length) refuse("名乗った長さと実際の長さが違います");

  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= bytes.length) {
    const length = head.getUint32(at, true);
    const kind = head.getUint32(at + 4, true);
    at += 8;
    // **足し算で溢れさせない。** 引き算で比べる。
    if (length > bytes.length - at) refuse("塊が本体からはみ出しています");
    const part = bytes.subarray(at, at + length);
    if (kind === JSON_CHUNK) {
      if (json) refuse("JSON の塊が2つあります");
      if (length > budget.jsonBytes) refuse(`JSON が大きすぎます（${budget.jsonBytes} バイトまで）`);
      json = part;
    } else if (kind === BIN_CHUNK) {
      if (bin) refuse("BIN の塊が2つあります");
      bin = part;
    }
    // 知らない塊は読まない。**書き直すときに落ちる。**
    at += length + ((4 - (length % 4)) % 4);
  }
  if (!json) refuse("JSON の塊がありません");
  return { json, bin };
}

function parse(json) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(json);
  } catch {
    refuse("JSON が UTF-8 ではありません");
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse("JSON として読めません");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) refuse("JSON の形が違います");
  return doc;
}

const list = (value) => (Array.isArray(value) ? value : []);

/**
 * 外を指す参照を許さない。
 *
 * **これを通すと、開いた人の browser に、こちらの知らない所へ取りに行かせる
 * ことになる。** 見た人の側の所在が漏れるし、後から中身を差し替えられる。
 * 埋め込みの data: だけを通す。
 */
function checkUris(doc, budget) {
  let dataBytes = 0;
  for (const where of ["buffers", "images"]) {
    for (const one of list(doc[where])) {
      const uri = one?.uri;
      if (uri === undefined) continue;
      if (typeof uri !== "string") refuse("uri の形が違います");
      if (!uri.startsWith("data:")) refuse(`外を指す参照は通せません（${where}）`);
      // data: の実体もバイト数に数える。**ここだけ野放しにすると、
      // ファイル全体の上限を JSON の中で回避できる。**
      dataBytes += uri.length;
      if (dataBytes > budget.imageBytes) refuse("埋め込みの絵が大きすぎます");
    }
  }
  return dataBytes;
}

/**
 * 参照が元の入れ物に収まっているか。
 *
 * **これが glTF でいちばん多い範囲外読み出し。** bufferView が buffer から
 * はみ出す、accessor が bufferView からはみ出す。読む側は素直に信じるので、
 * 渡す前に確かめる。
 */
function checkRanges(doc, bin) {
  const buffers = list(doc.buffers);
  const views = list(doc.bufferViews);

  buffers.forEach((buffer, index) => {
    const length = buffer?.byteLength;
    if (!Number.isSafeInteger(length) || length < 0) refuse("buffer の長さの形が違います");
    // 最初の buffer で uri を持たないものが BIN の塊。
    if (buffer?.uri === undefined) {
      if (!bin) refuse("BIN の塊がないのに、それを指す buffer があります");
      if (length > bin.length) refuse(`buffer ${index} が BIN の塊より長いと名乗っています`);
    }
  });

  views.forEach((view, index) => {
    const target = buffers[view?.buffer];
    if (!target) refuse(`bufferView ${index} が無い buffer を指しています`);
    const offset = view?.byteOffset ?? 0;
    const length = view?.byteLength;
    if (!Number.isSafeInteger(offset) || offset < 0) refuse("bufferView の位置の形が違います");
    if (!Number.isSafeInteger(length) || length < 0) refuse("bufferView の長さの形が違います");
    if (offset > target.byteLength || length > target.byteLength - offset) {
      refuse(`bufferView ${index} が buffer からはみ出しています`);
    }
  });

  let vertices = 0;
  list(doc.accessors).forEach((accessor, index) => {
    const count = accessor?.count;
    if (!Number.isSafeInteger(count) || count < 0) refuse("accessor の数の形が違います");
    const components = COMPONENTS[accessor?.type];
    const width = COMPONENT_BYTES[accessor?.componentType];
    if (!components || !width) refuse(`accessor ${index} の型が分かりません`);
    if (accessor.bufferView === undefined) return;
    const view = views[accessor.bufferView];
    if (!view) refuse(`accessor ${index} が無い bufferView を指しています`);
    const stride = view.byteStride ?? components * width;
    if (!Number.isSafeInteger(stride) || stride <= 0) refuse("byteStride の形が違います");
    const offset = accessor.byteOffset ?? 0;
    // 最後の1つは実寸ぶんだけ要る。stride で数えると、末尾で余計に要求してしまう。
    const need = count === 0 ? 0 : (count - 1) * stride + components * width;
    const room = view.byteLength ?? 0;
    if (offset > room || need > room - offset) {
      refuse(`accessor ${index} が bufferView からはみ出しています`);
    }
  });

  for (const mesh of list(doc.meshes)) {
    for (const part of list(mesh?.primitives)) {
      const position = list(doc.accessors)[part?.attributes?.POSITION];
      if (position) vertices += position.count ?? 0;
    }
  }
  return vertices;
}

/** 面の数。indices があればそこから、無ければ頂点から。 */
function countTriangles(doc) {
  const accessors = list(doc.accessors);
  let triangles = 0;
  for (const mesh of list(doc.meshes)) {
    for (const part of list(mesh?.primitives)) {
      // mode の既定は 4（三角形）。
      const mode = part?.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      const source = part?.indices !== undefined
        ? accessors[part.indices]
        : accessors[part?.attributes?.POSITION];
      const count = source?.count ?? 0;
      triangles += mode === 4 ? Math.floor(count / 3) : Math.max(0, count - 2);
    }
  }
  return triangles;
}

/**
 * 検める。**通らない理由を返す。**
 *
 * 世界へ入る許可と違い、これは出品する人が直せるもの。理由が分からないと
 * 直しようがない。
 */
export function inspect(input, budget = WORLD_BUDGET) {
  try {
    const bytes = asBytes(input);
    const { json, bin } = open(bytes, budget);
    const doc = parse(json);

    // **必要と言われた拡張は、全部知っていなければならない。**
    // 知らないまま通すと、解く器のある閲覧器でだけ別のものが動く。
    for (const name of list(doc.extensionsRequired)) {
      if (!ALLOWED_EXTENSIONS.has(name)) refuse(`通せない拡張です: ${name}`);
    }
    for (const name of list(doc.extensionsUsed)) {
      if (!ALLOWED_EXTENSIONS.has(name)) refuse(`通せない拡張です: ${name}`);
    }

    const embedded = checkUris(doc, budget);
    const vertices = checkRanges(doc, bin);
    const triangles = countTriangles(doc);

    const counted = {
      bytes: bytes.length,
      jsonBytes: json.length,
      vertices,
      triangles,
      nodes: list(doc.nodes).length,
      meshes: list(doc.meshes).length,
      images: list(doc.images).length,
      imageBytes: embedded,
      animations: list(doc.animations).length,
      materials: list(doc.materials).length,
      joints: list(doc.skins).reduce((most, one) => Math.max(most, list(one?.joints).length), 0)
    };
    for (const [key, value] of Object.entries(counted)) {
      if (budget[key] !== undefined && value > budget[key]) {
        refuse(`${key} が多すぎます（${value} / ${budget[key]}）`);
      }
    }
    return { ok: true, counted, doc, bin };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    // **中で何が起きても、落とさない。** 持ち込みを読む場所なので、
    // 例外がそのまま外へ出ると、それ自体が落とし方になる。
    return { ok: false, reason: "読めません" };
  }
}

/**
 * 知っている項目だけを残す。
 *
 * **検めを通ったバイト列を、そのまま配らない。** 知らない項目、拡張の中身、
 * 塊の詰め物——どれも検めの外側で、後から意味を持ち得る場所。
 */
const KEEP = [
  "asset", "scene", "scenes", "nodes", "meshes", "accessors", "bufferViews",
  "buffers", "materials", "textures", "images", "samplers", "skins", "animations",
  "cameras", "extensionsUsed", "extensionsRequired"
];

/**
 * 書き直す。**通ったものだけ。**
 *
 * 返るのは新しい .glb。元のバイト列は捨てる。
 */
export function clean(input, budget = WORLD_BUDGET) {
  const seen = inspect(input, budget);
  if (!seen.ok) return seen;

  const kept = {};
  for (const key of KEEP) {
    if (seen.doc[key] !== undefined) kept[key] = seen.doc[key];
  }
  // asset は必須。無いものを作らず、最小で足す。
  kept.asset = { version: "2.0", generator: "jkamma gltf-guard" };

  const json = new TextEncoder().encode(JSON.stringify(kept));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const bin = seen.bin ?? null;
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;

  const total = 12 + 8 + json.length + jsonPad + (bin ? 8 + bin.length + binPad : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, json.length + jsonPad, true);
  view.setUint32(16, JSON_CHUNK, true);
  out.set(json, 20);
  // JSON の詰め物は空白、BIN の詰め物は 0。仕様で決まっている。
  out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);

  if (bin) {
    const at = 20 + json.length + jsonPad;
    view.setUint32(at, bin.length + binPad, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    out.set(bin, at + 8);
  }
  return { ok: true, counted: seen.counted, bytes: out };
}
