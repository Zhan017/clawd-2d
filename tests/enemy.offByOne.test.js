'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/offByOne.js'];
const EXTRA_FILES = [...FILES, 'src/game/pickups.js', 'src/game/comfort.js']; // elite P0 handling and calm mode, for the extra tests below
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

function setup(ex, ey, files) {
  const CB = H.load(files || FILES);
  const w = CB.createWorld({ seed: 2, god: true });
  w.player.x = 160;
  w.player.y = 96;
  const e = w.spawnEnemy('offByOne', ex, ey);
  return { CB, w, e };
}

test('offByOne: stats', () => {
  const { e } = setup(60, 96);
  assert.equal(e.hp, 4);
  assert.equal(e.r, 5);
});

test('offByOne: fires a 2-bullet burst about 3.0 s after spawning, at 70 px/s', () => {
  const { w } = setup(60, 96);
  const shots = [];
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { const b = orig(...a); shots.push(b); return b; };
  H.stepN(w, 170, idle);
  assert.equal(shots.length, 0, 'nothing before 2.83 s');
  H.stepN(w, 30, idle);
  assert.equal(shots.length, 2);
  for (const b of shots) assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 70) < 1e-6);
  assert.equal(w.events.filter((ev) => ev.type === 'enemyShoot').length, 1);
  H.stepN(w, 170, idle);
  assert.equal(shots.length, 4, 'second burst 2.8 s later');
});

test('offByOne: aims one tile ahead of a moving player', () => {
  const { CB, w } = setup(60, 96);
  w.player.vx = 80;
  w.player.vy = 0;
  const p1 = CB.Enemies.offByOne.aimPoint(w);
  assert.ok(Math.abs(p1.x - (w.player.x + 8)) < 1e-9 && Math.abs(p1.y - w.player.y) < 1e-9);
  w.player.vx = 0;
  const p2 = CB.Enemies.offByOne.aimPoint(w);
  assert.equal(p2.x, w.player.x);
});

test('offByOne: backs off when close and closes in when far', () => {
  let { w, e } = setup(130, 96);
  const d0 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  H.stepN(w, 60, idle);
  assert.ok(Math.hypot(e.x - w.player.x, e.y - w.player.y) > d0 + 15);
  ({ w, e } = setup(16, 30));
  const d1 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  H.stepN(w, 60, idle);
  assert.ok(Math.hypot(e.x - w.player.x, e.y - w.player.y) < d1 - 15);
});

// ---- beyond the plan's four tests: flags, exact schedule, aim, range keeping, velocity, events, elite, art ----------------------

const tickOf = (w) => Math.round(w.time * 60);

// Wraps w.fireEnemyBullet and records every call: the arguments, the tick, and the world state at the moment of the call.
function spyShots(w, e) {
  const shots = [];
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => {
    const b = orig(...a);
    shots.push({ b, x: a[0], y: a[1], angle: a[2], speed: a[3], tick: tickOf(w), ex: e.x, ey: e.y, px: w.player.x, py: w.player.y, pvx: w.player.vx, pvy: w.player.vy });
    return b;
  };
  return shots;
}

test('offByOne: starts as a regular, targetable, contact enemy', () => {
  const { e } = setup(60, 96);
  assert.equal(e.kind, 'offByOne');
  assert.equal(e.maxHp, 4);
  assert.equal(e.targetable, true);
  assert.equal(e.contact, true);
  assert.equal(e.regular, true);
  assert.equal(e.boss, false);
  assert.equal(e.noContactT, 0.3, 'the world gives the 0.3 s contact grace; the spider never touches it');
});

test('offByOne: dies after 4 damage', () => {
  const { w, e } = setup(60, 96);
  for (let i = 0; i < 3; i++) w.damageEnemy(e, 1);
  assert.equal(e.dead, false);
  w.damageEnemy(e, 1);
  assert.equal(e.dead, true);
});

