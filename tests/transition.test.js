'use strict';
// CB.Transition (the terminal-style dither wipe between scenes) and how src/main.js drives it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');

const FILES = [...H.CORE, 'src/game/unlocks.js', 'src/game/comfort.js', 'src/scenes/transition.js'];
const COLS = 40; // 320 / 8
const ROWS = 23; // ceil(180 / 8)
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

function setup(calm) {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  if (calm) CB.Comfort.set(true);
  return { CB, sandbox, T: CB.Transition };
}

// Records rect and text draws with the alpha that was in force (r.alpha multiplies).
function fakeR() {
  const log = [];
  let a = 1;
  const r = {
    rect: (x, y, w, h, c) => log.push({ kind: 'rect', x, y, w, h, c, a }),
    text: (s, x, y, o) => log.push({ kind: 'text', s, x, y, o, a }),
    alpha: (v, fn) => {
      if (v <= 0) return;
      const prev = a;
      a = prev * v;
      try {
        fn();
      } finally {
        a = prev;
      }
    },
  };
  r.rects = () => log.filter((l) => l.kind === 'rect');
  r.texts = () => log.filter((l) => l.kind === 'text');
  r.log = log;
  return r;
}

// The spec's hash, written out again so the module is checked against the formula, not against itself.
const hashOf = (bx, by) => ((bx * 73856093) ^ (by * 19349663)) >>> 0;

test('transition: the module exposes start, update, active, progress, draw and cells', () => {
  const { T } = setup();
  for (const k of ['start', 'update', 'active', 'progress', 'draw', 'cells']) assert.equal(typeof T[k], 'function', k);
});

test('transition: idle by default; start() activates it and update() runs the 0.6 s clock', () => {
  const { T } = setup();
  assert.equal(T.active(), false);
  assert.equal(T.progress(), 1, 'nothing covers the screen when idle');
  T.update(1);
  assert.equal(T.active(), false, 'updating an idle transition does nothing');
  T.start('$ exit');
  assert.equal(T.active(), true);
  for (let i = 0; i < 35; i++) T.update(0.016); // 0.56 s
  assert.equal(T.active(), true);
  for (let i = 0; i < 4; i++) T.update(0.016); // 0.624 s
  assert.equal(T.active(), false, 'over after 0.6 s');
  T.update(0.5);
  assert.equal(T.active(), false);
  T.start('again');
  assert.equal(T.active(), true, 'it can start again');
});

test('transition: progress is 0 through the solid ink (to 0.1 s), 0..1 over the dither (0.1 to 0.4 s), then 1', () => {
  const { T } = setup();
  const at = (t) => {
    T.start('x');
    T.update(t);
    return T.progress();
  };
  assert.equal(at(0), 0);
  assert.equal(at(0.05), 0);
  assert.equal(at(0.1), 0);
  assert.ok(near(at(0.175), 0.25), String(at(0.175)));
  assert.ok(near(at(0.25), 0.5), String(at(0.25)));
  assert.ok(near(at(0.325), 0.75));
  assert.equal(at(0.4), 1);
  assert.equal(at(0.5), 1, 'the label bar lingers after the wipe is done');
  assert.equal(at(0.59), 1);
});

test('transition: cells(p) lists the blocks still covered on the 40 x 23 grid of 8 px blocks', () => {
  const { T } = setup();
  const all = T.cells(0);
  assert.equal(all.length, COLS * ROWS, 'p = 0: every block');
  const seen = new Set(all.map((c) => c.bx + ',' + c.by));
  assert.equal(seen.size, all.length, 'no block twice');
  for (const c of all) assert.ok(c.bx >= 0 && c.bx < COLS && c.by >= 0 && c.by < ROWS && Number.isInteger(c.bx) && Number.isInteger(c.by));
  assert.equal(T.cells(1).length, 0, 'p = 1: nothing left');
});

