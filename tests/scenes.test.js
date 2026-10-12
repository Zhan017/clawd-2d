'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/scenes/play.js', 'src/main.js');
  CB.Audio = { play() {}, handleEvents() {}, init() {}, toggleMute() {} };
  CB.Screens.patchPick = { cardAt: () => 1, draw() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    if (!CB.Enemies[k]) CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const visits = [];
  const game = { debug: { speed: 1 }, input: { peekAim: () => ({ x: 0, y: 0 }) }, go(name, data) { visits.push([name, data]); } };
  return { CB, game, visits };
}

test('parseDebugHash: parses stage, boss, god, seed, speed, patches, hitboxes', () => {
  const { CB } = setup();
  const d = CB.parseDebugHash('#stage=3&boss&god&seed=42&speed=2&patches=spread,spread,nope,dash&hitboxes');
  assert.equal(d.startStage, 2);
  assert.equal(d.skipWaves, true);
  assert.equal(d.god, true);
  assert.equal(d.seed, 42);
  assert.equal(d.speed, 2);
  assert.deepEqual(H.plain(d.patches), { spread: 2, dash: 1 });
  assert.equal(d.hitboxes, true);
  assert.equal(d.active, true);
  assert.equal(CB.parseDebugHash('').active, false);
  assert.equal(CB.parseDebugHash('#stage=99').startStage, 3);
  assert.equal(CB.parseDebugHash('#speed=1000').speed, 8);
});

test('parseDebugHash: bare anchors are not debug hashes; malformed escapes do not throw', () => {
  const { CB } = setup();
  assert.equal(CB.parseDebugHash('#foo').active, false);
  assert.equal(CB.parseDebugHash('#top').active, false);
  assert.equal(CB.parseDebugHash('#boss').active, true);
  assert.equal(CB.parseDebugHash('#boss').skipWaves, true);
  assert.equal(CB.parseDebugHash('#stage=2').active, true);
  assert.doesNotThrow(() => CB.parseDebugHash('#100%'));
  assert.equal(CB.parseDebugHash('#100%').active, false);
  assert.doesNotThrow(() => CB.parseDebugHash('#stage=%E0%A4%A&boss'));
  assert.equal(CB.parseDebugHash('#stage=%E0%A4%A&boss').active, true);
  assert.deepEqual(H.plain(CB.parseDebugHash('#patches=constructor,toString,__proto__,dash').patches), { dash: 1 });
});

test('debugFromLocation: debug hashes apply on file:, localhost, 127.0.0.1 and [::1] only', () => {
  const { CB } = setup();
  const at = (protocol, hostname) => CB.debugFromLocation({ protocol, hostname, hash: '#stage=2&god' });
  for (const [protocol, hostname] of [['file:', ''], ['http:', 'localhost'], ['http:', '127.0.0.1'], ['http:', '[::1]']]) {
    const d = at(protocol, hostname);
    assert.equal(d.active, true, `${protocol}//${hostname}`);
    assert.equal(d.startStage, 1);
    assert.equal(d.god, true);
  }
  for (const [protocol, hostname] of [['https:', 'claude.ai'], ['https:', 'localhost.evil.example'], ['https:', '127.0.0.1.evil.example'], ['https:', 'xlocalhost'], ['https:', '']]) {
    assert.deepEqual(H.plain(at(protocol, hostname)), { active: false }, `${protocol}//${hostname}`);
  }
});

test('play: onBlur pauses in combat states and pause toggles', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  assert.equal(play.paused, false);
  play.onBlur();
  assert.equal(play.paused, true);
  const t0 = play.run.time;
  play.update(CB.DT, H.makeInput());
  assert.equal(play.run.time, t0, 'no simulation while paused');
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, false);
  play.update(CB.DT, H.makeInput());
  assert.ok(play.run.time > t0);
});

