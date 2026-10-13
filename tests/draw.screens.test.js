'use strict';
// Overlay screens: stage intro, wave banner, boss warning, BUG FIXED card, pause, patch pick, game over, victory and the panic screen.
// The Rev 3 layout tables are checked with the layout recorder (every box on screen, no two text boxes sharing pixels).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

// prompts.js is loaded so every kbm string pinned below is the one CB.Prompts hands out (menus.devices.test.js covers touch, pad and no Prompts at all).
const SCREEN_FILES = ['src/core/prompts.js', 'src/scenes/screens.js', 'src/scenes/patchPick.js', 'src/scenes/gameOver.js', 'src/scenes/victory.js', 'src/scenes/panic.js'];
const BASE = [...H.GAME_BASE, 'src/art/font.js', 'src/art/render.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js'];
const ENEMIES = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne'].map((k) => 'src/game/enemies/' + k + '.js');
const BOSSES = ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug'].map((k) => 'src/game/bosses/' + k + '.js');
const QUIPS = 'src/game/quips.js';
const UNLOCKS = 'src/game/unlocks.js';
const COMFORT = 'src/game/comfort.js';
const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
const KINDS = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne'];

// A renderer on the stub canvas with the layout recorder on and a log of the primitive calls.
// opts: real (load the real enemies and bosses), extra (more scripts), localStorage, stub (replace every stage's boss with a bare stub).
function setup(opts) {
  const o = opts || {};
  const files = [...BASE, ...(o.real ? [...ENEMIES, ...BOSSES] : []), ...(o.extra || []), ...SCREEN_FILES];
  const { CB, sandbox } = H.load(files, { returnSandbox: true, localStorage: o.localStorage });
  if (o.stub) {
    CB.Bosses.stub = { id: 'stub', name: 'STUB', tagline: 'noop()', commitMsg: 'fix: stub', create: () => ({ x: 160, y: 60, hp: 1, maxHp: 1, phase: 1, defeated: false, update() {}, draw() {} }) };
    CB.STAGES = CB.STAGES.map((s) => Object.assign({}, s, { boss: 'stub' }));
  }
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const rec = H.recorder(r, CB);
  const log = { text: [], rect: [], frame: [], disc: [], ring: [], sprite: [], alpha: [] };
  for (const k of Object.keys(log)) {
    const orig = r[k];
    r[k] = function (...a) {
      log[k].push(a);
      return orig.apply(this, a);
    };
  }
  const clear = () => {
    rec.clear();
    for (const k of Object.keys(log)) log[k].length = 0;
  };
  return { CB, sandbox, r, rec, log, clear, C: CB.Pal.C };
}

// A real run (so every field a screen reads exists) with fields overridden. `checkpoint` is a read-only getter on a run:
// see withCheckpoint.
function mkRun(CB, over) {
  const o = over || {};
  const run = CB.createRun({ seed: o.seed == null ? 7 : o.seed, startStage: o.stageIndex | 0 });
  return Object.assign(run, o);
}
function withCheckpoint(run, cp) {
  return Object.create(run, { checkpoint: { value: cp } });
}

// Draws one screen at a state time and returns what the recorder saw.
function draw(env, screen, run, st, ui) {
  env.clear();
  run.stateT = st;
  env.CB.Screens[screen].draw(env.r, run, st, ui);
  return env.rec;
}

const strs = (rec) => rec.texts().map((b) => b.str);
const box = (rec, str) => rec.texts().find((b) => b.str === str);
const noConfetti = (rec) => rec.texts().filter((b) => b.str !== '✻');
const overlapsOf = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(a.str + ' / ' + b.str);
    }
  }
  return out;
};
const outsideOf = (list) => list.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > 320 || b.y + b.h > 180).map((b) => b.str || b.name);
const centreX = (b) => b.x + b.w / 2;
const inBox = (b, hit) => b.x >= hit.x && b.x + b.w <= hit.x + hit.w && b.y >= hit.y && b.y + b.h <= hit.y + hit.h;

// Every box on screen and no two text boxes sharing pixels.
function assertLayout(rec, label) {
  assert.deepEqual(outsideOf(noConfetti(rec)), [], label + ': text outside 320x180');
  assert.deepEqual(outsideOf(rec.sprites()), [], label + ': sprite outside 320x180');
  assert.deepEqual(overlapsOf(noConfetti(rec)), [], label + ': overlapping text');
}

// ---- the plan's smoke and hit-test tests -------------------------------------------------------------------------------------

test('screens: every overlay draws across its timeline without throwing', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, r } = env;
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  run.history = ['spread'];
  run.offer = ['rapid', 'pierce', 'heart'];
  const screens = { stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn', bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory' };
  for (const [state, screen] of Object.entries(screens)) {
    run.state = state;
    for (const st of [0, 0.3, 0.7, 1.6, 2.4]) {
      run.stateT = st;
      CB.Screens[screen].draw(r, run, st, { hover: 1 });
    }
  }
  CB.Screens.pause.draw(r, run, 0);
});

test('screens: every overlay survives a bare run and a missing ui', () => {
  const env = setup({ stub: true });
  const { CB, r } = env;
  const bare = { state: 'wave', stateT: 0.5, stageIndex: 0, waveIndex: 0 };
  for (const n of ['stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'patchPick', 'gameOver', 'victory', 'pause']) {
    for (const st of [0, 1, 3]) {
      bare.stateT = st;
      CB.Screens[n].draw(r, bare, st);
      CB.Screens[n].draw(r, bare, st, null);
    }
  }
});

test('screens: patch card hit-testing', () => {
  const { CB } = setup({ stub: true });
  const P = CB.Screens.patchPick;
  assert.equal(P.CARDS.length, 3);
  assert.deepEqual(H.plain(P.CARDS.map((c) => [c.x, c.y, c.w, c.h])), [[22, 44, 84, 100], [118, 44, 84, 100], [214, 44, 84, 100]]);
  assert.equal(P.cardAt(P.CARDS[0].x + 1, P.CARDS[0].y + 1), 0);
  assert.equal(P.cardAt(P.CARDS[2].x + P.CARDS[2].w - 1, P.CARDS[2].y + P.CARDS[2].h - 1), 2);
  assert.equal(P.cardAt(P.CARDS[1].x - 2, P.CARDS[1].y + 10), -1);
  assert.equal(P.cardAt(5, 5), -1);
  assert.equal(P.cardAt(NaN, 50), -1);
  assert.equal(P.cardAt(P.CARDS[1].x + 40, P.CARDS[1].y + P.CARDS[1].h), -1, 'the bottom edge is outside');
  for (const id of CB.Patches.ORDER) assert.ok(CB.Art.hasSprite('patch_' + id), id);
});

test('screens: patch icons are 12x12 with a closed ink outline and at least two shades', () => {
  const { CB } = setup({ stub: true });
  for (const id of CB.Patches.ORDER) {
    const d = CB.Art.spriteDef('patch_' + id);
    assert.equal(d.w, 12, id);
    assert.equal(d.h, 12, id);
    const at = (x, y) => (x < 0 || y < 0 || x >= d.w || y >= d.h ? '.' : d.rows[y][x]);
    const body = new Set();
    let ink = 0;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const ch = at(x, y);
        if (ch === '.') continue;
        if (ch === 'k') {
          ink++;
          continue;
        }
        body.add(ch);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) assert.notEqual(at(x + dx, y + dy), '.', `${id}: pixel ${x},${y} is open to the outside`);
      }
    }
    assert.ok(ink >= 12, `${id}: has an ink outline`);
    assert.ok(body.size >= 2, `${id}: at least two shades`);
  }
});

test('screens: victory time format pads minutes', () => {
  const { CB } = setup({ stub: true });
  const f = CB.Screens.victory.formatTime;
  assert.equal(f(0), '00:00');
  assert.equal(f(61.9), '01:01');
  assert.equal(f(600), '10:00');
  assert.equal(f(59.99), '00:59');
  assert.equal(f(-5), '00:00');
  assert.equal(f(NaN), '00:00');
  assert.equal(f(6000), '100:00');
});

test('screens: victory commitHash is seven lowercase hex chars and deterministic', () => {
  const { CB } = setup({ stub: true });
  const h = CB.Screens.victory.commitHash;
  assert.match(h(1, 0), /^[0-9a-f]{7}$/);
  assert.equal(h(1, 0), h(1, 0));
  assert.equal(h(1, 0), '9e3779b');
  assert.notEqual(h(1, 0), h(1, 1));
  assert.notEqual(h(1, 0), h(2, 0));
  assert.match(h(4294967295, 3), /^[0-9a-f]{7}$/);
  assert.match(h(0, 0), /^[0-9a-f]{7}$/);
});

test('screens: panic screen never throws', () => {
  const { CB, r } = setup({ stub: true });
  const e = new Error('TypeError: cannot read properties of undefined (reading x) '.repeat(4));
  CB.Screens.panic.draw(r, e);
  CB.Screens.panic.draw(r, { message: 'no stack' });
  CB.Screens.panic.draw(r, null);
  CB.Screens.panic.draw(r, 'a plain string');
  CB.Screens.panic.draw(r, { message: 12, stack: 7 });
  delete CB.Font;
  CB.Screens.panic.draw(r, e);
});

// ---- stageIntro ---------------------------------------------------------------------------------------------------------------

