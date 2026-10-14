'use strict';
// Touch controls: the pointer state machine (menu taps, sticks-mode regions, origin clamping, drag-follow, deadzones, mode changes),
// the overlay draw (checked on the real renderer through the recorder) and the platform helpers (isPortrait, requestFullscreen).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const LOGIC = ['src/core/ns.js', 'src/core/touch.js'];
const DRAW = [...H.CORE, 'src/art/font.js', 'src/art/render.js', 'src/core/touch.js'];
const plain = H.plain;

function menu() {
  const T = H.load(LOGIC).Touch;
  return { T, st: T.createState() };
}
function sticks() {
  const e = menu();
  e.T.setMode(e.st, 'sticks');
  return e;
}
// A finger that has been down long enough (10 sim ticks) is a stick, no longer a possible tap.
const age = (T, st, n) => {
  for (let i = 0; i < (n || T.TAP_TICKS); i++) T.sample(st);
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || 'value') + ': ' + a + ' vs ' + b);
const unit = (o, kx, ky) => Math.hypot(o[kx], o[ky]);

// Which part of the sticks-mode layout a finger landing at (x, y) goes to.
function classify(x, y) {
  const { T, st } = sticks();
  T.down(st, 1, x, y);
  const out = T.sample(st);
  const v = T.view(st);
  const hits = [];
  if (out.edges.pause) hits.push('pause');
  if (out.edges.dash) hits.push('dash');
  if (out.edges.compact) hits.push('compact');
  if (v.move) hits.push('move');
  if (v.aim) hits.push('aim');
  assert.ok(hits.length <= 1, 'a landing finger goes to exactly one place: ' + hits.join('+') + ' at ' + x + ',' + y);
  return hits[0] || 'ignored';
}

// ---- layout constants -----------------------------------------------------------------------------------------------------

test('touch: constants and layout match the contract and sit on screen', () => {
  const T = H.load(LOGIC).Touch;
  assert.equal(T.STICK_R, 16);
  assert.equal(T.DEAD_MOVE, 3);
  assert.equal(T.DEAD_AIM, 4);
  assert.equal(T.HIT_PAD, 6);
  assert.deepEqual(plain(T.BUTTONS), { dash: { x: 298, y: 146, r: 12 }, compact: { x: 272, y: 163, r: 10 } });
  assert.deepEqual(plain(T.PAUSE), { x: 296, y: 22, w: 20, h: 18 });
  assert.deepEqual(plain(T.REST), { move: { x: 40, y: 140 }, aim: { x: 236, y: 140 } });
  assert.ok(Object.isFrozen(T.BUTTONS) && Object.isFrozen(T.BUTTONS.dash) && Object.isFrozen(T.PAUSE) && Object.isFrozen(T.REST), 'shared tables cannot be mutated');
  for (const b of Object.values(plain(T.BUTTONS))) {
    assert.ok(b.x - b.r >= 0 && b.x + b.r <= 320 && b.y - b.r >= 0 && b.y + b.r <= 180, 'a button is fully on screen');
  }
  for (const s of Object.values(plain(T.REST))) assert.ok(s.x - T.STICK_R >= 0 && s.x + T.STICK_R <= 320 && s.y + T.STICK_R <= 180, 'a ghost ring is fully on screen');
  assert.ok(Math.hypot(298 - 272, 146 - 163) > 12 + 10 + 2, 'the two drawn buttons do not touch');
  assert.ok(T.REST.move.x < 160 && T.REST.aim.x >= 160, 'each rest ring is in its own half');
});

// ---- menu mode ------------------------------------------------------------------------------------------------------------

test('touch: a fresh state is in menu mode and idle', () => {
  const { T, st } = menu();
  assert.deepEqual(plain(T.view(st)), { mode: 'menu', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false });
  const out = T.sample(st);
  assert.deepEqual(plain(out), { active: false, moveX: 0, moveY: 0, aimDirX: null, aimDirY: null, aimAt: null, fire: false, edges: { dash: false, compact: false, pause: false, confirm: false }, tap: null });
});

test('touch: in menu mode a press is a tap plus a confirm edge, consumed by sample', () => {
  const { T, st } = menu();
  T.down(st, 1, 123.5, 77);
  const out = T.sample(st);
  assert.deepEqual(plain(out.tap), { x: 123.5, y: 77 });
  assert.equal(out.edges.confirm, true);
  assert.equal(out.active, true);
  assert.equal(out.aimDirX, null);
  assert.equal(out.aimDirY, null);
  assert.equal(out.fire, false);
  assert.equal(out.moveX, 0);
  assert.equal(out.moveY, 0);
  assert.equal(out.edges.dash || out.edges.compact || out.edges.pause, false);
  T.up(st, 1);
  const next = T.sample(st);
  assert.equal(next.tap, null, 'the tap is delivered once');
  assert.equal(next.edges.confirm, false);
  assert.equal(T.sample(st).active, false);
});

test('touch: menu taps keep letterbox coordinates, the last tap wins, and the button regions mean nothing', () => {
  const { T, st } = menu();
  T.down(st, 1, -20, 300);
  assert.deepEqual(plain(T.sample(st).tap), { x: -20, y: 300 }, 'a tap in the letterbox is passed on as is');
  T.up(st, 1);
  T.down(st, 2, 10, 10);
  T.up(st, 2);
  T.down(st, 3, 298, 146); // on the dash button, which does not exist in menu mode
  const out = T.sample(st);
  assert.deepEqual(plain(out.tap), { x: 298, y: 146 });
  assert.equal(out.edges.dash, false);
  assert.equal(out.edges.confirm, true);
});

test('touch: dragging in menu mode makes no stick and leaves the tap where it landed', () => {
  const { T, st } = menu();
  T.down(st, 1, 100, 100);
  T.move(st, 1, 140, 90);
  const v = T.view(st);
  assert.equal(v.move, null);
  assert.equal(v.aim, null);
  assert.deepEqual(plain(T.sample(st).tap), { x: 100, y: 100 });
  const hold = T.sample(st);
  assert.equal(hold.active, true, 'a held finger keeps touch active');
  assert.equal(hold.tap, null);
});

// ---- sticks mode: where a finger lands ------------------------------------------------------------------------------------

