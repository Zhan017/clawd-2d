'use strict';
// Audio: sound table, event mapping, throttles, pitch variation, music ducking and the persisted mute. Everything runs against
// H.fakeAudioContext(), which records what the code asked for (starts, param writes) instead of making any noise.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/core/audio.js'];

// Loads audio.js with a fake AudioContext installed and init() done. `opts` goes to H.load (e.g. { localStorage }).
function boot(opts) {
  const { CB, sandbox } = H.load(FILES, Object.assign({ returnSandbox: true }, opts));
  const ctx = H.fakeAudioContext();
  ctx.install(sandbox);
  CB.Audio.init();
  return { CB, sandbox, ctx };
}

function memStorage(init) {
  const store = Object.assign({}, init);
  return {
    store,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
  };
}

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.01 : eps);
const starts = (ctx) => ctx.starts.filter((s) => s.kind === 'oscillator');
const freqs = (ctx) => starts(ctx).map((s) => s.frequency);

// ---- headless -------------------------------------------------------------------------------------------------------------

test('audio: loads headless and is a no-op before init', () => {
  const CB = H.load(FILES);
  CB.Audio.play('shoot');
  CB.Audio.handleEvents([{ type: 'shoot' }, { type: 'hit' }, { type: 'nonsense' }]);
  CB.Audio.init(); // the harness has no AudioContext: this must quietly leave audio disabled
  CB.Audio.play('bossDie');
  CB.Audio.handleEvents([{ type: 'bossDie', x: 1, y: 1 }]);
  assert.equal(CB.Audio.context(), null);
  assert.equal(CB.Audio.output(), null);
});

test('audio: every mapped event names a defined sound', () => {
  const CB = H.load(FILES);
  for (const [ev, snd] of Object.entries(CB.Audio.EVENT_SOUND)) assert.equal(typeof CB.Audio.SOUNDS[snd], 'function', `${ev} -> ${snd}`);
  for (const k of ['shoot', 'hit', 'enemyDie', 'playerHurt', 'bossDie', 'patchPick', 'uiSelect', 'bossWarn']) assert.equal(typeof CB.Audio.SOUNDS[k], 'function', k);
});

test('audio: the sound table and the event table cover everything the game emits', () => {
  const CB = H.load(FILES);
  const sounds = Object.keys(CB.Audio.SOUNDS).sort();
  assert.deepEqual(
    sounds,
    ['beam', 'beamCharge', 'blast', 'bossDie', 'bossPhase', 'bossWarn', 'bounce', 'clink', 'compact', 'compactReady', 'dash', 'enemyDie', 'enemyShoot',
      'heartbeat', 'hit', 'lob', 'patchPick', 'perfect', 'pickup', 'playerDie', 'playerHurt', 'revive', 'shoot', 'splat', 'spawn', 'teleport',
      'uiSelect', 'unlock', 'victory'].sort()
  );
  assert.ok(!('graze' in CB.Audio.SOUNDS), 'the graze sound is gone (rev 3)');
  for (const ev of ['shoot', 'hit', 'clink', 'enemyDie', 'spawn', 'playerHurt', 'playerDie', 'dash', 'bounce', 'enemyShoot', 'bossPhase', 'bossDie', 'bossWarn',
    'teleport', 'beamCharge', 'beam', 'lob', 'splat', 'revive', 'patchPick', 'uiSelect', 'heartbeat', 'compact', 'compactReady', 'graze', 'pickup', 'blast',
    'victory', 'unlock', 'bossEnter']) assert.ok(ev in CB.Audio.EVENT_SOUND, `EVENT_SOUND.${ev}`);
  assert.equal(CB.Audio.EVENT_SOUND.bossEnter, 'teleport');
  assert.equal(CB.Audio.EVENT_SOUND.graze, 'perfect');
});

