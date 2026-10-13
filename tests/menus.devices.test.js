'use strict';
// Menus and screens per input device (keyboard + mouse, touch, pad): every prompt, the sound / music / calm chips, the pause and game-over
// tap boxes, the patch-pick hint, the panic text, and the title's pad edges, taps and fullscreen request. The whole script list is loaded,
// so the real CB.Prompts, CB.Screens and CB.Scenes.title are under test; Audio, Music and Comfort are stubs unless a test says otherwise.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const DEVICES = ['kbm', 'touch', 'pad'];
const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
const PAD0 = { a: false, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false };

// ---- fixture ----------------------------------------------------------------------------------------------------------------------

// A renderer on the stub canvas with the layout recorder, a log of r.text calls ([str, opts]) and of r.frame calls, a game for the title,
// and stubs for the modules the chips talk to. `dev` is the starting device.
function setup(dev, over) {
  const o = over || {};
  const { CB, sandbox } = H.load(o.files, { returnSandbox: true });
  const env = { CB, sandbox, C: CB.Pal.C, visits: [], sounds: [], cursor: [], fullscreen: 0, aim: { x: 0, y: 0 }, texts: [], frames: [] };
  env.r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  env.r.resize();
  env.rec = H.recorder(env.r, CB);
  const text = env.r.text;
  env.r.text = function (str, x, y, opts) {
    env.texts.push([String(str), opts || {}, y]);
    return text.apply(this, arguments);
  };
  const frame = env.r.frame;
  env.r.frame = function (x, y, w, h, color) {
    env.frames.push({ x, y, w, h, color });
    return frame.apply(this, arguments);
  };
  env.state = { muted: false, music: true, calm: false };
  CB.Audio = { play: (n) => env.sounds.push(n), isMuted: () => env.state.muted, toggleMute: () => (env.state.muted = !env.state.muted) };
  CB.Music = { stop() {}, isEnabled: () => env.state.music, toggle: () => (env.state.music = !env.state.music) };
  CB.Comfort = { calm: () => env.state.calm, toggle: () => (env.state.calm = !env.state.calm), blink: () => true };
  CB.Screens.hud = { cursor: (r, x, y, mode, t) => env.cursor.push({ x, y, mode, t }) };
  env.game = {
    go: (n, d) => env.visits.push([n, H.plain(d)]),
    input: { peekAim: () => env.aim, device: dev, requestFullscreenOnRelease: () => { env.fullscreen++; } },
    debug: {},
  };
  env.title = CB.Scenes.title;
  device(env, dev);
  return env;
}

// The device Clawd is played on, as input.js keeps it: in CB.Prompts and on game.input.
function device(env, dev) {
  env.CB.Prompts.setDevice(dev);
  env.game.input.device = dev;
}

// A real run (so every field the screens read exists), fields overridden.
function mkRun(CB, over) {
  const run = CB.createRun({ seed: 7 });
  return Object.assign(run, over || {});
}

const strs = (rec) => rec.texts().map((b) => b.str);
const box = (rec, s) => rec.texts().find((b) => b.str === s);
const centreX = (b) => b.x + b.w / 2;
const inBox = (b, hit) => b.x >= hit.x && b.x + b.w <= hit.x + hit.w && b.y >= hit.y && b.y + b.h <= hit.y + hit.h;
const touches = (b, hit) => b.x < hit.x + hit.w && hit.x < b.x + b.w && b.y < hit.y + hit.h && hit.y < b.y + b.h;
function assertLayout(rec, label) {
  assert.deepEqual(rec.outside().map((b) => b.str || b.name), [], label + ': off screen');
  assert.deepEqual(rec.overlaps().map((p) => p[0].str + ' / ' + p[1].str), [], label + ': overlapping text');
}

// One screen drawn with a clean recorder. `ui` is what play.js passes.
function drawScreen(env, name, run, st, ui) {
  env.rec.clear();
  env.texts.length = 0;
  env.frames.length = 0;
  run.stateT = st;
  env.CB.Screens[name].draw(env.r, run, st, ui);
  return env.rec;
}

// The title, entered fresh and past its input lock unless `locked`.
function enterTitle(env, o) {
  const opt = o || {};
  env.CB.Unlocks = fakeUnlocks(env, opt);
  env.title.enter(env.game, {});
  if (!opt.locked) tick(env, 20);
  return env;
}

function fakeUnlocks(env, o) {
  const s = { modes: !!o.modes, hats: o.hats || [], worn: o.worn || null, cycles: [] };
  env.unlocks = s;
  env.CB.HATS = [{ id: 'loopcap', name: 'Loop cap' }, { id: 'halo', name: 'Halo' }];
  return {
    has: (id) => (id === 'modes' ? s.modes : false),
    unlock: () => true,
    hats: () => s.hats.slice(),
    hat: () => s.worn,
    cycleHat: (d) => {
      s.cycles.push(d);
      return s.worn;
    },
  };
}

// n title ticks; `input` is an object, or a function(i).
function tick(env, n, input) {
  for (let i = 0; i < n; i++) env.title.update(env.CB.DT, typeof input === 'function' ? input(i) : input || H.makeInput());
}

// One title frame drawn with a clean recorder.
function titleFrame(env, t) {
  env.rec.clear();
  env.texts.length = 0;
  env.frames.length = 0;
  env.cursor.length = 0;
  env.title.draw(env.r, t == null ? 0.3 : t);
  return env.rec;
}

// What input.js hands over for a pad press: the pad edge, plus the merged edges the real sample() ORs in.
function padInput(edge, over) {
  return H.makeInput(Object.assign({
    pad: Object.assign({}, PAD0, { [edge]: true }),
    confirm: edge === 'a',
    dash: edge === 'a' || edge === 'lb',
    compact: edge === 'rb' || edge === 'b',
    pause: edge === 'start',
    quit: edge === 'back',
  }, over || {}));
}

// A mouse click or touch tap at (x, y): confirm and tap together, aimed there.
const tapInput = (x, y, over) => H.makeInput(Object.assign({ confirm: true, tap: true, aimX: x, aimY: y }, over || {}));