test('offByOne: bursts land on ticks 180/188, 348/356 and 516/524 (every 2.8 s, 0.12 s between the two bullets)', () => {
  const { w, e } = setup(60, 96);
  const shots = spyShots(w, e);
  H.stepN(w, 530, idle);
  assert.deepEqual(shots.map((s) => s.tick), [180, 188, 348, 356, 516, 524]);
  for (const s of shots) {
    assert.equal(s.speed, 70);
    assert.equal(s.x, s.ex, 'a bullet leaves from the spider');
    assert.equal(s.y, s.ey);
  }
  const announced = w.events.filter((ev) => ev.type === 'enemyShoot');
  assert.equal(announced.length, 3, 'enemyShoot on the first bullet of each burst only');
  for (const ev of announced) assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y));
});

test('offByOne: a stationary player is aimed at exactly', () => {
  const { w, e } = setup(60, 96);
  const shots = spyShots(w, e);
  H.stepN(w, 200, idle);
  assert.equal(shots.length, 2);
  for (const s of shots) assert.ok(Math.abs(s.angle - Math.atan2(s.py - s.y, s.px - s.x)) < 1e-9, `angle ${s.angle}`);
});

test('offByOne: every bullet leads a moving player by 8 px, computed at the moment of its own shot', () => {
  const { w, e } = setup(60, 96);
  const shots = spyShots(w, e);
  H.stepN(w, 200, (i) => H.makeInput({ aimX: 300, aimY: 30, moveX: i >= 170 ? 1 : 0 })); // Clawd starts running right at tick 171
  assert.equal(shots.length, 2);
  for (const s of shots) {
    assert.ok(s.pvx > 0 && s.pvy === 0, 'Clawd really is moving right at the shot');
    const want = Math.atan2(s.py - s.y, s.px + 8 - s.x);
    assert.ok(Math.abs(s.angle - want) < 1e-9, `angle ${s.angle} vs ${want}`);
  }
  assert.ok(Math.abs(shots[1].angle - shots[0].angle) > 0.01, 'the second bullet is re-aimed, not a copy of the first');
});

test('offByOne: aimPoint is the player position when still, and stays finite for odd velocities', () => {
  const { CB, w } = setup(60, 96);
  const aim = CB.Enemies.offByOne.aimPoint;
  w.player.vx = 0;
  w.player.vy = 0;
  assert.deepEqual(H.plain(aim(w)), { x: 160, y: 96 });
  w.player.vx = 0;
  w.player.vy = -300; // a dash: only the direction matters
  const up = aim(w);
  assert.ok(Math.abs(up.x - 160) < 1e-9 && Math.abs(up.y - 88) < 1e-9, `${up.x}, ${up.y}`);
  w.player.vx = 3;
  w.player.vy = 4;
  const diag = aim(w);
  assert.ok(Math.abs(diag.x - (160 + 4.8)) < 1e-9 && Math.abs(diag.y - (96 + 6.4)) < 1e-9, `${diag.x}, ${diag.y}`);
  w.player.vx = NaN;
  w.player.vy = undefined;
  const bad = aim(w);
  assert.ok(Number.isFinite(bad.x) && Number.isFinite(bad.y));
});

test('offByOne: fires through w.fireEnemyBullet looked up at fire time (a replacement installed later still sees the shots)', () => {
  const { w } = setup(60, 96);
  H.stepN(w, 100, idle);
  let calls = 0;
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { calls++; return orig(...a); };
  H.stepN(w, 100, idle);
  assert.equal(calls, 2);
});

