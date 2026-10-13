'use strict';
// T4a: stick aim and aim assist. A stick aims by direction (the aim point is 48 px out along it) and, while it fires, a regular bug
// within 10 degrees and 140 px pulls the aim onto itself. The mouse (and every bot input, which has no aimDir) behaves as before.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { makeBot } = require('./bot');

const BOSS_FILES = [
  'src/art/font.js', 'src/game/enemies/syntaxError.js', 'src/game/enemies/memoryLeak.js', 'src/game/enemies/nullPointer.js',
  'src/game/bosses/infiniteLoop.js', 'src/game/bosses/memoryLeakBoss.js', 'src/game/bosses/mergeConflict.js', 'src/game/bosses/heisenbug.js',
];
const deg = (d) => (d * Math.PI) / 180;

function setup(extra) {
  const CB = H.load([...H.GAME_BASE, ...(extra || [])]);
  CB.Enemies.dummy = {
    create: (w, x, y, op) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 1000, r: 5, contact: false }, op || {})),
    update() {},
    draw() {},
  };
  const w = CB.createWorld({ seed: 9, god: true });
  const p = w.player;
  p.x = 100;
  p.y = 100;
  return { CB, w, p };
}
// A dummy bug `dist` px from Clawd at `angle` degrees clockwise from straight right (y grows downward).
function bugAt(w, angle, dist, props) {
  const p = w.player;
  return w.spawnEnemy('dummy', p.x + Math.cos(deg(angle)) * dist, p.y + Math.sin(deg(angle)) * dist, props);
}
const stick = (dx, dy, over) => H.makeInput(Object.assign({ aimDirX: dx, aimDirY: dy, aimAssist: true, fire: false, aimX: 7, aimY: 7 }, over || {}));
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);

// ---- CB.Player.assistTarget -----------------------------------------------------------------------------------

test('assist: the constants are 48 px out, 10 degrees and 140 px', () => {
  const { CB } = setup();
  assert.equal(CB.Player.AIM_R, 48);
  assert.equal(CB.Player.ASSIST_DEG, 10);
  assert.equal(CB.Player.ASSIST_RANGE, 140);
  assert.equal(typeof CB.Player.assistTarget, 'function');
});

test('assist: a bug dead ahead is the target, and with nothing to snap to the answer is null', () => {
  const { CB, w, p } = setup();
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), null, 'no enemies');
  const e = bugAt(w, 0, 80);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), e);
  assert.equal(CB.Player.assistTarget(w, p, -1, 0), null, 'the other way');
  assert.equal(CB.Player.assistTarget(w, p, 0, 1), null, 'a quarter turn away');
  assert.equal(CB.Player.assistTarget({ enemies: [] }, p, 1, 0), null);
  assert.equal(CB.Player.assistTarget({}, p, 1, 0), null, 'a world without a list');
});

test('assist: the cone is 10 degrees to either side of the stick, measured at the stick direction (any length)', () => {
  const { CB, w, p } = setup();
  const e = bugAt(w, 9.8, 90);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), e, '9.8 degrees off counts');
  assert.equal(CB.Player.assistTarget(w, p, 5, 0), e, 'a long vector is the same direction');
  e.dead = true;
  const f = bugAt(w, -9.8, 90);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), f, 'and 9.8 degrees the other side');
  f.dead = true;
  bugAt(w, 10.3, 90);
  bugAt(w, -10.3, 90);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), null, '10.3 degrees off does not');
  const dir = { x: Math.cos(deg(200)), y: Math.sin(deg(200)) };
  const g = bugAt(w, 205, 60);
  assert.equal(CB.Player.assistTarget(w, p, dir.x, dir.y), g, 'any stick angle, not just straight right');
});

test('assist: a bug has to be within 140 px of Clawd', () => {
  const { CB, w, p } = setup();
  const far = bugAt(w, 0, 141);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), null, '141 px is out of range');
  far.dead = true;
  const edge = bugAt(w, 0, 139);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), edge, '139 px is in');
});

