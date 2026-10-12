'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/raceCondition.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

test('raceCondition: stats', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('raceCondition', 60, 96, { phase: 0 });
  assert.equal(e.hp, 1);
  assert.equal(e.r, 4);
});

test('raceCondition: a pair zigzags in opposite phase', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 280;
  w.player.y = 96;
  const a = w.spawnEnemy('raceCondition', 60, 90, { phase: 0 });
  const b = w.spawnEnemy('raceCondition', 60, 102, { phase: Math.PI });
  const ay0 = a.y;
  const by0 = b.y;
  H.stepN(w, 6, idle);
  assert.ok((a.y - ay0) * (b.y - by0) < 0, `a ${a.y - ay0} b ${b.y - by0}`);
});

test('raceCondition: advances ~62 px/s toward the player', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = 96;
  const e = w.spawnEnemy('raceCondition', 40, 96, { phase: 0 });
  H.stepN(w, 60, idle);
  assert.ok(e.x - 40 > 50 && e.x - 40 < 64, `dx ${e.x - 40}`);
});

// ---- beyond the plan: flags, zigzag shape, published velocity, arena, drawing -------------------------------------------------

function setup(ex, ey, opts, px, py) {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 3, god: true });
  w.player.x = px == null ? 300 : px;
  w.player.y = py == null ? 96 : py;
  const e = w.spawnEnemy('raceCondition', ex, ey, opts);
  return { CB, w, e };
}

test('raceCondition: a regular targetable contact enemy that dies to one hit', () => {
  const { w, e } = setup(60, 96, { phase: 0 });
  assert.equal(e.kind, 'raceCondition');
  assert.equal(e.regular, true);
  assert.equal(e.contact, true);
  assert.equal(e.targetable, true);
  assert.equal(e.boss, false);
  assert.equal(w.damageEnemy(e, 1), 1);
  assert.equal(e.dead, true);
  const ev = w.events.find((x) => x.type === 'enemyDie');
  assert.ok(ev && Number.isFinite(ev.x) && Number.isFinite(ev.y), 'enemyDie carries finite x, y');
});

test('raceCondition: the phase option defaults to 0 and is stored', () => {
  const { e } = setup(60, 96, undefined);
  assert.equal(e.data.phase, 0);
  const { e: f } = setup(60, 96, { phase: Math.PI });
  assert.equal(f.data.phase, Math.PI);
});

test('raceCondition: sideways velocity is 40 sin(4 pi t + phase) on top of a 62 px/s approach', () => {
  const { w, e } = setup(40, 96, { phase: 0 });
  // Player straight ahead on the same row: the heading is +x, the perpendicular is +y.
  H.stepN(w, 15, idle); // t = 0.25 s: sin(pi) = 0
  assert.ok(Math.abs(e.vy) < 3, `vy at the zero crossing ${e.vy}`);
  H.stepN(w, 7, idle); // t ~ 0.367 s: past the crossing, the sign has flipped to negative
  assert.ok(e.vy < -25, `vy ${e.vy}`);
  const sp = Math.hypot(e.vx, e.vy);
  assert.ok(sp > 62 && sp < 75, `speed ${sp}`);
  assert.ok(e.vx > 55, `vx ${e.vx}`);
});

test('raceCondition: the zigzag stays inside +-40 px/s sideways and averages out', () => {
  const { w, e } = setup(30, 96, { phase: 0 }, 310, 96);
  let ymin = 1e9;
  let ymax = -1e9;
  for (let i = 0; i < 90; i++) {
    H.stepN(w, 1, idle);
    ymin = Math.min(ymin, e.y);
    ymax = Math.max(ymax, e.y);
    assert.ok(Math.abs(e.vy) <= 40 + 2.5, `vy ${e.vy}`);
  }
  assert.ok(ymax - ymin > 4 && ymax - ymin < 14, `swing ${ymax - ymin}`);
  assert.ok(Math.abs(e.y - 96) < 8, `drift ${e.y - 96}`);
});

test('raceCondition: e.vx / e.vy are the real displacement per second', () => {
  const { w, e } = setup(60, 60, { phase: 1.3 }, 220, 130);
  for (let i = 0; i < 40; i++) {
    const x0 = e.x;
    const y0 = e.y;
    H.stepN(w, 1, idle);
    assert.ok(Math.abs(e.vx * (1 / 60) - (e.x - x0)) < 1e-9, `tick ${i} vx ${e.vx} dx ${e.x - x0}`);
    assert.ok(Math.abs(e.vy * (1 / 60) - (e.y - y0)) < 1e-9, `tick ${i} vy ${e.vy} dy ${e.y - y0}`);
  }
  assert.ok(Math.hypot(e.vx, e.vy) > 30);
});

