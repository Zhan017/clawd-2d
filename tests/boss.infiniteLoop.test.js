'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/art/font.js', 'src/game/enemies/syntaxError.js', 'src/game/bosses/infiniteLoop.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 96 });

function start() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 7, god: true });
  w.boss = CB.Bosses.infiniteLoop.create(w);
  return { CB, w, boss: w.boss };
}
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);
function countFires(w) {
  const box = { n: 0, shots: [] };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { box.n++; box.shots.push(a); return orig(...a); };
  return box;
}

test('infiniteLoop: one head and 8 solid untargetable r5 segments, all with spawn contact grace', () => {
  const { w, boss } = start();
  assert.equal(alive(w, 'loopHead').length, 1);
  const segs = alive(w, 'loopSegment');
  assert.equal(segs.length, 8);
  for (const s of segs) {
    assert.equal(s.targetable, false);
    assert.equal(s.solid, true);
    assert.equal(s.r, 5);
    assert.equal(s.boss, true);
    assert.equal(s.regular, false);
    assert.ok(s.noContactT >= 0.45);
  }
  assert.equal(boss.maxHp, 120);
  assert.equal(boss.hp, 120);
});

test('infiniteLoop: the head is a targetable r8 boss part with contact, drawn above the segments', () => {
  const { w, boss } = start();
  const h = boss.head;
  assert.equal(h.kind, 'loopHead');
  assert.equal(h.r, 8);
  assert.equal(h.hp, 120);
  assert.equal(h.targetable, true);
  assert.equal(h.solid, false);
  assert.equal(h.contact, true);
  assert.equal(h.boss, true);
  assert.equal(h.regular, false);
  assert.ok(h.noContactT >= 0.45);
  assert.equal(h.z, 1e6);
  boss.segments.forEach((s, i) => {
    assert.equal(s.contact, true);
    assert.equal(s.z, 1e5 - i);
    assert.ok(s.z < h.z);
  });
  assert.equal(w.enemies.length, 9);
});

test('infiniteLoop: head starts on the far side from the player and circles at radius 60', () => {
  const { w, boss } = start();
  assert.ok(Math.hypot(boss.head.x - w.player.x, boss.head.y - w.player.y) > 85);
  H.stepN(w, 90, idle);
  const d = Math.hypot(boss.head.x - 160, boss.head.y - 96);
  assert.ok(Math.abs(d - 60) < 1, `radius ${d}`);
});

test('infiniteLoop: segments lie on the circle with ~10 px of path between them', () => {
  const { w, boss } = start();
  H.stepN(w, 120, idle);
  let prev = boss.head;
  for (const s of boss.segments) {
    assert.ok(Math.abs(Math.hypot(s.x - 160, s.y - 96) - 60) < 1, 'on the circle');
    const d = Math.hypot(s.x - prev.x, s.y - prev.y);
    assert.ok(d > 9 && d < 10.5, `chord ${d}`);
    prev = s;
  }
});

test('infiniteLoop: the head publishes its velocity (~54 px/s in phase 1)', () => {
  const { w, boss } = start();
  H.stepN(w, 30, idle);
  const v = Math.hypot(boss.head.vx, boss.head.vy);
  assert.ok(Math.abs(v - 54) < 1.5, `speed ${v}`);
});

test('infiniteLoop: every moving part publishes a velocity, including the segments', () => {
  const { w, boss } = start();
  H.stepN(w, 20, idle);
  for (const part of [boss.head, ...boss.segments]) {
    assert.ok(Math.hypot(part.vx, part.vy) > 40, `|v| ${Math.hypot(part.vx, part.vy)}`);
  }
});

test('infiniteLoop: segments absorb bolts; damage only lands on the head', () => {
  const { w, boss } = start();
  const seg = boss.segments[5];
  const b = w.firePlayerBolt(seg.x, seg.y, 0);
  b.vx = 0;
  b.vy = 0;
  H.stepN(w, 1, idle);
  assert.equal(b.dead, true);
  assert.ok(w.events.some((e) => e.type === 'clink'));
  assert.equal(w.damageEnemy(seg, 10), 0);
  w.damageEnemy(boss.head, 10);
  H.stepN(w, 1, idle);
  assert.equal(boss.hp, 110);
});

