#!/usr/bin/env node
// Draws the site's images from the game's own art: `npm run art` writes assets/*.png (the link-preview card, the app icons
// and the favicon). Node built-ins only. The sprites and the bitmap font come from the real game scripts, loaded into a
// node:vm sandbox, so the pictures cannot drift from the game; a tiny RGB rasterizer paints them; a PNG encoder with its own
// deflate writes them. The deflate is hand-rolled (LZ77 + fixed Huffman) instead of zlib's, because zlib's output can differ
// between Node versions and CPUs, and the committed files must be byte-for-byte what every machine regenerates.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ASSET_DIR = join(ROOT, 'assets');

// name -> width and height. The plan's Assets table: tests and the manifest read the sizes from here too.
export const ASSETS = Object.freeze({
  'og.png': { w: 1200, h: 630 },
  'icon-192.png': { w: 192, h: 192 },
  'icon-512.png': { w: 512, h: 512 },
  'icon-maskable-512.png': { w: 512, h: 512 },
  'apple-touch-icon.png': { w: 180, h: 180 },
  'favicon-32.png': { w: 32, h: 32 },
});

const BG = '#0B0B10'; // the page, theme and manifest background
const OG_SCALE = 5; // og.png is drawn at 240x126 and scaled up with nearest-neighbour

// ---- the game's art, loaded the way the tests load it -------------------------------------------------------------------

const SCRIPTS = [
  'src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/font.js', 'src/art/sprites.js',
  'src/game/projectiles.js', 'src/game/player.js',
  'src/game/enemies/syntaxError.js', 'src/game/enemies/nullPointer.js', 'src/game/enemies/raceCondition.js',
  'src/game/enemies/memoryLeak.js', 'src/game/enemies/offByOne.js',
];

function loadGame() {
  const sandbox = { console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of SCRIPTS) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), sandbox, { filename: f });
  return sandbox.CB;
}

// ---- RGB rasterizer -----------------------------------------------------------------------------------------------------

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

class Raster {
  constructor(w, h, color) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    if (color) this.rect(0, 0, w, h, color);
  }

  // Solid when alpha is 1, else blended over what is there (integer maths only, so it is exact everywhere).
  rect(x, y, w, h, color, alpha = 1) {
    const [r, g, b] = rgb(color);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x) + Math.round(w));
    const y1 = Math.min(this.h, Math.round(y) + Math.round(h));
    const a = Math.round(alpha * 256);
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const o = (j * this.w + i) * 3;
        if (a >= 256) {
          this.px[o] = r;
          this.px[o + 1] = g;
          this.px[o + 2] = b;
        } else {
          this.px[o] += ((r - this.px[o]) * a) >> 8;
          this.px[o + 1] += ((g - this.px[o + 1]) * a) >> 8;
          this.px[o + 2] += ((b - this.px[o + 2]) * a) >> 8;
        }
      }
    }
  }

  // A filled disc, hard-edged: a pixel is in when its centre is within the radius.
  disc(cx, cy, rad, color, alpha = 1) {
    for (let j = Math.floor(cy - rad); j <= Math.ceil(cy + rad); j++) {
      for (let i = Math.floor(cx - rad); i <= Math.ceil(cx + rad); i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy <= rad * rad) this.rect(i, j, 1, 1, color, alpha);
      }
    }
  }

  // A sprite def ({ rows, pal }) at an integer scale. opts: flip (mirror left-right), tint (one colour for every pixel), alpha.
  sprite(def, x, y, scale = 1, opts = {}) {
    const flip = !!opts.flip;
    for (let j = 0; j < def.rows.length; j++) {
      const row = def.rows[j];
      for (let i = 0; i < row.length; i++) {
        const col = def.pal[row[flip ? row.length - 1 - i : i]];
        if (col) this.rect(x + i * scale, y + j * scale, scale, scale, opts.tint || col, opts.alpha == null ? 1 : opts.alpha);
      }
    }
  }

  // Text through the game's own CB.Font.draw (a fillRect per lit pixel), with the optional drop shadow one scaled pixel down-right.
  text(Font, str, x, y, color, scale = 1, shadow = null) {
    const ctx = { fillStyle: '#000000', fillRect: (rx, ry, rw, rh) => this.rect(rx, ry, rw, rh, ctx.fillStyle) };
    if (shadow) Font.draw(ctx, str, x + scale, y + scale, shadow, scale);
    Font.draw(ctx, str, x, y, color, scale);
  }

  scaled(k) {
    const out = new Raster(this.w * k, this.h * k);
    for (let j = 0; j < out.h; j++) {
      const src = Math.floor(j / k) * this.w;
      for (let i = 0; i < out.w; i++) {
        const s = (src + Math.floor(i / k)) * 3;
        const o = (j * out.w + i) * 3;
        out.px[o] = this.px[s];
        out.px[o + 1] = this.px[s + 1];
        out.px[o + 2] = this.px[s + 2];
      }
    }
    return out;
  }
}

