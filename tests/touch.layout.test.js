'use strict';
// Touch, second half: tap to shoot (T1), the first-run labels (T2), and the controls in the side bars with safe areas (T4).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const LOGIC = ['src/core/ns.js', 'src/core/touch.js'];
const DRAW = [...H.CORE, 'src/art/font.js', 'src/art/render.js', 'src/core/touch.js'];
const plain = H.plain;

function sticks(files) {
  const T = H.load(files || LOGIC).Touch;
  const st = T.createState();
  T.setMode(st, 'sticks');
  return { T, st };
}
const age = (T, st, n) => {
  for (let i = 0; i < n; i++) T.sample(st);
};

// ---- T1: tap to shoot where you tap ------------------------------------------------------------------------------------------

test('tap: a touch on the aim half aims at its own point and fires, with no direction, until it proves to be a stick', () => {
  const { T, st } = sticks();
  T.down(st, 1, 250, 60);
  for (let i = 0; i < T.TAP_TICKS; i++) {
    const o = T.sample(st);
    assert.deepEqual(plain(o.aimAt), { x: 250, y: 60 }, 'tick ' + i);
    assert.equal(o.fire, true);
    assert.equal(o.aimDirX, null);
    assert.equal(o.aimDirY, null);
  }
  const o = T.sample(st);
  assert.equal(o.aimAt, null, 'after 10 ticks (under 180 ms) it is a hold');
  assert.equal(o.fire, true);
  assert.equal(o.aimDirY, -1);
});

test('tap: the finger point follows a finger that wiggles under 6 px, and 6 px or more makes it a stick at once', () => {
  const { T, st } = sticks();
  T.down(st, 1, 250, 60);
  T.move(st, 1, 254, 63); // 5 px
  assert.deepEqual(plain(T.sample(st).aimAt), { x: 254, y: 63 });
  T.move(st, 1, 256, 60); // exactly 6 px from where it landed
  const o = T.sample(st);
  assert.equal(o.aimAt, null);
  assert.ok(o.aimDirX > 0.99, 'a drag steers as before');
  T.move(st, 1, 250, 60); // back at the start: still a stick, the travel is remembered
  assert.equal(T.sample(st).aimAt, null);
  T.up(st, 1);
  assert.equal(T.sample(st).fire, false, 'a lift after a drag leaves no shot');
});

test('tap: a lift inside the window keeps firing at the tapped point for 7 more ticks (about 120 ms), then stops', () => {
  const { T, st } = sticks();
  T.down(st, 1, 200, 30);
  age(T, st, 3);
  T.up(st, 1);
  for (let i = 0; i < T.SHOT_TICKS; i++) {
    const o = T.sample(st);
    assert.deepEqual(plain(o.aimAt), { x: 200, y: 30 }, 'shot tick ' + i);
    assert.equal(o.fire, true);
    assert.equal(o.aimDirX, null);
  }
  const o = T.sample(st);
  assert.equal(o.fire, false);
  assert.equal(o.aimAt, null);
  assert.equal(o.aimDirY, -1, 'the stick direction is back');
});

test('tap: the window edge is 10 ticks, and a lift after that is a hold', () => {
  const a = sticks();
  a.T.down(a.st, 1, 200, 30);
  age(a.T, a.st, 10);
  a.T.up(a.st, 1);
  assert.equal(a.T.sample(a.st).fire, true, 'lifted at 10 ticks: still a tap');
  const b = sticks();
  b.T.down(b.st, 1, 200, 30);
  age(b.T, b.st, 11);
  b.T.up(b.st, 1);
  assert.equal(b.T.sample(b.st).fire, false, 'lifted at 11 ticks: a hold');
});

