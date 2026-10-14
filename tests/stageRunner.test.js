'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(extra) {
  const CB = H.loadWith(...(extra || []), 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
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
  assert.ok(until(run, (r) => r.state === 'patchPick', 300)); // the first BUG FIXED card holds 4.6 s
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
  assert.equal(run.world.player.hearts, 6);
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
  assert.equal(p.hearts, 6);
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

test('stageRunner: state durations match the spec (waveBreak 1.5, bossWarn 2.5, bossDead 4.6 first time, dying 1.2)', () => {
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
  near(ticksIn(run, 'bossDead'), 4.6);
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
  for (const [patches, before, after] of [[{}, 1, 3], [{}, 5, 6], [{}, 6, 6], [{ heart: 1 }, 6, 7], [{ heart: 2 }, 3, 5]]) {
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
  assert.equal(run.world.player.hearts, 7);
  const skip = CB.createRun({ seed: 1, skipWaves: true });
  skip.world.player.hearts = 2;
  toState(skip, 'bossWarn');
  assert.equal(skip.world.player.hearts, 6);
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
  assert.equal(run.world.player.hearts, 6);
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
  assert.equal(run.world.player.hearts, 6);
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

// ---- rev 3 (A3-2): wave-2 checkpoint, short retry intros, boss entrance, full-meter boss start ---------------------

// Steps until `pred` holds (at most `max` ticks) and returns every event the steps returned.
function collect(run, pred, max, each) {
  const evs = [];
  for (let i = 0; i < max && !pred(run); i++) {
    if (each) each(run);
    for (const e of run.step(idle())) evs.push(e);
  }
  return evs;
}
const dieAndRetry = (run) => {
  kill(run);
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  assert.equal(run.retryStage(), true);
};

test('stageRunner: checkpoint is boss | wave2 | stage by where Clawd died (waveBreak and wave 2 are wave2)', () => {
  const CB = setup();
  const at = (reach) => {
    const run = CB.createRun({ seed: 1 });
    reach(run);
    kill(run);
    assert.equal(run.state, 'dying');
    return run;
  };
  assert.equal(at((run) => assert.equal(run.state, 'stageIntro')).checkpoint, 'stage', 'stageIntro');
  assert.equal(at((run) => toState(run, 'wave')).checkpoint, 'stage', 'wave 1');
  const wb = at((run) => toState(run, 'waveBreak'));
  assert.equal(wb.checkpoint, 'wave2', 'waveBreak');
  assert.equal(wb.diedInBoss, false);
  const w2 = at((run) => {
    toState(run, 'waveBreak');
    assert.ok(until(run, (r) => r.state === 'wave' && r.waveIndex === 1, 200));
  });
  assert.equal(w2.checkpoint, 'wave2', 'wave 2');
  assert.equal(at((run) => toState(run, 'bossWarn')).checkpoint, 'stage', 'bossWarn');
  const boss = at((run) => toBoss(run));
  assert.equal(boss.checkpoint, 'boss');
  assert.equal(boss.diedInBoss, true, 'diedInBoss stays and mirrors the boss checkpoint');
});

test('stageRunner: a wave-2 death retries at wave 2 with full hearts, stage-start patches and the wave-1 tally', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  toState(run, 'waveBreak');
  assert.deepEqual(H.plain(run.squashed), { dummy: 2 }, 'the last kill of the wave is in the break snapshot');
  assert.ok(until(run, (r) => r.state === 'wave' && r.waveIndex === 1, 200));
  run.patches = { spread: 1, rapid: 1 };
  run.world.killEnemy(run.world.spawnEnemy('dummy', 60, 60)); // an extra kill; the wave's own enemy is still pending, so wave 2 goes on
  run.step(idle());
  assert.equal(run.state, 'wave');
  assert.equal(run.squashed.dummy, 3, 'the wave-2 kill counts while it lasts');
  const oldWorld = run.world;
  run.world.player.hearts = 2;
  kill(run);
  assert.equal(run.checkpoint, 'wave2');
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  assert.equal(run.retryStage(), true);
  assert.equal(run.state, 'wave', 'the stage intro and wave 1 are skipped');
  assert.equal(run.waveIndex, 1);
  assert.equal(run.stageIndex, 0);
  assert.notEqual(run.world, oldWorld, 'a fresh world');
  assert.equal(run.world.player.hearts, 6);
  assert.deepEqual(H.plain(run.patches), { spread: 1 });
  assert.deepEqual(H.plain(run.squashed), { dummy: 2 }, 'wave 1 is kept, the failed wave-2 kill is not');
  assert.equal(run.deaths, 1);
  assert.equal(run.spawner.total, 1, 'a fresh spawner for wave 2');
  assert.equal(run.attempt, 1);
  assert.equal(run.diedInBoss, false);
  toState(run, 'bossWarn');
  assert.deepEqual(H.plain(run.squashed), { dummy: 3 });
});

test('stageRunner: a wave-break death also retries at wave 2; a second death in wave 2 keeps the wave-1 tally', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  toState(run, 'waveBreak');
  dieAndRetry(run);
  assert.equal(run.state, 'wave');
  assert.equal(run.waveIndex, 1);
  assert.deepEqual(H.plain(run.squashed), { dummy: 2 });
  dieAndRetry(run);
  assert.equal(run.state, 'wave');
  assert.equal(run.waveIndex, 1);
  assert.deepEqual(H.plain(run.squashed), { dummy: 2 });
  assert.equal(run.deaths, 2);
  assert.equal(run.attempt, 2);
});

test('stageRunner: the squashed tally of a retry never aliases the stage-start or wave-break snapshots', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  toState(run, 'waveBreak');
  const snap = run.wave2Squashed;
  assert.notEqual(snap, run.squashed);
  assert.deepEqual(H.plain(snap), { dummy: 2 });
  dieAndRetry(run);
  assert.notEqual(run.squashed, run.wave2Squashed, 'the live tally is its own object');
  run.squashed.dummy = 99;
  assert.deepEqual(H.plain(run.wave2Squashed), { dummy: 2 });
  assert.deepEqual(H.plain(run.stageSquashed), {});
});

test('stageRunner: skipWaves and Boss Rush runs never get a wave-2 checkpoint', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, bossRush: true });
  toState(run, 'bossWarn');
  kill(run);
  assert.equal(run.checkpoint, 'stage');
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.retryStage();
  assert.equal(run.state, 'stageIntro');
});