test('play: quit from pause is two-step (first Q arms for 2 s, second Q quits)', () => {
  const { CB, game, visits } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  assert.equal(play.quitArmT, 0);
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, true);
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0, 'the first Q only arms');
  assert.equal(play.quitArmT, 2.0);
  for (let i = 0; i < 30; i++) play.update(CB.DT, H.makeInput());
  assert.ok(Math.abs(play.quitArmT - 1.5) < 1e-9, `decays by dt while paused: ${play.quitArmT}`);
  assert.equal(visits.length, 0);
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 1);
  assert.equal(visits[0][0], 'title');
});

test('play: the quit arm expires after 2 s and resuming disarms it', () => {
  const { CB, game, visits } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  play.update(CB.DT, H.makeInput({ pause: true }));
  play.update(CB.DT, H.makeInput({ quit: true }));
  for (let i = 0; i < 125; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.quitArmT, 0, 'expired');
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0, 'an expired arm just re-arms');
  assert.equal(play.quitArmT, 2.0);
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, false);
  assert.equal(play.quitArmT, 0, 'resuming disarms');
  play.update(CB.DT, H.makeInput({ pause: true }));
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0, 'a fresh pause needs two Qs again');
  assert.equal(play.quitArmT, 2.0);
});

test('play: Q does nothing outside pause and the dead screen', () => {
  const { CB, game, visits } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  play.update(CB.DT, H.makeInput({ quit: true }));
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0);
  assert.equal(play.quitArmT, 0);
});

test('play: Q on the dead screen waits for the input lock', () => {
  const { CB, game, visits } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  const p = play.run.world.player;
  p.hearts = 1;
  assert.equal(play.run.world.hurtPlayer(null), true);
  for (let i = 0; i < 400 && play.run.state !== 'dead'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'dead');
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0, 'locked right after dying (a mashed Q must not skip the screen)');
  for (let i = 0; i < 30; i++) play.update(CB.DT, H.makeInput());
  assert.ok(play.run.stateT < CB.RUN_T.inputLock);
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 0);
  for (let i = 0; i < 10; i++) play.update(CB.DT, H.makeInput());
  assert.ok(play.run.stateT >= CB.RUN_T.inputLock);
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits.length, 1);
  assert.equal(visits[0][0], 'title');
});

test('play: N toggles the music (also while paused); a missing CB.Music is fine', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput({ music: true })));
  let toggles = 0;
  CB.Music = { toggle: () => { toggles++; } };
  play.update(CB.DT, H.makeInput({ music: true }));
  assert.equal(toggles, 1);
  play.update(CB.DT, H.makeInput());
  assert.equal(toggles, 1);
  play.update(CB.DT, H.makeInput({ pause: true }));
  play.update(CB.DT, H.makeInput({ music: true }));
  assert.equal(toggles, 2);
});

test('play: extra sim ticks (debug speed) never repeat edge inputs', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  game.debug.speed = 3;
  play.enter(game, { runOpts: { seed: 1 } });
  const seen = [];
  const real = play.run.step;
  play.run.step = function (inp) { seen.push(inp); return real.call(this, inp); };
  const keys = ['KeyA'];
  play.update(CB.DT, H.makeInput({ dash: true, compact: true, music: true, keys }));
  assert.equal(seen.length, 3);
  assert.equal(seen[0].dash, true);
  assert.equal(seen[0].compact, true);
  for (const i of [1, 2]) {
    assert.equal(seen[i].dash, false);
    assert.equal(seen[i].compact, false);
    assert.equal(seen[i].music, false);
    assert.deepEqual(H.plain(seen[i].keys), []);
  }
});

function drawSetup() {
  const s = setup();
  const { CB } = s;
  CB.WorldDraw = { draw() {} };
  CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) CB.Screens[k] = { draw() {} };
  const pauseArgs = [];
  CB.Screens.pause = { draw: (...a) => pauseArgs.push(a) };
  const log = [];
  const r = {
    clear: (c) => log.push(['clear', c]),
    shaken: (dx, dy, fn) => { log.push(['shaken', dx, dy]); fn(); },
    alpha: (a, fn) => { log.push(['alpha', a]); fn(); },
    rect: (x, y, w, h, c) => log.push(['rect', c]),
  };
  const play = CB.Scenes.play;
  play.enter(s.game, { runOpts: { seed: 1 } });
  return Object.assign(s, { play, r, log, pauseArgs });
}