test('tap: a new aim finger ends a shot that is still running, a cancel is no tap, and the move half, menus and buttons make no shot', () => {
  const { T, st } = sticks();
  T.down(st, 1, 200, 30);
  T.up(st, 1);
  T.down(st, 2, 280, 100);
  assert.deepEqual(plain(T.sample(st).aimAt), { x: 280, y: 100 }, 'the new finger, not the old shot');
  T.cancel(st, 2);
  const o = T.sample(st);
  assert.equal(o.fire, false);
  assert.equal(o.aimAt, null);

  T.down(st, 3, 40, 100); // move half
  T.up(st, 3);
  assert.equal(T.sample(st).fire, false);
  T.down(st, 4, 298, 146); // DASH
  T.up(st, 4);
  assert.equal(T.sample(st).fire, false);

  const m = H.load(LOGIC).Touch;
  const ms = m.createState();
  m.down(ms, 1, 250, 60); // menu mode
  m.up(ms, 1);
  const mo = m.sample(ms);
  assert.equal(mo.fire, false);
  assert.equal(mo.aimAt, null);

  const { T: T2, st: s2 } = sticks();
  T2.down(s2, 1, 200, 30);
  T2.up(s2, 1);
  T2.setMode(s2, 'menu');
  T2.setMode(s2, 'sticks');
  assert.equal(T2.sample(s2).aimAt, null, 'a mode change drops a running shot');
});

test('tap: releaseAll drops a running shot', () => {
  const { T, st } = sticks();
  T.down(st, 1, 200, 30);
  T.up(st, 1);
  T.releaseAll(st);
  assert.equal(T.sample(st).fire, false);
});

// ---- T4: layoutFor ----------------------------------------------------------------------------------------------------------

const M = (x0, x1, safe, y0, y1) => ({ x0, x1, y0: y0 === undefined ? 0 : y0, y1: y1 === undefined ? 180 : y1, safe: safe || { l: 0, t: 0, r: 0, b: 0 } });

test('layout: no bars, thin bars, a missing or junk metrics object keep the in-arena layout (the default constants)', () => {
  const T = H.load(LOGIC).Touch;
  for (const m of [null, undefined, {}, 'x', M(0, 320), M(-6.75, 326.75), M(-39, 359), M(-51, 320), M(-51, 371, { l: 40, t: 0, r: 0, b: 0 })]) {
    const L = T.layoutFor(m);
    assert.equal(L.bars, false, JSON.stringify(m));
    assert.deepEqual(plain(L.dash), plain(T.BUTTONS.dash));
    assert.deepEqual(plain(L.compact), plain(T.BUTTONS.compact));
    assert.deepEqual(plain(L.pause), plain(T.PAUSE));
    assert.deepEqual(plain(L.rest), plain(T.REST));
  }
});

test('layout: a wide phone puts move on the left and aim, /c, DASH and II in the right bar, II on top, clear of each other', () => {
  const T = H.load(LOGIC).Touch;
  const L = T.layoutFor(M(-51, 371, null, -7.5, 187.5));
  assert.equal(L.bars, true);
  assert.ok(L.rest.move.x < -9 && L.rest.move.x > -51 + 17, 'move ring inside the left bar: ' + L.rest.move.x);
  assert.ok(L.rest.aim.x > 320 + 9 && L.rest.aim.x < 371 - 17, 'aim ring inside the right bar');
  for (const b of [L.dash, L.compact]) assert.ok(b.x - b.r - 1 >= 320 && b.x + b.r + 1 <= 371, 'buttons inside the right bar');
  assert.ok(L.pause.x >= 320 && L.pause.x + L.pause.w <= 371);
  assert.ok(L.pause.y < L.compact.y && L.compact.y < L.dash.y && L.dash.y < L.rest.aim.y, 'II, /c, DASH, then the aim ring, top to bottom');
  // hit areas (drawn size plus HIT_PAD) never overlap, so each touch goes to one thing
  const gap = (a, b) => b.y - b.r - T.HIT_PAD - (a.y + a.r + T.HIT_PAD);
  assert.ok(L.compact.y - L.compact.r - T.HIT_PAD >= L.pause.y + L.pause.h + T.HIT_PAD, 'II and /c');
  assert.ok(gap(L.compact, L.dash) >= 0, '/c and DASH');
  assert.ok(L.dash.y + L.dash.r + T.HIT_PAD <= L.rest.aim.y - T.STICK_R, 'DASH and the aim ring');
  assert.equal(T.layoutFor(M(-51, 371, null, -7.5, 187.5)), L, 'the same metrics give the same object');
});