test('stageIntro: types STAGE n and the path, then the prompt lines, and fades out over the last 0.3 s', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, C } = env;
  const run = mkRun(CB, { stageIndex: 1, state: 'stageIntro', introT: 2.0 });
  const [q1, q2] = CB.Quips.stage[1];
  assert.deepEqual(strs(draw(env, 'stageIntro', run, 0)), [], 'nothing typed yet');
  const early = strs(draw(env, 'stageIntro', run, 0.13));
  assert.deepEqual(early, ['ST'], 'one character per 0.06 s');
  assert.deepEqual(strs(draw(env, 'stageIntro', run, 0.43)), ['STAGE 2'], 'the title is done, the path has not started');
  let seen = strs(draw(env, 'stageIntro', run, 0.6));
  assert.ok(seen.includes('STAGE 2'));
  const partial = seen.find((s) => s !== 'STAGE 2');
  assert.ok(partial && partial.length < '~/node_modules/'.length && '~/node_modules/'.startsWith(partial), 'the path is typing: ' + partial);
  seen = strs(draw(env, 'stageIntro', run, 0.9));
  assert.ok(seen.includes('~/node_modules/'), 'the path is done and the prompt has started');
  assert.ok(!seen.includes(q2));
  seen = strs(draw(env, 'stageIntro', run, 1.6));
  for (const s of ['STAGE 2', '~/node_modules/', q1, q2]) assert.ok(seen.includes(s), s);
  assertLayout(env.rec, 'stageIntro long');
  // The band: 56 px at y 62 with the prompt lines, ink at 0.7.
  assert.ok(env.log.rect.some((a) => a[0] === 0 && a[1] === 62 && a[2] === 320 && a[3] === 56 && a[4] === C.ink), 'long band');
  const title = box(env.rec, 'STAGE 2');
  assert.equal(title.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(title) - 160) <= 1);
  const accent = CB.Pal.STAGES.node_modules.accent;
  assert.ok(env.log.text.some((a) => a[0] === '~/node_modules/' && a[3].color === accent), 'path in the stage accent');
  assert.ok(env.log.text.some((a) => a[0] === q1 && a[3].color === C.pale), 'prompt in pale');
  // The fade: the whole card is drawn at alpha (2.0 - t) / 0.3 over the last 0.3 s, so it is still there, dimmer, at 1.9.
  draw(env, 'stageIntro', run, 1.6);
  assert.equal(env.log.alpha[0][0], 1, 'full strength before the fade');
  seen = strs(draw(env, 'stageIntro', run, 1.9));
  assert.ok(seen.includes(q2));
  assert.ok(Math.abs(env.log.alpha[0][0] - 1 / 3) < 1e-6, 'a third strength at 1.9 s: ' + env.log.alpha[0][0]);
  assert.deepEqual(strs(draw(env, 'stageIntro', run, 2.0)), [], 'faded out entirely at the end');
});

test('stageIntro: every stage fits its prompt lines in the band', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB } = env;
  for (let i = 0; i < CB.STAGES.length; i++) {
    const run = mkRun(CB, { stageIndex: i, state: 'stageIntro', introT: 2.0 });
    const rec = draw(env, 'stageIntro', run, 1.65);
    assert.ok(strs(rec).includes(CB.Quips.stage[i][1]), 'second line typed in full by 1.65 s, stage ' + i);
    assertLayout(rec, 'stage ' + i);
    for (const b of rec.texts()) assert.ok(b.y >= 62 && b.y + b.h <= 118, `${b.str} inside the band`);
  }
});

test('stageIntro: the retry card is short: no prompt lines, double typing speed, 34 px band', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, C } = env;
  const run = mkRun(CB, { stageIndex: 1, state: 'stageIntro', introT: 0.9 });
  assert.deepEqual(strs(draw(env, 'stageIntro', run, 0.07)), ['ST'], 'two characters in 0.07 s');
  const seen = strs(draw(env, 'stageIntro', run, 0.5));
  assert.deepEqual(seen, ['STAGE 2', '~/node_modules/']);
  assert.ok(env.log.rect.some((a) => a[0] === 0 && a[1] === 70 && a[2] === 320 && a[3] === 34 && a[4] === C.ink), 'short band');
  assert.equal(box(env.rec, 'STAGE 2').y, 74);
  assert.equal(box(env.rec, '~/node_modules/').y, 92);
  assert.deepEqual(strs(draw(env, 'stageIntro', run, 0.9)), [], 'gone at the end of the short card');
  // And without Quips the long card falls back to the short layout.
  const bare = setup({ stub: true });
  const run2 = mkRun(bare.CB, { stageIndex: 0, state: 'stageIntro', introT: 2.0 });
  assert.deepEqual(strs(draw(bare, 'stageIntro', run2, 1.5)), ['STAGE 1', '~/src/']);
});

// ---- waveBanner ---------------------------------------------------------------------------------------------------------------

test('waveBanner: waveBreak shows WAVE 2 and the stage quip, wave shows a fading WAVE n/2', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, C } = env;
  for (let i = 0; i < CB.STAGES.length; i++) {
    const run = mkRun(CB, { stageIndex: i, state: 'waveBreak' });
    const rec = draw(env, 'waveBanner', run, 0.7);
    const head = box(rec, 'WAVE 2');
    assert.ok(head, 'WAVE 2');
    assert.equal(head.h, 14, 'scale 2');
    assert.equal(head.y, 74);
    assert.ok(Math.abs(centreX(head) - 160) <= 1);
    const line = CB.Quips.waveBreak[i % CB.Quips.waveBreak.length];
    const sub = box(rec, line);
    assert.ok(sub, 'quip ' + line);
    assert.ok(sub.y >= head.y + head.h + 2, 'below the headline');
    assert.ok(env.log.text.some((a) => a[0] === line && a[3].color === C.grey), 'in grey');
    assertLayout(rec, 'waveBreak ' + i);
  }
  const wave = mkRun(CB, { stageIndex: 0, state: 'wave', waveIndex: 1 });
  const rec = draw(env, 'waveBanner', wave, 0.3);
  const w = box(rec, 'WAVE 2/2');
  assert.ok(w);
  assert.equal(w.y, 40);
  assert.equal(w.h, 7, 'scale 1');
  assert.deepEqual(strs(draw(env, 'waveBanner', wave, 1.3)), [], 'gone after 1.2 s');
  const first = mkRun(CB, { stageIndex: 0, state: 'wave', waveIndex: 0 });
  assert.ok(strs(draw(env, 'waveBanner', first, 0.1)).includes('WAVE 1/2'));
  // Other states draw nothing.
  const idle = mkRun(CB, { state: 'boss' });
  assert.deepEqual(strs(draw(env, 'waveBanner', idle, 0.3)), []);
});

test('waveBanner: without Quips the second line is incoming...', () => {
  const env = setup({ stub: true });
  const run = mkRun(env.CB, { state: 'waveBreak' });
  const seen = strs(draw(env, 'waveBanner', run, 0.7));
  assert.deepEqual(seen, ['WAVE 2', 'incoming...']);
  env.CB.Quips = {}; // present but empty
  assert.deepEqual(strs(draw(env, 'waveBanner', run, 0.7)), ['WAVE 2', 'incoming...']);
  env.CB.Quips = { waveBreak: [] };
  assert.deepEqual(strs(draw(env, 'waveBanner', run, 0.7)), ['WAVE 2', 'incoming...']);
});

// ---- bossWarn -----------------------------------------------------------------------------------------------------------------

test('bossWarn: stripes, blinking WARNING, name, typed tagline and a vignette', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB, C } = env;
  const run = mkRun(CB, { stageIndex: 0, state: 'bossWarn', warnT: 2.5 });
  const B = CB.Bosses.infiniteLoop;
  let rec = draw(env, 'bossWarn', run, 0.1);
  const warn = box(rec, '⚠ WARNING ⚠');
  assert.ok(warn, 'WARNING is on in the first quarter second');
  assert.equal(warn.y, 56);
  assert.ok(Math.abs(centreX(warn) - 160) <= 1);
  assert.ok(env.log.text.some((a) => a[0] === '⚠ WARNING ⚠' && a[3].color === C.hurt));
  const name = box(rec, B.name);
  assert.ok(name);
  assert.equal(name.y, 72);
  assert.equal(name.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(name) - 160) <= 1);
  assert.ok(!strs(rec).includes(B.tagline), 'the tagline is still typing');
  // 4 Hz: off in the second quarter second, on again in the third.
  assert.ok(!box(draw(env, 'bossWarn', run, 0.3), '⚠ WARNING ⚠'));
  assert.ok(box(draw(env, 'bossWarn', run, 0.55), '⚠ WARNING ⚠'));
  rec = draw(env, 'bossWarn', run, 1.7);
  const tag = box(rec, B.tagline);
  assert.ok(tag, 'typed in full by 1.7 s');
  assert.equal(tag.y, 92);
  assert.ok(env.log.text.some((a) => a[0] === B.tagline && a[3].color === C.gold));
  // Hazard stripes: hurt-coloured runs in the top and bottom 10 px, ink under them.
  const hurt = env.log.rect.filter((a) => a[4] === C.hurt);
  assert.ok(hurt.some((a) => a[1] >= 0 && a[1] < 10), 'top stripes');
  assert.ok(hurt.some((a) => a[1] >= 170 && a[1] < 180), 'bottom stripes');
  assert.ok(env.log.frame.some((a) => a[4] === C.hurt), 'vignette frames');
  assertLayout(rec, 'bossWarn');
});

