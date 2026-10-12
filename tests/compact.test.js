'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/compact.js'];
const RUN_FILES = [...FILES, 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js'];

function addDummy(CB) {
  CB.Enemies.dummy = { create: (w, x, y, op) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 1000, r: 5, contact: false }, op || {})), update() {}, draw() {} };
}
function setup(o) {
  const CB = H.load(FILES);
  addDummy(CB);
  const w = CB.createWorld(Object.assign({ seed: 9 }, o || {}));
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const count = (w, type) => w.events.filter((e) => e.type === type).length;
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
function hit(w, e, n, dmg) {
  for (let i = 0; i < n; i++) w.damageEnemy(e, dmg == null ? 1 : dmg, { dmg: dmg == null ? 1 : dmg });
}

// ---- meter model ------------------------------------------------------------------------------

test('compact: constants and exports match the rev 3 meter model', () => {
  const { CB } = setup();
  const C = CB.Compact;
  assert.deepEqual(
    [C.MAX, C.HIT, C.INCOME_CAP, C.PERFECT, C.WAVE_SPEED, C.WAVE_RMAX, C.DMG_REGULAR, C.DMG_BOSS, C.BANNER_T],
    [45, 1, 7, 3, 520, 360, 3, 5, 1.0]
  );
  for (const fn of ['charge', 'onBoltHit', 'perfect', 'fill', 'cast', 'update', 'draw', 'drawPrompt']) assert.equal(typeof C[fn], 'function', fn);
  for (const gone of ['graze', 'onHurt', 'GRAZE', 'GRAZE_RATE', 'GRAZE_BAND', 'CHAIN_T', 'CHAIN_CAP']) assert.equal(C[gone], undefined, gone);
});

test('compact: world carries the rev 3 fields and none of the removed chain/graze ones', () => {
  const { w } = setup();
  assert.deepEqual(H.plain(w.context), { value: 0, max: 45, announced: false });
  assert.equal(w.incomeTokens, 7);
  assert.equal(w.compactWave, null);
  assert.equal(w.compactBannerT, 0);
  assert.equal(w.compactBuffered, false);
  assert.equal(w.seenCompact, false);
  assert.equal(w.flashColor, null);
  assert.equal(w.glitchT, 0);
  assert.deepEqual(H.plain(w.fxQueue), []);
  assert.equal(w.quipT, 0);
  assert.equal(w.stats.perfects, 0);
  assert.equal(w.stats.compacts, 0);
  for (const gone of ['chain', 'grazeTokens']) assert.equal(w[gone], undefined, gone);
  for (const gone of ['maxChain', 'grazes']) assert.equal(w.stats[gone], undefined, gone);
});

test('compact: every applied bolt hit charges exactly 1, whatever the damage', () => {
  const { CB, w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  let expect = 0;
  for (const dmg of [0.3, 1, 1.15, 1.7, 3, 25]) {
    w.damageEnemy(e, dmg, { dmg });
    expect += 1;
    assert.equal(w.context.value, expect, `after dmg ${dmg}`);
  }
  CB.Compact.onBoltHit(w, 0);
  CB.Compact.onBoltHit(w, -2);
  assert.equal(w.context.value, expect, 'applied <= 0 is worth nothing');
  assert.equal(w.incomeTokens, 7 - expect, 'and does not spend the bucket');
});

test('compact: a hit that applies no damage (invulnerable, onHit returns 0) does not charge', () => {
  const { CB, w } = setup();
  CB.Enemies.shield = { create: (w2, x, y) => CB.makeEnemy('shield', x, y, { hp: 9, contact: false }), update() {}, draw() {}, onHit: () => 0 };
  const s = w.spawnEnemy('shield', 80, 60);
  const e = w.spawnEnemy('dummy', 100, 60);
  e.invuln = 1;
  hit(w, s, 5);
  hit(w, e, 5);
  assert.equal(w.context.value, 0);
});

test('compact: 100 hits in one tick charge at most 7 (the income bucket)', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  hit(w, e, 100);
  assert.ok(w.context.value <= 7 + 1e-9, `${w.context.value}`);
  assert.ok(near(w.context.value, 7, 1e-9), `${w.context.value}`);
  assert.ok(w.incomeTokens >= 0 && w.incomeTokens < 1e-9);
});

test('compact: the income bucket refills at 7 tokens per second and holds at most 7', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  hit(w, e, 100);
  const v0 = w.context.value;
  H.stepN(w, 30, idle); // 0.5 s
  hit(w, e, 100);
  assert.ok(near(w.context.value - v0, 3.5, 1e-6), `refilled ${w.context.value - v0}`);
  const v1 = w.context.value;
  H.stepN(w, 240, idle); // long enough to refill past the cap
  hit(w, e, 100);
  assert.ok(near(w.context.value - v1, 7, 1e-6), `refilled ${w.context.value - v1}`);
});