test('audio: toggleMute flips and reports state', () => {
  const CB = H.load(FILES);
  const m0 = CB.Audio.isMuted();
  assert.equal(CB.Audio.toggleMute(), !m0);
  assert.equal(CB.Audio.isMuted(), !m0);
  CB.Audio.setMuted(false);
  assert.equal(CB.Audio.isMuted(), false);
});

// ---- context --------------------------------------------------------------------------------------------------------------

test('audio: init builds a 0.25 master into the destination, exposes context() and output(), and is idempotent', () => {
  const { CB, ctx } = boot();
  assert.equal(CB.Audio.context(), ctx);
  assert.equal(CB.Audio.output(), ctx.gains[0]);
  assert.equal(CB.Audio.output().gain.value, 0.25);
  assert.equal(CB.Audio.output().connections[0], ctx.destination);
  assert.equal(CB.Audio.init(), true);
  assert.equal(ctx.gains.length, 1, 'a second init() does not build a second graph');
});

test('audio: init resumes a suspended context, and play stays silent until it runs', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  ctx.state = 'suspended';
  ctx.install(sandbox);
  CB.Audio.init();
  assert.equal(ctx.resumed, 1);
  assert.equal(ctx.state, 'running');
  CB.Audio.init();
  assert.equal(ctx.resumed, 1, 'a running context is left alone');
  ctx.state = 'suspended';
  CB.Audio.play('uiSelect');
  assert.equal(ctx.starts.length, 0, 'nothing is queued on a suspended context');
  CB.Audio.init();
  assert.equal(ctx.resumed, 2);
  CB.Audio.play('uiSelect');
  assert.equal(ctx.starts.length, 1);
});

test('audio: a rejected resume() is swallowed', async () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  ctx.state = 'suspended';
  ctx.resume = () => Promise.reject(new Error('blocked by autoplay policy'));
  ctx.install(sandbox);
  CB.Audio.init();
  await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run here
});

test('audio: any failure while building the graph leaves audio disabled', () => {
  const broken = [
    ['constructor throws', (sandbox) => { sandbox.AudioContext = function () { throw new Error('no audio'); }; sandbox.webkitAudioContext = undefined; }],
    ['createGain throws', (sandbox, ctx) => { ctx.createGain = () => { throw new Error('gain'); }; ctx.install(sandbox); }],
    ['createBuffer throws', (sandbox, ctx) => { ctx.createBuffer = () => { throw new Error('buffer'); }; ctx.install(sandbox); }],
  ];
  for (const [name, breakIt] of broken) {
    const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
    breakIt(sandbox, H.fakeAudioContext());
    assert.doesNotThrow(() => CB.Audio.init(), name);
    assert.equal(CB.Audio.context(), null, name);
    assert.equal(CB.Audio.output(), null, name);
    assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'shoot' }, { type: 'bossDie' }]), name);
  }
});

test('audio: the noise buffer is one second of seeded white noise (no Math.random: the harness throws on it)', () => {
  function noiseOf() {
    const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
    const ctx = H.fakeAudioContext();
    const made = [];
    const orig = ctx.createBuffer;
    ctx.createBuffer = (...a) => {
      const b = orig(...a);
      made.push(b);
      return b;
    };
    ctx.install(sandbox);
    CB.Audio.init();
    assert.equal(made.length, 1);
    return { CB, buf: made[0], ctx };
  }
  const a = noiseOf();
  const b = noiseOf();
  assert.equal(a.buf.length, a.ctx.sampleRate, 'one second');
  assert.equal(a.buf.sampleRate, a.ctx.sampleRate);
  const d = a.buf.getChannelData(0);
  assert.deepEqual(Array.from(d), Array.from(b.buf.getChannelData(0)), 'same seed, same noise');
  const rng = a.CB.createRng(0xc1a0d);
  assert.ok(near(d[0], rng.next() * 2 - 1, 1e-6), 'seed 0xC1A0D');
  let min = 1;
  let max = -1;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    min = Math.min(min, d[i]);
    max = Math.max(max, d[i]);
    sum += d[i];
  }
  assert.ok(min >= -1 && max <= 1 && min < -0.9 && max > 0.9, `range ${min}..${max}`);
  assert.ok(Math.abs(sum / d.length) < 0.02, 'centred on zero');
});

