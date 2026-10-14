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
  const padArgs = [];
  const boxArgs = [];
  CB.Screens.patchPick = { cardAt: (x, y) => (y >= 30 && y < 150 ? (x < 100 ? 0 : x < 220 ? 1 : 2) : -1), draw() {} };
  const chips = (y0) => IDS.slice(0, o.chips || 3).map((id, i) => ({ id, x: 45 + 78 * i, y: y0 - 2, w: 74, h: 11 }));
  if (!o.noToggles) {
    CB.Screens.toggles = {
      IDS,
      boxes: (y0) => { boxArgs.push(y0); return chips(y0); },
      hit: (x, y, y0, pad) => {
        hitArgs.push(y0);
        padArgs.push(pad);
        const p = pad || 0;
        const b = chips(y0).find((c) => x >= c.x - p && x < c.x + c.w + p && y >= c.y - p && y < c.y + c.h + p);
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
  return { CB, play, game, input, log, played, applied, hitArgs, padArgs, boxArgs, modes, rumbles, visits };
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
  tick(d, 1, in_({ quit: true })); // arms
  d.log.length = 0;
  tick(d, 1, in_({ quit: true }));
  assert.deepEqual(d.log, ['mode:menu', 'go:title'], 'dead + quit');
  const v = setup();
  v.play.run.state = 'victory';
  v.play.run.stateT = 3;
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
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [true, 0], 'the first press only lights the first chip, it does not also move');
  tick(s, 1, in_({ navX: 1 }));
  assert.equal(play.ui.pauseFocus, 1);
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
  assert.equal(two.play.ui.pauseFocus, 0, 'lit, not moved');
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
  tick(s, 1, in_({ navX: 1 }));
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [true, 1]);
  pause(s); // resume
  assert.equal(play.paused, false);
  pause(s); // open again
  assert.deepEqual([play.ui.pauseNav, play.ui.pauseFocus], [false, 0]);
  tick(s, 1, in_({ navX: 1 }));
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
  tick(s, 1, in_({ navX: 1 })); // lights the first chip
  tick(s, 1, in_({ confirm: true, pad: padBtns({ a: true }) })); // a pad's A press is also a confirm edge: still one toggle
  assert.deepEqual(s.applied, ['sound']);
  tick(s, 1, in_({ navX: 1 }));
  tick(s, 1, in_({ pad: padBtns({ a: true }) }));
  assert.deepEqual(s.applied, ['sound', 'music'], 'A alone is enough');
  tick(s, 1, in_({ pad: padBtns({ b: true, start: false }) }));
  assert.deepEqual(s.applied, ['sound', 'music'], 'other pad buttons toggle nothing');
  assert.equal(s.play.paused, true, 'and toggling never resumes');
});

test('pause chips: Enter (a confirm that is not a pointer press) toggles the focused chip; a click is a tap, not Enter', () => {
  const s = setup();
  pause(s);
  tick(s, 1, in_({ confirm: true }));
  assert.deepEqual(s.applied, [], 'no focus ring: Enter does nothing');
  tick(s, 1, in_({ navX: -1 })); // ArrowLeft / A: the first press lights the first chip
  assert.equal(s.play.ui.pauseFocus, 0);
  tick(s, 1, in_({ navX: -1 })); // and the next wraps to the last
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
  assert.equal(q.visits.length, 0, 'the first Q only arms, as on the pause screen');
  assert.equal(q.play.quitArmT, 2.0);
  tick(q, 1, in_({ quit: true }));
  assert.equal(q.visits.length, 1, 'the second one leaves');
  const b = setup({ device: 'pad' });
  toDead(b);
  afterLock(b);
  tick(b, 1, in_({ quit: true }));
  tick(b, 1, in_({ quit: true }));
  assert.equal(b.visits.length, 1, 'and the pad\'s Back is the same');
});

test('game over: the armed Q expires after 2 s and a retry disarms it', () => {
  const s = setup();
  toDead(s);
  afterLock(s);
  tick(s, 1, in_({ quit: true }));
  assert.equal(s.visits.length, 0);
  tick(s, 130); // 2.17 s
  assert.equal(s.play.quitArmT, 0);
  tick(s, 1, in_({ quit: true }));
  assert.equal(s.visits.length, 0, 'an expired arm just re-arms');
  tick(s, 1, in_({ retry: true }));
  assert.equal(s.play.run.attempt, 1);
  assert.equal(s.play.quitArmT, 0, 'retrying clears it');
});