// The box around a sprite's visible pixels, so it can be centred without its blank rows.
function bounds(def) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  def.rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      if (!def.pal[row[i]]) continue;
      x0 = Math.min(x0, i);
      x1 = Math.max(x1, i);
      y0 = Math.min(y0, j);
      y1 = Math.max(y1, j);
    }
  });
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---- PNG ----------------------------------------------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// Deflate length and distance code tables (RFC 1951).
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const lastLE = (base, v) => {
  let i = base.length - 1;
  while (base[i] > v) i--;
  return i;
};

// A zlib stream: one fixed-Huffman deflate block over a greedy hash-chain LZ77. Pure integer code, so it is the same on every
// machine; pixel art (long runs, rows repeated by the scale-up) compresses well enough with it.
export function deflate(data) {
  const out = [0x78, 0x01];
  let bits = 0;
  let nbits = 0;
  const put = (v, n) => { // LSB first
    bits |= v << nbits;
    nbits += n;
    while (nbits >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      nbits -= 8;
    }
  };
  const huff = (code, n) => { // Huffman codes go MSB first
    let r = 0;
    for (let i = 0; i < n; i++) r |= ((code >> i) & 1) << (n - 1 - i);
    put(r, n);
  };
  const sym = (s) => { // fixed literal/length code
    if (s < 144) huff(0x30 + s, 8);
    else if (s < 256) huff(0x190 + s - 144, 9);
    else if (s < 280) huff(s - 256, 7);
    else huff(0xc0 + s - 280, 8);
  };

  put(1, 1); // final block
  put(1, 2); // fixed Huffman
  const n = data.length;
  const MASK = 0x7fff;
  const head = new Int32Array(1 << 15).fill(-1);
  const prev = new Int32Array(MASK + 1);
  const hash = (i) => Math.imul((data[i] << 16) | (data[i + 1] << 8) | data[i + 2], 2654435761) >>> 17;
  const insert = (i) => {
    if (i + 2 >= n) return;
    const h = hash(i);
    prev[i & MASK] = head[h];
    head[h] = i;
  };
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < n) {
      const max = Math.min(258, n - i);
      let cand = head[hash(i)];
      for (let chain = 0; chain < 24 && cand >= 0 && i - cand <= 32768; chain++) {
        let len = 0;
        while (len < max && data[cand + len] === data[i + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - cand;
          if (len >= max) break;
        }
        const next = prev[cand & MASK];
        if (next >= cand) break; // that slot was reused by a newer position
        cand = next;
      }
    }
    if (bestLen >= 3) {
      const li = lastLE(LEN_BASE, bestLen);
      sym(257 + li);
      put(bestLen - LEN_BASE[li], LEN_EXTRA[li]);
      const di = lastLE(DIST_BASE, bestDist);
      huff(di, 5);
      put(bestDist - DIST_BASE[di], DIST_EXTRA[di]);
      for (let k = 0; k < bestLen; k++) insert(i + k);
      i += bestLen;
    } else {
      sym(data[i]);
      insert(i);
      i++;
    }
  }
  sym(256);
  if (nbits > 0) out.push(bits & 255);
  const sum = adler32(data);
  out.push(sum >>> 24, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255);
  return Buffer.from(out);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 8-bit RGB, no interlace, filter 0 on every row, one IDAT.
export function encodePng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    raw[o] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * w * 3, w * 3).copy(raw, o + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- the pictures -------------------------------------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The 8-armed spark from the title screen (the game keeps it inside title.js, which drags in the whole scene layer).
const SPARK_ROWS = ['.k..k..k.', 'kfkkqkkfk', '.kfkzkfk.', '.kkfzfkk.', 'kqzzwzzqk', '.kkfzfkk.', '.kfkzkfk.', 'kfkkqkkfk', '.k..k..k.'];
// 3x5 digits for the editor's line numbers, as the arena draws them.
const DIGITS = [
  ['###', '#.#', '#.#', '#.#', '###'], ['.#.', '##.', '.#.', '.#.', '###'], ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '###', '..#', '###'], ['#.#', '#.#', '###', '..#', '..#'], ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'], ['###', '..#', '..#', '..#', '..#'], ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
];