// ---- mute -----------------------------------------------------------------------------------------------------------------

test('audio: setMuted(true) sets the master gain to 0, silences play and restores 0.25 on unmute', () => {
  const { CB, ctx } = boot();
  CB.Audio.setMuted(true);
  assert.equal(CB.Audio.isMuted(), true);
  assert.equal(CB.Audio.output().gain.value, 0);
  CB.Audio.play('uiSelect');
  CB.Audio.handleEvents([{ type: 'bossDie', x: 1, y: 1 }]);
  assert.equal(ctx.starts.length, 0, 'muted: nothing is started');
  assert.equal(CB.Audio.toggleMute(), false);
  assert.equal(CB.Audio.output().gain.value, 0.25);
  CB.Audio.play('uiSelect');
  assert.equal(ctx.starts.length, 1);
});

test('audio: muted state is applied to a context created later', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  CB.Audio.setMuted(true);
  const ctx = H.fakeAudioContext();
  ctx.install(sandbox);
  CB.Audio.init();
  assert.equal(CB.Audio.output().gain.value, 0);
});

test('audio: mute persists in localStorage cb.muted (read at load, written by setMuted)', () => {
  const on = memStorage({ 'cb.muted': '1' });
  const a = H.load(FILES, { localStorage: on });
  assert.equal(a.Audio.isMuted(), true, 'reads "1" at load');
  a.Audio.setMuted(false);
  assert.equal(on.store['cb.muted'], '0');
  assert.equal(a.Audio.toggleMute(), true);
  assert.equal(on.store['cb.muted'], '1');

  const off = memStorage({ 'cb.muted': '0' });
  assert.equal(H.load(FILES, { localStorage: off }).Audio.isMuted(), false);
  const empty = memStorage();
  assert.equal(H.load(FILES, { localStorage: empty }).Audio.isMuted(), false, 'unset means sound on');
  assert.deepEqual(empty.store, {}, 'nothing is written until the player changes it');
});

test('audio: a throwing localStorage is harmless', () => {
  const bad = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  const CB = H.load(FILES, { localStorage: bad });
  assert.equal(CB.Audio.isMuted(), false);
  assert.doesNotThrow(() => CB.Audio.setMuted(true));
  assert.equal(CB.Audio.isMuted(), true, 'the in-memory state still changes');
  assert.doesNotThrow(() => CB.Audio.toggleMute());
  assert.equal(CB.Audio.isMuted(), false);
});

// ---- events ---------------------------------------------------------------------------------------------------------------

test('audio: two shoot events in one call start only one oscillator (70 ms throttle)', () => {
  const { CB, ctx } = boot();
  CB.Audio.handleEvents([{ type: 'shoot', x: 1, y: 1 }, { type: 'shoot', x: 2, y: 2 }]);
  assert.equal(ctx.oscillators.length, 1);
  assert.equal(starts(ctx).length, 1);
});

test('audio: a silent enemyDie starts nothing, a normal one starts a square thump plus a noise burst', () => {
  const { CB, ctx } = boot();
  CB.Audio.handleEvents([{ type: 'enemyDie', x: 1, y: 1, silent: true }]);
  assert.equal(ctx.starts.length, 0);
  CB.Audio.handleEvents([{ type: 'enemyDie', x: 1, y: 1, silent: false }]);
  assert.equal(starts(ctx).length, 1);
  assert.equal(ctx.bufferSources.length, 1);
  assert.equal(ctx.starts.length, 2);
});

