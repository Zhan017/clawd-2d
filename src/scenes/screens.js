// Overlay cards drawn over the world by run state: stage intro, wave banner, boss warning, the BUG FIXED diff card and the pause screen.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
  const WAVE_FALLBACK = 'incoming...';
  const FADE_OUT = 0.3; // the intro card and the wave-break banner fade out over their last 0.3 s
  const QUIP_START = 0.5; // the prompt lines under the stage path start typing here...
  const QUIP_SPC = 0.02; // ...at this many seconds a character, or faster when the card is short
  const STRIPE_H = 10; // hazard tape at the top and bottom of the boss warning
  const STRIPE_PERIOD = 16;
  const STRIPE_SPEED = 30; // px/s
  const PORTRAIT_Y = 138; // centre of the boss portrait once it has slid in
  const PORTRAIT_FROM = 190;
  const SLIDE_T = 0.6;
  const FLASH_LEAD = 0.2; // the portrait flashes white for the last 0.2 s of the card
  const FRINGE = 2; // px: the chromatic copies sit this far either side of the portrait
  const DIFF_LAST = 2.75; // the last diff line is in by here, so the card is complete before 2.9 s
  const DIFF_MAX = 10;
  // BUG FIXED card: the commit line types at commitCps from `start`; the panel header comes at diffStart, then one diff line every
  // diffStep, then the passing test passDelay after the last line.
  const TIMELINE = Object.freeze({ start: 1.5, commitCps: 100, diffStart: 1.95, diffStep: 0.2, passDelay: 0.1 });
  const PANEL = Object.freeze({ x: 40, y: 72, w: 240, pad: 6 });
  // Stage intro layouts (y = top of the 7 px cell). The long card has room for two prompt lines under the path.
  const INTRO_SHORT = Object.freeze({ bandY: 70, bandH: 34, title: 74, path: 92, quips: [] });
  const INTRO_LONG = Object.freeze({ bandY: 62, bandH: 56, title: 67, path: 85, quips: [97, 106] });

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const easeOutCubic = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  // Blinks faster than 4 Hz go through Calm mode when it is loaded.
  const blink = (t, hz) => (CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);
  // Run timings with fallbacks, so a card still draws when the runner is stubbed.
  const runT = (key, d) => (CB.RUN_T && typeof CB.RUN_T[key] === 'number' ? CB.RUN_T[key] : d);

  function stageOf(run) {
    return (CB.STAGES && CB.STAGES[num(run.stageIndex, 0)]) || (run.world && run.world.stage) || null;
  }

  function stagePalette(stage) {
    const P = CB.Pal.STAGES;
    return (stage && (P[stage.palette] || P[stage.id])) || P.src;
  }

  function bossOf(run) {
    const stage = stageOf(run);
    return (stage && CB.Bosses && CB.Bosses[stage.boss]) || null;
  }

  // The first n characters of str as one text with its left edge at x.
  function typedAt(r, str, n, x, y, o) {
    const chars = Array.from(str);
    const k = clamp(Math.floor(n), 0, chars.length);
    if (k > 0) r.text(k === chars.length ? str : chars.slice(0, k).join(''), x, y, o);
  }

  // The same, anchored where the whole string would sit if centred on cx, so typing never slides the text.
  function typedCentred(r, str, n, cx, y, o) {
    typedAt(r, str, n, Math.round(cx - r.measure(str, (o && o.scale) || 1) / 2), y, o);
  }

  // ---- stage intro --------------------------------------------------------------------------------------------------------

  // The user's prompt and the "thinking" status under the path, when Quips has them for this stage.
  function promptLines(run) {
    const q = CB.Quips && CB.Quips.stage;
    const pair = Array.isArray(q) ? q[num(run.stageIndex, 0)] : null;
    return Array.isArray(pair) ? pair.slice(0, 2).filter((s) => typeof s === 'string' && s) : [];
  }

  function drawStageIntro(r, run) {
    const st = num(run.stateT, 0);
    const full = runT('stageIntro', 2.0);
    const len = num(run.introT, full);
    const short = len < full - 1e-6; // a retry's card: no prompt lines, double typing speed
    const fade = clamp((len - st) / FADE_OUT, 0, 1);
    if (fade <= 0) return;
    const stage = stageOf(run);
    const lines = short ? [] : promptLines(run);
    const L = lines.length ? INTRO_LONG : INTRO_SHORT;
    const title = 'STAGE ' + ((stage && stage.n) || num(run.stageIndex, 0) + 1);
    const path = stage && stage.path ? String(stage.path) : '';
    const titleSpc = short ? 0.03 : 0.06; // seconds per character
    const pathSpc = short ? 0.015 : 0.03;
    r.alpha(fade, () => {
      r.alpha(0.7, () => r.rect(0, L.bandY, W, L.bandH, C.ink));
      typedCentred(r, title, st / titleSpc, W / 2, L.title, { scale: 2, color: C.white, shadow: C.ink });
      typedCentred(r, path, (st - Array.from(title).length * titleSpc) / pathSpc, W / 2, L.path, { color: stagePalette(stage).accent, shadow: C.ink });
      if (!lines.length) return;
      // The prompt block is left-aligned like a terminal, typed as one stream, and always done before the fade.
      const x = Math.round(W / 2 - Math.max(...lines.map((l) => r.measure(l, 1))) / 2);
      const total = lines.reduce((n, l) => n + Array.from(l).length, 0);
      let typed = (st - QUIP_START) / Math.max(0.005, Math.min(QUIP_SPC, (len - 0.95) / total));
      lines.forEach((l, i) => {
        typedAt(r, l, typed, x, L.quips[i], { color: C.pale, shadow: C.ink });
        typed -= Array.from(l).length;
      });
    });
  }

  // ---- wave banner --------------------------------------------------------------------------------------------------------

  function waveBreakLine(run) {
    const q = CB.Quips && CB.Quips.waveBreak;
    const line = Array.isArray(q) && q.length ? q[num(run.stageIndex, 0) % q.length] : null;
    return typeof line === 'string' && line ? line : WAVE_FALLBACK;
  }

  function drawWaveBanner(r, run) {
    const st = num(run.stateT, 0);
    if (run.state === 'waveBreak') {
      const a = clamp(st / 0.2, 0, 1) * clamp((runT('waveBreak', 1.5) - st) / FADE_OUT, 0, 1);
      r.alpha(a, () => {
        r.alpha(0.4, () => r.rect(0, 68, W, 38, C.ink));
        r.text('WAVE ' + (num(run.waveIndex, 0) + 2), W / 2, 74, { scale: 2, color: C.white, shadow: C.ink, align: 'center' });
        r.text(waveBreakLine(run), W / 2, 94, { color: C.grey, shadow: C.ink, align: 'center' });
      });
    } else if (run.state === 'wave' && st < 1.2) {
      const stage = stageOf(run);
      const total = stage && Array.isArray(stage.waves) ? stage.waves.length : 2;
      r.alpha(clamp((1.2 - st) / 0.5, 0, 1), () => {
        r.text('WAVE ' + (num(run.waveIndex, 0) + 1) + '/' + total, W / 2, 40, { color: C.pale, shadow: C.ink, align: 'center' });
      });
    }
  }

  // ---- boss warning -------------------------------------------------------------------------------------------------------

  // Diagonal hazard tape: red runs on ink, slanting, scrolling left as `shift` grows (whole pixels).
  function hazardBand(r, y, shift) {
    r.rect(0, y, W, STRIPE_H, C.ink);
    const half = STRIPE_PERIOD / 2;
    for (let j = 0; j < STRIPE_H; j++) {
      const phase = (shift + j) % STRIPE_PERIOD;
      for (let x = -phase; x < W; x += STRIPE_PERIOD) r.rect(x, y + j, half, 1, C.hurt);
    }
  }

  // A copy of a sprite in one flat colour, defined on first use (the glitch fringes of the portrait).
  function tinted(name, tag, color) {
    const key = 'warn_' + tag + '_' + name;
    if (!CB.Art.hasSprite(key)) CB.Art.defineTint(key, name, color);
    return key;
  }

  // The boss portrait slides up from below, wears cyan and red fringes that swap sides 20 times a second, and flashes white at the end.
  function drawPortrait(r, B, st, len, short) {
    if (!B || !B.portrait || !CB.Art.hasSprite(B.portrait)) return;
    const d = CB.Art.spriteDef(B.portrait);
    const scale = Math.max(2, Math.min(4, Math.floor(56 / Math.max(d.w, d.h))));
    const y = short ? PORTRAIT_Y : PORTRAIT_Y + (PORTRAIT_FROM - PORTRAIT_Y) * (1 - easeOutCubic(clamp(st / SLIDE_T, 0, 1)));
    const side = blink(st, 20) ? FRINGE : -FRINGE;
    r.sprite(tinted(B.portrait, 'cyan', C.cyan), W / 2 - side, y, { scale, alpha: 0.35 });
    r.sprite(tinted(B.portrait, 'hurt', C.hurt), W / 2 + side, y, { scale, alpha: 0.35 });
    r.sprite(B.portrait, W / 2, y, { scale, white: st >= len - FLASH_LEAD && blink(st, 8) });
  }

  function drawBossWarn(r, run) {
    const st = num(run.stateT, 0);
    const full = runT('bossWarn', 2.5);
    const len = num(run.warnT, full);
    const short = len < full - 1e-6; // a retry's card: tagline at once, portrait already in place
    const B = bossOf(run);
    r.alpha(0.4, () => r.rect(0, STRIPE_H, W, H - 2 * STRIPE_H, C.ink));
    const pulse = 0.5 + 0.5 * Math.sin(st * Math.PI * 4); // 2 Hz
    r.alpha(0.1 + 0.2 * pulse, () => {
      for (let i = 0; i < 4; i++) r.frame(i, i, W - 2 * i, H - 2 * i, C.hurt);
    });
    const shift = Math.floor(st * STRIPE_SPEED);
    hazardBand(r, 0, shift);
    hazardBand(r, H - STRIPE_H, shift);
    if (Math.floor(st * 4) % 2 === 0) r.text('⚠ WARNING ⚠', W / 2, 56, { color: C.hurt, shadow: C.ink, align: 'center' });
    if (!B) return;
    r.text(String(B.name || ''), W / 2, 72, { scale: 2, color: C.white, shadow: C.ink, align: 'center' });
    typedCentred(r, String(B.tagline || ''), short ? Infinity : (st - 0.4) / 0.03, W / 2, 92, { color: C.gold, shadow: C.ink });
    drawPortrait(r, B, st, len, short);
  }

  // ---- BUG FIXED card -----------------------------------------------------------------------------------------------------

  const diffOf = (B) => (Array.isArray(B && B.diff) ? B.diff.filter((l) => typeof l === 'string').slice(0, DIFF_MAX) : []);

  function drawBossDead(r, run) {
    const st = num(run.stateT, 0);
    if (!(st > runT('slowmo', 1.5))) return; // the boss is still exploding
    const TL = TIMELINE;
    const B = bossOf(run) || {};
    const diff = diffOf(B);
    const n = diff.length;
    r.alpha(0.65 * clamp((st - TL.start) / 0.25, 0, 1), () => r.rect(0, 0, W, H, C.ink));
    r.text('BUG FIXED ✓', W / 2, 40, { scale: 2, color: C.green, shadow: C.ink, align: 'center' });
    typedCentred(r, 'git commit -m "' + String(B.commitMsg || '') + '"', (st - TL.start) * TL.commitCps, W / 2, 58, { color: C.pale, shadow: C.ink });
    if (st < TL.diffStart) return;

    const rowH = clamp(Math.floor(70 / Math.max(n, 1)), 8, 12);
    const lineY = (i) => 88 + i * rowH;
    const passY = lineY(n) + 3;
    const x = PANEL.x + PANEL.pad;
    const panelH = passY + 7 + 5 - PANEL.y;
    r.alpha(0.82, () => r.rect(PANEL.x, PANEL.y, PANEL.w, panelH, C.ink));
    r.frame(PANEL.x, PANEL.y, PANEL.w, panelH, C.greyDark);
    r.text('@@ ' + String(B.file || '') + ' @@', x, 76, { color: C.grey });
    const step = n > 0 ? Math.min(TL.diffStep, (DIFF_LAST - TL.diffStart) / n) : TL.diffStep;
    diff.forEach((line, i) => {
      if (st < TL.diffStart + step * (i + 1)) return;
      const minus = line.startsWith('-');
      const plus = line.startsWith('+');
      if (minus || plus) r.alpha(0.3, () => r.rect(PANEL.x + 2, lineY(i) - Math.floor((rowH - 8) / 2), PANEL.w - 4, rowH - 1, minus ? C.redDark : C.greenDark));
      r.text(line, x, lineY(i), { color: minus ? C.red : plus ? C.green : C.grey });
    });
    if (st >= TL.diffStart + step * n + TL.passDelay) r.text('✓ 1 test passing', x, passY, { color: C.green });
  }

  // ---- pause --------------------------------------------------------------------------------------------------------------

  // "M sound: on · N music: on · V calm: off", leaving out whatever module is not there.
  function statusLine() {
    const parts = [];
    if (CB.Audio && typeof CB.Audio.isMuted === 'function') parts.push('M sound: ' + (CB.Audio.isMuted() ? 'off' : 'on'));
    if (CB.Music && typeof CB.Music.isEnabled === 'function') parts.push('N music: ' + (CB.Music.isEnabled() ? 'on' : 'off'));
    if (CB.Comfort && typeof CB.Comfort.calm === 'function') parts.push('V calm: ' + (CB.Comfort.calm() ? 'on' : 'off'));
    return parts.join(' · ');
  }

  // "Name ×n" for each owned patch, in the catalogue's order.
  function patchLines(run) {
    const defs = (CB.Patches && CB.Patches.DEFS) || {};
    const order = (CB.Patches && CB.Patches.ORDER) || Object.keys(defs);
    const counts = run && run.patches && typeof run.patches === 'object' ? run.patches : {};
    const out = [];
    for (const id of order) {
      const n = defs[id] ? Math.min(defs[id].max, counts[id] | 0) : 0;
      if (n > 0) out.push(defs[id].name + ' ×' + n);
    }
    return out;
  }

  function drawPause(r, run, t, ui) {
    r.alpha(0.75, () => r.rect(0, 0, W, H, C.ink));
    r.text('PAUSED', W / 2, 14, { scale: 2, color: C.white, shadow: C.ink, align: 'center' });
    if (ui && num(ui.quitArmT, 0) > 0) r.text('Press Q again to quit', W / 2, 34, { color: C.gold, align: 'center' });
    else r.text('Esc: resume · Q: quit to title', W / 2, 34, { color: C.pale, align: 'center' });
    r.text('WASD move · Mouse aim · Click shoot', W / 2, 48, { color: C.pale, align: 'center' });
    r.text('Space dash · E /compact (meter full)', W / 2, 57, { color: C.pale, align: 'center' });
    const status = statusLine();
    if (status) r.text(status, W / 2, 66, { color: C.grey, align: 'center' });
    r.text('patches', W / 2, 82, { color: C.gold, align: 'center' });
    const lines = patchLines(run);
    if (!lines.length) r.text('none yet', W / 2, 91, { color: C.grey, align: 'center' });
    lines.forEach((l, i) => r.text(l, W / 2, 91 + 9 * i, { color: C.pale, align: 'center' }));
    r.text(DISCLAIMER, W / 2, 160, { color: C.grey, align: 'center' });
  }

  CB.Screens.stageIntro = { draw: drawStageIntro };
  CB.Screens.waveBanner = { draw: drawWaveBanner };
  CB.Screens.bossWarn = { draw: drawBossWarn };
  CB.Screens.bossDead = { TIMELINE, draw: drawBossDead };
  CB.Screens.pause = { draw: drawPause };
})(window.CB);
