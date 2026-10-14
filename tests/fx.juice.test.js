'use strict';
// Task 21B: bug life cycle, muzzle flash, boss finale, glitch, quip hooks and the patch celebration, all driven by world events.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(opts) {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js'], { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  CB.Enemies.dummy = { create: (w, x, y, o) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 2, r: 6 }, o || {})), update() {}, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r, w: CB.createWorld(Object.assign({ seed: 4, god: true }, opts || {})) };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const C = (CB) => CB.Pal.C;

// Emits events and feeds them to Fx outside a step (the way the run does for bossDie and bossEnter).
function feed(CB, w, evs) {
  const from = w.events.length;
  for (const e of evs) w.emit(e.type, e);
  CB.Fx.consume(w, from);
}
const kinds = (w, kind) => w.fx.filter((f) => f.kind === kind);

// A renderer that only records what Fx asked for (with the alpha in force at the time).
function spy() {
  const calls = [];
  let a = 1;
  const rec = (fn) => (...args) => { calls.push({ fn, args, a }); };
  const r = {
    alpha(v, fn) {
      const prev = a;
      a = prev * v;
      try { fn(); } finally { a = prev; }
    },
    rect: rec('rect'), disc: rec('disc'), ring: rec('ring'), line: rec('line'), frame: rec('frame'), text: rec('text'), sprite: rec('sprite'),
    measure: (s) => String(s).length * 6,
  };
  return { r, calls, of: (fn) => calls.filter((c) => c.fn === fn) };
}

// ---- Pose -----------------------------------------------------------------------------------------------------------------

test('juice: pose is exactly (1,1) after 0.25 s and bounded during pop-in', () => {
  const { CB } = setup();
  for (let t = 0; t < 0.25; t += 0.01) {
    const q = CB.Fx.pose({ t, hitFlash: 0, boss: false });
    assert.ok(q.sy >= 0.2 && q.sy <= 1.4 && q.sx >= 0.8 && q.sx <= 1.4);
  }
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 0.3, hitFlash: 0 })), { sx: 1, sy: 1 });
  assert.ok(CB.Fx.pose({ t: 1, hitFlash: 0.05 }).sy < 1);
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 0, hitFlash: 0.05, boss: true })), { sx: 1, sy: 1 });
});

test('juice: pose pop-in eases 0.2 -> 1.2 (at 0.15 s) -> 1.0 (at 0.25 s) with sx = clamp(1/sy, 0.8, 1.4); a hit squashes to 1.12 x 0.9', () => {
  const { CB } = setup();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(CB.Fx.pose({ t: 0 }).sy, 0.2));
  assert.equal(CB.Fx.pose({ t: 0 }).sx, 1.4, '1/0.2 is clamped to 1.4');
  assert.ok(near(CB.Fx.pose({ t: 0.15 }).sy, 1.2));
  assert.ok(near(CB.Fx.pose({ t: 0.15 }).sx, 1 / 1.2), '1/1.2 = 0.833 is above the 0.8 floor');
  assert.ok(near(CB.Fx.pose({ t: 0.25 - 1e-12 }).sy, 1.0) || Math.abs(CB.Fx.pose({ t: 0.25 - 1e-12 }).sy - 1) < 1e-6);
  let prev = -Infinity;
  for (let t = 0; t <= 0.15 + 1e-9; t += 0.005) {
    const sy = CB.Fx.pose({ t }).sy;
    assert.ok(sy >= prev - 1e-9, `rising at ${t}`);
    prev = sy;
  }
  for (let t = 0.15; t < 0.25; t += 0.005) {
    const sy = CB.Fx.pose({ t }).sy;
    assert.ok(sy <= prev + 1e-9, `settling at ${t}`);
    prev = sy;
  }
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 5, hitFlash: 0.02 })), { sx: 1.12, sy: 0.9 });
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 5, hitFlash: 0 })), { sx: 1, sy: 1 });
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 0.1, hitFlash: 0.02, boss: true })), { sx: 1, sy: 1 }, 'boss parts never deform');
  assert.deepEqual(H.plain(CB.Fx.pose({})), { sx: 1, sy: 1 }, 'a bare object (no t) is settled');
  assert.deepEqual(H.plain(CB.Fx.pose(null)), { sx: 1, sy: 1 });
  assert.notEqual(CB.Fx.pose({ t: 1 }), CB.Fx.pose({ t: 1 }), 'a fresh object each call');
});

// ---- Bug life cycle -------------------------------------------------------------------------------------------------------

test('juice: a kill leaves a decal and debris; a silent kill leaves no decal; decals cap at 40', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 80);
  H.stepN(w, 1, idle);
  w.damageEnemy(e, 5);
  const f = w.spawnEnemy('dummy', 150, 80);
  H.stepN(w, 1, idle);
  w.killEnemy(f, true);
  H.stepN(w, 1, idle);
  assert.equal(w.fx.filter((x) => x.kind === 'decal').length, 0, 'decals only from in-step deaths');
  for (let i = 0; i < 60; i++) {
    const g = w.spawnEnemy('dummy', 40 + i, 60, { hp: 0.5 });
    w.firePlayerBolt(g.x, g.y, 0);
  }
  H.stepN(w, 2, idle);
  const decals = w.fx.filter((x) => x.kind === 'decal').length;
  assert.ok(decals > 0 && decals <= 40, `decals ${decals}`);
  assert.ok(w.fx.length <= 500);
});

test('juice: a real kill is a white pop disc, 4 + r debris squares at 40-90 px/s in the kind colours, and a floor decal', () => {
  const { CB, w } = setup();
  const c = C(CB);
  feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'syntaxError', r: 6, boss: false, silent: false }]);
  const pop = kinds(w, 'pop');
  assert.equal(pop.length, 1);
  assert.equal(pop[0].r, 6);
  assert.equal(pop[0].life, 0.06);
  assert.equal(pop[0].color || c.white, c.white);
  const debris = w.fx.filter((f) => f.kind === 'p' && f.size === 2);
  assert.equal(debris.length, 4 + 6);
  for (const d of debris) {
    assert.ok(d.color === c.red || d.color === c.redDark, d.color);
    const sp = Math.hypot(d.vx, d.vy);
    assert.ok(sp >= 40 - 1e-9 && sp <= 90 + 1e-9, `speed ${sp}`);
    assert.equal(d.life, 0.5);
  }
  assert.ok(debris.some((d) => d.color === c.red) && debris.some((d) => d.color === c.redDark), 'both shades');
  const decal = kinds(w, 'decal');
  assert.equal(decal.length, 1);
  assert.ok(Math.abs(decal[0].r - 0.9 * 6) < 1e-9);
  assert.equal(decal[0].color, c.redDark);
  assert.equal(decal[0].life, 6);
  assert.equal(decal[0].x, 100);
  assert.equal(decal[0].y, 60);
});