// The centre of a chip (id) on the row y0.
function chipAt(env, id, y0) {
  const b = env.CB.Screens.toggles.boxes(y0).find((c) => c.id === id);
  assert.ok(b, 'chip ' + id);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

// ---- toggles ----------------------------------------------------------------------------------------------------------------------

test('toggles: three fixed chips, 74 x 11, gap 4, centred, box 2 px above the text row', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  assert.deepEqual(H.plain(T.IDS), ['sound', 'music', 'calm']);
  assert.deepEqual(H.plain(T.boxes(66)), [
    { id: 'sound', x: 45, y: 64, w: 74, h: 11 },
    { id: 'music', x: 123, y: 64, w: 74, h: 11 },
    { id: 'calm', x: 201, y: 64, w: 74, h: 11 },
  ]);
  assert.deepEqual(H.plain(T.boxes(170)).map((b) => b.y), [168, 168, 168]);
  assert.equal(45 + 230 + 45, 320, 'centred');
  assert.equal(T.boxes(170).at(-1).y + 11, 179, 'the title row ends inside the 180 px screen');
});

test('toggles: a chip exists only for a module that can report its state, and the others keep their places', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  const ids = () => T.boxes(66).map((b) => b.id + '@' + b.x);
  env.CB.Music = {};
  assert.deepEqual(ids(), ['sound@45', 'calm@201']);
  env.CB.Audio = { play() {} };
  assert.deepEqual(ids(), ['calm@201']);
  env.CB.Comfort = undefined;
  assert.deepEqual(ids(), []);
  assert.equal(T.hit(100, 66, 66), null);
  assert.equal(T.label('sound'), '');
  assert.equal(T.label('bogus'), '');
});

test('toggles: hit finds the chip under a point; the gaps, the edges and junk are misses', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  assert.equal(T.hit(46, 65, 66), 'sound');
  assert.equal(T.hit(45, 64, 66), 'sound', 'top-left corner is inside');
  assert.equal(T.hit(118, 74, 66), 'sound', 'last pixel of the chip');
  assert.equal(T.hit(119, 66, 66), null, 'the 4 px gap');
  assert.equal(T.hit(122, 66, 66), null);
  assert.equal(T.hit(123, 66, 66), 'music');
  assert.equal(T.hit(236, 70, 66), 'calm');
  assert.equal(T.hit(275, 66, 66), null, 'right edge is exclusive');
  assert.equal(T.hit(44, 66, 66), null);
  assert.equal(T.hit(80, 63, 66), null, 'above');
  assert.equal(T.hit(80, 75, 66), null, 'below');
  assert.equal(T.hit(80, 170, 170), 'sound', 'follows y0');
  assert.equal(T.hit(80, 66, 170), null);
  assert.equal(T.hit(NaN, 66, 66), null);
  assert.equal(T.hit(80, undefined, 66), null);
});

test('toggles: labels carry the key on the keyboard and not on touch or pad', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  env.state.calm = true;
  env.state.muted = true;
  for (const [dev, want] of [['kbm', ['M sound: off', 'N music: on', 'V calm: on']], ['touch', ['sound: off', 'music: on', 'calm: on']], ['pad', ['sound: off', 'music: on', 'calm: on']]]) {
    device(env, dev);
    assert.deepEqual(T.IDS.map((id) => T.label(id)), want, dev);
  }
  // An unknown device reads as the keyboard.
  env.CB.Prompts.device = undefined;
  assert.equal(T.label('sound'), 'M sound: off');
  delete env.CB.Prompts;
  assert.equal(T.label('music'), 'N music: on');
});

test('toggles: apply flips each setting through its module, chimes, and returns the new on-state', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  // Sound: toggleMute returns the MUTED flag, apply returns the on-state, so the two are opposite.
  assert.equal(T.apply('sound'), false, 'muted now, so sound is off');
  assert.equal(env.state.muted, true);
  assert.equal(T.apply('sound'), true);
  assert.equal(env.state.muted, false);
  assert.equal(T.apply('music'), false);
  assert.equal(T.apply('music'), true);
  assert.equal(T.apply('calm'), true);
  assert.equal(T.apply('calm'), false);
  assert.equal(env.sounds.filter((s) => s === 'uiSelect').length, 6);
  assert.equal(T.apply('bogus'), false);
  assert.equal(env.sounds.length, 6, 'an unknown chip chimes nothing');
});

test('toggles: apply with real Audio, Music and Comfort agrees with what the chips then show', () => {
  const mem = {};
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true, localStorage: { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } } });
  const T = CB.Screens.toggles;
  assert.equal(CB.Audio.isMuted(), false);
  const wasMusic = CB.Music.isEnabled();
  const wasCalm = CB.Comfort.calm();
  assert.equal(T.apply('sound'), !CB.Audio.isMuted());
  assert.equal(CB.Audio.isMuted(), true);
  assert.equal(T.label('sound'), 'M sound: off');
  assert.equal(T.apply('sound'), true);
  assert.equal(T.apply('music'), !wasMusic);
  assert.equal(CB.Music.isEnabled(), !wasMusic);
  assert.equal(T.apply('calm'), !wasCalm);
  assert.equal(CB.Comfort.calm(), !wasCalm);
  assert.ok(sandbox.CB);
});

test('toggles: a module that reports but cannot flip answers with its current state and stays quiet', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  env.CB.Audio = { isMuted: () => true, play: (n) => env.sounds.push(n) };
  env.CB.Music = { isEnabled: () => true };
  env.CB.Comfort = { calm: () => false };
  assert.equal(T.apply('sound'), false);
  assert.equal(T.apply('music'), true);
  assert.equal(T.apply('calm'), false);
  assert.deepEqual(env.sounds, []);
  env.CB.Audio = undefined;
  assert.equal(T.apply('sound'), false, 'no module at all');
});

test('toggles: draw shows a dim frame per chip and a bright one on the focused or hovered chip', () => {
  const env = setup('pad');
  const T = env.CB.Screens.toggles;
  const C = env.C;
  const bright = (focus, aim) => {
    env.frames.length = 0;
    T.draw(env.r, 66, focus, aim);
    return env.frames.map((f) => (f.color === C.gold ? 'B' : f.color === C.greyDark ? 'd' : '?')).join('');
  };
  assert.equal(bright(-1), 'ddd');
  assert.equal(bright(0), 'Bdd');
  assert.equal(bright(1), 'dBd');
  assert.equal(bright(2), 'ddB');
  assert.equal(bright(3), 'ddd', 'out of range');
  assert.equal(bright(undefined), 'ddd');
  assert.equal(bright(-1, { x: 130, y: 68 }), 'dBd', 'the mouse over a chip');
  assert.equal(bright(0, { x: 250, y: 68 }), 'BdB', 'focus and hover are independent');
  assert.equal(bright(-1, { x: 5, y: 5 }), 'ddd');
  // The text is on the row, inside its chip.
  env.rec.clear();
  T.draw(env.r, 66, -1);
  const t = env.rec.texts();
  assert.deepEqual(t.map((b) => b.y), [66, 66, 66]);
  T.boxes(66).forEach((b, i) => assert.ok(inBox(t[i], b), b.id));
});