test('infiniteLoop: exactly 60 HP is still phase 1; below 60 is phase 2', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.head, 60);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.head, 61);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  assert.ok(w.events.some((e) => e.type === 'bossPhase'));
  H.stepN(w, 150, idle);
  assert.ok(Math.abs(boss.radius - 40) < 0.5, `radius ${boss.radius}`);
  assert.ok(Math.abs(boss.angSpeed - 1.2) < 1e-9);
});

test('infiniteLoop: the radius eases linearly from 60 to 40 over 2 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  H.stepN(w, 60, idle); // one second into the easing
  assert.ok(Math.abs(boss.radius - 50) < 0.6, `radius ${boss.radius}`);
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(boss.radius - 40) < 0.6, `radius ${boss.radius}`);
});

test('infiniteLoop: a phase change emits bossPhase with finite x, y, shakes the screen and shields the head for 0.5 s', () => {
  const { w, boss } = start();
  const shakes = [];
  const addShake = w.addShake;
  w.addShake = (a) => { shakes.push(a); return addShake(a); };
  H.stepN(w, 10, idle);
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  const ev = w.events.filter((e) => e.type === 'bossPhase');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].phase, 2);
  assert.ok(Number.isFinite(ev[0].x) && Number.isFinite(ev[0].y));
  assert.ok(shakes.includes(4), 'w.addShake(4)');
  assert.ok(boss.head.invuln > 0.45);
  assert.equal(w.damageEnemy(boss.head, 5), 0, 'invulnerable right after the change');
  H.stepN(w, 29, idle);
  assert.equal(w.damageEnemy(boss.head, 5), 0, 'still invulnerable at 0.48 s');
  H.stepN(w, 3, idle);
  assert.equal(w.damageEnemy(boss.head, 5), 5, 'vulnerable again after 0.5 s');
});

test('infiniteLoop: the controller itself shakes the screen by 4 on a phase change (not just the Fx reaction)', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  assert.equal(w.shake, 0);
  boss.update(w, 1 / 60); // straight into the controller: no world step, so no Fx.consume and no decay
  assert.equal(boss.phase, 2);
  assert.ok(w.shake >= 4, `shake ${w.shake}`);
});

test('infiniteLoop: the reversal timer comes from the seeded world rng', () => {
  const timer = (seed) => {
    const CB = H.load(FILES);
    const w = CB.createWorld({ seed, god: true });
    w.boss = CB.Bosses.infiniteLoop.create(w);
    w.damageEnemy(w.boss.head, 80);
    H.stepN(w, 1, idle);
    return w.boss.reverseT;
  };
  assert.equal(timer(7), timer(7), 'same seed, same timer');
  const seen = new Set([1, 2, 3, 4, 5, 6].map(timer));
  assert.ok(seen.size >= 4, `timers across seeds: ${[...seen]}`);
});

test('infiniteLoop: phases latch and never revert, and the change fires once', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  boss.head.hp = 120;
  H.stepN(w, 120, idle);
  assert.equal(boss.phase, 2);
  assert.equal(boss.hp, 120);
  assert.equal(w.events.filter((e) => e.type === 'bossPhase').length, 1);
});

test('infiniteLoop: phase 2 reverses direction within 6.5 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  const d0 = boss.dir;
  let flipped = false;
  for (let i = 0; i < 390 && !flipped; i++) {
    H.stepN(w, 1, idle);
    if (boss.dir !== d0) flipped = true;
  }
  assert.ok(flipped);
});

