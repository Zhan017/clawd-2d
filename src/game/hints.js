// First-run hints: four one-time tips (dash, /compact, perfect dash, the Heisenbug's moths) in a small framed banner under the HUD strip. Optional module: the play scene guards every call on `if (CB.Hints)`.
// Presentation only: it reads the step's events and the world, never writes to them, and draws with no clock and no random source.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const KEYS = { dash: 'hintDash', compact: 'hintCompact', perfect: 'hintPerfect', look: 'hintLook' }; // hint id -> CB.Prompts key
  const LIVE = { wave: true, boss: true }; // the only states a hint is shown in
  const SHOW_T = 3.0; // seconds a hint stays up; it counts the play scene's steps, so a pause (no steps) freezes it
  const FADE_IN = 0.25;
  const FADE_OUT = 0.5;
  const GAP_T = 0.4; // quiet time between one hint and the next
  const NEAR = 48; // px: an enemy bullet this close to Clawd and heading at her calls for the dash hint
  const LOOK_AT = 2.6; // seconds into the Heisenbug fight, if no moth has clinked by then
  const OPTIMIZED = '<optimized out>'; // the text a bolt that hits a ghost moth pops (heisenbug.js)
  // The banner sits on the first rows of the arena (y 20 and down), centred. It stays clear of the HUD strip above (hearts, boss name and bar y 1-15,
  // wave text y 5), the touch pause button (x 296-316, y 22-40: the widest string's box ends at x 273) and the wave banner (y 40).
  // It gives way to the /compact banner (y 22) by not drawing while that shows. It never blinks, so calm mode has nothing to slow: it only fades.
  const BOX_Y = 21;
  const BOX_H = 13; // 1 px frame, 2 px air, the 7 px glyphs, 2 px air, 1 px frame
  const PAD_X = 4; // 1 px frame and 3 px air either side of the text
  const BOX_ALPHA = 0.8;

  let lastRun = null; // the run the state below belongs to: a new run starts clean
  let queue = []; // ids waiting for their turn, in the order they were asked for
  let cur = null; // { id, t }: the hint on show and how long it has been up
  let gapT = 0;
  let session = []; // ids seen this session, for when CB.Save is missing

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // The seen ids live in one array under 'hints'. Storage can hold anything, so reads are validated and writes always replace the array.
  function seenList() {
    if (!(CB.Save && typeof CB.Save.get === 'function')) return session;
    const v = CB.Save.get('hints', []);
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  }

  const isSeen = (id) => seenList().indexOf(id) >= 0;

  function markSeen(id) {
    const list = seenList();
    if (list.indexOf(id) >= 0) return;
    const next = list.concat([id]);
    if (CB.Save && typeof CB.Save.set === 'function') CB.Save.set('hints', next);
    else session = next;
  }

  // The hint's line for the device in use; '' when CB.Prompts is missing (then there is nothing to show).
  const textOf = (id) => (CB.Prompts && typeof CB.Prompts.text === 'function' ? CB.Prompts.text(KEYS[id]) : '');

  // A hint can be asked for when it is not already waiting, unseen and has text to show (the cheap check first: this runs every step).
  const canWant = (id) => queue.indexOf(id) < 0 && !isSeen(id) && !!textOf(id);

  function want(id) {
    if (canWant(id)) queue.push(id);
  }

  // The player did the thing the hint teaches: it is retired for good, and dropped if it is on show or waiting.
  function done(id) {
    markSeen(id);
    const at = queue.indexOf(id);
    if (at >= 0) queue.splice(at, 1);
    if (cur && cur.id === id) {
      cur = null;
      gapT = GAP_T;
    }
  }

  // A new run (the play scene's run object) forgets the last run's queue and the hint on show; what was seen stays seen.
  function sync(run) {
    if (run === lastRun) return;
    lastRun = run;
    queue = [];
    cur = null;
    gapT = 0;
  }

  // An enemy bullet inside NEAR px of Clawd whose velocity points at her.
  function bulletNear(w) {
    const p = w.player;
    if (!p || !Array.isArray(w.eBullets)) return false;
    for (const b of w.eBullets) {
      if (!b || b.dead) continue;
      const dx = p.x - b.x;
      const dy = p.y - b.y;
      if (dx * dx + dy * dy <= NEAR * NEAR && b.vx * dx + b.vy * dy > 0) return true;
    }
    return false;
  }

  // The Heisenbug fight is on: the boss says so (its controller's id), or the stage does (a stand-in boss on its stage still counts).
  const isHeisenbug = (w) => !!w.boss && !w.boss.defeated && (w.boss.id === 'heisenbug' || (!!w.stage && w.stage.boss === 'heisenbug'));

  // Counts one step on the hint on show and, when the slot is free, starts the next one. Only a hint that starts is marked seen.
  // While the /compact banner hides the hint its clock waits, so the hint is not used up unseen.
  function advance(w) {
    const dt = CB.DT || 1 / 60;
    if (cur) {
      if (!(num(w.compactBannerT, 0) > 0)) cur.t += dt;
      if (cur.t >= SHOW_T) {
        cur = null;
        gapT = GAP_T;
      }
    } else if (gapT > 0) gapT = Math.max(0, gapT - dt);
    if (!cur && gapT <= 0 && queue.length) {
      const id = queue.shift();
      markSeen(id);
      cur = { id, t: 0 };
    }
  }

  const Hints = {
    IDS: Object.keys(KEYS),
    SHOW_T, NEAR, LOOK_AT, BOX_Y, BOX_H,

    // After each play step: `evs` are the step's events, `run` the run, `game` the host (its debug.active silences every hint).
    // Triggers are noted in any state, but a hint only starts (and only counts down) in the wave and boss states.
    onEvents(evs, run, game) {
      if (!run || !run.world) return;
      sync(run);
      if (game && game.debug && game.debug.active) return;
      for (const e of Array.isArray(evs) ? evs : []) {
        if (!e) continue;
        if (e.type === 'compactReady') want('compact');
        else if (e.type === 'graze' && e.perfect === true) want('perfect');
        else if (e.type === 'text' && e.text === OPTIMIZED) want('look');
        else if (e.type === 'dash') done('dash'); // she already knows how
        else if (e.type === 'compact') done('compact');
      }
      if (LIVE[run.state] !== true) return;
      const w = run.world;
      if (!(w.player && w.player.dead)) {
        if (canWant('dash') && bulletNear(w)) queue.push('dash');
        if (run.state === 'boss' && num(run.stateT, 0) >= LOOK_AT && isHeisenbug(w) && canWant('look')) queue.push('look');
      }
      advance(w);
    },

    // The banner's box for a line of text: centred, with the font's width. `r` is only used for its measure.
    box(text, r) {
      const tw = r && typeof r.measure === 'function' ? r.measure(text, 1) : CB.Font.measure(text, 1);
      const w = tw + 2 * PAD_X;
      return { x: Math.round((CB.W - w) / 2), y: BOX_Y, w, h: BOX_H, textX: Math.round((CB.W - w) / 2) + PAD_X, textY: BOX_Y + 3 };
    },

    // After the HUD, before the overlays. `run` defaults to the last run onEvents saw. Nothing while paused: the play scene does not call it then.
    draw(r, t, run) {
      const rn = run || lastRun;
      if (!cur || !rn || LIVE[rn.state] !== true) return;
      const w = rn.world;
      if (w && num(w.compactBannerT, 0) > 0) return; // the /compact banner owns this row while it shows
      const text = textOf(cur.id);
      if (!text) return;
      const a = clamp(Math.min(cur.t / FADE_IN, (SHOW_T - cur.t) / FADE_OUT), 0, 1);
      if (a <= 0) return;
      const b = Hints.box(text, r);
      r.alpha(a * BOX_ALPHA, () => r.rect(b.x, b.y, b.w, b.h, C.ink));
      r.alpha(a, () => {
        r.frame(b.x, b.y, b.w, b.h, C.gold);
        r.text(text, b.textX, b.textY, { color: C.gold });
      });
    },

    // The hint on show ({ id, t }) or null, and the ids waiting. For tests and the debug console.
    current() {
      return cur ? { id: cur.id, t: cur.t } : null;
    },

    pending() {
      return queue.slice();
    },

    // Forgets the queue and the hint on show (not what was seen).
    reset() {
      lastRun = null;
      queue = [];
      cur = null;
      gapT = 0;
    },
  };
  CB.Hints = Hints;
})(window.CB);
