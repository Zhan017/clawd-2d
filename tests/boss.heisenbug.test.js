'use strict';
// The Heisenbug, "The Observer Effect" (docs/superpowers/specs/2026-10-13-heisenbug-observer-effect.md). One test per rule and per fairness bullet:
// the gaze, stone and wave, strain, lashes, the three phases, the last blow, the fairness list, the engine notes (onHit, clink throttle, cursor tint, quips).
// Worlds are built by hand: the moths are put where a test needs them and the aim decides which of them is looked at.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { makeBot } = require('./bot');

const FILES = [...H.GAME_BASE, 'src/art/font.js', 'src/game/bosses/heisenbug.js'];
const DT = 1 / 60;
const TAU = Math.PI * 2;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const deg = (r) => (r * 180) / Math.PI;

// A world with the boss in it. Clawd stands at (160, 126) unless `player` says otherwise; god mode counts hits in stats.wouldHits.
function start(o) {
  const opt = o || {};
  const CB = H.load(opt.files || FILES);
  const w = CB.createWorld({ seed: opt.seed || 17, god: opt.god !== false, mode: opt.yolo ? { yolo: true } : {}, patches: opt.patches });
  if (opt.player) {
    w.player.x = opt.player[0];
    w.player.y = opt.player[1];
  }
  w.boss = CB.Bosses.heisenbug.create(w);
  w.boss.lashIdle = -1e9; // no idle lash, unless a test is about the lashes
  return { CB, w, boss: w.boss };
}
const put = (m, x, y) => {
  m.x = x;
  m.y = y;
};
const aim = (x, y, extra) => () => H.makeInput(Object.assign({ aimX: x, aimY: y }, extra || {}));
const aimAt = (m, extra) => () => H.makeInput(Object.assign({ aimX: m.x, aimY: m.y }, extra || {}));
const AWAY = aim(10, 170); // the ray runs out toward the bottom left corner
const bolt = (n) => ({ dmg: n === undefined ? 1 : n });
const hit = (w, m, n) => w.damageEnemy(m, n, bolt(n));
const step = (w, n, input) => H.stepN(w, n, input || AWAY);
const events = (w, type) => w.events.filter((e) => e.type === type);
const P2 = (boss) => Math.round(0.6 * boss.maxHp);
const P3 = (boss) => Math.round(0.25 * boss.maxHp);

// The standard picture: a stone moth straight ahead of Clawd at (160, 46) and a wave out on her right at (260, 120). The fight is already
// past its quiet first 2.6 s (tests of the quiet start use start() or a bot fight).
function pair(o) {
  const t = start(o);
  t.boss.age = 10;
  const [a, b] = t.boss.moths;
  put(a, 160, 46);
  put(b, 260, 120);
  step(t.w, 1, aimAt(a));
  t.w.events.length = 0;
  return Object.assign(t, { a, b, look: aimAt(a) });
}

// An aim point whose ray from Clawd passes `off` px beside moth m (the distance from the moth's centre to the ray is exactly off).
function ray(w, m, off) {
  const p = w.player;
  const d = dist(m, p);
  const a = Math.atan2(m.y - p.y, m.x - p.x) + Math.asin(off / d);
  return { aimX: p.x + Math.cos(a) * 100, aimY: p.y + Math.sin(a) * 100 };
}

// Records every enemy bullet the world is asked for: { x, y, angle, speed, time, player: Clawd where she stood when it fired }.
function countFires(w) {
  const box = { n: 0, calls: [] };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => {
    box.n++;
    box.calls.push({ x: a[0], y: a[1], angle: a[2], speed: a[3], time: w.time, player: { x: w.player.x, y: w.player.y } });
    return orig(...a);
  };
  return box;
}

// Phase 2 in one call (the third moth lands), then the shield is waited out. Phase 3 the same.
function toPhase2(t) {
  t.boss.body.hp = P2(t.boss) - 0.5;
  step(t.w, 1);
  step(t.w, 40);
  t.boss.lashIdle = -1e9;
}
function toPhase3(t) {
  toPhase2(t);
  t.boss.body.hp = P3(t.boss) - 0.5;
  step(t.w, 1);
  step(t.w, 40); // the merge is over
  t.boss.lashIdle = -1e9;
  t.w.events.length = 0;
}

// A renderer that only has the documented methods (anything else throws) and records what was asked of it.
function spyRenderer() {
  const calls = [];
  const rec = (name) => (...a) => {
    calls.push({ name, a });
  };
  return {
    calls,
    clear: rec('clear'), rect: rec('rect'), frame: rec('frame'), disc: rec('disc'), ring: rec('ring'), line: rec('line'), sprite: rec('sprite'), text: rec('text'),
    measure: (s, sc) => String(s).length * 6 * (sc || 1),
    alpha: (a, fn) => {
      calls.push({ name: 'alpha', a: [a] });
      fn();
    },
    shaken: (dx, dy, fn) => fn(),
    squash: (ax, ay, sx, sy, fn) => {
      calls.push({ name: 'squash', a: [ax, ay, sx, sy] });
      fn();
    },
  };
}
const sprites = (r) => r.calls.filter((c) => c.name === 'sprite').map((c) => ({ name: c.a[0], x: c.a[1], y: c.a[2], o: c.a[3] || {} }));

// ---- the module ------------------------------------------------------------------------------------------------------------

test('heisenbug: the card, the commit line and the sprites the smoke test pins are kept', () => {
  const { CB } = start();
  const B = CB.Bosses.heisenbug;
  assert.equal(B.id, 'heisenbug');
  assert.equal(B.name, 'THE HEISENBUG');
  assert.equal(B.tagline, 'works on my machine');
  assert.equal(B.commitMsg, 'fix: cannot reproduce (closed)');
  assert.equal(B.file, 'repro.js');
  assert.deepEqual(Array.from(B.diff), ['- // works on my machine', '+ // works on every machine', '+ // (probably)']);
  assert.equal(B.portrait, 'heisenbug_0');
  assert.equal(typeof B.create, 'function');
  for (const l of B.diff) {
    assert.match(l, /^[-+] /);
    assert.ok(CB.Font.measure(l, 1) <= 228, `diff line "${l}" measures ${CB.Font.measure(l, 1)} px`);
    for (const ch of l) assert.ok(CB.Font.has(ch), `glyph ${JSON.stringify(ch)} missing from the font`);
  }
  for (const n of ['heisenbug_0', 'heisenbug_1', 'heisenbug_2', 'heisenbug_cyan_0', 'heisenbug_mag_0', 'heisenEye_0', 'heisenEye_1', 'heisenStone_0', 'heisenbug_yel_0']) {
    assert.ok(CB.Art.hasSprite(n), n);
  }
  assert.ok(CB.Art.hasSprite(B.portrait));
});

test('heisenbug: the sprites are 16x14 ink-outlined moths, and the stone one is grey', () => {
  const { CB } = start();
  for (const n of ['heisenbug_0', 'heisenbug_1', 'heisenbug_2', 'heisenStone_0']) {
    const d = CB.Art.spriteDef(n);
    assert.deepEqual([d.w, d.h], [16, 14], n);
    assert.ok(d.rows.join('').includes('k'), `${n} has the ink outline`);
  }
  const stone = CB.Art.spriteDef('heisenStone_0');
  const colours = new Set(stone.rows.join('').replace(/\./g, '').split(''));
  for (const ch of colours) assert.ok('kseSdW'.includes(ch), `stone uses only ink and greys, not "${ch}"`);
  assert.ok(colours.has('s') && colours.has('S'), 'two shades of grey');
  for (const n of ['heisenEye_0', 'heisenEye_1']) assert.deepEqual([CB.Art.spriteDef(n).w, CB.Art.spriteDef(n).h], [9, 5]);
});

test('heisenbug: MAX_HP sits in 300-360 and the thresholds are round(0.6 x) and round(0.25 x), each strictly below and latching', () => {
  const { w, boss } = start();
  const max = boss.maxHp;
  assert.ok(max >= 300 && max <= 360, `maxHp ${max}`);
  assert.equal(boss.hp, max);
  assert.equal(boss.phase, 1);
  boss.body.hp = P2(boss);
  step(w, 1);
  assert.equal(boss.phase, 1, 'exactly on the threshold is still phase 1');
  boss.body.hp = P2(boss) - 0.01;
  step(w, 1);
  assert.equal(boss.phase, 2);
  step(w, 40);
  boss.body.hp = P3(boss);
  step(w, 1);
  assert.equal(boss.phase, 2, 'exactly on the threshold is still phase 2');
  boss.body.hp = P3(boss) - 0.01;
  step(w, 1);
  assert.equal(boss.phase, 3);
  boss.body.hp = max; // healed back up: phases never revert
  step(w, 1);
  assert.equal(boss.phase, 3);
  assert.equal(events(w, 'bossPhase').length, 2, 'two bossPhase events, so two hotfix hearts');
});

// ---- phase 1: the entangled pair -------------------------------------------------------------------------------------------

test('heisenbug: two moths, kind heisenbug, boss && !regular, always targetable, harmless at spawn', () => {
  const { w, boss } = start();
  assert.equal(boss.moths.length, 2);
  assert.equal(w.enemies.filter((e) => !e.dead && e.kind === 'heisenbug').length, 2);
  for (const m of boss.moths) {
    assert.equal(m.kind, 'heisenbug');
    assert.equal(m.boss, true);
    assert.equal(m.regular, false);
    assert.equal(m.targetable, true);
    assert.equal(m.r, 9);
    assert.equal(m.contact, false);
    assert.ok(m.noContactT >= 0.45);
  }
  assert.equal(boss.body, boss.moths[0]);
  // the bot keeps aiming at them whatever they look like: they never stop being targetable
  const { w: w2, boss: b2, a, b } = pair();
  step(w2, 120);
  for (const m of [a, b]) assert.equal(m.targetable, true);
  assert.equal(b2.moths.every((m) => m.targetable), true);
});

test('heisenbug: the pair spawns on the two candidate spots farthest from Clawd (the first listed wins ties), at least 80 px away wherever she stands', () => {
  const { w, boss } = start();
  assert.deepEqual([boss.moths[0].x, boss.moths[0].y, boss.moths[1].x, boss.moths[1].y], [60, 60, 260, 60], 'a tie goes to the first listed');
  assert.ok(dist(boss.moths[0], w.player) >= 80);
  for (const at of [[20, 30], [300, 30], [160, 96], [110, 73], [300, 170], [8, 172], [60, 60], [260, 140], [160, 30], [40, 150]]) {
    const t = start({ player: at });
    assert.equal(t.boss.moths.length, 2);
    for (const m of t.boss.moths) assert.ok(dist(m, t.w.player) >= 80, `Clawd at ${at}: a moth spawned ${dist(m, t.w.player).toFixed(1)} px away`);
  }
  // the enemy cap is full but the boss has to exist
  const c = start({ files: FILES });
  const cap = c.CB.CAPS.enemies;
  c.CB.Enemies.dummy = { create: (ww, x, y) => c.CB.makeEnemy('dummy', x, y, { hp: 1 }), update() {}, draw() {} };
  const w2 = c.CB.createWorld({ seed: 3, god: true });
  while (w2.enemies.length < cap) w2.spawnEnemy('dummy', 10, 10);
  const b2 = c.CB.Bosses.heisenbug.create(w2);
  assert.equal(b2.moths.length, 2);
  assert.equal(w2.enemies.filter((e) => e.kind === 'heisenbug').length, 2);
});