test('game over (touch): only the retry button retries; a tap that misses both buttons does nothing; the quit button leaves', () => {
  const s = setup({ device: 'touch' });
  const R = { x: 6, y: 128, w: 150, h: 20 };
  s.CB.Screens.gameOver = { draw() {}, QUIT_BOX: OVER_QUIT_BOX, retryBox: () => R, quitBox: () => OVER_QUIT_BOX };
  toDead(s);
  afterLock(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 60 }));
  assert.equal(s.play.run.attempt, 0, 'a tap on the dead space is not a retry');
  assert.equal(s.visits.length, 0);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 124 })); // between the quip and the buttons
  assert.equal(s.play.run.attempt, 0);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 30, aimY: 135 }));
  assert.equal(s.play.run.attempt, 1, 'the retry button');
  const q = setup({ device: 'touch' });
  q.CB.Screens.gameOver = { draw() {}, QUIT_BOX: OVER_QUIT_BOX, retryBox: () => R, quitBox: () => OVER_QUIT_BOX };
  toDead(q);
  afterLock(q);
  tick(q, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 138 }));
  assert.equal(q.visits.length, 1);
  assert.equal(q.play.run.attempt, 0, 'and its tap is not also a retry');
  // The keyboard and mouse still retry on a click anywhere, as they always did.
  const k = setup({ device: 'kbm' });
  k.CB.Screens.gameOver = { draw() {}, QUIT_BOX: OVER_QUIT_BOX, retryBox: () => R, quitBox: () => OVER_QUIT_BOX };
  toDead(k);
  afterLock(k);
  tick(k, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 60 }));
  assert.equal(k.play.run.attempt, 1);
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
  s.CB.Screens.victory = { draw() {}, continueBox: () => ({ x: 164, y: 149, w: 120, h: 22 }), shareBox: () => ({ x: 36, y: 149, w: 120, h: 22 }) };
  s.play.run.state = 'victory';
  s.play.run.stateT = 0;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 160 }));
  assert.equal(s.visits.length, 0, 'too early');
  s.play.run.stateT = 2.5;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 160 }));
  assert.equal(s.visits.length, 0, 'strictly after 2.5 s');
  s.play.run.stateT = 2.6;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 160 }));
  assert.equal(s.visits.length, 1);
});

test('victory: only [ continue ], Enter or the pad\'s A leave; a tap or click anywhere else does nothing', () => {
  const mk = (device) => {
    const s = setup({ device });
    s.CB.Screens.victory = { draw() {}, continueBox: () => ({ x: 164, y: 149, w: 120, h: 22 }), shareBox: () => ({ x: 36, y: 149, w: 120, h: 22 }) };
    s.play.run.state = 'victory';
    s.play.run.stateT = 3;
    return s;
  };
  for (const device of ['kbm', 'touch']) {
    const s = mk(device);
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 60 }));
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 160 })); // on the share button's place, without CB.Share: nothing there
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 163, aimY: 160 })); // a pixel left of continue
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 148 })); // a pixel above it
    assert.equal(s.visits.length, 0, device + ': the near misses stay on the receipt');
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 164, aimY: 149 })); // its top-left pixel
    assert.equal(s.visits.length, 1, device + ': the button leaves');
  }
  const e = mk('kbm');
  tick(e, 1, in_({ confirm: true })); // Enter: a confirm with no tap
  assert.equal(e.visits.length, 1, 'Enter leaves');
  const a = mk('pad');
  tick(a, 1, in_({ confirm: true, pad: padBtns({ a: true }) }));
  assert.equal(a.visits.length, 1, 'pad A leaves');
  const other = mk('pad');
  tick(other, 1, in_({ pad: padBtns({ b: true, y: true }) }));
  assert.equal(other.visits.length, 0, 'other pad buttons do not');
});

test('victory: without CB.Share the share inputs are nothing, even over a SHARE_BOX', () => {
  const s = setup();
  s.CB.Screens.victory = { draw() {}, SHARE_BOX: { x: 70, y: 159, w: 88, h: 10 } };
  s.play.run.state = 'victory';
  s.play.run.stateT = 3;
  tick(s, 1, in_({ keys: ['KeyC'] }));
  tick(s, 1, in_({ pad: padBtns({ x: true }) }));
  assert.equal(s.visits.length, 0, 'C and X do nothing');
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 }));
  assert.equal(s.visits.length, 0, 'a tap over the box is only a tap: it does nothing now');
  tick(s, 1, in_({ confirm: true }));
  assert.equal(s.visits.length, 1, 'Enter plays again');
});

