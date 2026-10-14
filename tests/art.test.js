'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js'];

test('palette: every sprite char maps to null or a #RRGGBB colour', () => {
  const CB = H.load(FILES);
  for (const [ch, col] of Object.entries(CB.Pal.CHARS)) {
    assert.equal(ch.length, 1, `char key ${ch}`);
    if (ch === '.') assert.equal(col, null);
    else assert.match(col, /^#[0-9A-Fa-f]{6}$/, `char ${ch}`);
  }
});

test('palette: four stage palettes with five code colours each', () => {
  const CB = H.load(FILES);
  for (const id of ['src', 'node_modules', 'git', 'prod']) {
    const p = CB.Pal.STAGES[id];
    assert.ok(p, id);
    for (const k of ['floor', 'floorLine', 'wall', 'wallHi', 'wallLo', 'lineNo', 'accent']) assert.match(p[k], /^#[0-9A-Fa-f]{6}$/, `${id}.${k}`);
    assert.equal(p.code.length, 5);
  }
  assert.equal(CB.Pal.STAGES.prod.pulse, true);
});

test('sprites: define validates width and palette chars', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_ok', ['.o.', 'ooo']);
  assert.equal(CB.Art.hasSprite('t_ok'), true);
  const d = CB.Art.spriteDef('t_ok');
  assert.equal(d.w, 3);
  assert.equal(d.h, 2);
  assert.throws(() => CB.Art.defineSprite('t_ragged', ['..', '...']), /ragged/);
  assert.throws(() => CB.Art.defineSprite('t_badchar', ['.Q.']), /unknown palette char/);
  assert.throws(() => CB.Art.defineSprite('t_empty', []), /non-empty/);
});

test('sprites: custom palette per sprite', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_custom', ['ab'], { a: '#000000', b: null });
  assert.equal(CB.Art.spriteDef('t_custom').pal.a, '#000000');
});

test('sprites: defineTint keeps the shape and recolours every visible pixel', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_src', ['.oh.', 'oOko', '.wz.']);
  CB.Art.defineTint('t_tint', 't_src', '#123456');
  const s = CB.Art.spriteDef('t_src');
  const t = CB.Art.spriteDef('t_tint');
  assert.equal(t.w, s.w);
  assert.equal(t.h, s.h);
  assert.deepEqual(H.plain(t.rows), H.plain(s.rows));
  let visible = 0;
  for (let y = 0; y < t.h; y++) {
    for (let x = 0; x < t.w; x++) {
      const ch = t.rows[y][x];
      if (ch === '.') assert.equal(t.pal[ch], null);
      else {
        visible++;
        assert.equal(t.pal[ch], '#123456', `pixel ${x},${y} (${ch})`);
      }
    }
  }
  assert.equal(visible, 8);
  assert.equal(CB.Art.spriteDef('t_src').pal.o, CB.Pal.C.clawd, 'source is untouched');
  assert.throws(() => CB.Art.defineTint('t_bad', 't_missing', '#FFFFFF'), /unknown source sprite/);
});

test('sprites: defineTint works on custom palettes and on tints of tints', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_c', ['ab.'], { a: '#000000', b: null, '.': null });
  CB.Art.defineTint('t_c1', 't_c', '#FF0000');
  assert.equal(CB.Art.spriteDef('t_c1').pal.a, '#FF0000');
  assert.equal(CB.Art.spriteDef('t_c1').pal.b, null, 'transparent palette entries stay transparent');
  CB.Art.defineTint('t_c2', 't_c1', '#00FF00');
  assert.equal(CB.Art.spriteDef('t_c2').pal.a, '#00FF00');
});

test("sprites: defineTint keeps '.' transparent even if the source palette coloured it", () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_dotcol', ['a.'], { a: '#000000', '.': '#654321' });
  CB.Art.defineTint('t_dotcol_t', 't_dotcol', '#FF00FF');
  assert.equal(CB.Art.spriteDef('t_dotcol_t').pal['.'], null);
  assert.equal(CB.Art.spriteDef('t_dotcol_t').pal.a, '#FF00FF');
});

