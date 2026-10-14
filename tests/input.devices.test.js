'use strict';
// CB.createInput with every device: keyboard + mouse, gamepad (scripted through a fake navigator.getGamepads) and touch (pointer events).
// Covers device switching and the Prompts sync, the mouse compatibility-event guard, the 2 px mousemove rule, nav edges, the merged
// fields, aim directions per device and touch mode, taps and the pointer position they set, rumble routing, fullscreen-on-release,
// platform APIs that are missing or throw, and dispose.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/prompts.js', 'src/core/gamepad.js', 'src/core/touch.js', 'src/core/input.js'];
const plain = H.plain;

// ---- fakes ------------------------------------------------------------------------------------------------------------------

function fakeTarget() {
  const handlers = {};
  const t = {
    handlers,
    focused: 0,
    captured: [],
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    fire(type, ev) {
      const e = Object.assign({ repeat: false, defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } }, ev);
      for (const fn of (handlers[type] || []).slice()) fn(e);
      return e;
    },
    focus() { t.focused++; },
  };
  return t;
}

// A standard-mapping pad you can poke: down()/up() take button indices, axes() the four stick axes, trigger() an analog value.
function mkPad(over) {
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons.push({ pressed: false, touched: false, value: 0 });
  const pad = Object.assign({ id: 'fake pad', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] }, over || {});
  pad.down = (...ids) => { for (const i of ids) pad.buttons[i] = { pressed: true, touched: true, value: 1 }; return pad; };
  pad.up = (...ids) => { for (const i of ids) pad.buttons[i] = { pressed: false, touched: false, value: 0 }; return pad; };
  pad.stick = (lx, ly, rx, ry) => { pad.axes = [lx || 0, ly || 0, rx || 0, ry || 0]; return pad; };
  pad.trigger = (i, v) => { pad.buttons[i] = { pressed: v >= 0.5, touched: v > 0, value: v }; return pad; };
  return pad;
}
const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// The renderer maps client px to internal px by /4, so client (400, 200) is internal (100, 50).
// Internal points used below: move half x < 160 (client x < 640), aim half x >= 160; DASH at (298, 146), /compact at (272, 163), pause box (296..316, 22..40).
const CLIENT = { dash: [1192, 584], compact: [1088, 652], pause: [1224, 124], moveSide: [160, 400], aimSide: [800, 400] };

function makeEnv(o) {
  const opt = o || {};
  const CB = H.load(opt.files || FILES);
  const win = fakeTarget();
  const canvas = fakeTarget();
  const env = { CB, win, canvas, pads: [], vibes: [], audioInits: 0, promptCalls: [] };
  canvas.setPointerCapture = (id) => { canvas.captured.push(id); };
  if (opt.navigator !== null) {
    win.navigator = opt.navigator || { getGamepads: () => env.pads, vibrate: (v) => { env.vibes.push(v); return true; } };
  }
  if (opt.win) Object.assign(win, opt.win);
  if (opt.audio !== false) CB.Audio = { init() { env.audioInits++; } };
  if (CB.Prompts) {
    const real = CB.Prompts.setDevice;
    CB.Prompts.setDevice = (d) => { env.promptCalls.push(d); real(d); };
  }
  env.renderer = { toInternal: (x, y) => ({ x: x / 4, y: y / 4 }) };
  env.input = CB.createInput({ canvas, renderer: env.renderer, win });
  // helpers
  env.key = (code, extra) => win.fire('keydown', Object.assign({ code }, extra));
  env.keyUp = (code) => win.fire('keyup', { code });
  env.tdown = (id, cx, cy, ts) => canvas.fire('pointerdown', { pointerType: 'touch', pointerId: id, clientX: cx, clientY: cy, timeStamp: ts });
  env.tmove = (id, cx, cy, ts) => win.fire('pointermove', { pointerType: 'touch', pointerId: id, clientX: cx, clientY: cy, timeStamp: ts });
  env.tup = (id, ts) => win.fire('pointerup', { pointerType: 'touch', pointerId: id, timeStamp: ts });
  env.tcancel = (id, ts) => win.fire('pointercancel', { pointerType: 'touch', pointerId: id, timeStamp: ts });
  env.mdown = (cx, cy, extra) => canvas.fire('mousedown', Object.assign({ button: 0, clientX: cx, clientY: cy }, extra));
  env.mmove = (cx, cy, extra) => win.fire('mousemove', Object.assign({ clientX: cx, clientY: cy }, extra));
  env.mup = (extra) => win.fire('mouseup', Object.assign({ button: 0 }, extra));
  env.pad = (p) => { env.pads.length = 0; env.pads.push(p || null, null, null, null); return p; };
  env.device = () => env.input.device;
  return env;
}

// Puts the input on `device` the way a player would.
function useDevice(env, device) {
  if (device === 'kbm') env.key('KeyJ');
  else if (device === 'touch') env.tdown(90, 400, 200) && env.tup(90);
  else {
    const p = mkPad();
    env.pad(p);
    p.down(B.X);
    env.input.sample();
    p.up(B.X);
  }
  env.input.sample();
  assert.equal(env.input.device, device, 'setup: ' + device);
}

const NEW_FIELDS = ['device', 'aimDirX', 'aimDirY', 'aimAssist', 'navX', 'navY', 'tap', 'pad'];
const OLD_FIELDS = ['moveX', 'moveY', 'aimX', 'aimY', 'fire', 'dash', 'pause', 'mute', 'confirm', 'choice', 'retry', 'quit', 'compact', 'music', 'keys'];

// ---- the state shape ---------------------------------------------------------------------------------------------------------

test('input state: a fresh keyboard and mouse sample keeps every old field and gains the new ones at their idle values', () => {
  const e = makeEnv();
  const s = e.input.sample();
  for (const k of [...OLD_FIELDS, ...NEW_FIELDS]) assert.ok(k in s, k + ' is always present');
  assert.deepEqual(plain({ moveX: s.moveX, moveY: s.moveY, aimX: s.aimX, aimY: s.aimY, fire: s.fire, dash: s.dash, pause: s.pause, mute: s.mute, confirm: s.confirm, choice: s.choice, retry: s.retry, quit: s.quit, compact: s.compact, music: s.music, keys: s.keys }), {
    moveX: 0, moveY: 0, aimX: 160, aimY: 50, fire: false, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [],
  });
  assert.equal(s.device, 'kbm');
  assert.strictEqual(s.aimDirX, null);
  assert.strictEqual(s.aimDirY, null);
  assert.strictEqual(s.aimAssist, false);
  assert.strictEqual(s.navX, 0);
  assert.strictEqual(s.navY, 0);
  assert.strictEqual(s.tap, false);
  assert.strictEqual(s.pad, null);
});

test('input state: the new fields are present with the right types on every device, and the old booleans are real booleans', () => {
  const e = makeEnv();
  for (const dev of ['kbm', 'pad', 'touch', 'kbm']) {
    useDevice(e, dev);
    const s = e.input.sample();
    assert.equal(s.device, dev);
    for (const k of NEW_FIELDS) assert.ok(k in s, dev + ': ' + k);
    assert.ok(s.aimDirX === null || typeof s.aimDirX === 'number');
    assert.equal(s.aimDirX === null, s.aimDirY === null, 'aimDirX and aimDirY are null together');
    assert.equal(s.aimAssist, s.aimDirX !== null, 'aimAssist is exactly aimDirX !== null');
    assert.ok([-1, 0, 1].includes(s.navX) && [-1, 0, 1].includes(s.navY));
    assert.equal(typeof s.tap, 'boolean');
    assert.ok(s.pad === null || typeof s.pad === 'object');
    for (const k of ['fire', 'dash', 'pause', 'mute', 'confirm', 'retry', 'quit', 'compact', 'music']) assert.equal(typeof s[k], 'boolean', k);
  }
});

// ---- device tracking and the Prompts sync ---------------------------------------------------------------------------------------

test('device: the initial device comes from CB.Prompts.detect and is pushed into CB.Prompts', () => {
  const coarse = (q) => ({ matches: q === '(pointer: coarse)' });
  const phone = makeEnv({ win: { matchMedia: coarse } });
  assert.equal(phone.input.device, 'touch', 'a coarse pointer with no fine one is a phone');
  assert.equal(phone.CB.Prompts.device, 'touch');
  assert.equal(phone.CB.Prompts.text('start'), 'Tap to start');
  assert.deepEqual(phone.promptCalls, ['touch']);

  const laptop = makeEnv({ win: { matchMedia: (q) => ({ matches: q === '(pointer: coarse)' || q === '(any-pointer: fine)' }) } });
  assert.equal(laptop.input.device, 'kbm', 'a fine pointer anywhere wins');
  assert.equal(laptop.CB.Prompts.text('start'), 'Click to start');

  const throwing = makeEnv({ win: { matchMedia() { throw new Error('no media'); } } });
  assert.equal(throwing.input.device, 'kbm');
  const none = makeEnv();
  assert.equal(none.input.device, 'kbm', 'a window without matchMedia');
  assert.deepEqual(none.promptCalls, [], 'kbm to kbm is no change');
});

test('device: a new input resets a stale CB.Prompts.device', () => {
  const CB = H.load(FILES);
  CB.Prompts.setDevice('pad');
  const win = fakeTarget();
  const input = CB.createInput({ canvas: fakeTarget(), renderer: { toInternal: (x, y) => ({ x, y }) }, win });
  assert.equal(input.device, 'kbm');
  assert.equal(CB.Prompts.device, 'kbm');
});