test('touch: sticks-mode landing regions, in contract order, including the pads and the letterbox', () => {
  const cases = [
    ['pause centre', 306, 31, 'pause'],
    ['pause pad, top-left corner (290, 16)', 290, 16, 'pause'],
    ['pause pad, bottom-right corner (322, 46)', 322, 46, 'pause'],
    ['letterbox right of the pause box, inside its pad', 322, 30, 'pause'],
    ['just left of the pause pad', 289, 31, 'aim'],
    ['just below the pause pad', 306, 47, 'aim'],
    ['above the pause pad: the HUD strip', 306, 10, 'aim'],
    ['dash centre', 298, 146, 'dash'],
    ['dash edge plus pad (18 px out)', 316, 146, 'dash'],
    ['just outside the dash pad', 317, 146, 'aim'],
    ['compact centre', 272, 163, 'compact'],
    ['compact edge plus pad (16 px out)', 272, 179, 'compact'],
    ['just outside the compact pad', 272, 180, 'aim'],
    ['where the dash and compact pads overlap: dash is checked first', 285, 154.5, 'dash'],
    ['left half', 40, 140, 'move'],
    ['just left of the middle', 159.9, 90, 'move'],
    ['on the middle line', 160, 90, 'aim'],
    ['right half', 236, 140, 'aim'],
    ['letterbox, far left', -40, 90, 'move'],
    ['letterbox, far right', 400, 90, 'aim'],
    ['letterbox above, left half', 10, -30, 'move'],
    ['letterbox below, right half', 200, 300, 'aim'],
  ];
  for (const [label, x, y, want] of cases) assert.equal(classify(x, y), want, label);
});

test('touch: a button press makes a held button, an edge and no stick, and no confirm or tap', () => {
  const { T, st } = sticks();
  T.down(st, 1, 298, 146);
  T.down(st, 2, 272, 163);
  T.down(st, 3, 306, 31);
  const v = T.view(st);
  assert.deepEqual(plain(v), { mode: 'sticks', move: null, aim: null, dashDown: true, compactDown: true, pauseDown: true });
  const out = T.sample(st);
  assert.deepEqual(plain(out.edges), { dash: true, compact: true, pause: true, confirm: false });
  assert.equal(out.tap, null);
  assert.equal(out.fire, false);
  T.up(st, 2);
  assert.deepEqual(plain(T.view(st)), { mode: 'sticks', move: null, aim: null, dashDown: true, compactDown: false, pauseDown: true });
  T.up(st, 1);
  T.up(st, 3);
  assert.equal(T.view(st).dashDown || T.view(st).pauseDown, false);
});

test('touch: button edges fire once per press and a held button does not repeat', () => {
  const { T, st } = sticks();
  T.down(st, 1, 298, 146);
  assert.equal(T.sample(st).edges.dash, true);
  assert.equal(T.sample(st).edges.dash, false, 'still held, no second edge');
  T.up(st, 1);
  T.down(st, 1, 298, 146);
  assert.equal(T.sample(st).edges.dash, true, 'a new press is a new edge');
  T.down(st, 2, 272, 163);
  T.down(st, 3, 306, 31);
  const out = T.sample(st);
  assert.equal(out.edges.compact, true);
  assert.equal(out.edges.pause, true);
  assert.equal(out.edges.dash, false);
  const again = T.sample(st);
  assert.equal(again.edges.compact || again.edges.pause, false);
});

// ---- sticks mode: origin, follow and deadzones ----------------------------------------------------------------------------

test('touch: a landing stick origin is exactly where the finger lands, letterbox included', () => {
  const cases = [
    ['move, interior', 'move', [60, 100]],
    ['move, near the left edge', 'move', [10, 100]],
    ['move, in the left letterbox', 'move', [-30, 90]],
    ['move, near the bottom-left corner', 'move', [10, 175]],
    ['aim, near the right edge', 'aim', [310, 100]],
    ['aim, in the right letterbox', 'aim', [350, 60]],
    ['aim, interior', 'aim', [236, 140]],
  ];
  for (const [label, which, [x, y]] of cases) {
    const { T, st } = sticks();
    T.down(st, 1, x, y);
    const s = T.view(st)[which];
    assert.ok(s, label + ': the right stick was grabbed');
    assert.deepEqual(plain(s), { ox: x, oy: y, x, y }, label);
  }
});

test('touch: a thumb landing in the letterbox does not move Clawd until it slides', () => {
  const { T, st } = sticks();
  T.down(st, 1, -5, 90);
  let out = T.sample(st);
  assert.equal(out.moveX, 0);
  assert.equal(out.moveY, 0);
  T.move(st, 1, -30, 90); // 25 out: the origin follows to one radius away
  const s = T.view(st).move;
  near(s.ox, -14);
  near(s.oy, 90);
  out = T.sample(st);
  near(out.moveX, -1);
  near(out.moveY, 0);
});

test('touch: the move stick output is the unit direction at full speed, and the origin follows a far finger', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  assert.equal(T.sample(st).moveX, 0, 'a finger on the origin is centred');
  T.move(st, 1, 70, 100); // 10 out: inside the ring, the origin stays
  let v = T.view(st).move;
  assert.deepEqual(plain(v), { ox: 60, oy: 100, x: 70, y: 100 });
  let out = T.sample(st);
  near(out.moveX, 1);
  near(out.moveY, 0);
  T.move(st, 1, 100, 100); // 40 out: the origin comes along to 16 behind the finger
  v = T.view(st).move;
  near(v.ox, 84);
  near(v.oy, 100);
  assert.equal(v.x, 100);
  out = T.sample(st);
  near(out.moveX, 1);
  T.move(st, 1, 84, 100); // back onto the new origin
  out = T.sample(st);
  assert.equal(out.moveX, 0);
  assert.equal(out.moveY, 0);
  T.move(st, 1, 84, 60); // straight up, far
  v = T.view(st).move;
  near(v.ox, 84);
  near(v.oy, 76);
  out = T.sample(st);
  near(out.moveX, 0);
  near(out.moveY, -1);
  T.move(st, 1, 84 + 6, 76 - 8); // 6,-8 from the origin: 10 out
  out = T.sample(st);
  near(out.moveX, 0.6);
  near(out.moveY, -0.8);
  near(unit(out, 'moveX', 'moveY'), 1, 'diagonals are normalised');
});

test('touch: the move deadzone is 3 px', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.move(st, 1, 62.9, 100);
  let out = T.sample(st);
  assert.equal(out.moveX, 0);
  assert.equal(out.moveY, 0);
  T.move(st, 1, 63, 100);
  out = T.sample(st);
  near(out.moveX, 1);
  T.move(st, 1, 60, 102.9);
  assert.equal(T.sample(st).moveY, 0);
  T.move(st, 1, 60, 97);
  near(T.sample(st).moveY, -1);
});