// ---- the site images and head (tools/make-art.mjs, assets/, manifest.webmanifest, index.html <head>, tools/serve.mjs) -------------
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const net = require('net');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ASSET_DIR = path.join(H.ROOT, 'assets');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let artMod = null;
const art = () => (artMod = artMod || import(pathToFileURL(path.join(H.ROOT, 'tools', 'make-art.mjs')).href));
let rendered = null;
const renderedOnce = () => (rendered = rendered || art().then((m) => m.renderAll()));

// The test's own CRC-32, independent of the encoder's.
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Walks a PNG's chunks, checking every CRC, and returns { w, h, depth, colorType, interlace, types, idat } (idat: all IDAT data joined).
function parsePng(buf, label) {
  assert.ok(buf.subarray(0, 8).equals(PNG_SIG), `${label}: PNG signature`);
  const types = [];
  const idat = [];
  let pos = 8;
  let ihdr = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    assert.equal(buf.readUInt32BE(pos + 8 + len), crc32(buf.subarray(pos + 4, pos + 8 + len)), `${label}: ${type} chunk CRC`);
    types.push(type);
    if (type === 'IHDR') ihdr = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  assert.equal(pos, buf.length, `${label}: no trailing bytes`);
  assert.ok(ihdr && ihdr.length === 13 && types[0] === 'IHDR', `${label}: IHDR first`);
  assert.equal(types[types.length - 1], 'IEND', `${label}: IEND last`);
  return { w: ihdr.readUInt32BE(0), h: ihdr.readUInt32BE(4), depth: ihdr[8], colorType: ihdr[9], interlace: ihdr[12], types, idat: Buffer.concat(idat) };
}

// { w, h, bpp, at(x, y) -> '#RRGGBB' } for an 8-bit RGB or RGBA PNG whose rows all use filter 0.
function decode(buf, label) {
  const p = parsePng(buf, label);
  const bpp = p.colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(p.idat);
  assert.equal(raw.length, p.h * (1 + p.w * bpp), `${label}: inflated size`);
  for (let y = 0; y < p.h; y++) assert.equal(raw[y * (1 + p.w * bpp)], 0, `${label}: row ${y} filter byte`);
  const hex = (n) => n.toString(16).padStart(2, '0');
  return {
    w: p.w,
    h: p.h,
    bpp,
    at(x, y) {
      const o = y * (1 + p.w * bpp) + 1 + x * bpp;
      return ('#' + hex(raw[o]) + hex(raw[o + 1]) + hex(raw[o + 2])).toUpperCase();
    },
  };
}

// Bounding box { x0, y0, x1, y1, n } of the pixels whose colour is in `colors`, within an optional window { x0, y0, x1, y1 } (x1 and y1 exclusive).
function boxOf(img, colors, win) {
  const set = new Set(colors.map((c) => c.toUpperCase()));
  const w = win || { x0: 0, y0: 0, x1: img.w, y1: img.h };
  const b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 };
  for (let y = w.y0; y < w.y1; y++) {
    for (let x = w.x0; x < w.x1; x++) {
      if (!set.has(img.at(x, y))) continue;
      b.n++;
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x);
      b.y1 = Math.max(b.y1, y);
    }
  }
  return b;
}

const NAMES = ['og.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'];
const SIZES = { 'og.png': [1200, 630], 'icon-192.png': [192, 192], 'icon-512.png': [512, 512], 'icon-maskable-512.png': [512, 512], 'apple-touch-icon.png': [180, 180], 'favicon-32.png': [32, 32] };

