/** CPython 3 random.Random for integer seeds. choice and sample use randbelow. */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;

export class PyRandom {
  state = new Uint32Array(N);
  index = N;

  constructor(seed: number) {
    const key = [seed >>> 0];
    this.state[0] = 19650218;
    for (let i = 1; i < N; i++) {
      const prev = this.state[i - 1];
      this.state[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    let i = 1;
    let j = 0;
    for (let k = N; k; k--) {
      const prev = this.state[i - 1];
      this.state[i] = ((this.state[i] ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        this.state[0] = this.state[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k; k--) {
      const prev = this.state[i - 1];
      this.state[i] = ((this.state[i] ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        this.state[0] = this.state[N - 1];
        i = 1;
      }
    }
    this.state[0] = 0x80000000;
  }

  private genrand(): number {
    if (this.index >= N) {
      for (let kk = 0; kk < N - M; kk++) {
        const y = (this.state[kk] & 0x80000000) | (this.state[kk + 1] & 0x7fffffff);
        this.state[kk] = (this.state[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      for (let kk = N - M; kk < N - 1; kk++) {
        const y = (this.state[kk] & 0x80000000) | (this.state[kk + 1] & 0x7fffffff);
        this.state[kk] = (this.state[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      const y = (this.state[N - 1] & 0x80000000) | (this.state[0] & 0x7fffffff);
      this.state[N - 1] = (this.state[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      this.index = 0;
    }
    let y = this.state[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  private getrandbits(k: number): number {
    return this.genrand() >>> (32 - k);
  }

  private randbelow(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  random(): number {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  choice<T>(seq: T[]): T {
    return seq[this.randbelow(seq.length)];
  }

  sample<T>(population: T[], k: number): T[] {
    const n = population.length;
    const pool = population.slice();
    const result: T[] = [];
    for (let i = 0; i < k; i++) {
      const j = this.randbelow(n - i);
      result.push(pool[j]);
      pool[j] = pool[n - i - 1];
    }
    return result;
  }
}