test('infiniteLoop: the head blinks white for 0.5 s before it reverses, then re-rolls 4-6 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  assert.ok(boss.reverseT >= 3.9 && boss.reverseT <= 6.01, `reverseT ${boss.reverseT}`);
  assert.notEqual(boss.head.data.telegraph, true);
  const d0 = boss.dir;
  let teleAt = -1;
  let flipAt = -1;
  for (let i = 0; i < 480 && flipAt < 0; i++) {
    H.stepN(w, 1, idle);
    if (teleAt < 0 && boss.head.data.telegraph) teleAt = i;
    if (boss.dir !== d0) flipAt = i;
  }
  assert.ok(teleAt >= 0 && flipAt > teleAt, `tele ${teleAt} flip ${flipAt}`);
  assert.ok(flipAt - teleAt >= 28 && flipAt - teleAt <= 32, `0.5 s of warning: ${flipAt - teleAt} ticks`);
  assert.equal(boss.head.data.telegraph, false, 'telegraph clears on the flip');
  assert.ok(boss.reverseT >= 3.9 && boss.reverseT <= 6.01, `re-rolled ${boss.reverseT}`);
});

test('infiniteLoop: phase 2 sheds a segment into a syntaxError every 6 s, stopping at 4', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  H.stepN(w, 6.3 * 60, idle);
  assert.equal(alive(w, 'loopSegment').length, 7);
  assert.ok(alive(w, 'syntaxError').length >= 1);
  H.stepN(w, 40 * 60, idle);
  assert.equal(alive(w, 'loopSegment').length, 4);
});

test('infiniteLoop: the shed tail becomes a syntaxError at its own position, and the segment list stays alive-only', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  let tail = null;
  let before = boss.segments.length;
  for (let i = 0; i < 7 * 60 && boss.segments.length === before; i++) {
    tail = boss.segments[boss.segments.length - 1];
    H.stepN(w, 1, idle);
  }
  assert.equal(boss.segments.length, before - 1);
  assert.equal(tail.dead, true);
  const bug = alive(w, 'syntaxError');
  assert.equal(bug.length, 1);
  assert.equal(bug[0].x, tail.x);
  assert.equal(bug[0].y, tail.y);
  assert.ok(boss.segments.every((s) => !s.dead));
  const shed = w.events.filter((e) => e.type === 'enemyDie' && e.kind === 'loopSegment');
  assert.equal(shed.length, 1);
  assert.equal(shed[0].silent, true);
});

test('infiniteLoop: phase 1 telegraphs then fires a 3-bullet fan every 3 s', () => {
  const { w, boss } = start();
  const c = countFires(w);
  H.stepN(w, 2.8 * 60, idle);
  assert.equal(c.n, 0);
  assert.equal(boss.fanTele, true, 'telegraph shows 0.35 s before the fan');
  H.stepN(w, 0.3 * 60, idle);
  assert.equal(c.n, 3);
  assert.equal(boss.fanTele, false);
});

test('infiniteLoop: the first fan comes one full 3 s period after spawn, not before', () => {
  const { w } = start();
  const c = countFires(w);
  let first = -1;
  for (let i = 1; i <= 200 && first < 0; i++) {
    H.stepN(w, 1, idle);
    if (c.n > 0) first = i;
  }
  assert.ok(first >= 180 && first <= 181, `first fan at tick ${first}`);
  assert.equal(w.events.filter((e) => e.type === 'enemyShoot').length, 1, 'one enemyShoot per volley');
});

test('infiniteLoop: the phase 1 fan is 3 bullets at 0 and +-15 degrees around the aim, speed 72, from the head', () => {
  const { CB, w, boss } = start();
  const c = countFires(w);
  H.stepN(w, 181, idle);
  assert.equal(c.n, 3);
  const o = c.shots[0];
  assert.ok(Math.hypot(o[0] - boss.head.x, o[1] - boss.head.y) < 1.5, 'fired from the head');
  const aim = CB.M.angleTo(o[0], o[1], w.player.x, w.player.y);
  const deg = c.shots.map((s) => Math.round(((CB.M.wrapAngle(s[2] - aim) * 180) / Math.PI) * 10) / 10).sort((a, b) => a - b);
  assert.deepEqual(deg, [-15, 0, 15]);
  for (const s of c.shots) assert.equal(s[3], 72);
  const ev = w.events.find((e) => e.type === 'enemyShoot');
  assert.ok(Number.isFinite(ev.x) && Number.isFinite(ev.y));
});

