'use strict';
// T4a: the play scene per device. The touch layer follows the screen (setTouchMode), the pause screen has focusable chips and a tap
// map, the patch pick takes a pad/keyboard focus, the game over screen has a tap-to-quit line, haptics and host toasts are wired,
// and the cursor / crosshair / on-screen controls are drawn per device. screens.js (T4b) and input.js (T3) are stubbed here.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const IDS = ['sound', 'music', 'calm'];
const QUIT_BOX = { x: 110, y: 150, w: 100, h: 10 };
const OVER_QUIT_BOX = { x: 100, y: 133, w: 120, h: 11 };
const padBtns = (over) => Object.assign({ a: false, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false }, over || {});

// The scene with stubbed screens and a recording host. over.files: extra scripts; over.noToggles / noBoxes / noInputExtras trim the stubs.
function setup(over) {
  const o = over || {};
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', ...(o.files || []), 'src/scenes/play.js', 'src/main.js');
  const log = [];
  const played = [];
  CB.Audio = { play: (n) => { played.push(n); log.push('audio:' + n); }, handleEvents: () => log.push('audio:events'), init() {}, toggleMute() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    if (!CB.Enemies[k]) CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const applied = [];
  const hitArgs = [];
  const boxArgs = [];
  CB.Screens.patchPick = { cardAt: (x, y) => (y >= 30 && y < 150 ? (x < 100 ? 0 : x < 220 ? 1 : 2) : -1), draw() {} };
  const chips = (y0) => IDS.slice(0, o.chips || 3).map((id, i) => ({ id, x: 45 + 78 * i, y: y0 - 2, w: 74, h: 11 }));
  if (!o.noToggles) {
    CB.Screens.toggles = {
      IDS,
      boxes: (y0) => { boxArgs.push(y0); return chips(y0); },
      hit: (x, y, y0) => {
        hitArgs.push(y0);
        const b = chips(y0).find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
        return b ? b.id : null;
      },
      apply: (id) => { applied.push(id); return true; },
      label: (id) => id,
      draw() {},
    };
  }
  CB.Screens.pause = Object.assign({ draw() { log.push('pause'); }, CHIPS_Y: 66 }, o.noBoxes ? {} : { QUIT_BOX });
  CB.Screens.gameOver = Object.assign({ draw() {} }, o.noBoxes ? {} : { QUIT_BOX: OVER_QUIT_BOX });
  const modes = [];
  const rumbles = [];
  const input = { device: o.device === undefined ? 'kbm' : o.device, peekAim: () => ({ x: 30, y: 40 }) };
  if (!o.noInputExtras) {
    input.setTouchMode = (m) => { modes.push(m); log.push('mode:' + m); };
    input.rumble = (...a) => rumbles.push(a);
    input.touchView = () => ({ mode: 'sticks', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false });
  }
  const visits = [];
  const game = { debug: { speed: 1 }, input, go(name, data) { visits.push([name, data]); log.push('go:' + name); } };
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1, skipWaves: o.skipWaves !== false } });
  return { CB, play, game, input, log, played, applied, hitArgs, boxArgs, modes, rumbles, visits };
}
const tick = (s, n, inp) => {
  for (let i = 0; i < (n || 1); i++) s.play.update(s.CB.DT, inp || H.makeInput());
};
const in_ = (over) => H.makeInput(over);
const pause = (s) => tick(s, 1, in_({ pause: true }));