test('bossWarn: the portrait slides in, keeps y 100-168 at its scale, glitches and flashes at the end', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB } = env;
  for (let i = 0; i < CB.STAGES.length; i++) {
    const B = CB.Bosses[CB.STAGES[i].boss];
    const def = CB.Art.spriteDef(B.portrait);
    const want = Math.max(2, Math.min(4, Math.floor(56 / Math.max(def.w, def.h))));
    const run = mkRun(CB, { stageIndex: i, state: 'bossWarn', warnT: 2.5 });
    let rec = draw(env, 'bossWarn', run, 1.0);
    const main = rec.sprites().filter((b) => b.name === B.portrait);
    assert.equal(main.length, 1, B.portrait);
    assert.equal(main[0].w, def.w * want, 'scale ' + want);
    assert.equal(main[0].h, def.h * want);
    assert.ok(Math.abs(main[0].y + main[0].h / 2 - 138) <= 1, 'centred at y 138');
    assert.ok(Math.abs(centreX(main[0]) - 160) <= 1);
    for (const s of rec.sprites()) {
      assert.ok(s.y >= 100 && s.y + s.h <= 168, `${s.name} box y ${s.y}..${s.y + s.h}`);
      assert.ok(s.x >= 0 && s.x + s.w <= 320);
    }
    assert.equal(rec.sprites().length, 3, 'two chromatic copies and the portrait');
    const copies = env.log.sprite.filter((a) => a[0] !== B.portrait);
    assert.equal(copies.length, 2);
    for (const c of copies) assert.equal(c[3].alpha, 0.35, 'chromatic copies at alpha 0.35');
    const xs = env.log.sprite.map((a) => a[1]).sort((a, b) => a - b);
    assert.equal(xs[2] - xs[0], 4, 'the copies sit 2 px either side');
    // The offset flips every 0.05 s.
    const copyX = (st) => {
      draw(env, 'bossWarn', run, st);
      return env.log.sprite.filter((a) => a[0] !== B.portrait).map((a) => a[1]);
    };
    const a = copyX(1.0);
    const b = copyX(1.06);
    assert.notDeepEqual(a, b, 'flipped');
    assert.deepEqual(copyX(1.0), a, 'and deterministic');
    // Flash: white from warnT - 0.2 at 8 Hz, never before.
    const whiteAt = (st) => {
      draw(env, 'bossWarn', run, st);
      return env.log.sprite.some((s) => s[0] === B.portrait && s[3].white === true);
    };
    assert.equal(whiteAt(2.0), false);
    assert.equal(whiteAt(2.31), true);
    assert.equal(whiteAt(2.4), false);
    assert.equal(whiteAt(2.46), false);
  }
});

test('bossWarn: the slide is easeOutCubic from y 190 to y 138 over 0.6 s', () => {
  const env = setup({ real: true });
  const { CB } = env;
  const run = mkRun(CB, { stageIndex: 0, state: 'bossWarn', warnT: 2.5 });
  const B = CB.Bosses.infiniteLoop;
  const yAt = (st) => {
    draw(env, 'bossWarn', run, st);
    return env.log.sprite.find((a) => a[0] === B.portrait)[2];
  };
  assert.equal(yAt(0), 190);
  assert.equal(yAt(0.6), 138);
  assert.equal(yAt(1.5), 138);
  const mid = yAt(0.3);
  assert.ok(mid < 190 && mid > 138);
  assert.ok(Math.abs(mid - (138 + 52 * Math.pow(0.5, 3))) < 1, 'easeOutCubic(0.5) = 0.875 of the way');
  assert.ok(yAt(0.1) > yAt(0.2) && yAt(0.2) > yAt(0.4));
});

test('bossWarn: the retry card is short: portrait in place and the tagline in full at once', () => {
  const env = setup({ real: true });
  const { CB } = env;
  const run = mkRun(CB, { stageIndex: 2, state: 'bossWarn', warnT: 1.3 });
  const B = CB.Bosses.mergeConflict;
  const rec = draw(env, 'bossWarn', run, 0.05);
  assert.ok(strs(rec).includes(B.tagline), 'tagline shown instantly');
  const p = env.log.sprite.find((a) => a[0] === B.portrait);
  assert.equal(p[2], 138, 'portrait already at its final position');
  // The end-of-card flash moves with the card: from warnT - 0.2.
  const whiteAt = (st) => {
    draw(env, 'bossWarn', run, st);
    return env.log.sprite.some((s) => s[0] === B.portrait && s[3].white === true);
  };
  assert.equal(whiteAt(1.0), false);
  assert.equal(whiteAt(1.12), true);
});

test('bossWarn: a boss without a portrait still gets its card', () => {
  const env = setup({ stub: true });
  const run = mkRun(env.CB, { state: 'bossWarn', warnT: 2.5 });
  const rec = draw(env, 'bossWarn', run, 1.5);
  assert.deepEqual(rec.sprites(), []);
  assert.ok(strs(rec).includes('STUB'));
  env.CB.Bosses.stub.portrait = 'no_such_sprite';
  assert.deepEqual(draw(env, 'bossWarn', run, 1.5).sprites(), []);
});

// ---- bossDead -----------------------------------------------------------------------------------------------------------------

test('bossDead: TIMELINE is exported', () => {
  const { CB } = setup({ stub: true });
  assert.deepEqual(H.plain(CB.Screens.bossDead.TIMELINE), { start: 1.5, commitCps: 100, diffStart: 1.95, diffStep: 0.2, passDelay: 0.1 });
});

test('bossDead: nothing during the slow-mo, then BUG FIXED, the typed commit, the diff and the passing test', () => {
  const env = setup({ real: true });
  const { CB, C } = env;
  const run = mkRun(CB, { stageIndex: 2, state: 'bossDead' });
  const B = CB.Bosses.mergeConflict;
  const full = 'git commit -m "' + B.commitMsg + '"';
  assert.deepEqual(strs(draw(env, 'bossDead', run, 1.4)), [], 'nothing while the boss is exploding');
  assert.deepEqual(strs(draw(env, 'bossDead', run, 1.5)), [], 'strictly after the slow-mo');
  let rec = draw(env, 'bossDead', run, 1.6);
  const head = box(rec, 'BUG FIXED ✓');
  assert.ok(head);
  assert.equal(head.y, 40);
  assert.equal(head.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(head) - 160) <= 1);
  assert.ok(env.log.text.some((a) => a[0] === 'BUG FIXED ✓' && a[3].color === C.green));
  const typed = strs(rec).find((s) => s.startsWith('git'));
  assert.ok(typed && typed.length < full.length && full.startsWith(typed), 'the commit line is mid-type at 1.6 s: ' + typed);
  assert.equal(box(rec, typed).y, 58);
  assert.ok(env.log.text.some((a) => a[0] === typed && a[3].color === C.pale));
  assert.ok(!strs(rec).some((s) => s.startsWith('@@')), 'no diff panel yet');
  // 2.2 s: the commit line is done, the header and the first diff line are in, the rest is not.
  rec = draw(env, 'bossDead', run, 2.2);
  const seen = strs(rec);
  assert.ok(seen.includes(full));
  assert.ok(seen.includes('@@ ' + B.file + ' @@'));
  assert.ok(seen.includes(B.diff[0]));
  assert.ok(!seen.includes(B.diff[1]));
  assert.ok(!seen.includes('✓ 1 test passing'));
  // 2.9 s: everything.
  rec = draw(env, 'bossDead', run, 2.9);
  const all = strs(rec);
  for (const s of ['BUG FIXED ✓', full, '@@ ' + B.file + ' @@', ...B.diff, '✓ 1 test passing']) assert.ok(all.includes(s), s);
  const header = box(rec, '@@ ' + B.file + ' @@');
  assert.ok(header.x >= 40 && header.y >= 72, 'the header sits in the panel');
  assert.ok(env.log.text.some((a) => a[0] === header.str && a[3].color === C.grey));
  assert.ok(env.log.text.some((a) => a[0] === '✓ 1 test passing' && a[3].color === C.green));
  // - lines: red text on a redDark bar at 0.3; + lines: green on greenDark.
  for (const line of B.diff) {
    const colour = line.startsWith('-') ? C.red : C.green;
    assert.ok(env.log.text.some((a) => a[0] === line && a[3].color === colour), line);
  }
  assert.ok(env.log.rect.some((a) => a[4] === C.redDark), 'a red bar');
  assert.ok(env.log.rect.some((a) => a[4] === C.greenDark), 'a green bar');
});

test('bossDead: the diff lines arrive one every 0.2 s from 1.95 s, and the pass line follows the last one', () => {
  const env = setup({ real: true });
  const { CB } = env;
  const T = CB.Screens.bossDead.TIMELINE;
  const run = mkRun(CB, { stageIndex: 2, state: 'bossDead' });
  const B = CB.Bosses.mergeConflict;
  assert.equal(B.diff.length, 4);
  assert.ok(strs(draw(env, 'bossDead', run, T.diffStart + 0.01)).includes('@@ ' + B.file + ' @@'));
  for (let i = 0; i < B.diff.length; i++) {
    const at = T.diffStart + T.diffStep * (i + 1);
    assert.ok(!strs(draw(env, 'bossDead', run, at - 0.03)).includes(B.diff[i]), 'line ' + i + ' not yet');
    assert.ok(strs(draw(env, 'bossDead', run, at + 0.01)).includes(B.diff[i]), 'line ' + i + ' in');
  }
  const last = T.diffStart + T.diffStep * B.diff.length;
  assert.ok(!strs(draw(env, 'bossDead', run, last + T.passDelay - 0.03)).includes('✓ 1 test passing'));
  assert.ok(strs(draw(env, 'bossDead', run, last + T.passDelay + 0.01)).includes('✓ 1 test passing'));
  assert.ok(last + T.passDelay <= 2.9, 'a 4 line diff is complete before 2.9 s');
});

