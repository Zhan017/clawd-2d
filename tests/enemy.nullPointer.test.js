'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/nullPointer.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

function setup() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 4, god: true });
  w.player.x = 200;
  w.player.y = 110;
  const e = w.spawnEnemy('nullPointer', 60, 60);
  return { CB, w, e };
}
const at = (w, seconds, from) => H.stepN(w, Math.round((seconds - (from || 0)) * 60), idle);

test('nullPointer: full cycle with correct flags and timings', () => {
  const { w, e } = setup();
  at(w, 0.5);
  assert.equal(e.state, 'wander');
  assert.equal(e.targetable, true);
  at(w, 1.6, 0.5);
  assert.equal(e.state, 'vanish');
  assert.equal(e.visible, false);
  assert.equal(e.targetable, false);
  assert.equal(e.contact, false);
  at(w, 2.45, 1.6);
  assert.equal(e.state, 'appear');
  assert.equal(e.targetable, false);
  assert.equal(e.contact, false);
  const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  assert.ok(d >= 49.5 && d <= 60.5, `appear distance ${d}`);
  at(w, 2.9, 2.45);
  assert.equal(e.state, 'lunge');
  assert.equal(e.targetable, true);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 130) < 1, `lunge speed ${Math.hypot(e.vx, e.vy)}`);
  at(w, 3.35, 2.9);
  assert.equal(e.state, 'wander');
});

test('nullPointer: bolts pass through while vanished', () => {
  const { w, e } = setup();
  at(w, 1.7);
  assert.equal(e.state, 'vanish');
  w.firePlayerBolt(e.x - 10, e.y, 0);
  H.stepN(w, 6, idle);
  assert.equal(e.hp, 2);
  assert.equal(w.damageEnemy(e, 1), 0);
});

// ---- beyond the plan's two tests: stats, timeline, velocity, the reappearance and the lunge ----------------------------------

test('nullPointer: stats and starting flags', () => {
  const { w, e } = setup();
  assert.equal(e.hp, 2);
  assert.equal(e.maxHp, 2);
  assert.equal(e.r, 5);
  assert.equal(e.state, 'wander');
  assert.equal(e.regular, true);
  assert.equal(e.boss, false);
  assert.equal(e.targetable, true);
  assert.equal(e.contact, true);
  assert.equal(e.visible, true);
  assert.equal(e.alpha, 1);
  assert.equal(w.damageEnemy(e, 1), 1);
  assert.equal(e.dead, false);
  assert.equal(w.damageEnemy(e, 1), 1);
  assert.equal(e.dead, true);
});

test('nullPointer: state changes land on 1.5, 2.3, 2.8 and 3.2 s, and the cycle repeats', () => {
  const { w, e } = setup();
  const seen = [];
  for (let i = 0; i < 400; i++) {
    const before = e.state;
    H.stepN(w, 1, idle);
    if (e.state !== before) seen.push([i + 1, e.state]);
  }
  const order = seen.map((s) => s[1]);
  assert.deepEqual(order.slice(0, 5), ['vanish', 'appear', 'lunge', 'wander', 'vanish']);
  const ticks = seen.map((s) => s[0]);
  const want = [90, 138, 168, 192, 282];
  for (let i = 0; i < want.length; i++) assert.ok(Math.abs(ticks[i] - want[i]) <= 1, `change ${i} at tick ${ticks[i]}, wanted ${want[i]}`);
});

test('nullPointer: wanders at 30 px/s and publishes the actual velocity, 0 while it stands still', () => {
  const { w, e } = setup();
  H.stepN(w, 20, idle);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 30) < 1e-6, `wander speed ${Math.hypot(e.vx, e.vy)}`);
  const x0 = e.x;
  const y0 = e.y;
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(Math.hypot(e.x - x0, e.y - y0) * 60 - 30) < 1e-6, 'moved by exactly what it published');
  at(w, 1.7, 20 / 60 + 1 / 60);
  assert.equal(e.state, 'vanish');
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);
  at(w, 2.45, 1.7);
  assert.equal(e.state, 'appear');
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);
  const x1 = e.x;
  const y1 = e.y;
  H.stepN(w, 10, idle);
  assert.equal(e.x, x1, 'it stands still while the ring tightens');
  assert.equal(e.y, y1);
});

test('nullPointer: picks a new random heading every 0.5 s while wandering', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 4, god: true });
  w.player.x = 200;
  w.player.y = 110;
  const e = w.spawnEnemy('nullPointer', 160, 96); // mid-arena, so no wall clamps the heading
  const headings = [];
  for (let i = 0; i < 89; i++) {
    H.stepN(w, 1, idle);
    headings.push(Math.atan2(e.vy, e.vx));
  }
  const distinct = [];
  for (const h of headings) if (!distinct.some((d) => Math.abs(d - h) < 1e-6)) distinct.push(h);
  assert.equal(distinct.length, 3, `headings in 1.5 s of wandering: ${distinct.length}`);
});