// Runs the scene to the patch pick (stops on the tick that made it; the NEXT update is the one that sees it).
function toPatchPick(s) {
  const { CB, play } = s;
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  for (let i = 0; i < 1200 && play.run.state !== 'patchPick'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'patchPick');
}
function toDead(s) {
  const { CB, play } = s;
  const run = play.run;
  run.world.player.hearts = 1;
  assert.equal(run.world.hurtPlayer(null), true);
  for (let i = 0; i < 400 && run.state !== 'dead'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(run.state, 'dead');
}
const afterLock = (s) => {
  while (s.play.run.stateT < s.CB.RUN_T.inputLock + 0.05) tick(s, 1);
};

// ---- the touch layer follows the screen ---------------------------------------------------------------------------

test('touch mode: a fight is "sticks"; pause, patch pick, game over and victory are "menu"', () => {
  const s = setup();
  const { play } = s;
  play.run.spawner = { update() {}, done: false }; // a hand-set 'wave' state needs one to step
  for (const state of ['stageIntro', 'wave', 'waveBreak', 'bossWarn', 'boss', 'bossDead', 'dying']) {
    play.run.state = state;
    s.modes.length = 0;
    tick(s, 1);
    assert.deepEqual(s.modes, ['sticks'], state);
  }
  for (const state of ['patchPick', 'dead', 'victory']) {
    play.run.state = state;
    play.run.stateT = 0;
    s.modes.length = 0;
    tick(s, 1);
    assert.deepEqual(s.modes, ['menu'], state);
  }
  play.run.state = 'wave';
  play.paused = true;
  s.modes.length = 0;
  tick(s, 1);
  assert.deepEqual(s.modes, ['menu'], 'paused, whatever the state');
});

test('touch mode: set once per update, first of everything, from the state the update starts in', () => {
  const s = setup();
  const { play } = s;
  tick(s, 1);
  assert.deepEqual(s.modes, ['sticks']);
  s.log.length = 0;
  pause(s);
  assert.equal(play.paused, true);
  assert.deepEqual(s.log.slice(0, 2), ['mode:sticks', 'audio:uiSelect'], 'the mode goes in before the pause sound: it is the first thing update does');
  assert.equal(s.modes.length, 2, 'one call per update');
  tick(s, 1);
  assert.equal(s.modes[2], 'menu', 'the next update sees the pause and switches the touch layer to taps');
  tick(s, 1, in_({ pause: true }));
  assert.equal(play.paused, false);
  assert.equal(s.modes[3], 'menu', 'resuming: this update started paused');
  tick(s, 1);
  assert.equal(s.modes[4], 'sticks');
});

test('touch mode: the mode is set before an early return or leave()', () => {
  const s = setup();
  const { play } = s;
  pause(s);
  s.log.length = 0;
  tick(s, 1, in_({ quit: true })); // arms
  tick(s, 1, in_({ quit: true })); // leaves
  assert.deepEqual(s.log, ['mode:menu', 'mode:menu', 'go:title']);
  const d = setup();
  toDead(d);
  afterLock(d);
  d.log.length = 0;
  tick(d, 1, in_({ quit: true }));
  assert.deepEqual(d.log, ['mode:menu', 'go:title'], 'dead + quit');
  const v = setup();
  v.play.run.state = 'victory';
  v.play.run.stateT = 2;
  v.log.length = 0;
  tick(v, 1, in_({ confirm: true }));
  assert.deepEqual(v.log, ['mode:menu', 'go:title'], 'victory + confirm');
});

test('touch mode: a host without setTouchMode, device or extras still plays', () => {
  const s = setup({ noInputExtras: true });
  assert.doesNotThrow(() => tick(s, 5));
  s.game.input = { peekAim: () => ({ x: 0, y: 0 }) };
  assert.doesNotThrow(() => tick(s, 5, in_({ pause: true })));
  s.game.input = {};
  assert.doesNotThrow(() => tick(s, 5));
  assert.equal(s.play.device(), 'kbm');
  for (const d of [undefined, null, 'gyro', 3, '']) {
    s.game.input = { device: d, peekAim: () => ({ x: 0, y: 0 }) };
    assert.equal(s.play.device(), 'kbm', String(d));
  }
  s.game.input = { device: 'pad' };
  assert.equal(s.play.device(), 'pad');
  s.game.input = { device: 'touch' };
  assert.equal(s.play.device(), 'touch');
});

test('input flow: the stick aim fields reach the run, and extra debug-speed ticks lose the new edges too', () => {
  const s = setup();
  s.game.debug.speed = 3;
  const seen = [];
  const real = s.play.run.step;
  s.play.run.step = function (inp) { seen.push(inp); return real.call(this, inp); };
  const pad = padBtns({ a: true });
  tick(s, 1, in_({ aimDirX: 0, aimDirY: -1, aimAssist: true, navX: 1, navY: -1, tap: true, pad, confirm: true, fire: true }));
  assert.equal(seen.length, 3);
  assert.equal(seen[0].aimDirY, -1);
  assert.equal(seen[0].navX, 1);
  assert.equal(seen[0].tap, true);
  assert.equal(seen[0].pad, pad);
  for (const i of [1, 2]) {
    assert.equal(seen[i].navX, 0);
    assert.equal(seen[i].navY, 0);
    assert.equal(seen[i].tap, false);
    assert.equal(seen[i].pad, null);
    assert.equal(seen[i].confirm, false);
    assert.equal(seen[i].aimDirY, -1, 'the aim stays, only the edges go');
    assert.equal(seen[i].aimAssist, true);
    assert.equal(seen[i].fire, true);
  }
});

// ---- the pause screen -----------------------------------------------------------------------------------------------

test('pause chips: nav moves the focus over the chips with wrap and starts the focus ring', () => {
  const s = setup();
  const { play } = s;
  pause(s);
  assert.equal(play.ui.pauseNav, false);
  assert.equal(play.ui.pauseFocus, 0);
  tick(s, 1);
  assert.equal(play.ui.pauseNav, false, 'time passing alone starts nothing');
  tick(s, 1, in_({ navX: 1 }));
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [true, 1]);
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(play.ui.pauseFocus, 2);
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(play.ui.pauseFocus, 0, 'wraps forward');
  tick(s, 1, in_({ navX: -1 }));
  assert.equal(play.ui.pauseFocus, 2, 'and back');
  tick(s, 1, in_({ navY: 1 }));
  assert.equal(play.ui.pauseFocus, 2, 'only the horizontal edges move a row of chips');
  assert.ok(s.boxArgs.length > 0 && s.boxArgs.every((y) => y === 66), 'laid out at the pause screen\'s CHIPS_Y');
});

test('pause chips: only the chips that exist take the focus (a missing module drops its chip), none at all without screens.js', () => {
  const two = setup({ chips: 2 });
  pause(two);
  tick(two, 1, in_({ navX: 1 }));
  tick(two, 1, in_({ navX: 1 }));
  assert.equal(two.play.ui.pauseFocus, 0, 'two chips: 0, 1, back to 0');
  tick(two, 1, in_({ navX: -1 }));
  assert.equal(two.play.ui.pauseFocus, 1);
  const none = setup({ noToggles: true });
  pause(none);
  tick(none, 1, in_({ navX: 1 }));
  assert.equal(none.play.ui.pauseNav, false);
  assert.equal(none.play.ui.pauseFocus, 0);
  assert.doesNotThrow(() => tick(none, 3, in_({ navX: 1, pad: padBtns({ a: true }), confirm: true })));
  const custom = setup();
  custom.CB.Screens.pause.CHIPS_Y = 70;
  pause(custom);
  tick(custom, 1, in_({ navX: 1 }));
  assert.equal(custom.boxArgs[custom.boxArgs.length - 1], 70, 'follows the pause screen\'s own CHIPS_Y');
  delete custom.CB.Screens.pause.CHIPS_Y;
  tick(custom, 1, in_({ navX: 1 }));
  assert.equal(custom.boxArgs[custom.boxArgs.length - 1], 68, 'and falls back to 68');
});