test('bossDead: every real boss draws its whole card by 2.9 s, inside 320x180, nothing overlapping', () => {
  const env = setup({ real: true });
  const { CB } = env;
  assert.equal(Object.keys(CB.Bosses).length, 4);
  CB.STAGES.forEach((stage, i) => {
    const B = CB.Bosses[stage.boss];
    const run = mkRun(CB, { stageIndex: i, state: 'bossDead' });
    for (const st of [1.6, 2.2, 2.9, 3.0]) {
      const rec = draw(env, 'bossDead', run, st);
      assertLayout(rec, `${B.id} at ${st}`);
    }
    const rec = draw(env, 'bossDead', run, 2.9);
    const all = strs(rec);
    const lines = [`git commit -m "${B.commitMsg}"`, '@@ ' + B.file + ' @@', ...B.diff, '✓ 1 test passing'];
    for (const s of lines) assert.ok(all.includes(s), `${B.id}: ${s}`);
    for (const s of B.diff) assert.ok(CB.Font.measure(s, 1) <= 228, `${B.id}: diff line "${s}" fits the panel`);
    // The panel keeps its left and right edges (x 40..280) and the text its padding.
    for (const b of rec.texts()) if (b.str !== 'BUG FIXED ✓' && !b.str.startsWith('git commit')) assert.ok(b.x >= 42 && b.x + b.w <= 278, `${b.str} inside the panel`);
  });
});

test('bossDead: a boss with no diff or file still draws, and a long diff is compressed to finish in time', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const run = mkRun(CB, { state: 'bossDead' });
  assert.ok(strs(draw(env, 'bossDead', run, 2.9)).includes('✓ 1 test passing'));
  CB.Bosses.stub.diff = 'not an array';
  CB.Bosses.stub.file = null;
  assert.ok(strs(draw(env, 'bossDead', run, 2.9)).includes('✓ 1 test passing'));
  CB.Bosses.stub.diff = ['- a', '+ b', '+ c', '+ d', '+ e', '+ f', '+ g'];
  CB.Bosses.stub.file = 'x.js';
  const rec = draw(env, 'bossDead', run, 2.9);
  for (const l of CB.Bosses.stub.diff) assert.ok(strs(rec).includes(l), l);
  assert.ok(strs(rec).includes('✓ 1 test passing'));
  assertLayout(rec, 'long diff');
});

// ---- pause --------------------------------------------------------------------------------------------------------------------

function pauseStubs(CB, over) {
  const o = Object.assign({ muted: false, music: true, calm: false }, over || {});
  CB.Audio = { isMuted: () => o.muted, play() {} };
  CB.Music = { isEnabled: () => o.music };
  CB.Comfort = Object.assign(CB.Comfort || {}, { calm: () => o.calm });
}

test('pause: the Rev 3 layout table, with every patch owned', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, C } = env;
  pauseStubs(CB);
  const run = mkRun(CB, { state: 'boss' });
  run.patches = { spread: 2, rapid: 1, pierce: 2, heavy: 1, heart: 2, dash: 1, ricochet: 1 };
  const rec = draw(env, 'pause', run, 0.5, { hover: -1 });
  const T = (s) => {
    const b = box(rec, s);
    assert.ok(b, 'missing: ' + s);
    return b;
  };
  const paused = T('PAUSED');
  assert.equal(paused.y, 14);
  assert.equal(paused.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(paused) - 160) <= 1);
  assert.equal(T('Esc: resume · Q: quit to title').y, 34);
  assert.equal(T('WASD move · Mouse aim · Click shoot').y, 48);
  assert.equal(T('Space dash · E /compact (meter full)').y, 57);
  // The status line is now three chips, each its own text on row 66 and centred in its fixed box (x 45 / 123 / 201, 74 wide).
  [['M sound: on', 45], ['N music: on', 123], ['V calm: off', 201]].forEach(([s, x]) => {
    assert.equal(T(s).y, 68, s);
    assert.ok(Math.abs(centreX(T(s)) - (x + 37)) <= 1, s + ' is centred in its chip');
  });
  assert.equal(CB.Screens.pause.CHIPS_Y, 68);
  assert.equal(T('patches').y, 82);
  const lines = ['Spread Shot ×2', 'Rapid Fire ×1', 'Pierce ×2', 'Heavy Bolts ×1', 'Extra Heart ×2', 'Quick Dash ×1', 'Ricochet ×1'];
  lines.forEach((s, i) => assert.equal(T(s).y, 91 + 9 * i, s));
  // The new quit button sits between the seventh patch line (ends at 152) and the footer (160), and its hit box holds the text.
  const quit = T('[ quit to title ]');
  assert.equal(quit.y, 152);
  assert.ok(Math.abs(centreX(quit) - 160) <= 1);
  assert.deepEqual(H.plain(CB.Screens.pause.QUIT_BOX), { x: 110, y: 150, w: 100, h: 10 });
  assert.ok(inBox(quit, CB.Screens.pause.QUIT_BOX), 'the box holds the text');
  assert.ok(T('Ricochet ×1').y + T('Ricochet ×1').h <= quit.y, 'the seventh patch line clears the quit button');
  assert.equal(T(DISCLAIMER).y, 160);
  assert.ok(Math.abs(centreX(T(DISCLAIMER)) - 160) <= 1);
  for (const s of lines) assert.ok(T(s).y + T(s).h < 160, s + ' clears the footer');
  assert.ok(quit.y + quit.h <= T(DISCLAIMER).y, 'the quit button clears the footer');
  assertLayout(rec, 'pause worst case');
  // The dim.
  assert.ok(env.log.rect.some((a) => a[0] === 0 && a[1] === 0 && a[2] === 320 && a[3] === 180 && a[4] === C.ink), 'full-screen ink');
});

test('pause: Press Q again to quit replaces the hint in gold while the quit is armed', () => {
  const env = setup({ stub: true });
  const { CB, C } = env;
  pauseStubs(CB);
  const run = mkRun(CB, { state: 'wave' });
  let rec = draw(env, 'pause', run, 0, { hover: -1, quitArmT: 1.2 });
  assert.ok(!strs(rec).includes('Esc: resume · Q: quit to title'));
  const armed = box(rec, 'Press Q again to quit');
  assert.ok(armed);
  assert.equal(armed.y, 34);
  assert.ok(env.log.text.some((a) => a[0] === 'Press Q again to quit' && a[3].color === C.gold));
  rec = draw(env, 'pause', run, 0, { hover: -1, quitArmT: 0 });
  assert.ok(strs(rec).includes('Esc: resume · Q: quit to title'));
  rec = draw(env, 'pause', run, 0);
  assert.ok(strs(rec).includes('Esc: resume · Q: quit to title'), 'no ui at all');
  rec = draw(env, 'pause', run, 0, null);
  assert.ok(strs(rec).includes('Esc: resume · Q: quit to title'));
  assertLayout(rec, 'pause');
});

test('pause: sound, music and calm chips show only for the modules that exist, in their current state', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const run = mkRun(CB, { state: 'wave' });
  // Was one status line ("M sound: off · N music: off · V calm: on"); each part is now its own chip, and a missing module's chip keeps its place.
  const status = () => strs(draw(env, 'pause', run, 0)).filter((s) => /sound|music|calm/.test(s));
  CB.Audio = undefined;
  CB.Music = undefined;
  CB.Comfort = undefined;
  assert.deepEqual(status(), [], 'no modules, no chips');
  pauseStubs(CB, { muted: true, music: false, calm: true });
  assert.deepEqual(status(), ['M sound: off', 'N music: off', 'V calm: on']);
  CB.Music = {}; // present but without the method
  assert.deepEqual(status(), ['M sound: off', 'V calm: on']);
  CB.Audio = { play() {} };
  assert.deepEqual(status(), ['V calm: on']);
  CB.Comfort = {};
  assert.deepEqual(status(), []);
  CB.Audio = { isMuted: () => false };
  assert.deepEqual(status(), ['M sound: on']);
  const rec = draw(env, 'pause', run, 0);
  assert.equal(box(rec, 'M sound: on').y, 68);
  assert.equal(overlapsOf(rec.texts()).length, 0);
});

test('pause: no patches yet, and the disclaimer is always sent to r.text', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  pauseStubs(CB);
  const run = mkRun(CB, { state: 'wave', patches: {} });
  const rec = draw(env, 'pause', run, 0, { hover: -1 });
  assert.ok(strs(rec).includes('patches'));
  assert.ok(strs(rec).includes(DISCLAIMER));
  assert.ok(env.log.text.some((a) => a[0] === DISCLAIMER), 'r.text received the disclaimer');
  assert.ok(strs(rec).includes('none yet'));
  assertLayout(rec, 'pause empty');
  // A patch count past its max or junk in the map draws nothing odd.
  run.patches = { spread: 99, bogus: 3, rapid: 'x', heart: -1 };
  const rec2 = draw(env, 'pause', run, 0);
  assert.ok(strs(rec2).includes('Spread Shot ×2'), 'clamped to the max');
  assert.ok(!strs(rec2).some((s) => /bogus|NaN|undefined/.test(s)));
  assertLayout(rec2, 'pause junk');
});

// ---- patchPick ----------------------------------------------------------------------------------------------------------------

test('patchPick: title, the lock dots, and cards that arrive 0.15 s apart', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const run = mkRun(CB, { stageIndex: 1, state: 'patchPick', offer: ['rapid', 'pierce', 'heart'], patches: { spread: 1 } });
  const D = CB.Patches.DEFS;
  let rec = draw(env, 'patchPick', run, 0.1, { hover: -1 });
  const title = box(rec, 'PR #2 — choose a patch');
  assert.ok(title, 'title');
  assert.equal(title.y, 24);
  assert.ok(Math.abs(centreX(title) - 160) <= 1);
  const dots = box(rec, '…');
  assert.ok(dots && dots.y > title.y + title.h, 'the lock dots sit under the title');
  assert.ok(box(rec, D.rapid.name));
  assert.ok(!box(rec, D.pierce.name) && !box(rec, D.heart.name), 'cards 1 and 2 have not arrived');
  rec = draw(env, 'patchPick', run, 0.2, { hover: -1 });
  assert.ok(box(rec, D.rapid.name) && box(rec, D.pierce.name));
  assert.ok(!box(rec, D.heart.name));
  rec = draw(env, 'patchPick', run, 0.35, { hover: -1 });
  assert.ok(box(rec, D.rapid.name) && box(rec, D.pierce.name) && box(rec, D.heart.name));
  assert.ok(box(rec, '…'), 'dots until 0.6 s');
  rec = draw(env, 'patchPick', run, 0.7, { hover: -1 });
  assert.ok(!box(rec, '…'), 'the lock is over');
  for (const k of ['[1]', '[2]', '[3]']) assert.ok(box(rec, k), k);
  // Stage 4 never offers, but a stage index still titles the card sensibly.
  const run3 = mkRun(CB, { stageIndex: 0, state: 'patchPick', offer: ['rapid'] });
  assert.ok(strs(draw(env, 'patchPick', run3, 1)).includes('PR #1 — choose a patch'));
});