test('transition: a block is revealed exactly when hash % 1000 < p * 1000 (hash = (bx*73856093 ^ by*19349663) >>> 0)', () => {
  const { T } = setup();
  for (const p of [0, 0.01, 0.1, 0.25, 0.5, 0.777, 0.99, 1]) {
    const covered = new Set(T.cells(p).map((c) => c.bx + ',' + c.by));
    for (let by = 0; by < ROWS; by++) {
      for (let bx = 0; bx < COLS; bx++) {
        const revealed = hashOf(bx, by) % 1000 < p * 1000;
        assert.equal(covered.has(bx + ',' + by), !revealed, `p=${p} block ${bx},${by}`);
      }
    }
  }
});

test('transition: cells() only ever uncovers blocks as p rises, is deterministic, and clamps p to 0..1', () => {
  const { T } = setup();
  let prev = T.cells(0).map((c) => c.bx + ',' + c.by);
  for (let i = 1; i <= 20; i++) {
    const cur = T.cells(i / 20).map((c) => c.bx + ',' + c.by);
    const curSet = new Set(prev);
    for (const k of cur) assert.ok(curSet.has(k), `block ${k} was uncovered and came back at step ${i}`);
    assert.ok(cur.length <= prev.length);
    prev = cur;
  }
  assert.deepEqual(H.plain(T.cells(0.4)), H.plain(T.cells(0.4)));
  assert.equal(T.cells(-3).length, COLS * ROWS);
  assert.equal(T.cells(7).length, 0);
  const half = T.cells(0.5).length;
  assert.ok(half > COLS * ROWS * 0.4 && half < COLS * ROWS * 0.6, `about half left at p = 0.5, got ${half}`);
});

test('transition: draw() does nothing while idle and after the end', () => {
  const { T } = setup();
  const r = fakeR();
  T.draw(r, 0);
  assert.equal(r.log.length, 0);
  T.start('$ exit');
  T.update(0.7);
  T.draw(r, 0);
  assert.equal(r.log.length, 0);
});

test('transition: solid ink over the whole screen for the first 0.1 s', () => {
  const { CB, T } = setup();
  T.start('$ exit');
  T.update(0.05);
  const r = fakeR();
  T.draw(r, 0);
  const full = r.rects().filter((q) => q.w === 320 && q.h === 180);
  assert.equal(full.length, 1);
  assert.deepEqual(H.plain([full[0].x, full[0].y, full[0].c, full[0].a]), [0, 0, CB.Pal.C.ink, 1]);
  assert.equal(r.rects().filter((q) => q.a === 1).length, 1, 'nothing else at full alpha');
});

test('transition: the dither phase paints only the still-covered blocks, as ink, aligned to the 8 px grid', () => {
  const { CB, T } = setup();
  T.start('$ exit');
  T.update(0.25); // p = 0.5
  const r = fakeR();
  T.draw(r, 0);
  const cover = r.rects().filter((q) => q.a === 1);
  assert.ok(cover.length > 0);
  assert.ok(cover.every((q) => q.c === CB.Pal.C.ink));
  assert.ok(cover.every((q) => q.x % 8 === 0 && q.y % 8 === 0 && q.w % 8 === 0), 'runs of whole blocks');
  const expected = new Set(T.cells(T.progress()).map((c) => c.bx + ',' + c.by));
  const painted = new Set();
  for (const q of cover) {
    for (let bx = q.x / 8; bx < (q.x + q.w) / 8; bx++) {
      const k = bx + ',' + q.y / 8;
      assert.ok(!painted.has(k), `block ${k} painted twice`);
      painted.add(k);
    }
  }
  assert.deepEqual([...painted].sort(), [...expected].sort(), 'exactly the covered blocks');
  assert.ok(cover.every((q) => q.y + q.h <= 180), 'the last row is clipped to the 180 px screen');
  assert.ok(cover.length < expected.size, 'neighbouring blocks are merged into runs');
});

test('transition: after the wipe (0.4 s on) only the label bar is left', () => {
  const { T } = setup();
  T.start('$ exit');
  T.update(0.45);
  const r = fakeR();
  T.draw(r, 0);
  assert.equal(r.rects().filter((q) => q.a === 1).length, 0, 'no cover');
  assert.equal(r.rects().length, 1, 'just the bar');
});