test('touch: the aim stick sets the last aim direction outside a 4 px deadzone and keeps it after release', () => {
  const { T, st } = sticks();
  let out = T.sample(st);
  assert.equal(out.aimDirX, 0, 'before any touch the aim points up');
  assert.equal(out.aimDirY, -1);
  assert.equal(out.fire, false);
  T.down(st, 1, 236, 140);
  age(T, st); // long enough to be a stick (a shorter touch is a tap that aims at its own point)
  out = T.sample(st);
  assert.equal(out.aimDirX, 0, 'a press on the origin keeps the direction');
  assert.equal(out.aimDirY, -1);
  T.move(st, 1, 239.9, 140); // 3.9 out: inside the deadzone
  out = T.sample(st);
  assert.equal(out.aimDirX, 0);
  assert.equal(out.aimDirY, -1);
  T.move(st, 1, 240, 140); // 4 out
  out = T.sample(st);
  near(out.aimDirX, 1);
  near(out.aimDirY, 0);
  T.move(st, 1, 236 + 3, 140 + 4); // 5 out, 3-4-5
  out = T.sample(st);
  near(out.aimDirX, 0.6);
  near(out.aimDirY, 0.8);
  T.move(st, 1, 236 + 1, 140 + 1); // back into the deadzone: the direction stays
  out = T.sample(st);
  near(out.aimDirX, 0.6);
  near(out.aimDirY, 0.8);
  T.up(st, 1);
  out = T.sample(st);
  near(out.aimDirX, 0.6, 'kept after release');
  near(out.aimDirY, 0.8);
  assert.equal(out.fire, false, 'and no longer firing');
  assert.equal(T.view(st).aim, null);
  T.down(st, 2, 236, 140); // a new touch fires at its own point until it proves to be a stick, then along the kept direction
  out = T.sample(st);
  assert.equal(out.fire, true);
  assert.equal(out.aimDirX, null);
  assert.deepEqual(plain(out.aimAt), { x: 236, y: 140 });
  age(T, st);
  out = T.sample(st);
  assert.equal(out.fire, true);
  assert.equal(out.aimAt, null);
  near(out.aimDirX, 0.6);
  near(out.aimDirY, 0.8);
});

test('touch: a tap in the side bar or the HUD strip steers instead of shooting at the thumb', () => {
  const { T, st } = sticks();
  for (const [x, y] of [[340, 120], [300, 8], [316, 100]]) {
    T.down(st, 1, x, y); // a resting aim thumb off the arena floor
    let out = T.sample(st);
    assert.equal(out.aimAt, null, 'no shot at ' + x + ',' + y);
    assert.equal(out.fire, true, 'it still fires, along the stick');
    near(out.aimDirX, 0);
    near(out.aimDirY, -1);
    T.up(st, 1);
    out = T.sample(st);
    assert.equal(out.aimAt, null, 'and no shot after the lift either');
  }
  T.down(st, 2, 250, 40); // on the floor it is a tap at that point
  assert.deepEqual(plain(T.sample(st).aimAt), { x: 250, y: 40 });
});

test('touch: landing the aim stick keeps the last direction until the finger slides', () => {
  const { T, st } = sticks();
  T.down(st, 1, 310, 100);
  age(T, st);
  let out = T.sample(st);
  near(out.aimDirX, 0);
  near(out.aimDirY, -1);
  T.move(st, 1, 318, 100);
  out = T.sample(st);
  near(out.aimDirX, 1);
  near(out.aimDirY, 0);
});

test('touch: aim output is always a unit vector in sticks mode and null in menu mode', () => {
  const { T, st } = sticks();
  T.down(st, 1, 236, 140);
  for (const [x, y] of [[236, 100], [300, 140], [180, 170], [236, 140], [90, 20]]) {
    T.move(st, 1, x, y);
    const out = T.sample(st);
    near(unit(out, 'aimDirX', 'aimDirY'), 1, 'aimDir at ' + x + ',' + y);
  }
  T.setMode(st, 'menu');
  const out = T.sample(st);
  assert.equal(out.aimDirX, null);
  assert.equal(out.aimDirY, null);
  assert.equal(out.fire, false);
});

test('touch: fire is on while the aim stick is held, and only then', () => {
  const { T, st } = sticks();
  assert.equal(T.sample(st).fire, false);
  T.down(st, 1, 40, 140); // the move stick does not fire
  assert.equal(T.sample(st).fire, false);
  T.down(st, 2, 298, 146); // neither does a button
  assert.equal(T.sample(st).fire, false);
  T.down(st, 3, 236, 140);
  assert.equal(T.sample(st).fire, true);
  assert.equal(T.sample(st).fire, true, 'still held');
  age(T, st); // held long enough to be a stick, not a tap
  assert.equal(T.sample(st).fire, true, 'a stick held');
  T.up(st, 3);
  assert.equal(T.sample(st).fire, false, 'a lift after a hold leaves no shot behind');
});

// ---- several fingers ------------------------------------------------------------------------------------------------------

test('touch: move and aim fingers work together, a third on either half is ignored, and a button finger never steers a stick', () => {
  const { T, st } = sticks();
  T.down(st, 'm', 40, 140);
  T.down(st, 'a', 236, 140);
  T.move(st, 'm', 50, 140);
  T.move(st, 'a', 236, 120);
  let out = T.sample(st);
  near(out.moveX, 1);
  near(out.aimDirY, -1);
  assert.equal(out.fire, true);

  T.down(st, 'x', 100, 100); // left half, move stick taken
  T.down(st, 'y', 250, 100); // right half, aim stick taken
  T.move(st, 'x', 150, 150);
  T.move(st, 'y', 300, 20);
  const v = T.view(st);
  assert.deepEqual(plain(v.move), { ox: 40, oy: 140, x: 50, y: 140 }, 'the owner still holds the move stick');
  assert.deepEqual(plain(v.aim), { ox: 236, oy: 136, x: 236, y: 120 }, 'the aim origin trailed the 20 px pull');

  T.down(st, 'd', 298, 146);
  T.move(st, 'd', 20, 20); // sliding a finger off a button
  T.move(st, 'd', 300, 10);
  assert.deepEqual(plain(T.view(st).move), { ox: 40, oy: 140, x: 50, y: 140 });
  assert.equal(T.view(st).dashDown, true, 'and the button stays held until the finger lifts');
  T.up(st, 'd');
  assert.equal(T.view(st).dashDown, false);

  T.up(st, 'm'); // the move stick is free, but the spare finger 'x' stays ignored for its whole life
  assert.equal(T.view(st).move, null);
  T.move(st, 'x', 60, 100);
  assert.equal(T.view(st).move, null);
  T.down(st, 'n', 70, 100);
  assert.deepEqual(plain(T.view(st).move), { ox: 70, oy: 100, x: 70, y: 100 }, 'a fresh finger takes it');
  out = T.sample(st);
  assert.equal(out.moveX, 0);
});

