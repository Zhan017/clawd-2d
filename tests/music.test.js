'use strict';
// Music: seeded per-stage patterns, the intensity ladder and the lookahead scheduler. The scheduler runs against H.fakeAudioContext()
// and the sandbox's recorded setInterval callbacks, so a test moves the clock and calls the 30 ms tick by hand; nothing makes noise.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/core/audio.js', 'src/core/music.js'];
const STAGE_IDS = ['src', 'node_modules', 'git', 'prod'];
const BPM = { src: 124, node_modules: 108, git: 136, prod: 152 };
// Pitch classes of each stage's scale (0 = C): A minor pentatonic, D dorian, E minor, C# whole-half diminished.
const PCS = {
  src: [9, 0, 2, 4, 7],
  node_modules: [2, 4, 5, 7, 9, 11, 0],
  git: [4, 6, 7, 9, 11, 0, 2],
  prod: [1, 3, 4, 6, 7, 9, 10, 0],
};

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);
const midiOf = (hz) => 69 + 12 * Math.log2(hz / 440);

// Loads the modules with a fake AudioContext installed and Audio.init() done. `opts` goes to H.load (e.g. { localStorage }).
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

const runOf = (state, stageId, phase) => ({
  state,
  stageIndex: Math.max(0, STAGE_IDS.indexOf(stageId)),
  world: { stage: { id: stageId }, boss: phase ? { phase } : null },
});

// Moves the clock in 30 ms ticks and runs every registered scheduler callback on each one. Every note started by a tick must lie
// between "now" and the 0.15 s lookahead: never in the past, never far ahead.
function advance(env, seconds) {
  const n = Math.round(seconds / 0.03);
  for (let i = 0; i < n; i++) {
    env.ctx.currentTime += 0.03;
    const before = env.ctx.starts.length;
    for (const fn of env.sandbox.__intervals.slice()) fn();
    for (let k = before; k < env.ctx.starts.length; k++) {
      const t = env.ctx.starts[k].time;
      assert.ok(t >= env.ctx.currentTime - 1e-9, `start ${t} is before now (${env.ctx.currentTime})`);
      assert.ok(t <= env.ctx.currentTime + 0.15 + 1e-9, `start ${t} is beyond the lookahead from ${env.ctx.currentTime}`);
    }
  }
}

const basses = (ctx) => ctx.starts.filter((s) => s.kind === 'oscillator' && s.type === 'triangle');
const leads = (ctx) => ctx.starts.filter((s) => s.kind === 'oscillator' && s.type === 'square');
const hats = (ctx) => ctx.starts.filter((s) => s.kind === 'bufferSource');
const musicNode = (env) => env.ctx.gains.find((g) => g.connections.includes(env.CB.Audio.output()));
// The per-note gain node a voice feeds (a hat goes through its highpass first).
function gainOf(start) {
  let n = start.node.connections[0];
  while (n && n.kind !== 'gain') n = n.connections[0];
  return n;
}
const peakOf = (start) => Math.max(...gainOf(start).gain.values);
const noteAt = (id, bar, ch, step) => H.load(FILES).Music.pattern(id, bar).find((n) => n.ch === ch && n.step === step);

// ---- plan tests -----------------------------------------------------------------------------------------------------------

test('music: patterns are deterministic per stage and differ across stages', () => {
  const CB = H.load(FILES);
  const a = JSON.stringify(CB.Music.pattern('src', 0));
  assert.equal(a, JSON.stringify(CB.Music.pattern('src', 0)));
  assert.notEqual(a, JSON.stringify(CB.Music.pattern('prod', 0)));
});

test('music: every note has a legal step, channel and audible frequency', () => {
  const CB = H.load(FILES);
  for (const id of ['src', 'node_modules', 'git', 'prod']) {
    for (let bar = 0; bar < 8; bar++) {
      const notes = CB.Music.pattern(id, bar);
      assert.ok(notes.length > 0);
      for (const n of notes) {
        assert.ok(Number.isInteger(n.step) && n.step >= 0 && n.step <= 15);
        assert.ok(['bass', 'lead', 'hat'].includes(n.ch));
        if (n.ch !== 'hat') assert.ok(n.freq >= 55 && n.freq <= 1760, `${id} ${n.freq}`);
      }
    }
  }
});

test('music: intensity follows run state', () => {
  const CB = H.load(FILES);
  const I = (state, phase) => CB.Music.intensityFor({ state, world: { boss: phase ? { phase } : null } });
  assert.equal(I('wave'), 0);
  assert.equal(I('bossWarn'), -1);
  assert.equal(I('boss', 1), 1);
  assert.equal(I('boss', 2), 2);
  assert.equal(I('dead'), -1);
});

test('music: with no AudioContext every call is a safe no-op', () => {
  const CB = H.load(FILES);
  CB.Music.start();
  CB.Music.update({ state: 'boss', stageIndex: 0, world: { boss: { phase: 2 }, stage: { id: 'src' } } }, false);
  CB.Music.stop();
  assert.equal(typeof CB.Music.toggle(), 'boolean');
});

// ---- patterns -------------------------------------------------------------------------------------------------------------

test('music: pattern returns fresh, sorted notes with channel registers from the rev 3 delta (bass 55-130 Hz, lead 220-1760 Hz)', () => {
  const CB = H.load(FILES);
  for (const id of STAGE_IDS.concat(STAGE_IDS.map((s) => s + '#boss'))) {
    for (let bar = 0; bar < 8; bar++) {
      const notes = CB.Music.pattern(id, bar);
      let last = -1;
      const seen = new Set();
      for (const n of notes) {
        assert.ok(n.step >= last, `${id} bar ${bar}: sorted by step`);
        last = n.step;
        assert.ok(Number.isFinite(n.freq) && Number.isInteger(n.len) && n.len >= 1 && n.step + n.len <= 16, `${id} bar ${bar}: ${JSON.stringify(n)}`);
        const key = n.ch + n.step;
        assert.ok(!seen.has(key), `${id} bar ${bar}: one ${n.ch} note per step`);
        seen.add(key);
        if (n.ch === 'bass') assert.ok(n.freq >= 55 && n.freq <= 130, `${id} bass ${n.freq}`);
        if (n.ch === 'lead') assert.ok(n.freq >= 220 && n.freq <= 1760, `${id} lead ${n.freq}`);
      }
      assert.ok(seen.has('bass0') && seen.has('lead0'), `${id} bar ${bar}: the downbeat always sounds`);
    }
  }
  const a = CB.Music.pattern('src', 0);
  a.length = 0;
  a.push({ junk: true });
  assert.ok(CB.Music.pattern('src', 0).length > 1, 'mutating a result never changes the next one');
});

