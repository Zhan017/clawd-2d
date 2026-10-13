'use strict';
// CB.Gamepad: pad picking, the pure per-poll read (sticks, D-pad, fire, edges, menu-nav latches) and dual-rumble.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const CB = H.load(['src/core/ns.js', 'src/core/gamepad.js']);
const G = CB.Gamepad;
const B = G.BTN;

// A fake standard pad. `down` lists pressed button indices, `values` sets analog values (index → 0..1),
// `axes` is [lx, ly, rx, ry]. Every button exists, so tests can drop buttons by overriding `buttons`.
function mkPad(o) {
  const op = o || {};
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons.push({ pressed: false, touched: false, value: 0 });
  for (const i of op.down || []) buttons[i] = { pressed: true, touched: true, value: 1 };
  for (const k of Object.keys(op.values || {})) buttons[k] = { pressed: op.values[k] >= 0.5, touched: op.values[k] > 0, value: op.values[k] };
  return Object.assign({ id: 'fake pad', index: 0, connected: true, mapping: 'standard', buttons, axes: op.axes || [0, 0, 0, 0] }, op.extra || {});
}

const EDGE_NAMES = ['confirm', 'dash', 'compact', 'pause', 'quit'];
const PAD_NAMES = ['a', 'b', 'x', 'y', 'lb', 'rb', 'start', 'back'];
const trueEdges = (out) => EDGE_NAMES.filter((n) => out.edges[n]);
const truePad = (out) => PAD_NAMES.filter((n) => out.pad[n]);

test('gamepad: constants match the contract', () => {
  assert.deepEqual(H.plain(G.BTN), { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });
  assert.equal(G.DZ_MOVE, 0.25);
  assert.equal(G.DZ_AIM, 0.3);
  assert.equal(G.FIRE_AT, 0.5);
  assert.equal(G.TRIGGER_AT, 0.35);
  assert.equal(G.NAV_ON, 0.6);
  assert.equal(G.NAV_OFF, 0.3);
});

test('gamepad: createState gives the documented fresh state, and states are independent', () => {
  const a = G.createState();
  assert.deepEqual(H.plain(a), { prev: [], lt: false, navLatchX: 0, navLatchY: 0 });
  const b = G.createState();
  G.read(mkPad({ down: [B.A] }), a);
  assert.equal(G.read(mkPad({ down: [B.A] }), b).edges.confirm, true, 'another state still sees a fresh press');
});

// ---- pick -------------------------------------------------------------------------------------------------------------------

test('gamepad: pick() finds nothing in an empty, all-null or junk list', () => {
  assert.strictEqual(G.pick(null), null);
  assert.strictEqual(G.pick(undefined), null);
  assert.strictEqual(G.pick([]), null);
  assert.strictEqual(G.pick([null, null, null, null]), null);
  assert.strictEqual(G.pick({}), null);
  assert.strictEqual(G.pick('pad'), null);
  assert.strictEqual(G.pick(7), null);
  assert.strictEqual(G.pick([undefined, null]), null);
});

test('gamepad: pick() takes the first non-null pad that is not marked disconnected', () => {
  const p0 = mkPad({ extra: { mapping: '' } });
  const p1 = mkPad({ extra: { mapping: '' } });
  assert.equal(G.pick([null, p0, p1]), p0);
  assert.equal(G.pick([null, null, p1]), p1);
  const gone = mkPad({ extra: { mapping: '', connected: false } });
  assert.equal(G.pick([gone, p1]), p1, 'connected === false is skipped');
  assert.strictEqual(G.pick([gone]), null);
  const unknown = mkPad({ extra: { mapping: '' } });
  delete unknown.connected;
  assert.equal(G.pick([unknown]), unknown, 'a pad with no `connected` flag counts as connected');
});

test('gamepad: pick() prefers a pad with the standard mapping, the first such one, over an earlier odd pad', () => {
  const odd = mkPad({ extra: { mapping: '', id: 'odd' } });
  const std1 = mkPad({ extra: { id: 'std1' } });
  const std2 = mkPad({ extra: { id: 'std2' } });
  assert.equal(G.pick([odd, std1, std2]), std1);
  assert.equal(G.pick([null, odd, null, std2, std1]), std2);
  assert.equal(G.pick([odd]), odd, 'with no standard pad the odd one is used');
  const stdGone = mkPad({ extra: { connected: false } });
  assert.equal(G.pick([stdGone, odd]), odd, 'a disconnected standard pad does not beat a connected odd one');
});