// Clawd on the dark page colour with a soft stepped glow behind him: the app icon. `fit` is the share of the width the
// sprite may take (about 0.70 for the icon, at most 0.60 for the maskable one); the scale is the biggest whole number within it.
function iconArt(CB, size, fit, glow) {
  const clawd = CB.Art.spriteDef('clawd_idle0');
  const box = bounds(clawd);
  const scale = Math.max(1, Math.round((size * fit) / box.w));
  const r = new Raster(size, size, BG);
  if (glow) {
    const c = size / 2;
    for (const k of [1, 0.84, 0.68, 0.52]) r.disc(c, c, size * glow * k, CB.Pal.C.clawd, 0.03); // four faint steps, brightest in the middle
  }
  const x = Math.round((size - box.w * scale) / 2) - box.x0 * scale;
  const y = Math.round((size - box.h * scale) / 2) - box.y0 * scale;
  if (glow) r.rect(x + (box.x0 + 1) * scale, y + (box.y0 + box.h) * scale, (box.w - 2) * scale, scale, '#000000', 0.5); // a shadow strip under the feet
  r.sprite(clawd, x, y, scale);
  return r;
}

function ogArt(CB) {
  const W = 240;
  const H = 126;
  const PAL = CB.Pal;
  const C = PAL.C;
  const S = PAL.STAGES.src;
  const Font = CB.Font;
  const r = new Raster(W, H, S.wall);

  // The arena: a wall frame round a ruled floor with faint code lines and line numbers, as the game draws the src stage.
  const B = 5;
  r.rect(0, 0, W, 1, S.wallLo);
  r.rect(0, H - 1, W, 1, S.wallLo);
  r.rect(0, 0, 1, H, S.wallLo);
  r.rect(W - 1, 0, 1, H, S.wallLo);
  r.rect(B - 1, B - 1, W - 2 * B + 2, H - 2 * B + 2, S.wallHi);
  r.rect(B, B, W - 2 * B, H - 2 * B, S.floor);
  const rows = Math.floor((H - 2 * B) / 6);
  for (let i = 0; i < rows; i++) r.rect(B, B + i * 6 + 5, W - 2 * B, 1, S.floorLine);
  const rnd = mulberry32(0xc1a3d);
  for (let i = 0; i < rows; i++) {
    const y = B + i * 6 + 2;
    let x = 20 + Math.floor(rnd() * 5) * 8;
    const n = 1 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const w = (3 + Math.floor(rnd() * 21)) * 2;
      const col = S.code[Math.floor(rnd() * S.code.length)];
      if (x + w > W - B - 8) break;
      if (y > 36) { // none behind the logo, so its edges stay clean
        r.rect(x + 1, y, w - 2, 1, col, 0.8);
        r.rect(x, y + 1, w, 1, col, 0.8);
      }
      x += w + 3;
    }
    const num = String(i / 2 + 1);
    for (let d = 0; i % 2 === 0 && y > 36 && d < num.length; d++) { // a number beside every second row, none by the logo
      DIGITS[num.charCodeAt(d) - 48].forEach((line, j) => {
        for (let c = 0; c < 3; c++) if (line[c] === '#') r.rect(B + 3 + (num.length > 1 ? 0 : 4) + d * 4 + c, y + j - 1, 1, 1, S.lineNo);
      });
    }
  }

  // The logo: CLAWD in Clawd's colours, a small pale vs, BUGS in red; letters spaced out and shadowed like the title screen.
  const sc = 3;
  const extra = sc;
  const word = (str) => Font.measure(str, sc) + (str.length - 1) * extra;
  const vsW = Font.measure('vs', 2);
  const gap = 8;
  const total = word('CLAWD') + gap + vsW + gap + word('BUGS');
  const logoY = 10;
  const letters = (str, x0, color, shadow) => {
    for (let i = 0; i < str.length; i++) {
      const x = x0 + (i ? Font.measure(str.slice(0, i), sc) + sc + i * extra : 0);
      r.text(Font, str[i], x, logoY, color, sc, shadow);
    }
  };
  let lx = Math.round((W - total - sc) / 2); // the shadow counts toward the width
  letters('CLAWD', lx, C.clawd, C.clawdDark);
  lx += word('CLAWD') + gap;
  r.text(Font, 'vs', lx, logoY + 7, C.pale, 2, C.ink);
  lx += vsW + gap;
  letters('BUGS', lx, C.red, C.redDark);

  // The fight: Clawd at scale 5 (his game face) shooting bolts right at a red beetle; a slime, a moth and an ant wait behind it.
  const clawd = CB.Art.spriteDef('clawd_idle0_angry');
  const cb = bounds(clawd);
  const cs = 5;
  const cx = 20;
  const cy = 41;
  r.rect(cx + cs, cy + cb.h * cs - cs, (cb.w - 2) * cs, 2 * cs, C.ink, 0.45);
  r.sprite(clawd, cx - cb.x0 * cs, cy - cb.y0 * cs, cs);
  const bugs = {
    beetle: CB.Art.spriteDef('syntaxError_0'),
    slime: CB.Art.spriteDef('memoryLeak_0'),
    ant: CB.Art.spriteDef('raceCondition_1'),
    moth: CB.Art.spriteDef('nullPointer_0'),
  };
  r.sprite(bugs.moth, 190, 35, 3, { flip: true });
  r.sprite(bugs.slime, 186, 64, 3, { flip: true });
  r.sprite(bugs.ant, 150, 73, 3, { flip: true });
  r.sprite(bugs.beetle, 148, 42, 3, { flip: true });
  // Bolts on the line from Clawd's face to the beetle, the older ones fainter, each centred on that line.
  const lineY = cy + 3 * cs + 1;
  const centred = (d, x, y, scale, a) => r.sprite(d, Math.round(x - (d.rows[0].length * scale) / 2), Math.round(y - (d.rows.length * scale) / 2), scale, { alpha: a });
  centred(CB.Art.spriteDef('bolt'), 112, lineY, 2, 0.35);
  centred(CB.Art.spriteDef('bolt'), 122, lineY, 2, 0.6);
  centred(CB.Art.spriteDef('bolt_big'), 134, lineY, 3, 1);
  centred({ rows: SPARK_ROWS, pal: PAL.CHARS }, 150, lineY, 2, 1);
  for (const [dx, dy, col] of [[142, -9, C.gold], [153, -13, C.white], [140, 9, C.ember], [146, 15, C.gold], [156, 17, C.spark]]) r.rect(dx, lineY + dy, 2, 2, col);

  // The tagline and the address, on a darker band so they read over the code lines.
  r.rect(B, 98, W - 2 * B, H - B - 98, C.ink, 0.6);
  const mid = (str, y, color) => r.text(Font, str, Math.round((W - Font.measure(str, 1)) / 2), y, color, 1);
  mid('a pixel boss rush · play in your browser', 101, C.pale);
  mid('clawd-2d.vercel.app', 111, C.grey);
  return r.scaled(OG_SCALE);
}

