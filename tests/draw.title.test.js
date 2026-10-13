'use strict';
// Title scene: start flow, secrets, hats, modes, music and calm keys, and the Rev 3 layout (recorder-checked).
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
  env.title.draw(env.r, t == null ? 0.3 : t);
  return env.rec;
}

const textOf = (rec, s) => rec.texts().find((b) => b.str === s);
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
  assert.equal(t.y, 160);
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

test('title: the hat label names the worn hat (or none) and the hat is drawn above Clawd at scale 2', () => {
  const env = setup();
  const s = stubUnlocks(env, { hats: ['branch', 'halo'], worn: 'branch' });
  const calls = [];
  env.CB.Player.drawHat = (r, x, y, id, facing, scale) => calls.push({ x, y, id, facing, scale });
  unlocked(env);
  const rec = frame(env);
  const label = textOf(rec, 'hat: Branch beanie (Q/E)');
  assert.ok(label, 'label');
  assert.equal(label.y, 105);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'branch');
  assert.equal(calls[0].x, 160);
  assert.equal(calls[0].scale, 2);
  assert.equal(calls[0].facing, 1);
  assert.ok(calls[0].y >= 58 && calls[0].y <= 74, 'above the head: ' + calls[0].y);
  s.worn = null;
  calls.length = 0;
  const bare = frame(env);
  assert.ok(hasText(bare, 'hat: none (Q/E)'));
  assert.equal(calls.length, 0, 'no hat, no drawHat');
});

test('title: a missing drawHat or HATS table is fine', () => {
  const env = setup();
  stubUnlocks(env, { hats: ['halo'], worn: 'halo' });
  env.CB.HATS = undefined;
  delete env.CB.Player.drawHat;
  unlocked(env);
  assert.ok(hasText(frame(env), 'hat: halo (Q/E)'));
});

// ---- modes ----------------------------------------------------------------------------------------------------------------------

test('title: BUTTONS exposes rush and yolo hit boxes that hold the drawn labels', () => {
  const env = setup();
  const B = env.title.BUTTONS;
  assert.deepEqual(B.map((b) => b.id), ['rush', 'yolo']);
  for (const b of B) for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(b[k]), b.id + '.' + k);
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const rec = frame(env);
  const rush = textOf(rec, '[ boss rush ]');
  const yolo = textOf(rec, '[ ] --yolo');
  assert.ok(rush && yolo);
  assert.ok(inBox(rush, B[0]), 'rush label inside its box');
  assert.ok(inBox(yolo, B[1]), 'yolo label inside its box');
  assert.ok(Math.abs(rush.x + rush.w / 2 - 110) <= 1);
  assert.ok(Math.abs(yolo.x + yolo.w / 2 - 220) <= 1);
  assert.equal(rush.y, 124);
  assert.equal(yolo.y, 124);
  assert.ok(B[0].x + B[0].w < B[1].x, 'boxes do not touch');
});