test('gamepad: pick() accepts an array-like (a GamepadList)', () => {
  const p = mkPad();
  assert.equal(G.pick({ 0: null, 1: p, length: 2 }), p);
});

// ---- read: idle, null, missing data ----------------------------------------------------------------------------------------

test('gamepad: a null pad gives an idle out and leaves the state untouched', () => {
  const st = G.createState();
  G.read(mkPad({ down: [B.A, B.LT], axes: [0.9, 0, 0, 0] }), st);
  const before = JSON.stringify(st);
  for (const pad of [null, undefined]) {
    const out = G.read(pad, st);
    assert.equal(out.active, false);
    assert.equal(out.moveX, 0);
    assert.equal(out.moveY, 0);
    assert.strictEqual(out.aimDirX, null);
    assert.strictEqual(out.aimDirY, null);
    assert.equal(out.fire, false);
    assert.deepEqual(trueEdges(out), []);
    assert.deepEqual(truePad(out), []);
    assert.equal(out.navX, 0);
    assert.equal(out.navY, 0);
    assert.equal(JSON.stringify(st), before, 'state unchanged');
  }
  // A button still held when the pad comes back is not a new press.
  assert.equal(G.read(mkPad({ down: [B.A] }), st).edges.confirm, false);
});

test('gamepad: an idle pad reads as all zero, false and null', () => {
  const out = G.read(mkPad(), G.createState());
  assert.equal(out.active, false);
  assert.equal(out.moveX, 0);
  assert.equal(out.moveY, 0);
  assert.strictEqual(out.aimDirX, null);
  assert.strictEqual(out.aimDirY, null);
  assert.equal(out.fire, false);
  assert.deepEqual(trueEdges(out), []);
  assert.deepEqual(truePad(out), []);
  assert.equal(out.navX, 0);
  assert.equal(out.navY, 0);
  assert.deepEqual(Object.keys(out.edges).sort(), EDGE_NAMES.slice().sort());
  assert.deepEqual(Object.keys(out.pad).sort(), PAD_NAMES.slice().sort());
});

test('gamepad: missing buttons and axes count as released and zero; junk entries never throw', () => {
  const st = G.createState();
  for (const pad of [{}, { buttons: [], axes: [] }, { buttons: null, axes: null }, { buttons: [{ pressed: true, value: 1 }], axes: [0.8] }]) {
    assert.doesNotThrow(() => G.read(pad, st));
  }
  let out = G.read({}, G.createState());
  assert.equal(out.active, false);
  assert.equal(out.moveX, 0);
  assert.strictEqual(out.aimDirX, null);
  // Only button 0 and axis 0 exist: A reads, nothing else does.
  out = G.read({ buttons: [{ pressed: true, value: 1 }], axes: [0.8] }, G.createState());
  assert.equal(out.edges.confirm, true);
  assert.equal(out.moveX, 0.8);
  assert.equal(out.moveY, 0, 'a missing axis is zero');
  assert.strictEqual(out.aimDirX, null);
  assert.equal(out.fire, false);
  // Holes, nulls, numbers and NaN inside the arrays.
  out = G.read({ buttons: [null, undefined, 5, 'x', {}, { value: 'high' }], axes: [NaN, undefined, null, Infinity] }, G.createState());
  assert.equal(out.active, false);
  assert.equal(out.moveX, 0);
  assert.strictEqual(out.aimDirX, null);
  assert.deepEqual(trueEdges(out), []);
});

test('gamepad: read() never writes to the pad it is given', () => {
  const pad = mkPad({ down: [B.A, B.RB], axes: [0.7, -0.7, 0.4, 0.4], values: { 6: 0.9, 7: 0.9 } });
  Object.freeze(pad);
  Object.freeze(pad.axes);
  for (const b of pad.buttons) Object.freeze(b);
  Object.freeze(pad.buttons);
  assert.doesNotThrow(() => G.read(pad, G.createState()));
});

