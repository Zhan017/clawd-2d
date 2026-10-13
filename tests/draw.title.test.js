'use strict';
// Title scene: start flow, secrets, hats, modes, music and calm keys, and the menu-card layout (recorder-checked: text, sprite and frame boxes).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('title: draws, animates and starts the game on confirm', () => {
  const files = [...H.GAME_BASE, 'src/art/render.js', 'src/scenes/title.js'];
  const { CB, sandbox } = H.load(files, { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1), draw() {}, wrap: (s) => [String(s)] };
  CB.Arena = CB.Arena || { draw() {} };
  CB.Audio = { play() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const visits = [];
  const game = { go: (n, d) => visits.push(n), input: { peekAim: () => ({ x: 0, y: 0 }) }, debug: {} };
  const title = CB.Scenes.title;
  title.enter(game, {});
  for (let i = 0; i < 120; i++) {
    title.update(CB.DT, H.makeInput());
    if (i % 20 === 0) title.draw(r, i * CB.DT);
  }
  assert.equal(visits.length, 0);
  title.update(CB.DT, H.makeInput({ confirm: true }));
  assert.deepEqual(visits, ['play']);
});

test('title: confirm is ignored during the first 0.3 s', () => {
  const files = [...H.GAME_BASE, 'src/art/render.js', 'src/scenes/title.js'];
  const CB = H.load(files);
  CB.Audio = { play() {} };
  const visits = [];
  const title = CB.Scenes.title;
  title.enter({ go: (n) => visits.push(n), input: { peekAim: () => ({ x: 0, y: 0 }) } }, {});
  title.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(visits.length, 0);
});

// ---- helpers --------------------------------------------------------------------------------------------------------------------

const ENEMIES = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak'].map((k) => 'src/game/enemies/' + k + '.js');
const BASE = [...H.GAME_BASE, 'src/art/font.js', 'src/art/render.js'];
// prompts.js and screens.js (the sound / music / calm chips) are loaded so the kbm strings pinned below come from CB.Prompts;
// menus.devices.test.js covers touch, pad, and the scene without either module.
const FILES = [...BASE, 'src/core/prompts.js', 'src/scenes/screens.js', 'src/scenes/title.js'];
// The same with CB.Daily, for the daily build button (not in FILES: the other tests also cover the title without it).
const DAILY_FILES = [...BASE, 'src/core/prompts.js', 'src/core/daily.js', 'src/scenes/screens.js', 'src/scenes/title.js'];
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
const ULTRA = ['KeyU', 'KeyL', 'KeyT', 'KeyR', 'KeyA', 'KeyT', 'KeyH', 'KeyI', 'KeyN', 'KeyK'];
const HAT_NAMES = [
  { id: 'loopcap', name: 'Loop cap' }, { id: 'slime', name: 'Slime hat' }, { id: 'branch', name: 'Branch beanie' },
  { id: 'shades', name: 'Shades' }, { id: 'crown', name: 'Crown' }, { id: 'sudo', name: 'sudo hat' }, { id: 'halo', name: 'Halo' },
];

// A scene on a real renderer with the recorder on, plus stubs for the modules that are not loaded. `over` may set:
// files, localStorage, and (before enter) whatever the test wants through `prep(env)`.
function setup(over) {
  const o = over || {};
  const { CB, sandbox } = H.load(o.files || FILES, { returnSandbox: true, localStorage: o.localStorage });
  const env = { CB, sandbox, visits: [], sounds: [], arena: [], cursor: [], aim: { x: 0, y: 0 } };
  if (!CB.Arena) CB.Arena = { draw: (r, stage, t) => env.arena.push({ stage: H.plain(stage), t }) };
  CB.Audio = { play: (n) => env.sounds.push(n), isMuted: () => false };
  CB.Screens.hud = { cursor: (r, x, y, mode, t) => env.cursor.push({ x, y, mode, t }) };
  env.r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  env.r.resize();
  env.rec = H.recorder(env.r, CB);
  // The recorder has no frames: the framed buttons and the card are recorded here ({ x, y, w, h, color }) so tests can compare hit boxes with what is drawn.
  env.frames = [];
  const drawFrame = env.r.frame;
  env.r.frame = function (x, y, w, h, color) {
    env.frames.push({ x, y, w, h, color });
    return drawFrame.apply(this, arguments);
  };
  env.game = { go: (n, d) => env.visits.push([n, H.plain(d)]), input: { peekAim: () => env.aim }, debug: {} };
  env.title = CB.Scenes.title;
  if (o.prep) o.prep(env);
  env.title.enter(env.game, {});
  return env;
}

// n fixed ticks of the scene, `input` an object or a function(i).
function run(env, n, input) {
  for (let i = 0; i < n; i++) env.title.update(env.CB.DT, typeof input === 'function' ? input(i) : input || H.makeInput());
}

// Past the 0.3 s input lock.
function unlocked(env) {
  run(env, 20);
  return env;
}

// One frame drawn with a clean recorder; returns the boxes.
function frame(env, t) {
  env.rec.clear();
  env.frames.length = 0;
  env.title.draw(env.r, t == null ? 0.3 : t);
  return env.rec;
}

const textOf = (rec, s) => rec.texts().find((b) => b.str === s);
// The frame drawn exactly at a hit box (or undefined).
const frameAt = (env, b) => env.frames.find((f) => f.x === b.x && f.y === b.y && f.w === b.w && f.h === b.h);
const hasText = (rec, s) => !!textOf(rec, s);
const inBox = (b, btn) => b.x >= btn.x && b.x + b.w <= btn.x + btn.w && b.y >= btn.y && b.y + b.h <= btn.y + btn.h;

// A stub CB.Unlocks that records calls. `hats` is the unlocked list, `worn` the current hat id.
function stubUnlocks(env, o) {
  const s = Object.assign({ modes: false, hats: [], worn: null, fresh: true }, o || {});
  s.calls = [];
  s.cycles = [];
  env.CB.HATS = HAT_NAMES;
  env.CB.Unlocks = {
    has: (id) => (id === 'modes' ? s.modes : false),
    unlock: (id) => {
      s.calls.push(id);
      return s.fresh;
    },
    hats: () => s.hats.slice(),
    hat: () => s.worn,
    cycleHat: (d) => {
      s.cycles.push(d);
      return s.worn;
    },
  };
  return s;
}

// ---- start flow and state -------------------------------------------------------------------------------------------------------

test('title: confirm plays uiSelect and starts a normal run with the yolo flag off', () => {
  const env = setup();
  unlocked(env);
  run(env, 1, H.makeInput({ confirm: true }));
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]]);
  assert.deepEqual(env.sounds, ['uiSelect']);
});

test('title: enter stops the music and resets the scene', () => {
  const env = setup({ prep: (e) => { e.stops = 0; e.CB.Music = { stop: () => { e.stops++; } }; } });
  assert.equal(env.stops, 1);
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const yolo = env.title.BUTTONS.find((b) => b.id === 'yolo');
  run(env, 1, H.makeInput({ confirm: true, aimX: yolo.x + 2, aimY: yolo.y + 2 }));
  env.title.enter(env.game, {}); // back from a run
  assert.equal(env.stops, 2);
  unlocked(env);
  run(env, 1, H.makeInput({ confirm: true }));
  assert.deepEqual(env.visits.at(-1), ['play', { runOpts: { yolo: false } }]);
});

test('title: a Music that only has some methods is fine', () => {
  const env = setup({ prep: (e) => { e.CB.Music = {}; } });
  unlocked(env);
  run(env, 1, H.makeInput({ music: true, confirm: true }));
  assert.equal(env.visits.length, 1);
  assert.doesNotThrow(() => frame(env));
});

// ---- secrets --------------------------------------------------------------------------------------------------------------------

test('title: konami (one key per tick) unlocks the halo, toasts, chimes once, and the toast expires', () => {
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'] });
  const s = stubUnlocks(env);
  unlocked(env);
  run(env, KONAMI.length, (i) => H.makeInput({ keys: [KONAMI[i]] }));
  assert.deepEqual(s.calls, ['halo']);
  assert.deepEqual(env.sounds, ['unlock']);
  const rec = frame(env);
  const t = textOf(rec, 'cheat codes are just undocumented features');
  assert.ok(t, 'toast text');
  assert.equal(t.y, 173);
  assert.ok(!hasText(rec, 'Fan game. Not affiliated with Anthropic.'), 'the toast takes the footer row while it is up');
  assert.deepEqual(rec.overlaps(), []);
  assert.deepEqual(rec.outside(), []);
  run(env, 130);
  const later = frame(env);
  assert.ok(!hasText(later, 'cheat codes are just undocumented features'), 'gone after 2 s');
  assert.ok(hasText(later, 'Fan game. Not affiliated with Anthropic.'));
});