test('juice: every bug kind has its own colours; an unknown kind still gets a stain', () => {
  const { CB, w } = setup();
  const c = C(CB);
  const want = {
    syntaxError: [c.red, c.redDark], nullPointer: [c.pale, c.grey], raceCondition: [c.yellow, c.yellowDark],
    memoryLeak: [c.green, c.greenDark], offByOne: [c.purple, c.purpleDark],
  };
  for (const [kind, [main, dark]] of Object.entries(want)) {
    w.fx.length = 0;
    feed(CB, w, [{ type: 'enemyDie', x: 50, y: 50, kind, r: 5, boss: false, silent: false }]);
    // A slime's stain is neutral grey: the Memory Leak boss's puddles are green, and a kill's decal must never read as one.
    assert.equal(kinds(w, 'decal')[0].color, kind === 'memoryLeak' ? c.greyDark : dark, kind);
    const cols = new Set(w.fx.filter((f) => f.kind === 'p' && f.size === 2).map((f) => f.color));
    assert.deepEqual([...cols].sort(), [main, dark].sort(), kind);
  }
  w.fx.length = 0;
  feed(CB, w, [{ type: 'enemyDie', x: 50, y: 50, kind: 'mystery', r: 5, boss: false, silent: false }]);
  assert.equal(kinds(w, 'decal').length, 1);
  assert.ok(kinds(w, 'pop').length === 1);
});

test('juice: boss parts and silent kills get no pop, debris or decal', () => {
  const { CB, w } = setup();
  feed(CB, w, [
    { type: 'enemyDie', x: 100, y: 60, kind: 'bossHead', r: 12, boss: true, silent: false },
    { type: 'enemyDie', x: 120, y: 60, kind: 'dummy', r: 6, boss: false, silent: true },
  ]);
  assert.equal(kinds(w, 'pop').length, 0);
  assert.equal(kinds(w, 'decal').length, 0);
  assert.equal(w.fx.filter((f) => f.size === 2).length, 0);
});

test('juice: a decal with no radius or a missing r is still finite', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'dummy', boss: false }]);
  for (const f of w.fx) for (const k of ['x', 'y', 'life']) assert.ok(Number.isFinite(f[k]), `${f.kind}.${k}`);
  for (const f of kinds(w, 'decal').concat(kinds(w, 'pop'))) assert.ok(Number.isFinite(f.r) && f.r > 0);
});

test('juice: the 41st decal pushes out the oldest one first', () => {
  const { CB, w } = setup();
  for (let i = 0; i < 45; i++) feed(CB, w, [{ type: 'enemyDie', x: 10 + i, y: 60, kind: 'dummy', r: 4, boss: false, silent: false }]);
  const xs = kinds(w, 'decal').map((f) => f.x);
  assert.equal(xs.length, 40);
  assert.equal(Math.min(...xs), 15, 'decals 0-4 were dropped, oldest first');
  assert.equal(Math.max(...xs), 54);
});

test('juice: decals survive a particle flood at the cap and drop only when their 6 s are up', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'dummy', r: 4, boss: false, silent: false }]);
  assert.equal(kinds(w, 'decal').length, 1);
  for (let i = 0; i < 30; i++) CB.Fx.spark(w, 50, 50, '#FFFFFF', 40, 50, 5); // 1200 particles into a 500 cap
  assert.equal(w.fx.length, CB.CAPS.fx);
  assert.equal(kinds(w, 'decal').length, 1, 'the old stain outlives the flood');
  w.fx.length = 0;
  feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'dummy', r: 4, boss: false, silent: false }]);
  CB.Fx.update(w, 5.9);
  assert.equal(kinds(w, 'decal').length, 1);
  CB.Fx.update(w, 0.2);
  assert.equal(kinds(w, 'decal').length, 0);
});

test('juice: decals draw under entities at alpha 0.35, fade over the last 2 s, and Fx.draw skips them', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'syntaxError', r: 6, boss: false, silent: false }]);
  w.fx = w.fx.filter((f) => f.kind === 'decal');
  let s = spy();
  CB.Fx.drawUnder(w, s.r, 1);
  assert.equal(s.of('disc').length, 1);
  assert.equal(s.of('disc')[0].args[3], C(CB).redDark);
  assert.ok(Math.abs(s.of('disc')[0].a - 0.35) < 1e-9);
  s = spy();
  CB.Fx.draw(w, s.r, 1);
  assert.equal(s.calls.length, 0, 'Fx.draw leaves decals to drawUnder');
  CB.Fx.update(w, 5);
  s = spy();
  CB.Fx.drawUnder(w, s.r, 1);
  assert.ok(Math.abs(s.of('disc')[0].a - 0.35 * 0.5) < 1e-9, `life 1 of the last 2 s: ${s.of('disc')[0].a}`);
  CB.Fx.update(w, 0.5);
  s = spy();
  CB.Fx.drawUnder(w, s.r, 1);
  assert.ok(Math.abs(s.of('disc')[0].a - 0.35 * 0.25) < 1e-9);
});

test('juice: a spawn adds 8 white 1 px dots converging from radius 10 over 0.15 s (and keeps its ring)', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'spawn', x: 100, y: 60, kind: 'dummy' }]);
  const im = kinds(w, 'implode');
  assert.equal(im.length, 1);
  assert.equal(im[0].life, 0.15);
  assert.equal(im[0].r0, 10);
  assert.ok(kinds(w, 'ring').length >= 1, 'the old spawn ring stays');
  const dist = (calls) => calls.map((c) => Math.hypot(c.args[0] - 100, c.args[1] - 60));
  let s = spy();
  CB.Fx.draw(w, s.r, 1);
  const dots0 = s.of('rect').filter((c) => c.args[2] === 1 && c.args[3] === 1 && c.args[4] === C(CB).white);
  assert.equal(dots0.length, 8);
  CB.Fx.update(w, 0.1);
  s = spy();
  CB.Fx.draw(w, s.r, 1);
  const dots1 = s.of('rect').filter((c) => c.args[2] === 1 && c.args[3] === 1 && c.args[4] === C(CB).white);
  assert.equal(dots1.length, 8);
  assert.ok(Math.max(...dist(dots1)) < Math.max(...dist(dots0)) - 3, 'closer to the centre later');
  CB.Fx.update(w, 0.06);
  assert.equal(kinds(w, 'implode').length, 0);
});