test('music: a loop is 8 bars, and the bars within it are not copies of each other', () => {
  const CB = H.load(FILES);
  for (const id of STAGE_IDS.concat(STAGE_IDS.map((s) => s + '#boss'))) {
    const bars = [];
    for (let bar = 0; bar < 8; bar++) bars.push(JSON.stringify(CB.Music.pattern(id, bar)));
    assert.ok(new Set(bars).size >= 4, `${id}: only ${new Set(bars).size} distinct bars`);
    assert.equal(JSON.stringify(CB.Music.pattern(id, 8)), bars[0], `${id}: bar 8 wraps to bar 0`);
    assert.equal(JSON.stringify(CB.Music.pattern(id, 19)), bars[3], `${id}: bar 19 wraps to bar 3`);
    assert.equal(JSON.stringify(CB.Music.pattern(id, -1)), bars[7], `${id}: bar -1 wraps to bar 7`);
  }
});

test('music: every stage plays only the notes of its scale (A minor pentatonic, D dorian, E minor, C# diminished)', () => {
  const CB = H.load(FILES);
  for (const id of STAGE_IDS) {
    for (const track of [id, id + '#boss']) {
      for (let bar = 0; bar < 8; bar++) {
        for (const n of CB.Music.pattern(track, bar)) {
          if (n.ch === 'hat') continue;
          const m = midiOf(n.freq);
          assert.ok(Math.abs(m - Math.round(m)) < 0.01, `${track} ${n.freq} is on the equal-tempered grid`);
          assert.ok(PCS[id].includes(((Math.round(m) % 12) + 12) % 12), `${track} bar ${bar} ${n.ch} ${n.freq} (pc ${Math.round(m) % 12}) is outside the scale`);
        }
      }
    }
  }
});

test('music: bass is root/fifth eighths (git: 3+3+2), the lead is a sixteenth arpeggio, the hats sit on the off-beats', () => {
  const CB = H.load(FILES);
  for (const id of STAGE_IDS) {
    for (let bar = 0; bar < 8; bar++) {
      const notes = CB.Music.pattern(id, bar);
      const bass = notes.filter((n) => n.ch === 'bass');
      const lead = notes.filter((n) => n.ch === 'lead');
      const hat = notes.filter((n) => n.ch === 'hat');
      assert.ok(new Set(bass.map((n) => n.freq)).size <= 2, `${id} bar ${bar}: bass is root and fifth only`);
      assert.ok(bass.length >= 4, `${id} bar ${bar}: ${bass.length} bass notes`);
      if (id === 'git') for (const n of bass) assert.ok([0, 3, 6, 8, 11, 14].includes(n.step), `git bass step ${n.step} is off the 3+3+2 grid`);
      else for (const n of bass) assert.equal(n.step % 2, 0, `${id} bass step ${n.step} is not an eighth`);
      assert.ok(lead.length >= 9, `${id} bar ${bar}: ${lead.length} lead notes is too sparse for a sixteenth arpeggio`);
      assert.ok(new Set(lead.map((n) => n.freq)).size >= 3, `${id} bar ${bar}: the arpeggio moves`);
      assert.ok(hat.length >= 1);
      for (const n of hat) assert.ok([2, 6, 10, 14].includes(n.step), `${id} hat step ${n.step} is not an off-beat`);
    }
  }
});

test('music: the boss loop is its own pattern, busier than the stage loop and still inside the registers', () => {
  const CB = H.load(FILES);
  assert.notEqual(JSON.stringify(CB.Music.pattern('src#boss', 0)), JSON.stringify(CB.Music.pattern('src', 0)));
  for (const id of STAGE_IDS) {
    for (let bar = 0; bar < 8; bar++) {
      const boss = CB.Music.pattern(id + '#boss', bar);
      const stage = CB.Music.pattern(id, bar);
      assert.notEqual(JSON.stringify(boss), JSON.stringify(stage), `${id} bar ${bar}`);
    }
    const count = (track, ch) => {
      let c = 0;
      for (let bar = 0; bar < 8; bar++) c += CB.Music.pattern(track, bar).filter((n) => n.ch === ch).length;
      return c;
    };
    assert.ok(count(id + '#boss', 'bass') > count(id, 'bass'), `${id}: the boss bass pushes harder`);
    assert.ok(count(id + '#boss', 'hat') > count(id, 'hat'), `${id}: the boss hats are busier`);
  }
});

test('music: an unknown stage id still gives a legal, deterministic pattern', () => {
  const CB = H.load(FILES);
  for (const id of ['nope', '', 'x#boss']) {
    const a = JSON.stringify(CB.Music.pattern(id, 2));
    assert.equal(a, JSON.stringify(CB.Music.pattern(id, 2)));
    assert.ok(CB.Music.pattern(id, 2).length > 0);
  }
  assert.doesNotThrow(() => CB.Music.pattern(undefined, 0));
  assert.doesNotThrow(() => CB.Music.pattern('src', NaN));
});

// ---- intensity ------------------------------------------------------------------------------------------------------------

test('music: intensity for every run state, and phase 2 of a boss', () => {
  const CB = H.load(FILES);
  const I = (state, boss) => CB.Music.intensityFor({ state, world: { boss: boss === undefined ? null : boss } });
  for (const s of ['stageIntro', 'wave', 'waveBreak', 'patchPick']) assert.equal(I(s), 0, s);
  for (const s of ['bossWarn', 'bossDead', 'dying', 'dead']) assert.equal(I(s), -1, s);
  assert.equal(I('victory'), 1);
  assert.equal(I('boss', { phase: 1 }), 1);
  assert.equal(I('boss', { phase: 2 }), 2);
  assert.equal(I('boss', { phase: 3 }), 2);
  assert.equal(I('boss', null), 1, 'a boss that is not out yet is still phase 1');
  assert.equal(CB.Music.intensityFor({ state: 'boss' }), 1, 'no world at all');
  assert.equal(CB.Music.intensityFor({ state: 'whatever' }), -1);
  assert.equal(CB.Music.intensityFor(null), -1);
  assert.equal(CB.Music.intensityFor(undefined), -1);
});

// ---- no context -----------------------------------------------------------------------------------------------------------

