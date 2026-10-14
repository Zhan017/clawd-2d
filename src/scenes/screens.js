// Overlay cards drawn over the world by run state: stage intro, wave banner, boss warning, the BUG FIXED diff card and the pause screen,
// plus the sound / music / calm chips the title and the pause screen share.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
  const WAVE_FALLBACK = 'incoming...';
  const FADE_OUT = 0.3; // the intro card and the wave-break banner fade out over their last 0.3 s
  const QUIP_START = 0.5; // the prompt lines under the stage path start typing here...
  const QUIP_HOLD = 0.6; // the finished prompt lines stay up this long before the card fades
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
      // The lines are typed by len - 0.9 at the latest: the punchline holds a full 0.6 s before the 0.3 s fade.
      let typed = (st - QUIP_START) / Math.max(0.005, Math.min(QUIP_SPC, (len - QUIP_START - QUIP_HOLD - FADE_OUT) / total));
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
    r.rect(0, STRIPE_H, W, (CB.ARENA ? CB.ARENA.y : 20) - STRIPE_H, C.ink); // the HUD strip (y 0-20) must not show through under the tape
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

  // When the last line of the card (the passing test) has shown for this boss: a confirm press skips the card only after it.
  function passAt(run) {
    const n = diffOf(bossOf(run) || {}).length;
    const step = n > 0 ? Math.min(TIMELINE.diffStep, (DIFF_LAST - TIMELINE.diffStart) / n) : TIMELINE.diffStep;
    return TIMELINE.diffStart + step * n + TIMELINE.passDelay;
  }

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

  // ---- device prompts -----------------------------------------------------------------------------------------------------

  // The device Clawd is being played on. A missing CB.Prompts or an unknown value reads as the keyboard and mouse.
  function deviceOf() {
    const d = CB.Prompts && CB.Prompts.device;
    return d === 'touch' || d === 'pad' ? d : 'kbm';
  }

  // The prompt for `key` on the current device; `kbm` is what shows when CB.Prompts is not loaded.
  function say(key, kbm) {
    const P = CB.Prompts;
    return (P && typeof P.text === 'function' && P.text(key, deviceOf())) || kbm;
  }

  // ---- sound / music / calm chips -----------------------------------------------------------------------------------------

  // Three tappable chips in a fixed row, shared by the title and the pause screen: phones have no M, N or V keys.
  // A chip shows only when its module can report its state; the others keep their places.
  const CHIP = Object.freeze({ w: 74, h: 11, gap: 4, dy: 2 }); // the box starts 2 px above its text row
  const CHIP_X0 = Math.round((W - (3 * CHIP.w + 2 * CHIP.gap)) / 2); // 45
  const TOGGLE_IDS = Object.freeze(['sound', 'music', 'calm']);
  const TOGGLE = {
    sound: {
      key: 'M',
      has: () => !!(CB.Audio && typeof CB.Audio.isMuted === 'function'),
      on: () => !CB.Audio.isMuted(),
      flip: () => (CB.Audio && typeof CB.Audio.toggleMute === 'function' ? !CB.Audio.toggleMute() : null), // toggleMute returns the muted flag
    },
    music: {
      key: 'N',
      has: () => !!(CB.Music && typeof CB.Music.isEnabled === 'function'),
      on: () => !!CB.Music.isEnabled(),
      flip: () => (CB.Music && typeof CB.Music.toggle === 'function' ? !!CB.Music.toggle() : null),
    },
    calm: {
      key: 'V',
      has: () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function'),
      on: () => !!CB.Comfort.calm(),
      flip: () => (CB.Comfort && typeof CB.Comfort.toggle === 'function' ? !!CB.Comfort.toggle() : null),
    },
  };
  const hasChip = (id) => Object.prototype.hasOwnProperty.call(TOGGLE, id) && TOGGLE[id].has();

  const toggles = {
    IDS: TOGGLE_IDS,

    // The chips that exist, with y0 the text row they sit on.
    boxes(y0) {
      const out = [];
      TOGGLE_IDS.forEach((id, i) => {
        if (hasChip(id)) out.push({ id, x: CHIP_X0 + i * (CHIP.w + CHIP.gap), y: num(y0, 0) - CHIP.dy, w: CHIP.w, h: CHIP.h });
      });
      return out;
    },

    // The chip under (x, y), or null. `pad` (optional, px) widens every chip's box on all four sides: a thumb's near-miss on touch.
    hit(x, y, y0, pad) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const p = typeof pad === 'number' && Number.isFinite(pad) && pad > 0 ? pad : 0;
      for (const b of toggles.boxes(y0)) if (x >= b.x - p && x < b.x + b.w + p && y >= b.y - p && y < b.y + b.h + p) return b.id;
      return null;
    },

    // "M sound: on" with a keyboard, "sound: on" without one; '' for a chip that is not there.
    label(id) {
      if (!hasChip(id)) return '';
      return (deviceOf() === 'kbm' ? TOGGLE[id].key + ' ' : '') + id + ': ' + (TOGGLE[id].on() ? 'on' : 'off');
    },

    // Flips the setting, chimes, and returns the new on-state (the current one when the module cannot flip).
    apply(id) {
      if (!hasChip(id)) return false;
      const next = TOGGLE[id].flip();
      if (next === null) return TOGGLE[id].on();
      if (CB.Audio && typeof CB.Audio.play === 'function') CB.Audio.play('uiSelect');
      return next;
    },

    // Dim frames; the chip at focusIndex (an index into IDS: the pad's focus, -1 for none) or under `aim` (the mouse) is bright.
    draw(r, y0, focusIndex, aim) {
      const under = aim && Number.isFinite(aim.x) && Number.isFinite(aim.y) ? toggles.hit(aim.x, aim.y, y0) : null;
      const focus = Number.isInteger(focusIndex) ? TOGGLE_IDS[focusIndex] : null;
      for (const b of toggles.boxes(y0)) {
        const lit = b.id === focus || b.id === under;
        r.alpha(0.6, () => r.rect(b.x, b.y, b.w, b.h, C.ink));
        r.frame(b.x, b.y, b.w, b.h, lit ? C.gold : C.greyDark);
        r.text(toggles.label(b.id), b.x + b.w / 2, b.y + CHIP.dy, { color: lit ? C.white : C.grey, align: 'center' });
      }
    },
  };

  // ---- framed buttons -----------------------------------------------------------------------------------------------------

  // A framed button: ink panel, a frame (gold when lit), the label centred. On touch they are at least 20 game px tall (a 44 CSS px target at 2x).
  const TOUCH_BTN_H = 20;
  const isTouch = () => deviceOf() === 'touch';
  function button(r, b, label, o) {
    const lit = !!(o && o.lit);
    const dim = o && typeof o.alpha === 'number' ? o.alpha : 1;
    r.alpha(dim, () => {
      r.rect(b.x, b.y, b.w, b.h, C.ink);
      r.frame(b.x, b.y, b.w, b.h, lit ? C.gold : C.grey);
      r.text(label, b.x + Math.floor(b.w / 2), b.y + Math.floor((b.h - 7) / 2), { color: (o && o.color) || (lit ? C.white : C.pale), align: 'center' });
    });
  }
  const inRect = (b, x, y) => !!b && Number.isFinite(x) && Number.isFinite(y) && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

  // ---- pause --------------------------------------------------------------------------------------------------------------

  const CHIPS_Y = 68; // text row of the chips: their frames clear the legend line above by 2 px
  // The bottom row: [ resume ] and [ quit to title ], side by side (taller on touch). The patch list gives way to it (PATCH_ROWS lines fit above).
  const BTN_Y = 136;
  const BTN_W = 104;
  const BTN_GAP = 8;
  const BTN_X0 = Math.round((W - (2 * BTN_W + BTN_GAP)) / 2);
  const PATCH_Y = 91;
  const PATCH_ROWS = 5; // 91..134
  const pauseBox = (i, h) => Object.freeze({ x: BTN_X0 + i * (BTN_W + BTN_GAP), y: BTN_Y, w: BTN_W, h });
  const RESUME_BOX = pauseBox(0, TOUCH_BTN_H); // the touch-sized boxes; resumeBox() / quitBox() give the current device's
  const QUIT_BOX = pauseBox(1, TOUCH_BTN_H);
  const resumeBox = () => pauseBox(0, isTouch() ? TOUCH_BTN_H : 12);
  const quitBox = () => pauseBox(1, isTouch() ? TOUCH_BTN_H : 12);

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

  // ui (all optional): quitArmT (> 0 while the first quit is armed), pauseNav + pauseFocus (the pad's chip focus), aimX/aimY (the mouse, for hover).
  function drawPause(r, run, t, ui) {
    const armed = !!(ui && num(ui.quitArmT, 0) > 0);
    const aim = ui && deviceOf() === 'kbm' && Number.isFinite(ui.aimX) && Number.isFinite(ui.aimY) ? { x: ui.aimX, y: ui.aimY } : null;
    r.alpha(0.75, () => r.rect(0, 0, W, H, C.ink));
    r.text('PAUSED', W / 2, 14, { scale: 2, color: C.white, shadow: C.ink, align: 'center' });
    if (armed) r.text(say('quitArm', 'Press Q again to quit'), W / 2, 34, { color: C.gold, align: 'center' });
    else r.text(isTouch() ? 'Tap resume to keep playing' : say('pauseLine', 'Esc: resume · Q: quit to title'), W / 2, 34, { color: C.pale, align: 'center' });
    r.text(say('pauseLegend1', 'WASD move · Mouse aim · Click shoot'), W / 2, 48, { color: C.pale, align: 'center' });
    r.text(say('pauseLegend2', 'Space dash · E /compact (meter full)'), W / 2, 57, { color: C.pale, align: 'center' });
    toggles.draw(r, CHIPS_Y, ui && ui.pauseNav ? ui.pauseFocus : -1, aim);
    r.text('patches', W / 2, 82, { color: C.gold, align: 'center' });
    const lines = patchLines(run);
    if (!lines.length) r.text('none yet', W / 2, PATCH_Y, { color: C.grey, align: 'center' });
    // Up to PATCH_ROWS lines in one centred column; more (only a debug run holds so many) split into two, so the buttons below keep their place.
    const rows = lines.length > PATCH_ROWS ? Math.ceil(lines.length / 2) : PATCH_ROWS;
    lines.forEach((l, i) => {
      const col = lines.length > PATCH_ROWS ? Math.floor(i / rows) : 0;
      const cx = lines.length > PATCH_ROWS ? (col ? W * 0.75 : W * 0.25) : W / 2;
      r.text(l, cx, PATCH_Y + 9 * (i % rows), { color: C.pale, align: 'center' });
    });
    const rb = resumeBox();
    const qb = quitBox();
    button(r, rb, '[ resume ]', { lit: !!(aim && inRect(rb, aim.x, aim.y)) });
    button(r, qb, armed ? '[ quit again ]' : '[ quit to title ]', { lit: armed || !!(aim && inRect(qb, aim.x, aim.y)), color: armed ? C.gold : undefined });
    r.text(DISCLAIMER, W / 2, 166, { color: C.grey, align: 'center' });
  }

  CB.Screens.stageIntro = { draw: drawStageIntro };
  CB.Screens.waveBanner = { draw: drawWaveBanner };
  CB.Screens.bossWarn = { draw: drawBossWarn };
  CB.Screens.bossDead = { TIMELINE, passAt, draw: drawBossDead };
  CB.Screens.toggles = toggles;
  CB.Screens.button = button;
  CB.Screens.pause = { CHIPS_Y, QUIT_BOX, RESUME_BOX, resumeBox, quitBox, draw: drawPause };
})(window.CB);