test('offByOne: each range band gets its own motion at 50 px/s, and the published velocity is what really moved', () => {
  const run = (ex, ey) => {
    const { w, e } = setup(ex, ey);
    H.stepN(w, 1, idle);
    return e;
  };
  let e = run(130, 96); // 30 px away: straight back
  assert.ok(Math.abs(e.vx - -50) < 1e-6 && Math.abs(e.vy) < 1e-6, `away ${e.vx}, ${e.vy}`);
  e = run(20, 96); // 140 px away: straight in
  assert.ok(Math.abs(e.vx - 50) < 1e-6 && Math.abs(e.vy) < 1e-6, `toward ${e.vx}, ${e.vy}`);
  e = run(70, 96); // 90 px away: sideways, perpendicular to the line to Clawd
  assert.ok(Math.abs(e.vx) < 1e-6 && Math.abs(Math.abs(e.vy) - 50) < 1e-6, `strafe ${e.vx}, ${e.vy}`);
  e = run(160, 40); // 56 px straight above Clawd: back up
  assert.ok(Math.abs(e.vx) < 1e-6 && Math.abs(e.vy - -50) < 1e-6, `away vertically ${e.vx}, ${e.vy}`);
});

test('offByOne: the range bands are 70 and 110 px', () => {
  const dirOf = (dist) => {
    const { w, e } = setup(160 - dist, 96);
    H.stepN(w, 1, idle);
    return e.vx < -1 ? 'away' : e.vx > 1 ? 'toward' : 'strafe';
  };
  assert.equal(dirOf(69), 'away');
  assert.equal(dirOf(71), 'strafe');
  assert.equal(dirOf(109), 'strafe');
  assert.equal(dirOf(111), 'toward');
});

test('offByOne: the strafe direction flips every 1.5 to 2.5 s, on a schedule from w.rng', () => {
  const flips = (seed) => {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed, god: true });
    w.player.x = 160;
    w.player.y = 96;
    const e = w.spawnEnemy('offByOne', 70, 96);
    const at = [];
    let last = 0;
    for (let i = 1; i <= 900; i++) {
      e.x = 70; // pinned 90 px from Clawd: it never leaves the strafe band, so vy is the strafe sign alone
      e.y = 96;
      H.stepN(w, 1, idle);
      assert.ok(Math.abs(Math.abs(e.vy) - 50) < 1e-6 && Math.abs(e.vx) < 1e-6, `tick ${i}: ${e.vx}, ${e.vy}`);
      const s = Math.sign(e.vy);
      if (last && s !== last) at.push(i);
      last = s;
    }
    return at;
  };
  const a = flips(2);
  assert.ok(a.length >= 5, `15 s should hold at least 5 flips, saw ${a.length}`);
  const gaps = [a[0], ...a.slice(1).map((t, i) => t - a[i])];
  for (const g of gaps) assert.ok(g >= 1.5 * 60 - 2 && g <= 2.5 * 60 + 2, `gap ${g} ticks`);
  assert.ok(new Set(gaps).size > 1, 'the gaps are not all the same');
  assert.deepEqual(flips(2), a, 'same seed, same schedule');
});

test('offByOne: spiders do not all start strafing the same way', () => {
  const dirs = new Set();
  for (let seed = 1; seed <= 8; seed++) {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed, god: true });
    w.player.x = 160;
    w.player.y = 96;
    const e = w.spawnEnemy('offByOne', 70, 96);
    H.stepN(w, 1, idle);
    dirs.add(Math.sign(e.vy));
  }
  assert.equal(dirs.size, 2);
});

test('offByOne: a Clawd creeping up on it does not make it shudder on the 70 px line', () => {
  // Without the few pixels of hysteresis on the retreat, a closing speed below the spider's 50 px/s flips it between
  // "back away" and "strafe" every other tick (72 to 146 switches in these 3 s); with it, a few slow cycles.
  for (const closing of [15, 30, 40]) {
    const { w, e } = setup(88, 96); // 72 px away, in the strafe band
    let last = null;
    let switches = 0;
    for (let i = 0; i < 180; i++) {
      w.player.x = Math.max(60, w.player.x - closing / 60); // Clawd walks at it, `closing` px/s
      H.stepN(w, 1, idle);
      const radial = ((e.x - w.player.x) * e.vx + (e.y - w.player.y) * e.vy) / Math.hypot(e.x - w.player.x, e.y - w.player.y);
      const retreating = radial > 25;
      if (last !== null && retreating !== last) switches++;
      last = retreating;
    }
    assert.ok(switches <= 24, `closing ${closing} px/s: ${switches} retreat/strafe switches in 3 s`);
  }
});