test('heisenbug: c.body.hp is the authority, mirrored into every moth, and damage to either moth drains the one pool', () => {
  const { w, boss } = start();
  const [a, b] = boss.moths;
  assert.equal(a.hp, boss.maxHp);
  assert.equal(b.hp, boss.maxHp);
  boss.body.hp = 200;
  step(w, 1);
  assert.equal(b.hp, 200);
  assert.equal(boss.hp, 200);
  assert.equal(w.damageEnemy(b, 30), 30);
  assert.equal(boss.body.hp, 170);
  assert.equal(a.hp, 170);
  assert.equal(b.hp, 170);
  assert.equal(boss.hp, 170);
});

// ---- the gaze --------------------------------------------------------------------------------------------------------------

test('heisenbug gaze: it is the ray from Clawd through the aim point, so a moth far beyond an aim point close to Clawd is still looked at', () => {
  const { w, boss, a } = pair();
  assert.equal(a.data.look, true);
  assert.equal(boss.observing, true);
  put(a, 160, 30); // 96 px ahead
  step(w, 1, aim(160, 100)); // the aim point is only 26 px from Clawd
  assert.equal(a.data.look, true, 'the ray reaches it');
  step(w, 1, aim(200, 100)); // tilted away: the ray misses
  assert.equal(a.data.look, false);
});

test('heisenbug gaze: 13.5 px beside the ray counts, 14.5 does not, on either side', () => {
  for (const side of [1, -1]) {
    for (const [off, want] of [[13.5, true], [14.5, false]]) {
      const { w, a } = pair();
      put(a, 160, 46);
      step(w, 1, AWAY); // not looked at yet: the 14 px radius applies, not the 20 px one that keeps a gaze
      step(w, 1, () => H.makeInput(ray(w, a, side * off)));
      assert.equal(a.data.look, want, `${off} px on side ${side}`);
    }
  }
});

test('heisenbug gaze: once looked at it stays looked at within 20 px, but a moth not yet looked at needs 14', () => {
  const { w, a } = pair();
  put(a, 160, 46);
  step(w, 2, aim(160, 46));
  assert.equal(a.data.look, true);
  step(w, 1, () => H.makeInput(ray(w, a, 19)));
  assert.equal(a.data.look, true, '19 px: kept');
  step(w, 1, () => H.makeInput(ray(w, a, 21)));
  assert.equal(a.data.look, false, '21 px: lost');
  const t = pair();
  put(t.a, 160, 46);
  step(t.w, 1, AWAY);
  step(t.w, 1, () => H.makeInput(ray(t.w, t.a, 19)));
  assert.equal(t.a.data.look, false, '19 px is not enough to start');
});

test('heisenbug gaze: a moth behind Clawd, or exactly beside her, is not looked at', () => {
  const { w, a } = pair();
  put(a, 160, 200); // below Clawd, the aim runs up
  step(w, 1, aim(160, 20));
  assert.equal(a.data.look, false, 'behind');
  put(a, 100, 126); // level with Clawd, the aim runs up
  step(w, 1, aim(160, 20));
  assert.equal(a.data.look, false, 'beside');
});

test('heisenbug gaze: when the ray leaves, bolts already in flight keep landing for 0.35 s', () => {
  const { w, boss, a } = pair();
  assert.ok(hit(w, a, 1) > 0, 'looked at: it takes damage');
  let grace = -1;
  for (let i = 1; i <= 40; i++) {
    step(w, 1, AWAY);
    if (hit(w, a, 0.01) === 0 && grace < 0) grace = i;
    assert.equal(a.data.look, false);
  }
  assert.ok(grace >= 20 && grace <= 22, `damage stopped on the ${grace}th tick without the ray (${(grace / 60).toFixed(2)} s)`);
  assert.ok(boss.body.hp > 0);
});

test('heisenbug gaze: an aim point within 6 px of Clawd has no direction, so the point rule applies', () => {
  const { w, a } = pair();
  put(a, 260, 126); // 100 px to her right
  step(w, 1, aim(163, 125)); // 3 px from Clawd, pointing roughly at it
  assert.equal(a.data.look, false, 'pointing nowhere in particular is not looking at a moth 100 px away');
  put(a, 168, 126);
  step(w, 1, aim(163, 125)); // the moth is within 14 px of the aim point
  assert.equal(a.data.look, true);
  put(a, 190, 126);
  w.player.x = 160;
  step(w, 1, aim(163, 125));
  assert.equal(a.data.look, false, 'and 27 px from the aim point is outside it');
  // from 6 px out there is a direction: an aim point 8 px to the right of Clawd looks along the ray at a moth 100 px out
  const t = pair();
  put(t.a, 260, 126);
  step(t.w, 1, AWAY);
  step(t.w, 1, aim(168, 126));
  assert.equal(t.a.data.look, true, 'the ray rule applies from 6 px');
});

test('heisenbug gaze: a stick aims along a ray too: its aim point is only 48 px out, the moth is 100 px out', () => {
  const { w, a } = pair();
  put(a, 160, 26);
  const stick = (off) => () => {
    const r = ray(w, a, off);
    return H.makeInput({ aimDirX: r.aimX - w.player.x, aimDirY: r.aimY - w.player.y });
  };
  step(w, 1, stick(0));
  assert.equal(w.player.aimStick, true);
  assert.ok(Math.abs(dist({ x: w.player.aimX, y: w.player.aimY }, w.player) - 48) < 1e-6, 'the stick aim point is 48 px out');
  assert.equal(a.data.look, true);
  const t = pair();
  put(t.a, 160, 26);
  step(t.w, 1, AWAY);
  step(t.w, 1, () => H.makeInput({ aimDirX: ray(t.w, t.a, 14.5).aimX - t.w.player.x, aimDirY: ray(t.w, t.a, 14.5).aimY - t.w.player.y }));
  assert.equal(t.a.data.look, false, '14.5 px off the ray: not looked at');
  step(t.w, 1, () => H.makeInput({ aimDirX: ray(t.w, t.a, 13.5).aimX - t.w.player.x, aimDirY: ray(t.w, t.a, 13.5).aimY - t.w.player.y }));
  assert.equal(t.a.data.look, true, '13.5 px off the ray: looked at');
});

test('heisenbug gaze: mouse, stick and touch play by the same rule, and stick assist never snaps onto a moth', () => {
  const dirs = [];
  for (const kind of ['mouse', 'touch', 'stick']) {
    const { CB, w, a } = pair();
    put(a, 200, 40);
    const r = ray(w, a, 5);
    const input =
      kind === 'stick'
        ? () => H.makeInput({ aimDirX: r.aimX - w.player.x, aimDirY: r.aimY - w.player.y, aimAssist: true, fire: true, device: 'pad' })
        : () => H.makeInput(Object.assign({ device: kind === 'touch' ? 'touch' : 'kbm' }, r));
    step(w, 1, input);
    dirs.push(a.data.look);
    for (const m of w.enemies) assert.equal(CB.Player.assistTarget(w, w.player, 0.3, -0.9), null, `assist ignores the ${m.kind}`);
  }
  assert.deepEqual(dirs, [true, true, true]);
});

// ---- stone: observed -------------------------------------------------------------------------------------------------------

test('heisenbug stone: a looked-at moth is frozen, harmless to touch, and the only thing that takes damage', () => {
  const { w, boss, a, b, look } = pair();
  const at = { x: a.x, y: a.y };
  step(w, 120, look);
  assert.deepEqual([a.x, a.y], [at.x, at.y], 'stone does not move');
  assert.equal(a.contact, false);
  assert.equal(a.data.obs, true);
  assert.ok(b.x !== 260 || b.y !== 120, 'the ghost does hunt');
  // real bolts hurt it
  const hp0 = boss.body.hp;
  step(w, 60, () => H.makeInput({ aimX: a.x, aimY: a.y, fire: true }));
  assert.ok(boss.body.hp < hp0, 'bolts land on the stone moth');
  assert.ok(w.stats.damageDealt > 0);
  // and standing on it costs nothing
  const t = pair();
  t.w.player.x = t.a.x;
  t.w.player.y = t.a.y;
  step(t.w, 90, t.look);
  assert.equal(t.w.stats.wouldHits, 0, 'stone is harmless to touch');
});

test('heisenbug stone: every point of damage fills the ring one for one, and a direct call with no source does not', () => {
  const { w, boss, a } = pair();
  assert.equal(hit(w, a, 3), 3);
  assert.equal(a.data.strain, 3);
  assert.equal(boss.charge, 3);
  assert.equal(w.damageEnemy(a, 5), 5, 'a direct call still applies');
  assert.equal(a.data.strain, 3, 'but feeds neither the ring');
  assert.equal(boss.charge, 3, 'nor the lash charge');
  assert.equal(boss.body.hp, boss.maxHp - 8);
});

test('heisenbug stone: the gaze line is a faint dotted cyan tether to every observed moth, and the boss reports it for the crosshair', () => {
  const { CB, w, boss, a } = pair();
  const r = spyRenderer();
  boss.draw(r, 1);
  const dots = r.calls.filter((c) => c.name === 'rect' && c.a[2] === 1 && c.a[3] === 1 && c.a[4] === CB.Pal.C.cyan);
  assert.ok(dots.length >= 8, `${dots.length} cyan dots`);
  // the dots run from Clawd to moth a, none toward the ghost b
  for (const d of dots) {
    const off = Math.abs((d.a[0] - w.player.x) * (a.y - w.player.y) - (d.a[1] - w.player.y) * (a.x - w.player.x)) / dist(a, w.player);
    assert.ok(off < 1.5, `a tether dot sits ${off.toFixed(1)} px off the line to the moth`);
  }
  assert.equal(boss.observing, true);
  step(w, 30, AWAY);
  assert.equal(boss.observing, false);
  const r2 = spyRenderer();
  boss.draw(r2, 1);
  assert.equal(r2.calls.filter((c) => c.name === 'rect' && c.a[4] === CB.Pal.C.cyan).length, 0, 'nothing observed, no tether');
});

// ---- wave: unobserved ------------------------------------------------------------------------------------------------------

test('heisenbug wave: bolts and the /compact wave clink off an unobserved moth; a direct damageEnemy still applies', () => {
  const { w, boss, a, b, look } = pair();
  const hp = boss.body.hp;
  assert.equal(w.damageEnemy(b, 5, bolt(5)), 0);
  assert.equal(w.damageEnemy(b, 5, { compact: true }), 0);
  assert.equal(events(w, 'clink').length, 2, 'both clink');
  assert.equal(boss.body.hp, hp);
  assert.equal(a.data.strain, 0);
  // a real bolt flying through it is stopped
  w.events.length = 0;
  w.firePlayerBolt(b.x - 30, b.y, 0);
  const n = w.pBullets.length;
  step(w, 20, look);
  assert.equal(boss.body.hp, hp, 'the bolt did nothing');
  assert.ok(events(w, 'clink').length >= 1);
  assert.ok(w.pBullets.length < n, 'and was absorbed');
  // a direct call applies
  assert.equal(w.damageEnemy(b, 5), 5);
  assert.equal(boss.body.hp, hp - 5);
});