test('title: confirm inside rush starts boss rush; inside yolo toggles; elsewhere starts a normal run', () => {
  const env = setup();
  stubUnlocks(env, { modes: true });
  unlocked(env);
  const [rush, yolo] = env.title.BUTTONS;
  const at = (b) => H.makeInput({ confirm: true, aimX: b.x + b.w / 2, aimY: b.y + b.h / 2 });
  run(env, 1, at(yolo));
  assert.equal(env.visits.length, 0, 'the toggle does not start the run');
  assert.ok(hasText(frame(env), '[x] --yolo'));
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
  assert.ok(hasText(frame(env), '[ ] --yolo'), 'toggled back off');
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
  assert.equal(t.y, 160);
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

// ---- layout (Rev 3 table) -------------------------------------------------------------------------------------------------------

test('title: base layout puts every line at its Rev 3 row', () => {
  const env = setup({ prep: (e) => { e.CB.Music = { stop() {}, toggle() {}, isEnabled: () => true }; } });
  unlocked(env);
  const rec = frame(env, 0.3); // blink on
  const row = (s) => {
    const b = textOf(rec, s);
    assert.ok(b, 'missing ' + JSON.stringify(s));
    return b;
  };
  assert.equal(row('vs').y, 27);
  assert.equal(row('Click to start').y, 114);
  assert.equal(row('WASD move · Mouse aim · Click shoot · Space dash').y, 138);
  assert.equal(row('E /compact · N music · M mute · V calm · Esc pause').y, 147);
  assert.equal(row('Fan game. Not affiliated with Anthropic.').y, 160);
  // The status row is the sound / music / calm chips now (was one centred line); calm has no module in this test, so it has no chip.
  assert.equal(row('M sound: on').y, 170);
  assert.equal(row('N music: on').y, 170);
  assert.ok(!rec.texts().some((b) => b.str.startsWith('V calm')));
  assert.ok(Math.abs(row('M sound: on').x + row('M sound: on').w / 2 - (45 + 37)) <= 1, 'sound is centred in the first chip');
  assert.ok(Math.abs(row('N music: on').x + row('N music: on').w / 2 - (123 + 37)) <= 1, 'music is centred in the second chip');
  for (const s of ['vs', 'Click to start', 'WASD move · Mouse aim · Click shoot · Space dash', 'Fan game. Not affiliated with Anthropic.']) {
    const b = row(s);
    assert.ok(Math.abs(b.x + b.w / 2 - 160) <= 1, s + ' is centred');
  }
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
  assert.ok(!rec.texts().some((b) => b.str.startsWith('hat:')), 'no hats, no hat row');
  assert.ok(!rec.texts().some((b) => b.str.startsWith('Best on desktop')), 'no small-screen note');
  assert.ok(!rec.texts().some((b) => b.y === 96), 'its row 96 is empty');
  assert.deepEqual(rec.outside(), []);
  assert.deepEqual(rec.overlaps(), []);
});

test('title: Click to start blinks 0.6 s on, 0.3 s off', () => {
  const env = setup();
  unlocked(env);
  const on = (t) => hasText(frame(env, t), 'Click to start');
  assert.equal(on(0), true);
  assert.equal(on(0.59), true);
  assert.equal(on(0.61), false);
  assert.equal(on(0.89), false);
  assert.equal(on(0.91), true);
  assert.equal(on(1.45), true);
  assert.equal(on(1.55), false);
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
    assert.ok(!rec.texts().some((b) => b.y === 96), how + ': row 96 stays empty');
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
  assert.ok(!frame(env).texts().some((b) => b.y === 170), 'no status row when no module can report');
});

test('title: without screens.js there are no chips and nothing breaks', () => {
  const env = setup({ files: [...BASE, 'src/core/prompts.js', 'src/scenes/title.js'], prep: (e) => { e.CB.Music = { stop() {}, isEnabled: () => false }; } });
  unlocked(env);
  assert.ok(!env.CB.Screens.toggles);
  assert.ok(!frame(env).texts().some((b) => b.y === 170));
  assert.doesNotThrow(() => run(env, 1, H.makeInput({ confirm: true, tap: true, aimX: 60, aimY: 171 })));
  assert.equal(env.visits.length, 1, 'a tap where the chips would be just starts the game');
});

test('title: worst-case layout (hats, modes, toast, all three chips) stays on screen with disjoint text', () => {
  const env = setup({
    files: [...BASE, ...ENEMIES, 'src/core/prompts.js', 'src/scenes/screens.js', 'src/scenes/title.js'],
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
  unlocked(env);
  run(env, 1, H.makeInput({ keys: ['KeyV'] }));
  const seen = new Set();
  let sparks = 0;
  for (let i = 0; i < 1500; i++) {
    run(env, 1, H.makeInput({ aimX: 100 + (i % 120), aimY: 100 + (i % 50) }));
    if (i % 5 !== 0) continue;
    const t = i / 60;
    const rec = frame(env, t);
    assert.deepEqual(rec.outside(), [], 'on screen at t=' + t);
    assert.deepEqual(rec.overlaps().map((p) => [p[0].str, p[1].str]), [], 'disjoint text at t=' + t);
    for (const b of rec.texts()) seen.add(b.str);
    sparks += rec.sprites().filter((b) => b.name.startsWith('title_spark')).length;
    if (i === 20) assert.ok(rec.sprites().some((b) => b.name === 'hat_testbeanie'));
  }
  assert.ok(sparks > 0, 'the spark flew at some point');
  for (const must of ['Click to start', '[ boss rush ]', 'hat: Branch beanie (Q/E)', 'M sound: off', 'N music: off', 'V calm: off']) assert.ok(seen.has(must), must);
  assert.ok(!seen.has('Best on desktop with keyboard + mouse'));
  assert.deepEqual(s.cycles, []);
  // The disclaimer comes back once the toast is gone.
  assert.ok(seen.has('Fan game. Not affiliated with Anthropic.'));
});

test('title: the real font keeps every line inside 320 px with room to spare', () => {
  const env = setup();
  const w = (s) => env.r.measure(s, 1);
  for (const s of ['WASD move · Mouse aim · Click shoot · Space dash', 'E /compact · N music · M mute · V calm · Esc pause', 'Fan game. Not affiliated with Anthropic.']) {
    assert.ok(w(s) <= 300, s + ' is ' + w(s));
  }
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
  assert.ok(hz.length > 0 && hz.every((f) => f === 20), 'blink hz ' + [...new Set(hz)]);
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
  assert.ok(!frame(env).texts().some((b) => b.str.startsWith('hat:')));
  run(env, KONAMI.length, (i) => H.makeInput({ keys: [KONAMI[i]] }));
  assert.ok(env.CB.Unlocks.has('halo'));
  assert.ok(hasText(frame(env), 'hat: none (Q/E)'));
  run(env, 1, H.makeInput({ compact: true }));
  assert.equal(env.CB.Unlocks.hat(), 'halo');
  assert.ok(hasText(frame(env), 'hat: Halo (Q/E)'));
  run(env, 1, H.makeInput({ quit: true }));
  assert.equal(env.CB.Unlocks.hat(), null);
  // Typing ultrathink's letters never touches the worn hat (no Q or E in it).
  run(env, 1, H.makeInput({ compact: true }));
  run(env, ULTRA.length, (i) => H.makeInput({ keys: [ULTRA[i]] }));
  assert.ok(env.CB.Unlocks.has('rainbow'));
  assert.equal(env.CB.Unlocks.hat(), 'halo');
  assert.ok(env.visits.length === 0);
});