test('audio: unknown events, junk entries and non-array input are ignored', () => {
  const { CB, ctx } = boot();
  assert.doesNotThrow(() => {
    CB.Audio.handleEvents(null);
    CB.Audio.handleEvents(undefined);
    CB.Audio.handleEvents('shoot');
    CB.Audio.handleEvents([null, undefined, 5, {}, { type: 'nonsense' }, { type: 'constructor' }, { type: '__proto__' }, { type: 'toString' }, { type: 'text', x: 1, y: 1 }]);
  });
  assert.equal(ctx.starts.length, 0);
  assert.doesNotThrow(() => CB.Audio.play('nonsense'));
  assert.doesNotThrow(() => CB.Audio.play('constructor'));
  assert.doesNotThrow(() => CB.Audio.play(undefined));
  assert.equal(ctx.starts.length, 0);
});

// Per event: the oscillator types and start frequencies in creation order, how many noise bursts, and the filter type if any.
const RECIPES = [
  ['shoot', ['square'], [880], 0, null],
  ['hit', ['triangle'], [320], 0, null],
  ['clink', ['square'], [1400], 0, null],
  ['enemyDie', ['square'], [240], 1, 'lowpass'],
  ['spawn', ['triangle'], [220], 0, null],
  ['playerHurt', ['square'], [320], 1, 'lowpass'],
  ['playerDie', ['square', 'square', 'square', 'square'], [659.26, 523.25, 440, 329.63], 0, null],
  ['dash', [], [], 1, 'highpass'],
  ['bounce', ['triangle'], [660], 0, null],
  ['enemyShoot', ['square'], [210], 0, null],
  ['bossPhase', ['square', 'square', 'square', 'square', 'square', 'square'], [660, 440, 660, 440, 660, 440], 0, null],
  ['bossDie', ['square'], [200], 1, 'lowpass'],
  ['bossWarn', ['square', 'square', 'square', 'square'], [110, 110, 110, 110], 0, null],
  ['bossEnter', ['square'], [200], 0, null],
  ['teleport', ['square'], [200], 0, null],
  ['beamCharge', ['sine'], [200], 0, null],
  ['beam', ['sawtooth', 'sine'], [110, 30], 0, null],
  ['lob', ['triangle'], [380], 0, null],
  ['splat', [], [], 1, 'lowpass'],
  ['revive', ['square', 'square', 'square', 'square'], [440, 523.25, 659.26, 880], 0, null],
  ['patchPick', ['triangle', 'triangle', 'triangle', 'triangle'], [523.25, 659.26, 783.99, 1046.5], 0, null],
  ['uiSelect', ['square'], [990], 0, null],
  ['heartbeat', ['sine', 'sine'], [70, 70], 0, null],
  ['compact', ['sine'], [120], 1, 'highpass'],
  ['compactReady', ['triangle', 'triangle'], [880, 1320], 0, null],
  ['pickup', ['triangle', 'triangle', 'triangle'], [1046.5, 1318.51, 1567.98], 0, null],
  ['blast', ['triangle'], [160], 1, 'lowpass'],
  ['victory', ['square', 'square', 'square', 'square', 'square', 'square'], [783.99, 1046.5, 1318.51, 1567.98, 1318.51, 2093], 0, null],
  ['unlock', ['triangle', 'triangle', 'triangle', 'triangle'], [880, 1108.73, 1318.51, 1760], 0, null],
];

test('audio: each event plays its recipe from the plan (oscillator types, start pitches, noise bursts)', () => {
  for (const [ev, types, fr, noises, filt] of RECIPES) {
    const { CB, ctx } = boot();
    CB.Audio.handleEvents([{ type: ev, x: 10, y: 10 }]);
    assert.deepEqual(starts(ctx).map((s) => s.type), types, `${ev}: types`);
    const got = freqs(ctx);
    assert.equal(got.length, fr.length, `${ev}: oscillator count`);
    fr.forEach((f, i) => assert.ok(near(got[i], f), `${ev}: osc ${i} starts at ${got[i]}, wanted ${f}`));
    assert.equal(ctx.bufferSources.length, noises, `${ev}: noise bursts`);
    if (filt) assert.ok(ctx.filters.some((f) => f.type === filt), `${ev}: ${filt} filter`);
    else assert.equal(ctx.filters.length, 0, `${ev}: no filter`);
  }
});

