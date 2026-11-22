// «Доказ роботи» замість капчі: сервер дає виклик, браузер шукає число nonce, щоб
// sha256(виклик:nonce) починався з N нульових бітів. Гравцеві — десяті частки секунди (поки він пише),
// розсилачу спаму — та сама робота на кожне повідомлення. Без сторонніх сервісів і ключів.
// SHA-256 тут синхронний і свій: crypto.subtle асинхронний і на сотнях тисяч спроб у рази повільніший.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
const W = new Uint32Array(64);
const H = new Uint32Array(8);
const enc = new TextEncoder();

/** SHA-256 байтів → 8 слів стану (big-endian). Повертає внутрішній буфер: скопіюйте, якщо треба зберегти. */
export function sha256Words(msg: Uint8Array): Uint32Array {
  const len = msg.length, blocks = ((len + 9 + 63) >> 6), buf = new Uint8Array(blocks * 64);
  buf.set(msg); buf[len] = 0x80;
  const bits = len * 8, dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(bits / 0x100000000)); dv.setUint32(buf.length - 4, bits >>> 0);
  H.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(b * 64 + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15] as number, w2 = W[i - 2] as number;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = ((W[i - 16] as number) + s0 + (W[i - 7] as number) + s1) | 0;
    }
    let a = H[0] as number, bb = H[1] as number, c = H[2] as number, d = H[3] as number, e = H[4] as number, f = H[5] as number, g = H[6] as number, h = H[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + (K[i] as number) + (W[i] as number)) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] as number) + a; H[1] = (H[1] as number) + bb; H[2] = (H[2] as number) + c; H[3] = (H[3] as number) + d;
    H[4] = (H[4] as number) + e; H[5] = (H[5] as number) + f; H[6] = (H[6] as number) + g; H[7] = (H[7] as number) + h;
  }
  return H;
}

export function sha256Hex(s: string): string {
  return Array.from(sha256Words(enc.encode(s)), (w) => (w >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Скільки нульових бітів на початку хешу. */
export function leadingZeroBits(words: Uint32Array): number {
  let n = 0;
  for (const w of words) { if (w === 0) { n += 32; continue; } return n + Math.clz32(w); }
  return n;
}

/**
 * Знайти nonce для виклику: працює шматками й віддає керування браузеру, щоб гра й інтерфейс не завмирали.
 * signal — скасувати, якщо гравець закрив форму.
 */
export async function solvePow(challenge: string, bits: number, signal?: AbortSignal, sliceMs = 12): Promise<string> {
  const prefix = enc.encode(challenge + ':');
  const buf = new Uint8Array(prefix.length + 12);
  buf.set(prefix);
  for (let nonce = 0; ; ) {
    const end = performance.now() + sliceMs;
    while (performance.now() < end) {
      for (let k = 0; k < 256; k++, nonce++) {
        const digits = enc.encodeInto(nonce.toString(36), buf.subarray(prefix.length)).written;
        if (leadingZeroBits(sha256Words(buf.subarray(0, prefix.length + digits))) >= bits) return nonce.toString(36);
      }
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await new Promise((r) => setTimeout(r, 0));
  }
}