test('gamepad: read() with no state at all still works (every press is an edge)', () => {
  const out = G.read(mkPad({ down: [B.A] }));
  assert.equal(out.edges.confirm, true);
});

test('gamepad: a button counts as pressed on .pressed or on .value above 0.5, not at exactly 0.5', () => {
  const press = (btn) => {
    const pad = mkPad();
    pad.buttons[B.A] = btn;
    return G.read(pad, G.createState()).edges.confirm;
  };
  assert.equal(press({ pressed: true, value: 0 }), true);
  assert.equal(press({ pressed: false, value: 0.51 }), true);
  assert.equal(press({ pressed: false, value: 0.5 }), false);
  assert.equal(press({ pressed: false, value: 0 }), false);
  assert.equal(press({ value: 1 }), true, 'no .pressed flag');
  assert.equal(press({ pressed: true }), true, 'no .value');
  assert.equal(press(undefined), false);
});

// ---- read: sticks ------------------------------------------------------------------------------------------------------------

test('gamepad: the L-stick uses a radial deadzone of DZ_MOVE and passes raw values beyond it', () => {
  const move = (x, y) => {
    const o = G.read(mkPad({ axes: [x, y, 0, 0] }), G.createState());
    return [o.moveX, o.moveY];
  };
  assert.deepEqual(move(0.2, 0), [0, 0]);
  assert.deepEqual(move(0.24, 0), [0, 0]);
  assert.deepEqual(move(0, -0.24), [0, 0]);
  assert.deepEqual(move(0.17, 0.17), [0, 0], 'magnitude 0.24: inside');
  assert.deepEqual(move(0.25, 0), [0.25, 0], 'exactly on the edge is out');
  assert.deepEqual(move(0.2, 0.2), [0.2, 0.2], 'radial, not per axis: each axis is under 0.25 but the magnitude is 0.28');
  assert.deepEqual(move(-0.6, 0.3), [-0.6, 0.3], 'raw values, not normalised');
  assert.deepEqual(move(1, -1), [1, -1]);
  assert.deepEqual(move(0, 0), [0, 0]);
});

test('gamepad: a deadzoned or zero stick reads +0, never -0', () => {
  const o = G.read(mkPad({ axes: [-0, -0.1, -0, -0.1] }), G.createState());
  assert.ok(Object.is(o.moveX, 0));
  assert.ok(Object.is(o.moveY, 0));
  const p = G.read(mkPad({ axes: [0, 0, -0.5, -0] }), G.createState());
  assert.ok(Object.is(p.aimDirY, 0), 'a unit vector along -x has y +0');
  assert.ok(Object.is(p.aimDirX, -1));
  const q = G.read(mkPad({ axes: [-0, 0.5, 0, 0] }), G.createState());
  assert.ok(Object.is(q.moveX, 0));
});

test('gamepad: the D-pad beats the L-stick; opposite buttons cancel', () => {
  const read = (down, axes) => {
    const o = G.read(mkPad({ down, axes: axes || [0, 0, 0, 0] }), G.createState());
    return [o.moveX, o.moveY];
  };
  assert.deepEqual(read([B.RIGHT]), [1, 0]);
  assert.deepEqual(read([B.LEFT]), [-1, 0]);
  assert.deepEqual(read([B.UP]), [0, -1]);
  assert.deepEqual(read([B.DOWN]), [0, 1]);
  assert.deepEqual(read([B.UP, B.LEFT]), [-1, -1]);
  assert.deepEqual(read([B.DOWN, B.RIGHT]), [1, 1]);
  assert.deepEqual(read([B.LEFT, B.RIGHT]), [0, 0], 'left+right cancel');
  assert.deepEqual(read([B.RIGHT], [-0.9, 0.9, 0, 0]), [1, 0], 'the stick is ignored while any D-pad button is held');
  assert.deepEqual(read([B.LEFT, B.RIGHT], [0.9, 0.9, 0, 0]), [0, 0], 'even when the D-pad cancels out');
  assert.deepEqual(read([], [-0.9, 0.9, 0, 0]), [-0.9, 0.9], 'no D-pad: the stick');
});