test('title: all konami codes in one tick work too; ultrathink unlocks the rainbow', () => {
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'] });
  const s = stubUnlocks(env);
  unlocked(env);
  run(env, 1, H.makeInput({ keys: KONAMI.slice() }));
  assert.deepEqual(s.calls, ['halo']);
  run(env, 1, H.makeInput({ keys: ULTRA.slice() }));
  assert.deepEqual(s.calls, ['halo', 'rainbow']);
  assert.deepEqual(env.sounds, ['unlock', 'unlock']);
  assert.ok(hasText(frame(env), '✻ ultrathink enabled'));
});

test('title: a code typed when it is already unlocked gives no toast and no chime', () => {
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'] });
  const s = stubUnlocks(env, { fresh: false });
  unlocked(env);
  run(env, 1, H.makeInput({ keys: KONAMI.slice() }));
  assert.deepEqual(s.calls, ['halo']);
  assert.deepEqual(env.sounds, []);
  assert.ok(!hasText(frame(env), 'cheat codes are just undocumented features'));
});

test('title: a partial or scrambled code does nothing; the matcher is fed from every tick', () => {
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'] });
  const s = stubUnlocks(env);
  unlocked(env);
  run(env, 1, H.makeInput({ keys: KONAMI.slice(0, 9) }));
  run(env, 1, H.makeInput({ keys: ['KeyX'] }));
  run(env, 1, H.makeInput({ keys: ['KeyA'] }));
  assert.deepEqual(s.calls, []);
  run(env, 1, H.makeInput({ keys: ['KeyU', 'KeyL', 'KeyT'] })); // typed across ticks
  run(env, 1, H.makeInput({ keys: ULTRA.slice(3) }));
  assert.deepEqual(s.calls, ['rainbow']);
});

test('title: with no Secrets or Unlocks module the keys are ignored', () => {
  const env = setup();
  unlocked(env);
  assert.doesNotThrow(() => run(env, 3, H.makeInput({ keys: KONAMI.slice(), quit: true, compact: true })));
  assert.equal(env.sounds.length, 0);
});

// ---- hats -----------------------------------------------------------------------------------------------------------------------

test('title: Q cycles the hat back and E forward; nothing else does', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: ['loopcap', 'halo'], worn: 'loopcap' });
  unlocked(env);
  run(env, 1, H.makeInput({ quit: true }));
  run(env, 1, H.makeInput({ compact: true }));
  run(env, 1, H.makeInput({ compact: true }));
  assert.deepEqual(s.cycles, [-1, 1, 1]);
  assert.deepEqual(env.sounds, ['uiSelect', 'uiSelect', 'uiSelect']);
  run(env, 4, (i) => H.makeInput({ moveX: i % 2 ? 1 : -1, keys: [i % 2 ? 'KeyD' : 'KeyA'] }));
  run(env, 2, H.makeInput({ keys: ['ArrowLeft', 'ArrowRight'], moveX: 1 }));
  assert.deepEqual(s.cycles, [-1, 1, 1], 'A/D and the arrows do not cycle');
  assert.equal(env.visits.length, 0);
});

test('title: with no hats unlocked Q and E do nothing', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: [] });
  unlocked(env);
  run(env, 2, H.makeInput({ quit: true, compact: true }));
  assert.deepEqual(s.cycles, []);
  assert.deepEqual(env.sounds, []);
  assert.ok(!frame(env).texts().some((b) => b.str.startsWith('hat:')));
});

test('title: typing konami and ultrathink with moveX edges never changes the hat', () => {
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'] });
  const s = stubUnlocks(env, { hats: ['loopcap', 'halo'], worn: 'loopcap' });
  unlocked(env);
  // The real input fills moveX on WASD and the arrows: every code here comes with the matching edge.
  const move = { ArrowLeft: -1, ArrowRight: 1, KeyA: -1, KeyD: 1 };
  for (const seq of [KONAMI, ULTRA]) {
    run(env, seq.length, (i) => H.makeInput({ keys: [seq[i]], moveX: move[seq[i]] || 0 }));
    run(env, 1, H.makeInput());
  }
  assert.deepEqual(s.cycles, []);
  assert.deepEqual(s.calls, ['halo', 'rainbow']);
});

test('title: the hat picker names the worn hat (or none) between two chevrons, and the hat is drawn above Clawd at scale 2', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: ['branch', 'halo'], worn: 'branch' });
  const calls = [];
  env.CB.Player.drawHat = (r, x, y, id, facing, scale) => calls.push({ x, y, id, facing, scale });
  unlocked(env);
  const rec = frame(env);
  const label = textOf(rec, 'Branch beanie');
  assert.ok(label, 'the hat name (the old "hat: " prefix and "(Q/E)" tail are gone)');
  assert.equal(label.y, 99, 'the top row of the card');
  assert.ok(!rec.texts().some((b) => b.str.startsWith('hat:')));
  // Key hints on the outside, chevrons hugging the name: Q ‹ Branch beanie › E
  const q = textOf(rec, 'Q');
  const e = textOf(rec, 'E');
  const chevs = rec.sprites().filter((b) => b.name === 'title_chev').sort((a, b) => a.x - b.x);
  assert.equal(chevs.length, 2, 'two chevrons');
  assert.ok(q && e, 'key hints');
  assert.ok(q.x + q.w < chevs[0].x && chevs[0].x + chevs[0].w < label.x, 'Q, left chevron, name in that order');
  assert.ok(label.x + label.w < chevs[1].x && chevs[1].x + chevs[1].w < e.x, 'name, right chevron, E in that order');
  assert.ok(chevs[0].x - (q.x + q.w) <= 6 && e.x - (chevs[1].x + chevs[1].w) <= 6, 'the hints sit right outside the chevrons');
  assert.deepEqual([chevs[0].x, chevs[1].x], [114, 202], 'the chevrons are fixed, either side of a 74 px name field');
  assert.ok(Math.abs((label.x + label.w / 2) - 160) <= 1, 'the name is centred');
  assert.equal(chevs[0].y, 99);
  assert.equal(chevs[0].h, 7);
  // The sub-boxes cover what is drawn: the left one the Q and its chevron, the right one the name, its chevron and the E.
  const { HAT_BOX, HAT_LEFT, HAT_RIGHT } = env.title;
  for (const b of [q, chevs[0]]) assert.ok(inBox(b, HAT_LEFT), 'left part ' + (b.str || b.name));
  for (const b of [label, chevs[1], e]) assert.ok(inBox(b, HAT_RIGHT), 'right part ' + (b.str || b.name));
  assert.equal(HAT_LEFT.x, HAT_BOX.x);
  assert.equal(HAT_LEFT.x + HAT_LEFT.w, HAT_RIGHT.x, 'the two halves meet');
  assert.equal(HAT_RIGHT.x + HAT_RIGHT.w, HAT_BOX.x + HAT_BOX.w, 'and fill the row box');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'branch');
  assert.equal(calls[0].x, 160);
  assert.equal(calls[0].scale, 2);
  assert.equal(calls[0].facing, 1);
  assert.ok(calls[0].y >= 58 && calls[0].y <= 74, 'above the head: ' + calls[0].y);
  s.worn = null;
  calls.length = 0;
  const bare = frame(env);
  assert.ok(hasText(bare, 'none'));
  assert.ok(!hasText(bare, 'Branch beanie'));
  assert.equal(calls.length, 0, 'no hat, no drawHat');
  assert.deepEqual(bare.overlaps(), []);
});

test('title: the hat row is the card\'s first row: the card is 10 px taller with a hat unlocked, and START stays put', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: [] });
  unlocked(env);
  const cardOf = () => env.frames.find((f) => f.x === env.title.CARD.x && f.w === env.title.CARD.w);
  frame(env);
  const bare = cardOf();
  assert.equal(bare.y, 106);
  assert.equal(bare.y + bare.h, 172, 'the card ends where the disclaimer row begins');
  assert.ok(!env.rec.sprites().some((b) => b.name === 'title_chev'), 'no hats, no hat row');
  s.hats = ['loopcap'];
  frame(env);
  const withHat = cardOf();
  assert.equal(withHat.y, 96);
  assert.equal(withHat.y + withHat.h, 172);
  assert.equal(env.frames.find((f) => f.x === env.title.START_BOX.x && f.y === env.title.START_BOX.y).w, 104, 'the START frame did not move');
});