test('victory: the share button is where the victory screen says (CB.Screens.victory.SHARE_BOX), and a missing screen means no box', () => {
  const sent = [];
  const s = setup({ files: ['src/core/prompts.js'] });
  s.CB.Share = { text: () => 'result', send: (text, env) => { sent.push([text, env.device]); return Promise.resolve('copied'); } };
  s.CB.Screens.victory = { draw() {}, SHARE_BOX: { x: 200, y: 20, w: 30, h: 10 } };
  s.play.run.state = 'victory';
  s.play.run.stateT = 3;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 210, aimY: 25 }));
  assert.deepEqual(sent, [['result', 'kbm']]);
  assert.equal(s.visits.length, 0, 'a tap in the box stays');
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 }));
  assert.equal(s.visits.length, 0, 'where the button used to be is nothing now');
  assert.equal(sent.length, 1);
  const t = setup();
  t.CB.Share = { text: () => 'result', send: () => Promise.resolve('copied') };
  delete t.CB.Screens.victory;
  t.play.run.state = 'victory';
  t.play.run.stateT = 3;
  assert.doesNotThrow(() => tick(t, 1, in_({ confirm: true, tap: true, aimX: 100, aimY: 164 })));
  assert.equal(t.visits.length, 0, 'no victory screen, no buttons: a tap does nothing');
  tick(t, 1, in_({ confirm: true }));
  assert.equal(t.visits.length, 1, 'but Enter still leaves');
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