test('layout: the safe-area insets keep every control off the notch and the home indicator', () => {
  const T = H.load(LOGIC).Touch;
  const safe = { l: 23.5, t: 4, r: 23.5, b: 10.5 };
  const L = T.layoutFor(M(-51, 371, safe, 0, 180));
  assert.equal(L.bars, true);
  assert.ok(L.rest.move.x - 17 >= -51 + 23.5 - 0.5, 'move ring clear of the left notch');
  assert.ok(L.rest.aim.x + 17 <= 371 - 23.5 + 0.5, 'aim ring clear of the right notch');
  for (const b of [L.dash, L.compact]) assert.ok(b.x + b.r + 1 <= 371 - 23.5, 'buttons clear of the right notch');
  assert.ok(L.pause.x + L.pause.w <= 371 - 23.5);
  assert.ok(L.pause.y >= 4, 'II below the top inset');
  assert.ok(L.rest.aim.y + 17 <= 180 - 10.5, 'rings above the home indicator');
  const flat = T.layoutFor(M(-51, 371, null, 0, 180));
  assert.ok(L.rest.aim.y < flat.rest.aim.y, 'the bottom inset lifts the rings');
  // the bars shrink to nothing under a huge notch: back to the arena
  assert.equal(T.layoutFor(M(-51, 371, { l: 40, t: 0, r: 40, b: 0 })).bars, false);
});

test('layout: setLayout moves the hit areas to match what is drawn, and null brings the arena layout back', () => {
  const { T, st } = sticks();
  const L = T.layoutFor(M(-51, 371));
  T.setLayout(st, L);
  const hit = (x, y) => {
    const s = T.createState();
    T.setMode(s, 'sticks');
    T.setLayout(s, st.layout);
    T.down(s, 1, x, y);
    const o = T.sample(s);
    return o.edges.dash ? 'dash' : o.edges.compact ? 'compact' : o.edges.pause ? 'pause' : T.view(s).move ? 'move' : T.view(s).aim ? 'aim' : 'none';
  };
  assert.equal(hit(L.dash.x, L.dash.y), 'dash');
  assert.equal(hit(L.compact.x, L.compact.y), 'compact');
  assert.equal(hit(L.pause.x + 10, L.pause.y + 9), 'pause');
  assert.equal(hit(298, 146), 'aim', 'the old DASH spot is aim ground now');
  assert.equal(hit(-30, 100), 'move', 'the left bar is the move side');
  assert.equal(hit(L.rest.aim.x, L.rest.aim.y), 'aim');
  T.setLayout(st, null);
  assert.equal(hit(298, 146), 'dash');
  T.setLayout(st, { junk: true });
  assert.equal(st.layout, null, 'a layout without the three hit areas is ignored');
});

// ---- T4 and T2: drawing -------------------------------------------------------------------------------------------------------

function drawEnv(win) {
  const { CB, sandbox } = H.load(DRAW, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), win || { innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 });
  r.resize();
  const log = { text: [], ring: [], disc: [], rect: [] };
  for (const k of Object.keys(log)) {
    const orig = r[k];
    r[k] = function (...a) {
      log[k].push(a);
      return orig.apply(this, a);
    };
  }
  const queued = [];
  const realOverlay = r.overlay;
  r.overlay = (fn) => {
    queued.push(fn);
    return realOverlay(fn);
  };
  const clear = () => {
    for (const k of Object.keys(log)) log[k].length = 0;
    queued.length = 0;
  };
  return { CB, sandbox, r, log, queued, clear, T: CB.Touch };
}
const IDLE = { mode: 'sticks', move: null, aim: null, dashDown: false, compactDown: false, pauseDown: false };