test('music: without an AudioContext nothing is created, scheduled or thrown, and the answers are still sane', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const run = runOf('boss', 'src', 2);
  assert.doesNotThrow(() => {
    CB.Music.start();
    CB.Music.update(run, false);
    CB.Music.update(run, true);
    CB.Music.duck(0.5, 0.2, 0.5);
    CB.Music.stop();
    CB.Music.update(null, false);
  });
  assert.equal(sandbox.__intervals.length, 0, 'no scheduler without a context');
  CB.Audio.init(); // the harness has no AudioContext: still nothing
  CB.Music.update(run, false);
  assert.equal(sandbox.__intervals.length, 0);
  assert.equal(CB.Music.isEnabled(), true);
  assert.equal(CB.Music.toggle(), false);
  assert.equal(CB.Music.toggle(), true);
  assert.equal(CB.Music.toggle(false), false);
  assert.equal(CB.Music.toggle(true), true);
});

test('music: a missing CB.Audio is a no-op too', () => {
  const { CB, sandbox } = H.load(['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/core/music.js'], { returnSandbox: true });
  assert.doesNotThrow(() => {
    CB.Music.update(runOf('wave', 'src'), false);
    CB.Music.duck(0.4, 0.1, 0.3);
    CB.Music.stop();
  });
  assert.equal(sandbox.__intervals.length, 0);
});

// ---- lifecycle ------------------------------------------------------------------------------------------------------------

test('music: update creates the 0.10 music gain into Audio.output() and one 30 ms scheduler, once, and fades in over 0.4 s', () => {
  const env = boot();
  const { CB, sandbox, ctx } = env;
  assert.equal(ctx.gains.length, 1, 'only the master before any update');
  assert.equal(sandbox.__intervals.length, 0);
  const delays = [];
  const record = sandbox.setInterval; // the harness stub ignores the period, so note it on the way past
  sandbox.setInterval = (fn, ms) => {
    delays.push(ms);
    return record(fn, ms);
  };
  CB.Music.update(runOf('stageIntro', 'src'), false);
  assert.deepEqual(delays, [30], 'a 30 ms scheduler');
  assert.equal(sandbox.__intervals.length, 1);
  assert.equal(ctx.gains.length, 2);
  const g = musicNode(env);
  assert.ok(g && g !== CB.Audio.output());
  assert.equal(g.gain.value, 0.1);
  const fade = g.gain.events.filter((e) => e.kind === 'linear');
  assert.equal(fade.length, 1);
  assert.ok(near(fade[0].time, ctx.currentTime + 0.4) && near(fade[0].value, 0.1), 'ramps 0 -> 0.1 over 0.4 s');
  assert.equal(g.gain.events.find((e) => e.kind === 'set').value, 0, 'from silence');
  for (let i = 0; i < 5; i++) CB.Music.update(runOf('wave', 'src'), false);
  assert.equal(sandbox.__intervals.length, 1, 'later updates do not start a second scheduler');
  assert.equal(ctx.gains.length, 2, 'or a second gain');
});

test('music: the music gain feeds the master, so M (mute) silences it too', () => {
  const env = boot();
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.5);
  assert.equal(musicNode(env).connections[0], env.CB.Audio.output());
  for (const s of env.ctx.starts) assert.equal(gainOf(s).connections[0], musicNode(env), 'every voice goes through the music gain');
  env.CB.Audio.setMuted(true);
  assert.equal(env.CB.Audio.output().gain.value, 0);
});

test('music: the stage comes from run.world.stage.id, falling back to CB.STAGES[run.stageIndex].id, then src', () => {
  const firstBass = (run, setup) => {
    const env = boot();
    if (setup) setup(env.CB);
    env.CB.Music.update(run, false);
    advance(env, 0.3);
    return basses(env.ctx)[0].frequency;
  };
  for (const id of STAGE_IDS) assert.ok(near(firstBass(runOf('wave', id)), noteAt(id, 0, 'bass', 0).freq, 1e-9), id);
  const stages = (CB) => {
    CB.STAGES = STAGE_IDS.map((id) => ({ id }));
  };
  assert.ok(near(firstBass({ state: 'wave', stageIndex: 2, world: {} }, stages), noteAt('git', 0, 'bass', 0).freq, 1e-9), 'world without a stage -> STAGES[2]');
  assert.ok(near(firstBass({ state: 'wave', stageIndex: 3 }, stages), noteAt('prod', 0, 'bass', 0).freq, 1e-9), 'no world -> STAGES[3]');
  assert.ok(near(firstBass({ state: 'wave', stageIndex: 3, world: { stage: { id: 'git' } } }, stages), noteAt('git', 0, 'bass', 0).freq, 1e-9), 'the world wins');
  assert.ok(near(firstBass({ state: 'wave', stageIndex: 9 }, stages), noteAt('src', 0, 'bass', 0).freq, 1e-9), 'unknown index -> src');
  assert.ok(near(firstBass({ state: 'wave' }), noteAt('src', 0, 'bass', 0).freq, 1e-9), 'nothing known -> src');
});

// ---- scheduler ------------------------------------------------------------------------------------------------------------

test('music: the scheduler plays the bass pattern on a 16-step grid at each stage tempo, bar after bar', () => {
  for (const id of STAGE_IDS) {
    const env = boot();
    const step = 15 / BPM[id]; // 60 / bpm / 4
    env.CB.Music.update(runOf('wave', id), false);
    advance(env, 32 * step + 0.4);
    const bass = basses(env.ctx);
    const t0 = bass[0].time;
    const want = [];
    for (let bar = 0; bar < 2; bar++) for (const n of env.CB.Music.pattern(id, bar)) if (n.ch === 'bass') want.push({ t: t0 + (bar * 16 + n.step) * step, f: n.freq });
    const got = bass.filter((s) => s.time < t0 + 32 * step - 1e-6);
    assert.equal(got.length, want.length, id);
    got.forEach((s, i) => {
      assert.ok(near(s.time, want[i].t, 1e-6), `${id} note ${i}: ${s.time} vs ${want[i].t}`);
      assert.ok(near(s.frequency, want[i].f, 1e-6), `${id} note ${i}: ${s.frequency} vs ${want[i].f}`);
    });
    // the hats ride the same grid
    const hat = hats(env.ctx).filter((s) => s.time < t0 + 16 * step - 1e-6);
    const wantHats = env.CB.Music.pattern(id, 0).filter((n) => n.ch === 'hat').map((n) => t0 + n.step * step);
    assert.equal(hat.length, wantHats.length, `${id}: hats in bar 0`);
    hat.forEach((s, i) => assert.ok(near(s.time, wantHats[i], 1e-6)));
  }
});

