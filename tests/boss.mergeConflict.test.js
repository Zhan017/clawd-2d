'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
// Rev 3: the finale test measures the diff lines with CB.Font, so font.js is loaded too.
const FILES = [...H.GAME_BASE, 'src/art/font.js', 'src/game/bosses/mergeConflict.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const twins = (w) => w.enemies.filter((e) => !e.dead && e.kind === 'conflictTwin');

function start(god, opts) {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: (opts && opts.seed) || 13, god: god !== false });
  if (opts && opts.player) {
    w.player.x = opts.player[0];
    w.player.y = opts.player[1];
  }
  w.boss = CB.Bosses.mergeConflict.create(w);
  return { CB, w, boss: w.boss };
}

// Wraps w.fireEnemyBullet and records every call (the boss must look it up at fire time, never bind it).
function recordFires(w) {
  const box = { n: 0, calls: [] };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => {
    box.n++;
    box.calls.push({ x: a[0], y: a[1], angle: a[2], speed: a[3], time: w.time });
    return orig(...a);
  };
  return box;
}

// Runs until `boss.attack` is set (or maxTicks pass). Returns the attack kind that began, or null.
function untilAttack(w, boss, maxTicks) {
  for (let i = 0; i < maxTicks; i++) {
    H.stepN(w, 1, idle);
    if (boss.attack) return boss.attack.kind;
  }
  return null;
}
function untilIdle(w, boss, maxTicks) {
  for (let i = 0; i < maxTicks && boss.attack; i++) H.stepN(w, 1, idle);
}

// A renderer that only has the documented methods: calling anything else throws, so a draw that strays outside the contract fails.
function fakeRenderer() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push({ name, a }); };
  return {
    calls,
    clear: rec('clear'), rect: rec('rect'), frame: rec('frame'), disc: rec('disc'), ring: rec('ring'), line: rec('line'),
    sprite: rec('sprite'), text: rec('text'),
    measure: (s, sc) => String(s).length * 6 * (sc || 1),
    alpha: (a, fn) => { calls.push({ name: 'alpha', a: [a] }); fn(); },
    shaken: (dx, dy, fn) => fn(),
    squash: (ax, ay, sx, sy, fn) => fn(),
  };
}

// ---- the plan's tests (rev 3 additions marked) ----------------------------------------------------------------------------

test('mergeConflict: two twins of 130 HP, combined 260, at least 40 px from centre', () => {
  const { w, boss } = start();
  const t = twins(w);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((e) => e.data.side).sort(), ['head', 'incoming']);
  for (const e of t) {
    assert.equal(e.hp, 130);
    assert.ok(Math.hypot(e.x - 160, e.y - 96) >= 40);
  }
  assert.equal(boss.maxHp, 260);
  assert.equal(boss.hp, 260);
});

test('mergeConflict: incoming mirrors HEAD through the arena centre', () => {
  const { w, boss } = start();
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(boss.incoming.x - (320 - boss.head.x)) < 0.01);
  assert.ok(Math.abs(boss.incoming.y - (192 - boss.head.y)) < 0.01);
});

test('mergeConflict: a missed 6 s window revives the dead twin at 20 HP, far from the player', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 1, idle);
  assert.ok(boss.resolveT > 5.9 && boss.resolveT <= 6.0, `resolveT ${boss.resolveT}`);
  assert.equal(boss.deadSide, 'head');
  H.stepN(w, 6.2 * 60, idle);
  const head = twins(w).find((e) => e.data.side === 'head');
  assert.ok(head, 'HEAD revived');
  assert.equal(head.hp, 20);
  assert.ok(head.noContactT > 0);
  assert.equal(boss.resolveT, null);
  assert.ok(w.events.some((e) => e.type === 'revive'));
  assert.equal(boss.defeated, false);
  w.damageEnemy(boss.head, 20);
  H.stepN(w, 1, idle);
  assert.ok(boss.resolveT > 5.9, 'the window re-triggers after a revive');
});

test('mergeConflict: killing the second twin inside the window defeats the boss', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 5 * 60, idle);
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.resolveT, null);
});

test('mergeConflict: both twins dying in the same tick defeats the boss', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
});

