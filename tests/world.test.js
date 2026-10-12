'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(props) {
  const CB = H.loadWith();
  CB.Enemies.dummy = {
    create: (w, x, y, o) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 3, r: 5 }, props || {}, o || {})),
    update() {},
    draw() {},
  };
  const w = CB.createWorld({ seed: 1 });
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const types = (w) => w.events.map((e) => e.type);

test('world: player starts below arena centre with full hearts', () => {
  const { w } = setup();
  assert.equal(w.player.x, 160);
  assert.equal(w.player.y, 126);
  assert.equal(w.player.hearts, 5);
});

test('world: makeEnemy defaults and maxHp', () => {
  const { CB } = setup();
  const e = CB.makeEnemy('k', 1, 2, { hp: 7 });
  assert.equal(e.maxHp, 7);
  assert.equal(e.targetable, true);
  assert.equal(e.solid, false);
  assert.equal(e.contact, true);
  assert.equal(e.visible, true);
  assert.equal(e.regular, true);
  assert.equal(e.boss, false);
  assert.equal(CB.makeEnemy('k', 0, 0, { hp: 7, maxHp: 10 }).maxHp, 10);
});

test('world: queueSpawn telegraphs 0.6 s before the enemy exists', () => {
  const { w } = setup();
  w.queueSpawn('dummy', 60, 60);
  H.stepN(w, 30, idle);
  assert.equal(w.enemies.length, 0);
  H.stepN(w, 10, idle);
  assert.equal(w.enemies.length, 1);
  assert.ok(types(w).includes('spawn'));
  assert.equal(w.spawns.length, 0);
});

test('world: a bolt damages a targetable enemy and dies', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 180, 60);
  const b = w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 15, idle);
  assert.equal(e.hp, 2);
  assert.equal(b.dead, true);
  assert.ok(types(w).includes('hit'));
});

test('world: pierce passes through exactly pierce enemies', () => {
  const { w } = setup();
  w.player.stats.pierce = 1;
  const a = w.spawnEnemy('dummy', 180, 60);
  const b = w.spawnEnemy('dummy', 200, 60);
  const c = w.spawnEnemy('dummy', 220, 60);
  w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 40, idle);
  assert.equal(a.hp, 2);
  assert.equal(b.hp, 2);
  assert.equal(c.hp, 3);
});

test('world: solid non-targetable enemies absorb bolts with a clink', () => {
  const { w } = setup({ targetable: false, solid: true });
  const e = w.spawnEnemy('dummy', 180, 60);
  const b = w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 15, idle);
  assert.equal(e.hp, 3);
  assert.equal(b.dead, true);
  assert.ok(types(w).includes('clink'));
});

test('world: killing an enemy emits enemyDie and removes it', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  w.damageEnemy(e, 5);
  H.stepN(w, 1, idle);
  assert.equal(e.dead, true);
  assert.equal(w.enemies.length, 0);
  assert.ok(types(w).includes('enemyDie'));
});

test('world: caps hold for enemy bullets and enemies', () => {
  const { CB, w } = setup();
  for (let i = 0; i < 500; i++) w.fireEnemyBullet(30, 30, Math.PI, 10);
  assert.equal(w.eBullets.length, CB.CAPS.eBullets);
  for (let i = 0; i < 80; i++) w.spawnEnemy('dummy', 30, 30);
  assert.equal(w.enemies.length, CB.CAPS.enemies);
});

test('world: an enemy bullet costs one heart and is consumed; a second one in the same tick passes', () => {
  const { w } = setup();
  const p = w.player;
  const b1 = w.fireEnemyBullet(p.x, p.y, 0, 0);
  const b2 = w.fireEnemyBullet(p.x, p.y, 0, 0);
  H.stepN(w, 1, idle);
  assert.equal(p.hearts, 4);
  assert.equal(b1.dead, true);
  assert.equal(b2.dead, false);
});

test('world: contact with an enemy hurts the player', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', w.player.x + 3, w.player.y);
  e.noContactT = 0;
  H.stepN(w, 1, idle);
  assert.equal(w.player.hearts, 4);
});

test('world: a freshly spawned regular enemy cannot hurt for 0.3 s, then can', () => {
  const { CB, w } = setup();
  const p = w.player;
  const e = w.spawnEnemy('dummy', p.x, p.y);
  assert.equal(e.noContactT, CB.SPAWN_GRACE);
  assert.equal(CB.SPAWN_GRACE, 0.3);
  let hurtTick = 0;
  for (let i = 1; i <= 40 && !hurtTick; i++) {
    H.stepN(w, 1, idle);
    if (p.hearts < 5) hurtTick = i;
    if (i === 15) assert.equal(p.hearts, 5, 'still protected at 0.25 s');
  }
  assert.ok(hurtTick >= 18 && hurtTick <= 19, `first hurt on tick ${hurtTick}`);
  assert.equal(p.hearts, 4);
});

