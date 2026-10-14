'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const REQUIRED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?\'"-_/\\()[]{}<>=+*#%&@~|^$`✓⚠✻♥·—×→…';
const FILES = ['src/core/ns.js', 'src/art/font.js'];

test('font: every required glyph is 7 equal-width rows of . and #', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  for (const ch of REQUIRED) {
    const g = CB.Font.GLYPHS[ch];
    assert.ok(g, `missing glyph ${JSON.stringify(ch)}`);
    assert.equal(g.length, 7, `glyph ${ch} rows`);
    const w = g[0].length;
    assert.ok(w >= 1 && w <= 5, `glyph ${ch} width ${w}`);
    for (const row of g) {
      assert.equal(row.length, w, `glyph ${ch} ragged`);
      assert.match(row, /^[.#]+$/, `glyph ${ch} chars`);
    }
    if (ch !== ' ') assert.ok(g.some((row) => row.includes('#')), `glyph ${ch} is blank`);
  }
});

test('font: measure sums advances minus the trailing spacing, times scale', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  const wA = CB.Font.GLYPHS.A[0].length;
  const wB = CB.Font.GLYPHS.B[0].length;
  assert.equal(CB.Font.measure('AB'), wA + 1 + wB);
  assert.equal(CB.Font.measure('AB', 2), (wA + 1 + wB) * 2);
  assert.equal(CB.Font.measure(''), 0);
  assert.equal(CB.Font.measure('\u0001'), CB.Font.measure('?'), 'unknown → ?');
});

test('font: wrap keeps every line within maxWidth', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  const lines = CB.Font.wrap('TypeError: cannot read properties of undefined (reading x)', 120);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(CB.Font.measure(l) <= 120, l);
  assert.equal(lines.join(' '), 'TypeError: cannot read properties of undefined (reading x)');
});

test('font: draw fills one rect per lit pixel', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  let n = 0;
  const ctx = { fillStyle: '', fillRect: () => n++ };
  CB.Font.draw(ctx, 'I', 0, 0, '#FFFFFF', 1);
  const lit = CB.Font.GLYPHS.I.join('').split('').filter((c) => c === '#').length;
  assert.equal(n, lit);
});

// ---- beyond the plan: the rest of the interface and the shape of the font ----------------------------------------------------

const lit = (g) => g.join('').split('').filter((c) => c === '#').length;
// Every fillRect call of drawing `str`, as [x, y, w, h], plus the fillStyle in force at the first call.
function rects(CB, str, x, y, color, scale) {
  const out = [];
  const ctx = {
    fillStyle: '',
    fillRect: (...a) => out.push({ r: a, style: ctx.fillStyle }),
  };
  CB.Font.draw(ctx, str, x, y, color, scale);
  return out;
}

test('font: constants are the 5x7 cell and the 9 px line pitch', () => {
  const CB = H.load(FILES);
  assert.equal(CB.Font.CELL_H, 7);
  assert.equal(CB.Font.LINE_H, 9);
});

test('font: has() is true only for a single character that has a glyph', () => {
  const CB = H.load(FILES);
  for (const ch of REQUIRED) assert.equal(CB.Font.has(ch), true, ch);
  for (const bad of ['\u0001', '\n', 'é', '😀', 'AB', '', 'constructor', '__proto__', undefined, null, 5]) {
    assert.equal(CB.Font.has(bad), false, String(bad));
  }
});

test('font: every glyph in the table (not only the required ones) is well formed and a single code point', () => {
  const CB = H.load(FILES);
  const keys = Object.keys(CB.Font.GLYPHS);
  for (const ch of REQUIRED) assert.ok(keys.includes(ch), `required ${ch}`);
  for (const k of keys) {
    assert.equal(Array.from(k).length, 1, `key ${JSON.stringify(k)} is one code point`);
    const g = CB.Font.GLYPHS[k];
    assert.equal(g.length, 7);
    for (const row of g) assert.match(row, new RegExp('^[.#]{' + g[0].length + '}$'));
  }
});