test('mergeConflict: the conflict-line beam hurts a player standing on it, only after the telegraph', () => {
  const { w, boss } = start(false);
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  w.player.x = 160;
  w.player.y = 96;
  boss.startAttack('line');
  H.stepN(w, 40, idle);
  assert.equal(w.player.hearts, 6, 'no damage during the 0.8 s telegraph');
  assert.ok(w.events.some((e) => e.type === 'beamCharge'));
  H.stepN(w, 17, idle);
  assert.equal(w.player.hearts, 5);
  assert.ok(w.events.some((e) => e.type === 'beam'));
});

test('mergeConflict: phase 2 strictly below 130 combined HP', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.head, 65);
  w.damageEnemy(boss.incoming, 65);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  assert.ok(w.events.some((e) => e.type === 'bossPhase'));
});

test('mergeConflict: finale data', () => {
  const { CB, w, boss } = start();
  const B = CB.Bosses.mergeConflict;
  assert.equal(boss.id, 'mergeConflict'); // rev 3
  assert.equal(B.id, 'mergeConflict');
  assert.equal(B.file, 'merge.js');
  assert.ok(CB.Art.hasSprite(B.portrait));
  assert.ok(B.diff.length >= 2 && B.diff.length <= 4);
  for (const l of B.diff) {
    assert.match(l, /^[-+] /);
    assert.ok(l.length <= 46, `diff line length ${l.length}`);
    assert.ok(CB.Font.measure(l, 1) <= 228, `diff line "${l}" measures ${CB.Font.measure(l, 1)} px`); // rev 3
    for (const ch of l) assert.ok(CB.Font.has(ch), `glyph ${JSON.stringify(ch)} missing from the font`);
  }
  const before = B.deathPoints(boss);
  assert.equal(before.length, 3);
  for (const p of before) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  // rev 3: deathPoints still works after defeat and keeps its count (the dead twins keep their last x/y)
  w.damageEnemy(boss.head, 999);
  w.damageEnemy(boss.incoming, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  const after = B.deathPoints(boss);
  assert.equal(after.length, before.length);
  for (const p of after) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

// ---- extra coverage for the rev 3 boss rules --------------------------------------------------------------------------------

test('mergeConflict: module fields', () => {
  const { CB } = start();
  const B = CB.Bosses.mergeConflict;
  assert.equal(B.name, 'MERGE CONFLICT');
  assert.equal(B.tagline, '<<<<<<< HEAD');
  assert.equal(B.commitMsg, 'fix: resolve merge conflict');
  assert.equal(B.portrait, 'conflictHead_0');
  assert.deepEqual(Array.from(B.diff), ['- <<<<<<< HEAD', '- =======', '- >>>>>>> incoming', '+ // kept both. you are welcome']);
  assert.equal(typeof B.create, 'function');
  assert.equal(typeof B.deathPoints, 'function');
});

test('mergeConflict: parts are boss-only conflictTwin entities with spawn contact grace', () => {
  const { CB, w, boss } = start();
  assert.equal(typeof CB.Enemies.conflictTwin.create, 'function');
  for (const e of twins(w)) {
    assert.equal(e.boss, true);
    assert.equal(e.regular, false);
    assert.equal(e.targetable, true);
    assert.equal(e.contact, true);
    assert.equal(e.solid, false);
    assert.equal(e.r, 8);
    assert.ok(e.noContactT >= 0.45, `noContactT ${e.noContactT}`);
  }
  assert.equal(boss.phase, 1);
  assert.equal(boss.defeated, false);
  assert.equal(boss.resolveT, null);
  assert.equal(boss.deadSide, null);
  assert.equal(boss.attack, null);
  assert.equal(boss.attackIdx, 0);
  assert.equal(boss.cx, 160);
  assert.equal(boss.cy, 96);
  assert.equal(w.regularAlive(), 0);
});

test('mergeConflict: HEAD spawns at the candidate farthest from the player (first wins ties), incoming at its mirror', () => {
  const cases = [
    [[160, 126], [90, 56]], // an exact tie between the two upper candidates: the first one wins
    [[230, 136], [90, 56]],
    [[90, 56], [230, 136]],
    [[230, 56], [90, 136]],
    [[90, 136], [230, 56]],
  ];
  for (const [pl, want] of cases) {
    const { boss } = start(true, { player: pl });
    assert.deepEqual([boss.head.x, boss.head.y], want, `player ${pl}`);
    assert.deepEqual([boss.incoming.x, boss.incoming.y], [320 - want[0], 192 - want[1]], `player ${pl}`);
  }
});

test('mergeConflict: the first attack comes one full 2.8 s period after spawn; crossfire is a 3-bullet aimed burst per twin', () => {
  const { w, boss } = start();
  const fires = recordFires(w);
  H.stepN(w, 162, idle); // 2.7 s
  assert.equal(fires.n, 0);
  assert.equal(boss.attack, null);
  H.stepN(w, 24, idle); // 3.1 s: all three volleys are out
  assert.equal(fires.n, 6);
  for (const c of fires.calls) {
    assert.equal(c.speed, 85);
    assert.ok(c.time >= 2.8 - 1e-6, `fired at ${c.time}`);
  }
  // each volley: both twins fire; every angle was aimed at the player from the shooter's position at fire time
  for (let v = 0; v < 3; v++) {
    const a = fires.calls[v * 2];
    const b = fires.calls[v * 2 + 1];
    assert.equal(a.time, b.time, 'both twins fire together');
    for (const c of [a, b]) {
      const want = Math.atan2(w.player.y - c.y, w.player.x - c.x);
      assert.ok(Math.abs(Math.atan2(Math.sin(c.angle - want), Math.cos(c.angle - want))) < 1e-9, 'aimed at the player');
    }
  }
  const gap1 = fires.calls[2].time - fires.calls[0].time;
  const gap2 = fires.calls[4].time - fires.calls[2].time;
  assert.ok(gap1 > 0.1 && gap1 < 0.15, `gap ${gap1}`);
  assert.ok(gap2 > 0.1 && gap2 < 0.15, `gap ${gap2}`);
  assert.equal(boss.attack, null, 'the burst is over');
  assert.ok(w.events.some((e) => e.type === 'enemyShoot' && Number.isFinite(e.x) && Number.isFinite(e.y)));
});

test('mergeConflict: crossfire from a lone twin is one 3-bullet burst', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 1, idle);
  const fires = recordFires(w);
  boss.startAttack('crossfire');
  H.stepN(w, 30, idle);
  assert.equal(fires.n, 3);
});

test('mergeConflict: the rotation is crossfire, line in phase 1 and crossfire, line, charge in phase 2', () => {
  const { w, boss } = start();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    seen.push(untilAttack(w, boss, 200));
    untilIdle(w, boss, 200);
  }
  assert.deepEqual(seen, ['crossfire', 'line', 'crossfire', 'line']);
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  boss.attackIdx = 0;
  boss.attackT = 0.5;
  const seen2 = [];
  for (let i = 0; i < 4; i++) {
    seen2.push(untilAttack(w, boss, 400));
    untilIdle(w, boss, 200);
    boss.attackT = 0.5;
  }
  assert.deepEqual(seen2, ['crossfire', 'line', 'charge', 'crossfire']);
});

