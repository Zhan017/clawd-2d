// Victory screen: the receipt of a clear (time, deaths, patches, bugs squashed, a git log of the four fixes) with a happy Clawd and confetti.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
  const CLICK_AT = 1.5; // the play-again prompt shows strictly after this (play.js accepts the click, tap or A then)
  const KINDS = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']; // tally order
  const CELL_STEP = 56; // px between tally cells
  // A worn hat reaches up into the quip line above Clawd, so with one Clawd stands 6 px lower and hops a little less.
  const CLAWD = { x: 160, y: 44, scale: 2, hop: 4, hatHop: 3, hatDrop: 6 };
  const HAT_DY = -7; // per scale, from Clawd's centre (the value Player.HAT_DY holds)
  const LOG_X = 40;
  const MAX_LINE = 250; // the patches line is kept to this width, clear of the confetti margins
  const CONFETTI = 24;
  const CONFETTI_COLORS = [C.gold, C.spark, C.clawd];

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const calm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // The prompt for `key` on the current device (a missing CB.Prompts or an unknown device reads as keyboard + mouse); `kbm` shows without CB.Prompts.
  function say(key, kbm) {
    const P = CB.Prompts;
    const d = P && P.device;
    return (P && typeof P.text === 'function' && P.text(key, d === 'touch' || d === 'pad' ? d : 'kbm')) || kbm;
  }

  // "mm:ss", minutes padded to two digits.
  function formatTime(seconds) {
    const s = Math.floor(Math.max(0, num(seconds, 0)));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // A fake short git hash for the i-th fix: deterministic in the run's seed, so the receipt does not change between frames.
  function commitHash(seed, i) {
    return ((seed * 2654435761 + i * 97) >>> 0).toString(16).padStart(8, '0').slice(0, 7);
  }

  // The patches taken, in the order they were first picked: "Spread Shot ×2, Rapid Fire". Too wide: the short ids, then cut with "...".
  function patchesLine(r, run) {
    const picks = new Map();
    for (const id of Array.isArray(run.history) ? run.history : []) picks.set(String(id), (picks.get(String(id)) || 0) + 1);
    const defs = (CB.Patches && CB.Patches.DEFS) || {};
    const line = (label) => 'patches: ' + (picks.size ? [...picks].map(([id, n]) => label(id) + (n > 1 ? ' ×' + n : '')).join(', ') : 'none');
    const named = line((id) => (defs[id] ? defs[id].name : id));
    if (r.measure(named, 1) <= MAX_LINE) return named;
    const short = line((id) => id);
    if (r.measure(short, 1) <= MAX_LINE) return short;
    const chars = Array.from(short);
    while (chars.length > 1 && r.measure(chars.join('') + '...', 1) > MAX_LINE) chars.pop();
    return chars.join('') + '...';
  }

  // The bosses this run fixed, oldest first. bossesFixed counts them from the end of the stage list (a run that started on stage 4 fixed one).
  function fixes(run) {
    const stages = CB.STAGES || [];
    const n = typeof run.bossesFixed === 'number' && Number.isFinite(run.bossesFixed) ? clamp(Math.floor(run.bossesFixed), 0, stages.length) : stages.length;
    return stages.slice(stages.length - n).map((s) => CB.Bosses && CB.Bosses[s.boss]).filter((B) => B && typeof B.commitMsg === 'string');
  }

  // The hat Clawd wears on the title, if any. Optional modules, guarded by method.
  function wornHat() {
    const U = CB.Unlocks;
    const id = U && typeof U.hat === 'function' ? U.hat() : null;
    return typeof id === 'string' && CB.Art.hasSprite('hat_' + id) ? id : null;
  }

  function drawClawd(r, st) {
    const hat = wornHat();
    const idle1 = Math.floor(st * 2) % 2 === 1;
    const name = 'clawd_idle' + (idle1 ? 1 : 0) + '_happy';
    const cy = CLAWD.y + (hat ? CLAWD.hatDrop : 0) - Math.abs(Math.sin(st * 6)) * (hat ? CLAWD.hatHop : CLAWD.hop);
    r.sprite(CB.Art.hasSprite(name) ? name : 'clawd_idle' + (idle1 ? 1 : 0), CLAWD.x, cy, { scale: CLAWD.scale });
    if (hat && CB.Player && typeof CB.Player.drawHat === 'function') {
      const dy = num(CB.Player.HAT_DY, HAT_DY);
      CB.Player.drawHat(r, CLAWD.x, cy + dy * CLAWD.scale + (idle1 ? CLAWD.scale : 0), hat, 1, CLAWD.scale); // the idle1 frame is one pixel lower
    }
  }

  // The kill tally: a sprite and "xN" under it for each kind squashed, centred as a row.
  function drawTally(r, run) {
    const sq = run.squashed && typeof run.squashed === 'object' ? run.squashed : {};
    const kinds = KINDS.filter((k) => num(sq[k], 0) > 0 && CB.Art.hasSprite(k + '_0'));
    kinds.forEach((k, i) => {
      const x = W / 2 + (i - (kinds.length - 1) / 2) * CELL_STEP;
      r.sprite(k + '_0', x, 88);
      r.text('x' + Math.floor(sq[k]), x, 95, { color: C.pale, align: 'center' });
    });
  }

  // A repeatable 0..1 number for piece i and a salt (an integer mix, so the three numbers a piece uses are not tied to each other).
  function unit(i, salt) {
    let h = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }

  // Falling ✻ in the two side margins (the receipt fills the middle). Positions come from the index and the clock, so no RNG.
  // They stay on screen, fade near the top and bottom, and fall slowly in calm mode.
  function drawConfetti(r, st) {
    const speed = calm() ? 0.3 : 1;
    for (let i = 0; i < CONFETTI; i++) {
      const u = (k) => unit(i, k);
      const fall = 18 + u(1) * 22;
      const y = 2 + ((u(2) * 170 + st * fall * speed) % 170);
      const x = (i % 2 ? 292 + u(3) * 18 : 7 + u(3) * 20) + Math.sin(st * 2 * speed + i) * 3;
      const a = clamp(Math.min(y - 2, 171 - y) / 12, 0, 1);
      r.alpha(a, () => r.text('✻', Math.round(x), Math.round(y), { color: CONFETTI_COLORS[i % 3] }));
    }
  }

  function draw(r, run) {
    const st = num(run.stateT, 0);
    const show = (at) => clamp((st - at) / 0.25, 0, 1); // each block of the receipt fades in at its own time
    r.alpha(0.8 * clamp(st / 0.3, 0, 1), () => r.rect(0, 0, W, H, C.ink));
    r.alpha(show(0), () => r.text('ALL TESTS PASSING ✓', W / 2, 6, { scale: 2, color: C.green, shadow: C.ink, align: 'center' }));
    const quips = CB.Quips && CB.Quips.victory;
    const quip = Array.isArray(quips) && quips.length ? quips[(Math.floor(num(run.deaths, 0)) + num(run.stageIndex, 0)) % quips.length] : null;
    if (typeof quip === 'string' && quip) r.alpha(show(0.2), () => r.text(quip, W / 2, 23, { color: C.grey, shadow: C.ink, align: 'center' }));
    r.alpha(show(0.2), () => drawClawd(r, st));
    r.alpha(show(0.5), () => {
      r.text('time ' + formatTime(run.time) + ' · deaths ' + Math.floor(num(run.deaths, 0)), W / 2, 62, { color: C.pale, shadow: C.ink, align: 'center' });
      r.text(patchesLine(r, run), W / 2, 71, { color: C.pale, shadow: C.ink, align: 'center' });
    });
    r.alpha(show(0.8), () => drawTally(r, run));
    r.alpha(show(1.0), () => r.text('git log --oneline', LOG_X, 106, { color: C.pale }));
    fixes(run).forEach((B, i) => {
      const line = commitHash(num(run.seed, 1), i) + ' ' + B.commitMsg;
      r.alpha(show(1.1 + 0.1 * i), () => r.text(line, LOG_X, 115 + 9 * i, { color: C.grey }));
    });
    r.alpha(show(0.5), () => r.text(DISCLAIMER, W / 2, 152, { color: C.grey, align: 'center' }));
    if (st > CLICK_AT && Math.floor(st * 2) % 2 === 0) r.text(say('again', 'Click to play again'), W / 2, 160, { color: C.white, shadow: C.ink, align: 'center' });
    if (st > 0.3) drawConfetti(r, st);
  }

  CB.Screens.victory = { formatTime, commitHash, draw };
})(window.CB);