test('play.draw: starts with a black clear, then the shaken world', () => {
  const { play, r, log } = drawSetup();
  play.draw(r, 0.5);
  assert.deepEqual(log[0], ['clear', '#000000']);
  assert.equal(log[1][0], 'shaken');
});

test('play.draw: shake and flash are live only while not paused; flash uses w.flashColor', () => {
  const { CB, play, r, log, pauseArgs } = drawSetup();
  const w = play.run.world;
  w.shake = 4;
  w.flash = 0.1;
  const t = 0.5;
  play.draw(r, t);
  const sh = log.find((l) => l[0] === 'shaken');
  assert.equal(sh[1], Math.round(Math.sin(t * 91) * 4));
  assert.equal(sh[2], Math.round(Math.cos(t * 77) * 4));
  assert.ok(sh[1] !== 0 || sh[2] !== 0, 'the test point really shakes');
  const rect = log.find((l) => l[0] === 'rect');
  assert.equal(rect[1], CB.Pal.C.hurt, 'default flash colour');
  log.length = 0;
  w.flashColor = '#123456';
  play.draw(r, t);
  assert.equal(log.find((l) => l[0] === 'rect')[1], '#123456');
  log.length = 0;
  play.paused = true;
  play.quitArmT = 1.25;
  play.draw(r, t);
  const sp = log.find((l) => l[0] === 'shaken');
  assert.equal(sp[1], 0);
  assert.equal(sp[2], 0);
  assert.equal(log.some((l) => l[0] === 'rect'), false, 'no flash while paused');
  assert.equal(pauseArgs.length, 1);
  assert.equal(pauseArgs[0][3].quitArmT, 1.25, 'the pause screen can read the arm timer');
  assert.equal(w.shake, 4, 'drawing never mutates the sim');
});

test('play: clicking a patch card picks it after the input lock', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1, skipWaves: true } });
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  for (let i = 0; i < 1200 && play.run.state !== 'patchPick'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'patchPick');
  for (let i = 0; i < 40; i++) play.update(CB.DT, H.makeInput());
  const offered = play.run.offer[1];
  play.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(play.run.history[0], offered);
});

test('play: restore data carries deaths, time and history', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { startStage: 2, patches: { rapid: 1 } }, restore: { deaths: 3, time: 99, history: ['rapid'] } });
  assert.equal(play.run.stageIndex, 2);
  assert.equal(play.run.deaths, 3);
  assert.equal(play.run.time, 99);
  assert.deepEqual(H.plain(play.run.history), ['rapid']);
});

// ---- rev 3 (A3-2): #rush / #yolo, the toast queue, restored tallies ---------------------------------------------------

test('parseDebugHash: #rush gives bossRush and #yolo gives yolo; each alone is a debug hash', () => {
  const { CB } = setup();
  const rush = CB.parseDebugHash('#rush');
  assert.equal(rush.active, true);
  assert.equal(rush.bossRush, true);
  assert.equal(rush.yolo, undefined);
  const yolo = CB.parseDebugHash('#yolo');
  assert.equal(yolo.active, true);
  assert.equal(yolo.yolo, true);
  assert.equal(yolo.bossRush, undefined);
  const both = CB.parseDebugHash('#rush&yolo&stage=2&god');
  assert.equal(both.bossRush, true);
  assert.equal(both.yolo, true);
  assert.equal(both.startStage, 1);
  const run = CB.createRun(rush);
  assert.equal(run.bossRush, true);
  assert.equal(run.skipWaves, true, 'Boss Rush skips the waves');
  assert.equal(CB.createRun(yolo).yolo, true);
  assert.equal(CB.parseDebugHash('#rushing').bossRush, undefined, 'only the exact key');
});