test('mergeConflict: the line needs both twins and falls back to crossfire; a death mid-line cancels the beam', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  boss.startAttack('line');
  assert.equal(boss.attack.kind, 'crossfire');
  assert.ok(!w.events.some((e) => e.type === 'beamCharge'));

  ({ w, boss } = start(false));
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  w.player.x = 160;
  w.player.y = 96;
  boss.startAttack('line');
  H.stepN(w, 20, idle);
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 60, idle);
  assert.equal(boss.attack === null || boss.attack.kind !== 'line', true, 'the line ended with its twin');
  assert.equal(w.player.hearts, 6, 'no beam without both twins');
  assert.ok(!w.events.some((e) => e.type === 'beam'));
});

test('mergeConflict: beam events carry the midpoint plus both end points; the twins hold still during the line', () => {
  const { w, boss } = start();
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  boss.startAttack('line');
  H.stepN(w, 70, idle);
  assert.deepEqual([boss.head.x, boss.head.y, boss.incoming.x, boss.incoming.y], [100, 60, 220, 132], 'the twins hold still for the whole line');
  assert.ok(boss.attack && boss.attack.kind === 'line');
  H.stepN(w, 10, idle);
  const charge = w.events.filter((e) => e.type === 'beamCharge');
  const beam = w.events.filter((e) => e.type === 'beam');
  assert.equal(charge.length, 1);
  assert.equal(beam.length, 1, 'the beam event is emitted once');
  for (const e of [...charge, ...beam]) {
    assert.deepEqual([e.x1, e.y1, e.x2, e.y2], [100, 60, 220, 132]);
    assert.equal(e.x, 160);
    assert.equal(e.y, 96);
  }
  assert.equal(boss.attack, null, 'the line lasts 0.8 s + 0.5 s');
});

