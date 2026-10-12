'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
// Rev 3: the finale test measures the diff lines with CB.Font, so font.js is loaded too.
const FILES = [...H.GAME_BASE, 'src/art/font.js', 'src/game/enemies/nullPointer.js', 'src/game/bosses/heisenbug.js'];
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);

function start(opts) {
  const o = opts || {};
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: o.seed || 17, god: o.god !== false });
  if (o.player) {
    w.player.x = o.player[0];
    w.player.y = o.player[1];
  }
  w.boss = CB.Bosses.heisenbug.create(w);
  return { CB, w, boss: w.boss };
}
const aimAt = (boss) => () => H.makeInput({ aimX: boss.body.x, aimY: boss.body.y });
const aimAway = () => H.makeInput({ aimX: 10, aimY: 170 });
function countFires(w) {
  const box = { n: 0, calls: [] };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => {
    box.n++;
    box.calls.push({ x: a[0], y: a[1], angle: a[2], speed: a[3], time: w.time });
    return orig(...a);
  };
  return box;
}
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Phase 2 in one call: 97 damage, one tick. Phase 3 follows with 90 more once the 0.5 s phase invulnerability is over.
function toPhase2(w) {
  w.damageEnemy(w.boss.body, 97);
  H.stepN(w, 1, aimAway);
}
function toPhase3(w) {
  toPhase2(w);
  H.stepN(w, 40, aimAway);
  w.damageEnemy(w.boss.body, 90);
  H.stepN(w, 1, aimAway);
}

// A renderer that only has the documented methods: anything else throws, so a draw that strays outside the contract fails.
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
const sprites = (r) => r.calls.filter((c) => c.name === 'sprite').map((c) => ({ name: c.a[0], x: c.a[1], y: c.a[2], opts: c.a[3] || {} }));

// ---- the plan's tests (rev 3 additions marked) ------------------------------------------------------------------------------

test('heisenbug: 240 HP, spawns away from the player', () => {
  const { w, boss } = start();
  assert.equal(boss.maxHp, 240);
  assert.equal(boss.hp, 240);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) > 70);
});

test('heisenbug: teleports after 2.0 s of continuous observation, landing ≥ 80 px from the player', () => {
  const { w, boss } = start();
  let tp = -1;
  for (let i = 0; i < 140 && tp < 0; i++) {
    H.stepN(w, 1, aimAt(boss));
    if (w.events.some((e) => e.type === 'teleport')) tp = i + 1;
  }
  assert.ok(tp >= 119 && tp <= 123, `teleport tick ${tp}`);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) >= 80);
  assert.equal(boss.observeT, 0);
});

test('heisenbug: observation resets when the aim leaves', () => {
  const { w, boss } = start();
  H.stepN(w, 72, aimAt(boss));
  assert.ok(boss.observeT > 1.1);
  H.stepN(w, 6, aimAway);
  assert.equal(boss.observeT, 0);
  H.stepN(w, 72, aimAt(boss));
  assert.equal(w.events.filter((e) => e.type === 'teleport').length, 0);
});

test('heisenbug: untargetable while fading during a blink', () => {
  const { w, boss } = start();
  boss.blinkT = 0;
  H.stepN(w, 3, aimAway);
  assert.equal(boss.body.targetable, false);
  assert.equal(w.damageEnemy(boss.body, 5), 0);
  H.stepN(w, 40, aimAway);
  assert.equal(boss.body.targetable, true);
});

test('heisenbug: thresholds are strict (144 → phase 1, 143 → phase 2)', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.body, 96);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 2);
});

test('heisenbug: phase 2 places 2 one-HP decoys per blink that pop with 404', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const decoys = alive(w, 'heisenDecoy');
  assert.equal(decoys.length, 2);
  w.damageEnemy(decoys[0], 1);
  assert.equal(decoys[0].dead, true);
  assert.ok(w.events.some((e) => e.type === 'text' && e.text === '404'));
});

test('heisenbug: phase 3 removes decoys, spirals ~8 bullets/s and keeps at most 4 nullPointers', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  assert.equal(alive(w, 'heisenDecoy').length, 2);
  w.damageEnemy(boss.body, 90);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 3);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
  boss.blinkT = 999;
  const c = countFires(w);
  H.stepN(w, 120, aimAway);
  assert.ok(c.n >= 14 && c.n <= 18, `spiral bullets in 2 s: ${c.n}`);
  let peak = 0;
  for (let i = 0; i < 30 * 60; i++) {
    H.stepN(w, 1, aimAway);
    peak = Math.max(peak, alive(w, 'nullPointer').length + w.spawns.filter((s) => s.kind === 'nullPointer').length);
  }
  assert.ok(peak >= 2 && peak <= 4, `peak ${peak}`);
});