// ---- Muzzle flash ---------------------------------------------------------------------------------------------------------

test('juice: muzzle flash per volley and glitch on phase change; everything stays finite', () => {
  const { CB, w, r } = setup();
  H.stepN(w, 1, () => H.makeInput({ fire: true, aimX: 300, aimY: 126 }));
  assert.equal(w.fx.filter((f) => f.kind === 'muzzle').length, 1);
  CB.Enemies.ph = { create: (w2, x, y) => CB.makeEnemy('ph', x, y, { contact: false }), update(e, w2) { if (!e.data.d) { e.data.d = 1; w2.emit('bossPhase', { x: 1, y: 1, phase: 2 }); } }, draw() {} };
  w.spawnEnemy('ph', 10, 30);
  H.stepN(w, 1, idle);
  assert.ok(w.glitchT > 0.3);
  H.stepN(w, 200, idle);
  for (const f of w.fx) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
  CB.Fx.drawUnder(w, r, 1);
  CB.Fx.draw(w, r, 1);
});

test('juice: a muzzle flash is a 3x3 white core, a gold 5 px plus and a 4 px streak along the aim, gone in 0.06 s', () => {
  const { CB, w } = setup();
  const c = C(CB);
  feed(CB, w, [{ type: 'shoot', x: 100, y: 80, angle: 0 }]);
  const m = kinds(w, 'muzzle');
  assert.equal(m.length, 1);
  assert.equal(m[0].life, 0.06);
  const s = spy();
  CB.Fx.draw(w, s.r, 1);
  const rects = s.of('rect').map((q) => q.args);
  assert.ok(rects.some((a) => a[2] === 3 && a[3] === 3 && a[4] === c.white), '3x3 white core');
  assert.ok(rects.some((a) => a[2] === 5 && a[3] === 1 && a[4] === c.gold), 'gold plus, horizontal arm');
  assert.ok(rects.some((a) => a[2] === 1 && a[3] === 5 && a[4] === c.gold), 'gold plus, vertical arm');
  const line = s.of('line');
  assert.equal(line.length, 1);
  const [x1, y1, x2, y2] = line[0].args;
  assert.ok(Math.abs(Math.hypot(x2 - x1, y2 - y1) - 4) < 1e-9, 'a 4 px streak');
  assert.ok(Math.abs(y2 - y1) < 1e-9 && x2 > x1 && x1 >= 100, 'pointing along angle 0, out from the muzzle');
  // Aimed straight up, the streak points up.
  w.fx.length = 0;
  feed(CB, w, [{ type: 'shoot', x: 100, y: 80, angle: -Math.PI / 2 }]);
  const up = spy();
  CB.Fx.draw(w, up.r, 1);
  const [ux1, uy1, ux2, uy2] = up.of('line')[0].args;
  assert.ok(Math.abs(ux2 - ux1) < 1e-9 && uy2 < uy1);
  CB.Fx.update(w, 0.07);
  assert.equal(kinds(w, 'muzzle').length, 0);
});

test('juice: a shoot event with no angle still makes a finite flash', () => {
  const { CB, w, r } = setup();
  feed(CB, w, [{ type: 'shoot', x: 100, y: 80 }]);
  assert.equal(kinds(w, 'muzzle').length, 1);
  CB.Fx.draw(w, r, 1);
});

// ---- Glitch ---------------------------------------------------------------------------------------------------------------

test('juice: bossPhase sets glitchT 0.4 and Fx.update decays it to 0', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'bossPhase', x: 100, y: 60, phase: 2 }]);
  assert.equal(w.glitchT, 0.4);
  CB.Fx.update(w, 0.1);
  assert.ok(Math.abs(w.glitchT - 0.3) < 1e-9);
  CB.Fx.update(w, 1);
  assert.equal(w.glitchT, 0);
  CB.Fx.update(w, 1);
  assert.equal(w.glitchT, 0, 'never negative');
});

// ---- Boss finale ----------------------------------------------------------------------------------------------------------

test('juice: bossDie schedules 12 blasts that all fire within 0.4 world seconds', () => {
  const { CB, w } = setup();
  CB.Bosses.stub = { id: 'stub', deathPoints: () => [{ x: 100, y: 60 }, { x: 120, y: 70 }] };
  w.boss = { id: 'stub', x: 110, y: 65, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} };
  const from = w.events.length;
  w.emit('bossDie', { x: 110, y: 65 });
  CB.Fx.consume(w, from);
  let blasts = 0;
  for (let i = 0; i < 40; i++) {
    const mark = w.events.length;
    H.stepN(w, 1, idle);
    blasts += w.events.slice(mark).filter((e) => e.type === 'blast').length;
  }
  assert.equal(blasts, 12);
  assert.ok(w.fx.some((f) => f.kind === 'ring'));
});

// Runs a finale to the end and returns what it emitted and drew. `wire(CB, w)` sets up the boss module.
function finale(wire, opts) {
  const { CB, w } = setup(opts);
  w.boss = { id: 'stub', x: 110, y: 65, hp: 0, maxHp: 1, phase: 3, defeated: true, update() {}, draw() {} };
  if (wire) wire(CB, w);
  const from = w.events.length;
  w.emit('bossDie', { x: 110, y: 65 });
  CB.Fx.consume(w, from);
  const blasts = [];
  const seen = { rings: [], conf: 0, bigRing: null };
  const ringCalls = [];
  const realRing = CB.Fx.ring;
  CB.Fx.ring = function (...a) { ringCalls.push(a); return realRing.apply(CB.Fx, a); };
  for (let i = 0; i < 60; i++) {
    const mark = w.events.length;
    H.stepN(w, 1, idle);
    for (const e of w.events.slice(mark)) if (e.type === 'blast') blasts.push(e);
    const conf = kinds(w, 'conf').length;
    if (conf > seen.conf) seen.conf = conf;
    const big = w.fx.find((f) => f.kind === 'ring' && f.r1 === 300);
    if (big && !seen.bigRing) seen.bigRing = { at: w.time, ring: big };
  }
  CB.Fx.ring = realRing;
  return { CB, w, blasts, seen, ringCalls };
}

test('juice: finale blasts cycle through deathPoints, in order, 12 of them', () => {
  const { blasts } = finale((CB) => { CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }, { x: 120, y: 70 }, { x: 140, y: 80 }] }; });
  assert.equal(blasts.length, 12);
  blasts.forEach((b, i) => {
    const p = [{ x: 100, y: 60 }, { x: 120, y: 70 }, { x: 140, y: 80 }][i % 3];
    assert.equal(b.x, p.x);
    assert.equal(b.y, p.y);
  });
});

