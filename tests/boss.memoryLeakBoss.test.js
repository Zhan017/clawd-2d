'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/art/font.js', 'src/game/enemies/memoryLeak.js', 'src/game/bosses/memoryLeakBoss.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function start(opts) {
  const o = opts || {};
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: o.seed || 11, god: true });
  if (o.player) {
    w.player.x = o.player[0];
    w.player.y = o.player[1];
  }
  w.boss = CB.Bosses.memoryLeakBoss.create(w);
  return { CB, w, boss: w.boss };
}
function countFires(w) {
  const box = { n: 0 };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { box.n++; return orig(...a); };
  return box;
}

test('memoryLeakBoss: 260 HP, spawns at the farthest candidate, radius tracks size', () => {
  const { w, boss } = start();
  assert.equal(boss.maxHp, 260);
  assert.equal(boss.body.hp, 260);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) > 80);
  boss.size = 1.5;
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(boss.body.r - 14 * boss.size) < 1e-9);
  assert.equal(boss.radius, boss.body.r, 'the controller exposes the radius too (Fx places the phase quip with it)');
});

test('memoryLeakBoss: regenerates 3 HP/s and grows 0.10/s after 1.5 s without damage', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 40);
  const hp0 = boss.body.hp;
  H.stepN(w, 3.5 * 60, idle);
  const gained = boss.body.hp - hp0;
  assert.ok(gained > 5 && gained < 7, `gained ${gained}`);
  assert.ok(boss.size > 1.15 && boss.size < 1.25, `size ${boss.size}`);
});

test('memoryLeakBoss: damage shrinks size with a floor of 1.0', () => {
  const { w, boss } = start();
  boss.size = 1.5;
  w.damageEnemy(boss.body, 50);
  assert.ok(Math.abs(boss.size - 1.24) < 1e-9);
  w.damageEnemy(boss.body, 100);
  assert.equal(boss.size, 1);
});

test('memoryLeakBoss: lobs 2 blobs every 2.5 s that land within 24 px of the player as puddles', () => {
  const { w } = start();
  H.stepN(w, 2.6 * 60, idle);
  assert.equal(alive(w, 'leakBlob').length, 2);
  H.stepN(w, 1.1 * 60, idle);
  assert.equal(alive(w, 'leakBlob').length, 0);
  assert.ok(w.hazards.length >= 2);
  for (const h of w.hazards) assert.ok(Math.hypot(h.x - w.player.x, h.y - w.player.y) <= 24.5);
});

test('memoryLeakBoss: splits below 66% and 33%, each exactly once', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 120);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 3);
  boss.body.hp = 230;
  H.stepN(w, 1, idle);
  w.damageEnemy(boss.body, 50);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 3, 'no second 66% split');
  w.damageEnemy(boss.body, 100);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 6);
});

test('memoryLeakBoss: phase 2 strictly below 50% latches and adds an 8-bullet ring every 4 s', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.body, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1, 'exactly 50% is still phase 1');
  ({ w, boss } = start());
  w.damageEnemy(boss.body, 131);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  const c = countFires(w);
  H.stepN(w, 4.1 * 60, idle);
  assert.ok(c.n >= 8, `bullets ${c.n}`);
  boss.body.hp = 250;
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2, 'phases never revert');
});

test('memoryLeakBoss: defeat when the body dies; finale data', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  const B = CB.Bosses.memoryLeakBoss;
  assert.equal(B.id, 'memoryLeakBoss');
  assert.equal(boss.id, 'memoryLeakBoss');
  assert.equal(B.name, 'MEMORY LEAK');
  assert.equal(B.tagline, 'heap: 99% used');
  assert.equal(B.commitMsg, 'fix: free() what you malloc()');
  assert.equal(B.file, 'heap.c');
  assert.ok(CB.Art.hasSprite(B.portrait));
  assert.equal(B.portrait, 'leakBoss_0');
  assert.ok(B.diff.length >= 2 && B.diff.length <= 4);
  for (const l of B.diff) {
    assert.match(l, /^[-+] /);
    assert.ok(l.length <= 46, l);
    assert.ok(CB.Font.measure(l) <= 228, `diff line "${l}" is ${CB.Font.measure(l)} px`);
    for (const ch of l) assert.ok(CB.Font.has(ch), `no glyph for ${JSON.stringify(ch)}`);
  }
  for (const p of B.deathPoints(boss)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

// ---- spawn ----------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: the body is a targetable, contact-dealing boss part with spawn contact grace', () => {
  const { w, boss } = start();
  const b = boss.body;
  assert.equal(b.kind, 'leakBoss');
  assert.equal(b.boss, true);
  assert.equal(b.regular, false);
  assert.equal(b.targetable, true);
  assert.equal(b.solid, false);
  assert.equal(b.contact, true);
  assert.ok(b.noContactT >= 0.45);
  assert.equal(b.r, 14);
  assert.equal(boss.size, 1);
  assert.equal(boss.phase, 1);
  assert.equal(boss.defeated, false);
  assert.equal(w.enemies.filter((e) => !e.dead).length, 1);
});

test('memoryLeakBoss: spawns at the candidate farthest from the player, the first one winning ties', () => {
  const at = (px, py) => {
    const { boss } = start({ player: [px, py] });
    return [boss.body.x, boss.body.y];
  };
  assert.deepEqual(at(80, 96), [240, 96]);
  assert.deepEqual(at(240, 96), [80, 96]);
  assert.deepEqual(at(160, 126), [80, 96], 'a tie between (80, 96) and (240, 96) goes to the first listed');
  assert.deepEqual(at(160, 60), [80, 96], 'a tie again, with the top candidate closest');
  assert.deepEqual(at(160, 170), [160, 60]);
});

