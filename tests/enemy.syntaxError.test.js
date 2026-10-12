'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/syntaxError.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

test('syntaxError: stats', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('syntaxError', 100, 100);
  assert.equal(e.hp, 3);
  assert.equal(e.maxHp, 3);
  assert.equal(e.r, 5);
  assert.equal(e.targetable, true);
  assert.equal(e.contact, true);
  assert.equal(e.regular, true);
});

test('syntaxError: closes ~38 px/s toward the player', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 240;
  w.player.y = 96;
  const e = w.spawnEnemy('syntaxError', 60, 96);
  H.stepN(w, 60, idle);
  assert.ok(e.x - 60 > 33 && e.x - 60 < 40, `dx ${e.x - 60}`);
  assert.ok(Math.abs(e.y - 96) < 6);
});

test('syntaxError: dies after 3 damage', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('syntaxError', 100, 60);
  w.damageEnemy(e, 1);
  w.damageEnemy(e, 1);
  assert.equal(e.dead, false);
  w.damageEnemy(e, 1);
  assert.equal(e.dead, true);
});

test('syntaxError: sprites are defined', () => {
  const CB = H.load(FILES);
  assert.ok(CB.Art.hasSprite('syntaxError_0') && CB.Art.hasSprite('syntaxError_1'));
});

// ---- extra guards (Task 10 owns this file) ------------------------------------------------------------------------------------

function chase(px, py, ex, ey) {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1, god: true });
  w.player.x = px;
  w.player.y = py;
  const e = w.spawnEnemy('syntaxError', ex, ey);
  return { CB, w, e };
}

test('syntaxError: wobbles sideways at 3 Hz, 10 px/s, and publishes the velocity it really moved at', () => {
  const { w, e } = chase(280, 96, 40, 96);
  H.stepN(w, 5, idle); // e.t = 5/60 s: sin(2π·3·e.t) = 1
  assert.ok(Math.abs(e.vx - 38) < 0.1, `vx ${e.vx}`);
  assert.ok(Math.abs(e.vy - 10) < 0.3, `vy ${e.vy}`);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 20; i++) {
    H.stepN(w, 1, idle);
    lo = Math.min(lo, e.y);
    hi = Math.max(hi, e.y);
  }
  assert.ok(hi - lo > 0.8, `the wobble should swing the beetle about a pixel, saw ${hi - lo}`);
  assert.ok(hi - lo < 2.5, `but not more than that, saw ${hi - lo}`);
});

test('syntaxError: faces the way it is chasing, and the wobble does not flip it on a vertical chase', () => {
  let { w, e } = chase(40, 96, 200, 96);
  H.stepN(w, 3, idle);
  assert.equal(e.facing, -1);
  ({ w, e } = chase(280, 96, 100, 96));
  H.stepN(w, 3, idle);
  assert.equal(e.facing, 1);
  ({ w, e } = chase(100, 30, 100, 150)); // straight up: the sideways wobble swings vx between about -10 and +10
  e.facing = -1;
  let sawBothSigns = [false, false];
  for (let i = 0; i < 60; i++) {
    H.stepN(w, 1, idle);
    assert.equal(e.facing, -1, `tick ${i}`);
    sawBothSigns[e.vx < 0 ? 0 : 1] = true;
  }
  assert.deepEqual(sawBothSigns, [true, true], 'the test only means something if vx really changes sign');
});

test('syntaxError: stays finite when it sits exactly on the player, and turns around once the player moves', () => {
  const { w, e } = chase(160, 96, 160, 96);
  H.stepN(w, 20, idle);
  for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(e[k]), `${k} ${e[k]}`);
  const x1 = e.x;
  w.player.x = 60;
  H.stepN(w, 30, idle);
  assert.ok(e.x < x1 - 10, `it should head for the player again, x ${x1} -> ${e.x}`);
});

test('syntaxError: is kept inside the arena and publishes no velocity into a wall it is pressed against', () => {
  const { CB, w, e } = chase(30, 40, 0, 0);
  H.stepN(w, 1, idle);
  assert.ok(e.x >= CB.ARENA.x + e.r && e.y >= CB.ARENA.y + e.r, `${e.x}, ${e.y}`);
  // Chasing straight up the left wall, the sideways wobble pushes into the wall on every other half-swing.
  const { CB: CB2, w: w2, e: e2 } = chase(13, 30, 13, 120);
  const wall = CB2.ARENA.x + e2.r;
  let pressed = 0;
  for (let i = 0; i < 90; i++) {
    const before = e2.x;
    H.stepN(w2, 1, idle);
    assert.ok(e2.x >= wall - 1e-9, `x ${e2.x}`);
    if (before <= wall + 1e-9 && e2.x <= wall + 1e-9) {
      pressed++;
      assert.ok(e2.vx >= -1e-9, `vx ${e2.vx} points into the wall`);
    }
  }
  assert.ok(pressed > 5, `the test should actually press on the wall (${pressed} ticks)`);
});