test('transition: the 14 px terminal bar is ink at alpha 0.85, y 160 to 174, full width', () => {
  const { CB, T } = setup();
  T.start('$ exit');
  T.update(0.3);
  const r = fakeR();
  T.draw(r, 0);
  const bar = r.rects().filter((q) => q.h === 14);
  assert.equal(bar.length, 1);
  assert.deepEqual(H.plain([bar[0].x, bar[0].y, bar[0].w, bar[0].h, bar[0].c]), [0, 160, 320, 14, CB.Pal.C.ink]);
  assert.ok(near(bar[0].a, 0.85), String(bar[0].a));
});

test('transition: the label is typed at 0.03 s a character', () => {
  const { T } = setup();
  const typed = (label, t) => {
    T.start(label);
    T.update(t);
    const r = fakeR();
    T.draw(r, 0);
    const tx = r.texts();
    return tx.length ? tx[0].s : '';
  };
  assert.equal(typed('$ exit', 0.01), '', 'nothing typed yet');
  assert.equal(typed('$ exit', 0.035), '$');
  assert.equal(typed('$ exit', 0.095), '$ e');
  assert.equal(typed('$ exit', 0.155), '$ exit'.slice(0, 5));
  assert.equal(typed('$ exit', 0.25), '$ exit', 'complete, and it stays that way');
  assert.equal(typed('$ exit', 0.4), '$ exit');
});

test('transition: every real label is fully typed before the bar fades out', () => {
  const { T } = setup();
  for (const label of ['$ ./clawd --fight', '$ exit', '$ git reset --hard HEAD']) {
    T.start(label);
    T.update(0.5);
    const r = fakeR();
    T.draw(r, 0);
    const tx = r.texts();
    assert.equal(tx.length, 1, label);
    assert.equal(tx[0].s, label, `${label} is complete at 0.5 s`);
  }
});

test('transition: the bar and its text fade out and are gone by 0.6 s', () => {
  const { T } = setup();
  const alphaAt = (t) => {
    T.start('$ exit');
    T.update(t);
    const r = fakeR();
    T.draw(r, 0);
    const bar = r.rects().filter((q) => q.h === 14)[0];
    const tx = r.texts()[0];
    return { bar: bar ? bar.a : 0, text: tx ? tx.a : 0 };
  };
  const a1 = alphaAt(0.3);
  const a2 = alphaAt(0.55);
  const a3 = alphaAt(0.59);
  assert.ok(near(a1.bar, 0.85) && near(a1.text, 1), JSON.stringify(a1));
  assert.ok(a2.bar < a1.bar && a2.bar > a3.bar, `${a1.bar} > ${a2.bar} > ${a3.bar}`);
  assert.ok(a2.text < 1 && a2.text > a3.text);
  assert.ok(a3.bar < 0.2, `almost gone at 0.59 s: ${a3.bar}`);
  T.start('$ exit');
  T.update(0.6);
  assert.equal(T.active(), false);
});

test('transition: the label sits inside the bar, 320 px wide at most', () => {
  const { CB, T } = setup();
  T.start('$ git reset --hard HEAD');
  T.update(0.5);
  const r = fakeR();
  const rec = H.recorder(r, CB);
  T.draw(r, 0);
  const tb = rec.texts();
  assert.equal(tb.length, 1);
  assert.ok(tb[0].y >= 160 && tb[0].y + tb[0].h <= 174, `text box ${JSON.stringify(tb[0])}`);
  assert.ok(tb[0].x >= 0 && tb[0].x + tb[0].w <= 320, `text box ${JSON.stringify(tb[0])}`);
});

test('transition: calm mode swaps the dither for a plain 0.25 s fade of ink, with no label bar', () => {
  const { CB, T } = setup(true);
  T.start('$ ./clawd --fight');
  T.update(0.05);
  assert.equal(T.active(), true);
  let r = fakeR();
  T.draw(r, 0);
  assert.equal(r.texts().length, 0, 'no typing in calm mode');
  assert.equal(r.rects().length, 1, 'one full-screen rect');
  const q = r.rects()[0];
  assert.deepEqual(H.plain([q.x, q.y, q.w, q.h, q.c]), [0, 0, 320, 180, CB.Pal.C.ink]);
  assert.ok(near(q.a, 0.8), `alpha ${q.a}`);
  T.update(0.1);
  r = fakeR();
  T.draw(r, 0);
  assert.ok(near(r.rects()[0].a, 0.4), `alpha ${r.rects()[0].a}`);
  assert.ok(near(T.progress(), 0.6), String(T.progress()));
  T.update(0.11);
  assert.equal(T.active(), false, 'over after 0.25 s');
  assert.equal(T.progress(), 1);
});