test('raceCondition: faces the way it runs', () => {
  const { w, e } = setup(200, 96, { phase: 0 }, 40, 96);
  H.stepN(w, 5, idle);
  assert.equal(e.facing, -1);
  const { w: w2, e: e2 } = setup(40, 96, { phase: 0 }, 250, 96);
  H.stepN(w2, 5, idle);
  assert.equal(e2.facing, 1);
});

test('raceCondition: homes in on a player who moves', () => {
  const { w, e } = setup(60, 50, { phase: 0 }, 250, 150);
  const d0 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  H.stepN(w, 60, idle);
  const d1 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  assert.ok(d0 - d1 > 45, `closed ${d0 - d1}`);
  w.player.x = 40;
  w.player.y = 40;
  const e0x = e.x;
  H.stepN(w, 60, idle);
  assert.ok(e.x < e0x - 30, `turned around: ${e0x} -> ${e.x}`);
});

test('raceCondition: stays inside the arena and does not freeze on top of the player', () => {
  const { w, e } = setup(12, 25, { phase: 0 }, 12, 25);
  H.stepN(w, 120, idle);
  const a = w.arena;
  assert.ok(e.x >= a.x + e.r && e.x <= a.x + a.w - e.r, `x ${e.x}`);
  assert.ok(e.y >= a.y + e.r && e.y <= a.y + a.h - e.r, `y ${e.y}`);
  assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.vx) && Number.isFinite(e.vy));
  const { w: w2, e: e2 } = setup(300, 160, { phase: 0 }, 310, 170);
  H.stepN(w2, 200, idle);
  assert.ok(e2.x <= w2.arena.x + w2.arena.w - e2.r + 1e-9 && e2.y <= w2.arena.y + w2.arena.h - e2.r + 1e-9);
});

test('raceCondition: same seed, same path (no hidden randomness)', () => {
  const run = () => {
    const { w, e } = setup(60, 70, { phase: 0.7 }, 250, 140);
    H.stepN(w, 90, idle);
    return [e.x, e.y, e.vx, e.vy];
  };
  assert.deepEqual(run(), run());
});

test('raceCondition: a timeScale only speeds the update up; the published velocity stays the real one', () => {
  const { w, e } = setup(40, 96, { phase: 0 }, 300, 96);
  e.timeScale = 1.2;
  H.stepN(w, 59, idle);
  const x0 = e.x;
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(e.vx * (1 / 60) - (e.x - x0)) < 1e-9, `vx ${e.vx} vs dx/dt ${(e.x - x0) * 60}`);
  assert.ok(e.x - 40 > 60 && e.x - 40 < 78, `dx ${e.x - 40}`);
});

// ---- sprites -------------------------------------------------------------------------------------------------------------------

test('raceCondition: three 10x8 scurry frames, yellow with an ink outline and two shades', () => {
  const CB = H.load(FILES);
  const frames = [0, 1, 2].map((i) => CB.Art.spriteDef('raceCondition_' + i));
  frames.forEach((d, i) => {
    assert.ok(d, `frame ${i} defined`);
    assert.equal(d.w, 10);
    assert.equal(d.h, 8);
    const px = d.rows.join('');
    for (const ch of 'kyY') assert.ok(px.includes(ch), `frame ${i} uses ${ch}`);
    for (const ch of new Set(px)) assert.ok(ch === '.' || 'kyYw'.includes(ch), `frame ${i} unexpected char ${ch}`);
    // every light-yellow pixel is boxed in by opaque pixels: the ink outline closes the body
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (d.rows[y][x] !== 'y') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          assert.ok(nx >= 0 && ny >= 0 && nx < d.w && ny < d.h && d.rows[ny][nx] !== '.', `frame ${i}: y at ${x},${y} is exposed`);
        }
      }
    }
  });
  assert.notDeepEqual(H.plain(frames[0].rows), H.plain(frames[1].rows));
  assert.notDeepEqual(H.plain(frames[1].rows), H.plain(frames[2].rows));
  assert.notDeepEqual(H.plain(frames[0].rows), H.plain(frames[2].rows));
});

