'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/compact.js', 'src/game/pickups.js', 'src/game/stages.js', 'src/game/waves.js'];

function setup() {
  const CB = H.load(FILES);
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 4, contact: false }), update(e, w, dt) { e.x += 30 * dt; }, draw() {} };
  }
  const w = CB.createWorld({ seed: 21 });
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });

test('elites: stage data has two counts per stage', () => {
  const { CB } = setup();
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.elites)), [[0, 1], [0, 1], [1, 1], [1, 2]]);
});

test('elites: marking picks exactly N spawns from allowed kinds and leaves the queue unchanged', () => {
  const { CB, w } = setup();
  const def = [{ kind: 'offByOne', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'nullPointer', count: 2 }];
  const plain = CB.createWaveSpawner(w, def, 0);
  const sp = CB.createWaveSpawner(w, def, 2);
  assert.deepEqual(H.plain(sp.queue), H.plain(plain.queue));
  assert.equal(sp.eliteFlags.filter(Boolean).length, 2);
  sp.queue.forEach((k, i) => { if (sp.eliteFlags[i]) assert.equal(k, 'offByOne'); });
});

test('elites: hp is ceil(base × 1.75) and they move 20% farther', () => {
  const { w } = setup();
  const a = w.spawnEnemy('syntaxError', 40, 40);
  const b = w.spawnEnemy('syntaxError', 40, 80, { elite: true });
  assert.equal(b.hp, 7);
  assert.equal(b.maxHp, 7);
  assert.equal(b.elite, true);
  H.stepN(w, 60, idle);
  assert.ok(Math.abs((b.x - 40) - 1.2 * (a.x - 40)) < 0.5);
});

test('elites: a normal kill drops exactly one hotfix; a silent kill drops none', () => {
  const { w } = setup();
  const a = w.spawnEnemy('syntaxError', 40, 40, { elite: true });
  const b = w.spawnEnemy('syntaxError', 80, 40, { elite: true });
  w.damageEnemy(a, 99);
  w.killEnemy(b, true);
  assert.equal(w.pickups.length, 1);
});

test('hotfix: heals below max, gives +15 context at full, expires at 8 s, cap 6', () => {
  const { CB, w } = setup();
  const p = w.player;
  p.hearts = 3;
  CB.Pickups.drop(w, p.x, p.y);
  H.stepN(w, 1, idle);
  assert.equal(p.hearts, 4);
  assert.equal(w.pickups.length, 0);
  p.hearts = p.stats.maxHearts;
  CB.Pickups.drop(w, p.x, p.y);
  H.stepN(w, 1, idle);
  assert.equal(w.context.value, 15);
  const pops = w.events.filter((e) => e.type === 'text').map((e) => e.text);
  assert.deepEqual(pops, ['+1 ♥', '+15 /compact'], 'the pop names the meter it feeds, not "ctx"');
  CB.Pickups.drop(w, 30, 30);
  H.stepN(w, 8.1 * 60, idle);
  assert.equal(w.pickups.length, 0);
  for (let i = 0; i < 10; i++) CB.Pickups.drop(w, 30, 30);
  assert.equal(w.pickups.length, 6);
});

test('elites: the alive cap of 6 still holds with elites', () => {
  const { CB, w } = setup();
  const sp = CB.createWaveSpawner(w, [{ kind: 'syntaxError', count: 12 }], 3);
  let peak = 0;
  for (let i = 0; i < 60 * 20; i++) {
    w.step(CB.DT, idle());
    sp.update(CB.DT);
    peak = Math.max(peak, sp.alive());
  }
  assert.equal(peak, 6);
});