test('infiniteLoop: phase 2 fans 5 bullets in 15 degree steps every 2.5 s, first one a full 2.5 s after the change', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  const c = countFires(w);
  H.stepN(w, 2.4 * 60, idle);
  assert.equal(c.n, 0, 'fanT was reset to 2.5 on phase entry');
  assert.equal(boss.fanTele, true);
  H.stepN(w, 0.2 * 60, idle);
  assert.equal(c.n, 5);
  const aim = CB.M.angleTo(c.shots[0][0], c.shots[0][1], w.player.x, w.player.y);
  const deg = c.shots.map((s) => Math.round(((CB.M.wrapAngle(s[2] - aim) * 180) / Math.PI) * 10) / 10).sort((a, b) => a - b);
  assert.deepEqual(deg, [-30, -15, 0, 15, 30]);
  H.stepN(w, 2.6 * 60, idle);
  assert.equal(c.n, 10, 'the next fan 2.5 s later');
});

// Steps until the first fan fires and returns the telegraph flag after every tick (the last entry is the tick the fan fired on).
function teleRun(w, boss) {
  const c = countFires(w);
  const tele = [];
  for (let i = 0; i < 200 && c.n === 0; i++) {
    H.stepN(w, 1, idle);
    tele.push(boss.fanTele);
  }
  assert.ok(c.n > 0, 'the fan fired');
  return tele;
}

test('infiniteLoop: the fan telegraph is the last 0.35 s of each period and clears on the tick the fan fires', () => {
  for (const hurt of [0, 80]) {
    const { w, boss } = start();
    if (hurt) {
      w.damageEnemy(boss.head, hurt);
      H.stepN(w, 1, idle);
    }
    const tele = teleRun(w, boss);
    const n = tele.length;
    const on = tele.filter(Boolean).length;
    assert.ok(on >= 20 && on <= 22, `phase ${hurt ? 2 : 1}: ${on} ticks of telegraph`);
    assert.equal(tele[n - 1], false, 'cleared on the firing tick');
    assert.ok(tele.slice(n - 1 - on, n - 1).every(Boolean), 'one unbroken run that ends just before the fan');
    assert.equal(boss.head.data.fanTele, false, 'the head part is told too');
  }
});

test('infiniteLoop: the head defeat kills all eight segments silently and the head loudly', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  const dies = w.events.filter((e) => e.type === 'enemyDie');
  const segs = dies.filter((e) => e.kind === 'loopSegment');
  assert.equal(segs.length, 8);
  for (const e of segs) {
    assert.equal(e.silent, true);
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
  }
  const head = dies.filter((e) => e.kind === 'loopHead');
  assert.equal(head.length, 1);
  assert.equal(head[0].silent, false);
  assert.ok(boss.segments.every((s) => s.dead));
});

test('infiniteLoop: the controller x, y follow the head, so bossEnter and bossDie land on the boss', () => {
  const { w, boss } = start();
  assert.deepEqual([boss.x, boss.y], [boss.head.x, boss.head.y]);
  const x0 = boss.x;
  const y0 = boss.y;
  H.stepN(w, 45, idle);
  assert.equal(boss.x, boss.head.x);
  assert.equal(boss.y, boss.head.y);
  assert.ok(Math.hypot(boss.x - x0, boss.y - y0) > 10, 'it has moved');
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y), 'still finite after defeat');
});

test('infiniteLoop: the recorded path is trimmed to what the body needs, so it never grows', () => {
  const { w, boss } = start();
  let most = 0;
  for (let i = 0; i < 60 * 50; i++) {
    if (i === 60 * 20) w.damageEnemy(boss.head, 80);
    H.stepN(w, 1, idle);
    most = Math.max(most, boss.path.length);
  }
  assert.equal(boss.phase, 2);
  assert.ok(most < 140, `path peaked at ${most} points`);
});

test('infiniteLoop: the first shed is 6 s after the phase change and the next 6 s after that', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  H.stepN(w, 354, idle); // 5.9 s
  assert.equal(boss.segments.length, 8);
  H.stepN(w, 12, idle); // 6.1 s
  assert.equal(boss.segments.length, 7);
  H.stepN(w, 348, idle); // 11.9 s
  assert.equal(boss.segments.length, 7);
  H.stepN(w, 18, idle); // 12.2 s
  assert.equal(boss.segments.length, 6);
});