test('pause chips: the focus starts over every time the pause opens (Esc, Start, or the window losing focus)', () => {
  const s = setup();
  const { play } = s;
  pause(s);
  tick(s, 1, in_({ navX: 1 }));
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [true, 1]);
  pause(s); // resume
  assert.equal(play.paused, false);
  pause(s); // open again
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [false, 0]);
  tick(s, 1, in_({ navX: 1 }));
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(play.ui.pauseFocus, 2);
  pause(s);
  pause(s);
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [false, 0], 'a third time');
});

test('pause chips: onBlur opens the pause with a clean focus, and a second blur while paused leaves the focus alone', () => {
  const s = setup();
  const { play } = s;
  play.ui.pauseNav = true;
  play.ui.pauseFocus = 2;
  play.onBlur();
  assert.equal(play.paused, true);
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [false, 0]);
  tick(s, 1, in_({ navX: 1 }));
  play.onBlur(); // the portrait overlay re-applies blur on every resize
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [true, 1], 'already paused: nothing is reset');
  const out = setup();
  out.play.run.state = 'patchPick';
  out.play.onBlur();
  assert.equal(out.play.paused, false, 'a menu does not pause');
});

test('pause chips: pad A toggles the focused chip once, only after the focus ring has started', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ confirm: true, pad: padBtns({ a: true }) }));
  assert.deepEqual(s.applied, [], 'A with no focus ring does nothing (Start resumes)');
  assert.equal(s.play.paused, true);
  tick(s, 1, in_({ navX: 1 }));
  tick(s, 1, in_({ confirm: true, pad: padBtns({ a: true }) })); // a pad's A press is also a confirm edge: still one toggle
  assert.deepEqual(s.applied, ['music']);
  tick(s, 1, in_({ navX: 1 }));
  tick(s, 1, in_({ pad: padBtns({ a: true }) }));
  assert.deepEqual(s.applied, ['music', 'calm'], 'A alone is enough');
  tick(s, 1, in_({ pad: padBtns({ b: true, start: false }) }));
  assert.deepEqual(s.applied, ['music', 'calm'], 'other pad buttons toggle nothing');
  assert.equal(s.play.paused, true, 'and toggling never resumes');
});

test('pause chips: Enter (a confirm that is not a pointer press) toggles the focused chip; a click is a tap, not Enter', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ confirm: true }));
  assert.deepEqual(s.applied, [], 'no focus ring: Enter does nothing');
  tick(s, 1, in_({ navX: -1 })); // ArrowLeft / A: wraps to the last chip
  assert.equal(s.play.ui.pauseFocus, 2);
  tick(s, 1, in_({ confirm: true }));
  assert.deepEqual(s.applied, ['calm']);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 120 }));
  assert.deepEqual(s.applied, ['calm'], 'a click elsewhere does not also press the focused chip');
  assert.equal(s.play.paused, false, 'it resumes instead');
});

test('pause chips: a tap on a chip toggles that chip, stays paused, and hands the highlight back to the pointer', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(s.play.ui.pauseNav, true);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 60, aimY: 70 }));
  assert.deepEqual(s.applied, ['sound'], 'the chip under the tap, not the focused one');
  assert.equal(s.play.paused, true);
  assert.equal(s.play.ui.pauseNav, false);
  assert.equal(s.play.quitArmT, 0);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 70 }));
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 240, aimY: 74 }));
  assert.deepEqual(s.applied, ['sound', 'music', 'calm']);
  assert.ok(s.hitArgs.every((y) => y === 66));
  assert.equal(s.visits.length, 0);
  const edge = (x, y) => {
    const before = s.applied.length;
    tick(s, 1, in_({ confirm: true, tap: true, aimX: x, aimY: y }));
    return s.applied.length > before;
  };
  assert.equal(edge(45, 64), true, 'the top-left pixel of a chip');
  assert.equal(edge(118, 74), true, 'the bottom-right pixel');
  assert.equal(s.play.paused, true);
  assert.equal(edge(119, 74), false, 'one past it: the gap between chips');
  assert.equal(s.play.paused, false, 'which is just a tap on the pause screen');
});

test('pause quit button: the first tap arms, the second quits, like pressing Q twice', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  assert.equal(s.play.quitArmT, 2.0);
  assert.equal(s.play.paused, true, 'a tap on the button does not resume');
  assert.equal(s.visits.length, 0);
  tick(s, 30);
  assert.ok(Math.abs(s.play.quitArmT - 1.5) < 1e-9, 'decays like the Q arm');
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 150, aimY: 150 }));
  assert.equal(s.visits.length, 1);
  assert.equal(s.visits[0][0], 'title');
});

test('pause quit button: Q then a tap quits, a tap then Q quits, and an expired arm just re-arms', () => {
  const a = setup();
  pause(a);
  tick(a, 1, in_({ quit: true }));
  assert.equal(a.play.quitArmT, 2.0);
  tick(a, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  assert.equal(a.visits.length, 1);
  const b = setup();
  pause(b);
  tick(b, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  tick(b, 1, in_({ quit: true }));
  assert.equal(b.visits.length, 1);
  const c = setup();
  pause(c);
  tick(c, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  tick(c, 125);
  assert.equal(c.play.quitArmT, 0);
  tick(c, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  assert.equal(c.visits.length, 0);
  assert.equal(c.play.quitArmT, 2.0);
});

test('pause quit button: the button\'s edges (x 110-209, y 150-159) are the hit box', () => {
  for (const [x, y, hit] of [[110, 150, true], [209, 159, true], [109, 155, false], [210, 155, false], [160, 149, false], [160, 160, false]]) {
    const s = setup();
    pause(s);
    tick(s, 1, in_({ confirm: true, tap: true, aimX: x, aimY: y }));
    if (hit) {
      assert.equal(s.play.quitArmT, 2.0, `${x},${y} arms`);
      assert.equal(s.play.paused, true);
    } else {
      assert.equal(s.play.paused, false, `${x},${y} resumes`);
    }
  }
});

test('pause tap: anywhere else resumes -- unpauses, disarms the quit, plays the select sound, and does not step on that tick', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ quit: true }));
  assert.equal(s.play.quitArmT, 2.0);
  const t0 = s.play.run.time;
  s.played.length = 0;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 110 }));
  assert.equal(s.play.paused, false);
  assert.equal(s.play.quitArmT, 0);
  assert.deepEqual(s.played, ['uiSelect']);
  assert.equal(s.play.run.time, t0, 'the tap is spent on the resume');
  tick(s, 1);
  assert.ok(s.play.run.time > t0, 'and the next tick simulates');
  assert.equal(s.visits.length, 0);
});