test('assets: every PNG is valid: signature, IHDR size, chunk CRCs, one IDAT that inflates to the exact raw size', async () => {
  const { ASSETS } = await art();
  assert.deepEqual(Object.keys(ASSETS), NAMES);
  for (const name of NAMES) {
    const buf = fs.readFileSync(path.join(ASSET_DIR, name));
    const p = parsePng(buf, name);
    assert.deepEqual([p.w, p.h], SIZES[name], `${name} size`);
    assert.deepEqual([ASSETS[name].w, ASSETS[name].h], SIZES[name], `${name} size in the tool`);
    assert.equal(p.depth, 8, `${name} bit depth`);
    assert.ok(p.colorType === 2 || p.colorType === 6, `${name} is RGB or RGBA`);
    assert.equal(p.interlace, 0);
    assert.deepEqual(p.types, ['IHDR', 'IDAT', 'IEND'], `${name} chunks`);
    const bpp = p.colorType === 6 ? 4 : 3;
    assert.equal(zlib.inflateSync(p.idat).length, p.h * (1 + p.w * bpp), `${name} inflated size`);
    assert.ok(buf.length < 150 * 1024, `${name} is ${buf.length} bytes: the link preview and icons stay small`);
  }
});

test('assets: regenerating in memory gives the committed bytes, and twice gives the same bytes (assets cannot go stale)', async () => {
  const files = await renderedOnce();
  assert.deepEqual(Object.keys(files), NAMES);
  const again = (await art()).renderAll();
  for (const name of NAMES) {
    assert.ok(Buffer.isBuffer(files[name]), name);
    assert.ok(files[name].equals(again[name]), `${name}: two runs differ`);
    assert.ok(files[name].equals(fs.readFileSync(path.join(ASSET_DIR, name))), `${name} is stale: run npm run art and commit assets/`);
  }
});

test('png encoder: crc32 and the built-in deflate agree with the standard ones (empty, tiny, runs, repeats past the window, noise)', async () => {
  const { crc32: toolCrc, deflate } = await art();
  assert.equal(toolCrc(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(toolCrc(Buffer.alloc(0)), 0);
  let seed = 12345;
  const noise = Buffer.alloc(70000).map(() => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) & 255);
  const cases = {
    empty: Buffer.alloc(0),
    one: Buffer.from([7]),
    abc: Buffer.from('abcabcabcabcabcabc'),
    zeros: Buffer.alloc(100000),
    noise,
    repeats: Buffer.concat([noise.subarray(0, 40000), noise.subarray(0, 40000), noise.subarray(100, 5000)]),
    mixed: Buffer.concat([Buffer.alloc(300, 1), noise.subarray(0, 300), Buffer.alloc(300, 2)]),
  };
  for (const [label, buf] of Object.entries(cases)) {
    const z = deflate(buf);
    assert.ok(Buffer.from(zlib.inflateSync(z)).equals(buf), `${label}: round trip through zlib.inflateSync`);
    assert.ok(deflate(buf).equals(z), `${label}: deterministic`);
  }
  assert.ok(deflate(cases.zeros).length < 1000, 'long runs shrink');
});

test('og.png: not a flat colour, the logo has Clawd orange and bug red, Clawd and the tagline are drawn, nothing important in the 5% margin', () => {
  const img = decode(fs.readFileSync(path.join(ASSET_DIR, 'og.png')), 'og.png');
  const C = H.load(FILES).Pal.C;
  const seen = new Set();
  for (let y = 0; y < img.h; y += 5) for (let x = 0; x < img.w; x += 5) seen.add(img.at(x, y));
  assert.ok(seen.size >= 20, `${seen.size} distinct colours`);
  const left = boxOf(img, [C.clawd], { x0: 0, y0: 40, x1: 600, y1: 175 });
  const right = boxOf(img, [C.red], { x0: 600, y0: 40, x1: img.w, y1: 175 });
  assert.ok(left.n > 1000, `CLAWD in Clawd's colour (${left.n} px)`);
  assert.ok(right.n > 1000, `BUGS in red (${right.n} px)`);
  const hero = boxOf(img, [C.clawd, C.clawdDark, C.clawdLight], { x0: 0, y0: 190, x1: 560, y1: 480 });
  assert.ok(hero.n > 20000, `Clawd is big (${hero.n} px)`);
  const text = boxOf(img, [C.pale], { x0: 0, y0: 490, x1: img.w, y1: 560 });
  assert.ok(text.n > 500, `the tagline is in pale text (${text.n} px)`);
  const url = boxOf(img, [C.grey], { x0: 0, y0: 550, x1: img.w, y1: 600 });
  assert.ok(url.n > 300, `the address is drawn (${url.n} px)`);
  const mx = img.w * 0.05;
  const my = img.h * 0.05;
  const all = boxOf(img, [C.clawd, C.red, C.pale, C.grey]);
  assert.ok(all.x0 >= mx && all.x1 < img.w - mx && all.y0 >= my && all.y1 < img.h - my, `logo, Clawd and text stay inside a 5% margin: ${JSON.stringify(all)}`);
});

test('icons: Clawd on #0B0B10, opaque, centred; about 70% wide, and inside the central 60% on the maskable one', () => {
  const C = H.load(FILES).Pal.C;
  const clawdColors = [C.clawd, C.clawdDark, C.clawdLight];
  for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png']) {
    const img = decode(fs.readFileSync(path.join(ASSET_DIR, name)), name);
    assert.equal(img.bpp, 3, `${name}: no alpha channel, so it is opaque`);
    assert.equal(img.w, img.h);
    const n = img.w;
    const probes = [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]];
    if (name !== 'favicon-32.png') probes.push([n >> 1, 0], [0, n >> 1]); // Clawd's arms reach the favicon's side edges
    for (const [x, y] of probes) assert.equal(img.at(x, y), '#0B0B10', `${name}: full-bleed background at ${x},${y}`);
    const b = boxOf(img, clawdColors);
    assert.ok(b.n > 0, `${name}: Clawd is drawn`);
    assert.ok(Math.abs((b.x0 + b.x1 + 1) / 2 - n / 2) <= 1, `${name}: Clawd is centred across (${b.x0}..${b.x1})`);
    const w = (b.x1 - b.x0 + 1) / n;
    if (name === 'icon-maskable-512.png') {
      assert.ok(w <= 0.6 && w > 0.5, `${name}: Clawd is ${w} of the width`);
      assert.ok(b.x0 >= n * 0.2 && b.x1 < n * 0.8 && b.y0 >= n * 0.2 && b.y1 < n * 0.8, `${name}: inside the central 60%`);
    } else if (name === 'favicon-32.png') {
      assert.equal(n, 32);
      assert.ok(w >= 0.9, `${name}: Clawd fills the 32 px`);
      assert.ok(boxOf(img, [C.ink]).n >= 4, `${name}: the eyes show`);
    } else {
      assert.ok(w >= 0.6 && w <= 0.76, `${name}: Clawd is ${w} of the width`);
    }
  }
});