test('heisenbug wave: the real /compact wave hurts a stone moth and clinks off a wave', () => {
  const CB = H.load();
  const w = CB.createWorld({ seed: 9, god: true, stage: CB.STAGES[3] });
  w.boss = CB.Bosses.heisenbug.create(w);
  w.boss.lashIdle = -1e9;
  const [a, b] = w.boss.moths;
  put(a, 160, 46);
  put(b, 260, 120);
  step(w, 1, aimAt(a));
  CB.Compact.fill(w);
  w.events.length = 0;
  const hp = w.boss.body.hp;
  step(w, 1, () => H.makeInput({ aimX: a.x, aimY: a.y, compact: true }));
  assert.equal(w.stats.compacts, 1);
  step(w, 50, aimAt(a));
  assert.equal(a.data.strain, 5, 'DMG_BOSS 5 on the stone moth');
  assert.equal(w.boss.body.hp, hp - 5, 'and nothing from the ghost');
  assert.ok(events(w, 'clink').length >= 1);
});

test('heisenbug wave: the "<optimized out>" hint pops at most once every 1.6 s', () => {
  const { w, b, look } = pair();
  const pops = () => events(w, 'text').filter((e) => e.text === '<optimized out>').length;
  for (let i = 0; i < 5; i++) w.damageEnemy(b, 1, bolt());
  assert.equal(pops(), 1);
  step(w, 60, look); // 1 s
  w.damageEnemy(b, 1, bolt());
  assert.equal(pops(), 1, 'throttled');
  step(w, 40, look); // 1.67 s since the first
  w.damageEnemy(b, 1, bolt());
  assert.equal(pops(), 2);
  for (const e of events(w, 'text')) assert.ok(finite(e.x) && finite(e.y));
});

test('heisenbug wave: a ghost is harmless to touch (except in a lunge)', () => {
  const { w, b } = pair();
  w.player.x = b.x;
  w.player.y = b.y;
  step(w, 100);
  assert.equal(b.contact, false);
  assert.equal(w.stats.wouldHits, 0);
});

test('heisenbug wave: it creeps at 22 px/s and speeds up to 44 (55 in phase 2), parks about 50 px from Clawd', () => {
  const setup = (phase2) => {
    const t = pair({ player: [20, 126] }); // far from the wave, so it has room to speed up
    t.a.x = 20;
    t.a.y = 46;
    if (phase2) t.boss.phase = 2;
    put(t.b, 300, 126);
    return Object.assign(t, { look: aimAt(t.a) });
  };
  const speed = (t, n) => {
    const p0 = { x: t.b.x, y: t.b.y };
    step(t.w, n, t.look);
    return dist(p0, t.b) / (n / 60);
  };
  const t = setup(false);
  step(t.w, 1, t.look);
  const first = speed(t, 15);
  assert.ok(first > 21 && first < 28, `first quarter second: ${first.toFixed(1)} px/s`);
  step(t.w, 200, t.look);
  const later = speed(t, 30);
  assert.ok(later > 43 && later <= 44.5, `after 4 s as a wave: ${later.toFixed(1)} px/s`);
  step(t.w, 600, t.look);
  assert.ok(Math.abs(dist(t.b, t.w.player) - 50) < 0.5, `it parks ${dist(t.b, t.w.player).toFixed(1)} px away`);
  const t2 = setup(true);
  step(t2.w, 1, t2.look);
  step(t2.w, 235, t2.look);
  const fast = speed(t2, 30);
  assert.ok(fast > 54 && fast <= 55.5, `phase 2: ${fast.toFixed(1)} px/s`);
});

test('heisenbug wave: it slides off the aim ray (at most 55 px/s) to stay 70 degrees off it, so it comes from the blind side', () => {
  // a ray pointing right (a stone moth far out on it) and a wave parked 50 px from Clawd, 20 degrees off the ray; then the mirror image
  for (const [rayDir, from] of [[0, -20], [180, 200]]) {
    const t = pair();
    const { w, a, b } = t;
    put(a, rayDir === 0 ? 290 : 30, 126);
    const look = aimAt(a);
    const at = (deg0) => [160 + 50 * Math.cos((deg0 * Math.PI) / 180), 126 + 50 * Math.sin((deg0 * Math.PI) / 180)];
    put(b, ...at(from));
    const rel = () => Math.abs(deg(M_wrap(Math.atan2(b.y - w.player.y, b.x - w.player.x) - (rayDir * Math.PI) / 180)));
    assert.ok(rel() < 25);
    let worst = 0;
    for (let i = 0; i < 100; i++) {
      const p0 = { x: b.x, y: b.y };
      step(w, 1, look);
      worst = Math.max(worst, dist(p0, b));
    }
    assert.ok(worst <= 55 / 60 + 1e-6, `the biggest sidestep in one tick was ${worst.toFixed(3)} px`);
    assert.ok(worst > 0.5, 'and it did slide');
    assert.ok(rel() >= 69.5, `it ended ${rel().toFixed(1)} degrees off the ray`);
    assert.ok(Math.abs(dist(b, w.player) - 50) < 0.5, 'and kept its distance while sliding');
    assert.equal(b.data.look, false);
  }
});
function M_wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

test('heisenbug wave: loose moths keep 60 px apart', () => {
  const { w, boss } = start();
  const [a, b] = boss.moths;
  put(a, 120, 40);
  put(b, 150, 40); // 30 px apart, both far from Clawd
  step(w, 360, AWAY);
  assert.ok(dist(a, b) >= 59.5, `${dist(a, b).toFixed(1)} px apart after 6 s`);
});

// ---- strain ----------------------------------------------------------------------------------------------------------------

test('heisenbug strain: the ring cools 3.5 per second while unobserved', () => {
  const { w, a } = pair();
  step(w, 30, AWAY); // the grace period is over
  a.data.strain = 10;
  step(w, 60, AWAY);
  assert.ok(Math.abs(a.data.strain - 6.5) < 0.06, `strain ${a.data.strain.toFixed(2)} after 1 s`);
  step(w, 120, AWAY);
  assert.equal(a.data.strain, 0, 'it bottoms out at 0');
});

test('heisenbug strain: the eye is cyan below 70% of 22 and red from there, over a ring that lights floor(16 x strain / 22) dots', () => {
  const { CB, a } = pair();
  for (const [strain, eye, lit] of [[0, 'heisenEye_0', 0], [11, 'heisenEye_0', 8], [15.3, 'heisenEye_0', 11], [15.5, 'heisenEye_1', 11], [21.9, 'heisenEye_1', 15]]) {
    a.data.strain = strain;
    const r = spyRenderer();
    CB.Enemies.heisenbug.draw(a, r, 1);
    const eyes = sprites(r).filter((s) => s.name.startsWith('heisenEye_'));
    assert.deepEqual(eyes.map((s) => s.name), [eye], `strain ${strain}`);
    const dots = r.calls.filter((c) => c.name === 'rect' && c.a[2] === 2 && c.a[3] === 2 && c.a[4] === CB.Pal.C.cyan);
    assert.equal(dots.length, lit, `strain ${strain} lights ${lit} dots`);
  }
});

test('heisenbug strain: a full ring is a held white-out for 0.25 s, then a nova of 8 at 75 px/s with a 45 degree gap on Clawd, then a jump', () => {
  const { CB, w, boss, a, look } = pair();
  const fires = countFires(w);
  hit(w, a, 22);
  assert.equal(a.data.strain, 22);
  boss.charge = 0; // the 22 damage also charged a lash: keep the ghost's ripple out of this nova
  let over = 0;
  let whiteTicks = 0;
  let novaAt = -1;
  const x0 = a.x;
  const y0 = a.y;
  for (let i = 1; i <= 40 && novaAt < 0; i++) {
    step(w, 1, look);
    if (a.data.over > 0) {
      over++;
      const r = spyRenderer();
      CB.Enemies.heisenbug.draw(a, r, i / 60);
      if (sprites(r).some((s) => s.o.white === true && s.name === 'heisenStone_0')) whiteTicks++;
      assert.deepEqual([a.x, a.y], [x0, y0], 'it holds still while it whitens');
    }
    if (fires.n > 0) novaAt = i;
  }
  assert.equal(over, whiteTicks, 'the white sprite is drawn on every tick of the white-out, held and not flashed');
  assert.ok(over >= 14 && over <= 15, `${over} ticks of white-out`);
  assert.ok(novaAt >= 15 && novaAt <= 17, `the nova on tick ${novaAt}`);
  assert.equal(fires.n, 8);
  const toward = Math.atan2(w.player.y - y0, w.player.x - x0);
  const offs = fires.calls.map((c) => ((deg(c.angle - toward) % 360) + 540) % 360 - 180).sort((p, q) => p - q);
  assert.ok(fires.calls.every((c) => c.speed === 75 && c.x === x0 && c.y === y0));
  assert.ok(Math.min(...offs.map(Math.abs)) > 22.4, `the bullets next to the gap are ${Math.min(...offs.map(Math.abs)).toFixed(2)} degrees off Clawd`);
  for (let i = 1; i < offs.length; i++) assert.ok(Math.abs(offs[i] - offs[i - 1] - 45) < 1e-6, 'the bullets are 45 degrees apart round the far side');
  assert.equal(events(w, 'enemyShoot').length, 1);
  // the jump, in the same tick
  assert.ok(dist(a, w.player) >= 80, `it landed ${dist(a, w.player).toFixed(1)} px from Clawd`);
  assert.equal(boss.ghosts.length, 1, 'an afterimage stays behind');
  assert.deepEqual([boss.ghosts[0].x, boss.ghosts[0].y], [x0, y0]);
  const tp = events(w, 'teleport');
  assert.equal(tp.length, 1);
  assert.deepEqual([tp[0].x, tp[0].y], [x0, y0]);
  assert.ok(Math.abs(tp[0].x2 - a.x) < 1e-9 && Math.abs(tp[0].y2 - a.y) < 1e-9);
  assert.equal(events(w, 'text').filter((e) => e.text === '!?').length, 1);
  assert.ok(w.glitchT >= 0.2 - DT - 1e-9, `glitchT ${w.glitchT}`);
  assert.ok(a.noContactT >= 0.45);
  assert.equal(a.data.strain, 0);
});

test('heisenbug strain: after the jump it is dazzled for 1.0 s: it ignores the gaze and is immune, then thaws', () => {
  const { w, boss, a } = pair();
  hit(w, a, 22);
  let n = 0;
  while (a.data.dazzle <= 0 && n++ < 60) step(w, 1, aimAt(a));
  assert.ok(a.data.dazzle > 0.9);
  const at = aimAt(a);
  let obsAt = -1;
  let blocked = 0;
  for (let i = 1; i <= 90 && obsAt < 0; i++) {
    step(w, 1, at);
    if (a.data.obs) obsAt = i;
    else if (hit(w, a, 1) === 0) blocked++;
  }
  assert.ok(obsAt >= 59 && obsAt <= 62, `looked at again after ${obsAt} ticks`);
  assert.ok(blocked >= 58, `${blocked} bolts bounced off while it was dazzled`);
  assert.ok(events(w, 'clink').length >= blocked);
  assert.ok(hit(w, a, 1) > 0, 'and it takes damage again');
  assert.ok(boss.body.hp < boss.maxHp);
});