test('device: keys, mouse buttons, mouse travel, pad presses and touches each take the device, and Prompts follow', () => {
  const e = makeEnv();
  const text = () => e.CB.Prompts.text('start');
  assert.equal(text(), 'Click to start');

  const p = e.pad(mkPad());
  p.down(B.A);
  e.input.sample();
  assert.equal(e.input.device, 'pad');
  assert.equal(text(), 'Press A to start');

  e.tdown(1, 400, 200);
  assert.equal(e.input.device, 'touch');
  assert.equal(text(), 'Tap to start');

  e.key('KeyW');
  assert.equal(e.input.device, 'kbm');
  assert.equal(text(), 'Click to start');

  e.tdown(2, 400, 200);
  e.mdown(10, 10);
  assert.equal(e.input.device, 'kbm', 'a real mouse press (no timeStamp, no touch flag) is the mouse');

  e.tdown(3, 400, 200);
  e.mmove(500, 500);
  assert.equal(e.input.device, 'kbm', 'a mouse that travelled far enough');
  assert.deepEqual(e.promptCalls, ['pad', 'touch', 'kbm', 'touch', 'kbm', 'touch', 'kbm'], 'CB.Prompts.setDevice is called on changes only');
});

test('device: a repeating key does not take the device back from a pad', () => {
  const e = makeEnv();
  e.key('KeyW');
  const p = e.pad(mkPad());
  p.down(B.A);
  e.input.sample();
  assert.equal(e.input.device, 'pad');
  e.key('KeyW', { repeat: true });
  e.key('KeyW', { repeat: true });
  assert.equal(e.input.device, 'pad', 'only a fresh key press counts as keyboard activity');
  e.key('KeyS');
  assert.equal(e.input.device, 'kbm');
});

test('device: keyup, blur and a context menu do not change it', () => {
  const e = makeEnv();
  useDevice(e, 'pad');
  e.keyUp('KeyW');
  e.win.fire('blur', {});
  e.canvas.fire('contextmenu', {});
  assert.equal(e.input.device, 'pad');
});

// ---- the mouse compatibility-event guard ----------------------------------------------------------------------------------------

test('mouse guard: events the browser marks as touch-born (sourceCapabilities.firesTouchEvents) are ignored', () => {
  const e = makeEnv();
  e.tdown(1, 400, 200);
  e.input.sample(); // the tap
  const compat = { sourceCapabilities: { firesTouchEvents: true } };
  e.mdown(40, 40, compat);
  e.mmove(900, 900, compat);
  const s = e.input.sample();
  assert.equal(s.device, 'touch');
  assert.equal(s.fire, false, 'no mouse fire');
  assert.equal(s.confirm, false);
  assert.equal(s.tap, false);
  assert.equal(s.aimX, 100, 'the aim is still the tap');
  assert.equal(s.aimY, 50);
  e.mdown(40, 40, { sourceCapabilities: { firesTouchEvents: false } });
  assert.equal(e.input.device, 'kbm', 'a real mouse that reports firesTouchEvents: false is accepted');
});

test('mouse guard: a mouse event under 1000 ms after a touch event is ignored, from 1000 ms on it is real', () => {
  const e = makeEnv();
  e.tdown(1, 400, 200, 5000);
  e.input.sample();
  e.canvas.fire('mousedown', { button: 0, clientX: 40, clientY: 40, timeStamp: 5999 });
  let s = e.input.sample();
  assert.equal(s.device, 'touch');
  assert.equal(s.fire, false);
  assert.equal(s.confirm, false);
  assert.equal(s.tap, false);
  e.canvas.fire('mousedown', { button: 0, clientX: 40, clientY: 40, timeStamp: 6000 });
  s = e.input.sample();
  assert.equal(s.device, 'kbm', 'exactly 1000 ms later it is a real click');
  assert.equal(s.fire, true);
  assert.equal(s.confirm, true);
  assert.equal(s.tap, true);
  assert.equal(s.aimX, 10);
});

test('mouse guard: a compat mousemove neither moves the aim nor takes the device, and a compat mouseup does not end a real hold', () => {
  const e = makeEnv();
  e.mdown(40, 40); // real mouse, no timeStamp
  e.input.sample();
  e.tdown(1, 400, 200, 100);
  e.win.fire('mousemove', { clientX: 900, clientY: 900, buttons: 1, timeStamp: 300 });
  assert.equal(e.input.device, 'touch');
  assert.equal(e.input.sample().aimX, 100, 'the tap point, not the compat move');
  e.win.fire('mouseup', { button: 0, timeStamp: 400 });
  assert.equal(e.input.sample().fire, true, 'the compat mouseup is ignored');
  e.win.fire('mouseup', { button: 0, timeStamp: 2000 });
  assert.equal(e.input.sample().fire, false, 'a real one releases');
});

test('mouse guard: a touch pointermove, pointerup and pointercancel each restart the 1000 ms window', () => {
  for (const mk of [(e) => e.tmove(1, 400, 200, 3000), (e) => e.tup(1, 3000), (e) => e.tcancel(1, 3000)]) {
    const e = makeEnv();
    e.tdown(1, 400, 200, 1000);
    mk(e);
    e.canvas.fire('mousedown', { button: 0, clientX: 4, clientY: 4, timeStamp: 3999 });
    assert.equal(e.input.device, 'touch', 'under 1000 ms after the last touch event, whichever kind');
    e.canvas.fire('mousedown', { button: 0, clientX: 4, clientY: 4, timeStamp: 4000 });
    assert.equal(e.input.device, 'kbm');
  }
});

test('mouse guard: lastTouchTS starts at -Infinity, and events with no timeStamp never count as compat', () => {
  const e = makeEnv();
  e.canvas.fire('mousedown', { button: 0, clientX: 4, clientY: 4, timeStamp: 0 });
  assert.equal(e.input.sample().confirm, true, 'a mouse event at time 0 before any touch is real');
  e.tdown(1, 400, 200, 50000);
  e.mdown(8, 8); // no timeStamp: a test event, not a compat event
  assert.equal(e.input.device, 'kbm');
  const e2 = makeEnv();
  e2.tdown(1, 400, 200); // a touch without a timeStamp leaves the window closed
  e2.canvas.fire('mousedown', { button: 0, clientX: 4, clientY: 4, timeStamp: 10 });
  assert.equal(e2.input.device, 'kbm');
});