test('toggles: every label fits its chip with room to spare, in every state and on every device', () => {
  const env = setup('kbm');
  const T = env.CB.Screens.toggles;
  for (const dev of DEVICES) {
    device(env, dev);
    for (const on of [false, true]) {
      env.state.muted = !on;
      env.state.music = on;
      env.state.calm = on;
      for (const id of T.IDS) assert.ok(env.CB.Font.measure(T.label(id), 1) <= 74 - 8, dev + ' ' + T.label(id));
    }
  }
});

// ---- title: prompts per device ----------------------------------------------------------------------------------------------------

const TITLE_TEXT = {
  kbm: { start: 'Click to start', l1: 'WASD move · Mouse aim · Click shoot · Space dash', l2: 'E /compact · N music · M mute · V calm · Esc pause', hat: 'hat: Loop cap (Q/E)', rush: '[ boss rush ]', yolo: '[ ] --yolo', chips: ['M sound: on', 'N music: on', 'V calm: off'] },
  touch: { start: 'Tap to start', l1: 'Left thumb: move · Right thumb: aim + shoot', l2: 'DASH and /compact buttons · II pause', hat: 'hat: Loop cap (tap)', rush: '[ boss rush ]', yolo: '[ ] --yolo', chips: ['sound: on', 'music: on', 'calm: off'] },
  pad: { start: 'Press A to start', l1: 'L-stick move · R-stick aim + shoot · A dash', l2: 'RB /compact · Start pause · RT shoot', hat: 'hat: Loop cap (LB/RB)', rush: 'Y: boss rush', yolo: 'X: [ ] --yolo', chips: ['sound: on', 'music: on', 'calm: off'] },
};

for (const dev of DEVICES) {
  test('title (' + dev + '): every prompt reads for the device, and the layout holds', () => {
    const env = setup(dev);
    enterTitle(env, { modes: true, hats: ['loopcap', 'halo'], worn: 'loopcap' });
    const want = TITLE_TEXT[dev];
    const rec = titleFrame(env, 0.3);
    const row = (s, y) => {
      const b = box(rec, s);
      assert.ok(b, dev + ': missing ' + JSON.stringify(s));
      if (y != null) assert.equal(b.y, y, s);
      return b;
    };
    assert.ok(Math.abs(centreX(row(want.start, 114)) - 160) <= 1);
    row(want.l1, 138);
    row(want.l2, 147);
    row(want.hat, 105);
    const rush = row(want.rush, 124);
    const yolo = row(want.yolo, 124);
    assert.ok(inBox(rush, env.title.BUTTONS[0]) && inBox(yolo, env.title.BUTTONS[1]), 'labels inside their hit boxes');
    want.chips.forEach((s, i) => assert.ok(Math.abs(centreX(row(s, 170)) - (45 + 78 * i + 37)) <= 1, s));
    row(DISCLAIMER, 160);
    assert.ok(inBox(row(want.hat, 105), { x: 90, y: 102, w: 140, h: 11 }), 'the hat row sits inside HAT_BOX');
    assertLayout(rec, 'title ' + dev);
    // Nothing from another device leaks in, and the small-screen note is gone everywhere.
    for (const other of DEVICES.filter((d) => d !== dev)) {
      for (const k of ['start', 'l1', 'l2']) if (TITLE_TEXT[other][k] !== want[k]) assert.ok(!box(rec, TITLE_TEXT[other][k]), dev + ' shows no ' + other + ' text: ' + TITLE_TEXT[other][k]);
    }
    assert.ok(!rec.texts().some((b) => /Best on desktop/.test(b.str)));
  });

  test('title (' + dev + '): the yolo label follows its state; the cursor is drawn for the keyboard and mouse only', () => {
    const env = setup(dev);
    enterTitle(env, { modes: true });
    env.title.yolo = true;
    assert.ok(box(titleFrame(env), dev === 'pad' ? 'X: [x] --yolo' : '[x] --yolo'));
    assert.equal(env.cursor.length, dev === 'kbm' ? 1 : 0, 'cursor calls');
    if (dev === 'kbm') assert.equal(env.cursor[0].mode, 'pointer');
  });
}

test('title: the mouse hover highlight on the mode labels is for the keyboard and mouse only', () => {
  const env = setup('kbm');
  enterTitle(env, { modes: true });
  const rush = env.title.BUTTONS[0];
  env.aim = { x: rush.x + 4, y: rush.y + 4 };
  const colourOf = (s) => {
    titleFrame(env);
    return env.texts.find((t) => t[0] === s)[1].color;
  };
  assert.equal(colourOf('[ boss rush ]'), env.C.white, 'kbm hover');
  device(env, 'touch');
  assert.equal(colourOf('[ boss rush ]'), env.C.pale, 'a stale tap spot does not highlight on touch');
  device(env, 'pad');
  assert.equal(colourOf('Y: boss rush'), env.C.pale);
});

test('title: the sound chip lights under the mouse (keyboard and mouse only)', () => {
  const env = setup('kbm');
  enterTitle(env);
  const at = chipAt(env, 'sound', 170);
  env.aim = at;
  titleFrame(env);
  assert.equal(env.frames[0].color, env.C.gold);
  assert.equal(env.frames[1].color, env.C.greyDark);
  device(env, 'touch');
  titleFrame(env);
  assert.equal(env.frames[0].color, env.C.greyDark);
});

test('title: the device falls back to game.input.device without CB.Prompts, and to the keyboard with neither', () => {
  const env = setup('touch');
  enterTitle(env);
  delete env.CB.Prompts;
  titleFrame(env);
  assert.equal(env.cursor.length, 0, 'input says touch: no cursor');
  assert.ok(box(env.rec, 'Click to start'), 'no Prompts module: the keyboard text');
  delete env.game.input.device;
  titleFrame(env);
  assert.equal(env.cursor.length, 1, 'no device anywhere: keyboard and mouse');
  env.game.input.device = 'gamepad'; // junk
  titleFrame(env);
  assert.equal(env.cursor.length, 1);
  env.game.input = { peekAim: () => env.aim };
  assert.doesNotThrow(() => titleFrame(env));
  env.game.input = undefined;
  assert.doesNotThrow(() => titleFrame(env));
});