test('assist: only a regular bug that can be hit right now counts (dead, hidden, untargetable, boss-flagged and invulnerable are skipped)', () => {
  const { CB, w, p } = setup();
  const back = bugAt(w, 4, 120); // a legal target further away, to prove each of the others is skipped rather than the search ending
  const cases = [
    ['dead', { dead: true }],
    ['invisible', { visible: false }],
    ['untargetable', { targetable: false }],
    ['not regular', { regular: false }],
    ['boss', { boss: true }],
    ['boss and not regular, like every boss part', { boss: true, regular: false }],
    ['invulnerable', { invuln: 0.5 }],
  ];
  for (const [name, props] of cases) {
    const blocker = bugAt(w, 0, 60, props);
    assert.equal(CB.Player.assistTarget(w, p, 1, 0), back, name);
    blocker.dead = true;
  }
  const spent = bugAt(w, 0, 60, { invuln: 0 });
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), spent, 'a bug whose invulnerability has run out counts again');
  const negative = bugAt(w, 0, 50, { invuln: -0.2 });
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), negative, 'a timer that went negative is over');
});

test('assist: the best aligned bug wins; within 0.002 of cosine the nearer one does; the order of the list never matters', () => {
  const { CB, w, p } = setup();
  const wide = bugAt(w, 5, 60);
  const tight = bugAt(w, 2, 120);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), tight, 'smaller angle beats nearer when the cosines differ clearly');
  tight.dead = true;
  wide.dead = true;

  const a = bugAt(w, 3, 110); // cos 3 deg = 0.99863
  const b = bugAt(w, -3, 60); // the same cosine: the nearer wins
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), b, 'equal angles: nearer');
  a.dead = true;
  b.dead = true;

  const c = bugAt(w, 3.5, 50); // cos 0.99813, 0.0005 below the 3 degree one: a tie
  const d = bugAt(w, 3, 120);
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), c, 'within 0.002 of cosine: nearer');
  w.enemies.reverse();
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), c, 'same answer with the list reversed');
  c.dead = true;
  d.dead = true;

  const e = bugAt(w, 2, 130); // cos 0.99939
  const f = bugAt(w, 4.5, 40); // cos 0.99692: 0.00247 below, not a tie
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), e, 'clearly better aligned: farther but wins');
  w.enemies.reverse();
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), e, 'same answer with the list reversed');
  assert.ok(f);
});

test('assist: a zero or broken stick direction, and a bug on top of Clawd, give no target', () => {
  const { CB, w, p } = setup();
  const e = bugAt(w, 0, 50);
  assert.equal(CB.Player.assistTarget(w, p, 0, 0), null);
  assert.equal(CB.Player.assistTarget(w, p, NaN, 1), null);
  assert.equal(CB.Player.assistTarget(w, p, 1, undefined), null);
  e.dead = true;
  w.spawnEnemy('dummy', p.x, p.y); // exactly on Clawd: there is no direction to it
  assert.equal(CB.Player.assistTarget(w, p, 1, 0), null);
});

// ---- the aim point from a stick -----------------------------------------------------------------------------

test('stick aim: the aim point is 48 px out along the stick, from where Clawd stands', () => {
  const { CB, w, p } = setup();
  H.stepN(w, 1, () => stick(0, -1));
  assert.ok(near(p.aimX, p.x) && near(p.aimY, p.y - 48), `${p.aimX},${p.aimY}`);
  assert.equal(p.aimStick, true);
  H.stepN(w, 1, () => stick(-0.6, 0.8));
  assert.ok(near(p.aimX, p.x - 28.8) && near(p.aimY, p.y + 38.4));
  assert.equal(p.facing, -1, 'Clawd faces the stick');
  H.stepN(w, 1, () => stick(1, 0));
  assert.equal(p.facing, 1);
  H.stepN(w, 1, () => stick(3, 4)); // not unit: still 48 px
  assert.ok(near(Math.hypot(p.aimX - p.x, p.aimY - p.y), 48));
  assert.ok(near(p.aimX, p.x + 28.8) && near(p.aimY, p.y + 38.4));
  assert.ok(CB.Player.AIM_R === 48);
});

test('stick aim: a mouse input has no aimDir, aims at the point, and flags aimStick false', () => {
  const { w, p } = setup();
  H.stepN(w, 1, () => stick(0, -1));
  assert.equal(p.aimStick, true);
  H.stepN(w, 1, () => H.makeInput({ aimX: 250, aimY: 30 }));
  assert.equal(p.aimX, 250);
  assert.equal(p.aimY, 30);
  assert.equal(p.aimStick, false, 'the flag follows the input every tick');
  assert.equal(w.player.aimStick, false);
});

