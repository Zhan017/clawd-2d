'use strict';
// CB.Comfort: calm mode (saved flag, then prefers-reduced-motion), calm-aware blink, shake and flash.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = [...H.CORE, 'src/game/unlocks.js', 'src/game/comfort.js'];

function memStorage() {
  const mem = {};
  return {
    mem,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = String(v);
    },
  };
}

// `media` = what (prefers-reduced-motion: reduce) answers; 'none' removes matchMedia, 'throws' makes it throw.
function setup(media, files) {
  const storage = memStorage();
  const { CB, sandbox } = H.load(files || FILES, { returnSandbox: true, localStorage: storage });
  const asked = [];
  if (media === 'none') sandbox.matchMedia = undefined;
  else if (media === 'throws') {
    sandbox.matchMedia = () => {
      throw new Error('no media queries here');
    };
  } else {
    sandbox.matchMedia = (q) => {
      asked.push(q);
      return { matches: !!media, addEventListener() {} };
    };
  }
  return { CB, sandbox, storage, asked };
}

test('comfort: the module exposes calm, set, toggle, blink, shake and flash', () => {
  const { CB } = setup(false);
  for (const k of ['calm', 'set', 'toggle', 'blink', 'shake', 'flash']) assert.equal(typeof CB.Comfort[k], 'function', k);
});

test('comfort: calm() is false with nothing saved and no reduced-motion preference', () => {
  const { CB } = setup(false);
  assert.equal(CB.Comfort.calm(), false);
});

test('comfort: with nothing saved, calm() follows prefers-reduced-motion: reduce', () => {
  const { CB, asked } = setup(true);
  assert.equal(CB.Comfort.calm(), true);
  assert.ok(asked.includes('(prefers-reduced-motion: reduce)'), JSON.stringify(asked));
});

test('comfort: a saved choice beats the media query, both ways', () => {
  const on = setup(false);
  on.CB.Comfort.set(true);
  assert.equal(on.CB.Comfort.calm(), true);
  const off = setup(true);
  assert.equal(off.CB.Comfort.calm(), true, 'the preference alone');
  off.CB.Comfort.set(false);
  assert.equal(off.CB.Comfort.calm(), false, 'an explicit off wins over the OS preference');
});

test('comfort: a missing or throwing matchMedia is harmless and means "not calm"', () => {
  for (const media of ['none', 'throws']) {
    const { CB } = setup(media);
    assert.doesNotThrow(() => CB.Comfort.calm(), media);
    assert.equal(CB.Comfort.calm(), false, media);
    assert.equal(CB.Comfort.blink(0, 10), true, media);
  }
});

test('comfort: a saved value that is not a boolean is ignored', () => {
  const { CB } = setup(true);
  CB.Save.set('calm', 'yes');
  assert.equal(CB.Comfort.calm(), true, 'falls back to the media query');
  CB.Save.set('calm', 0);
  assert.equal(CB.Comfort.calm(), true);
  const plain = setup(false);
  plain.CB.Save.set('calm', 'yes');
  assert.equal(plain.CB.Comfort.calm(), false);
});

test('comfort: set() stores a boolean under cb.calm; toggle() flips, persists and returns the new state', () => {
  const { CB, storage } = setup(false);
  CB.Comfort.set(1);
  assert.equal(storage.mem['cb.calm'], 'true', 'coerced to a boolean');
  assert.equal(CB.Comfort.toggle(), false);
  assert.equal(storage.mem['cb.calm'], 'false');
  assert.equal(CB.Comfort.calm(), false);
  assert.equal(CB.Comfort.toggle(), true);
  assert.equal(storage.mem['cb.calm'], 'true');
  assert.equal(CB.Comfort.calm(), true);
});

test('comfort: toggling flips the effective state even when it came from the media query', () => {
  const { CB, storage } = setup(true);
  assert.equal(CB.Comfort.calm(), true);
  assert.equal(CB.Comfort.toggle(), false);
  assert.equal(CB.Comfort.calm(), false);
  assert.equal(storage.mem['cb.calm'], 'false');
});

