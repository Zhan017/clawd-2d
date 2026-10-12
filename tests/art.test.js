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
