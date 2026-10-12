'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.stub = { id: 'stub', name: 'S', tagline: 't', commitMsg: 'c', create: () => { const c = { x: 160, y: 60, hp: 1, maxHp: 1, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} }; return c; } };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: '~/s/', palette: 'src', boss: 'stub', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]], elites: [0, 0] }));
  return CB;
}
function until(run, pred, max, each) {
  for (let i = 0; i < max; i++) {
    if (pred(run)) return true;
    if (each) each(run);
    run.step(H.makeInput({ choice: run.state === 'patchPick' && run.stateT > 0.7 ? 1 : 0 }));
  }
  return pred(run);
}

test('modes: Boss Rush visits all four stages with only boss states and ends in victory', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, bossRush: true });
  const seen = new Set();
  until(run, (r) => r.state === 'victory', 60 * 60 * 3, (r) => {
    seen.add(r.state);
    if (r.state === 'boss') r.world.boss.hp = 0;
  });
  assert.equal(run.state, 'victory');
  assert.ok(!seen.has('wave') && !seen.has('waveBreak'));
  assert.equal(run.bossesFixed, 4);
});

test('modes: YOLO has 3 hearts, 15% faster bullets and 0.7 s hurt invuln; normal runs are unchanged', () => {
  const CB = setup();
  const y = CB.createRun({ seed: 1, yolo: true });
  assert.equal(y.world.player.hearts, 3);
  assert.equal(y.world.player.hurtInvuln, 0.7);
  const b = y.world.fireEnemyBullet(50, 50, 0);
  assert.ok(Math.abs(b.vx - 92) < 1e-9);
  const n = CB.createRun({ seed: 1 });
  assert.equal(n.world.player.hearts, 6);
  assert.ok(Math.abs(n.world.fireEnemyBullet(50, 50, 0).vx - 80) < 1e-9);
});

test('modes: YOLO subtracts 3 hearts from the base 6, so Extra Heart gives 4 and 5; normal runs get 6, 7 and 8', () => {
  const CB = setup();
  for (const [heart, yolo, normal] of [[0, 3, 6], [1, 4, 7], [2, 5, 8]]) {
    const patches = heart ? { heart } : {};
    const y = CB.createRun({ seed: 1, yolo: true, patches }).world.player;
    assert.equal(y.hearts, yolo, `YOLO, heart ${heart}`);
    assert.equal(y.stats.maxHearts, yolo);
    const n = CB.createRun({ seed: 1, patches }).world.player;
    assert.equal(n.hearts, normal, `normal, heart ${heart}`);
    assert.equal(n.stats.maxHearts, normal);
  }
});

test('tally: counts non-boss non-silent kills by kind; a wave-1 death retries the stage with the stage-start tally', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  until(run, (r) => r.state === 'wave', 300);
  const killAll = (r) => { for (const e of r.world.enemies) if (!e.dead) r.world.killEnemy(e); };
  until(run, (r) => r.world.enemies.length > 0, 200);
  killAll(run);
  run.step(H.makeInput());
  assert.equal(run.state, 'wave', 'one of the two wave-1 enemies is still to come');
  assert.equal(run.squashed.dummy, 1);
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  until(run, (r) => r.state === 'dead', 200);
  until(run, (r) => r.stateT > 0.7, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'stageIntro', 'a wave-1 death restarts the stage');
  assert.equal(run.squashed.dummy || 0, 0);
});

test('tally: a wave-break death retries at wave 2 and keeps the wave-1 tally (rev 3 checkpoint)', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  until(run, (r) => r.state === 'wave', 300);
  until(run, (r) => r.state === 'waveBreak', 600, (r) => { for (const e of r.world.enemies) if (!e.dead) r.world.killEnemy(e); });
  assert.equal(run.squashed.dummy, 2);
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  until(run, (r) => r.state === 'dead', 200);
  until(run, (r) => r.stateT > 0.7, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'wave');
  assert.equal(run.waveIndex, 1);
  assert.equal(run.squashed.dummy, 2);
});

test('modes: victory emits a victory event', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, startStage: 3, skipWaves: true });
  let got = false;
  for (let i = 0; i < 2000 && !got; i++) {
    if (run.state === 'boss') run.world.boss.hp = 0;
    got = run.step(H.makeInput()).some((e) => e.type === 'victory');
  }
  assert.ok(got);
});