test('offByOne: stays in the arena and publishes no velocity into the wall it is cornered against', () => {
  const { CB, w, e } = setup(13, 25);
  w.player.x = 50;
  w.player.y = 60; // 51 px away: it wants to back into the corner
  H.stepN(w, 30, idle);
  assert.ok(e.x >= CB.ARENA.x + e.r - 1e-9 && e.y >= CB.ARENA.y + e.r - 1e-9, `${e.x}, ${e.y}`);
  assert.ok(Math.abs(e.vx) < 1e-6 && Math.abs(e.vy) < 1e-6, `${e.vx}, ${e.vy}`);
  const far = setup(300, 160);
  far.w.player.x = 280;
  far.w.player.y = 150;
  H.stepN(far.w, 120, idle);
  assert.ok(far.e.x <= CB.ARENA.x + CB.ARENA.w - far.e.r + 1e-9 && far.e.y <= CB.ARENA.y + CB.ARENA.h - far.e.r + 1e-9);
});

test('offByOne: faces the way it is moving', () => {
  let { w, e } = setup(130, 96); // backs off to the left
  H.stepN(w, 5, idle);
  assert.equal(e.facing, -1);
  ({ w, e } = setup(20, 96)); // closes in to the right
  H.stepN(w, 5, idle);
  assert.equal(e.facing, 1);
});

test('offByOne: sitting exactly on the player stays finite, backs off, and still shoots', () => {
  const { w, e } = setup(160, 96);
  const shots = spyShots(w, e);
  H.stepN(w, 200, idle);
  for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(e[k]), `${k} ${e[k]}`);
  assert.ok(Math.hypot(e.x - 160, e.y - 96) > 30, 'it should have walked away from the player');
  assert.equal(shots.length, 2);
  for (const s of shots) assert.ok(Number.isFinite(s.b.vx) && Number.isFinite(s.b.vy) && Math.abs(Math.hypot(s.b.vx, s.b.vy) - 70) < 1e-6);
});

test('offByOne: every event over 15 s of fighting carries a finite x and y', () => {
  const { w } = setup(60, 96);
  w.spawnEnemy('offByOne', 250, 150);
  H.stepN(w, 900, (i) => H.makeInput({ aimX: 300, aimY: 30, moveX: Math.sin(i / 40), moveY: Math.cos(i / 55), fire: i % 7 < 3 }));
  assert.ok(w.events.some((ev) => ev.type === 'enemyShoot'));
  for (const ev of w.events) assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y), `${ev.type} ${ev.x}, ${ev.y}`);
  for (const b of w.eBullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

test('offByOne: the same seed always plays out the same fight', () => {
  const fight = (seed) => {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed, god: true });
    w.player.x = 160;
    w.player.y = 96;
    const a = w.spawnEnemy('offByOne', 60, 96);
    const b = w.spawnEnemy('offByOne', 250, 40);
    H.stepN(w, 400, idle);
    return [a.x, a.y, b.x, b.y, w.eBullets.length, w.rng.next()];
  };
  assert.deepEqual(fight(5), fight(5));
});

// An elite P0 (timeScale 1.2) runs its whole life 20% faster: 20% more ground, volleys 20% sooner, tell stays 0.4 s of real time.
test('offByOne: an elite moves 20% faster and fires 20% sooner, and reports the speed it really moves at', () => {
  const CB = H.load(EXTRA_FILES);
  const w = CB.createWorld({ seed: 2, god: true });
  w.player.x = 160;
  w.player.y = 96;
  const e = w.spawnEnemy('offByOne', 130, 96, { elite: true });
  assert.equal(e.elite, true);
  assert.equal(e.hp, 7); // ceil(4 * 1.75)
  const shots = spyShots(w, e);
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 60) < 1e-6, `|v| ${Math.hypot(e.vx, e.vy)}`);
  H.stepN(w, 400, idle);
  assert.deepEqual(shots.map((s) => s.tick), [150, 156, 290, 296]);
  for (const s of shots) assert.equal(s.speed, 70, 'bullets are not sped up');
});

