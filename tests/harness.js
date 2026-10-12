'use strict';
// Loads game scripts into a node:vm sandbox with DOM/canvas stubs.
// Objects returned from the sandbox come from another realm: compare them
// with assert.deepEqual or plain(), never assert.deepStrictEqual.
// Exports: load / loadWith / scriptList / GAME_BASE / CORE / makeInput / plain / stepN, plus
//   load(files, { localStorage })   installs that storage object in the sandbox
//   sandbox.__intervals             callbacks registered through the sandbox's setInterval stub
//   fakeAudioContext()              inert Web Audio fake that records starts and param writes (audio and music tests)
//   recorder(r, CB)                 records text and sprite boxes from a renderer, for layout tests
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function makeCtx2d() {
  // Real defaults for state the renderer reads back (so headless draw smoke tests stay numeric).
  const target = {
    canvas: null,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (s) => ({ width: String(s).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

function makeCanvas() {
  const c = {
    width: 300,
    height: 150,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }),
  };
  const ctx = makeCtx2d();
  ctx.canvas = c;
  c.getContext = () => ctx;
  return c;
}

// setInterval/clearInterval never run on their own in tests: the callbacks are recorded in `sandbox.__intervals`
// (the callbacks themselves, in registration order; clearInterval removes its entry), and a test calls them by hand.
function makeIntervals() {
  const live = [];
  const list = [];
  let nextId = 1;
  const sync = () => {
    list.length = 0;
    for (const t of live) list.push(t.fn);
  };
  return {
    list,
    setInterval(fn) {
      const id = nextId++;
      live.push({ id, fn });
      sync();
      return id;
    },
    clearInterval(id) {
      const i = live.findIndex((t) => t.id === id);
      if (i >= 0) live.splice(i, 1);
      sync();
    },
  };
}

function makeSandbox() {
  const intervals = makeIntervals();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: intervals.setInterval,
    clearInterval: intervals.clearInterval,
    __intervals: intervals.list,
    CB_NO_BOOT: true,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { hash: '', reload() {} },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: 'node' },
    document: {
      readyState: 'complete',
      hidden: false,
      createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
      getElementById: () => makeCanvas(),
      querySelector: () => null,
      addEventListener() {},
      removeEventListener() {},
      body: { appendChild() {}, classList: { add() {}, remove() {} } },
    },
  };
  sandbox.window = sandbox;
  return sandbox;
}

let lastCB = null; // the CB of the most recent load(); recorder() falls back to it

// load(files, { returnSandbox, allowRandom, localStorage }): `localStorage` replaces the sandbox's empty storage stub.
function load(files, opts) {
  const o = opts || {};
  const list = files || scriptList();
  const sandbox = makeSandbox();
  if (o.localStorage) sandbox.localStorage = o.localStorage;
  vm.createContext(sandbox);
  if (!o.allowRandom) {
    vm.runInContext(
      'Math.random = function () { throw new Error("Math.random() is not allowed in game logic; use world.rng / world.fxRng"); };',
      sandbox
    );
  }
  for (const f of list) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  lastCB = sandbox.CB;
  if (o.returnSandbox) return { CB: sandbox.CB, sandbox };
  return sandbox.CB;
}

// Logic never needs the font, so it is not part of CORE (render tests load it explicitly).
const CORE = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js'];
const GAME_BASE = [...CORE, 'src/game/world.js', 'src/game/projectiles.js', 'src/game/patches.js', 'src/game/player.js', 'src/game/fx.js'];

function loadWith(...extra) {
  return load([...GAME_BASE, ...extra]);
}

function makeInput(over) {
  return Object.assign(
    { moveX: 0, moveY: 0, aimX: 160, aimY: 40, fire: false, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] },
    over || {}
  );
}

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

// Steps a world n fixed ticks. `input` may be an object or a function(i) → object.
function stepN(world, n, input) {
  for (let i = 0; i < n; i++) {
    const inp = typeof input === 'function' ? input(i) : input || makeInput();
    world.step(1 / 60, inp);
  }
}

// ---- Web Audio fake -----------------------------------------------------------------------------------------------------------