test('audio: filter cutoffs follow the recipes', () => {
  const cutoff = (ev) => {
    const { CB, ctx } = boot();
    CB.Audio.handleEvents([{ type: ev, x: 1, y: 1 }]);
    return ctx.filters[0].frequency.values;
  };
  assert.equal(cutoff('enemyDie')[0], 2000);
  assert.equal(cutoff('dash')[0], 1500);
  assert.equal(cutoff('splat')[0], 900);
  assert.equal(cutoff('blast')[0], 1200);
  const boss = cutoff('bossDie');
  assert.equal(boss[0], 3000, 'bossDie sweeps from 3 kHz');
  assert.equal(boss[boss.length - 1], 200, '... down to 200 Hz');
});

test('audio: playerHurt with god plays the hit blip instead; graze plays only when perfect', () => {
  let b = boot();
  b.CB.Audio.handleEvents([{ type: 'playerHurt', x: 1, y: 1, god: true }]);
  assert.deepEqual(starts(b.ctx).map((s) => s.type), ['triangle']);
  assert.ok(near(starts(b.ctx)[0].frequency, 320));
  assert.equal(b.ctx.bufferSources.length, 0);

  b = boot();
  b.CB.Audio.handleEvents([{ type: 'graze', x: 1, y: 1 }]);
  assert.equal(b.ctx.starts.length, 0, 'a plain graze is silent');
  b.CB.Audio.handleEvents([{ type: 'graze', x: 1, y: 1, perfect: false }]);
  assert.equal(b.ctx.starts.length, 0);
  b.CB.Audio.handleEvents([{ type: 'graze', x: 1, y: 1, perfect: true }]);
  assert.deepEqual(freqs(b.ctx), [1200, 1800], 'perfect: the two-tone rise');
});

test('audio: heartbeat is not throttled', () => {
  const { CB, ctx } = boot();
  CB.Audio.handleEvents([{ type: 'heartbeat', x: 1, y: 1 }, { type: 'heartbeat', x: 1, y: 1 }]);
  assert.equal(starts(ctx).length, 4, 'two heartbeats, two thumps each');
});

// ---- throttles and variation ----------------------------------------------------------------------------------------------

test('audio: throttles are measured on ctx.currentTime and the first sound is never swallowed', () => {
  // [sound, gap, oscillators + noise bursts one play starts]
  for (const [name, gap, voices] of [['shoot', 0.07, 1], ['enemyShoot', 0.09, 1], ['hit', 0.04, 1], ['perfect', 0.05, 2], ['blast', 0.06, 2], ['clink', 0.05, 1]]) {
    const { CB, ctx } = boot();
    ctx.currentTime = 0;
    CB.Audio.play(name);
    assert.equal(ctx.starts.length, voices, `${name}: first play at t = 0`);
    ctx.currentTime = gap * 0.9;
    CB.Audio.play(name);
    assert.equal(ctx.starts.length, voices, `${name}: blocked inside ${gap} s`);
    ctx.currentTime = gap * 1.1;
    CB.Audio.play(name);
    assert.equal(ctx.starts.length, voices * 2, `${name}: allowed after ${gap} s`);
  }
});

test('audio: sounds without a throttle play every time', () => {
  const { CB, ctx } = boot();
  CB.Audio.handleEvents([{ type: 'enemyDie', x: 1, y: 1 }, { type: 'enemyDie', x: 2, y: 2 }, { type: 'spawn', x: 1, y: 1 }, { type: 'spawn', x: 1, y: 1 }]);
  assert.equal(starts(ctx).length, 4);
  assert.equal(ctx.bufferSources.length, 2);
});