test('notify: with a kind a waiting toast of that kind is rewritten and a new one shows first; without one every message queues as before', () => {
  const s = setup();
  s.play.notify('controller connected');
  s.play.notify('controller connected');
  assert.equal(s.play.toasts.length, 2);
  s.play.notify('one', 'share');
  assert.equal(s.play.toasts.length, 3);
  assert.deepEqual([s.play.toasts[0].text, s.play.toasts[0].kind], ['one', 'share'], 'a kinded toast with none waiting jumps the queue');
  assert.deepEqual(s.play.toasts.slice(1).map((q) => q.text), ['controller connected', 'controller connected'], 'the others keep their order behind it');
  s.play.toasts[0].t = 0.5;
  s.play.notify('two', 'share');
  assert.equal(s.play.toasts.length, 3);
  assert.deepEqual([s.play.toasts[0].text, s.play.toasts[0].t], ['two', 2.5]);
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
const CARDS = ['stageIntro', 'bossWarn', 'bossDead']; // centred cards: a stick has no crosshair over them
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
    assert.deepEqual(k.cursors, CARDS.includes(st) ? [] : [[150, 77, 'cross']], st + (CARDS.includes(st) ? ': no crosshair over a card' : ''));
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
    assert.deepEqual(k.cursors, CARDS.includes(st) ? [] : [[200, 60, 'cross']], st + (CARDS.includes(st) ? ': no crosshair over a card' : ''));
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

// ---- the UX pass: flow and screens -----------------------------------------------------------------------------------------------------

// Plays up to the BUG FIXED card (the boss falls on the step that enters it).
function toBossDead(s) {
  const { CB, play } = s;
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  for (let i = 0; i < 1200 && play.run.state !== 'bossDead'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'bossDead');
}

test('BUG FIXED card: a confirm skips it only once the passing-test line has shown', () => {
  const s = setup();
  s.CB.Screens.bossDead = { draw() {}, passAt: () => 2.9 };
  toBossDead(s);
  const { play, CB } = s;
  tick(s, 1, in_({ confirm: true }));
  assert.equal(play.run.state, 'bossDead', 'during the slow-mo: nothing');
  while (play.run.stateT < 2.8) tick(s, 1);
  tick(s, 1, in_({ confirm: true }));
  assert.equal(play.run.state, 'bossDead', 'before the last line: nothing');
  while (play.run.stateT < 2.9) tick(s, 1);
  tick(s, 1, in_({ confirm: true }));
  tick(s, 1);
  assert.equal(play.run.state, 'patchPick', 'after it: on to the pick, well before the 4.6 s hold');
  assert.ok(play.run.stateT < 1);
  assert.ok(CB.RUN_T.bossDead > 4);
  // Without screens.js's passAt the scene still has a number.
  const t = setup();
  t.CB.Screens.bossDead = { draw() {} };
  toBossDead(t);
  while (t.play.run.stateT < 2.95) tick(t, 1);
  tick(t, 2, in_({ confirm: true }));
  assert.equal(t.play.run.state, 'patchPick');
});

test('BUG FIXED card: with no confirm it runs its full 4.6 s', () => {
  const s = setup();
  toBossDead(s);
  let n = 0;
  while (s.play.run.state === 'bossDead' && n < 600) {
    tick(s, 1);
    n++;
  }
  assert.ok(Math.abs(n / 60 - 4.6) < 0.05, 'ticks: ' + n);
});

// -- patch picks are deliberate

function pickScene(device) {
  const s = setup({ device });
  toPatchPick(s);
  return s;
}
const padA = () => in_({ confirm: true, pad: padBtns({ a: true }) });

test('patch pick (pad): an A that follows a dash mash does not pick; a navigation press or 0.4 s without A does', () => {
  const s = pickScene('pad');
  const { play } = s;
  // Mash A through the lock (a dash button pressed every 0.2 s).
  tick(s, 1); // the pick is seen
  for (let i = 0; i < 40; i++) tick(s, 1, i % 12 === 0 ? padA() : in_());
  assert.ok(play.run.stateT > 0.6);
  assert.equal(play.run.state, 'patchPick');
  tick(s, 12, in_());
  tick(s, 1, padA()); // 0.2 s after the last press
  assert.equal(play.run.state, 'patchPick', 'a mashed A is not a choice');
  // A deliberate navigation press makes the next A count.
  tick(s, 1, in_({ navX: 1 }));
  tick(s, 1, padA());
  assert.equal(play.run.state, 'stageIntro', 'A after a navigation press');
  assert.equal(play.run.history.length, 1);

  const t = pickScene('pad');
  tick(t, 1);
  for (let i = 0; i < 40; i++) tick(t, 1, i % 12 === 0 ? padA() : in_());
  tick(t, 24, in_()); // 0.4 s with A up
  tick(t, 1, padA());
  assert.equal(t.play.run.state, 'stageIntro', 'A after it has been released for 0.4 s');
  // And an A with no mash at all (the first press of the pick) works.
  const u = pickScene('pad');
  tick(u, 1);
  while (u.play.run.stateT < 0.7) tick(u, 1);
  tick(u, 1, padA());
  assert.equal(u.play.run.state, 'stageIntro');
});

test('patch pick (mouse and keyboard): the lock stays, the opening tick counts for nothing, and a fresh mousedown or Enter picks the card under the pointer', () => {
  const s = pickScene('kbm');
  const { play } = s;
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 })); // the tick that sees the pick, inside the lock
  assert.equal(play.run.state, 'patchPick');
  afterLock(s);
  tick(s, 1, in_({ aimX: 160, aimY: 90 }));
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 }));
  assert.equal(play.run.state, 'stageIntro', 'a mousedown on the middle card');
  const e = pickScene('kbm');
  tick(e, 1);
  afterLock(e);
  tick(e, 1, in_({ confirm: true, aimX: 30, aimY: 90 })); // Enter with the pointer over card 0
  assert.equal(e.play.run.state, 'stageIntro', 'Enter');
});

test('patch pick (touch): the card lights on touch-down and commits on release over the same card', () => {
  const s = pickScene('touch');
  s.game.r = { toInternal: (x, y) => ({ x, y }) };
  const { play } = s;
  tick(s, 1);
  afterLock(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 })); // finger down on the middle card
  assert.equal(play.run.state, 'patchPick', 'down alone picks nothing');
  assert.equal(play.ui.hover, 1, 'the card is lit');
  assert.equal(play.ui.touchCard, 1);
  tick(s, 3);
  assert.equal(play.ui.hover, 1, 'and stays lit while the finger rests');
  play.touchMove(160, 92);
  tick(s, 1);
  assert.equal(play.ui.hover, 1);
  play.touchMove(40, 90); // slid onto another card
  tick(s, 1);
  assert.equal(play.ui.hover, -1, 'slid off the card: not lit');
  play.touchRelease(160, 90);
  tick(s, 1);
  assert.equal(play.run.state, 'stageIntro', 'lifting over the card it came down on picks it');
  assert.equal(play.run.history.length, 1);
  assert.equal(play.ui.touchCard, -1);
});