test('memoryLeakBoss: the controller fields start where the plan says', () => {
  const { boss } = start();
  assert.equal(boss.idleT, 0);
  assert.equal(boss.lobT, 2.5);
  assert.equal(boss.ringT, 4);
  assert.equal(boss.split66, false);
  assert.equal(boss.split33, false);
  assert.equal(boss.x, boss.body.x);
  assert.equal(boss.y, boss.body.y);
  assert.equal(boss.hp, boss.body.hp);
});

// ---- the leak -------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: a hit resets the idle clock, and nothing regenerates before 1.5 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 40);
  H.stepN(w, 1.4 * 60, idle);
  assert.equal(boss.body.hp, 220, 'no regen yet');
  assert.equal(boss.size, 1);
  boss.idleT = 3;
  w.damageEnemy(boss.body, 1);
  assert.equal(boss.idleT, 0);
});

test('memoryLeakBoss: regeneration stops at max HP and growth stops at size 2', () => {
  const { w, boss } = start();
  boss.idleT = 5;
  boss.body.hp = 259.9;
  boss.size = 1.99;
  H.stepN(w, 60, idle);
  assert.equal(boss.body.hp, 260);
  assert.equal(boss.size, 2);
  assert.equal(boss.body.r, 28);
  assert.equal(boss.hp, 260);
});

test('memoryLeakBoss: the controller HP mirrors the body every tick', () => {
  const { w, boss } = start();
  for (let i = 0; i < 20; i++) {
    if (i % 5 === 0) w.damageEnemy(boss.body, 7);
    H.stepN(w, 1, idle);
    assert.equal(boss.hp, boss.body.hp, `tick ${i}`);
  }
});

test('memoryLeakBoss: a hit still works on a body that has no controller', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 3, god: true });
  const lone = w.spawnEnemy('leakBoss', 100, 100);
  assert.equal(w.damageEnemy(lone, 10), 10);
  assert.equal(lone.hp, 250);
});

test('memoryLeakBoss: player bolts shrink it by 0.0052 per point of damage', () => {
  const { w, boss } = start();
  boss.size = 1.6;
  const before = boss.size;
  const b = w.firePlayerBolt(boss.body.x, boss.body.y, 0);
  b.dmg = 5;
  H.stepN(w, 1, idle);
  assert.equal(boss.body.hp, 255);
  assert.ok(Math.abs(boss.size - (before - 0.026)) < 1e-6, `size ${boss.size}`);
});

// ---- movement -------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: drifts toward the player at 18 / size px/s and publishes its velocity', () => {
  const { w, boss } = start();
  const d0 = Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y);
  H.stepN(w, 30, idle);
  const d1 = Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y);
  assert.ok(d1 < d0 - 8 && d1 > d0 - 10, `closed ${d0 - d1}`);
  const v = Math.hypot(boss.body.vx, boss.body.vy);
  assert.ok(Math.abs(v - 18) < 0.01, `speed ${v}`);
  // the published velocity points at the player
  const toP = { x: w.player.x - boss.body.x, y: w.player.y - boss.body.y };
  assert.ok(boss.body.vx * toP.x + boss.body.vy * toP.y > 0);

  const big = start();
  big.boss.size = 2;
  H.stepN(big.w, 30, idle);
  const v2 = Math.hypot(big.boss.body.vx, big.boss.body.vy);
  assert.ok(Math.abs(v2 - 9) < 0.01, `a size-2 body moves at 9 px/s, got ${v2}`);
});

test('memoryLeakBoss: stays inside the arena even at full size against a wall', () => {
  const { w, boss } = start({ player: [14, 25] });
  boss.size = 2;
  boss.idleT = 100;
  const A = w.arena;
  for (let i = 0; i < 60 * 30; i++) {
    H.stepN(w, 1, idle);
    const b = boss.body;
    assert.ok(finite(b.x) && finite(b.y), `tick ${i}`);
    assert.ok(b.x - b.r >= A.x - 1e-6 && b.x + b.r <= A.x + A.w + 1e-6, `x outside at tick ${i}`);
    assert.ok(b.y - b.r >= A.y - 1e-6 && b.y + b.r <= A.y + A.h + 1e-6, `y outside at tick ${i}`);
  }
});

test('memoryLeakBoss: the body parked on the player never produces NaN', () => {
  const { w, boss } = start();
  boss.body.x = w.player.x;
  boss.body.y = w.player.y;
  H.stepN(w, 120, idle);
  assert.ok(finite(boss.body.x) && finite(boss.body.y) && finite(boss.body.vx) && finite(boss.body.vy));
});

// ---- the lob --------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: the first lob comes a full 2.5 s after spawn, and emits lob at the body', () => {
  const { w, boss } = start();
  let ticks = 0;
  while (!w.events.some((e) => e.type === 'lob') && ticks < 600) {
    H.stepN(w, 1, idle);
    ticks++;
  }
  assert.equal(ticks, 150, 'exactly one period after spawn');
  assert.equal(alive(w, 'leakBlob').length, 2);
  const lobs = w.events.filter((e) => e.type === 'lob');
  assert.equal(lobs.length, 1, 'one lob event per volley');
  assert.deepEqual([lobs[0].x, lobs[0].y], [boss.body.x, boss.body.y], 'at the body');
});