test('patchPick: cards slide up 8 px into place by 0.6 s and lift 2 px when hovered', () => {
  const env = setup({ stub: true });
  const { CB, C } = env;
  const run = mkRun(CB, { state: 'patchPick', offer: ['rapid', 'pierce', 'heart'], patches: {} });
  const D = CB.Patches.DEFS;
  const nameY = (st, i, ui) => {
    const rec = draw(env, 'patchPick', run, st, ui || { hover: -1 });
    return box(rec, D[run.offer[i]].name).y;
  };
  const rest = [nameY(1, 0), nameY(1, 1), nameY(1, 2)];
  assert.equal(nameY(0, 0), rest[0] + 8, 'card 0 starts 8 px low');
  assert.ok(nameY(0.15, 0) < rest[0] + 8 && nameY(0.15, 0) > rest[0], 'and is mid-slide');
  assert.equal(nameY(0.3, 0), rest[0]);
  assert.equal(nameY(0.15, 1), rest[1] + 8, 'card 1 starts at 0.15 s');
  assert.equal(nameY(0.3, 2), rest[2] + 8, 'card 2 starts at 0.3 s');
  assert.equal(nameY(0.6, 2), rest[2], 'all in place by 0.6 s');
  // Hover: a 2 px gold frame and 2 px higher.
  const hovered = nameY(1, 1, { hover: 1 });
  assert.equal(hovered, rest[1] - 2);
  assert.equal(nameY(1, 0, { hover: 1 }), rest[0], 'the others stay');
  draw(env, 'patchPick', run, 1, { hover: 1 });
  const gold = env.log.frame.filter((a) => a[4] === C.gold);
  assert.equal(gold.length, 2, 'two nested 1 px frames make the 2 px gold frame');
  assert.equal(gold[0][2] - gold[1][2], 2);
  draw(env, 'patchPick', run, 1, { hover: -1 });
  assert.equal(env.log.frame.filter((a) => a[4] === C.gold).length, 0);
  // No highlight while the input lock is on, so the card does not look clickable before it is.
  draw(env, 'patchPick', run, 0.3, { hover: 1 });
  assert.equal(env.log.frame.filter((a) => a[4] === C.gold).length, 0);
});

test('patchPick: stack pips show owned plus the new one filled, the rest hollow; the icon is the patch sprite', () => {
  const env = setup({ stub: true });
  const { CB, C } = env;
  const run = mkRun(CB, { state: 'patchPick', offer: ['rapid', 'pierce', 'dash'], patches: { rapid: 1 } });
  draw(env, 'patchPick', run, 1, { hover: -1 });
  // rapid: max 2, owned 1 -> 2 filled. pierce: max 2, owned 0 -> 1 filled + 1 hollow. dash: max 1 -> 1 filled.
  assert.equal(env.log.disc.length, 4, 'filled pips');
  assert.equal(env.log.ring.length, 1, 'hollow pips');
  assert.equal(env.log.disc.filter((a) => a[3] === C.gold).length, 3, 'the new stack is gold');
  const icons = env.log.sprite.filter((a) => a[0].startsWith('patch_')).map((a) => [a[0], a[3].scale]);
  assert.deepEqual(icons, [['patch_rapid', 2], ['patch_pierce', 2], ['patch_dash', 2]]);
});

test('patchPick: names, descriptions and hints stay inside their card for every patch', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const ids = CB.Patches.ORDER;
  const P = CB.Screens.patchPick;
  for (let s = 0; s < ids.length; s++) {
    const offer = [ids[s], ids[(s + 1) % ids.length], ids[(s + 2) % ids.length]];
    const run = mkRun(CB, { state: 'patchPick', offer, patches: {} });
    const rec = draw(env, 'patchPick', run, 1, { hover: -1 });
    assertLayout(rec, 'offer ' + offer.join());
    const D = CB.Patches.DEFS;
    offer.forEach((id, i) => {
      const c = P.CARDS[i];
      const inside = rec.texts().filter((b) => centreX(b) > c.x && centreX(b) < c.x + c.w && b.y > 40);
      assert.ok(inside.length >= 3, `card ${i} has its name, description and hint`);
      for (const b of inside) assert.ok(b.x >= c.x + 2 && b.x + b.w <= c.x + c.w - 2 && b.y >= c.y && b.y + b.h <= c.y + c.h, `${id}: "${b.str}" fits card ${i}`);
      assert.ok(inside.some((b) => b.str === D[id].name));
      const sprite = rec.sprites().find((b) => b.name === 'patch_' + id);
      assert.ok(sprite && sprite.w === 24 && sprite.h === 24 && sprite.y >= c.y && sprite.y + sprite.h <= c.y + 40, 'the icon sits at the top');
      assert.ok(Math.abs(sprite.x + sprite.w / 2 - (c.x + c.w / 2)) <= 1, 'and is centred');
    });
  }
});

test('patchPick: a short offer draws fewer cards, and none draws just the title', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const run = mkRun(CB, { state: 'patchPick', offer: ['heart'], patches: {} });
  const rec = draw(env, 'patchPick', run, 1, { hover: 0 });
  assert.ok(box(rec, CB.Patches.DEFS.heart.name));
  assert.ok(!box(rec, '[2]'));
  run.offer = null;
  assert.doesNotThrow(() => draw(env, 'patchPick', run, 1, { hover: 0 }));
  run.offer = [];
  assert.doesNotThrow(() => draw(env, 'patchPick', run, 1, { hover: 2 }));
  run.offer = ['nonexistent', 'heart'];
  assert.doesNotThrow(() => draw(env, 'patchPick', run, 1, { hover: 0 }));
});

// ---- gameOver -----------------------------------------------------------------------------------------------------------------

test('gameOver: the crash text, path, deaths, a dead quip, and hints only after the input lock', () => {
  const env = setup({ stub: true, extra: [QUIPS] });
  const { CB, C } = env;
  const run = mkRun(CB, { stageIndex: 0, state: 'dead', deaths: 3 });
  let rec = draw(env, 'gameOver', run, 0.3);
  const seg = box(rec, 'Segmentation fault');
  assert.ok(seg);
  assert.equal(seg.y, 56);
  assert.equal(seg.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(seg) - 160) <= 1);
  assert.ok(env.log.text.some((a) => a[0] === 'Segmentation fault' && a[3].color === C.hurt));
  assert.equal(box(rec, '(core dumped)').y, 76);
  assert.equal(box(rec, 'Clawd crashed in ~/src/').y, 92);
  assert.equal(box(rec, 'deaths: 3').y, 104);
  const quip = CB.Quips.dead[(3 * 3 + 0) % CB.Quips.dead.length];
  assert.equal(box(rec, quip).y, 114);
  assert.ok(env.log.text.some((a) => a[0] === quip && a[3].color === C.grey));
  assert.ok(!strs(rec).some((s) => /retry|quit/.test(s)), 'no hints while the input is locked');
  rec = draw(env, 'gameOver', run, 0.7);
  assert.equal(box(rec, 'R / click: retry stage').y, 124);
  assert.equal(box(rec, 'Q: quit to title').y, 136);
  assert.deepEqual(H.plain(CB.Screens.gameOver.QUIT_BOX), { x: 100, y: 133, w: 120, h: 11 });
  assert.ok(inBox(box(rec, 'Q: quit to title'), CB.Screens.gameOver.QUIT_BOX), 'the tap box holds the quit line');
  assertLayout(rec, 'gameOver');
  // The quip moves with the death count and the stage.
  const run2 = mkRun(CB, { stageIndex: 2, state: 'dead', deaths: 4 });
  const q2 = CB.Quips.dead[(4 * 3 + 2) % CB.Quips.dead.length];
  assert.ok(strs(draw(env, 'gameOver', run2, 1)).includes(q2));
  assert.ok(strs(draw(env, 'gameOver', run2, 1)).includes('Clawd crashed in ~/.git/'));
});

test('gameOver: the retry hint follows the checkpoint', () => {
  const env = setup({ stub: true });
  const { CB } = env;
  const base = mkRun(CB, { state: 'dead', deaths: 1 });
  const hint = (run) => strs(draw(env, 'gameOver', run, 1)).find((s) => s.startsWith('R / click'));
  assert.equal(hint(withCheckpoint(base, 'boss')), 'R / click: retry boss');
  assert.equal(hint(withCheckpoint(base, 'wave2')), 'R / click: retry wave 2');
  assert.equal(hint(withCheckpoint(base, 'stage')), 'R / click: retry stage');
  assert.equal(hint(withCheckpoint(base, undefined)), 'R / click: retry stage');
  // A run that only carries diedInBoss (older state) still gets the boss hint.
  const old = { state: 'dead', stateT: 1, stageIndex: 0, deaths: 1, diedInBoss: true };
  assert.equal(hint(old), 'R / click: retry boss');
  assert.equal(hint({ state: 'dead', stateT: 1, stageIndex: 0, deaths: 1, diedInBoss: false }), 'R / click: retry stage');
});