test('mergeConflict: the beam misses a player who is off the line', () => {
  const { w, boss } = start(false);
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  w.player.x = 160;
  w.player.y = 150;
  boss.startAttack('line');
  H.stepN(w, 90, idle);
  assert.equal(w.player.hearts, 6);
});

test('mergeConflict: charge shakes for 0.4 s, then both twins dash at the player at 160 px/s for 0.5 s', () => {
  const { w, boss } = start();
  w.player.x = 160;
  w.player.y = 96;
  const p0 = { hx: boss.head.x, hy: boss.head.y, ix: boss.incoming.x, iy: boss.incoming.y };
  boss.startAttack('charge');
  H.stepN(w, 20, idle); // 0.33 s: telegraph
  assert.equal(boss.head.x, p0.hx);
  assert.equal(boss.head.y, p0.hy);
  assert.equal(boss.incoming.x, p0.ix);
  assert.equal(boss.head.data.jit, true, 'the telegraph jitters');
  assert.equal(Math.hypot(boss.head.vx, boss.head.vy), 0);
  H.stepN(w, 15, idle); // 0.58 s: dashing
  assert.ok(Math.abs(Math.hypot(boss.head.vx, boss.head.vy) - 160) < 1, `head speed ${Math.hypot(boss.head.vx, boss.head.vy)}`);
  assert.ok(Math.abs(Math.hypot(boss.incoming.vx, boss.incoming.vy) - 160) < 1);
  assert.equal(boss.head.data.jit, false);
  // heading: straight at the player
  const dx = boss.head.vx / 160;
  const dy = boss.head.vy / 160;
  const want = Math.atan2(96 - p0.hy, 160 - p0.hx);
  assert.ok(Math.abs(Math.atan2(dy, dx) - want) < 0.01);
  H.stepN(w, 20, idle);
  assert.equal(boss.attack, null, 'the charge is over after 0.9 s');
  const travelled = Math.hypot(boss.head.x - p0.hx, boss.head.y - p0.hy);
  assert.ok(Math.abs(travelled - 80) < 2, `travelled ${travelled}`);
});

test('mergeConflict: a twin within 40 px of the player at telegraph start does not charge', () => {
  const { w, boss } = start();
  w.player.x = 160;
  w.player.y = 96;
  boss.head.x = 130; // 30 px from the player
  boss.head.y = 96;
  boss.startAttack('charge');
  H.stepN(w, 40, idle);
  assert.equal(boss.head.x, 130);
  assert.equal(boss.head.y, 96);
  assert.equal(boss.head.data.jit, false, 'no telegraph on a twin that will not charge');
  assert.ok(Math.hypot(boss.incoming.x - 230, boss.incoming.y - 136) > 20, 'the far twin did charge');
});

test('mergeConflict: after a charge incoming heads back to its mirror point at up to 120 px/s', () => {
  const { w, boss } = start();
  w.player.x = 130; // off the centre of symmetry, so the two dashes end in different places
  w.player.y = 70;
  boss.startAttack('charge');
  H.stepN(w, 54, idle); // the tick the charge ends
  assert.equal(boss.attack, null);
  const off = Math.hypot(boss.incoming.x - (320 - boss.head.x), boss.incoming.y - (192 - boss.head.y));
  assert.ok(off > 15, `incoming is away from its mirror point (${off})`);
  let top = 0;
  for (let i = 0; i < 120; i++) {
    H.stepN(w, 1, idle);
    top = Math.max(top, Math.hypot(boss.incoming.vx, boss.incoming.vy));
  }
  assert.ok(top <= 120.5, `peak return speed ${top}`);
  assert.ok(Math.abs(boss.incoming.x - (320 - boss.head.x)) < 0.01);
  assert.ok(Math.abs(boss.incoming.y - (192 - boss.head.y)) < 0.01);
});

