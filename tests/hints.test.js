'use strict';
// CB.Hints (src/game/hints.js): the four first-run tips (dash, /compact, perfect dash, the Heisenbug's moths). Triggers, once-only storage under 'hints'
// (and what happens when storage fails or is missing), the wave / boss / unpaused / not-debug gates, the queue, the 3 s life with its fade, the
// device-aware strings, the banner's place on the screen (clear of the HUD, the /compact banner, the touch pause button and the wave text), calm mode,
// and the play scene's wiring. The module is presentation only, so one test also runs the same seeded run with and without it.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const ENEMIES = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne'].map((k) => 'src/game/enemies/' + k + '.js');
const BOSSES = ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug'].map((k) => 'src/game/bosses/' + k + '.js');
const BASE = [
  ...H.GAME_BASE, 'src/art/font.js', 'src/art/render.js', 'src/core/prompts.js', 'src/game/unlocks.js', 'src/game/comfort.js', 'src/game/compact.js',
  'src/game/pickups.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', ...ENEMIES, ...BOSSES, 'src/core/touch.js',
  'src/scenes/hud.js', 'src/scenes/screens.js',
];
const FILES = [...BASE, 'src/game/hints.js'];
const DEVICES = ['kbm', 'touch', 'pad'];
const IDS = ['dash', 'compact', 'perfect', 'look'];
const KEY = { dash: 'hintDash', compact: 'hintCompact', perfect: 'hintPerfect', look: 'hintLook' };
const LIVE = ['wave', 'boss'];
const NOT_LIVE = ['stageIntro', 'waveBreak', 'bossWarn', 'bossDead', 'patchPick', 'dying', 'dead', 'victory'];
const GAME = { debug: { speed: 1 } }; // what a real (non-debug) host passes
const COMPACT_READY = { type: 'compactReady', x: 100, y: 100 };
const PERFECT = { type: 'graze', x: 100, y: 100, perfect: true };
const OPTIMIZED = { type: 'text', x: 100, y: 100, text: '<optimized out>', color: '#888888' };

function memStorage(seed) {
  const mem = Object.assign({}, seed || {});
  return {
    mem,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = String(v);
    },
  };
}

// A storage that refuses everything, the way a blocked or full one does.
const brokenStorage = () => ({
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('quota');
  },
});

// opts: files (script list), storage, seen (ids already seen, written as the saved list), device.
function env(opts) {
  const o = opts || {};
  const storage = o.storage || memStorage(o.seen ? { 'cb.hints': JSON.stringify(o.seen) } : {});
  const { CB, sandbox } = H.load(o.files || FILES, { returnSandbox: true, localStorage: storage });
  if (CB.Prompts) CB.Prompts.setDevice(o.device || 'kbm');
  return { CB, sandbox, storage, Hints: CB.Hints };
}

// A real run (so the world, the player and the stage are real) put in a state by hand; unit tests never step it.
function runAt(CB, state, stateT, over) {
  const run = CB.createRun({ seed: 1, startStage: (over && over.startStage) || 0 });
  run.state = state;
  run.stateT = stateT == null ? 5 : stateT;
  run.world.eBullets.length = 0;
  return run;
}

// Calls onEvents n times: the events on the first call, none after.
function tick(e, run, n, evs, game) {
  for (let i = 0; i < (n || 1); i++) e.Hints.onEvents(i === 0 ? evs || [] : [], run, game || GAME);
}

const seenList = (e) => JSON.parse(e.storage.mem['cb.hints'] || '[]');
const shownId = (e) => (e.Hints.current() ? e.Hints.current().id : null);

// A bullet the given distance from Clawd, flying at her (speed > 0), away from her (< 0) or past her (sideways: true).
function bulletAt(run, dist, speed, sideways) {
  const p = run.world.player;
  const b = { x: p.x + dist, y: p.y, vx: sideways ? 0 : -speed, vy: sideways ? speed : 0, r: 2, dead: false };
  run.world.eBullets.push(b);
  return b;
}

// ---- drawing helpers ----------------------------------------------------------------------------------------------------------

function renderer(e) {
  const r = e.CB.createRenderer(e.sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const rec = H.recorder(r, e.CB);
  const log = [];
  for (const k of ['alpha', 'rect', 'frame', 'text']) {
    const orig = r[k];
    r[k] = function (...a) {
      log.push([k, ...a]);
      return orig.apply(this, a);
    };
  }
  const clear = () => {
    rec.clear();
    log.length = 0;
  };
  return { r, rec, log, clear };
}

// What one Hints.draw put on the screen: its ink box, gold frame, gold text and the alpha each was drawn at.
function shot(log) {
  const rect = log.find((l) => l[0] === 'rect');
  const frame = log.find((l) => l[0] === 'frame');
  const text = log.find((l) => l[0] === 'text');
  const alphas = log.filter((l) => l[0] === 'alpha').map((l) => l[1]);
  if (!rect && !frame && !text) return null;
  return { rect, frame, text, alphas, box: rect ? { x: rect[1], y: rect[2], w: rect[3], h: rect[4] } : null };
}

const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const fadeOf = (t) => Math.max(0, Math.min(1, t / 0.25, (3 - t) / 0.5)); // the spec'd fade: in over 0.25 s, out over the last 0.5 s of 3 s

// ---- the module ---------------------------------------------------------------------------------------------------------------

test('hints: CB.Hints exposes the four ids and the entry points the play scene calls', () => {
  const { Hints } = env();
  assert.deepEqual(Array.from(Hints.IDS), IDS);
  for (const k of ['onEvents', 'draw', 'box', 'current', 'pending', 'reset']) assert.equal(typeof Hints[k], 'function', k);
  assert.equal(Hints.SHOW_T, 3, 'a hint stays up for 3 s');
  assert.equal(Hints.NEAR, 48);
  assert.equal(Hints.LOOK_AT, 2.6);
  assert.equal(Hints.current(), null);
  assert.deepEqual(Hints.pending(), []);
});

test('hints: junk in, nothing out (no run, no world, junk events)', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  assert.doesNotThrow(() => {
    e.Hints.onEvents(null, null);
    e.Hints.onEvents(undefined, undefined, undefined);
    e.Hints.onEvents([], {});
    e.Hints.onEvents([COMPACT_READY], { state: 'wave', world: null });
    e.Hints.onEvents('compactReady', run, GAME);
    e.Hints.onEvents([null, undefined, 3, 'x', {}, { type: 5 }, { type: 'graze' }, { type: 'text' }], run, GAME);
    e.Hints.onEvents([COMPACT_READY], run, null);
  });
  assert.equal(shownId(e), 'compact', 'the one real event in all that did its job');
});

