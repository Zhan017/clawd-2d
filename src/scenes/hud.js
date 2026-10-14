// HUD: hearts, dash pip, context meter, stage path, wave text, boss bar, low-health vignette, /compact banner, YOLO tag and the cursors.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const HEART_X = 4;
  const HEART_Y = 5;
  const HEART_STEP = 9;
  const MAX_DRAWN_HEARTS = 12; // the strip has room for about this many before the pip and the tags
  const METER = { x: 4, y: 13, w: 48, h: 4 };
  const TRACK = '#66708A'; // the empty meter: about 3.9:1 against the strip (greyDark is 2.4:1)
  const VIGNETTE_PX = 6;
  const QUIET_WAVE_T = 2; // seconds after a wave starts with no idle bubble over Clawd
  const BAR = { x: 90, y: 10, w: 140, h: 5 }; // boss bar frame; the fill sits inside it
  const BAR_FILL_T = 0.8; // the bar fills up to the boss's health over this long when the fight starts
  const NAME_CPS = 40; // the boss name types in at this many characters a second
  const GHOST_HOLD = 0.1; // seconds the white damage segment waits before it eases down to the fill
  const GHOST_RATE = 20; // 1/s: how fast it eases (the segment is gone about 0.3 s after the hit)
  const PIP_MASK = [[1, 3], [0, 4], [0, 4], [0, 4], [1, 3]]; // [first, last] lit column in each row of the 5x5 pip
  const BANNER_TEXT = 'Compacting conversation...';
  let looking = false; // this frame's boss reports a moth being looked at: set by draw(), read by cursor() right after it
  let quietAt = -Infinity; // the clock of the last frame that was in the quiet stretch around a wave start (read by Player's idle bubble)

  // Hearts: R is the rim (ink would vanish on the HUD strip), r the body, w the shine. The empty heart is a slate hollow in a grey rim.
  CB.Art.defineSprite('heart_full', ['.RR.RR.', 'RrwRrrR', 'RrrrrrR', '.RrrrR.', '..RrR..', '...R...']);
  CB.Art.defineSprite('heart_empty', ['.SS.SS.', 'SddSddS', 'SdddddS', '.SdddS.', '..SdS..', '...S...']);
  CB.Art.defineSprite('dash_ready', ['.ccc.', 'cwccc', 'ccccc', 'cccCC', '.CCC.']);
  CB.Art.defineSprite('dash_cool', ['.CCC.', 'CCCCC', 'CCCCC', 'CCCSS', '.SSS.']);
  // Crosshair: white arms with an ink outline and a 1 px gap in the middle; the second frame has arms one pixel longer.
  CB.Art.defineSprite('cursor_cross_0', [
    '....k....',
    '...kwk...',
    '...kwk...',
    '.kkkwkkk.',
    'kwww.wwwk',
    '.kkkwkkk.',
    '...kwk...',
    '...kwk...',
    '....k....',
  ]);
  CB.Art.defineSprite('cursor_cross_1', [
    '.....k.....',
    '....kwk....',
    '....kwk....',
    '....kwk....',
    '.kkkkwkkkk.',
    'kwwww.wwwwk',
    '.kkkkwkkkk.',
    '....kwk....',
    '....kwk....',
    '....kwk....',
    '.....k.....',
  ]);
  // The same crosshair with cyan arms: it tints while the aim is looking at a Heisenbug moth (the tether on the floor is cyan too).
  for (const i of [0, 1]) CB.Art.defineSprite('cursor_cross_look_' + i, CB.Art.spriteDef('cursor_cross_' + i).rows.map((row) => row.replace(/w/g, 'c')));
  // Pointer: the tip (top-left pixel) is the hotspot.
  CB.Art.defineSprite('cursor_pointer', ['k......', 'kk.....', 'kwk....', 'kwwk...', 'kwwwk..', 'kwwwwk.', 'kwwwwwk', 'kkkwwk.', '..kwwk.', '...kk..']);

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const easeOutCubic = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  // Blinks faster than 4 Hz go through Calm mode when it is loaded.
  const blink = (t, hz) => (CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  // A sprite placed by its top-left corner.
  function blit(r, name, x, y, o) {
    const d = CB.Art.spriteDef(name);
    r.sprite(name, x + d.w / 2, y + d.h / 2, o);
  }

  function stageOf(run) {
    return (run.world && run.world.stage) || CB.STAGES[run.stageIndex] || null;
  }

  function stagePalette(stage) {
    const P = CB.Pal.STAGES;
    return (stage && (P[stage.palette] || P[stage.id])) || P.src;
  }

  const isCalm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // At 1 heart the screen edge glows: six nested 1 px frames fading inward, brighter on the beat (steady in calm mode).
  // The red ~/prod/ floor would swallow a red edge, so there it is gold.
  function drawVignette(r, p, stage) {
    const pulse = isCalm() ? 0.5 : clamp(num(p.beatPulse, 0), 0, 1);
    const base = 0.2 + 0.25 * pulse;
    const color = stage && stage.palette === 'prod' ? C.gold : C.hurt;
    for (let i = 0; i < VIGNETTE_PX; i++) {
      r.alpha(base * (1 - i / (VIGNETTE_PX + 1)), () => r.frame(i, i, CB.W - 2 * i, CB.H - 2 * i, color));
    }
  }

  function drawHearts(r, p, t, max) {
    const hearts = clamp(Math.floor(num(p.hearts, 0)), 0, max);
    const lost = num(p.hurtT, 0) > 0 && hearts < max ? hearts : -1; // the heart just lost blinks while Clawd is hurt
    const throb = hearts === 1; // the last heart is drawn on top, after the others, so it can swell
    for (let i = 0; i < max; i++) {
      if (throb && i === 0) continue;
      const x = HEART_X + i * HEART_STEP;
      if (i < hearts) blit(r, 'heart_full', x, HEART_Y);
      else if (i === lost && blink(t, 12)) blit(r, 'heart_full', x, HEART_Y, { white: true });
      else blit(r, 'heart_empty', x, HEART_Y);
    }
    if (throb) {
      if (num(p.beatPulse, 0) > 0.5) r.sprite('heart_full', HEART_X + 3.5, HEART_Y + 2, { scale: 2 });
      else blit(r, 'heart_full', HEART_X, HEART_Y);
    }
  }

  // Cyan and lit when the dash is ready; dim while cooling, filling from the bottom.
  function drawPip(r, p, x) {
    const cd = num(p.stats && p.stats.dashCooldown, 0.8);
    if (num(p.dashCd, 0) <= 0 || cd <= 0) blit(r, 'dash_ready', x, HEART_Y);
    else {
      blit(r, 'dash_cool', x, HEART_Y);
      const rows = Math.round(5 * clamp(1 - p.dashCd / cd, 0, 1));
      for (let j = 5 - rows; j < 5; j++) r.rect(x + PIP_MASK[j][0], HEART_Y + j, PIP_MASK[j][1] - PIP_MASK[j][0] + 1, 1, C.cyan);
    }
    if (num(p.refuseDashT, 0) > 0) r.frame(x - 1, HEART_Y - 1, 7, 7, C.hurt); // a dash pressed while it cools: the pip flashes
  }

  // The context bar: a visible track, cyan fill with a darker bottom row, flashing gold when /compact is ready, and a `/c` tag that lights with it.
  // A /compact pressed before it is full flashes the outline.
  function drawMeter(r, w, t) {
    const c = w.context;
    if (!c || !(num(c.max, 0) > 0)) return;
    const m = METER;
    const frac = clamp(num(c.value, 0) / c.max, 0, 1);
    const full = frac >= 1;
    const gold = full && blink(t, 6);
    r.rect(m.x, m.y, m.w, m.h, TRACK);
    r.rect(m.x + 1, m.y + 1, m.w - 2, m.h - 2, C.ink);
    const fw = Math.round(m.w * frac);
    if (fw > 0) {
      r.rect(m.x, m.y, fw, m.h - 1, gold ? C.gold : C.cyan);
      r.rect(m.x, m.y + m.h - 1, fw, 1, gold ? C.ember : C.cyanDark);
    }
    r.text('/c', m.x + m.w + 3, m.y - 2, { color: full ? (gold ? C.gold : C.white) : TRACK });
    if (num(w.player && w.player.refuseCompactT, 0) > 0) r.frame(m.x - 1, m.y - 1, m.w + 2, m.h + 2, C.hurt);
  }

  // ---- boss bar -------------------------------------------------------------------------------------------------------

  // The white damage segment trails the fill: it holds for a moment after a hit, then eases down. Draw-side state only, kept per run.
  const ghosts = new WeakMap();
  function ghostOf(run, boss, fill, t) {
    let g = ghosts.get(run);
    if (!g || g.boss !== boss) {
      g = { boss, v: fill, last: fill, hold: 0, t };
      ghosts.set(run, g);
    }
    const dt = clamp(t - g.t, 0, 0.1);
    g.t = t;
    if (fill < g.last - 1e-6) g.hold = GHOST_HOLD;
    g.last = fill;
    if (fill >= g.v) {
      g.v = fill;
      g.hold = 0;
    } else {
      g.hold -= dt;
      if (g.hold <= 0) {
        g.v = fill + (g.v - fill) * Math.exp(-GHOST_RATE * dt);
        if (g.v - fill < 0.004) g.v = fill;
      }
    }
    return g.v;
  }

  function drawBossBar(r, run, t, stage) {
    const b = run.world.boss;
    if (!b) return;
    const def = stage && CB.Bosses[stage.boss];
    const name = String((def && def.name) || b.name || '');
    // The name is anchored where the whole word would be centred, so it types out without sliding.
    const shown = run.state === 'boss' ? Math.min(name.length, Math.floor(num(run.stateT, 0) * NAME_CPS)) : name.length;
    if (shown > 0) r.text(name.slice(0, shown), Math.round(CB.W / 2 - r.measure(name, 1) / 2), 1, { color: C.offwhite });

    const fill = CB.Screens.hud.bossBarFill(run);
    const inner = BAR.w - 2;
    const fw = Math.round(inner * fill);
    const gw = Math.round(inner * ghostOf(run, b, fill, num(t, 0)));
    r.frame(BAR.x, BAR.y, BAR.w, BAR.h, C.ink);
    r.rect(BAR.x + 1, BAR.y + 1, inner, BAR.h - 2, C.redDark);
    if (gw > fw) r.rect(BAR.x + 1 + fw, BAR.y + 1, gw - fw, BAR.h - 2, C.white);
    if (fw > 0) {
      const hot = num(b.phase, 1) >= 2;
      r.rect(BAR.x + 1, BAR.y + 1, fw, BAR.h - 2, hot ? C.ember : C.red);
      r.rect(BAR.x + 1, BAR.y + 1, fw, 1, hot ? C.gold : C.hurt);
    }
  }

  CB.Screens.hud = {
    // How full the boss bar is drawn (0..1): it rises to the boss's health over the first 0.8 s of the fight, then tracks it.
    bossBarFill(run) {
      const b = run && run.world && run.world.boss;
      if (!b || !(num(b.maxHp, 0) > 0)) return 0;
      const frac = clamp(num(b.hp, 0) / b.maxHp, 0, 1);
      if (run.state === 'boss') return easeOutCubic(clamp(num(run.stateT, 0) / BAR_FILL_T, 0, 1)) * frac;
      return frac;
    },

    // True while the idle "Thinking..." bubble should hold back: the wave break and the first 2 s of a wave. The world draws before the HUD,
    // so this reads the last HUD frame; `t` is the screen clock, and a stale answer (the HUD stopped drawing) expires after a tenth of a second.
    bubbleQuiet(t) {
      return Number.isFinite(t) && t - quietAt >= -0.1 && t - quietAt < 0.1;
    },

    draw(r, run, t) {
      const w = run && run.world;
      looking = !!(w && w.boss && !w.boss.defeated && w.boss.observing === true);
      if (!w || !w.player) return;
      const p = w.player;
      const stage = stageOf(run);
      const tt = num(t, 0);
      const quiet = run.state === 'waveBreak' || (run.state === 'wave' && num(run.stateT, 0) < QUIET_WAVE_T);
      if (quiet) quietAt = tt;
      if (p.hearts === 1 && !p.dead) drawVignette(r, p, stage);

      const max = clamp(Math.floor(num(p.stats && p.stats.maxHearts, 5)), 1, MAX_DRAWN_HEARTS);
      drawHearts(r, p, tt, max);
      const pipX = HEART_X + max * HEART_STEP + 2;
      drawPip(r, p, pipX);
      drawMeter(r, w, tt);
      if (stage && stage.path) r.text(stage.path, CB.W - 4, 5, { align: 'right', color: stagePalette(stage).accent });

      if (run.state === 'wave') {
        const total = stage && stage.waves ? stage.waves.length : 2;
        r.text('WAVE ' + (run.waveIndex + 1) + '/' + total, CB.W / 2, 5, { align: 'center', color: C.grey });
      } else if ((run.state === 'boss' || run.state === 'bossDead') && w.boss) drawBossBar(r, run, tt, stage);
      if (run.yolo || (w.mode && w.mode.yolo)) r.text('YOLO', Math.max(78, pipX + 8), 5, { color: C.red, shadow: C.ink }); // after the bar: its last letters reach under the bar's left end; x 78, or 3 px past the pip when 8 hearts push it there

      if (num(w.compactBannerT, 0) > 0) {
        r.text(BANNER_TEXT, CB.W / 2, 22, { align: 'center', color: C.gold, shadow: C.ink, alpha: Math.min(1, w.compactBannerT * 3) });
      }
    },

    // `cross` is centred on (x, y); `pointer` has its tip there.
    cursor(r, x, y, mode, t) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const cx = Math.round(x);
      const cy = Math.round(y);
      if (mode === 'pointer') {
        r.sprite('cursor_pointer', cx + 3.5, cy + 5);
        return;
      }
      r.sprite((looking ? 'cursor_cross_look_' : 'cursor_cross_') + (Math.floor(num(t, 0) / 0.25) % 2), cx, cy);
    },
  };
})(window.CB);