test('gamepad: the R-stick aims along a unit vector from DZ_AIM, and not below it', () => {
  const aim = (x, y) => {
    const o = G.read(mkPad({ axes: [0, 0, x, y] }), G.createState());
    return [o.aimDirX, o.aimDirY];
  };
  assert.deepEqual(aim(0.29, 0), [null, null]);
  assert.deepEqual(aim(0, -0.2), [null, null]);
  assert.deepEqual(aim(0.2, 0.2), [null, null], 'magnitude 0.28');
  assert.deepEqual(aim(0.3, 0), [1, 0], 'exactly on the edge is out');
  assert.deepEqual(aim(0, -0.3), [0, -1]);
  assert.deepEqual(aim(-0.5, 0), [-1, 0]);
  const [x, y] = aim(0.3, 0.4);
  assert.ok(Math.abs(x - 0.6) < 1e-12 && Math.abs(y - 0.8) < 1e-12, `unit vector (${x}, ${y})`);
  const [dx, dy] = aim(-0.9, -0.9);
  assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-12);
  assert.ok(dx < 0 && dy < 0);
  assert.equal(aim(0.7, 0.7)[0], aim(0.35, 0.35)[0], 'only the direction counts, not the deflection');
});

test('gamepad: fire follows the R-stick at FIRE_AT and the right trigger at TRIGGER_AT', () => {
  const fire = (o) => G.read(mkPad(o), G.createState()).fire;
  assert.equal(fire({ axes: [0, 0, 0.49, 0] }), false, 'aiming alone does not fire');
  assert.equal(fire({ axes: [0, 0, 0.5, 0] }), true);
  assert.equal(fire({ axes: [0, 0, 0, -1] }), true);
  assert.equal(fire({ axes: [0.7, 0.7, 0, 0] }), false, 'the L-stick never fires');
  assert.equal(fire({ values: { 7: 0.34 } }), false);
  assert.equal(fire({ values: { 7: 0.35 } }), true);
  assert.equal(fire({ values: { 7: 1 } }), true);
  assert.equal(fire({ down: [B.RT] }), true, 'a digital RT');
  const digital = mkPad();
  digital.buttons[B.RT] = { pressed: true };
  assert.equal(G.read(digital, G.createState()).fire, true, 'a trigger with only a .pressed flag');
  assert.equal(fire({ values: { 6: 1 } }), false, 'the left trigger does not fire');
  assert.equal(fire({ down: [B.A, B.RB, B.LB] }), false);
});

// ---- read: edges -------------------------------------------------------------------------------------------------------------

test('gamepad: each button fires its own edges, and only on the tick it goes down', () => {
  // [button, edges expected, pad flags expected]
  const cases = [
    [B.A, ['confirm', 'dash'], ['a']],
    [B.B, ['compact'], ['b']],
    [B.X, [], ['x']],
    [B.Y, [], ['y']],
    [B.LB, ['dash'], ['lb']],
    [B.RB, ['compact'], ['rb']],
    [B.START, ['pause'], ['start']],
    [B.BACK, ['quit'], ['back']],
  ];
  for (const [btn, edges, flags] of cases) {
    const st = G.createState();
    let out = G.read(mkPad({ down: [btn] }), st);
    assert.deepEqual(trueEdges(out), edges, `button ${btn}: edges on press`);
    assert.deepEqual(truePad(out), flags, `button ${btn}: pad flags on press`);
    out = G.read(mkPad({ down: [btn] }), st);
    assert.deepEqual(trueEdges(out), [], `button ${btn}: nothing while held`);
    assert.deepEqual(truePad(out), []);
    G.read(mkPad(), st);
    out = G.read(mkPad({ down: [btn] }), st);
    assert.deepEqual(trueEdges(out), edges, `button ${btn}: fires again after a release`);
    assert.deepEqual(truePad(out), flags);
  }
});

test('gamepad: buttons with no mapped edge (sticks clicks, D-pad) do not raise any edge or pad flag', () => {
  for (const btn of [B.LS, B.RS, B.UP, B.DOWN, B.LEFT, B.RIGHT, B.RT]) {
    const out = G.read(mkPad({ down: [btn] }), G.createState());
    assert.deepEqual(trueEdges(out), [], `button ${btn}`);
    assert.deepEqual(truePad(out), [], `button ${btn}`);
    assert.equal(out.active, true, `button ${btn} still counts as activity`);
  }
});

