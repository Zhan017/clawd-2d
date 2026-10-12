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

// ---- rev 3 (A3-2): player bolt lifetime and walls --------------------------------------------------------------------------

test('projectiles: a bolt expires after 1.5 s in open space (alive at tick 89, dead by tick 92)', () => {
  const { w } = setup();
  w.player.stats.boltSpeed = 20; // 30 px in 1.5 s: it can never reach a wall
  const b = w.firePlayerBolt(160, 90, 0);
  H.stepN(w, 89, idle);
  assert.equal(b.dead, false, 'still alive at tick 89');
  assert.ok(w.pBullets.includes(b));
  H.stepN(w, 3, idle);
  assert.equal(b.dead, true, 'dead by tick 92');
  assert.equal(w.pBullets.includes(b), false, 'and removed');
  assert.deepEqual(types(w).filter((t) => t === 'bounce'), []);
});

test('projectiles: a plain bolt dies at the wall without bouncing', () => {
  const { w } = setup();
  const b = w.firePlayerBolt(300, 90, 0);
  assert.equal(b.bounces, 0);
  H.stepN(w, 3, idle);
  assert.equal(b.dead, false, 'still inside the arena a few ticks in');
  H.stepN(w, 5, idle);
  assert.equal(b.dead, true, 'gone once past x = 312');
  assert.equal(w.pBullets.length, 0);
  assert.ok(b.vx > 0, 'never reversed');
  assert.equal(types(w).includes('bounce'), false);
  const up = w.firePlayerBolt(160, 24, -Math.PI / 2);
  H.stepN(w, 3, idle);
  assert.equal(up.dead, true, 'the top wall too');
});

test('projectiles: a ricochet bolt survives exactly one bounce and dies at the next wall', () => {
  const { w } = setup();
  w.player.stats.bounces = 1;
  w.player.stats.boltSpeed = 600; // long enough after the bounce to cross the whole arena to the far wall
  const b = w.firePlayerBolt(300, 90, 0);
  assert.equal(b.bounces, 1);
  H.stepN(w, 3, idle);
  assert.equal(b.dead, false, 'alive after the first wall');
  assert.ok(b.vx < 0, 'it came back');
  assert.equal(b.bounces, 0);
  assert.equal(types(w).filter((t) => t === 'bounce').length, 1);
  assert.ok(b.life <= 0.6 + 1e-9, 'lifetime refreshed to 0.6 s');
  H.stepN(w, 40, idle);
  assert.equal(b.dead, true, 'the second wall ends it');
  assert.equal(types(w).filter((t) => t === 'bounce').length, 1, 'exactly one bounce ever');
  assert.equal(w.pBullets.length, 0);
});

// ---- rev 3 (A3-3): bullet readability (layers, bolt fade, enemy core pulse) ------------------------------------------------

function drawEnv(withComfort) {
  const CB = H.loadWith(...(withComfort ? ['src/game/unlocks.js', 'src/game/comfort.js'] : []));
  const calls = [];
  let alpha = 1;
  const r = {
    sprite: (name, x, y) => calls.push({ k: 'sprite', name, x, y, a: alpha }),
    disc: (x, y, rad, c) => calls.push({ k: 'disc', x, y, rad, c, a: alpha }),
    rect: (x, y, w, h, c) => calls.push({ k: 'rect', x, y, w, h, c, a: alpha }),
    alpha: (a, fn) => {
      const prev = alpha;
      alpha = prev * a;
      try {
        fn();
      } finally {
        alpha = prev;
      }
    },
  };
  return { CB, r, calls };
}
const bolts = (n) => Array.from({ length: n }, (_, i) => ({ x: 20 + i, y: 40, r: 2, t: 0.1 }));
const shots = (n) => Array.from({ length: n }, (_, i) => ({ x: 30 + i * 6, y: 90, r: 2, t: 0 }));