test('touch: a stick belongs to its finger even after the finger crosses the middle line', () => {
  const { T, st } = sticks();
  T.down(st, 1, 100, 100);
  T.move(st, 1, 200, 100);
  assert.ok(T.view(st).move, 'still the move stick');
  assert.equal(T.view(st).aim, null);
  near(T.sample(st).moveX, 1);
});

// ---- mode changes, releaseAll and odd input ------------------------------------------------------------------------------

test('touch: changing the mode drops every live pointer until it lifts, and sticks clear', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.down(st, 2, 236, 140);
  T.down(st, 3, 298, 146);
  T.sample(st);
  T.setMode(st, 'menu');
  assert.deepEqual(plain(T.view(st)), { mode: 'menu', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false });
  let out = T.sample(st);
  assert.equal(out.aimDirX, null);
  assert.equal(out.fire, false);
  assert.equal(out.active, true, 'fingers are still on the glass');
  T.move(st, 1, 90, 90); // late events for dropped pointers are harmless
  T.move(st, 3, 90, 90);
  T.up(st, 2);

  // Back to the sticks: finger 1 (still down, last seen at 90,90) is picked up as a fresh move stick right there. Finger 3, also on the move
  // side, finds the stick taken and is a spare.
  T.setMode(st, 'sticks');
  assert.deepEqual(plain(T.view(st).move), { ox: 90, oy: 90, x: 90, y: 90 }, 'a finger still down is picked up where it is');
  T.move(st, 1, 100, 90);
  out = T.sample(st);
  near(out.moveX, 1);
  T.move(st, 3, 20, 90);
  near(T.sample(st).moveX, 1, 'the spare steers nothing');
  T.down(st, 4, 50, 120);
  assert.equal(T.view(st).move.ox, 90, 'the stick is taken, so a new finger on that side is a spare');
  T.up(st, 1);
  assert.equal(T.view(st).move, null);
  T.down(st, 5, 50, 120);
  assert.deepEqual(plain(T.view(st).move), { ox: 50, oy: 120, x: 50, y: 120 }, 'once it is free a new finger takes it');
});

test('touch: a finger that was down for a menu tap is picked up as a stick when the mode flips to sticks (a thumb never goes dead)', () => {
  const { T, st } = menu();
  T.down(st, 1, 100, 100); // e.g. tapping a resume button, and keeping the thumb down
  T.sample(st);
  T.setMode(st, 'sticks');
  assert.deepEqual(plain(T.view(st).move), { ox: 100, oy: 100, x: 100, y: 100 }, 'a fresh stick at the finger');
  assert.equal(T.sample(st).moveX, 0, 'landing moves nothing by itself');
  T.move(st, 1, 130, 100);
  near(T.sample(st).moveX, 1, 'and it steers from there');
  T.up(st, 1);
  T.down(st, 1, 100, 100);
  assert.ok(T.view(st).move, 'and the next press counts as before');
});

test('touch: a finger picked up by a mode change on the aim half is a stick at once, never a tap', () => {
  const { T, st } = menu();
  T.down(st, 1, 250, 100);
  T.sample(st);
  T.setMode(st, 'sticks');
  assert.deepEqual(plain(T.view(st).aim), { ox: 250, oy: 100, x: 250, y: 100 });
  const out = T.sample(st);
  assert.equal(out.aimAt, null, 'no shot at the finger');
  assert.equal(out.fire, true);
  near(out.aimDirY, -1);
  T.up(st, 1);
  assert.equal(T.sample(st).fire, false, 'and its lift leaves no shot');
});

test('touch: switching to the menu still makes steering fingers inert until they lift', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.setMode(st, 'menu');
  T.sample(st);
  T.move(st, 1, 70, 100);
  const out = T.sample(st);
  assert.equal(out.tap, null);
  assert.equal(out.edges.confirm, false);
  assert.equal(T.view(st).move, null);
});

test('touch: setting the mode that is already active, or junk, keeps every pointer', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.setMode(st, 'sticks');
  T.setMode(st, 'nonsense');
  T.setMode(st, undefined);
  T.setMode(st, null);
  assert.equal(T.view(st).mode, 'sticks');
  assert.deepEqual(plain(T.view(st).move), { ox: 60, oy: 100, x: 60, y: 100 });
});

test('touch: releaseAll lets go of everything but keeps the last aim direction', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.down(st, 2, 236, 140);
  T.move(st, 2, 236, 160);
  T.down(st, 3, 298, 146);
  T.sample(st);
  T.releaseAll(st);
  assert.deepEqual(plain(T.view(st)), { mode: 'sticks', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false });
  T.move(st, 1, 90, 90); // the lifted fingers report late: nothing happens
  T.move(st, 2, 90, 90);
  T.up(st, 3);
  assert.equal(T.view(st).move, null);
  assert.equal(T.view(st).aim, null);
  const out = T.sample(st);
  assert.equal(out.fire, false);
  assert.equal(out.moveX, 0);
  near(out.aimDirX, 0);
  near(out.aimDirY, 1, 'still pointing down');
  T.down(st, 1, 60, 100);
  assert.ok(T.view(st).move, 'and the same ids can press again');
});

test('touch: unknown pointer ids, non-finite coordinates and repeated downs are handled', () => {
  const { T, st } = sticks();
  T.up(st, 'ghost');
  T.move(st, 'ghost', 10, 10);
  T.down(st, 1, NaN, 50);
  T.down(st, 1, 50, Infinity);
  T.down(st, 1, '50', 50);
  T.down(st, 1, undefined, undefined);
  assert.equal(T.view(st).move, null);
  assert.equal(T.sample(st).active, false, 'nothing counted as a touch');
  T.down(st, 1, 60, 100);
  T.move(st, 1, NaN, 100);
  T.move(st, 1, 60, 'x');
  assert.deepEqual(plain(T.view(st).move), { ox: 60, oy: 100, x: 60, y: 100 }, 'bad moves are dropped');
  T.down(st, 1, 236, 140); // the same id presses again without a lift: it starts over
  assert.equal(T.view(st).move, null, 'the move stick was freed');
  assert.ok(T.view(st).aim);
  T.up(st, 1);
  assert.equal(T.view(st).aim, null);
});

