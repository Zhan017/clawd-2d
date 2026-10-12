'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/stages.js', 'src/game/unlocks.js'];

function load(storage) {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  if (storage === 'throw') Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('blocked'); } });
  return CB;
}

test('save: works with a throwing localStorage via the memory fallback', () => {
  const CB = load('throw');
  CB.Save.set('x', { a: 1 });
  assert.equal(CB.Save.get('x').a, 1);
  assert.equal(CB.Unlocks.unlock('crown'), true);
  assert.equal(CB.Unlocks.unlock('crown'), false);
  assert.equal(CB.Unlocks.has('crown'), true);
});

test('unlocks: bossDie in stage i gives that boss hat; victory gives crown and modes (+ sudo in YOLO)', () => {
  const CB = load();
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: 1 })), ['slime']);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: 1 })), []);
  const v = H.plain(CB.Unlocks.onEvents([{ type: 'victory' }], { stageIndex: 3, yolo: true }));
  assert.ok(v.includes('crown') && v.includes('modes') && v.includes('sudo'));
});

test('unlocks: hat cycling goes through none and the unlocked hats in order', () => {
  const CB = load();
  CB.Unlocks.unlock('shades');
  CB.Unlocks.unlock('loopcap');
  assert.equal(CB.Unlocks.hat(), null);
  assert.equal(CB.Unlocks.cycleHat(1), 'loopcap');
  assert.equal(CB.Unlocks.cycleHat(1), 'shades');
  assert.equal(CB.Unlocks.cycleHat(1), null);
  assert.equal(CB.Unlocks.cycleHat(-1), 'shades');
});

test('secrets: konami and ultrathink fire once on completion, even mid-stream', () => {
  const CB = load();
  const m = CB.Secrets.create();
  let hits = [];
  for (const c of ['KeyX', ...CB.Secrets.CODES.konami]) { const r = m.feed(c); if (r) hits.push(r); }
  assert.deepEqual(hits, ['konami']);
  hits = [];
  for (const c of ['KeyQ', 'KeyU', ...CB.Secrets.CODES.ultrathink]) { const r = m.feed(c); if (r) hits.push(r); }
  assert.deepEqual(hits, ['ultrathink']);
  assert.equal(m.feed('KeyA'), null);
});

// ---- Extra coverage (not in the plan's test block): storage, validation, rainbow bolts and the play-scene toast ----

function fakeStorage(init) {
  const data = Object.assign({}, init);
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

function loadWithStorage(init) {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const ls = fakeStorage(init);
  sandbox.localStorage = ls;
  return { CB, ls };
}

test('save: writes JSON under cb.<key>, reads it back in a fresh session, and survives corrupt text', () => {
  const a = loadWithStorage();
  a.CB.Save.set('hat', 'crown');
  assert.equal(a.ls.data['cb.hat'], '"crown"');
  const b = loadWithStorage(a.ls.data);
  assert.equal(b.CB.Save.get('hat', null), 'crown');
  assert.equal(b.CB.Save.get('missing', 7), 7);
  const c = loadWithStorage({ 'cb.unlocks': '{not json' });
  assert.equal(c.CB.Save.get('unlocks', 'dflt'), 'dflt');
  assert.deepEqual(H.plain(c.CB.Unlocks.list()), [], 'corrupt storage is an empty list, not a crash');
  const d = loadWithStorage({ 'cb.unlocks': '{"a":1}' });
  assert.deepEqual(H.plain(d.CB.Unlocks.list()), [], 'wrong shape is an empty list');
});

test('save: a value set this session wins over storage, even when setItem throws', () => {
  const { CB, ls } = loadWithStorage({ 'cb.x': '1' });
  ls.setItem = () => { throw new Error('quota'); };
  CB.Save.set('x', 2);
  assert.equal(CB.Save.get('x'), 2);
});

// In node:vm the plan's throwing `localStorage` getter reads back as undefined (the exception is swallowed), so the first
// test above covers "storage missing". These cover storage whose methods throw, which is what a blocked browser does.
test('save: getItem and setItem that throw fall back to memory', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  sandbox.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal(CB.Save.get('x', 'dflt'), 'dflt');
  CB.Save.set('x', [1, 2]);
  assert.deepEqual(H.plain(CB.Save.get('x')), [1, 2]);
  assert.equal(CB.Unlocks.unlock('halo'), true);
  assert.equal(CB.Unlocks.unlock('halo'), false);
  assert.deepEqual(H.plain(CB.Unlocks.hats()), ['halo']);
});