test('title: the chevrons stay put as the hat name changes, and every hat name fits between them; a phone shows no key hints', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: HAT_NAMES.map((h) => h.id), worn: 'halo' });
  unlocked(env);
  const chevX = () => env.rec.sprites().filter((b) => b.name === 'title_chev').map((b) => b.x).sort((a, b) => a - b);
  const seen = new Set();
  for (const h of [...HAT_NAMES, { id: null, name: 'none' }]) {
    s.worn = h.id;
    const rec = frame(env);
    const label = textOf(rec, h.name);
    assert.ok(label, h.name);
    assert.ok(label.w <= 74, h.name + ' fits the 74 px field');
    assert.ok(Math.abs(label.x + label.w / 2 - 160) <= 1, h.name + ' is centred');
    assert.ok(label.x > 114 + 4 && label.x + label.w < 202, h.name + ' sits between the chevrons');
    seen.add(chevX().join());
  }
  assert.deepEqual([...seen], ['114,202'], 'the chevrons never move');
  env.CB.Prompts.setDevice('touch');
  const touch = frame(env);
  assert.ok(!hasText(touch, 'Q') && !hasText(touch, 'E') && !hasText(touch, 'LB') && !hasText(touch, 'RB'), 'a phone has no keys to name');
  assert.equal(touch.sprites().filter((b) => b.name === 'title_chev').length, 2, 'it keeps the chevrons');
  env.CB.Prompts.setDevice('pad');
  const pad = frame(env);
  assert.ok(hasText(pad, 'LB') && hasText(pad, 'RB'), 'the pad names LB and RB');
  assert.ok(!hasText(pad, 'Q'));
  assertCardLayout(env, pad, 'pad hat row');
});

test('title: a missing drawHat or HATS table is fine', () => {
  const env = setup();
  stubUnlocks(env, { hats: ['halo'], worn: 'halo' });
  env.CB.HATS = undefined;
  delete env.CB.Player.drawHat;
  unlocked(env);
  assert.ok(hasText(frame(env), 'halo'), 'the id stands in for the name');
});

// ---- modes ----------------------------------------------------------------------------------------------------------------------

test('title: BUTTONS exposes rush, yolo and daily hit boxes, each exactly the frame that is drawn, with its label centred inside', () => {
  const env = setup({ files: DAILY_FILES, prep: (e) => { e.CB.Music = { stop() {}, isEnabled: () => true }; e.CB.Comfort = { calm: () => false, toggle() {}, blink: () => true }; } }); // all three chips exist
  const B = env.title.BUTTONS;
  assert.deepEqual(B.map((b) => b.id), ['rush', 'yolo', 'daily']);
  for (const b of B) for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(b[k]), b.id + '.' + k);
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const rec = frame(env);
  const rush = textOf(rec, 'boss rush');
  const yolo = textOf(rec, '--yolo: off');
  const daily = textOf(rec, 'daily build');
  assert.ok(rush && yolo && daily, 'the three labels');
  for (const [txt, box] of [[rush, B[0]], [yolo, B[1]], [daily, B[2]]]) {
    assert.ok(inBox(txt, box), box.id + ' label inside its box');
    assert.ok(Math.abs(txt.x + txt.w / 2 - (box.x + box.w / 2)) <= 1, box.id + ' label is centred in its box');
    assert.equal(txt.y, box.y + 2, box.id + ' label row');
    assert.ok(frameAt(env, box), box.id + ': a frame is drawn at exactly the hit box');
  }
  assert.deepEqual(B.map((b) => b.y), [125, 125, 125], 'one row');
  assert.ok(B[0].x + B[0].w < B[2].x && B[2].x + B[2].w < B[1].x, 'boxes do not touch, the daily one sits between');
  // They share the chips' grid: the same width and the same columns, so the two rows line up.
  const chips = env.CB.Screens.toggles.boxes(160);
  assert.deepEqual(B.map((b) => b.w), chips.map((c) => c.w).slice(0, 3));
  assert.deepEqual([B[0].x, B[2].x, B[1].x], chips.map((c) => c.x));
  assert.equal(B[0].h, chips[0].h, 'and the same height');
});

test('title: confirm inside rush starts boss rush; inside yolo toggles; elsewhere starts a normal run', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const [rush, yolo] = env.title.BUTTONS;
  const at = (b) => H.makeInput({ confirm: true, aimX: b.x + b.w / 2, aimY: b.y + b.h / 2 });
  run(env, 1, at(yolo));
  assert.equal(env.visits.length, 0, 'the toggle does not start the run');
  assert.ok(hasText(frame(env), '--yolo: ON'));
  assert.deepEqual(env.sounds, ['uiSelect']);
  run(env, 1, at(rush));
  assert.deepEqual(env.visits, [['play', { runOpts: { bossRush: true, yolo: true } }]]);
});

test('title: boss rush with yolo off, a normal start after toggling twice, and a click just outside both boxes', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const [rush, yolo] = env.title.BUTTONS;
  const at = (x, y) => H.makeInput({ confirm: true, aimX: x, aimY: y });
  run(env, 1, at(yolo.x + 1, yolo.y + 1));
  run(env, 1, at(yolo.x + yolo.w - 1, yolo.y + yolo.h - 1));
  assert.ok(hasText(frame(env), '--yolo: off'), 'toggled back off');
  run(env, 1, at(rush.x - 1, rush.y + 3)); // just left of rush
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
  env.title.enter(env.game, {});
  unlocked(env);
  run(env, 1, at(rush.x, rush.y + rush.h)); // y is exclusive at the bottom edge
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
  env.title.enter(env.game, {});
  unlocked(env);
  run(env, 1, at(rush.x, rush.y));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { bossRush: true, yolo: false } }]);
});

test('title: hit-testing uses input.aimX/aimY, not the cursor the game reports', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const rush = env.title.BUTTONS[0];
  env.aim = { x: 5, y: 5 }; // peekAim says elsewhere
  run(env, 1, H.makeInput({ confirm: true, aimX: rush.x + 4, aimY: rush.y + 4 }));
  assert.equal(env.visits[0][1].runOpts.bossRush, true);
});

test('title: with modes locked the mode row is hidden and the button areas just start a normal run', () => {
  const env = setup();
  stubUnlocks(env, { modes: false });
  unlocked(env);
  const rec = frame(env);
  assert.ok(!rec.texts().some((b) => b.str.includes('boss rush') || b.str.includes('--yolo')));
  assert.ok(!env.frames.some((f) => env.title.BUTTONS.some((b) => b.id !== 'daily' && f.x === b.x && f.y === b.y)), 'and no frames for them');
  const rush = env.title.BUTTONS[0];
  run(env, 1, H.makeInput({ confirm: true, aimX: rush.x + 4, aimY: rush.y + 4 }));
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]]);
});

test('title: mode buttons ignore a click in the first 0.3 s', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  const rush = env.title.BUTTONS[0];
  run(env, 5, H.makeInput({ confirm: true, aimX: rush.x + 4, aimY: rush.y + 4 }));
  assert.equal(env.visits.length, 0);
  assert.equal(env.sounds.length, 0);
});

// ---- music and calm -------------------------------------------------------------------------------------------------------------

test('title: N toggles the music once and plays uiSelect', () => {
  let toggles = 0;
  const env = setup({ prep: (e) => { e.CB.Music = { stop() {}, toggle: () => { toggles++; }, isEnabled: () => true }; } });
  unlocked(env);
  run(env, 1, H.makeInput({ music: true }));
  assert.equal(toggles, 1);
  assert.deepEqual(env.sounds, ['uiSelect']);
  run(env, 3);
  assert.equal(toggles, 1);
  assert.equal(env.visits.length, 0);
});

test('title: N with no Music module is a quiet no-op', () => {
  const env = setup();
  unlocked(env);
  assert.doesNotThrow(() => run(env, 1, H.makeInput({ music: true })));
  assert.deepEqual(env.sounds, []);
});

test('title: finishing ultrathink leaves the music as it was (its N press toggled it once)', () => {
  let toggles = 0;
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'], prep: (e) => { e.CB.Music = { stop() {}, toggle: () => { toggles++; } }; } });
  stubUnlocks(env);
  unlocked(env);
  // The real input raises the music edge on the N of "ultrathink".
  run(env, ULTRA.length, (i) => H.makeInput({ keys: [ULTRA[i]], music: ULTRA[i] === 'KeyN' }));
  assert.equal(toggles, 2, 'one for the N press, one to put it back');
  // A plain N press later is a real toggle.
  run(env, 200);
  run(env, 1, H.makeInput({ music: true, keys: ['KeyN'] }));
  assert.equal(toggles, 3);
});