test('projectiles: draw(w, r, t, layer) paints the player bolts, the enemy bullets, or both (player first)', () => {
  const { CB, r, calls } = drawEnv(false);
  const w = { pBullets: bolts(2), eBullets: shots(2) };
  CB.Projectiles.draw(w, r, 0, 'player');
  assert.deepEqual(calls.map((c) => c.name), ['bolt', 'bolt']);
  calls.length = 0;
  CB.Projectiles.draw(w, r, 0, 'enemy');
  assert.deepEqual(calls.map((c) => c.name), ['ebullet', 'ebullet']);
  calls.length = 0;
  CB.Projectiles.draw(w, r, 0);
  assert.deepEqual(calls.map((c) => c.name), ['bolt', 'bolt', 'ebullet', 'ebullet']);
  calls.length = 0;
  CB.Projectiles.draw(w, r, 0, undefined);
  assert.equal(calls.length, 4);
  calls.length = 0;
  CB.Projectiles.draw(w, r); // the old two-argument call still works
  assert.equal(calls.length, 4);
});

test('projectiles: up to 14 bolts are drawn at full alpha; beyond that they fade by 0.03 each, down to 0.55', () => {
  const { CB, r, calls } = drawEnv(false);
  const alphaFor = (n) => {
    calls.length = 0;
    CB.Projectiles.draw({ pBullets: bolts(n), eBullets: [] }, r, 0, 'player');
    assert.equal(calls.length, n);
    return calls[0].a;
  };
  assert.equal(alphaFor(1), 1);
  assert.equal(alphaFor(14), 1);
  assert.ok(Math.abs(alphaFor(15) - 0.97) < 1e-9);
  assert.ok(Math.abs(alphaFor(20) - 0.82) < 1e-9);
  assert.ok(Math.abs(alphaFor(30) - 0.55) < 1e-9, 'floor at 0.55 (1 - 16 * 0.03 would be 0.52)');
  assert.equal(alphaFor(100), 0.55);
  assert.ok(calls.every((c) => c.a === calls[0].a), 'every bolt at the same alpha');
});

test('projectiles: the bolt fade also covers rainbow bolts, and never touches enemy bullets', () => {
  const { CB, r, calls } = drawEnv(true);
  CB.Unlocks.unlock('rainbow');
  CB.Projectiles.draw({ pBullets: bolts(24), eBullets: shots(3) }, r, 0);
  const discs = calls.filter((c) => c.k === 'disc');
  assert.equal(discs.length, 24);
  assert.ok(discs.every((c) => Math.abs(c.a - 0.7) < 1e-9), 'rainbow bolts fade too');
  const enemy = calls.filter((c) => c.k === 'sprite');
  assert.equal(enemy.length, 3);
  assert.ok(enemy.every((c) => c.a === 1), 'enemy bullets are never dimmed');
});

test('projectiles: a full-alpha draw makes no r.alpha call (and a renderer without one still works)', () => {
  const { CB, calls } = drawEnv(false);
  const r = { sprite: (name) => calls.push(name), disc() {}, rect() {} };
  assert.doesNotThrow(() => CB.Projectiles.draw({ pBullets: bolts(14), eBullets: shots(3) }, r, 1.3));
  assert.equal(calls.length, 17);
});

test('projectiles: the enemy bullet sprites are a 5 x 5 pair, the bright one ink-outlined with two shades', () => {
  const { CB } = drawEnv(false);
  const hot = CB.Art.spriteDef('ebullet_hot');
  const base = CB.Art.spriteDef('ebullet');
  assert.ok(hot && base);
  assert.deepEqual([hot.w, hot.h], [5, 5]);
  assert.deepEqual([base.w, base.h], [5, 5]);
  assert.equal(hot.rows[0], '..k..');
  assert.equal(hot.rows[4], '..k..');
  assert.equal(hot.rows[2][0], 'k');
  assert.equal(hot.rows[2][4], 'k');
  const chars = new Set(hot.rows.join('').replace(/[.k]/g, ''));
  assert.ok(chars.size >= 2, `at least two fill shades, got ${[...chars]}`);
});

// The sprite name each of n bullets is drawn with at time t.
function pulseNames(CB, r, calls, n, t) {
  calls.length = 0;
  CB.Projectiles.draw({ pBullets: [], eBullets: shots(n) }, r, t, 'enemy');
  return calls.map((c) => c.name);
}