test('world: a boss part and a pre-set grace are not given the regular spawn grace', () => {
  const { CB, w } = setup({ boss: true, regular: false });
  const part = w.spawnEnemy('dummy', 60, 60);
  assert.equal(part.noContactT, 0);
  CB.Enemies.graced = { create: (ww, x, y) => CB.makeEnemy('graced', x, y, { hp: 1, noContactT: 0.5 }), update() {}, draw() {} };
  assert.equal(w.spawnEnemy('graced', 80, 60).noContactT, 0.5, 'a longer grace is kept');
  assert.equal(CB.makeEnemy('k', 0, 0).noContactT, 0);
});

test('world: overlapping regular enemies are pushed apart', () => {
  const { w } = setup();
  const a = w.spawnEnemy('dummy', 100, 60, { r: 4 });
  const b = w.spawnEnemy('dummy', 100, 60, { r: 6 });
  H.stepN(w, 60, idle);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(d >= 0.8 * (4 + 6) - 0.5, `separated to ${d}`);
  assert.ok(d < 0.8 * (4 + 6) + 1, 'a gentle push, not a launch');
  for (const e of [a, b]) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
});

test('world: separation pushes at most 30 px/s per enemy (a nudge, not a teleport)', () => {
  const { w } = setup();
  const a = w.spawnEnemy('dummy', 100, 60, { r: 5 });
  const b = w.spawnEnemy('dummy', 100, 60, { r: 5 });
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(Math.abs(a.x - 100) - 0.5) < 1e-9, `a moved ${a.x - 100}`);
  assert.ok(Math.abs(Math.abs(b.x - 100) - 0.5) < 1e-9, `b moved ${b.x - 100}`);
  assert.ok(a.x < b.x, 'deterministic: the first of a coincident pair goes -x, the second +x');
  assert.equal(a.y, 60);
  assert.equal(b.y, 60);
  H.stepN(w, 5, idle);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.8 * 10, 'still easing apart after 6 ticks');
});

test('world: separation ignores bosses, hidden and dead enemies and keeps everyone in the arena', () => {
  const { CB, w } = setup();
  const boss = w.spawnEnemy('dummy', 100, 60, { boss: true, regular: false });
  const hidden = w.spawnEnemy('dummy', 100, 60, { visible: false });
  const live = w.spawnEnemy('dummy', 100, 60);
  H.stepN(w, 30, idle);
  assert.equal(boss.x, 100);
  assert.equal(hidden.x, 100);
  assert.equal(live.x, 100, 'a lone regular enemy is not pushed by non-regular ones');
  // pile at the left wall: nobody leaves the arena
  const pile = [];
  for (let i = 0; i < 6; i++) pile.push(w.spawnEnemy('dummy', 13, 90));
  H.stepN(w, 120, idle);
  for (const e of pile) {
    assert.ok(e.x >= CB.ARENA.x + e.r - 1e-9 && e.y >= CB.ARENA.y + e.r - 1e-9 && e.y <= CB.ARENA.y + CB.ARENA.h - e.r + 1e-9);
  }
  for (let i = 0; i < pile.length; i++) {
    for (let j = i + 1; j < pile.length; j++) assert.ok(Math.hypot(pile[i].x - pile[j].x, pile[i].y - pile[j].y) > 1, 'no two share a point');
  }
});

test('world: a defeated boss controller is never updated again', () => {
  const { w } = setup();
  const boss = { defeated: false, calls: 0, update() { this.calls++; }, draw() {} };
  w.boss = boss;
  H.stepN(w, 3, idle);
  assert.equal(boss.calls, 3);
  boss.defeated = true;
  H.stepN(w, 30, idle);
  assert.equal(boss.calls, 3);
});

test('world: hurtPlayer routes through Player.hurt', () => {
  const { w } = setup();
  assert.equal(w.hurtPlayer(null), true);
  assert.equal(w.player.hearts, 4);
  assert.equal(w.hurtPlayer(null), false, 'hurt invulnerability applies');
});