test('touch: active is true on any touch since the last sample and while a finger is held', () => {
  const { T, st } = sticks();
  assert.equal(T.sample(st).active, false);
  T.down(st, 1, 60, 100);
  T.up(st, 1); // a tap that is over before the next sample still counts
  assert.equal(T.sample(st).active, true);
  assert.equal(T.sample(st).active, false);
  T.down(st, 2, 60, 100);
  assert.equal(T.sample(st).active, true);
  assert.equal(T.sample(st).active, true, 'held');
  T.up(st, 2);
  assert.equal(T.sample(st).active, true, 'the lift itself is a touch');
  assert.equal(T.sample(st).active, false);
  T.down(st, 3, 100, 100);
  T.down(st, 4, 100, 100); // an ignored spare finger counts as a finger on the glass
  T.up(st, 3);
  T.sample(st);
  assert.equal(T.sample(st).active, true);
});

test('touch: view has exactly the contract shape in both modes', () => {
  const { T, st } = sticks();
  T.down(st, 1, 60, 100);
  T.down(st, 2, 236, 140);
  const v = T.view(st);
  assert.deepEqual(Object.keys(v).sort(), ['aim', 'compactDown', 'dashDown', 'mode', 'move', 'pauseDown']);
  assert.deepEqual(Object.keys(v.move).sort(), ['ox', 'oy', 'x', 'y']);
  assert.deepEqual(Object.keys(v.aim).sort(), ['ox', 'oy', 'x', 'y']);
  v.move.ox = 999; // a view is a snapshot: editing it does not move the stick
  assert.equal(T.view(st).move.ox, 60);
  T.setMode(st, 'menu');
  assert.deepEqual(Object.keys(T.view(st)).sort(), ['aim', 'compactDown', 'dashDown', 'mode', 'move', 'pauseDown']);
});

test('touch: pointer ids may be numbers or strings, and states are independent', () => {
  const T = H.load(LOGIC).Touch;
  const a = T.createState();
  const b = T.createState();
  T.setMode(a, 'sticks');
  T.down(a, 'pointer-1', 60, 100);
  assert.ok(T.view(a).move);
  assert.equal(T.view(b).mode, 'menu');
  assert.equal(T.view(b).move, null);
});

// ---- drawing --------------------------------------------------------------------------------------------------------------