test('pause tap: with no chips or quit button known (screens.js not loaded) a tap anywhere resumes', () => {
  const s = setup({ noToggles: true, noBoxes: true });
  pause(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 70 }));
  assert.equal(s.play.paused, false);
  pause(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  assert.equal(s.play.paused, false);
  assert.equal(s.visits.length, 0);
  const h = setup({ noToggles: true, noBoxes: true });
  delete h.CB.Screens.pause;
  h.CB.Screens.pause = { draw() {} };
  pause(h);
  assert.doesNotThrow(() => tick(h, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 })));
});

test('pause: Esc, P and Q behave as before, and a plain click on nothing in a fight does nothing', () => {
  const s = setup();
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 155 }));
  assert.equal(s.play.paused, false);
  assert.equal(s.play.quitArmT, 0);
  pause(s);
  assert.equal(s.play.paused, true);
  pause(s);
  assert.equal(s.play.paused, false);
  assert.deepEqual(s.applied, []);
});

// ---- patch pick ------------------------------------------------------------------------------------------------------

test('patch pick: a pad starts with the middle card focused; the other devices start without a focus ring', () => {
  for (const [device, nav] of [['pad', true], ['kbm', false], ['touch', false]]) {
    const s = setup({ device });
    toPatchPick(s);
    tick(s, 1, in_({ aimX: 30, aimY: 100 }));
    assert.equal(s.play.ui.nav, nav, device);
    assert.equal(s.play.ui.focus, 1, device);
    assert.equal(s.play.ui.hover, device === 'pad' ? 1 : device === 'kbm' ? 0 : -1, `${device}: pad = focus, mouse = card under it, touch = this tick's tap only`);
  }
});

test('patch pick: the pad focus is not undone by a pointer that moved earlier in the fight', () => {
  const s = setup({ device: 'pad' });
  toPatchPick(s);
  tick(s, 1, in_({ aimX: 250, aimY: 100 })); // the pointer position differs from the last fight tick (160, 40)
  assert.equal(s.play.ui.nav, true);
  assert.equal(s.play.ui.hover, 1);
  tick(s, 1, in_({ aimX: 250, aimY: 100 }));
  assert.equal(s.play.ui.nav, true, 'a still pointer does nothing');
});

test('patch pick: nav edges move the focus without wrapping and turn the ring on (keyboard arrows too)', () => {
  const s = setup({ device: 'kbm' });
  toPatchPick(s);
  tick(s, 1, in_({ aimX: 250, aimY: 100 }));
  assert.equal(s.play.ui.nav, false);
  assert.equal(s.play.ui.hover, 2, 'the mouse is over card 3');
  tick(s, 1, in_({ aimX: 250, aimY: 100, navX: -1 }));
  assert.deepEqual([s.play.ui.nav, s.play.ui.focus, s.play.ui.hover], [true, 0, 0], 'the focus is in charge, from the middle card');
  tick(s, 1, in_({ aimX: 250, aimY: 100, navX: -1 }));
  assert.equal(s.play.ui.focus, 0, 'clamped at the first card');
  tick(s, 2, in_({ aimX: 250, aimY: 100, navX: 1 }));
  assert.equal(s.play.ui.focus, 2);
  tick(s, 1, in_({ aimX: 250, aimY: 100, navX: 1 }));
  assert.equal(s.play.ui.focus, 2, 'and at the last');
  tick(s, 1, in_({ aimX: 250, aimY: 100, navY: 1 }));
  assert.equal(s.play.ui.focus, 2, 'vertical edges are not used here');
});

test('patch pick: confirm picks the focused card (pad A, Enter), not the one under a resting pointer', () => {
  const s = setup({ device: 'pad' });
  toPatchPick(s);
  tick(s, 40, in_({ aimX: 250, aimY: 100 })); // past the input lock, pointer parked over card 3
  const offer = s.play.run.offer.slice();
  assert.equal(s.play.run.state, 'patchPick');
  tick(s, 1, in_({ aimX: 250, aimY: 100, navX: -1 }));
  tick(s, 1, in_({ aimX: 250, aimY: 100, confirm: true, pad: padBtns({ a: true }) }));
  assert.equal(s.play.run.history[0], offer[0], 'card 1 was focused');
  const k = setup({ device: 'kbm' });
  toPatchPick(k);
  tick(k, 40, in_({ aimX: 30, aimY: 100 }));
  const offerK = k.play.run.offer.slice();
  tick(k, 1, in_({ aimX: 30, aimY: 100, navX: 1 }));
  tick(k, 1, in_({ aimX: 30, aimY: 100, navX: 1 }));
  tick(k, 1, in_({ aimX: 30, aimY: 100, confirm: true }));
  assert.equal(k.play.run.history[0], offerK[2], 'Enter picks the focused card with the pointer over card 1');
});

test('patch pick: confirm with no focus ring picks the card under the pointer, and nothing when it is over none', () => {
  const s = setup({ device: 'kbm' });
  toPatchPick(s);
  tick(s, 40, in_({ aimX: 160, aimY: 5 }));
  tick(s, 1, in_({ aimX: 160, aimY: 5, confirm: true }));
  assert.equal(s.play.run.history.length, 0, 'not over a card');
  tick(s, 1, in_({ aimX: 30, aimY: 100, confirm: true, tap: true }));
  assert.equal(s.play.run.history.length, 1);
  tick(s, 1);
  assert.equal(s.play.ui.nav, false, 'after the pick the next screen has no ring');
  assert.equal(s.play.ui.hover, -1);
});

