'use strict';
// Loads game scripts into a node:vm sandbox with DOM/canvas stubs.
// Objects returned from the sandbox come from another realm: compare them
// with assert.deepEqual or plain(), never assert.deepStrictEqual.
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

function makeSandbox() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
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

function load(files, opts) {
  const o = opts || {};
  const list = files || scriptList();
  const sandbox = makeSandbox();
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

module.exports = { ROOT, scriptList, load, loadWith, CORE, GAME_BASE, makeInput, plain, stepN };