test('title: an undefined Prompts device reads as the keyboard and mouse', () => {
  const env = setup('kbm');
  enterTitle(env);
  env.CB.Prompts.device = undefined;
  env.game.input.device = undefined;
  const rec = titleFrame(env);
  assert.ok(box(rec, 'Click to start'));
  assert.equal(env.cursor.length, 1);
});

// ---- title: pad ---------------------------------------------------------------------------------------------------------------------

test('title (pad): A starts a normal run, honouring --yolo, and ignores the pointer spot its confirm edge would read', () => {
  const env = setup('pad');
  enterTitle(env, { modes: true });
  const rush = env.title.BUTTONS[0];
  const yolo = env.title.BUTTONS[1];
  tick(env, 1, padInput('a', { aimX: rush.x + 4, aimY: rush.y + 4 }));
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]], 'not boss rush');
  assert.deepEqual(env.sounds, ['uiSelect']);
  env.visits.length = 0;
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('a', { aimX: yolo.x + 4, aimY: yolo.y + 4 }));
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]], 'the yolo box was not toggled either');
  env.visits.length = 0;
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('x'));
  tick(env, 1, padInput('a'));
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: true } }]]);
});

test('title (pad): Y starts boss rush, X toggles --yolo; both need the modes unlock', () => {
  const env = setup('pad');
  enterTitle(env, { modes: true });
  tick(env, 1, padInput('x'));
  assert.equal(env.title.yolo, true);
  assert.deepEqual(env.sounds, ['uiSelect']);
  assert.ok(box(titleFrame(env), 'X: [x] --yolo'));
  assert.equal(env.visits.length, 0);
  tick(env, 1, padInput('x'));
  assert.equal(env.title.yolo, false);
  assert.ok(box(titleFrame(env), 'X: [ ] --yolo'));
  tick(env, 1, padInput('y'));
  assert.deepEqual(env.visits, [['play', { runOpts: { bossRush: true, yolo: false } }]]);
  env.visits.length = 0;
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('x'));
  tick(env, 1, padInput('y'));
  assert.deepEqual(env.visits, [['play', { runOpts: { bossRush: true, yolo: true } }]]);

  const locked = setup('pad');
  enterTitle(locked, { modes: false });
  locked.sounds.length = 0;
  tick(locked, 1, padInput('y'));
  tick(locked, 1, padInput('x'));
  assert.equal(locked.visits.length, 0);
  assert.equal(locked.title.yolo, false);
  assert.deepEqual(locked.sounds, []);
  assert.ok(!locked.rec.texts().some((b) => /boss rush|yolo/.test(b.str)));
});

test('title (pad): LB wears the previous hat and RB (which arrives as compact) the next; Back and B are not hat buttons', () => {
  const env = setup('pad');
  enterTitle(env, { hats: ['loopcap', 'halo'], worn: 'loopcap' });
  tick(env, 1, padInput('lb'));
  assert.deepEqual(env.unlocks.cycles, [-1]);
  tick(env, 1, padInput('rb'));
  assert.deepEqual(env.unlocks.cycles, [-1, 1]);
  assert.deepEqual(env.sounds, ['uiSelect', 'uiSelect']);
  tick(env, 1, padInput('back'));
  tick(env, 1, padInput('b'));
  assert.deepEqual(env.unlocks.cycles, [-1, 1], 'Back (quit) and B (compact) cycle nothing');
  // The keyboard still cycles while a pad is connected (its edges are all false).
  tick(env, 1, H.makeInput({ quit: true, pad: Object.assign({}, PAD0) }));
  tick(env, 1, H.makeInput({ compact: true, pad: Object.assign({}, PAD0) }));
  assert.deepEqual(env.unlocks.cycles, [-1, 1, -1, 1]);
  assert.equal(env.visits.length, 0);
});

test('title (pad): with no hat unlocked LB and RB do nothing', () => {
  const env = setup('pad');
  enterTitle(env, { hats: [] });
  tick(env, 1, padInput('lb'));
  tick(env, 1, padInput('rb'));
  assert.deepEqual(env.unlocks.cycles, []);
  assert.deepEqual(env.sounds, []);
});

test('title (pad): every pad edge waits out the 0.3 s input lock', () => {
  for (const edge of ['a', 'y', 'x', 'lb', 'rb']) {
    const env = setup('pad');
    enterTitle(env, { modes: true, hats: ['loopcap', 'halo'], worn: 'loopcap', locked: true });
    tick(env, 5, padInput(edge));
    assert.equal(env.visits.length, 0, edge + ' starts nothing');
    assert.deepEqual(env.unlocks.cycles, [], edge + ' cycles nothing');
    assert.equal(env.title.yolo, false, edge + ' toggles nothing');
    assert.deepEqual(env.sounds, [], edge + ' is silent');
    tick(env, 20);
    tick(env, 1, padInput(edge));
    assert.ok(env.visits.length || env.unlocks.cycles.length || env.title.yolo, edge + ' works once the lock is over');
  }
});

test('title (pad): the other pad buttons do nothing here', () => {
  const env = setup('pad');
  enterTitle(env, { modes: true, hats: ['loopcap'], worn: null });
  for (const edge of ['b', 'start', 'back']) tick(env, 1, padInput(edge));
  assert.equal(env.visits.length, 0);
  assert.deepEqual(env.unlocks.cycles, []);
  assert.equal(env.title.yolo, false);
});

// ---- title: clicks and taps ---------------------------------------------------------------------------------------------------------

test('title: a tap on a chip toggles that setting and does not start; a tap anywhere else does', () => {
  for (const dev of ['kbm', 'touch']) {
    const env = setup(dev);
    enterTitle(env);
    let p = chipAt(env, 'sound', 170);
    tick(env, 1, tapInput(p.x, p.y));
    assert.equal(env.state.muted, true, dev + ' sound');
    p = chipAt(env, 'music', 170);
    tick(env, 1, tapInput(p.x, p.y));
    assert.equal(env.state.music, false, dev + ' music');
    p = chipAt(env, 'calm', 170);
    tick(env, 1, tapInput(p.x, p.y));
    assert.equal(env.state.calm, true, dev + ' calm');
    assert.equal(env.visits.length, 0, 'no chip tap starts a run');
    assert.equal(env.fullscreen, 0);
    assert.ok(box(titleFrame(env), dev === 'kbm' ? 'M sound: off' : 'sound: off'), 'the chip shows the new state');
    tick(env, 1, tapInput(160, 60)); // empty arena
    assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]], dev);
  }
});

