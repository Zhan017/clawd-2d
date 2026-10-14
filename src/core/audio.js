// Web Audio synth sound effects: event to sound mapping, throttles, pitch variation, music ducking and a persisted mute. No audio files.
(function (CB) {
  'use strict';
  const MASTER = 0.25;
  const FLOOR = 0.0001; // exponential ramps cannot reach 0
  const NOISE_SEED = 0xc1a0d;
  const MUTE_KEY = 'cb.muted';

  // Seconds between two plays of the same sound, measured on ctx.currentTime. `perfect` carries the old graze throttle; `clink` stops a stream
  // of bolts bouncing off a Heisenbug wave from machine-gunning.
  const THROTTLE = { shoot: 0.07, enemyShoot: 0.09, hit: 0.04, perfect: 0.05, blast: 0.06, clink: 0.05, refuse: 0.15 };
  // Pitch multipliers cycled per sound, so a stream of identical blips does not machine-gun. A throttled play does not advance them.
  const VARIANTS = { shoot: [1, 1.06, 0.97, 1.09], hit: [1, 0.92, 1.1], enemyDie: [1, 0.85, 1.15, 0.93] };
  // Music ducking per event: [amount, hold seconds, release seconds].
  const DUCK = { playerHurt: [0.4, 0.12, 0.35], bossPhase: [0.5, 0.3, 0.6], compact: [0.5, 0.2, 0.5], heartbeat: [0.7, 0.05, 0.2] };

  // Pitches in Hz (equal temperament, A4 = 440).
  const E4 = 329.63;
  const A4 = 440;
  const C5 = 523.25;
  const E5 = 659.26;
  const G5 = 783.99;
  const A5 = 880;
  const C6 = 1046.5;
  const CS6 = 1108.73;
  const E6 = 1318.51;
  const G6 = 1567.98;
  const A6 = 1760;
  const C7 = 2093;

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let noiseCursor = 0;
  const lastAt = {};
  const played = {};
  for (const k of Object.keys(THROTTLE)) lastAt[k] = -Infinity;
  for (const k of Object.keys(VARIANTS)) played[k] = 0;

  try {
    muted = window.localStorage.getItem(MUTE_KEY) === '1';
  } catch (e) {
    muted = false;
  }

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const release = (g) => {
    try {
      g.disconnect();
    } catch (e) {
      /* already gone */
    }
  };

  // ---- voices -------------------------------------------------------------------------------------------------------------

  // Gain envelope: a short attack to `vol`, then an exponential decay to silence, or with `flat` a hold and a short release.
  function envelope(g, t, dur, vol, o) {
    const rel = o && o.flat ? Math.min(0.02, dur * 0.3) : 0;
    const att = Math.min((o && o.attack) || 0.004, dur * 0.9 - rel);
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.linearRampToValueAtTime(vol, t + att);
    if (rel > 0) {
      g.gain.setValueAtTime(vol, t + dur - rel);
      g.gain.linearRampToValueAtTime(FLOOR, t + dur);
    } else g.gain.exponentialRampToValueAtTime(FLOOR, t + dur);
  }

  // One oscillator voice gliding f0 -> f1 over `dur`. start() comes before the glide is scheduled, so the start pitch is f0.
  function tone(type, f0, f1, t, dur, vol, o) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.connect(g);
    g.connect(master);
    envelope(g, t, dur, vol, o);
    osc.start(t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.stop(t + dur + 0.03);
    osc.onended = () => release(g);
    return osc;
  }

  // Notes played back to back, `step` seconds apart.
  function arp(type, notes, t, step, dur, vol, o) {
    for (let i = 0; i < notes.length; i++) tone(type, notes[i], notes[i], t + i * step, dur, vol, o);
  }

  // A filtered burst of the shared noise buffer, with the filter gliding f0 -> f1. Each burst starts a little further into the
  // buffer (a counter, not a random draw), so repeats are not sample-identical.
  function noise(ftype, f0, f1, t, dur, vol, o) {
    const src = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true; // white noise wraps without an audible seam, and bossDie outlasts the 1 s buffer
    filt.type = ftype;
    filt.frequency.setValueAtTime(f0, t);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    envelope(g, t, dur, vol, o);
    noiseCursor = (noiseCursor + 0.173) % 0.7;
    src.start(t, noiseCursor);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.stop(t + dur + 0.03);
    src.onended = () => release(g);
  }

  // ---- sounds -------------------------------------------------------------------------------------------------------------

  // Each sound is (t, m): the start time and a pitch multiplier. Only shoot, hit and enemyDie are ever given an m other than 1.
  const SOUNDS = {
    shoot(t, m = 1) {
      tone('square', 880 * m, 620 * m, t, 0.045, 0.1);
    },
    hit(t, m = 1) {
      tone('triangle', 320 * m, 180 * m, t, 0.035, 0.18);
    },
    clink(t) {
      tone('square', 1400, 1400, t, 0.025, 0.06);
    },
    refuse(t) {
      tone('triangle', 150, 110, t, 0.04, 0.09); // a dull tick: a dash or /compact that is not ready
    },
    enemyDie(t, m = 1) {
      noise('lowpass', 2000 * m, 2000 * m, t, 0.11, 0.16);
      tone('square', 240 * m, 70 * m, t, 0.12, 0.12);
    },
    spawn(t) {
      tone('triangle', 220, 440, t, 0.09, 0.08);
    },
    playerHurt(t) {
      tone('square', 320, 90, t, 0.26, 0.2);
      noise('lowpass', 2400, 2400, t, 0.12, 0.14);
    },
    playerDie(t) {
      arp('square', [E5, C5, A4, E4], t, 0.09, 0.09, 0.14, { flat: true });
    },
    dash(t) {
      noise('highpass', 1500, 1500, t, 0.09, 0.14);
    },
    bounce(t) {
      tone('triangle', 660, 660, t, 0.03, 0.1);
    },
    enemyShoot(t) {
      tone('square', 210, 210, t, 0.035, 0.07);
    },
    bossPhase(t) {
      arp('square', [660, 440, 660, 440, 660, 440], t, 0.12, 0.11, 0.14, { flat: true });
    },
    bossDie(t) {
      noise('lowpass', 3000, 200, t, 1.2, 0.28);
      tone('square', 200, 40, t, 1.2, 0.2);
    },
    bossWarn(t) {
      arp('square', [110, 110, 110, 110], t, 0.15, 0.1, 0.18, { flat: true });
    },
    teleport(t) {
      tone('square', 200, 1600, t, 0.12, 0.1);
    },
    beamCharge(t) {
      tone('sine', 200, 900, t, 0.8, 0.08, { flat: true, attack: 0.7 });
    },
    beam(t) {
      const osc = tone('sawtooth', 110, 110, t, 0.5, 0.14, { flat: true });
      // 30 Hz vibrato: a sine LFO wobbling the saw's frequency by +-10 Hz.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(30, t);
      depth.gain.setValueAtTime(10, t);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + 0.53);
      lfo.onended = () => release(depth);
    },
    lob(t) {
      tone('triangle', 380, 720, t, 0.12, 0.1);
    },
    splat(t) {
      noise('lowpass', 900, 900, t, 0.08, 0.16);
    },
    revive(t) {
      arp('square', [A4, C5, E5, A5], t, 0.08, 0.08, 0.12, { flat: true });
    },
    patchPick(t) {
      arp('triangle', [C5, E5, G5, C6], t, 0.07, 0.12, 0.16);
    },
    uiSelect(t) {
      tone('square', 990, 990, t, 0.03, 0.08, { flat: true });
    },
    heartbeat(t) {
      tone('sine', 70, 45, t, 0.08, 0.3);
      tone('sine', 70, 45, t + 0.14, 0.08, 0.3);
    },
    compact(t) {
      tone('sine', 120, 1400, t, 0.5, 0.2, { attack: 0.02 });
      noise('highpass', 800, 4000, t, 0.4, 0.1, { attack: 0.05 });
    },
    compactReady(t) {
      arp('triangle', [880, 1320], t, 0.06, 0.1, 0.12);
    },
    perfect(t) {
      arp('square', [1200, 1800], t, 0.04, 0.04, 0.08, { flat: true });
    },
    pickup(t) {
      arp('triangle', [C6, E6, G6], t, 0.05, 0.09, 0.12);
    },
    blast(t) {
      noise('lowpass', 1200, 250, t, 0.09, 0.2);
      tone('triangle', 160, 50, t, 0.09, 0.15);
    },
    victory(t) {
      arp('square', [G5, C6, E6, G6, E6, C7], t, 0.11, 0.11, 0.12, { flat: true });
    },
    unlock(t) {
      arp('triangle', [A5, CS6, E6, A6], t, 0.08, 0.16, 0.14);
    },
  };

  // Event type -> sound name. `graze` only reaches the table for perfect dashes (see soundFor); `bossEnter` is the boss's teleport-in.
  const EVENT_SOUND = {
    shoot: 'shoot', hit: 'hit', clink: 'clink', enemyDie: 'enemyDie', spawn: 'spawn', playerHurt: 'playerHurt', playerDie: 'playerDie',
    dash: 'dash', bounce: 'bounce', enemyShoot: 'enemyShoot', bossPhase: 'bossPhase', bossDie: 'bossDie', bossWarn: 'bossWarn',
    bossEnter: 'teleport', teleport: 'teleport', beamCharge: 'beamCharge', beam: 'beam', lob: 'lob', splat: 'splat', revive: 'revive',
    patchPick: 'patchPick', uiSelect: 'uiSelect', heartbeat: 'heartbeat', compact: 'compact', compactReady: 'compactReady',
    graze: 'perfect', pickup: 'pickup', blast: 'blast', victory: 'victory', unlock: 'unlock', refuse: 'refuse',
  };

  // ---- context ------------------------------------------------------------------------------------------------------------

  function resume() {
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      /* stays suspended */
    }
  }

  // One second of white noise from a seeded RNG.
  function makeNoise(c) {
    const rate = c.sampleRate || 44100;
    const buf = c.createBuffer(1, rate, rate);
    const data = buf.getChannelData(0);
    const rng = CB.createRng(NOISE_SEED);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
    return buf;
  }

  // Creates the context on the first call (it needs a user gesture, so main.js calls it from pointerdown/keydown) and resumes it on
  // later ones. Returns whether sound is available; any failure leaves audio disabled.
  function init() {
    try {
      if (ctx) {
        if (ctx.state !== 'running') resume();
        return true;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const c = new AC();
      try {
        const g = c.createGain();
        g.gain.value = muted ? 0 : MASTER;
        g.connect(c.destination);
        const buf = makeNoise(c);
        ctx = c;
        master = g;
        noiseBuf = buf;
      } catch (e) {
        try {
          c.close();
        } catch (e2) {
          /* nothing to close */
        }
        return false;
      }
      if (ctx.state !== 'running') resume();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- playing ------------------------------------------------------------------------------------------------------------

  // Plays one named sound, throttled and pitch-varied. Never throws.
  function play(name) {
    if (!ctx || !master || muted) return;
    if (ctx.state === 'suspended' || ctx.state === 'closed') return; // do not queue a burst for when it wakes up
    if (!hasOwn(SOUNDS, name)) return;
    try {
      const now = ctx.currentTime;
      if (hasOwn(THROTTLE, name)) {
        if (now - lastAt[name] < THROTTLE[name]) return;
        lastAt[name] = now;
      }
      const table = VARIANTS[name];
      const m = table ? table[played[name]++ % table.length] : 1;
      SOUNDS[name](now, m);
    } catch (e) {
      /* a broken voice must never take the game down */
    }
  }

  // The sound an event plays, or null for none.
  function soundFor(e) {
    if (!hasOwn(EVENT_SOUND, e.type)) return null;
    if (e.type === 'enemyDie' && e.silent) return null;
    if (e.type === 'graze' && !e.perfect) return null; // only perfect dashes graze in rev 3
    if (e.type === 'playerHurt' && e.god) return 'hit';
    return EVENT_SOUND[e.type];
  }

  function duck(type) {
    const M = CB.Music;
    if (!hasOwn(DUCK, type) || !M || typeof M.duck !== 'function') return;
    try {
      M.duck(DUCK[type][0], DUCK[type][1], DUCK[type][2]);
    } catch (e) {
      /* music is optional */
    }
  }

  // One sound (and one duck) per mapped event.
  function handleEvents(events) {
    if (!Array.isArray(events)) return;
    for (const e of events) {
      if (!e || typeof e.type !== 'string') continue;
      duck(e.type);
      const name = soundFor(e);
      if (name) play(name);
    }
  }

  // ---- mute ---------------------------------------------------------------------------------------------------------------

  // Mute lives on the master gain, so it silences the music too. A 20 ms ramp keeps the switch from clicking.
  function applyMute() {
    if (!master) return;
    const v = muted ? 0 : MASTER;
    try {
      const g = master.gain;
      const now = ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + 0.02);
    } catch (e) {
      try {
        master.gain.value = v;
      } catch (e2) {
        /* no gain to set */
      }
    }
  }

  function setMuted(b) {
    muted = !!b;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch (e) {
      /* storage unavailable: the choice lasts for this session only */
    }
    applyMute();
  }

  CB.Audio = {
    init,
    play,
    handleEvents,
    toggleMute() {
      setMuted(!muted);
      return muted;
    },
    setMuted,
    isMuted: () => muted,
    context: () => ctx,
    output: () => master,
    SOUNDS,
    EVENT_SOUND,
  };
})(window.CB);