test('unlocks: persist across sessions; the worn hat must still be unlocked', () => {
  const a = loadWithStorage();
  a.CB.Unlocks.unlock('crown');
  a.CB.Unlocks.unlock('modes');
  a.CB.Unlocks.setHat('crown');
  const b = loadWithStorage(a.ls.data);
  assert.deepEqual(H.plain(b.CB.Unlocks.list()), ['crown', 'modes']);
  assert.deepEqual(H.plain(b.CB.Unlocks.hats()), ['crown'], 'modes is a flag, not a hat');
  assert.equal(b.CB.Unlocks.hat(), 'crown');
  b.CB.Unlocks.setHat('halo');
  assert.equal(b.CB.Unlocks.hat(), 'crown', 'a locked hat cannot be worn');
  b.CB.Unlocks.setHat(null);
  assert.equal(b.CB.Unlocks.hat(), null);
  const c = loadWithStorage({ 'cb.hat': '"halo"' });
  assert.equal(c.CB.Unlocks.hat(), null, 'a tampered hat id is ignored');
  assert.equal(c.CB.Unlocks.cycleHat(1), null, 'no hats: cycling stays on none');
});

test('unlocks: every boss earns its own hat; no stage or run earns nothing; plain victory has no sudo', () => {
  const CB = load();
  const got = [0, 1, 2, 3].map((i) => H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: i }))[0]);
  assert.deepEqual(got, ['loopcap', 'slime', 'branch', 'shades']);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: 9 })), []);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], null)), []);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents(null, { stageIndex: 0 })), []);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'hit' }, null, { type: 'enemyDie' }], { stageIndex: 0 })), []);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'victory' }], { stageIndex: 3 })), ['crown', 'modes']);
  assert.equal(CB.Unlocks.has('sudo'), false);
});

test('secrets: a wrong key breaks the sequence, a match resets it, and the same code can be typed again', () => {
  const CB = load();
  const m = CB.Secrets.create();
  const konami = CB.Secrets.CODES.konami;
  const run = (codes) => codes.map((c) => m.feed(c)).filter(Boolean);
  assert.deepEqual(run([...konami.slice(0, 9), 'KeyX', 'KeyA']), []);
  assert.deepEqual(run(konami), ['konami']);
  assert.deepEqual(run(konami), ['konami'], 'typed twice, fires twice');
  assert.deepEqual(run(konami.slice(0, 9)), []);
  assert.deepEqual(run(konami.slice(9)), ['konami'], 'resumes where it left off');
  CB.Secrets.CODES.aa = ['KeyA', 'KeyA']; // a self-overlapping code: the buffer reset is what keeps it to one hit per completion
  assert.deepEqual(run(['KeyA', 'KeyA', 'KeyA']), ['aa']);
  assert.deepEqual(run(['KeyA']), ['aa']);
});

test('projectiles: rainbow bolts are cycling discs with a white core; otherwise the sprite', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const calls = [];
  const r = {
    sprite: (name, x, y) => calls.push(['sprite', name, x, y]),
    disc: (x, y, rad, c) => calls.push(['disc', x, y, rad, c]),
    rect: (x, y, w, h, c) => calls.push(['rect', x, y, w, h, c]),
  };
  const w = { pBullets: [{ x: 50, y: 60, r: 2, t: 0 }, { x: 70, y: 80, r: 3, t: 0.1 }], eBullets: [] };
  CB.Projectiles.draw(w, r);
  assert.deepEqual(calls.map((c) => c[0] + ':' + c[1]), ['sprite:bolt', 'sprite:bolt_big']);
  calls.length = 0;
  CB.Unlocks.unlock('rainbow');
  CB.Projectiles.draw(w, r);
  const C = CB.Pal.C;
  assert.deepEqual(H.plain(calls), [
    ['disc', 50, 60, 2, C.red], ['rect', 50, 60, 1, 1, C.white],
    ['disc', 70, 80, 3, C.yellow], ['rect', 70, 80, 1, 1, C.white],
  ]);
  calls.length = 0;
  w.pBullets = [{ x: 1, y: 1, r: 2, t: 0.05 }, { x: 1, y: 1, r: 2, t: 0.15 }, { x: 1, y: 1, r: 2, t: 0.3 }];
  CB.Projectiles.draw(w, r);
  assert.deepEqual(calls.filter((c) => c[0] === 'disc').map((c) => c[4]), [C.ember, C.green, C.red], 'floor(t * 20) % 6 walks red, ember, yellow, green, cyan, purple');
  assert.ok(sandbox, 'loaded');
});