test('comfort: a saved choice is read back by a fresh load (it really is in storage)', () => {
  const first = setup(false);
  first.CB.Comfort.set(true);
  const storage = first.storage;
  const CB = H.load(FILES, { localStorage: storage });
  assert.equal(CB.Comfort.calm(), true);
});

test('comfort: without CB.Save the choice is still kept for the session', () => {
  const { CB } = setup(false, [...H.CORE, 'src/game/comfort.js']);
  assert.equal(CB.Save, undefined);
  assert.equal(CB.Comfort.calm(), false);
  CB.Comfort.set(true);
  assert.equal(CB.Comfort.calm(), true);
  assert.equal(CB.Comfort.toggle(), false);
  assert.equal(CB.Comfort.calm(), false);
});

test('comfort: blink flips every 1/(2 hz) s normally, and never faster than 4 Hz when calm', () => {
  const { CB } = setup(false);
  assert.equal(CB.Comfort.blink(0, 10), true);
  assert.equal(CB.Comfort.blink(0.05, 10), true);
  assert.equal(CB.Comfort.blink(0.1, 10), false);
  assert.equal(CB.Comfort.blink(0.15, 10), false);
  assert.equal(CB.Comfort.blink(0.2, 10), true);
  assert.equal(CB.Comfort.blink(0.3, 6), false);
  CB.Comfort.set(true);
  // calm: 10 Hz becomes 4 Hz, so the phase changes every 0.25 s
  assert.equal(CB.Comfort.blink(0.1, 10), true);
  assert.equal(CB.Comfort.blink(0.2, 10), true);
  assert.equal(CB.Comfort.blink(0.26, 10), false);
  assert.equal(CB.Comfort.blink(0.51, 10), true);
  // a slow blink is left alone
  assert.equal(CB.Comfort.blink(0.3, 2), true);
  assert.equal(CB.Comfort.blink(0.55, 2), false);
});

test('comfort: blink matches the formula over a sweep, calm and not', () => {
  const { CB } = setup(false);
  for (const calm of [false, true]) {
    CB.Comfort.set(calm);
    for (const hz of [1, 3, 4, 5, 8, 12, 20]) {
      const eff = calm ? Math.min(hz, 4) : hz;
      for (let i = 0; i < 200; i++) {
        const t = i * 0.0137;
        assert.equal(CB.Comfort.blink(t, hz), Math.floor(t * eff) % 2 === 0, `calm=${calm} hz=${hz} t=${t}`);
      }
    }
  }
});

test('comfort: shake() is the world shake, or 0 when calm', () => {
  const { CB } = setup(false);
  const w = { shake: 4 };
  assert.equal(CB.Comfort.shake(w), 4);
  CB.Comfort.set(true);
  assert.equal(CB.Comfort.shake(w), 0);
  assert.equal(w.shake, 4, 'the sim value is never touched');
});

test('comfort: flash() is a capped full-screen alpha normally, and a capped frame alpha when calm', () => {
  const { CB } = setup(false);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let f = CB.Comfort.flash({ flash: 0.1 });
  assert.ok(near(f.alpha, 0.2), String(f.alpha));
  assert.equal(f.frame, 0);
  f = CB.Comfort.flash({ flash: 0.25 });
  assert.equal(f.alpha, 0.35, 'capped at 0.35');
  assert.equal(CB.Comfort.flash({ flash: 0 }).alpha, 0);
  CB.Comfort.set(true);
  f = CB.Comfort.flash({ flash: 0.1 });
  assert.equal(f.alpha, 0, 'no full-screen flash when calm');
  assert.ok(near(f.frame, 0.3), String(f.frame));
  f = CB.Comfort.flash({ flash: 0.25 });
  assert.equal(f.alpha, 0);
  assert.equal(f.frame, 0.5, 'capped at 0.5');
  assert.equal(CB.Comfort.flash({ flash: 0 }).frame, 0);
});