test('mergeConflict: HEAD wanders at 50 px/s and both twins publish their velocity', () => {
  const { w, boss } = start();
  H.stepN(w, 30, idle);
  assert.ok(Math.abs(Math.hypot(boss.head.vx, boss.head.vy) - 50) < 1, `head speed ${Math.hypot(boss.head.vx, boss.head.vy)}`);
  assert.ok(Math.hypot(boss.incoming.vx, boss.incoming.vy) > 45, 'the mirrored twin moves with it');
  // incoming's velocity is the mirror of HEAD's
  assert.ok(Math.abs(boss.incoming.vx + boss.head.vx) < 1e-6);
  assert.ok(Math.abs(boss.incoming.vy + boss.head.vy) < 1e-6);
});

test('mergeConflict: with HEAD dead, incoming wanders on its own waypoints at 50 px/s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 2, idle);
  const start0 = { x: boss.incoming.x, y: boss.incoming.y };
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(Math.hypot(boss.incoming.vx, boss.incoming.vy) - 50) < 1);
  const d = Math.hypot(boss.incoming.x - start0.x, boss.incoming.y - start0.y);
  assert.ok(d > 20, `it moved ${d}`);
  assert.ok(Math.abs(boss.incoming.x - (320 - boss.head.x)) > 1 || Math.abs(boss.incoming.y - (192 - boss.head.y)) > 1, 'not pinned to the dead twin');
});

test('mergeConflict: a phase change emits bossPhase, shakes, and makes each living twin invulnerable for 0.5 s; phases latch', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61);
  boss.update(w, 1 / 60); // directly: world.step would already have decayed the shake by 1/3 within the same tick
  const ev = w.events.filter((e) => e.type === 'bossPhase');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].phase, 2);
  assert.ok(Number.isFinite(ev[0].x) && Number.isFinite(ev[0].y));
  assert.ok(w.shake >= 4, `shake ${w.shake}`);
  assert.equal(w.damageEnemy(boss.head, 5), 0);
  assert.equal(w.damageEnemy(boss.incoming, 5), 0);
  H.stepN(w, 27, idle); // 0.45 s on
  assert.equal(w.damageEnemy(boss.head, 5), 0);
  H.stepN(w, 6, idle);
  assert.ok(w.damageEnemy(boss.head, 5) > 0, 'vulnerable again after 0.5 s');
  boss.head.hp = 130;
  boss.incoming.hp = 130;
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2, 'phases never revert');
  assert.equal(w.events.filter((e) => e.type === 'bossPhase').length, 1);
});

test('mergeConflict: the first attack after a phase change waits a full period', () => {
  const { w, boss } = start();
  boss.attackT = 0.1; // an attack was nearly due
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61);
  const fires = recordFires(w);
  H.stepN(w, 120, idle); // 2 s
  assert.equal(fires.n, 0);
  assert.equal(boss.attack, null);
});

test('mergeConflict: hp is the sum of the living twins, x/y their midpoint', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 50);
  w.damageEnemy(boss.incoming, 30);
  H.stepN(w, 1, idle);
  assert.equal(boss.hp, 80 + 100);
  assert.ok(Math.abs(boss.x - (boss.head.x + boss.incoming.x) / 2) < 1e-9);
  assert.ok(Math.abs(boss.y - (boss.head.y + boss.incoming.y) / 2) < 1e-9);
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.hp, 100, 'a dead twin counts for 0');
  assert.ok(Math.abs(boss.x - boss.incoming.x) < 1e-9, 'x/y follow the lone survivor');
  assert.ok(Math.abs(boss.y - boss.incoming.y) < 1e-9);
});

test('mergeConflict: FINISH banner event is at the arena centre and names the twin to finish', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 1, idle);
  const t = w.events.filter((e) => e.type === 'text' && /FINISH/.test(e.text));
  assert.equal(t.length, 1);
  assert.equal(t[0].text, 'FINISH INCOMING!');
  assert.equal(t[0].x, 160);
  assert.equal(t[0].y, 96);
  assert.equal(typeof t[0].color, 'string');
  H.stepN(w, 60, idle);
  assert.equal(w.events.filter((e) => e.type === 'text' && /FINISH/.test(e.text)).length, 1, 'once per window');
});