test('transition: calm is read when the transition starts, so toggling mid-way does not change its length', () => {
  const { CB, T } = setup(false);
  T.start('x');
  CB.Comfort.set(true);
  T.update(0.3);
  assert.equal(T.active(), true, 'a normal transition is still 0.6 s long');
  CB.Comfort.set(false);
  T.start('x');
  CB.Comfort.set(true);
  T.update(0.3);
  assert.equal(T.active(), true);
  CB.Comfort.set(true);
  T.start('x');
  CB.Comfort.set(false);
  T.update(0.3);
  assert.equal(T.active(), false, 'a calm one ends at 0.25 s');
});

test('transition: works without CB.Comfort (never calm)', () => {
  const { CB, sandbox } = H.load([...H.CORE, 'src/scenes/transition.js'], { returnSandbox: true });
  assert.equal(CB.Comfort, undefined);
  CB.Transition.start('x');
  CB.Transition.update(0.3);
  assert.equal(CB.Transition.active(), true);
  assert.doesNotThrow(() => CB.Transition.draw(fakeR(), 0));
  assert.ok(sandbox);
});

// ---- src/main.js wiring ----------------------------------------------------------------------------------------------------

const MAIN = fs.readFileSync(path.join(H.ROOT, 'src/main.js'), 'utf8');
const LIBS = [
  'src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js', 'src/art/render.js',
  'src/core/input.js', 'src/core/loop.js',
  'src/game/world.js', 'src/game/projectiles.js', 'src/game/patches.js', 'src/game/player.js', 'src/game/fx.js',
  'src/game/unlocks.js', 'src/game/comfort.js', 'src/scenes/transition.js',
];

// A booted main.js with stub scenes and a spy around every Transition method.
function boot(hash) {
  const { CB, sandbox } = H.load(LIBS, { returnSandbox: true });
  delete sandbox.CB_NO_BOOT;
  const env = { CB, sandbox, calls: [], nowMs: 0, rafCb: null };
  sandbox.performance = { now: () => env.nowMs };
  sandbox.requestAnimationFrame = (f) => {
    env.rafCb = f;
    return 1;
  };
  sandbox.location = { protocol: 'http:', hostname: 'localhost', hash: hash || '', reload() {} };
  const canvas = sandbox.document.getElementById();
  sandbox.document.getElementById = () => canvas;
  CB.Audio = { init() {}, toggleMute() {}, play() {}, handleEvents() {} };
  for (const name of ['title', 'play', 'other']) {
    CB.Scenes[name] = {
      enter: () => env.calls.push(['enter', name]),
      update: () => env.calls.push(['scene.update', name]),
      draw: () => env.calls.push(['scene.draw', name]),
    };
  }
  CB.Screens.panic = { draw() {} };
  CB.Font = { measure: (str, sc) => String(str).length * 6 * (sc || 1), CELL_H: 7, draw() {} }; // the real bitmap font is Task 8's
  for (const k of ['start', 'update', 'draw']) {
    const orig = CB.Transition[k];
    CB.Transition[k] = function (...a) {
      env.calls.push(['T.' + k, k === 'start' ? a[0] : undefined]);
      return orig.apply(CB.Transition, a);
    };
  }
  env.run = () => vm.runInContext(MAIN, sandbox, { filename: 'src/main.js' });
  env.frame = (ms) => {
    env.nowMs += ms;
    env.rafCb();
  };
  env.names = () => env.calls.map((c) => c.join(':'));
  return env;
}

test('main: the first scene (title at boot) gets no transition', () => {
  const env = boot();
  env.run();
  assert.equal(env.CB.game.sceneName, 'title');
  assert.equal(env.calls.some((c) => c[0] === 'T.start'), false);
  assert.equal(env.CB.Transition.active(), false);
});