test('manifest.webmanifest: valid JSON per the contract, every icon exists at its declared size', () => {
  const m = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Clawd vs Bugs');
  assert.equal(m.id, '/', 'a stable app id, so the install identity does not hang on start_url');
  assert.equal(m.short_name, 'Clawd', 'home-screen labels truncate at about 12 characters');
  assert.ok(typeof m.description === 'string' && m.description.length > 20);
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'fullscreen');
  assert.equal(m.orientation, 'landscape');
  assert.equal(m.background_color, '#0B0B10');
  assert.equal(m.theme_color, '#0B0B10');
  assert.equal(m.icons.length, 4);
  for (const icon of m.icons) {
    for (const k of ['src', 'sizes', 'type', 'purpose']) assert.equal(typeof icon[k], 'string', `icon ${k}`);
    assert.equal(icon.type, 'image/png');
    assert.ok(['any', 'maskable'].includes(icon.purpose));
    assert.doesNotMatch(icon.src, /^[a-z]+:|^\//i, 'a relative path, so it resolves beside the manifest');
    const file = path.join(H.ROOT, icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} exists`);
    const p = parsePng(fs.readFileSync(file), icon.src);
    assert.equal(icon.sizes, `${p.w}x${p.h}`, `${icon.src} declared size`);
  }
  assert.deepEqual(m.icons.filter((i) => i.purpose === 'maskable').map((i) => i.src), ['assets/icon-maskable-512.png']);
  for (const s of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === s && i.purpose === 'any'), `an "any" icon at ${s}`);
});

// The <meta> and <link> tags of the head as { tag, attrs }.
function headTags(html) {
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || '';
  return [...head.matchAll(/<(meta|link)\s+([^>]*?)\s*>/g)].map((m) => {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return { tag: m[1], attrs };
  });
}

test('index.html head: description, canonical, Open Graph, Twitter card, icons and manifest, with an absolute og:image', () => {
  const html = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const tags = headTags(html);
  const content = (key, val) => {
    const found = tags.filter((t) => t.tag === 'meta' && t.attrs[key] === val);
    assert.equal(found.length, 1, `exactly one <meta ${key}="${val}">`);
    assert.ok(found[0].attrs.content && found[0].attrs.content.length > 0, `${val} has content`);
    return found[0].attrs.content;
  };
  const links = (rel) => tags.filter((t) => t.tag === 'link' && t.attrs.rel === rel);
  const ORIGIN = 'https://clawd-2d.vercel.app';
  assert.ok(content('name', 'description').length >= 50);
  assert.equal(links('canonical').length, 1);
  assert.equal(links('canonical')[0].attrs.href, ORIGIN + '/');
  assert.equal(content('property', 'og:type'), 'website');
  assert.equal(content('property', 'og:site_name'), 'Clawd vs Bugs');
  assert.equal(content('property', 'og:title'), 'Clawd vs Bugs');
  assert.ok(content('property', 'og:description').length >= 50);
  assert.equal(content('property', 'og:url'), ORIGIN + '/');
  assert.equal(content('property', 'og:image'), ORIGIN + '/assets/og.png');
  assert.equal(content('property', 'og:image:width'), '1200');
  assert.equal(content('property', 'og:image:height'), '630');
  assert.ok(content('property', 'og:image:alt').length >= 20);
  assert.equal(content('name', 'twitter:card'), 'summary_large_image');
  assert.equal(content('name', 'twitter:title'), 'Clawd vs Bugs');
  assert.ok(content('name', 'twitter:description').length >= 50);
  assert.equal(content('name', 'twitter:image'), ORIGIN + '/assets/og.png');
  const og = parsePng(fs.readFileSync(path.join(ASSET_DIR, 'og.png')), 'og.png');
  assert.deepEqual([String(og.w), String(og.h)], [content('property', 'og:image:width'), content('property', 'og:image:height')], 'the declared size is the real size');

  assert.equal(links('icon').length, 1, 'one favicon link');
  assert.deepEqual(links('icon')[0].attrs, { rel: 'icon', type: 'image/png', sizes: '32x32', href: 'assets/favicon-32.png' });
  assert.equal(links('apple-touch-icon').length, 1);
  assert.equal(links('apple-touch-icon')[0].attrs.href, 'assets/apple-touch-icon.png');
  assert.equal(links('manifest').length, 1);
  assert.equal(links('manifest')[0].attrs.href, 'manifest.webmanifest');
  for (const rel of ['icon', 'apple-touch-icon', 'manifest']) assert.ok(fs.existsSync(path.join(H.ROOT, links(rel)[0].attrs.href)), `${rel} target exists`);
  assert.doesNotMatch(html, /href="data:,"/, 'the empty data: icon is gone');
  assert.equal(content('name', 'theme-color'), '#0B0B10', 'the existing metas are untouched');
  assert.match(html, /<title>Clawd vs Bugs<\/title>/);
});

test('tools/serve.mjs: .webmanifest is served as application/manifest+json (and PNGs as image/png)', async () => {
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  const child = spawn(process.execPath, [path.join(H.ROOT, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('serve.mjs did not start in 8 s')), 8000);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`serve.mjs exited with ${code}`)));
      child.stdout.on('data', (d) => String(d).includes('http://127.0.0.1') && resolve());
    });
    const m = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /^application\/manifest\+json/);
    assert.equal(JSON.parse(await m.text()).name, 'Clawd vs Bugs');
    const p = await fetch(`http://127.0.0.1:${port}/assets/og.png`);
    assert.equal(p.status, 200);
    assert.equal(p.headers.get('content-type'), 'image/png');
  } finally {
    clearTimeout(timer);
    child.removeAllListeners('exit');
    child.kill();
  }
});