test('mergeConflict: the revive spot is the farthest candidate (>= 70 px), the text reads merge failed, and it keeps maxHp 130', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  H.stepN(w, 6.3 * 60, idle);
  const inc = boss.incoming;
  assert.equal(inc.dead, false);
  assert.equal(inc.hp, 20);
  assert.equal(inc.maxHp, 130);
  assert.equal(inc.data.side, 'incoming');
  assert.equal(inc.boss, true);
  assert.equal(inc.regular, false);
  const rv = w.events.find((e) => e.type === 'revive');
  assert.ok(Number.isFinite(rv.x) && Number.isFinite(rv.y));
  assert.ok(Math.hypot(rv.x - w.player.x, rv.y - w.player.y) >= 70, 'far from the player');
  assert.ok([[60, 50], [260, 50], [160, 150]].some((c) => c[0] === rv.x && c[1] === rv.y), 'one of the three candidates');
  const msg = w.events.find((e) => e.type === 'text' && e.text === 'merge failed');
  assert.ok(msg && Number.isFinite(msg.x) && Number.isFinite(msg.y));
  assert.equal(boss.hp, 150);
});

test('mergeConflict: a revive that cannot spawn (entity cap) is retried on the next tick', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 1, idle);
  const real = w.spawnEnemy;
  w.spawnEnemy = () => null;
  H.stepN(w, 6.1 * 60, idle);
  assert.equal(boss.defeated, false);
  assert.equal(twins(w).length, 1, 'still waiting');
  assert.ok(boss.resolveT < 0, 'the window has run out and the revive is waiting for room');
  const r = fakeRenderer();
  const rec = H.recorder(r, CB);
  boss.draw(r, 1);
  assert.ok(rec.texts().some((b) => b.str === '0.0'), 'the banner counts down to 0.0 and stays there, never negative');
  assert.ok(!rec.texts().some((b) => b.str.startsWith('-')));
  rec.restore();
  w.spawnEnemy = real;
  H.stepN(w, 2, idle);
  assert.equal(twins(w).length, 2);
  assert.equal(boss.resolveT, null);
});

test('mergeConflict: defeat clears the overlay state and leaves finite positions', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 5, idle);
  boss.startAttack('crossfire');
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(boss.resolveT, null);
  assert.equal(boss.deadSide, null);
  assert.equal(boss.attack, null);
  assert.equal(twins(w).length, 0);
  assert.ok(Number.isFinite(boss.x) && Number.isFinite(boss.y));
  const r = fakeRenderer();
  boss.draw(r, 1); // harmless even though the world never calls it again
});