test('patch pick: a pointer move or a tap hands the highlight back to the pointer', () => {
  const s = setup({ device: 'pad' });
  toPatchPick(s);
  tick(s, 3, in_({ aimX: 250, aimY: 100 }));
  assert.equal(s.play.ui.nav, true);
  tick(s, 1, in_({ aimX: 251, aimY: 100 }));
  assert.equal(s.play.ui.nav, false, 'the mouse moved a pixel');
  assert.equal(s.play.ui.hover, 2);
  tick(s, 1, in_({ aimX: 251, aimY: 100, navX: -1 }));
  assert.equal(s.play.ui.nav, true);
  tick(s, 1, in_({ aimX: 251, aimY: 100, confirm: true, tap: true }));
  assert.equal(s.play.ui.nav, false, 'a tap too');
  assert.equal(s.play.ui.hover, 2);
});

test('patch pick: on a phone a card is "hovered" only on the tick of the tap, so no stale highlight lingers', () => {
  const s = setup({ device: 'touch' });
  toPatchPick(s);
  tick(s, 1, in_({ aimX: 30, aimY: 100 }));
  assert.equal(s.play.ui.hover, -1, 'a pointer sitting on a card is not a hover');
  tick(s, 1, in_({ aimX: 30, aimY: 100, confirm: true, tap: true }));
  assert.equal(s.play.ui.hover, 0, 'the tap lands on card 1 (the pick itself waits for the input lock)');
  assert.equal(s.play.run.history.length, 0, 'still locked');
  tick(s, 1, in_({ aimX: 30, aimY: 100 }));
  assert.equal(s.play.ui.hover, -1, 'gone the next tick');
  tick(s, 40, in_({ aimX: 30, aimY: 100 }));
  const offer = s.play.run.offer.slice();
  tick(s, 1, in_({ aimX: 30, aimY: 100, confirm: true })); // a confirm that is not a tap (stray): nothing
  assert.equal(s.play.run.history.length, 0);
  tick(s, 1, in_({ aimX: 250, aimY: 100, confirm: true, tap: true }));
  assert.equal(s.play.run.history[0], offer[2], 'a tap picks the card it lands on');
});

test('patch pick: a tap off the cards picks nothing, on a phone and with a mouse', () => {
  for (const device of ['touch', 'kbm']) {
    const s = setup({ device });
    toPatchPick(s);
    tick(s, 40);
    tick(s, 1, in_({ aimX: 160, aimY: 5, confirm: true, tap: true }));
    assert.equal(s.play.run.history.length, 0, device);
    assert.equal(s.play.ui.hover, -1);
  }
});

test('patch pick: the focus restarts on the middle card for each pick, and a short offer limits it', () => {
  const s = setup({ device: 'pad' });
  toPatchPick(s);
  tick(s, 1);
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(s.play.ui.focus, 2);
  s.play.run.offer = s.play.run.offer.slice(0, 2);
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(s.play.ui.focus, 1, 'two cards: 0 and 1 only');
  s.play.run.state = 'stageIntro';
  tick(s, 1);
  assert.equal(s.play.ui.nav, false, 'leaving the pick clears the ring');
  assert.equal(s.play.ui.hover, -1);
  s.play.run.offer = ['spread'];
  s.play.run.state = 'patchPick';
  tick(s, 1);
  assert.deepEqual([s.play.ui.nav, s.play.ui.focus], [true, 0], 'a one-card offer: the focus is that card');
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(s.play.ui.focus, 0);
});

test('patch pick: the draw sees the focus (ui.nav, ui.focus, ui.hover) through the overlay\'s ui argument', () => {
  const s = setup({ device: 'pad' });
  toPatchPick(s);
  tick(s, 1);
  const seen = [];
  s.CB.WorldDraw = { draw() {} };
  s.CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) s.CB.Screens[k] = { draw() {} };
  s.CB.Screens.patchPick = Object.assign({}, s.CB.Screens.patchPick, { draw: (r, run, t, ui) => seen.push(ui) });
  const r = { clear() {}, shaken: (a, b, fn) => fn(), alpha: (a, fn) => fn(), rect() {}, text() {} };
  s.play.draw(r, 0);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].nav, seen[0].focus, seen[0].hover], [true, 1, 1]);
});

test('patch pick: number keys still choose (the run reads inp.choice itself)', () => {
  const s = setup({ device: 'kbm' });
  toPatchPick(s);
  tick(s, 40);
  const offer = s.play.run.offer.slice();
  tick(s, 1, in_({ choice: 3 }));
  assert.equal(s.play.run.history[0], offer[2]);
});

// ---- the game over screen --------------------------------------------------------------------------------------------

test('game over: a tap on the quit line leaves for the title, and the same tap does not retry', () => {
  const s = setup();
  toDead(s);
  afterLock(s);
  const attempt = s.play.run.attempt;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 138 }));
  assert.equal(s.visits.length, 1);
  assert.equal(s.visits[0][0], 'title');
  assert.equal(s.play.run.attempt, attempt, 'no retry');
  assert.equal(s.play.run.state, 'dead');
});

test('game over: the quit line waits for the input lock, so a mashed tap cannot skip the screen', () => {
  const s = setup();
  toDead(s);
  assert.ok(s.play.run.stateT < s.CB.RUN_T.inputLock);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 138 }));
  assert.equal(s.visits.length, 0);
  assert.equal(s.play.run.state, 'dead');
  assert.equal(s.play.run.attempt, 0, 'and the locked screen refuses the retry too');
});