test('title: the gap between chips and the strip around them start the game, like any other tap', () => {
  const env = setup('touch');
  enterTitle(env);
  tick(env, 1, tapInput(120, 173)); // the 4 px gap between sound and music
  assert.equal(env.visits.length, 1);
  assert.equal(env.state.muted, false);
});

test('title: a click or tap inside the lock window does nothing, chips included', () => {
  const env = setup('touch');
  enterTitle(env, { locked: true });
  const p = chipAt(env, 'sound', 170);
  tick(env, 5, tapInput(p.x, p.y));
  tick(env, 5, tapInput(160, 60));
  assert.equal(env.state.muted, false);
  assert.equal(env.visits.length, 0);
  assert.deepEqual(env.sounds, []);
});

test('title: a tap on the hat row (when a hat is unlocked) wears the next hat; with no hat it starts the game', () => {
  const env = setup('touch');
  enterTitle(env, { hats: ['loopcap', 'halo'], worn: 'loopcap' });
  const B = env.title.HAT_BOX;
  assert.deepEqual(H.plain(B), { x: 90, y: 102, w: 140, h: 11 });
  tick(env, 1, tapInput(B.x + 2, B.y + 2));
  tick(env, 1, tapInput(B.x + B.w - 1, B.y + B.h - 1));
  assert.deepEqual(env.unlocks.cycles, [1, 1], 'forward each time');
  assert.equal(env.visits.length, 0);
  tick(env, 1, tapInput(B.x - 1, B.y + 2)); // just left of the box
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, tapInput(B.x + 5, B.y + B.h)); // y is exclusive at the bottom edge
  assert.equal(env.visits.length, 1);
  assert.deepEqual(env.unlocks.cycles, [1, 1]);

  const bare = setup('touch');
  enterTitle(bare, { hats: [] });
  tick(bare, 1, tapInput(B.x + 5, B.y + 5));
  assert.equal(bare.visits.length, 1, 'no hats: the hat row is not a button');
});

test('title: taps reach the mode buttons: rush starts, yolo toggles, and the rest starts', () => {
  for (const dev of ['kbm', 'touch']) {
    const env = setup(dev);
    enterTitle(env, { modes: true });
    const [rush, yolo] = env.title.BUTTONS;
    tick(env, 1, tapInput(yolo.x + 3, yolo.y + 3));
    assert.equal(env.title.yolo, true, dev);
    assert.equal(env.visits.length, 0);
    tick(env, 1, tapInput(rush.x + 3, rush.y + 3));
    assert.deepEqual(env.visits, [['play', { runOpts: { bossRush: true, yolo: true } }]], dev);
  }
});