test('juice: finale falls back to the event x/y plus up to 20 px of fxRng jitter when deathPoints is missing, throws, or returns junk', () => {
  const cases = {
    'no boss module': null,
    'no deathPoints method': (CB) => { CB.Bosses.stub = { id: 'stub' }; },
    'throws': (CB) => { CB.Bosses.stub = { deathPoints() { throw new Error('boom'); } }; },
    'returns null': (CB) => { CB.Bosses.stub = { deathPoints: () => null }; },
    'returns a non-array': (CB) => { CB.Bosses.stub = { deathPoints: () => ({ x: 1, y: 2 }) }; },
    'returns only junk': (CB) => { CB.Bosses.stub = { deathPoints: () => [null, { x: NaN, y: 1 }, { x: 1 }, 'a', { x: 1, y: Infinity }] }; },
    'empty': (CB) => { CB.Bosses.stub = { deathPoints: () => [] }; },
  };
  for (const [name, wire] of Object.entries(cases)) {
    const { blasts } = finale(wire);
    assert.equal(blasts.length, 12, name);
    for (const b of blasts) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y), name);
      assert.ok(Math.hypot(b.x - 110, b.y - 65) <= 20 + 1e-9, `${name}: ${b.x},${b.y}`);
    }
    assert.ok(new Set(blasts.map((b) => b.x + ',' + b.y)).size > 3, `${name}: jittered, not stacked`);
  }
});

test('juice: finale drops junk points and keeps the valid ones', () => {
  const { blasts } = finale((CB) => { CB.Bosses.stub = { deathPoints: () => [{ x: NaN, y: 1 }, { x: 5, y: 6 }, null, { x: 7, y: 8 }] }; });
  assert.equal(blasts.length, 12);
  blasts.forEach((b, i) => {
    const p = i % 2 ? { x: 7, y: 8 } : { x: 5, y: 6 };
    assert.equal(b.x, p.x);
    assert.equal(b.y, p.y);
  });
});

test('juice: finale with no w.boss at all still blasts from the event position', () => {
  const { CB, w } = setup();
  w.boss = null;
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const mark = w.events.length;
    H.stepN(w, 1, idle);
    n += w.events.slice(mark).filter((e) => e.type === 'blast').length;
  }
  assert.equal(n, 12);
});

test('juice: each blast is a 2 -> 14 px ring, 14 sparks alternating gold, ember and white, and a shake of 2', () => {
  const { CB, w } = setup();
  CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }] };
  w.boss = { id: 'stub', x: 110, y: 65, defeated: true, update() {}, draw() {} };
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
  w.fx.length = 0;
  w.shake = 0;
  CB.Fx.update(w, 0.001); // the k = 0 blast is due at once
  const ring = w.fx.filter((f) => f.kind === 'ring' && f.r1 === 14);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].r0, 2);
  const sparks = w.fx.filter((f) => f.kind === 'p');
  assert.equal(sparks.length, 14);
  const c = C(CB);
  const cols = sparks.map((f) => f.color);
  assert.deepEqual([...new Set(cols)].sort(), [c.gold, c.ember, c.white].sort());
  assert.ok(cols.filter((x) => x === c.gold).length >= 4 && cols.filter((x) => x === c.ember).length >= 4 && cols.filter((x) => x === c.white).length >= 4);
  assert.equal(w.shake, 2);
});

test('juice: at +0.45 world seconds a white ring grows 0 -> 300 px and 60 confetti drift up', () => {
  const { CB, w, seen } = finale((CB2) => { CB2.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }] }; });
  assert.ok(seen.bigRing, 'the full-screen ring appears');
  assert.ok(seen.bigRing.at >= 0.45 - 1e-9 && seen.bigRing.at <= 0.45 + 2 / 60, `at ${seen.bigRing.at}`);
  assert.equal(seen.bigRing.ring.r0, 0);
  assert.equal(seen.bigRing.ring.color, C(CB).white);
  assert.equal(seen.conf, 60);
  const conf = kinds(w, 'conf');
  const cols = new Set(conf.map((f) => f.color));
  for (const col of cols) assert.ok([C(CB).clawd, C(CB).gold, C(CB).spark].includes(col), col);
  assert.ok(conf.every((f) => f.vy < 0), 'drifting up');
  for (const f of w.fx) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
});

test('juice: the big ring is drawn as in-bounds pixels, not as a 600 px cached disc', () => {
  const { CB, w } = setup();
  w.fx.length = 0;
  CB.Fx.ring(w, 160, 90, 0, 300, C(CB).white, 0.5);
  CB.Fx.update(w, 0.25); // k = 0.5 -> radius 150: the ring crosses the left and right screen edges
  let s = spy();
  CB.Fx.draw(w, s.r, 1);
  assert.ok(s.of('ring').every((c) => c.args[2] <= 60), 'no big r.ring call');
  const px = s.of('rect');
  assert.ok(px.length > 0, 'some of the ring is on screen');
  for (const c of px) {
    const [x, y, wd, ht] = c.args;
    assert.ok(x >= 0 && x < 320 && y >= 0 && y < 180 && wd === 1 && ht === 1);
  }
  w.fx.length = 0;
  CB.Fx.ring(w, 160, 90, 2, 14, C(CB).white, 0.3);
  s = spy();
  CB.Fx.draw(w, s.r, 1);
  assert.equal(s.of('ring').length, 1, 'small rings still use r.ring');
  assert.equal(s.of('ring')[0].args[2], 2);
});

test('juice: calm mode caps the confetti at 20 and the blast rings at 6 (the blasts and their events stay 12)', () => {
  const wire = (CB) => {
    CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }, { x: 120, y: 70 }] };
    CB.Comfort = { calm: () => true };
  };
  const calm = finale(wire);
  assert.equal(calm.blasts.length, 12);
  assert.equal(calm.seen.conf, 20);
  assert.equal(calm.ringCalls.filter((a) => a[4] === 14).length, 6);
  const normal = finale((CB) => { CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }] }; CB.Comfort = { calm: () => false }; });
  assert.equal(normal.seen.conf, 60);
  assert.equal(normal.ringCalls.filter((a) => a[4] === 14).length, 12);
  const absent = finale(null);
  assert.equal(absent.seen.conf, 60, 'no Comfort module: not calm');
  const partial = finale((CB) => { CB.Comfort = {}; });
  assert.equal(partial.seen.conf, 60, 'a Comfort stub without calm() is ignored');
});