test('music: the scheduler runs on for the whole 8-bar loop and wraps back to bar 0', () => {
  const env = boot();
  const step = 15 / BPM.src;
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 16 * 16 * step + 0.3);
  const bass = basses(env.ctx);
  const t0 = bass[0].time;
  for (const bar of [0, 7, 8, 15]) {
    const want = env.CB.Music.pattern('src', bar).filter((n) => n.ch === 'bass');
    const got = bass.filter((s) => s.time >= t0 + bar * 16 * step - 1e-6 && s.time < t0 + (bar + 1) * 16 * step - 1e-6);
    assert.equal(got.length, want.length, `bar ${bar}`);
    got.forEach((s, i) => assert.ok(near(s.frequency, want[i].freq, 1e-6) && near(s.time, t0 + (bar * 16 + want[i].step) * step, 1e-6)));
  }
});

test('music: the lead plays only at intensity 1 and up; intensity 0 is bass and hats', () => {
  const calm = boot();
  calm.CB.Music.update(runOf('wave', 'src'), false);
  advance(calm, 4);
  assert.ok(basses(calm.ctx).length > 0 && hats(calm.ctx).length > 0);
  assert.equal(leads(calm.ctx).length, 0);
  for (const state of ['stageIntro', 'waveBreak', 'patchPick']) {
    const e = boot();
    e.CB.Music.update(runOf(state, 'git'), false);
    advance(e, 3);
    assert.equal(leads(e.ctx).length, 0, state);
    assert.ok(basses(e.ctx).length > 0, state);
  }
  for (const [state, phase] of [['boss', 1], ['boss', 2], ['victory', 0]]) {
    const e = boot();
    e.CB.Music.update(runOf(state, 'git', phase), false);
    advance(e, 3);
    assert.ok(leads(e.ctx).length > 8, `${state} ${phase}`);
  }
});

test('music: the boss plays its own loop, from its first bar, and phase 2 is 10% faster with the lead an octave up', () => {
  const stageStep = 15 / BPM.src;
  const bossAt = (phase) => {
    const env = boot();
    env.CB.Music.update(runOf('boss', 'src', phase), false);
    advance(env, 4.5);
    return env;
  };
  const p1 = bossAt(1);
  const p2 = bossAt(2);
  const pat = p1.CB.Music.pattern('src#boss', 0);
  const bassSteps = pat.filter((n) => n.ch === 'bass').map((n) => n.step);
  const t1 = basses(p1.ctx)[0].time;
  const one = basses(p1.ctx).filter((s) => s.time < t1 + 16 * stageStep - 1e-6);
  assert.deepEqual(one.map((s) => Math.round((s.time - t1) / stageStep)), bassSteps, 'bar 0 of the boss loop, not of the stage loop');
  // phase 2: same pattern, tempo x1.1
  const t2 = basses(p2.ctx)[0].time;
  const fast = stageStep / 1.1;
  const two = basses(p2.ctx).filter((s) => s.time < t2 + 16 * fast - 1e-6);
  assert.deepEqual(two.map((s) => Math.round((s.time - t2) / fast)), bassSteps);
  two.forEach((s, i) => assert.ok(near(s.time - t2, bassSteps[i] * fast, 1e-6), `phase 2 step ${bassSteps[i]}`));
  // lead: octave up at phase 2 only
  const lead0 = pat.find((n) => n.ch === 'lead' && n.step === 0).freq;
  assert.ok(near(leads(p1.ctx)[0].frequency, lead0, 1e-6));
  assert.ok(near(leads(p2.ctx)[0].frequency, lead0 * 2, 1e-6));
  assert.ok(leads(p2.ctx).every((s) => s.frequency <= 3520 && s.frequency >= 440));
});

test('music: node_modules detunes the lead +6 cents; no other stage does, and the bass is never detuned', () => {
  const detuneOf = (id) => {
    const env = boot();
    env.CB.Music.update(runOf('boss', id, 1), false);
    advance(env, 2);
    const cents = leads(env.ctx).map((s) => (s.node.detune.values.length ? s.node.detune.value : 0));
    const bassCents = basses(env.ctx).map((s) => (s.node.detune.values.length ? s.node.detune.value : 0));
    assert.ok(bassCents.every((c) => c === 0), `${id}: bass detune`);
    assert.ok(cents.length > 0);
    return cents;
  };
  assert.ok(detuneOf('node_modules').every((c) => c === 6));
  for (const id of ['src', 'git', 'prod']) assert.ok(detuneOf(id).every((c) => c === 0), id);
});

test('music: per-note peaks are bass 0.70, lead 0.35 and hat 0.20 into the 0.10 node (effective 0.07 / 0.035 / 0.02)', () => {
  const env = boot();
  env.CB.Music.update(runOf('boss', 'prod', 1), false);
  advance(env, 4);
  const node = musicNode(env).gain.value;
  assert.equal(node, 0.1);
  assert.ok(basses(env.ctx).length > 0 && leads(env.ctx).length > 0 && hats(env.ctx).length > 0);
  for (const s of basses(env.ctx)) {
    assert.ok(near(peakOf(s), 0.7, 1e-9), `bass peak ${peakOf(s)}`);
    assert.ok(near(peakOf(s) * node, 0.07, 1e-9));
  }
  for (const s of leads(env.ctx)) {
    assert.ok(near(peakOf(s), 0.35, 1e-9), `lead peak ${peakOf(s)}`);
    assert.ok(near(peakOf(s) * node, 0.035, 1e-9));
  }
  for (const s of hats(env.ctx)) {
    assert.ok(near(peakOf(s), 0.2, 1e-9), `hat peak ${peakOf(s)}`);
    assert.ok(near(peakOf(s) * node, 0.02, 1e-9));
  }
});

test('music: voices are triangle bass, square lead and highpassed (6 kHz) noise hats, each ending before the next note of its channel', () => {
  const env = boot();
  env.CB.Music.update(runOf('boss', 'src', 1), false);
  advance(env, 4);
  assert.ok(env.ctx.filters.length > 0 && env.ctx.filters.every((f) => f.type === 'highpass' && f.frequency.value === 6000));
  assert.ok(hats(env.ctx).every((s) => s.node.buffer && s.node.buffer.length > 0), 'hats play the shared noise buffer');
  for (const list of [basses(env.ctx), leads(env.ctx)]) {
    for (let i = 0; i + 1 < list.length; i++) {
      const g = gainOf(list[i]).gain.events;
      const end = g[g.length - 1].time;
      assert.ok(end <= list[i + 1].time + 1e-9, `a note rings into the next one (${end} > ${list[i + 1].time})`);
      assert.ok(list[i].node.stopTime >= end, 'the oscillator outlives its envelope');
    }
  }
  for (const s of hats(env.ctx)) assert.ok(s.node.stopTime - s.time < 0.12, 'hats are short');
});

