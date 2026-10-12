// Procedural chiptune: seeded per-stage bass, lead and hat patterns, an intensity ladder driven by the run state, and a lookahead scheduler on the shared Web Audio context.
(function (CB) {
  'use strict';
  const STEPS = 16; // sixteenth notes per bar
  const BARS = 8; // bars per loop
  const MUSIC_GAIN = 0.1; // the music node, into the master; mute and the master level apply on top
  const TICK_MS = 30;
  const LOOKAHEAD = 0.15; // seconds of notes queued ahead of the clock
  const START_DELAY = 0.05; // a fresh start, or a resync after a stall, begins a hair after "now"
  const FADE_IN = 0.4;
  const FADE_OUT = 0.25;
  const LEVEL_RAMP = 0.15; // patchPick's half gain eases in and out
  const DUCK_DOWN = 0.02;
  const ATTACK = 0.004;
  const FLOOR = 0.0001; // exponential ramps cannot reach 0
  const PEAK = { bass: 0.7, lead: 0.35, hat: 0.2 }; // per note, into the 0.10 node: 0.07 / 0.035 / 0.02 at the speakers
  const HAT_HZ = 6000; // the hat's highpass cutoff, carried in its note's freq
  const HAT_DUR = 0.04;
  const BOSS_TEMPO = 1.1; // intensity 2
  const NOISE_SEED = 0x4a7c;
  const MUSIC_KEY = 'cb.music';
  const BASS_LO = 33; // MIDI 33..47 is 55..123.5 Hz
  const BASS_HI = 47;
  const LEAD_LO = 57; // MIDI 57..81 is 220..880 Hz; intensity 2 doubles it
  const LEAD_HI = 81;
  const ORDER = { bass: 0, lead: 1, hat: 2 };

  // Bass hit slots as [step, length in steps]: straight eighths, or the 3+3+2 grid of the git stage. R = root, F = fifth.
  const EIGHTHS = [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]];
  const EIGHTH_ROLES = ['R', 'R', 'F', 'R', 'R', 'R', 'F', 'R'];
  const THREE_THREE_TWO = [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]];
  const THREE_THREE_TWO_ROLES = ['R', 'R', 'F', 'R', 'R', 'F'];

  // Sixteenth arpeggio contours over a chord's four tones (root, third, fifth, octave); a stage's hash picks one.
  const SHAPES = [
    [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
    [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 1, 0, 1],
    [0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 3],
    [0, 3, 2, 3, 1, 3, 2, 3, 0, 3, 2, 3, 1, 3, 2, 3],
  ];

  // Per stage: scale = semitones above the tonic; bass / lead = the tonic's MIDI note in each register; fifth = scale steps from a
  // chord root to its fifth; loop / boss = the chord root (a scale index) of each of the 8 bars; detune = lead cents.
  const STAGE = {
    src: { // A minor pentatonic
      scale: [0, 3, 5, 7, 10], bass: 45, lead: 69, bpm: 124, detune: 0, fifth: 3, rhythm: EIGHTHS, roles: EIGHTH_ROLES,
      loop: [0, 0, 2, 2, 1, 1, 4, 3], boss: [0, 3, 4, 2, 0, 3, 1, 4],
    },
    node_modules: { // D dorian
      scale: [0, 2, 3, 5, 7, 9, 10], bass: 38, lead: 62, bpm: 108, detune: 6, fifth: 4, rhythm: EIGHTHS, roles: EIGHTH_ROLES,
      loop: [0, 0, 3, 3, 6, 6, 3, 4], boss: [0, 3, 6, 5, 0, 3, 4, 5],
    },
    git: { // E minor
      scale: [0, 2, 3, 5, 7, 8, 10], bass: 40, lead: 64, bpm: 136, detune: 0, fifth: 4, rhythm: THREE_THREE_TWO, roles: THREE_THREE_TWO_ROLES,
      loop: [0, 0, 5, 5, 2, 2, 6, 4], boss: [0, 5, 6, 4, 0, 5, 2, 4],
    },
    prod: { // C# diminished (whole-half)
      scale: [0, 2, 3, 5, 6, 8, 9, 11], bass: 37, lead: 61, bpm: 152, detune: 0, fifth: 4, rhythm: EIGHTHS, roles: EIGHTH_ROLES,
      loop: [0, 0, 2, 2, 4, 4, 5, 5], boss: [0, 2, 0, 4, 0, 5, 4, 2],
    },
  };

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const release = (g) => {
    try {
      g.disconnect();
    } catch (e) {
      /* already gone */
    }
  };

  // ---- patterns -----------------------------------------------------------------------------------------------------------

  // FNV-1a over the string: the stage id (or id + '#boss') seeds every random choice in its pattern.
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  const hz = (m) => Math.round(440 * Math.pow(2, (m - 69) / 12) * 100) / 100;

  // Shifts a MIDI note by octaves into [lo, hi] (a window of at least an octave always has room).
  function fold(m, lo, hi) {
    while (m > hi) m -= 12;
    while (m < lo) m += 12;
    return m;
  }

  // Semitones above the tonic of scale step j (j may run past the octave).
  const degree = (def, j) => def.scale[j % def.scale.length] + 12 * Math.floor(j / def.scale.length);

  function wrapBar(bar) {
    const n = Math.floor(Number(bar));
    return Number.isFinite(n) ? ((n % BARS) + BARS) % BARS : 0;
  }

  // One bar of bass: root and fifth on the stage's rhythm. The RNG moves the fifths about and rests some off-beat hits, never
  // leaving fewer than four notes. The boss loop adds a sixteenth push before every beat.
  function bassLine(def, idx, boss, rng) {
    const root = hz(fold(def.bass + degree(def, idx), BASS_LO, BASS_HI));
    const fifth = hz(fold(def.bass + degree(def, idx + def.fifth), BASS_LO, BASS_HI));
    const roles = def.roles.slice();
    const fifths = [];
    roles.forEach((r, i) => {
      if (r === 'F') fifths.push(i);
    });
    for (const i of fifths) {
      if (!rng.chance(0.3)) continue;
      const j = i + (rng.chance(0.5) ? 1 : -1);
      if (j > 0 && j < roles.length && roles[j] === 'R') {
        roles[i] = 'R';
        roles[j] = 'F';
      }
    }
    const restP = boss ? 0.05 : 0.1;
    let spare = def.rhythm.length - 4;
    const hits = [];
    def.rhythm.forEach(([step, len], i) => {
      const rest = rng.chance(restP);
      if (i > 0 && step % 4 !== 0 && rest && spare > 0) {
        spare--;
        return;
      }
      hits.push({ step, len, freq: roles[i] === 'F' ? fifth : root });
    });
    if (boss) {
      for (let s = 3; s < STEPS; s += 4) if (!hits.some((h) => h.step === s)) hits.push({ step: s, len: 1, freq: root });
      hits.sort((a, b) => a.step - b.step);
    }
    return hits.map((h, i) => ({ step: h.step, freq: h.freq, ch: 'bass', len: Math.min(h.len, (i + 1 < hits.length ? hits[i + 1].step : STEPS) - h.step) }));
  }

  // One bar of lead: a sixteenth arpeggio of the bar's chord (scale steps 0, 2, 4 and the octave), moved by whole octaves into the
  // lead register. The RNG swaps neighbouring notes and rests some off-beat sixteenths; the downbeats always sound.
  function leadLine(def, idx, shape, boss, rng) {
    const n = def.scale.length;
    let tones = [0, 2, 4, n].map((k) => def.lead + degree(def, idx + k));
    let shift = 0;
    while (Math.max.apply(null, tones) + shift > LEAD_HI) shift -= 12;
    while (Math.min.apply(null, tones) + shift < LEAD_LO) shift += 12;
    tones = tones.map((m) => hz(m + shift));
    const seq = shape.slice();
    for (let swaps = boss ? 2 : 1; swaps > 0; swaps--) {
      const swap = rng.chance(0.35);
      const i = rng.int(1, STEPS - 2);
      if (swap) {
        const tmp = seq[i];
        seq[i] = seq[i + 1];
        seq[i + 1] = tmp;
      }
    }
    const restP = boss ? 0.06 : 0.12;
    const out = [];
    for (let s = 0; s < STEPS; s++) {
      const rest = rng.chance(restP);
      if (s % 4 !== 0 && rest) continue;
      out.push({ step: s, freq: tones[seq[s]], ch: 'lead', len: 1 });
    }
    return out;
  }

  // Hats on the off-beats (the boss loop adds the sixteenth after each beat). One of the stage loop's hats may rest.
  function hatLine(boss, rng) {
    const out = [];
    for (const s of [2, 6, 10, 14]) {
      const rest = rng.chance(0.1);
      if (s !== 6 && rest && !boss) continue;
      out.push({ step: s, freq: HAT_HZ, ch: 'hat', len: 1 });
    }
    if (boss) for (const s of [3, 7, 11, 15]) out.push({ step: s, freq: HAT_HZ, ch: 'hat', len: 1 });
    return out;
  }

  // The notes of one bar of a track: a stage id, or stageId + '#boss' for its boss loop. Pure: the same (track, bar) always gives the
  // same notes, and bar wraps at 8. Registers are base octaves (bass 55-130 Hz, lead 220-1760 Hz); the scheduler applies the
  // intensity-2 octave, the tempo and the detune. A hat's freq is its highpass cutoff.
  function pattern(stageId, bar) {
    const id = String(stageId);
    const boss = id.endsWith('#boss');
    const base = boss ? id.slice(0, -5) : id;
    const def = hasOwn(STAGE, base) ? STAGE[base] : STAGE.src;
    const b = wrapBar(bar);
    const seed = hash(id);
    const shape = SHAPES[CB.createRng(seed).int(0, SHAPES.length - 1)];
    const rng = CB.createRng((seed + Math.imul(b + 1, 0x9e3779b1)) >>> 0);
    const idx = (boss ? def.boss : def.loop)[b];
    const notes = bassLine(def, idx, boss, rng).concat(leadLine(def, idx, shape, boss, rng), hatLine(boss, rng));
    notes.sort((a, c) => a.step - c.step || ORDER[a.ch] - ORDER[c.ch]);
    return notes;
  }

  // ---- run state ----------------------------------------------------------------------------------------------------------

  // -1 silent, 0 bass and hats, 1 adds the lead, 2 adds a faster tempo and the lead an octave up. bossWarn is silent because its
  // warning sound is the stinger; the music also stops on bossDead, dying and dead.
  function intensityFor(run) {
    if (!run) return -1;
    switch (run.state) {
      case 'stageIntro':
      case 'wave':
      case 'waveBreak':
      case 'patchPick':
        return 0;
      case 'boss': {
        const boss = run.world && run.world.boss;
        return boss && boss.phase >= 2 ? 2 : 1;
      }
      case 'victory':
        return 1;
      default:
        return -1;
    }
  }

  function stageIdOf(run) {
    const id = run && run.world && run.world.stage && run.world.stage.id;
    if (typeof id === 'string' && id) return id;
    const list = CB.STAGES;
    const s = run && Array.isArray(list) ? list[run.stageIndex] : null;
    return s && typeof s.id === 'string' && s.id ? s.id : 'src';
  }

  // Bosses play their own loop; every other state plays the stage's.
  const trackFor = (run) => stageIdOf(run) + (run && run.state === 'boss' ? '#boss' : '');

  // ---- scheduler ----------------------------------------------------------------------------------------------------------

  let enabled = true;
  try {
    enabled = window.localStorage.getItem(MUSIC_KEY) !== '0';
  } catch (e) {
    enabled = true;
  }

  let ctx = null; // the context the running scheduler plays on
  let node = null; // the music gain, kept across stop/start on the same context
  let nodeCtx = null;
  let hatBuf = null;
  let hatCursor = 0;
  let timer = null;
  let paused = false;
  let level = 1; // 0.5 on the patch pick
  let wantTrack = 'src'; // what the run asks for (update)...
  let wantIntensity = -1;
  let curTrack = null; // ...and what is playing: adopted at each bar boundary
  let curIntensity = 0;
  let curDef = STAGE.src;
  let idle = true; // silent: the next audible tick starts a fresh loop on the downbeat
  let bar = 0;
  let step = 0;
  let nextTime = 0;
  let stepDur = 0.12;
  let byStep = [];
  let duckAmt = 0;
  let duckHoldEnd = 0;
  let duckRel = 0;
  let duckEnd = 0;

  const audioCtx = () => (CB.Audio && typeof CB.Audio.context === 'function' ? CB.Audio.context() : null);
  const baseGain = () => MUSIC_GAIN * level;

  // Half a second of white noise for the hats, drawn from a fixed-seed CB.createRng so every boot sounds the same.
  function makeNoise(c) {
    const rate = c.sampleRate || 44100;
    const buf = c.createBuffer(1, Math.floor(rate / 2), rate);
    const data = buf.getChannelData(0);
    const rng = CB.createRng(NOISE_SEED);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
    return buf;
  }

  // Creates the music gain (silent until faded in) and the hat noise on a context, once per context.
  function ensureNode(c) {
    if (node && nodeCtx === c) return true;
    const out = CB.Audio && typeof CB.Audio.output === 'function' ? CB.Audio.output() : null;
    if (!out) return false;
    try {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(out);
      node = g;
      nodeCtx = c;
    } catch (e) {
      return false;
    }
    try {
      hatBuf = makeNoise(c);
    } catch (e) {
      hatBuf = null; // no hats, the rest still plays
    }
    return true;
  }

  // Ramps the music gain from wherever it is to `target`. Any pending duck is replaced.
  function rampTo(target, secs) {
    try {
      const g = node.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(target, now + secs);
    } catch (e) {
      /* the gain stays where it is */
    }
    duckEnd = 0;
  }

  // Chip envelope: a 4 ms attack to the peak, a sag to `sus` of it over the note and a linear release to silence at `dur`.
  function envelope(g, t, dur, peak, sus) {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + ATTACK);
    g.linearRampToValueAtTime(peak * sus, t + dur * 0.75);
    g.linearRampToValueAtTime(0, t + dur);
  }

  function voice(type, freq, cents, t, dur, peak, sus) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (cents) osc.detune.setValueAtTime(cents, t);
    osc.connect(g);
    g.connect(node);
    envelope(g.gain, t, dur, peak, sus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => release(g);
  }

  // A short burst of the shared noise through a highpass. Each hat starts a little further into the buffer (a counter, not a draw).
  function hat(t, cutoff) {
    if (!hatBuf) return;
    const src = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = hatBuf;
    src.loop = true;
    filt.type = 'highpass';
    filt.frequency.setValueAtTime(cutoff, t);
    src.connect(filt);
    filt.connect(g);
    g.connect(node);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(PEAK.hat, t + 0.002);
    g.gain.exponentialRampToValueAtTime(FLOOR, t + HAT_DUR);
    hatCursor = (hatCursor + 0.0937) % 0.4;
    src.start(t, hatCursor);
    src.stop(t + HAT_DUR + 0.02);
    src.onended = () => release(g);
  }

  // Bar boundary: take the track and intensity the run asks for, set the tempo, and unpack the bar's notes by step. A new track
  // starts at its bar 0.
  function beginBar() {
    if (wantTrack !== curTrack) bar = 0;
    curTrack = wantTrack;
    curIntensity = wantIntensity;
    const baseId = curTrack.endsWith('#boss') ? curTrack.slice(0, -5) : curTrack;
    curDef = hasOwn(STAGE, baseId) ? STAGE[baseId] : STAGE.src;
    stepDur = 60 / (curDef.bpm * (curIntensity >= 2 ? BOSS_TEMPO : 1)) / 4;
    byStep = [];
    for (let s = 0; s < STEPS; s++) byStep.push([]);
    for (const n of pattern(curTrack, bar)) byStep[n.step].push(n);
  }

  function playStep(t) {
    const octave = curIntensity >= 2 ? 2 : 1;
    for (const n of byStep[step]) {
      try {
        if (n.ch === 'bass') voice('triangle', n.freq, 0, t, n.len * stepDur * 0.92, PEAK.bass, 0.8);
        else if (n.ch === 'lead') {
          if (curIntensity >= 1) voice('square', n.freq * octave, curDef.detune, t, n.len * stepDur * 0.85, PEAK.lead, 0.7);
        } else hat(t, n.freq);
      } catch (e) {
        /* a broken voice must never take the game down */
      }
    }
  }

  // Every 30 ms: queue the steps that start before currentTime + 0.15. Paused, hidden or suspended it queues nothing, and on the
  // way back it resyncs to "now" (keeping its place in the bar) rather than replaying the time it missed. A silent run state
  // schedules nothing at once and later restarts the loop from its downbeat.
  function tick() {
    try {
      if (!ctx || paused) return;
      if (typeof document !== 'undefined' && document && document.hidden) return;
      if (ctx.state === 'suspended' || ctx.state === 'closed') return;
      if (wantIntensity < 0) {
        idle = true;
        return;
      }
      const now = ctx.currentTime;
      if (idle) {
        idle = false;
        bar = 0;
        step = 0;
        curTrack = null;
        nextTime = now + START_DELAY;
      } else if (nextTime < now) nextTime = now + START_DELAY;
      const horizon = now + LOOKAHEAD;
      while (nextTime < horizon) {
        if (step === 0) beginBar();
        playStep(nextTime);
        nextTime += stepDur;
        if (++step === STEPS) {
          step = 0;
          bar = (bar + 1) % BARS;
        }
      }
    } catch (e) {
      /* the scheduler survives anything: the next tick tries again */
    }
  }

  // ---- public -------------------------------------------------------------------------------------------------------------

  function setWant(run) {
    wantIntensity = intensityFor(run);
    wantTrack = trackFor(run);
    const lv = run && run.state === 'patchPick' ? 0.5 : 1;
    if (lv !== level) {
      level = lv;
      if (node && timer !== null) rampTo(baseGain(), LEVEL_RAMP);
    }
  }

  // Brings the gain and the scheduler up when music is on, a context exists and nothing is running. It stays silent until update()
  // gives it a run state (or a run is passed in).
  function start(run) {
    if (!enabled || timer !== null) return;
    const c = audioCtx();
    if (!c || typeof setInterval !== 'function' || !ensureNode(c)) return;
    if (run) setWant(run);
    ctx = c;
    idle = true;
    curTrack = null;
    bar = 0;
    step = 0;
    timer = setInterval(tick, TICK_MS);
    rampTo(baseGain(), FADE_IN);
  }

  // Stops scheduling at once and fades the gain out; the next update() starts again from the top of the loop.
  function stop() {
    if (timer === null) return;
    if (typeof clearInterval === 'function') clearInterval(timer);
    timer = null;
    idle = true;
    if (node && ctx) rampTo(0, FADE_OUT);
  }

  // Owns the lifecycle: called every frame with the run (and whether the game is paused). It starts the music when it is on and
  // not running, and tells the scheduler which track and intensity the run wants; both change at the next bar boundary.
  function update(run, isPaused) {
    paused = !!isPaused;
    if (!enabled || !audioCtx()) return;
    setWant(run);
    if (timer === null) start();
  }

  // Dips the music to base x (1 - amount) in 20 ms, holds, then eases back. A lighter duck inside a deeper one keeps the deeper
  // level. A no-op while the music is not running.
  function duck(amount, hold, rel) {
    if (timer === null || !node || !ctx || typeof amount !== 'number' || !Number.isFinite(amount)) return;
    try {
      const g = node.gain;
      const now = ctx.currentTime;
      const hold0 = Number.isFinite(hold) ? Math.max(0, hold) : 0;
      const rel0 = Number.isFinite(rel) ? Math.max(0, rel) : 0;
      const active = now < duckEnd;
      const amt = Math.min(1, Math.max(active ? duckAmt : 0, amount));
      const holdEnd = Math.max(now + DUCK_DOWN + hold0, active ? duckHoldEnd : 0);
      const relT = active ? Math.max(rel0, duckRel) : rel0;
      const low = baseGain() * (1 - amt);
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(low, now + DUCK_DOWN);
      g.setValueAtTime(low, holdEnd);
      g.linearRampToValueAtTime(baseGain(), holdEnd + relT);
      duckAmt = amt;
      duckHoldEnd = holdEnd;
      duckRel = relT;
      duckEnd = holdEnd + relT;
    } catch (e) {
      /* music is optional */
    }
  }

  // toggle() flips, toggle(true / false) sets. Off stops the music; on waits for the next update(). Persisted, best effort.
  function toggle(on) {
    enabled = typeof on === 'boolean' ? on : !enabled;
    try {
      window.localStorage.setItem(MUSIC_KEY, enabled ? '1' : '0');
    } catch (e) {
      /* storage unavailable: the choice lasts for this session only */
    }
    if (!enabled) stop();
    return enabled;
  }

  CB.Music = { pattern, intensityFor, update, start, stop, toggle, isEnabled: () => enabled, duck };
})(window.CB);