test('juice: a second bossDie while a finale is running does not stack another 12 blasts', () => {
  const { CB, w } = setup();
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }, { type: 'bossDie', x: 110, y: 65 }]);
  assert.equal(w.fxQueue.filter((q) => q.kind === 'blast').length, 12);
  assert.equal(w.fxQueue.filter((q) => q.kind === 'finale').length, 1);
});

test('juice: the finale clock is world time, so a hitstop freezes it (the boss-die hitstop leads in to the first blast)', () => {
  const { CB, w } = setup({ god: false });
  w.boss = { id: 'stub', x: 110, y: 65, defeated: true, update() {}, draw() {} };
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
  assert.ok(w.hitstop > 0.07, `hitstop ${w.hitstop}`);
  const t0 = w.time;
  const mark = w.events.length;
  H.stepN(w, 3, idle);
  assert.equal(w.time, t0, 'still frozen');
  assert.equal(w.events.slice(mark).filter((e) => e.type === 'blast').length, 0);
  assert.equal(w.fxQueue.length, 13);
  H.stepN(w, 60, idle);
  assert.equal(w.events.slice(mark).filter((e) => e.type === 'blast').length, 12);
  assert.equal(w.fxQueue.length, 0, 'the queue drains');
});

test('juice: a hand-built world without fxQueue still gets its finale', () => {
  const { CB, w } = setup();
  delete w.fxQueue;
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
  assert.equal(w.fxQueue.length, 13);
  H.stepN(w, 40, idle);
  assert.equal(w.events.filter((e) => e.type === 'blast').length, 12);
});

test('juice: the finale keeps the old opening burst (six rings, gold sparks) and the bossDie impact', () => {
  const { CB, w } = setup({ god: false });
  feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
  assert.ok(kinds(w, 'ring').length >= 6);
  assert.ok(w.fx.filter((f) => f.kind === 'p' && f.color === C(CB).gold).length >= 40);
  assert.equal(w.flashColor, '#FFFFFF');
  assert.ok(w.flash > 0.2);
});

test('juice: the same seed gives the same finale, and a flood never breaks the cap or finiteness', () => {
  const run = () => {
    const { CB, w } = setup({ seed: 9 });
    CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }, { x: 120, y: 70 }] };
    w.boss = { id: 'stub', x: 110, y: 65, defeated: true, update() {}, draw() {} };
    feed(CB, w, [{ type: 'bossDie', x: 110, y: 65 }]);
    for (let i = 0; i < 90; i++) {
      H.stepN(w, 1, idle);
      assert.ok(w.fx.length <= CB.CAPS.fx, `fx ${w.fx.length}`);
    }
    return w;
  };
  const a = run();
  const b = run();
  assert.deepEqual(H.plain(a.fx), H.plain(b.fx));
  for (const f of a.fx) for (const k of ['x', 'y', 'life']) assert.ok(Number.isFinite(f[k]));
});

// ---- Boss entrance and patch celebration ----------------------------------------------------------------------------------

test('juice: bossEnter is a white ring 4 -> 32 px over 0.4 s and 16 cyan/white sparks', () => {
  const { CB, w } = setup();
  const c = C(CB);
  feed(CB, w, [{ type: 'bossEnter', x: 160, y: 60 }]);
  const ring = kinds(w, 'ring');
  assert.equal(ring.length, 1);
  assert.equal(ring[0].r0, 4);
  assert.equal(ring[0].r1, 32);
  assert.equal(ring[0].life, 0.4);
  assert.equal(ring[0].color, c.white);
  const sparks = kinds(w, 'p');
  assert.equal(sparks.length, 16);
  assert.ok(sparks.every((f) => f.color === c.cyan || f.color === c.white));
  assert.equal(sparks.filter((f) => f.color === c.cyan).length, 8);
});

test('juice: celebrate is a gold ring, 12 patch-coloured sparks, a gold "+ name" pop and cheerT 0.9', () => {
  const { CB, w } = setup();
  const c = C(CB);
  const p = w.player;
  CB.Fx.celebrate(w, 'spread');
  const ring = kinds(w, 'ring');
  assert.equal(ring.length, 1);
  assert.equal(ring[0].r0, 2);
  assert.equal(ring[0].r1, 26);
  assert.equal(ring[0].life, 0.4);
  assert.equal(ring[0].color, c.gold);
  assert.equal(ring[0].x, p.x);
  assert.equal(ring[0].y, p.y);
  const sparks = kinds(w, 'p');
  assert.equal(sparks.length, 12);
  for (const s of sparks) {
    assert.equal(s.color, c.cyan);
    assert.equal(s.life, 0.5);
    assert.ok(Math.hypot(s.vx, s.vy) <= 60 + 1e-9);
  }
  assert.equal(Math.max(...sparks.map((s) => Math.hypot(s.vx, s.vy))) > 24, true, 'speed 60 scaled 0.4-1');
  const text = kinds(w, 'text');
  assert.equal(text.length, 1);
  assert.equal(text[0].text, '+ Spread Shot');
  assert.equal(text[0].color, c.gold);
  assert.equal(text[0].life, 1.2);
  assert.equal(p.cheerT, 0.9);
});

test('juice: celebrate colours the sparks per patch and names each patch', () => {
  const { CB, w } = setup();
  const c = C(CB);
  const want = { spread: c.cyan, rapid: c.yellow, pierce: c.purple, heavy: c.ember, heart: c.red, dash: c.cyan, ricochet: c.green };
  for (const [id, color] of Object.entries(want)) {
    w.fx.length = 0;
    CB.Fx.celebrate(w, id);
    assert.ok(kinds(w, 'p').every((f) => f.color === color), id);
    assert.equal(kinds(w, 'text')[0].text, '+ ' + CB.Patches.DEFS[id].name, id);
  }
});

test('juice: celebrate survives an unknown patch id, a missing Patches module and a world with no player', () => {
  const { CB, w } = setup();
  CB.Fx.celebrate(w, 'nope');
  assert.equal(kinds(w, 'p').length, 12);
  assert.ok(kinds(w, 'p').every((f) => f.color === C(CB).gold));
  assert.equal(kinds(w, 'text')[0].text, '+ nope');
  w.fx.length = 0;
  const saved = CB.Patches;
  CB.Patches = undefined;
  CB.Fx.celebrate(w, 'rapid');
  assert.equal(kinds(w, 'text')[0].text, '+ rapid');
  CB.Patches = saved;
  w.fx.length = 0;
  w.player = null;
  CB.Fx.celebrate(w, 'rapid');
  assert.equal(kinds(w, 'text').length, 1);
  for (const f of w.fx) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
});