test('gamepad: two buttons pressed on the same tick give both edges; a second press while another is held still edges', () => {
  const st = G.createState();
  let out = G.read(mkPad({ down: [B.START, B.RB] }), st);
  assert.deepEqual(trueEdges(out), ['compact', 'pause']);
  out = G.read(mkPad({ down: [B.START, B.RB, B.A] }), st);
  assert.deepEqual(trueEdges(out), ['confirm', 'dash'], 'A is new; START and RB are still held');
  assert.deepEqual(truePad(out), ['a']);
});

test('gamepad: the left trigger dashes on the tick it crosses TRIGGER_AT, once', () => {
  const st = G.createState();
  const lt = (v) => G.read(mkPad({ values: { 6: v } }), st);
  assert.equal(lt(0.34).edges.dash, false);
  assert.equal(st.lt, false);
  assert.equal(lt(0.35).edges.dash, true);
  assert.equal(st.lt, true);
  assert.equal(lt(0.35).edges.dash, false, 'held');
  assert.equal(lt(1).edges.dash, false, 'pressed further');
  assert.equal(lt(0.34).edges.dash, false, 'let go');
  assert.equal(st.lt, false);
  assert.equal(lt(0.9).edges.dash, true, 'squeezed again');
  const out = lt(0);
  assert.equal(out.edges.dash, false);
  assert.equal(out.edges.confirm, false, 'LT only dashes');
  assert.deepEqual(truePad(out), []);
});

test('gamepad: the right trigger fires but raises no edge, and a trigger counts for activity', () => {
  const out = G.read(mkPad({ values: { 7: 0.9 } }), G.createState());
  assert.equal(out.fire, true);
  assert.deepEqual(trueEdges(out), []);
  assert.equal(out.active, true);
  assert.equal(G.read(mkPad({ values: { 7: 0.34 } }), G.createState()).active, false, 'a trigger resting under the threshold is idle');
  assert.equal(G.read(mkPad({ values: { 6: 0.34 } }), G.createState()).active, false);
  assert.equal(G.read(mkPad({ values: { 6: 0.35 } }), G.createState()).active, true);
});

test('gamepad: A plus LB plus LT on one tick is still just one dash edge', () => {
  const out = G.read(mkPad({ down: [B.A, B.LB], values: { 6: 1 } }), G.createState());
  assert.equal(out.edges.dash, true);
  assert.equal(out.edges.confirm, true);
});

// ---- read: active ------------------------------------------------------------------------------------------------------------

test('gamepad: active is true for a button, a trigger past TRIGGER_AT, or a stick past its own deadzone', () => {
  const act = (o) => G.read(mkPad(o), G.createState()).active;
  assert.equal(act({}), false);
  for (let i = 0; i < 16; i++) assert.equal(act({ down: [i] }), true, `button ${i}`);
  assert.equal(act({ axes: [0.24, 0, 0, 0] }), false);
  assert.equal(act({ axes: [0.25, 0, 0, 0] }), true);
  assert.equal(act({ axes: [0, 0, 0.29, 0] }), false, 'R-stick is under DZ_AIM');
  assert.equal(act({ axes: [0, 0, 0.3, 0] }), true);
  assert.equal(act({ axes: [0, 0, 0, 0.29] }), false);
  assert.equal(act({ axes: [0.2, 0.2, 0, 0] }), true, 'radial deadzone');
  assert.equal(act({ axes: [0, 0, 0.2, 0.2] }), false);
  assert.equal(act({ axes: [0, -1, 0, 0] }), true);
});

test('gamepad: a button beyond the standard sixteen still counts as activity', () => {
  const pad = mkPad();
  assert.equal(pad.buttons.length, 17);
  pad.buttons[16] = { pressed: true, value: 1 };
  const out = G.read(pad, G.createState());
  assert.equal(out.active, true);
  assert.deepEqual(trueEdges(out), []);
});

// ---- read: menu navigation ---------------------------------------------------------------------------------------------------