// A real renderer on the stub canvas with the layout recorder and a log of every primitive call.
function drawEnv(opts) {
  const o = opts || {};
  const { CB, sandbox } = H.load([...DRAW, ...(o.extra || [])], { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const rec = H.recorder(r, CB);
  const log = { text: [], rect: [], frame: [], disc: [], ring: [], alpha: [], sprite: [] };
  for (const k of Object.keys(log)) {
    const orig = r[k];
    r[k] = function (...a) {
      log[k].push(a);
      return orig.apply(this, a);
    };
  }
  const T = CB.Touch;
  const clear = () => {
    rec.clear();
    for (const k of Object.keys(log)) log[k].length = 0;
  };
  return { CB, sandbox, r, rec, log, clear, T, C: CB.Pal.C };
}

const IDLE = { mode: 'sticks', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false };
const BTN = { dash: { x: 298, y: 146, r: 12 }, compact: { x: 272, y: 163, r: 10 } };

// The 1 px-high fill rows inside the /compact button, from the rect log.
function compactFill(log) {
  const b = BTN.compact;
  return log.rect.filter(([x, y, w, h]) => h === 1 && x >= b.x - b.r && x + w <= b.x + b.r + 1 && y >= b.y - b.r && y <= b.y + b.r).map(([x, y, w, h, color]) => ({ x, y, w, h, color }));
}

test('touch draw: a null view, a missing renderer or a missing palette draws nothing and does not throw', () => {
  const env = drawEnv();
  env.T.draw(env.r, null, 0, {});
  env.T.draw(env.r, undefined, 0);
  env.T.draw(null, IDLE, 0, {});
  for (const k of Object.keys(env.log)) assert.equal(env.log[k].length, 0, k);

  const T = H.load(LOGIC).Touch; // no palette, no font
  const calls = [];
  const spy = new Proxy({}, { get: (t, p) => () => calls.push(p) });
  T.draw(spy, IDLE, 0, {});
  assert.equal(calls.length, 0);
});

test('touch draw: paints DASH, /c and II once each, on screen, inside their buttons, never overlapping', () => {
  const env = drawEnv();
  env.T.draw(env.r, IDLE, 0, { compactFrac: 0.5, compactReady: false, dashReady: true });
  const texts = env.rec.texts();
  assert.deepEqual(texts.map((b) => b.str).sort(), ['/c', 'AIM + FIRE', 'DASH', 'II', 'MOVE'], 'the two first-run labels ride the ghost rings');
  assert.deepEqual(env.rec.outside(320, 180), []);
  assert.deepEqual(env.rec.overlaps(), []);
  const t = (s) => texts.find((b) => b.str === s);
  const inside = (box, cx, cy, rad) => box.x >= cx - rad && box.x + box.w <= cx + rad + 1 && box.y >= cy - rad && box.y + box.h <= cy + rad + 1;
  assert.ok(inside(t('DASH'), 298, 146, 13), 'DASH sits inside its button');
  assert.ok(inside(t('/c'), 272, 163, 10), '/c sits inside its button');
  const p = t('II');
  assert.ok(p.x >= 296 && p.x + p.w <= 316 && p.y >= 22 && p.y + p.h <= 40, 'II sits inside the pause box');
  assert.ok(Math.abs(p.x + p.w / 2 - (296 + 20 / 2)) <= 1, 'and is centred in it');
});

test('touch draw: the font has every glyph the labels use', () => {
  const { CB } = drawEnv();
  for (const ch of ['D', 'A', 'S', 'H', '/', 'c', 'I']) assert.ok(CB.Font.has(ch), 'glyph ' + ch);
});

test('touch draw: only renderer methods that exist are called, with a frame standing in when ring is missing', () => {
  const env = drawEnv();
  const strict = new Proxy(env.r, {
    get(t, p) {
      if (!(p in t)) throw new Error('renderer has no ' + String(p));
      return t[p];
    },
  });
  const live = { mode: 'sticks', move: { ox: 40, oy: 140, x: 50, y: 130 }, aim: { ox: 236, oy: 140, x: 250, y: 150 }, dashDown: true, compactDown: true, pauseDown: true };
  env.T.draw(strict, live, 1.3, { compactFrac: 1, compactReady: true, dashReady: false });
  env.T.draw(strict, IDLE, 0, {});

  const noRing = Object.assign({}, env.r);
  delete noRing.ring;
  env.clear();
  env.T.draw(noRing, live, 0, { compactFrac: 0.3 });
  assert.equal(env.log.ring.length, 0);
  assert.ok(env.log.frame.length > 0, 'rings became frames');
});

test('touch draw: idle sticks are faint ghost rings at REST, live sticks a ring at the origin and a knob at the finger', () => {
  const env = drawEnv();
  const ghosts = () => env.log.alpha.filter(([a]) => a === 0.3).length;
  env.T.draw(env.r, IDLE, 0, {});
  assert.equal(ghosts(), 2, 'both sticks are ghosts at alpha 0.3');
  const ringAt = (x, y, rad) => env.log.ring.filter(([cx, cy, rr]) => cx === x && cy === y && rr === rad);
  assert.equal(ringAt(40, 140, 16).length, 1, 'move ghost at REST.move');
  assert.equal(ringAt(236, 140, 16).length, 1, 'aim ghost at REST.aim');
  assert.equal(env.log.disc.filter(([, , rad]) => rad === 5 || rad === 6).length, 0, 'no knobs while idle');

  env.clear();
  const live = { mode: 'sticks', move: { ox: 60, oy: 100, x: 70, y: 100 }, aim: null, dashDown: false, compactDown: false, pauseDown: false };
  env.T.draw(env.r, live, 0, {});
  assert.equal(ghosts(), 1, 'only the aim stick is still a ghost');
  assert.equal(ringAt(60, 100, 16).length, 1, 'the live ring is at the origin');
  assert.equal(ringAt(40, 140, 16).length, 0, 'and the move ghost is gone');
  assert.equal(env.log.alpha.filter(([a]) => a === 0.45).length >= 1, true, 'the live stick is at alpha 0.45');
  assert.equal(env.log.disc.filter(([x, y, rad]) => x === 70 && y === 100 && rad === 5).length, 1, 'the knob is at the finger');

  env.clear();
  const far = { mode: 'sticks', move: { ox: 60, oy: 100, x: 100, y: 100 }, aim: null, dashDown: false, compactDown: false, pauseDown: false };
  env.T.draw(env.r, far, 0, {});
  assert.equal(env.log.disc.filter(([x, y, rad]) => x === 76 && y === 100 && rad === 5).length, 1, 'a finger past the ring leaves the knob on the ring');
});

test('touch draw: the stick colours are told apart (move vs aim) and every colour comes from the palette', () => {
  const env = drawEnv();
  const live = { mode: 'sticks', move: { ox: 60, oy: 100, x: 70, y: 100 }, aim: { ox: 236, oy: 120, x: 250, y: 120 }, dashDown: true, compactDown: true, pauseDown: true };
  const allowed = new Set(Object.values(env.C));
  const seen = new Set();
  const note = (c) => {
    if (c === undefined) return;
    assert.ok(allowed.has(c), 'colour ' + c + ' is not in CB.Pal.C');
    seen.add(c);
  };
  for (const o of [{}, { compactFrac: 0.6, dashReady: false }, { compactReady: true }]) {
    env.clear();
    env.T.draw(env.r, live, 0.2, o);
    for (const [, , , , c] of env.log.rect) note(c);
    for (const [, , , , c] of env.log.frame) note(c);
    for (const [, , , c] of env.log.disc) note(c);
    for (const [, , , c] of env.log.ring) note(c);
    for (const [, , , opt] of env.log.text) {
      note(opt.color);
      note(opt.shadow);
    }
  }
  assert.ok(seen.has(env.C.cyan) && seen.has(env.C.gold) && seen.has(env.C.ink), 'cyan, gold and ink are all in use');
  env.clear();
  env.T.draw(env.r, live, 0, {});
  const ringColours = env.log.ring.filter(([x, y, rad]) => rad === 16 && ((x === 60 && y === 100) || (x === 236 && y === 120))).map(([, , , c]) => c);
  assert.equal(ringColours.length, 2);
  assert.notEqual(ringColours[0], ringColours[1], 'the move and aim rings differ in colour');
});

test('touch draw: DASH is dim while the dash is cooling down and bright when ready', () => {
  const env = drawEnv();
  const textAlpha = () => env.log.text.find(([s]) => s === 'DASH')[3].alpha;
  const dashRing = () => env.log.ring.find(([x, y]) => x === 298 && y === 146)[3];
  env.T.draw(env.r, IDLE, 0, { dashReady: true });
  const brightAlpha = textAlpha();
  const brightRing = dashRing();
  env.clear();
  env.T.draw(env.r, IDLE, 0, { dashReady: false });
  assert.ok(textAlpha() < brightAlpha, 'the label dims');
  assert.notEqual(dashRing(), brightRing, 'the ring changes colour');
  assert.equal(brightRing, env.C.cyan);
  const bodyAlphas = env.log.alpha.map(([a]) => a);
  assert.ok(bodyAlphas.includes(0.2), 'the body is drawn at a low alpha');
  env.clear();
  env.T.draw(env.r, IDLE, 0, {}); // no options: the dash counts as ready
  assert.equal(textAlpha(), brightAlpha);
  env.clear();
  env.T.draw(env.r, Object.assign({}, IDLE, { dashDown: true }), 0, { dashReady: true });
  assert.ok(env.log.disc.some(([x, y, rad, c]) => x === 298 && y === 146 && rad === 12 && c === env.C.cyanDark), 'a pressed DASH fills in');
});

test('touch draw: /compact fills bottom-up with compactFrac and is gold when ready', () => {
  const env = drawEnv();
  const b = BTN.compact;
  const area = (rows) => rows.reduce((s, r) => s + r.w * r.h, 0);
  const fills = {};
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    env.clear();
    env.T.draw(env.r, IDLE, 0, { compactFrac: f });
    fills[f] = compactFill(env.log);
  }
  assert.equal(fills[0].length, 0, 'an empty meter draws no fill');
  for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]]) assert.ok(area(fills[lo]) < area(fills[hi]), 'fill grows from ' + lo + ' to ' + hi);
  const rowsY = (rows) => rows.map((r) => r.y);
  assert.ok(Math.min(...rowsY(fills[0.5])) >= b.y, 'half full stays in the bottom half');
  assert.ok(Math.max(...rowsY(fills[0.5])) <= b.y + b.r - 1, 'and inside the ring');
  assert.ok(Math.max(...rowsY(fills[0.25])) === Math.max(...rowsY(fills[1])), 'every fill starts at the same bottom row');
  assert.ok(Math.min(...rowsY(fills[1])) < b.y - 5, 'full reaches the top');
  for (const rows of Object.values(fills)) for (const r of rows) assert.ok(r.x >= b.x - b.r && r.x + r.w <= b.x + b.r + 1, 'a fill row stays inside the circle');
  const colours = (rows) => new Set(rows.map((r) => r.color));
  for (const c of colours(fills[0.5])) assert.ok(c === env.C.cyan || c === env.C.offwhite, 'charging reads cyan');

  env.clear();
  env.T.draw(env.r, IDLE, 0, { compactFrac: 0.3, compactReady: true });
  const ready = compactFill(env.log);
  assert.equal(area(ready), area(fills[1]), 'ready means full, whatever the fraction');
  for (const c of colours(ready)) assert.ok(c === env.C.gold || c === env.C.white, 'ready reads gold');
});