test('juice: pops are kept on screen (text centred near the edge slides in; the rise stays under the arena top)', () => {
  const { CB, w } = setup();
  w.player.x = 12;
  w.player.y = 24;
  CB.Fx.celebrate(w, 'ricochet');
  const t = kinds(w, 'text')[0];
  const half = ('+ ' + CB.Patches.DEFS.ricochet.name).length * 6 / 2;
  assert.ok(t.x - half >= 0 && t.x + half <= 320, `x ${t.x}`);
  assert.ok(t.y + t.vy * t.life >= CB.ARENA.y - 1e-9, `rises to ${t.y + t.vy * t.life}`);
});

test('juice: a kill pop near an edge or the arena top stays on screen too (quip lines are wider than the old words)', () => {
  const { CB, w } = setup();
  CB.Quips = { kill: { dummy: ['delete x now'] }, pick: (rng, list) => ({ text: list[0], idx: 0 }) };
  const half = 'delete x now'.length * 6 / 2;
  for (const [x, y] of [[10, 30], [310, 24], [160, 22], [160, 100]]) {
    w.fx.length = 0;
    for (let i = 0; i < 40; i++) feed(CB, w, [{ type: 'enemyDie', x, y, kind: 'dummy', r: 4, boss: false, silent: false }]);
    const t = kinds(w, 'text')[0];
    assert.ok(t, `a kill pop at (${x}, ${y})`);
    assert.ok(t.x - half >= 0 && t.x + half <= 320, `x ${t.x} for a kill at ${x}`);
    assert.ok(t.y + t.vy * t.life >= CB.ARENA.y - 1e-9, `rises to ${t.y + t.vy * t.life} for a kill at y ${y}`);
  }
  w.fx.length = 0;
  for (let i = 0; i < 40; i++) feed(CB, w, [{ type: 'enemyDie', x: 160, y: 100, kind: 'dummy', r: 4, boss: false, silent: false }]);
  const mid = kinds(w, 'text')[0];
  assert.equal(mid.x, 160);
  assert.equal(mid.y, 92, 'unclamped pops keep the old spot (8 px above the bug)');
});

// ---- Quip hooks -----------------------------------------------------------------------------------------------------------

function stubQuips(CB) {
  CB.Quips = {
    kill: { dummy: ['KILL-STUB'] },
    hurt: ['HURT-STUB'],
    bossPhase: { stub: { 2: ['PHASE-STUB'] } },
    pick: (rng, list) => ({ text: list[0], idx: 0 }),
  };
}

test('juice: kill, hurt and boss-phase pops use the strings from CB.Quips.pick', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  let texts = [];
  for (let i = 0; i < 40; i++) {
    w.fx.length = 0; // one kill at a time: pops that overlap a live one change lane (see the lane test)
    feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'dummy', r: 4, boss: false, silent: false }]);
    texts = texts.concat(kinds(w, 'text'));
  }
  assert.ok(texts.length >= 8 && texts.length <= 32, `about half of 40 kills pop: ${texts.length}`);
  assert.ok(texts.every((f) => f.text === 'KILL-STUB'));

  w.fx.length = 0;
  let shown = 0;
  for (let i = 0; i < 80 && !shown; i++) {
    w.quipT = 0;
    feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
    shown = kinds(w, 'text').length;
  }
  assert.equal(shown, 1, 'a hurt quip showed within 80 tries at 35%');
  assert.equal(kinds(w, 'text')[0].text, 'HURT-STUB');
  assert.equal(w.quipT, 5);

  w.fx.length = 0;
  w.boss = { id: 'stub', x: 160, y: 70, radius: 12 };
  feed(CB, w, [{ type: 'bossPhase', x: 160, y: 70, phase: 2 }]);
  texts = kinds(w, 'text');
  assert.equal(texts.length, 1);
  assert.equal(texts[0].text, 'PHASE-STUB');
  assert.equal(texts[0].color, C(CB).gold);
  assert.equal(texts[0].life, 1.6);
  assert.ok(texts[0].y < 70, 'above the boss');
});

test('juice: with real kinds the kill pool beats DEATH_TEXT, and pick receives the world fxRng and the pool', () => {
  const { CB, w } = setup();
  const seen = [];
  CB.Quips = {
    kill: { syntaxError: ['A', 'B', 'C'] },
    pick: (rng, list, last) => { seen.push({ rng, list, last }); return { text: list[1], idx: 1 }; },
  };
  for (let i = 0; i < 30; i++) feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'syntaxError', r: 4, boss: false, silent: false }]);
  const texts = kinds(w, 'text');
  assert.ok(texts.length > 0);
  assert.ok(texts.every((f) => f.text === 'B'), 'never the old ";"');
  assert.ok(seen.every((s) => s.rng === w.fxRng && s.list === CB.Quips.kill.syntaxError));
  assert.equal(seen[0].last, -1);
  assert.equal(seen[1].last, 1, 'the previous index is passed back so a pool never repeats');
});

test('juice: without usable quips the kill text falls back to DEATH_TEXT and nothing throws', () => {
  const variants = [
    undefined,
    {},
    { kill: {} },
    { kill: { syntaxError: [] }, pick: () => ({ text: 'X', idx: 0 }) },
    { kill: { syntaxError: ['x'] } }, // no pick
    { kill: { syntaxError: 'x' }, pick: () => ({ text: 'X', idx: 0 }) }, // not an array
    { kill: { syntaxError: ['x'] }, pick: () => null },
    { kill: { syntaxError: ['x'] }, pick: () => ({ idx: 0 }) },
    { kill: { syntaxError: ['x'] }, pick: () => ({ text: 42, idx: 0 }) },
  ];
  for (const q of variants) {
    const { CB, w } = setup();
    CB.Quips = q;
    for (let i = 0; i < 30; i++) feed(CB, w, [{ type: 'enemyDie', x: 100, y: 60, kind: 'syntaxError', r: 4, boss: false, silent: false }]);
    const texts = kinds(w, 'text');
    assert.ok(texts.length > 0, JSON.stringify(Object.keys(q || {})));
    assert.ok(texts.every((f) => f.text === ';'), 'the old pop');
  }
});