test('music: hat noise is seeded: two boots build the same buffer', () => {
  const noise = () => {
    const env = boot();
    env.CB.Music.update(runOf('wave', 'src'), false);
    advance(env, 1);
    return Array.from(hats(env.ctx)[0].node.buffer.getChannelData(0).slice(0, 64));
  };
  const a = noise();
  assert.deepEqual(a, noise());
  assert.ok(a.some((v) => v !== 0) && a.every((v) => v >= -1 && v <= 1));
});

test('music: intensity -1 (bossWarn, bossDead, dying, dead) schedules nothing, but the scheduler is still alive', () => {
  for (const state of ['bossWarn', 'bossDead', 'dying', 'dead']) {
    const env = boot();
    env.CB.Music.update(runOf(state, 'src'), false);
    assert.equal(env.sandbox.__intervals.length, 1, state);
    advance(env, 3);
    assert.equal(env.ctx.starts.length, 0, state);
  }
});

test('music: dropping to silence cuts the scheduling at once, and music returns on the downbeat of the new track', () => {
  const env = boot();
  const { CB, ctx } = env;
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 1.3);
  CB.Music.update(runOf('bossWarn', 'src'), false);
  const n = ctx.starts.length;
  assert.ok(n > 0);
  advance(env, 3);
  assert.equal(ctx.starts.length, n, 'bossWarn: not one more note');
  CB.Music.update(runOf('boss', 'src', 1), false);
  const before = ctx.starts.length;
  advance(env, 0.3);
  const fresh = ctx.starts.slice(before);
  assert.ok(fresh.length > 0, 'the boss loop starts straight away');
  const firstBass = fresh.find((s) => s.type === 'triangle');
  assert.ok(near(firstBass.frequency, CB.Music.pattern('src#boss', 0).find((x) => x.ch === 'bass' && x.step === 0).freq, 1e-6));
  assert.ok(fresh.find((s) => s.type === 'square'), 'with the lead from the first beat');
});

test('music: a track or intensity change waits for the bar boundary', () => {
  const env = boot();
  const { CB, ctx } = env;
  const step = 15 / BPM.src;
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.9);
  const t0 = basses(ctx)[0].time;
  CB.Music.update(runOf('boss', 'src', 1), false); // mid-bar 0
  advance(env, 4);
  const lead = leads(ctx);
  assert.ok(lead.length > 0);
  const boundary = t0 + 16 * step;
  assert.ok(lead.every((s) => s.time >= boundary - 1e-6), 'no lead before the boundary');
  assert.ok(near(lead[0].time, boundary, 1e-6), 'and it comes in exactly on the boundary');
  assert.ok(near(lead[0].frequency, noteAt('src#boss', 0, 'lead', 0).freq, 1e-6), 'on bar 0 of the new track, not on bar 1');
  assert.notEqual(noteAt('src#boss', 0, 'lead', 0).freq, noteAt('src#boss', 1, 'lead', 0).freq, 'bars 0 and 1 of the boss loop really do differ in pitch');
  // the bass before the boundary is still the stage loop, after it the boss loop
  const early = basses(ctx).filter((s) => s.time < boundary - 1e-6).map((s) => Math.round((s.time - t0) / step));
  assert.deepEqual(early, CB.Music.pattern('src', 0).filter((n) => n.ch === 'bass').map((n) => n.step));
  const late = basses(ctx).filter((s) => s.time >= boundary - 1e-6 && s.time < boundary + 16 * step - 1e-6).map((s) => Math.round((s.time - boundary) / step));
  assert.deepEqual(late, CB.Music.pattern('src#boss', 0).filter((n) => n.ch === 'bass').map((n) => n.step));
  const lateFreq = basses(ctx).filter((s) => s.time >= boundary - 1e-6 && s.time < boundary + 16 * step - 1e-6).map((s) => s.frequency);
  lateFreq.forEach((f, i) => assert.ok(near(f, CB.Music.pattern('src#boss', 0).filter((n) => n.ch === 'bass')[i].freq, 1e-6), 'boss bar 0 pitches'));
});

test('music: a phase-2 tempo change waits for the bar boundary too', () => {
  const env = boot();
  const { CB, ctx } = env;
  const step = 15 / BPM.git;
  CB.Music.update(runOf('boss', 'git', 1), false);
  advance(env, 1);
  const t0 = basses(ctx)[0].time;
  CB.Music.update(runOf('boss', 'git', 2), false);
  advance(env, 4);
  const boundary = t0 + 16 * step;
  const inFirst = basses(ctx).filter((s) => s.time < boundary - 1e-6);
  assert.deepEqual(inFirst.map((s) => Math.round((s.time - t0) / step)), CB.Music.pattern('git#boss', 0).filter((n) => n.ch === 'bass').map((n) => n.step), 'bar 0 keeps the old tempo');
  const next = basses(ctx).find((s) => s.time >= boundary - 1e-6);
  assert.ok(near(next.time, boundary, 1e-6));
  const second = basses(ctx).filter((s) => s.time >= boundary - 1e-6 && s.time < boundary + 16 * step / 1.1 - 1e-6);
  assert.deepEqual(second.map((s) => Math.round((s.time - boundary) / (step / 1.1))), CB.Music.pattern('git#boss', 1).filter((n) => n.ch === 'bass').map((n) => n.step), 'bar 1 runs at x1.1');
});

test('music: a hidden tab schedules nothing and resumes without a burst of old notes', () => {
  const env = boot();
  const { CB, sandbox, ctx } = env;
  CB.Music.update(runOf('boss', 'src', 1), false);
  advance(env, 1);
  const n = ctx.starts.length;
  sandbox.document.hidden = true;
  advance(env, 5);
  assert.equal(ctx.starts.length, n, 'hidden: not a single note');
  sandbox.document.hidden = false;
  const t = ctx.currentTime;
  advance(env, 0.12);
  const fresh = ctx.starts.slice(n);
  assert.ok(fresh.length > 0, 'music is back');
  assert.ok(fresh.length <= 10, `${fresh.length} notes at once: the missed time was not replayed`);
  assert.ok(fresh.every((s) => s.time >= t), 'all of them ahead of the clock');
});

