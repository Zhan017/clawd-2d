'use strict';
// Runs the real src/main.js inside the vm sandbox (CB_NO_BOOT off) against stub DOM, audio and scenes,
// so crash handling, debug-hash gating, the hot snapshot and the loop wiring are tested end to end.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');

const LIBS = [
  'src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js', 'src/art/render.js',
  'src/core/prompts.js', 'src/core/gamepad.js', 'src/core/touch.js', 'src/core/input.js', 'src/core/loop.js',
  'src/game/world.js', 'src/game/projectiles.js', 'src/game/patches.js', 'src/game/player.js', 'src/game/fx.js',
  'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/scenes/play.js',
];
const MAIN = fs.readFileSync(path.join(H.ROOT, 'src/main.js'), 'utf8');

function bootEnv(o) {
  const opt = o || {};
  const { CB, sandbox } = H.load(LIBS, { returnSandbox: true });
  delete sandbox.CB_NO_BOOT;
  const SErr = vm.runInContext('Error', sandbox); // errors must come from the sandbox realm to pass `instanceof Error`

  const order = [];
  const warns = [];
  const errs = [];
  const appended = [];
  const winOn = {};
  const canvasOn = {};
  const calls = [];
  const env = { CB, sandbox, SErr, order, warns, errs, appended, winOn, canvasOn, calls, reloads: 0, focused: 0, nowMs: 0, rafCb: null };

  sandbox.addEventListener = (type, fn) => {
    (winOn[type] = winOn[type] || []).push(fn);
    order.push('win:' + type);
  };
  sandbox.console = { log() {}, info() {}, warn: (...a) => warns.push(a), error: (...a) => errs.push(a) };
  sandbox.performance = { now: () => env.nowMs };
  sandbox.requestAnimationFrame = (f) => {
    env.rafCb = f;
    return 1;
  };
  sandbox.location = Object.assign({ protocol: 'http:', hostname: 'localhost', hash: '', reload() { env.reloads++; } }, opt.loc || {});
  if (opt.claude) sandbox.claude = opt.claude;
  if (opt.coarse) sandbox.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' }); // a phone: coarse pointer, no fine one

  const ctx = new Proxy({ canvas: null, imageSmoothingEnabled: false, globalAlpha: 1 }, {
    get: (t, p) => (p in t ? t[p] : (...a) => { calls.push([String(p), ...a]); }),
    set: (t, p, v) => { t[p] = v; return true; },
  });
  const canvas = {
    width: 300,
    height: 150,
    style: {},
    focus() { env.focused++; },
    addEventListener: (type, fn) => { (canvasOn[type] = canvasOn[type] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    getContext: () => ctx,
  };
  env.canvas = canvas;
  const doc = sandbox.document;
  doc.getElementById = () => canvas;
  doc.addEventListener = () => {};
  doc.body = { appendChild: (el) => appended.push(el), classList: { add() {}, remove() {} } };

  const probe = { toggles: 0, inputs: [], draws: 0, panic: [], panicThrows: false, updateThrows: null, musicToggles: 0, inits: 0, notes: [], blurs: 0 };
  env.probe = probe;
  CB.Audio = { init() { probe.inits++; }, toggleMute() { probe.toggles++; }, play() {}, handleEvents() {} };
  CB.Music = { toggle() { probe.musicToggles++; } };
  CB.Scenes.title = {
    enter() { order.push('title.enter'); },
    update(dt, inp) {
      probe.inputs.push(inp);
      if (probe.updateThrows) throw probe.updateThrows;
    },
    draw() { order.push('draw'); probe.draws++; },
    onBlur() { probe.blurs++; },
    notify(text) { probe.notes.push(text); },
  };
  CB.Screens.panic = {
    draw(r, e) {
      if (probe.panicThrows) throw new SErr('panic screen failed too');
      probe.panic.push(e);
    },
  };
  const realCreate = CB.createRenderer;
  CB.createRenderer = (c, w) => {
    order.push('createRenderer');
    if (opt.rendererThrows) throw new SErr('no 2d context');
    const r = realCreate(c, w);
    const realResize = r.resize;
    r.resize = () => {
      order.push('resize');
      return realResize();
    };
    env.r = r;
    return r;
  };

  env.fire = (type, ev) => (winOn[type] || []).slice().forEach((fn) => fn(ev));
  env.fireCanvas = (type, ev) => (canvasOn[type] || []).slice().forEach((fn) => fn(ev));
  env.runMain = () => vm.runInContext(MAIN, sandbox, { filename: 'src/main.js' });
  env.frame = (ms) => {
    env.nowMs += ms;
    env.rafCb();
  };
  env.err = (msg) => new SErr(msg);
  return env;
}

test('boot: the crash handlers go in before the renderer is touched; a boot failure shows an escaped <pre>', () => {
  const env = bootEnv({ rendererThrows: true });
  let thrown = null;
  try {
    env.runMain();
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'createRenderer failed, so boot threw');
  assert.ok(env.order.indexOf('win:error') >= 0 && env.order.indexOf('win:unhandledrejection') >= 0);
  assert.ok(env.order.indexOf('win:error') < env.order.indexOf('createRenderer'), 'error handler is first');
  assert.ok(env.order.indexOf('win:unhandledrejection') < env.order.indexOf('createRenderer'));
  assert.equal(env.order[0], 'win:error', 'nothing runs before the handlers are installed');
  // The browser would now raise a window 'error' event for the uncaught exception.
  env.fire('error', { error: env.err('bad <b>html</b> & "quotes"'), message: 'x' });
  assert.equal(env.appended.length, 1, 'no renderer, so the message goes into the page');
  const pre = env.appended[0];
  assert.ok(pre.innerHTML.includes('KERNEL PANIC'));
  assert.ok(pre.innerHTML.includes('bad &lt;b&gt;html&lt;/b&gt; &amp; &quot;quotes&quot;'), pre.innerHTML);
  assert.ok(!pre.innerHTML.includes('<b>'), 'message is HTML-escaped');
  assert.ok(pre.innerHTML.includes('Press R to reload'));
  assert.match(pre.style.cssText, /position:fixed/);
  env.fire('keydown', { code: 'KeyX' });
  assert.equal(env.reloads, 0);
  env.fire('keydown', { code: 'KeyR' });
  assert.equal(env.reloads, 1);
  assert.equal(env.probe.panic.length, 0, 'no renderer, no panic screen');
});

test('boot: an error event without an Error object and unhandled rejections only warn', () => {
  const env = bootEnv();
  env.runMain();
  env.fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.', error: null });
  env.fire('error', { message: 'Script error.', error: 'just a string' });
  env.fire('unhandledrejection', { reason: env.err('a promise went wrong') });
  env.fire('unhandledrejection', { reason: 'plain reason' });
  assert.equal(env.warns.length, 4);
  assert.equal(env.probe.panic.length, 0);
  assert.equal(env.canvas.style.cursor, undefined);
  env.frame(20);
  assert.equal(env.probe.draws, 1, 'the loop keeps running');
  assert.equal(env.errs.length, 0);
});

test('boot: a fatal error paints the panic screen once, frees the cursor, stops the loop, repaints on resize, reloads on R or click', () => {
  const env = bootEnv();
  env.runMain();
  env.frame(20);
  assert.equal(env.probe.draws, 1);
  const presents = () => env.calls.filter((c) => c[0] === 'drawImage').length;
  const p0 = presents();
  const boom = env.err('boom');
  env.fire('error', { error: boom, message: 'boom' });
  assert.equal(env.probe.panic.length, 1);
  assert.equal(env.probe.panic[0], boom);
  assert.equal(env.canvas.style.cursor, 'auto');
  assert.ok(presents() > p0, 'the panic frame was presented');
  assert.equal(env.errs.length, 1, 'logged once');
  env.frame(20);
  assert.equal(env.probe.draws, 1, 'the game loop is stopped');
  env.fire('error', { error: env.err('second'), message: 'second' });
  assert.equal(env.probe.panic.length, 1, 'only the first crash is shown');
  env.fire('resize', {});
  assert.equal(env.probe.panic.length, 2, 'repainted on resize');
  assert.equal(env.probe.panic[1], boom);
  env.fire('keydown', { code: 'KeyW' });
  assert.equal(env.reloads, 0);
  env.fire('keydown', { code: 'KeyR' });
  assert.equal(env.reloads, 1);
  env.fireCanvas('mousedown', { button: 0, clientX: 5, clientY: 5 });
  assert.equal(env.reloads, 2, 'clicking the canvas reloads too');
});

test('boot: an exception inside the game loop becomes the panic screen', () => {
  const env = bootEnv();
  env.runMain();
  env.probe.updateThrows = env.err('update blew up');
  env.frame(20);
  assert.equal(env.probe.panic.length, 1);
  assert.equal(env.probe.panic[0].message, 'update blew up');
  assert.equal(env.canvas.style.cursor, 'auto');
});

test('boot: if the panic screen itself fails, the plain fillText fallback is painted', () => {
  const env = bootEnv();
  env.runMain();
  env.probe.panicThrows = true;
  env.fire('error', { error: env.err('original failure'), message: 'x' });
  const texts = env.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('KERNEL PANIC'), JSON.stringify(texts));
  assert.ok(texts.some((t) => t.includes('original failure')));
  assert.ok(texts.includes('Press R to reload'));
  assert.equal(env.appended.length, 0, 'the canvas fallback worked, so no <pre>');
  env.fire('keydown', { code: 'KeyR' });
  assert.equal(env.reloads, 1);
});

test('boot: debug hashes work on local hosts only', () => {
  const hash = '#stage=3&god';
  for (const loc of [
    { protocol: 'http:', hostname: 'localhost' },
    { protocol: 'http:', hostname: '127.0.0.1' },
    { protocol: 'http:', hostname: '[::1]' },
    { protocol: 'file:', hostname: '' },
  ]) {
    const env = bootEnv({ loc: Object.assign({ hash }, loc) });
    env.runMain();
    assert.equal(env.CB.game.sceneName, 'play', JSON.stringify(loc));
    assert.equal(env.CB.game.scene.run.stageIndex, 2);
    assert.equal(env.CB.game.scene.run.god, true);
  }
  for (const loc of [
    { protocol: 'https:', hostname: 'claude.ai' },
    { protocol: 'https:', hostname: 'localhost.evil.example' },
    { protocol: 'https:', hostname: '127.0.0.1.evil.example' },
    { protocol: 'https:', hostname: 'evil-localhost' },
  ]) {
    const env = bootEnv({ loc: Object.assign({ hash }, loc) });
    env.runMain();
    assert.equal(env.CB.game.sceneName, 'title', JSON.stringify(loc));
    assert.equal(env.CB.game.debug.active, false);
  }
});

test('boot: every render starts with r.resize(); the loop update keeps M for mute and leaves N to the play scene', () => {
  const env = bootEnv();
  env.runMain();
  const n0 = env.order.length;
  env.frame(20);
  const tail = env.order.slice(n0);
  assert.deepEqual(tail.filter((x) => x === 'resize' || x === 'draw'), ['resize', 'draw'], 'resize comes right before draw');
  env.fire('keydown', { code: 'KeyM' });
  env.fire('keydown', { code: 'KeyN' });
  env.fire('keydown', { code: 'KeyE' });
  env.frame(20);
  assert.equal(env.probe.toggles, 1, 'M toggles mute');
  assert.equal(env.probe.musicToggles, 0, 'main.js does not toggle music; play.js does');
  const last = env.probe.inputs[env.probe.inputs.length - 1];
  assert.equal(last.music, true);
  assert.equal(last.compact, true);
  assert.deepEqual(H.plain(last.keys), ['KeyM', 'KeyN', 'KeyE']);
});

test('boot: CB.debug exposes game, run and scene', () => {
  const env = bootEnv();
  env.runMain();
  const { CB } = env;
  assert.equal(CB.debug.game, CB.game);
  assert.equal(CB.debug.scene, CB.Scenes.title);
  assert.ok(!CB.debug.run);
  CB.game.go('play', { runOpts: { seed: 1 } });
  assert.equal(CB.debug.scene, CB.Scenes.play);
  assert.equal(CB.debug.run, CB.Scenes.play.run);
});

test('hot snapshot: registered at load; returns {} unless the run is in a combat state or dying', () => {
  let snap = null;
  const env = bootEnv({ claude: { hot: { snapshot: (fn) => { snap = fn; }, data: {} } } });
  assert.equal(snap, null, 'nothing registered until main.js runs');
  env.runMain();
  assert.equal(typeof snap, 'function');
  const { CB } = env;
  assert.deepEqual(H.plain(snap()), {}, 'title screen');
  CB.game.go('play', { runOpts: { startStage: 2, patches: { spread: 1 } } });
  const run = CB.Scenes.play.run;
  run.deaths = 2;
  run.time = 33;
  run.history.push('spread');
  for (const state of ['stageIntro', 'wave', 'waveBreak', 'bossWarn', 'boss', 'dying']) {
    run.state = state;
    const s = H.plain(snap());
    assert.equal(s.stageIndex, 2, state);
    assert.deepEqual(s.patches, { spread: 1 });
    assert.equal(s.deaths, 2);
    assert.equal(s.time, 33);
    assert.deepEqual(s.history, ['spread']);
  }
  for (const state of ['bossDead', 'patchPick', 'dead', 'victory']) {
    run.state = state;
    assert.deepEqual(H.plain(snap()), {}, state);
  }
  run.state = 'wave';
  const copy = snap();
  copy.patches.rapid = 9;
  copy.history.push('x');
  assert.deepEqual(H.plain(run.patches), { spread: 1 }, 'the snapshot is a copy');
  assert.deepEqual(H.plain(run.history), ['spread']);
  run.history = null; // a broken run must not throw out of the snapshot callback
  assert.doesNotThrow(() => snap());
  assert.deepEqual(H.plain(snap()), {});
});

test('hot snapshot: a host whose snapshot() throws does not stop the game from booting', () => {
  const env = bootEnv({ claude: { hot: { snapshot() { throw new Error('host says no'); }, data: {} } } });
  assert.doesNotThrow(() => env.runMain());
  assert.equal(env.CB.game.sceneName, 'title');
  assert.equal(env.warns.length, 1);
});

test('hot data: resumes at the saved stage; hot.ready(start) defers the boot', () => {
  const data = { stageIndex: 2, patches: { rapid: 1 }, deaths: 3, time: 99, history: ['rapid'] };
  const env = bootEnv({ claude: { hot: { data } } });
  env.runMain();
  assert.equal(env.CB.game.sceneName, 'play');
  const run = env.CB.Scenes.play.run;
  assert.equal(run.stageIndex, 2);
  assert.equal(run.deaths, 3);
  assert.equal(run.time, 99);
  assert.deepEqual(H.plain(run.patches), { rapid: 1 });

  let startFn = null;
  const env2 = bootEnv({ claude: { hot: { ready: (fn) => { startFn = fn; } } } });
  env2.runMain();
  assert.equal(env2.CB.game, undefined, 'waiting for the host');
  startFn({ stageIndex: 1 });
  assert.equal(env2.CB.game.sceneName, 'play');
  assert.equal(env2.CB.Scenes.play.run.stageIndex, 1);
  const env3 = bootEnv({ claude: { hot: { data: {} } } });
  env3.runMain();
  assert.equal(env3.CB.game.sceneName, 'title', 'an empty snapshot means a normal start');
});

// ---- rev 3 (A3-2): the snapshot carries the modes and the stage-start tally ---------------------------------------------

test('hot snapshot: carries bossRush, yolo and the stage-start tally (a copy), so a resume keeps the run intact', () => {
  let snap = null;
  const env = bootEnv({ claude: { hot: { snapshot: (fn) => { snap = fn; }, data: {} } } });
  env.runMain();
  const { CB } = env;
  CB.game.go('play', { runOpts: { startStage: 1, bossRush: true, yolo: true } });
  const run = CB.Scenes.play.run;
  run.stageSquashed = { syntaxError: 3, nullPointer: 1 };
  run.squashed = { syntaxError: 7, nullPointer: 1, offByOne: 2 };
  run.state = 'wave';
  let s = H.plain(snap());
  assert.equal(s.bossRush, true);
  assert.equal(s.yolo, true);
  assert.deepEqual(s.squashed, { syntaxError: 3, nullPointer: 1 }, 'the tally as the stage began, not the live one');
  const raw = snap();
  raw.squashed.syntaxError = 99;
  assert.equal(run.stageSquashed.syntaxError, 3, 'the snapshot holds a copy');
  CB.game.go('play', { runOpts: { startStage: 0 } });
  CB.Scenes.play.run.state = 'boss';
  s = H.plain(snap());
  assert.equal(s.bossRush, false);
  assert.equal(s.yolo, false);
  assert.deepEqual(s.squashed, {});
});

test('hot data: a resume keeps Boss Rush, YOLO and the tally; the live and stage-start tallies are separate objects', () => {
  const data = { stageIndex: 2, patches: { rapid: 1 }, deaths: 1, time: 50, history: ['rapid'], bossRush: true, yolo: true, squashed: { syntaxError: 5, offByOne: 1 } };
  const env = bootEnv({ claude: { hot: { data } } });
  env.runMain();
  const run = env.CB.Scenes.play.run;
  assert.equal(env.CB.game.sceneName, 'play');
  assert.equal(run.bossRush, true);
  assert.equal(run.skipWaves, true);
  assert.equal(run.yolo, true);
  assert.equal(run.world.mode.yolo, true);
  assert.deepEqual(H.plain(run.squashed), { syntaxError: 5, offByOne: 1 });
  assert.deepEqual(H.plain(run.stageSquashed), { syntaxError: 5, offByOne: 1 });
  assert.notEqual(run.squashed, run.stageSquashed);
  assert.notEqual(run.squashed, data.squashed, 'the host data is not mutated by play');
  const plain = bootEnv({ claude: { hot: { data: { stageIndex: 1 } } } });
  plain.runMain();
  const r2 = plain.CB.Scenes.play.run;
  assert.equal(r2.bossRush, false);
  assert.equal(r2.yolo, false);
  assert.deepEqual(H.plain(r2.squashed), {});
});

test('hot snapshot round trip: what one session saves, the next boots into', () => {
  let snap = null;
  const a = bootEnv({ claude: { hot: { snapshot: (fn) => { snap = fn; }, data: {} } } });
  a.runMain();
  a.CB.game.go('play', { runOpts: { startStage: 3, patches: { dash: 1 }, yolo: true, bossRush: true }, restore: { deaths: 2, time: 77, history: ['dash'], squashed: { memoryLeak: 4 } } });
  a.CB.Scenes.play.run.state = 'bossWarn';
  const saved = JSON.parse(JSON.stringify(H.plain(snap())));
  const b = bootEnv({ claude: { hot: { data: saved } } });
  b.runMain();
  const run = b.CB.Scenes.play.run;
  assert.equal(run.stageIndex, 3);
  assert.equal(run.yolo, true);
  assert.equal(run.bossRush, true);
  assert.equal(run.deaths, 2);
  assert.deepEqual(H.plain(run.patches), { dash: 1 });
  assert.deepEqual(H.plain(run.squashed), { memoryLeak: 4 });
});

test('hot snapshot: carries the daily key and the seed, so a resumed daily is the same day\'s build', () => {
  let snap = null;
  const env = bootEnv({ claude: { hot: { snapshot: (fn) => { snap = fn; }, data: {} } } });
  env.runMain();
  const { CB } = env;
  CB.game.go('play', { runOpts: { startStage: 1, daily: '2026-10-13', seed: 123456789 } });
  CB.Scenes.play.run.state = 'wave';
  let s = H.plain(snap());
  assert.equal(s.daily, '2026-10-13');
  assert.equal(s.seed, 123456789);
  CB.game.go('play', { runOpts: { startStage: 1, seed: 77 } });
  CB.Scenes.play.run.state = 'wave';
  s = H.plain(snap());
  assert.equal(s.daily, null, 'a plain run has no day');
  assert.equal(s.seed, 77);
});

test('hot data: a resume keeps the daily key and the seed; a missing or malformed one is left out so the run picks its own', () => {
  const data = { stageIndex: 2, patches: { rapid: 1 }, deaths: 1, time: 50, history: ['rapid'], daily: '2026-10-13', seed: 4242 };
  const env = bootEnv({ claude: { hot: { data } } });
  env.runMain();
  const run = env.CB.Scenes.play.run;
  assert.equal(run.daily, '2026-10-13');
  assert.equal(run.seed, 4242);
  const edge = bootEnv({ claude: { hot: { data: { stageIndex: 1, seed: 0xffffffff } } } });
  edge.runMain();
  assert.equal(edge.CB.Scenes.play.run.seed, 0xffffffff, 'the top of the uint range is a seed');
  assert.equal(edge.CB.Scenes.play.run.daily, null, 'no key, a plain run');
  for (const daily of [5, '', '2026-1-3', 'tomorrow', '2026-10-13T00:00', { a: 1 }, ['2026-10-13'], null, true]) {
    const bad = bootEnv({ claude: { hot: { data: { stageIndex: 1, daily } } } });
    bad.runMain();
    assert.equal(bad.CB.game.sceneName, 'play', JSON.stringify(daily));
    assert.equal(bad.CB.Scenes.play.run.daily, null, 'not a day: ' + JSON.stringify(daily));
  }
  for (const seed of [-1, 1.5, NaN, Infinity, '7', 2 ** 32, null, {}, [7], true]) {
    const bad = bootEnv({ claude: { hot: { data: { stageIndex: 1, seed } } } });
    bad.runMain();
    const got = bad.CB.Scenes.play.run.seed;
    assert.ok(Number.isInteger(got) && got >= 0 && got <= 0xffffffff, 'a usable seed anyway: ' + String(seed));
    assert.notEqual(got, seed >>> 0, 'not the bad one coerced: ' + String(seed));
  }
});

test('hot snapshot round trip: a daily run resumes as the same daily with the same seed', () => {
  let snap = null;
  const a = bootEnv({ claude: { hot: { snapshot: (fn) => { snap = fn; }, data: {} } } });
  a.runMain();
  a.CB.game.go('play', { runOpts: { startStage: 2, daily: '2026-10-13', seed: 31337, patches: { dash: 1 } } });
  a.CB.Scenes.play.run.state = 'boss';
  const saved = JSON.parse(JSON.stringify(H.plain(snap())));
  const b = bootEnv({ claude: { hot: { data: saved } } });
  b.runMain();
  const run = b.CB.Scenes.play.run;
  assert.equal(run.daily, '2026-10-13');
  assert.equal(run.seed, 31337);
  assert.equal(run.stageIndex, 2);
  assert.deepEqual(H.plain(run.patches), { dash: 1 });
});

// ---- more ways to play: touch unlock, notify, controller events, the portrait pause, touch-aware crash text ----------------------

const lastInput = (env) => env.probe.inputs[env.probe.inputs.length - 1];

test('boot: touchend unlocks audio beside pointerdown and keydown (a touch pointerdown is not a user activation)', () => {
  const env = bootEnv();
  env.runMain();
  assert.equal(env.winOn.touchend.length, 1);
  const n = env.probe.inits;
  env.fire('pointerdown', {});
  env.fire('keydown', { code: 'KeyW' });
  assert.equal(env.probe.inits, n + 2);
  env.fire('touchend', {});
  assert.equal(env.probe.inits, n + 3);
});

test('boot: game.notify reaches the scene when it can toast, and does nothing when it cannot', () => {
  const env = bootEnv();
  env.runMain();
  const { CB } = env;
  CB.game.notify('hello');
  assert.deepEqual(env.probe.notes, ['hello']);
  delete CB.Scenes.title.notify;
  assert.doesNotThrow(() => CB.game.notify('nobody is listening'));
  CB.Scenes.title.notify = 'not a function';
  assert.doesNotThrow(() => CB.game.notify('still nobody'));
  CB.game.scene = null;
  assert.doesNotThrow(() => CB.game.notify('no scene at all'));
});

test('boot: a controller connecting unlocks audio and says so; one disconnecting says so and pauses like a window blur', () => {
  const env = bootEnv();
  env.runMain();
  env.fire('keydown', { code: 'KeyW' }); // walking
  env.frame(20);
  assert.equal(lastInput(env).moveY, -1);
  const n = env.probe.inits;
  env.fire('gamepadconnected', { gamepad: { id: 'pad' } });
  assert.equal(env.probe.inits, n + 1, 'a connect counts as the gesture it came with');
  assert.deepEqual(env.probe.notes, ['controller connected']);
  assert.equal(env.probe.blurs, 0);
  env.fire('gamepaddisconnected', { gamepad: { id: 'pad' } });
  assert.deepEqual(env.probe.notes, ['controller connected', 'controller disconnected']);
  assert.equal(env.probe.blurs, 1, 'the scene is told, so a fight pauses');
  env.frame(20);
  assert.equal(lastInput(env).moveY, 0, 'and the input was released: Clawd is not left walking');
});

test('boot: a pad plugged into the real input drives the scene, unlocks audio on its first press and switches the prompts', () => {
  const env = bootEnv();
  const pad = { id: 'x', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [] };
  for (let i = 0; i < 17; i++) pad.buttons.push({ pressed: false, touched: false, value: 0 });
  env.sandbox.navigator.getGamepads = () => [pad, null, null, null];
  env.runMain();
  const { CB } = env;
  assert.equal(CB.Prompts.text('start'), 'Click to start');
  env.frame(20);
  assert.equal(lastInput(env).device, 'kbm');
  assert.strictEqual(lastInput(env).pad.a, false);
  const n = env.probe.inits;
  pad.buttons[0] = { pressed: true, touched: true, value: 1 };
  env.frame(20);
  assert.equal(lastInput(env).device, 'pad');
  assert.equal(lastInput(env).pad.a, true);
  assert.equal(lastInput(env).confirm, true);
  assert.equal(env.probe.inits, n + 1, 'the press unlocked audio');
  assert.equal(CB.Prompts.text('start'), 'Press A to start');
  env.frame(20);
  assert.equal(lastInput(env).confirm, false, 'held: no second edge');
});

test('boot: a touch on the canvas reaches the scene as a tap on the touch device', () => {
  const env = bootEnv();
  env.runMain();
  const ev = { pointerType: 'touch', pointerId: 4, clientX: 150, clientY: 75, preventDefault() { this.prevented = true; } };
  env.fireCanvas('pointerdown', ev);
  assert.equal(ev.prevented, true);
  env.frame(20);
  assert.equal(lastInput(env).device, 'touch');
  assert.equal(lastInput(env).tap, true);
  assert.equal(lastInput(env).confirm, true);
  assert.equal(env.CB.Prompts.text('start'), 'Tap to start');
});

test('boot: in portrait on touch every resize and orientationchange pauses again; landscape, a keyboard or no touch leave it alone', () => {
  const env = bootEnv({ coarse: true });
  env.runMain();
  assert.equal(env.CB.game.input.device, 'touch', 'a phone starts on touch');
  assert.equal(env.winOn.orientationchange.length, 1);
  env.sandbox.innerWidth = 844;
  env.sandbox.innerHeight = 390;
  env.fire('resize', {});
  env.fire('orientationchange', {});
  assert.equal(env.probe.blurs, 0, 'landscape');
  env.sandbox.innerWidth = 390;
  env.sandbox.innerHeight = 844;
  const n0 = env.order.length;
  env.fire('resize', {});
  assert.equal(env.probe.blurs, 1);
  assert.ok(env.order.slice(n0).includes('resize'), 'the renderer still resizes');
  env.fire('resize', {});
  assert.equal(env.probe.blurs, 2, 'every time, so a resume under the rotate overlay is pausing again at once');
  env.fire('orientationchange', {});
  assert.equal(env.probe.blurs, 3);
  env.fire('keydown', { code: 'KeyW' });
  env.fire('resize', {});
  assert.equal(env.probe.blurs, 3, 'once the keyboard is the device a tall window is just a tall window');

  const desktop = bootEnv();
  desktop.runMain();
  desktop.sandbox.innerWidth = 390;
  desktop.sandbox.innerHeight = 844;
  desktop.fire('resize', {});
  desktop.fire('orientationchange', {});
  assert.equal(desktop.probe.blurs, 0);
});

test('boot: every scene change puts the touch input back in menu mode', () => {
  const env = bootEnv({ coarse: true });
  env.runMain();
  const { CB } = env;
  CB.game.input.setTouchMode('sticks');
  assert.equal(CB.game.input.touchView().mode, 'sticks');
  CB.game.go('title');
  assert.equal(CB.game.input.touchView().mode, 'menu', 'a title reached from a fight can be tapped');
});

test('boot: after a crash a canvas pointerdown reloads too (the touch handler swallows the compatibility mousedown)', () => {
  const env = bootEnv();
  env.runMain();
  env.fire('error', { error: env.err('boom'), message: 'boom' });
  assert.equal(env.reloads, 0);
  env.fireCanvas('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 5, clientY: 5 });
  assert.equal(env.reloads, 1);
  env.fireCanvas('mousedown', { button: 0, clientX: 5, clientY: 5 });
  assert.equal(env.reloads, 2, 'and the mouse still does');
});

test('boot: the raw crash text follows the device: "Tap to reload" on a phone, "Press R to reload" otherwise (page <pre> and canvas fallback)', () => {
  const pre = (device) => {
    const env = bootEnv({ rendererThrows: true });
    env.CB.Prompts.setDevice(device);
    assert.throws(() => env.runMain());
    env.fire('error', { error: env.err('no canvas'), message: 'x' });
    return env.appended[0].innerHTML;
  };
  assert.ok(pre('touch').includes('Tap to reload'));
  assert.ok(!pre('touch').includes('Press R'));
  assert.ok(pre('pad').includes('Press R to reload'), 'R is still the key on a pad');
  assert.ok(pre('kbm').includes('Press R to reload'));

  const fallback = (device) => {
    const env = bootEnv();
    env.runMain();
    env.CB.Prompts.setDevice(device);
    env.probe.panicThrows = true;
    env.fire('error', { error: env.err('original failure'), message: 'x' });
    return env.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  };
  assert.ok(fallback('touch').includes('Tap to reload'));
  assert.ok(fallback('kbm').includes('Press R to reload'));
});

test('boot: the crash text falls back to "Press R to reload" when CB.Prompts is not there', () => {
  const env = bootEnv({ rendererThrows: true });
  delete env.CB.Prompts;
  assert.throws(() => env.runMain());
  env.fire('error', { error: env.err('x'), message: 'x' });
  assert.ok(env.appended[0].innerHTML.includes('Press R to reload'));
  const env2 = bootEnv({ rendererThrows: true });
  env2.CB.Prompts.text = () => '';
  assert.throws(() => env2.runMain());
  env2.fire('error', { error: env2.err('x'), message: 'x' });
  assert.ok(env2.appended[0].innerHTML.includes('Press R to reload'), 'an empty string is no text');
});