test('heisenbug strain: the loop. Looking at the other moth during its tell freezes it and cancels the lunge, and the first one thaws', () => {
  const { w, boss, a, b, look } = pair();
  put(b, 205, 126); // 45 px from Clawd: a lunge
  hit(w, a, 12);
  boss.age = 10;
  boss.charge = 100;
  step(w, 1, look);
  assert.equal(b.data.lunge && b.data.lunge.stage, 'tell');
  step(w, 10, look);
  assert.equal(b.data.lunge.stage, 'tell');
  const s0 = a.data.strain;
  const swap = aimAt(b);
  step(w, 1, swap);
  assert.equal(b.data.obs, true);
  assert.equal(b.data.lunge, null, 'the lunge is cancelled');
  assert.equal(b.contact, false);
  const at = { x: b.x, y: b.y };
  step(w, 60, swap);
  assert.deepEqual([b.x, b.y], [at.x, at.y], 'and it is frozen');
  assert.equal(w.stats.wouldHits, 0);
  assert.ok(a.data.strain < s0 - 1, `the first moth cooled: ${s0} -> ${a.data.strain.toFixed(2)}`);
  assert.equal(a.data.obs, false);
});

// ---- lashes ----------------------------------------------------------------------------------------------------------------

test('heisenbug lash: damage dealt charges it, at 14 in phase 1 and 11 in phase 2 the nearest idle wave lashes (a lunge within 90 px)', () => {
  const { w, boss, a, b } = pair();
  put(b, 230, 126); // 70 px
  boss.age = 10;
  step(w, 1, aimAt(a));
  hit(w, a, 13);
  step(w, 1, aimAt(a));
  assert.equal(events(w, 'beamCharge').length, 0, '13 is not enough');
  hit(w, a, 1);
  step(w, 1, aimAt(a));
  const bc = events(w, 'beamCharge');
  assert.equal(bc.length, 1, '14 lashes');
  assert.equal(b.data.lunge.stage, 'tell');
  assert.equal(boss.charge, 0);
  // phase 2: the nearest of two idle waves, at 11
  const t = pair();
  toPhase2(t);
  const [m0, m1, m2] = t.boss.moths;
  put(m0, 160, 46);
  put(m1, 160 + 80, 126);
  put(m2, 160 - 62, 126); // the nearest
  t.boss.age = 10;
  step(t.w, 1, aimAt(m0));
  t.w.events.length = 0;
  hit(t.w, m0, 10);
  step(t.w, 1, aimAt(m0));
  assert.equal(events(t.w, 'beamCharge').length, 0, '10 is not enough in phase 2');
  hit(t.w, m0, 1);
  step(t.w, 1, aimAt(m0));
  const first = events(t.w, 'beamCharge')[0];
  assert.ok(first, '11 lashes in phase 2');
  assert.ok(dist({ x: first.x1, y: first.y1 }, m2) < 1, 'the nearest idle wave lunged');
});

test('heisenbug lash: with no damage a lash still comes every 4.5 s, and nothing attacks before 2.6 s', () => {
  const { w, boss } = start();
  boss.lashIdle = 0;
  put(boss.moths[0], 160, 40);
  put(boss.moths[1], 232, 126);
  const log = [];
  for (let i = 0; i < 60 * 12; i++) {
    step(w, 1, AWAY);
    for (const e of w.events) if (e.type === 'beamCharge' || e.type === 'enemyShoot') log.push(w.time);
    w.events.length = 0;
  }
  assert.ok(log.length >= 2);
  assert.ok(Math.abs(log[0] - 4.5) < 0.05, `the first idle lash at ${log[0].toFixed(2)} s`);
  assert.ok(Math.abs(log[1] - log[0] - 4.5) < 0.1, `then ${(log[1] - log[0]).toFixed(2)} s later`);
  // a full charge from the first tick still waits for 2.6 s
  const t = start();
  t.boss.charge = 999;
  t.boss.lashIdle = 999;
  put(t.boss.moths[0], 160, 40);
  put(t.boss.moths[1], 232, 126);
  let first = -1;
  const fires = countFires(t.w);
  for (let i = 0; i < 200 && first < 0; i++) {
    step(t.w, 1, AWAY);
    if (t.w.events.some((e) => e.type === 'beamCharge' || e.type === 'enemyShoot') || fires.n) first = t.w.time;
  }
  assert.ok(first >= 2.6 - 1e-6 && first <= 2.6 + 0.04, `the first attack at ${first.toFixed(3)} s`);
});

test('heisenbug lash: a ripple (a hunter further than 90 px): 12 slots, 3 gaps, 9 bullets at 75 px/s, one gap centred on Clawd', () => {
  const { w, boss, b, look } = pair();
  put(b, 280, 126); // 120 px
  boss.age = 10;
  boss.charge = 100;
  const fires = countFires(w);
  step(w, 1, look);
  assert.equal(events(w, 'beamCharge').length, 0, 'too far for a lunge');
  assert.equal(fires.n, 9);
  const toward = Math.atan2(w.player.y - b.y, w.player.x - b.x);
  const offs = fires.calls.map((c) => Math.round((((deg(c.angle - toward) % 360) + 360) % 360) * 1000) / 1000).sort((p, q) => p - q);
  assert.deepEqual(offs, [30, 60, 90, 150, 180, 210, 270, 300, 330], 'slots 0, 4 and 8 are the gaps, and slot 0 points at Clawd');
  assert.ok(fires.calls.every((c) => c.speed === 75 && Math.abs(c.x - b.x) < 1e-9));
  assert.equal(events(w, 'enemyShoot').length, 1);
  assert.equal(boss.charge, 0);
});

test('heisenbug lash: a lunge crouches for 0.6 s, dashes 55 px in 0.22 s and rests 0.6 s, and touches only while it dashes', () => {
  const { w, boss, b, look } = pair();
  put(b, 210, 126);
  boss.age = 10;
  boss.charge = 100;
  w.events.length = 0;
  step(w, 1, look);
  const bc = events(w, 'beamCharge');
  assert.equal(bc.length, 1);
  for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) assert.ok(finite(bc[0][k]), `beamCharge.${k}`);
  const from = { x: bc[0].x1, y: bc[0].y1 };
  const to = { x: bc[0].x2, y: bc[0].y2 };
  assert.ok(Math.abs(dist(from, to) - 55) < 1e-9, 'the landing point is 55 px along the locked heading');
  assert.ok(Math.abs(to.x - 155) < 1e-6 && Math.abs(to.y - 126) < 1e-6, 'locked on Clawd as she stood');
  const stages = [];
  let contactTicks = 0;
  let maxStep = 0;
  for (let i = 0; i < 140; i++) {
    const p0 = { x: b.x, y: b.y };
    // Clawd walks away while it crouches: the heading was locked at the start
    step(w, 1, () => H.makeInput({ aimX: 160, aimY: 46, moveY: i < 30 ? -0.6 : 0, moveX: i < 30 ? 0.8 : 0 }));
    const L = b.data.lunge;
    stages.push(L ? L.stage : 'none');
    if (b.contact) {
      contactTicks++;
      assert.equal(L.stage, 'dash', 'contact only in the dash window');
    }
    if (L && L.stage === 'dash') maxStep = Math.max(maxStep, dist(p0, b));
  }
  const count = (s) => stages.filter((x) => x === s).length;
  assert.ok(count('tell') >= 35 && count('tell') <= 36, `${count('tell')} ticks of tell (0.6 s)`);
  assert.ok(count('dash') >= 13 && count('dash') <= 14, `${count('dash')} ticks of dash (0.22 s)`);
  assert.ok(contactTicks >= 12 && contactTicks <= 14, `${contactTicks} ticks of contact`);
  assert.ok(count('rest') >= 35 && count('rest') <= 37, `${count('rest')} ticks of rest (0.6 s)`);
  assert.ok(maxStep <= 250 / 60 + 1e-9 && maxStep > 4, `dash speed ${(maxStep * 60).toFixed(1)} px/s`);
  assert.ok(Math.abs(b.x - to.x) < 1e-6 && Math.abs(b.y - to.y) < 1e-6, 'it lands on the locked point');
  assert.equal(b.data.lunge, null, 'and the lunge is over');
});

test('heisenbug lash: a 36 px sidestep clears a lunge that otherwise connects', () => {
  const run = (sidestep) => {
    const { w, boss, b, look } = pair();
    put(b, 210, 126);
    boss.age = 10;
    boss.charge = 100;
    step(w, 1, look);
    for (let i = 0; i < 75; i++) {
      const moving = sidestep && i < 27; // 27 ticks at 80 px/s: 36 px
      step(w, 1, () => H.makeInput({ aimX: 160, aimY: 46, moveY: moving ? -1 : 0 }));
    }
    return w.stats.wouldHits;
  };
  assert.equal(run(false), 1, 'standing still takes the lunge');
  assert.equal(run(true), 0, 'a 36 px sidestep clears it');
});

test('heisenbug lash: freezing a moth during its tell cancels the lunge', () => {
  const { w, boss, b, look } = pair();
  put(b, 210, 126);
  boss.age = 10;
  boss.charge = 100;
  step(w, 20, look);
  assert.equal(b.data.lunge.stage, 'tell');
  step(w, 1, aimAt(b));
  assert.equal(b.data.lunge, null);
  step(w, 90, aimAt(b));
  assert.equal(w.stats.wouldHits, 0);
});

test('heisenbug lash: phase 2 pincer. A lunge starts the other idle wave within 90 px lunging 0.3 s later, from its own flank', () => {
  const t = pair();
  toPhase2(t);
  const [m0, m1, m2] = t.boss.moths;
  put(m0, 160, 46);
  put(m1, 160 + 80, 126);
  put(m2, 160 - 62, 126);
  t.boss.age = 10;
  t.boss.charge = 100;
  t.w.events.length = 0;
  const log = [];
  for (let i = 0; i < 40; i++) {
    step(t.w, 1, aimAt(m0));
    for (const e of events(t.w, 'beamCharge')) log.push({ i, e, from: t.boss.moths.map((m) => ({ x: m.x, y: m.y })) });
    t.w.events.length = 0;
  }
  assert.equal(log.length, 2, 'two lunges');
  const firstAt = log[0].i;
  assert.ok(Math.abs(log[1].i - firstAt - 18) <= 1, `${log[1].i - firstAt} ticks apart (0.3 s)`);
  assert.ok(dist({ x: log[0].e.x1, y: log[0].e.y1 }, log[0].from[2]) < 1, 'the nearest went first');
  assert.ok(dist({ x: log[1].e.x1, y: log[1].e.y1 }, log[1].from[1]) < 1, 'the second one comes from its own flank');
  assert.ok(log[1].e.x1 > t.w.player.x + 30 && log[0].e.x1 < t.w.player.x - 30, 'one from each side of Clawd');
  assert.ok((log[0].e.x2 - log[0].e.x1) * (log[1].e.x2 - log[1].e.x1) < 0, 'on opposite lines: a pincer');
  // phase 1 has no pincer: two idle waves, one lash, one lunge
  const p1 = start();
  const [x, y] = p1.boss.moths;
  put(x, 160 + 60, 126);
  put(y, 160 - 62, 126);
  p1.boss.age = 10;
  p1.boss.charge = 100;
  let lunges = 0;
  for (let i = 0; i < 60; i++) {
    step(p1.w, 1, aim(160, 20));
    lunges += events(p1.w, 'beamCharge').length;
    p1.w.events.length = 0;
  }
  assert.equal(lunges, 1);
});