test('music: a document-less environment still schedules', () => {
  const env = boot();
  env.sandbox.document = undefined;
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 1);
  assert.ok(env.ctx.starts.length > 0);
});

test('music: pause mutes the scheduler and resuming picks up ahead of the clock', () => {
  const env = boot();
  const { CB, ctx } = env;
  CB.Music.update(runOf('wave', 'git'), false);
  advance(env, 1);
  assert.ok(ctx.starts.length > 0);
  CB.Music.update(runOf('wave', 'git'), true);
  const n = ctx.starts.length;
  advance(env, 4);
  assert.equal(ctx.starts.length, n, 'paused: nothing scheduled');
  assert.equal(env.sandbox.__intervals.length, 1, 'the scheduler is not torn down by a pause');
  CB.Music.update(runOf('wave', 'git'), false);
  const t = ctx.currentTime;
  advance(env, 0.12);
  const fresh = ctx.starts.slice(n);
  assert.ok(fresh.length > 0 && fresh.length <= 8);
  assert.ok(fresh.every((s) => s.time >= t));
});

test('music: a stalled main thread (clock far ahead) resyncs instead of scheduling in the past', () => {
  const env = boot();
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.5);
  const n = env.ctx.starts.length;
  env.ctx.currentTime += 3; // no tick for 3 s
  for (const fn of env.sandbox.__intervals.slice()) fn();
  for (const s of env.ctx.starts.slice(n)) assert.ok(s.time >= env.ctx.currentTime);
  assert.ok(env.ctx.starts.length - n <= 8);
});

test('music: a suspended context is left alone and music starts when it runs', () => {
  const env = boot();
  env.ctx.state = 'suspended';
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 1);
  assert.equal(env.ctx.starts.length, 0);
  env.ctx.state = 'running';
  advance(env, 0.3);
  assert.ok(env.ctx.starts.length > 0);
});

test('music: a voice that throws never escapes the scheduler tick', () => {
  const env = boot();
  env.ctx.createOscillator = () => {
    throw new Error('no voices');
  };
  env.CB.Music.update(runOf('boss', 'src', 1), false);
  assert.doesNotThrow(() => advance(env, 1));
  const env2 = boot();
  env2.ctx.createBufferSource = () => {
    throw new Error('no noise');
  };
  env2.CB.Music.update(runOf('boss', 'src', 1), false);
  assert.doesNotThrow(() => advance(env2, 1));
  assert.ok(basses(env2.ctx).length > 0, 'the bass still plays without hats');
});

test('music: without setInterval there is no scheduler and no gain, and nothing throws', () => {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  ctx.install(sandbox);
  CB.Audio.init();
  sandbox.setInterval = undefined;
  assert.doesNotThrow(() => {
    CB.Music.update(runOf('wave', 'src'), false);
    CB.Music.stop();
  });
  assert.equal(ctx.gains.length, 1);
  assert.equal(ctx.starts.length, 0);
});

// ---- stop / toggle --------------------------------------------------------------------------------------------------------

test('music: stop clears the interval and ramps to 0 over 0.25 s; the next update restarts from the top of the loop', () => {
  const env = boot();
  const { CB, sandbox, ctx } = env;
  const step = 15 / BPM.src;
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 3 * 16 * step * 0.5);
  assert.equal(sandbox.__intervals.length, 1);
  const g = musicNode(env);
  const now = ctx.currentTime;
  CB.Music.stop();
  assert.equal(sandbox.__intervals.length, 0, 'interval cleared');
  const out = g.gain.events.filter((e) => e.kind === 'linear').pop();
  assert.ok(near(out.time, now + 0.25) && out.value === 0, 'ramp to 0 over 0.25 s');
  assert.equal(g.gain.value, 0);
  const n = ctx.starts.length;
  const nBass = basses(ctx).length;
  advance(env, 2); // nothing is registered to run
  assert.equal(ctx.starts.length, n);
  CB.Music.stop(); // stopping twice is harmless
  assert.equal(sandbox.__intervals.length, 0);

  CB.Music.update(runOf('wave', 'src'), false);
  assert.equal(sandbox.__intervals.length, 1, 'the next update restarts');
  assert.equal(ctx.gains.filter((x) => x.connections.includes(CB.Audio.output())).length, 1, 'on the same music gain');
  const back = g.gain.events.filter((e) => e.kind === 'linear').pop();
  assert.ok(near(back.time, ctx.currentTime + 0.4) && near(back.value, 0.1), 'fades back in over 0.4 s');
  advance(env, 0.3);
  const first = basses(ctx)[nBass];
  assert.ok(near(first.frequency, noteAt('src', 0, 'bass', 0).freq, 1e-6), 'starts from bar 0 again');
});

test('music: toggle flips and returns the flag; toggle(false) stops, and update does not restart while it is off', () => {
  const env = boot();
  const { CB, sandbox, ctx } = env;
  CB.Music.update(runOf('wave', 'src'), false);
  assert.equal(sandbox.__intervals.length, 1);
  assert.equal(CB.Music.isEnabled(), true);
  assert.equal(CB.Music.toggle(false), false);
  assert.equal(CB.Music.isEnabled(), false);
  assert.equal(sandbox.__intervals.length, 0, 'toggle(false) stops');
  assert.equal(musicNode(env).gain.value, 0);
  const n = ctx.starts.length;
  CB.Music.update(runOf('wave', 'src'), false);
  CB.Music.update(runOf('boss', 'src', 1), false);
  advance(env, 2);
  assert.equal(sandbox.__intervals.length, 0);
  assert.equal(ctx.starts.length, n);
  assert.equal(CB.Music.toggle(), true, 'a bare toggle flips back on');
  assert.equal(sandbox.__intervals.length, 0, 'but nothing starts until the next update');
  CB.Music.update(runOf('wave', 'src'), false);
  assert.equal(sandbox.__intervals.length, 1);
  assert.equal(CB.Music.toggle(), false);
  assert.equal(CB.Music.toggle(), true);
});

test('music: start() brings the scheduler up and stays silent until update gives it a run state', () => {
  const env = boot();
  env.CB.Music.start();
  assert.equal(env.sandbox.__intervals.length, 1);
  env.CB.Music.start();
  assert.equal(env.sandbox.__intervals.length, 1, 'idempotent');
  advance(env, 2);
  assert.equal(env.ctx.starts.length, 0);
  env.CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.5);
  assert.ok(env.ctx.starts.length > 0);
  env.CB.Music.toggle(false);
  env.CB.Music.start();
  assert.equal(env.sandbox.__intervals.length, 0, 'start() respects the toggle');
});