test('heisenbug: defeat clears decoys; finale data; tinted sprites exist', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const B = CB.Bosses.heisenbug;
  const before = B.deathPoints(boss); // rev 3: deathPoints keeps working after defeat, with the same count
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
  assert.equal(boss.id, 'heisenbug'); // rev 3
  assert.equal(B.id, 'heisenbug');
  assert.ok(CB.Art.hasSprite(B.portrait));
  assert.ok(CB.Art.hasSprite('heisenbug_cyan_0') && CB.Art.hasSprite('heisenbug_mag_0'));
  assert.ok(B.diff.length >= 2 && B.diff.length <= 4);
  for (const l of B.diff) {
    assert.match(l, /^[-+] /);
    assert.ok(l.length <= 46, `diff line "${l}" is ${l.length} chars`);
    assert.ok(CB.Font.measure(l, 1) <= 228, `diff line "${l}" measures ${CB.Font.measure(l, 1)} px`); // rev 3
    for (const ch of l) assert.ok(CB.Font.has(ch), `glyph ${JSON.stringify(ch)} missing from the font`);
  }
  assert.equal(typeof B.file, 'string');
  const after = B.deathPoints(boss);
  assert.equal(before.length, 7);
  assert.equal(after.length, before.length);
  for (const p of after) assert.ok(finite(p.x) && finite(p.y));
});

// ---- module data and the shared boss rules ----------------------------------------------------------------------------------

test('heisenbug: module fields match the spec', () => {
  const { CB } = start();
  const B = CB.Bosses.heisenbug;
  assert.equal(B.name, 'THE HEISENBUG');
  assert.equal(B.tagline, 'works on my machine');
  assert.equal(B.commitMsg, 'fix: cannot reproduce (closed)');
  assert.equal(B.file, 'repro.js');
  assert.deepEqual(Array.from(B.diff), ['- // works on my machine', '+ // works on every machine', '+ // (probably)']);
  assert.equal(B.portrait, 'heisenbug_0');
  assert.equal(typeof B.create, 'function');
});

test('heisenbug: parts are boss, not regular, r 9, with spawn contact grace', () => {
  const { w, boss } = start();
  assert.equal(boss.body.r, 9);
  assert.equal(boss.body.boss, true);
  assert.equal(boss.body.regular, false);
  assert.ok(boss.body.noContactT >= 0.45);
  assert.equal(boss.body.hp, 240);
  toPhase2(w);
  boss.blinkT = 0;
  let first = null;
  for (let i = 0; i < 45; i++) {
    H.stepN(w, 1, aimAway);
    if (!first && alive(w, 'heisenDecoy').length) first = alive(w, 'heisenDecoy').map((d) => d.noContactT);
  }
  assert.ok(first, 'decoys appeared');
  for (const n of first) assert.ok(n >= 0.45, 'a new decoy is harmless for its first 0.5 s');
  const decoys = alive(w, 'heisenDecoy');
  assert.equal(decoys.length, 2);
  for (const d of decoys) {
    assert.equal(d.r, 9);
    assert.equal(d.hp, 1);
    assert.equal(d.boss, true);
    assert.equal(d.regular, false);
  }
});

test('heisenbug: spawns on the farthest candidate (first wins ties) from wherever the player stands', () => {
  const cases = [
    [[160, 96], { x: 60, y: 96 }], // 100 px to either side, the first candidate listed wins
    [[40, 96], { x: 260, y: 96 }],
    [[280, 96], { x: 60, y: 96 }],
  ];
  for (const [pl, want] of cases) {
    const { boss } = start({ player: pl });
    assert.equal(boss.body.x, want.x, `player ${pl}`);
    assert.equal(boss.body.y, want.y, `player ${pl}`);
  }
});

test('heisenbug: the controller mirrors the body (x, y, hp) every tick', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 30);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.hp, 210);
  assert.equal(boss.x, boss.body.x);
  assert.equal(boss.y, boss.body.y);
});

test('heisenbug: the first attack comes no earlier than one period (2.5 s) after spawn', () => {
  for (const seed of [1, 7, 17, 99]) {
    const { w } = start({ seed });
    const c = countFires(w);
    H.stepN(w, Math.floor(2.5 * 60) - 1, aimAway);
    assert.equal(c.n, 0, `seed ${seed}: bullets before 2.5 s`);
  }
});

// ---- blink -----------------------------------------------------------------------------------------------------------------

test('heisenbug: a blink fades out 0.3 s, jumps ≥ 80 px away, fades in 0.3 s, then fires a ring of 10 at speed 75', () => {
  const { w, boss } = start();
  const c = countFires(w);
  const from = { x: boss.body.x, y: boss.body.y };
  boss.blinkT = 0;
  const alphas = [];
  let jumpTick = -1;
  let ringTick = -1;
  let waitAtRing = -1;
  for (let i = 1; i <= 50; i++) {
    H.stepN(w, 1, aimAway);
    alphas.push(boss.body.alpha);
    if (jumpTick < 0 && w.events.some((e) => e.type === 'teleport')) jumpTick = i;
    if (ringTick < 0 && c.n > 0) {
      ringTick = i;
      waitAtRing = boss.blinkT;
    }
  }
  assert.ok(alphas[0] < 1 && alphas[0] > 0.9, `first fade step ${alphas[0]}`);
  assert.ok(alphas[8] < 0.6 && alphas[8] > 0.4, `halfway out ${alphas[8]}`);
  assert.equal(alphas[17], 0, 'fully out after 0.3 s');
  assert.ok(jumpTick >= 17 && jumpTick <= 19, `jump tick ${jumpTick}`);
  assert.ok(alphas[26] > 0.4 && alphas[26] < 0.6, `halfway in ${alphas[26]}`);
  assert.equal(alphas[35], 1, 'fully in after another 0.3 s');
  assert.ok(ringTick >= 35 && ringTick <= 37, `ring tick ${ringTick}`);
  assert.equal(c.n, 10, 'phase 1 has no decoys: just the 10-bullet ring');
  for (const f of c.calls) {
    assert.equal(f.speed, 75);
    assert.ok(Math.abs(f.x - boss.body.x) < 1e-9 && Math.abs(f.y - boss.body.y) < 1e-9, 'fired from the landing spot');
  }
  const angles = c.calls.map((f) => f.angle).sort((a, b) => a - b);
  for (let i = 1; i < angles.length; i++) assert.ok(Math.abs(angles[i] - angles[i - 1] - (2 * Math.PI) / 10) < 1e-9, 'evenly spaced');
  assert.ok(dist(boss.body, w.player) >= 80);
  assert.ok(dist(boss.body, from) > 1);
  const tp = w.events.filter((e) => e.type === 'teleport');
  assert.equal(tp.length, 1);
  assert.ok(finite(tp[0].x) && finite(tp[0].y) && finite(tp[0].x2) && finite(tp[0].y2));
  assert.ok(Math.abs(tp[0].x - from.x) < 1e-9 && Math.abs(tp[0].x2 - boss.body.x) < 1e-9, 'x, y is where it left, x2, y2 where it landed');
  assert.equal(w.events.filter((e) => e.type === 'enemyShoot').length, 1, 'one enemyShoot for the whole volley');
  assert.ok(waitAtRing >= 2.5 && waitAtRing <= 3.5, `wait after the ring ${waitAtRing}`);
  assert.equal(boss.blink, null);
  assert.equal(boss.body.targetable, true);
  assert.equal(boss.body.contact, true);
});

