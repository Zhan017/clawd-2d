'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js'];

test('ns: constants and registries exist', () => {
  const CB = H.load(FILES);
  assert.equal(CB.W, 320);
  assert.equal(CB.H, 180);
  assert.ok(Math.abs(CB.DT - 1 / 60) < 1e-12);
  assert.deepEqual(H.plain(CB.ARENA), { x: 8, y: 20, w: 304, h: 152 });
  for (const k of ['Enemies', 'Bosses', 'Scenes', 'Screens']) assert.equal(typeof CB[k], 'object');
});

test('math: norm, clamp, circleHit, circleSegment', () => {
  const { M } = H.load(FILES);
  const n = M.norm(3, 4);
  assert.ok(Math.abs(n.x - 0.6) < 1e-9 && Math.abs(n.y - 0.8) < 1e-9);
  assert.deepEqual(H.plain(M.norm(0, 0)), { x: 0, y: 0 });
  assert.equal(M.clamp(5, 0, 3), 3);
  assert.equal(M.clamp(-1, 0, 3), 0);
  assert.equal(M.circleHit(0, 0, 2, 3, 0, 1), true);
  assert.equal(M.circleHit(0, 0, 2, 3.1, 0, 1), false);
  assert.equal(M.circleSegment(5, 2, 2, 0, 0, 10, 0), true);
  assert.equal(M.circleSegment(5, 3, 2, 0, 0, 10, 0), false);
  assert.equal(M.circleSegment(12, 0, 1.5, 0, 0, 10, 0), false);
  assert.ok(Math.abs(M.wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.equal(M.approach(0, 10, 3), 3);
  assert.equal(M.approach(9, 10, 3), 10);
});

test('math: wrapAngle terminates and stays finite for huge and non-finite angles', () => {
  const { sandbox } = H.load(FILES, { returnSandbox: true });
  // Evaluated inside the vm with a timeout: a regression to an endless loop fails here instead of hanging the suite.
  const wrap = (expr) => vm.runInContext(`CB.M.wrapAngle(${expr})`, sandbox, { timeout: 2000 });
  assert.ok(Number.isFinite(wrap('1e17')));
  assert.ok(Math.abs(wrap('1e17')) <= Math.PI + 1e-9);
  assert.ok(Math.abs(wrap('-1e17')) <= Math.PI + 1e-9);
  assert.ok(Number.isFinite(wrap('1e300')));
  assert.equal(wrap('Infinity'), 0);
  assert.equal(wrap('-Infinity'), 0);
  assert.equal(wrap('NaN'), 0);
  assert.ok(Math.abs(Math.abs(wrap('7 * Math.PI')) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrap('0.5') - 0.5) < 1e-12, 'small angles pass through');
});

test('math: clampToArena keeps the circle inside', () => {
  const CB = H.load(FILES);
  const e = { x: -50, y: 999, r: 5 };
  CB.M.clampToArena(e);
  assert.equal(e.x, 13);
  assert.equal(e.y, 167);
});

test('rng: same seed gives same sequence; ranges stay in bounds', () => {
  const CB = H.load(FILES);
  const a = CB.createRng(42);
  const b = CB.createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const r = CB.createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(2, 5);
    assert.ok(v >= 2 && v <= 5 && Number.isInteger(v));
    const f = r.range(-1, 1);
    assert.ok(f >= -1 && f < 1);
  }
  assert.notEqual(CB.createRng(1).next(), CB.createRng(2).next());
  const sh = r.shuffle([1, 2, 3, 4, 5]);
  assert.deepEqual(H.plain(sh).sort(), [1, 2, 3, 4, 5]);
});

test('harness: Math.random is poisoned inside the sandbox unless allowed', () => {
  const vm = require('vm');
  const probe = '(() => { try { Math.random(); return "ok"; } catch (e) { return "threw"; } })()';
  const strict = H.load(FILES, { returnSandbox: true });
  assert.equal(vm.runInContext(probe, strict.sandbox), 'threw');
  const loose = H.load(FILES, { returnSandbox: true, allowRandom: true });
  assert.equal(vm.runInContext(probe, loose.sandbox), 'ok');
});

test('harness: scriptList parses index.html in order', () => {
  const list = H.scriptList();
  assert.equal(list[0], 'src/core/ns.js');
  assert.equal(list[list.length - 1], 'src/main.js');
  assert.ok(list.length >= 43);
});
