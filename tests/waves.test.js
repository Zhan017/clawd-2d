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

// ---- rev 3 (A3-2): the whole stage table, and elites that can actually be placed -----------------------------------------------

test('stages: the full table matches spec 2.5 (path, bosses, both waves, P0 elites per wave)', () => {
  const CB = setup();
  const k = (kind, count) => ({ kind, count });
  const expected = [
    { id: 'src', n: 1, path: '~/src/', boss: 'infiniteLoop', elites: [0, 1], waves: [[k('syntaxError', 4), k('nullPointer', 2)], [k('syntaxError', 6), k('nullPointer', 3)]] },
    { id: 'node_modules', n: 2, path: '~/node_modules/', boss: 'memoryLeakBoss', elites: [0, 1], waves: [[k('syntaxError', 3), k('raceCondition', 2), k('memoryLeak', 2)], [k('memoryLeak', 3), k('raceCondition', 2), k('nullPointer', 2)]] },
    { id: 'git', n: 3, path: '~/.git/', boss: 'mergeConflict', elites: [1, 1], waves: [[k('offByOne', 2), k('syntaxError', 4), k('raceCondition', 1)], [k('offByOne', 3), k('memoryLeak', 2), k('nullPointer', 2)]] },
    { id: 'prod', n: 4, path: '~/prod/', boss: 'heisenbug', elites: [1, 2], waves: [[k('offByOne', 2), k('raceCondition', 2), k('memoryLeak', 2), k('nullPointer', 3)], [k('offByOne', 3), k('syntaxError', 4), k('memoryLeak', 2), k('raceCondition', 2)]] },
  ];
  assert.equal(CB.STAGES.length, 4);
  CB.STAGES.forEach((s, i) => {
    const e = expected[i];
    assert.deepEqual(H.plain({ id: s.id, n: s.n, path: s.path, boss: s.boss, elites: s.elites, waves: s.waves }), e, `stage ${i + 1}`);
    assert.ok(CB.Pal.STAGES[s.palette], s.palette);
  });
  assert.deepEqual(H.plain(CB.GROUP_SIZE), { raceCondition: 2 }, 'race conditions come in pairs');
});

test('stages: every real wave has enough eligible spawns for its elite count, and the spawner flags exactly that many', () => {
  const CB = H.loadWith('src/game/pickups.js', 'src/game/stages.js', 'src/game/waves.js');
  for (const kind of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[kind] = { create: (w, x, y) => CB.makeEnemy(kind, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  for (const stage of CB.STAGES) {
    assert.equal(stage.elites.length, stage.waves.length, `${stage.id}: one elite count per wave`);
    stage.waves.forEach((wave, i) => {
      const eligible = wave.filter((d) => CB.ELITE_KINDS[d.kind]).reduce((n, d) => n + d.count, 0);
      assert.ok(stage.elites[i] <= eligible, `${stage.id} wave ${i + 1}: ${stage.elites[i]} elites but only ${eligible} eligible spawns`);
      const w = CB.createWorld({ seed: 11 });
      const sp = CB.createWaveSpawner(w, wave, stage.elites[i]);
      assert.equal(sp.eliteFlags.filter(Boolean).length, stage.elites[i], `${stage.id} wave ${i + 1}: flagged`);
      sp.queue.forEach((kind, j) => {
        if (sp.eliteFlags[j]) assert.ok(CB.ELITE_KINDS[kind], `${kind} may not be an elite`);
      });
    });
  }
});