test('gameOver: a real run that dies reads its own checkpoint (stage, wave 2, boss)', () => {
  const env = setup({ real: true });
  const { CB } = env;
  // Plays idle ticks until `until` holds (clearing the bugs every tick so the waves finish), then kills Clawd and waits for 'dead'.
  const killIn = (run, until) => {
    for (let i = 0; i < 4000 && !until(run); i++) {
      if (run.state === 'wave') run.world.killAllEnemies();
      run.step(H.makeInput());
    }
    assert.ok(until(run), 'reached the state, now ' + run.state);
    run.world.player.dead = true;
    for (let i = 0; i < 200 && run.state !== 'dead'; i++) run.step(H.makeInput());
    assert.equal(run.state, 'dead');
    return run;
  };
  const hint = (run) => strs(draw(env, 'gameOver', run, 1)).find((s) => s.startsWith('R / click'));
  const a = killIn(CB.createRun({ seed: 3, god: false }), (r) => r.state === 'wave' && r.waveIndex === 0);
  assert.equal(a.checkpoint, 'stage');
  assert.equal(hint(a), 'R / click: retry stage');
  const b = killIn(CB.createRun({ seed: 3 }), (r) => r.state === 'wave' && r.waveIndex === 1);
  assert.equal(b.checkpoint, 'wave2');
  assert.equal(hint(b), 'R / click: retry wave 2');
  const c = killIn(CB.createRun({ seed: 3, skipWaves: true }), (r) => r.state === 'boss');
  assert.equal(c.checkpoint, 'boss');
  assert.equal(hint(c), 'R / click: retry boss');
});

// ---- victory ------------------------------------------------------------------------------------------------------------------

function victoryRun(CB, over) {
  return mkRun(CB, Object.assign({
    stageIndex: 3, state: 'victory', seed: 7, deaths: 3, time: 61.9, bossesFixed: 4,
    history: ['spread', 'rapid', 'spread'],
    squashed: { syntaxError: 12, nullPointer: 7, raceCondition: 5, memoryLeak: 9, offByOne: 4 },
  }, over || {}));
}

test('victory: the Rev 3 layout table with a full tally and four fixes', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB, C } = env;
  const run = victoryRun(CB);
  const rec = draw(env, 'victory', run, 3);
  const T = (s) => {
    const b = box(rec, s);
    assert.ok(b, 'missing: ' + s);
    return b;
  };
  const title = T('ALL TESTS PASSING ✓');
  assert.equal(title.y, 6);
  assert.equal(title.h, 14, 'scale 2');
  assert.ok(Math.abs(centreX(title) - 160) <= 1);
  assert.ok(env.log.text.some((a) => a[0] === 'ALL TESTS PASSING ✓' && a[3].color === C.green));
  const quip = CB.Quips.victory[(3 + 3) % CB.Quips.victory.length];
  assert.equal(T(quip).y, 23);
  assert.ok(env.log.text.some((a) => a[0] === quip && a[3].color === C.grey));
  assert.equal(T('time 01:01 · deaths 3').y, 62);
  assert.equal(T('patches: Spread Shot ×2, Rapid Fire').y, 71);
  // Clawd: happy, scale 2, centred at (160, 44), hopping up by at most 4 px.
  const clawd = rec.sprites().filter((b) => /^clawd_idle[01]_happy$/.test(b.name));
  assert.equal(clawd.length, 1, 'one happy Clawd');
  assert.equal(clawd[0].w, 32);
  assert.equal(clawd[0].h, 24);
  assert.ok(Math.abs(centreX(clawd[0]) - 160) <= 1);
  assert.ok(clawd[0].y >= 28 && clawd[0].y <= 32, 'hop box ' + clawd[0].y);
  // The tally: 5 cells, 56 px apart, sprite on top (<= 12 px), xN beneath, all within y 82..102.
  const cells = rec.sprites().filter((b) => /_0$/.test(b.name) && !b.name.startsWith('clawd'));
  assert.deepEqual(cells.map((b) => b.name), KINDS.map((k) => k + '_0'));
  for (let i = 1; i < cells.length; i++) assert.equal(Math.round(centreX(cells[i]) - centreX(cells[i - 1])), 56);
  assert.ok(Math.abs(centreX(cells[2]) - 160) <= 1, 'the row is centred');
  KINDS.forEach((k, i) => {
    const n = run.squashed[k];
    const label = T('x' + n);
    assert.equal(label.y, 95);
    assert.ok(Math.abs(centreX(label) - centreX(cells[i])) <= 1, 'count centred under its sprite');
    assert.ok(cells[i].h <= 12 && cells[i].y >= 82 && cells[i].y + cells[i].h <= label.y, k + ' sprite above its count');
    assert.ok(label.y + label.h <= 102);
  });
  // git log: header at 106, four lines at x 40 from 115 in steps of 9.
  assert.equal(T('git log --oneline').y, 106);
  CB.STAGES.forEach((stage, i) => {
    const line = CB.Screens.victory.commitHash(7, i) + ' ' + CB.Bosses[stage.boss].commitMsg;
    const b = T(line);
    assert.equal(b.x, 40, 'log lines start at x 40');
    assert.equal(b.y, 115 + 9 * i);
    assert.ok(env.log.text.some((a) => a[0] === line && a[3].color === C.grey));
  });
  assert.equal(T(DISCLAIMER).y, 152);
  assert.equal(T('Click to play again').y, 160);
  assert.ok(env.log.text.some((a) => a[0] === DISCLAIMER), 'r.text received the disclaimer');
  assertLayout(rec, 'victory');
});

test('victory: Click to play again waits for 1.5 s and blinks; nothing else stays hidden', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB } = env;
  const run = victoryRun(CB);
  assert.ok(!box(draw(env, 'victory', run, 1.4), 'Click to play again'));
  assert.ok(!box(draw(env, 'victory', run, 1.5), 'Click to play again'), 'play.js accepts the click strictly after 1.5 s');
  const on = [];
  for (let st = 1.6; st < 3.6; st += 0.05) on.push(!!box(draw(env, 'victory', run, st), 'Click to play again'));
  assert.ok(on.some((v) => v) && on.some((v) => !v), 'it blinks');
});

test('victory: fewer tally kinds, no fixes and an empty history still lay out', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB } = env;
  const cases = [
    { squashed: {}, bossesFixed: 0, history: [] },
    { squashed: { syntaxError: 3 }, bossesFixed: 1, history: [] },
    { squashed: { offByOne: 2, memoryLeak: 100000 }, bossesFixed: 2, history: ['heart'] },
    { squashed: { bogus: 4, syntaxError: 0, nullPointer: -2 }, bossesFixed: 4, history: ['nonsense'] },
    { squashed: undefined, bossesFixed: undefined, history: undefined },
  ];
  for (const c of cases) {
    const run = victoryRun(CB, c);
    for (const st of [0, 0.4, 1.7, 5]) assertLayout(draw(env, 'victory', run, st), JSON.stringify(c) + '@' + st);
  }
  const rec = draw(env, 'victory', victoryRun(CB, cases[0]), 3);
  assert.ok(strs(rec).includes('patches: none'));
  assert.deepEqual(rec.sprites().filter((b) => !b.name.startsWith('clawd')).map((b) => b.name), [], 'no tally sprites');
  const one = draw(env, 'victory', victoryRun(CB, cases[1]), 3);
  assert.equal(one.sprites().filter((b) => /_0$/.test(b.name) && !b.name.startsWith('clawd')).length, 1);
  assert.equal(strs(one).filter((s) => /^[0-9a-f]{7} /.test(s)).length, 1, 'one fix, the last stage boss');
  assert.ok(strs(one).some((s) => s.endsWith(CB.Bosses.heisenbug.commitMsg)));
});

test('victory: a long patches line is shortened to fit, never dropped off the screen', () => {
  const env = setup({ real: true });
  const { CB } = env;
  const run = victoryRun(CB, { history: ['spread', 'rapid', 'pierce', 'heavy', 'heart', 'dash', 'ricochet', 'spread', 'rapid', 'pierce', 'heavy', 'heart'] });
  const rec = draw(env, 'victory', run, 3);
  const line = rec.texts().find((b) => b.str.startsWith('patches:'));
  assert.ok(line.x >= 4 && line.x + line.w <= 316, 'fits with a margin');
  assertLayout(rec, 'long patches line');
});

test('victory: confetti falls in the side margins, inside the screen and clear of every text', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  const { CB } = env;
  const run = victoryRun(CB);
  let sawAny = false;
  for (let st = 0.2; st < 12; st += 0.37) {
    const rec = draw(env, 'victory', run, st);
    const bits = rec.texts().filter((b) => b.str === '✻');
    const other = noConfetti(rec);
    sawAny = sawAny || bits.length > 0;
    assert.ok(bits.length <= 24, 'at most 24 pieces');
    for (const b of bits) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 320 && b.y + b.h <= 180, `piece at ${b.x},${b.y} on screen`);
      for (const o of other) assert.ok(!(b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h), `piece at ${b.x},${b.y} over "${o.str}"`);
    }
  }
  assert.ok(sawAny, 'confetti exists');
  // Colours: gold, spark and clawd.
  draw(env, 'victory', run, 5);
  const colours = new Set(env.log.text.filter((a) => a[0] === '✻').map((a) => a[3].color));
  assert.deepEqual([...colours].sort(), [env.C.clawd, env.C.gold, env.C.spark].sort());
  // Deterministic: the same time draws the same pieces.
  draw(env, 'victory', run, 5);
  const a = JSON.stringify(env.log.text.filter((x) => x[0] === '✻').map((x) => [x[1], x[2]]));
  draw(env, 'victory', run, 5);
  assert.equal(JSON.stringify(env.log.text.filter((x) => x[0] === '✻').map((x) => [x[1], x[2]])), a);
});