test('mouse guard: touch pointers of other kinds (mouse, pen) are not touches', () => {
  const e = makeEnv();
  const down = e.canvas.fire('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 200, timeStamp: 10 });
  e.canvas.fire('pointerdown', { pointerType: 'pen', pointerId: 2, clientX: 400, clientY: 200, timeStamp: 10 });
  e.canvas.fire('pointerdown', { pointerId: 3, clientX: 400, clientY: 200 });
  e.win.fire('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: 5, clientY: 5, timeStamp: 11 });
  e.win.fire('pointerup', { pointerType: 'pen', pointerId: 2, timeStamp: 12 });
  assert.equal(down.defaultPrevented, false, 'a mouse pointerdown keeps its default');
  assert.deepEqual(e.canvas.captured, []);
  assert.equal(e.input.device, 'kbm');
  e.mdown(8, 8, { timeStamp: 13 });
  assert.equal(e.input.sample().confirm, true, 'and they never open the compat window');
});

// ---- the 2 px mousemove rule -------------------------------------------------------------------------------------------------------

test('mousemove: on a pad it takes the device back only after travelling 2 px from the last position it took', () => {
  const e = makeEnv();
  e.mmove(100, 100);
  assert.equal(e.input.sample().aimX, 25);
  const p = e.pad(mkPad());
  p.down(B.A);
  e.input.sample();
  assert.equal(e.input.device, 'pad');

  e.mmove(101, 100);
  assert.equal(e.input.device, 'pad', '1 px is a twitch');
  e.mmove(101, 101);
  assert.equal(e.input.device, 'pad', 'a 1 px diagonal (1.41) is still under 2');
  let s = e.input.sample();
  assert.equal(s.aimX, 25, 'a twitch does not move the aim either');
  assert.equal(s.aimY, 25);
  e.mmove(102, 100);
  assert.equal(e.input.device, 'kbm', 'but 2 px from where the mouse was last taken is real movement, slow drift included');
  s = e.input.sample();
  assert.equal(s.aimX, 25.5);
  assert.equal(s.aimY, 25);
});

test('mousemove: exactly 2 px counts, a stationary move event (0 px) never does', () => {
  const e = makeEnv();
  e.mmove(100, 100);
  useDevice(e, 'pad');
  e.mmove(100, 100);
  e.mmove(100, 100);
  assert.equal(e.input.device, 'pad');
  e.mmove(100, 102);
  assert.equal(e.input.device, 'kbm');
});

test('mousemove: on the keyboard and mouse device every move still updates the aim, however small', () => {
  const e = makeEnv();
  e.mmove(100, 100);
  e.mmove(101, 100);
  assert.equal(e.input.sample().aimX, 25.25);
  e.mmove(101.5, 100);
  assert.equal(e.input.sample().aimX, 25.375);
});

test('mousemove: the first move of a session is far from the origin, so it counts', () => {
  const e = makeEnv();
  useDevice(e, 'pad');
  e.mmove(300, 200);
  assert.equal(e.input.device, 'kbm');
});

test('mousedown takes the device at any distance', () => {
  const e = makeEnv();
  e.mmove(100, 100);
  useDevice(e, 'pad');
  e.mdown(100, 100);
  assert.equal(e.input.device, 'kbm');
});

// ---- nav edges --------------------------------------------------------------------------------------------------------------------

test('nav: arrows and WASD give one menu-navigation edge per press, on keydown only', () => {
  const e = makeEnv();
  const table = [['ArrowLeft', -1, 0], ['KeyA', -1, 0], ['ArrowRight', 1, 0], ['KeyD', 1, 0], ['ArrowUp', 0, -1], ['KeyW', 0, -1], ['ArrowDown', 0, 1], ['KeyS', 0, 1]];
  for (const [code, nx, ny] of table) {
    e.key(code);
    let s = e.input.sample();
    assert.equal(s.navX, nx, code + ' navX');
    assert.equal(s.navY, ny, code + ' navY');
    s = e.input.sample();
    assert.equal(s.navX, 0, code + ': the edge is consumed');
    assert.equal(s.navY, 0);
    e.key(code, { repeat: true });
    assert.equal(e.input.sample().navX + e.input.sample().navY, 0, code + ': key repeat is not an edge');
    e.keyUp(code);
  }
});

test('nav: both axes at once, and the last of two opposite keys in a tick wins', () => {
  const e = makeEnv();
  e.key('KeyD');
  e.key('KeyS');
  let s = e.input.sample();
  assert.equal(s.navX, 1);
  assert.equal(s.navY, 1);
  assert.equal(s.moveX, 1, 'held keys still walk');
  e.keyUp('KeyD');
  e.keyUp('KeyS');
  e.key('KeyA');
  e.key('KeyD');
  assert.equal(e.input.sample().navX, 1);
});

test('nav: other keys give none, and the existing key edges are untouched', () => {
  const e = makeEnv();
  e.key('Space');
  e.key('Digit2');
  e.key('KeyE');
  e.key('Enter');
  const s = e.input.sample();
  assert.equal(s.navX, 0);
  assert.equal(s.navY, 0);
  assert.equal(s.dash, true);
  assert.equal(s.choice, 2);
  assert.equal(s.compact, true);
  assert.equal(s.confirm, true);
  assert.equal(s.tap, false, 'Enter is a confirm without a tap');
});

test('nav: a Cmd-shortcut key still gives its edge (like every other key edge)', () => {
  const e = makeEnv();
  e.key('KeyA', { metaKey: true });
  assert.equal(e.input.sample().navX, -1);
});

test('nav: a pad D-pad press and an L-stick flick give edges, and the keyboard wins a tie', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  e.input.sample();
  p.down(B.RIGHT);
  let s = e.input.sample();
  assert.equal(s.navX, 1);
  assert.equal(s.navY, 0);
  assert.equal(e.input.sample().navX, 0, 'held D-pad: no second edge');
  p.up(B.RIGHT);
  p.stick(0, 0.7, 0, 0);
  s = e.input.sample();
  assert.equal(s.navY, 1, 'stick flick down');
  assert.equal(e.input.sample().navY, 0, 'latched until it falls back');
  p.stick(0, 0, 0, 0);
  e.input.sample();
  p.stick(-0.9, 0, 0, 0);
  assert.equal(e.input.sample().navX, -1, 're-armed');
  p.stick(0, 0, 0, 0);
  e.input.sample();
  p.down(B.LEFT);
  e.key('KeyD');
  assert.equal(e.input.sample().navX, 1, 'keyboard first');
});

// ---- merged fields ----------------------------------------------------------------------------------------------------------------

test('merge: movement is the sum of keyboard, pad and touch, clamped per axis', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  e.touchMode = e.input.setTouchMode('sticks');
  e.key('KeyD');
  p.stick(0.5, -0.5, 0, 0);
  let s = e.input.sample();
  assert.equal(s.moveX, 1, 'keyboard 1 + pad 0.5 clamps to 1');
  assert.equal(s.moveY, -0.5, 'pad alone');
  e.keyUp('KeyD');
  e.key('KeyA');
  s = e.input.sample();
  assert.equal(s.moveX, -0.5, 'keyboard -1 + pad 0.5');
  e.keyUp('KeyA');

  p.stick(0, 0, 0, 0);
  e.tdown(1, ...CLIENT.moveSide);
  e.tmove(1, CLIENT.moveSide[0] + 100, CLIENT.moveSide[1]); // 25 internal px to the right: past the stick radius, full right
  s = e.input.sample();
  assert.equal(s.moveX, 1, 'touch alone');
  e.key('KeyD');
  p.stick(0.5, 0, 0, 0);
  s = e.input.sample();
  assert.equal(s.moveX, 1, 'all three, clamped');
  e.keyUp('KeyD');
  e.key('KeyA');
  p.stick(0, 0, 0, 0);
  assert.equal(e.input.sample().moveX, 0, 'keyboard -1 and touch +1 cancel');
});

test('merge: a pad stick below its deadzone moves nothing, and a D-pad overrides the stick', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.stick(0.15, 0.15, 0, 0); // radial: 0.21 is under the 0.25 deadzone
  let s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, 0);
  p.stick(0, 0.4, 0, 0).down(B.LEFT);
  s = e.input.sample();
  assert.equal(s.moveX, -1);
  assert.equal(s.moveY, 0, 'D-pad wins over the stick');
});

test('merge: fire is the mouse, the pad (R-stick or RT) or the touch aim stick', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  assert.equal(e.input.sample().fire, false);
  e.mdown(40, 40);
  assert.equal(e.input.sample().fire, true, 'mouse');
  e.mup();
  assert.equal(e.input.sample().fire, false);
  p.stick(0, 0, 0.8, 0);
  assert.equal(e.input.sample().fire, true, 'R-stick');
  p.stick(0, 0, 0.4, 0);
  assert.equal(e.input.sample().fire, false, 'under the fire deflection');
  p.stick(0, 0, 0, 0).trigger(B.RT, 0.6);
  assert.equal(e.input.sample().fire, true, 'RT');
  p.trigger(B.RT, 0);
  assert.equal(e.input.sample().fire, false);
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.aimSide);
  assert.equal(e.input.sample().fire, true, 'touch aim stick held');
  e.tup(1);
  assert.equal(e.input.sample().fire, true, 'a tap keeps shooting at its point for a moment');
  for (let i = 0; i < 7; i++) e.input.sample();
  assert.equal(e.input.sample().fire, false, 'and then stops');
});

test('merge: pad edges feed confirm, dash, compact, pause and quit; keyboard edges still do', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  e.input.sample();
  const edgeNames = (s) => ['confirm', 'dash', 'compact', 'pause', 'quit'].filter((n) => s[n]);
  const press = (id) => { p.down(id); const s = e.input.sample(); p.up(id); e.input.sample(); return edgeNames(s); };
  assert.deepEqual(press(B.A), ['confirm', 'dash']);
  assert.deepEqual(press(B.LB), ['dash']);
  assert.deepEqual(press(B.RB), ['compact']);
  assert.deepEqual(press(B.B), ['compact']);
  assert.deepEqual(press(B.START), ['pause']);
  assert.deepEqual(press(B.BACK), ['quit']);
  assert.deepEqual(press(B.X), []);
  assert.deepEqual(press(B.Y), []);
  p.trigger(B.LT, 0.9);
  assert.deepEqual(edgeNames(e.input.sample()), ['dash'], 'LT crossing');
  assert.deepEqual(edgeNames(e.input.sample()), [], 'held LT: no second edge');
  p.trigger(B.LT, 0);
  e.input.sample();
  e.key('Escape');
  e.key('KeyQ');
  assert.deepEqual(edgeNames(e.input.sample()), ['pause', 'quit'], 'keyboard unchanged');
});

test('merge: sample().pad is the pad edge object, null with no pad, and the edges are consumed', () => {
  const e = makeEnv();
  assert.strictEqual(e.input.sample().pad, null, 'no pad');
  const p = e.pad(mkPad());
  let s = e.input.sample();
  assert.deepEqual(plain(s.pad), { a: false, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false }, 'a pad that is there but idle');
  p.down(B.A, B.RB);
  s = e.input.sample();
  assert.equal(s.pad.a, true);
  assert.equal(s.pad.rb, true);
  assert.equal(s.pad.b, false);
  s = e.input.sample();
  assert.equal(s.pad.a, false, 'held: no edge');
  e.pad(null);
  assert.strictEqual(e.input.sample().pad, null, 'unplugged again');
});

test('merge: touch edges feed dash, compact, pause (sticks mode) and confirm (menu mode)', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.dash);
  let s = e.input.sample();
  assert.equal(s.dash, true);
  assert.equal(s.compact, false);
  e.tup(1);
  e.tdown(2, ...CLIENT.compact);
  s = e.input.sample();
  assert.equal(s.compact, true);
  assert.equal(s.dash, false);
  e.tup(2);
  e.tdown(3, ...CLIENT.pause);
  s = e.input.sample();
  assert.equal(s.pause, true);
  assert.equal(s.confirm, false, 'sticks mode never confirms');
  e.tup(3);
  e.input.setTouchMode('menu');
  e.tdown(4, 400, 200);
  s = e.input.sample();
  assert.equal(s.confirm, true);
  assert.equal(s.dash || s.compact || s.pause, false);
  assert.equal(e.input.sample().confirm, false, 'consumed');
});