test('game over: a tap anywhere else retries; a pad A with the old pointer parked on the quit line retries too', () => {
  const s = setup();
  toDead(s);
  afterLock(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 60 }));
  assert.equal(s.visits.length, 0);
  assert.equal(s.play.run.attempt, 1, 'retried');
  const p = setup({ device: 'pad' });
  toDead(p);
  afterLock(p);
  tick(p, 1, in_({ confirm: true, pad: padBtns({ a: true }), aimX: 160, aimY: 138 }));
  assert.equal(p.visits.length, 0, 'not a tap: the pointer position means nothing to a pad');
  assert.equal(p.play.run.attempt, 1);
});

test('game over: the quit box has these edges (x 100-219, y 133-143); Q and the pad\'s Back still quit', () => {
  for (const [x, y, hit] of [[100, 133, true], [219, 143, true], [99, 138, false], [220, 138, false], [160, 132, false], [160, 144, false]]) {
    const s = setup();
    toDead(s);
    afterLock(s);
    tick(s, 1, in_({ confirm: true, tap: true, aimX: x, aimY: y }));
    assert.equal(s.visits.length, hit ? 1 : 0, `${x},${y}`);
  }
  const q = setup();
  toDead(q);
  afterLock(q);
  tick(q, 1, in_({ quit: true }));
  assert.equal(q.visits.length, 1);
});

test('game over: without a QUIT_BOX (screens not loaded) a tap just retries', () => {
  const s = setup({ noBoxes: true });
  toDead(s);
  afterLock(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 138 }));
  assert.equal(s.visits.length, 0);
  assert.equal(s.play.run.attempt, 1);
  delete s.CB.Screens.gameOver;
  const t = setup();
  toDead(t);
  afterLock(t);
  delete t.CB.Screens.gameOver;
  assert.doesNotThrow(() => tick(t, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 138 })));
});

test('victory: a tap (a confirm) leaves for the title after the delay', () => {
  const s = setup();
  s.play.run.state = 'victory';
  s.play.run.stateT = 0;
  tick(s, 1, in_({ confirm: true, tap: true }));
  assert.equal(s.visits.length, 0, 'too early');
  s.play.run.stateT = 2;
  tick(s, 1, in_({ confirm: true, tap: true }));
  assert.equal(s.visits.length, 1);
});

test('victory: without CB.Share the share inputs are nothing, even over a SHARE_BOX', () => {
  const s = setup();
  s.CB.Screens.victory = { draw() {}, SHARE_BOX: { x: 70, y: 159, w: 88, h: 10 } };
  s.play.run.state = 'victory';
  s.play.run.stateT = 2;
  tick(s, 1, in_({ keys: ['KeyC'] }));
  tick(s, 1, in_({ pad: padBtns({ x: true }) }));
  assert.equal(s.visits.length, 0, 'C and X do nothing');
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 }));
  assert.equal(s.visits.length, 1, 'a tap over the box is only a tap: it plays again');
});

test('victory: the share button is where the victory screen says (CB.Screens.victory.SHARE_BOX), and a missing screen means no box', () => {
  const sent = [];
  const s = setup({ files: ['src/core/prompts.js'] });
  s.CB.Share = { text: () => 'result', send: (text, env) => { sent.push([text, env.device]); return Promise.resolve('copied'); } };
  s.CB.Screens.victory = { draw() {}, SHARE_BOX: { x: 200, y: 20, w: 30, h: 10 } };
  s.play.run.state = 'victory';
  s.play.run.stateT = 2;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 210, aimY: 25 }));
  assert.deepEqual(sent, [['result', 'kbm']]);
  assert.equal(s.visits.length, 0, 'a tap in the box stays');
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 }));
  assert.equal(s.visits.length, 1, 'where the button used to be is just a tap now');
  const t = setup();
  t.CB.Share = { text: () => 'result', send: () => Promise.resolve('copied') };
  delete t.CB.Screens.victory;
  t.play.run.state = 'victory';
  t.play.run.stateT = 2;
  assert.doesNotThrow(() => tick(t, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 })));
  assert.equal(t.visits.length, 1, 'no victory screen, no box: a tap leaves');
});

test('victory: a daily run is recorded once with its time, deaths and yolo flag, a plain run never', () => {
  const calls = [];
  const s = setup();
  s.CB.Daily = { record: (key, res) => calls.push([key, H.plain(res)]) };
  s.play.run.state = 'victory';
  s.play.run.stateT = 0.2;
  s.play.run.time = 75.5;
  s.play.run.deaths = 4;
  tick(s, 3);
  assert.deepEqual(calls, [], 'a plain run');
  s.play.run.daily = '2026-10-13';
  tick(s, 3);
  assert.deepEqual(calls, [['2026-10-13', { time: 75.5, deaths: 4, yolo: false }]]);
  tick(s, 10);
  assert.equal(calls.length, 1);
});

test('notify: with a kind a waiting toast of that kind is rewritten; without one every message queues as before', () => {
  const s = setup();
  s.play.notify('controller connected');
  s.play.notify('controller connected');
  assert.equal(s.play.toasts.length, 2);
  s.play.notify('one', 'share');
  s.play.toasts[2].t = 0.5;
  s.play.notify('two', 'share');
  assert.equal(s.play.toasts.length, 3);
  assert.deepEqual([s.play.toasts[2].text, s.play.toasts[2].t], ['two', 2.5]);
});

// ---- haptics and host toasts -----------------------------------------------------------------------------------------------