test('audio: shoot, hit and enemyDie cycle their pitch multipliers; four spaced shots start at >= 3 distinct pitches', () => {
  let { CB, ctx } = boot();
  const seq = (name, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      ctx.currentTime = i * 0.2;
      CB.Audio.play(name);
    }
    return out;
  };
  seq('shoot', 5);
  const sf = freqs(ctx);
  assert.ok(new Set(sf.map((f) => Math.round(f * 100))).size >= 3);
  [1, 1.06, 0.97, 1.09, 1].forEach((m, i) => assert.ok(near(sf[i], 880 * m), `shoot ${i}: ${sf[i]} vs ${880 * m}`));

  ({ CB, ctx } = boot());
  seq('hit', 4);
  [1, 0.92, 1.1, 1].forEach((m, i) => assert.ok(near(freqs(ctx)[i], 320 * m), `hit ${i}`));

  ({ CB, ctx } = boot());
  seq('enemyDie', 5);
  [1, 0.85, 1.15, 0.93, 1].forEach((m, i) => {
    assert.ok(near(freqs(ctx)[i], 240 * m), `enemyDie ${i}`);
    assert.ok(near(ctx.filters[i].frequency.values[0], 2000 * m), `enemyDie ${i} noise cutoff`);
  });
});

test('audio: a throttled sound does not advance the variation counter', () => {
  const { CB, ctx } = boot();
  ctx.currentTime = 0;
  CB.Audio.play('shoot');
  CB.Audio.play('shoot'); // throttled
  CB.Audio.play('shoot'); // throttled
  ctx.currentTime = 0.1;
  CB.Audio.play('shoot');
  assert.equal(starts(ctx).length, 2);
  assert.ok(near(freqs(ctx)[0], 880));
  assert.ok(near(freqs(ctx)[1], 880 * 1.06), 'the second played shot is variant 1');
});

test('audio: sounds other than shoot, hit and enemyDie are not varied', () => {
  const { CB, ctx } = boot();
  for (let i = 0; i < 4; i++) {
    ctx.currentTime = i;
    CB.Audio.play('uiSelect');
    CB.Audio.play('enemyShoot');
  }
  const ui = starts(ctx).filter((s) => near(s.frequency, 990)).length;
  const es = starts(ctx).filter((s) => near(s.frequency, 210)).length;
  assert.equal(ui, 4);
  assert.equal(es, 4);
});

// ---- music ducking --------------------------------------------------------------------------------------------------------

test('audio: handleEvents ducks the music on playerHurt, bossPhase, compact and heartbeat only', () => {
  const { CB } = boot();
  const calls = [];
  CB.Music = { duck: (a, h, r) => calls.push([a, h, r]) };
  CB.Audio.handleEvents([
    { type: 'shoot', x: 1, y: 1 }, { type: 'playerHurt', x: 1, y: 1 }, { type: 'bossPhase', x: 1, y: 1 }, { type: 'compact', x: 1, y: 1 },
    { type: 'heartbeat', x: 1, y: 1 }, { type: 'hit', x: 1, y: 1 }, { type: 'bossDie', x: 1, y: 1 }, { type: 'enemyDie', x: 1, y: 1 },
  ]);
  assert.deepEqual(H.plain(calls), [[0.4, 0.12, 0.35], [0.5, 0.3, 0.6], [0.5, 0.2, 0.5], [0.7, 0.05, 0.2]]);
});

test('audio: ducking is guarded by method and a throwing duck does not stop the sounds', () => {
  const { CB, ctx } = boot();
  CB.Music = {};
  assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'playerHurt', x: 1, y: 1 }]));
  CB.Music = { duck: 'not a function' };
  assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'heartbeat', x: 1, y: 1 }]));
  let n = 0;
  CB.Music = {
    duck() {
      n++;
      throw new Error('boom');
    },
  };
  const before = ctx.starts.length;
  assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'bossPhase', x: 1, y: 1 }, { type: 'compact', x: 1, y: 1 }]));
  assert.equal(n, 2, 'duck was still tried for both');
  assert.ok(ctx.starts.length > before, 'and the sounds still played');
  delete CB.Music;
  assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'playerHurt', x: 1, y: 1 }]));
});