test('syntaxError: an elite (timeScale 1.2) covers 20% more ground and reports it', () => {
  const { w, e } = chase(300, 96, 40, 96);
  e.timeScale = 1.2;
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(e.x - 40 - 45.6) < 1.0, `dx ${e.x - 40}`);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 1.2 * Math.hypot(38, 10 * Math.sin(2 * Math.PI * 3 * e.t))) < 1.5, `|v| ${Math.hypot(e.vx, e.vy)}`);
});

// A fake renderer that records the calls draw() makes. It has no text/measure on purpose: the beetle must not need the font.
function fakeRenderer() {
  const log = [];
  const r = {
    log,
    rect: (x, y, w, h, c) => log.push({ kind: 'rect', x, y, w, h, c }),
    sprite: (name, x, y, o) => log.push({ kind: 'sprite', name, x, y, o: o || {} }),
    line: (x1, y1, x2, y2, c) => log.push({ kind: 'line', x1, y1, x2, y2, c }),
    alpha: (a, fn) => {
      log.push({ kind: 'alpha', a });
      fn();
    },
  };
  return r;
}

test('syntaxError: draw shows a shadow, the walk frame, the white hit flash and a 10 px yellow squiggle', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('syntaxError', 100, 100);
  const C = CB.Pal.C;
  const squiggle = (log) => log.filter((c) => c.kind === 'rect' && c.c === C.yellow);
  const frameOf = (log) => log.find((c) => c.kind === 'sprite');

  e.t = 0;
  let r = fakeRenderer();
  CB.Enemies.syntaxError.draw(e, r, 0);
  assert.equal(frameOf(r.log).name, 'syntaxError_0');
  assert.equal(frameOf(r.log).o.white, false);
  assert.equal(frameOf(r.log).o.flip, false);
  const shadow = r.log.find((c) => c.kind === 'rect' && c.c === C.ink);
  assert.ok(shadow && shadow.w === 10 && shadow.h === 2 && shadow.y === 100 + 5 - 1, 'ground shadow under the feet');
  const sq0 = squiggle(r.log);
  assert.equal(sq0.length, 10);
  assert.deepEqual(sq0.map((c) => c.x).sort((a, b) => a - b), [95, 96, 97, 98, 99, 100, 101, 102, 103, 104], '10 px wide, centred on the beetle');
  assert.equal(new Set(sq0.map((c) => c.y)).size, 2, 'a two-row zigzag');
  assert.ok(sq0.every((c) => c.w === 1 && c.h === 1 && c.y > 100 + 4), '1 px, below the sprite');
  const rowAt = (list, x) => list.find((c) => c.x === x).y;

  r = fakeRenderer();
  CB.Enemies.syntaxError.draw(e, r, 0.13); // floor(0.13 * 8) = 1: the zigzag shifts by one
  const sq1 = squiggle(r.log);
  assert.notEqual(rowAt(sq0, 95), rowAt(sq1, 95));
  r = fakeRenderer();
  CB.Enemies.syntaxError.draw(e, r, 0.26); // floor(0.26 * 8) = 2: back to the start
  assert.equal(rowAt(sq0, 95), rowAt(squiggle(r.log), 95));

  e.t = 0.16;
  e.facing = -1;
  e.hitFlash = 0.05;
  r = fakeRenderer();
  CB.Enemies.syntaxError.draw(e, r, 0);
  assert.equal(frameOf(r.log).name, 'syntaxError_1');
  assert.equal(frameOf(r.log).o.flip, true);
  assert.equal(frameOf(r.log).o.white, true);
});

test('syntaxError: sprite art is an ink-outlined 12x10 beetle in two reds, and the two frames differ', () => {
  const CB = H.load(FILES);
  const frames = [0, 1].map((i) => CB.Art.spriteDef('syntaxError_' + i));
  for (const d of frames) {
    assert.equal(d.w, 12);
    assert.equal(d.h, 10);
    const all = d.rows.join('');
    for (const ch of 'kwrR') assert.ok(all.includes(ch), `uses ${ch}`);
    assert.ok(all.split('k').length - 1 >= 25, 'a real outline, not a few ink pixels');
    for (const ch of new Set(all)) assert.ok(ch === '.' || ch in CB.Pal.CHARS, `palette char ${ch}`);
    // The shell and the eye are enclosed: no bright-red or white pixel touches transparency or the sprite's edge.
    // (Legs and the antenna are thin dark-red strokes outside the outline, so they read on the near-ink floor.)
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = d.rows[y][x];
        if (ch !== 'r' && ch !== 'w') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = d.rows[y + dy] && d.rows[y + dy][x + dx];
          assert.ok(n && n !== '.', `pixel ${ch} at ${x},${y} is not enclosed by ink (${d.name})`);
        }
      }
    }
  }
  assert.notDeepEqual(frames[0].rows, frames[1].rows);
  assert.deepEqual(frames[0].rows.slice(0, 9), frames[1].rows.slice(0, 9), 'only the legs shuffle');
});
