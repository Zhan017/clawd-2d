'use strict';
// Whole-game smoke tests: every script in index.html loaded together, the registries wired up, every sprite baked,
// and the title and play scenes driven and drawn through a real renderer.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('smoke: every script in index.html loads together without throwing', () => {
  const CB = H.load();
  assert.ok(CB.createRun && CB.createWorld && CB.createRenderer && CB.createInput && CB.createLoop);
});

test('smoke: every stage references registered enemies and bosses', () => {
  const CB = H.load();
  assert.equal(CB.STAGES.length, 4);
  for (const s of CB.STAGES) {
    assert.ok(CB.Bosses[s.boss], `boss ${s.boss}`);
    assert.ok(s.waves.length >= 2, `stage ${s.id} has at least two waves`);
    for (const wave of s.waves) for (const g of wave) assert.ok(CB.Enemies[g.kind], `enemy ${g.kind}`);
  }
});

test('smoke: every boss module carries the data the screens read', () => {
  const CB = H.load();
  const bossIds = new Set(CB.STAGES.map((s) => s.boss));
  for (const id of Object.keys(CB.Bosses)) {
    const B = CB.Bosses[id];
    assert.ok(bossIds.has(id), `${id} is used by a stage`);
    assert.equal(B.id, id, `${id}.id`);
    for (const k of ['name', 'tagline', 'commitMsg', 'file', 'portrait']) assert.ok(typeof B[k] === 'string' && B[k], `${id}.${k}`);
    assert.ok(Array.isArray(B.diff) && B.diff.length > 0, `${id}.diff`);
    assert.equal(typeof B.create, 'function', `${id}.create`);
    assert.equal(typeof B.deathPoints, 'function', `${id}.deathPoints`);
  }
  for (const id of bossIds) assert.ok(CB.Bosses[id], id);
});

test('smoke: every enemy module can create, update and draw', () => {
  const CB = H.load();
  for (const k of Object.keys(CB.Enemies)) {
    const E = CB.Enemies[k];
    for (const fn of ['create', 'update', 'draw']) assert.equal(typeof E[fn], 'function', `${k}.${fn}`);
  }
});

test('smoke: every screen and scene is registered', () => {
  const CB = H.load();
  for (const n of ['hud', 'stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'patchPick', 'gameOver', 'victory', 'pause', 'panic']) assert.equal(typeof CB.Screens[n].draw, 'function', n);
  for (const n of ['title', 'play']) assert.equal(typeof CB.Scenes[n].update, 'function', n);
  assert.equal(typeof CB.Font.measure, 'function');
  assert.equal(typeof CB.Audio.handleEvents, 'function');
  assert.equal(typeof CB.Transition.start, 'function');
  assert.equal(typeof CB.Comfort.calm, 'function');
});

test('smoke: all sprites bake headless and the required ones exist', () => {
  const CB = H.load();
  for (const n of CB.Art.spriteNames()) {
    CB.Art.sprite(n);
    const def = CB.Art.spriteDef(n);
    assert.ok(def && def.w > 0 && def.h > 0, `${n} has a size`);
  }
  const REQUIRED = [
    // Clawd, shots, HUD, pickups
    'clawd_idle0', 'clawd_idle0_happy', 'clawd_blink', 'bolt', 'bolt_big', 'ebullet', 'ebullet_hot', 'heart_full', 'heart_empty',
    'dash_ready', 'dash_cool', 'keycap_e', 'pickup_hotfix', 'cursor_cross_0', 'cursor_pointer', 'title_spark0',
    // regular bugs
    'syntaxError_0', 'nullPointer_0', 'raceCondition_0', 'memoryLeak_0', 'memoryLeakSmall_0', 'offByOne_0',
    // bosses and their parts
    'loopHead_0', 'loopSegment_0', 'leakBoss_0', 'leakBlob_0', 'conflictHead_0', 'conflictIncoming_0',
    'heisenbug_0', 'heisenbug_cyan_0', 'heisenbug_mag_0', 'heisenEye_0',
    'hat_crown', 'hat_halo',
  ];
  for (const n of REQUIRED) assert.ok(CB.Art.hasSprite(n), n);
  for (const id of CB.Patches.ORDER) assert.ok(CB.Art.hasSprite('patch_' + id), 'patch_' + id);
  for (const h of CB.HATS) assert.ok(CB.Art.hasSprite('hat_' + h.id), 'hat_' + h.id);
  for (const ex of ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried']) assert.ok(CB.Art.hasSprite('clawd_idle0_' + ex), 'clawd_idle0_' + ex);
});

test('smoke: every boss portrait exists as a sprite', () => {
  const CB = H.load();
  assert.equal(Object.keys(CB.Bosses).length, 4);
  for (const id of Object.keys(CB.Bosses)) assert.ok(CB.Art.hasSprite(CB.Bosses[id].portrait), `${id} portrait ${CB.Bosses[id].portrait}`);
  for (const s of CB.STAGES) assert.ok(CB.Art.hasSprite(CB.Bosses[s.boss].portrait), s.boss + ' portrait');
});

test('smoke: title and play scenes run and draw through a real renderer', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const game = { r, debug: {}, input: { peekAim: () => ({ x: 160, y: 90 }), releaseAll() {} }, scene: null, go(name, data) { game.scene = CB.Scenes[name]; game.scene.enter(game, data || {}); } };
  game.go('title');
  for (let i = 0; i < 60; i++) {
    game.scene.update(CB.DT, H.makeInput());
    game.scene.draw(r, i / 60);
  }
  game.go('play', { runOpts: { seed: 5, god: true } });
  for (let i = 0; i < 60 * 20; i++) {
    game.scene.update(CB.DT, H.makeInput({ fire: true, aimX: 160, aimY: 40, moveX: Math.sin(i / 30) }));
    if (i % 15 === 0) game.scene.draw(r, i / 60);
  }
  CB.Screens.panic.draw(r, new Error('smoke'));
});

test('smoke: a click on the title starts a run, and the play scene pauses and draws the pause overlay', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const visits = [];
  const game = {
    r,
    debug: {},
    input: { peekAim: () => ({ x: 160, y: 90 }), releaseAll() {} },
    scene: null,
    go(name, data) {
      visits.push(name);
      game.scene = CB.Scenes[name];
      game.scene.enter(game, name === 'play' ? Object.assign({}, data, { runOpts: Object.assign({ seed: 3, god: true }, (data && data.runOpts) || {}) }) : data || {});
    },
  };
  game.go('title');
  for (let i = 0; i < 40; i++) {
    game.scene.update(CB.DT, H.makeInput());
    game.scene.draw(r, i / 60);
  }
  for (let i = 0; i < 10 && game.scene !== CB.Scenes.play; i++) {
    game.scene.update(CB.DT, H.makeInput({ fire: true, confirm: true, aimX: 160, aimY: 114 }));
    game.scene.draw(r, 1 + i / 60);
  }
  assert.deepEqual(visits, ['title', 'play']);
  const play = CB.Scenes.play;
  for (let i = 0; i < 120; i++) play.update(CB.DT, H.makeInput());
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, true);
  play.draw(r, 3);
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, false);
});