test('stick aim: null, zero, half-missing and non-finite directions fall back to the mouse point', () => {
  const { w, p } = setup();
  const bads = [
    { aimDirX: null, aimDirY: null },
    { aimDirX: undefined, aimDirY: undefined },
    { aimDirX: 0, aimDirY: 0 },
    { aimDirX: 1, aimDirY: null },
    { aimDirX: null, aimDirY: 1 },
    { aimDirX: NaN, aimDirY: 1 },
    { aimDirX: 1, aimDirY: Infinity },
    { aimDirX: '1', aimDirY: '0' },
  ];
  for (const bad of bads) {
    H.stepN(w, 1, () => H.makeInput(Object.assign({ aimX: 222, aimY: 44, aimAssist: bad.aimDirX != null }, bad)));
    assert.equal(p.aimX, 222, JSON.stringify(bad));
    assert.equal(p.aimY, 44);
    assert.equal(p.aimStick, false);
  }
});

test('stick aim: the aim point follows Clawd as she moves, so the shot goes exactly along the stick', () => {
  const { w, p } = setup();
  H.stepN(w, 1, () => stick(0, -1, { moveX: 1, fire: true }));
  assert.ok(p.x > 100, 'she moved');
  assert.ok(near(p.aimX, p.x) && near(p.aimY, p.y - 48), 'anchored on the new position');
  const b = w.pBullets[w.pBullets.length - 1];
  assert.ok(near(b.vx, 0, 1e-6) && b.vy < 0, 'a straight-up bolt');
});

test('stick aim: an idle stick never snaps; neither does a firing one with the assist flag off', () => {
  const { w, p } = setup();
  const e = bugAt(w, 6, 90);
  H.stepN(w, 1, () => stick(1, 0, { fire: false }));
  assert.ok(near(p.aimX, p.x + 48) && near(p.aimY, p.y), 'idle: passing bugs do not pull the crosshair');
  H.stepN(w, 1, () => stick(1, 0, { fire: true, aimAssist: false }));
  assert.ok(near(p.aimX, p.x + 48) && near(p.aimY, p.y), 'assist off');
  H.stepN(w, 1, () => stick(1, 0, { fire: true, aimAssist: undefined }));
  assert.ok(near(p.aimX, p.x + 48) && near(p.aimY, p.y), 'assist flag missing');
  assert.ok(e);
});

test('stick aim: a firing stick with the assist flag snaps onto the bug and the bolt flies at it', () => {
  const { w, p } = setup();
  const e = bugAt(w, 7, 100);
  H.stepN(w, 1, () => stick(1, 0, { fire: true }));
  assert.equal(p.aimX, e.x);
  assert.equal(p.aimY, e.y);
  assert.equal(p.aimStick, true);
  const b = w.pBullets[0];
  const want = Math.atan2(e.y - p.y, e.x - p.x);
  assert.ok(near(Math.atan2(b.vy, b.vx), want, 1e-9), 'the bolt goes at the bug, not along the stick');
  assert.ok(near(w.stats.shots, 1));
  // let go of fire: the aim goes back to 48 px along the stick
  H.stepN(w, 1, () => stick(1, 0, { fire: false }));
  assert.ok(near(p.aimX, p.x + 48) && near(p.aimY, p.y));
});

test('stick aim: the snap is gone when the bug leaves the cone, range or targetable state', () => {
  const { w, p } = setup();
  const e = bugAt(w, 7, 100);
  const fire = () => stick(1, 0, { fire: true });
  H.stepN(w, 1, fire);
  assert.equal(p.aimX, e.x);
  e.targetable = false;
  H.stepN(w, 1, fire);
  assert.ok(near(p.aimX, p.x + 48), 'a bug that cannot be hit is not chased');
  e.targetable = true;
  e.x = p.x + 150;
  e.y = p.y;
  H.stepN(w, 1, fire);
  assert.ok(near(p.aimX, p.x + 48), 'out of range');
  e.x = p.x + 100;
  e.y = p.y + 40;
  H.stepN(w, 1, fire);
  assert.ok(near(p.aimX, p.x + 48), '22 degrees off');
});