test('memoryLeakBoss: blobs are boss parts that start at the body and have a target near the player', () => {
  const { w, boss } = start();
  H.stepN(w, 2.5 * 60 + 1, idle);
  const blobs = alive(w, 'leakBlob');
  assert.equal(blobs.length, 2);
  for (const b of blobs) {
    assert.equal(b.boss, true);
    assert.equal(b.regular, false);
    assert.equal(b.targetable, false);
    assert.equal(b.solid, false);
    assert.equal(b.contact, false);
    assert.equal(b.r, 4);
    assert.ok(b.noContactT >= 0.45);
    assert.equal(b.data.dur, 1);
    assert.ok(Math.hypot(b.data.sx - boss.body.x, b.data.sy - boss.body.y) < 1, 'starts at the body');
    assert.ok(Math.hypot(b.data.tx - w.player.x, b.data.ty - w.player.y) <= 24 + 1e-9, 'targets the 24 px disc');
  }
});

test('memoryLeakBoss: a blob flies in a straight line, publishes its velocity, then lands as a puddle and a silent kill', () => {
  const { w } = start();
  H.stepN(w, 2.5 * 60 + 1, idle);
  const blob = alive(w, 'leakBlob')[0];
  const d = blob.data;
  H.stepN(w, 30, idle);
  assert.ok(Math.abs(blob.x - (d.sx + (d.tx - d.sx) * 0.5)) < 1.5, 'halfway along the line at 0.5 s');
  assert.ok(Math.abs(blob.y - (d.sy + (d.ty - d.sy) * 0.5)) < 1.5);
  assert.ok(Math.hypot(blob.vx, blob.vy) > 10, `speed ${Math.hypot(blob.vx, blob.vy)}`);
  const evFrom = w.events.length;
  const hz0 = w.hazards.length;
  H.stepN(w, 31, idle);
  assert.equal(blob.dead, true);
  const landed = w.hazards.slice(hz0).filter((h) => Math.abs(h.x - d.tx) < 1e-9 && Math.abs(h.y - d.ty) < 1e-9);
  assert.equal(landed.length, 1);
  assert.equal(landed[0].kind, 'puddle');
  assert.equal(landed[0].r, 12);
  assert.equal(landed[0].slow, 0.5);
  assert.ok(landed[0].life > 4.4 && landed[0].life <= 4.5, `life ${landed[0].life}`);
  const splat = w.events.slice(evFrom).find((e) => e.type === 'splat' && e.x === d.tx && e.y === d.ty);
  assert.ok(splat, 'splat at the landing point');
  const die = w.events.slice(evFrom).find((e) => e.type === 'enemyDie' && e.kind === 'leakBlob');
  assert.equal(die.silent, true);
});

test('memoryLeakBoss: a landed puddle slows Clawd to half speed while she stands in it', () => {
  const { w } = start();
  H.stepN(w, 3.6 * 60, idle);
  assert.ok(w.hazards.length >= 2);
  const puddle = w.hazards[0];
  w.player.x = puddle.x;
  w.player.y = puddle.y;
  H.stepN(w, 1, idle);
  assert.equal(w.player.slow, 0.5);
});

test('memoryLeakBoss: a blob that lands on Clawd hurts, and so does standing in its puddle; one beside her does not', () => {
  const { w } = start();
  H.stepN(w, 2.6 * 60, idle); // the first lob (at 2.5 s) is in the air
  const blobs = w.enemies.filter((e) => !e.dead && e.kind === 'leakBlob');
  assert.ok(blobs.length >= 2, 'two blobs in flight');
  const [onHer, beside] = blobs;
  beside.data.tx = onHer.data.tx + 40; // a second landing spot well clear of her
  beside.data.ty = onHer.data.ty;
  w.player.x = onHer.data.tx; // Clawd stands on the first shadow and does not move
  w.player.y = onHer.data.ty;
  const before = w.stats.wouldHits;
  let n = 0;
  while (w.enemies.some((e) => e === onHer && !e.dead) && n++ < 120) H.stepN(w, 1, () => H.makeInput({ aimX: 300, aimY: w.player.y }));
  H.stepN(w, 1, idle);
  assert.equal(w.stats.wouldHits, before + 1, 'the landing splash is one hit, the one beside her none');
  H.stepN(w, 70, idle); // still standing in the puddle once the mercy frames run out
  assert.equal(w.stats.wouldHits, before + 2, 'the puddle keeps burning');
});

test('memoryLeakBoss: lob targets stay on the floor when Clawd hugs a corner', () => {
  const { w } = start({ player: [13, 25], seed: 5 });
  const A = w.arena;
  let seen = 0;
  for (let i = 0; i < 60 * 25; i++) {
    H.stepN(w, 1, idle);
    for (const b of alive(w, 'leakBlob')) {
      if (b.data.seen) continue;
      b.data.seen = true;
      seen++;
      assert.ok(b.data.tx >= A.x + 12 - 1e-9 && b.data.ty >= A.y + 12 - 1e-9, `target ${b.data.tx}, ${b.data.ty}`);
      assert.ok(b.data.tx <= A.x + A.w - 12 + 1e-9 && b.data.ty <= A.y + A.h - 12 + 1e-9);
    }
  }
  assert.ok(seen >= 16, `saw ${seen} blobs`);
});