test('title: V toggles calm mode with a toast, one toast at a time', () => {
  let calm = false;
  const env = setup({ prep: (e) => { e.CB.Comfort = { toggle: () => (calm = !calm), calm: () => calm, blink: () => true }; } });
  unlocked(env);
  run(env, 1, H.makeInput({ keys: ['KeyV'] }));
  assert.equal(calm, true);
  let rec = frame(env);
  const t = textOf(rec, 'calm mode: on');
  assert.ok(t);
  assert.equal(t.y, 173);
  run(env, 1, H.makeInput({ keys: ['KeyV'] }));
  assert.equal(calm, false);
  rec = frame(env);
  assert.ok(hasText(rec, 'calm mode: off'));
  assert.ok(!hasText(rec, 'calm mode: on'));
  assert.deepEqual(rec.overlaps(), []);
});

test('title: V with no Comfort module does nothing', () => {
  const env = setup();
  unlocked(env);
  assert.doesNotThrow(() => run(env, 1, H.makeInput({ keys: ['KeyV'] })));
  assert.ok(!frame(env).texts().some((b) => b.str.startsWith('calm mode')));
});

// ---- layout (the menu card) -----------------------------------------------------------------------------------------------------

const rectsMeet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// What every frame of the title must satisfy: on screen, the card holds every menu element, no framed button touches another, and no text
// that is not a button's own label touches a button's frame. `env` has just drawn `rec`.
function assertCardLayout(env, rec, what) {
  const { CARD } = env.title;
  const card = env.frames.find((f) => f.x === CARD.x && f.w === CARD.w);
  assert.ok(card, what + ': the card is drawn');
  assert.equal(card.y + card.h, CARD.bottom, what + ': the card ends on its row');
  assert.ok(card.y === CARD.topBare || card.y === CARD.topWithHat, what + ': card top ' + card.y);
  assert.deepEqual(rec.outside(), [], what + ': text and sprites on screen');
  for (const f of env.frames) assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= 320 && f.y + f.h <= 180, what + ': frame on screen ' + JSON.stringify(f));
  for (const b of rec.boxes) {
    if (b.y < card.y || b.y >= CARD.bottom) continue; // the logo, Clawd and the bugs above; the disclaimer or toast row below
    if (b.kind === 'sprite' && !b.name.startsWith('title_chev')) continue;
    assert.ok(b.x > card.x && b.x + b.w < card.x + card.w && b.y > card.y && b.y + b.h < card.y + card.h, what + ': ' + (b.str || b.name) + ' is inside the card');
  }
  const buttons = env.frames.filter((f) => f !== card);
  for (let i = 0; i < buttons.length; i++) {
    for (let j = i + 1; j < buttons.length; j++) {
      const a = buttons[i];
      const c = buttons[j];
      const nested = a.x === c.x - 1 && a.y === c.y - 1 && a.w === c.w + 2 && a.h === c.h + 2; // the doubled --yolo frame
      const nested2 = c.x === a.x - 1 && c.y === a.y - 1 && c.w === a.w + 2 && c.h === a.h + 2;
      if (!nested && !nested2) assert.ok(!rectsMeet(a, c), what + ': frames apart ' + JSON.stringify([a, c]));
    }
  }
  for (const t of rec.texts()) {
    for (const f of buttons) {
      const inside = t.x >= f.x && t.x + t.w <= f.x + f.w && t.y >= f.y && t.y + t.h <= f.y + f.h;
      if (!inside) assert.ok(!rectsMeet(t, f), what + ': ' + JSON.stringify(t.str) + ' stays off the frame ' + JSON.stringify(f));
    }
  }
  assert.deepEqual(rec.overlaps().map((p) => [p[0].str, p[1].str]), [], what + ': disjoint text');
}

test('title: base layout: logo, then the card with START, the legend, the chips, and the disclaimer on the last row', () => {
  const env = setup({ prep: (e) => { e.CB.Music = { stop() {}, toggle() {}, isEnabled: () => true }; } });
  unlocked(env);
  const rec = frame(env, 0.3);
  const row = (s) => {
    const b = textOf(rec, s);
    assert.ok(b, 'missing ' + JSON.stringify(s));
    return b;
  };
  assert.equal(row('vs').y, 27);
  // The card: x 34-286, bottom row at 171; 106 at the top while there is no hat row.
  const card = env.frames.find((f) => f.x === 34 && f.w === 252);
  assert.deepEqual(H.plain(card), { x: 34, y: 106, w: 252, h: 66, color: env.CB.Pal.C.greyDark });
  // START: a 104 x 13 framed box in clawd orange, centred, its label centred in it.
  const start = env.title.START_BOX;
  assert.deepEqual(H.plain(start), { x: 108, y: 109, w: 104, h: 13 });
  const sf = frameAt(env, start);
  assert.ok(sf, 'the START frame');
  assert.ok([env.CB.Pal.C.clawd, env.CB.Pal.C.clawdLight].includes(sf.color), 'in clawd orange');
  assert.equal(row('Click to start').y, 112);
  assert.ok(inBox(row('Click to start'), start));
  assert.ok(Math.abs(row('Click to start').x + row('Click to start').w / 2 - 160) <= 1);
  // The legend: two short lines in the dim grey, the chips' M, N and V no longer repeated.
  assert.equal(row('WASD move · Mouse aim · Click shoot').y, 139);
  assert.equal(row('Space dash · E /compact · Esc pause').y, 148);
  assert.ok(!rec.texts().some((b) => /N music · M mute|V calm ·/.test(b.str)), 'the legend no longer repeats the chips');
  // The chips are the card's last row (calm has no module in this test, so it has no chip).
  assert.equal(row('M sound: on').y, 160);
  assert.equal(row('N music: on').y, 160);
  assert.ok(!rec.texts().some((b) => b.str.startsWith('V calm')));
  assert.ok(Math.abs(row('M sound: on').x + row('M sound: on').w / 2 - (45 + 37)) <= 1, 'sound is centred in the first chip');
  assert.ok(Math.abs(row('N music: on').x + row('N music: on').w / 2 - (123 + 37)) <= 1, 'music is centred in the second chip');
  // The disclaimer has the last row, below the card.
  assert.equal(row('Fan game. Not affiliated with Anthropic.').y, 173);
  assert.equal(row('Fan game. Not affiliated with Anthropic.').y + 7, 180);
  for (const s of ['vs', 'Click to start', 'WASD move · Mouse aim · Click shoot', 'Space dash · E /compact · Esc pause', 'Fan game. Not affiliated with Anthropic.']) {
    const b = row(s);
    assert.ok(Math.abs(b.x + b.w / 2 - 160) <= 1, s + ' is centred');
  }
  // Reading order down the screen.
  const ys = ['vs', 'Click to start', 'WASD move · Mouse aim · Click shoot', 'Space dash · E /compact · Esc pause', 'M sound: on', 'Fan game. Not affiliated with Anthropic.'].map((x) => row(x).y);
  assert.deepEqual(ys, ys.slice().sort((a, b) => a - b));
  // Logo: five and four separate letters, scale 3 (15 x 21 boxes), bobbing at most 1 px around rows 4 and 36.
  const letters = (word, y) => {
    const found = word.split('').map((ch, i) => {
      const cands = rec.texts().filter((b) => b.str === ch && b.w === 15 && b.h === 21 && Math.abs(b.y - y) <= 1);
      assert.ok(cands.length >= 1, word + ' letter ' + i);
      return cands[0];
    });
    for (let i = 1; i < found.length; i++) assert.ok(found[i].x >= found[i - 1].x + 15 + 3 - 0, word + ' spacing');
    return found;
  };
  const clawd = letters('CLAWD', 4);
  const bugs = letters('BUGS', 36);
  assert.ok(Math.abs((clawd[0].x + clawd[4].x + 15) / 2 - 160) <= 1.5, 'CLAWD centred');
  assert.ok(Math.abs((bugs[0].x + bugs[3].x + 15) / 2 - 160) <= 1.5, 'BUGS centred');
  // Clawd: scale 2, centred (160, 82).
  const clawdBox = rec.sprites().find((b) => /^clawd_(idle0|idle1|blink)/.test(b.name));
  assert.ok(clawdBox, 'Clawd sprite');
  assert.equal(clawdBox.w, 32);
  assert.equal(clawdBox.h, 24);
  assert.equal(clawdBox.x, 144);
  assert.equal(clawdBox.y, 70);
  assert.ok(!rec.sprites().some((b) => b.name === 'title_chev'), 'no hats, no hat row');
  assert.ok(!rec.texts().some((b) => b.str.startsWith('Best on desktop')), 'no small-screen note');
  assert.ok(!rec.texts().some((b) => b.y >= 94 && b.y < 109), 'nothing between Clawd and START when there is no hat row');
  assertCardLayout(env, rec, 'base');
});