test('font: space is 3 px wide and advances like any glyph', () => {
  const CB = H.load(FILES);
  assert.equal(CB.Font.GLYPHS[' '][0].length, 3);
  assert.equal(CB.Font.measure(' '), 3);
  const wA = CB.Font.GLYPHS.A[0].length;
  const wB = CB.Font.GLYPHS.B[0].length;
  assert.equal(CB.Font.measure('A B'), wA + 1 + 3 + 1 + wB);
  assert.equal(rects(CB, '   ', 0, 0, '#fff', 1).length, 0, 'a space lights nothing');
});

test('font: digits are tabular (all 5 wide) so a ticking timer does not jiggle', () => {
  const CB = H.load(FILES);
  for (const d of '0123456789') assert.equal(CB.Font.GLYPHS[d][0].length, 5, d);
  assert.equal(CB.Font.measure('1111'), CB.Font.measure('0000'));
  assert.equal(CB.Font.measure('01:01'), CB.Font.measure('10:10'));
});

test('font: baseline is row 6 and heights follow the rule (caps and digits rows 0-6, x-height letters rows 2-6)', () => {
  const CB = H.load(FILES);
  const G = CB.Font.GLYPHS;
  const rowLit = (ch, r) => G[ch][r].includes('#');
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    assert.ok(rowLit(ch, 0), `${ch} reaches the cap line`);
    assert.ok(rowLit(ch, 6), `${ch} sits on the baseline`);
  }
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') assert.ok(rowLit(ch, 6), `${ch} touches the baseline`);
  for (const ch of 'acemnorsuvwxz') {
    assert.ok(!rowLit(ch, 0) && !rowLit(ch, 1), `${ch} is x-height only`);
    assert.ok(rowLit(ch, 2), `${ch} reaches the x-height line`);
  }
  for (const ch of 'bdfhkl') assert.ok(rowLit(ch, 0), `${ch} has an ascender`);
  // The cell ends at the baseline, so g p q y keep the x-height and put their tail on row 6 (nothing drops below it).
  for (const ch of 'gpqy') {
    assert.ok(!rowLit(ch, 0) && !rowLit(ch, 1), `${ch} is x-height at the top`);
    assert.ok(rowLit(ch, 2) && rowLit(ch, 6), `${ch} spans rows 2-6, tail on the baseline row`);
  }
  assert.ok(rowLit('j', 0) && !rowLit('j', 1) && rowLit('j', 2) && rowLit('j', 6), 'j has its dot on row 0 and a hook on the baseline row');
});

test('font: letters that are easy to confuse are drawn differently', () => {
  const CB = H.load(FILES);
  const G = CB.Font.GLYPHS;
  const groups = ['Il1|i', 'O0o', 'S5s', 'B8', 'Z2z', 'gq9', 'uvU', 'rn', 'cC(', 'DO', 'MN', 'VY', ',.;:', "'`\""];
  for (const grp of groups) {
    const seen = new Map();
    for (const ch of grp) {
      const key = G[ch].join('/');
      assert.ok(!seen.has(key), `${ch} looks the same as ${seen.get(key)}`);
      seen.set(key, ch);
    }
  }
  assert.equal(new Set(Object.values(G).map((g) => g.join('/'))).size, Object.keys(G).length, 'no two characters share a bitmap');
});

test('font: measure counts code points, maps unknowns to ? and tolerates non-strings', () => {
  const CB = H.load(FILES);
  assert.equal(CB.Font.measure('✓'), CB.Font.GLYPHS['✓'][0].length);
  assert.equal(CB.Font.measure('😀'), CB.Font.measure('?'), 'an astral character is one unknown, not two');
  assert.equal(CB.Font.measure('😀😀'), CB.Font.measure('??'));
  assert.equal(CB.Font.measure(42), CB.Font.measure('42'));
  assert.equal(CB.Font.measure(null), 0);
  assert.equal(CB.Font.measure(undefined), 0);
  assert.equal(CB.Font.measure('AB', 0), CB.Font.measure('AB'), 'a bad scale falls back to 1');
  assert.equal(CB.Font.measure('AB', -3), CB.Font.measure('AB'));
  assert.equal(CB.Font.measure('AB', undefined), CB.Font.measure('AB'));
  assert.equal(CB.Font.measure('AB', 3), CB.Font.measure('AB') * 3);
});