test('stageRunner: retry cards are short from the second visit (stage intro 0.9 s, boss warning 1.3 s)', () => {
  const CB = setup();
  assert.equal(CB.RUN_T.stageIntroRetry, 0.9);
  assert.equal(CB.RUN_T.bossWarnRetry, 1.3);
  const run = CB.createRun({ seed: 1, skipWaves: true });
  assert.equal(run.introT, 2.0, 'the first visit is the full card');
  assert.equal(run.seenIntro.has(0), false);
  near(ticksIn(run, 'stageIntro'), 2.0);
  assert.equal(run.seenIntro.has(0), true, 'marked when the card completes');
  assert.equal(run.warnT, 2.5);
  assert.equal(run.seenWarn.has(0), false);
  near(ticksIn(run, 'bossWarn'), 2.5);
  assert.equal(run.seenWarn.has(0), true);
  assert.equal(run.state, 'boss');
  run.world.player.invuln = 0;
  dieAndRetry(run);
  assert.equal(run.state, 'bossWarn', 'the boss checkpoint skips the intro');
  assert.equal(run.warnT, 1.3);
  near(ticksIn(run, 'bossWarn'), 1.3);
  assert.equal(run.state, 'boss');

  const run2 = CB.createRun({ seed: 1 });
  near(ticksIn(run2, 'stageIntro'), 2.0);
  toState(run2, 'wave');
  dieAndRetry(run2);
  assert.equal(run2.state, 'stageIntro');
  assert.equal(run2.introT, 0.9);
  near(ticksIn(run2, 'stageIntro'), 0.9);
  assert.equal(run2.state, 'wave');
});