function toastSetup(fresh) {
  const s = setup();
  const { CB, game } = s;
  CB.HATS = [{ id: 'loopcap', name: 'Loop cap' }, { id: 'crown', name: 'Crown' }];
  const heard = [];
  CB.Audio.handleEvents = (evs) => heard.push(...H.plain(evs).map((e) => e.type));
  const cfg = { ids: [] };
  CB.Unlocks = { onEvents: () => cfg.ids.splice(0) };
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  s.play = play;
  s.heard = heard;
  s.cfg = cfg;
  void fresh;
  return s;
}
const tick = (play, CB, n, inp) => {
  for (let i = 0; i < (n || 1); i++) play.update(CB.DT, inp || H.makeInput());
};

test('play: unlock toasts form a queue; hats are 2.5 s and the modes unlock is 4 s with its own text', () => {
  const { CB, play, cfg, heard } = toastSetup();
  assert.deepEqual(H.plain(play.toasts), []);
  assert.equal(play.toast, undefined, 'the single-toast field is gone');
  cfg.ids.push('crown', 'modes');
  tick(play, CB);
  assert.equal(play.toasts.length, 2);
  assert.equal(play.toasts[0].text, 'NEW HAT: Crown');
  assert.equal(play.toasts[0].t, 2.5);
  assert.equal(play.toasts[1].text, 'UNLOCKED: boss rush + --yolo on the title');
  assert.equal(play.toasts[1].t, 4.0);
  assert.equal(heard.filter((t) => t === 'unlock').length, 1, 'one chime per step, however many unlocks');
});

test('play: only the first toast counts down; the next one starts its clock after it', () => {
  const { CB, play, cfg } = toastSetup();
  cfg.ids.push('loopcap', 'modes');
  tick(play, CB);
  tick(play, CB, 60);
  assert.ok(Math.abs(play.toasts[0].t - (2.5 - 1)) < 1e-6, `first at ${play.toasts[0].t}`);
  assert.equal(play.toasts[1].t, 4.0, 'the queued toast has not started');
  tick(play, CB, 92); // 1.5 s left of the first toast, plus a little for the accumulated float error
  assert.equal(play.toasts.length, 1, 'the first expired after 2.5 s');
  assert.equal(play.toasts[0].text.indexOf('UNLOCKED'), 0);
  assert.ok(Math.abs(play.toasts[0].t - 4.0) < 0.05);
  tick(play, CB, 60);
  assert.ok(Math.abs(play.toasts[0].t - 3.0) < 0.05);
  tick(play, CB, 200);
  assert.equal(play.toasts.length, 0);
});

test('play: the toast queue freezes while paused, a toast raised mid-queue goes to the back, and a new run clears it', () => {
  const { CB, play, cfg } = toastSetup();
  cfg.ids.push('loopcap');
  tick(play, CB);
  tick(play, CB, 30);
  tick(play, CB, 1, H.makeInput({ pause: true }));
  assert.equal(play.paused, true);
  const t0 = play.toasts[0].t;
  tick(play, CB, 30);
  assert.equal(play.toasts[0].t, t0, 'frozen while paused');
  tick(play, CB, 1, H.makeInput({ pause: true }));
  cfg.ids.push('modes');
  tick(play, CB);
  assert.deepEqual(H.plain(play.toasts.map((t) => t.text.split(':')[0])), ['NEW HAT', 'UNLOCKED']);
  play.enter(play.game, { runOpts: { seed: 2 } });
  assert.deepEqual(H.plain(play.toasts), [], 'a new run starts without the old toasts');
});

test('play: ids that are neither a hat nor modes chime without a toast', () => {
  const { CB, play, cfg, heard } = toastSetup();
  cfg.ids.push('rainbow', 'nonsense');
  tick(play, CB);
  assert.equal(play.toasts.length, 0);
  assert.equal(heard.filter((t) => t === 'unlock').length, 1);
});