test('title: the card is a dark translucent panel with a dim frame, drawn before the menu', () => {
  const env = setup();
  unlocked(env);
  const order = [];
  const rect = env.r.rect;
  env.r.rect = (x, y, w, h, c) => {
    if (w === 252) order.push('card:' + c);
    return rect.call(env.r, x, y, w, h, c);
  };
  const alpha = env.r.alpha;
  const alphas = [];
  env.r.alpha = (a, fn) => {
    alphas.push(a);
    return alpha.call(env.r, a, fn);
  };
  const frameFn = env.r.frame;
  env.r.frame = (x, y, w, h, c) => {
    if (w === 252) order.push('cardFrame:' + c);
    if (w === 104) order.push('start');
    return frameFn.call(env.r, x, y, w, h, c);
  };
  frame(env);
  const C = env.CB.Pal.C;
  assert.deepEqual(order, ['card:' + C.ink, 'cardFrame:' + C.greyDark, 'start']);
  assert.ok(alphas.includes(0.7), 'ink at about 0.7');
});

test('title: the START label never blinks; its frame pulses through Comfort.blink, at most once a second, and is steady in calm mode', () => {
  let calm = false;
  const calls = [];
  const env = setup({ prep: (e) => { e.CB.Comfort = { toggle: () => calm, calm: () => calm, blink: (t, hz) => { calls.push(hz); return Math.floor(t * hz) % 2 === 0; } }; } });
  unlocked(env);
  const colours = [];
  for (let i = 0; i < 1200; i++) {
    const rec = frame(env, i / 60);
    assert.ok(hasText(rec, 'Click to start'), 'the label is there at t=' + i / 60);
    colours.push(frameAt(env, env.title.START_BOX).color);
  }
  const C = env.CB.Pal.C;
  assert.deepEqual([...new Set(colours)].sort(), [C.clawd, C.clawdLight].sort(), 'two shades of the same orange');
  const flips = colours.filter((c, i) => i && c !== colours[i - 1]).length;
  assert.ok(flips >= 10, 'it does pulse: ' + flips + ' changes in 20 s');
  assert.ok(flips <= 40, 'at most one round trip a second: ' + flips + ' changes in 20 s');
  assert.ok(calls.some((hz) => hz <= 2), 'the pulse rate goes through Comfort.blink');
  calm = true;
  const steady = new Set();
  for (let i = 0; i < 300; i++) {
    frame(env, i / 60);
    steady.add(frameAt(env, env.title.START_BOX).color);
  }
  assert.equal(steady.size, 1, 'steady in calm mode');
});

test('title: START without a Comfort module still pulses, and a Comfort that cannot blink or tell calm does not break it', () => {
  const env = setup();
  unlocked(env);
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    frame(env, i / 60);
    seen.add(frameAt(env, env.title.START_BOX).color);
  }
  assert.equal(seen.size, 2);
  env.CB.Comfort = {};
  assert.doesNotThrow(() => frame(env, 0.2));
  env.CB.Comfort = { calm: () => false };
  assert.doesNotThrow(() => frame(env, 0.2));
});

test('title: the mouse brightens START (kbm only); a pad or phone never hovers', () => {
  const env = setup();
  unlocked(env);
  const C = env.CB.Pal.C;
  const START = env.title.START_BOX;
  env.aim = { x: START.x + 5, y: START.y + 5 };
  frame(env);
  assert.equal(frameAt(env, START).color, C.white, 'lit under the mouse');
  env.aim = { x: 5, y: 5 };
  frame(env);
  assert.notEqual(frameAt(env, START).color, C.white);
  env.aim = { x: START.x + 5, y: START.y + 5 };
  for (const dev of ['touch', 'pad']) {
    env.CB.Prompts.setDevice(dev);
    frame(env);
    assert.notEqual(frameAt(env, START).color, C.white, dev + ' has no hover');
  }
});

test('title: a click on START starts a normal run, honouring --yolo; so does a click anywhere else that is not a control', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const START = env.title.START_BOX;
  env.title.yolo = true;
  run(env, 1, H.makeInput({ tap: true, aimX: START.x + START.w / 2, aimY: START.y + START.h / 2 }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: true } }]);
  for (const [x, y] of [[10, 10], [300, 175], [160, 97], [40, 150], [280, 120]]) {
    env.title.enter(env.game, {});
    unlocked(env);
    run(env, 1, H.makeInput({ tap: true, aimX: x, aimY: y }));
    assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }], 'click at ' + x + ',' + y);
  }
});

test('title: the small-screen note is gone: a coarse pointer or a narrow window shows nothing extra', () => {
  for (const how of ['coarse', 'narrow']) {
    const env = setup({
      prep: (e) => {
        if (how === 'coarse') e.sandbox.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q), addEventListener() {} });
        else e.sandbox.innerWidth = 400;
      },
    });
    unlocked(env);
    const rec = frame(env);
    assert.ok(!hasText(rec, 'Best on desktop with keyboard + mouse'), how);
    assert.ok(!rec.texts().some((b) => b.y >= 94 && b.y < 109), how + ': nothing between Clawd and START');
  }
});

test('title: a matchMedia that throws or is missing is fine', () => {
  for (const mm of [() => { throw new Error('no'); }, undefined]) {
    const env = setup({ prep: (e) => { e.sandbox.matchMedia = mm; } });
    unlocked(env);
    assert.doesNotThrow(() => frame(env));
    assert.ok(!hasText(frame(env), 'Best on desktop with keyboard + mouse'));
  }
});

test('title: the chips show sound and music state and leave out a missing module', () => {
  // Was one centred status line ("M sound: on · N music: off"); each part is its own chip now and a missing module's chip is left out.
  const env = setup({ prep: (e) => { e.CB.Music = { stop() {}, isEnabled: () => false }; } });
  unlocked(env);
  const rec = frame(env);
  assert.ok(hasText(rec, 'M sound: on') && hasText(rec, 'N music: off'));
  env.CB.Audio.isMuted = () => true;
  assert.ok(hasText(frame(env), 'M sound: off') && hasText(frame(env), 'N music: off'));
  delete env.CB.Audio.isMuted;
  assert.ok(hasText(frame(env), 'N music: off'));
  assert.ok(!frame(env).texts().some((b) => b.str.includes('sound')));
  delete env.CB.Music.isEnabled;
  assert.ok(!frame(env).texts().some((b) => b.y === 160), 'no status row when no module can report');
});

test('title: without screens.js there are no chips and nothing breaks', () => {
  const env = setup({ files: [...BASE, 'src/core/prompts.js', 'src/scenes/title.js'], prep: (e) => { e.CB.Music = { stop() {}, isEnabled: () => false }; } });
  unlocked(env);
  assert.ok(!env.CB.Screens.toggles);
  assert.ok(!frame(env).texts().some((b) => b.y === 160));
  assert.doesNotThrow(() => run(env, 1, H.makeInput({ confirm: true, tap: true, aimX: 60, aimY: 163 })));
  assert.equal(env.visits.length, 1, 'a tap where the chips would be just starts the game');
});