test('merge: tap is true for a left mouse press or a menu-mode touch tap, never for Enter, a pad A, the right button or a sticks-mode touch', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  e.input.sample();
  e.mdown(40, 40);
  let s = e.input.sample();
  assert.equal(s.tap, true);
  assert.equal(s.confirm, true);
  assert.equal(e.input.sample().tap, false, 'consumed');
  e.mdown(40, 40, { button: 2 });
  s = e.input.sample();
  assert.equal(s.tap, false);
  assert.equal(s.dash, true);
  e.key('Enter');
  s = e.input.sample();
  assert.equal(s.tap, false);
  assert.equal(s.confirm, true);
  p.down(B.A);
  s = e.input.sample();
  assert.equal(s.tap, false);
  assert.equal(s.confirm, true);
  p.up(B.A);
  e.input.sample();
  e.tdown(1, 400, 200);
  s = e.input.sample();
  assert.equal(s.tap, true, 'menu-mode touch');
  assert.equal(s.confirm, true);
  e.tup(1);
  e.input.setTouchMode('sticks');
  e.tdown(2, ...CLIENT.aimSide);
  s = e.input.sample();
  assert.equal(s.tap, false, 'sticks-mode touch');
  assert.equal(s.confirm, false);
});

// ---- aim directions ---------------------------------------------------------------------------------------------------------------

test('aimDir: keyboard and mouse aim has none, and no assist', () => {
  const e = makeEnv();
  const s = e.input.sample();
  assert.strictEqual(s.aimDirX, null);
  assert.strictEqual(s.aimDirY, null);
  assert.strictEqual(s.aimAssist, false);
  e.mdown(40, 40);
  e.mmove(80, 80);
  assert.strictEqual(e.input.sample().aimAssist, false);
});

test('aimDir: on a pad it is the R-stick unit vector, else the last one, starting straight up', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.down(B.X);
  let s = e.input.sample();
  assert.equal(s.device, 'pad');
  assert.equal(s.aimDirX, 0);
  assert.equal(s.aimDirY, -1, 'nothing aimed yet: up');
  assert.equal(s.aimAssist, true);
  p.up(B.X);
  p.stick(0, 0, 0.6, 0.8);
  s = e.input.sample();
  assert.ok(Math.abs(s.aimDirX - 0.6) < 1e-9 && Math.abs(s.aimDirY - 0.8) < 1e-9, 'unit length');
  p.stick(0, 0, 0, 0);
  s = e.input.sample();
  assert.ok(Math.abs(s.aimDirX - 0.6) < 1e-9 && Math.abs(s.aimDirY - 0.8) < 1e-9, 'the stick rests: the last direction stays');
  p.stick(0, 0, 0.1, 0.1);
  s = e.input.sample();
  assert.ok(Math.abs(s.aimDirX - 0.6) < 1e-9, 'inside the aim deadzone: unchanged');
  p.stick(0, 0, -2, 0);
  s = e.input.sample();
  assert.equal(s.aimDirX, -1);
  assert.equal(s.aimDirY, 0);
  assert.equal(s.aimAssist, true);
});

test('aimDir: drift on the R-stick is remembered but never makes it the aim while the mouse is the device', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.stick(0, 0, 0.4, 0); // 0.4: past the aim deadzone, under the device wake
  let s = e.input.sample();
  assert.equal(s.device, 'kbm', 'drift does not steal the device');
  assert.strictEqual(s.aimDirX, null, 'and the mouse still aims');
  assert.strictEqual(s.aimAssist, false);
  assert.equal(s.fire, false);
  p.stick(0, 0, 0, 0).down(B.A);
  s = e.input.sample();
  assert.equal(s.device, 'pad');
  assert.equal(s.aimDirX, 1, 'the direction the stick last pointed');
  assert.equal(s.aimDirY, 0);
});

test('aimDir: back to the mouse, it is null again', () => {
  const e = makeEnv();
  useDevice(e, 'pad');
  assert.equal(e.input.sample().aimAssist, true);
  e.key('KeyW');
  const s = e.input.sample();
  assert.strictEqual(s.aimDirX, null);
  assert.strictEqual(s.aimAssist, false);
});

test('aimDir: touch sticks mode gives the aim stick direction (up until used, then the last one), menu mode and other devices give none', () => {
  const e = makeEnv();
  useDevice(e, 'touch');
  e.input.setTouchMode('menu');
  let s = e.input.sample();
  assert.strictEqual(s.aimDirX, null, 'menu mode');
  assert.strictEqual(s.aimAssist, false);
  e.input.setTouchMode('sticks');
  s = e.input.sample();
  assert.equal(s.aimDirX, 0);
  assert.equal(s.aimDirY, -1, 'initial direction: up');
  assert.equal(s.aimAssist, true);
  e.tdown(1, ...CLIENT.aimSide);
  e.tmove(1, CLIENT.aimSide[0] + 40, CLIENT.aimSide[1]);
  s = e.input.sample();
  assert.equal(s.aimDirX, 1);
  assert.equal(s.aimDirY, 0);
  assert.equal(s.fire, true);
  e.tup(1);
  s = e.input.sample();
  assert.equal(s.aimDirX, 1, 'kept after the finger lifts');
  assert.equal(s.fire, false);
  e.key('KeyW');
  s = e.input.sample();
  assert.strictEqual(s.aimDirX, null, 'keyboard and mouse device: no direction even in sticks mode');
  assert.strictEqual(s.aimAssist, false);
});

test('aimDir: the touch aim direction is ignored while the pad is the device', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.aimSide);
  e.tmove(1, CLIENT.aimSide[0] + 40, CLIENT.aimSide[1]);
  const p = e.pad(mkPad());
  p.down(B.X);
  const s = e.input.sample();
  assert.equal(s.device, 'pad');
  assert.equal(s.aimDirX, 0, 'the pad direction (up), not the finger');
  assert.equal(s.aimDirY, -1);
});

// ---- touch ------------------------------------------------------------------------------------------------------------------------

test('touch: pointerdown prevents default, captures the pointer, focuses the canvas and takes the device', () => {
  const e = makeEnv();
  const ev = e.tdown(7, 400, 200);
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(e.canvas.captured, [7]);
  assert.equal(e.canvas.focused, 1);
  assert.equal(e.input.device, 'touch');
});

test('touch: a setPointerCapture that throws, or is missing, does not break the tap', () => {
  const e = makeEnv();
  e.canvas.setPointerCapture = () => { throw new Error('InvalidPointerId'); };
  assert.doesNotThrow(() => e.tdown(1, 400, 200));
  assert.equal(e.input.sample().tap, true);
  const e2 = makeEnv();
  delete e2.canvas.setPointerCapture;
  assert.doesNotThrow(() => e2.tdown(1, 400, 200));
  assert.equal(e2.input.sample().tap, true);
  const e3 = makeEnv();
  e3.canvas.focus = undefined;
  assert.doesNotThrow(() => e3.tdown(1, 400, 200));
});

test('touch: coordinates go through renderer.toInternal, letterbox values included', () => {
  const e = makeEnv();
  e.tdown(1, -40, 800); // internal (-10, 200): outside the 320x180 picture
  const s = e.input.sample();
  assert.equal(s.aimX, -10);
  assert.equal(s.aimY, 200);
  e.tup(1);
  e.input.setTouchMode('sticks');
  e.tdown(2, -40, 800);
  const v = e.input.touchView();
  assert.deepEqual(plain(v.move), { ox: -10, oy: 200, x: -10, y: 200 }, 'the stick origin is exactly where the finger landed');
});

test('touch: a menu-mode tap sets the pointer position, and whichever of tap and mouse moved last owns it', () => {
  const e = makeEnv();
  assert.deepEqual(plain(e.input.peekAim()), { x: 160, y: 50 }, 'no pointer yet: the default');
  e.tdown(1, 400, 200);
  let s = e.input.sample();
  assert.equal(s.aimX, 100);
  assert.equal(s.aimY, 50);
  assert.deepEqual(plain(e.input.peekAim()), { x: 100, y: 50 }, 'peekAim keeps the tap point');
  e.tup(1);
  e.mmove(800, 400);
  assert.deepEqual(plain(e.input.peekAim()), { x: 200, y: 100 }, 'a mouse move after the tap is newer');
  e.tdown(2, 40, 80);
  e.input.sample();
  assert.deepEqual(plain(e.input.peekAim()), { x: 10, y: 20 }, 'a tap after the mouse is newer');
  e.mdown(80, 80);
  assert.deepEqual(plain(e.input.peekAim()), { x: 20, y: 20 }, 'a click is a mouse position too');
  e.tup(2);
  e.input.setTouchMode('sticks');
  e.tdown(3, 4, 4);
  s = e.input.sample();
  assert.equal(s.aimX, 20, 'a sticks-mode touch is no pointer position');
});

test('touch: a tap with no mouse ever, then peekAim between samples, never throws', () => {
  const e = makeEnv();
  e.tdown(1, 400, 200);
  assert.doesNotThrow(() => e.input.peekAim());
  assert.doesNotThrow(() => e.input.sample());
});

test('touch: sticks mode drives the move stick, the aim stick and the buttons, with a third finger ignored', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.moveSide);
  e.tdown(2, ...CLIENT.aimSide);
  e.tdown(3, 200, 300); // a third finger on the move side: that stick is taken
  let s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, 0);
  assert.equal(s.fire, true);
  e.tmove(3, 500, 300);
  assert.equal(e.input.sample().moveX, 0, 'the ignored finger moves nothing');
  e.tmove(1, CLIENT.moveSide[0], CLIENT.moveSide[1] - 80); // 20 internal px up
  s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, -1);
  e.tmove(1, CLIENT.moveSide[0] - 80, CLIENT.moveSide[1] - 80); // the ring followed the finger up to (40, 96); now the finger is at (20, 80)
  s = e.input.sample();
  const len = Math.hypot(20, 16);
  assert.ok(Math.abs(s.moveX + 20 / len) < 1e-9 && Math.abs(s.moveY + 16 / len) < 1e-9, 'a unit direction, full speed: ' + s.moveX + ', ' + s.moveY);
  e.tup(1);
  s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, 0);
  assert.equal(s.fire, true, 'the aim finger is still down');
  e.tcancel(2);
  assert.equal(e.input.sample().fire, false, 'pointercancel releases the aim stick');
});