test('heisenbug: the body has no contact while it fades, and the first blink waits 2.5-3.5 s', () => {
  const { w, boss } = start();
  assert.ok(boss.blinkT >= 2.5 && boss.blinkT <= 3.5, `first blinkT ${boss.blinkT}`);
  boss.blinkT = 0;
  H.stepN(w, 5, aimAway);
  assert.equal(boss.body.contact, false);
  H.stepN(w, 40, aimAway);
  assert.equal(boss.body.contact, true);
});

test('heisenbug: phase 1 keeps blinking every 2.5-3.5 s of waiting', () => {
  const { w, boss } = start();
  let jumps = 0;
  let last = null;
  const gaps = [];
  for (let i = 0; i < 60 * 25; i++) {
    H.stepN(w, 1, aimAway);
    const n = w.events.filter((e) => e.type === 'teleport').length;
    if (n > jumps) {
      if (last != null) gaps.push((i - last) / 60);
      last = i;
      jumps = n;
    }
  }
  assert.ok(jumps >= 5, `${jumps} blinks in 25 s`);
  for (const g of gaps) assert.ok(g >= 3.1 - 0.05 && g <= 4.1 + 0.05, `gap between jumps ${g}`); // wait 2.5-3.5 s plus the 0.6 s fade
});

test('heisenbug: phase 2 blinks bring 2 decoys; the rings are 10 from the body plus 6 from each decoy', () => {
  const { w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  const c = countFires(w);
  H.stepN(w, 45, aimAway);
  const decoys = alive(w, 'heisenDecoy');
  assert.equal(decoys.length, 2);
  assert.equal(c.n, 22, 'one 10-ring and two 6-rings');
  for (const d of decoys) {
    assert.ok(c.calls.filter((f) => Math.abs(f.x - d.x) < 1e-9 && Math.abs(f.y - d.y) < 1e-9).length === 6, 'six bullets from each decoy');
    assert.ok(dist(d, w.player) >= 60 - 1e-9, `decoy ${dist(d, w.player)} px from the player`);
    assert.ok(dist(d, boss.body) >= 20, 'decoys do not sit on the real one');
  }
  assert.ok(dist(decoys[0], decoys[1]) >= 20);
  assert.equal(w.events.filter((e) => e.type === 'enemyShoot').length, 1, 'still one volley event');
});

test('heisenbug: decoys are untargetable and harmless while they fade in, and the next blink replaces them silently', () => {
  const { w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 22, aimAway); // jump happened around tick 18, fade-in under way
  let decoys = alive(w, 'heisenDecoy');
  assert.equal(decoys.length, 2);
  for (const d of decoys) {
    assert.equal(d.targetable, false);
    assert.equal(d.contact, false);
    assert.ok(d.alpha > 0 && d.alpha < 1, `decoy alpha ${d.alpha}`);
    assert.equal(w.damageEnemy(d, 5), 0);
  }
  H.stepN(w, 20, aimAway);
  decoys = alive(w, 'heisenDecoy');
  for (const d of decoys) {
    assert.equal(d.targetable, true);
    assert.equal(d.alpha, 1);
  }
  const old = decoys.slice();
  w.events.length = 0;
  boss.blinkT = 0;
  H.stepN(w, 25, aimAway); // past the jump of the next blink
  for (const d of old) assert.equal(d.dead, true, 'old decoys are gone');
  assert.equal(alive(w, 'heisenDecoy').length, 2, 'and two new ones stand');
  assert.equal(w.events.filter((e) => e.type === 'text' && e.text === '404').length, 0, 'replacing is silent: no 404');
  for (const e of w.events.filter((ev) => ev.type === 'enemyDie' && ev.kind === 'heisenDecoy')) assert.equal(e.silent, true);
});

test('heisenbug: a decoy dies in one hit and only the real one needs more', () => {
  const { w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const hp0 = boss.body.hp;
  const d = alive(w, 'heisenDecoy')[0];
  w.firePlayerBolt(d.x - 20, d.y, 0).vx = 300;
  H.stepN(w, 12, aimAway);
  assert.equal(d.dead, true);
  const pop = w.events.find((e) => e.type === 'text' && e.text === '404');
  assert.ok(pop && finite(pop.x) && finite(pop.y));
  assert.equal(boss.body.hp, hp0, 'the real one is untouched');
  assert.equal(boss.defeated, false);
  assert.equal(alive(w, 'heisenDecoy').length, 1);
});

// ---- observation -----------------------------------------------------------------------------------------------------------

test('heisenbug: observation emits teleport (x2, y2) and a "!?" pop, then the timer starts over', () => {
  const { w, boss } = start();
  const from = { x: boss.body.x, y: boss.body.y };
  H.stepN(w, 125, aimAt(boss));
  const tp = w.events.find((e) => e.type === 'teleport');
  assert.ok(tp);
  assert.ok(finite(tp.x) && finite(tp.y) && finite(tp.x2) && finite(tp.y2));
  assert.ok(Math.abs(tp.x - from.x) < 1e-9 && Math.abs(tp.x2 - boss.body.x) < 1e-9);
  const pop = w.events.find((e) => e.type === 'text' && e.text === '!?');
  assert.ok(pop && finite(pop.x) && finite(pop.y));
  assert.equal(boss.observeT > 0, true, 'watching the new spot starts a new count');
  assert.ok(boss.observeT < 0.2);
});

test('heisenbug: the aim only counts within 14 px of the real body', () => {
  const { w, boss } = start();
  const near = () => H.makeInput({ aimX: boss.body.x + 13.5, aimY: boss.body.y });
  const far = () => H.makeInput({ aimX: boss.body.x + 14.5, aimY: boss.body.y });
  H.stepN(w, 30, near);
  assert.ok(boss.observeT > 0.45);
  H.stepN(w, 1, far);
  assert.equal(boss.observeT, 0);
});

test('heisenbug: watching a blink-faded body does not count', () => {
  const { w, boss } = start();
  boss.blinkT = 0;
  H.stepN(w, 12, aimAt(boss));
  assert.equal(boss.body.targetable, false);
  assert.equal(boss.observeT, 0);
});

test('heisenbug: the real one is watched only on its own spot, not on a decoy', () => {
  const { w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const d = alive(w, 'heisenDecoy')[0];
  H.stepN(w, 130, () => H.makeInput({ aimX: d.x, aimY: d.y }));
  assert.equal(boss.observeT, 0);
  assert.equal(w.events.filter((e) => e.type === 'teleport').length, 1, 'only the blink jump');
});

// ---- phases ----------------------------------------------------------------------------------------------------------------

test('heisenbug: a phase change emits bossPhase with finite x, y, shakes the screen and shields the body for 0.5 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  w.shake = 0;
  boss.update(w, 1 / 60); // straight into the controller: World.step decays the shake in the same tick
  assert.ok(w.shake >= 4, `shake ${w.shake}`);
  const ev = w.events.filter((e) => e.type === 'bossPhase');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].phase, 2);
  assert.ok(finite(ev[0].x) && finite(ev[0].y));
  assert.ok(boss.body.invuln > 0.45);
  assert.equal(w.damageEnemy(boss.body, 5), 0, 'blocked');
  H.stepN(w, 31, aimAway);
  assert.ok(w.damageEnemy(boss.body, 5) > 0, 'open again after 0.5 s');
});