// ---- phase 2: superposition ------------------------------------------------------------------------------------------------

test('heisenbug phase 2: the split. bossPhase, a shake of at least 4, a 0.5 s shield on the main part and a third moth at least 80 px away', () => {
  const { w, boss } = start();
  const shakes = [];
  const addShake = w.addShake;
  w.addShake = (x) => {
    shakes.push(x);
    addShake(x);
  };
  boss.body.hp = P2(boss) - 0.5;
  step(w, 1);
  const ph = events(w, 'bossPhase');
  assert.equal(ph.length, 1);
  assert.equal(ph[0].phase, 2);
  assert.ok(finite(ph[0].x) && finite(ph[0].y));
  assert.ok(shakes.some((s) => s >= 4));
  assert.equal(boss.moths.length, 3);
  const third = boss.moths[2];
  assert.ok(dist(third, w.player) >= 80, `the third moth landed ${dist(third, w.player).toFixed(1)} px away`);
  assert.equal(third.kind, 'heisenbug');
  assert.equal(third.boss, true);
  assert.equal(third.regular, false);
  assert.ok(third.noContactT >= 0.45);
  assert.equal(third.contact, false);
  assert.equal(third.hp, boss.body.hp, 'it shares the pool');
  assert.equal(w.damageEnemy(boss.body, 1), 0, 'the main part is shielded');
  assert.equal(w.damageEnemy(third, 1), 0, 'and the newborn cannot be hurt');
  step(w, 25);
  assert.equal(w.damageEnemy(boss.body, 1), 0, 'still shielded 0.42 s later');
  assert.equal(w.damageEnemy(third, 1), 0);
  step(w, 15);
  assert.equal(w.damageEnemy(boss.body, 1), 1, 'shield over');
  assert.equal(w.damageEnemy(third, 1), 1);
  assert.ok(events(w, 'teleport').length >= 1, 'a chromatic tear');
});

test('heisenbug phase 2: if the enemy cap returns null the split is skipped silently', () => {
  const { CB, w, boss } = start();
  CB.Enemies.dummy = { create: (ww, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1 }), update() {}, draw() {} };
  while (w.enemies.length < CB.CAPS.enemies) w.spawnEnemy('dummy', 10, 10);
  boss.body.hp = P2(boss) - 0.5;
  assert.doesNotThrow(() => step(w, 60));
  assert.equal(boss.phase, 2);
  assert.equal(boss.moths.length, 2);
});

test('heisenbug phase 2: it is faster. The third moth hunts too, and the creep tops out at 55 px/s', () => {
  const t = pair();
  toPhase2(t);
  const [m0, m1, m2] = t.boss.moths;
  put(m0, 160, 46);
  put(m1, 300, 126);
  put(m2, 20, 126);
  step(t.w, 300, aimAt(m0));
  const d0 = dist(m1, t.w.player);
  const x = { x: m1.x, y: m1.y };
  step(t.w, 15, aimAt(m0));
  assert.ok(dist(m1, x) > 0 || d0 < 51, 'it moves, or has already parked');
  assert.ok(Math.abs(dist(m2, t.w.player) - 50) < 0.5, 'the third parks 50 px out too');
  assert.ok(dist(m1, m2) >= 59.5, 'and keeps off its sisters');
});

test('heisenbug phase 2: one hit across both thresholds applies 1 -> 2 -> 3 in order', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, boss.maxHp - P3(boss) + 1);
  step(w, 1);
  const ph = events(w, 'bossPhase').map((e) => e.phase);
  assert.deepEqual(ph, [2, 3]);
  assert.equal(boss.phase, 3);
});

// ---- phase 3: regression ---------------------------------------------------------------------------------------------------

test('heisenbug phase 3: the three moths slide to the centre over 0.5 s inside the shield and merge into a giant at exactly 2x', () => {
  const t = pair();
  toPhase2(t);
  const { w, boss } = t;
  const moths = boss.moths.slice();
  assert.equal(moths.length, 3);
  put(moths[0], 60, 60);
  put(moths[1], 260, 60);
  put(moths[2], 60, 150);
  step(w, 1);
  const start3 = moths.map((m) => ({ x: m.x, y: m.y }));
  boss.body.hp = P3(boss) - 0.5;
  w.events.length = 0;
  step(w, 1);
  assert.equal(events(w, 'bossPhase').length, 1);
  assert.equal(boss.phase, 3);
  assert.ok(boss.merge, 'the merge is under way');
  const from = moths.map((m) => ({ x: m.x, y: m.y }));
  assert.ok(from.every((f, i) => Math.abs(f.x - start3[i].x) < 3), 'the moths started from where they stood');
  for (let i = 0; i < 29; i++) {
    step(w, 1);
    assert.equal(w.damageEnemy(boss.body, 1), 0, 'inside the phase shield');
    assert.ok(boss.moths.length === 3 && boss.giant === false);
  }
  const mid = moths.map((m) => dist(m, { x: 160, y: 96 }));
  assert.ok(mid.every((d, i) => d < dist(from[i], { x: 160, y: 96 }) * 0.1), 'nearly there on the last tick');
  step(w, 1);
  assert.equal(boss.giant, true);
  assert.equal(boss.moths.length, 1);
  assert.equal(boss.moths[0], boss.body);
  assert.deepEqual([boss.body.x, boss.body.y], [160, 96]);
  assert.equal(boss.body.r, 18, 'the hitbox is 2x');
  assert.equal(moths.filter((m) => m.dead).length, 2, 'the other two folded into it');
  for (const m of moths) assert.ok(m === boss.body || m.dead);
  const r = spyRenderer();
  t.CB.Enemies.heisenbug.draw(boss.body, r, 1);
  const spr = sprites(r).filter((s) => s.name === 'heisenStone_0' || s.name === 'heisenbug_0' || s.name.startsWith('heisenbug_'));
  assert.ok(spr.length >= 1 && spr.every((s) => s.o.scale === 2), 'every sprite of the giant is drawn at exactly 2x');
});

test('heisenbug phase 3: the merge cameos are draw-only, guarded by hasSprite, and use each boss\'s own sprite names', () => {
  const t = pair();
  toPhase2(t);
  t.boss.body.hp = P3(t.boss) - 0.5;
  step(t.w, 1);
  step(t.w, 10);
  assert.ok(t.boss.merge);
  const before = t.w.enemies.length;
  const r = spyRenderer();
  assert.doesNotThrow(() => t.boss.draw(r, 1), 'no other boss loaded: nothing to draw, nothing breaks');
  assert.equal(sprites(r).filter((s) => ['loopHead_0', 'leakBoss_0', 'conflictHead_0'].includes(s.name)).length, 0);
  assert.equal(t.w.enemies.length, before, 'drawing changes no world state');
  // with everything loaded the three bosses fold in at about half alpha
  const CB = H.load();
  const w = CB.createWorld({ seed: 4, god: true, stage: CB.STAGES[3] });
  w.boss = CB.Bosses.heisenbug.create(w);
  w.boss.body.hp = P2(w.boss) - 0.5;
  step(w, 1);
  step(w, 40);
  w.boss.body.hp = P3(w.boss) - 0.5;
  step(w, 11);
  const r2 = spyRenderer();
  w.boss.draw(r2, 1);
  const cams = sprites(r2).filter((s) => ['loopHead_0', 'leakBoss_0', 'conflictHead_0'].includes(s.name));
  assert.deepEqual(cams.map((s) => s.name).sort(), ['conflictHead_0', 'leakBoss_0', 'loopHead_0']);
  for (const s of cams) {
    assert.equal(s.o.alpha, 0.5);
    assert.ok(dist(s, { x: 160, y: 96 }) < 160);
  }
  step(w, 30);
  const r3 = spyRenderer();
  w.boss.draw(r3, 1);
  assert.equal(sprites(r3).filter((s) => ['loopHead_0', 'leakBoss_0', 'conflictHead_0'].includes(s.name)).length, 0, 'and they are gone once merged');
});

test('heisenbug phase 3: the law inverts. The giant is awake and solid only while looked at (0.3 s grace); unobserved it sleeps, harmless and immune', () => {
  const t = pair();
  toPhase3(t);
  const { w, boss } = t;
  const g = boss.body;
  step(w, 1, AWAY);
  step(w, 30, AWAY);
  assert.equal(g.data.obs, false);
  assert.equal(hit(w, g, 1), 0, 'asleep: immune');
  assert.ok(events(w, 'clink').length >= 1);
  w.player.x = g.x;
  w.player.y = g.y;
  step(w, 60, AWAY);
  assert.equal(w.stats.wouldHits, 0, 'asleep: harmless to touch');
  w.player.x = 160;
  w.player.y = 126;
  const look = aimAt(g);
  step(w, 1, look);
  assert.equal(g.data.obs, true);
  assert.ok(hit(w, g, 1) > 0, 'awake: takes damage');
  let released = -1;
  for (let i = 1; i <= 30 && released < 0; i++) {
    step(w, 1, AWAY);
    if (hit(w, g, 0.01) === 0) released = i;
  }
  assert.ok(released >= 18 && released <= 19, `awake for ${released} ticks after the ray left (0.3 s)`);
});

test('heisenbug phase 3: every 2.4 damage the awake giant reflects one opposite pair of spiral bullets at 75 px/s, turning 0.35 rad per pair', () => {
  const t = pair();
  toPhase3(t);
  const { w, boss } = t;
  const g = boss.body;
  const look = aimAt(g);
  step(w, 1, look);
  const fires = countFires(w);
  hit(w, g, 1);
  hit(w, g, 1);
  step(w, 1, look);
  assert.equal(fires.n, 0, '2.0 is not enough');
  hit(w, g, 0.4);
  step(w, 1, look);
  assert.equal(fires.n, 2);
  const [p, q] = fires.calls;
  assert.ok(Math.abs(Math.abs(p.angle - q.angle) - Math.PI) < 1e-9, 'opposite');
  assert.ok(fires.calls.every((c) => c.speed === 75 && c.x === g.x && c.y === g.y));
  for (let i = 0; i < 4; i++) {
    hit(w, g, 2.4);
    step(w, 1, look);
  }
  assert.equal(fires.n, 10);
  for (let k = 1; k < 5; k++) {
    const d = (((fires.calls[2 * k].angle - fires.calls[2 * (k - 1)].angle) % TAU) + TAU) % TAU;
    assert.ok(Math.abs(d - 0.35) < 1e-9, `pair ${k} advanced ${d}`);
  }
});