test('music: the choice persists in localStorage cb.music (read at load, written by toggle); default on', () => {
  const off = memStorage({ 'cb.music': '0' });
  const a = H.load(FILES, { localStorage: off });
  assert.equal(a.Music.isEnabled(), false, 'reads "0" at load');
  assert.equal(a.Music.toggle(), true);
  assert.equal(off.store['cb.music'], '1');
  assert.equal(a.Music.toggle(), false);
  assert.equal(off.store['cb.music'], '0');
  assert.equal(a.Music.toggle(true), true);
  assert.equal(off.store['cb.music'], '1');

  const on = memStorage({ 'cb.music': '1' });
  assert.equal(H.load(FILES, { localStorage: on }).Music.isEnabled(), true);
  const empty = memStorage();
  assert.equal(H.load(FILES, { localStorage: empty }).Music.isEnabled(), true, 'unset means music on');
  assert.deepEqual(empty.store, {}, 'nothing is written until the player changes it');
});

test('music: a throwing localStorage is harmless', () => {
  const bad = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  const CB = H.load(FILES, { localStorage: bad });
  assert.equal(CB.Music.isEnabled(), true);
  assert.doesNotThrow(() => CB.Music.toggle(false));
  assert.equal(CB.Music.isEnabled(), false, 'the in-memory state still changes');
  assert.equal(CB.Music.toggle(), true);
});

test('music: disabled at load, update never builds a gain or a scheduler', () => {
  const env = boot({ localStorage: memStorage({ 'cb.music': '0' }) });
  env.CB.Music.update(runOf('boss', 'src', 2), false);
  env.CB.Music.start();
  assert.equal(env.sandbox.__intervals.length, 0);
  assert.equal(env.ctx.gains.length, 1);
});

// ---- levels, ducking ------------------------------------------------------------------------------------------------------

test('music: patchPick plays at half gain, and the level comes back with the next state', () => {
  const env = boot();
  env.CB.Music.update(runOf('patchPick', 'src'), false);
  const g = musicNode(env);
  assert.ok(near(g.gain.value, 0.05), `patchPick ${g.gain.value}`);
  advance(env, 1);
  assert.ok(basses(env.ctx).length > 0 && leads(env.ctx).length === 0, 'intensity 0');
  env.CB.Music.update(runOf('stageIntro', 'git'), false);
  assert.ok(near(g.gain.value, 0.1), `back to full ${g.gain.value}`);
});

test('music: duck ramps to base x (1 - amount) in 20 ms, holds, then ramps back over the release', () => {
  const env = boot();
  const { CB, ctx } = env;
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 1);
  const g = musicNode(env);
  const mark = g.gain.events.length;
  const now = ctx.currentTime;
  CB.Music.duck(0.5, 0.2, 0.5);
  const ev = g.gain.events.slice(mark);
  assert.equal(ev[0].kind, 'cancel');
  const ramps = ev.filter((e) => e.kind === 'linear');
  assert.equal(ramps.length, 2);
  assert.ok(near(ramps[0].value, 0.05) && near(ramps[0].time, now + 0.02), 'down to 0.05 in 20 ms');
  const hold = ev.find((e) => e.kind === 'set' && e.value === ramps[0].value && e.time > now + 0.02);
  assert.ok(hold && near(hold.time, now + 0.02 + 0.2), 'held for 0.2 s');
  assert.ok(near(ramps[1].value, 0.1) && near(ramps[1].time, now + 0.02 + 0.2 + 0.5), 'back to 0.1 over 0.5 s');
  assert.ok(near(g.gain.value, 0.1));
});

test('music: ducks take base x (1 - amount) of the current level, and a lighter duck never lifts a deeper one', () => {
  const env = boot();
  const { CB, ctx } = env;
  CB.Music.update(runOf('patchPick', 'src'), false); // base 0.05
  advance(env, 0.5);
  const g = musicNode(env);
  CB.Music.duck(0.4, 0.1, 0.3);
  const low = g.gain.events.filter((e) => e.kind === 'linear')[1];
  assert.ok(near(low.value, 0.05 * 0.6), `patchPick duck ${low.value}`);
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.1);
  CB.Music.duck(0.7, 0.05, 0.2);
  const r1 = g.gain.events.filter((e) => e.kind === 'linear');
  const deep = r1[r1.length - 2]; // the last ramp is the release back to base
  assert.ok(near(deep.value, 0.1 * 0.3), `deep duck ${deep.value}`);
  CB.Music.duck(0.4, 0.05, 0.2); // lighter, while the deeper one is still active
  const ramps = g.gain.events.filter((e) => e.kind === 'linear');
  const down = ramps[ramps.length - 2];
  assert.ok(near(down.value, 0.1 * 0.3, 1e-9), `a lighter duck keeps the deeper level (${down.value})`);
  advance(env, 2); // the clock passes the whole duck; a later light duck is just a light duck
  CB.Music.duck(0.4, 0.05, 0.2);
  const later = g.gain.events.filter((e) => e.kind === 'linear');
  assert.ok(near(later[later.length - 2].value, 0.1 * 0.6, 1e-9), 'an expired duck does not linger');
  assert.ok(ctx.currentTime > 2);
});

test('music: duck is a no-op when music is not running (never started, stopped, or turned off)', () => {
  const env = boot();
  const { CB, ctx } = env;
  assert.doesNotThrow(() => CB.Music.duck(0.5, 0.2, 0.5));
  assert.equal(ctx.gains.length, 1, 'no gain was created for a duck');
  CB.Music.update(runOf('wave', 'src'), false);
  const g = musicNode(env);
  CB.Music.stop();
  const mark = g.gain.events.length;
  CB.Music.duck(0.5, 0.2, 0.5);
  assert.equal(g.gain.events.length, mark, 'stopped: the gain is not touched');
  for (const bad of [undefined, NaN, 'x', null]) assert.doesNotThrow(() => CB.Music.duck(bad, bad, bad));
});

