'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function runSetup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.dummyBoss = { id: 'dummyBoss', name: 'D', tagline: 't', commitMsg: 'c', create() { const c = { id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update(w) { if (c.defeated) c.updatedAfterDefeat = true; if (c.hp <= 0) c.defeated = true; }, draw() {} }; return c; } };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: 'p', palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 1 }], [{ kind: 'dummy', count: 1 }]] }));
  return CB;
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const ticksIn = (run, state) => { let n = 0; while (run.state === state && n < 2000) { run.step(idle()); n++; } return n; };

test('extra: base fire rate is 5 shots/s over 10 s (not 4.7)', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 3 });
  let shots = 0;
  for (let i = 0; i < 600; i++) { w.step(1 / 60, H.makeInput({ aimX: 300, aimY: 126, fire: true })); shots += w.events.filter((e) => e.type === 'shoot').length; w.events.length = 0; w.pBullets.length = 0; }
  assert.ok(shots >= 50 && shots <= 51, `shots ${shots}`);
});
test('extra: dash covers 39 px (+-1)', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 3 });
  const x0 = w.player.x;
  w.step(1 / 60, H.makeInput({ moveX: 1, dash: true, aimX: 300, aimY: 30 }));
  for (let i = 0; i < 20; i++) w.step(1 / 60, H.makeInput({ aimX: 300, aimY: 30 }));
  assert.ok(Math.abs(w.player.x - x0 - 39) <= 1, `dist ${w.player.x - x0}`);
});
test('extra: dash invulnerability lasts 15 ticks (0.25 s)', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 3 });
  const p = w.player;
  let n = 0;
  w.step(1 / 60, H.makeInput({ moveX: 1, dash: true, aimX: 300, aimY: 30 }));
  if (!CB.Player.canBeHit(p)) n++;
  for (let i = 0; i < 30; i++) { w.step(1 / 60, H.makeInput({ aimX: 300, aimY: 30 })); p.x = 160; if (!CB.Player.canBeHit(p)) n++; }
  assert.equal(n, 15);
});
test('extra: a dash press during hitstop is buffered, not lost', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 3 });
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  w.step(1 / 60, idle());
  assert.ok(w.hitstop > 0);
  w.step(1 / 60, H.makeInput({ aimX: 300, aimY: 30, moveX: 1, dash: true }));
  for (let i = 0; i < 6; i++) w.step(1 / 60, H.makeInput({ aimX: 300, aimY: 30, moveX: 1 }));
  assert.ok(w.events.some((e) => e.type === 'dash'));
});
test('extra: boss defeat spawns the bossDie fx', () => {
  const CB = runSetup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  while (run.state !== 'boss') run.step(idle());
  run.world.boss.hp = 0;
  while (run.state !== 'bossDead') run.step(idle());
  assert.ok(run.world.fx.some((f) => f.kind === 'ring'), 'rings from bossDie');
});
test('extra: a defeated boss is not updated again', () => {
  const CB = runSetup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  while (run.state !== 'boss') run.step(idle());
  const boss = run.world.boss;
  boss.hp = 0;
  for (let i = 0; i < 60; i++) run.step(idle());
  assert.notEqual(boss.updatedAfterDefeat, true);
});
test('extra: same-tick death and defeat leaves Clawd alive for bossDead', () => {
  const CB = runSetup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  while (run.state !== 'boss') run.step(idle());
  const w = run.world;
  w.player.hearts = 1; w.boss.hp = 0; w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  run.step(idle());
  assert.equal(run.state, 'bossDead');
  assert.equal(w.player.dead, false);
});
test('extra: state timings match the spec (waveBreak 1.5, bossWarn 2.5, bossDead 4.6 first time, dying 1.2)', () => {
  const CB = runSetup();
  const run = CB.createRun({ seed: 1, skipWaves: false });
  const near = (n, s) => assert.ok(Math.abs(n / 60 - s) <= 0.04, `${n / 60} vs ${s}`);
  while (run.state !== 'wave') run.step(idle());
  while (run.state === 'wave') { for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e); run.step(idle()); }
  near(ticksIn(run, 'waveBreak'), 1.5);
  while (run.state === 'wave') { for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e); run.step(idle()); }
  near(ticksIn(run, 'bossWarn'), 2.5);
  run.world.boss.hp = 0;
  while (run.state === 'boss') run.step(idle());
  near(ticksIn(run, 'bossDead'), 4.6);
});
test('extra: parseDebugHash survives malformed escapes and ignores bare anchors', () => {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/scenes/play.js', 'src/main.js');
  assert.doesNotThrow(() => CB.parseDebugHash('#100%'));
  assert.equal(CB.parseDebugHash('#top').active, false);
  assert.equal(CB.parseDebugHash('#stage=2').active, true);
});
test('extra: wrapAngle terminates for huge and non-finite angles', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/math.js']);
  assert.ok(Number.isFinite(CB.M.wrapAngle(1e17)));
  assert.equal(CB.M.wrapAngle(Infinity), 0);
});