test('stick aim: the mouse is never assisted, even with the flags set and a bug right next to the pointer', () => {
  const { w, p } = setup();
  const e = bugAt(w, 4, 100);
  H.stepN(w, 1, () => H.makeInput({ aimX: p.x + 100, aimY: p.y, fire: true, aimAssist: true }));
  assert.equal(p.aimX, p.x + 100, 'the pointer stays where it is');
  assert.equal(p.aimY, p.y);
  const b = w.pBullets[0];
  assert.ok(near(Math.atan2(b.vy, b.vx), 0, 1e-9), 'the bolt follows the pointer');
  assert.ok(e);
});

test('stick aim: a boss part dead ahead is never assisted, and does not block a regular bug in the cone', () => {
  const { w, p } = setup();
  const boss = bugAt(w, 0, 60, { boss: true, regular: false });
  H.stepN(w, 1, () => stick(1, 0, { fire: true }));
  assert.ok(near(p.aimX, p.x + 48) && near(p.aimY, p.y), 'only the stick');
  const bug = bugAt(w, 8, 120);
  H.stepN(w, 1, () => stick(1, 0, { fire: true }));
  assert.equal(p.aimX, bug.x, 'the regular bug is still found');
  assert.ok(boss);
});

test('stick aim: with no move input a dash goes along the stick', () => {
  const { w, p } = setup();
  H.stepN(w, 1, () => stick(0, 1, { dash: true }));
  assert.ok(near(p.dashDX, 0) && near(p.dashDY, 1), `${p.dashDX},${p.dashDY}`);
});

test('stick aim: a dead Clawd keeps the last flag and cannot be aimed', () => {
  const { w, p } = setup();
  p.dead = true;
  const x = p.aimX;
  H.stepN(w, 1, () => stick(1, 0, { fire: true }));
  assert.equal(p.aimX, x, 'a dead player does not aim or shoot');
  assert.equal(w.stats.shots, 0);
});

test('stick aim: a new player is not aiming by stick', () => {
  const { w } = setup();
  assert.equal(w.player.aimStick, false);
});

// ---- per-boss exclusions --------------------------------------------------------------------------------------

function bossWorld(id) {
  const CB = H.load([...H.GAME_BASE, ...BOSS_FILES]);
  CB.Enemies.dummy = { create: (w, x, y, op) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 1000, r: 5, contact: false }, op || {})), update() {}, draw() {} };
  const w = CB.createWorld({ seed: 5, god: true });
  w.boss = CB.Bosses[id].create(w);
  w.player.x = 160;
  w.player.y = 150;
  H.stepN(w, 100, () => H.makeInput({ aimX: 160, aimY: 20 }));
  return { CB, w };
}

for (const id of ['heisenbug', 'infiniteLoop', 'memoryLeakBoss', 'mergeConflict']) {
  test(`assist: ${id} -- no body, segment, twin, blob or decoy is ever a target, and a bug beside it still is`, () => {
    const { CB, w } = bossWorld(id);
    if (id === 'heisenbug') {
      w.spawnEnemy('heisenDecoy', 60, 60); // what the controller does every blink in phase 2
      w.spawnEnemy('heisenDecoy', 260, 60);
    }
    const parts = w.enemies.filter((e) => !e.dead && (e.boss || !e.regular));
    assert.ok(parts.length >= 1, 'the fight has parts');
    assert.ok(parts.some((e) => e.targetable && e.visible), 'at least one part is hittable, so the exclusion is by the flag, not by luck');
    for (const e of parts) {
      assert.equal(e.boss, true, `${e.kind} is boss-flagged`);
      assert.equal(e.regular, false, `${e.kind} is not regular`);
    }
    const p = w.player;
    for (const e of w.enemies) {
      if (e.dead) continue;
      p.x = e.x - 40;
      p.y = e.y;
      assert.equal(CB.Player.assistTarget(w, p, 1, 0), null, `${e.kind} straight ahead 40 px away`);
      p.x = e.x - 8;
      assert.equal(CB.Player.assistTarget(w, p, 1, 0), null, `${e.kind} 8 px away`);
    }
    // end to end: a firing assisted stick aimed straight at the first hittable part keeps its 48 px aim point
    const target = parts.find((e) => e.targetable && e.visible);
    p.x = Math.max(20, target.x - 60);
    p.y = target.y;
    const d = Math.hypot(target.x - p.x, target.y - p.y);
    H.stepN(w, 1, () => stick((target.x - p.x) / d, (target.y - p.y) / d, { fire: true }));
    assert.equal(p.aimStick, true);
    assert.ok(near(Math.hypot(p.aimX - p.x, p.aimY - p.y), 48, 1e-6), `${id}: the stick keeps its 48 px aim point`);
    // a regular bug in the cone is still assisted next to the fight
    const dir = target.x - 90 >= 20 ? 1 : -1;
    p.x = target.x - dir * 90;
    p.y = target.y;
    const bug = w.spawnEnemy('dummy', target.x - dir * 30, target.y + 3); // between Clawd and the boss part
    assert.equal(CB.Player.assistTarget(w, p, dir, 0), bug, 'the ordinary bug is found with the boss part right behind it');
    bug.x = target.x + dir * 20; // and past the part: the part dead ahead does not hide it
    assert.equal(CB.Player.assistTarget(w, p, dir, 0), bug, 'or beyond it');
  });
}