// ---- T1: tap to shoot where you tap -------------------------------------------------------------------------------------------

test('touch tap: a short tap on the aim half fires at the tapped point, with no direction and no assist, for the touch plus about 120 ms', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, 1000, 280); // internal (250, 70)
  let s = e.input.sample();
  assert.equal(s.fire, true);
  assert.strictEqual(s.aimDirX, null);
  assert.strictEqual(s.aimDirY, null);
  assert.strictEqual(s.aimAssist, false);
  assert.equal(s.aimX, 250);
  assert.equal(s.aimY, 70);
  e.tup(1);
  for (let i = 0; i < 7; i++) {
    s = e.input.sample();
    assert.equal(s.fire, true, 'shot tick ' + i);
    assert.equal(s.aimX, 250);
    assert.equal(s.aimY, 70);
    assert.strictEqual(s.aimDirX, null);
  }
  s = e.input.sample();
  assert.equal(s.fire, false);
  assert.equal(s.aimAssist, true, 'back to the stick direction (kept, up)');
  assert.equal(s.aimDirY, -1);
});

test('touch tap: a tap lifted before the next sample still shoots once at its point', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, 1000, 280);
  e.tup(1);
  const s = e.input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.aimX, 250);
  assert.equal(s.aimY, 70);
  assert.strictEqual(s.aimDirX, null);
});

test('touch tap: a hold (over 10 ticks) or a drag (6 px or more) is the stick as before, and a cancelled touch is no tap', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, 1000, 280);
  for (let i = 0; i < 12; i++) e.input.sample();
  let s = e.input.sample();
  assert.strictEqual(s.aimAssist, true, 'held: the stick direction');
  e.tup(1);
  assert.equal(e.input.sample().fire, false, 'a lift after a hold leaves no shot');

  e.tdown(2, 1000, 280);
  e.tmove(2, 1000 + 4 * 6, 280); // 6 internal px right
  s = e.input.sample();
  assert.strictEqual(s.aimAssist, true, 'dragged: the stick direction at once');
  assert.ok(s.aimDirX > 0.99, 'to the right: ' + s.aimDirX);
  e.tup(2);
  assert.equal(e.input.sample().fire, false);

  e.tdown(3, 1000, 280);
  e.tcancel(3);
  assert.equal(e.input.sample().fire, false, 'pointercancel is no tap');
});

test('touch tap: the move half, menu mode, the mouse and the pad are untouched by the tap shot', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.moveSide);
  e.tup(1);
  let s = e.input.sample();
  assert.equal(s.fire, false, 'a tap on the move half shoots nothing');
  e.input.setTouchMode('menu');
  e.tdown(2, 1000, 280);
  e.tup(2);
  s = e.input.sample();
  assert.equal(s.fire, false, 'menu taps are taps');
  assert.equal(s.tap, true);
  e.mdown(40, 40);
  assert.equal(e.input.sample().fire, true, 'the mouse still fires');
  e.mup();
});

// ---- T4: the layout follows the renderer's metrics ---------------------------------------------------------------------------

test('touch layout: with side bars the controls are hit where they are drawn, from the renderer metrics; without them nothing changes', () => {
  const e = makeEnv();
  const metrics = { x0: -51, y0: 0, x1: 371, y1: 180, safe: { l: 0, t: 0, r: 0, b: 0 } };
  e.renderer.metrics = () => metrics;
  e.renderer.toInternal = (x, y) => ({ x: x / 4 - 51, y: y / 4 });
  const L = e.CB.Touch.layoutFor(metrics);
  assert.equal(L.bars, true);
  e.input.setTouchMode('sticks');
  // DASH in the right bar, drawn at L.dash
  e.tdown(1, (L.dash.x + 51) * 4, L.dash.y * 4);
  let s = e.input.sample();
  assert.equal(s.dash, true, 'a touch on the bar DASH is a dash');
  assert.equal(s.fire, false);
  e.tup(1);
  e.tdown(2, (L.pause.x + 5 + 51) * 4, (L.pause.y + 5) * 4);
  assert.equal(e.input.sample().pause, true, 'II in the right bar');
  e.tup(2);
  // The old DASH spot is now just aim ground (inside the arena, on the aim half)
  e.tdown(3, (298 + 51) * 4, 146 * 4);
  s = e.input.sample();
  assert.equal(s.dash, false);
  assert.equal(s.fire, true);
  e.tup(3);

  // No bars: back to the in-arena buttons.
  Object.assign(metrics, { x0: 0, x1: 320 });
  e.renderer.toInternal = (x, y) => ({ x: x / 4, y: y / 4 });
  e.tdown(4, ...CLIENT.dash);
  assert.equal(e.input.sample().dash, true);
});

test('touch layout: a renderer without metrics, or a Touch without setLayout, keeps the in-arena layout', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.dash);
  assert.equal(e.input.sample().dash, true);
  const f = makeEnv({ files: ['src/core/ns.js', 'src/core/math.js', 'src/core/input.js'] });
  f.renderer.metrics = () => ({ x0: -51, x1: 371, y0: 0, y1: 180 });
  assert.doesNotThrow(() => f.input.sample());
});

test('touch: a move or an up for a pointer that never went down is harmless', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  assert.doesNotThrow(() => {
    e.tmove(99, 100, 100);
    e.tup(99);
    e.tcancel(99);
  });
  const s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.fire, false);
});

test('touch: setTouchMode ignores junk, and a mode change makes a finger that was already down inert until it lifts', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.input.setTouchMode('bogus');
  e.input.setTouchMode(undefined);
  e.tdown(1, ...CLIENT.aimSide);
  assert.equal(e.input.sample().fire, true, 'still in sticks mode');
  e.input.setTouchMode('menu');
  assert.equal(e.input.sample().fire, false, 'the finger from the old mode is ignored');
  e.tmove(1, 900, 400);
  e.tup(1);
  const s = e.input.sample();
  assert.equal(s.confirm, false);
  assert.equal(s.tap, false);
});

test('touch: touchView() is null unless the device is touch, and then it is the Touch view', () => {
  const e = makeEnv();
  assert.strictEqual(e.input.touchView(), null);
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.moveSide);
  const v = e.input.touchView();
  assert.equal(v.mode, 'sticks');
  assert.ok(v.move && v.aim === null);
  assert.equal(v.dashDown, false);
  e.key('KeyW');
  assert.strictEqual(e.input.touchView(), null, 'back on the keyboard');
  useDevice(e, 'pad');
  assert.strictEqual(e.input.touchView(), null);
});

test('touch: releaseAll lets go of the sticks as well as keys and fire; the mouse leaving the canvas only lets go of the latter', () => {
  const e = makeEnv();
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.moveSide);
  e.tmove(1, CLIENT.moveSide[0] + 100, CLIENT.moveSide[1]);
  e.tdown(2, ...CLIENT.aimSide);
  e.key('KeyW');
  e.mdown(40, 40);
  let s = e.input.sample();
  assert.equal(s.moveX, 1);
  assert.equal(s.fire, true);
  e.canvas.fire('mouseleave', {});
  s = e.input.sample();
  assert.equal(s.moveX, 1, 'the touch stick survives a mouseleave');
  assert.equal(s.moveY, 0, 'the held key does not');
  assert.equal(s.fire, true, 'the aim finger is still holding fire');
  e.input.releaseAll();
  s = e.input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.fire, false);
  e.tmove(1, CLIENT.moveSide[0] + 100, CLIENT.moveSide[1]);
  assert.equal(e.input.sample().moveX, 0, 'the released finger no longer steers');

  const e2 = makeEnv();
  e2.input.setTouchMode('sticks');
  e2.tdown(1, ...CLIENT.aimSide);
  assert.equal(e2.input.sample().fire, true);
  e2.win.fire('blur', {});
  assert.equal(e2.input.sample().fire, false, 'window blur releases touch too');
});

test('touch: releaseAll leaves a pending fullscreen request armed (game.go calls it right around starting a run)', () => {
  const e = makeEnv();
  const calls = [];
  e.CB.Touch.requestFullscreen = (d, s) => calls.push([d, s]);
  e.input.requestFullscreenOnRelease();
  e.input.releaseAll();
  e.tdown(1, 400, 200);
  e.tup(1);
  assert.equal(calls.length, 1);
});

// ---- gamepad ----------------------------------------------------------------------------------------------------------------------

test('pad: a fake navigator.getGamepads drives movement, aim and fire each sample (and is polled fresh every time)', () => {
  const e = makeEnv();
  let polls = 0;
  e.win.navigator.getGamepads = () => { polls++; return e.pads; };
  const p = e.pad(mkPad());
  p.stick(0.7, -0.2, 0, 0);
  const s = e.input.sample();
  assert.equal(s.moveX, 0.7);
  assert.equal(s.moveY, -0.2);
  assert.equal(polls, 1);
  e.input.sample();
  e.input.sample();
  assert.equal(polls, 3, 'once per sample');
  e.pad(null);
  assert.equal(e.input.sample().moveX, 0, 'unplugged: nothing');
});