test('touch draw: compactFrac is clamped and survives junk', () => {
  const env = drawEnv();
  const area = (f) => {
    env.clear();
    env.T.draw(env.r, IDLE, 0, { compactFrac: f });
    return compactFill(env.log).reduce((s, r) => s + r.w * r.h, 0);
  };
  assert.equal(area(-3), area(0));
  assert.equal(area(7), area(1));
  assert.equal(area(NaN), area(0));
  assert.equal(area('0.5'), area(0));
  assert.equal(area(undefined), area(0));
});

test('touch draw: a ready /compact pulses (through Comfort.blink when it exists, so calm mode can slow it)', () => {
  const env = drawEnv();
  const b = BTN.compact;
  const halo = () => env.log.ring.filter(([x, y, rad, c]) => x === b.x && y === b.y && rad === b.r + 1 && c === env.C.gold).length;

  // No Comfort module: a plain 3 Hz on/off.
  env.T.draw(env.r, IDLE, 0, { compactReady: true });
  assert.equal(halo(), 1, 'on at t = 0');
  env.clear();
  env.T.draw(env.r, IDLE, 0.4, { compactReady: true });
  assert.equal(halo(), 0, 'off a moment later');
  env.clear();
  env.T.draw(env.r, IDLE, 0.4, { compactFrac: 1 });
  assert.equal(halo(), 0, 'and never when not ready');

  // With Comfort: its blink decides, and it is asked for the same time.
  const asked = [];
  let answer = true;
  env.CB.Comfort = { blink: (t, hz) => { asked.push([t, hz]); return answer; } };
  env.clear();
  env.T.draw(env.r, IDLE, 5.5, { compactReady: true });
  assert.equal(halo(), 1);
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0], 5.5);
  assert.ok(asked[0][1] <= 6, 'a gentle rate');
  answer = false;
  env.clear();
  env.T.draw(env.r, IDLE, 5.5, { compactReady: true });
  assert.equal(halo(), 0);
  env.clear();
  asked.length = 0;
  env.T.draw(env.r, IDLE, 5.5, { compactFrac: 0.4 });
  assert.equal(asked.length, 0, 'no blink asked for while charging');
});

test('touch draw: calm mode (the real Comfort module) never blinks it faster than 4 Hz', () => {
  const env = drawEnv({ extra: ['src/game/comfort.js'] });
  env.CB.Comfort.set(true);
  const b = BTN.compact;
  const states = [];
  for (let i = 0; i < 120; i++) {
    env.clear();
    env.T.draw(env.r, IDLE, i / 60, { compactReady: true });
    states.push(env.log.ring.some(([x, y, rad]) => x === b.x && y === b.y && rad === b.r + 1));
  }
  let flips = 0;
  for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) flips++;
  assert.ok(flips > 0 && flips <= 8, 'flips in 2 s: ' + flips);
});

test('touch draw: the pause box is a small frame with II, and fills while pressed', () => {
  const env = drawEnv();
  env.T.draw(env.r, IDLE, 0, {});
  const frame = env.log.frame.find(([x, y, w, h]) => x >= 296 && y >= 22 && x + w <= 316 && y + h <= 40);
  assert.ok(frame, 'a frame inside the pause box');
  assert.ok(frame[2] <= 12 && frame[3] <= 12, 'a small one');
  const pressedFills = () => env.log.rect.filter(([x, y, w, h, c]) => x > frame[0] && y > frame[1] && x + w < frame[0] + frame[2] && y + h < frame[1] + frame[3] && c === env.C.greyDark).length;
  assert.equal(pressedFills(), 0);
  env.clear();
  env.T.draw(env.r, Object.assign({}, IDLE, { pauseDown: true }), 0, {});
  assert.equal(pressedFills(), 1);
});

test('touch draw: nothing hides the middle of the arena and nothing is opaque', () => {
  const env = drawEnv();
  const live = { mode: 'sticks', move: { ox: 60, oy: 100, x: 70, y: 100 }, aim: { ox: 236, oy: 120, x: 250, y: 120 }, dashDown: true, compactDown: true, pauseDown: true };
  env.T.draw(env.r, live, 0, { compactFrac: 0.5 });
  for (const [x, , w] of env.log.rect) assert.ok(x + w <= 320 && x >= 0, 'rects stay on screen');
  assert.ok(env.rec.sprites().length === 0, 'no sprites');
  // Every primitive except the labels is drawn inside an r.alpha block below 1 (alpha calls come first, in order).
  assert.ok(env.log.alpha.length >= 6);
  for (const [a] of env.log.alpha) assert.ok(a > 0 && a < 1, 'alpha ' + a);
  for (const [, , , opt] of env.log.text) assert.ok(opt.alpha > 0 && opt.alpha < 1, 'labels are translucent too');
  // Nothing drawn between the two rest rings' columns, nor in the top-middle where the boss bar and wave text live.
  for (const [x, y, w, h] of env.log.rect) assert.ok(!(x >= 100 && x + w <= 200 && y >= 0 && y < 160), 'the middle of the screen stays clear');
  for (const [x, y] of env.log.disc) assert.ok(!(x >= 100 && x <= 200 && y < 120), 'discs too');
});