test('mergeConflict: every event over a long fight carries a finite x and y', () => {
  const { w, boss } = start();
  const move = (i) => H.makeInput({ aimX: 160 + 100 * Math.cos(i / 40), aimY: 96 + 60 * Math.sin(i / 40), moveX: Math.cos(i / 90), moveY: Math.sin(i / 70), fire: true });
  H.stepN(w, 12 * 60, move); // two crossfire, two lines
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61); // phase 2: charge joins
  H.stepN(w, 12 * 60, move);
  w.damageEnemy(boss.head, 999); // finish window
  H.stepN(w, 7 * 60, move); // ... missed: revive
  w.damageEnemy(boss.head, 999);
  w.damageEnemy(boss.incoming, 999);
  H.stepN(w, 3, move);
  assert.equal(boss.defeated, true);
  const kinds = new Set(w.events.map((e) => e.type));
  for (const k of ['bossPhase', 'beamCharge', 'beam', 'revive', 'text', 'enemyShoot']) assert.ok(kinds.has(k), `saw ${k}`);
  for (const e of w.events) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.type} has x ${e.x}, y ${e.y}`);
  for (const b of w.eBullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

test('mergeConflict: nothing under the controller or its twins is ever NaN, even with the player on top of a twin', () => {
  const { w, boss } = start();
  w.player.x = boss.head.x;
  w.player.y = boss.head.y;
  boss.startAttack('charge');
  H.stepN(w, 100, () => H.makeInput({ aimX: boss.head.x, aimY: boss.head.y }));
  for (const e of [boss.head, boss.incoming]) {
    for (const k of ['x', 'y', 'vx', 'vy', 'hp']) assert.ok(Number.isFinite(e[k]), `${k} ${e[k]}`);
  }
});

// ---- drawing -------------------------------------------------------------------------------------------------------------

test('mergeConflict: twins draw a 24x3 HP bar 4 px above the sprite, with a white notch at 17 HP', () => {
  const { CB, w, boss } = start();
  const def = CB.Art.spriteDef('conflictHead_0');
  const top = Math.round(boss.head.y - def.h / 2);
  boss.head.hp = 65; // half
  const r = fakeRenderer();
  CB.Enemies.conflictTwin.draw(boss.head, r, 1);
  const rects = r.calls.filter((c) => c.name === 'rect').map((c) => c.a);
  const bx = Math.round(boss.head.x - 12);
  const by = top - 4 - 3;
  const bg = rects.find((a) => a[2] === 24 && a[3] === 3 && a[4] === CB.Pal.C.ink);
  assert.ok(bg, 'ink background 24x3');
  assert.equal(bg[0], bx);
  assert.equal(bg[1], by);
  const fill = rects.find((a) => a[1] === by && a[3] === 3 && a[4] === CB.Pal.C.blue && a[2] > 0 && a[2] < 24);
  assert.ok(fill, 'blue fill');
  assert.equal(fill[0], bx);
  assert.equal(fill[2], 12, 'half of 24 px');
  const notch = rects.find((a) => a[2] === 1 && a[3] === 3 && a[4] === CB.Pal.C.white);
  assert.ok(notch, 'notch');
  assert.equal(notch[0], bx + Math.round((24 * 17) / 130));
  assert.equal(notch[1], by);
  // the incoming twin fills green
  const ri = fakeRenderer();
  CB.Enemies.conflictTwin.draw(boss.incoming, ri, 1);
  assert.ok(ri.calls.some((c) => c.name === 'rect' && c.a[4] === CB.Pal.C.green && c.a[3] === 3));
  void w;
});

test('mergeConflict: a twin draws its own side sprite with the hit flash, and the tiny <<<<<<< / >>>>>>> labels', () => {
  const { CB, boss } = start();
  const names = (e, flash) => {
    e.hitFlash = flash;
    const r = fakeRenderer();
    CB.Enemies.conflictTwin.draw(e, r, 1);
    return r.calls.filter((c) => c.name === 'sprite');
  };
  const h = names(boss.head, 0.05);
  assert.equal(h.length, 1);
  assert.match(h[0].a[0], /^conflictHead_[01]$/);
  assert.equal(h[0].a[3].white, true);
  const i = names(boss.incoming, 0);
  assert.match(i[0].a[0], /^conflictIncoming_[01]$/);
  assert.equal(i[0].a[3].white, false);
  // labels are pixel chevrons: no r.text is spent on them
  const r = fakeRenderer();
  CB.Enemies.conflictTwin.draw(boss.head, r, 1);
  assert.equal(r.calls.filter((c) => c.name === 'text').length, 0);
});

test('mergeConflict: the finish zone (<= 17 HP) flashes the bar; blinks go through CB.Comfort when it exists', () => {
  const { CB, boss } = start();
  let blinks = 0;
  CB.Comfort = { blink: () => { blinks++; return true; }, calm: () => false };
  boss.head.hp = 10;
  const r = fakeRenderer();
  CB.Enemies.conflictTwin.draw(boss.head, r, 1);
  assert.ok(blinks > 0);
  assert.ok(r.calls.some((c) => c.name === 'rect' && c.a[3] === 3 && c.a[4] === CB.Pal.C.gold), 'the fill turns gold');
});

test('mergeConflict: overlay draws the telegraph line, the beam and the FINISH banner on screen without text collisions', () => {
  const { CB, w, boss } = start();
  const r = fakeRenderer();
  const rec = H.recorder(r, CB);
  // idle: nothing
  boss.draw(r, 1);
  assert.equal(r.calls.length, 0);
  // telegraph: a line and nothing else heavy
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  boss.startAttack('line');
  boss.draw(r, 1.0);
  boss.draw(r, 1.04);
  assert.ok(r.calls.some((c) => c.name === 'line'));
  r.calls.length = 0;
  // beam: a 3 px line (at least 3 parallel lines) with a bright core
  H.stepN(w, 50, idle);
  assert.ok(boss.attack && boss.attack.t >= 0.8);
  boss.draw(r, 1);
  const lines = r.calls.filter((c) => c.name === 'line');
  assert.ok(lines.length >= 4, `beam lines ${lines.length}`);
  assert.ok(lines.some((c) => c.a[4] === CB.Pal.C.white), 'bright core');
  // FINISH banner
  boss.attack = null;
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 3, idle);
  rec.clear();
  r.calls.length = 0;
  boss.draw(r, 1);
  const texts = rec.texts();
  assert.ok(texts.some((b) => b.str === 'FINISH INCOMING!'));
  assert.ok(texts.some((b) => /^\d\.\d$/.test(b.str)), 'the countdown');
  assert.equal(rec.outside().length, 0);
  assert.equal(rec.overlaps().length, 0);
  assert.ok(texts.every((b) => Math.abs(b.x + b.w / 2 - 160) < 1), 'centred');
  assert.equal(texts[0].y, 30);
  rec.restore();
});

test('mergeConflict: drawing without a clock never hands the renderer a NaN', () => {
  const { CB, w, boss } = start();
  const r = fakeRenderer();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 3, idle);
  boss.draw(r); // the finish banner, arrow and countdown bar
  boss.startAttack('crossfire');
  for (const e of twins(w)) CB.Enemies.conflictTwin.draw(e, r);
  assert.ok(r.calls.length > 10);
  for (const c of r.calls) for (const v of c.a) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${c.name} got ${v}`);
});