test('play.draw: the toast drawn is the first in the queue, then the next once it expires', () => {
  const { CB, play, cfg } = toastSetup();
  CB.WorldDraw = { draw() {} };
  CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) CB.Screens[k] = { draw() {} };
  const texts = [];
  const r = {
    clear() {}, shaken: (dx, dy, fn) => fn(), alpha: (a, fn) => fn(), rect() {},
    text: (s) => texts.push(s),
  };
  cfg.ids.push('loopcap', 'modes');
  tick(play, CB);
  play.draw(r, 0);
  assert.deepEqual(texts, ['NEW HAT: Loop cap']);
  play.toasts[0].t = 0.001;
  tick(play, CB);
  texts.length = 0;
  play.draw(r, 0);
  assert.deepEqual(texts, ['UNLOCKED: boss rush + --yolo on the title']);
  play.toasts.length = 0;
  texts.length = 0;
  play.draw(r, 0);
  assert.deepEqual(texts, [], 'nothing drawn without a toast');
});

test('play: restore carries the stage-start tally as two separate copies, and a retry returns to it', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  const restore = { deaths: 1, time: 5, history: [], squashed: { syntaxError: 4, nullPointer: 2, junk: 'x', neg: -3, nan: NaN } };
  play.enter(game, { runOpts: { startStage: 1, bossRush: true, yolo: true }, restore });
  const run = play.run;
  assert.deepEqual(H.plain(run.squashed), { syntaxError: 4, nullPointer: 2 }, 'only finite non-negative counts survive');
  assert.deepEqual(H.plain(run.stageSquashed), { syntaxError: 4, nullPointer: 2 });
  assert.notEqual(run.squashed, run.stageSquashed, 'one object per tally, or kills would leak into the stage-start copy');
  assert.equal(run.bossRush, true);
  assert.equal(run.yolo, true);
  run.squashed.syntaxError += 3;
  assert.equal(run.stageSquashed.syntaxError, 4);
  run.world.player.hearts = 1;
  assert.equal(run.world.hurtPlayer(null), true);
  for (let i = 0; i < 400 && run.state !== 'dead'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(run.state, 'dead');
  for (let i = 0; i < 40; i++) play.update(CB.DT, H.makeInput());
  assert.equal(run.retryStage(), true);
  assert.deepEqual(H.plain(run.squashed), { syntaxError: 4, nullPointer: 2 }, 'the failed attempt does not count');
});

test('play: a restore without a tally (or with a junk one) starts from an empty tally', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  for (const squashed of [undefined, null, 'x', 7, [1, 2]]) {
    play.enter(game, { runOpts: { seed: 1 }, restore: { deaths: 0, time: 0, history: [], squashed } });
    assert.deepEqual(H.plain(play.run.squashed), {}, String(squashed));
    assert.deepEqual(H.plain(play.run.stageSquashed), {});
  }
});

// ---- rev 3 (A3-3): calm mode, the retry transition and the patch-pick celebration ---------------------------------------------