test('memoryLeakBoss: phase 2 lobs 3 blobs per volley and the lob clock keeps running', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 150);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  H.stepN(w, 2.5 * 60, idle);
  assert.equal(alive(w, 'leakBlob').length, 3);
});

test('memoryLeakBoss: lobs are deterministic for a seed', () => {
  const run = () => {
    const { w } = start({ seed: 21 });
    H.stepN(w, 2.5 * 60 + 1, idle);
    return alive(w, 'leakBlob').map((b) => [b.data.tx, b.data.ty]);
  };
  assert.deepEqual(run(), run());
});

// ---- splits ---------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: a split is three big, non-elite memoryLeaks 20 px from the body at 120 degree steps', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 120);
  H.stepN(w, 1, idle);
  const kids = alive(w, 'memoryLeak');
  assert.equal(kids.length, 3);
  const angles = [];
  for (const k of kids) {
    assert.ok(!k.elite, 'never elite');
    assert.equal(k.hp, 4);
    assert.equal(k.data.small, false);
    assert.ok(Math.abs(Math.hypot(k.x - boss.body.x, k.y - boss.body.y) - 20) < 1e-6);
    angles.push(Math.atan2(k.y - boss.body.y, k.x - boss.body.x));
  }
  angles.sort((a, b) => a - b);
  const gaps = [angles[1] - angles[0], angles[2] - angles[1], angles[0] + 2 * Math.PI - angles[2]];
  for (const g of gaps) assert.ok(Math.abs(g - (2 * Math.PI) / 3) < 1e-6, `gap ${g}`);
});

test('memoryLeakBoss: the two splits land at different angles', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 180); // 80 HP: below both thresholds in one go
  H.stepN(w, 1, idle);
  const kids = alive(w, 'memoryLeak');
  assert.equal(kids.length, 6);
  const keys = new Set(kids.map((k) => Math.round(Math.atan2(k.y - boss.body.y, k.x - boss.body.x) * 1000)));
  assert.equal(keys.size, 6, 'six distinct directions');
});

test('memoryLeakBoss: regenerating back over a threshold never splits again', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 120);
  H.stepN(w, 1, idle);
  assert.equal(boss.split66, true);
  boss.idleT = 10;
  H.stepN(w, 60 * 40, idle);
  assert.ok(boss.body.hp > 171.6, 'regenerated past 66%');
  for (const k of alive(w, 'memoryLeak')) k.dead = true;
  w.damageEnemy(boss.body, 100);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 0, 'the 66% split does not repeat');
  assert.equal(boss.split33, false);
});

// ---- phase 2 --------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: the phase change emits bossPhase, shakes, and gives the body 0.5 s of invulnerability', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 150);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  const ev = w.events.filter((e) => e.type === 'bossPhase');
  assert.equal(ev.length, 1, 'once');
  assert.equal(ev[0].phase, 2);
  assert.ok(finite(ev[0].x) && finite(ev[0].y));
  assert.ok(w.shake > 3.5, `shake ${w.shake}`);
  const hp = boss.body.hp;
  assert.equal(w.damageEnemy(boss.body, 5), 0, 'invulnerable right after the change');
  H.stepN(w, 25, idle);
  assert.equal(w.damageEnemy(boss.body, 5), 0, 'still invulnerable at 0.4 s');
  H.stepN(w, 8, idle);
  assert.equal(w.damageEnemy(boss.body, 5), 5, 'vulnerable again after 0.5 s');
  assert.ok(boss.body.hp < hp);
  assert.equal(w.events.filter((e) => e.type === 'bossPhase').length, 1, 'never repeats');
});

test('memoryLeakBoss: the controller itself calls addShake(4) on the phase change', () => {
  const { w, boss } = start();
  const shakes = [];
  const addShake = w.addShake;
  w.addShake = (amount) => { shakes.push(amount); return addShake(amount); };
  w.damageEnemy(boss.body, 150);
  boss.update(w, 1 / 60); // straight to the controller: the world's Fx would shake on bossPhase as well
  assert.equal(boss.phase, 2);
  assert.deepEqual(shakes, [4]);
});

test('memoryLeakBoss: the ring is 8 bullets at speed 70, evenly spaced, announced with one enemyShoot', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 150);
  H.stepN(w, 1, idle);
  assert.equal(w.eBullets.length, 0, 'no ring on phase entry: the first comes a full period later');
  let guard = 0;
  while (w.eBullets.length === 0 && guard++ < 600) H.stepN(w, 1, idle);
  assert.ok(guard > 230 && guard < 245, `first ring after ${guard} ticks`);
  assert.equal(w.eBullets.length, 8);
  const angles = [];
  for (const b of w.eBullets) {
    assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 70) < 1e-6);
    angles.push(Math.atan2(b.vy, b.vx));
  }
  angles.sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(angles[i] - angles[i - 1] - Math.PI / 4) < 1e-6);
  const shoots = w.events.filter((e) => e.type === 'enemyShoot');
  assert.equal(shoots.length, 1);
  assert.ok(finite(shoots[0].x) && finite(shoots[0].y));
});