test('heisenbug: one hit across both thresholds applies 1 → 2 → 3 in order', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 200); // 240 → 40, below 144 and below 60
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 3);
  const ev = w.events.filter((e) => e.type === 'bossPhase');
  assert.deepEqual(ev.map((e) => e.phase), [2, 3]);
  assert.equal(alive(w, 'heisenDecoy').length, 0, 'phase 3 never keeps decoys');
});

test('heisenbug: phases latch even if HP comes back', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.body.hp = 240;
  H.stepN(w, 5, aimAway);
  assert.equal(boss.phase, 2);
  assert.equal(w.events.filter((e) => e.type === 'bossPhase').length, 1, 'fires once');
  boss.body.hp = 59;
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 3);
  boss.body.hp = 240;
  H.stepN(w, 5, aimAway);
  assert.equal(boss.phase, 3);
  assert.equal(w.events.filter((e) => e.type === 'bossPhase').length, 2);
});

test('heisenbug: phase 3 is strictly below 60 HP', () => {
  let { w, boss } = start();
  boss.body.hp = 60;
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 2);
  ({ w, boss } = start());
  boss.body.hp = 59.5;
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 3);
});

test('heisenbug: phase 3 blinks every 5 s and leaves no decoys behind', () => {
  const { w, boss } = start();
  toPhase3(w);
  assert.equal(boss.phase, 3);
  assert.equal(boss.blinkT, 5, 'the first phase-3 blink is a full period away');
  boss.blinkT = 0;
  H.stepN(w, 36, aimAway); // the blink is over on its 36th tick, and the wait restarts at 5 s
  assert.equal(boss.blink, null);
  assert.equal(boss.blinkT, 5);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
});