test('hints: draw with no run ever seen draws nothing and does not throw', () => {
  const e = env();
  const g = renderer(e);
  assert.doesNotThrow(() => e.Hints.draw(g.r, 0));
  assert.equal(g.log.length, 0);
});

// ---- triggers -----------------------------------------------------------------------------------------------------------------

test('hints: dash fires the first time an enemy bullet within 48 px is heading at Clawd, and not for anything else', () => {
  const cases = [
    ['a bullet 30 px away flying at her', (run) => bulletAt(run, 30, 80), true],
    ['exactly 48 px away', (run) => bulletAt(run, 48, 80), true],
    ['48.5 px away', (run) => bulletAt(run, 48.5, 80), false],
    ['100 px away', (run) => bulletAt(run, 100, 80), false],
    ['30 px away flying away from her', (run) => bulletAt(run, 30, -80), false],
    ['30 px away flying past her (sideways)', (run) => bulletAt(run, 30, 80, true), false],
    ['30 px away, not moving', (run) => bulletAt(run, 30, 0), false],
    ['a dead bullet', (run) => Object.assign(bulletAt(run, 30, 80), { dead: true }), false],
    ['no bullet at all', () => null, false],
  ];
  for (const [name, setup, expected] of cases) {
    const e = env();
    const run = runAt(e.CB, 'wave');
    setup(run);
    tick(e, run, 1);
    assert.equal(shownId(e), expected ? 'dash' : null, name);
  }
});

test('hints: dash looks at bullets over the whole screen, not just the first one, and needs Clawd alive', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  bulletAt(run, 200, 80);
  bulletAt(run, 30, -80);
  tick(e, run, 3);
  assert.equal(shownId(e), null, 'a far one and one flying away');
  bulletAt(run, 20, 80);
  tick(e, run, 1);
  assert.equal(shownId(e), 'dash', 'the third bullet is the one');
  const e2 = env();
  const dead = runAt(e2.CB, 'wave');
  bulletAt(dead, 20, 80);
  dead.world.player.dead = true;
  tick(e2, dead, 3);
  assert.equal(shownId(e2), null, 'a dead Clawd needs no tip');
});

test('hints: dash works in the boss state too', () => {
  const e = env();
  const run = runAt(e.CB, 'boss', 1);
  bulletAt(run, 24, 60);
  tick(e, run, 1);
  assert.equal(shownId(e), 'dash');
});

test('hints: compact fires on the first compactReady event, and only on that event', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 2, [{ type: 'hit', x: 1, y: 1 }, { type: 'pickup', x: 1, y: 1 }, { type: 'compactready' }]);
  assert.equal(shownId(e), null, 'other events are not the meter filling');
  tick(e, run, 1, [COMPACT_READY]);
  assert.equal(shownId(e), 'compact');
});

test('hints: compact fires from the real meter filling (CB.Compact.charge) and from the real boss-fight fill', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  const w = run.world;
  e.CB.Compact.charge(w, 10);
  tick(e, run, 1, w.events.splice(0));
  assert.equal(shownId(e), null, 'a part-full meter says nothing');
  e.CB.Compact.charge(w, 45);
  const evs = w.events.splice(0);
  assert.ok(evs.some((x) => x.type === 'compactReady'));
  tick(e, run, 1, evs);
  assert.equal(shownId(e), 'compact');
  const f = env();
  const run2 = runAt(f.CB, 'wave');
  f.CB.Compact.fill(run2.world);
  tick(f, run2, 1, run2.world.events.splice(0));
  assert.equal(shownId(f), 'compact', 'Compact.fill is what opens every boss fight');
});

test('hints: perfect fires on a perfect graze and on nothing else', () => {
  for (const [name, ev, expected] of [
    ['a perfect graze', PERFECT, true],
    ['a graze that is not perfect', { type: 'graze', x: 1, y: 1, perfect: false }, false],
    ['a graze with no flag', { type: 'graze', x: 1, y: 1 }, false],
    ['perfect: "true" (a string)', { type: 'graze', perfect: 'true' }, false],
    ['the floating "perfect" text alone', { type: 'text', x: 1, y: 1, text: 'perfect' }, false],
    ['a dash', { type: 'dash', x: 1, y: 1 }, false],
  ]) {
    const e = env();
    tick(e, runAt(e.CB, 'wave'), 1, [ev]);
    assert.equal(shownId(e), expected ? 'perfect' : null, name);
  }
});

test('hints: perfect fires from the real thing (CB.Compact.perfect on a dash-protected bullet)', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  const w = run.world;
  e.CB.Compact.perfect(w, { x: w.player.x + 3, y: w.player.y, grazed: false });
  const evs = w.events.splice(0);
  assert.ok(evs.some((x) => x.type === 'graze' && x.perfect === true));
  tick(e, run, 1, evs);
  assert.equal(shownId(e), 'perfect');
});

test('hints: look fires 2.6 s into the Heisenbug fight, not before, and not in any other boss fight', () => {
  const e = env({ seen: ['compact'] }); // Compact.fill opens every fight with a compactReady; this player has had that tip
  const run = runAt(e.CB, 'boss', 0, { startStage: 3 });
  assert.equal(run.world.stage.boss, 'heisenbug');
  run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
  let first = null;
  for (let i = 0; i < 200 && !first; i++) {
    run.stateT = i / 60;
    tick(e, run, 1);
    if (shownId(e) === 'look') first = run.stateT;
  }
  assert.ok(first !== null, 'it fired');
  assert.ok(first >= 2.6 && first < 2.6 + 1 / 60 + 1e-9, 'at 2.6 s, to the step: ' + first);

  const other = env({ seen: ['compact'] });
  const run2 = runAt(other.CB, 'boss', 5, { startStage: 0 });
  run2.world.boss = other.CB.Bosses.infiniteLoop.create(run2.world);
  tick(other, run2, 5);
  assert.equal(shownId(other), null, 'the Infinite Loop has no moths');
});

test('hints: look is for the Heisenbug fight in the boss state only, and ends with the boss', () => {
  const stageBoss = (state, t, mut) => {
    const e = env({ seen: ['compact'] });
    const run = runAt(e.CB, state, t, { startStage: 3 });
    run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
    if (mut) mut(run);
    tick(e, run, 3);
    return shownId(e);
  };
  assert.equal(stageBoss('boss', 2.59), null, 'just under 2.6 s');
  assert.equal(stageBoss('boss', 2.6), 'look');
  assert.equal(stageBoss('boss', 20), 'look', 'late is fine too');
  for (const state of ['wave', 'bossWarn', 'bossDead']) assert.equal(stageBoss(state, 20), null, state);
  assert.equal(stageBoss('boss', 20, (run) => (run.world.boss.defeated = true)), null, 'a beaten boss');
  assert.equal(stageBoss('boss', 20, (run) => (run.world.boss = null)), null, 'no boss');
});