test('memoryLeakBoss: successive rings are turned half a step so the gaps move', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 150);
  H.stepN(w, 1, idle);
  const firstAngle = () => {
    let g = 0;
    while (w.eBullets.length === 0 && g++ < 600) H.stepN(w, 1, idle);
    const a = Math.atan2(w.eBullets[0].vy, w.eBullets[0].vx);
    w.eBullets.length = 0;
    return a;
  };
  const a1 = firstAngle();
  const a2 = firstAngle();
  const turn = ((a2 - a1) % (Math.PI / 4) + Math.PI / 4) % (Math.PI / 4);
  assert.ok(Math.abs(turn - Math.PI / 8) < 1e-6, `turn ${turn}`);
});

test('memoryLeakBoss: no ring before phase 2', () => {
  const { w } = start();
  const c = countFires(w);
  H.stepN(w, 10 * 60, idle);
  assert.equal(c.n, 0);
});

// ---- defeat ---------------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: defeat silently clears blobs in flight and nothing lobs afterwards', () => {
  const { w, boss } = start();
  H.stepN(w, 2.5 * 60 + 5, idle);
  assert.equal(alive(w, 'leakBlob').length, 2);
  const hz0 = w.hazards.length;
  const lobs0 = w.events.filter((e) => e.type === 'lob').length;
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(alive(w, 'leakBlob').length, 0);
  const blobDeaths = w.events.filter((e) => e.type === 'enemyDie' && e.kind === 'leakBlob');
  assert.equal(blobDeaths.length, 2);
  for (const d of blobDeaths) assert.equal(d.silent, true);
  H.stepN(w, 6 * 60, idle);
  assert.equal(w.hazards.length, hz0, 'blobs killed mid-air never land');
  assert.equal(w.events.filter((e) => e.type === 'lob').length, lobs0);
  assert.equal(alive(w, 'leakBoss').length, 0);
});

test('memoryLeakBoss: deathPoints is the centre plus 7 points on a ring of 0.7 r, and works after defeat', () => {
  const { CB, w, boss } = start();
  const B = CB.Bosses.memoryLeakBoss;
  boss.size = 1.5;
  H.stepN(w, 30, idle);
  const before = B.deathPoints(boss);
  assert.equal(before.length, 8);
  assert.deepEqual([before[0].x, before[0].y], [boss.body.x, boss.body.y], 'the centre first');
  for (let i = 1; i < before.length; i++) {
    const d = Math.hypot(before[i].x - boss.body.x, before[i].y - boss.body.y);
    assert.ok(Math.abs(d - boss.body.r * 0.7) < 1e-9, `point ${i} at ${d}`);
  }
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  const after = B.deathPoints(boss);
  assert.equal(after.length, before.length);
  for (const p of after) assert.ok(finite(p.x) && finite(p.y));
});

test('memoryLeakBoss: the finale data fits the diff card', () => {
  const { CB } = start();
  const B = CB.Bosses.memoryLeakBoss;
  assert.deepEqual(Array.from(B.diff), ['- p = malloc(HEAP);', '+ p = malloc(HEAP);', '+ free(p);']);
});

// ---- the whole fight ------------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: every event over a long fight carries a finite x and y, and no entity goes NaN', () => {
  const { CB, w, boss } = start({ seed: 4 });
  H.stepN(w, 5 * 60, idle);
  w.damageEnemy(boss.body, 150); // phase 2 and the 66% split
  H.stepN(w, 12 * 60, idle);
  w.damageEnemy(boss.body, 60); // the 33% split
  H.stepN(w, 12 * 60, idle);
  assert.ok(w.events.some((e) => e.type === 'lob'));
  assert.ok(w.events.some((e) => e.type === 'splat'));
  assert.ok(w.events.some((e) => e.type === 'bossPhase'));
  for (const e of w.events) assert.ok(finite(e.x) && finite(e.y), `${e.type} has no finite position`);
  for (const e of w.enemies) assert.ok(finite(e.x) && finite(e.y) && finite(e.r), e.kind);
  assert.ok(w.enemies.length <= CB.CAPS.enemies);
});

test('memoryLeakBoss: a bolt storm kills it cleanly and the world stays healthy', () => {
  const { w, boss } = start({ seed: 8 });
  const fire = () => H.makeInput({ aimX: boss.body.x, aimY: boss.body.y, fire: true });
  let guard = 0;
  while (!boss.defeated && guard++ < 60 * 120) H.stepN(w, 1, fire);
  assert.equal(boss.defeated, true, 'killable with the base kit');
  assert.ok(w.stats.damageDealt > 0);
  assert.equal(boss.maxHp, 260);
});

// ---- sprites and drawing --------------------------------------------------------------------------------------------------------

test('memoryLeakBoss: sprites exist at the planned sizes, with an ink outline, two greens and a shine', () => {
  const { CB } = start();
  const dims = { leakBoss_0: [28, 22], leakBoss_1: [28, 22], leakBlob_0: [6, 6] };
  for (const [name, [wd, ht]] of Object.entries(dims)) {
    assert.ok(CB.Art.hasSprite(name), name);
    const d = CB.Art.spriteDef(name);
    assert.equal(d.w, wd, `${name} width`);
    assert.equal(d.h, ht, `${name} height`);
    const px = d.rows.join('');
    assert.ok(px.includes('k'), `${name} has an ink outline`);
    assert.ok(px.includes('g') && px.includes('G'), `${name} has two greens`);
    assert.ok(px.includes('w'), `${name} has a shine`);
  }
  assert.notEqual(CB.Art.spriteDef('leakBoss_0').rows.join('|'), CB.Art.spriteDef('leakBoss_1').rows.join('|'), 'the wobble frames differ');
});