// ---- bot-style and mouse inputs are unchanged -----------------------------------------------------------------

test('unchanged: inputs without the new fields and inputs with them neutral drive the same world', () => {
  const NEUTRAL_FIELDS = { device: 'kbm', aimDirX: null, aimDirY: null, aimAssist: false, navX: 0, navY: 0, tap: false, pad: null };
  const runWith = (extra) => {
    const CB = H.load();
    const run = CB.createRun({ seed: 7, startStage: 1, god: true });
    const bot = makeBot({});
    for (let i = 0; i < 1500; i++) run.step(Object.assign(bot(run), extra));
    const w = run.world;
    return { px: w.player.x, py: w.player.y, shots: w.stats.shots, kills: w.stats.kills, dmg: w.stats.damageDealt, state: run.state, bolts: w.pBullets.length, enemies: w.enemies.length };
  };
  assert.deepEqual(runWith({}), runWith(NEUTRAL_FIELDS));
});

// Fingerprints of bot replays taken with the pre-T4a player.js and heisenbug.js. A mouse- or bot-driven sim must stay bit-identical:
// update these only when the simulation is changed on purpose.
const GOLDEN = [
  { seed: 7, stage: 0, ticks: 2400, state: 'boss', px: '239.860836', py: '110.125396', shots: 200, kills: 15, dmg: '137.000000', compacts: 2 },
  { seed: 3, stage: 1, ticks: 2400, state: 'boss', px: '135.896520', py: '98.806459', shots: 200, kills: 38, dmg: '153.000000', compacts: 2 },
  { seed: 5, stage: 2, ticks: 3000, state: 'boss', px: '204.494971', py: '66.380624', shots: 250, kills: 19, dmg: '197.000000', compacts: 3 },
  { seed: 11, stage: 3, ticks: 3600, state: 'boss', px: '145.664670', py: '58.026885', shots: 300, kills: 32, dmg: '184.000000', compacts: 2 },
];
for (const g of GOLDEN) {
  test(`unchanged: the bot replay of seed ${g.seed} stage ${g.stage + 1} matches the pre-stick-aim simulation exactly`, () => {
    const CB = H.load();
    const run = CB.createRun({ seed: g.seed, startStage: g.stage, god: true });
    const bot = makeBot({});
    for (let i = 0; i < g.ticks; i++) run.step(bot(run));
    const w = run.world;
    const p = w.player;
    assert.deepEqual(
      { state: run.state, px: p.x.toFixed(6), py: p.y.toFixed(6), shots: w.stats.shots, kills: w.stats.kills, dmg: w.stats.damageDealt.toFixed(6), compacts: w.stats.compacts },
      { state: g.state, px: g.px, py: g.py, shots: g.shots, kills: g.kills, dmg: g.dmg, compacts: g.compacts }
    );
    assert.equal(p.aimStick, false, 'a bot never aims by stick');
  });
}