function playSetup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/game/unlocks.js', 'src/scenes/play.js', 'src/main.js');
  const heard = [];
  CB.Audio = { play() {}, handleEvents: (evs) => heard.push(...H.plain(evs).map((e) => e.type)), init() {}, toggleMute() {} };
  CB.Screens.patchPick = { cardAt: () => -1, draw() {} };
  CB.Bosses = CB.Bosses || {};
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    if (!CB.Enemies[k]) CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const game = { debug: { speed: 1 }, input: { peekAim: () => ({ x: 0, y: 0 }) }, go() {} };
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1, skipWaves: true } });
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  return { CB, play, heard };
}

test('play: beating a boss unlocks its hat, raises the toast once, and chimes once', () => {
  const { CB, play, heard } = playSetup();
  assert.equal(play.toast, null);
  let i = 0;
  while (!play.toast && i++ < 1200) play.update(CB.DT, H.makeInput());
  assert.ok(play.toast, 'toast raised');
  assert.equal(play.toast.text, 'NEW HAT: Loop cap');
  assert.ok(play.toast.t > 2.4 && play.toast.t <= 2.5);
  assert.equal(CB.Unlocks.has('loopcap'), true);
  assert.equal(heard.filter((t) => t === 'unlock').length, 1);
  assert.ok(heard.indexOf('bossDie') >= 0 && heard.indexOf('bossDie') < heard.indexOf('unlock'), 'the unlock chime follows the event that earned it');
  for (let k = 0; k < 20; k++) play.update(CB.DT, H.makeInput());
  assert.equal(heard.filter((t) => t === 'unlock').length, 1, 'no repeat chime');
});

test('play: the toast decays with dt, freezes while paused, and leaving the run clears it', () => {
  const { CB, play } = playSetup();
  play.toast = { text: 'NEW HAT: Test', t: 1 };
  play.update(CB.DT, H.makeInput());
  assert.ok(Math.abs(play.toast.t - (1 - CB.DT)) < 1e-9);
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, true);
  const t0 = play.toast.t;
  for (let k = 0; k < 30; k++) play.update(CB.DT, H.makeInput());
  assert.equal(play.toast.t, t0, 'frozen while paused');
  play.update(CB.DT, H.makeInput({ pause: true }));
  for (let k = 0; k < 70; k++) play.update(CB.DT, H.makeInput());
  assert.equal(play.toast, null, 'expired');
  play.toast = { text: 'x', t: 1 };
  play.enter(play.game, { runOpts: { seed: 2 } });
  assert.equal(play.toast, null, 'a new run starts without the old toast');
});

test('play: with a stubbed Unlocks (or none) the scene still runs; non-hat unlocks chime without a toast', () => {
  const { CB, play, heard } = playSetup();
  CB.Unlocks = { onEvents: () => ['modes'] };
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput()));
  assert.equal(play.toast, null, 'modes is not a hat');
  assert.ok(heard.includes('unlock'));
  CB.HATS = undefined;
  CB.Unlocks = { onEvents: () => ['slime'] };
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput()));
  CB.Unlocks = undefined;
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput()));
});

test('play.draw: the toast is gold text on a dark band at y 168, fading out; absent when there is no toast', () => {
  const { CB, play } = playSetup();
  CB.WorldDraw = { draw() {} };
  CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) CB.Screens[k] = { draw() {} };
  const log = [];
  const r = {
    clear() {}, shaken: (dx, dy, fn) => fn(),
    alpha: (a, fn) => { log.push(['alpha', a]); fn(); },
    rect: (x, y, w, h, c) => log.push(['rect', x, y, w, h, c]),
    text: (s, x, y, o) => log.push(['text', s, x, y, o.color, o.align]),
  };
  play.draw(r, 0);
  assert.equal(log.length, 0, 'nothing drawn without a toast');
  play.toast = { text: 'NEW HAT: Crown', t: 2 };
  play.draw(r, 0);
  const text = log.find((l) => l[0] === 'text');
  assert.deepEqual(H.plain(text), ['text', 'NEW HAT: Crown', CB.W / 2, 168, CB.Pal.C.gold, 'center']);
  const band = log.find((l) => l[0] === 'rect');
  assert.equal(band[2] <= 168 && band[2] + band[4] >= 168 + 7, true, 'the band covers the 7 px glyph row');
  assert.equal(band[3], CB.W);
  assert.equal(log.filter((l) => l[0] === 'alpha').every((l) => l[1] === 1 || l[1] === 0.85), true, 'fully opaque while fresh');
  log.length = 0;
  play.toast.t = 0.2;
  play.draw(r, 0);
  assert.ok(log.find((l) => l[0] === 'alpha')[1] < 0.85, 'fading near the end');
});