test('heisenbug phase 3: every 14 damage the giant lunges with the same tell, and looking away cancels it', () => {
  const t = pair();
  toPhase3(t);
  const { w, boss } = t;
  const g = boss.body;
  const look = aimAt(g);
  step(w, 1, look);
  hit(w, g, 13);
  w.events.length = 0;
  step(w, 1, look);
  assert.equal(events(w, 'beamCharge').length, 0, '13 is not 14');
  hit(w, g, 1);
  step(w, 1, look);
  const bc = events(w, 'beamCharge');
  assert.equal(bc.length, 1);
  for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(finite(bc[0][k]));
  assert.equal(g.data.lunge.stage, 'tell');
  let contact = 0;
  let tell = 1;
  while (g.data.lunge && g.data.lunge.stage === 'tell') {
    step(w, 1, look);
    tell++;
    assert.equal(g.contact, false);
  }
  assert.ok(tell >= 36 && tell <= 38, `${tell} ticks of tell`);
  step(w, 3, look);
  assert.equal(g.contact, true, 'solid and touching in the dash');
  contact++;
  step(w, 1, AWAY); // look away mid-dash: it falls asleep, the lunge is gone
  step(w, 30, AWAY);
  assert.equal(g.data.lunge, null);
  assert.equal(g.contact, false);
  assert.ok(contact);
  // and the other way: looking away during the tell cancels it
  const t2 = pair();
  toPhase3(t2);
  const g2 = t2.boss.body;
  step(t2.w, 1, aimAt(g2));
  hit(t2.w, g2, 14);
  step(t2.w, 5, aimAt(g2));
  assert.equal(g2.data.lunge.stage, 'tell');
  step(t2.w, 30, AWAY);
  assert.equal(g2.data.lunge, null);
});

test('heisenbug phase 3: at 26 strain the giant whitens for 0.25 s, novas 16 around a gap on Clawd, jumps 80 px, gets a 1.2 s shield and sleeps; strain cools 4/s asleep', () => {
  const t = pair();
  toPhase3(t);
  const { CB, w, boss } = t;
  const g = boss.body;
  const look = aimAt(g);
  step(w, 1, look);
  const fires = countFires(w);
  g.data.strain = 25;
  step(w, 30, look);
  assert.equal(g.data.over, 0, '25 is not full');
  assert.equal(fires.n, 0);
  hit(w, g, 1);
  assert.equal(g.data.strain, 26);
  const at = { x: g.x, y: g.y };
  let whites = 0;
  let nova = -1;
  for (let i = 1; i <= 40 && nova < 0; i++) {
    step(w, 1, look);
    if (g.data.over > 0) {
      const r = spyRenderer();
      CB.Enemies.heisenbug.draw(g, r, i / 60);
      if (sprites(r).some((s) => s.o.white === true)) whites++;
    }
    if (fires.n) nova = i;
  }
  assert.ok(whites >= 14 && whites <= 15, `${whites} white ticks`);
  assert.equal(fires.n, 16);
  const toward = Math.atan2(w.player.y - at.y, w.player.x - at.x);
  const nearest = Math.min(...fires.calls.map((c) => Math.abs((((deg(c.angle - toward) % 360) + 540) % 360) - 180)));
  assert.ok(nearest > 22.4, `${nearest.toFixed(2)} degrees clear on each side of Clawd`);
  assert.ok(dist(g, w.player) >= 80);
  assert.ok(g.invuln > 1.1 && g.invuln <= 1.2, `shield ${g.invuln}`);
  assert.equal(w.damageEnemy(g, 1), 0, 'the shield blocks even a direct call');
  assert.equal(g.data.strain, 0);
  // it sleeps until looked at again: the aim is still on the old spot
  step(w, 1, AWAY);
  assert.equal(g.data.obs, false);
  g.data.strain = 20;
  step(w, 60, AWAY);
  assert.ok(Math.abs(g.data.strain - 16) < 0.07, `cooled 4/s: ${g.data.strain.toFixed(2)}`);
});

// ---- the last blow ---------------------------------------------------------------------------------------------------------

test('heisenbug REPRODUCED: the last hit leaves HP just above 0, turns the giant to stone with a gold ring and pop, and the body dies 0.9 s later', () => {
  const t = pair();
  toPhase3(t);
  const { CB, w, boss } = t;
  const g = boss.body;
  const look = aimAt(g);
  g.hp = 3;
  step(w, 1, look);
  w.events.length = 0;
  assert.equal(hit(w, g, 5), 5);
  assert.ok(g.hp > 0 && g.hp < 1, `HP floors at ${g.hp}`);
  assert.equal(boss.hp > 0 && boss.hp < 1, true);
  assert.equal(g.dead, false);
  assert.equal(boss.defeated, false);
  const pop = events(w, 'text').find((e) => e.text === 'REPRODUCED');
  assert.ok(pop, 'the pop');
  assert.equal(pop.color, CB.Pal.C.gold);
  assert.ok(finite(pop.x) && finite(pop.y));
  assert.equal(events(w, 'enemyDie').length, 0, 'not dead yet');
  assert.equal(hit(w, g, 5), 0, 'nothing counts any more');
  assert.equal(w.damageEnemy(g, 5), 0);
  // stone, with a gold ring collapsing into it
  const r = spyRenderer();
  CB.Enemies.heisenbug.draw(g, r, 1);
  assert.deepEqual(sprites(r).filter((s) => s.name.startsWith('heisenbug_') || s.name === 'heisenStone_0').map((s) => s.name), ['heisenStone_0']);
  const ring = spyRenderer();
  boss.draw(ring, 1);
  const rings = ring.calls.filter((c) => c.name === 'ring' && c.a[3] === CB.Pal.C.gold).map((c) => c.a[2]);
  assert.ok(rings.length >= 1, 'a gold ring');
  step(w, 30, look);
  const ring2 = spyRenderer();
  boss.draw(ring2, 1);
  const rings2 = ring2.calls.filter((c) => c.name === 'ring' && c.a[3] === CB.Pal.C.gold).map((c) => c.a[2]);
  assert.ok(Math.max(...rings2) < Math.max(...rings), 'and it collapses');
  // the controller keeps updating through the beat, and closes the bug at 0.9 s
  const age0 = boss.age;
  let died = -1;
  for (let i = 31; i <= 90 && died < 0; i++) {
    step(w, 1, look);
    if (boss.defeated) died = i;
  }
  assert.ok(boss.age > age0, 'the controller kept updating');
  assert.ok(died >= 53 && died <= 56, `dead on tick ${died} (0.9 s after the blow)`);
  assert.equal(g.dead, true);
  assert.equal(boss.hp, 0);
  assert.ok(events(w, 'enemyDie').some((e) => e.boss === true && e.silent === false));
});

test('heisenbug REPRODUCED: any killing blow goes through the beat, in any phase, and the run then shows its usual BUG FIXED flow', () => {
  const CB = H.load();
  const run = CB.createRun({ seed: 5, startStage: 3, god: true, skipWaves: true });
  const bot = makeBot();
  let g = 0;
  while (run.state !== 'boss' && g++ < 1200) run.step(bot(run));
  assert.equal(run.state, 'boss');
  const w = run.world;
  const boss = w.boss;
  w.damageEnemy(boss.body, 99999); // a direct kill from phase 1
  assert.ok(boss.body.hp > 0 && boss.body.hp < 1);
  assert.equal(boss.defeated, false);
  let ticks = 0;
  while (run.state === 'boss' && ticks++ < 200) run.step(H.makeInput({ aimX: 160, aimY: 40 }));
  assert.equal(run.state, 'bossDead');
  assert.ok(ticks >= 53 && ticks <= 58, `${ticks} ticks in the boss state after the blow`);
  assert.equal(boss.defeated, true);
  assert.equal(run.bossesFixed, 1);
  assert.ok(w.enemies.every((e) => e.dead || false));
  const B = CB.Bosses.heisenbug;
  const pts = B.deathPoints(boss);
  assert.equal(pts.length, 7);
  for (const p of pts) assert.ok(finite(p.x) && finite(p.y));
});

test('heisenbug REPRODUCED: deathPoints is the body plus 6 points on a ring, before and after the end, for moth and giant', () => {
  const t = pair();
  const B = t.CB.Bosses.heisenbug;
  const before = B.deathPoints(t.boss);
  assert.equal(before.length, 7);
  assert.deepEqual(before[0], { x: t.boss.body.x, y: t.boss.body.y });
  assert.ok(Math.abs(dist(before[1], before[0]) - 14) < 1e-9);
  const g = pair();
  toPhase3(g);
  assert.ok(Math.abs(dist(B.deathPoints(g.boss)[1], g.boss.body) - 26) < 1e-9, 'a wider ring for the giant');
  assert.equal(B.deathPoints(null).length, 7);
  assert.equal(B.deathPoints({}).length, 7);
});

// ---- fairness ---------------------------------------------------------------------------------------------------------------

// A deterministic bot fight on stage 4. onTick(run, boss, w, ev) runs after every step (ev: the events that step returned, run.step drains the
// world's list); the fight stops at the boss's death or after `max` seconds.
function botFight(seed, patches, max, onTick, setup) {
  const CB = H.load();
  const run = CB.createRun({ seed, startStage: 3, god: true, skipWaves: true, patches: patches || {} });
  const bot = makeBot();
  if (setup) setup(CB, run);
  let ticks = 0;
  while (ticks < max * 60 && run.state !== 'bossDead') {
    const ev = run.step(bot(run));
    ticks++;
    if (run.state === 'boss' && run.world.boss && onTick) onTick(run, run.world.boss, run.world, ev);
  }
  return { CB, run };
}
const THREE = { spread: 1, rapid: 1, pierce: 1 };

test('heisenbug fair: contact only during a lunge, and every lunge is telegraphed for at least 0.6 s', () => {
  let lunges = 0;
  let contacts = 0;
  let giantLunges = 0;
  for (const seed of [1, 2, 3, 4]) {
    const tellStart = new Map();
    const dashAt = new Map();
    botFight(seed, seed % 2 ? THREE : {}, 200, (run, boss, w) => {
      for (const m of boss.moths) {
        const L = m.data.lunge;
        if (L) {
          if (!tellStart.has(L)) {
            tellStart.set(L, w.time);
            lunges++;
            if (m.data.giant) giantLunges++;
          }
          if (L.stage === 'dash' && !dashAt.has(L)) {
            dashAt.set(L, w.time);
            assert.ok(w.time - tellStart.get(L) >= 0.6 - 1e-6, `a lunge dashed ${(w.time - tellStart.get(L)).toFixed(3)} s after its tell began`);
          }
        }
        if (m.contact) {
          contacts++;
          assert.ok(L && L.stage === 'dash', `contact outside a dash at t=${w.time.toFixed(2)}`);
        }
      }
    });
  }
  assert.ok(lunges >= 10 && contacts >= 10, `${lunges} lunges and ${contacts} contact ticks seen: the check is not vacuous`);
  assert.ok(giantLunges >= 1, 'including the giant');
});