test('compact: the meter caps at 45 and compactReady fires once', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  for (let s = 0; s < 8; s++) {
    hit(w, e, 100);
    H.stepN(w, 60, idle);
  }
  assert.equal(w.context.value, 45);
  assert.equal(w.context.announced, true);
  assert.equal(count(w, 'compactReady'), 1);
  hit(w, e, 100);
  H.stepN(w, 60, idle);
  hit(w, e, 100);
  assert.equal(w.context.value, 45);
  assert.equal(count(w, 'compactReady'), 1);
  const ev = w.events.find((x) => x.type === 'compactReady');
  assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y));
});

test('compact: damage with no bolt source, or from the wave itself, never charges', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  w.damageEnemy(e, 5);
  w.damageEnemy(e, 5, { compact: true });
  w.damageEnemy(e, 5, { dmg: 5, compact: true });
  assert.equal(w.context.value, 0);
  assert.equal(w.incomeTokens, 7);
});

// ---- perfect dash -----------------------------------------------------------------------------

test('perfect: a dash through a stationary bullet gives exactly +3 once, with the graze event and the text', () => {
  const { w } = setup();
  H.stepN(w, 1, () => H.makeInput({ dash: true, moveX: 1 }));
  const b = w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 2, () => H.makeInput({ moveX: 1 }));
  assert.equal(w.context.value, 3);
  assert.equal(b.grazed, true);
  assert.equal(w.stats.perfects, 1);
  assert.equal(w.player.hearts, 5);
  const g = w.events.filter((e) => e.type === 'graze');
  assert.equal(g.length, 1);
  assert.equal(g[0].perfect, true);
  assert.ok(Number.isFinite(g[0].x) && Number.isFinite(g[0].y));
  const t = w.events.find((e) => e.type === 'text' && e.text === 'perfect');
  assert.ok(t && Number.isFinite(t.x) && Number.isFinite(t.y));
  H.stepN(w, 30, idle);
  assert.equal(w.context.value, 3, 'a spent bullet never pays twice');
});

test('perfect: a bullet riding along with the dash overlaps for many ticks and still pays only once', () => {
  const { w } = setup();
  H.stepN(w, 1, () => H.makeInput({ dash: true, moveX: 1 }));
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 260);
  H.stepN(w, 7, () => H.makeInput({ moveX: 1 }));
  assert.equal(w.context.value, 3);
  assert.equal(w.stats.perfects, 1);
});

test('perfect: the bonus bypasses the income bucket', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  hit(w, e, 100); // bucket empty
  H.stepN(w, 1, () => H.makeInput({ dash: true, moveX: 1 }));
  const before = w.context.value;
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 2, () => H.makeInput({ moveX: 1 }));
  assert.ok(near(w.context.value - before, 3, 1e-9), `${w.context.value - before}`);
});