test('stageRunner: a card that was cut short by a death is still a first visit', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  for (let i = 0; i < 30; i++) run.step(idle());
  assert.equal(run.state, 'stageIntro');
  kill(run);
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.retryStage();
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.introT, 2.0, 'the intro never completed, so it is still the full card');

  const warn = CB.createRun({ seed: 1, skipWaves: true });
  toState(warn, 'bossWarn');
  for (let i = 0; i < 20; i++) warn.step(idle());
  kill(warn);
  toState(warn, 'dead');
  until(warn, (r) => r.stateT >= 0.6, 60);
  warn.retryStage();
  assert.equal(warn.state, 'stageIntro');
  assert.equal(warn.introT, 0.9, 'this intro had completed');
  toState(warn, 'bossWarn');
  assert.equal(warn.warnT, 2.5, 'the warning card never completed');
});

test('stageRunner: cards are tracked per stage; Boss Rush plays every first visit at full length', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, bossRush: true });
  assert.equal(run.skipWaves, true);
  toBoss(run);
  run.world.boss.hp = 0;
  toState(run, 'patchPick');
  until(run, (r) => r.stateT >= 0.6, 60);
  assert.equal(run.choosePatch(0), true);
  assert.equal(run.stageIndex, 1);
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.introT, 2.0, 'stage 2 has not been visited');
  near(ticksIn(run, 'stageIntro'), 2.0);
  assert.equal(run.state, 'bossWarn');
  assert.equal(run.warnT, 2.5);
  assert.deepEqual([...run.seenIntro], [0, 1]);
});

test('stageRunner: bossEnter is emitted once per boss start (retries included) with the boss position', () => {
  const CB = setup();
  const sawByFx = [];
  const realConsume = CB.Fx.consume;
  CB.Fx.consume = function (w, from) {
    for (let i = from; i < w.events.length; i++) sawByFx.push(w.events[i].type);
    return realConsume.call(this, w, from);
  };
  const run = CB.createRun({ seed: 1, skipWaves: true });
  const evs = collect(run, (r) => r.state === 'boss', 400);
  assert.equal(run.state, 'boss');
  assert.equal(evs.filter((e) => e.type === 'bossEnter').length, 0, 'not before the fight starts');
  const after = collect(run, () => false, 3);
  const enter = after.filter((e) => e.type === 'bossEnter');
  assert.equal(enter.length, 1);
  assert.equal(enter[0].x, run.world.boss.x);
  assert.equal(enter[0].y, run.world.boss.y);
  assert.equal(sawByFx.filter((t) => t === 'bossEnter').length, 1, 'Fx sees it too, once');
  collect(run, () => false, 120);
  run.world.player.invuln = 0;
  kill(run);
  toState(run, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.retryStage();
  const again = collect(run, (r) => r.state === 'boss', 400).concat(collect(run, () => false, 3));
  assert.equal(again.filter((e) => e.type === 'bossEnter').length, 1, 'one more on the retry');
  assert.equal(sawByFx.filter((t) => t === 'bossEnter').length, 2);
  for (const e of [...after, ...again]) if (e.type === 'bossEnter') assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
});

test('stageRunner: bossEnter always carries a finite x, y even for a boss with no position', () => {
  const CB = setup();
  CB.Bosses.dummyBoss.create = () => ({ id: 'dummyBoss', hp: 10, maxHp: 10, phase: 1, defeated: false, update() {}, draw() {} });
  const run = CB.createRun({ seed: 1, skipWaves: true });
  const evs = collect(run, (r) => r.state === 'boss', 400).concat(collect(run, () => false, 2));
  const enter = evs.find((e) => e.type === 'bossEnter');
  assert.ok(enter);
  assert.ok(Number.isFinite(enter.x) && Number.isFinite(enter.y));
});

test('stageRunner: every boss start, retries included, begins with a full context meter', () => {
  const CB = H.loadWith('src/game/compact.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.dummyBoss = { id: 'dummyBoss', create: () => ({ id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update() {}, draw() {} }) };
  CB.STAGES = [0, 1].map((i) => ({ id: 's' + i, n: i + 1, path: '~/', palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 1 }], [{ kind: 'dummy', count: 1 }]] }));
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toState(run, 'bossWarn');
  assert.equal(run.world.context.value, 0, 'empty before the fight');
  const evs = collect(run, (r) => r.state === 'boss', 400);
  assert.equal(run.state, 'boss');
  assert.equal(run.world.context.value, run.world.context.max);
  assert.equal(run.world.context.announced, true);
  assert.equal(evs.filter((e) => e.type === 'compactReady').length, 1, 'announced once, on the boss-start tick');
  run.world.player.invuln = 0;
  dieAndRetry(run);
  assert.equal(run.world.context.value, 0, 'a fresh world after the retry');
  toState(run, 'boss');
  assert.equal(run.world.context.value, run.world.context.max, 'the retried fight also starts full');
});

