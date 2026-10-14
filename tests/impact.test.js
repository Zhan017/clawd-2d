'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(god) {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 5, god: !!god });
  return { CB, w };
}
// Events must be emitted inside world.step to reach Fx.consume.
function emitInStep(CB, w, evs) {
  CB.Enemies.emitter = {
    create: (w2, x, y) => CB.makeEnemy('emitter', x, y, { hp: 1, contact: false, targetable: false, regular: false }),
    update(e, w2) {
      if (!e.data.done) {
        e.data.done = true;
        for (const ev of evs) w2.emit(ev.type, ev);
      }
    },
    draw() {},
  };
  w.spawnEnemy('emitter', 20, 30);
  H.stepN(w, 1, H.makeInput());
}

test('impact: bossPhase sets hitstop 0.14, a white flash and shake; time freezes then resumes', () => {
  const { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'bossPhase', x: 100, y: 60, phase: 2 }]);
  assert.ok(Math.abs(w.hitstop - 0.14) < 1e-9, `hitstop ${w.hitstop}`);
  assert.ok(w.flash > 0.05);
  assert.equal(w.flashColor, '#FFFFFF');
  assert.ok(w.shake > 0);
  const t0 = w.time;
  H.stepN(w, 8, H.makeInput());
  assert.equal(w.time, t0);
  H.stepN(w, 3, H.makeInput());
  assert.ok(w.time > t0);
});

test('impact: hits, clinks and small kills add nothing; an r=6 kill adds 0.04', () => {
  let { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'hit', x: 1, y: 1 }, { type: 'clink', x: 1, y: 1 }, { type: 'enemyDie', x: 1, y: 1, kind: 'k', r: 5, boss: false }]);
  assert.equal(w.hitstop, 0);
  assert.equal(w.shake, 0);
  ({ CB, w } = setup());
  emitInStep(CB, w, [{ type: 'enemyDie', x: 1, y: 1, kind: 'k', r: 6, boss: false }]);
  assert.ok(Math.abs(w.hitstop - 0.04) < 1e-9);
  assert.ok(w.shake > 1);
});

test('impact: stacked boss events never exceed hitstop 0.25 or shake 6, and keep the strongest of each', () => {
  const { CB, w } = setup();
  const evs = [];
  for (let i = 0; i < 10; i++) evs.push({ type: 'bossPhase', x: 1, y: 1, phase: 2 }, { type: 'bossDie', x: 1, y: 1 });
  emitInStep(CB, w, evs);
  assert.ok(w.hitstop <= 0.25 + 1e-9);
  assert.ok(Math.abs(w.hitstop - 0.14) < 1e-9, `hitstop ${w.hitstop}`); // the largest single entry (bossPhase), never a sum
  assert.ok(w.shake <= 6);
  assert.ok(w.shake > 5, `shake ${w.shake}`); // bossDie's 6, less one tick of decay
  assert.ok(w.flash > 0.2, `flash ${w.flash}`); // bossDie's 0.25, less one tick of decay
  assert.equal(w.flashColor, '#FFFFFF');
});

test('impact: god mode never freezes but still shakes and flashes', () => {
  const { CB, w } = setup(true);
  emitInStep(CB, w, [{ type: 'bossPhase', x: 1, y: 1, phase: 2 }]);
  assert.equal(w.hitstop, 0);
  assert.ok(w.shake > 0, `shake ${w.shake}`);
  assert.ok(w.flash > 0.05, `flash ${w.flash}`);
});

test('impact: a weaker flash never recolours a stronger one (bossDie then compact in one step stays white)', () => {
  const { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'bossDie', x: 1, y: 1 }, { type: 'compact', x: 1, y: 1 }]);
  assert.equal(w.flashColor, '#FFFFFF');
  assert.ok(w.flash > 0.2, `flash ${w.flash}`);
});

test('impact: a stronger or equal flash takes over the colour; a weaker one keeps the old colour', () => {
  const { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'compact', x: 1, y: 1 }]); // gold, 0.12
  assert.equal(w.flashColor, '#FFD27A');
  CB.Fx.impact(w, 'bossDie'); // white, 0.25: stronger
  assert.equal(w.flashColor, '#FFFFFF');
  const f = w.flash;
  CB.Fx.impact(w, 'compact'); // gold, 0.12: weaker
  assert.equal(w.flashColor, '#FFFFFF');
  assert.equal(w.flash, f);
  w.flash = 0.12;
  w.flashColor = '#FFFFFF';
  CB.Fx.impact(w, 'compact'); // equal: the newer one wins
  assert.equal(w.flashColor, '#FFD27A');
});

test('impact: with no flash left, any flash sets its colour', () => {
  const { CB, w } = setup();
  w.flash = 0;
  w.flashColor = null;
  CB.Fx.impact(w, 'bossPhase');
  assert.equal(w.flashColor, '#FFFFFF');
  assert.ok(Math.abs(w.flash - 0.1) < 1e-9);
});

test('heartbeat: at 1 heart beats at ~0.3 s then every 0.85 s; "last heart!" fires once', () => {
  const { w } = setup();
  w.player.hearts = 1;
  H.stepN(w, 180, H.makeInput());
  const beats = w.events.filter((e) => e.type === 'heartbeat').length;
  assert.ok(beats >= 3 && beats <= 4, `beats ${beats}`);
  assert.equal(w.events.filter((e) => e.type === 'text' && e.text === 'last heart!').length, 1);
});

test('heartbeat: none at 2 hearts; re-arms after healing', () => {
  const { w } = setup();
  w.player.hearts = 2;
  H.stepN(w, 120, H.makeInput());
  assert.equal(w.events.filter((e) => e.type === 'heartbeat').length, 0);
  w.player.hearts = 1;
  H.stepN(w, 30, H.makeInput());
  w.player.hearts = 2;
  H.stepN(w, 5, H.makeInput());
  w.player.hearts = 1;
  H.stepN(w, 5, H.makeInput());
  assert.equal(w.events.filter((e) => e.type === 'text' && e.text === 'last heart!').length, 2);
});

test('impact: hurt sets a red flash colour', () => {
  const { CB, w } = setup();
  CB.Player.hurt(w.player, w, null);
  assert.equal(w.flashColor, CB.Pal.C.hurt);
});