// ---- drawing ------------------------------------------------------------------------------------------------------------------

// Records the calls draw() makes. It has no text/measure/disc on purpose: the spider must not need the font.
function fakeRenderer() {
  const log = [];
  return {
    log,
    rect: (x, y, w, h, c) => log.push({ kind: 'rect', x, y, w, h, c }),
    sprite: (name, x, y, o) => log.push({ kind: 'sprite', name, x, y, o: o || {} }),
    line: (x1, y1, x2, y2, c) => log.push({ kind: 'line', x1, y1, x2, y2, c }),
    alpha: (a, fn) => {
      log.push({ kind: 'alpha', a });
      fn();
    },
  };
}
const drawn = (CB, e, t) => {
  const r = fakeRenderer();
  CB.Enemies.offByOne.draw(e, r, t == null ? e.t : t);
  return r.log;
};
const spriteOf = (log) => log.find((c) => c.kind === 'sprite');
const whiteEyes = (CB, log) => log.filter((c) => c.kind === 'rect' && c.c === CB.Pal.C.white && c.w === 1 && c.h === 2);

test('offByOne: draw shows a shadow, the sprite, and the white hit flash', () => {
  const { CB, e } = setup(100, 100);
  const C = CB.Pal.C;
  let log = drawn(CB, e);
  const sp = spriteOf(log);
  assert.ok(/^offByOne_[01]$/.test(sp.name));
  assert.equal(sp.x, 100);
  assert.equal(sp.y, 100);
  assert.equal(sp.o.white, false);
  assert.equal(sp.o.flip, false);
  const shadow = log.find((c) => c.kind === 'rect' && c.c === C.ink && c.h === 2);
  assert.ok(shadow && shadow.w === 10 && shadow.y === 100 + 5 - 1 && shadow.x === 95, 'ground shadow under the feet');
  const shadowAlpha = log.find((c) => c.kind === 'alpha');
  assert.ok(Math.abs(shadowAlpha.a - 0.3) < 1e-9, 'the shadow is drawn at alpha 0.3');
  e.facing = -1;
  e.hitFlash = 0.05;
  log = drawn(CB, e);
  assert.equal(spriteOf(log).o.flip, true);
  assert.equal(spriteOf(log).o.white, true);
});

test('offByOne: the leg shuffle alternates the two frames about every 0.12 s', () => {
  const { CB, e } = setup(100, 100);
  const seen = [];
  for (let i = 0; i < 60; i++) {
    e.t = i / 60;
    seen.push(spriteOf(drawn(CB, e)).name);
  }
  assert.equal(new Set(seen).size, 2);
  let switches = 0;
  for (let i = 1; i < seen.length; i++) if (seen[i] !== seen[i - 1]) switches++;
  assert.ok(switches >= 6 && switches <= 10, `${switches} frame switches in a second`);
});

test('offByOne: a purple tick mark floats above it, 1 px right of centre, in white while hit', () => {
  const { CB, e } = setup(100, 100);
  const C = CB.Pal.C;
  const tick = (log) => log.find((c) => c.kind === 'rect' && c.w === 1 && c.h === 3 && (c.c === C.purple || c.c === C.white));
  let log = drawn(CB, e);
  const t = tick(log);
  assert.ok(t, 'a 1x3 tick');
  assert.equal(t.c, C.purple);
  assert.equal(t.x, 100 + 1);
  assert.ok(t.y + t.h <= 100 - 5, `above the 10 px sprite: ${t.y}..${t.y + t.h}`);
  const back = log.find((c) => c.kind === 'rect' && c.c === C.ink && c.h === 5);
  assert.ok(back && back.x <= t.x - 1 && back.x + back.w >= t.x + 2, 'inked on both sides so it reads on a wall');
  e.facing = -1;
  assert.equal(tick(drawn(CB, e)).x, 101, 'it does not mirror with the sprite');
  e.hitFlash = 0.05;
  assert.equal(tick(drawn(CB, e)).c, C.white);
});