test('mergeConflict: charge telegraph marks the shaking twins; the whole draw path uses only documented renderer methods', () => {
  const { CB, w, boss } = start();
  const r = fakeRenderer();
  w.player.x = 160;
  w.player.y = 96;
  boss.startAttack('charge');
  H.stepN(w, 10, idle);
  boss.draw(r, 1);
  for (const e of twins(w)) CB.Enemies.conflictTwin.draw(e, r, 1);
  boss.startAttack('crossfire');
  boss.draw(r, 1);
  assert.ok(r.calls.length > 0);
});

test('mergeConflict: sprites have an ink outline, two shades per body colour, and the four frames share one size', () => {
  const { CB } = start();
  const names = ['conflictHead_0', 'conflictHead_1', 'conflictIncoming_0', 'conflictIncoming_1'];
  const d0 = CB.Art.spriteDef(names[0]);
  for (const n of names) {
    const d = CB.Art.spriteDef(n);
    assert.ok(d, n);
    assert.equal(d.w, d0.w);
    assert.equal(d.h, d0.h);
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = d.rows[y][x];
        if (ch === '.') continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const row = d.rows[y + dy];
          return !row || row[x + dx] === undefined || row[x + dx] === '.';
        });
        if (edge) assert.equal(ch, 'k', `${n}: silhouette pixel (${x},${y}) is "${ch}", not ink`);
      }
    }
    const chars = new Set(d.rows.join(''));
    assert.ok(chars.has('k'));
    if (n.startsWith('conflictHead')) assert.ok(chars.has('b') && chars.has('B'), `${n} needs both blues`);
    else assert.ok(chars.has('g') && chars.has('G'), `${n} needs both greens`);
    assert.ok(chars.has('w'), `${n} needs eye whites`);
  }
  assert.ok(d0.w <= 20 && d0.h <= 18, 'a 16x14-ish beetle for an r 8 hitbox');
  assert.notDeepEqual(CB.Art.spriteDef('conflictHead_0').rows, CB.Art.spriteDef('conflictHead_1').rows, 'two animation frames');
  assert.notDeepEqual(CB.Art.spriteDef('conflictIncoming_0').rows, CB.Art.spriteDef('conflictIncoming_1').rows, 'two animation frames');
  // the twins share a silhouette; the marking on the shell is what tells them apart: HEAD wears <, incoming wears > (its mirror image)
  const marks = (name, ch) => {
    const out = [];
    CB.Art.spriteDef(name).rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
    return out;
  };
  for (const f of [0, 1]) {
    const head = marks('conflictHead_' + f, 'c');
    const inc = marks('conflictIncoming_' + f, 'W');
    assert.equal(head.length, 5, 'a five-pixel chevron');
    assert.deepEqual(inc.map(([x, y]) => [d0.w - 1 - x, y]).sort(), head.slice().sort(), `frame ${f}: incoming's chevron mirrors HEAD's`);
    assert.ok(Math.min(...head.map(([x]) => x)) < Math.max(...head.map(([x]) => x)));
  }
});
