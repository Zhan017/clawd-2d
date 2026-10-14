// Victory screen: the receipt of a clear (time, deaths, patches, bugs squashed, a git log of the four fixes) with a happy Clawd and confetti.
// The bottom row holds two framed buttons, share and continue, side by side (22 px tall on touch); the disclaimer sits under them, in the
// play scene's toast band (y 171-180), which a toast simply covers for its short life.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
  const CLICK_AT = 2.5; // the buttons work strictly after this (play.js accepts the share and continue input then); they show dimmed from BTN_SHOW
  const KINDS = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']; // tally order
  const CELL_STEP = 56; // px between tally cells
  // A worn hat reaches up into the quip line above Clawd, so with one Clawd stands 6 px lower and hops a little less.
  const CLAWD = { x: 160, y: 44, scale: 2, hop: 4, hatHop: 3, hatDrop: 6 };
  const HAT_DY = -7; // per scale, from Clawd's centre (the value Player.HAT_DY holds)
  const BTN_SHOW = 1.6;
  const LOG_X = 40;
  const MAX_LINE = 250; // the patches line is kept to this width, clear of the confetti margins
  const CONFETTI = 24;
  const CONFETTI_COLORS = [C.gold, C.spark, C.clawd];
  const TIME_Y = 60; // the time / deaths line; the patches line is 9 below it
  const TALLY_Y = 83; // centre of the tally sprites; "xN" sits 7 below
  const LOG_HEAD_Y = 101; // the log header; a daily build's date sits at the right end of the same row
  const LOG_Y = 109; // the first commit line; one every LOG_STEP
  const LOG_STEP = 8;
  const UNLOCK_Y = 141; // an "UNLOCKED: ..." line, when this clear unlocked something
  const DAILY_X = 280; // right edge of the daily line: the mirror of LOG_X
  const DISCLAIMER_Y = 173;
  // The bottom row: [ share result ] and [ continue ] side by side with 8 px between. Touch buttons are 22 px tall (44 CSS px at 2x) and the other
  // devices' 14 px, centred on the same line. The row ends at y 171, where the toast band starts.
  const BTN_W = 120;
  const BTN_GAP = 8;
  const BTN_BAND_Y = 149;
  const BTN_TOUCH_H = 22;
  const BTN_H = 14;
  const box = (x, h) => Object.freeze({ x, y: BTN_BAND_Y + Math.floor((BTN_TOUCH_H - h) / 2), w: BTN_W, h });
  const BTN_X0 = Math.round((W - (2 * BTN_W + BTN_GAP)) / 2);
  // A tap here shares (play.js). The touch-sized box; shareBox() gives the current device's.
  const SHARE_BOX = box(BTN_X0, BTN_TOUCH_H);

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const calm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // The share button shows only when there is a CB.Share for it to talk to (optional module); without one [ continue ] keeps the row.
  const canShare = () => !!(CB.Share && typeof CB.Share.send === 'function');
  const deviceKind = () => {
    const d = CB.Prompts && CB.Prompts.device;
    return d === 'touch' || d === 'pad' ? d : 'kbm';
  };
  const btnH = () => (deviceKind() === 'touch' ? BTN_TOUCH_H : BTN_H);
  const shareBox = () => box(BTN_X0, btnH());
  const continueBox = () => (canShare() ? box(BTN_X0 + BTN_W + BTN_GAP, btnH()) : box(Math.round((W - BTN_W) / 2), btnH()));
  const CONTINUE = { kbm: '[ continue ]', touch: '[ continue ]', pad: '[ A: continue ]' };

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

  // A fake short hash for the i-th fix: deterministic in the run's seed, so the receipt does not change between frames. The index is mixed
  // into the bits (not added to the low ones), so the four hashes differ all along their length.
  function commitHash(seed, i) {
    let h = Math.imul((seed | 0) ^ Math.imul(i + 1, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7);
  }

  // Patch id -> times taken, in the order first taken: what the run started with (a daily build's patch), then the picks.
  function patchesTaken(run) {
    const picked = new Map();
    for (const id of Array.isArray(run.history) ? run.history : []) picked.set(String(id), (picked.get(String(id)) || 0) + 1);
    const taken = new Map();
    const held = run.patches && typeof run.patches === 'object' ? run.patches : {};
    for (const id of Object.keys(held)) {
      const extra = Math.floor(num(held[id], 0)) - (picked.get(id) || 0);
      if (extra > 0) taken.set(id, extra);
    }
    for (const [id, n] of picked) taken.set(id, (taken.get(id) || 0) + n);
    return taken;
  }

  // The patches taken: "Spread Shot ×2, Rapid Fire". Too wide: the short ids, then cut with "...".
  function patchesLine(r, run) {
    const picks = patchesTaken(run);
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

  // A line cut with "..." to the receipt's width.
  function fitLine(r, str) {
    if (r.measure(str, 1) <= MAX_LINE) return str;
    const chars = Array.from(str);
    while (chars.length > 1 && r.measure(chars.join('') + '...', 1) > MAX_LINE) chars.pop();
    return chars.join('') + '...';
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
      r.sprite(k + '_0', x, TALLY_Y);
      r.text('x' + Math.floor(sq[k]), x, TALLY_Y + 7, { color: C.pale, align: 'center' });
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

  // ui (optional): unlocked, the list of things this clear unlocked (hat names, 'boss rush + --yolo'), shown as one line.
  function draw(r, run, t, ui) {
    const st = num(run.stateT, 0);
    const show = (at) => clamp((st - at) / 0.25, 0, 1); // each block of the receipt fades in at its own time
    r.alpha(0.8 * clamp(st / 0.3, 0, 1), () => r.rect(0, 0, W, H, C.ink));
    r.alpha(show(0), () => r.text('ALL TESTS PASSING ✓', W / 2, 6, { scale: 2, color: C.green, shadow: C.ink, align: 'center' }));
    const quips = CB.Quips && CB.Quips.victory;
    const quip = Array.isArray(quips) && quips.length ? quips[(Math.floor(num(run.deaths, 0)) + num(run.stageIndex, 0)) % quips.length] : null;
    if (typeof quip === 'string' && quip) r.alpha(show(0.2), () => r.text(quip, W / 2, 23, { color: C.grey, shadow: C.ink, align: 'center' }));
    r.alpha(show(0.2), () => drawClawd(r, st));
    r.alpha(show(0.5), () => {
      r.text('time ' + formatTime(run.time) + ' · deaths ' + Math.floor(num(run.deaths, 0)), W / 2, TIME_Y, { color: C.pale, shadow: C.ink, align: 'center' });
      r.text(patchesLine(r, run), W / 2, TIME_Y + 9, { color: C.pale, shadow: C.ink, align: 'center' });
    });
    r.alpha(show(0.8), () => drawTally(r, run));
    r.alpha(show(1.0), () => {
      r.text('git log --oneline', LOG_X, LOG_HEAD_Y, { color: C.pale });
      if (typeof run.daily === 'string' && run.daily) r.text('daily build ' + run.daily, DAILY_X, LOG_HEAD_Y, { color: C.gold, align: 'right' });
    });
    fixes(run).forEach((B, i) => {
      const line = commitHash(num(run.seed, 1), i) + ' ' + B.commitMsg;
      r.alpha(show(1.1 + 0.1 * i), () => r.text(line, LOG_X, LOG_Y + LOG_STEP * i, { color: C.grey }));
    });
    const unlocked = ui && Array.isArray(ui.unlocked) ? ui.unlocked.filter((u) => typeof u === 'string' && u) : [];
    if (unlocked.length) r.alpha(show(1.5), () => r.text(fitLine(r, 'UNLOCKED: ' + unlocked.join(', ')), W / 2, UNLOCK_Y, { color: C.gold, shadow: C.ink, align: 'center' }));
    r.alpha(show(0.5), () => r.text(DISCLAIMER, W / 2, DISCLAIMER_Y, { color: C.grey, align: 'center' }));
    if (st > BTN_SHOW) {
      const a = clamp((st - BTN_SHOW) / 0.25, 0, 1) * (st > CLICK_AT ? 1 : 0.35); // dim until the buttons take input
      const btn = CB.Screens.button;
      const put = (b, label, color) => {
        if (typeof btn === 'function') btn(r, b, label, { alpha: a, color });
        else r.alpha(a, () => r.text(label, b.x + b.w / 2, b.y + 3, { color: color || C.pale, shadow: C.ink, align: 'center' }));
      };
      if (canShare()) put(shareBox(), say('share', '[ copy result ] (C)'), C.pale);
      put(continueBox(), CONTINUE[deviceKind()], C.white);
    }
    if (st > 0.3) drawConfetti(r, st);
  }

  CB.Screens.victory = { formatTime, commitHash, SHARE_BOX, shareBox, continueBox, CLICK_AT, draw };
})(window.CB);
