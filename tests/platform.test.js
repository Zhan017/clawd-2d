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
