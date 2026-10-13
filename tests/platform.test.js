'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function fakeTarget() {
  const handlers = {};
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    fire(type, ev) { for (const fn of handlers[type] || []) fn(Object.assign({ preventDefault() {}, repeat: false }, ev)); },
    focus() {},
  };
}
function makeInput() {
  const CB = H.load(['src/core/ns.js', 'src/core/math.js', 'src/core/input.js']);
  const win = fakeTarget();
  const canvas = fakeTarget();
  const renderer = { toInternal: (x, y) => ({ x: x / 4, y: y / 4 }) };
  const input = CB.createInput({ canvas, renderer, win });
  return { CB, win, canvas, input };
}

test('input: WASD and arrows move, clamped to -1..1', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'KeyW' });
  win.fire('keydown', { code: 'ArrowUp' });
  win.fire('keydown', { code: 'KeyD' });
  const s = input.sample();
  assert.equal(s.moveX, 1);
  assert.equal(s.moveY, -1);
  win.fire('keyup', { code: 'KeyW' });
  win.fire('keyup', { code: 'ArrowUp' });
  assert.equal(input.sample().moveY, 0);
});

test('input: edges fire once per press; key repeat does not retrigger', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'Space' });
  assert.equal(input.sample().dash, true);
  assert.equal(input.sample().dash, false);
  win.fire('keydown', { code: 'Space', repeat: true });
  assert.equal(input.sample().dash, false);
  win.fire('keydown', { code: 'Digit2' });
  win.fire('keydown', { code: 'KeyM' });
  win.fire('keydown', { code: 'Escape' });
  const s = input.sample();
  assert.equal(s.choice, 2);
  assert.equal(s.mute, true);
  assert.equal(s.pause, true);
  assert.equal(input.sample().choice, 0);
});

test('input: left mouse holds fire and confirms once; right mouse dashes; aim maps through renderer', () => {
  const { win, canvas, input } = makeInput();
  canvas.fire('mousedown', { button: 0, clientX: 400, clientY: 200 });
  let s = input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.confirm, true);
  assert.equal(s.aimX, 100);
  assert.equal(s.aimY, 50);
  s = input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.confirm, false);
  win.fire('mouseup', { button: 0 });
  assert.equal(input.sample().fire, false);
  canvas.fire('mousedown', { button: 2, clientX: 0, clientY: 0 });
  assert.equal(input.sample().dash, true);
});

test('input: E casts compact and N toggles music, once per press', () => {
  const { win, input } = makeInput();
  let s = input.sample();
  assert.equal(s.compact, false);
  assert.equal(s.music, false);
  win.fire('keydown', { code: 'KeyE' });
  win.fire('keydown', { code: 'KeyN' });
  s = input.sample();
  assert.equal(s.compact, true);
  assert.equal(s.music, true);
  s = input.sample();
  assert.equal(s.compact, false);
  assert.equal(s.music, false);
  win.fire('keydown', { code: 'KeyE', repeat: true });
  assert.equal(input.sample().compact, false, 'key repeat does not recast');
});

test('input: sample() returns the key codes pressed since the last sample, oldest dropped past 16', () => {
  const { win, input } = makeInput();
  assert.deepEqual(H.plain(input.sample().keys), []);
  win.fire('keydown', { code: 'KeyA' });
  win.fire('keydown', { code: 'KeyA', repeat: true });
  win.fire('keydown', { code: 'ArrowUp' });
  win.fire('keyup', { code: 'KeyA' });
  const got = input.sample().keys;
  assert.deepEqual(H.plain(got), ['KeyA', 'ArrowUp']);
  got.push('junk');
  assert.deepEqual(H.plain(input.sample().keys), [], 'cleared by sample and the result is a copy');
  for (let i = 0; i < 20; i++) win.fire('keydown', { code: 'Key' + i });
  const last = H.plain(input.sample().keys);
  assert.equal(last.length, 16);
  assert.equal(last[0], 'Key4');
  assert.equal(last[15], 'Key19');
});