test('main: a debug start straight into play gets no transition', () => {
  const env = boot('#stage=2&god');
  env.run();
  assert.equal(env.CB.game.sceneName, 'play');
  assert.equal(env.calls.some((c) => c[0] === 'T.start'), false);
});

test('main: title to play starts "$ ./clawd --fight", play to title starts "$ exit"', () => {
  const env = boot();
  env.run();
  env.CB.game.go('play', {});
  assert.deepEqual(env.calls.filter((c) => c[0] === 'T.start'), [['T.start', '$ ./clawd --fight']]);
  assert.equal(env.CB.Transition.active(), true);
  env.calls.length = 0;
  env.CB.game.go('title');
  assert.deepEqual(env.calls.filter((c) => c[0] === 'T.start'), [['T.start', '$ exit']]);
});

test('main: scene changes with no label (any other pair) start no transition', () => {
  const env = boot();
  env.run();
  env.CB.game.go('other', {});
  env.CB.game.go('title');
  env.CB.game.go('other', {});
  env.CB.game.go('play', {});
  assert.equal(env.calls.some((c) => c[0] === 'T.start'), false);
});

test('main: each simulated frame updates the transition, and render draws it after the scene', () => {
  const env = boot();
  env.run();
  env.CB.game.go('play', {});
  env.calls.length = 0;
  env.frame(34); // two fixed ticks
  const names = env.names();
  assert.equal(names.filter((n) => n === 'T.update:').length, 2, names.join(' '));
  const draw = names.indexOf('scene.draw:play');
  assert.ok(draw >= 0);
  assert.equal(names.indexOf('T.draw:'), draw + 1, 'drawn right after the scene, i.e. last');
  assert.equal(names.indexOf('T.draw:'), names.lastIndexOf('T.draw:'));
});

test('main: the transition clock runs on fixed ticks and ends after 0.6 s of frames', () => {
  const env = boot();
  env.run();
  env.CB.game.go('play', {});
  for (let i = 0; i < 30; i++) env.frame(16.667);
  assert.equal(env.CB.Transition.active(), true, 'about 0.5 s in');
  for (let i = 0; i < 10; i++) env.frame(16.667);
  assert.equal(env.CB.Transition.active(), false);
});

test('main: a game without CB.Transition runs exactly as before', () => {
  const env = boot();
  env.run();
  env.CB.Transition = undefined;
  assert.doesNotThrow(() => env.CB.game.go('play', {}));
  assert.doesNotThrow(() => env.frame(20));
  env.CB.Transition = {};
  assert.doesNotThrow(() => env.CB.game.go('title'), 'a partial stub is fine too');
  assert.doesNotThrow(() => env.frame(20));
});

test('transition: every phase draws through the real renderer without trouble, normal and calm', () => {
  for (const calm of [false, true]) {
    const { CB, sandbox } = H.load([...FILES, 'src/art/render.js'], { returnSandbox: true });
    CB.Font = { measure: (str, sc) => String(str).length * 6 * (sc || 1), CELL_H: 7, draw() {} }; // the real bitmap font is Task 8's
    if (calm) CB.Comfort.set(true);
    const r = CB.createRenderer(sandbox.document.getElementById());
    CB.Transition.start('$ git reset --hard HEAD');
    for (let i = 0; i < 70; i++) {
      assert.doesNotThrow(() => CB.Transition.draw(r, i * 0.01), `calm=${calm} frame ${i}`);
      CB.Transition.update(0.01);
    }
    assert.equal(CB.Transition.active(), false);
  }
});

test('index.html loads comfort.js right after unlocks.js (it reads CB.Save) and transition.js just before main.js', () => {
  const list = H.scriptList();
  assert.equal(list.indexOf('src/game/comfort.js'), list.indexOf('src/game/unlocks.js') + 1);
  assert.equal(list.indexOf('src/scenes/transition.js'), list.indexOf('src/main.js') - 1);
  assert.ok(list.indexOf('src/scenes/play.js') < list.indexOf('src/scenes/transition.js'));
});