test('touch draw: every view, option and time combination draws without throwing', () => {
  const env = drawEnv();
  const views = [
    null,
    IDLE,
    { mode: 'menu', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false },
    { mode: 'sticks', move: { ox: 40, oy: 140, x: 56, y: 140 }, aim: null, dashDown: false, compactDown: false, pauseDown: false },
    { mode: 'sticks', move: null, aim: { ox: 236, oy: 140, x: 236, y: 120 }, dashDown: true, compactDown: false, pauseDown: false },
    { mode: 'sticks', move: { ox: -10, oy: 200, x: -30, y: 215 }, aim: { ox: 330, oy: -5, x: 345, y: -9 }, dashDown: true, compactDown: true, pauseDown: true },
  ];
  const opts = [undefined, null, {}, { compactFrac: 0, compactReady: false, dashReady: true }, { compactFrac: 0.5, dashReady: false }, { compactFrac: 1, compactReady: true, dashReady: true },
    { compactFrac: NaN }, { compactFrac: -1, compactReady: true }, { compactFrac: 9, dashReady: false }];
  const times = [0, 0.4, 1.7, 1e6, -3, NaN, undefined];
  let n = 0;
  for (const v of views) {
    for (const o of opts) {
      for (const t of times) {
        env.clear();
        env.T.draw(env.r, v, t, o);
        n++;
        if (!v) {
          assert.equal(env.rec.texts().length, 0);
          continue;
        }
        const names = env.rec.texts().map((b) => b.str).filter((x) => x !== 'MOVE' && !x.startsWith('AIM')).sort(); // the first-run labels come and go
        assert.deepEqual(names, ['/c', 'DASH', 'II'], 'labels for view ' + views.indexOf(v));
        assert.deepEqual(env.rec.outside(320, 180), []);
        assert.deepEqual(env.rec.overlaps(), []);
      }
    }
  }
  assert.ok(n >= 300);
});

test('touch draw: a live view straight from the state machine draws', () => {
  const env = drawEnv();
  const st = env.T.createState();
  env.T.setMode(st, 'sticks');
  env.T.down(st, 1, 50, 130);
  env.T.move(st, 1, 90, 120);
  env.T.down(st, 2, 250, 120);
  env.T.down(st, 3, 298, 146);
  env.T.draw(env.r, env.T.view(st), 0.1, { compactFrac: 0.7, compactReady: false, dashReady: true });
  assert.deepEqual(env.rec.texts().map((b) => b.str).sort(), ['/c', 'DASH', 'II'], 'both sticks live: no first-run labels');
  const m = env.T.view(st).move;
  assert.ok(env.log.ring.some(([x, y, rad]) => Math.abs(x - m.ox) < 1 && Math.abs(y - m.oy) < 1 && rad === 16), 'the ring follows the dragged origin');
});

// ---- platform helpers -----------------------------------------------------------------------------------------------------

test('touch: isPortrait compares the window sides and never throws', () => {
  const T = H.load(LOGIC).Touch;
  assert.equal(T.isPortrait({ innerWidth: 390, innerHeight: 844 }), true);
  assert.equal(T.isPortrait({ innerWidth: 844, innerHeight: 390 }), false);
  assert.equal(T.isPortrait({ innerWidth: 500, innerHeight: 500 }), false, 'square is not portrait');
  assert.equal(T.isPortrait({ innerWidth: 500, innerHeight: 501 }), true);
  for (const junk of [undefined, null, {}, 'win', 5, { innerWidth: 400 }, { innerHeight: 800 }, { innerWidth: '400', innerHeight: '800' }, { innerWidth: NaN, innerHeight: 800 }]) {
    assert.equal(T.isPortrait(junk), false, JSON.stringify(junk));
  }
  const hostile = {
    get innerWidth() { throw new Error('no'); },
    innerHeight: 800,
  };
  assert.equal(T.isPortrait(hostile), false);
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('touch: requestFullscreen asks for fullscreen with the nav bar hidden, then locks landscape', async () => {
  const T = H.load(LOGIC).Touch;
  const calls = [];
  const doc = { documentElement: { requestFullscreen: (o) => { calls.push(['fullscreen', plain(o)]); return Promise.resolve(); } } };
  const scr = { orientation: { lock: (m) => { calls.push(['lock', m]); return Promise.resolve(); } } };
  T.requestFullscreen(doc, scr);
  assert.deepEqual(calls, [['fullscreen', { navigationUI: 'hide' }]], 'the lock waits for fullscreen');
  await tick();
  assert.deepEqual(calls, [['fullscreen', { navigationUI: 'hide' }], ['lock', 'landscape']]);
});

test('touch: requestFullscreen still tries the lock when fullscreen is rejected, and swallows every rejection', async () => {
  const T = H.load(LOGIC).Touch;
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const calls = [];
    const doc = { documentElement: { requestFullscreen: () => Promise.reject(new Error('denied')) } };
    const scr = { orientation: { lock: (m) => { calls.push(m); return Promise.reject(new Error('NotSupportedError')); } } };
    T.requestFullscreen(doc, scr);
    await tick();
    await tick();
    assert.deepEqual(calls, ['landscape']);
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('touch: requestFullscreen survives missing APIs, sync throws and odd return values', async () => {
  const T = H.load(LOGIC).Touch;
  const locks = [];
  const scr = { orientation: { lock: (m) => { locks.push(m); } } };
  T.requestFullscreen();
  T.requestFullscreen(null, null);
  T.requestFullscreen({}, {});
  T.requestFullscreen({ documentElement: {} }, { orientation: {} });
  T.requestFullscreen({ documentElement: null }, { orientation: null });
  T.requestFullscreen({ documentElement: { requestFullscreen: 5 } }, { orientation: { lock: 'no' } });
  assert.deepEqual(locks, []);

  T.requestFullscreen({ documentElement: { requestFullscreen: () => { throw new Error('sync'); } } }, scr);
  assert.deepEqual(locks, ['landscape'], 'a throwing request still falls through to the lock');
  T.requestFullscreen({ documentElement: { requestFullscreen: () => undefined } }, scr);
  assert.deepEqual(locks, ['landscape', 'landscape'], 'a non-promise result locks at once');
  T.requestFullscreen({ documentElement: {} }, { orientation: { lock: () => { throw new Error('sync lock'); } } });
  T.requestFullscreen({ documentElement: {} }, { get orientation() { throw new Error('getter'); } });
  T.requestFullscreen({ get documentElement() { throw new Error('getter'); } }, scr);
  const badThenable = { then() { throw new Error('then'); } };
  T.requestFullscreen({ documentElement: { requestFullscreen: () => badThenable } }, scr);
  const hangs = { then() {} };
  T.requestFullscreen({ documentElement: { requestFullscreen: () => hangs } }, scr);
  await tick();
});