test('gamepad: D-pad presses are nav edges, once per press', () => {
  const nav = (st, down) => {
    const o = G.read(mkPad({ down }), st);
    return [o.navX, o.navY];
  };
  const st = G.createState();
  assert.deepEqual(nav(st, []), [0, 0]);
  assert.deepEqual(nav(st, [B.RIGHT]), [1, 0]);
  assert.deepEqual(nav(st, [B.RIGHT]), [0, 0], 'held');
  assert.deepEqual(nav(st, []), [0, 0]);
  assert.deepEqual(nav(st, [B.LEFT]), [-1, 0]);
  assert.deepEqual(nav(st, []), [0, 0]);
  assert.deepEqual(nav(st, [B.UP]), [0, -1]);
  assert.deepEqual(nav(st, [B.UP, B.DOWN]), [0, 1], 'the new press edges, the held one does not');
  assert.deepEqual(nav(st, []), [0, 0]);
  assert.deepEqual(nav(st, [B.DOWN, B.RIGHT]), [1, 1], 'both axes in one tick');
  assert.deepEqual(nav(st, []), [0, 0]);
  assert.deepEqual(nav(st, [B.LEFT, B.RIGHT]), [0, 0], 'opposite presses on one tick cancel');
});

test('gamepad: an L-stick flick is a nav edge at NAV_ON, then latched until the axis falls under NAV_OFF', () => {
  const st = G.createState();
  const lx = (v) => G.read(mkPad({ axes: [v, 0, 0, 0] }), st).navX;
  assert.equal(lx(0.59), 0, 'under NAV_ON');
  assert.equal(st.navLatchX, 0);
  assert.equal(lx(0.6), 1, 'on NAV_ON');
  assert.equal(st.navLatchX, 1);
  assert.equal(lx(0.9), 0, 'held');
  assert.equal(lx(0.35), 0, 'between NAV_OFF and NAV_ON: still latched');
  assert.equal(lx(0.9), 0, 'so pushing again does not re-fire');
  assert.equal(lx(0.3), 0, 'exactly NAV_OFF is not under it');
  assert.equal(st.navLatchX, 1);
  assert.equal(lx(0.29), 0, 'under NAV_OFF re-arms');
  assert.equal(st.navLatchX, 0);
  assert.equal(lx(0.7), 1, 'fires again');
  assert.equal(lx(0), 0);
  assert.equal(lx(-0.6), -1, 'left');
  assert.equal(st.navLatchX, -1);
  assert.equal(lx(-1), 0);
  assert.equal(lx(0.9), 0, 'an overshoot to the other side while latched is not a new flick');
  assert.equal(lx(0), 0);
  assert.equal(lx(-0.61), -1, 're-armed after rest');
});

test('gamepad: the nav latches of the two stick axes are independent', () => {
  const st = G.createState();
  const at = (x, y) => {
    const o = G.read(mkPad({ axes: [x, y, 0, 0] }), st);
    return [o.navX, o.navY];
  };
  assert.deepEqual(at(0.8, 0), [1, 0]);
  assert.deepEqual(at(0.8, -0.8), [0, -1], 'x is still latched, y fires');
  assert.deepEqual(at(0.8, -0.8), [0, 0]);
  assert.deepEqual(at(0, -0.8), [0, 0], 'x re-arms under NAV_OFF, y stays latched');
  assert.deepEqual(at(-0.8, 0.8), [-1, 0], 'x fires again; y never fell under NAV_OFF, so the swing to +y is not a new flick');
  assert.deepEqual(at(-0.8, 0), [0, 0], 'y re-arms');
  assert.deepEqual(at(-0.8, 0.8), [0, 1], 'and now fires');
});

test('gamepad: only the L-stick navigates menus; the R-stick plays no part', () => {
  assert.equal(G.read(mkPad({ axes: [0, 0.6, 0, 0] }), G.createState()).navY, 1);
  const out = G.read(mkPad({ axes: [0, 0, 0.9, 0.9] }), G.createState());
  assert.equal(out.navX, 0);
  assert.equal(out.navY, 0);
});

test('gamepad: a D-pad press wins over a stick flick on the same tick; stick latches still update', () => {
  const st = G.createState();
  const out = G.read(mkPad({ down: [B.RIGHT], axes: [-0.9, 0, 0, 0] }), st);
  assert.equal(out.navX, 1);
  assert.equal(st.navLatchX, -1, 'the flick was swallowed but latched, so it will not fire later');
  assert.equal(G.read(mkPad({ down: [B.RIGHT], axes: [-0.9, 0, 0, 0] }), st).navX, 0);
});