// renderAll() -> { 'og.png': Buffer, ... } for every file in ASSETS. Deterministic: no clock, no randomness, no zlib.
export function renderAll() {
  const CB = loadGame();
  const pic = {
    'og.png': ogArt(CB),
    'icon-192.png': iconArt(CB, 192, 0.7, 0.42),
    'icon-512.png': iconArt(CB, 512, 0.7, 0.42),
    'icon-maskable-512.png': iconArt(CB, 512, 0.58, 0.36),
    'apple-touch-icon.png': iconArt(CB, 180, 0.7, 0.42),
    'favicon-32.png': iconArt(CB, 32, 1, 0),
  };
  const out = {};
  for (const name of Object.keys(ASSETS)) {
    const p = pic[name];
    if (p.w !== ASSETS[name].w || p.h !== ASSETS[name].h) throw new Error(`${name}: drew ${p.w}x${p.h}, expected ${ASSETS[name].w}x${ASSETS[name].h}`);
    out[name] = encodePng(p.w, p.h, p.px);
  }
  return out;
}

export function writeAll(dir = ASSET_DIR) {
  mkdirSync(dir, { recursive: true });
  const files = renderAll();
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(dir, name), buf);
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = writeAll();
  for (const [name, buf] of Object.entries(files)) console.log(`assets/${name}: ${ASSETS[name].w}x${ASSETS[name].h}, ${(buf.length / 1024).toFixed(1)} KB`);
}