test('music: Audio.handleEvents ducks the running music through the real duck()', () => {
  const env = boot();
  const { CB } = env;
  CB.Music.update(runOf('wave', 'src'), false);
  advance(env, 0.5);
  const g = musicNode(env);
  CB.Audio.handleEvents([{ type: 'playerHurt', x: 10, y: 10 }]);
  const ramps = g.gain.events.filter((e) => e.kind === 'linear');
  assert.ok(near(ramps[ramps.length - 2].value, 0.1 * 0.6), 'playerHurt ducks 0.4');
  CB.Audio.handleEvents([{ type: 'heartbeat', x: 10, y: 10 }]);
  const r2 = g.gain.events.filter((e) => e.kind === 'linear');
  assert.ok(near(r2[r2.length - 2].value, 0.1 * 0.3), 'heartbeat ducks 0.7');
});

test('music: run with a null or odd run object never throws', () => {
  const env = boot();
  for (const run of [null, undefined, {}, { state: 'boss' }, { state: 'boss', world: null }, { state: 'wave', world: { stage: null }, stageIndex: 'x' }, { state: 5 }]) {
    assert.doesNotThrow(() => env.CB.Music.update(run, false));
  }
  assert.doesNotThrow(() => advance(env, 1));
});

// ---- with the real stage runner -------------------------------------------------------------------------------------------

// A run on real stage ids with a dummy enemy and a dummy boss, stepped at 60 Hz with Music.update after each step (as play.js does)
// and the scheduler ticking every other frame (~33 ms).
function runEnv() {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/core/audio.js', 'src/core/music.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js'], { returnSandbox: true });
  const ctx = H.fakeAudioContext();
  ctx.install(sandbox);
  CB.Audio.init();
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.dummyBoss = {
    id: 'dummyBoss', name: 'DUMMY', tagline: 'noop()', commitMsg: 'fix: dummy',
    create() {
      const c = { id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} };
      return c;
    },
  };
  CB.STAGES = STAGE_IDS.map((id, i) => ({ id, n: i + 1, path: `~/${id}/`, palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]] }));
  const run = CB.createRun({ seed: 1 });
  const env = { CB, sandbox, ctx, run, frames: 0 };
  env.frame = (each) => {
    if (each) each(run);
    run.step(H.makeInput({ aimX: 160, aimY: 30 }));
    ctx.currentTime += 1 / 60;
    if (++env.frames % 2 === 0) for (const fn of sandbox.__intervals.slice()) fn();
    CB.Music.update(run, false);
  };
  env.until = (state, max, each) => {
    for (let i = 0; i < max && run.state !== state; i++) env.frame(each);
    assert.equal(run.state, state, `never reached ${state}`);
  };
  env.hold = (seconds, each) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) env.frame(each);
  };
  return env;
}
const killAll = (run) => {
  for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e);
};

test('music: follows a real run: bass and hats through intro and waves, silence on the warning, the lead and phase 2 in the boss, silence on its death', () => {
  const env = runEnv();
  const { CB, ctx, run } = env;
  env.hold(1.5);
  assert.equal(run.state, 'stageIntro');
  assert.equal(env.sandbox.__intervals.length, 1, 'the first update started the music');
  assert.ok(basses(ctx).length > 0 && hats(ctx).length > 0 && leads(ctx).length === 0, 'stageIntro: intensity 0');
  env.until('wave', 200);
  env.hold(0.5);
  assert.equal(leads(ctx).length, 0, 'wave: intensity 0');
  env.until('waveBreak', 600, killAll);
  env.until('bossWarn', 900, killAll);
  assert.equal(leads(ctx).length, 0, 'no lead through any wave');
  env.hold(0.3); // the 0.15 s lookahead drains
  const quiet = ctx.starts.length;
  env.hold(2.0);
  assert.equal(run.state, 'bossWarn');
  assert.equal(ctx.starts.length, quiet, 'bossWarn: the warning sound is the stinger, so the music is silent');

  env.until('boss', 300);
  env.hold(2.3);
  assert.ok(leads(ctx).length > 8, 'boss: the lead comes in');
  assert.ok(leads(ctx).every((s) => s.frequency <= 880), 'phase 1: the lead is in its base register');

  const before = ctx.starts.length;
  run.world.boss.phase = 2;
  env.hold(4);
  assert.ok(ctx.starts.length > before, 'still playing in phase 2');
  assert.ok(leads(ctx).some((s) => s.frequency > 880), 'phase 2: the lead went up an octave');

  run.world.boss.hp = 0;
  env.until('bossDead', 10);
  env.hold(0.3);
  const atDeath = ctx.starts.length;
  env.hold(2.0);
  assert.equal(run.state, 'bossDead');
  assert.equal(ctx.starts.length, atDeath, 'bossDead: silent');

  env.until('patchPick', 400);
  env.hold(0.7);
  const g = musicNode(env);
  assert.ok(near(g.gain.value, 0.05), `patchPick plays at half gain (${g.gain.value})`);
  const pickLeads = leads(ctx).length;
  env.hold(2.5);
  assert.equal(leads(ctx).length, pickLeads, 'patchPick: intensity 0, no lead');
  assert.ok(ctx.starts.length > atDeath, 'but the bass is back');
  assert.equal(run.choosePatch(0), true);
  env.frame();
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.stageIndex, 1);
  assert.ok(near(g.gain.value, 0.1), 'the next stage is back at full level');
  const bassNow = basses(ctx).length;
  env.hold(4.5);
  const fresh = basses(ctx).slice(bassNow);
  const stageBars = [0, 1, 2].map((b) => CB.Music.pattern('node_modules', b).filter((n) => n.ch === 'bass').map((n) => n.freq));
  assert.ok(fresh.some((s) => stageBars.some((bar) => bar.some((f) => near(f, s.frequency, 1e-6)))), 'the second stage plays the node_modules loop');
  assert.equal(env.sandbox.__intervals.length, 1, 'one scheduler for the whole run');
});

test('music: a player death goes quiet (dying, dead), and a retry brings the stage loop back from its top', () => {
  const env = runEnv();
  const { CB, ctx, run } = env;
  env.until('wave', 300);
  env.hold(0.5);
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  env.until('dying', 5);
  env.hold(0.3);
  const quiet = ctx.starts.length;
  env.until('dead', 200);
  env.hold(1.0);
  assert.equal(run.state, 'dead');
  assert.equal(ctx.starts.length, quiet, 'dying and dead: silent');
  env.hold(0.7);
  assert.equal(run.retryStage(), true);
  const nBass = basses(ctx).length;
  env.hold(0.5);
  const first = basses(ctx)[nBass];
  assert.ok(first, 'the music is back after the retry');
  assert.ok(near(first.frequency, noteAt('src', 0, 'bass', 0).freq, 1e-6), 'from bar 0 of the stage loop');
});