test('font: draw puts each glyph at its advance, scales every pixel and sets the colour first', () => {
  const CB = H.load(FILES);
  const one = rects(CB, 'I', 10, 20, '#ABCDEF', 2);
  assert.equal(one.length, lit(CB.Font.GLYPHS.I));
  assert.deepEqual(one[0].r, [10, 20, 2, 2], 'first lit pixel of I is (0,0) at scale 2');
  for (const q of one) {
    assert.equal(q.style, '#ABCDEF');
    assert.equal(q.r[2], 2);
    assert.equal(q.r[3], 2);
    assert.equal((q.r[0] - 10) % 2, 0);
    assert.equal((q.r[1] - 20) % 2, 0);
  }
  const wA = CB.Font.GLYPHS.A[0].length;
  const ab = rects(CB, 'AB', 0, 0, '#fff', 1);
  const a = rects(CB, 'A', 0, 0, '#fff', 1);
  const b = rects(CB, 'B', wA + 1, 0, '#fff', 1);
  assert.deepEqual(ab.map((q) => q.r), [...a, ...b].map((q) => q.r), 'B starts one glyph width plus one px after A');
  const ab2 = rects(CB, 'AB', 4, 6, '#fff', 3);
  assert.equal(ab2.length, ab.length);
  for (const q of ab2) {
    assert.ok(q.r[0] >= 4 && q.r[0] + 3 <= 4 + CB.Font.measure('AB', 3), 'stays inside the measured width');
    assert.ok(q.r[1] >= 6 && q.r[1] + 3 <= 6 + CB.Font.CELL_H * 3, 'stays inside the cell height');
  }
});

test('font: draw renders unknown characters as ? and an empty string as nothing', () => {
  const CB = H.load(FILES);
  assert.deepEqual(rects(CB, '\u0001', 0, 0, '#fff', 1).map((q) => q.r), rects(CB, '?', 0, 0, '#fff', 1).map((q) => q.r));
  assert.equal(rects(CB, '😀', 0, 0, '#fff', 1).length, lit(CB.Font.GLYPHS['?']));
  assert.equal(rects(CB, '', 0, 0, '#fff', 1).length, 0);
  const noScale = rects(CB, 'Hi', 0, 0, '#fff');
  assert.deepEqual(noScale.map((q) => q.r), rects(CB, 'Hi', 0, 0, '#fff', 1).map((q) => q.r), 'scale defaults to 1');
});

test('font: draw never reaches past measure() or below the 7 px cell, for every glyph', () => {
  const CB = H.load(FILES);
  for (const ch of Object.keys(CB.Font.GLYPHS)) {
    const s = ch + ch;
    const w = CB.Font.measure(s);
    for (const q of rects(CB, s, 0, 0, '#fff', 1)) {
      assert.ok(q.r[0] >= 0 && q.r[0] < w, `${ch} x ${q.r[0]} within ${w}`);
      assert.ok(q.r[1] >= 0 && q.r[1] < CB.Font.CELL_H, `${ch} y ${q.r[1]}`);
    }
  }
});

test('font: wrap hard-breaks a word that is wider than the line and still terminates', () => {
  const CB = H.load(FILES);
  const long = 'Pneumonoultramicroscopic';
  const lines = CB.Font.wrap(long, 40);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(CB.Font.measure(l) <= 40, l);
  assert.equal(lines.join(''), long, 'no character lost');
  const after = CB.Font.wrap('ok ' + long + ' end', 40);
  for (const l of after) assert.ok(CB.Font.measure(l) <= 40, l);
  assert.equal(after.join(' ').replace(/ /g, ''), ('ok' + long + 'end'), 'every character kept in order');
  const tiny = CB.Font.wrap('abc', 1);
  assert.deepEqual(tiny, ['a', 'b', 'c'], 'narrower than a glyph: one character per line, no infinite loop');
});

