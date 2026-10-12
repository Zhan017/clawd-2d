// Scene transition: ink that dithers away over the new scene, with a typed terminal label. Optional module: every caller guards `if (CB.Transition)`.
(function (CB) {
  'use strict';
  // Seconds. Solid ink to `solid`, then the dither reveals the scene until `revealEnd`; the label bar lingers to `total`.
  // Typing is 0.03 s a character, but a long label is sped up so it is always complete by `typeBy`, before the bar fades.
  const T = Object.freeze({ solid: 0.1, revealEnd: 0.4, total: 0.6, calmTotal: 0.25, perChar: 0.03, typeBy: 0.5, fade: 0.1 });
  const BLOCK = 8;
  const COLS = Math.ceil(CB.W / BLOCK); // 40
  const ROWS = Math.ceil(CB.H / BLOCK); // 23: the last row is half a block, clipped by the screen
  const BAR = Object.freeze({ y: 160, h: 14, alpha: 0.85, textX: 8, textY: 163 });

  // Each block is uncovered at its own moment: KEY[i] in 0..999, and a block is revealed once KEY < p * 1000.
  const KEY = new Uint16Array(COLS * ROWS);
  for (let by = 0; by < ROWS; by++) {
    for (let bx = 0; bx < COLS; bx++) KEY[by * COLS + bx] = (((bx * 73856093) ^ (by * 19349663)) >>> 0) % 1000;
  }

  const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN becomes 0
  const state = { on: false, t: 0, label: '', calm: false };
  const length = () => (state.calm ? T.calmTotal : T.total);

  // Reveal fraction: 0 while the screen is solid ink, 1 once the new scene is fully uncovered (and while idle).
  function progress() {
    if (!state.on) return 1;
    if (state.calm) return clamp01(state.t / T.calmTotal);
    return clamp01((state.t - T.solid) / (T.revealEnd - T.solid));
  }

  // The blocks still covered at reveal fraction p, as { bx, by } on the 40 x 23 grid.
  function cells(p) {
    const q = clamp01(p) * 1000;
    const out = [];
    for (let by = 0; by < ROWS; by++) {
      for (let bx = 0; bx < COLS; bx++) if (!(KEY[by * COLS + bx] < q)) out.push({ bx, by });
    }
    return out;
  }

  // Ink over the covered blocks, one rect per horizontal run.
  function cover(r, p) {
    const q = p * 1000;
    const ink = CB.Pal.C.ink;
    for (let by = 0; by < ROWS; by++) {
      const y = by * BLOCK;
      const h = Math.min(BLOCK, CB.H - y);
      let run = -1;
      for (let bx = 0; bx <= COLS; bx++) {
        const covered = bx < COLS && !(KEY[by * COLS + bx] < q);
        if (covered) {
          if (run < 0) run = bx;
        } else if (run >= 0) {
          r.rect(run * BLOCK, y, (bx - run) * BLOCK, h, ink);
          run = -1;
        }
      }
    }
  }

  // The terminal bar along the bottom: the label typed out, the whole bar fading over its last 0.1 s.
  function bar(r) {
    const fade = clamp01((T.total - state.t) / T.fade);
    if (fade <= 0) return;
    const len = state.label.length;
    const per = Math.min(T.perChar, T.typeBy / Math.max(1, len));
    const n = Math.min(len, Math.floor(state.t / per + 1e-6));
    r.alpha(fade, () => {
      r.alpha(BAR.alpha, () => r.rect(0, BAR.y, CB.W, BAR.h, CB.Pal.C.ink));
      if (n > 0) r.text(state.label.slice(0, n), BAR.textX, BAR.textY, { color: CB.Pal.C.green });
    });
  }

  const Transition = {
    T,

    // Begins a wipe over whatever is on screen. Calm mode is read now, so a wipe keeps its length once begun.
    start(label) {
      state.on = true;
      state.t = 0;
      state.label = String(label == null ? '' : label);
      state.calm = !!(CB.Comfort && CB.Comfort.calm && CB.Comfort.calm());
    },

    update(dt) {
      if (!state.on) return;
      state.t += dt;
      if (state.t >= length()) state.on = false;
    },

    active: () => state.on,
    progress,
    cells,

    // Drawn last, over the scene. Calm mode is a plain 0.25 s fade of ink with no label.
    draw(r) {
      if (!state.on) return;
      if (state.calm) {
        r.alpha(1 - progress(), () => r.rect(0, 0, CB.W, CB.H, CB.Pal.C.ink));
        return;
      }
      const p = progress();
      if (p <= 0) r.rect(0, 0, CB.W, CB.H, CB.Pal.C.ink);
      else if (p < 1) cover(r, p);
      bar(r);
    },
  };
  CB.Transition = Transition;
})(window.CB);