test('perfect: boss safe-spawn invulnerability (no dash) and hurt invulnerability never give perfects', () => {
  let { w } = setup();
  w.player.invuln = 1; // what startBoss grants
  assert.equal(w.player.dashInvulnT, 0);
  const b = w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 3, idle);
  assert.equal(w.context.value, 0);
  assert.equal(b.grazed, false);
  assert.equal(w.stats.perfects, 0);
  assert.equal(count(w, 'graze'), 0);

  ({ w } = setup());
  assert.equal(w.hurtPlayer(null), true);
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 3, idle);
  assert.equal(w.context.value, 0);
  assert.equal(w.player.hearts, 4, 'only the first hit landed');
  assert.equal(w.stats.perfects, 0);
});

test('perfect: /compact invulnerability never gives a perfect either', () => {
  const { CB, w } = setup();
  w.context.value = 45;
  CB.Compact.cast(w);
  assert.ok(w.player.invuln > 0.45);
  assert.ok(w.player.dashInvulnT <= 1e-9);
  w.compactWave = null; // the wave would sweep the bullet away; this test is about the invulnerability alone
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 3, idle);
  assert.equal(w.context.value, 0);
  assert.equal(w.stats.perfects, 0);
});

test('perfect: an unprotected overlap still hurts and gives nothing', () => {
  const { w } = setup();
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 1, idle);
  assert.equal(w.player.hearts, 4);
  assert.equal(w.context.value, 0);
});

test('player: a dash sets dashInvulnT to DASH_INVULN and it counts down with the other timers', () => {
  const { CB, w } = setup();
  assert.equal(w.player.dashInvulnT, 0);
  H.stepN(w, 1, () => H.makeInput({ dash: true, moveX: 1 }));
  assert.ok(near(w.player.dashInvulnT, CB.Player.DASH_INVULN, 1e-9));
  H.stepN(w, 5, idle);
  assert.ok(w.player.dashInvulnT > 0.1 && w.player.dashInvulnT < CB.Player.DASH_INVULN);
  H.stepN(w, 12, idle);
  assert.ok(w.player.dashInvulnT <= 1e-9);
});

// ---- cast, buffered E, fill -------------------------------------------------------------------

test('compact: refused below full; at full it empties the meter, gives 0.5 s invuln and emits compact', () => {
  const { w } = setup();
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(count(w, 'compact'), 0);
  w.context.value = 45;
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(count(w, 'compact'), 1);
  assert.equal(w.context.value, 0);
  assert.equal(w.context.announced, false);
  assert.ok(w.player.invuln > 0.45);
  assert.equal(w.stats.compacts, 1);
  assert.ok(w.compactWave || w.compactBannerT > 0);
});

test('compact: an E press on a frozen hitstop tick casts on the first live tick, exactly once', () => {
  const { w } = setup();
  w.context.value = 45;
  w.hitstop = 0.1;
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(w.compactBuffered, true);
  assert.equal(count(w, 'compact'), 0, 'still frozen');
  assert.equal(w.context.value, 45);
  H.stepN(w, 12, idle); // the rest of the freeze, then live ticks
  assert.equal(count(w, 'compact'), 1);
  assert.equal(w.context.value, 0);
  assert.equal(w.compactBuffered, false);
  H.stepN(w, 20, idle);
  assert.equal(count(w, 'compact'), 1);
});

test('compact: the buffered E is spent on the first live tick even when the cast is refused', () => {
  const { w } = setup();
  w.hitstop = 0.05;
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(w.compactBuffered, true);
  H.stepN(w, 6, idle); // live ticks with the meter empty: refused
  assert.equal(w.compactBuffered, false);
  w.context.value = 45;
  H.stepN(w, 3, idle);
  assert.equal(count(w, 'compact'), 0, 'no stale press fires later');
});

test('compact: a live press and a buffered press on the same tick cast once', () => {
  const { w } = setup();
  w.context.value = 45;
  w.hitstop = 0.02;
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  H.stepN(w, 5, idle);
  assert.equal(count(w, 'compact'), 1);
});