test('title: Enter (a confirm with no tap) keeps its old behaviour: the pointer spot picks a mode button, never a chip or the hat row', () => {
  const env = setup('kbm');
  enterTitle(env, { modes: true, hats: ['loopcap', 'halo'], worn: 'loopcap' });
  const [rush, yolo] = env.title.BUTTONS;
  const chip = chipAt(env, 'sound', 170);
  tick(env, 1, H.makeInput({ confirm: true, aimX: chip.x, aimY: chip.y }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
  assert.equal(env.state.muted, false, 'Enter does not press a chip');
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, H.makeInput({ confirm: true, aimX: 160, aimY: 107 }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
  assert.deepEqual(env.unlocks.cycles, [], 'nor the hat row');
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, H.makeInput({ confirm: true, aimX: yolo.x + 3, aimY: yolo.y + 3 }));
  assert.equal(env.title.yolo, true);
  tick(env, 1, H.makeInput({ confirm: true, aimX: rush.x + 3, aimY: rush.y + 3 }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { bossRush: true, yolo: true } }]);
});

test('title: a mouse click with a pad connected (every pad edge false) is still a tap', () => {
  const env = setup('kbm');
  enterTitle(env);
  const p = chipAt(env, 'music', 170);
  tick(env, 1, tapInput(p.x, p.y, { pad: Object.assign({}, PAD0) }));
  assert.equal(env.state.music, false);
  assert.equal(env.visits.length, 0);
  tick(env, 1, tapInput(160, 60, { pad: Object.assign({}, PAD0) }));
  assert.equal(env.visits.length, 1);
});

test('title: the other keys are unchanged: N toggles music, V toggles calm with a toast', () => {
  const env = setup('kbm');
  enterTitle(env);
  tick(env, 1, H.makeInput({ music: true }));
  assert.equal(env.state.music, false);
  tick(env, 1, H.makeInput({ keys: ['KeyV'] }));
  assert.equal(env.state.calm, true);
  assert.ok(box(titleFrame(env), 'calm mode: on'));
});

// ---- title: touch fullscreen, notify ------------------------------------------------------------------------------------------------

test('title: starting a run on the touch device asks input for fullscreen on the next finger lift; other devices do not', () => {
  for (const dev of DEVICES) {
    const env = setup(dev);
    enterTitle(env, { modes: true });
    const [rush] = env.title.BUTTONS;
    tick(env, 1, dev === 'pad' ? padInput('a') : tapInput(160, 60));
    assert.equal(env.visits.length, 1, dev);
    assert.equal(env.fullscreen, dev === 'touch' ? 1 : 0, dev + ' fullscreen requests');
    if (dev === 'touch') {
      env.title.enter(env.game, {});
      tick(env, 20);
      tick(env, 1, tapInput(rush.x + 3, rush.y + 3));
      assert.equal(env.fullscreen, 2, 'boss rush too');
      env.title.enter(env.game, {});
      tick(env, 20);
      tick(env, 1, H.makeInput({ confirm: true }));
      assert.equal(env.fullscreen, 3, 'and Enter');
    }
  }
});

test('title: a tap that only toggles a chip or the yolo box does not ask for fullscreen', () => {
  const env = setup('touch');
  enterTitle(env, { modes: true });
  const p = chipAt(env, 'sound', 170);
  tick(env, 1, tapInput(p.x, p.y));
  const yolo = env.title.BUTTONS[1];
  tick(env, 1, tapInput(yolo.x + 3, yolo.y + 3));
  assert.equal(env.fullscreen, 0);
});

test('title: a game input without requestFullscreenOnRelease (or no input at all) still starts', () => {
  const env = setup('touch');
  enterTitle(env);
  delete env.game.input.requestFullscreenOnRelease;
  assert.doesNotThrow(() => tick(env, 1, tapInput(160, 60)));
  assert.equal(env.visits.length, 1);
  const bare = setup('touch');
  enterTitle(bare);
  bare.game.input = undefined;
  assert.doesNotThrow(() => tick(bare, 1, tapInput(160, 60)));
  assert.equal(bare.visits.length, 1);
});

test('title: notify shows a gold toast in the footer row for 2 s', () => {
  const env = setup('pad');
  enterTitle(env);
  env.title.notify('controller connected');
  const rec = titleFrame(env);
  const b = box(rec, 'controller connected');
  assert.ok(b);
  assert.equal(b.y, 160);
  assert.ok(env.texts.some((t) => t[0] === 'controller connected' && t[1].color === env.C.gold));
  assert.ok(!box(rec, DISCLAIMER), 'it takes the footer row');
  assertLayout(rec, 'toast');
  tick(env, 110);
  assert.ok(box(titleFrame(env), 'controller connected'), 'still up at 1.8 s');
  tick(env, 20);
  const later = titleFrame(env);
  assert.ok(!box(later, 'controller connected'), 'gone after 2 s');
  assert.ok(box(later, DISCLAIMER));
});

test('title: the worst case per device (hats, modes, toast, all chips) stays on screen with disjoint text', () => {
  for (const dev of DEVICES) {
    const env = setup(dev);
    enterTitle(env, { modes: true, hats: ['loopcap', 'halo'], worn: 'halo' });
    env.title.notify('controller disconnected');
    env.title.yolo = true;
    for (let i = 0; i < 200; i += 7) {
      tick(env, 7);
      const rec = titleFrame(env, i / 60);
      assertLayout(rec, dev + ' t=' + i);
    }
  }
});

// ---- pause ----------------------------------------------------------------------------------------------------------------------------

const PAUSE_TEXT = {
  kbm: { line: 'Esc: resume · Q: quit to title', armed: 'Press Q again to quit', l1: 'WASD move · Mouse aim · Click shoot', l2: 'Space dash · E /compact (meter full)', chips: ['M sound: on', 'N music: on', 'V calm: off'] },
  touch: { line: 'Tap: resume', armed: 'Tap quit again to quit', l1: 'Left thumb: move · Right thumb: aim + shoot', l2: 'DASH · /compact (meter full)', chips: ['sound: on', 'music: on', 'calm: off'] },
  pad: { line: 'Start: resume · Back: quit to title', armed: 'Press Back again to quit', l1: 'L-stick move · R-stick aim + shoot', l2: 'A/LB dash · RB/B /compact (meter full)', chips: ['sound: on', 'music: on', 'calm: off'] },
};

for (const dev of DEVICES) {
  test('pause (' + dev + '): the lines, chips and quit button read for the device', () => {
    const env = setup(dev);
    const run = mkRun(env.CB, { state: 'boss', patches: { spread: 2, rapid: 1, pierce: 2, heavy: 1, heart: 2, dash: 1, ricochet: 1 } });
    const want = PAUSE_TEXT[dev];
    const rec = drawScreen(env, 'pause', run, 0.5, { hover: -1 });
    const row = (s, y) => {
      const b = box(rec, s);
      assert.ok(b, dev + ': missing ' + JSON.stringify(s));
      assert.equal(b.y, y, s);
      return b;
    };
    row(want.line, 34);
    row(want.l1, 48);
    row(want.l2, 57);
    want.chips.forEach((s, i) => assert.ok(Math.abs(centreX(row(s, 66)) - (45 + 78 * i + 37)) <= 1, s));
    const quit = row('[ quit to title ]', 152);
    assert.ok(inBox(quit, env.CB.Screens.pause.QUIT_BOX));
    row(DISCLAIMER, 160);
    assert.ok(!box(rec, want.armed), 'not armed');
    assertLayout(rec, 'pause ' + dev);
    // Armed: the arm prompt replaces line 34, in gold, and the button turns gold too.
    const armed = drawScreen(env, 'pause', run, 0.5, { hover: -1, quitArmT: 1.2 });
    assert.equal(box(armed, want.armed).y, 34);
    assert.ok(!box(armed, want.line));
    assert.ok(env.texts.some((t) => t[0] === want.armed && t[1].color === env.C.gold));
    assert.ok(env.texts.some((t) => t[0] === '[ quit to title ]' && t[1].color === env.C.gold));
    assertLayout(armed, 'pause armed ' + dev);
  });
}

test('pause: the chips are at CHIPS_Y, the quit box is exported, and the hit helpers agree with what is drawn', () => {
  const env = setup('touch');
  const P = env.CB.Screens.pause;
  assert.equal(P.CHIPS_Y, 66);
  assert.deepEqual(H.plain(P.QUIT_BOX), { x: 110, y: 150, w: 100, h: 10 });
  assert.equal(typeof P.draw, 'function');
  const run = mkRun(env.CB, { state: 'wave' });
  const rec = drawScreen(env, 'pause', run, 0);
  const T = env.CB.Screens.toggles;
  for (const id of T.IDS) {
    const c = chipAt(env, id, P.CHIPS_Y);
    assert.equal(T.hit(c.x, c.y, P.CHIPS_Y), id);
    const label = rec.texts().find((b) => b.str.startsWith(id));
    assert.ok(label && label.x < c.x && c.x < label.x + label.w, id + ' label is on its chip');
  }
  // With no patches owned the quit box holds the button and no other text.
  const others = rec.texts().filter((b) => b.str !== '[ quit to title ]' && touches(b, P.QUIT_BOX));
  assert.deepEqual(others.map((b) => b.str), []);
});

test('pause: the pad focus lights one chip, only while pauseNav is set', () => {
  const env = setup('pad');
  const run = mkRun(env.CB, { state: 'wave' });
  const lit = (ui) => {
    drawScreen(env, 'pause', run, 0, ui);
    return env.frames.map((f) => (f.color === env.C.gold ? 'B' : 'd')).join('');
  };
  assert.equal(lit({ pauseNav: false, pauseFocus: 1 }), 'ddd');
  assert.equal(lit({ pauseNav: true, pauseFocus: 0 }), 'Bdd');
  assert.equal(lit({ pauseNav: true, pauseFocus: 1 }), 'dBd');
  assert.equal(lit({ pauseNav: true, pauseFocus: 2 }), 'ddB');
  assert.equal(lit({ pauseNav: true }), 'ddd', 'no focus index');
  assert.equal(lit(undefined), 'ddd');
  assert.equal(lit(null), 'ddd');
});

test('pause: the mouse position lights the chip or the quit button under it (keyboard and mouse only)', () => {
  const env = setup('kbm');
  const run = mkRun(env.CB, { state: 'wave' });
  const chip = chipAt(env, 'music', 66);
  drawScreen(env, 'pause', run, 0, { aimX: chip.x, aimY: chip.y });
  assert.deepEqual(env.frames.map((f) => (f.color === env.C.gold ? 'B' : 'd')), ['d', 'B', 'd']);
  drawScreen(env, 'pause', run, 0, { aimX: 160, aimY: 154 });
  assert.ok(env.texts.some((t) => t[0] === '[ quit to title ]' && t[1].color === env.C.white), 'the button brightens');
  device(env, 'touch');
  drawScreen(env, 'pause', run, 0, { aimX: chip.x, aimY: chip.y });
  assert.deepEqual(env.frames.map((f) => (f.color === env.C.gold ? 'B' : 'd')), ['d', 'd', 'd'], 'a stale tap spot lights nothing');
});

// ---- game over ----------------------------------------------------------------------------------------------------------------------

const OVER_TEXT = {
  kbm: { retry: 'R / click', quit: 'Q: quit to title' },
  touch: { retry: 'Tap', quit: '[ quit to title ]' },
  pad: { retry: 'A', quit: 'Back: quit to title' },
};

for (const dev of DEVICES) {
  test('gameOver (' + dev + '): the retry hint and the quit line read for the device; the quit box holds the line and nothing else', () => {
    const env = setup(dev);
    const base = mkRun(env.CB, { state: 'dead', deaths: 2 });
    const want = OVER_TEXT[dev];
    const locked = drawScreen(env, 'gameOver', base, 0.3);
    assert.ok(!locked.texts().some((b) => /retry|quit/.test(b.str)), 'no hints while the input is locked');
    for (const [cp, label] of [['boss', 'retry boss'], ['wave2', 'retry wave 2'], ['stage', 'retry stage']]) {
      const run = Object.create(base, { checkpoint: { value: cp } });
      const rec = drawScreen(env, 'gameOver', run, 1);
      assert.equal(box(rec, want.retry + ': ' + label).y, 124, dev + ' ' + cp);
    }
    const rec = drawScreen(env, 'gameOver', base, 1);
    const quit = box(rec, want.quit);
    assert.ok(quit, 'quit line');
    assert.equal(quit.y, 136);
    const Q = env.CB.Screens.gameOver.QUIT_BOX;
    assert.deepEqual(H.plain(Q), { x: 100, y: 133, w: 120, h: 11 });
    assert.ok(inBox(quit, Q), 'the tap box holds the quit line');
    assert.deepEqual(rec.texts().filter((b) => b !== quit && touches(b, Q)).map((b) => b.str), [], 'and nothing else');
    assert.ok(Math.abs(centreX(quit) - 160) <= 1);
    assertLayout(rec, 'gameOver ' + dev);
  });
}

// ---- victory --------------------------------------------------------------------------------------------------------------------------

test('victory: the play-again prompt reads for the device, after 1.5 s, and the layout holds', () => {
  const want = { kbm: 'Click to play again', touch: 'Tap to play again', pad: 'Press A to play again' };
  for (const dev of DEVICES) {
    const env = setup(dev);
    const run = mkRun(env.CB, { state: 'victory', deaths: 3, time: 61.9, bossesFixed: 4, history: ['spread', 'rapid'], squashed: { syntaxError: 3, nullPointer: 2 } });
    assert.ok(!box(drawScreen(env, 'victory', run, 1.5), want[dev]), dev + ': not yet');
    const rec = drawScreen(env, 'victory', run, 2.0);
    const b = box(rec, want[dev]);
    assert.ok(b, dev);
    assert.equal(b.y, 160);
    assert.ok(Math.abs(centreX(b) - 160) <= 1);
    for (const other of DEVICES.filter((d) => d !== dev)) assert.ok(!box(rec, want[other]), dev + ' shows no ' + other + ' prompt');
    assert.deepEqual(rec.overlaps().filter((p) => p[0].str !== '✻' && p[1].str !== '✻').map((p) => p[0].str + ' / ' + p[1].str), []);
  }
});

// ---- patch pick -----------------------------------------------------------------------------------------------------------------------

test('patchPick: the card hint is [n] with a keyboard, tap on a phone, and [A] on the focused card only while the pad navigates', () => {
  const env = setup('kbm');
  const run = mkRun(env.CB, { state: 'patchPick', offer: ['rapid', 'pierce', 'heart'], patches: {} });
  const hints = (ui, st) => drawScreen(env, 'patchPick', run, st == null ? 1 : st, ui).texts().filter((b) => /^(\[.+\]|tap)$/.test(b.str)).map((b) => b.str + '@' + env.CB.Screens.patchPick.CARDS.findIndex((c) => centreX(b) >= c.x && centreX(b) < c.x + c.w));
  assert.deepEqual(hints({ hover: -1 }), ['[1]@0', '[2]@1', '[3]@2']);
  assert.deepEqual(hints({ hover: 1, nav: true }), ['[1]@0', '[2]@1', '[3]@2'], 'arrow-key focus keeps [n]');
  device(env, 'touch');
  assert.deepEqual(hints({ hover: -1 }), ['tap@0', 'tap@1', 'tap@2']);
  assert.deepEqual(hints({ hover: 2 }), ['tap@0', 'tap@1', 'tap@2']);
  device(env, 'pad');
  assert.deepEqual(hints({ hover: -1 }), [], 'blank with no focus');
  assert.deepEqual(hints({ hover: 1 }), [], 'blank when the pad is not navigating');
  assert.deepEqual(hints({ hover: 1, nav: false }), []);
  assert.deepEqual(hints({ hover: 1, nav: true }), ['[A]@1'], 'only on the focused card');
  assert.deepEqual(hints({ hover: 0, nav: true }), ['[A]@0']);
  assert.deepEqual(hints({ hover: 2, nav: true }), ['[A]@2']);
  assert.deepEqual(hints({ hover: -1, nav: true }), []);
  assert.deepEqual(hints({ hover: 1, nav: true }, 0.3), [], 'nothing highlights during the input lock');
  assert.deepEqual(hints(undefined), []);
  assert.deepEqual(hints(null), []);
});

test('patchPick: the highlighted hint is white and the others grey; every hint fits inside its card', () => {
  for (const dev of ['kbm', 'touch']) {
    const env = setup(dev);
    const run = mkRun(env.CB, { state: 'patchPick', offer: ['rapid', 'pierce', 'heart'], patches: {} });
    const rec = drawScreen(env, 'patchPick', run, 1, { hover: 1 });
    const P = env.CB.Screens.patchPick;
    const hintTexts = env.texts.filter((t) => t[0] === 'tap' || /^\[[123]\]$/.test(t[0]));
    assert.equal(hintTexts.length, 3);
    assert.deepEqual(hintTexts.map((t) => t[1].color), [env.C.grey, env.C.white, env.C.grey], dev);
    for (const b of rec.texts().filter((x) => x.str === 'tap' || /^\[[123]\]$/.test(x.str))) {
      assert.ok(P.CARDS.some((c) => b.x >= c.x && b.x + b.w <= c.x + c.w && b.y + b.h <= c.y + c.h), 'inside a card');
    }
  }
});

// ---- panic ----------------------------------------------------------------------------------------------------------------------------

test('panic: the reload line reads for the device, in the normal path and in the plain-canvas fallback', () => {
  const want = { kbm: 'Press R to reload', touch: 'Tap to reload', pad: 'Press R to reload' };
  for (const dev of DEVICES) {
    const env = setup(dev);
    env.CB.Screens.panic.draw(env.r, new Error('boom'));
    const hint = env.rec.texts().find((b) => /reload/.test(b.str));
    assert.equal(hint.str, want[dev], dev);
    assert.equal(hint.y, 160);
    assert.ok(hint.x + hint.w <= 304);
    // The fallback: no font, so r.text throws inside the renderer and the 2D context paints.
    const filled = [];
    env.r.ctx.fillText = (s) => filled.push(String(s));
    delete env.CB.Font;
    env.CB.Screens.panic.draw(env.r, new Error('no font'));
    assert.ok(filled.includes(want[dev]), dev + ' plain path: ' + filled.join('|'));
  }
});

test('panic: a missing, broken or unknown-device Prompts still gives the reload line', () => {
  const env = setup('kbm');
  const lines = () => {
    env.rec.clear();
    env.CB.Screens.panic.draw(env.r, new Error('x'));
    return env.rec.texts().filter((b) => /reload/.test(b.str)).map((b) => b.str);
  };
  env.CB.Prompts.device = undefined;
  assert.deepEqual(lines(), ['Press R to reload']);
  env.CB.Prompts.device = 'touch';
  env.CB.Prompts.text = () => { throw new Error('prompts broke'); };
  assert.deepEqual(lines(), ['Press R to reload']);
  env.CB.Prompts.text = () => '';
  assert.deepEqual(lines(), ['Press R to reload']);
  delete env.CB.Prompts;
  assert.deepEqual(lines(), ['Press R to reload']);
});

// ---- the keyboard text is the text the game always had -----------------------------------------------------------------------------------

test('kbm: every screen reads the same with CB.Prompts as without it, and with an undefined device', () => {
  const grab = (env) => {
    const out = {};
    const run = mkRun(env.CB, { state: 'dead', deaths: 2, stageIndex: 1 });
    out.pause = strs(drawScreen(env, 'pause', run, 0.5, { hover: -1 }));
    out.pauseArmed = strs(drawScreen(env, 'pause', run, 0.5, { hover: -1, quitArmT: 1 }));
    out.gameOver = strs(drawScreen(env, 'gameOver', run, 1));
    out.victory = strs(drawScreen(env, 'victory', Object.assign(run, { state: 'victory', bossesFixed: 4, history: ['spread'] }), 2));
    out.patchPick = strs(drawScreen(env, 'patchPick', Object.assign(run, { state: 'patchPick', offer: ['rapid', 'pierce', 'heart'] }), 1, { hover: 0 }));
    enterTitle(env, { modes: true, hats: ['loopcap'], worn: 'loopcap' });
    out.title = strs(titleFrame(env, 0.3));
    env.rec.clear();
    env.CB.Screens.panic.draw(env.r, new Error('boom'));
    out.panic = strs(env.rec);
    return out;
  };
  const withPrompts = grab(setup('kbm'));
  const without = setup('kbm');
  delete without.CB.Prompts;
  assert.deepEqual(grab(without), withPrompts, 'no CB.Prompts');
  const undef = setup('kbm');
  undef.CB.Prompts.device = undefined;
  undef.game.input.device = undefined;
  assert.deepEqual(grab(undef), withPrompts, 'undefined device');
  // And it is the text the game always showed.
  assert.ok(withPrompts.title.includes('Click to start'));
  assert.ok(withPrompts.title.includes('hat: Loop cap (Q/E)'));
  assert.ok(withPrompts.pause.includes('Esc: resume · Q: quit to title'));
  assert.ok(withPrompts.pauseArmed.includes('Press Q again to quit'));
  assert.ok(withPrompts.gameOver.includes('R / click: retry stage') || withPrompts.gameOver.includes('R / click: retry wave 2') || withPrompts.gameOver.includes('R / click: retry boss'));
  assert.ok(withPrompts.gameOver.includes('Q: quit to title'));
  assert.ok(withPrompts.victory.includes('Click to play again'));
  assert.ok(withPrompts.patchPick.includes('[1]') && withPrompts.patchPick.includes('[3]'));
  assert.ok(withPrompts.panic.includes('Press R to reload'));
});

test('every touch and pad prompt this task draws fits the 312 px column in the real font', () => {
  const env = setup('kbm');
  const w = (s) => env.CB.Font.measure(s, 1);
  for (const dev of DEVICES) {
    for (const t of [TITLE_TEXT[dev], PAUSE_TEXT[dev]]) {
      for (const k of ['start', 'l1', 'l2', 'line', 'armed', 'hat', 'rush', 'yolo']) if (t[k]) assert.ok(w(t[k]) <= 312, dev + ' ' + t[k] + ' ' + w(t[k]));
    }
  }
});