test('pad: getGamepads that throws, returns junk or is missing is treated as no pad', () => {
  for (const nav of [
    { getGamepads() { throw new Error('SecurityError: permissions policy'); } },
    { getGamepads: () => null },
    { getGamepads: () => [null, null] },
    { getGamepads: () => 'nope' },
    { getGamepads: () => undefined },
    { getGamepads: 42 },
    {},
    null,
  ]) {
    const e = makeEnv({ navigator: nav });
    e.key('KeyD');
    let s;
    assert.doesNotThrow(() => { s = e.input.sample(); });
    assert.equal(s.moveX, 1, 'the keyboard still plays');
    assert.strictEqual(s.pad, null);
    assert.equal(s.device, 'kbm');
    assert.equal(e.input.rumble(1, 1, 100, 30), false);
  }
});

test('pad: a window with no navigator at all works', () => {
  const e = makeEnv({ navigator: null });
  assert.equal(e.win.navigator, undefined);
  assert.doesNotThrow(() => e.input.sample());
  assert.equal(e.input.rumble(1, 1, 100, 30), false);
});

test('pad: getGamepads is called as a method of navigator', () => {
  const nav = { marker: 'nav', getGamepads() { return this === nav ? [mkPad().down(B.A)] : null; } };
  const e = makeEnv({ navigator: nav });
  assert.equal(e.input.sample().confirm, true);
});

test('pad: the standard-mapping pad is preferred, and a disconnected one is skipped', () => {
  const e = makeEnv();
  const odd = mkPad({ mapping: '', index: 0 });
  const std = mkPad({ index: 1 });
  e.pads.push(odd, std);
  odd.down(B.B);
  std.down(B.Y);
  const s = e.input.sample();
  assert.equal(s.pad.y, true, 'the standard pad was read');
  assert.equal(s.pad.b, false);
  e.pads.length = 0;
  e.pads.push(mkPad({ connected: false }).down(B.A));
  assert.strictEqual(e.input.sample().pad, null);
});

test('pad device: a button press edge takes the device once; held buttons never take it back', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.down(B.RB);
  e.input.sample();
  assert.equal(e.input.device, 'pad');
  e.key('KeyW'); // keyboard now
  assert.equal(e.input.device, 'kbm');
  e.input.sample();
  e.input.sample();
  assert.equal(e.input.device, 'kbm', 'RB is still held but it is not a new press');
  p.up(B.RB);
  e.input.sample();
  assert.equal(e.input.device, 'kbm', 'releasing is not activity');
  p.down(B.RB);
  e.input.sample();
  assert.equal(e.input.device, 'pad', 'a new press is');
});

test('pad device: every button counts, the D-pad and the stick clicks included', () => {
  for (const id of [B.A, B.B, B.X, B.Y, B.LB, B.RB, B.BACK, B.START, B.LS, B.RS, B.UP, B.DOWN, B.LEFT, B.RIGHT]) {
    const e = makeEnv();
    const p = e.pad(mkPad());
    p.down(id);
    e.input.sample();
    assert.equal(e.input.device, 'pad', 'button ' + id);
  }
});

test('pad device: a trigger takes the device when it crosses its threshold, not while it is held or half-pulled', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.trigger(B.RT, 0.2);
  e.input.sample();
  assert.equal(e.input.device, 'kbm', 'under the threshold');
  p.trigger(B.RT, 0.5);
  e.input.sample();
  assert.equal(e.input.device, 'pad', 'crossing');
  e.key('KeyW');
  p.trigger(B.RT, 1);
  e.input.sample();
  assert.equal(e.input.device, 'kbm', 'a deeper pull of a trigger that is already down is no edge');
  p.trigger(B.RT, 0);
  e.input.sample();
  p.trigger(B.LT, 0.6);
  e.input.sample();
  assert.equal(e.input.device, 'pad', 'LT as well');
});

test('pad device: a stick takes it only past 0.5; below that it still moves and aims', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.stick(0.4, 0.2, 0, 0);
  let s = e.input.sample();
  assert.equal(e.input.device, 'kbm', 'drift between the deadzone and 0.5');
  assert.equal(s.moveX, 0.4, 'still moves');
  assert.equal(s.moveY, 0.2);
  p.stick(0.5, 0, 0, 0);
  e.input.sample();
  assert.equal(e.input.device, 'kbm', 'exactly 0.5 is not past it');
  p.stick(0.55, 0, 0, 0);
  e.input.sample();
  assert.equal(e.input.device, 'pad');
  p.stick(0, 0, 0, 0);
  e.key('KeyW');
  e.input.sample();
  assert.equal(e.input.device, 'kbm');
  p.stick(0, 0, 0.2, 0.55);
  e.input.sample();
  assert.equal(e.input.device, 'pad', 'the R-stick too (magnitude, not one axis)');
});

test('pad device: a stick held past 0.5 keeps the device (a stick is a level, buttons and triggers are edges)', () => {
  // Rev 2 only exempts drift under 0.5. A stick held hard over is the player still using the pad, so a stray key does not flip the prompts.
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.stick(0.9, 0, 0, 0);
  e.input.sample();
  assert.equal(e.input.device, 'pad');
  e.key('KeyW');
  assert.equal(e.input.device, 'kbm');
  e.input.sample();
  assert.equal(e.input.device, 'pad', 'the stick is still pushed over');
});

test('pad device: a pad that disconnects and returns with a button held is no new press', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.down(B.A);
  assert.equal(e.input.sample().confirm, true);
  e.pad(null);
  e.input.sample();
  e.key('KeyW');
  e.pad(p);
  const s = e.input.sample();
  assert.equal(s.confirm, false, 'no second A edge');
  assert.equal(e.input.device, 'kbm', 'and it does not take the device');
});

test('pad audio: the audio context is unlocked on a button press edge (a pad press is a user gesture), not on sticks or held buttons', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  e.input.sample();
  assert.equal(e.audioInits, 0);
  p.stick(0.9, 0, 0, 0);
  e.input.sample();
  assert.equal(e.audioInits, 0, 'a stick is not a gesture');
  p.stick(0, 0, 0, 0);
  e.input.sample();
  p.down(B.A);
  e.input.sample();
  assert.equal(e.audioInits, 1);
  e.input.sample();
  assert.equal(e.audioInits, 1, 'held');
  p.up(B.A).down(B.START);
  e.input.sample();
  assert.equal(e.audioInits, 2, 'another press');
  p.up(B.START).trigger(B.RT, 0.9);
  e.input.sample();
  assert.equal(e.audioInits, 3, 'a trigger crossing');
});

test('pad audio: a missing, throwing or non-function CB.Audio.init never breaks a sample', () => {
  for (const audio of [undefined, {}, { init: 5 }, { init() { throw new Error('no audio'); } }]) {
    const e = makeEnv({ audio: false });
    if (audio !== undefined) e.CB.Audio = audio;
    const p = e.pad(mkPad());
    p.down(B.A);
    let s;
    assert.doesNotThrow(() => { s = e.input.sample(); });
    assert.equal(s.confirm, true);
    assert.equal(e.input.device, 'pad');
  }
});

// ---- rumble -----------------------------------------------------------------------------------------------------------------------

function rumblePad() {
  const effects = [];
  const pad = mkPad({ vibrationActuator: { playEffect(type, params) { effects.push([type, params]); return Promise.resolve('complete'); } } });
  return { pad, effects };
}

test('rumble: on a pad it dual-rumbles the pad in use', () => {
  const e = makeEnv();
  const { pad, effects } = rumblePad();
  e.pad(pad);
  pad.down(B.A);
  e.input.sample();
  assert.equal(e.input.rumble(0.8, 0.4, 160, 40), true);
  assert.equal(effects.length, 1);
  assert.equal(effects[0][0], 'dual-rumble');
  assert.deepEqual(plain(effects[0][1]), { startDelay: 0, duration: 160, weakMagnitude: 0.4, strongMagnitude: 0.8 });
  assert.deepEqual(e.vibes, [], 'no phone vibration on a pad');
});

test('rumble: it talks to the pad of the latest sample, and to nothing once that pad is gone', () => {
  const e = makeEnv();
  const a = rumblePad();
  const b = rumblePad();
  e.pad(a.pad);
  a.pad.down(B.A);
  e.input.sample();
  e.input.rumble(1, 1, 50);
  e.pad(b.pad);
  b.pad.down(B.A);
  e.input.sample();
  e.input.rumble(1, 1, 50);
  assert.equal(a.effects.length, 1);
  assert.equal(b.effects.length, 1);
  e.pad(null);
  e.input.sample();
  assert.equal(e.input.rumble(1, 1, 50), false);
  assert.equal(b.effects.length, 1);
});

test('rumble: a pad with no actuator, or a rejecting one, is fine', () => {
  const e = makeEnv();
  const p = e.pad(mkPad());
  p.down(B.A);
  e.input.sample();
  assert.equal(e.input.rumble(1, 1, 50), false, 'no vibrationActuator');
  p.vibrationActuator = { playEffect: () => Promise.reject(new Error('asleep')) };
  assert.equal(e.input.rumble(1, 1, 50), true);
  p.vibrationActuator = { playEffect() { throw new Error('boom'); } };
  assert.equal(e.input.rumble(1, 1, 50), false);
});

test('rumble: on touch it vibrates the phone with the vib pattern', () => {
  const e = makeEnv();
  useDevice(e, 'touch');
  assert.equal(e.input.rumble(0.8, 0.4, 160, 40), true);
  assert.equal(e.input.rumble(1, 1, 400, [60, 40, 120]), true);
  assert.deepEqual(plain(e.vibes), [40, [60, 40, 120]]);
});

