'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/game/patches.js'];

test('patches: base stats', () => {
  const CB = H.load(FILES);
  const s = CB.Patches.computeStats({});
  assert.deepEqual(H.plain(s), { fireCooldown: 0.2, boltSpeed: 200, boltR: 2, dmg: 1, spread: 0, pierce: 0, bounces: 0, dashCooldown: 0.8, maxHearts: 5 });
});

test('patches: each patch effect matches the spec table', () => {
  const CB = H.load(FILES);
  const S = (c) => CB.Patches.computeStats(c);
  assert.equal(S({ spread: 2 }).spread, 2);
  assert.ok(Math.abs(S({ rapid: 1 }).fireCooldown - 0.16) < 1e-9);
  assert.ok(Math.abs(S({ rapid: 2 }).fireCooldown - 0.128) < 1e-9);
  assert.equal(S({ pierce: 2 }).pierce, 2);
  assert.ok(Math.abs(S({ pierce: 1 }).dmg - 1.15) < 1e-9);
  assert.ok(Math.abs(S({ pierce: 2 }).dmg - 1.3) < 1e-9);
  assert.ok(Math.abs(S({ pierce: 2, heavy: 2 }).dmg - 2.0) < 1e-9, 'pierce and heavy damage add');
  assert.ok(Math.abs(S({ heavy: 1 }).dmg - 1.35) < 1e-9);
  assert.ok(Math.abs(S({ heavy: 2 }).dmg - 1.7) < 1e-9);
  assert.equal(S({ heavy: 1 }).boltR, 3);
  assert.equal(S({ heavy: 2 }).boltR, 4);
  assert.equal(S({ heart: 2 }).maxHearts, 7);
  assert.equal(S({ dash: 1 }).dashCooldown, 0.45);
  assert.equal(S({ ricochet: 1 }).bounces, 1);
  assert.equal(S({ spread: 9 }).spread, 2, 'counts above max are clamped');
});

test('patches: descriptions match the retuned numbers', () => {
  const CB = H.load(FILES);
  assert.equal(CB.Patches.DEFS.rapid.desc, 'Fire 25% faster');
  assert.equal(CB.Patches.DEFS.heavy.desc, '+35% damage, bigger sparks');
  assert.equal(CB.Patches.DEFS.pierce.desc, 'Sparks pass through +1 bug, +15% damage');
});

test('patches: apply increments and refuses past max', () => {
  const CB = H.load(FILES);
  let c = CB.Patches.apply({}, 'dash');
  assert.equal(c.dash, 1);
  assert.throws(() => CB.Patches.apply(c, 'dash'), /max/);
  assert.throws(() => CB.Patches.apply({}, 'nope'), /unknown patch/);
  c = CB.Patches.apply(CB.Patches.apply({}, 'spread'), 'spread');
  assert.equal(c.spread, 2);
});

test('patches: offer returns 3 distinct non-maxed ids, deterministically', () => {
  const CB = H.load(FILES);
  const owned = { dash: 1, ricochet: 1, spread: 2 };
  for (let seed = 1; seed < 50; seed++) {
    const ids = H.plain(CB.Patches.offer(CB.createRng(seed), owned, 3));
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(!['dash', 'ricochet', 'spread'].includes(id), id);
  }
  assert.deepEqual(H.plain(CB.Patches.offer(CB.createRng(9), {}, 3)), H.plain(CB.Patches.offer(CB.createRng(9), {}, 3)));
});

test('patches: offer returns fewer when few remain', () => {
  const CB = H.load(FILES);
  const owned = { spread: 2, rapid: 2, pierce: 2, heavy: 2, heart: 2, dash: 1 };
  assert.deepEqual(H.plain(CB.Patches.offer(CB.createRng(1), owned, 3)), ['ricochet']);
});