test('title: worst-case layout (hats, modes, daily, toast, yolo, all three chips, the mouse sweeping every control) stays on screen, apart and inside the card', () => {
  const env = setup({
    files: [...BASE, ...ENEMIES, 'src/core/prompts.js', 'src/core/daily.js', 'src/scenes/screens.js', 'src/scenes/title.js'],
    prep: (e) => {
      e.sandbox.innerWidth = 400;
      e.CB.Music = { stop() {}, toggle() {}, isEnabled: () => false };
      e.CB.Audio.isMuted = () => true;
      e.CB.Comfort = { toggle: () => true, calm: () => false };
      e.CB.Art.defineSprite('hat_testbeanie', ['.kkkkkkkkk.', 'kBbBbBbBbBk', 'kbBbBbBbBbk', 'kkkkkkkkkkk', '...........', '...........']);
      e.CB.Player.drawHat = (r, x, y, id, facing, scale) => r.sprite('hat_testbeanie', x, y, { scale });
    },
  });
  const s = stubUnlocks(env, { modes: true, hats: HAT_NAMES.map((h) => h.id), worn: 'branch' });
  env.CB.Daily.record(env.CB.Daily.today(), { time: 90, deaths: 0 }); // 'daily build ✓'
  unlocked(env);
  run(env, 1, H.makeInput({ keys: ['KeyV'] }));
  // The mouse visits every control and the gaps between them, in turn.
  const B = env.title.BUTTONS;
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const spots = [...B.map(mid), mid(env.title.START_BOX), mid(env.title.HAT_LEFT), mid(env.title.HAT_RIGHT), { x: 82, y: 163 }, { x: 160, y: 163 }, { x: 5, y: 5 }];
  const seen = new Set();
  let sparks = 0;
  for (let i = 0; i < 1500; i++) {
    const at = spots[Math.floor(i / 15) % spots.length];
    env.title.yolo = Math.floor(i / 400) % 2 === 1; // --yolo ON for part of the run
    env.aim = at;
    run(env, 1, H.makeInput({ aimX: at.x, aimY: at.y }));
    if (i % 5 !== 0) continue;
    const t = i / 60;
    const rec = frame(env, t);
    assertCardLayout(env, rec, 'worst case at t=' + t);
    for (const b of rec.texts()) seen.add(b.str);
    sparks += rec.sprites().filter((b) => b.name.startsWith('title_spark')).length;
    if (i === 20) assert.ok(rec.sprites().some((b) => b.name === 'hat_testbeanie'));
  }
  assert.ok(sparks > 0, 'the spark flew at some point');
  for (const must of ['Click to start', 'boss rush', 'daily build ✓', '--yolo: off', '--yolo: ON', 'Branch beanie', 'M sound: off', 'N music: off', 'V calm: off',
    'WASD move · Mouse aim · Click shoot', 'Space dash · E /compact · Esc pause', 'all four bosses back to back', 'one seeded run a day, the same for everyone', '3 hearts, faster bullets: bragging rights', 'calm mode: on']) {
    assert.ok(seen.has(must), 'saw ' + must);
  }
  assert.ok(!seen.has('Best on desktop with keyboard + mouse'));
  assert.deepEqual(s.cycles, []);
  // The disclaimer comes back once the toast is gone.
  assert.ok(seen.has('Fan game. Not affiliated with Anthropic.'));
});

test('title: the real font keeps every card line inside the card with room to spare', () => {
  const env = setup();
  const w = (s) => env.r.measure(s, 1);
  const lines = [
    'WASD move · Mouse aim · Click shoot', 'Space dash · E /compact · Esc pause',
    'Left thumb move · Right thumb aim + shoot', 'DASH and /c buttons · II pause',
    'L-stick move · R-stick aim + shoot', 'A dash · RB /compact · Start pause',
    'all four bosses back to back', 'one seeded run a day, the same for everyone', '3 hearts, faster bullets: bragging rights',
    'LB Branch beanie RB',
  ];
  for (const s of lines) assert.ok(w(s) <= 240, s + ' is ' + w(s) + ' px, the card holds 250');
  assert.ok(w('Fan game. Not affiliated with Anthropic.') <= 300);
  // Every real hat name fits the 74 px name field, and the field with its chevrons and the widest key hints fits the hat row box.
  const real = setup({ files: [...FILES, 'src/game/unlocks.js'] }).CB.HATS;
  assert.ok(real.length >= 7);
  for (const h of real) assert.ok(w(h.name) <= 74, h.name + ' is ' + w(h.name) + ' px');
  assert.ok(w('LB') + 4 + 4 + 5 + 74 + 5 + 4 + 4 + w('RB') <= 168, 'the longest row, LB and RB either side, fits the 168 px hat box');
});

// ---- the description line, hover and focus ----------------------------------------------------------------------------------------

const DESCRIPTIONS = {
  rush: 'all four bosses back to back',
  daily: 'one seeded run a day, the same for everyone',
  yolo: '3 hearts, faster bullets: bragging rights',
};
const LEGEND = ['WASD move · Mouse aim · Click shoot', 'Space dash · E /compact · Esc pause'];

test('title: hovering a mode button shows what it does under the row, in place of the controls; moving off brings the controls back', () => {
  const env = setup({ files: DAILY_FILES });
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const C = env.CB.Pal.C;
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  let rec = frame(env);
  for (const l of LEGEND) assert.ok(hasText(rec, l), 'the legend by default: ' + l);
  assert.equal(textOf(rec, LEGEND[0]).y, 139);
  for (const b of env.title.BUTTONS) {
    env.aim = mid(b);
    rec = frame(env);
    const d = textOf(rec, DESCRIPTIONS[b.id]);
    assert.ok(d, b.id + ' description');
    assert.ok(d.w <= 240, 'fits the card');
    assert.ok(Math.abs(d.x + d.w / 2 - 160) <= 1, 'centred');
    assert.ok(d.y > b.y + b.h && d.y + d.h < 158, 'under the row and above the chips');
    for (const l of LEGEND) assert.ok(!hasText(rec, l), b.id + ' hides the legend');
    for (const other of Object.keys(DESCRIPTIONS)) if (other !== b.id) assert.ok(!hasText(rec, DESCRIPTIONS[other]));
    assert.equal(frameAt(env, b).color, C.gold, b.id + ' is lit');
    assertCardLayout(env, rec, 'hover ' + b.id);
  }
  env.aim = { x: 160, y: 40 };
  rec = frame(env);
  for (const l of LEGEND) assert.ok(hasText(rec, l), 'back to the legend');
  assert.ok(!Object.values(DESCRIPTIONS).some((d) => hasText(rec, d)));
});

test('title: the controls legend is dimmer than the buttons and the description; the disclaimer is dimmest', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const colours = [];
  const text = env.r.text;
  env.r.text = function (str, x, y, o) {
    colours.push([String(str), (o && o.color) || null]);
    return text.apply(this, arguments);
  };
  frame(env);
  const C = env.CB.Pal.C;
  const colour = (str) => colours.find((c) => c[0] === str)[1];
  for (const l of LEGEND) assert.equal(colour(l), C.grey, l);
  assert.equal(colour('boss rush'), C.pale);
  assert.equal(colour('Fan game. Not affiliated with Anthropic.'), C.greyDark);
  env.aim = { x: env.title.BUTTONS[0].x + 3, y: env.title.BUTTONS[0].y + 3 };
  colours.length = 0;
  frame(env);
  assert.equal(colour(DESCRIPTIONS.rush), C.pale, 'a description is a notch brighter than the legend it replaces');
});

test('title: a description needs its button: the daily one needs Daily, the others the modes unlock', () => {
  const env = setup({ files: DAILY_FILES });
  stubUnlocks(env, { modes: false });
  unlocked(env);
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  env.aim = mid(env.title.BUTTONS[0]); // where boss rush would be
  assert.ok(!hasText(frame(env), DESCRIPTIONS.rush), 'locked: no button, no description');
  env.aim = mid(env.title.BUTTONS[2]);
  assert.ok(hasText(frame(env), DESCRIPTIONS.daily), 'the daily build is always there');
  env.CB.Daily = undefined;
  assert.ok(!hasText(frame(env), DESCRIPTIONS.daily), 'no Daily, no button, no description');
  assert.ok(hasText(frame(env), LEGEND[0]));
});

test('title: a pad focus (title.focus) lights its button and shows its description; the scene starts and re-enters with none', () => {
  const env = setup({ files: DAILY_FILES });
  stubUnlocks(env, { modes: true });
  env.CB.Prompts.setDevice('pad');
  unlocked(env);
  assert.equal(env.title.focus, null);
  const C = env.CB.Pal.C;
  for (const id of ['rush', 'daily', 'yolo']) {
    env.title.focus = id;
    const rec = frame(env);
    assert.ok(hasText(rec, DESCRIPTIONS[id]), id);
    assert.equal(frameAt(env, env.title.BUTTONS.find((b) => b.id === id)).color, C.gold);
  }
  env.title.focus = null;
  assert.ok(hasText(frame(env), 'L-stick move · R-stick aim + shoot'), 'the pad legend');
  env.title.focus = 'rush';
  env.title.enter(env.game, {});
  assert.equal(env.title.focus, null);
  env.title.focus = 'nonsense';
  assert.doesNotThrow(() => frame(env));
  assert.ok(!Object.values(DESCRIPTIONS).some((d) => hasText(frame(env), d)), 'an unknown focus shows nothing');
});

test('title: a tap on --yolo (touch) or X (pad) keeps its description up for 2 s, then the controls come back', () => {
  for (const dev of ['touch', 'pad']) {
    const env = setup();
    stubUnlocks(env, { modes: true });
    env.CB.Prompts.setDevice(dev);
    unlocked(env);
    const yolo = env.title.BUTTONS.find((b) => b.id === 'yolo');
    assert.ok(!hasText(frame(env), DESCRIPTIONS.yolo), dev + ': nothing yet');
    if (dev === 'touch') run(env, 1, H.makeInput({ tap: true, aimX: yolo.x + 3, aimY: yolo.y + 3 }));
    else run(env, 1, H.makeInput({ pad: { x: true } }));
    assert.equal(env.title.yolo, true, dev);
    assert.ok(hasText(frame(env), DESCRIPTIONS.yolo), dev + ': the description shows');
    run(env, 100); // 1.67 s
    assert.ok(hasText(frame(env), DESCRIPTIONS.yolo), dev + ': still there at 1.7 s');
    run(env, 30); // 2.17 s
    const rec = frame(env);
    assert.ok(!hasText(rec, DESCRIPTIONS.yolo), dev + ': gone after 2 s');
    assert.ok(rec.texts().some((b) => b.y === 139), dev + ': the controls are back');
  }
});