test('rumble: on touch, no vib, no vibrate() or a throwing one does nothing and does not throw', () => {
  const e = makeEnv();
  useDevice(e, 'touch');
  assert.equal(e.input.rumble(1, 1, 100), false, 'no pattern');
  assert.equal(e.input.rumble(1, 1, 100, null), false);
  assert.deepEqual(e.vibes, []);
  e.win.navigator.vibrate = () => { throw new Error('blocked'); };
  assert.equal(e.input.rumble(1, 1, 100, 30), false);
  e.win.navigator.vibrate = undefined;
  assert.equal(e.input.rumble(1, 1, 100, 30), false);
});

test('rumble: on the keyboard and mouse it does nothing, even with a pad plugged in and a phone-style navigator', () => {
  const e = makeEnv();
  const { pad, effects } = rumblePad();
  e.pad(pad);
  e.input.sample();
  assert.equal(e.input.device, 'kbm');
  assert.equal(e.input.rumble(1, 1, 100, 30), false);
  assert.equal(effects.length, 0);
  assert.deepEqual(e.vibes, []);
});

test('rumble: it is a sink Haptics can use', () => {
  const files = [...FILES, 'src/core/haptics.js'];
  const e = makeEnv({ files });
  useDevice(e, 'touch');
  assert.equal(e.CB.Haptics.handleEvents([{ type: 'playerHurt' }, { type: 'pickup' }], e.input), 'playerHurt');
  assert.deepEqual(plain(e.vibes), [40]);
});

// ---- fullscreen on release ----------------------------------------------------------------------------------------------------------

test('fullscreen: requestFullscreenOnRelease waits for the next touch pointerup, then calls CB.Touch.requestFullscreen(document, screen) once', () => {
  const doc = { documentElement: {} };
  const scr = { orientation: {} };
  const e = makeEnv({ win: { document: doc, screen: scr } });
  const calls = [];
  e.CB.Touch.requestFullscreen = (d, s) => calls.push([d, s]);
  e.tdown(1, 400, 200);
  e.tup(1);
  assert.equal(calls.length, 0, 'not armed yet');
  e.input.requestFullscreenOnRelease();
  e.tdown(2, 400, 200);
  assert.equal(calls.length, 0, 'a touch pointerdown is not a user activation');
  e.tmove(2, 404, 200);
  assert.equal(calls.length, 0);
  e.tcancel(2);
  assert.equal(calls.length, 0, 'a cancel is not an activation either');
  e.win.fire('pointerup', { pointerType: 'mouse', pointerId: 5 });
  assert.equal(calls.length, 0, 'only touch counts');
  e.tdown(3, 400, 200);
  e.tup(3);
  assert.equal(calls.length, 1);
  assert.strictEqual(calls[0][0], doc);
  assert.strictEqual(calls[0][1], scr);
  e.tdown(4, 400, 200);
  e.tup(4);
  assert.equal(calls.length, 1, 'cleared after one request');
  e.input.requestFullscreenOnRelease();
  e.tdown(5, 400, 200);
  e.tup(5);
  assert.equal(calls.length, 2, 'and it can be armed again');
});

test('fullscreen: missing document and screen, a missing or throwing CB.Touch.requestFullscreen are all survivable', () => {
  const e = makeEnv();
  const calls = [];
  e.CB.Touch.requestFullscreen = (d, s) => calls.push([d, s]);
  e.input.requestFullscreenOnRelease();
  e.tdown(1, 400, 200);
  assert.doesNotThrow(() => e.tup(1));
  assert.deepEqual(calls, [[undefined, undefined]], 'the Touch helper does its own guarding');

  const e2 = makeEnv();
  e2.CB.Touch.requestFullscreen = () => { throw new Error('denied'); };
  e2.input.requestFullscreenOnRelease();
  e2.tdown(1, 400, 200);
  assert.doesNotThrow(() => e2.tup(1));
  e2.tdown(2, 400, 200);
  assert.doesNotThrow(() => e2.tup(2), 'and it was cleared');

  const e3 = makeEnv();
  e3.CB.Touch.requestFullscreen = undefined;
  e3.input.requestFullscreenOnRelease();
  e3.tdown(1, 400, 200);
  assert.doesNotThrow(() => e3.tup(1));
});

test('fullscreen: with the real Touch helper and a fake document it asks for fullscreen, then the landscape lock', async () => {
  const log = [];
  const doc = { documentElement: { requestFullscreen: (o) => { log.push(['fs', o && o.navigationUI]); return Promise.resolve(); } } };
  const scr = { orientation: { lock: (m) => { log.push(['lock', m]); return Promise.resolve(); } } };
  const e = makeEnv({ win: { document: doc, screen: scr } });
  e.input.requestFullscreenOnRelease();
  e.tdown(1, 400, 200);
  e.tup(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(log, [['fs', 'hide'], ['lock', 'landscape']]);
});

// ---- withActivation ----------------------------------------------------------------------------------------------------------------------

test('withActivation: with no touch down it runs now (a key or a click already granted the activation), once', () => {
  const e = makeEnv();
  const log = [];
  assert.equal(e.input.withActivation(() => log.push('a')), true, 'true: it ran now');
  assert.deepEqual(log, ['a']);
  e.tdown(1, 400, 200);
  e.tup(1);
  assert.deepEqual(log, ['a'], 'a later touch does not run it again');
  e.key('KeyC');
  assert.equal(e.input.withActivation(() => log.push('b')), true, 'after a key');
  e.mdown(400, 200);
  assert.equal(e.input.withActivation(() => log.push('c')), true, 'after a click');
  assert.deepEqual(log, ['a', 'b', 'c']);
});

test('withActivation: while a touch pointer is down it waits for the next touch pointerup and runs there, once', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, 400, 200);
  assert.equal(e.input.withActivation(() => log.push('x')), false, 'false: it is waiting');
  assert.deepEqual(log, []);
  e.tmove(1, 404, 200);
  e.key('KeyC');
  e.mdown(400, 200);
  e.win.fire('pointerup', { pointerType: 'mouse', pointerId: 1 });
  assert.deepEqual(log, [], 'a move, a key, a click and a mouse pointerup are not the touch release');
  e.tup(1);
  assert.deepEqual(log, ['x'], 'the release runs it');
  e.tdown(2, 400, 200);
  e.tup(2);
  assert.deepEqual(log, ['x'], 'and only once');
});

test('withActivation: it runs inside the pointerup handler, after the touch layer has taken the release, and the fullscreen request goes first', () => {
  const doc = { documentElement: {} };
  const e = makeEnv({ win: { document: doc, screen: {} } });
  const order = [];
  e.CB.Touch.requestFullscreen = () => order.push('fullscreen');
  const upCalls = [];
  const realUp = e.CB.Touch.up;
  e.CB.Touch.up = (st, id) => { upCalls.push(id); order.push('touch.up'); return realUp(st, id); };
  e.input.requestFullscreenOnRelease();
  e.tdown(7, 400, 200);
  e.input.withActivation(() => order.push('fn'));
  e.tup(7);
  assert.deepEqual(order, ['touch.up', 'fullscreen', 'fn']);
  assert.deepEqual(upCalls, [7]);
});

test('withActivation: with two fingers down it runs at the first lift, even though another is still down', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, ...CLIENT.moveSide);
  e.tdown(2, ...CLIENT.aimSide);
  e.input.withActivation(() => log.push('x'));
  e.tup(2);
  assert.deepEqual(log, ['x'], 'a pointerup is an activation whichever finger it is');
  e.tup(1);
  assert.deepEqual(log, ['x']);
  // A function asked for while one finger is still down waits for that finger.
  e.tdown(3, ...CLIENT.moveSide);
  e.tdown(4, ...CLIENT.aimSide);
  e.tup(4);
  e.input.withActivation(() => log.push('y'));
  assert.deepEqual(log, ['x'], 'one finger is still down: it waits');
  e.tup(3);
  assert.deepEqual(log, ['x', 'y']);
});

test('withActivation: a cancelled touch is no activation, and with no finger left the waiting function is dropped, not saved for a later tap', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, 400, 200);
  e.input.withActivation(() => log.push('x'));
  e.tcancel(1);
  assert.deepEqual(log, [], 'a cancel is not a release');
  e.tdown(2, 400, 200);
  e.tup(2);
  assert.deepEqual(log, [], 'the cancelled tap is over: a later one does not fire it');
  assert.equal(e.input.withActivation(() => log.push('y')), true, 'and with no finger down a new request runs at once');
  assert.deepEqual(log, ['y']);
  // One finger cancelled, another still down: the request survives for that finger's release.
  e.tdown(3, ...CLIENT.moveSide);
  e.tdown(4, ...CLIENT.aimSide);
  e.input.withActivation(() => log.push('z'));
  e.tcancel(3);
  assert.deepEqual(log, ['y']);
  e.tup(4);
  assert.deepEqual(log, ['y', 'z']);
});

test('withActivation: several waiting functions each run once, in the order they were asked', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, 400, 200);
  e.input.withActivation(() => log.push(1));
  e.input.withActivation(() => log.push(2));
  e.input.withActivation(() => log.push(3));
  e.tup(1);
  e.tdown(2, 400, 200);
  e.tup(2);
  assert.deepEqual(log, [1, 2, 3]);
});