function memStorage() {
  const mem = {};
  return { mem, getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
}
// The scene set-up with the real save and Comfort modules and an in-memory storage.
function calmSetup() {
  const storage = memStorage();
  const CB = H.load([...H.GAME_BASE, 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/game/unlocks.js', 'src/game/comfort.js', 'src/scenes/play.js'], { localStorage: storage });
  CB.Audio = { play() {}, handleEvents() {}, init() {}, toggleMute() {} };
  CB.Screens.patchPick = { cardAt: () => 1, draw() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    if (!CB.Enemies[k]) CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const visits = [];
  const game = { debug: { speed: 1 }, input: { peekAim: () => ({ x: 0, y: 0 }) }, go(name, data) { visits.push([name, data]); } };
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  return { CB, game, visits, play, storage };
}
const keyV = () => H.makeInput({ keys: ['KeyV'] });

test('play: V toggles calm mode and queues a "calm mode: on/off" toast', () => {
  const { CB, play, storage } = calmSetup();
  assert.equal(CB.Comfort.calm(), false);
  play.update(CB.DT, keyV());
  assert.equal(CB.Comfort.calm(), true);
  assert.equal(storage.mem['cb.calm'], 'true', 'saved');
  assert.deepEqual(H.plain(play.toasts.map((t) => t.text)), ['calm mode: on']);
  assert.ok(play.toasts[0].t > 0);
  play.update(CB.DT, keyV());
  assert.equal(CB.Comfort.calm(), false);
  assert.equal(play.toasts[0].text, 'calm mode: off');
});

test('play: other keys do not touch calm mode, and V among other keys does', () => {
  const { CB, play } = calmSetup();
  play.update(CB.DT, H.makeInput({ keys: ['KeyW', 'KeyB', 'KeyN', 'KeyC'] }));
  assert.equal(CB.Comfort.calm(), false);
  assert.equal(play.toasts.length, 0);
  play.update(CB.DT, H.makeInput({ keys: ['KeyW', 'KeyV'] }));
  assert.equal(CB.Comfort.calm(), true);
  play.update(CB.DT, H.makeInput({ keys: undefined }));
  assert.equal(CB.Comfort.calm(), true, 'an input without a key list is fine');
});

test('play: V works on every screen, including the pause screen, and the toast waits for the resume', () => {
  const { CB, play } = calmSetup();
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, true);
  play.update(CB.DT, keyV());
  assert.equal(CB.Comfort.calm(), true);
  assert.equal(play.toasts.length, 1);
  const t0 = play.toasts[0].t;
  for (let i = 0; i < 30; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.toasts[0].t, t0, 'the queue is frozen while paused');
  play.update(CB.DT, H.makeInput({ pause: true }));
  play.update(CB.DT, H.makeInput());
  assert.ok(play.toasts[0].t < t0, 'counting down again after the resume');
});

test('play: pressing V again replaces the calm toast instead of stacking a second one, and other toasts keep their place', () => {
  const { CB, play } = calmSetup();
  play.toasts.push({ text: 'NEW HAT: Crown', t: 2.5 });
  play.update(CB.DT, keyV());
  play.update(CB.DT, keyV());
  play.update(CB.DT, keyV());
  assert.deepEqual(H.plain(play.toasts.map((t) => t.text)), ['NEW HAT: Crown', 'calm mode: on']);
  assert.equal(CB.Comfort.calm(), true);
  const solo = calmSetup();
  solo.play.update(CB.DT, keyV());
  for (let i = 0; i < 60; i++) solo.play.update(CB.DT, H.makeInput());
  const mid = solo.play.toasts[0].t;
  solo.play.update(CB.DT, keyV());
  assert.equal(solo.play.toasts.length, 1);
  assert.ok(solo.play.toasts[0].t > mid, 'the replaced toast starts its clock again');
  assert.equal(solo.play.toasts[0].text, 'calm mode: off');
});

test('play: a missing or partial CB.Comfort makes V a no-op', () => {
  const { CB, play } = calmSetup();
  CB.Comfort = undefined;
  assert.doesNotThrow(() => play.update(CB.DT, keyV()));
  CB.Comfort = {};
  assert.doesNotThrow(() => play.update(CB.DT, keyV()));
  assert.equal(play.toasts.length, 0);
});

function calmDrawSetup() {
  const s = calmSetup();
  const { CB, play } = s;
  CB.WorldDraw = { draw() {} };
  CB.Screens.hud = { draw() {}, cursor() {} };
  for (const k of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'gameOver', 'victory']) CB.Screens[k] = { draw() {} };
  CB.Screens.pause = { draw() {} };
  const log = [];
  const r = {
    clear: (c) => log.push(['clear', c]),
    shaken: (dx, dy, fn) => { log.push(['shaken', dx, dy]); fn(); },
    alpha: (a, fn) => { log.push(['alpha', a]); fn(); },
    rect: (x, y, w, h, c) => log.push(['rect', x, y, w, h, c]),
    frame: (x, y, w, h, c) => log.push(['frame', x, y, w, h, c]),
  };
  return Object.assign(s, { r, log, play });
}

test('play.draw: calm mode removes the shake', () => {
  const { CB, play, r, log } = calmDrawSetup();
  const w = play.run.world;
  w.shake = 5;
  play.draw(r, 0.5);
  const calm0 = log.find((l) => l[0] === 'shaken');
  assert.ok(calm0[1] !== 0 || calm0[2] !== 0, 'shakes while not calm');
  log.length = 0;
  CB.Comfort.set(true);
  play.draw(r, 0.5);
  const sh = log.find((l) => l[0] === 'shaken');
  assert.equal(sh[1], 0);
  assert.equal(sh[2], 0);
  assert.equal(w.shake, 5, 'the sim value is untouched');
});

test('play.draw: calm mode swaps the full-screen flash for two nested 1 px frames in the flash colour', () => {
  const { CB, play, r, log } = calmDrawSetup();
  const w = play.run.world;
  w.flash = 0.1;
  w.flashColor = '#FFD27A';
  play.draw(r, 0);
  assert.equal(log.filter((l) => l[0] === 'rect').length, 1, 'normal: one full-screen rect');
  assert.equal(log.filter((l) => l[0] === 'frame').length, 0);
  const alphaN = log.find((l) => l[0] === 'alpha')[1];
  assert.ok(Math.abs(alphaN - 0.2) < 1e-9);
  log.length = 0;
  CB.Comfort.set(true);
  play.draw(r, 0);
  assert.equal(log.filter((l) => l[0] === 'rect').length, 0, 'calm: no full-screen rect');
  const frames = log.filter((l) => l[0] === 'frame');
  assert.deepEqual(H.plain(frames), [['frame', 0, 0, 320, 180, '#FFD27A'], ['frame', 1, 1, 318, 178, '#FFD27A']]);
  const alphaC = log.find((l) => l[0] === 'alpha')[1];
  assert.ok(Math.abs(alphaC - 0.3) < 1e-9, `frame alpha ${alphaC}`);
  log.length = 0;
  w.flash = 0;
  play.draw(r, 0);
  assert.equal(log.filter((l) => l[0] === 'frame' || l[0] === 'rect').length, 0, 'no flash, nothing drawn');
});

test('play.draw: calm flash frames use the hurt colour by default and are not drawn while paused', () => {
  const { CB, play, r, log } = calmDrawSetup();
  CB.Comfort.set(true);
  const w = play.run.world;
  w.flash = 0.1;
  w.flashColor = null;
  play.draw(r, 0);
  assert.equal(log.find((l) => l[0] === 'frame')[5], CB.Pal.C.hurt);
  log.length = 0;
  play.paused = true;
  play.draw(r, 0);
  assert.equal(log.some((l) => l[0] === 'frame'), false);
});

// Drives a run to its death screen. Returns the run.
function dieToGameOver(CB, play) {
  const run = play.run;
  run.world.player.hearts = 1;
  assert.equal(run.world.hurtPlayer(null), true);
  for (let i = 0; i < 400 && run.state !== 'dead'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(run.state, 'dead');
  return run;
}

test('play: a successful retry starts the "$ git reset --hard HEAD" transition, once', () => {
  const { CB, play } = calmSetup();
  const labels = [];
  CB.Transition = { start: (l) => labels.push(l) };
  const run = dieToGameOver(CB, play);
  assert.deepEqual(labels, [], 'dying does not start one');
  play.update(CB.DT, H.makeInput({ retry: true }));
  assert.equal(run.state, 'dead', 'the input lock refuses a retry this early');
  assert.deepEqual(labels, [], 'a refused retry does not start one');
  for (let i = 0; i < 40; i++) play.update(CB.DT, H.makeInput());
  play.update(CB.DT, H.makeInput({ retry: true }));
  assert.equal(run.attempt, 1);
  assert.equal(run.state, 'stageIntro');
  assert.deepEqual(labels, ['$ git reset --hard HEAD']);
  for (let i = 0; i < 20; i++) play.update(CB.DT, H.makeInput());
  assert.deepEqual(labels, ['$ git reset --hard HEAD'], 'not again on later ticks');
});

test('play: a click (confirm) on the game over screen retries with the same transition', () => {
  const { CB, play } = calmSetup();
  const labels = [];
  CB.Transition = { start: (l) => labels.push(l) };
  dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  play.update(CB.DT, H.makeInput({ confirm: true }));
  assert.deepEqual(labels, ['$ git reset --hard HEAD']);
});

test('play: every retry gets its own transition, and a retry made outside update() is noticed on the next update', () => {
  const { CB, play } = calmSetup();
  const labels = [];
  CB.Transition = { start: (l) => labels.push(l) };
  let run = dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  assert.equal(run.retryStage(), true);
  assert.deepEqual(labels, [], 'not seen until the scene next updates');
  play.update(CB.DT, H.makeInput());
  assert.deepEqual(labels, ['$ git reset --hard HEAD']);
  run = dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  play.update(CB.DT, H.makeInput({ retry: true }));
  assert.equal(run.attempt, 2);
  assert.equal(labels.length, 2);
});

test('play: entering a new run never counts as a retry, and a missing Transition is fine', () => {
  const { CB, game, play } = calmSetup();
  const labels = [];
  CB.Transition = { start: (l) => labels.push(l) };
  dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  play.update(CB.DT, H.makeInput({ retry: true }));
  assert.equal(labels.length, 1);
  play.enter(game, { runOpts: { seed: 2 } });
  play.update(CB.DT, H.makeInput());
  assert.equal(labels.length, 1, 'a fresh run starts at attempt 0 again');
  CB.Transition = undefined;
  dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput({ retry: true })));
  assert.equal(play.run.attempt, 1);
  CB.Transition = {};
  dieToGameOver(CB, play);
  for (let i = 0; i < 45; i++) play.update(CB.DT, H.makeInput());
  assert.doesNotThrow(() => play.update(CB.DT, H.makeInput({ retry: true })), 'a partial stub without start');
});

// A run parked on its patch-pick screen (the boss is a stub that is already down).
function toPatchPick(CB, play) {
  play.enter(play.game, { runOpts: { seed: 1, skipWaves: true } });
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  for (let i = 0; i < 1200 && play.run.state !== 'patchPick'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'patchPick');
  for (let i = 0; i < 40; i++) play.update(CB.DT, H.makeInput());
}

test('play: picking a patch calls Fx.celebrate(world, id) once, on the new stage world', () => {
  const { CB, play } = calmSetup();
  const calls = [];
  CB.Fx.celebrate = (w, id) => calls.push([w, id]);
  toPatchPick(CB, play);
  assert.equal(calls.length, 0, 'nothing before the pick');
  const offered = play.run.offer[1];
  const oldWorld = play.run.world;
  play.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(play.run.history[0], offered);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], offered);
  assert.equal(calls[0][0], play.run.world, 'Clawd of the new stage celebrates');
  assert.notEqual(calls[0][0], oldWorld);
  for (let i = 0; i < 30; i++) play.update(CB.DT, H.makeInput());
  assert.equal(calls.length, 1, 'once per pick');
});

test('play: a patch picked with the 1/2/3 keys celebrates too', () => {
  const { CB, play } = calmSetup();
  const calls = [];
  CB.Fx.celebrate = (w, id) => calls.push(id);
  toPatchPick(CB, play);
  const offered = play.run.offer[2];
  play.update(CB.DT, H.makeInput({ choice: 3 }));
  assert.equal(play.run.history[0], offered);
  play.update(CB.DT, H.makeInput());
  assert.deepEqual(calls, [offered]);
});

test('play: no Fx.celebrate (or no patchPick event) is fine, and other events never celebrate', () => {
  const { CB, play } = calmSetup();
  const calls = [];
  CB.Fx.celebrate = undefined; // emulate a build without the celebration hook
  toPatchPick(CB, play);
  play.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(play.run.history.length, 1, 'picked without a celebrate hook');
  CB.Fx.celebrate = (w, id) => calls.push(id);
  for (let i = 0; i < 120; i++) play.update(CB.DT, H.makeInput());
  assert.deepEqual(calls, [], 'wave, spawn and hit events are not patch picks');
});
