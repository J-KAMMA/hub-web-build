/*
 * 大きなファイルの SHA-256 を、全体をメモリに載せずに求める（2026-10-18）。
 * SubtleCrypto は分割して食わせられないため、ここで小さな実装を持つ。
 * ゲームのビルド（最大1GB）の登録に使う。結果は crypto を使う実装と一致することをテストで確かめる。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

export class Sha256 {
  private readonly state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  private length = 0;

  update(data: Uint8Array): this {
    this.length += data.length;
    let offset = 0;
    if (this.filled) {
      const take = Math.min(64 - this.filled, data.length);
      this.block.set(data.subarray(0, take), this.filled);
      this.filled += take;
      offset = take;
      if (this.filled < 64) return this;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; offset + 64 <= data.length; offset += 64) this.compress(data, offset);
    if (offset < data.length) {
      this.block.set(data.subarray(offset));
      this.filled = data.length - offset;
    }
    return this;
  }

  digestHex(): string {
    const bitLength = this.length * 8;
    const pad = new Uint8Array(((this.filled < 56 ? 56 : 120) - this.filled) + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(pad.length - 4, bitLength >>> 0);
    const length = this.length;
    this.update(pad);
    this.length = length;
    return [...this.state].map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  private compress(source: Uint8Array, offset: number) {
    const w = this.words;
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((source[j] << 24) | (source[j + 1] << 16) | (source[j + 2] << 8) | source[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const s = this.state;
    s[0] += a; s[1] += b; s[2] += c; s[3] += d; s[4] += e; s[5] += f; s[6] += g; s[7] += h;
  }
}

/** SHA-256 (hex) of a File or Blob, read in chunks so a 1 GB build never sits in memory at once. */
export async function sha256OfFile(file: Blob, onProgress?: (done: number) => void): Promise<string> {
  const hash = new Sha256();
  const chunk = 4 * 1024 * 1024;
  for (let start = 0; start < file.size; start += chunk) {
    hash.update(new Uint8Array(await file.slice(start, Math.min(start + chunk, file.size)).arrayBuffer()));
    onProgress?.(Math.min(start + chunk, file.size));
  }
  return hash.digestHex();
}