test('withActivation: a function that throws never reaches the page, now or at the release, and the rest still run', () => {
  const e = makeEnv();
  const log = [];
  assert.doesNotThrow(() => e.input.withActivation(() => { throw new Error('boom'); }));
  e.tdown(1, 400, 200);
  e.input.withActivation(() => { throw new Error('later'); });
  e.input.withActivation(() => log.push('after'));
  assert.doesNotThrow(() => e.tup(1));
  assert.deepEqual(log, ['after']);
  e.tdown(2, 400, 200);
  assert.doesNotThrow(() => e.tup(2));
  assert.equal(e.input.sample().device, 'touch', 'input is intact');
});

test('withActivation: anything but a function is ignored, and a function asked for inside a release runs at once', () => {
  const e = makeEnv();
  for (const junk of [undefined, null, 'x', 5, {}, []]) assert.equal(e.input.withActivation(junk), false);
  e.tdown(1, 400, 200);
  e.input.withActivation(undefined);
  e.input.withActivation(7);
  const log = [];
  e.input.withActivation(() => {
    log.push('outer');
    e.input.withActivation(() => log.push('inner'));
  });
  e.tup(1);
  assert.deepEqual(log, ['outer', 'inner'], 'the finger is up, so the inner one has its activation already');
});

test('withActivation: losing the window drops what waits and forgets the fingers, so the next request runs at once', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, 400, 200);
  e.input.withActivation(() => log.push('x'));
  e.win.fire('blur', {});
  assert.deepEqual(log, []);
  e.tup(1);
  assert.deepEqual(log, [], 'the blur dropped it');
  e.tdown(2, 400, 200);
  e.win.fire('blur', {});
  assert.equal(e.input.withActivation(() => log.push('y')), true, 'no finger is counted after a blur');
  assert.deepEqual(log, ['y']);
});

test('withActivation: dispose drops what waits', () => {
  const e = makeEnv();
  const log = [];
  e.tdown(1, 400, 200);
  e.input.withActivation(() => log.push('x'));
  e.input.dispose();
  e.win.fire('pointerup', { pointerType: 'touch', pointerId: 1 });
  assert.deepEqual(log, []);
});

test('withActivation: without a touch module a touch is not tracked, so it runs at once', () => {
  const e = makeEnv({ files: ['src/core/ns.js', 'src/core/math.js', 'src/core/input.js'] });
  const log = [];
  e.canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(e.input.withActivation(() => log.push('x')), true);
  assert.deepEqual(log, ['x']);
});

test('withActivation: it changes nothing else -- a tap still reads as a tap and the device stays touch', () => {
  const e = makeEnv();
  e.tdown(1, 400, 200);
  e.input.withActivation(() => {});
  const s = e.input.sample();
  assert.equal(s.device, 'touch');
  assert.equal(s.tap, true);
  assert.equal(s.confirm, true);
  assert.equal(s.aimX, 100);
  assert.equal(s.aimY, 50);
  e.tup(1);
  const s2 = e.input.sample();
  assert.equal(s2.tap, false);
  assert.equal(s2.confirm, false);
});

// ---- modules that are not loaded ----------------------------------------------------------------------------------------------------

test('partial environment: without Prompts, Gamepad or Touch the keyboard and mouse still work and nothing throws', () => {
  const e = makeEnv({ files: ['src/core/ns.js', 'src/core/math.js', 'src/core/input.js'] });
  assert.equal(e.CB.Prompts, undefined);
  e.key('KeyD');
  e.mdown(400, 200);
  const dirty = e.canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 200 });
  assert.equal(dirty.defaultPrevented, false, 'with no touch module a touch is left to the browser');
  e.win.fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 5, clientY: 5 });
  e.win.fire('pointerup', { pointerType: 'touch', pointerId: 1 });
  const s = e.input.sample();
  assert.equal(s.moveX, 1);
  assert.equal(s.fire, true);
  assert.equal(s.device, 'kbm');
  assert.strictEqual(s.pad, null);
  assert.strictEqual(e.input.touchView(), null);
  assert.doesNotThrow(() => e.input.setTouchMode('sticks'));
  assert.equal(e.input.rumble(1, 1, 10, 10), false);
  e.input.requestFullscreenOnRelease();
  assert.doesNotThrow(() => e.input.releaseAll());
});

test('stubbed Touch: the aim direction follows the mode input was told, and a tap is the tap point, not the confirm edge', () => {
  const e = makeEnv();
  let out = { active: true, moveX: 0, moveY: 0, aimDirX: 1, aimDirY: 0, fire: false, edges: { dash: false, compact: false, pause: false, confirm: false }, tap: null };
  const seen = [];
  e.CB.Touch = { createState: () => ({}), setMode: (st, m) => seen.push(m), sample: () => out, down() {}, move() {}, up() {}, releaseAll() {}, view: () => ({ mode: 'x' }) };
  e.tdown(1, 400, 200); // device touch
  let s = e.input.sample();
  assert.strictEqual(s.aimDirX, null, 'input has not been put in sticks mode, whatever the module says');
  e.input.setTouchMode('sticks');
  assert.deepEqual(seen, ['sticks']);
  s = e.input.sample();
  assert.equal(s.aimDirX, 1);
  assert.equal(s.aimAssist, true);
  out = Object.assign({}, out, { edges: { dash: false, compact: false, pause: false, confirm: true }, tap: null });
  assert.equal(e.input.sample().tap, false, 'a confirm edge alone is not a tap');
  assert.equal(e.input.sample().confirm, true);
  out = Object.assign({}, out, { edges: { dash: false, compact: false, pause: false, confirm: false }, tap: { x: 12, y: 34 } });
  s = e.input.sample();
  assert.equal(s.tap, true);
  assert.equal(s.aimX, 12);
  assert.equal(s.aimY, 34);
  assert.deepEqual(plain(e.input.touchView()), { mode: 'x' });
});

test('partial environment: only Touch is loaded (no Prompts, no Gamepad)', () => {
  const e = makeEnv({ files: ['src/core/ns.js', 'src/core/math.js', 'src/core/touch.js', 'src/core/input.js'] });
  e.input.setTouchMode('sticks');
  e.tdown(1, ...CLIENT.aimSide);
  let s = e.input.sample();
  assert.equal(s.device, 'touch');
  assert.equal(s.fire, true);
  assert.equal(s.aimDirY, null, 'a new touch aims at its own point first');
  assert.equal(s.aimY, 100);
  for (let i = 0; i < 10; i++) e.input.sample();
  s = e.input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.aimDirY, -1, 'and once held it is the stick');
});

test('partial environment: only Gamepad is loaded (no Prompts, no Touch)', () => {
  const e = makeEnv({ files: ['src/core/ns.js', 'src/core/math.js', 'src/core/gamepad.js', 'src/core/input.js'] });
  const p = e.pad(mkPad());
  p.down(B.A);
  p.stick(0.5, 0, 0, 0);
  const s = e.input.sample();
  assert.equal(s.device, 'pad');
  assert.equal(s.moveX, 0.5);
  assert.equal(s.confirm, true);
  assert.strictEqual(e.input.touchView(), null);
});

// ---- dispose ----------------------------------------------------------------------------------------------------------------------

test('dispose: every listener it added, on the window and the canvas, is removed', () => {
  const e = makeEnv();
  const names = (t) => Object.keys(t.handlers).filter((k) => t.handlers[k].length > 0).sort();
  assert.deepEqual(names(e.win), ['blur', 'keydown', 'keyup', 'mousemove', 'mouseup', 'pointercancel', 'pointermove', 'pointerup']);
  assert.deepEqual(names(e.canvas), ['contextmenu', 'mousedown', 'mouseleave', 'pointerdown']);
  for (const t of [e.win, e.canvas]) for (const k of Object.keys(t.handlers)) assert.equal(t.handlers[k].length, 1, k + ' registered once');
  e.input.dispose();
  assert.deepEqual(names(e.win), []);
  assert.deepEqual(names(e.canvas), []);
  e.key('KeyD');
  e.tdown(1, 400, 200);
  e.mdown(40, 40);
  assert.equal(e.canvas.captured.length, 0, 'nothing is listening any more');
});

// ---- device flow ------------------------------------------------------------------------------------------------------------------

test('flow: a player who swaps between mouse, pad and phone sees the prompts follow, and the right aim at every step', () => {
  const e = makeEnv();
  const P = e.CB.Prompts;
  e.input.setTouchMode('menu');
  assert.equal(P.text('start'), 'Click to start');
  e.mdown(400, 200);
  let s = e.input.sample();
  assert.deepEqual([s.device, s.tap, s.confirm, s.aimAssist], ['kbm', true, true, false]);

  const p = e.pad(mkPad());
  p.down(B.A);
  s = e.input.sample();
  assert.deepEqual([s.device, s.tap, s.confirm, s.aimAssist], ['pad', false, true, true]);
  assert.equal(P.text('start'), 'Press A to start');
  assert.equal(P.text('retryKey'), 'A');
  p.up(B.A);
  p.stick(0, 0, 0, -1);
  s = e.input.sample();
  assert.deepEqual([s.fire, s.aimDirX, s.aimDirY], [true, 0, -1]);

  p.stick(0, 0, 0, 0);
  e.tdown(1, 400, 200);
  s = e.input.sample();
  assert.deepEqual([s.device, s.tap, s.confirm, s.aimAssist], ['touch', true, true, false]);
  assert.equal(P.text('start'), 'Tap to start');
  e.tup(1);
  e.input.setTouchMode('sticks');
  s = e.input.sample();
  assert.deepEqual([s.device, s.aimAssist, s.aimDirY], ['touch', true, -1]);

  e.key('KeyW');
  s = e.input.sample();
  assert.deepEqual([s.device, s.aimAssist], ['kbm', false]);
  assert.equal(P.text('start'), 'Click to start');
});