test('gamepad: a D-pad held for movement is not a nav edge on later ticks, and moves while nav fires once', () => {
  const st = G.createState();
  let out = G.read(mkPad({ down: [B.LEFT] }), st);
  assert.equal(out.moveX, -1);
  assert.equal(out.navX, -1);
  out = G.read(mkPad({ down: [B.LEFT] }), st);
  assert.equal(out.moveX, -1, 'still moving');
  assert.equal(out.navX, 0, 'but nav fired once');
});

test('gamepad: state carries across polls (prev buttons are recorded)', () => {
  const st = G.createState();
  G.read(mkPad({ down: [B.A, B.START] }), st);
  assert.equal(st.prev[B.A], true);
  assert.equal(st.prev[B.START], true);
  assert.equal(st.prev[B.B], false);
  G.read(mkPad(), st);
  assert.equal(st.prev[B.A], false);
});

// ---- rumble ------------------------------------------------------------------------------------------------------------------

test('gamepad: rumble() plays a dual-rumble effect with the magnitudes and length mapped, and says so', () => {
  const calls = [];
  const pad = { vibrationActuator: { playEffect: (type, params) => { calls.push([type, params]); return Promise.resolve('complete'); } } };
  assert.equal(G.rumble(pad, 0.8, 0.4, 160), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'dual-rumble');
  assert.deepEqual(H.plain(calls[0][1]), { startDelay: 0, duration: 160, weakMagnitude: 0.4, strongMagnitude: 0.8 });
});

test('gamepad: rumble() clamps magnitudes to 0..1 and cleans junk numbers', () => {
  const calls = [];
  const pad = { vibrationActuator: { playEffect: (type, params) => { calls.push(params); return undefined; } } };
  G.rumble(pad, 3, -1, 250);
  assert.equal(calls[0].strongMagnitude, 1);
  assert.equal(calls[0].weakMagnitude, 0);
  assert.equal(calls[0].duration, 250);
  G.rumble(pad, NaN, undefined, -50);
  assert.equal(calls[1].strongMagnitude, 0);
  assert.equal(calls[1].weakMagnitude, 0);
  assert.equal(calls[1].duration, 0);
  G.rumble(pad, '0.5', null, '100');
  assert.equal(calls[2].strongMagnitude, 0, 'non-numbers are zero rather than guessed');
  assert.equal(calls[2].duration, 0);
});

test('gamepad: rumble() is false and quiet with no pad, no actuator or no playEffect', () => {
  assert.equal(G.rumble(null, 1, 1, 100), false);
  assert.equal(G.rumble(undefined, 1, 1, 100), false);
  assert.equal(G.rumble({}, 1, 1, 100), false);
  assert.equal(G.rumble({ vibrationActuator: null }, 1, 1, 100), false);
  assert.equal(G.rumble({ vibrationActuator: {} }, 1, 1, 100), false);
  assert.equal(G.rumble({ vibrationActuator: { playEffect: 'yes' } }, 1, 1, 100), false);
  assert.equal(G.rumble(mkPad(), 1, 1, 100), false, 'a pad without vibrationActuator');
});

test('gamepad: rumble() swallows a throwing playEffect', () => {
  const pad = { vibrationActuator: { playEffect() { throw new Error('actuator gone'); } } };
  assert.equal(G.rumble(pad, 1, 1, 100), false);
});

test('gamepad: rumble() swallows a rejected effect promise (no unhandled rejection)', async () => {
  let rejected = null;
  const pad = { vibrationActuator: { playEffect() { rejected = Promise.reject(new Error('pad asleep')); return rejected; } } };
  assert.equal(G.rumble(pad, 1, 1, 100), true, 'the effect was requested');
  await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the run here
  await assert.rejects(rejected, /pad asleep/, 'the promise itself still rejects for anyone else holding it');
});

test('gamepad: rumble() attaches a rejection handler to any thenable it is given', () => {
  let handler = null;
  const thenable = { then(ok, no) { handler = no; } };
  const pad = { vibrationActuator: { playEffect: () => thenable } };
  assert.equal(G.rumble(pad, 1, 1, 100), true);
  assert.equal(typeof handler, 'function');
  assert.doesNotThrow(() => handler(new Error('x')), 'the handler swallows');
});