test('infiniteLoop: every reversal timer is rolled with w.rng.range(4, 6), on the phase change and after each flip', () => {
  const { w, boss } = start();
  const calls = [];
  w.rng.range = (a, b) => {
    calls.push([a, b]);
    return 4.25;
  };
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  assert.deepEqual(calls, [[4, 6]]);
  const run = () => {
    const d0 = boss.dir;
    let n = 0;
    while (boss.dir === d0 && n < 700) {
      H.stepN(w, 1, idle);
      n++;
    }
    return n;
  };
  const first = run();
  assert.deepEqual(calls, [[4, 6], [4, 6]], 're-rolled at the flip');
  const second = run();
  assert.ok(Math.abs(first - 254) <= 2, `first flip after ${first} more ticks`);
  assert.ok(Math.abs(second - 255) <= 2, `second flip ${second} ticks after the re-roll`);
});

test('infiniteLoop: killing the head defeats the boss and clears segments', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(alive(w, 'loopSegment').length, 0);
});

test('infiniteLoop: defeat clears the telegraphs and the controller never acts again', () => {
  const { w, boss } = start();
  H.stepN(w, 2.8 * 60, idle);
  assert.equal(boss.fanTele, true);
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.fanTele, false);
  assert.notEqual(boss.head.data.telegraph, true);
  const where = [boss.head.x, boss.head.y];
  boss.update(w, 1 / 60); // even if called by mistake it must not move or fire
  assert.deepEqual([boss.head.x, boss.head.y], where);
  const c = countFires(w);
  H.stepN(w, 5 * 60, idle);
  assert.equal(c.n, 0);
});