test('hints: look comes sooner on the first <optimized out> pop, and only for that text', () => {
  const e = env({ seen: ['compact'] });
  const run = runAt(e.CB, 'boss', 0.4, { startStage: 3 });
  run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
  tick(e, run, 3, [{ type: 'text', x: 1, y: 1, text: 'perfect' }, { type: 'text', x: 1, y: 1, text: '<optimized' }]);
  assert.equal(shownId(e), null, 'other floating text');
  tick(e, run, 1, [OPTIMIZED]);
  assert.equal(shownId(e), 'look', '0.4 s in, the first pop is enough');
});

test('hints: doing the thing retires the hint for good, on show or not yet shown', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 2, [COMPACT_READY]);
  assert.equal(shownId(e), 'compact');
  tick(e, run, 1, [{ type: 'compact', x: 1, y: 1 }]);
  assert.equal(shownId(e), null, 'cast while it is up: gone');
  assert.deepEqual(seenList(e), ['compact']);
  tick(e, run, 1, [COMPACT_READY]);
  tick(e, run, 300);
  assert.equal(shownId(e), null, 'and it does not come back');

  const f = env();
  const run2 = runAt(f.CB, 'wave');
  tick(f, run2, 1, [{ type: 'dash', x: 1, y: 1 }]);
  bulletAt(run2, 20, 80);
  tick(f, run2, 5);
  assert.equal(shownId(f), null, 'she dashed before any bullet came: no dash tip');
  assert.deepEqual(seenList(f), ['dash']);

  const g = env();
  const run3 = runAt(g.CB, 'wave');
  tick(g, run3, 1, [PERFECT, COMPACT_READY]);
  assert.equal(shownId(g), 'perfect');
  assert.deepEqual(g.Hints.pending(), ['compact']);
  tick(g, run3, 1, [{ type: 'compact' }]);
  assert.deepEqual(g.Hints.pending(), [], 'a waiting tip she no longer needs is dropped');
  assert.equal(shownId(g), 'perfect', 'the one on show is another tip and stays');
});

// ---- once only, through CB.Save -----------------------------------------------------------------------------------------------

test('hints: a hint is written to cb.hints as an array of ids when it starts, and each one only once', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  assert.equal(e.storage.mem['cb.hints'], undefined);
  tick(e, run, 1, [COMPACT_READY]);
  assert.equal(e.storage.mem['cb.hints'], '["compact"]');
  tick(e, run, 400, [COMPACT_READY]);
  assert.equal(shownId(e), null);
  assert.deepEqual(seenList(e), ['compact'], 'asked for again, not shown again, not written twice');
  tick(e, run, 1, [PERFECT]);
  assert.deepEqual(seenList(e), ['compact', 'perfect'], 'the next one is added to the list');
  assert.equal(e.CB.Save.get('hints', null).length, 2);
});

test('hints: a hint already in the saved list never shows', () => {
  for (const id of IDS) {
    const e = env({ seen: [id] });
    const run = runAt(e.CB, 'boss', 5, { startStage: 3 });
    run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
    bulletAt(run, 20, 80);
    tick(e, run, 1, [COMPACT_READY, PERFECT, OPTIMIZED]);
    const shown = [shownId(e)].concat(e.Hints.pending());
    assert.ok(!shown.includes(id), id + ' was already seen: ' + JSON.stringify(shown));
    assert.equal(shown.length, 3, 'the other three are still on their way');
  }
  const all = env({ seen: IDS });
  const run = runAt(all.CB, 'boss', 5, { startStage: 3 });
  run.world.boss = all.CB.Bosses.heisenbug.create(run.world);
  bulletAt(run, 20, 80);
  tick(all, run, 400, [COMPACT_READY, PERFECT, OPTIMIZED]);
  assert.equal(shownId(all), null, 'a player who has seen them all sees none');
  assert.deepEqual(all.Hints.pending(), []);
});

test('hints: a hint on the way is not marked seen until it starts', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [COMPACT_READY, PERFECT]);
  assert.equal(shownId(e), 'compact');
  assert.deepEqual(e.Hints.pending(), ['perfect']);
  assert.deepEqual(seenList(e), ['compact'], 'perfect still waits and is not on the list');
});

test('hints: saved junk is tolerated and kept clear of the list that gets written back', () => {
  for (const [raw, expected] of [
    ['not json', ['compact']],
    ['{"a":1}', ['compact']],
    ['"compact"', ['compact']],
    ['null', ['compact']],
    ['7', ['compact']],
    ['[1,null,"dash",{"x":1}]', ['dash', 'compact']],
  ]) {
    const e = env({ storage: memStorage({ 'cb.hints': raw }) });
    tick(e, runAt(e.CB, 'wave'), 1, [COMPACT_READY]);
    assert.equal(shownId(e), 'compact', raw);
    assert.deepEqual(seenList(e), expected, raw);
  }
});

test('hints: storage that throws still gives once per session (CB.Save keeps its own copy)', () => {
  const e = env({ storage: brokenStorage() });
  const run = runAt(e.CB, 'wave');
  assert.doesNotThrow(() => tick(e, run, 1, [COMPACT_READY]));
  assert.equal(shownId(e), 'compact');
  tick(e, run, 400);
  assert.equal(shownId(e), null);
  tick(e, run, 1, [COMPACT_READY]);
  tick(e, run, 400);
  assert.equal(shownId(e), null, 'asked for again: not shown a second time this session');
  assert.deepEqual(Array.from(e.CB.Save.get('hints', [])), ['compact']);
  tick(e, run, 1, [PERFECT]);
  assert.equal(shownId(e), 'perfect', 'and the other hints still work');
});

test('hints: without CB.Save (unlocks.js missing) the list is kept for the session', () => {
  const files = FILES.filter((f) => f !== 'src/game/unlocks.js');
  const e = env({ files });
  assert.equal(e.CB.Save, undefined);
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [COMPACT_READY]);
  assert.equal(shownId(e), 'compact');
  tick(e, run, 400);
  tick(e, run, 1, [COMPACT_READY]);
  tick(e, run, 400);
  assert.equal(shownId(e), null, 'once per session');
  assert.deepEqual(e.storage.mem, {}, 'and nothing went to storage');
  e.Hints.reset();
  tick(e, run, 1, [COMPACT_READY]);
  assert.equal(shownId(e), null, 'reset forgets the queue, not what was seen');
});

test('hints: without CB.Prompts there is nothing to show, and nothing is marked seen', () => {
  const files = FILES.filter((f) => f !== 'src/core/prompts.js');
  const e = env({ files });
  assert.equal(e.CB.Prompts, undefined);
  const run = runAt(e.CB, 'wave');
  tick(e, run, 5, [COMPACT_READY, PERFECT]);
  assert.equal(shownId(e), null);
  assert.deepEqual(e.Hints.pending(), []);
  assert.equal(e.storage.mem['cb.hints'], undefined);
  const g = renderer(e);
  assert.doesNotThrow(() => e.Hints.draw(g.r, 0, run));
  assert.equal(g.log.length, 0);
});