test('juice: hurt quips obey the 5 s cooldown, skip god mode, and tick down in Fx.update', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  w.quipT = 0;
  let shown = false;
  for (let i = 0; i < 80 && !shown; i++) {
    w.quipT = 0;
    feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
    shown = kinds(w, 'text').length > 0;
  }
  assert.ok(shown);
  assert.equal(w.quipT, 5);
  w.fx.length = 0;
  for (let i = 0; i < 100; i++) feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
  assert.equal(kinds(w, 'text').length, 0, 'cooling down: no second quip');
  CB.Fx.update(w, 2);
  assert.ok(Math.abs(w.quipT - 3) < 1e-9);
  CB.Fx.update(w, 10);
  assert.equal(w.quipT, 0);
  const god = setup();
  stubQuips(god.CB);
  for (let i = 0; i < 200; i++) feed(god.CB, god.w, [{ type: 'playerHurt', x: 160, y: 126, god: true }]);
  assert.equal(kinds(god.w, 'text').length, 0, 'a god-mode hit never quips');
  assert.equal(god.w.quipT, 0);
});

test('juice: hurt quips fire about 35% of the time once the cooldown is clear', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  let n = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    w.quipT = 0;
    w.fx.length = 0;
    feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
    if (kinds(w, 'text').length) n++;
  }
  assert.ok(n > trials * 0.25 && n < trials * 0.45, `${n}/${trials}`);
});

test('juice: boss-phase quips need w.boss, a pool for that boss and an array for that phase', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  const phase = (n) => { w.fx.length = 0; feed(CB, w, [{ type: 'bossPhase', x: 160, y: 70, phase: n }]); return kinds(w, 'text').length; };
  w.boss = null;
  assert.equal(phase(2), 0, 'no boss');
  w.boss = { id: 'other', x: 160, y: 70 };
  assert.equal(phase(2), 0, 'no pool for this boss');
  w.boss = { id: 'stub', x: 160, y: 70 };
  assert.equal(phase(3), 0, 'no pool for phase 3');
  assert.equal(phase(2), 1);
  CB.Quips.bossPhase.stub = { 2: 'not an array' };
  assert.equal(phase(2), 0);
  CB.Quips.bossPhase = null;
  assert.equal(phase(2), 0);
  CB.Quips = { pick: () => ({ text: 'x', idx: 0 }) };
  assert.equal(phase(2), 0, 'no bossPhase table at all');
  CB.Quips = undefined;
  assert.equal(phase(2), 0);
  assert.ok(w.glitchT > 0, 'the glitch happens regardless');
});

test('juice: a phase quip near the top of the arena stays inside it', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  CB.Quips.bossPhase.stub[2] = ['A fairly long boss quip line'];
  w.boss = { id: 'stub', x: 20, y: 24, radius: 12 };
  feed(CB, w, [{ type: 'bossPhase', x: 20, y: 24, phase: 2 }]);
  const t = kinds(w, 'text')[0];
  const half = 'A fairly long boss quip line'.length * 6 / 2;
  assert.ok(t.x - half >= 0 && t.x + half <= 320);
  assert.ok(t.y + t.vy * t.life >= CB.ARENA.y - 1e-9);
});

// ---- Draw and caps --------------------------------------------------------------------------------------------------------

test('juice: every effect kind draws headless through the real renderer', () => {
  const { CB, w, r } = setup();
  CB.Bosses.stub = { deathPoints: () => [{ x: 100, y: 60 }] };
  w.boss = { id: 'stub', x: 110, y: 65, defeated: true, update() {}, draw() {} };
  CB.Fx.celebrate(w, 'heavy');
  feed(CB, w, [
    { type: 'spawn', x: 50, y: 50, kind: 'dummy' }, { type: 'shoot', x: 60, y: 60, angle: 1 },
    { type: 'enemyDie', x: 70, y: 70, kind: 'syntaxError', r: 6, boss: false }, { type: 'bossEnter', x: 160, y: 60 },
    { type: 'bossDie', x: 110, y: 65 }, { type: 'bossPhase', x: 110, y: 65, phase: 2 }, { type: 'text', x: 90, y: 90, text: 'hi', color: '#FFFFFF' },
  ]);
  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    H.stepN(w, 1, idle);
    for (const f of w.fx) seen.add(f.kind);
    CB.Fx.drawUnder(w, r, i / 60);
    CB.Fx.draw(w, r, i / 60);
  }
  for (const k of ['p', 'ring', 'text', 'pop', 'decal', 'implode', 'muzzle', 'conf']) assert.ok(seen.has(k), `${k} was drawn`);
});

test('juice: events with a non-finite position never put NaN into the fx list', () => {
  const { CB, w } = setup();
  feed(CB, w, [
    { type: 'hit', x: NaN, y: 1 }, { type: 'enemyDie', x: 1, y: undefined, kind: 'dummy', r: 5 }, { type: 'shoot', x: Infinity, y: 0, angle: 0 },
    { type: 'spawn', x: NaN, y: NaN }, { type: 'bossEnter', x: NaN, y: 3 }, { type: 'bossDie', x: NaN, y: NaN },
  ]);
  H.stepN(w, 40, idle);
  for (const f of w.fx) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y), f.kind);
  for (const e of w.events) if (e.type === 'blast') assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
});

test('juice: 300 boss deaths in one step still respect the fx cap', () => {
  const { CB, w } = setup();
  const evs = [];
  for (let i = 0; i < 300; i++) evs.push({ type: 'enemyDie', x: 100, y: 100, kind: 'dummy', r: 8, boss: false, silent: false });
  feed(CB, w, evs);
  assert.ok(w.fx.length <= CB.CAPS.fx);
  assert.ok(kinds(w, 'decal').length <= 40);
});

// ---- H1: pops that do not pile up ---------------------------------------------------------------------------------------------

const textsOf = (w) => w.fx.filter((f) => f.kind === 'text' && f.life > 0);

test('pops: two text events at the same spot take different lanes at least 9 px apart', () => {
  const { CB, w } = setup();
  w.player.x = 40;
  w.player.y = 150;
  feed(CB, w, [{ type: 'text', x: 200, y: 100, text: 'perfect' }, { type: 'text', x: 200, y: 100, text: 'perfect' }, { type: 'text', x: 205, y: 102, text: 'free()' }]);
  const t = textsOf(w);
  assert.ok(t.length >= 2);
  for (let i = 0; i < t.length; i++) {
    for (let j = i + 1; j < t.length; j++) assert.ok(Math.abs(t[i].y - t[j].y) >= 9, `pops ${i} and ${j}: ${t[i].y} vs ${t[j].y}`);
  }
  assert.equal(t[0].y, 100, 'the first keeps its place');
  assert.ok(t[1].y < t[0].y, 'the next moves up a lane');
});

test('pops: pops far apart in x, or already apart in y, do not move', () => {
  const { CB, w } = setup();
  w.player.x = 40;
  w.player.y = 150;
  feed(CB, w, [{ type: 'text', x: 100, y: 100, text: 'perfect' }, { type: 'text', x: 250, y: 100, text: 'perfect' }, { type: 'text', x: 100, y: 120, text: 'perfect' }]);
  assert.deepEqual(textsOf(w).map((f) => [f.x, f.y]), [[100, 100], [250, 100], [100, 120]]);
});