test('compact: cast marks the first cast as seen and saves it when a save module exists', () => {
  const CB = H.load(FILES);
  addDummy(CB);
  const saved = {};
  CB.Save = { get: (k, d) => (k in saved ? saved[k] : d), set: (k, v) => { saved[k] = v; } };
  const w = CB.createWorld({ seed: 9 });
  assert.equal(w.seenCompact, false);
  w.context.value = 45;
  assert.equal(CB.Compact.cast(w), true);
  assert.equal(w.seenCompact, true);
  assert.equal(saved.seenCompact, true);
  const w2 = CB.createWorld({ seed: 9 });
  assert.equal(w2.seenCompact, true, 'later worlds read it back from the save');
});

test('compact: cast works without a save module and a partial one', () => {
  const { CB, w } = setup();
  w.context.value = 45;
  assert.equal(CB.Compact.cast(w), true);
  assert.equal(w.seenCompact, true);
  const { CB: CB2, w: w2 } = setup();
  CB2.Save = {};
  w2.context.value = 45;
  assert.equal(CB2.Compact.cast(w2), true);
});

test('compact: fill sets the meter full, marks it announced and emits compactReady with a position', () => {
  const { CB, w } = setup();
  CB.Compact.fill(w);
  assert.equal(w.context.value, 45);
  assert.equal(w.context.announced, true);
  const ev = w.events.filter((e) => e.type === 'compactReady');
  assert.equal(ev.length, 1);
  assert.ok(Number.isFinite(ev[0].x) && Number.isFinite(ev[0].y));
  assert.equal(CB.Compact.cast(w), true);
});

function runSetup(opts) {
  const CB = H.load(RUN_FILES);
  addDummy(CB);
  CB.Bosses.dummyBoss = {
    id: 'dummyBoss', name: 'DUMMY', tagline: 'noop()', commitMsg: 'fix: dummy',
    create() {
      const c = { id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} };
      return c;
    },
  };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: `~/s${i}/`, palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]] }));
  return { CB, run: CB.createRun(Object.assign({ seed: 1 }, opts || {})) };
}
function until(run, pred, maxTicks) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred(run)) return true;
    run.step(idle());
  }
  return pred(run);
}

test('compact: startBoss fills the meter (skipWaves run with a stub boss: full in state boss, announced)', () => {
  const { run } = runSetup({ skipWaves: true });
  const evs = [];
  for (let i = 0; i < 400 && run.state !== 'boss'; i++) evs.push(...run.step(idle()));
  assert.equal(run.state, 'boss');
  assert.ok(run.world.boss);
  assert.equal(run.world.context.value, 45);
  assert.equal(run.world.context.announced, true);
  evs.push(...run.step(idle()));
  assert.equal(evs.filter((e) => e.type === 'compactReady').length, 1, 'reported to the audio handler once');
});

test('compact: boss rush and boss-checkpoint retries start every fight with a full meter and one cast', () => {
  const { CB, run } = runSetup({ bossRush: true });
  assert.ok(until(run, (r) => r.state === 'boss', 400));
  assert.equal(run.world.context.value, 45);
  assert.equal(CB.Compact.cast(run.world), true);
  assert.equal(run.world.context.value, 0);
  // die in the boss fight, retry from the boss checkpoint
  const p = run.world.player;
  p.invuln = 0;
  p.hearts = 1;
  assert.equal(run.world.hurtPlayer(null), true);
  run.step(idle());
  assert.equal(run.state, 'dying');
  assert.ok(until(run, (r) => r.state === 'dead', 200));
  assert.ok(until(run, (r) => r.stateT >= 0.6, 60));
  assert.equal(run.retryStage(), true);
  assert.equal(run.state, 'bossWarn');
  assert.equal(run.world.context.value, 0, 'the new world starts empty during the warning');
  assert.ok(until(run, (r) => r.state === 'boss', 400));
  assert.equal(run.world.context.value, 45);
});

test('compact: a normal run does not start with a full meter before the boss', () => {
  const { run } = runSetup();
  assert.ok(until(run, (r) => r.state === 'wave', 200));
  assert.equal(run.world.context.value, 0);
});

// ---- the wave ---------------------------------------------------------------------------------