test('memoryLeakBoss: every sprite pixel on the silhouette edge is ink (no loose colour touching transparency)', () => {
  const { CB } = start();
  for (const name of ['leakBoss_0', 'leakBoss_1', 'leakBlob_0']) {
    const rows = CB.Art.spriteDef(name).rows;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.' || ch === 'k') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy;
          const nx = x + dx;
          const n = ny < 0 || ny >= rows.length || nx < 0 || nx >= rows[y].length ? '.' : rows[ny][nx];
          assert.notEqual(n, '.', `${name}: "${ch}" at (${x}, ${y}) touches transparency`);
        }
      }
    }
  }
});

test('memoryLeakBoss: the body sprite is left-right symmetric in silhouette', () => {
  const { CB } = start();
  for (const name of ['leakBoss_0', 'leakBoss_1']) {
    const rows = CB.Art.spriteDef(name).rows;
    const clear = rows.map((r) => Array.from(r, (ch) => (ch === '.' ? '.' : '#')).join(''));
    // The drips may be uneven by design; the dome (the top 14 rows) must mirror exactly.
    for (let y = 0; y < 14; y++) assert.equal(clear[y], clear[y].split('').reverse().join(''), `${name} row ${y}`);
  }
});

// A renderer stub that records every call; alpha runs its callback.
function stubRenderer() {
  const calls = [];
  const rec = (kind) => (...a) => calls.push({ kind, a });
  return {
    calls,
    sprite: (name, x, y, o) => calls.push({ kind: 'sprite', name, x, y, o: o || {} }),
    rect: rec('rect'),
    disc: (x, y, rad, color) => calls.push({ kind: 'disc', x, y, rad, color, alpha: stubRenderer.alpha }),
    ring: (x, y, rad, color) => calls.push({ kind: 'ring', x, y, rad, color, alpha: stubRenderer.alpha }),
    line: rec('line'),
    frame: rec('frame'),
    text: (str, x, y, o) => calls.push({ kind: 'text', str, x, y, o: o || {} }),
    alpha(a, fn) {
      const prev = stubRenderer.alpha;
      stubRenderer.alpha = a;
      try { fn(); } finally { stubRenderer.alpha = prev; }
    },
  };
}
stubRenderer.alpha = 1;

test('memoryLeakBoss: the body draws a translucent hitbox disc under the sprite and a heap label above', () => {
  const { CB, w, boss } = start();
  const b = boss.body;
  b.x = 150;
  b.y = 100;
  const r = stubRenderer();
  CB.Enemies.leakBoss.draw(b, r, 0);
  const disc = r.calls.find((c) => c.kind === 'disc');
  assert.ok(disc, 'a hitbox disc');
  assert.equal(disc.rad, 14);
  assert.equal(disc.alpha, 0.35);
  assert.equal(disc.color, CB.Pal.C.green);
  const sprite = r.calls.find((c) => c.kind === 'sprite');
  assert.match(sprite.name, /^leakBoss_[01]$/);
  assert.equal(sprite.x, 150);
  assert.equal(sprite.y, 100);
  assert.equal(sprite.o.white, false);
  assert.ok(r.calls.indexOf(disc) < r.calls.indexOf(sprite), 'the disc is under the sprite');
  const label = r.calls.find((c) => c.kind === 'text');
  assert.equal(label.str, 'heap 0%', 'the label reads the wall gauge: empty at size 1');
  assert.ok(label.y < b.y - b.r, 'above the body');
  assert.equal(w.player.dead, false);
});

test("memoryLeakBoss: the heap label follows size from 0% to 100% (the wall gauge's own number) and the disc grows with the body", () => {
  const { CB, boss } = start();
  const b = boss.body;
  b.x = 150;
  b.y = 100;
  for (const [size, pct] of [[1, 0], [1.5, 50], [2, 100], [1.25, 25]]) {
    boss.size = size;
    b.r = 14 * size;
    const r = stubRenderer();
    CB.Enemies.leakBoss.draw(b, r, 0);
    assert.equal(r.calls.find((c) => c.kind === 'text').str, `heap ${pct}%`, `size ${size}`);
    assert.equal(r.calls.find((c) => c.kind === 'disc').rad, 14 * size);
  }
});

test('memoryLeakBoss: the label stays below the HUD even at full size against the top wall', () => {
  const { CB, w, boss } = start();
  const b = boss.body;
  boss.size = 2;
  b.r = 28;
  b.x = 160;
  b.y = w.arena.y + 28;
  const r = stubRenderer();
  CB.Enemies.leakBoss.draw(b, r, 0);
  assert.ok(r.calls.find((c) => c.kind === 'text').y >= w.arena.y);
});

test('memoryLeakBoss: the body flashes white on a hit and wobbles between two frames', () => {
  const { CB, boss } = start();
  const b = boss.body;
  const draw = (t, patch) => {
    Object.assign(b, patch);
    const r = stubRenderer();
    CB.Enemies.leakBoss.draw(b, r, t);
    return r.calls.find((c) => c.kind === 'sprite');
  };
  assert.equal(draw(0, { hitFlash: 0.05, t: 0 }).o.white, true);
  assert.equal(draw(0, { hitFlash: 0, t: 0 }).o.white, false);
  const names = new Set();
  for (let t = 0; t < 2; t += 0.1) names.add(draw(t, { t, hitFlash: 0 }).name);
  assert.deepEqual([...names].sort(), ['leakBoss_0', 'leakBoss_1']);
});