test('heisenbug: the spiral fires two opposite bullets every 0.25 s at speed 70, turning 2.2 rad/s', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 999;
  const c = countFires(w);
  H.stepN(w, 31, aimAway);
  assert.equal(c.n, 4, 'two volleys of two in 31 ticks');
  for (const f of c.calls) assert.equal(f.speed, 70);
  const a0 = c.calls[0].angle;
  const a1 = c.calls[1].angle;
  assert.ok(Math.abs(Math.abs(a1 - a0) - Math.PI) < 1e-9, 'the second arm is opposite');
  const turn = c.calls[2].angle - c.calls[0].angle;
  assert.ok(Math.abs(turn - 2.2 * 0.25) < 1e-6, `turn per volley ${turn}`);
  for (const f of c.calls) assert.ok(Math.abs(f.x - boss.body.x) < 1e-9 && Math.abs(f.y - boss.body.y) < 1e-9);
});

test('heisenbug: the spiral pauses while the body is faded out', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 0;
  H.stepN(w, 2, aimAway);
  const c = countFires(w);
  H.stepN(w, 30, aimAway);
  assert.equal(c.n, 0, 'nothing fires from an invisible boss');
});

test('heisenbug: summons 2 nullPointers 2 s into phase 3 (the documented exception to periodic-timers-start-full), then every 8 s up to 4', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 999;
  const pending = () => w.spawns.filter((s) => s.kind === 'nullPointer').length;
  const total = () => alive(w, 'nullPointer').length + pending();
  H.stepN(w, 100, aimAway); // 1.67 s
  assert.equal(total(), 0, 'not before 2 s');
  H.stepN(w, 25, aimAway); // 2.08 s
  assert.equal(pending(), 2, 'two queued at the arena edge');
  for (const s of w.spawns.filter((q) => q.kind === 'nullPointer')) {
    assert.ok(finite(s.x) && finite(s.y));
    const edge = Math.min(s.x - w.arena.x, w.arena.x + w.arena.w - s.x, s.y - w.arena.y, w.arena.y + w.arena.h - s.y);
    assert.ok(edge <= 10 + 1e-9, 'on the edge');
  }
  H.stepN(w, 60, aimAway); // 3.1 s: the 0.6 s telegraph is over
  assert.equal(alive(w, 'nullPointer').length, 2);
  H.stepN(w, 8 * 60, aimAway); // 11.1 s: the second batch (queued at 10 s) has landed
  assert.equal(alive(w, 'nullPointer').length, 4, 'second wave tops up to 4');
  H.stepN(w, 8 * 60, aimAway); // 19.1 s: the third summon (18 s) finds the field full
  assert.equal(alive(w, 'nullPointer').length, 4, 'never more than 4');
  assert.equal(pending(), 0);
});

test('heisenbug: summons only top up to 4 counting the ones already queued', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 999;
  w.queueSpawn('nullPointer', 100, 100, {}, 50);
  w.queueSpawn('nullPointer', 120, 100, {}, 50);
  w.queueSpawn('nullPointer', 140, 100, {}, 50);
  H.stepN(w, 130, aimAway);
  const queued = w.spawns.filter((s) => s.kind === 'nullPointer').length;
  assert.equal(queued, 4, 'one more fits under the cap of 4');
});

test('heisenbug: summoned nullPointers are ordinary regular enemies and do not count as boss parts', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 999;
  H.stepN(w, 3 * 60, aimAway);
  const np = alive(w, 'nullPointer');
  assert.ok(np.length >= 1);
  for (const e of np) {
    assert.equal(e.boss, false);
    assert.equal(e.regular, true);
  }
});

// ---- defeat ----------------------------------------------------------------------------------------------------------------

test('heisenbug: defeat sets defeated and hp 0 in the update that sees the body die, and clears overlay state', () => {
  const { w, boss } = start();
  H.stepN(w, 100, aimAt(boss));
  assert.ok(boss.observeT > 1);
  w.damageEnemy(boss.body, 999);
  assert.equal(boss.defeated, false, 'noticed on the next update');
  H.stepN(w, 1, aimAway);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(boss.observeT, 0);
  assert.equal(boss.blink, null);
  assert.ok(finite(boss.x) && finite(boss.y));
});

test('heisenbug: defeat in the middle of a blink still ends cleanly', () => {
  const { w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 25, aimAway);
  assert.ok(boss.blink);
  boss.body.hp = 0;
  boss.body.dead = true; // killed by something that bypassed targeting
  H.stepN(w, 1, aimAway);
  assert.equal(boss.defeated, true);
  assert.equal(boss.blink, null);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
});

test('heisenbug: the killing blow in phase 3 lands with the spiral and summons running', () => {
  const { w, boss } = start();
  toPhase3(w);
  boss.blinkT = 999;
  H.stepN(w, 5 * 60, aimAway);
  assert.ok(w.eBullets.length > 0);
  assert.ok(alive(w, 'nullPointer').length > 0);
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.defeated, true);
  assert.equal(boss.phase, 3);
});

test('heisenbug: deathPoints is the body plus 6 points on a radius-14 ring, before and after defeat', () => {
  const { CB, w, boss } = start();
  const B = CB.Bosses.heisenbug;
  const pts = B.deathPoints(boss);
  assert.equal(pts.length, 7);
  assert.equal(pts[0].x, boss.body.x);
  assert.equal(pts[0].y, boss.body.y);
  for (const p of pts.slice(1)) assert.ok(Math.abs(Math.hypot(p.x - boss.body.x, p.y - boss.body.y) - 14) < 1e-9);
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, aimAway);
  const dead = B.deathPoints(boss);
  assert.equal(dead.length, 7);
  for (let i = 0; i < 7; i++) assert.ok(Math.abs(dead[i].x - pts[i].x) < 1e-9 && Math.abs(dead[i].y - pts[i].y) < 1e-9);
});