test('nullPointer: reappears 50-60 px from the player inside the arena, from any seed and any player position', () => {
  const spots = [[200, 110], [160, 96], [14, 26], [306, 166], [14, 166], [306, 26], [20, 100], [160, 24], [160, 168]];
  for (let seed = 1; seed <= 10; seed++) {
    for (const [px, py] of spots) {
      const CB = H.load(FILES);
      const w = CB.createWorld({ seed, god: true });
      w.player.x = px;
      w.player.y = py;
      const e = w.spawnEnemy('nullPointer', 160, 96);
      at(w, 2.45);
      assert.equal(e.state, 'appear');
      const d = Math.hypot(e.x - px, e.y - py);
      assert.ok(d >= 49.5 && d <= 60.5, `seed ${seed} player ${px},${py}: appear distance ${d}`);
      const a = w.arena;
      assert.ok(e.x >= a.x + e.r - 1e-9 && e.x <= a.x + a.w - e.r + 1e-9 && e.y >= a.y + e.r - 1e-9 && e.y <= a.y + a.h - e.r + 1e-9, `seed ${seed} player ${px},${py}: inside the arena`);
    }
  }
});

test('nullPointer: the reappearance direction comes from the seeded rng, so the same seed repeats and seeds differ', () => {
  const run = (seed) => {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed, god: true });
    w.player.x = 160;
    w.player.y = 96;
    const e = w.spawnEnemy('nullPointer', 60, 60);
    at(w, 2.45);
    return [e.x, e.y];
  };
  assert.deepEqual(run(7), run(7));
  const spots = new Set([1, 2, 3, 4, 5, 6].map((s) => run(s).map((v) => v.toFixed(3)).join(',')));
  assert.ok(spots.size >= 4, `only ${spots.size} distinct reappearance points over 6 seeds`);
});

test('nullPointer: the appear fade-in ramps alpha 0 to 1 over 0.5 s', () => {
  const { w, e } = setup();
  at(w, 2.3);
  assert.equal(e.state, 'appear');
  assert.ok(e.alpha < 0.1, `alpha at the start ${e.alpha}`);
  at(w, 2.55, 2.3);
  assert.ok(e.alpha > 0.4 && e.alpha < 0.6, `alpha at half ${e.alpha}`);
  at(w, 2.78, 2.55);
  assert.equal(e.state, 'appear');
  assert.ok(e.alpha > 0.9 && e.alpha <= 1, `alpha near the end ${e.alpha}`);
  at(w, 2.9, 2.78);
  assert.equal(e.alpha, 1);
});

test('nullPointer: the lunge locks onto where the player was when it began', () => {
  const { w, e } = setup();
  at(w, 2.75);
  assert.equal(e.state, 'appear');
  const want = { x: w.player.x - e.x, y: w.player.y - e.y };
  const l = Math.hypot(want.x, want.y);
  at(w, 2.85, 2.75);
  assert.equal(e.state, 'lunge');
  const dot = (e.vx * want.x + e.vy * want.y) / (Math.hypot(e.vx, e.vy) * l);
  assert.ok(dot > 0.9999, `lunge heads at the player, dot ${dot}`);
  const v0 = [e.vx, e.vy];
  w.player.x = 30;
  w.player.y = 150;
  H.stepN(w, 5, idle);
  assert.equal(e.state, 'lunge');
  assert.ok(Math.abs(e.vx - v0[0]) < 1e-6 && Math.abs(e.vy - v0[1]) < 1e-6, 'it does not steer after the player');
});

test('nullPointer: a lunge catches a player who stands still, once, and never during the telegraph', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed });
    w.player.x = 200;
    w.player.y = 110;
    const e = w.spawnEnemy('nullPointer', 60, 60);
    const hearts = w.player.hearts;
    H.stepN(w, 168, idle);
    assert.equal(w.player.hearts, hearts, `seed ${seed}: untouched through wander, vanish and appear`);
    H.stepN(w, 40, idle);
    assert.equal(w.player.hearts, hearts - 1, `seed ${seed}: the lunge costs exactly one heart`);
    assert.equal(e.dead, false);
  }
});