test('victory: Clawd hops with abs(sin(6t)) * 4 and wears the hat, clear of the quip line', () => {
  const mem = {};
  const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const env = setup({ real: true, extra: [QUIPS, UNLOCKS], localStorage: store });
  const { CB } = env;
  const run = victoryRun(CB);
  const clawdY = (st) => {
    const rec = draw(env, 'victory', run, st);
    const c = rec.sprites().find((b) => /^clawd_idle[01]_happy$/.test(b.name));
    return c.y + c.h / 2;
  };
  const REST = Math.PI / 6; // abs(sin(6t)) is 0 here, and Clawd has faded in
  const base = clawdY(REST);
  assert.ok(Math.abs(base - 44) <= 1, 'rests at y 44');
  let top = 0;
  for (let st = 0.5; st < 3; st += 0.02) top = Math.max(top, base - clawdY(st));
  assert.ok(top > 2.5 && top <= 4.5, 'hops up to about 4 px: ' + top);
  // With a hat: the hat sprite is drawn on Clawd's head and nothing of it climbs into the quip line.
  CB.Unlocks.unlock('crown');
  CB.Unlocks.setHat('crown');
  const quip = CB.Quips.victory[(3 + 3) % CB.Quips.victory.length];
  let maxOverlap = 0;
  let sawHat = false;
  for (let st = 0.3; st < 3; st += 0.02) {
    const rec = draw(env, 'victory', run, st);
    const hat = rec.sprites().find((b) => b.name === 'hat_crown');
    const q = box(rec, quip);
    if (!hat) continue;
    sawHat = true;
    const c = rec.sprites().find((b) => /^clawd_idle[01]_happy$/.test(b.name));
    assert.ok(Math.abs(centreX(hat) - 160) <= 2 && hat.y + hat.h <= c.y + 8, 'the hat sits on the head');
    maxOverlap = Math.max(maxOverlap, Math.min(hat.y + hat.h, q.y + q.h) - Math.max(hat.y, q.y));
    assertLayout(rec, 'victory with hat @' + st);
  }
  assert.ok(sawHat, 'the worn hat is drawn');
  assert.ok(maxOverlap <= 4, 'the hat tip may brush the quip line by a few rows at the top of a hop, no more: ' + maxOverlap);
  // At rest, no overlap at all.
  const rest = draw(env, 'victory', run, REST);
  const hat0 = rest.sprites().find((b) => b.name === 'hat_crown');
  assert.ok(hat0.y >= box(rest, quip).y + 7, 'at rest the hat is below the quip');
});

// ---- victory: the share button, the daily build line and the bottom row ----------------------------------------------------------

const SHARE_JS = 'src/core/share.js';
const SHARE_LABEL = { kbm: '[ copy result ] (C)', touch: '[ share result ]', pad: '[ X: copy result ]' };
const AGAIN_LABEL = { kbm: 'Click to play again', touch: 'Tap to play again', pad: 'Press A to play again' };
const DEVICES = ['kbm', 'touch', 'pad'];
const touchesBox = (b, hit) => b.x < hit.x + hit.w && hit.x < b.x + b.w && b.y < hit.y + hit.h && hit.y < b.y + b.h;
const shareEnv = (dev) => {
  const env = setup({ real: true, extra: [QUIPS, SHARE_JS] });
  env.CB.Prompts.setDevice(dev || 'kbm');
  return env;
};

test('victory share: the button shows with the play-again prompt, does not blink, and the rows above it have not moved', () => {
  const env = shareEnv('kbm');
  const { CB, C } = env;
  const run = victoryRun(CB);
  const SH = SHARE_LABEL.kbm;
  assert.ok(!box(draw(env, 'victory', run, 1.4), SH), 'hidden at 1.4');
  assert.ok(!box(draw(env, 'victory', run, 1.5), SH), 'and at exactly 1.5: play.js accepts the share strictly after it, like the click');
  const shows = [];
  const agains = [];
  for (let st = 1.6; st < 3.6; st += 0.05) {
    const rec = draw(env, 'victory', run, st);
    shows.push(!!box(rec, SH));
    agains.push(!!box(rec, AGAIN_LABEL.kbm));
  }
  assert.ok(shows.every((v) => v), 'the share button never blinks');
  assert.ok(agains.some((v) => v) && agains.some((v) => !v), 'the play-again prompt does');
  const rec = draw(env, 'victory', run, 2.0);
  const share = box(rec, SH);
  const again = box(rec, AGAIN_LABEL.kbm);
  assert.equal(share.y, 160);
  assert.equal(again.y, 160, 'one row');
  assert.equal(share.x + share.w, 154, 'the button ends left of the gutter');
  assert.equal(again.x, 166, 'the prompt starts right of it');
  assert.ok(env.log.text.some((a) => a[0] === SH && a[3].color === C.pale && a[3].align === 'right'));
  assert.ok(env.log.text.some((a) => a[0] === AGAIN_LABEL.kbm && a[3].color === C.white));
  // Everything above the row is where it was.
  assert.equal(box(rec, DISCLAIMER).y, 152);
  assert.equal(box(rec, 'git log --oneline').y, 106);
  CB.STAGES.forEach((stage, i) => assert.equal(box(rec, CB.Screens.victory.commitHash(7, i) + ' ' + CB.Bosses[stage.boss].commitMsg).y, 115 + 9 * i));
  assert.equal(box(rec, 'time 01:01 · deaths 3').y, 62);
  assert.ok(share.y + share.h < 169 && again.y + again.h < 169, 'both clear the toast band (y 169-180)');
  assertLayout(rec, 'victory with share');
});

test('victory share: SHARE_BOX is frozen, holds the label on every device, touches no other text and stays above the toast band', () => {
  for (const dev of DEVICES) {
    const env = shareEnv(dev);
    const S = env.CB.Screens.victory.SHARE_BOX;
    assert.ok(Object.isFrozen(S));
    assert.deepEqual(H.plain(S), { x: 70, y: 159, w: 88, h: 10 });
    assert.ok(S.x >= 0 && S.y >= 0 && S.x + S.w <= 320 && S.y + S.h <= 169, 'on screen, above the toast band');
    const run = victoryRun(env.CB);
    for (const st of [1.6, 2.1, 3.1]) {
      const rec = draw(env, 'victory', run, st);
      const label = box(rec, SHARE_LABEL[dev]);
      assert.ok(label, dev + ' label at ' + st);
      assert.ok(inBox(label, S), `${dev}: the label (${label.x},${label.y} ${label.w}x${label.h}) is inside the box`);
      const others = rec.texts().filter((b) => b !== label && b.str !== '✻' && touchesBox(b, S));
      assert.deepEqual(others.map((b) => b.str), [], dev + ': no other text touches the box');
    }
  }
});

test('victory share: the box fits the widest label closely and the labels each fit it with room to spare for a thumb', () => {
  const env = shareEnv('kbm');
  const S = env.CB.Screens.victory.SHARE_BOX;
  const widest = Math.max(...DEVICES.map((d) => env.CB.Font.measure(SHARE_LABEL[d], 1)));
  assert.ok(widest <= S.w && S.w - widest <= 12, `box ${S.w} px for a ${widest} px label`);
  assert.ok(S.h >= 8 && S.h <= 12, 'about a text row tall');
});

test('victory share: a pad shows its X button, a phone its tap label, and each device only its own', () => {
  for (const dev of DEVICES) {
    const env = shareEnv(dev);
    const rec = draw(env, 'victory', victoryRun(env.CB), 2.1);
    for (const other of DEVICES.filter((d) => d !== dev)) assert.ok(!box(rec, SHARE_LABEL[other]), dev + ' shows no ' + other + ' label');
    assert.ok(box(rec, SHARE_LABEL[dev]), dev);
  }
});

test('victory share: without CB.Share there is no button and the prompt is centred as before', () => {
  const env = setup({ real: true, extra: [QUIPS] });
  assert.equal(env.CB.Share, undefined);
  const run = victoryRun(env.CB);
  let seen = false;
  for (let st = 1.6; st < 3.6; st += 0.05) {
    const rec = draw(env, 'victory', run, st);
    assert.ok(!strs(rec).some((s) => /result/.test(s)), 'no share label');
    const b = box(rec, 'Click to play again');
    if (b) {
      seen = true;
      assert.equal(b.y, 160);
      assert.ok(Math.abs(centreX(b) - 160) <= 1);
    }
  }
  assert.ok(seen);
});

test('victory daily: the date shows in gold at the right end of the log header row, only when run.daily is a string', () => {
  for (const dev of DEVICES) {
    const env = shareEnv(dev);
    const { CB, C } = env;
    const daily = victoryRun(CB, { daily: '2026-10-13' });
    const rec = draw(env, 'victory', daily, 3);
    const line = box(rec, 'daily build 2026-10-13');
    assert.ok(line, dev);
    assert.ok(env.log.text.some((a) => a[0] === 'daily build 2026-10-13' && a[3].color === C.gold), 'gold');
    const head = box(rec, 'git log --oneline');
    assert.equal(line.y, head.y, 'the same row as the log header');
    assert.equal(line.x + line.w, 280, 'right-aligned to the mirror of the log margin');
    assert.ok(line.x >= head.x + head.w + 8, 'clear of the header text');
    assert.ok(line.x + line.w <= 285 && line.x >= 4, 'inside the confetti margins');
    assertLayout(rec, 'daily ' + dev);
    for (const none of [null, undefined, '', 5, true, {}, ['2026-10-13']]) {
      const rec2 = draw(env, 'victory', victoryRun(CB, { daily: none }), 3);
      assert.ok(!strs(rec2).some((s) => /daily/.test(s)), `${dev}: daily ${JSON.stringify(none)} shows nothing`);
    }
  }
});