// ---- rules -----------------------------------------------------------------------------------------------------------------

test('heisenbug: every event over a long fight carries finite x, y (rule 11)', () => {
  const { w, boss } = start({ god: true });
  const seen = new Set();
  let ticks = 0;
  const check = () => {
    for (const e of w.events) {
      seen.add(e.type);
      assert.ok(finite(e.x) && finite(e.y), `${e.type} has x=${e.x} y=${e.y}`);
    }
    w.events.length = 0;
  };
  const run = (n, input) => {
    for (let i = 0; i < n; i++) {
      H.stepN(w, 1, input);
      ticks++;
      check();
    }
  };
  const hit = (dmg) => {
    for (let i = 0; i < 200 && !(boss.body.targetable && boss.body.invuln <= 0); i++) run(1, aimAway);
    w.damageEnemy(boss.body, dmg);
    check();
  };
  run(8 * 60, aimAt(boss)); // observation teleports and a blink
  hit(97);
  run(12 * 60, aimAway); // phase 2: decoys, rings
  const d = alive(w, 'heisenDecoy')[0];
  if (d) w.damageEnemy(d, 1);
  check();
  hit(90);
  run(20 * 60, aimAway); // phase 3: spiral, summons
  hit(999);
  run(2, aimAway);
  assert.equal(boss.defeated, true);
  assert.ok(ticks > 2000);
  for (const t of ['teleport', 'text', 'bossPhase', 'enemyShoot', 'enemyDie', 'spawn']) assert.ok(seen.has(t), `fight should have produced ${t}`);
});

test('heisenbug: the body publishes velocity as dx/dt on the tick it jumps and stands still otherwise', () => {
  const { w, boss } = start();
  boss.blinkT = 0;
  let jumped = false;
  for (let i = 0; i < 40; i++) {
    const x0 = boss.body.x;
    const y0 = boss.body.y;
    H.stepN(w, 1, aimAway);
    const dx = boss.body.x - x0;
    const dy = boss.body.y - y0;
    assert.ok(Math.abs(boss.body.vx - dx * 60) < 1e-6 && Math.abs(boss.body.vy - dy * 60) < 1e-6, `tick ${i}: v ${boss.body.vx},${boss.body.vy} vs d ${dx},${dy}`);
    if (Math.hypot(dx, dy) > 1) {
      jumped = true;
      assert.ok(Math.hypot(boss.body.vx, boss.body.vy) > 0);
    }
  }
  assert.ok(jumped);
});

test('heisenbug: same seed and inputs give the same fight', () => {
  const run = () => {
    const { w, boss } = start({ seed: 5 });
    w.damageEnemy(boss.body, 97);
    const trace = [];
    for (let i = 0; i < 600; i++) {
      H.stepN(w, 1, aimAway);
      if (i % 30 === 0) trace.push([boss.body.x, boss.body.y, boss.phase, w.eBullets.length].map((v) => Math.round(v * 1000) / 1000).join(','));
    }
    return trace.join(' ');
  };
  assert.equal(run(), run());
});

test('heisenbug: an enemy-bullet storm stays under the caps with no NaN', () => {
  const { w, boss } = start();
  toPhase3(w);
  for (let i = 0; i < 40 * 60; i++) {
    H.stepN(w, 1, aimAway);
    assert.ok(w.eBullets.length <= 400, 'enemy bullet cap');
    for (const b of w.eBullets) assert.ok(finite(b.x) && finite(b.y));
    if (boss.body.invuln > 0) boss.body.invuln = 0;
  }
  assert.ok(w.eBullets.length <= 400);
  assert.ok(finite(boss.body.x) && finite(boss.body.y));
});

// ---- drawing ---------------------------------------------------------------------------------------------------------------

test('heisenbug: sprites are 16x14 moths with an ink outline, several shades and a 3-frame flutter', () => {
  const { CB } = start();
  const names = ['heisenbug_0', 'heisenbug_1', 'heisenbug_2'];
  const defs = names.map((n) => CB.Art.spriteDef(n));
  for (const d of defs) {
    assert.ok(d, 'defined');
    assert.equal(d.w, 16);
    assert.equal(d.h, 14);
    const chars = new Set();
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = d.rows[y][x];
        if (ch === '.') continue;
        chars.add(ch);
        if (ch === 'k') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const open = nx < 0 || ny < 0 || nx >= d.w || ny >= d.h || d.rows[ny][nx] === '.';
          assert.ok(!open, `${d.name}: pixel ${ch} at ${x},${y} touches the outside without an ink outline`);
        }
      }
    }
    assert.ok(chars.has('k'), 'has ink');
    assert.ok(chars.size >= 5, `${d.name}: only ${chars.size} palette chars`);
    // Symmetric about the vertical axis: a moth seen from above.
    for (let y = 0; y < d.h; y++) {
      const row = d.rows[y];
      const mirrored = row.split('').reverse().join('');
      for (let x = 0; x < d.w; x++) assert.equal((row[x] === '.') === (mirrored[x] === '.'), true, `${d.name}: row ${y} silhouette is not symmetric`);
    }
  }
  assert.notEqual(defs[0].rows.join('|'), defs[1].rows.join('|'));
  assert.notEqual(defs[0].rows.join('|'), defs[2].rows.join('|'));
  assert.notEqual(defs[1].rows.join('|'), defs[2].rows.join('|'));
  for (let i = 0; i < 3; i++) {
    const cy = CB.Art.spriteDef('heisenbug_cyan_' + i);
    const mg = CB.Art.spriteDef('heisenbug_mag_' + i);
    assert.ok(cy && mg);
    assert.equal(cy.w, 16);
    assert.equal(mg.h, 14);
    assert.deepEqual(Array.from(cy.rows), Array.from(defs[i].rows), 'a tint keeps the shape');
    const solid = new Set(Object.values(cy.pal).filter(Boolean));
    assert.deepEqual(Array.from(solid), ['#5FD4E0']);
    assert.deepEqual(Array.from(new Set(Object.values(mg.pal).filter(Boolean))), ['#E055B0']);
  }
  for (const n of ['heisenEye_0', 'heisenEye_1']) assert.ok(CB.Art.hasSprite(n));
});