test('title: the description timer is for --yolo only; a tap that starts a run or toggles a chip sets none', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  env.CB.Prompts.setDevice('touch');
  unlocked(env);
  run(env, 1, H.makeInput({ tap: true, aimX: 82, aimY: 163 })); // the sound chip
  assert.ok(!Object.values(DESCRIPTIONS).some((d) => hasText(frame(env), d)));
  run(env, 1, H.makeInput({ tap: true, aimX: 82, aimY: 131 })); // boss rush starts
  assert.equal(env.visits.length, 1);
  assert.equal(env.title.descT, 0);
});

test('title: --yolo ON is a red frame, doubled, with red text, and the label says ON; off is the plain grey button', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const C = env.CB.Pal.C;
  const Y = env.title.BUTTONS.find((b) => b.id === 'yolo');
  frame(env);
  const nestedAround = (b) => env.frames.find((f) => f.x === b.x - 1 && f.y === b.y - 1 && f.w === b.w + 2 && f.h === b.h + 2);
  assert.equal(frameAt(env, Y).color, C.grey);
  assert.ok(!nestedAround(Y), 'off: a single frame');
  env.title.yolo = true;
  const rec = frame(env);
  assert.equal(frameAt(env, Y).color, C.red, 'on: red frame');
  assert.ok(nestedAround(Y), 'on: and a second frame around it, so the cue is not colour only');
  assert.equal(nestedAround(Y).color, C.red);
  assert.ok(hasText(rec, '--yolo: ON') && !hasText(rec, '--yolo: off'));
  const texts = [];
  const text = env.r.text;
  env.r.text = function (str, x, y, o) {
    texts.push([String(str), o && o.color]);
    return text.apply(this, arguments);
  };
  frame(env);
  assert.equal(texts.find((t) => t[0] === '--yolo: ON')[1], C.red, 'red text');
  assert.equal(texts.find((t) => t[0] === 'boss rush')[1], C.pale, 'the other buttons stay plain');
  assertCardLayout(env, frame(env), 'yolo on');
  // The second frame stays in the gap: the daily button's frame and the doubled one do not meet.
  const daily = env.title.BUTTONS.find((b) => b.id === 'daily');
  assert.ok(Y.x - 1 > daily.x + daily.w, 'a gap to the daily button');
});

test('title: pad labels name their button in front: Y boss rush, B daily build, X --yolo; the others do not', () => {
  const env = setup({ files: DAILY_FILES });
  stubUnlocks(env, { modes: true });
  unlocked(env);
  for (const [dev, rush, daily, yolo] of [['pad', 'Y boss rush', 'B daily build', 'X --yolo: off'], ['kbm', 'boss rush', 'daily build', '--yolo: off'], ['touch', 'boss rush', 'daily build', '--yolo: off']]) {
    env.CB.Prompts.setDevice(dev);
    const rec = frame(env);
    for (const l of [rush, daily, yolo]) assert.ok(hasText(rec, l), dev + ' ' + l);
    assertCardLayout(env, rec, dev);
  }
  env.CB.Prompts.setDevice('pad');
  env.title.yolo = true;
  assert.ok(hasText(frame(env), 'X --yolo: ON'));
});

test('title: with the modes locked only the daily build shows, centred in the middle column; without Daily the row is empty', () => {
  const env = setup({ files: DAILY_FILES });
  stubUnlocks(env, { modes: false });
  unlocked(env);
  const rec = frame(env);
  const d = textOf(rec, 'daily build');
  assert.ok(d);
  assert.ok(Math.abs(d.x + d.w / 2 - 160) <= 1, 'centred');
  assert.equal(env.frames.filter((f) => f.y === 125).length, 1, 'one button frame in the row');
  env.CB.Daily = undefined;
  const bare = frame(env);
  assert.ok(!bare.texts().some((b) => b.y >= 123 && b.y < 137));
  assert.equal(env.frames.filter((f) => f.y === 125).length, 0);
});

// ---- hat arrows ---------------------------------------------------------------------------------------------------------------------

test('title: a tap on the left of the hat row wears the previous hat; the name, the right arrow and the rest of the row the next', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: ['loopcap', 'halo'], worn: 'loopcap' });
  unlocked(env);
  const { HAT_BOX, HAT_LEFT, HAT_RIGHT } = env.title;
  const tap = (x, y) => run(env, 1, H.makeInput({ tap: true, aimX: x, aimY: y }));
  tap(HAT_LEFT.x + 2, HAT_LEFT.y + 2);
  tap(HAT_LEFT.x + HAT_LEFT.w - 1, HAT_LEFT.y + HAT_LEFT.h - 1);
  assert.deepEqual(s.cycles, [-1, -1]);
  tap(HAT_RIGHT.x, HAT_RIGHT.y);
  tap(160, HAT_BOX.y + 5); // the name
  tap(HAT_BOX.x + HAT_BOX.w - 1, HAT_BOX.y + 5); // the E
  assert.deepEqual(s.cycles, [-1, -1, 1, 1, 1]);
  assert.equal(env.visits.length, 0, 'none of these starts the game');
  assert.deepEqual(env.sounds, Array(5).fill('uiSelect'));
  // Just outside the row box above, below, left and right: a start.
  for (const [x, y] of [[160, HAT_BOX.y - 1], [HAT_BOX.x - 1, HAT_BOX.y + 5], [HAT_BOX.x + HAT_BOX.w, HAT_BOX.y + 5]]) {
    env.title.enter(env.game, {});
    unlocked(env);
    tap(x, y);
    assert.equal(env.visits.pop()[0], 'play', 'a tap at ' + x + ',' + y + ' starts');
  }
  assert.deepEqual(s.cycles, [-1, -1, 1, 1, 1], 'and cycled nothing');
});

test('title: with the chevron under the mouse it goes white; only on the keyboard and mouse', () => {
  const env = setup();
  stubUnlocks(env, { hats: ['loopcap', 'halo'], worn: 'halo' });
  unlocked(env);
  const whites = [];
  const sprite = env.r.sprite;
  env.r.sprite = function (name, x, y, o) {
    if (name === 'title_chev') whites.push({ x, flip: !!(o && o.flip), white: !!(o && o.white) });
    return sprite.apply(this, arguments);
  };
  const { HAT_LEFT, HAT_RIGHT } = env.title;
  const lit = () => {
    whites.length = 0;
    frame(env);
    return [whites.find((w) => !w.flip).white, whites.find((w) => w.flip).white];
  };
  env.aim = { x: 5, y: 5 };
  assert.deepEqual(lit(), [false, false]);
  env.aim = { x: HAT_LEFT.x + 5, y: HAT_LEFT.y + 5 };
  assert.deepEqual(lit(), [true, false]);
  env.aim = { x: HAT_RIGHT.x + 5, y: HAT_RIGHT.y + 5 };
  assert.deepEqual(lit(), [false, true]);
  env.CB.Prompts.setDevice('touch');
  assert.deepEqual(lit(), [false, false], 'a finger does not hover');
});

test('title: a toast takes the disclaimer row with its ink band under the card and never covers a button', () => {
  const env = setup();
  stubUnlocks(env, { modes: true, hats: ['loopcap'], worn: 'loopcap' });
  unlocked(env);
  env.title.notify('controller connected');
  const bands = [];
  const rect = env.r.rect;
  env.r.rect = function (x, y, w, h, c) {
    if (w === 320 && h < 180) bands.push({ x, y, w, h, c });
    return rect.apply(this, arguments);
  };
  const rec = frame(env);
  const t = textOf(rec, 'controller connected');
  assert.equal(t.y, 173);
  assert.equal(bands.length, 1);
  const band = bands[0];
  assert.equal(band.y, env.title.CARD.bottom, 'the band starts where the card ends');
  assert.equal(band.y + band.h, 180);
  assert.ok(inBox(t, band), 'the toast is on its band');
  assert.ok(!hasText(rec, 'Fan game. Not affiliated with Anthropic.'));
  for (const f of env.frames) assert.ok(f.y + f.h <= band.y, 'no frame reaches the band: ' + JSON.stringify(f));
  for (const c of env.CB.Screens.toggles.boxes(160)) assert.ok(c.y + c.h <= band.y, 'the chips sit above the band');
  assertCardLayout(env, rec, 'toast');
});

