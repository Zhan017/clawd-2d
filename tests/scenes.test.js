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