test('heisenbug: the body draws cyan left, magenta right, then itself, at the same y', () => {
  const { CB, boss } = start();
  const r = fakeRenderer();
  boss.body.x = 100;
  boss.body.y = 80;
  CB.Enemies.heisenbug.draw(boss.body, r, 0.5);
  const s = sprites(r);
  assert.equal(s.length, 3);
  assert.match(s[0].name, /^heisenbug_cyan_[012]$/);
  assert.match(s[1].name, /^heisenbug_mag_[012]$/);
  assert.match(s[2].name, /^heisenbug_[012]$/);
  assert.equal(s[0].x, 99);
  assert.equal(s[1].x, 101);
  assert.equal(s[2].x, 100);
  assert.equal(s[0].y, s[2].y);
  assert.equal(s[1].y, s[2].y);
  assert.equal(s[0].opts.alpha, 0.5);
  assert.equal(s[1].opts.alpha, 0.5);
  assert.ok(!s[2].opts.white);
  const frame = (n) => n.slice(-1);
  assert.equal(frame(s[0].name), frame(s[2].name), 'all three copies flutter on the same frame');
  assert.equal(frame(s[1].name), frame(s[2].name));
});

test('heisenbug: the chromatic offset grows from 1 to 3 px with the observation timer', () => {
  const { CB, boss } = start();
  const offsetAt = (obs) => {
    boss.observeT = obs;
    boss.body.data.observeT = obs;
    const r = fakeRenderer();
    CB.Enemies.heisenbug.draw(boss.body, r, 0.5);
    const s = sprites(r);
    assert.equal(s[1].x - s[0].x, 2 * (s[2].x - s[0].x), 'symmetric around the body');
    return s[2].x - s[0].x;
  };
  assert.equal(offsetAt(0), 1);
  assert.equal(offsetAt(1.0), 2);
  assert.equal(offsetAt(2.0), 3);
  assert.ok(offsetAt(0.5) >= 1 && offsetAt(0.5) <= 2);
  assert.ok(offsetAt(1.5) >= 2 && offsetAt(1.5) <= 3);
});

test('heisenbug: the body flashes white once at 1.0 s of observation, and on every hit; decoys never flash', () => {
  const { CB, w, boss } = start();
  const whiteAt = (obs) => {
    boss.body.data.observeT = obs;
    const r = fakeRenderer();
    CB.Enemies.heisenbug.draw(boss.body, r, 0.5);
    return !!sprites(r)[2].opts.white;
  };
  assert.equal(whiteAt(0), false);
  assert.equal(whiteAt(0.9), false);
  assert.equal(whiteAt(1.0), true);
  assert.equal(whiteAt(1.05), true);
  assert.equal(whiteAt(1.3), false, 'a short flash, not a state');
  assert.equal(whiteAt(1.9), false);
  boss.body.data.observeT = 0;
  boss.body.hitFlash = 0.08;
  let r = fakeRenderer();
  CB.Enemies.heisenbug.draw(boss.body, r, 0.5);
  assert.equal(sprites(r)[2].opts.white, true);
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const d = alive(w, 'heisenDecoy')[0];
  d.hitFlash = 0.08;
  r = fakeRenderer();
  CB.Enemies.heisenDecoy.draw(d, r, 0.5);
  const ds = sprites(r);
  assert.equal(ds.length, 3, 'a decoy draws the same three copies');
  assert.ok(!ds[2].opts.white);
  assert.match(ds[2].name, /^heisenbug_[012]$/, 'with the real sprite frames');
});

test('heisenbug: a decoy looks like the body (same copies, same offset) when nobody is watching', () => {
  const { CB, w, boss } = start();
  toPhase2(w);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const d = alive(w, 'heisenDecoy')[0];
  const rb = fakeRenderer();
  const rd = fakeRenderer();
  boss.body.data.observeT = 0;
  d.x = boss.body.x;
  d.y = boss.body.y;
  CB.Enemies.heisenbug.draw(boss.body, rb, 3.3);
  CB.Enemies.heisenDecoy.draw(d, rd, 3.3);
  assert.deepEqual(plainCalls(rb), plainCalls(rd));
});
function plainCalls(r) {
  return JSON.parse(JSON.stringify(r.calls));
}