// ---- background, cursor, wanderers ----------------------------------------------------------------------------------------------

test('title: draws the src arena dimmed, and the pointer cursor last', () => {
  const env = setup();
  unlocked(env);
  const order = [];
  const arenaDraw = env.CB.Arena.draw;
  env.CB.Arena.draw = (r, stage, t) => {
    order.push('arena');
    arenaDraw(r, stage, t);
  };
  const rect = env.r.rect;
  env.r.rect = (x, y, w, h, c) => {
    if (w === 320 && h === 180) order.push('dim:' + c);
    return rect.call(env.r, x, y, w, h, c);
  };
  const alpha = env.r.alpha;
  const alphas = [];
  env.r.alpha = (a, fn) => {
    alphas.push(a);
    return alpha.call(env.r, a, fn);
  };
  const cursorDraw = env.CB.Screens.hud.cursor;
  env.CB.Screens.hud.cursor = (...args) => {
    order.push('cursor');
    return cursorDraw(...args);
  };
  env.aim = { x: 123, y: 45 };
  frame(env, 0.4);
  assert.deepEqual(env.arena[0].stage, { id: 'title', palette: 'src' });
  assert.equal(env.arena[0].t, 0.4);
  assert.equal(order[0], 'arena');
  assert.equal(order[1], 'dim:' + env.CB.Pal.C.ink);
  assert.ok(alphas.includes(0.55));
  assert.equal(order.at(-1), 'cursor');
  assert.deepEqual(env.cursor.at(-1), { x: 123, y: 45, mode: 'pointer', t: 0.4 });
});

test('title: draws with no Arena and no hud (they belong to other tasks)', () => {
  const env = setup();
  env.CB.Arena = undefined;
  env.CB.Screens.hud = undefined;
  unlocked(env);
  assert.doesNotThrow(() => frame(env));
  env.game.input = {};
  assert.doesNotThrow(() => frame(env));
});

test('title: four bugs wander on the right, always fully on screen, identically for the same inputs', () => {
  const sig = () => {
    const env = setup({ files: [...BASE, ...ENEMIES, 'src/scenes/title.js'] });
    unlocked(env);
    const out = [];
    for (let i = 0; i < 3600; i++) {
      run(env, 1);
      if (i % 30) continue;
      const rec = frame(env, i / 60);
      assert.deepEqual(rec.outside(), [], 'tick ' + i);
      const bugs = rec.sprites().filter((b) => /^(syntaxError|raceCondition|memoryLeak|nullPointer)_/.test(b.name));
      assert.equal(bugs.length, 4, 'four bugs at tick ' + i);
      assert.deepEqual(bugs.map((b) => b.name.split('_')[0]).sort(), ['memoryLeak', 'nullPointer', 'raceCondition', 'syntaxError']);
      for (const b of bugs) assert.ok(b.x > 200, 'right of the logo: ' + b.name + ' at x ' + b.x);
      out.push(bugs.map((b) => [b.name, b.x, b.y].join(':')).join('|'));
    }
    return out;
  };
  const a = sig();
  const b = sig();
  assert.deepEqual(a, b);
  assert.ok(new Set(a).size > 20, 'they actually move');
});

test('title: without the enemy sprites the bugs are plain discs', () => {
  const env = setup();
  unlocked(env);
  let discs = 0;
  const disc = env.r.disc;
  env.r.disc = (...args) => {
    discs++;
    return disc.apply(env.r, args);
  };
  frame(env, 1);
  assert.ok(discs >= 4, 'discs: ' + discs);
});

test('title: Clawd fires a spark about every 2 s; it flies right and makes a bug flash white', () => {
  const env = setup({ files: [...BASE, ...ENEMIES, 'src/scenes/title.js'] });
  const sparkX = [];
  let whites = 0;
  let seenNow = false;
  const sprite = env.r.sprite;
  env.r.sprite = function (name, x, y, o) {
    if (name.startsWith('title_spark')) {
      sparkX.push(x);
      seenNow = true;
    }
    if (o && o.white && /^(syntaxError|raceCondition|memoryLeak|nullPointer)_/.test(name)) whites++;
    return sprite.apply(this, arguments);
  };
  const flights = []; // the tick each flight is first drawn
  for (let tick = 0; tick < 60 * 9; tick++) {
    run(env, 1);
    seenNow = false;
    frame(env, tick / 60);
    if (seenNow && (!flights.length || tick - flights[flights.length - 1] > 60)) flights.push(tick);
  }
  assert.ok(flights.length >= 3 && flights.length <= 5, 'flights in 9 s: ' + flights.length);
  for (let i = 1; i < flights.length; i++) assert.ok(Math.abs(flights[i] - flights[i - 1] - 120) <= 30, 'about 2 s apart');
  assert.ok(whites > 0, 'a bug flashed white when hit');
  assert.ok(sparkX.every((x) => x >= 150), 'always to the right of Clawd');
});

test('title: the spark twinkle goes through Comfort.blink, so calm mode slows it', () => {
  const hz = [];
  let steady = false;
  const env = setup({ prep: (e) => { e.CB.Comfort = { toggle: () => false, calm: () => steady, blink: (t, f) => { hz.push(f); return steady ? true : Math.floor(t * f) % 2 === 0; } }; } });
  const names = new Set();
  const sprite = env.r.sprite;
  env.r.sprite = function (name) {
    if (name.startsWith('title_spark')) names.add(name);
    return sprite.apply(this, arguments);
  };
  for (let tick = 0; tick < 120; tick++) {
    run(env, 1);
    frame(env, tick / 60);
  }
  const sparkHz = hz.filter((f) => f >= 10); // START's frame pulse asks for its own, slow rate
  assert.ok(sparkHz.length > 0 && sparkHz.every((f) => f === 20), 'blink hz ' + [...new Set(hz)]);
  assert.deepEqual([...names].sort(), ['title_spark0', 'title_spark1']);
  names.clear();
  steady = true; // calm: the stub holds one frame
  for (let tick = 120; tick < 240; tick++) {
    run(env, 1);
    frame(env, tick / 60);
  }
  assert.deepEqual([...names], ['title_spark0']);
});

test('title: the spark sprites are 9x9 outlined two-shade pixel art with a closed outline', () => {
  const env = setup();
  const frames = [env.CB.Art.spriteDef('title_spark0'), env.CB.Art.spriteDef('title_spark1')];
  for (const d of frames) {
    assert.ok(d, 'defined');
    assert.equal(d.w, 9);
    assert.equal(d.h, 9);
    const colours = new Set();
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const c = d.rows[y][x];
        if (c === '.') continue;
        if (c !== 'k') colours.add(c);
        if (c === 'k') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = d.rows[y + dy] && d.rows[y + dy][x + dx];
          assert.ok(n && n !== '.', 'the outline is open next to ' + c + ' at ' + x + ',' + y);
        }
      }
    }
    assert.ok(colours.size >= 3, 'at least a hot centre and two shades: ' + [...colours].join(''));
  }
  const mask = (d) => d.rows.map((row) => row.replace(/[^.]/g, '#')).join('/');
  assert.equal(mask(frames[0]), mask(frames[1]), 'the twinkle swaps colours, not the silhouette');
  assert.notDeepEqual(H.plain(frames[0].rows), H.plain(frames[1].rows));
});

test('title: real Unlocks and Secrets end to end: konami adds the halo, E wears it, the label follows', () => {
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const env = setup({ files: [...FILES, 'src/game/unlocks.js'], localStorage: store });
  unlocked(env);
  assert.ok(!frame(env).sprites().some((b) => b.name === 'title_chev'), 'no hat, no hat row');
  run(env, KONAMI.length, (i) => H.makeInput({ keys: [KONAMI[i]] }));
  assert.ok(env.CB.Unlocks.has('halo'));
  assert.ok(hasText(frame(env), 'none'));
  run(env, 1, H.makeInput({ compact: true }));
  assert.equal(env.CB.Unlocks.hat(), 'halo');
  assert.ok(hasText(frame(env), 'Halo'));
  run(env, 1, H.makeInput({ quit: true }));
  assert.equal(env.CB.Unlocks.hat(), null);
  // Typing ultrathink's letters never touches the worn hat (no Q or E in it).
  run(env, 1, H.makeInput({ compact: true }));
  run(env, ULTRA.length, (i) => H.makeInput({ keys: [ULTRA[i]] }));
  assert.ok(env.CB.Unlocks.has('rainbow'));
  assert.equal(env.CB.Unlocks.hat(), 'halo');
  assert.ok(env.visits.length === 0);
});