// ---- gates --------------------------------------------------------------------------------------------------------------------

test('hints: nothing shows in a debug run, and nothing is written', () => {
  for (const debug of [{ active: true }, { active: true, startStage: 2, skipWaves: true, god: true }]) {
    const e = env();
    const run = runAt(e.CB, 'boss', 5, { startStage: 3 });
    run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
    bulletAt(run, 20, 80);
    tick(e, run, 300, [COMPACT_READY, PERFECT, OPTIMIZED], { debug });
    assert.equal(shownId(e), null);
    assert.deepEqual(e.Hints.pending(), []);
    assert.equal(e.storage.mem['cb.hints'], undefined);
  }
  for (const game of [GAME, { debug: { active: false } }, { debug: {} }, { debug: null }, {}, undefined]) {
    const e = env();
    tick(e, runAt(e.CB, 'wave'), 1, [COMPACT_READY], game);
    assert.equal(shownId(e), 'compact', 'not a debug run: ' + JSON.stringify(game));
  }
});

test('hints: a hint shows only in the wave and boss states, and waits for them', () => {
  for (const state of LIVE) {
    const e = env();
    tick(e, runAt(e.CB, state), 1, [COMPACT_READY]);
    assert.equal(shownId(e), 'compact', state);
  }
  for (const state of NOT_LIVE) {
    const e = env();
    const run = runAt(e.CB, state);
    bulletAt(run, 20, 80);
    tick(e, run, 300, [COMPACT_READY, PERFECT]);
    assert.equal(shownId(e), null, state);
    assert.deepEqual(e.Hints.pending(), ['compact', 'perfect'], state + ': noted and kept for later (the bullet near her is not noted: it is not a fight)');
    assert.equal(e.storage.mem['cb.hints'], undefined, state + ': not seen until shown');
    run.state = 'wave';
    tick(e, run, 1);
    assert.equal(shownId(e), 'compact', state + ' -> wave: now');
    assert.deepEqual(e.Hints.pending(), ['perfect', 'dash'].filter((id) => e.Hints.pending().includes(id)), state);
  }
});

test('hints: a hint cut short by the wave break or a death goes back to the front of the queue and starts over, fading in, when the fight resumes', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 60, [COMPACT_READY]);
  const t = e.Hints.current().t;
  assert.ok(Math.abs(t - 59 / 60) < 1e-6, String(t));
  run.state = 'bossDead';
  tick(e, run, 500);
  assert.equal(e.Hints.current(), null, 'not left frozen mid-sentence: it is taken off the screen');
  assert.deepEqual(e.Hints.pending(), ['compact'], 'and waits for the fight to come back');
  const g = renderer(e);
  e.Hints.draw(g.r, 1, run);
  assert.equal(g.log.length, 0, 'and not drawn there');
  assert.deepEqual(seenList(e), ['compact'], 'seen was marked when it started: the once-only storage is unchanged');
  run.state = 'boss';
  tick(e, run, 1);
  assert.equal(shownId(e), 'compact', 'back on show');
  assert.equal(e.Hints.current().t, 0, 'restarted from the top, not where it left off (' + t + ')');
  g.clear();
  e.Hints.draw(g.r, 1, run);
  assert.equal(g.log.length, 0, 'invisible at t = 0: it fades in');
  tick(e, run, 1);
  assert.ok(Math.abs(e.Hints.current().t - 1 / 60) < 1e-6, 'counting again: ' + e.Hints.current().t);
  g.clear();
  e.Hints.draw(g.r, 1, run);
  const s = shot(g.log);
  assert.ok(s, 'drawn on its first frame back');
  assert.ok(s.alphas[1] < 0.1 && s.alphas[1] > 0, 'fading in, not popping back at full brightness: ' + s.alphas[1]);
  assert.deepEqual(e.Hints.pending(), [], 'and no longer waiting');
  assert.deepEqual(seenList(e), ['compact'], 'still one entry');
});

test('hints: a hint cut short keeps its place ahead of the ones queued behind it, and a death gets the same treatment', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 30, [COMPACT_READY, PERFECT]);
  assert.equal(shownId(e), 'compact');
  assert.deepEqual(e.Hints.pending(), ['perfect']);
  run.state = 'dying';
  tick(e, run, 5);
  assert.equal(e.Hints.current(), null);
  assert.deepEqual(e.Hints.pending(), ['compact', 'perfect'], 'the cut-short hint is first in line');
  run.state = 'wave';
  tick(e, run, 1);
  assert.equal(shownId(e), 'compact');
  assert.ok(e.Hints.current().t < 0.1, 'from the top');
  assert.deepEqual(e.Hints.pending(), ['perfect']);
});

test('hints: a new run forgets the queue and the hint on show, never what was seen', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 30, [COMPACT_READY, PERFECT]);
  assert.equal(shownId(e), 'compact');
  assert.deepEqual(e.Hints.pending(), ['perfect']);
  const next = runAt(e.CB, 'wave');
  tick(e, next, 1);
  assert.equal(shownId(e), null);
  assert.deepEqual(e.Hints.pending(), []);
  tick(e, next, 1, [COMPACT_READY]);
  assert.equal(shownId(e), null, 'compact was shown: seen');
  tick(e, next, 1, [PERFECT]);
  assert.equal(shownId(e), 'perfect', 'perfect never got its turn: still new');
});

test('hints: the same run after a retry keeps its queue', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [COMPACT_READY, PERFECT]);
  run.state = 'dying';
  tick(e, run, 100);
  run.state = 'wave';
  tick(e, run, 1);
  assert.equal(shownId(e), 'compact', 'still up, where it left off');
  assert.deepEqual(e.Hints.pending(), ['perfect']);
});

test('hints: reset forgets the queue and the hint on show', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [COMPACT_READY, PERFECT]);
  e.Hints.reset();
  assert.equal(e.Hints.current(), null);
  assert.deepEqual(e.Hints.pending(), []);
});

// ---- the queue and the clock --------------------------------------------------------------------------------------------------