test('heisenbug: a fading body flickers its sprite (calm-aware) and keeps the RGB copies', () => {
  const { CB, boss } = start();
  const hz = [];
  CB.Comfort = { calm: () => false, blink: (t, f) => { hz.push(f); return Math.floor(t * f) % 2 === 0; } };
  boss.body.alpha = 0.5;
  const shown = new Set();
  for (let i = 0; i < 24; i++) {
    const r = fakeRenderer();
    CB.Enemies.heisenbug.draw(boss.body, r, i / 60);
    const s = sprites(r);
    assert.ok(s.length === 2 || s.length === 3, 'copies always draw, the main sprite flickers');
    shown.add(s.length);
  }
  assert.equal(shown.size, 2, 'it flickers on and off');
  assert.ok(hz.length > 0, 'the flicker goes through CB.Comfort.blink');
  assert.ok(hz.every((f) => f > 4), 'a fast blink, so calm mode slows it');
  boss.body.alpha = 1;
  hz.length = 0;
  const r = fakeRenderer();
  CB.Enemies.heisenbug.draw(boss.body, r, 0.5);
  assert.equal(sprites(r).length, 3, 'a settled body does not flicker');
});

test('heisenbug: the same flicker works with no CB.Comfort', () => {
  const { CB, boss } = start();
  assert.equal(CB.Comfort, undefined);
  boss.body.alpha = 0.4;
  const r = fakeRenderer();
  assert.doesNotThrow(() => CB.Enemies.heisenbug.draw(boss.body, r, 0.2));
});

test('heisenbug: the observer ring lights floor(16 * observeT / 2) of 16 dots on a radius-14 circle around the real body', () => {
  const { CB, boss } = start();
  const body = boss.body;
  const dotsAt = (obs) => {
    boss.observeT = obs;
    const r = fakeRenderer();
    boss.draw(r, 0.5);
    const rects = r.calls.filter((c) => c.name === 'rect').map((c) => ({ x: c.a[0], y: c.a[1], w: c.a[2], h: c.a[3], color: c.a[4] }));
    return { rects, lit: rects.filter((q) => q.color === CB.Pal.C.cyan), r };
  };
  assert.equal(dotsAt(0).r.calls.length, 0, 'nothing is drawn when nobody watches');
  for (const [obs, n] of [[0.13, 1], [0.5, 4], [1.0, 8], [1.5, 12], [1.99, 15]]) {
    const { lit, rects } = dotsAt(obs);
    assert.equal(lit.length, n, `observeT ${obs}`);
    assert.equal(rects.length, 16, 'all 16 dots are drawn, the unlit ones dim');
    for (const q of rects) {
      const cx = q.x + q.w / 2;
      const cy = q.y + q.h / 2;
      assert.ok(Math.abs(Math.hypot(cx - body.x, cy - body.y) - 14) < 1.3, `dot at ${cx},${cy}`);
    }
  }
});

test('heisenbug: the eye over the ring turns red after 1.5 s', () => {
  const { boss } = start();
  const eyeAt = (obs) => {
    boss.observeT = obs;
    const r = fakeRenderer();
    boss.draw(r, 0.5);
    return sprites(r).filter((s) => /^heisenEye_/.test(s.name));
  };
  assert.equal(eyeAt(0).length, 0);
  for (const obs of [0.2, 1.0, 1.49]) {
    const e = eyeAt(obs);
    assert.equal(e.length, 1);
    assert.equal(e[0].name, 'heisenEye_0', `calm eye at ${obs}`);
    assert.equal(e[0].x, boss.body.x);
    assert.ok(e[0].y < boss.body.y - 14, 'above the ring');
  }
  for (const obs of [1.5, 1.8, 1.99]) assert.equal(eyeAt(obs)[0].name, 'heisenEye_1', `red eye at ${obs}`);
});

test('heisenbug: the overlay is silent while the body is hidden or the boss is defeated', () => {
  const { w, boss } = start();
  boss.observeT = 1.2;
  boss.body.targetable = false;
  let r = fakeRenderer();
  boss.draw(r, 0.5);
  assert.equal(r.calls.length, 0, 'no ring around a faded body');
  boss.body.targetable = true;
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, aimAway);
  r = fakeRenderer();
  assert.doesNotThrow(() => boss.draw(r, 0.5));
  assert.equal(r.calls.length, 0);
});

test('heisenbug: every draw path runs with only the documented renderer methods', () => {
  const { CB, w, boss } = start();
  toPhase3(w);
  const r = fakeRenderer();
  for (let i = 0; i < 400; i++) {
    H.stepN(w, 1, aimAt(boss));
    for (const e of w.enemies) if (!e.dead) CB.Enemies[e.kind].draw(e, r, w.time);
    if (!boss.defeated) boss.draw(r, w.time);
    if (i === 100) boss.blinkT = 0;
  }
  assert.ok(r.calls.length > 0);
  for (const c of r.calls) for (const v of c.a) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${c.name} got ${v}`);
});

test('heisenbug: the draw hooks never reach for the global scope beyond CB (no Math.random, no Date.now)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/game/bosses/heisenbug.js'), 'utf8');
  assert.ok(!/Math\.random/.test(src.replace(/\/\/.*$/gm, '')));
  assert.ok(!/Date\.now/.test(src.replace(/\/\/.*$/gm, '')));
});