test('victory daily: every combination of device, daily, fix count and time lays out with no overlap and nothing off screen', () => {
  for (const dev of DEVICES) {
    const env = shareEnv(dev);
    const { CB } = env;
    for (const daily of [null, '2026-10-13']) {
      for (const fixed of [0, 1, 2, 3, 4]) {
        const run = victoryRun(CB, { daily, bossesFixed: fixed, history: ['spread', 'rapid', 'pierce', 'heavy', 'heart', 'dash', 'ricochet'] });
        for (const st of [0, 0.6, 1.2, 1.6, 2.1, 2.6, 5]) assertLayout(draw(env, 'victory', run, st), `${dev} daily=${daily} fixed=${fixed} @${st}`);
      }
    }
  }
});

test('victory daily: the bottom row, the log lines and the toast band never share a pixel', () => {
  const env = shareEnv('pad');
  const { CB } = env;
  const run = victoryRun(CB, { daily: '2026-10-13' });
  const rec = draw(env, 'victory', run, 2.1);
  const TOAST_BAND = { x: 0, y: 169, w: 320, h: 11 }; // play.js: TOAST_Y 171, the band starts two above it
  const others = noConfetti(rec).filter((b) => touchesBox(b, TOAST_BAND));
  assert.deepEqual(others.map((b) => b.str), [], 'no text reaches the toast band');
  const last = Math.max(...CB.STAGES.map((s, i) => 115 + 9 * i + 7));
  assert.ok(last <= box(rec, DISCLAIMER).y - 1, 'the last log line ends above the disclaimer');
});

test('victory patches: the line counts what the run holds, so a daily build starts with its patch on the receipt', () => {
  const env = shareEnv('kbm');
  const { CB } = env;
  const line = (run) => noConfetti(draw(env, 'victory', victoryRun(CB, run), 3)).map((b) => b.str).find((s) => s.startsWith('patches:'));
  // A daily run starts holding a patch it never picked: it leads, then the picks follow.
  assert.equal(line({ patches: { rapid: 1, spread: 1 }, history: ['spread'] }), 'patches: Rapid Fire, Spread Shot');
  assert.equal(line({ patches: { rapid: 1 }, history: ['rapid', 'rapid'] }), 'patches: Rapid Fire ×2', 'history ahead of what is held counts too');
  // A plain run holds exactly its picks, so the line is the one it always was.
  assert.equal(line({ patches: { spread: 2, rapid: 1 }, history: ['spread', 'rapid', 'spread'] }), 'patches: Spread Shot ×2, Rapid Fire');
  assert.equal(line({ patches: {}, history: ['spread', 'rapid', 'spread'] }), 'patches: Spread Shot ×2, Rapid Fire');
  assert.equal(line({ patches: { spread: 1, rapid: 1 }, history: [] }), 'patches: Spread Shot, Rapid Fire');
  assert.equal(line({ patches: undefined, history: undefined }), 'patches: none');
  assert.equal(line({ patches: null, history: ['spread'] }), 'patches: Spread Shot');
  assert.equal(line({ patches: { rapid: NaN, spread: -1, heavy: 'x' }, history: [] }), 'patches: none', 'junk counts are nothing');
});

// ---- calm mode ----------------------------------------------------------------------------------------------------------------

function calmStore(value) {
  const mem = { 'cb.calm': JSON.stringify(value) };
  return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
}

test('calm mode: the portrait fringe, the game-over shake and the confetti all slow down', () => {
  const calm = setup({ real: true, extra: [UNLOCKS, COMFORT, QUIPS], localStorage: calmStore(true) });
  const lively = setup({ real: true, extra: [UNLOCKS, COMFORT, QUIPS], localStorage: calmStore(false) });
  assert.equal(calm.CB.Comfort.calm(), true);
  assert.equal(lively.CB.Comfort.calm(), false);
  // The fringe swaps sides 20 times a second, or at most 4 in calm mode.
  const fringe = (env, st) => {
    const run = mkRun(env.CB, { stageIndex: 0, state: 'bossWarn', warnT: 2.5 });
    draw(env, 'bossWarn', run, st);
    return env.log.sprite.filter((a) => a[0].startsWith('warn_')).map((a) => a[1]);
  };
  assert.notDeepEqual(fringe(lively, 1.0), fringe(lively, 1.06), 'lively: flips within 60 ms');
  assert.deepEqual(fringe(calm, 1.0), fringe(calm, 1.06), 'calm: holds for 250 ms');
  assert.notDeepEqual(fringe(calm, 1.0), fringe(calm, 1.3), 'calm: still flips at 4 Hz');
  // The game-over heading shakes only when lively.
  const headX = (env, st) => {
    const run = mkRun(env.CB, { state: 'dead', deaths: 1 });
    const b = box(draw(env, 'gameOver', run, st), 'Segmentation fault');
    return b.x;
  };
  assert.notEqual(headX(lively, 0.03), headX(lively, 0.04), 'lively: the heading jumps');
  assert.equal(headX(calm, 0.03), headX(calm, 0.04), 'calm: it stays put');
  // Confetti falls slower.
  const fall = (env) => {
    const run = victoryRun(env.CB);
    const at = (st) => {
      draw(env, 'victory', run, st);
      return env.log.text.filter((a) => a[0] === '✻').map((a) => a[2]);
    };
    // The median over the pieces is not thrown by the few that wrap from the bottom to the top (or fade out) in between.
    const a = at(5);
    const b = at(5.4);
    assert.ok(a.length > 12 && b.length > 12, 'most pieces are showing');
    const moved = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) moved.push(Math.abs(b[i] - a[i]));
    return moved.sort((x, y) => x - y)[moved.length >> 1];
  };
  assert.ok(fall(calm) < fall(lively) * 0.6, 'calm confetti moves less');
});

// ---- panic --------------------------------------------------------------------------------------------------------------------

test('panic: heading, wrapped message (6 lines max), first src/ stack line and the reload hint', () => {
  const env = setup({ stub: true });
  const { CB, rec } = env;
  const long = 'TypeError: cannot read properties of undefined (reading x) '.repeat(12);
  const err = new Error(long);
  err.stack = 'Error: boom\n    at Object.f (http://localhost:8000/lib/other.js:1:1)\n    at Object.update (http://localhost:8000/src/game/world.js:123:45)\n    at loop (http://localhost:8000/src/core/loop.js:9:9)';
  CB.Screens.panic.draw(env.r, err);
  const texts = rec.texts();
  const head = texts.find((b) => b.str === 'KERNEL PANIC');
  assert.ok(head);
  assert.equal(head.x, 16);
  assert.equal(head.y, 16);
  assert.equal(head.h, 14, 'scale 2');
  const hint = texts.find((b) => b.str === 'Press R to reload');
  assert.ok(hint);
  assert.equal(hint.y, 160);
  const msg = texts.filter((b) => b.y >= 40 && b.y < 100 && b !== hint);
  assert.ok(msg.length >= 2 && msg.length <= 7, 'message lines plus the stack line: ' + msg.length);
  for (const b of texts) assert.ok(b.x >= 0 && b.x + b.w <= 320 && b.y + b.h <= 180, b.str + ' on screen');
  for (const b of msg) assert.ok(b.w <= 288, `"${b.str}" wrapped to 288 px`);
  assert.ok(texts.filter((b) => b.y >= 40 && b.y < 94).length <= 6, 'at most 6 message lines');
  const stackLine = texts.find((b) => /src\/game\/world\.js/.test(b.str));
  assert.ok(stackLine, 'the first frame that names src/');
  assert.ok(!texts.some((b) => /other\.js|loop\.js/.test(b.str)), 'only the first one');
  assert.ok(stackLine.y > Math.max(...msg.filter((b) => b !== stackLine).map((b) => b.y)), 'under the message');
  assert.ok(env.log.text.some((a) => a[0] === stackLine.str && a[3].color === CB.Pal.C.grey));
  assert.ok(env.log.text.some((a) => a[0] === 'KERNEL PANIC' && a[3].color === '#FF6B6B'));
});

test('panic: clears to #0A0A14 and survives a missing font, a missing ctx and a hostile error', () => {
  const env = setup({ stub: true });
  const { CB, r } = env;
  const cleared = [];
  const origClear = r.clear;
  r.clear = (c) => {
    cleared.push(c);
    return origClear.call(r, c);
  };
  CB.Screens.panic.draw(r, new Error('x'));
  assert.deepEqual(cleared, ['#0A0A14']);
  // No font: r.text throws inside the renderer, so the plain ctx path paints instead.
  const filled = [];
  r.ctx.fillText = (s) => filled.push(String(s));
  delete CB.Font;
  assert.doesNotThrow(() => CB.Screens.panic.draw(r, new Error('no font here')));
  assert.ok(filled.includes('KERNEL PANIC'), 'fallback heading: ' + filled.join('|'));
  assert.ok(filled.some((s) => s.includes('no font here')), 'fallback message');
  assert.ok(filled.includes('Press R to reload'));
  // A renderer with no usable ctx at all, and errors whose fields throw.
  assert.doesNotThrow(() => CB.Screens.panic.draw({}, new Error('x')));
  assert.doesNotThrow(() => CB.Screens.panic.draw(null, new Error('x')));
  const hostile = {
    get message() { throw new Error('getter'); },
    get stack() { throw new Error('getter'); },
  };
  assert.doesNotThrow(() => CB.Screens.panic.draw(r, hostile));
  assert.doesNotThrow(() => CB.Screens.panic.draw(r, undefined));
});