test('infiniteLoop: 10 s of fighting in each phase emits only events with finite x and y', () => {
  for (const hurt of [0, 80]) {
    const { w, boss } = start();
    if (hurt) w.damageEnemy(boss.head, hurt);
    H.stepN(w, 600, idle);
    assert.ok(w.events.length > 0);
    for (const e of w.events) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.type} x ${e.x} y ${e.y}`);
    for (const part of [boss.head, ...boss.segments]) assert.ok(Number.isFinite(part.x) && Number.isFinite(part.y));
  }
});

test('infiniteLoop: stays finite and inside the arena through reversals, sheds and a player standing at the centre', () => {
  const { w, boss } = start();
  w.player.x = 160;
  w.player.y = 96;
  w.damageEnemy(boss.head, 80);
  const A = w.arena;
  for (let i = 0; i < 60 * 40; i++) {
    H.stepN(w, 1, idle);
    for (const part of [boss.head, ...boss.segments]) {
      assert.ok(Number.isFinite(part.x) && Number.isFinite(part.y), `tick ${i}`);
      assert.ok(part.x >= A.x && part.x <= A.x + A.w && part.y >= A.y && part.y <= A.y + A.h, `outside at tick ${i}`);
    }
  }
});

test('infiniteLoop: finale data', () => {
  const { CB, boss } = start();
  const B = CB.Bosses.infiniteLoop;
  assert.equal(B.id, 'infiniteLoop');
  assert.equal(boss.id, 'infiniteLoop');
  assert.equal(B.name, 'THE INFINITE LOOP');
  assert.equal(B.tagline, 'while (true) { bite(); }');
  assert.equal(B.commitMsg, 'fix: add a break condition');
  assert.ok(B.diff.length >= 2 && B.diff.length <= 4);
  for (const l of B.diff) {
    assert.match(l, /^[-+] /);
    assert.ok(l.length <= 46, l);
    assert.ok(CB.Font.measure(l) <= 228, `diff line "${l}" is ${CB.Font.measure(l)} px`);
    for (const ch of l) assert.ok(CB.Font.has(ch), `no glyph for ${JSON.stringify(ch)}`);
  }
  assert.equal(typeof B.file, 'string');
  assert.equal(B.file, 'loop.js');
  assert.ok(CB.Art.hasSprite(B.portrait));
  assert.equal(boss.radius, 60);
  const pts = B.deathPoints(boss);
  assert.equal(pts.length, 9);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  assert.deepEqual([pts[0].x, pts[0].y], [boss.head.x, boss.head.y], 'the head first');
  assert.deepEqual([pts[8].x, pts[8].y], [boss.segments[7].x, boss.segments[7].y], 'the tail last');
});

test('infiniteLoop: deathPoints still works after defeat, with the same points', () => {
  const { CB, w, boss } = start();
  H.stepN(w, 30, idle);
  const B = CB.Bosses.infiniteLoop;
  const before = B.deathPoints(boss).length;
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  const pts = B.deathPoints(boss);
  assert.equal(pts.length, before);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  // after a shed the list is shorter, and it is still head first
  const s = start();
  s.w.damageEnemy(s.boss.head, 80);
  H.stepN(s.w, 6.3 * 60, idle);
  assert.equal(B.deathPoints(s.boss).length, 8);
});

// ---- sprites and drawing ------------------------------------------------------------------------------------------------------

test('infiniteLoop: sprites exist at the planned sizes, with an ink outline and two shades of purple', () => {
  const { CB } = start();
  const dims = { loopHead_0: [18, 18], loopHead_1: [18, 18], loopSegment_0: [12, 12], loopSegment_1: [12, 12] };
  for (const [name, [wd, ht]] of Object.entries(dims)) {
    assert.ok(CB.Art.hasSprite(name), name);
    const d = CB.Art.spriteDef(name);
    assert.equal(d.w, wd, `${name} width`);
    assert.equal(d.h, ht, `${name} height`);
    const px = d.rows.join('');
    assert.ok(px.includes('k'), `${name} has an ink outline`);
    assert.ok(px.includes('p') && px.includes('P'), `${name} has two purples`);
  }
  const head = CB.Art.spriteDef('loopHead_0').rows.join('');
  assert.ok(head.includes('w'), 'white eyes');
  assert.notEqual(CB.Art.spriteDef('loopHead_0').rows.join('|'), CB.Art.spriteDef('loopHead_1').rows.join('|'), 'the jaws chomp');
  assert.notEqual(CB.Art.spriteDef('loopSegment_0').rows.join('|'), CB.Art.spriteDef('loopSegment_1').rows.join('|'), 'darker variant');
});

test('infiniteLoop: the 1 px ink outline is closed on every sprite (no lit pixel touches the edge or a gap)', () => {
  const { CB } = start();
  for (const name of ['loopHead_0', 'loopHead_1', 'loopSegment_0', 'loopSegment_1']) {
    const d = CB.Art.spriteDef(name);
    const at = (x, y) => (x < 0 || y < 0 || x >= d.w || y >= d.h ? '.' : d.rows[y][x]);
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = at(x, y);
        if (ch === '.' || ch === 'k') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(at(x + dx, y + dy), '.', `${name}: "${ch}" at (${x}, ${y}) is not outlined`);
      }
    }
  }
});

test('infiniteLoop: the head frames differ only in the jaws, and both are symmetric but for the highlight', () => {
  const { CB } = start();
  const f0 = CB.Art.spriteDef('loopHead_0').rows;
  const f1 = CB.Art.spriteDef('loopHead_1').rows;
  assert.deepEqual(f0.slice(0, 10), f1.slice(0, 10), 'the top ten rows (antennae, plate, eyes) do not change between frames');
  assert.notDeepEqual(f0.slice(10), f1.slice(10));
  const mirror = (row) => [...row].reverse().join('');
  for (const rows of [f0, f1]) {
    rows.forEach((row, y) => {
      if (y === 4 || y === 5) return; // the highlight, drawn on the left only
      const shade = (s) => s.replace(/[Pp]/g, 'p'); // the shade sits lower right
      assert.equal(shade(mirror(row)), shade(row), `row ${y} is not mirror-symmetric`);
    });
  }
});

// A renderer stub that records sprite and rect calls; alpha runs its callback.
function stubRenderer() {
  const calls = [];
  return {
    calls,
    sprite: (name, x, y, o) => calls.push({ kind: 'sprite', name, x, y, o: o || {} }),
    rect: (x, y, wd, ht, color) => calls.push({ kind: 'rect', x, y, w: wd, h: ht, color }),
    alpha: (a, fn) => fn(),
  };
}

test('infiniteLoop: the head draws its chomping sprite and flashes white on a hit', () => {
  const { CB, w, boss } = start();
  const r = stubRenderer();
  CB.Enemies.loopHead.draw(boss.head, r, 0);
  const s = r.calls.find((c) => c.kind === 'sprite');
  assert.match(s.name, /^loopHead_[01]$/);
  assert.equal(s.o.white, false);
  const names = new Set();
  for (let t = 0; t < 2; t += 0.1) {
    const r2 = stubRenderer();
    boss.head.t = t;
    CB.Enemies.loopHead.draw(boss.head, r2, t);
    names.add(r2.calls.find((c) => c.kind === 'sprite').name);
  }
  assert.equal(names.size, 2, 'both frames are used');
  boss.head.hitFlash = 0.05;
  const r3 = stubRenderer();
  CB.Enemies.loopHead.draw(boss.head, r3, 0);
  assert.equal(r3.calls.find((c) => c.kind === 'sprite').o.white, true);
  assert.ok(w);
});

test('infiniteLoop: fan and reverse telegraphs blink the head white, through Comfort when it exists', () => {
  const { CB, boss } = start();
  const head = boss.head;
  const whiteAt = (t) => {
    const r = stubRenderer();
    CB.Enemies.loopHead.draw(head, r, t);
    return r.calls.find((c) => c.kind === 'sprite').o.white;
  };
  // no telegraph: never white
  assert.equal(whiteAt(0), false);
  assert.equal(whiteAt(0.05), false);
  for (const flag of ['fanTele', 'telegraph']) {
    head.data.fanTele = false;
    head.data.telegraph = false;
    head.data[flag] = true;
    const seen = new Set();
    for (let t = 0; t < 0.4; t += 0.025) seen.add(whiteAt(t));
    assert.equal(seen.size, 2, `${flag}: blinks`);
  }
  const hz = [];
  CB.Comfort = { blink: (t, f) => { hz.push(f); return false; } };
  head.data.fanTele = true;
  assert.equal(whiteAt(0.01), false, 'Comfort decides');
  assert.ok(hz.includes(20), 'blinks at 20 Hz through Comfort.blink');
});

test('infiniteLoop: the jaws gape while a fan charges, whatever the chomp phase', () => {
  const { CB, boss } = start();
  const head = boss.head;
  head.t = 0; // chomp frame 0: jaws shut
  const frame = () => {
    const r = stubRenderer();
    CB.Enemies.loopHead.draw(head, r, 0);
    return r.calls.find((c) => c.kind === 'sprite').name;
  };
  assert.equal(frame(), 'loopHead_0');
  head.data.fanTele = true;
  assert.equal(frame(), 'loopHead_1');
  head.data.fanTele = false;
  assert.equal(frame(), 'loopHead_0');
});

test('infiniteLoop: segments alternate between the two ring variants and draw above a soft shadow', () => {
  const { CB, boss } = start();
  const names = boss.segments.map((s) => {
    const r = stubRenderer();
    CB.Enemies.loopSegment.draw(s, r, 0);
    assert.ok(r.calls.some((c) => c.kind === 'rect'), 'shadow');
    return r.calls.find((c) => c.kind === 'sprite').name;
  });
  assert.deepEqual(names, ['loopSegment_0', 'loopSegment_1', 'loopSegment_0', 'loopSegment_1', 'loopSegment_0', 'loopSegment_1', 'loopSegment_0', 'loopSegment_1']);
  boss.segments[0].hitFlash = 0.05;
  const r = stubRenderer();
  CB.Enemies.loopSegment.draw(boss.segments[0], r, 0);
  assert.equal(r.calls.find((c) => c.kind === 'sprite').o.white, true);
});

test('infiniteLoop: the overlay draw does nothing', () => {
  const { boss } = start();
  const r = stubRenderer();
  boss.draw(r, 1.5);
  assert.equal(r.calls.length, 0);
});