test('projectiles: enemy bullet cores pulse every 0.1 s, each bullet on its own phase', () => {
  const { CB, r, calls } = drawEnv(true);
  const names = (t) => pulseNames(CB, r, calls, 8, t);
  const seen = new Set();
  for (let i = 0; i < 40; i++) for (const n of names(i * 0.01)) seen.add(n);
  assert.deepEqual([...seen].sort(), ['ebullet', 'ebullet_hot'], 'both frames show up');
  // one bullet flips on 0.1 s boundaries and repeats every 0.2 s
  const first = (t) => names(t)[0];
  assert.equal(first(0.01), first(0.09), 'steady inside a 0.1 s window');
  assert.notEqual(first(0.01), first(0.11), 'flips after 0.1 s');
  assert.equal(first(0.01), first(0.21), 'back after 0.2 s');
  assert.equal(first(0.25), first(0.45));
  // the bullets are not all in step at every moment
  let mixed = 0;
  for (let i = 0; i < 40; i++) if (new Set(names(i * 0.01)).size === 2) mixed++;
  assert.ok(mixed >= 20, `bullets are out of phase with each other (${mixed} of 40 moments mixed)`);
  // but no bullet is dark for long: at any moment a fair share is bright
  for (let i = 0; i < 40; i++) {
    const hot = names(i * 0.01).filter((n) => n === 'ebullet_hot').length;
    assert.ok(hot >= 1 && hot <= 7, `moment ${i}: ${hot} of 8 bright`);
  }
});

test('projectiles: enemy bullets are static when calm, without Comfort, or with a Comfort that cannot blink', () => {
  const calm = drawEnv(true);
  calm.CB.Comfort.set(true);
  for (let i = 0; i < 30; i++) {
    const n = pulseNames(calm.CB, calm.r, calm.calls, 6, i * 0.037);
    assert.ok(n.every((s) => s === 'ebullet'), `calm t=${i * 0.037}`);
  }
  const bare = drawEnv(false);
  assert.equal(bare.CB.Comfort, undefined);
  for (let i = 0; i < 30; i++) assert.ok(pulseNames(bare.CB, bare.r, bare.calls, 6, i * 0.037).every((s) => s === 'ebullet'));
  const partial = drawEnv(false);
  partial.CB.Comfort = { calm: () => false };
  for (let i = 0; i < 30; i++) assert.ok(pulseNames(partial.CB, partial.r, partial.calls, 6, i * 0.037).every((s) => s === 'ebullet'));
  // turning calm off again brings the pulse back
  const back = drawEnv(true);
  back.CB.Comfort.set(true);
  back.CB.Comfort.set(false);
  const seen = new Set();
  for (let i = 0; i < 30; i++) for (const n of pulseNames(back.CB, back.r, back.calls, 6, i * 0.037)) seen.add(n);
  assert.equal(seen.size, 2);
});

test('projectiles: coloured enemy bullets keep their ink-ringed disc and gain a bright core while pulsing', () => {
  const { CB, r, calls } = drawEnv(true);
  const w = { pBullets: [], eBullets: [{ x: 50, y: 60, r: 3, color: '#33AA55', t: 0 }] };
  const discsAt = (t) => {
    calls.length = 0;
    CB.Projectiles.draw(w, r, t, 'enemy');
    return calls.filter((c) => c.k === 'disc');
  };
  let sawCore = false;
  let sawPlain = false;
  for (let i = 0; i < 40; i++) {
    const d = discsAt(i * 0.01);
    assert.deepEqual(H.plain([d[0].rad, d[0].c, d[1].rad, d[1].c]), [4, CB.Pal.C.ink, 3, '#33AA55'], 'ring and body are always there');
    if (d.length === 3) {
      sawCore = true;
      assert.equal(d[2].c, CB.Pal.C.bulletCore);
      assert.ok(d[2].rad >= 1 && d[2].rad < 3, 'the core is smaller than the body');
    } else {
      sawPlain = true;
      assert.equal(d.length, 2);
    }
  }
  assert.ok(sawCore && sawPlain);
  CB.Comfort.set(true);
  for (let i = 0; i < 40; i++) assert.equal(discsAt(i * 0.01).length, 2, 'calm: no core flash');
});

test('projectiles: a tiny coloured bullet (r 1) never gets a core that would hide its colour', () => {
  const { CB, r, calls } = drawEnv(true);
  const w = { pBullets: [], eBullets: [{ x: 50, y: 60, r: 1, color: '#33AA55', t: 0 }] };
  for (let i = 0; i < 40; i++) {
    calls.length = 0;
    CB.Projectiles.draw(w, r, i * 0.01, 'enemy');
    assert.equal(calls.filter((c) => c.k === 'disc').length, 2);
  }
});