test('hints: one at a time, in the order asked for, 3 s each, with a short gap', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [PERFECT, COMPACT_READY]);
  assert.equal(shownId(e), 'perfect');
  assert.deepEqual(e.Hints.pending(), ['compact']);
  let firstGone = -1;
  let secondStart = -1;
  for (let i = 1; i < 600 && secondStart < 0; i++) {
    tick(e, run, 1);
    if (firstGone < 0 && shownId(e) !== 'perfect') firstGone = i;
    if (secondStart < 0 && shownId(e) === 'compact') secondStart = i;
  }
  assert.ok(firstGone >= 179 && firstGone <= 182, 'the first hint lasts 3 s: step ' + firstGone);
  assert.ok(secondStart - firstGone >= 22 && secondStart - firstGone <= 26, 'a 0.4 s gap before the next: ' + (secondStart - firstGone));
  assert.equal(e.Hints.current().t, 0, 'the next one starts at t = 0');
  assert.deepEqual(e.Hints.pending(), []);
  for (let i = 0; i < 190; i++) tick(e, run, 1);
  assert.equal(shownId(e), null, 'and the second also ends');
});

test('hints: the same hint asked for twice waits once', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [PERFECT, PERFECT]);
  tick(e, run, 1, [COMPACT_READY, COMPACT_READY]);
  tick(e, run, 1, [COMPACT_READY]);
  assert.equal(shownId(e), 'perfect');
  assert.deepEqual(e.Hints.pending(), ['compact']);
});

test('hints: a four-hint pile-up plays out in order and each is seen once', () => {
  const e = env({ seen: [] });
  const run = runAt(e.CB, 'boss', 5, { startStage: 3 });
  run.world.boss = e.CB.Bosses.heisenbug.create(run.world);
  bulletAt(run, 20, 80);
  const order = [];
  tick(e, run, 1, [COMPACT_READY, PERFECT]);
  for (let i = 0; i < 1200; i++) {
    if (shownId(e) && order[order.length - 1] !== shownId(e)) order.push(shownId(e));
    tick(e, run, 1);
  }
  assert.deepEqual(order, ['compact', 'perfect', 'dash', 'look']);
  assert.deepEqual(seenList(e).slice().sort(), IDS.slice().sort());
});

test('hints: the clock stops while the /compact banner hides the hint', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  tick(e, run, 31, [PERFECT]);
  const t = e.Hints.current().t;
  run.world.compactBannerT = 1;
  tick(e, run, 120);
  assert.equal(e.Hints.current().t, t, 'the hint waits under the banner');
  run.world.compactBannerT = 0;
  tick(e, run, 5);
  assert.ok(e.Hints.current().t > t);
});

// ---- the banner on screen -----------------------------------------------------------------------------------------------------

test('hints: the banner is an ink box at 0.8 alpha with a 1 px gold frame and gold text, centred, and it fades in and out', () => {
  const e = env();
  const g = renderer(e);
  const C = e.CB.Pal.C;
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [COMPACT_READY]);
  e.Hints.draw(g.r, 0, run);
  assert.equal(g.log.length, 0, 'invisible at t = 0: it fades in');
  let seen = 0;
  for (let i = 0; i < 200 && e.Hints.current(); i++) {
    const t = e.Hints.current().t;
    g.clear();
    e.Hints.draw(g.r, i / 60, run);
    const s = shot(g.log);
    const a = fadeOf(t);
    if (a <= 0) assert.equal(s, null, 'nothing at alpha 0 (t = ' + t + ')');
    else {
      seen++;
      assert.ok(s, 'drawn at t = ' + t);
      assert.equal(s.rect[5], C.ink);
      assert.equal(s.frame[5], C.gold);
      assert.equal(s.text[1], 'E: /compact clears the screen');
      assert.equal(s.text[4].color, C.gold);
      assert.equal(s.text[4].shadow, undefined);
      assert.ok(Math.abs(s.alphas[0] - a * 0.8) < 1e-9, `the box at ${t}: ${s.alphas[0]} vs ${a * 0.8}`);
      assert.ok(Math.abs(s.alphas[1] - a) < 1e-9, `the frame and text at ${t}`);
      assert.deepEqual([s.frame[1], s.frame[2], s.frame[3], s.frame[4]], [s.rect[1], s.rect[2], s.rect[3], s.rect[4]], 'the frame is the box');
    }
    tick(e, run, 1);
  }
  assert.ok(seen > 170, 'on screen for about 3 s: ' + seen + ' frames');
  g.clear();
  e.Hints.draw(g.r, 4, run);
  assert.equal(g.log.length, 0, 'gone after');
});

test('hints: it is fully opaque from 0.25 s to 2.5 s, rises over the first 0.25 s and falls over the last 0.5 s', () => {
  const e = env();
  const g = renderer(e);
  const run = runAt(e.CB, 'wave');
  tick(e, run, 1, [PERFECT]); // the hint starts at t = 0
  const alphaAt = (steps) => {
    tick(e, run, steps);
    g.clear();
    e.Hints.draw(g.r, 0, run);
    const s = shot(g.log);
    return s ? s.alphas[1] : 0;
  };
  const a1 = alphaAt(4); // t = 0.067
  const a2 = alphaAt(5); // 0.15
  assert.ok(a1 > 0 && a1 < a2 && a2 < 1, `rising: ${a1}, ${a2}`);
  assert.equal(alphaAt(30), 1); // 0.65
  assert.equal(alphaAt(60), 1); // 1.65
  assert.equal(alphaAt(49), 1); // 2.47: just before the fall starts at 2.5
  const f1 = alphaAt(20); // 2.8
  const f2 = alphaAt(5); // 2.88
  assert.ok(f1 < 1 && f1 > f2 && f2 > 0, `falling: ${f1}, ${f2}`);
});

test('hints: the banner dims to 0.3 while Clawd is under it, and is unchanged anywhere else', () => {
  const alphasWith = (px, py, over) => {
    const e = env();
    const g = renderer(e);
    const run = runAt(e.CB, 'wave');
    tick(e, run, 1, [COMPACT_READY]);
    tick(e, run, 30); // t = 0.5: fully faded in
    run.world.player.x = px;
    run.world.player.y = py;
    if (over) Object.assign(run.world.player, over);
    g.clear();
    e.Hints.draw(g.r, 0, run);
    const s = shot(g.log);
    assert.ok(s, 'drawn');
    return { s, box: s.box };
  };
  const away = alphasWith(150, 100);
  assert.ok(Math.abs(away.s.alphas[0] - 0.8) < 1e-9, 'the box at 0.8: ' + away.s.alphas[0]);
  assert.equal(away.s.alphas[1], 1, 'the frame and text at 1');
  const under = alphasWith(150, 25);
  assert.ok(Math.abs(under.s.alphas[0] - 0.8 * 0.3) < 1e-9, 'the box at 0.3 times: ' + under.s.alphas[0]);
  assert.ok(Math.abs(under.s.alphas[1] - 0.3) < 1e-9, 'the frame and text at 0.3 times: ' + under.s.alphas[1]);
  assert.deepEqual(under.box, away.box, 'the banner has not moved');
  const b = away.box;
  // Her sprite spans about x-8..x+8 and y-9..y+3 (the check allows y-10..y+8), so a body one pixel clear of the box is not dimmed and one pixel in is.
  for (const [px, py] of [[b.x - 9, 25], [b.x + b.w + 9, 25], [150, b.y - 9], [150, b.y + b.h + 11]]) {
    const a = alphasWith(px, py);
    assert.ok(Math.abs(a.s.alphas[1] - 1) < 1e-9, `clear of the banner at (${px}, ${py}): ${a.s.alphas[1]}`);
  }
  for (const [px, py] of [[b.x - 7, 25], [b.x + b.w + 7, 25], [150, b.y - 8], [150, b.y + b.h + 9]]) {
    const a = alphasWith(px, py);
    assert.ok(Math.abs(a.s.alphas[1] - 0.3) < 1e-9, `her edge under the banner at (${px}, ${py}): ${a.s.alphas[1]}`);
  }
  const dead = alphasWith(150, 25, { dead: true });
  assert.equal(dead.s.alphas[1], 1, 'a dead Clawd does not dim it');
});

