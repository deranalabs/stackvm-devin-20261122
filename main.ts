import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Bin = (a: number, b: number) => number;

// opcode -> [immediate bytes, pops, pushes]
const T: Record<number, number[]> = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0], 0x04: [0, 1, 2], 0x05: [0, 2, 2],
  0x06: [0, 2, 3], 0x07: [0, 3, 3], 0x17: [0, 1, 1], 0x1b: [0, 1, 1],
  0x30: [2, 0, 0], 0x31: [2, 1, 0], 0x32: [2, 1, 0], 0x33: [2, 0, 0], 0x34: [0, 0, 0],
  0x40: [0, 1, 1], 0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1], 0x53: [0, 1, 0],
};
for (let o = 0x10; o < 0x23; o++) if (o != 0x1f) T[o] ??= [0, 2, 1];

// binary operators: ( a b -- r )
const B: Record<number, Bin> = {
  0x10: (a, b) => (a + b) | 0, 0x11: (a, b) => (a - b) | 0, 0x12: Math.imul,
  0x13: (a, b) => (a / b) | 0, 0x14: (a, b) => a % b | 0,
  0x15: (a, b) => Math.floor((a >>> 0) / (b >>> 0)) | 0, 0x16: (a, b) => (a >>> 0) % (b >>> 0) | 0,
  0x18: (a, b) => a & b, 0x19: (a, b) => a | b, 0x1a: (a, b) => a ^ b,
  0x1c: (a, b) => a << (b & 31), 0x1d: (a, b) => a >> (b & 31), 0x1e: (a, b) => (a >>> (b & 31)) | 0,
  0x20: (a, b) => +(a == b), 0x21: (a, b) => +(a < b), 0x22: (a, b) => +(a >>> 0 < b >>> 0),
};

function run(p: Buffer, inp: Buffer): [Buffer, number] {
  const D = new Int32Array(256), M = new Int32Array(256), C: number[] = [], out = Buffer.alloc(65536);
  let sp = 0, pc = 0, ol = 0, ip = 0, steps = 0;
  const end = (c: number): [Buffer, number] => [out.subarray(0, ol), c];
  for (;;) {
    if (steps == 1e6) return end(10);
    if (pc < 0 || pc >= p.length) return end(9);
    const op = p[pc], t = T[op];
    if (!t) return end(5);
    const [im, pop, push] = t;
    if (pc + im >= p.length) return end(9);
    steps++;
    if (sp < pop) return end(2);
    if (sp - pop + push > 256) return end(3);
    const nx = pc + 1 + im;
    const imm = im == 1 ? (p[nx - 1] << 24) >> 24 : im == 4 ? p.readInt32LE(pc + 1) : im ? p.readUInt16LE(pc + 1) : 0;
    const rel = nx + ((imm << 16) >> 16);
    const b = D[sp - 1], a = D[sp - 2];
    pc = nx;
    if (pop == 2 && push == 1) {
      if (op >= 0x13 && op <= 0x16 && !b) return end(4);
      D[--sp - 1] = B[op](a, b);
      continue;
    }
    switch (op) {
      case 0x00: return end(0);
      case 0x01: case 0x02: D[sp++] = imm; break;
      case 0x03: sp--; break;
      case 0x04: D[sp++] = b; break;
      case 0x05: D[sp - 1] = a; D[sp - 2] = b; break;
      case 0x06: D[sp++] = a; break;
      case 0x07: { const x = D[sp - 3]; D[sp - 3] = a; D[sp - 2] = b; D[sp - 1] = x; break; }
      case 0x17: D[sp - 1] = -b | 0; break;
      case 0x1b: D[sp - 1] = ~b; break;
      case 0x30: pc = rel; break;
      case 0x31: case 0x32: sp--; if ((b == 0) == (op == 0x31)) pc = rel; break;
      case 0x33: if (C.length == 64) return end(7); C.push(nx); pc = imm; break;
      case 0x34: if (!C.length) return end(8); pc = C.pop()!; break;
      case 0x40: if (b >>> 0 > 255) return end(6); D[sp - 1] = M[b]; break;
      case 0x41: if (b >>> 0 > 255) return end(6); M[b] = a; sp -= 2; break;
      case 0x50: {
        const s = String(b);
        if (ol + s.length > 65536) return end(11);
        ol += out.write(s, ol); sp--;
        break;
      }
      case 0x51: if (ol == 65536) return end(11); out[ol++] = b; sp--; break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break;
      case 0x53: return end(b & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const rd = (f: string) => { try { return readFileSync(f) } catch { return Buffer.alloc(0) } };
for (const id of readdirSync(I).sort()) {
  let o = Buffer.alloc(0), c = 0;
  try { [o, c] = run(rd(join(I, id, 'program.bin')), rd(join(I, id, 'input.bin'))) } catch {}
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), o);
  writeFileSync(join(O, id, 'exit.txt'), String(c));
}