test('input: a mouse move without the primary button releases fire; an unknown buttons value does nothing', () => {
  const { win, canvas, input } = makeInput();
  canvas.fire('mousedown', { button: 0, clientX: 40, clientY: 40 });
  win.fire('mousemove', { clientX: 80, clientY: 80, buttons: 1 });
  assert.equal(input.sample().fire, true, 'button still down');
  win.fire('mousemove', { clientX: 120, clientY: 80 });
  let s = input.sample();
  assert.equal(s.fire, true, 'buttons undefined: unknown, do nothing');
  assert.equal(s.aimX, 30);
  win.fire('mousemove', { clientX: 160, clientY: 80, buttons: 2 });
  s = input.sample();
  assert.equal(s.fire, false, 'primary button is up');
  assert.equal(s.aimX, 40, 'the aim still follows the pointer');
  win.fire('mousemove', { clientX: 160, clientY: 80, buttons: 0 });
  assert.equal(input.sample().fire, false);
});

test('input: a keydown with metaKey clears held keys but its edge still registers', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'KeyW' });
  win.fire('keydown', { code: 'KeyD' });
  let s = input.sample();
  assert.equal(s.moveX, 1);
  assert.equal(s.moveY, -1);
  win.fire('keydown', { code: 'KeyE', metaKey: true });
  s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.moveY, 0);
  assert.equal(s.compact, true, 'the edge is still processed');
  assert.ok(H.plain(s.keys).includes('KeyE'));
  // macOS never sends the keyup for a key pressed with Cmd down, so such a key must not stay held.
  win.fire('keydown', { code: 'KeyA', metaKey: true });
  s = input.sample();
  assert.equal(s.moveX, 0, 'a movement key pressed with Cmd is not held');
  win.fire('keydown', { code: 'KeyD' });
  assert.equal(input.sample().moveX, 1, 'plain keys hold again afterwards');
});

test('input: blur releases held keys and fire', () => {
  const { win, canvas, input } = makeInput();
  win.fire('keydown', { code: 'KeyA' });
  canvas.fire('mousedown', { button: 0, clientX: 1, clientY: 1 });
  win.fire('blur', {});
  const s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.fire, false);
});

test('loop: fixed steps, catch-up capped at 5, dt clamped to 0.25 s', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/loop.js']);
  let now = 0;
  let cb = null;
  let updates = 0;
  let renders = 0;
  const loop = CB.createLoop({ update: () => updates++, render: () => renders++, onError: (e) => { throw e; }, now: () => now, raf: (f) => { cb = f; return 1; }, caf: () => {} });
  loop.start();
  now += 1000 / 60 + 0.01;
  cb(now);
  assert.equal(updates, 1);
  assert.equal(renders, 1);
  now += 5000;
  cb(now);
  assert.equal(updates, 1 + 5, 'capped at MAX_STEPS');
  now += 1000 / 60 + 0.01;
  cb(now);
  assert.equal(updates, 7, 'accumulator was reset after the cap');
});

test('loop: an exception stops the loop and reaches onError', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/loop.js']);
  let now = 0;
  let cb = null;
  let caught = null;
  const loop = CB.createLoop({ update: () => { throw new Error('boom'); }, render() {}, onError: (e) => { caught = e; }, now: () => now, raf: (f) => { cb = f; return 1; }, caf: () => {} });
  loop.start();
  now += 20;
  cb(now);
  assert.equal(caught && caught.message, 'boom');
  assert.equal(loop.running, false);
});

// ---- rev 3 (A3-2): mouseleave, and the harness's new fakes ----------------------------------------------------------------

test('input: the pointer leaving the canvas releases fire and held keys; dispose removes the listener', () => {
  const { win, canvas, input } = makeInput();
  win.fire('keydown', { code: 'KeyD' });
  canvas.fire('mousedown', { button: 0, clientX: 40, clientY: 40 });
  let s = input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.moveX, 1);
  assert.equal(canvas.handlers.mouseleave.length, 1, 'registered on the canvas');
  canvas.fire('mouseleave', {});
  s = input.sample();
  assert.equal(s.fire, false, 'a button released outside the page never arrives, so leaving stops fire');
  assert.equal(s.moveX, 0);
  win.fire('keydown', { code: 'KeyA' });
  assert.equal(input.sample().moveX, -1, 'keys hold again afterwards');
  input.dispose();
  assert.equal((canvas.handlers.mouseleave || []).length, 0, 'removed on dispose');
  for (const t of ['mousedown', 'contextmenu']) assert.equal((canvas.handlers[t] || []).length, 0, t);
});