test('memoryLeakBoss: the body faces the player', () => {
  const { CB, w, boss } = start();
  const b = boss.body;
  b.x = 100;
  w.player.x = 200;
  H.stepN(w, 2, idle);
  let r = stubRenderer();
  CB.Enemies.leakBoss.draw(b, r, 0);
  assert.equal(r.calls.find((c) => c.kind === 'sprite').o.flip, false, 'player on the right: eyes right');
  w.player.x = 20;
  H.stepN(w, 2, idle);
  r = stubRenderer();
  CB.Enemies.leakBoss.draw(b, r, 0);
  assert.equal(r.calls.find((c) => c.kind === 'sprite').o.flip, true, 'player on the left: flipped');
});

test('memoryLeakBoss: the phase-change invulnerability flashes white, through Calm mode when it is loaded', () => {
  const { CB, boss } = start();
  const b = boss.body;
  b.invuln = 0.4;
  const whites = () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      b.t = i / 60;
      const r = stubRenderer();
      CB.Enemies.leakBoss.draw(b, r, i / 60);
      seen.add(r.calls.find((c) => c.kind === 'sprite').o.white);
    }
    return seen;
  };
  const plain = whites();
  assert.ok(plain.has(true) && plain.has(false), 'blinks without Comfort');
  const asked = [];
  CB.Comfort = { blink: (t, hz) => { asked.push(hz); return false; } };
  const calm = whites();
  assert.deepEqual([...calm], [false], 'Comfort decides the blink');
  assert.ok(asked.length > 0 && asked.every((hz) => hz > 4));
  b.invuln = 0;
  CB.Comfort = undefined;
  b.t = 0;
  const r = stubRenderer();
  CB.Enemies.leakBoss.draw(b, r, 0);
  assert.equal(r.calls.find((c) => c.kind === 'sprite').o.white, false, 'no flash when vulnerable');
});

test('memoryLeakBoss: a blob draws a droplet above its shadow and the puddle preview on the ground', () => {
  const { CB, w } = start();
  H.stepN(w, 2.5 * 60 + 31, idle);
  const blob = alive(w, 'leakBlob')[0];
  const r = stubRenderer();
  CB.Enemies.leakBlob.draw(blob, r, 0);
  const sprite = r.calls.find((c) => c.kind === 'sprite');
  assert.match(sprite.name, /^leakBlob_[01]$/);
  assert.ok(sprite.y < blob.y - 3, `lifted above the ground line by the arc (${sprite.y} vs ${blob.y})`);
  const shadow = r.calls.filter((c) => c.kind === 'rect' || c.kind === 'disc' || c.kind === 'ring');
  assert.ok(shadow.length >= 1, 'shadow and preview');
  assert.ok(r.calls.indexOf(sprite) > r.calls.findIndex((c) => c.kind === 'rect'), 'the shadow is under the droplet');
  // the shadow sits at the target, not at the blob
  const rects = r.calls.filter((c) => c.kind === 'rect');
  const cx = rects.reduce((s, c) => s + c.a[0] + c.a[2] / 2, 0) / rects.length;
  assert.ok(Math.abs(cx - blob.data.tx) < 1.5, `shadow centred at the target x (${cx} vs ${blob.data.tx})`);
});

test('memoryLeakBoss: a blob marks its landing with a 2 px yellow rim and an inner ring that shrinks onto the spot', () => {
  const { CB, w } = start();
  H.stepN(w, 2.5 * 60 + 1, idle);
  const blob = alive(w, 'leakBlob')[0];
  const rings = (k) => {
    blob.data.t = k * blob.data.dur;
    const r = stubRenderer();
    CB.Enemies.leakBlob.draw(blob, r, 0);
    return r.calls.filter((c) => c.kind === 'ring');
  };
  for (const k of [0.1, 0.9]) {
    const rim = rings(k).filter((c) => c.color === CB.Pal.C.yellow);
    assert.deepEqual(rim.map((c) => c.rad).sort((a, b) => b - a), [12, 11], `a rim two pixels thick at k ${k}`);
    assert.ok(rim.every((c) => c.alpha >= 0.55), 'visible from the first moment of the flight');
  }
  const inner = (k) => rings(k).find((c) => c.color === CB.Pal.C.white).rad;
  assert.ok(inner(0.1) > inner(0.5) && inner(0.5) > inner(0.95), 'the inner ring shrinks as the blob comes down');
  CB.Comfort = { calm: () => true };
  assert.equal(inner(0.1), inner(0.9), 'calm mode: the inner ring stays put');
});

test('memoryLeakBoss: the blob arc is a parabola that touches the ground at both ends', () => {
  const { CB, w } = start();
  H.stepN(w, 2.5 * 60 + 1, idle);
  const blob = alive(w, 'leakBlob')[0];
  const lift = (t) => {
    blob.data.t = t;
    const k = t / blob.data.dur;
    blob.x = blob.data.sx + (blob.data.tx - blob.data.sx) * k;
    blob.y = blob.data.sy + (blob.data.ty - blob.data.sy) * k;
    const r = stubRenderer();
    CB.Enemies.leakBlob.draw(blob, r, 0);
    return blob.y - r.calls.find((c) => c.kind === 'sprite').y;
  };
  const start0 = lift(0);
  const mid = lift(0.5);
  const end = lift(0.999);
  assert.ok(mid > start0 + 8 && mid > end + 8, `apex ${mid}, ends ${start0} / ${end}`);
  assert.ok(Math.abs(lift(0.25) - lift(0.75)) < 1.01, 'symmetric');
});