test('heisenbug fair: every nova and ripple leaves a gap centred on Clawd as she stood when it fired', () => {
  const sizes = {};
  for (const seed of [1, 2, 3, 5]) {
    const groups = [];
    botFight(
      seed,
      seed % 2 ? THREE : {},
      200,
      (run, boss, w) => {
        for (const g of groups) if (g.time === w.time && !g.done) g.done = false;
      },
      (CB, run) => {
        const w = run.world;
        const orig = w.fireEnemyBullet;
        w.fireEnemyBullet = (...a) => {
          const last = groups[groups.length - 1];
          const rec = { x: a[0], y: a[1], angle: a[2], speed: a[3], p: { x: w.player.x, y: w.player.y } };
          if (last && last.time === w.time && last.x === a[0] && last.y === a[1]) last.bullets.push(rec);
          else groups.push({ time: w.time, x: a[0], y: a[1], bullets: [rec] });
          return orig(...a);
        };
      }
    );
    for (const g of groups) {
      if (g.bullets.length < 8) continue; // reflected sparks come in pairs
      sizes[g.bullets.length] = (sizes[g.bullets.length] || 0) + 1;
      const p = g.bullets[0].p;
      const toward = Math.atan2(p.y - g.y, p.x - g.x);
      const clear = Math.min(...g.bullets.map((b) => Math.abs((((deg(b.angle - toward) % 360) + 540) % 360) - 180)));
      const floor = g.bullets.length === 9 ? 29.9 : 22.4;
      assert.ok(clear >= floor, `a ${g.bullets.length}-bullet ring left only ${clear.toFixed(2)} degrees clear on each side of Clawd`);
      assert.ok(g.bullets.every((b) => b.speed === 75));
    }
  }
  assert.ok(sizes[9] >= 3, `ripples seen: ${sizes[9]}`);
  assert.ok(sizes[8] >= 3, `moth novas seen: ${sizes[8]}`);
  assert.ok(sizes[16] >= 1, `giant novas seen: ${sizes[16]}`);
});

test('heisenbug fair: up close the nova gap widens so Clawd still fits through it', () => {
  const { w, boss, a, look } = pair();
  put(a, 160, 118); // 8 px above Clawd
  w.player.hearts = 3;
  const fires = countFires(w);
  hit(w, a, 22);
  boss.charge = 0; // keep the ghost's lash out of it
  step(w, 1, look);
  step(w, 30, look);
  assert.equal(fires.n, 8);
  const toward = Math.atan2(w.player.y - fires.calls[0].y, w.player.x - fires.calls[0].x);
  const clear = Math.min(...fires.calls.map((c) => Math.abs((((deg(c.angle - toward) % 360) + 540) % 360) - 180)));
  assert.ok(clear > 60, `${clear.toFixed(1)} degrees clear when Clawd is 8 px from the moth`);
  assert.equal(w.stats.wouldHits, 0);
});

test('heisenbug fair: new, split and jumping moths land at least 80 px from Clawd with at least 0.45 s of no contact', () => {
  let landings = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    botFight(seed, seed % 2 ? THREE : {}, 200, (run, boss, w, ev) => {
      for (const e of ev) {
        if (e.type !== 'teleport') continue;
        landings++;
        assert.ok(dist({ x: e.x2, y: e.y2 }, w.player) >= 80 - 1e-6, `a moth landed ${dist({ x: e.x2, y: e.y2 }, w.player).toFixed(1)} px from Clawd`);
        const m = boss.moths.find((mm) => Math.hypot(mm.x - e.x2, mm.y - e.y2) < 1e-6);
        assert.ok(m && m.noContactT >= 0.45 && m.contact === false, 'the landed moth is harmless for a while');
      }
    });
  }
  assert.ok(landings >= 12, `${landings} landings seen`);
});

test('heisenbug fair: nothing attacks in the first 2.6 s, however much damage the bot has dealt', () => {
  for (const seed of [1, 2, 3]) {
    let bullets = 0;
    let first = Infinity;
    botFight(seed, THREE, 30, (run, boss, w, ev) => {
      if (boss.age < 2.6 - 1e-6) {
        for (const e of ev) if (e.type === 'beamCharge' || e.type === 'enemyShoot') bullets++;
        assert.equal(w.eBullets.length, 0, 'no bullets');
        for (const m of boss.moths) assert.equal(m.contact, false);
      } else if (first === Infinity) first = boss.age;
    });
    assert.equal(bullets, 0);
    assert.ok(first >= 2.6 - 1e-6);
  }
});

test('heisenbug fair: a ring that fills inside the first 2.6 s waits: the white-out starts so that the nova lands no earlier than 2.6 s', () => {
  const { w, boss } = start();
  const [a, b] = boss.moths;
  put(a, 160, 46);
  put(b, 260, 120);
  const look = aimAt(a);
  step(w, 1, look);
  hit(w, a, 22);
  const fires = countFires(w);
  let whiteAt = -1;
  let novaAt = -1;
  for (let i = 0; i < 200 && novaAt < 0; i++) {
    step(w, 1, look);
    if (whiteAt < 0 && a.data.over > 0) whiteAt = w.time;
    if (fires.n) novaAt = w.time;
    if (!fires.n) assert.ok(w.time < 2.6 - 1e-6 || a.data.over > 0 || fires.n, 'nothing happened early');
  }
  assert.equal(fires.n >= 8, true);
  assert.ok(novaAt >= 2.6 - 1e-6 && novaAt <= 2.6 + 0.04, `the nova at ${novaAt.toFixed(3)} s`);
  assert.ok(whiteAt >= 2.35 - 0.04 && whiteAt <= 2.4, `the white-out began at ${whiteAt.toFixed(3)} s`);
  assert.equal(events(w, 'teleport').length >= 1, true);
});

test('heisenbug fair: calm mode. The white-out is held and not flashed, and every flicker goes through Comfort.blink', () => {
  const t = pair();
  const { CB, w, a } = t;
  const calls = [];
  CB.Comfort = { blink: (tt, hz) => (calls.push(hz), Math.floor(tt * Math.min(hz, 4)) % 2 === 0), calm: () => true };
  hit(w, a, 22);
  step(w, 1, t.look);
  const white = [];
  for (let i = 0; i < 14; i++) {
    const r = spyRenderer();
    CB.Enemies.heisenbug.draw(a, r, 0.3 + i * 0.041);
    white.push(sprites(r).filter((s) => s.name === 'heisenStone_0').map((s) => s.o.white));
    step(w, 1, t.look);
  }
  assert.ok(white.every((x) => x.length === 1 && x[0] === true), 'white on every frame of the white-out');
  assert.equal(calls.length, 0, 'the white-out never blinks');
  // a shield flickers, and that goes through Comfort
  a.invuln = 0.5;
  const r = spyRenderer();
  CB.Enemies.heisenbug.draw(a, r, 0.3);
  assert.ok(calls.length >= 1 && calls.every((hz) => hz > 4 || hz > 0), 'the shield flicker asked Comfort');
  delete CB.Comfort;
  assert.doesNotThrow(() => CB.Enemies.heisenbug.draw(a, spyRenderer(), 0.3), 'and it works without CB.Comfort');
});

test('heisenbug fair: not colour alone. Every tell has a shape, and nothing it draws is red or pink', () => {
  const { CB, w, boss, a, b, look } = pair();
  const C = CB.Pal.C;
  const drawn = [];
  const all = (r) => {
    for (const c of r.calls) if (['rect', 'ring', 'disc', 'line'].includes(c.name)) drawn.push(c.a[c.name === 'rect' ? 4 : c.name === 'line' ? 4 : 3]);
  };
  // the lunge tell: a dotted line (rects) and a landing ring, in white on ink
  put(b, 205, 126);
  boss.age = 10;
  boss.charge = 100;
  step(w, 12, look);
  const r = spyRenderer();
  boss.draw(r, 1);
  all(r);
  const whiteDots = r.calls.filter((c) => c.name === 'rect' && c.a[4] === C.white && c.a[2] === 2);
  const inkSquares = r.calls.filter((c) => c.name === 'rect' && c.a[4] === C.ink && c.a[2] === 4);
  assert.ok(inkSquares.length >= 6 && whiteDots.length >= inkSquares.length, `${whiteDots.length} white dots on ${inkSquares.length} ink squares`);
  const rings = r.calls.filter((c) => c.name === 'ring');
  assert.ok(rings.some((c) => c.a[3] === C.white) && rings.some((c) => c.a[3] === C.ink), 'a white landing ring with an ink outline');
  // the strain warning: a red eye in a white lid with an ink outline
  const d = CB.Art.spriteDef('heisenEye_1').rows.join('');
  assert.ok(d.includes('w') && d.includes('k') && d.includes('r'), 'the red eye has a white lid and an ink outline');
  // the stone, the wave and the awake giant are different shapes and sprites
  const names = (m) => {
    const rr = spyRenderer();
    CB.Enemies.heisenbug.draw(m, rr, 1);
    all(rr);
    return sprites(rr).map((s) => s.name);
  };
  assert.ok(names(a).includes('heisenStone_0'), 'stone');
  assert.ok(!names(b).includes('heisenStone_0') && names(b).some((n) => n.startsWith('heisenbug_cyan_')) && names(b).some((n) => n.startsWith('heisenbug_yel_')), 'wave');
  assert.ok(!names(b).some((n) => n.startsWith('heisenbug_mag_')), 'never magenta');
  // no primitive it draws is in the red or pink family
  for (const col of drawn) for (const bad of [C.red, C.redDark, C.hurt, C.ember, C.bullet, C.magenta, C.magentaDark, C.bulletCore]) assert.notEqual(col, bad, 'a red or pink primitive');
  // a dazzled moth shows dizzy dots (a shape), a sleeping giant a "z"
  b.data.dazzle = 1;
  const rd = spyRenderer();
  CB.Enemies.heisenbug.draw(b, rd, 1);
  assert.ok(rd.calls.filter((c) => c.name === 'rect' && c.a[4] === C.gold).length >= 3, 'dizzy dots');
});

test('heisenbug fair: YOLO makes bullets 15% faster, and a stationary Clawd still walks away from every nova and ripple', () => {
  for (const kind of ['nova', 'ripple', 'close', 'giant']) {
    const t = pair({ yolo: true, god: false });
    const { w, boss, a, b, look } = t;
    const fires = countFires(w);
    let g;
    if (kind === 'nova') hit(w, a, 22);
    else if (kind === 'close') {
      put(a, 160, 117);
      hit(w, a, 22);
    } else if (kind === 'ripple') {
      put(b, 280, 126);
      boss.age = 10;
      boss.charge = 100;
    } else {
      toPhase3(t);
      g = boss.body;
      g.data.strain = 26;
    }
    step(w, 240, kind === 'giant' ? aimAt(g) : look);
    assert.ok(fires.n >= (kind === 'giant' ? 16 : 8), `${kind}: ${fires.n} bullets`);
    assert.ok(fires.calls.every((c) => c.speed === 75), 'the callers ask for 75; the world applies the 1.15');
    assert.equal(w.player.hearts, w.player.stats.maxHearts, `${kind}: Clawd was not hit standing still`);
    assert.ok(w.eBullets.length === 0 || Math.hypot(w.eBullets[0].vx, w.eBullets[0].vy) > 86);
  }
});