test('haptics: every step\'s events go to CB.Haptics.handleEvents after the audio, with the input as the sink', () => {
  const s = setup();
  const calls = [];
  s.CB.Haptics = { handleEvents: (evs, sink) => { s.log.push('haptics'); calls.push([evs.map((e) => e.type), sink]); } };
  s.play.run.world.emit('playerHurt', { x: 1, y: 2 });
  tick(s, 1);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].includes('playerHurt'));
  assert.equal(calls[0][1], s.game.input);
  assert.deepEqual(s.log.filter((l) => l.startsWith('audio:events') || l === 'haptics'), ['audio:events', 'haptics']);
  s.game.debug.speed = 3;
  tick(s, 1);
  assert.equal(calls.length, 4, 'one per sim step');
  s.game.debug.speed = 1;
  s.CB.Haptics = undefined;
  assert.doesNotThrow(() => tick(s, 3));
  s.CB.Haptics = {};
  assert.doesNotThrow(() => tick(s, 3));
});

test('haptics: with the real module a hurt Clawd rumbles the input, and calm mode keeps it quiet', () => {
  const s = setup({ files: ['src/core/haptics.js', 'src/game/comfort.js'] });
  s.play.run.world.emit('playerHurt', { x: 1, y: 2 });
  tick(s, 1);
  assert.deepEqual(s.rumbles, [[0.8, 0.4, 160, 40]]);
  s.rumbles.length = 0;
  tick(s, 5);
  assert.deepEqual(s.rumbles, [], 'nothing to feel in a quiet step');
  s.CB.Comfort.set(true);
  s.play.run.world.emit('playerHurt', { x: 1, y: 2 });
  tick(s, 1);
  assert.deepEqual(s.rumbles, [], 'calm mode');
  const bare = setup({ files: ['src/core/haptics.js'], noInputExtras: true });
  bare.play.run.world.emit('playerHurt', { x: 1, y: 2 });
  assert.doesNotThrow(() => tick(bare, 1), 'an input without rumble');
});

test('notify: a host toast joins the queue behind the others, shows for 2.5 s, and is frozen while paused', () => {
  const s = setup();
  s.CB.Bosses[s.play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 1, maxHp: 1, phase: 1, defeated: false, update() {}, draw() {} }) };
  s.play.notify('controller connected');
  assert.deepEqual(JSON.parse(JSON.stringify(s.play.toasts)), [{ text: 'controller connected', t: 2.5 }]);
  s.play.toasts.unshift({ text: 'NEW HAT: Crown', t: 1 });
  s.play.notify('controller disconnected');
  assert.deepEqual(s.play.toasts.map((t) => t.text), ['NEW HAT: Crown', 'controller connected', 'controller disconnected']);
  s.play.toasts.shift();
  tick(s, 60);
  assert.ok(Math.abs(s.play.toasts[0].t - 1.5) < 1e-6);
  pause(s);
  const t0 = s.play.toasts[0].t;
  tick(s, 30);
  assert.equal(s.play.toasts[0].t, t0);
  tick(s, 1, in_({ pause: true }));
  tick(s, 300);
  assert.equal(s.play.toasts.length, 0, 'they all run out');
});

test('notify: blank and non-string texts are ignored, and a new run starts with no host toast', () => {
  const s = setup();
  for (const bad of ['', undefined, null, 5, {}, []]) s.play.notify(bad);
  assert.equal(s.play.toasts.length, 0);
  s.play.notify('controller connected');
  s.play.enter(s.game, { runOpts: { seed: 2 } });
  assert.equal(s.play.toasts.length, 0);
});

test('notify: the toast is drawn like any other', () => {
  const s = setup();
  const texts = [];
  s.CB.WorldDraw = { draw() {} };
  s.CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) s.CB.Screens[k] = { draw() {} };
  const r = { clear() {}, shaken: (a, b, fn) => fn(), alpha: (a, fn) => fn(), rect() {}, text: (str) => texts.push(str) };
  s.play.notify('controller connected');
  s.play.draw(r, 0);
  assert.deepEqual(texts, ['controller connected']);
});

// ---- drawing per device ----------------------------------------------------------------------------------------------------

// Stubs every screen with a logging draw; returns the log plus the cursor and Touch.draw calls.
function drawKit(s, opts) {
  const o = opts || {};
  const { CB, play } = s;
  const log = [];
  const cursors = [];
  const touches = [];
  CB.WorldDraw = { draw() { log.push('world'); } };
  CB.Screens.hud = { draw() { log.push('hud'); }, cursor: (r, x, y, mode) => { cursors.push([x, y, mode]); log.push('cursor'); } };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'patchPick', 'gameOver', 'victory']) CB.Screens[k] = { draw() { log.push('overlay:' + k); } };
  CB.Screens.pause = { draw() { log.push('pause'); } };
  if (!o.noTouch) CB.Touch = { draw: (r, view, t, opt) => { touches.push([view, t, opt]); log.push('touch'); } };
  const r = { clear() {}, shaken: (a, b, fn) => fn(), alpha: (a, fn) => fn(), rect() {}, text() {}, frame() {} };
  const draw = (state, paused) => {
    play.run.state = state;
    play.paused = !!paused;
    log.length = 0;
    cursors.length = 0;
    touches.length = 0;
    play.draw(r, 1.5);
  };
  return { log, cursors, touches, draw };
}
const FIGHT = ['stageIntro', 'wave', 'waveBreak', 'bossWarn', 'boss', 'bossDead', 'dying'];
const POINTER = ['patchPick', 'dead', 'victory'];

test('draw, keyboard and mouse: the cursor is at the mouse -- a crosshair in a fight, an arrow on every pointer screen (as before)', () => {
  const s = setup({ device: 'kbm' });
  const k = drawKit(s);
  for (const st of FIGHT) {
    k.draw(st);
    assert.deepEqual(k.cursors, [[30, 40, 'cross']], st);
    assert.equal(k.touches.length, 0);
  }
  for (const st of POINTER) {
    k.draw(st);
    assert.deepEqual(k.cursors, [[30, 40, 'pointer']], st);
  }
  k.draw('wave', true);
  assert.deepEqual(k.cursors, [[30, 40, 'pointer']], 'paused');
  assert.equal(k.touches.length, 0);
});