test('memoryLeakBoss: the overlay draw is a harmless no-op', () => {
  const { boss } = start();
  const r = stubRenderer();
  boss.draw(r, 0);
  assert.equal(r.calls.length, 0);
});

// ---- review additions: exact thresholds, precise rates, distributions, and the draw rules ----------------------------------------

test('memoryLeakBoss: the 66% and 33% splits are strict, so exactly on the threshold does not split', () => {
  const { w, boss } = start();
  boss.body.hp = 0.66 * boss.maxHp;
  H.stepN(w, 1, idle);
  assert.equal(boss.split66, false, 'exactly 66% is not below it');
  assert.equal(alive(w, 'memoryLeak').length, 0);
  boss.body.hp = 0.66 * boss.maxHp - 0.01;
  H.stepN(w, 1, idle);
  assert.equal(boss.split66, true);
  assert.equal(alive(w, 'memoryLeak').length, 3);
  boss.body.hp = 0.33 * boss.maxHp;
  H.stepN(w, 1, idle);
  assert.equal(boss.split33, false, 'exactly 33% is not below it');
  assert.equal(alive(w, 'memoryLeak').length, 3);
  boss.body.hp = 0.33 * boss.maxHp - 0.01;
  H.stepN(w, 1, idle);
  assert.equal(boss.split33, true);
  assert.equal(alive(w, 'memoryLeak').length, 6);
});

test('memoryLeakBoss: swells by exactly 0.10 size/s and heals 3 HP/s once idle for 1.5 s', () => {
  const { w, boss } = start();
  boss.body.hp = 200;
  H.stepN(w, 1.5 * 60 + 60, idle); // 1.5 s of grace, then one second of leak
  assert.ok(boss.size > 1.09 && boss.size < 1.11, `size ${boss.size}`);
  assert.ok(boss.body.hp > 202 && boss.body.hp < 204, `hp ${boss.body.hp}`);
});

test('memoryLeakBoss: lob targets are uniform over the 24 px disc around Clawd (area-uniform, not radius-uniform)', () => {
  const { w } = start({ seed: 77, player: [160, 96] });
  const seen = new Set();
  const dists = [];
  for (let i = 0; i < 60 * 150; i++) {
    H.stepN(w, 1, idle);
    for (const b of alive(w, 'leakBlob')) {
      if (seen.has(b)) continue;
      seen.add(b);
      dists.push(Math.hypot(b.data.tx - w.player.x, b.data.ty - w.player.y));
    }
  }
  assert.ok(dists.length >= 100, `saw ${dists.length} targets`);
  assert.ok(Math.max(...dists) <= 24 + 1e-9, 'never outside the disc');
  assert.ok(Math.max(...dists) > 22, 'the whole disc is used');
  const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
  assert.ok(mean > 14.5 && mean < 17.5, `mean distance ${mean} (an area-uniform disc of radius 24 gives 16)`);
});

test('memoryLeakBoss: a body a hair from Clawd settles on her instead of overshooting', () => {
  const { w, boss } = start();
  boss.body.x = w.player.x + 0.1;
  boss.body.y = w.player.y;
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(boss.body.x - w.player.x) < 1e-9 && Math.abs(boss.body.y - w.player.y) < 1e-9, `at ${boss.body.x}, ${boss.body.y}`);
  H.stepN(w, 30, idle);
  assert.ok(Math.abs(boss.body.x - w.player.x) < 1e-9, 'stays parked');
});

test('memoryLeakBoss: the heap label turns yellow and red on the same bands as the Arena thermometer', () => {
  const { CB, boss } = start();
  const b = boss.body;
  b.x = 150;
  b.y = 100;
  const colourAt = (size) => {
    b.r = 14 * size;
    const r = stubRenderer();
    CB.Enemies.leakBoss.draw(b, r, 0);
    return r.calls.find((c) => c.kind === 'text').o.color;
  };
  const C = CB.Pal.C;
  assert.equal(colourAt(1), C.green);
  assert.equal(colourAt(1.49), C.green);
  assert.equal(colourAt(1.5), C.yellow);
  assert.equal(colourAt(1.79), C.yellow);
  assert.equal(colourAt(1.8), C.red);
  assert.equal(colourAt(2), C.red);
});

test('memoryLeakBoss: the blob arc is a true parabola, 4 k (1 - k) of its apex height', () => {
  const { CB, w } = start();
  H.stepN(w, 2.5 * 60 + 1, idle);
  const blob = alive(w, 'leakBlob')[0];
  const lift = (k) => {
    blob.data.t = k * blob.data.dur;
    blob.x = blob.data.sx + (blob.data.tx - blob.data.sx) * k;
    blob.y = blob.data.sy + (blob.data.ty - blob.data.sy) * k;
    const r = stubRenderer();
    CB.Enemies.leakBlob.draw(blob, r, 0);
    return blob.y - r.calls.find((c) => c.kind === 'sprite').y;
  };
  const apex = lift(0.5);
  for (const k of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) assert.ok(Math.abs(lift(k) - 4 * k * (1 - k) * apex) < 1e-9, `k ${k}`);
});