test('pops: a pop never sits on Clawd, wherever it was asked for', () => {
  const { CB, w } = setup();
  const p = w.player;
  for (const [px, py] of [[160, 100], [160, 28], [20, 60], [300, 150]]) {
    w.fx.length = 0;
    p.x = px;
    p.y = py;
    feed(CB, w, [{ type: 'text', x: px, y: py - 4, text: 'last heart!' }, { type: 'text', x: px, y: py, text: '+1 ♥' }]);
    assert.ok(textsOf(w).length >= 1);
    for (const f of textsOf(w)) {
      const half = (f.text.length * 6) / 2;
      const hit = f.x - half < p.x + 8 && f.x + half > p.x - 8 && f.y < p.y + 4 && f.y + 7 > p.y - 10;
      assert.equal(hit, false, `${f.text} at (${f.x}, ${f.y}) over Clawd at (${px}, ${py})`);
    }
  }
});

test('pops: last heart!, +heart and perfect beat quips: a priority pop clears the quips under it, and a quip never lands on a live one', () => {
  const { CB, w } = setup();
  w.player.x = 40;
  w.player.y = 150;
  const text = (s, x, y) => feed(CB, w, [{ type: 'text', x, y, text: s }]);
  text('free()', 200, 100); // a quip is up...
  text('perfect', 200, 100); // ...and a priority pop arrives on it
  const t = textsOf(w);
  assert.deepEqual(t.map((f) => f.text), ['perfect'], 'the quip gave way');
  assert.equal(t[0].y, 100, 'the priority pop kept its place');
  text('free()', 202, 101);
  assert.deepEqual(textsOf(w).map((f) => f.text), ['perfect'], 'a quip meeting a priority pop is dropped');
  text('free()', 200, 30); // far away: fine
  assert.equal(textsOf(w).length, 2);
});

test('pops: the +15 /compact pickup and a patch name are priority: they find a free lane beside a live priority pop instead of being dropped', () => {
  const { CB, w } = setup();
  w.player.x = 40;
  w.player.y = 150;
  feed(CB, w, [{ type: 'text', x: 200, y: 100, text: 'perfect' }]);
  feed(CB, w, [{ type: 'text', x: 200, y: 100, text: '+15 /compact' }]);
  assert.deepEqual(textsOf(w).map((f) => f.text).sort(), ['+15 /compact', 'perfect'], 'both are up');
  assert.ok(textsOf(w).find((f) => f.text === '+15 /compact').prio, 'and the pickup is a priority pop');
  const { CB: CB2, w: w2 } = setup();
  w2.player.x = 200;
  w2.player.y = 100;
  feed(CB2, w2, [{ type: 'text', x: 200, y: 82, text: 'perfect' }]);
  CB2.Fx.celebrate(w2, 'rapid');
  assert.equal(textsOf(w2).filter((f) => /^\+ /.test(f.text)).length, 1, 'the patch name pop is not dropped');
});

test('pops: no hurt quip on the hit that leaves one heart', () => {
  const { CB, w } = setup();
  stubQuips(CB);
  for (let i = 0; i < 60; i++) {
    w.fx.length = 0;
    w.quipT = 0;
    w.player.hearts = 1; // the hit has already landed when Fx sees playerHurt
    feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
    assert.equal(textsOf(w).length, 0);
  }
  let shown = 0;
  for (let i = 0; i < 80 && !shown; i++) {
    w.fx.length = 0;
    w.quipT = 0;
    w.player.hearts = 3;
    feed(CB, w, [{ type: 'playerHurt', x: 160, y: 126 }]);
    shown = textsOf(w).length;
  }
  assert.equal(shown, 1, 'with hearts left the quip still shows');
});

test('pops: the pop stays inside the screen and the arena whatever lane it is moved to', () => {
  const { CB, w } = setup();
  w.player.x = 300;
  w.player.y = 150;
  for (let i = 0; i < 12; i++) feed(CB, w, [{ type: 'text', x: 5, y: 24, text: 'perfect' }]);
  assert.ok(textsOf(w).length >= 3);
  for (const f of textsOf(w)) {
    assert.ok(f.x - 21 >= 3 && f.y >= CB.ARENA.y, `${f.x}, ${f.y}`);
    assert.ok(f.y <= CB.ARENA.y + CB.ARENA.h, 'and above the bottom wall');
  }
});

// ---- H4 / H6: decals and blocked shots -------------------------------------------------------------------------------------------

test('decals: a slime kill never leaves a stain in the puddle green', () => {
  const { CB, w } = setup();
  const c = C(CB);
  for (const kind of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne', 'mystery']) {
    w.fx.length = 0;
    feed(CB, w, [{ type: 'enemyDie', x: 50, y: 50, kind, r: 5, boss: false, silent: false }]);
    const col = kinds(w, 'decal')[0].color;
    assert.ok(col !== c.green && col !== c.greenDark, `${kind} stain ${col}`);
  }
});

test('blocked: a clink throws a bigger grey spark, and on the Infinite Loop a "blocked" pop at most every 1.2 s', () => {
  const { CB, w } = setup();
  w.player.x = 40;
  w.player.y = 150;
  feed(CB, w, [{ type: 'clink', x: 200, y: 100 }]);
  const sparks = w.fx.filter((f) => f.kind === 'p' && f.color === C(CB).grey);
  assert.ok(sparks.length >= 5 && sparks.every((f) => f.size === 2), 'five 2 px grey sparks, not two 1 px ones');
  assert.equal(textsOf(w).length, 0, 'no pop away from the Loop');
  w.boss = { id: 'infiniteLoop', x: 160, y: 96, radius: 40 };
  feed(CB, w, [{ type: 'clink', x: 200, y: 100 }]);
  const pops = textsOf(w).filter((f) => f.text === 'blocked');
  assert.equal(pops.length, 1);
  assert.equal(pops[0].color, C(CB).grey);
  for (let i = 0; i < 5; i++) feed(CB, w, [{ type: 'clink', x: 200, y: 100 }]);
  assert.equal(textsOf(w).filter((f) => f.text === 'blocked').length, 1, 'rate-limited');
  w.time += 1.3;
  feed(CB, w, [{ type: 'clink', x: 260, y: 60 }]);
  assert.equal(textsOf(w).filter((f) => f.text === 'blocked').length, 2, 'and back after the gap');
});