test('patch pick (touch): lifting over another card, off the cards, or a cancelled touch picks nothing', () => {
  for (const [x, y] of [[40, 90], [160, 20], [NaN, NaN]]) {
    const s = pickScene('touch');
    s.game.r = { toInternal: (a, b) => ({ x: a, y: b }) };
    tick(s, 1);
    afterLock(s);
    tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 }));
    s.play.touchRelease(x, y);
    tick(s, 2);
    assert.equal(s.play.run.state, 'patchPick', `lifted at ${x},${y}`);
    assert.equal(s.play.ui.touchCard, -1);
    assert.equal(s.play.ui.hover, -1);
  }
  // A tap on nothing lights nothing, and a lift with no card down is ignored.
  const t = pickScene('touch');
  t.game.r = { toInternal: (a, b) => ({ x: a, y: b }) };
  tick(t, 1);
  afterLock(t);
  tick(t, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 10 }));
  assert.equal(t.play.ui.touchCard, -1);
  t.play.touchRelease(160, 90);
  tick(t, 2);
  assert.equal(t.play.run.state, 'patchPick');
  // A touch-down inside the lock does not arm a card.
  const u = pickScene('touch');
  u.game.r = { toInternal: (a, b) => ({ x: a, y: b }) };
  tick(u, 1);
  tick(u, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 }));
  assert.equal(u.play.ui.touchCard, -1, 'locked');
  assert.equal(u.play.ui.hover, -1);
});

test('patch pick (touch): a host that cannot see the lift still commits on touch-down, as before', () => {
  const s = pickScene('touch'); // no game.r
  tick(s, 1);
  afterLock(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 90 }));
  assert.equal(s.play.run.state, 'stageIntro');
});

// -- pause

test('pause (touch): chips take 3 px of near-miss padding; the keyboard and the pad pass none', () => {
  const s = setup({ device: 'touch' });
  pause(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 60, aimY: 62 })); // 2 px above the chip row (chips start at y 64)
  assert.deepEqual(s.applied, ['sound'], 'a near miss still toggles the chip');
  assert.equal(s.padArgs[s.padArgs.length - 1], 3);
  assert.equal(s.play.paused, true);
  const k = setup({ device: 'kbm' });
  pause(k);
  tick(k, 1, in_({ confirm: true, tap: true, aimX: 60, aimY: 62 }));
  assert.deepEqual(k.applied, [], 'the mouse gets no padding');
  assert.ok(k.padArgs.every((p) => !p), 'none passed');
  assert.equal(k.play.paused, false, 'and that click resumes, as it always did');
});

test('pause (touch): [ resume ] resumes, [ quit ] arms, and a tap that misses every control does nothing', () => {
  const s = setup({ device: 'touch' });
  const RB = { x: 52, y: 136, w: 104, h: 20 };
  const QB = { x: 164, y: 136, w: 104, h: 20 };
  s.CB.Screens.pause = { draw() {}, CHIPS_Y: 66, QUIT_BOX: QB, RESUME_BOX: RB, resumeBox: () => RB, quitBox: () => QB };
  pause(s);
  for (const [x, y] of [[160, 120], [20, 20], [51, 140], [156, 140], [160, 135], [160, 157], [310, 170]]) {
    tick(s, 1, in_({ confirm: true, tap: true, aimX: x, aimY: y }));
    assert.equal(s.play.paused, true, `a tap at ${x},${y} does not resume`);
    assert.equal(s.visits.length, 0);
    assert.equal(s.play.quitArmT, 0);
  }
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 200, aimY: 150 }));
  assert.equal(s.play.quitArmT, 2.0, 'the quit button arms');
  assert.equal(s.play.paused, true);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 52, aimY: 136 }));
  assert.equal(s.play.paused, false, 'the resume button (its top-left pixel)');
  assert.equal(s.play.quitArmT, 0);
});

test('pause (keyboard and mouse): a click anywhere else still resumes, with or without the new buttons', () => {
  const s = setup({ device: 'kbm' });
  const RB = { x: 52, y: 136, w: 104, h: 12 };
  s.CB.Screens.pause = { draw() {}, CHIPS_Y: 66, QUIT_BOX: { x: 164, y: 136, w: 104, h: 20 }, resumeBox: () => RB, quitBox: () => ({ x: 164, y: 136, w: 104, h: 12 }) };
  pause(s);
  tick(s, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 100 }));
  assert.equal(s.play.paused, false);
});

