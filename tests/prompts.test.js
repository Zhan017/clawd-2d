'use strict';
// CB.Prompts: the per-device prompt table, device detection, and the 312 px fit of every string.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/art/font.js', 'src/core/prompts.js'];
const DEVICES = ['kbm', 'touch', 'pad'];
const MAX_W = 312; // the text column the screens centre in (320 minus a 4 px margin each side)

// The keyboard + mouse strings the game shipped with (title.js, screens.js pause, gameOver.js, victory.js, panic.js).
// retryKey is the front of 'R / click: <label>' and hat the tail of 'hat: <name> (Q/E)'. These never change.
// The three share keys came later (the victory screen's result button and the toasts that answer it); SHARE_KEYS names them.
const KBM = {
  start: 'Click to start',
  again: 'Click to play again',
  retryKey: 'R / click',
  quitDead: 'Q: quit to title',
  pauseLine: 'Esc: resume · Q: quit to title',
  quitArm: 'Press Q again to quit',
  legend1: 'WASD move · Mouse aim · Click shoot · Space dash',
  legend2: 'E /compact · N music · M mute · V calm · Esc pause',
  pauseLegend1: 'WASD move · Mouse aim · Click shoot',
  pauseLegend2: 'Space dash · E /compact (meter full)',
  hat: '(Q/E)',
  reload: 'Press R to reload',
  share: '[ copy result ] (C)',
  shareDone: 'result copied ✓',
  shareFail: "couldn't copy",
};

const SHARE_KEYS = ['share', 'shareDone', 'shareFail'];

const TOUCH = {
  start: 'Tap to start',
  again: 'Tap to play again',
  retryKey: 'Tap',
  quitDead: '[ quit to title ]',
  pauseLine: 'Tap: resume',
  quitArm: 'Tap quit again to quit',
  legend1: 'Left thumb: move · Right thumb: aim + shoot',
  legend2: 'DASH and /compact buttons · II pause',
  pauseLegend1: 'Left thumb: move · Right thumb: aim + shoot',
  pauseLegend2: 'DASH · /compact (meter full)',
  hat: '(tap)',
  reload: 'Tap to reload',
  share: '[ share result ]',
  shareDone: 'shared ✓',
  shareFail: "couldn't copy",
};

const PAD = {
  start: 'Press A to start',
  again: 'Press A to play again',
  retryKey: 'A',
  quitDead: 'Back: quit to title',
  pauseLine: 'Start: resume · Back: quit to title',
  quitArm: 'Press Back again to quit',
  legend1: 'L-stick move · R-stick aim + shoot · A dash',
  legend2: 'RB /compact · Start pause · RT shoot',
  pauseLegend1: 'L-stick move · R-stick aim + shoot',
  pauseLegend2: 'A/LB dash · RB/B /compact (meter full)',
  hat: '(LB/RB)',
  reload: 'Press R to reload',
  share: '[ X: copy result ]',
  shareDone: 'result copied ✓',
  shareFail: "couldn't copy",
};

const KEYS = Object.keys(KBM);

function load() {
  return H.load(FILES);
}

test('prompts: the table has exactly the fifteen keys, each with a string for every device', () => {
  const { Prompts } = load();
  assert.deepEqual(Object.keys(Prompts.TABLE).sort(), KEYS.slice().sort());
  for (const k of KEYS) {
    assert.deepEqual(Object.keys(Prompts.TABLE[k]).sort(), DEVICES.slice().sort(), k);
    for (const d of DEVICES) {
      assert.equal(typeof Prompts.TABLE[k][d], 'string', `${k}.${d}`);
      assert.ok(Prompts.TABLE[k][d].length > 0, `${k}.${d} is not empty`);
    }
  }
});

test('prompts: every key on every device matches the table in the plan', () => {
  const { Prompts } = load();
  for (const k of KEYS) {
    assert.equal(Prompts.text(k, 'kbm'), KBM[k], `${k} kbm`);
    assert.equal(Prompts.text(k, 'touch'), TOUCH[k], `${k} touch`);
    assert.equal(Prompts.text(k, 'pad'), PAD[k], `${k} pad`);
    assert.equal(Prompts.TABLE[k].kbm, KBM[k]);
    assert.equal(Prompts.TABLE[k].touch, TOUCH[k]);
    assert.equal(Prompts.TABLE[k].pad, PAD[k]);
  }
});