test('audio: ducking does not depend on audio being initialised or unmuted', () => {
  const CB = H.load(FILES);
  const calls = [];
  CB.Music = { duck: (a, h, r) => calls.push([a, h, r]) };
  CB.Audio.handleEvents([{ type: 'heartbeat', x: 1, y: 1 }]);
  assert.equal(calls.length, 1);
});

// ---- every recipe is well-formed ------------------------------------------------------------------------------------------

test('audio: every sound schedules at or after now, stays under a second (bossDie 1.3 s), and only writes finite, legal param values', () => {
  const T0 = 5;
  for (const name of Object.keys(H.load(FILES).Audio.SOUNDS)) {
    const { CB, ctx } = boot();
    ctx.currentTime = T0;
    const g0 = ctx.gains.length;
    CB.Audio.play(name);
    assert.ok(ctx.starts.length >= 1, `${name}: makes a sound`);
    const nodes = ctx.starts.map((s) => s.node);
    let end = T0;
    for (const n of nodes) {
      assert.ok(n.startTime >= T0, `${name}: start ${n.startTime} >= now`);
      assert.ok(n.stopTime !== null && n.stopTime > n.startTime, `${name}: every source is stopped after it starts`);
      end = Math.max(end, n.stopTime);
    }
    assert.ok(end - T0 <= (name === 'bossDie' ? 1.3 : 1.0), `${name}: lasts ${(end - T0).toFixed(3)} s`);
    const params = [];
    for (const g of ctx.gains.slice(g0)) params.push(['gain', g.gain]);
    for (const o of ctx.oscillators) params.push(['osc frequency', o.frequency]);
    for (const f of ctx.filters) params.push(['filter frequency', f.frequency]);
    for (const s of ctx.bufferSources) params.push(['playbackRate', s.playbackRate]);
    for (const [label, p] of params) {
      for (const e of p.events) {
        if (e.kind === 'cancel') continue;
        assert.ok(Number.isFinite(e.value), `${name}: ${label} write ${e.value} is finite`);
        assert.ok(Number.isFinite(e.time) && e.time >= T0 - 1e-9, `${name}: ${label} write at ${e.time}`);
        if (e.kind === 'exp') assert.ok(e.value > 0, `${name}: ${label} exponential ramp target ${e.value} must be > 0`);
      }
    }
    for (const g of ctx.gains.slice(g0).filter((x) => x.connections.includes(CB.Audio.output()))) {
      const peak = Math.max(...g.gain.values);
      assert.ok(peak > 0 && peak <= 0.4, `${name}: gain peak ${peak}`);
    }
  }
});

test('audio: voices clean up after themselves (gain disconnects when the source ends)', () => {
  const { CB, ctx } = boot();
  CB.Audio.play('uiSelect');
  const osc = ctx.oscillators[0];
  const g = ctx.gains[1];
  assert.equal(g.connections[0], CB.Audio.output(), 'voice gain feeds the master');
  assert.equal(typeof osc.onended, 'function');
  osc.onended();
  assert.equal(g.connections.length, 0);
});

test('audio: a sound that throws mid-build never escapes play or handleEvents', () => {
  const { CB, ctx } = boot();
  ctx.createBiquadFilter = () => {
    throw new Error('no filters here');
  };
  assert.doesNotThrow(() => CB.Audio.handleEvents([{ type: 'enemyDie', x: 1, y: 1 }, { type: 'dash', x: 1, y: 1 }, { type: 'uiSelect' }]));
  assert.ok(starts(ctx).length >= 1, 'later sounds still play');
});

// ---- recipe numbers (durations, end pitches, levels, note spacing) --------------------------------------------------------