test('hints: the banner has no blink: the same pixels at any t, in calm mode or not', () => {
  for (const calm of [false, true]) {
    const e = env();
    e.CB.Comfort.set(calm);
    assert.equal(e.CB.Comfort.calm(), calm);
    const g = renderer(e);
    const run = runAt(e.CB, 'wave');
    tick(e, run, 60, [COMPACT_READY]);
    const frames = [];
    for (const t of [0, 0.05, 0.11, 0.2, 0.37, 1.01, 5.5]) {
      g.clear();
      e.Hints.draw(g.r, t, run);
      frames.push(JSON.stringify(g.log));
    }
    assert.ok(frames[0].length > 10, 'something is drawn');
    assert.ok(frames.every((f) => f === frames[0]), 'calm=' + calm + ': t does not change the picture');
  }
});

test('hints: the banner is centred, under the HUD strip, and fits the screen, for every hint on every device', () => {
  const e = env();
  const g = renderer(e);
  for (const d of DEVICES) {
    e.CB.Prompts.setDevice(d);
    for (const id of IDS) {
      const text = e.CB.Prompts.text(KEY[id]);
      assert.ok(text, id + '/' + d);
      assert.ok(e.CB.Font.measure(text, 1) <= 300, `${id}/${d} text is ${e.CB.Font.measure(text, 1)} px`);
      const b = e.Hints.box(text, g.r);
      assert.equal(b.w, e.CB.Font.measure(text, 1) + 8, 'a 1 px frame and 3 px air either side');
      assert.equal(b.h, 13, '1 px frame, 2 px air, 7 px glyphs, 2 px air, 1 px frame');
      assert.ok(Math.abs(b.x + b.w / 2 - 160) <= 0.5, `${id}/${d} centred: ${b.x}..${b.x + b.w}`);
      assert.ok(b.x >= 4 && b.x + b.w <= 316, `${id}/${d} on screen`);
      assert.equal(b.y, 21);
      assert.ok(b.y > 15, 'clear of the HUD strip (the boss bar ends at y 15)');
      assert.ok(b.y + b.h <= 40, 'clear of the wave banner (y 40)');
      assert.equal(b.textX, b.x + 4);
      assert.equal(b.textY, b.y + 3);
    }
  }
});

// What a hint is drawn over: the real HUD in a fight, with its text, sprites and rects collected.
function hudScene(e, g, state, startStage, bannerT) {
  const run = runAt(e.CB, state, 4, { startStage: startStage || 0 });
  if (state === 'boss') run.world.boss = e.CB.Bosses[run.world.stage.boss].create(run.world);
  run.world.compactBannerT = bannerT || 0;
  g.clear();
  e.CB.Screens.hud.draw(g.r, run, 4);
  return {
    run,
    texts: g.rec.texts().map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, what: b.str })),
    sprites: g.rec.sprites().map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, what: b.name })),
    rects: g.log.filter((l) => l[0] === 'rect' || l[0] === 'frame').map((l) => ({ x: l[1], y: l[2], w: l[3], h: l[4], what: l[0] })),
  };
}

test('hints: the banner overlaps nothing the HUD draws, in a wave or in each boss fight, on every device', () => {
  for (const [state, stage] of [['wave', 0], ['boss', 0], ['boss', 1], ['boss', 2], ['boss', 3]]) {
    for (const d of DEVICES) {
      const e = env({ device: d });
      const g = renderer(e);
      const hud = hudScene(e, g, state, stage);
      const items = [...hud.texts, ...hud.sprites, ...hud.rects];
      assert.ok(hud.texts.length > 0, 'the HUD drew text');
      if (state === 'boss') assert.ok(hud.rects.some((x) => x.y === 10 && x.w === 140), 'the boss bar is there');
      for (const id of IDS) {
        const b = e.Hints.box(e.CB.Prompts.text(KEY[id]), g.r);
        const clash = items.filter((x) => hit(b, x));
        assert.deepEqual(clash.map((x) => x.what), [], `${id}/${d} over the ${state} HUD (stage ${stage})`);
      }
    }
  }
});

test('hints: the banner does not touch the wave banner (y 40) or the touch pause button (x 296-316, y 22-40)', () => {
  const e = env({ device: 'touch' });
  const g = renderer(e);
  const run = runAt(e.CB, 'wave', 0.1);
  g.clear();
  e.CB.Screens.waveBanner.draw(g.r, run, 0.1);
  const wave = g.rec.texts();
  assert.ok(wave.length > 0 && wave.some((b) => /^WAVE/.test(b.str)), 'the wave text is up in the first 1.2 s');
  const pause = e.CB.Touch.PAUSE;
  assert.deepEqual([pause.x, pause.y, pause.w, pause.h], [296, 22, 20, 18]);
  for (const d of DEVICES) {
    e.CB.Prompts.setDevice(d);
    for (const id of IDS) {
      const b = e.Hints.box(e.CB.Prompts.text(KEY[id]), g.r);
      assert.equal(hit(b, pause), false, `${id}/${d} vs the pause button (the box ends at x ${b.x + b.w})`);
      assert.ok(b.x + b.w < pause.x - e.CB.Touch.HIT_PAD, `${id}/${d} also stays out of the button's touch margin`);
      for (const w of wave) assert.equal(hit(b, w), false, `${id}/${d} vs ${w.str}`);
    }
  }
});