function spyRenderer() {
  const calls = [];
  let alpha = 1;
  const r = {
    calls,
    sprite: (name, x, y, o) => calls.push({ k: 'sprite', name, x, y, o: o || {}, alpha }),
    rect: (x, y, w, h, c) => calls.push({ k: 'rect', x, y, w, h, c, alpha }),
    line: (x1, y1, x2, y2, c) => calls.push({ k: 'line', x1, y1, x2, y2, c, alpha }),
    disc: (x, y, rr, c) => calls.push({ k: 'disc', x, y, rr, c, alpha }),
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
  return r;
}

test('raceCondition: draw cycles three frames at 0.08 s each and flashes white on a hit', () => {
  const { CB, e } = setup(100, 96, { phase: 0 });
  const mod = CB.Enemies.raceCondition;
  const frameAt = (t) => {
    e.t = t;
    const r = spyRenderer();
    mod.draw(e, r, t);
    const s = r.calls.find((c) => c.k === 'sprite');
    assert.ok(s, 'a sprite is drawn');
    return s.name;
  };
  assert.equal(frameAt(0.01), 'raceCondition_0');
  assert.equal(frameAt(0.09), 'raceCondition_1');
  assert.equal(frameAt(0.17), 'raceCondition_2');
  assert.equal(frameAt(0.25), 'raceCondition_0');
  e.t = 0.01;
  e.hitFlash = 0.05;
  const r = spyRenderer();
  mod.draw(e, r, 0.01);
  assert.equal(r.calls.find((c) => c.k === 'sprite').o.white, true);
  e.hitFlash = 0;
  const r2 = spyRenderer();
  mod.draw(e, r2, 0.01);
  assert.equal(r2.calls.find((c) => c.k === 'sprite').o.white, false);
});

const xsOf = (c) => (c.k === 'line' ? [c.x1, c.x2] : [c.x, c.x + (c.w || 0)]);

test('raceCondition: draw puts a shadow under the ant and a faded speed streak behind it', () => {
  const { CB, e } = setup(100, 96, { phase: 0 });
  const mod = CB.Enemies.raceCondition;
  e.facing = 1;
  e.vx = 60;
  e.vy = 0;
  const r = spyRenderer();
  mod.draw(e, r, 0.5);
  const sprite = r.calls.find((c) => c.k === 'sprite');
  const shadow = r.calls.find((c) => c.k === 'rect' && c.y > e.y + 1 && c.alpha < 1);
  assert.ok(shadow, 'a translucent ground shadow below the body');
  assert.ok(r.calls.indexOf(shadow) < r.calls.indexOf(sprite), 'the shadow is drawn before the sprite');
  const streaks = r.calls.filter((c) => (c.k === 'rect' || c.k === 'line') && c !== shadow);
  assert.ok(streaks.length >= 2, 'two speed lines');
  for (const s of streaks) {
    assert.ok(s.alpha < 1, 'speed lines are drawn with alpha');
    for (const x of xsOf(s)) assert.ok(x < e.x, `streak behind a right-running ant (x ${x})`);
  }
  // running left puts the streak on the right
  e.facing = -1;
  e.vx = -60;
  const r2 = spyRenderer();
  mod.draw(e, r2, 0.5);
  const sh2 = r2.calls.find((c) => c.k === 'rect' && c.y > e.y + 1 && c.alpha < 1);
  const streaks2 = r2.calls.filter((c) => (c.k === 'rect' || c.k === 'line') && c !== sh2);
  assert.ok(streaks2.length >= 2);
  for (const s of streaks2) for (const x of xsOf(s)) assert.ok(x > e.x, `streak behind a left-running ant (x ${x})`);
  // standing still (or just spawned) leaves no streak
  e.vx = 0;
  e.vy = 0;
  const r3 = spyRenderer();
  mod.draw(e, r3, 0.5);
  assert.equal(r3.calls.filter((c) => c.k === 'line').length, 0);
});

test('raceCondition: draw passes the ant\'s alpha on to the sprite', () => {
  const { CB, e } = setup(100, 96, { phase: 0 });
  const mod = CB.Enemies.raceCondition;
  e.alpha = 0.5;
  const r = spyRenderer();
  mod.draw(e, r, 0.1);
  const s = r.calls.find((c) => c.k === 'sprite');
  assert.ok(s.o.alpha === 0.5 || s.alpha === 0.5, 'alpha reaches the sprite');
});