test('audio: single-voice recipes match the plan table (duration, end pitch, level)', () => {
  // [sound, duration s, end Hz or null for a flat pitch, gain peak]
  const TABLE = [
    ['shoot', 0.045, 620, 0.1],
    ['hit', 0.035, 180, 0.18],
    ['clink', 0.025, null, 0.06],
    ['spawn', 0.09, 440, 0.08],
    ['enemyShoot', 0.035, null, 0.07],
    ['bounce', 0.03, null, null],
    ['teleport', 0.12, 1600, null],
    ['lob', 0.12, 720, null],
    ['beamCharge', 0.8, 900, 0.08],
    ['uiSelect', 0.03, null, null],
  ];
  for (const [name, dur, endHz, vol] of TABLE) {
    const { CB, ctx } = boot();
    ctx.currentTime = 2;
    CB.Audio.play(name);
    const o = ctx.oscillators[0];
    assert.equal(ctx.oscillators.length, 1, name);
    assert.ok(near(o.stopTime - o.startTime - 0.03, dur, 1e-9), `${name}: lasts ${o.stopTime - o.startTime - 0.03}, wanted ${dur}`);
    const glide = o.frequency.events.filter((e) => e.kind === 'exp');
    if (endHz === null) assert.equal(glide.length, 0, `${name}: flat pitch`);
    else {
      assert.equal(glide.length, 1, `${name}: one glide`);
      assert.ok(near(glide[0].value, endHz, 1e-6), `${name}: glides to ${glide[0].value}`);
      assert.ok(near(glide[0].time, 2 + dur, 1e-9), `${name}: glide ends with the note`);
    }
    if (vol !== null) assert.ok(near(Math.max(...o.connections[0].gain.values), vol, 1e-9), `${name}: level ${Math.max(...o.connections[0].gain.values)}`);
  }
});

test('audio: arpeggios and multi-hit sounds use the plan note spacing', () => {
  // [sound, seconds between note starts]
  for (const [name, step] of [['playerDie', 0.09], ['bossPhase', 0.12], ['patchPick', 0.07], ['compactReady', 0.06], ['perfect', 0.04], ['pickup', 0.05], ['victory', 0.11], ['heartbeat', 0.14]]) {
    const { CB, ctx } = boot();
    ctx.currentTime = 3;
    CB.Audio.play(name);
    const t = starts(ctx).map((s) => s.time);
    assert.ok(t.length >= 2, name);
    t.forEach((x, i) => assert.ok(near(x, 3 + i * step, 1e-9), `${name}: note ${i} at ${x - 3}, wanted ${i * step}`));
  }
  const { CB, ctx } = boot();
  ctx.currentTime = 1;
  CB.Audio.play('heartbeat');
  const [a, b] = ctx.oscillators;
  assert.ok(near(a.frequency.events.find((e) => e.kind === 'exp').value, 45, 1e-9), 'thump 70 -> 45 Hz');
  assert.ok(near(a.stopTime - a.startTime - 0.03, 0.08, 1e-9), '80 ms thumps');
  assert.ok(near(b.startTime - a.startTime, 0.14, 1e-9));
});

test('audio: noise bursts loop (bossDie outlasts the 1 s buffer) and the beam vibrato is a 30 Hz LFO on the saw pitch', () => {
  let b = boot();
  b.CB.Audio.play('bossDie');
  assert.equal(b.ctx.bufferSources.length, 1);
  assert.equal(b.ctx.bufferSources[0].loop, true);
  assert.ok(b.ctx.bufferSources[0].stopTime - b.ctx.bufferSources[0].startTime > 1.2, 'noise lasts the full 1.2 s');

  b = boot();
  b.CB.Audio.play('beam');
  const [saw, lfo] = b.ctx.oscillators;
  assert.equal(saw.type, 'sawtooth');
  assert.equal(lfo.type, 'sine');
  assert.ok(near(lfo.frequency.values[0], 30, 1e-9));
  const depth = lfo.connections[0];
  assert.equal(depth.connections[0], saw.frequency, 'the LFO modulates the saw frequency');
  assert.ok(near(saw.stopTime - saw.startTime - 0.03, 0.5, 1e-9), '0.5 s beam');
  lfo.onended();
  assert.equal(depth.connections.length, 0, 'LFO depth gain is released');
});