// -- gentle resume

test('resume: the world eases back from 0.3x to 1x over 0.6 s and Clawd gets 0.6 s of mercy', () => {
  const s = setup();
  const { play, CB } = s;
  tick(s, 5);
  const p = play.run.world.player;
  p.invuln = 0;
  pause(s);
  tick(s, 10);
  assert.equal(play.run.timeScale, 1, 'paused: untouched');
  pause(s); // resume
  assert.equal(play.paused, false);
  assert.ok(p.invuln >= 0.59, 'mercy (less the step of the tick that unpaused): ' + p.invuln);
  assert.ok(Math.abs(play.run.timeScale - 0.3) < 1e-9, 'the tick that unpaused already runs at 0.3x: ' + play.run.timeScale);
  const seen = [];
  for (let i = 0; i < 40; i++) {
    tick(s, 1);
    seen.push(play.run.timeScale);
  }
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'rising');
  assert.equal(seen[seen.length - 1], 1, 'back to full speed after 0.6 s');
  assert.ok(seen[10] > 0.3 && seen[10] < 1);
  const before = play.run.stateT;
  tick(s, 1);
  assert.ok(Math.abs(play.run.stateT - before - CB.DT) < 1e-12, 'a normal tick again');
  // A tap on the resume (touch) or a click (keyboard) takes the same road.
  const t = setup();
  pause(t);
  tick(t, 1, in_({ confirm: true, tap: true, aimX: 160, aimY: 100 }));
  assert.equal(t.play.paused, false);
  assert.ok(t.play.run.world.player.invuln >= 0.6 - 1e-9, 'a tap resume does not step that tick');
  tick(t, 1);
  assert.ok(Math.abs(t.play.run.timeScale - 0.3) < 1e-9);
});

test('resume: mercy never shortens an invulnerability Clawd already had, and a dead Clawd gets none', () => {
  const s = setup();
  s.play.run.world.player.invuln = 2;
  pause(s);
  pause(s);
  assert.ok(s.play.run.world.player.invuln > 1.9, 'still about 2 s');
  const d = setup();
  d.play.run.world.player.dead = true;
  d.play.run.world.player.invuln = 0;
  d.play.resume();
  assert.equal(d.play.run.world.player.invuln, 0);
});

test('resume: a new run starts at full speed, and an unpaused fight never leaves the scale below 1', () => {
  const s = setup();
  pause(s);
  pause(s);
  tick(s, 3);
  assert.ok(s.play.run.timeScale < 1);
  s.play.enter(s.game, { runOpts: { seed: 2 } });
  assert.equal(s.play.resumeT, 0);
  tick(s, 1);
  assert.equal(s.play.run.timeScale, 1);
});

// -- the receipt's unlocks

test('victory: what a run unlocks is kept for the receipt, and a new run forgets it', () => {
  const s = setup();
  s.CB.HATS = [{ id: 'crown', name: 'Crown' }];
  const ids = ['crown', 'modes'];
  s.CB.Unlocks = { onEvents: () => ids.splice(0) };
  tick(s, 1);
  assert.deepEqual(H.plain(s.play.unlocked), ['hat Crown', 'boss rush + --yolo']);
  assert.equal(s.play.toasts.length, 2, 'the toasts are still queued');
  let seen = null;
  s.CB.Screens.stageIntro = { draw: (r, run, t, ui) => { seen = ui; } };
  s.game.input.peekAim = () => ({ x: 1, y: 1 });
  const r = { clear() {}, shaken: (a, b, fn) => fn(), alpha: (a, fn) => fn(), rect() {}, text() {}, frame() {} };
  s.CB.WorldDraw = { draw() {} };
  s.CB.Screens.hud = { draw() {}, cursor() {} };
  s.play.run.state = 'stageIntro';
  s.play.draw(r, 0);
  assert.deepEqual(H.plain(seen.unlocked), ['hat Crown', 'boss rush + --yolo'], 'handed to the screen');
  s.play.enter(s.game, { runOpts: { seed: 3 } });
  assert.deepEqual(H.plain(s.play.unlocked), []);
});