test('draw: with side bars the whole overlay goes to the full-resolution pass and sits in the bars; with none it stays in the buffer', () => {
  const env = drawEnv();
  const L = env.T.layoutFor(env.r.metrics());
  assert.equal(L.bars, true);
  env.T.draw(env.r, IDLE, 0, {});
  assert.equal(env.queued.length, 1, 'one deferred pass');
  assert.equal(env.log.ring.length, 0, 'nothing drawn into the buffer yet');
  env.r.present();
  const at = (x, y, rad) => env.log.ring.filter(([cx, cy, rr]) => cx === x && cy === y && rr === rad).length;
  assert.equal(at(L.rest.move.x, L.rest.move.y, 16), 1, 'move ghost in the left bar');
  assert.equal(at(L.rest.aim.x, L.rest.aim.y, 16), 1, 'aim ghost in the right bar');
  assert.ok(env.log.ring.some(([x, y]) => x === L.dash.x && y === L.dash.y), 'DASH in the right bar');
  assert.ok(env.log.text.some(([s, x, y]) => s === 'II' && x >= L.pause.x && y >= L.pause.y), 'II at the top of the right bar');

  const flat = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  flat.T.draw(flat.r, IDLE, 0, {});
  assert.equal(flat.queued.length, 0);
  assert.ok(flat.log.ring.some(([x, y, rr]) => x === 40 && y === 140 && rr === 16), 'the in-arena rest ring');
});

test('draw: a live stick is a ring exactly at the finger origin, never clamped: in the buffer when it fits, in the full-resolution pass when it does not', () => {
  const env = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  const inside = { mode: 'sticks', move: { ox: 60, oy: 100, x: 70, y: 100 }, aim: null, dashDown: false, compactDown: false, pauseDown: false };
  env.T.draw(env.r, inside, 0, {});
  assert.equal(env.queued.length, 0, 'inside the buffer: drawn at once');
  assert.ok(env.log.ring.some(([x, y, rr]) => x === 60 && y === 100 && rr === 16));

  env.clear();
  const edge = { mode: 'sticks', move: { ox: 3, oy: 175, x: 5, y: 176 }, aim: { ox: 330, oy: -4, x: 340, y: -4 }, dashDown: false, compactDown: false, pauseDown: false };
  env.T.draw(env.r, edge, 0, {});
  assert.equal(env.queued.length, 2, 'at the edge or in the letterbox: deferred');
  assert.equal(env.log.ring.filter(([x]) => x === 3 || x === 330).length, 0);
  env.r.present();
  assert.ok(env.log.ring.some(([x, y, rr]) => x === 3 && y === 175 && rr === 16), 'the ring is where the finger landed, not pulled inside');
  assert.ok(env.log.ring.some(([x, y, rr]) => x === 330 && y === -4 && rr === 16));
});

test('draw: a renderer without overlay() or metrics() draws everything at once in the arena', () => {
  const env = drawEnv({ innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 });
  const bare = Object.assign({}, env.r);
  delete bare.overlay;
  delete bare.metrics;
  env.T.draw(bare, { mode: 'sticks', move: { ox: -20, oy: 100, x: -20, y: 100 }, aim: null, dashDown: false, compactDown: false, pauseDown: false }, 0, {});
  assert.ok(env.log.ring.some(([x, y]) => x === 236 && y === 140), 'the arena layout (the aim ghost; the move stick is live)');
  assert.ok(env.log.ring.some(([x]) => x === -20), 'and the live ring at the finger');
});

// ---- T2: labels --------------------------------------------------------------------------------------------------------------

const labels = (env) => env.log.text.filter(([s]) => s === 'MOVE' || s.startsWith('AIM') || s === 'FIRE' || s === 'AIM +').map(([s]) => s);