// ---- more ways to play: the bare environment (only ns, math and input loaded; a window with no navigator; a canvas with no pointer capture) ----

test('input: in a bare environment sample() still carries every new field at its idle value', () => {
  const { input } = makeInput();
  const s = input.sample();
  assert.equal(s.device, 'kbm');
  assert.strictEqual(s.aimDirX, null);
  assert.strictEqual(s.aimDirY, null);
  assert.strictEqual(s.aimAssist, false);
  assert.strictEqual(s.navX, 0);
  assert.strictEqual(s.navY, 0);
  assert.strictEqual(s.tap, false);
  assert.strictEqual(s.pad, null);
  assert.equal(input.device, 'kbm');
  assert.strictEqual(input.touchView(), null);
  assert.equal(input.rumble(1, 1, 100, 30), false);
  assert.doesNotThrow(() => {
    input.setTouchMode('sticks');
    input.requestFullscreenOnRelease();
    input.releaseAll();
  });
});

test('input: touch pointer events do nothing without the touch module, and the mouse path is untouched by them', () => {
  const { win, canvas, input } = makeInput();
  assert.doesNotThrow(() => {
    canvas.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 400, clientY: 200 });
    win.fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 404, clientY: 200 });
    win.fire('pointerup', { pointerType: 'touch', pointerId: 1 });
    win.fire('pointercancel', { pointerType: 'touch', pointerId: 1 });
  });
  const s = input.sample();
  assert.equal(s.device, 'kbm');
  assert.equal(s.confirm, false);
  canvas.fire('mousedown', { button: 0, clientX: 400, clientY: 200, timeStamp: 5 });
  assert.equal(input.sample().confirm, true, 'a touch that was never handled opens no compat window for the mouse');
});

test('input: arrow and WASD keydowns give nav edges without disturbing movement', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'ArrowLeft' });
  win.fire('keydown', { code: 'KeyS' });
  let s = input.sample();
  assert.equal(s.navX, -1);
  assert.equal(s.navY, 1);
  assert.equal(s.moveX, -1);
  assert.equal(s.moveY, 1);
  s = input.sample();
  assert.equal(s.navX, 0);
  assert.equal(s.navY, 0);
  assert.equal(s.moveX, -1, 'still held');
});

test('input: a left press is a tap at the pointer, a right press and Enter are not', () => {
  const { win, canvas, input } = makeInput();
  canvas.fire('mousedown', { button: 0, clientX: 400, clientY: 200 });
  let s = input.sample();
  assert.equal(s.tap, true);
  assert.equal(s.aimX, 100);
  canvas.fire('mousedown', { button: 2, clientX: 0, clientY: 0 });
  assert.equal(input.sample().tap, false);
  win.fire('keydown', { code: 'Enter' });
  s = input.sample();
  assert.equal(s.confirm, true);
  assert.equal(s.tap, false);
});

test('input: dispose removes every listener on the window and the canvas, the pointer ones included', () => {
  const { win, canvas, input } = makeInput();
  const live = (t) => Object.keys(t.handlers).filter((k) => t.handlers[k].length > 0).sort();
  assert.deepEqual(live(win), ['blur', 'keydown', 'keyup', 'mousemove', 'mouseup', 'pointercancel', 'pointermove', 'pointerup']);
  assert.deepEqual(live(canvas), ['contextmenu', 'mousedown', 'mouseleave', 'pointerdown']);
  input.dispose();
  assert.deepEqual(live(win), []);
  assert.deepEqual(live(canvas), []);
});

const vm = require('vm');