test('heisenbug fair: bullet caps. A full bullet list stops the rings quietly, and nothing throws', () => {
  const { CB, w, boss, a, b, look } = pair();
  while (w.fireEnemyBullet(10, 10, 0, 0, { life: 99 }));
  assert.equal(w.eBullets.length, CB.CAPS.eBullets);
  put(b, 280, 126);
  boss.age = 10;
  boss.charge = 100;
  hit(w, a, 22);
  assert.doesNotThrow(() => step(w, 60, look));
  assert.ok(w.eBullets.length <= CB.CAPS.eBullets);
  const t = pair();
  toPhase3(t);
  while (t.w.fireEnemyBullet(10, 10, 0, 0, { life: 99 }));
  t.boss.body.data.strain = 26;
  hit(t.w, t.boss.body, 5);
  assert.doesNotThrow(() => step(t.w, 60, aimAt(t.boss.body)));
  assert.ok(t.w.eBullets.length <= CB.CAPS.eBullets);
});

// ---- engine notes ----------------------------------------------------------------------------------------------------------

test('heisenbug engine: the published velocity is displacement / dt, so jumps and lunges are non-zero', () => {
  let jumps = 0;
  let lunges = 0;
  let checked = 0;
  for (const seed of [1, 2, 3]) {
    const last = new Map();
    botFight(seed, seed === 2 ? {} : THREE, 200, (run, boss, w) => {
      for (const m of boss.moths) {
        const was = last.get(m);
        last.set(m, { x: m.x, y: m.y });
        if (!was) continue;
        const d = dist(m, was);
        checked++;
        assert.ok(Math.abs(Math.hypot(m.vx, m.vy) * DT - d) < 1e-6, `v = ${Math.hypot(m.vx, m.vy).toFixed(2)} but it moved ${d.toFixed(4)} px`);
        if (d > 30) jumps++;
        if (d > 3.9 && m.data.lunge && m.data.lunge.stage === 'dash') lunges++;
      }
    });
  }
  assert.ok(checked > 1000 && jumps >= 5 && lunges >= 10, `${checked} ticks, ${jumps} jumps, ${lunges} dash ticks`);
});

test('heisenbug engine: the same seed and inputs give the same fight', () => {
  const trace = () => {
    const out = [];
    botFight(7, THREE, 80, (run, boss, w) => {
      if (Math.round(w.time * 60) % 20 === 0) out.push([boss.hp.toFixed(3), boss.phase, ...boss.moths.map((m) => m.x.toFixed(3) + ',' + m.y.toFixed(3)), w.eBullets.length]);
    });
    return JSON.stringify(out);
  };
  assert.equal(trace(), trace());
});

test('heisenbug engine: every event has finite x, y, and a long bot fight keeps everything finite and under the caps', () => {
  const seen = new Set();
  botFight(3, {}, 200, (run, boss, w, ev) => {
    for (const e of ev) {
      seen.add(e.type);
      assert.ok(finite(e.x) && finite(e.y), `${e.type} x=${e.x} y=${e.y}`);
      if (e.type === 'beamCharge') for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(finite(e[k]), `beamCharge.${k}`);
      if (e.type === 'teleport') assert.ok(finite(e.x2) && finite(e.y2));
    }
    for (const m of boss.moths) assert.ok(finite(m.x) && finite(m.y) && finite(m.hp) && finite(m.vx) && finite(m.vy));
    assert.ok(w.eBullets.length <= w.CAPS_EB || w.eBullets.length <= 400, 'under the bullet cap');
    assert.ok(finite(boss.hp) && boss.hp >= 0);
  });
  for (const type of ['enemyShoot', 'teleport', 'beamCharge', 'bossPhase', 'clink', 'text']) assert.ok(seen.has(type), `no ${type} in the whole fight (saw ${[...seen].join(', ')})`);
});

test('heisenbug engine: the bot beats it from every kit, through all three phases and the REPRODUCED beat', () => {
  for (const [patches, limit] of [[THREE, 120], [{}, 240]]) {
    const counts = {};
    const { run } = botFight(2, patches, limit, (r, boss, w, ev) => {
      for (const e of ev) counts[e.type] = (counts[e.type] || 0) + 1;
    });
    assert.equal(run.state, 'bossDead', 'the boss fell within the time limit');
    assert.equal(counts.bossPhase, 2);
    assert.ok(run.world.boss.giant, 'the giant was reached');
    assert.equal(run.world.boss.defeated, true);
  }
});

test('heisenbug engine: a stray moth with no controller still draws and takes a plain hit', () => {
  const { CB, w } = start();
  const m = w.spawnEnemy('heisenbug', 100, 100);
  assert.equal(w.damageEnemy(m, 5, bolt(5)), 5);
  assert.equal(m.hp, m.maxHp - 5);
  assert.doesNotThrow(() => CB.Enemies.heisenbug.draw(m, spyRenderer(), 1));
});

test('heisenbug engine: every draw path runs on a renderer with only the documented methods, in every phase and state', () => {
  const t = pair();
  const { CB, w, boss, a, b } = t;
  const states = [];
  const draw = (label) => {
    const r = spyRenderer();
    assert.doesNotThrow(() => {
      for (const m of boss.moths) if (!m.dead) CB.Enemies.heisenbug.draw(m, r, 1.23);
      boss.draw(r, 1.23);
    }, label);
    states.push(label);
  };
  draw('phase 1');
  b.data.dazzle = 0.5;
  b.data.born = 0.3;
  draw('dazzled and newborn');
  hit(w, a, 22);
  step(w, 5, t.look);
  draw('white-out');
  step(w, 20, t.look);
  draw('after the nova (afterimage)');
  put(b, 205, 126);
  b.data.dazzle = 0;
  boss.age = 10;
  boss.charge = 100;
  step(w, 8, aimAt(a));
  draw('lunge tell');
  toPhase3(t);
  draw('merged giant, asleep');
  step(w, 2, aimAt(boss.body));
  draw('giant awake');
  hit(w, boss.body, 14);
  step(w, 2, aimAt(boss.body));
  draw('giant lunge tell');
  boss.body.hp = 3;
  hit(w, boss.body, 5);
  draw('REPRODUCED');
  step(w, 70, aimAt(boss.body));
  assert.doesNotThrow(() => boss.draw(spyRenderer(), 1), 'a defeated boss draws nothing');
  assert.ok(states.length >= 9);
  // nothing here touches the world
  const before = JSON.stringify(boss.moths.map((m) => [m.x, m.y, m.hp]));
  draw('again');
  assert.equal(JSON.stringify(boss.moths.map((m) => [m.x, m.y, m.hp])), before);
});

test('heisenbug engine: the giant and the wave draw through a real renderer too', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const w = CB.createWorld({ seed: 2, god: true, stage: CB.STAGES[3] });
  w.boss = CB.Bosses.heisenbug.create(w);
  for (const hp of [w.boss.maxHp, P2(w.boss) - 1, P3(w.boss) - 1]) {
    w.boss.body.hp = hp;
    step(w, 60, aimAt(w.boss.body));
    assert.doesNotThrow(() => CB.WorldDraw.draw(r, w, 1, { hitboxes: false }));
  }
});

test('heisenbug engine: the clink sound is throttled so bolts bouncing off a wave do not machine-gun', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  ctx.install(sandbox);
  CB.Audio.init();
  const starts = () => ctx.starts.filter((s) => s.kind === 'oscillator').length;
  ctx.currentTime = 1;
  CB.Audio.handleEvents([{ type: 'clink', x: 1, y: 1 }, { type: 'clink', x: 1, y: 1 }, { type: 'clink', x: 1, y: 1 }]);
  assert.equal(starts(), 1, 'three clinks in one call sound once');
  ctx.currentTime = 1.04;
  CB.Audio.handleEvents([{ type: 'clink', x: 1, y: 1 }]);
  assert.equal(starts(), 1, 'blocked inside 0.05 s');
  ctx.currentTime = 1.06;
  CB.Audio.handleEvents([{ type: 'clink', x: 1, y: 1 }]);
  assert.equal(starts(), 2, 'allowed after it');
});

test('heisenbug engine: the crosshair tints cyan while the boss reports an observed moth, and only the crosshair', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const rec = H.recorder(r, CB);
  const run = CB.createRun({ seed: 4, startStage: 3, god: true });
  const w = run.world;
  const cursor = (mode) => {
    rec.clear();
    CB.Screens.hud.cursor(r, 100, 90, mode || 'cross', 0);
    return rec.sprites().map((s) => s.name);
  };
  const hud = (boss) => {
    w.boss = boss;
    CB.Screens.hud.draw(r, run, 1);
  };
  assert.deepEqual(cursor(), ['cursor_cross_0'], 'before any frame');
  hud({ id: 'heisenbug', x: 1, y: 1, hp: 5, maxHp: 10, phase: 1, defeated: false, observing: true });
  assert.deepEqual(cursor(), ['cursor_cross_look_0']);
  assert.deepEqual(cursor('pointer'), ['cursor_pointer'], 'the menu pointer never tints');
  rec.clear();
  CB.Screens.hud.cursor(r, 100, 90, 'cross', 0.25);
  assert.deepEqual(rec.sprites().map((s) => s.name), ['cursor_cross_look_1'], 'the second frame too');
  hud({ id: 'heisenbug', x: 1, y: 1, hp: 5, maxHp: 10, phase: 1, defeated: false, observing: false });
  assert.deepEqual(cursor(), ['cursor_cross_0']);
  hud({ id: 'heisenbug', x: 1, y: 1, hp: 5, maxHp: 10, phase: 1, defeated: true, observing: true });
  assert.deepEqual(cursor(), ['cursor_cross_0'], 'a defeated boss does not tint');
  hud({ id: 'infiniteLoop', x: 1, y: 1, hp: 5, maxHp: 10, phase: 1, defeated: false });
  assert.deepEqual(cursor(), ['cursor_cross_0'], 'other bosses never report it');
  hud(null);
  assert.deepEqual(cursor(), ['cursor_cross_0'], 'no boss, no tint');
  for (const n of ['cursor_cross_look_0', 'cursor_cross_look_1']) {
    const d = CB.Art.spriteDef(n);
    assert.ok(d.rows.join('').includes('c') && !d.rows.join('').includes('w'), `${n} has cyan arms`);
    assert.ok(d.rows.join('').includes('k'), 'and keeps the ink outline');
  }
  // the live boss really reports it
  const t = pair();
  assert.equal(t.boss.observing, true);
});

test('heisenbug engine: the phase 3 pool ends with "regression detected" and index 0 is unchanged', () => {
  const CB = H.load();
  const pool = CB.Quips.bossPhase.heisenbug[3];
  assert.equal(pool[0], 'works on my machine');
  assert.equal(pool[pool.length - 1], 'regression detected');
  assert.ok(pool.length >= 4);
  assert.ok(CB.Font.measure('regression detected') <= 150);
  assert.deepEqual(Array.from(CB.Quips.bossPhase.heisenbug[2]).slice(0, 1), ['cannot reproduce']);
});