// Steps to an absolute tick and asks how many white eye rects are drawn.
function eyesAt(CB, w, e, tick) {
  H.stepN(w, tick - tickOf(w), idle);
  return whiteEyes(CB, drawn(CB, e)).length;
}

test('offByOne: the eyes blink white for 0.4 s before a burst, hold white while the second bullet is pending, then go quiet', () => {
  const { CB, w, e } = setup(60, 96);
  assert.equal(eyesAt(CB, w, e, 150), 0, 'quiet well before the burst');
  assert.equal(eyesAt(CB, w, e, 155), 0, 'the tell opens at 2.6 s (tick 156), not before');
  assert.equal(eyesAt(CB, w, e, 159), 2, 'first frames of the tell are lit, so it reads at once');
  assert.equal(eyesAt(CB, w, e, 168), 0, 'the blink has an off half');
  assert.equal(eyesAt(CB, w, e, 176), 2, 'and it is lit again as the burst goes out');
  assert.equal(eyesAt(CB, w, e, 184), 2, 'solid between the two bullets');
  assert.equal(eyesAt(CB, w, e, 200), 0, 'quiet after the burst');
  assert.equal(eyesAt(CB, w, e, 330), 2, 'the tell comes back before the next burst (5.4 s)');
});

test('offByOne: the tell blinks no faster than 4 Hz in calm mode', () => {
  const { CB, w, e } = setup(60, 96, EXTRA_FILES);
  CB.Comfort.set(true);
  assert.equal(CB.Comfort.calm(), true);
  assert.equal(eyesAt(CB, w, e, 159), 0, 'calm: this is the off half of a 4 Hz blink');
  assert.equal(eyesAt(CB, w, e, 168), 2, 'calm: and this one is lit');
  const again = setup(60, 96, EXTRA_FILES);
  assert.equal(again.CB.Comfort.calm(), false);
  assert.equal(eyesAt(again.CB, again.w, again.e, 159), 2, 'normal blink rate: lit here');
  assert.equal(eyesAt(again.CB, again.w, again.e, 168), 0, 'normal blink rate: dark here');
});

test('offByOne: no eye overlay while the sprite is flashing white, and an elite keeps a 0.4 s tell in real time', () => {
  const { CB, w, e } = setup(60, 96);
  H.stepN(w, 159, idle);
  e.hitFlash = 0.05;
  assert.equal(whiteEyes(CB, drawn(CB, e)).length, 0);
  const E = H.load(EXTRA_FILES);
  const w2 = E.createWorld({ seed: 2, god: true });
  w2.player.x = 160;
  w2.player.y = 96;
  const e2 = w2.spawnEnemy('offByOne', 60, 96, { elite: true });
  // The elite's first burst is at tick 150; its tell covers the 24 ticks before it.
  assert.equal(eyesAt(E, w2, e2, 124), 0);
  assert.equal(eyesAt(E, w2, e2, 128), 2);
});

test('offByOne: draw needs no font, and runs at the arena edges and with a missing alpha', () => {
  const { CB, w, e } = setup(13, 25);
  H.stepN(w, 10, idle);
  e.alpha = undefined;
  assert.doesNotThrow(() => drawn(CB, e));
  e.x = 307;
  e.y = 167;
  e.alpha = 0.5;
  assert.doesNotThrow(() => drawn(CB, e, 0.123));
});