test('world: a bolt fired at an enemy hugging Clawd still hits it (no point-blank dead zone)', () => {
  for (const r of [4, 5]) {
    for (const off of [0, 2, 4, 6]) {
      const { w } = setup({ r, hp: 10 });
      const p = w.player;
      const e = w.spawnEnemy('dummy', p.x + off, p.y);
      H.stepN(w, 3, () => H.makeInput({ aimX: 300, aimY: p.y, fire: true }));
      assert.ok(e.hp < 10, `r ${r} at ${off} px was not hit (hp ${e.hp})`);
    }
  }
});

test('world: a new player bolt does not move on its spawn tick', () => {
  const { w } = setup();
  const b = w.firePlayerBolt(100, 60, 0);
  H.stepN(w, 1, idle);
  assert.equal(b.x, 100);
  assert.ok(Math.abs(b.life - (1.5 - 1 / 60)) < 1e-9, 'life still decrements');
  H.stepN(w, 1, idle);
  assert.ok(b.x > 103);
});

test('world: puddle hazard halves player speed while inside', () => {
  const { w } = setup();
  const p = w.player;
  w.addHazard({ x: p.x, y: p.y, r: 12 });
  H.stepN(w, 1, idle);
  assert.equal(p.slow, 0.5);
  const x0 = p.x;
  H.stepN(w, 10, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  const moved = p.x - x0;
  assert.ok(moved > 6 && moved < 7.5, `moved ${moved}`);
});

test('world: ricochet bolt bounces once off the wall', () => {
  const { w } = setup();
  w.player.stats.bounces = 1;
  const b = w.firePlayerBolt(300, 60, 0);
  H.stepN(w, 18, idle);
  assert.ok(b.vx < 0, 'reversed');
  assert.ok(b.x < 312);
  assert.equal(b.bounces, 0);
  assert.ok(b.life <= 0.6);
  assert.ok(types(w).includes('bounce'));
});

test('world: hitstop freezes simulation time', () => {
  const { w } = setup();
  w.hitstop = 0.1;
  H.stepN(w, 3, idle);
  assert.equal(w.time, 0);
  H.stepN(w, 10, idle);
  assert.ok(w.time > 0);
});

test('world: aiming exactly at the player never produces NaN', () => {
  const { w } = setup();
  const p = w.player;
  H.stepN(w, 20, () => H.makeInput({ aimX: p.x, aimY: p.y, fire: true }));
  for (const b of w.pBullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.vx));
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test('fx: a silent enemy death is only a small 4-spark burst (no ring, no text)', () => {
  const { CB, w } = setup();
  w.emit('enemyDie', { x: 100, y: 60, kind: 'syntaxError', r: 5, boss: false, silent: true });
  CB.Fx.consume(w, 0);
  assert.equal(w.fx.length, 4);
  assert.ok(w.fx.every((f) => f.kind === 'p'));
  const loud = CB.createWorld({ seed: 1 });
  loud.emit('enemyDie', { x: 100, y: 60, kind: 'syntaxError', r: 5, boss: false, silent: false });
  CB.Fx.consume(loud, 0);
  assert.ok(loud.fx.some((f) => f.kind === 'ring'), 'a real kill still gets its ring');
  assert.ok(loud.fx.length > 4);
});

test('fx: killAllEnemies during a step is silent (a boss defeat does not flood the screen)', () => {
  const { w } = setup();
  for (let i = 0; i < 5; i++) w.spawnEnemy('dummy', 60 + i * 30, 60);
  // Fx only sees events emitted inside step, so the clear is triggered from a boss update.
  w.boss = { defeated: false, update(ww) { ww.killAllEnemies(); this.defeated = true; }, draw() {} };
  H.stepN(w, 1, idle);
  assert.equal(w.fx.length, 5 * 4);
  assert.ok(w.fx.every((f) => f.kind === 'p'));
});

// Only events emitted *during* step become particles (consume reads from the step's start index),
// so the flood is emitted from inside an enemy update.
test('world: fx particles respect the cap', () => {
  const CB = H.loadWith();
  CB.Enemies.boomer = {
    create: (w, x, y) => CB.makeEnemy('boomer', x, y, { hp: 1, contact: false }),
    update(e, w) {
      if (e.t <= 1 / 60 + 1e-9) for (let i = 0; i < 300; i++) w.emit('enemyDie', { x: 100, y: 100, kind: 'boomer', r: 8, boss: true });
    },
    draw() {},
  };
  const w = CB.createWorld({ seed: 1 });
  w.spawnEnemy('boomer', 30, 30);
  H.stepN(w, 2, idle);
  assert.ok(w.fx.length > 0);
  assert.ok(w.fx.length <= CB.CAPS.fx);
});
