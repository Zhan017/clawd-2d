'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.dummyBoss = {
    id: 'dummyBoss', name: 'DUMMY', tagline: 'noop()', commitMsg: 'fix: dummy',
    create() {
      const c = { id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} };
      return c;
    },
  };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: `~/s${i}/`, palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]] }));
  return CB;
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
function killAll(run) {
  for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e);
}
function until(run, pred, maxTicks, each) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred(run)) return true;
    if (each) each(run);
    run.step(idle());
  }
  return pred(run);
}

test('stageRunner: full stage sequence through to patch pick', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  assert.equal(run.state, 'stageIntro');
  assert.ok(until(run, (r) => r.state === 'wave', 200));
  assert.ok(Math.abs(run.time - 2.0) < 0.05);
  assert.ok(until(run, (r) => r.state === 'waveBreak', 600, killAll));
  assert.ok(until(run, (r) => r.state === 'wave' && r.waveIndex === 1, 200));
  assert.ok(until(run, (r) => r.state === 'bossWarn', 600, killAll));
  assert.ok(until(run, (r) => r.state === 'boss', 200));
  assert.ok(run.world.boss);
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'bossDead', 5));
  assert.ok(until(run, (r) => r.state === 'patchPick', 200));
  assert.equal(run.offer.length, 3);
  assert.ok(until(run, (r) => r.stateT >= 0.6, 60));
  assert.equal(run.choosePatch(0), true);
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.stageIndex, 1);
  assert.equal(run.history.length, 1);
  assert.equal(Object.values(run.patches).reduce((a, b) => a + b, 0), 1);
});

test('stageRunner: patch choice ignored during first 0.6 s', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'patchPick', 400);
  assert.equal(run.choosePatch(1), false);
  run.step(H.makeInput({ choice: 2 }));
  assert.equal(run.state, 'patchPick');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ choice: 2 }));
  assert.equal(run.state, 'stageIntro');
});

test('stageRunner: death → dying → dead → retry restores the stage', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  until(run, (r) => r.state === 'wave', 200);
  run.patches = { spread: 1, rapid: 1 };
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  run.step(idle());
  assert.equal(run.state, 'dying');
  assert.equal(run.deaths, 1);
  until(run, (r) => r.state === 'dead', 120);
  assert.equal(run.retryStage(), false, 'retry ignored during first 0.6 s');
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.world.player.hearts, 5);
  assert.deepEqual(H.plain(run.patches), { spread: 1 });
});

test('stageRunner: player invulnerable during bossDead', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'bossDead', 5);
  const p = run.world.player;
  assert.equal(CB.Player.hurt(p, run.world, null), false);
  assert.equal(p.hearts, 5);
});

test('stageRunner: clearing the last stage leads to victory', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, startStage: 3, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'victory', 400));
});

test('stageRunner: time excludes patchPick; events are returned and cleared', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'patchPick', 400);
  const t0 = run.time;
  for (let i = 0; i < 30; i++) run.step(idle());
  assert.equal(run.time, t0);
  run.choosePatch(0);
  until(run, (r) => r.stateT >= 0.6, 60);
  run.choosePatch(0);
  // The first choosePatch above was locked (stateT < 0.6); the second succeeded and queued a patchPick event.
  const evs = run.step(idle());
  assert.ok(Array.isArray(evs));
  assert.ok(evs.some((e) => e.type === 'patchPick'));
  assert.equal(run.world.events.length, 0);
});

test('stageRunner: skipWaves goes from stageIntro straight to bossWarn', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state !== 'stageIntro', 200);
  assert.equal(run.state, 'bossWarn');
});

// ---- rev 2: durations, heals, boss checkpoint -------------------------------------------------

const ticksIn = (run, state) => {
  let n = 0;
  while (run.state === state && n < 2000) {
    run.step(idle());
    n++;
  }
  return n;
};
const near = (ticks, secs) => assert.ok(Math.abs(ticks / 60 - secs) <= 0.04, `${ticks / 60} s vs ${secs} s`);
// Plays through the waves (killing everything instantly) until the given state is entered.
function toState(run, state) {
  assert.ok(until(run, (r) => r.state === state, 3000, killAll), `never reached ${state}, stuck in ${run.state}`);
}
function toBoss(run) {
  toState(run, 'boss');
  run.world.player.invuln = 0; // drop the boss-spawn safety so tests can hurt Clawd
  return run.world.boss;
}
function kill(run) {
  const p = run.world.player;
  p.hearts = 1;
  p.invuln = 0;
  assert.equal(run.world.hurtPlayer(null), true);
  run.step(idle());
}

test('stageRunner: state durations match the spec (waveBreak 1.5, bossWarn 2.5, bossDead 3.0, dying 1.2)', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  assert.ok(until(run, (r) => r.state === 'wave', 200));
  near(run.time * 60, 2.0);
  toState(run, 'waveBreak');
  near(ticksIn(run, 'waveBreak'), 1.5);
  assert.equal(run.state, 'wave');
  toState(run, 'bossWarn');
  near(ticksIn(run, 'bossWarn'), 2.5);
  assert.equal(run.state, 'boss');
  run.world.boss.hp = 0;
  toState(run, 'bossDead');
  near(ticksIn(run, 'bossDead'), 3.0);
  assert.equal(run.state, 'patchPick');

  const run2 = CB.createRun({ seed: 1 });
  toState(run2, 'wave');
  kill(run2);
  assert.equal(run2.state, 'dying');
  near(ticksIn(run2, 'dying'), 1.2);
  assert.equal(run2.state, 'dead');
});