test('harness: load(files, { localStorage }) installs the given storage in the sandbox', () => {
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  mem['cb.seen'] = '7';
  const { CB } = H.load(['src/core/ns.js', 'src/game/unlocks.js'], { localStorage: storage, returnSandbox: true });
  assert.equal(CB.Save.get('seen', 0), 7, 'reads what the storage already held');
  CB.Save.set('muted', true);
  assert.equal(mem['cb.muted'], 'true', 'writes land in the given storage');
  const dflt = H.load(['src/core/ns.js', 'src/game/unlocks.js']);
  assert.equal(dflt.Save.get('seen', 'none'), 'none', 'the default storage is empty');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const blocked = H.load(['src/core/ns.js', 'src/game/unlocks.js'], { localStorage: throwing });
  assert.doesNotThrow(() => blocked.Save.set('a', 1));
  assert.equal(blocked.Save.get('a', 0), 1, 'the in-memory copy still serves the session');
});

test('harness: setInterval/clearInterval stubs record the callbacks in sandbox.__intervals', () => {
  const { sandbox } = H.load(['src/core/ns.js'], { returnSandbox: true });
  assert.deepEqual([...sandbox.__intervals], []);
  vm.runInContext('globalThis.ticks = 0; globalThis.id1 = setInterval(function () { ticks++; }, 30); globalThis.id2 = setInterval(function () { ticks += 10; }, 50);', sandbox);
  assert.equal(sandbox.__intervals.length, 2);
  assert.equal(typeof sandbox.__intervals[0], 'function', 'the entries are the callbacks themselves');
  sandbox.__intervals[0]();
  sandbox.__intervals[1]();
  assert.equal(sandbox.ticks, 11, 'calling an entry runs the scheduler tick');
  assert.notEqual(sandbox.id1, sandbox.id2, 'distinct ids');
  vm.runInContext('clearInterval(id1)', sandbox);
  assert.equal(sandbox.__intervals.length, 1);
  sandbox.__intervals[0]();
  assert.equal(sandbox.ticks, 21, 'the cleared one is gone, the other remains');
  assert.doesNotThrow(() => vm.runInContext('clearInterval(12345); clearInterval(undefined)', sandbox));
  vm.runInContext('clearInterval(id2)', sandbox);
  assert.equal(sandbox.__intervals.length, 0);
});

test('harness: fakeAudioContext records oscillator and bufferSource starts, param writes, and a writable clock', async () => {
  const ctx = H.fakeAudioContext();
  assert.equal(ctx.currentTime, 0);
  ctx.currentTime = 1.5;
  assert.equal(ctx.currentTime, 1.5, 'writable');
  assert.ok(ctx.destination, 'has a destination');
  const g = ctx.createGain();
  assert.equal(g.gain.value, 1);
  g.gain.value = 0.25;
  g.gain.setValueAtTime(0, 2);
  g.gain.linearRampToValueAtTime(0.5, 2.1);
  g.gain.exponentialRampToValueAtTime(0.01, 2.4);
  g.gain.setTargetAtTime(0.2, 2.5, 0.1);
  assert.deepEqual([...g.gain.values], [0.25, 0, 0.5, 0.01, 0.2], 'every written value, in order');
  assert.deepEqual(g.gain.events.map((e) => e.kind), ['value', 'set', 'linear', 'exp', 'target']);
  assert.equal(g.gain.events[1].time, 2);
  assert.equal(g.gain.value, 0.2, 'value reads the latest write');
  assert.equal(g.connect(ctx.destination), ctx.destination, 'connect returns its argument, like the real node');
  assert.deepEqual(g.connections, [ctx.destination]);
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 440;
  osc.connect(g);
  osc.start(3);
  osc.stop(3.2);
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 100, 44100);
  assert.equal(src.buffer.getChannelData(0).length, 100);
  assert.ok(src.buffer.getChannelData(0) instanceof Float32Array || src.buffer.getChannelData(0).length === 100);
  src.start();
  const f = ctx.createBiquadFilter();
  assert.equal(f.type, 'lowpass');
  assert.equal(typeof f.frequency.setValueAtTime, 'function');
  assert.equal(ctx.starts.length, 2);
  assert.deepEqual(ctx.starts.map((s) => [s.kind, s.time]), [['oscillator', 3], ['bufferSource', 1.5]], 'start() with no time means now');
  assert.equal(ctx.starts[0].frequency, 440);
  assert.equal(ctx.starts[0].node, osc);
  assert.equal(ctx.oscillators.length, 1);
  assert.equal(ctx.bufferSources.length, 1);
  assert.equal(ctx.gains.length, 1);
  assert.equal(osc.stopTime, 3.2);
  const resumed = ctx.resume();
  assert.equal(typeof resumed.then, 'function');
  await resumed;
});