test('stageRunner: every event a run returns, run-level ones included, carries a finite x, y', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, bossRush: true });
  const evs = [];
  const step = (inp) => { for (const e of run.step(inp || idle())) evs.push(e); };
  for (let i = 0; i < 6000 && run.state !== 'victory'; i++) {
    if (run.state === 'boss') {
      run.world.player.invuln = 0;
      if (run.deaths === 0 && run.stageIndex === 0) {
        run.world.player.hearts = 1; // one death and a boss retry on the way
        run.world.hurtPlayer(null);
        step();
        continue;
      }
      run.world.boss.hp = 0;
    }
    if (run.state === 'dead' && run.stateT >= 0.6) run.retryStage();
    step(run.state === 'patchPick' && run.stateT > 0.7 ? H.makeInput({ choice: 1 }) : idle());
  }
  assert.equal(run.state, 'victory');
  step();
  const types = new Set(evs.map((e) => e.type));
  for (const t of ['bossWarn', 'bossEnter', 'bossDie', 'patchPick', 'victory', 'playerDie', 'playerHurt']) assert.ok(types.has(t), `saw ${t}`);
  for (const e of evs) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.type} has no finite x, y`);
});

// ---- boss phase change: a hotfix heart lands halfway between the boss and the arena centre ------------------------------------------

// A boss that changes phase when told to: fire() makes its next update emit bossPhase from where it stands.
function phaseBossRun(extra) {
  const CB = setup(extra);
  CB.Bosses.phaseBoss = {
    id: 'phaseBoss', name: 'PHASE', tagline: 'noop()', commitMsg: 'fix: phase',
    create() {
      const c = {
        id: 'phaseBoss', x: 100, y: 40, hp: 10, maxHp: 10, phase: 1, defeated: false, pending: false,
        update(w) {
          if (c.pending) {
            c.pending = false;
            c.phase++;
            w.emit('bossPhase', { x: c.x, y: c.y, phase: c.phase });
          }
        },
        draw() {},
      };
      return c;
    },
  };
  CB.STAGES[0].boss = 'phaseBoss';
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toBoss(run);
  return { CB, run, boss: run.world.boss };
}

test('stageRunner: a boss phase change drops exactly one hotfix 24 px from Clawd toward the arena centre (160, 96)', () => {
  const { CB, run, boss } = phaseBossRun(['src/game/pickups.js']);
  assert.ok(CB.Pickups && CB.Pickups.drop);
  assert.equal(run.world.pickups.length, 0, 'nothing lying around before the phase change');
  const p = run.world.player;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const expectAt = (px, py) => {
    const d = Math.hypot(160 - px, 96 - py);
    return [px + ((160 - px) / d) * 24, py + ((96 - py) / d) * 24];
  };
  p.x = 100;
  p.y = 40;
  boss.pending = true;
  const evs = run.step(idle());
  assert.equal(evs.filter((e) => e.type === 'bossPhase').length, 1, 'the event still reaches the caller');
  const list = run.world.pickups;
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'hotfix');
  const [ex, ey] = expectAt(100, 40);
  assert.ok(near(list[0].x, ex) && near(list[0].y, ey), JSON.stringify([list[0].x, list[0].y, ex, ey]));
  assert.ok(Math.hypot(list[0].x - p.x, list[0].y - p.y) > 9, 'not collected on the spot');
  for (let i = 0; i < 30; i++) run.step(idle());
  assert.equal(run.world.pickups.length, 1, 'one event, one drop: later steps do not drop again');
  p.x = 220;
  p.y = 150;
  boss.pending = true;
  run.step(idle());
  assert.equal(run.world.pickups.length, 2, 'the next phase change drops the next hotfix');
  const [fx, fy] = expectAt(220, 150);
  assert.ok(near(run.world.pickups[1].x, fx) && near(run.world.pickups[1].y, fy));
});

test('stageRunner: the phase drop respects the pickup cap and ignores other events', () => {
  const { CB, run, boss } = phaseBossRun(['src/game/pickups.js']);
  const w = run.world;
  for (let i = 0; i < CB.Pickups.CAP; i++) CB.Pickups.drop(w, 20 + i, 20);
  assert.equal(w.pickups.length, CB.Pickups.CAP);
  boss.pending = true;
  assert.doesNotThrow(() => run.step(idle()));
  assert.equal(w.pickups.length, CB.Pickups.CAP, 'refused at the cap, no error');
  w.pickups.length = 0;
  w.emit('hit', { x: 10, y: 10, kind: 'x', boss: true });
  w.emit('bossDie', { x: 10, y: 10 });
  run.step(idle());
  assert.equal(w.pickups.length, 0, 'only bossPhase drops a hotfix');
});

test('stageRunner: a boss phase change with CB.Pickups not loaded breaks nothing', () => {
  const { CB, run, boss } = phaseBossRun();
  assert.equal(CB.Pickups, undefined);
  boss.pending = true;
  let evs;
  assert.doesNotThrow(() => { evs = run.step(idle()); });
  assert.equal(evs.filter((e) => e.type === 'bossPhase').length, 1);
  assert.ok(!run.world.pickups || run.world.pickups.length === 0);
  assert.equal(run.state, 'boss');
  for (let i = 0; i < 30; i++) run.step(idle());
  assert.equal(run.state, 'boss');
});

// ---- the UX pass: the BUG FIXED card holds, skips, and the world eases back in -----------------------------------------------------

function toBossDead(run) {
  toState(run, 'boss');
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'bossDead', 10));
}

test('stageRunner: the first BUG FIXED card holds 4.6 s, a boss beaten again after a retry holds 3.0 s', () => {
  const CB = setup();
  assert.equal(CB.RUN_T.bossDead, 4.6);
  assert.equal(CB.RUN_T.bossDeadRetry, 3.0);
  const run = CB.createRun({ seed: 1, skipWaves: true });
  toBossDead(run);
  assert.equal(run.deadT, 4.6);
  assert.equal(run.seenFixed.has(0), false);
  near(ticksIn(run, 'bossDead'), 4.6);
  assert.equal(run.seenFixed.has(0), true, 'marked when the card completes');
  assert.equal(run.state, 'patchPick');

  // The same boss again (a retry that got back to it): the short hold.
  const again = CB.createRun({ seed: 1, skipWaves: true });
  again.seenFixed.add(0);
  toBossDead(again);
  assert.equal(again.deadT, 3.0);
  near(ticksIn(again, 'bossDead'), 3.0);
});

test('stageRunner: skipFixedCard ends the card on the next step, but only after the slow-mo, and only on that card', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  assert.equal(run.skipFixedCard(), false, 'not on a stage intro');
  toBossDead(run);
  assert.equal(run.skipFixedCard(), false, 'the boss is still exploding');
  until(run, (r) => r.stateT > CB.RUN_T.slowmo + 0.1, 200);
  assert.equal(run.state, 'bossDead');
  assert.equal(run.skipFixedCard(), true);
  run.step(idle());
  run.step(idle());
  assert.equal(run.state, 'patchPick');
  assert.equal(run.seenFixed.has(0), true, 'a skipped card still counts as seen');
});

test('stageRunner: timeScale slows the whole step (the world, the clocks) and defaults to exactly 1', () => {
  const CB = setup();
  const a = CB.createRun({ seed: 1 });
  const b = CB.createRun({ seed: 1 });
  assert.equal(a.timeScale, 1);
  b.timeScale = 0.5;
  for (let i = 0; i < 60; i++) {
    a.step(idle());
    b.step(idle());
  }
  assert.ok(Math.abs(a.stateT - 1.0) < 1e-9);
  assert.ok(Math.abs(b.stateT - 0.5) < 1e-9, 'half the speed, half the clock');
  assert.ok(Math.abs(b.time - 0.5) < 1e-9);
});