test('hints: while the /compact banner shows (y 22) the hint is not drawn; when it ends the hint is back', () => {
  const e = env();
  const g = renderer(e);
  const hud = hudScene(e, g, 'wave', 0, 0.6);
  const banner = hud.texts.find((t) => t.what === 'Compacting conversation...');
  assert.ok(banner, 'the HUD drew the banner');
  assert.equal(banner.y, 22);
  const run = hud.run;
  run.world.compactBannerT = 0; // a perfect dash, a moment later a cast
  tick(e, run, 40, [PERFECT]);
  g.clear();
  e.Hints.draw(g.r, 1, run);
  const before = shot(g.log);
  assert.ok(before, 'the hint is up');
  assert.ok(hit(before.box, banner), 'it shares the row with the banner, which is why it gives way');
  run.world.compactBannerT = 0.6;
  g.clear();
  e.Hints.draw(g.r, 1, run);
  assert.equal(g.log.length, 0, 'banner up: no hint');
  run.world.compactBannerT = 0;
  g.clear();
  e.Hints.draw(g.r, 1, run);
  assert.ok(shot(g.log), 'banner gone: the hint is back');
});

test('hints: the text follows the device in use, switching mid-hint', () => {
  const e = env();
  const g = renderer(e);
  const run = runAt(e.CB, 'wave');
  bulletAt(run, 20, 80);
  tick(e, run, 60);
  assert.equal(shownId(e), 'dash');
  const want = { kbm: 'Space: dash through bullets', touch: 'DASH: dash through bullets', pad: 'A: dash through bullets' };
  for (const d of DEVICES) {
    e.CB.Prompts.setDevice(d);
    g.clear();
    e.Hints.draw(g.r, 1, run);
    assert.equal(shot(g.log).text[1], want[d], d);
  }
  const c = env();
  const gc = renderer(c);
  const run2 = runAt(c.CB, 'wave');
  tick(c, run2, 60, [COMPACT_READY]);
  const wantC = { kbm: 'E: /compact clears the screen', touch: '/c: /compact clears the screen', pad: 'RB: /compact clears the screen' };
  for (const d of DEVICES) {
    c.CB.Prompts.setDevice(d);
    gc.clear();
    c.Hints.draw(gc.r, 1, run2);
    assert.equal(shot(gc.log).text[1], wantC[d], d);
  }
});

test('hints: draw defaults to the last run onEvents saw, and draws nothing outside the wave and boss states', () => {
  const e = env();
  const g = renderer(e);
  const run = runAt(e.CB, 'wave');
  tick(e, run, 60, [PERFECT]);
  e.Hints.draw(g.r, 1);
  assert.ok(shot(g.log), 'no run passed: the last one is used');
  for (const state of NOT_LIVE) {
    run.state = state;
    g.clear();
    e.Hints.draw(g.r, 1, run);
    assert.equal(g.log.length, 0, state);
  }
});

// ---- presentation only --------------------------------------------------------------------------------------------------------

test('hints: the events it reads are never changed (frozen events, strict mode)', () => {
  const e = env();
  const run = runAt(e.CB, 'wave');
  bulletAt(run, 20, 80);
  const evs = Object.freeze([COMPACT_READY, PERFECT, OPTIMIZED, { type: 'dash' }, { type: 'compact' }].map((x) => Object.freeze(Object.assign({}, x))));
  assert.doesNotThrow(() => tick(e, run, 10, evs));
});

test('hints: the simulation does not know it is there (the same seeded run, with and without the module, ends identical)', () => {
  const play = (withHints) => {
    const e = env({ files: withHints ? FILES : BASE });
    const run = e.CB.createRun({ seed: 99, startStage: 0, skipWaves: false });
    const g = withHints ? renderer(e) : null;
    for (let i = 0; i < 1500; i++) {
      const dash = i % 53 === 0;
      const evs = run.step(H.makeInput({ moveX: Math.sin(i / 40) > 0 ? 1 : -1, moveY: Math.cos(i / 55) > 0 ? 1 : -1, aimX: 160 + 80 * Math.sin(i / 17), aimY: 90, fire: i % 3 !== 0, dash, compact: i % 400 === 399 }));
      if (withHints) {
        e.Hints.onEvents(evs, run, GAME);
        e.Hints.draw(g.r, i / 60, run);
      }
    }
    const w = run.world;
    const p = w.player;
    return JSON.stringify({
      state: run.state, stateT: run.stateT, time: run.time, deaths: run.deaths, squashed: run.squashed, wave: run.waveIndex,
      px: p.x, py: p.y, hearts: p.hearts, stats: w.stats, ctx: w.context, enemies: w.enemies.length, bullets: w.eBullets.length, ebx: w.eBullets.map((b) => [b.x, b.y]),
    });
  };
  const without = play(false);
  const withIt = play(true);
  assert.equal(withIt, without);
  assert.ok(without.length > 100);
});

test('hints: in a real run, the first thing it shows is the /compact tip as the first boss fight opens', () => {
  const e = env();
  const run = e.CB.createRun({ seed: 3, startStage: 0, skipWaves: true });
  let started = -1;
  for (let i = 0; i < 1000 && started < 0; i++) {
    const evs = run.step(H.makeInput({ aimX: 200, aimY: 60 }));
    e.Hints.onEvents(evs, run, GAME);
    if (e.Hints.current()) started = i;
  }
  assert.ok(started >= 0, 'a tip appeared');
  assert.equal(run.state, 'boss', 'in the boss state');
  assert.equal(shownId(e), 'compact');
  assert.ok(run.stateT < 0.1, 'on the first step of the fight (Compact.fill opens it)');
  assert.deepEqual(seenList(e), ['compact']);
});

test('hints: in a real Heisenbug fight the look tip arrives at 2.6 s of the fight', () => {
  const e = env({ seen: ['compact', 'dash'] });
  const run = e.CB.createRun({ seed: 5, startStage: 3, skipWaves: true, god: true });
  let at = null;
  for (let i = 0; i < 1500 && at === null; i++) {
    const evs = run.step(H.makeInput({ aimX: 40, aimY: 150 }));
    e.Hints.onEvents(evs, run, GAME);
    if (shownId(e) === 'look') at = run.stateT;
  }
  assert.equal(run.state, 'boss');
  assert.ok(at !== null, 'it came');
  assert.ok(at <= 2.6 + 1 / 30, 'no later than 2.6 s of the fight (an earlier moth clink brings it sooner): ' + at);
  assert.deepEqual(seenList(e).sort(), ['compact', 'dash', 'look']);
});

// ---- the play scene -----------------------------------------------------------------------------------------------------------