test('labels: MOVE and AIM + FIRE ride the ghost rings until each stick has been used once, and that is saved', () => {
  const env = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  const store = {};
  env.CB.Save = { get: (k, d) => (k in store ? store[k] : d), set: (k, v) => { store[k] = v; } };
  env.T.draw(env.r, IDLE, 0, {});
  assert.deepEqual(labels(env).sort(), ['AIM + FIRE', 'MOVE']);
  env.clear();
  env.T.draw(env.r, Object.assign({}, IDLE, { move: { ox: 60, oy: 100, x: 60, y: 100 } }), 0, {});
  assert.deepEqual(labels(env), ['AIM + FIRE'], 'the move label goes once the move stick is used');
  assert.deepEqual(plain(store.touchTaught), { move: true, aim: false });
  env.clear();
  env.T.draw(env.r, IDLE, 0, {});
  assert.deepEqual(labels(env), ['AIM + FIRE'], 'and stays gone');
  env.T.draw(env.r, Object.assign({}, IDLE, { aim: { ox: 236, oy: 100, x: 236, y: 100 } }), 0, {});
  assert.deepEqual(plain(store.touchTaught), { move: true, aim: true });
  env.clear();
  env.T.draw(env.r, IDLE, 0, {});
  assert.deepEqual(labels(env), []);
});

test('labels: a saved touchTaught from an earlier visit hides them, and junk or a throwing save is shrugged off', () => {
  const env = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  env.CB.Save = { get: () => ({ move: true, aim: true }), set() {} };
  env.T.draw(env.r, IDLE, 0, {});
  assert.deepEqual(labels(env), []);

  const junk = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  junk.CB.Save = { get: () => 'nonsense', set() { throw new Error('quota'); } };
  junk.T.draw(junk.r, IDLE, 0, {});
  assert.equal(labels(junk).length, 2);
  assert.doesNotThrow(() => junk.T.draw(junk.r, Object.assign({}, IDLE, { move: { ox: 60, oy: 100, x: 60, y: 100 } }), 0, {}));
});

test('labels: they pulse at 1 Hz at most and are steady in calm mode; the ghost rings are at alpha 0.3', () => {
  const env = drawEnv({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  const alphas = (t) => {
    env.clear();
    env.T.draw(env.r, IDLE, t, {});
    return env.log.text.filter(([s]) => s === 'MOVE').map(([, , , o]) => o.alpha);
  };
  const seen = new Set([0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9].map((t) => alphas(t)[0]));
  assert.ok(seen.size > 3, 'it pulses');
  assert.ok(Math.abs(alphas(0)[0] - alphas(1)[0]) < 1e-9 && Math.abs(alphas(0.3)[0] - alphas(2.3)[0]) < 1e-9, 'once a second');
  for (const a of seen) assert.ok(a > 0.4 && a < 1);
  env.CB.Comfort = { calm: () => true, blink: () => true };
  const calm = new Set([0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9].map((t) => alphas(t)[0]));
  assert.equal(calm.size, 1, 'steady in calm mode');
  env.clear();
  env.T.draw(env.r, IDLE, 0, {});
});

test('labels: in a narrow bar AIM + FIRE splits over two lines and stays inside the bar', () => {
  const env = drawEnv();
  env.T.draw(env.r, IDLE, 0, {});
  env.r.present();
  assert.deepEqual(labels(env).sort(), ['AIM +', 'FIRE', 'MOVE']);
  const L = env.T.layoutFor(env.r.metrics());
  for (const [s, x] of env.log.text.filter(([s]) => s === 'AIM +' || s === 'FIRE')) {
    assert.ok(x >= 320 && x + env.r.measure(s, 1) <= 371, s + ' inside the right bar');
  }
  const move = env.log.text.find(([s]) => s === 'MOVE');
  assert.ok(move[1] >= -51 && move[1] + env.r.measure('MOVE', 1) <= 0, 'MOVE inside the left bar');
  assert.ok(L.bars);
});