test('compact: the wave hits each enemy once, 3 to regulars and 5 to boss parts, skipping untouchables, and never charges', () => {
  const { w } = setup();
  const reg = w.spawnEnemy('dummy', 100, 100, { hp: 10 });
  const boss = w.spawnEnemy('dummy', 220, 60, { hp: 10, boss: true, regular: false });
  const untarg = w.spawnEnemy('dummy', 60, 60, { hp: 10, targetable: false });
  const hidden = w.spawnEnemy('dummy', 260, 140, { hp: 10, visible: false });
  const solid = w.spawnEnemy('dummy', 40, 150, { hp: 10, targetable: false, solid: true });
  w.context.value = 45;
  H.stepN(w, 60, (i) => H.makeInput({ compact: i === 0 }));
  assert.equal(reg.hp, 7);
  assert.equal(boss.hp, 5);
  assert.equal(untarg.hp, 10);
  assert.equal(hidden.hp, 10);
  assert.equal(solid.hp, 10);
  assert.equal(w.compactWave, null);
  assert.equal(w.context.value, 0, 'the wave damage does not feed the meter');
});

test('compact: deletes enemy bullets and puddles inside the radius and leaves player bolts', () => {
  const { w } = setup();
  const p = w.player;
  for (let i = 0; i < 20; i++) w.fireEnemyBullet(p.x + Math.cos(i) * 50, p.y + Math.sin(i) * 30, 0, 0);
  w.addHazard({ x: p.x - 80, y: p.y - 20 });
  const bolt = w.firePlayerBolt(p.x, 40, 0);
  bolt.vx = 0;
  bolt.vy = 0;
  w.context.value = 45;
  H.stepN(w, 40, (i) => H.makeInput({ compact: i === 0 }));
  assert.equal(w.eBullets.length, 0);
  assert.equal(w.hazards.length, 0);
  assert.ok(w.pBullets.length >= 1);
});

test('compact: cannot cast while dead, with a wave out, or after a boss defeat', () => {
  const { CB, w } = setup();
  w.context.value = 45;
  w.boss = { defeated: true, update() {}, draw() {} };
  assert.equal(CB.Compact.cast(w), false);
  w.boss = null;
  w.player.dead = true;
  assert.equal(CB.Compact.cast(w), false);
  w.player.dead = false;
  assert.equal(CB.Compact.cast(w), true);
  w.context.value = 45;
  assert.equal(CB.Compact.cast(w), false, 'a wave is already out');
});

// ---- keycap prompt ----------------------------------------------------------------------------

function fakeR() {
  const calls = [];
  const r = {
    calls,
    sprite: (name, x, y, o) => calls.push({ kind: 'sprite', name, x, y, o }),
    text: (str, x, y, o) => calls.push({ kind: 'text', str, x, y, o }),
    rect: (x, y, w, h, color) => calls.push({ kind: 'rect', x, y, w, h, color }),
    alpha: (a, fn) => fn(),
  };
  return r;
}

test('keycap_e: a 9x9 sprite with an ink outline, offwhite keycap and a dark E', () => {
  const { CB } = setup();
  const d = CB.Art.spriteDef('keycap_e');
  assert.ok(d, 'defined at load time');
  assert.equal(d.w, 9);
  assert.equal(d.h, 9);
  const rows = d.rows;
  for (let x = 0; x < 9; x++) {
    for (const y of [0, 8]) assert.ok(rows[y][x] === 'k' || rows[y][x] === '.', `top/bottom edge ${x},${y}`);
  }
  for (let y = 1; y < 8; y++) assert.ok(rows[y][0] === 'k' && rows[y][8] === 'k', `side edge row ${y}`);
  const chars = new Set(rows.join('').split(''));
  assert.ok(chars.has('W') && chars.has('d'), 'offwhite fill and a dark glyph');
  const shades = ['w', 'W', 'e'].filter((c) => chars.has(c));
  assert.ok(shades.length >= 2, 'at least two shades of the key colour');
  // the dark glyph is an E: left stem, three bars
  const glyph = rows.map((row) => row.split('').map((c) => (c === 'd' ? '#' : '.')).join('')).filter((s) => s.includes('#'));
  assert.equal(glyph.length, 5);
  assert.ok(glyph[0].split('#').length - 1 >= 4 && glyph[2].split('#').length - 1 >= 3 && glyph[4].split('#').length - 1 >= 4);
});