// The scene with a hint-aware renderer stub: every primitive the scene and Hints use is logged in order. over: debug, noHints, seen, device.
function scene(over) {
  const o = over || {};
  const storage = memStorage(o.seen ? { 'cb.hints': JSON.stringify(o.seen) } : {});
  const files = [...H.GAME_BASE, 'src/art/font.js', 'src/core/prompts.js', 'src/game/unlocks.js', 'src/game/compact.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js']
    .concat(o.noHints ? [] : ['src/game/hints.js'], ['src/scenes/play.js', 'src/main.js']);
  const CB = H.load(files, { localStorage: storage });
  CB.Prompts.setDevice(o.device || 'kbm');
  CB.Audio = { play() {}, handleEvents() {}, init() {}, toggleMute() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const log = [];
  CB.WorldDraw = { draw: () => log.push('world') };
  CB.Screens.hud = { draw: () => log.push('hud'), cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory', 'patchPick']) CB.Screens[k] = { draw: () => log.push('overlay:' + k), cardAt: () => -1 };
  CB.Screens.pause = { draw: () => log.push('pause') };
  const game = { debug: o.debug || { speed: 1 }, input: { device: o.device || 'kbm', peekAim: () => ({ x: 0, y: 0 }) }, go() {} };
  const r = {
    clear() {},
    shaken: (dx, dy, fn) => fn(),
    alpha: (a, fn) => fn(),
    rect: () => log.push('rect'),
    frame: () => log.push('frame'),
    text: (s) => log.push('text:' + s),
    sprite() {},
    measure: (s, sc) => CB.Font.measure(String(s), sc || 1),
  };
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1, skipWaves: true } });
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 160, y: 80, hp: 10, maxHp: 10, phase: 1, defeated: false, update() {}, draw() {} }) };
  return { CB, play, game, r, log, storage };
}

const toBoss = (s) => {
  for (let i = 0; i < 1000 && s.play.run.state !== 'boss'; i++) s.play.update(s.CB.DT, H.makeInput());
  assert.equal(s.play.run.state, 'boss');
};

test('hints (scene): update hands every step\'s events, the run and the host to Hints.onEvents', () => {
  const s = scene();
  const calls = [];
  const orig = s.CB.Hints.onEvents;
  s.CB.Hints.onEvents = function (evs, run, game) {
    calls.push([Array.isArray(evs), run, game]);
    return orig.apply(this, arguments);
  };
  for (let i = 0; i < 5; i++) s.play.update(s.CB.DT, H.makeInput());
  assert.equal(calls.length, 5, 'once per step');
  for (const [isArr, run, game] of calls) {
    assert.equal(isArr, true);
    assert.equal(run, s.play.run);
    assert.equal(game, s.game);
  }
  s.game.debug.speed = 3;
  calls.length = 0;
  s.play.update(s.CB.DT, H.makeInput());
  assert.equal(calls.length, 3, 'once per step, however many steps a frame runs');
});

test('hints (scene): the boss fight opens with the /compact tip, drawn in the box after the HUD', () => {
  const s = scene();
  toBoss(s);
  assert.equal(s.CB.Hints.current().id, 'compact');
  for (let i = 0; i < 20; i++) s.play.update(s.CB.DT, H.makeInput());
  s.log.length = 0;
  s.play.draw(s.r, 0.5);
  const hud = s.log.indexOf('hud');
  const text = s.log.indexOf('text:E: /compact clears the screen');
  assert.ok(hud >= 0, 'the HUD is drawn');
  assert.ok(text > hud, 'the tip comes after the HUD: ' + JSON.stringify(s.log));
  assert.ok(s.log.indexOf('rect') > hud && s.log.indexOf('rect') < text, 'its box first, then its text');
  assert.ok(s.log.indexOf('frame') > hud && s.log.indexOf('frame') < text, 'and its frame');
});

test('hints (scene): it is drawn under an overlay card (the tip, then the wave banner)', () => {
  const s = scene();
  const play = s.play;
  play.run.state = 'wave'; // a hand-set wave needs a spawner to step; the scene is only drawn here
  play.run.spawner = { update() {}, done: false };
  s.CB.Hints.onEvents([COMPACT_READY], play.run, s.game);
  for (let i = 0; i < 30; i++) s.CB.Hints.onEvents([], play.run, s.game);
  assert.equal(s.CB.Hints.current().id, 'compact');
  s.log.length = 0;
  play.draw(s.r, 0.5);
  const hud = s.log.indexOf('hud');
  const tip = s.log.indexOf('text:E: /compact clears the screen');
  const banner = s.log.indexOf('overlay:waveBanner');
  assert.ok(hud >= 0 && tip > hud, 'after the HUD');
  assert.ok(banner > tip, 'before the overlay');
});

test('hints (scene): a paused scene draws no hint and its clock stands still', () => {
  const s = scene();
  toBoss(s);
  for (let i = 0; i < 40; i++) s.play.update(s.CB.DT, H.makeInput());
  const t = s.CB.Hints.current().t;
  s.play.paused = true;
  for (let i = 0; i < 100; i++) s.play.update(s.CB.DT, H.makeInput());
  assert.equal(s.CB.Hints.current().t, t, 'no steps, no time');
  s.log.length = 0;
  s.play.draw(s.r, 0.5);
  assert.equal(s.log.some((x) => x.startsWith('text:E: /compact')), false, 'not drawn while paused');
  s.play.paused = false;
  s.play.update(s.CB.DT, H.makeInput());
  s.log.length = 0;
  s.play.draw(s.r, 0.5);
  assert.equal(s.log.some((x) => x.startsWith('text:E: /compact')), true, 'and back on resume');
});

test('hints (scene): a debug run shows none and saves none', () => {
  const s = scene({ debug: { active: true, speed: 1, skipWaves: true } });
  toBoss(s);
  for (let i = 0; i < 60; i++) s.play.update(s.CB.DT, H.makeInput());
  assert.equal(s.CB.Hints.current(), null);
  assert.equal(s.storage.mem['cb.hints'], undefined);
  s.log.length = 0;
  s.play.draw(s.r, 0.5);
  assert.equal(s.log.some((x) => x.startsWith('text:')), false);
});

test('hints (scene): the tip uses the device in use', () => {
  for (const [device, text] of [['kbm', 'E: /compact clears the screen'], ['touch', '/c: /compact clears the screen'], ['pad', 'RB: /compact clears the screen']]) {
    const s = scene({ device });
    toBoss(s);
    for (let i = 0; i < 30; i++) s.play.update(s.CB.DT, H.makeInput());
    s.log.length = 0;
    s.play.draw(s.r, 0.5);
    assert.ok(s.log.includes('text:' + text), device + ': ' + JSON.stringify(s.log.filter((x) => x.startsWith('text:'))));
  }
});

test('hints (scene): the scene runs the same without the module, or with a broken one', () => {
  for (const make of [(CB) => { delete CB.Hints; }, (CB) => { CB.Hints = {}; }, (CB) => { CB.Hints = { onEvents: 1, draw: 'no' }; }, (CB) => { CB.Hints = null; }]) {
    const s = scene({ noHints: true });
    make(s.CB);
    assert.doesNotThrow(() => {
      toBoss(s);
      for (let i = 0; i < 30; i++) s.play.update(s.CB.DT, H.makeInput());
      s.play.draw(s.r, 0.5);
    });
  }
  const s = scene({ noHints: true });
  assert.equal(s.CB.Hints, undefined);
});
