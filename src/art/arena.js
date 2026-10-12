// Arena floor and walls drawn as a code editor: a static layer cached per stage, then per-frame cursor line, wall pulse and boss overlays.
(function (CB) {
  'use strict';
  const A = CB.ARENA;
  const HUD_BG = '#0D0D12';
  const HUD_LINE_Y = 17; // y 0-16 is the HUD strip, y 17 the 1 px line under it
  const ROW = 6; // the editor grid: a rule and a code row every 6 px
  const ROWS = Math.floor(A.h / ROW); // 25 rows fit the floor
  const NUM_PITCH = 12; // a line number beside every second row
  const NUMS = Math.ceil(A.h / NUM_PITCH); // 13 numbers down the left wall
  const CODE_L = A.x + 8; // code starts here; indents add multiples of 8 px
  const CODE_R = A.x + A.w - 8; // a bar ends here at the latest, so none touches a wall
  const GLYPH_H = 5;
  const CURSOR_SPEED = 6; // px/s the cursor-line highlight drifts down the floor
  const GLITCH_T = 0.4; // the length of w.glitchT, as Fx sets it on a phase change
  const SCAN_H = 6;
  const OVERLAY_A = 0.18; // boss overlays stay at or under 0.2 so bullets stay readable
  const GAUGE = { x: 2, y: A.y + 26, w: 4, h: 100 }; // memory-leak heap gauge, inside the left wall
  const CENTER = { x: 160, y: 96 };

  // Local 3x5 digit font for the line numbers (digits only; the 5x7 font is not needed at load time).
  const DIGITS = [
    ['###', '#.#', '#.#', '#.#', '###'],
    ['.#.', '##.', '.#.', '.#.', '###'],
    ['###', '..#', '###', '#..', '###'],
    ['###', '..#', '###', '..#', '###'],
    ['#.#', '#.#', '###', '..#', '..#'],
    ['###', '#..', '###', '..#', '###'],
    ['###', '#..', '###', '#.#', '###'],
    ['###', '..#', '..#', '..#', '..#'],
    ['###', '#.#', '###', '#.#', '###'],
    ['###', '#.#', '###', '..#', '###'],
  ];
  // The per-boss signature colour, as a palette name.
  const THEME_COLOR = { infiniteLoop: 'purple', memoryLeakBoss: 'green', mergeConflict: 'blue', heisenbug: 'magenta' };

  function hashStr(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  const mix = (a, b) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function paletteOf(stage) {
    const P = CB.Pal.STAGES;
    return (stage && (P[stage.palette] || P[stage.id])) || P.src;
  }

  // One 3x5 digit as horizontal runs. `put(x, y, w, h, color)` is whatever target is being painted.
  function drawDigit(put, d, x, y, color) {
    const rows = DIGITS[d];
    for (let j = 0; j < GLYPH_H; j++) {
      let i = 0;
      while (i < 3) {
        if (rows[j][i] !== '#') {
          i++;
          continue;
        }
        let k = i;
        while (k < 3 && rows[j][k] === '#') k++;
        put(x + i, y + j, k - i, 1, color);
        i = k;
      }
    }
  }

  // A line number right-aligned so its last pixel column is 6 (inside the 8 px wall, clear of the bevel at x 7).
  function drawNumber(put, n, y, color) {
    const s = String(n);
    for (let i = 0; i < s.length; i++) drawDigit(put, s.charCodeAt(s.length - 1 - i) - 48, 4 - 4 * i, y, color);
  }

  const labelY = (k) => A.y + (k - 1) * NUM_PITCH + 1;

  // The code lines of a stage: 20-30 of them (the floor has 25 rows) from the stage id, each 1-4 tokens at an 8 px indent.
  const layouts = Object.create(null);
  function layoutFor(stage) {
    const id = String((stage && stage.id) || 'src');
    if (layouts[id]) return layouts[id];
    const pal = paletteOf(stage);
    const codes = pal.code && pal.code.length ? pal.code : [pal.wallHi];
    const rng = CB.createRng(hashStr(id));
    const want = Math.min(ROWS, rng.int(20, 30));
    const all = [];
    for (let i = 0; i < ROWS; i++) all.push(i);
    const rows = rng.shuffle(all).slice(0, want).sort((a, b) => a - b);
    const lines = rows.map((row) => {
      const indent = rng.int(0, 4);
      const bars = [];
      let x = CODE_L + indent * 8;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const w = rng.int(3, 23) * 2; // 6..46 px
        const color = codes[rng.int(0, codes.length - 1)];
        if (x + w > CODE_R) break;
        bars.push({ x, w, color });
        x += w + 3;
      }
      return { row, y: A.y + row * ROW + 2, indent, bars };
    });
    layouts[id] = { id, lines };
    return layouts[id];
  }

  // The static layer: HUD strip, walls with a 3-tone bevel, the ruled floor, code bars, line numbers.
  function paint(put, pal, layout) {
    const W = CB.W;
    put(0, 0, W, HUD_LINE_Y, HUD_BG);
    put(0, HUD_LINE_Y, W, 1, pal.wallLo);
    put(0, HUD_LINE_Y + 1, W, CB.H - HUD_LINE_Y - 1, pal.wall);
    put(0, HUD_LINE_Y + 1, 1, CB.H - HUD_LINE_Y - 1, pal.wallLo); // outer edges
    put(W - 1, HUD_LINE_Y + 1, 1, CB.H - HUD_LINE_Y - 1, pal.wallLo);
    put(0, CB.H - 1, W, 1, pal.wallLo);
    const ix = A.x - 1;
    const iy = A.y - 1;
    const iw = A.w + 2;
    const ih = A.h + 2;
    put(ix, iy, iw, 1, pal.wallHi); // inner edge, a frame around the floor
    put(ix, iy + ih - 1, iw, 1, pal.wallHi);
    put(ix, iy, 1, ih, pal.wallHi);
    put(ix + iw - 1, iy, 1, ih, pal.wallHi);
    // Right wall: an editor scrollbar. Bottom wall: status-bar ticks.
    put(CB.W - 6, A.y + 2, 4, A.h - 4, pal.wallLo);
    put(CB.W - 5, A.y + 6, 2, 34, pal.wallHi);
    put(A.x + 4, A.y + A.h + 3, 16, 2, pal.lineNo);
    put(A.x + 26, A.y + A.h + 3, 10, 2, pal.lineNo);
    put(A.x + A.w - 30, A.y + A.h + 3, 24, 2, pal.lineNo);

    put(A.x, A.y, A.w, A.h, pal.floor);
    for (let i = 0; i < ROWS; i++) put(A.x, A.y + i * ROW + 5, A.w, 1, pal.floorLine);
    for (const ln of layout.lines) {
      for (const b of ln.bars) {
        put(b.x + 1, ln.y, b.w - 2, 1, b.color); // rounded: the top row is one pixel shorter at each end
        put(b.x, ln.y + 1, b.w, 1, b.color);
      }
    }
    for (let k = 1; k <= NUMS; k++) drawNumber(put, k, labelY(k), pal.lineNo);
  }

  // One baked 320x180 canvas per stage. Without a DOM (or if baking fails) the caller paints straight onto the renderer.
  const baked = Object.create(null);
  function bakedFor(stage, pal, layout) {
    const key = layout.id + '|' + (stage && stage.palette);
    if (key in baked) return baked[key];
    let c = null;
    try {
      if (typeof document !== 'undefined') {
        c = document.createElement('canvas');
        c.width = CB.W;
        c.height = CB.H;
        const g = c.getContext('2d');
        paint((x, y, w, h, color) => {
          g.fillStyle = color;
          g.fillRect(x, y, w, h);
        }, pal, layout);
      }
    } catch (e) {
      c = null;
    }
    baked[key] = c;
    return c;
  }

  // ---- per-frame effects ----------------------------------------------------------------------------------------------

  // The 1-row highlight of the editor's current line, drifting down and wrapping.
  function cursorLine(r, t) {
    const y = A.y + ((num(t, 0) * CURSOR_SPEED) % A.h);
    const h = Math.min(ROW, A.y + A.h - y);
    r.alpha(0.06, () => r.rect(A.x, y, A.w, h, CB.Pal.C.white));
  }

  function pulseWalls(r, pal, t) {
    r.alpha(0.1 + 0.08 * Math.sin(num(t, 0) * 3), () => {
      r.rect(0, HUD_LINE_Y + 1, CB.W, A.y - HUD_LINE_Y - 1, pal.accent);
      r.rect(0, A.y, A.x, CB.H - A.y, pal.accent);
      r.rect(A.x + A.w, A.y, CB.W - A.x - A.w, CB.H - A.y, pal.accent);
      r.rect(A.x, A.y + A.h, A.w, CB.H - A.y - A.h, pal.accent);
    });
  }

  // 1 px dashes marching round a circle (standing still in calm mode).
  function dashedRing(r, cx, cy, rad, t, color) {
    const n = Math.max(12, Math.round(2 * Math.PI * rad));
    const calm = !!(CB.Comfort && CB.Comfort.calm && CB.Comfort.calm());
    const march = calm ? 0 : Math.floor(num(t, 0) * 8);
    for (let i = 0; i < n; i++) {
      if (Math.floor((i + march) / 4) % 2) continue;
      const a = (i / n) * Math.PI * 2;
      r.rect(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 1, 1, color);
    }
  }

  // The number a line-number slot shows: 1..13 down the wall, or 1 2 3 repeating while the Infinite Loop is in phase 2+.
  function lineNumber(k, w) {
    const b = w && w.boss;
    if (b && !b.defeated && b.id === 'infiniteLoop' && num(b.phase, 1) >= 2) return ((k - 1) % 3) + 1;
    return k;
  }

  function loopOverlay(r, pal, t, w, b) {
    const rad = clamp(num(b.radius, 60), 4, 72); // 72 keeps the ring inside the floor's height around (160, 96)
    r.alpha(OVERLAY_A, () => dashedRing(r, CENTER.x, CENTER.y, rad, t, pal.accent));
    if (num(b.phase, 1) < 2) return;
    const put = (x, y, ww, hh, color) => r.rect(x, y, ww, hh, color);
    for (let k = 1; k <= NUMS; k++) {
      const y = labelY(k);
      r.rect(0, y, 1, GLYPH_H, pal.wallLo); // blank the baked number, then write the cycled one
      r.rect(1, y, 6, GLYPH_H, pal.wall);
      drawNumber(put, lineNumber(k, w), y, pal.lineNo);
    }
  }

  function heapOverlay(r, pal, b) {
    const C = CB.Pal.C;
    const f = clamp(num(b.size, 1) - 1, 0, 1);
    r.alpha(0.05 * f, () => r.rect(A.x, A.y, A.w, A.h, C.green));
    const g = GAUGE;
    r.rect(0, g.y - 1, 1, g.h + 2, pal.wallLo); // the frame starts at x 1: restore the outer edge a two-digit line number drew over
    r.frame(g.x - 1, g.y - 1, g.w + 2, g.h + 2, pal.wallHi);
    r.rect(g.x, g.y, g.w, g.h, C.ink);
    const fill = Math.round(g.h * f);
    // Thermometer: green to 50 %, yellow to 80 %, red above.
    const bands = [[0, 50, C.green], [50, 80, C.yellow], [80, 100, C.red]];
    for (const [lo, hi, color] of bands) {
      const top = Math.min(fill, hi);
      if (top > lo) r.rect(g.x, g.y + g.h - top, g.w, top - lo, color);
    }
    if (fill > 0) r.alpha(0.2, () => r.rect(g.x, g.y + g.h - fill, 1, fill, C.white)); // a gloss line down the left of the fill
  }

  function conflictOverlay(r, pal) {
    const C = CB.Pal.C;
    const half = A.w / 2;
    r.alpha(0.07, () => {
      r.rect(A.x, A.y, half, A.h, C.blue);
      r.rect(A.x + half, A.y, half, A.h, C.green);
    });
    r.alpha(OVERLAY_A, () => {
      for (let y = A.y; y < A.y + A.h; y += 6) r.rect(CENTER.x, y, 1, Math.min(3, A.y + A.h - y), pal.accent);
    });
    r.text('<<<<<<< HEAD', 12, 22, { color: C.blue, alpha: OVERLAY_A });
    r.text('>>>>>>> incoming', 308, 166, { color: C.green, align: 'right', alpha: OVERLAY_A });
  }

  // A 0.12 s band every 1.7 s: three strips of the floor shifted sideways, placed by a hash of floor(t * 8).
  function glitchBands(r, t, tint) {
    if (!(t % 1.7 < 0.12)) return;
    const ctx = r.ctx;
    const src = ctx.canvas;
    const seed = Math.floor(t * 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(A.x, A.y, A.w, A.h);
    ctx.clip();
    for (let k = 0; k < 3; k++) {
      const h1 = mix(seed, k + 1);
      const hh = 4 + (h1 % 5);
      const y = A.y + (mix(h1, 7 + k) % (A.h - hh));
      const dx = (h1 >>> 8) & 1 ? 3 : -3;
      if (src) ctx.drawImage(src, A.x, y, A.w, hh, A.x + dx, y, A.w, hh);
      r.alpha(0.12, () => r.rect(A.x, y, A.w, hh, tint));
    }
    ctx.restore();
  }

  // Phase 3: "404" and "?" ghosts that hop to new hashed spots twice a second.
  function ghosts(r, t, tint) {
    const seed = Math.floor(t * 2);
    const words = ['404', '?', '404', '?'];
    for (let k = 0; k < words.length; k++) {
      const h = mix(seed, 31 + k);
      const x = A.x + 12 + (h % (A.w - 70));
      const y = A.y + 10 + (mix(h, 5) % (A.h - 40));
      r.text(words[k], x, y, { color: tint, alpha: 0.18, scale: k % 2 ? 2 : 1 });
    }
  }

  // A bright bar sweeping down the floor for the length of w.glitchT.
  function scanBar(r, w) {
    const k = 1 - clamp(w.glitchT / GLITCH_T, 0, 1);
    const y0 = A.y - SCAN_H + k * (A.h + SCAN_H);
    const top = Math.max(A.y, y0);
    const bot = Math.min(A.y + A.h, y0 + SCAN_H);
    if (bot - top < 1) return;
    r.alpha(0.35, () => {
      r.rect(A.x, top, A.w, bot - top, CB.Pal.C.white);
      r.rect(A.x, bot - 1, A.w, 1, CB.Pal.C.cyan);
    });
  }

  function bossOverlay(r, pal, t, w) {
    const b = w.boss;
    if (!b || b.defeated) return;
    const theme = CB.Arena.bossTheme(b.id, b.phase);
    if (!theme) return;
    const phase = theme.phase;
    switch (theme.overlay) {
      case 'infiniteLoop': loopOverlay(r, pal, t, w, b); break;
      case 'memoryLeakBoss': heapOverlay(r, pal, b); break;
      case 'mergeConflict': conflictOverlay(r, pal); break;
      case 'heisenbug':
        if (phase >= 2) glitchBands(r, num(t, 0), theme.tint);
        if (phase >= 3) ghosts(r, num(t, 0), theme.tint);
        break;
      default: break;
    }
  }

  CB.Arena = {
    // `w` is optional: the title draws the floor without a world. With it the boss overlays and the scan bar are drawn too.
    draw(r, stage, t, w) {
      const pal = paletteOf(stage);
      const layout = layoutFor(stage);
      const img = bakedFor(stage, pal, layout);
      if (img) r.ctx.drawImage(img, 0, 0);
      else paint((x, y, ww, hh, color) => r.rect(x, y, ww, hh, color), pal, layout);
      cursorLine(r, t);
      if (w) bossOverlay(r, pal, t, w);
      if (pal.pulse) pulseWalls(r, pal, t);
      if (w && w.glitchT > 0) scanBar(r, w);
    },

    // A pure lookup: the overlay a boss gets and its signature colour (null for anything else).
    bossTheme(id, phase) {
      if (!Object.prototype.hasOwnProperty.call(THEME_COLOR, id)) return null;
      return { overlay: id, tint: CB.Pal.C[THEME_COLOR[id]], phase: clamp(Math.floor(num(phase, 1)), 1, 3) };
    },

    layout: layoutFor,
    lineNumber,
  };
})(window.CB);