test('nullPointer: never re-arms the spawn contact grace, and emits only events with finite x, y', () => {
  const { w, e } = setup();
  H.stepN(w, 30, idle);
  assert.ok(e.noContactT <= 1e-9, 'the world owns noContactT');
  let seen = 0;
  for (let i = 0; i < 600; i++) {
    H.stepN(w, 1, idle);
    assert.ok(e.noContactT <= 1e-9, `noContactT ${e.noContactT} at tick ${i}`);
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.vx) && Number.isFinite(e.vy));
    for (const ev of w.events) {
      seen++;
      assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y), `event ${ev.type} without a finite x, y`);
    }
    w.events.length = 0;
  }
  assert.ok(seen > 0, 'the lunge on a god-mode player is an event worth checking');
});

test('nullPointer: stays inside the arena over a long fight', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 9, god: true });
  w.player.x = 12;
  w.player.y = 24;
  const e = w.spawnEnemy('nullPointer', 12, 24);
  const a = w.arena;
  for (let i = 0; i < 1800; i++) {
    H.stepN(w, 1, idle);
    assert.ok(e.x >= a.x + e.r - 1e-9 && e.x <= a.x + a.w - e.r + 1e-9, `x ${e.x} at tick ${i}`);
    assert.ok(e.y >= a.y + e.r - 1e-9 && e.y <= a.y + a.h - e.r + 1e-9, `y ${e.y} at tick ${i}`);
  }
});

test('nullPointer: an elite (timeScale 1.2) moves 20% faster on the same timeline', () => {
  const { w, e } = setup();
  e.timeScale = 1.2;
  H.stepN(w, 20, idle);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 36) < 1e-6, `elite wander speed ${Math.hypot(e.vx, e.vy)}`);
  at(w, 1.6, 20 / 60);
  assert.equal(e.state, 'vanish', 'state durations still run on real time');
  at(w, 2.9, 1.6);
  assert.equal(e.state, 'lunge');
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 156) < 1, `elite lunge speed ${Math.hypot(e.vx, e.vy)}`);
});

test('nullPointer: two sprite frames, 12x10, outlined in ink, pale with grey shading', () => {
  const CB = H.load(FILES);
  const frames = ['nullPointer_0', 'nullPointer_1'].map((n) => {
    assert.ok(CB.Art.hasSprite(n), n);
    return CB.Art.spriteDef(n);
  });
  for (const d of frames) {
    assert.equal(d.w, 12, `${d.name} width`);
    assert.equal(d.h, 10, `${d.name} height`);
    const rows = Array.from(d.rows);
    const used = new Set(rows.join('').split(''));
    for (const ch of ['k', 'e', 's', 'W']) assert.ok(used.has(ch), `${d.name} uses ${ch}`);
    let opaque = 0;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (rows[y][x] === '.') continue;
        opaque++;
        if (rows[y][x] === 'k') continue;
        // a coloured pixel must never border the outside (up, down, left or right), so ink closes the silhouette
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          assert.ok(nx >= 0 && ny >= 0 && nx < d.w && ny < d.h, `${d.name}: ${rows[y][x]} at ${x},${y} touches the sprite edge`);
          assert.notEqual(rows[ny][nx], '.', `${d.name}: ${rows[y][x]} at ${x},${y} is not enclosed by ink`);
        }
      }
    }
    assert.ok(opaque >= 50, `${d.name} has body (${opaque} px)`);
  }
  let diff = 0;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 12; x++) if (frames[0].rows[y][x] !== frames[1].rows[y][x]) diff++;
  assert.ok(diff >= 10, `the wing frames differ by ${diff} px`);
});

// ---- drawing -----------------------------------------------------------------------------------------------------------------

function fakeRenderer() {
  const log = { lines: [], sprites: [], rects: [], scopes: [] };
  let depth = 0;
  const r = {
    alpha(a, fn) {
      log.scopes.push(a);
      depth++;
      try {
        fn();
      } finally {
        depth--;
      }
    },
    rect(x, y, w, h, c) { log.rects.push({ x, y, w, h, c, scoped: depth > 0 }); },
    line(x1, y1, x2, y2, c) { log.lines.push({ x1, y1, x2, y2, c, scoped: depth > 0 }); },
    sprite(name, x, y, o) { log.sprites.push({ name, x, y, o: o || {} }); },
    disc() {}, ring() {}, frame() {}, text() {},
  };
  return { r, log };
}