// A minimal AudioContext for audio and music tests. Nodes are inert; what matters is what the code under test asked for.
//   ctx.currentTime            writable clock (starts at 0)
//   ctx.destination            connect target
//   ctx.starts                 [{ kind: 'oscillator' | 'bufferSource', time, node, frequency?, type? }] for every start(t);
//                              start() with no time records ctx.currentTime
//   ctx.oscillators / .bufferSources / .gains / .filters   every node created, in order
//   param.value                reads the latest write; param.values lists every written number in order;
//                              param.events lists { kind: 'value' | 'set' | 'linear' | 'exp' | 'target' | 'cancel', value, time, timeConstant }
//   ctx.install(sandbox)       defines AudioContext and webkitAudioContext on the sandbox, so `new AudioContext()` returns ctx
// Ramps jump straight to their target value: tests assert what was scheduled, not what a real clock would have produced.
function fakeAudioContext() {
  const ctx = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    destination: { kind: 'destination', connections: [], connect() {}, disconnect() {} },
    starts: [],
    oscillators: [],
    bufferSources: [],
    gains: [],
    filters: [],
    resumed: 0,
  };

  function param(initial) {
    let current = initial;
    const p = { values: [], events: [] };
    const write = (kind, value, time, timeConstant) => {
      current = value;
      p.values.push(value);
      p.events.push({ kind, value, time, timeConstant });
      return p;
    };
    Object.defineProperty(p, 'value', { get: () => current, set: (v) => { write('value', v, ctx.currentTime); }, enumerable: true });
    p.setValueAtTime = (v, t) => write('set', v, t);
    p.linearRampToValueAtTime = (v, t) => write('linear', v, t);
    p.exponentialRampToValueAtTime = (v, t) => write('exp', v, t);
    p.setTargetAtTime = (v, t, tc) => write('target', v, t, tc);
    p.cancelScheduledValues = (t) => {
      p.events.push({ kind: 'cancel', time: t });
      return p;
    };
    p.cancelAndHoldAtTime = p.cancelScheduledValues;
    return p;
  }

  function node(kind, extra) {
    const n = {
      kind,
      connections: [],
      connect(dest) {
        n.connections.push(dest);
        return dest;
      },
      disconnect() {
        n.connections.length = 0;
      },
    };
    return Object.assign(n, extra);
  }

  function startable(n, startKind, list) {
    n.startTime = null;
    n.stopTime = null;
    n.start = (t) => {
      n.startTime = t == null ? ctx.currentTime : t;
      const rec = { kind: startKind, time: n.startTime, node: n };
      if (startKind === 'oscillator') {
        rec.frequency = n.frequency.value;
        rec.type = n.type;
      }
      ctx.starts.push(rec);
    };
    n.stop = (t) => {
      n.stopTime = t == null ? ctx.currentTime : t;
    };
    list.push(n);
    return n;
  }

  ctx.createGain = () => {
    const g = node('gain', { gain: param(1) });
    ctx.gains.push(g);
    return g;
  };
  ctx.createOscillator = () => startable(node('oscillator', { type: 'sine', frequency: param(440), detune: param(0), onended: null }), 'oscillator', ctx.oscillators);
  ctx.createBufferSource = () => startable(node('bufferSource', { buffer: null, loop: false, playbackRate: param(1) }), 'bufferSource', ctx.bufferSources);
  ctx.createBiquadFilter = () => {
    const f = node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) });
    ctx.filters.push(f);
    return f;
  };
  ctx.createBuffer = (channels, length, sampleRate) => {
    const data = [];
    for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c) => data[c] };
  };
  ctx.resume = () => {
    ctx.resumed++;
    ctx.state = 'running';
    return Promise.resolve();
  };
  ctx.suspend = () => {
    ctx.state = 'suspended';
    return Promise.resolve();
  };
  ctx.close = () => {
    ctx.state = 'closed';
    return Promise.resolve();
  };
  ctx.install = (sandbox) => {
    const Ctor = function () {
      return ctx;
    };
    sandbox.AudioContext = Ctor;
    sandbox.webkitAudioContext = Ctor;
    return ctx;
  };
  return ctx;
}

// ---- layout recorder ----------------------------------------------------------------------------------------------------------

// Wraps r.text and r.sprite (calling through to the originals when there are any) and records the pixel box each draw covers:
//   { kind: 'text', str, x, y, w, h }      x is the left edge after alignment, y the top of the glyph cell, w = CB.Font.measure(str, scale)
//   { kind: 'sprite', name, x, y, w, h }   x, y the top-left corner of the sprite (r.sprite takes the centre), w, h from the sprite def x scale
// The recorder is the array of boxes (rec.boxes === rec) plus: texts(), sprites(), outside(w = 320, h = 180) → boxes not fully on
// screen, overlaps() → [[a, b], ...] text boxes that share area, clear(), restore().
// `CB` is where Font and Art come from: pass it, or it is the CB of the most recent load(). Empty strings draw nothing and are skipped.
function recorder(r, CBopt) {
  const rec = [];
  const getCB = () => CBopt || r.CB || lastCB;
  const origText = r.text;
  const origSprite = r.sprite;
  r.text = function (str, x, y, o) {
    const s = String(str);
    if (s) {
      const CB = getCB();
      const sc = (o && o.scale) || 1;
      const w = CB && CB.Font && CB.Font.measure ? CB.Font.measure(s, sc) : s.length * 6 * sc;
      const h = (CB && CB.Font && CB.Font.CELL_H ? CB.Font.CELL_H : 7) * sc;
      let bx = x;
      if (o && o.align === 'center') bx = x - w / 2;
      else if (o && o.align === 'right') bx = x - w;
      rec.push({ kind: 'text', str: s, x: Math.round(bx), y: Math.round(y), w, h });
    }
    return origText ? origText.apply(this, arguments) : undefined;
  };
  r.sprite = function (name, cx, cy, o) {
    const CB = getCB();
    const def = CB && CB.Art && CB.Art.spriteDef ? CB.Art.spriteDef(name) : null;
    const sc = (o && o.scale) || 1;
    const w = (def ? def.w : 0) * sc;
    const h = (def ? def.h : 0) * sc;
    rec.push({ kind: 'sprite', name, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h });
    return origSprite ? origSprite.apply(this, arguments) : undefined;
  };
  rec.boxes = rec;
  rec.texts = () => rec.filter((b) => b.kind === 'text');
  rec.sprites = () => rec.filter((b) => b.kind === 'sprite');
  rec.outside = (W, Hh) => rec.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > (W || 320) || b.y + b.h > (Hh || 180));
  rec.overlaps = () => {
    const t = rec.texts();
    const out = [];
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const a = t[i];
        const b = t[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push([a, b]);
      }
    }
    return out;
  };
  rec.clear = () => {
    rec.length = 0;
  };
  rec.restore = () => {
    r.text = origText;
    r.sprite = origSprite;
  };
  return rec;
}

module.exports = { ROOT, scriptList, load, loadWith, CORE, GAME_BASE, makeInput, plain, stepN, fakeAudioContext, recorder };