test('harness: fakeAudioContext.install(sandbox) makes `new AudioContext()` return it', () => {
  const { sandbox } = H.load(['src/core/ns.js'], { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  assert.equal(ctx.install(sandbox), ctx);
  assert.equal(vm.runInContext('new AudioContext()', sandbox), ctx);
  assert.equal(vm.runInContext('new webkitAudioContext()', sandbox), ctx);
});

function recorderSetup() {
  const CB = H.load(['src/core/ns.js', 'src/art/palette.js', 'src/art/sprites.js']);
  CB.Font = { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1) };
  CB.Art.defineSprite('box3', ['kkk', 'kwk', 'kkk']);
  const calls = [];
  const r = { text: (...a) => calls.push(['text', ...a]), sprite: (...a) => calls.push(['sprite', ...a]) };
  return { CB, r, calls };
}

test('harness: recorder wraps text and sprite into pixel boxes (alignment, scale, centred sprites) and calls through', () => {
  const { CB, r, calls } = recorderSetup();
  const rec = H.recorder(r, CB);
  r.text('abcd', 10, 20);
  r.text('abcd', 100, 30, { align: 'center' });
  r.text('abcd', 200, 40, { align: 'right', scale: 2 });
  r.text('', 5, 5);
  r.sprite('box3', 50, 60);
  r.sprite('box3', 50, 60, { scale: 2 });
  assert.equal(calls.length, 6, 'every call goes through to the original (the renderer itself skips the empty string)');
  assert.deepEqual(H.plain(rec.boxes), [
    { kind: 'text', str: 'abcd', x: 10, y: 20, w: 24, h: 7 },
    { kind: 'text', str: 'abcd', x: 88, y: 30, w: 24, h: 7 },
    { kind: 'text', str: 'abcd', x: 152, y: 40, w: 48, h: 14 },
    { kind: 'sprite', name: 'box3', x: 49, y: 59, w: 3, h: 3 },
    { kind: 'sprite', name: 'box3', x: 47, y: 57, w: 6, h: 6 },
  ]);
  assert.equal(rec.boxes, rec, 'the recorder is its own list');
  assert.equal(rec.texts().length, 3);
  assert.equal(rec.sprites().length, 2);
  rec.restore();
  r.text('zz', 0, 0);
  assert.equal(rec.length, 5, 'restored: nothing more is recorded (the empty string never was)');
  assert.equal(calls.length, 7);
});

test('harness: recorder.outside() and .overlaps() find boxes off the 320x180 screen and overlapping text', () => {
  const { CB, r } = recorderSetup();
  const rec = H.recorder(r, CB);
  r.text('hello', 4, 4);
  r.text('world', 40, 4);
  r.text('over', 42, 8);
  r.sprite('box3', 2, 2);
  assert.equal(rec.outside().length, 0, 'everything so far is inside 320x180');
  r.text('left', -3, 100);
  r.text('right edge', 316, 100);
  r.text('bottom', 10, 175);
  const out = rec.outside(320, 180).map((b) => b.str || b.name);
  assert.deepEqual(out.sort(), ['bottom', 'left', 'right edge'].sort());
  const pairs = rec.overlaps();
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].map((b) => b.str).sort(), ['over', 'world']);
  rec.clear();
  assert.equal(rec.length, 0);
});

test('harness: recorder finds CB from the last load when it is not passed, and survives a stub with no text or sprite', () => {
  const { CB } = recorderSetup();
  const r = {};
  const rec = H.recorder(r);
  r.text('abc', 0, 0);
  r.sprite('box3', 10, 10);
  assert.equal(rec.length, 2);
  assert.equal(rec[0].w, 18, 'measured with CB.Font from the last loaded sandbox');
  assert.equal(rec[1].w, 3);
  assert.ok(CB);
});