test('nullPointer: draws a ground shadow and a flipped, flashing, flickering sprite', () => {
  const { CB, w, e } = setup();
  const mod = CB.Enemies.nullPointer;
  H.stepN(w, 5, idle);
  const { r, log } = fakeRenderer();
  e.facing = -1;
  e.hitFlash = 0.05;
  mod.draw(e, r, 0.1);
  assert.equal(log.sprites.length, 1);
  const s = log.sprites[0];
  assert.match(s.name, /^nullPointer_[01]$/);
  assert.equal(s.o.flip, true);
  assert.equal(s.o.white, true);
  const want = 0.75 + 0.25 * Math.sin(0.1 * 10);
  assert.ok(Math.abs(s.o.alpha - want) < 1e-9, `sprite alpha ${s.o.alpha}`);
  assert.equal(log.rects.length, 1, 'one shadow strip');
  assert.ok(log.rects[0].scoped, 'the shadow is drawn translucent');
  assert.equal(log.rects[0].c, CB.Pal.C.ink);
  assert.equal(log.lines.length, 0, 'no ring outside the telegraph');
  e.facing = 1;
  e.hitFlash = 0;
  log.sprites.length = 0;
  mod.draw(e, r, 0.1);
  assert.equal(log.sprites[0].o.flip, false);
  assert.equal(log.sprites[0].o.white, false);
});

test('nullPointer: both wing frames are used while it flies', () => {
  const { CB, w, e } = setup();
  const names = new Set();
  const { r, log } = fakeRenderer();
  for (let i = 0; i < 40; i++) {
    H.stepN(w, 1, idle);
    if (e.state !== 'wander') break;
    CB.Enemies.nullPointer.draw(e, r, w.time);
    names.add(log.sprites[log.sprites.length - 1].name);
  }
  assert.deepEqual([...names].sort(), ['nullPointer_0', 'nullPointer_1']);
});

test('nullPointer: the appear ring is dashed, at full alpha from its first frame, and tightens from radius 12 to 5', () => {
  const { CB, w, e } = setup();
  const mod = CB.Enemies.nullPointer;
  const ringRadii = (log) => log.lines.flatMap((l) => [Math.hypot(l.x1 - e.x, l.y1 - e.y), Math.hypot(l.x2 - e.x, l.y2 - e.y)]);
  at(w, 2.3); // the tick the telegraph begins
  assert.equal(e.state, 'appear');
  assert.ok(e.stateT < 1 / 30);
  const first = fakeRenderer();
  mod.draw(e, first.r, 0);
  assert.ok(first.log.lines.length >= 4, `${first.log.lines.length} dashes`);
  for (const l of first.log.lines) {
    assert.equal(l.scoped, false, 'the ring is not inside an alpha scope');
    assert.equal(l.c, CB.Pal.C.hurt);
  }
  const rs0 = ringRadii(first.log);
  assert.ok(Math.min(...rs0) > 11 && Math.max(...rs0) < 12.5, `starting radii ${Math.min(...rs0)}..${Math.max(...rs0)}`);
  const sprite0 = first.log.sprites[0];
  assert.ok(sprite0.o.alpha < 0.2, 'the moth itself is still faded in');
  // dashes leave gaps: consecutive dash ends are not joined
  const l0 = first.log.lines[0];
  const l1 = first.log.lines[1];
  assert.ok(Math.hypot(l0.x2 - l1.x1, l0.y2 - l1.y1) > 1, 'there is a gap between dashes');

  at(w, 2.58, 2.3);
  const mid = fakeRenderer();
  mod.draw(e, mid.r, 0);
  const rsMid = ringRadii(mid.log);
  assert.ok(Math.max(...rsMid) < Math.min(...rs0), 'it tightened');

  at(w, 2.77, 2.58);
  assert.equal(e.state, 'appear');
  const last = fakeRenderer();
  mod.draw(e, last.r, 0);
  const rsEnd = ringRadii(last.log);
  assert.ok(Math.max(...rsEnd) < 6.5 && Math.min(...rsEnd) > 4.5, `ending radii ${Math.min(...rsEnd)}..${Math.max(...rsEnd)}`);
  for (const l of last.log.lines) assert.equal(l.scoped, false);
});

test('nullPointer: draw runs in every state without throwing, and only appear draws a ring', () => {
  const { CB, w, e } = setup();
  const mod = CB.Enemies.nullPointer;
  const rings = {};
  for (let i = 0; i < 230; i++) {
    H.stepN(w, 1, idle);
    const { r, log } = fakeRenderer();
    mod.draw(e, r, w.time);
    rings[e.state] = rings[e.state] || log.lines.length > 0;
    if (log.lines.length) assert.equal(e.state, 'appear');
  }
  assert.deepEqual(Object.keys(rings).sort(), ['appear', 'lunge', 'vanish', 'wander']);
  assert.equal(rings.appear, true);
  assert.equal(rings.wander, false);
  assert.equal(rings.lunge, false);
});