test('drawPrompt: nothing is drawn below a full meter, when dead, during the wave or after the boss falls', () => {
  const { CB, w } = setup();
  let r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.length, 0, 'meter not full');

  w.context.value = 45;
  w.player.dead = true;
  r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.length, 0, 'dead');
  w.player.dead = false;

  w.compactWave = { x: 1, y: 1, r: 4, hits: [] };
  r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.length, 0, 'wave out');
  w.compactWave = null;

  w.boss = { defeated: true, update() {}, draw() {} };
  r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.length, 0, 'boss defeated');

  w.boss = { defeated: false, update() {}, draw() {} };
  r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.filter((c) => c.kind === 'sprite').length, 1, 'a live boss does not hide it');
});

test('drawPrompt: a full meter draws the keycap above Clawd and bobs by one pixel', () => {
  const { CB, w } = setup();
  w.context.value = 45;
  const p = w.player;
  let r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  const keys = r.calls.filter((c) => c.kind === 'sprite');
  assert.equal(keys.length, 1);
  assert.equal(keys[0].name, 'keycap_e');
  assert.equal(keys[0].x, p.x);
  assert.equal(keys[0].y, p.y - 17);
  r = fakeR();
  CB.Compact.drawPrompt(w, r, Math.PI / 8); // sin(4t) = 1
  assert.equal(r.calls.find((c) => c.kind === 'sprite').y, p.y - 16);
  r = fakeR();
  CB.Compact.drawPrompt(w, r, (3 * Math.PI) / 8); // sin(4t) = -1
  assert.equal(r.calls.find((c) => c.kind === 'sprite').y, p.y - 18);
});

test('drawPrompt: "/compact" in gold sits to the right until the first cast ever, then goes away', () => {
  const { CB, w } = setup();
  w.context.value = 45;
  const p = w.player;
  let r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  const label = r.calls.find((c) => c.kind === 'text');
  assert.ok(label, 'first-time hint');
  assert.equal(label.str, '/compact');
  assert.equal(label.o.color, CB.Pal.C.gold);
  assert.ok(label.x > p.x + 4, 'to the right of the keycap');
  w.seenCompact = true;
  r = fakeR();
  CB.Compact.drawPrompt(w, r, 0);
  assert.equal(r.calls.filter((c) => c.kind === 'text').length, 0);
  assert.equal(r.calls.filter((c) => c.kind === 'sprite').length, 1, 'the keycap stays');
});

test('drawPrompt: runs against the real renderer headless in every condition', () => {
  const { CB, sandbox } = H.load([...FILES, 'src/art/render.js'], { returnSandbox: true });
  CB.Font = { CELL_H: 7, measure: (s, sc) => s.length * 6 * (sc || 1), draw() {} };
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, { innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 });
  r.resize();
  const w = CB.createWorld({ seed: 9 });
  CB.Compact.drawPrompt(w, r, 0.3); // empty
  w.context.value = 45;
  CB.Compact.drawPrompt(w, r, 0.3); // full, first time
  w.seenCompact = true;
  CB.Compact.drawPrompt(w, r, 0.7); // full, seen
  w.compactWave = { x: 1, y: 1, r: 4, hits: [] };
  CB.Compact.drawPrompt(w, r, 0.7); // wave out
  w.compactWave = null;
  w.player.dead = true;
  CB.Compact.drawPrompt(w, r, 0.7); // dead
  w.player.dead = false;
  w.boss = { defeated: true };
  CB.Compact.drawPrompt(w, r, 0.7); // boss down
  w.boss = null;
  CB.Compact.draw(w, r); // no wave: no-op
  w.compactWave = { x: 100, y: 90, r: 60, hits: [] };
  CB.Compact.draw(w, r);
});