// ---- sprites ------------------------------------------------------------------------------------------------------------------

test('offByOne: sprites are defined', () => {
  const CB = H.load(FILES);
  assert.ok(CB.Art.hasSprite('offByOne_0') && CB.Art.hasSprite('offByOne_1'));
});

test('offByOne: sprite art is an ink-outlined 12x10 purple spider with red eyes, and only its legs shuffle', () => {
  const CB = H.load(FILES);
  const f = [0, 1].map((i) => CB.Art.spriteDef('offByOne_' + i));
  for (const d of f) {
    assert.equal(d.w, 12);
    assert.equal(d.h, 10);
    const all = d.rows.join('');
    for (const ch of 'kpPrRw') assert.ok(all.includes(ch), `uses ${ch}`);
    assert.ok(all.split('k').length - 1 >= 16, 'a real outline around the body (it opens only where a leg leaves)');
    assert.equal(d.rows[0].slice(4, 8), 'kkkk', 'inked across the top of the head');
    assert.equal(d.rows[9].slice(4, 8), 'kkkk', 'and across the bottom of the abdomen');
    for (const ch of new Set(all)) assert.ok(ch === '.' || ch in CB.Pal.CHARS, `palette char ${ch}`);
    // Two eyes, each a bright red pixel over a dark red one, at the columns the white tell paints over.
    assert.equal(d.rows[2][4], 'r');
    assert.equal(d.rows[2][7], 'r');
    assert.equal(d.rows[3][4], 'R');
    assert.equal(d.rows[3][7], 'R');
    assert.equal((all.match(/[rR]/g) || []).length, 4, 'exactly two 1x2 eyes');
    // The body (the four middle columns) is solid: no hole opens to the outside.
    for (let y = 0; y < d.h; y++) {
      for (let x = 4; x <= 7; x++) {
        if (d.rows[y][x] === 'k') continue;
        assert.notEqual(d.rows[y][x], '.', `hole in the body at ${x},${y}`);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = d.rows[y + dy] && d.rows[y + dy][x + dx];
          assert.ok(n && n !== '.', `pixel ${d.rows[y][x]} at ${x},${y} is open to the outside`);
        }
      }
    }
    // Eight legs: four stubs on each side, anchored in the body edge (a purple pixel in column 2/3 or 8/9).
    const side = (cols) => d.rows.reduce((n, row) => n + [...row].filter((c, x) => cols.includes(x) && (c === 'p' || c === 'P')).length, 0);
    assert.ok(side([0, 1, 2]) >= 12 && side([9, 10, 11]) >= 12, 'legs on both sides');
  }
  const diff = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) if (f[0].rows[y][x] !== f[1].rows[y][x]) diff.push(x);
  assert.ok(diff.length >= 8, 'the legs really move');
  assert.ok(diff.every((x) => x <= 2 || x >= 9), 'nothing but the legs differs between the two frames');
});

test('offByOne: the white eye overlay lands exactly on the sprite eyes', () => {
  const { CB, w, e } = setup(60, 96);
  H.stepN(w, 159, idle);
  const log = drawn(CB, e);
  const eyes = whiteEyes(CB, log);
  assert.equal(eyes.length, 2);
  const left = Math.round(e.x - 6);
  const top = Math.round(e.y - 5);
  for (const f of [0, 1]) {
    const d = CB.Art.spriteDef('offByOne_' + f);
    for (const rect of eyes) {
      for (let dy = 0; dy < rect.h; dy++) {
        const ch = d.rows[rect.y + dy - top][rect.x - left];
        assert.ok(ch === 'r' || ch === 'R', `frame ${f}: white over ${ch} at ${rect.x - left},${rect.y + dy - top}`);
      }
    }
  }
  const sx = eyes.map((r) => r.x - left).sort((a, b) => a - b);
  assert.equal(sx[0] + sx[1], 11, 'the eyes sit symmetrically, so mirroring the sprite changes nothing');
});