test('stageRunner: waveBreak heals 2 hearts, capped at max hearts', () => {
  const CB = setup();
  for (const [patches, before, after] of [[{}, 1, 3], [{}, 4, 5], [{}, 5, 5], [{ heart: 1 }, 5, 6], [{ heart: 2 }, 3, 5]]) {
    const run = CB.createRun({ seed: 1, patches });
    toState(run, 'wave');
    run.world.player.hearts = before;
    toState(run, 'waveBreak');
    assert.equal(run.world.player.hearts, after, `patches ${JSON.stringify(patches)}, ${before} hearts`);
  }
});

test('stageRunner: bossWarn heals to full', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, patches: { heart: 1 } });
  toState(run, 'waveBreak');
  toState(run, 'wave');
  run.world.player.hearts = 1;
  toState(run, 'bossWarn');
  assert.equal(run.world.player.hearts, 6);
  const skip = CB.createRun({ seed: 1, skipWaves: true });
  skip.world.player.hearts = 2;
  toState(skip, 'bossWarn');
  assert.equal(skip.world.player.hearts, 5);
});

test('stageRunner: the player gets 1 s of invulnerability when the boss spawns', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toState(run, 'boss');
  const p = run.world.player;
  assert.ok(p.invuln >= 1.0 - 1e-9, `invuln ${p.invuln}`);
  assert.equal(CB.Player.canBeHit(p), false);
  assert.equal(run.world.hurtPlayer(null), false);
});

test('stageRunner: dying in the boss fight retries at bossWarn with full hearts and the stage-start patches', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  toBoss(run);
  run.patches = { spread: 1, rapid: 1 };
  kill(run);
  assert.equal(run.state, 'dying');
  assert.equal(run.deaths, 1);
  assert.equal(run.diedInBoss, true);
  assert.equal(run.checkpoint, 'boss');
  assert.throws(() => { run.checkpoint = 'stage'; }, TypeError, 'checkpoint is read-only');
  assert.equal(run.checkpoint, 'boss');
  assert.ok(until(run, (r) => r.state === 'dead', 200));
  until(run, (r) => r.stateT >= 0.6, 60);
  const oldWorld = run.world;
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'bossWarn');
  assert.notEqual(run.world, oldWorld, 'a fresh world');
  assert.equal(run.world.boss, null);
  assert.equal(run.world.player.hearts, 5);
  assert.equal(run.deaths, 1);
  assert.deepEqual(H.plain(run.patches), { spread: 1 });
  assert.equal(run.stageIndex, 0);
  const evs = run.step(idle());
  assert.ok(evs.some((e) => e.type === 'bossWarn'), 'the warning card event is emitted');
  toState(run, 'boss');
  assert.ok(run.world.boss);
});

test('stageRunner: dying in the waves retries at stageIntro', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  assert.equal(run.checkpoint, 'stage', 'default before any death');
  toState(run, 'wave');
  kill(run);
  assert.equal(run.state, 'dying');
  assert.equal(run.diedInBoss, false);
  assert.equal(run.checkpoint, 'stage');
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.world.player.hearts, 5);
  assert.equal(run.deaths, 1);
});

test('stageRunner: dying in the boss fight again after a boss retry keeps the boss checkpoint', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  toBoss(run);
  kill(run);
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'bossWarn');
  toBoss(run);
  kill(run);
  assert.equal(run.deaths, 2);
  assert.equal(run.checkpoint, 'boss');
});

test('stageRunner: the boss defeat tick spawns the bossDie rings', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toBoss(run);
  run.world.boss.hp = 0;
  run.step(idle());
  assert.equal(run.state, 'bossDead');
  assert.ok(run.world.fx.some((f) => f.kind === 'ring'), 'rings from bossDie');
});

test('stageRunner: if the player dies on the defeat tick the defeat wins, Clawd lives and no death is counted', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toBoss(run);
  const w = run.world;
  w.player.hearts = 1;
  w.boss.hp = 0;
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  run.step(idle());
  assert.equal(run.state, 'bossDead');
  assert.equal(w.player.dead, false);
  assert.ok(w.player.hearts >= 1);
  assert.equal(run.deaths, 0);
});

test('stageRunner: if the boss falls while Clawd is dying the defeat wins and the death is undone', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  const boss = toBoss(run);
  kill(run);
  assert.equal(run.state, 'dying');
  assert.equal(run.deaths, 1);
  run.world.player.trail.push({ x: 1, y: 1, life: 1, facing: 1 });
  boss.hp = 0;
  assert.ok(until(run, (r) => r.state !== 'dying', 20));
  assert.equal(run.state, 'bossDead');
  assert.equal(run.deaths, 0);
  assert.equal(run.world.player.dead, false);
  assert.ok(run.world.player.hearts >= 1);
  assert.equal(run.world.player.trail.length, 0);
  assert.ok(run.world.fx.some((f) => f.kind === 'ring'));
});

test('stageRunner: entering dead leaves no enemies, spawns, bullets or hazards', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  toState(run, 'wave');
  const w = run.world;
  w.spawnEnemy('dummy', 60, 60);
  w.queueSpawn('dummy', 100, 60);
  w.fireEnemyBullet(40, 40, 0, 0);
  w.firePlayerBolt(60, 100, 0);
  w.addHazard({ x: 200, y: 60 });
  kill(run);
  assert.ok(until(run, (r) => r.state === 'dead', 200), 'no killAll helper here: leftovers must be cleared by the runner');
  assert.equal(w.enemies.length, 0);
  assert.equal(w.spawns.length, 0);
  assert.equal(w.eBullets.length, 0);
  assert.equal(w.pBullets.length, 0);
  assert.equal(w.hazards.length, 0);
});