test('draw, controller: the crosshair rides the aim point in a fight; no cursor on pointer screens, none while dead', () => {
  const s = setup({ device: 'pad' });
  const k = drawKit(s);
  const p = s.play.run.world.player;
  p.aimX = 150;
  p.aimY = 77;
  for (const st of FIGHT) {
    k.draw(st);
    assert.deepEqual(k.cursors, [[150, 77, 'cross']], st);
    assert.equal(k.touches.length, 0, 'a pad has no on-screen controls');
  }
  for (const st of POINTER) {
    k.draw(st);
    assert.deepEqual(k.cursors, [], st);
  }
  k.draw('wave', true);
  assert.deepEqual(k.cursors, [], 'paused');
  p.dead = true;
  k.draw('dying');
  assert.deepEqual(k.cursors, [], 'a dead Clawd has no crosshair');
});

test('draw, phone: the crosshair is at the aim point and the on-screen controls are drawn in a fight only', () => {
  const s = setup({ device: 'touch' });
  const k = drawKit(s);
  const p = s.play.run.world.player;
  p.aimX = 200;
  p.aimY = 60;
  for (const st of FIGHT) {
    k.draw(st);
    assert.deepEqual(k.cursors, [[200, 60, 'cross']], st);
    assert.equal(k.touches.length, 1, `${st}: controls`);
  }
  for (const st of POINTER) {
    k.draw(st);
    assert.deepEqual(k.cursors, [], st);
    assert.equal(k.touches.length, 0, `${st}: taps only, no sticks`);
  }
  k.draw('wave', true);
  assert.deepEqual(k.cursors, []);
  assert.equal(k.touches.length, 0, 'paused');
  p.dead = true;
  k.draw('dying');
  assert.deepEqual(k.cursors, []);
});

test('draw, phone: the controls go after the HUD and before the overlay card, with the input\'s view and the clock', () => {
  const s = setup({ device: 'touch' });
  const k = drawKit(s);
  const view = { mode: 'sticks', move: { ox: 40, oy: 140, x: 50, y: 140 }, aim: null, dashDown: false, compactDown: false, pauseDown: false };
  s.input.touchView = () => view;
  k.draw('stageIntro');
  assert.deepEqual(k.log.filter((l) => l !== 'cursor'), ['world', 'hud', 'touch', 'overlay:stageIntro']);
  assert.equal(k.touches[0][0], view);
  assert.equal(k.touches[0][1], 1.5);
});

test('draw, phone: the /compact button gets the meter, whether a cast is ready, and the dash button whether it has cooled', () => {
  const s = setup({ device: 'touch', files: ['src/game/compact.js'] });
  const k = drawKit(s);
  const w = s.play.run.world;
  k.draw('wave');
  assert.deepEqual(JSON.parse(JSON.stringify(k.touches[0][2])), { compactFrac: 0, compactReady: false, dashReady: true });
  w.context.value = 22.5;
  w.player.dashCd = 0.3;
  k.draw('wave');
  assert.deepEqual(JSON.parse(JSON.stringify(k.touches[0][2])), { compactFrac: 0.5, compactReady: false, dashReady: false });
  w.context.value = 45;
  w.player.dashCd = 0;
  k.draw('wave');
  assert.deepEqual(JSON.parse(JSON.stringify(k.touches[0][2])), { compactFrac: 1, compactReady: true, dashReady: true });
  w.compactWave = { x: 1, y: 1, r: 4, hits: [] };
  k.draw('wave');
  assert.equal(k.touches[0][2].compactReady, false, 'a wave is already out: the button is not offered');
  assert.equal(k.touches[0][2].compactFrac, 1);
  w.compactWave = null;
  w.context.value = 99;
  k.draw('wave');
  assert.equal(k.touches[0][2].compactFrac, 1, 'clamped');
  w.context.value = -3;
  k.draw('wave');
  assert.equal(k.touches[0][2].compactFrac, 0);
});

test('draw, phone: without the compact module the button still works from the raw meter', () => {
  const s = setup({ device: 'touch' });
  const k = drawKit(s);
  s.play.run.world.context.value = 45;
  k.draw('boss');
  assert.equal(k.touches[0][2].compactReady, true);
});

test('draw, phone: no view (not the touch device yet), no Touch module, or no touchView draws no controls and does not throw', () => {
  const s = setup({ device: 'touch' });
  const k = drawKit(s);
  s.input.touchView = () => null;
  assert.doesNotThrow(() => k.draw('wave'));
  assert.equal(k.touches.length, 0);
  s.input.touchView = undefined;
  assert.doesNotThrow(() => k.draw('wave'));
  assert.equal(k.touches.length, 0);
  const n = setup({ device: 'touch' });
  const kn = drawKit(n, { noTouch: true });
  n.CB.Touch = undefined;
  assert.doesNotThrow(() => kn.draw('wave'));
  n.CB.Touch = {};
  assert.doesNotThrow(() => kn.draw('wave'));
  assert.deepEqual(kn.cursors, [[n.play.run.world.player.aimX, n.play.run.world.player.aimY, 'cross']], 'the crosshair does not depend on it');
});

test('draw: a host without a device is the keyboard (cursor at the mouse, no controls); the pause screen is drawn over all of it', () => {
  const s = setup({ device: undefined });
  s.game.input = { peekAim: () => ({ x: 5, y: 6 }) };
  const k = drawKit(s);
  k.draw('wave');
  assert.deepEqual(k.cursors, [[5, 6, 'cross']]);
  assert.equal(k.touches.length, 0);
  k.draw('wave', true);
  assert.ok(k.log.includes('pause'));
  assert.deepEqual(k.cursors, [[5, 6, 'pointer']]);
});