test('prompts: the kbm strings are byte-identical to the shipped ones (U+00B7 separators, nothing else non-ASCII)', () => {
  const { Prompts } = load();
  for (const k of KEYS.filter((x) => !SHARE_KEYS.includes(x))) {
    const s = Prompts.text(k, 'kbm');
    assert.equal(Buffer.from(s, 'utf8').toString('hex'), Buffer.from(KBM[k], 'utf8').toString('hex'), k);
    assert.equal(s.replace(/·/g, '').replace(/[\x20-\x7e]/g, ''), '', `${k}: only printable ASCII and the middle dot`);
  }
  assert.equal(Prompts.text('pauseLine', 'kbm').split('·').length, 2);
});

test('prompts: the share strings carry nothing but printable ASCII and the check mark, and each says what it is for', () => {
  const { Prompts } = load();
  for (const k of SHARE_KEYS) {
    for (const d of DEVICES) assert.equal(Prompts.text(k, d).replace(/✓/g, '').replace(/[\x20-\x7e]/g, ''), '', `${k}/${d}`);
  }
  // The button names its input on every device that has one to name; the phone's says what it does.
  assert.match(Prompts.text('share', 'kbm'), /\(C\)$/, 'the keyboard shortcut is C');
  assert.match(Prompts.text('share', 'pad'), /^\[ X: /, 'the pad button is X');
  assert.doesNotMatch(Prompts.text('share', 'touch'), /\(|X:/, 'a phone has no key to name');
  for (const d of DEVICES) {
    assert.notEqual(Prompts.text('shareDone', d), Prompts.text('shareFail', d), d);
    assert.match(Prompts.text('shareDone', d), /✓$/, d + ': done reads as done');
    assert.doesNotMatch(Prompts.text('shareFail', d), /✓/, d + ': fail is not ticked');
  }
  assert.equal(Prompts.text('shareDone', 'touch'), 'shared ✓', 'a phone shared it');
  assert.equal(Prompts.text('shareDone', 'kbm'), 'result copied ✓', 'a computer copied it');
});

test('prompts: the toast strings fit the toast band (one line, well inside the screen) on every device', () => {
  const CB = load();
  for (const k of ['shareDone', 'shareFail']) {
    for (const d of DEVICES) assert.ok(CB.Font.measure(CB.Prompts.text(k, d), 1) <= 160, `${k}/${d}`);
  }
});

test('prompts: text() defaults to the current device and follows setDevice', () => {
  const { Prompts } = load();
  assert.equal(Prompts.device, 'kbm', 'starts on keyboard + mouse');
  assert.equal(Prompts.text('start'), 'Click to start');
  Prompts.setDevice('pad');
  assert.equal(Prompts.device, 'pad');
  assert.equal(Prompts.text('start'), 'Press A to start');
  assert.equal(Prompts.text('start', 'kbm'), 'Click to start', 'an explicit device wins');
  assert.equal(Prompts.text('start', 'touch'), 'Tap to start');
  Prompts.setDevice('touch');
  assert.equal(Prompts.text('start'), 'Tap to start');
  assert.equal(Prompts.text('hat'), '(tap)');
  Prompts.setDevice('kbm');
  assert.equal(Prompts.text('hat'), '(Q/E)');
});

test('prompts: text() of an unknown key is the empty string, whatever the device', () => {
  const { Prompts } = load();
  for (const k of ['nope', '', 'Start', 'constructor', 'toString', '__proto__', 'hasOwnProperty', undefined, null, 0, 42, {}, [], ['start']]) {
    for (const d of [undefined, ...DEVICES]) assert.strictEqual(Prompts.text(k, d), '', `${String(k)} / ${d}`);
  }
});

test('prompts: text() with a junk device falls back to the current device', () => {
  const { Prompts } = load();
  Prompts.setDevice('pad');
  for (const d of ['mouse', '', null, 5, {}, ['kbm'], 'PAD', 'constructor']) assert.equal(Prompts.text('start', d), 'Press A to start', String(d));
});

test('prompts: setDevice ignores anything but kbm, pad and touch', () => {
  const { Prompts } = load();
  Prompts.setDevice('touch');
  for (const d of ['mouse', 'keyboard', '', 'KBM', 'Pad', ' pad', null, undefined, 0, 1, true, {}, ['kbm'], ['pad'], () => 'pad']) {
    Prompts.setDevice(d);
    assert.equal(Prompts.device, 'touch', `junk ${String(d)} left the device alone`);
  }
  for (const d of DEVICES) {
    Prompts.setDevice(d);
    assert.equal(Prompts.device, d);
  }
});

test('prompts: every string fits 312 px at scale 1 and uses only glyphs the font has', () => {
  const CB = load();
  let widest = 0;
  for (const k of KEYS) {
    for (const d of DEVICES) {
      const s = CB.Prompts.text(k, d);
      const w = CB.Font.measure(s, 1);
      assert.ok(w <= MAX_W, `${k}/${d} is ${w} px: ${JSON.stringify(s)}`);
      widest = Math.max(widest, w);
      for (const ch of Array.from(s)) assert.ok(CB.Font.has(ch), `${k}/${d} uses ${JSON.stringify(ch)}, which the font lacks`);
    }
  }
  assert.ok(widest > 0);
});

test('prompts: the rows screens build around a prompt still fit (long hat name, game-over retry row)', () => {
  const CB = load();
  // The title's hat row is 'hat: <name> ' + hat, and game over's retry row is retryKey + ': ' + label.
  for (const d of DEVICES) {
    const hatRow = 'hat: Stack Overflow Bucket Hat ' + CB.Prompts.text('hat', d);
    assert.ok(CB.Font.measure(hatRow, 1) <= MAX_W, `hat row on ${d}`);
  }
  const gameOverRow = (d) => CB.Prompts.text('retryKey', d) + ': retry wave 2';
  for (const d of DEVICES) assert.ok(CB.Font.measure(gameOverRow(d), 1) <= MAX_W, `game over row on ${d}`);
  assert.equal(gameOverRow('kbm'), 'R / click: retry wave 2', 'kbm still reads as before');
});

test('prompts: detect() says touch only for a coarse pointer with no fine pointer anywhere', () => {
  const { Prompts } = load();
  const calls = [];
  const win = (coarse, fine) => ({
    matchMedia(q) {
      calls.push([this, q]);
      return { matches: q === '(pointer: coarse)' ? coarse : q === '(any-pointer: fine)' ? fine : false };
    },
  });
  assert.equal(Prompts.detect(win(true, false)), 'touch', 'a phone');
  assert.equal(Prompts.detect(win(true, true)), 'kbm', 'a touchscreen laptop: a mouse is also there');
  assert.equal(Prompts.detect(win(false, false)), 'kbm');
  assert.equal(Prompts.detect(win(false, true)), 'kbm', 'a desktop');
  assert.ok(calls.some((c) => c[1] === '(pointer: coarse)'));
  assert.ok(calls.some((c) => c[1] === '(any-pointer: fine)'));
  const w = win(true, false);
  Prompts.detect(w);
  assert.equal(calls[calls.length - 1][0], w, 'matchMedia is called as a method of the window');
});

test('prompts: detect() falls back to kbm when matchMedia is missing, throws, or answers nothing', () => {
  const { Prompts } = load();
  assert.equal(Prompts.detect({}), 'kbm', 'no matchMedia');
  assert.equal(Prompts.detect({ matchMedia: 'nope' }), 'kbm');
  assert.equal(Prompts.detect(null), 'kbm');
  assert.equal(Prompts.detect(undefined), 'kbm');
  assert.equal(Prompts.detect({ matchMedia() { throw new Error('blocked'); } }), 'kbm', 'throws');
  assert.equal(Prompts.detect({ matchMedia: () => null }), 'kbm', 'answers null');
  assert.equal(Prompts.detect({ matchMedia: () => ({}) }), 'kbm', 'answers no `matches`');
  // The coarse query works but the fine query throws: the safe answer is still keyboard + mouse.
  let n = 0;
  assert.equal(Prompts.detect({ matchMedia() { if (n++ === 1) throw new Error('second query'); return { matches: true }; } }), 'kbm');
  assert.equal(Prompts.device, 'kbm', 'detect() only answers; it never changes the current device');
});

test('prompts: the harness sandbox (matchMedia matches nothing) detects kbm', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  assert.equal(CB.Prompts.detect(sandbox), 'kbm');
});
