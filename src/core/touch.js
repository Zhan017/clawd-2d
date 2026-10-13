// Touch controls: a pure pointer state machine for the floating twin sticks and buttons (320x180 coordinates), plus the overlay that draws them.
(function (CB) {
  'use strict';
  const W = CB.W;
  const H = CB.H;
  const STICK_R = 16; // a stick's ring radius: how far the finger can sit from the origin before the origin follows it
  const DEAD_MOVE = 3; // below this the move stick reads as centred
  const DEAD_AIM = 4; // below this the aim stick keeps the last direction
  const HIT_PAD = 6; // buttons accept touches this far outside their drawn edge
  const BUTTONS = Object.freeze({
    dash: Object.freeze({ x: 298, y: 146, r: 12 }),
    compact: Object.freeze({ x: 272, y: 163, r: 10 }),
  });
  const PAUSE = Object.freeze({ x: 296, y: 22, w: 20, h: 18 }); // hit box, in the arena's top-right corner (the HUD strip above is full); the framed "II" sits inside it
  const REST = Object.freeze({
    move: Object.freeze({ x: 40, y: 140 }),
    aim: Object.freeze({ x: 236, y: 140 }),
  }); // where the ghost rings show while a stick is idle
  const ORIGIN_PAD = STICK_R + 2; // a live ring is drawn at least this far inside the screen edge
  const ALPHA_GHOST = 0.18;
  const ALPHA_LIVE = 0.45;

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // Blinks faster than 4 Hz go through Calm mode when it is loaded.
  const blink = (t, hz) => (CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  // ---- state machine ----------------------------------------------------------------------------------------------------

  // Pointer roles: 'menu' (a tap), 'move' / 'aim' (own a stick), 'dash' / 'compact' / 'pause' (a button), 'ignored' (a spare finger, or one that was down when the mode changed).
  function createState() {
    return {
      mode: 'menu',
      ptr: new Map(), // pointer id -> role
      move: null, // { ox, oy, x, y }: origin and finger of the move stick
      aim: null,
      dirX: 0, // the last aim direction, kept after the finger lifts
      dirY: -1,
      dash: false, // edges, consumed by sample()
      compact: false,
      pause: false,
      confirm: false,
      tap: null,
      touched: false, // any touch since the last sample
    };
  }

  // Forgets a pointer and frees the stick it owned. False when the id was not live.
  function release(st, id) {
    const role = st.ptr.get(id);
    if (role === undefined) return false;
    st.ptr.delete(id);
    if (role === 'move') st.move = null;
    else if (role === 'aim') st.aim = null;
    return true;
  }

  function setMode(st, mode) {
    if ((mode !== 'menu' && mode !== 'sticks') || mode === st.mode) return;
    st.mode = mode;
    for (const id of Array.from(st.ptr.keys())) st.ptr.set(id, 'ignored'); // a finger that was down for the old mode must lift before it counts again
    st.move = null;
    st.aim = null;
  }

  const inPause = (x, y) => x >= PAUSE.x - HIT_PAD && x <= PAUSE.x + PAUSE.w + HIT_PAD && y >= PAUSE.y - HIT_PAD && y <= PAUSE.y + PAUSE.h + HIT_PAD;
  const inButton = (x, y, b) => Math.hypot(x - b.x, y - b.y) <= b.r + HIT_PAD;

  // Puts the finger at (x, y): the origin trails it so it never sits further than STICK_R away, and the aim stick remembers its direction.
  function follow(st, which, x, y) {
    const s = st[which];
    let vx = x - s.ox;
    let vy = y - s.oy;
    const len = Math.hypot(vx, vy);
    if (len > STICK_R) {
      const k = (len - STICK_R) / len;
      s.ox += vx * k;
      s.oy += vy * k;
      vx = x - s.ox;
      vy = y - s.oy;
    }
    s.x = x;
    s.y = y;
    if (which === 'aim') {
      const l = Math.hypot(vx, vy);
      if (l >= DEAD_AIM) {
        st.dirX = vx / l;
        st.dirY = vy / l;
      }
    }
  }

  // The origin is exactly where the finger lands, even in the letterbox, so landing never moves or turns anything by itself.
  function grab(st, which, id, x, y) {
    st[which] = { ox: x, oy: y, x, y };
    st.ptr.set(id, which);
  }

  function down(st, id, x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    release(st, id); // a pointer that goes down twice without lifting starts over
    st.touched = true;
    if (st.mode === 'menu') {
      st.ptr.set(id, 'menu');
      st.tap = { x, y };
      st.confirm = true;
    } else if (inPause(x, y)) {
      st.ptr.set(id, 'pause');
      st.pause = true;
    } else if (inButton(x, y, BUTTONS.dash)) {
      st.ptr.set(id, 'dash');
      st.dash = true;
    } else if (inButton(x, y, BUTTONS.compact)) {
      st.ptr.set(id, 'compact');
      st.compact = true;
    } else {
      const which = x < W / 2 ? 'move' : 'aim';
      if (st[which]) st.ptr.set(id, 'ignored');
      else grab(st, which, id, x, y);
    }
  }

  function move(st, id, x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const role = st.ptr.get(id);
    if (role === 'move' || role === 'aim') follow(st, role, x, y);
  }

  // Also the handler for pointercancel.
  function up(st, id) {
    if (release(st, id)) st.touched = true;
  }

  function releaseAll(st) {
    st.ptr.clear();
    st.move = null;
    st.aim = null;
  }

  function sample(st) {
    const sticks = st.mode === 'sticks';
    const out = {
      active: st.touched || st.ptr.size > 0,
      moveX: 0,
      moveY: 0,
      aimDirX: null,
      aimDirY: null,
      fire: false,
      edges: { dash: st.dash, compact: st.compact, pause: st.pause, confirm: st.confirm },
      tap: st.tap,
    };
    if (sticks) {
      const m = st.move;
      if (m) {
        const vx = m.x - m.ox;
        const vy = m.y - m.oy;
        const len = Math.hypot(vx, vy);
        if (len >= DEAD_MOVE) {
          out.moveX = vx / len;
          out.moveY = vy / len;
        }
      }
      out.aimDirX = st.dirX;
      out.aimDirY = st.dirY;
      out.fire = st.aim !== null; // held means firing, so a tap fires along the last direction
    }
    st.dash = st.compact = st.pause = st.confirm = false;
    st.tap = null;
    st.touched = false;
    return out;
  }

  function holds(st, role) {
    for (const r of st.ptr.values()) if (r === role) return true;
    return false;
  }

  const stickView = (s) => (s ? { ox: s.ox, oy: s.oy, x: s.x, y: s.y } : null);

  function view(st) {
    return {
      mode: st.mode,
      move: stickView(st.move),
      aim: stickView(st.aim),
      dashDown: holds(st, 'dash'),
      compactDown: holds(st, 'compact'),
      pauseDown: holds(st, 'pause'),
    };
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------

  // A 1 px circle outline. The renderer has ring(); a plain frame stands in for a renderer without it.
  function ring(r, x, y, rad, color) {
    if (typeof r.ring === 'function') r.ring(x, y, rad, color);
    else r.frame(x - rad, y - rad, 2 * rad + 1, 2 * rad + 1, color);
  }

  // Idle: a faint ring and dot at REST. Live: the ring at the origin and a knob at the finger, held inside the ring.
  // A live ring is drawn clamped on screen (its origin can sit in the letterbox); the knob keeps its offset from the origin.
  function drawStick(r, C, rest, live, color) {
    const cx = live ? clamp(live.ox, ORIGIN_PAD, W - ORIGIN_PAD) : rest.x;
    const cy = live ? clamp(live.oy, ORIGIN_PAD, H - ORIGIN_PAD) : rest.y;
    r.alpha(live ? ALPHA_LIVE : ALPHA_GHOST, () => {
      ring(r, cx, cy, STICK_R + 1, C.ink); // dark outline so the ring reads on any floor
      ring(r, cx, cy, STICK_R, color);
      if (!live) {
        r.disc(cx, cy, 3, color);
        return;
      }
      let vx = live.x - live.ox;
      let vy = live.y - live.oy;
      const len = Math.hypot(vx, vy);
      if (len > STICK_R) {
        vx = (vx * STICK_R) / len;
        vy = (vy * STICK_R) / len;
      }
      const kx = Math.round(cx + vx);
      const ky = Math.round(cy + vy);
      r.disc(kx, ky, 6, C.ink);
      r.disc(kx, ky, 5, color);
      r.rect(kx - 2, ky - 3, 2, 1, C.white); // the shine
    });
  }

  // Cyan like the dash pip; dim while the dash is cooling down.
  function drawDash(r, C, v, ready) {
    const b = BUTTONS.dash;
    const vr = b.r + 1; // one px of margin round the 23 px wide label
    r.alpha(ready ? (v.dashDown ? 0.65 : ALPHA_LIVE) : 0.2, () => {
      r.disc(b.x, b.y, vr, C.ink);
      if (v.dashDown) r.disc(b.x, b.y, vr - 1, C.cyanDark);
      ring(r, b.x, b.y, vr, ready ? C.cyan : C.grey);
    });
    r.text('DASH', b.x, b.y - 3, { align: 'center', color: ready ? C.white : C.grey, alpha: ready ? 0.9 : 0.4 });
  }

  // Fills bottom-up with the context meter (cyan, like the HUD bar); when ready it is gold and the glow pulses.
  function drawCompact(r, C, v, o, t) {
    const b = BUTTONS.compact;
    const ready = !!o.compactReady;
    const frac = ready ? 1 : clamp(num(o.compactFrac, 0), 0, 1);
    const pulse = ready && blink(t, 3);
    r.alpha(v.compactDown ? 0.65 : ALPHA_LIVE, () => {
      r.disc(b.x, b.y, b.r, C.ink);
      ring(r, b.x, b.y, b.r, ready ? C.gold : C.grey);
      if (pulse) ring(r, b.x, b.y, b.r + 1, C.gold);
    });
    const rows = Math.round(frac * (2 * (b.r - 1) + 1)); // the rows inside the ring, counted from the bottom
    if (rows > 0) {
      const inner = b.r - 0.5;
      r.alpha(ready ? (pulse ? 0.8 : 0.55) : ALPHA_LIVE, () => {
        for (let i = 0; i < rows; i++) {
          const dy = b.r - 1 - i;
          const half = Math.floor(Math.sqrt(inner * inner - dy * dy));
          const top = i === rows - 1;
          r.rect(b.x - half, b.y + dy, 2 * half + 1, 1, top ? (ready ? C.white : C.offwhite) : ready ? C.gold : C.cyan);
        }
      });
    }
    r.text('/c', b.x, b.y - 3, { align: 'center', color: ready ? C.ink : C.white, shadow: ready ? undefined : C.ink, alpha: 0.9 });
  }

  // A small framed "II" centred in the hit box.
  function drawPause(r, C, v) {
    const fx = PAUSE.x + Math.round((PAUSE.w - 11) / 2);
    const fy = PAUSE.y + Math.round((PAUSE.h - 11) / 2);
    r.alpha(v.pauseDown ? 0.65 : ALPHA_LIVE, () => {
      r.rect(fx, fy, 11, 11, C.ink);
      if (v.pauseDown) r.rect(fx + 1, fy + 1, 9, 9, C.greyDark);
      r.frame(fx, fy, 11, 11, C.offwhite);
    });
    r.text('II', fx + 2, fy + 2, { color: C.white, alpha: 0.85 });
  }

  // o: { compactFrac: 0..1, compactReady, dashReady } (dashReady defaults to true). A null view draws nothing.
  function draw(r, v, t, o) {
    const C = CB.Pal && CB.Pal.C;
    if (!r || !v || !C) return;
    const opt = o || {};
    const tt = num(t, 0);
    drawStick(r, C, REST.move, v.move, C.offwhite);
    drawStick(r, C, REST.aim, v.aim, C.ember);
    drawDash(r, C, v, opt.dashReady !== false);
    drawCompact(r, C, v, opt, tt);
    drawPause(r, C, v);
  }

  // ---- platform helpers -------------------------------------------------------------------------------------------------

  function isPortrait(win) {
    try {
      const w = win && win.innerWidth;
      const h = win && win.innerHeight;
      return typeof w === 'number' && typeof h === 'number' && h > w;
    } catch (e) {
      return false;
    }
  }

  function swallow(p) {
    if (p && typeof p.then === 'function') p.then(null, () => {});
  }

  function lockLandscape(scr) {
    try {
      const o = scr && scr.orientation;
      if (o && typeof o.lock === 'function') swallow(o.lock('landscape'));
    } catch (e) {
      // no orientation lock here (iOS, desktop): the rotate overlay covers it
    }
  }

  // Asks for fullscreen, then for a landscape lock (Android needs the first for the second). Every step is optional and can fail.
  function requestFullscreen(doc, scr) {
    let pending = null;
    try {
      const el = doc && doc.documentElement;
      if (el && typeof el.requestFullscreen === 'function') pending = el.requestFullscreen({ navigationUI: 'hide' });
    } catch (e) {
      pending = null;
    }
    try {
      if (pending && typeof pending.then === 'function') pending.then(() => lockLandscape(scr), () => lockLandscape(scr));
      else lockLandscape(scr);
    } catch (e) {
      // a broken thenable: nothing more to try
    }
  }

  CB.Touch = {
    STICK_R, DEAD_MOVE, DEAD_AIM, HIT_PAD, BUTTONS, PAUSE, REST,
    createState, setMode, down, move, up, sample, releaseAll, view, draw, isPortrait, requestFullscreen,
  };
})(window.CB);