test('font: wrap fills greedily, collapses runs of spaces, honours scale and explicit newlines', () => {
  const CB = H.load(FILES);
  const M = (s, sc) => CB.Font.measure(s, sc);
  assert.deepEqual(CB.Font.wrap('aa bb', 1000), ['aa bb']);
  assert.deepEqual(CB.Font.wrap('  aa   bb  ', 1000), ['aa bb'], 'extra spaces collapse');
  assert.deepEqual(CB.Font.wrap('aa bb', M('aa bb') - 1), ['aa', 'bb'], 'one px short forces the break');
  assert.deepEqual(CB.Font.wrap('aa bb', M('aa bb')), ['aa bb'], 'an exact fit stays on one line');
  assert.deepEqual(CB.Font.wrap('aa bb', M('aa', 2), 2), ['aa', 'bb'], 'scale is applied to the limit');
  assert.deepEqual(CB.Font.wrap('aa bb', M('aa bb', 2), 2), ['aa bb']);
  assert.deepEqual(CB.Font.wrap('one\ntwo', 1000), ['one', 'two']);
  assert.deepEqual(CB.Font.wrap('one\n\ntwo', 1000), ['one', '', 'two'], 'a blank line survives');
  assert.deepEqual(CB.Font.wrap('', 100), [''], 'empty text is one empty line, never an empty list');
  assert.deepEqual(CB.Font.wrap('   ', 100), ['']);
  assert.deepEqual(CB.Font.wrap(undefined, 100), ['']);
  assert.deepEqual(CB.Font.wrap(12345, 1000), ['12345']);
});

test('font: wrap leaves no line wider than the limit across a sweep of widths (words that fit are never split)', () => {
  const CB = H.load(FILES);
  const text = 'it works on my machine ✓ git reset --hard HEAD · WASD move · Mouse aim → 100% (reading x) [ok] {a: 1}';
  const widest = Math.max(...text.split(' ').map((w) => CB.Font.measure(w)));
  for (let max = widest; max <= 300; max += 7) {
    const lines = CB.Font.wrap(text, max);
    for (const l of lines) assert.ok(CB.Font.measure(l) <= max, `"${l}" > ${max}`);
    assert.equal(lines.join(' '), text, `lossless at ${max}`);
  }
});

test('font: the longest lines the screens draw fit the 320 px screen, and 46-char diff lines fit 228 px', () => {
  const CB = H.load(FILES);
  const M = (s) => CB.Font.measure(s);
  const screen = [
    'WASD move · Mouse aim · Click shoot · Space dash',
    'E /compact · N music · M mute · V calm · Esc pause',
    'Esc: resume · Q: quit to title',
    'Space/Shift dash · E /compact (meter full)',
    'M sound: on · N music: on · V calm: off',
    'Fan game. Not affiliated with Anthropic.',
    '✻ Thinking... (compacting conversation)',
    '✻ Thinking... (reading MERGE_HEAD)',
    '✻ Thinking... ⚠ this is prod',
    'ALL TESTS PASSING ✓',
  ];
  for (const s of screen) assert.ok(M(s) <= 300, `${s} is ${M(s)} px`);
  assert.ok(M('ALL TESTS PASSING ✓') * 2 <= 320, 'the scale-2 victory title fits');
  assert.ok(M('CLAWD') * 3 <= 320 && M('BUGS') * 3 <= 320, 'the scale-3 title words fit');
  const diff = [
    '- while (true) { await sleep(Infinity); }  ',
    '+ if (ttl < now) { cache.delete(key); }   ',
    '- const total = items.reduce((a, b) => a + b);',
    '+ <<<<<<< HEAD  ======= >>>>>>> feature/bugs',
  ];
  for (const d of diff) {
    const line = d.slice(0, 46);
    assert.ok(M(line) <= 228, `"${line}" is ${M(line)} px`);
  }
});
