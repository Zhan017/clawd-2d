'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js');
  for (const k of ['dummy', 'raceCondition']) {
    CB.Enemies[k] = { create: (w, x, y, o) => CB.makeEnemy(k, x, y, { hp: 1, contact: false, data: { opts: o } }), update() {}, draw() {} };
  }
  return CB;
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });

test('waves: never more than 6 regular enemies alive or pending', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 2 });
  const sp = CB.createWaveSpawner(w, [{ kind: 'dummy', count: 20 }]);
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) {
    w.step(CB.DT, idle());
    sp.update(CB.DT);
    peak = Math.max(peak, sp.alive());
  }
  assert.equal(peak, 6);
  assert.equal(CB.WAVE.MAX_ALIVE, 6);
  assert.equal(sp.done, false, 'enemies still alive');
  for (let i = 0; i < 60 * 40 && !sp.done; i++) {
    for (const e of w.enemies) if (!e.dead) w.killEnemy(e);
    w.step(CB.DT, idle());
    sp.update(CB.DT);
  }
  assert.equal(sp.done, true);
  assert.equal(sp.spawnedGroups, 20);
});

test('waves: round-robin order by kind and 0.7 s stagger', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 2 });
  const sp = CB.createWaveSpawner(w, [{ kind: 'dummy', count: 2 }, { kind: 'raceCondition', count: 1 }]);
  assert.deepEqual(H.plain(sp.queue), ['dummy', 'raceCondition', 'dummy']);
  sp.update(CB.DT);
  assert.equal(w.spawns.length, 1, 'first group immediately');
  for (let i = 0; i < 40; i++) sp.update(CB.DT);
  assert.equal(w.spawns.length, 1, 'next group waits 0.7 s');
  for (let i = 0; i < 3; i++) sp.update(CB.DT);
  assert.equal(w.spawns.length, 3, 'raceCondition spawns as a pair');
  const phases = w.spawns.slice(1).map((s) => s.opts.phase);
  assert.deepEqual(H.plain(phases), [0, Math.PI]);
});

test('waves: spawn points are on the arena edge and at least 60 px from the player', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 5 });
  for (let i = 0; i < 50; i++) {
    const p = w.edgePoint(60);
    assert.ok(Math.hypot(p.x - w.player.x, p.y - w.player.y) >= 60);
    const a = CB.ARENA;
    const onEdge = Math.abs(p.x - (a.x + 10)) < 1e-9 || Math.abs(p.x - (a.x + a.w - 10)) < 1e-9 || Math.abs(p.y - (a.y + 10)) < 1e-9 || Math.abs(p.y - (a.y + a.h - 10)) < 1e-9;
    assert.ok(onEdge);
  }
});

test('stages: data matches the spec table', () => {
  const CB = setup();
  assert.equal(CB.STAGES.length, 4);
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.boss)), ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug']);
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.path)), ['~/src/', '~/node_modules/', '~/.git/', '~/prod/']);
  for (const s of CB.STAGES) {
    assert.equal(s.waves.length, 2);
    assert.ok(CB.Pal.STAGES[s.palette], s.palette);
  }
  assert.deepEqual(H.plain(CB.STAGES[0].waves), [
    [{ kind: 'syntaxError', count: 4 }, { kind: 'nullPointer', count: 2 }],
    [{ kind: 'syntaxError', count: 6 }, { kind: 'nullPointer', count: 3 }],
  ]);
});
