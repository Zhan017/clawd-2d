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
  const ALPHA_GHOST = 0.3;
  const ALPHA_LIVE = 0.45;
  const TAP_TICKS = 10; // a finger on the aim half is a tap while it has been down at most this many sim ticks (10 / 60 s, under 180 ms)
  const TAP_PX = 6; // and has moved less than this from where it landed
  const SHOT_TICKS = 7; // a lifted tap keeps firing at its point this long (7 / 60 s, about 120 ms), so even a very quick tap lands a shot
  const MIN_BAR = 40; // each side bar must be this wide (game px) before the controls move into the bars
  const MIN_USABLE = 22; // and this wide once the notch side (safe-area inset) is taken off
  const KNOB_R = 6;
  const LABELS = Object.freeze({ move: 'MOVE', aim: 'AIM + FIRE' }); // shown on a ghost ring until that stick has been used once

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
      pos: new Map(), // pointer id -> { x, y }: where each finger is now, so a mode change can pick it up as a stick
      layout: null, // see layoutFor(); null is the in-arena layout
      tick: 0, // sample() calls so far: the clock of the tap window (sim ticks, so the state machine reads no clock)
      shot: null, // { x, y, left }: a lifted tap that is still firing at its point
      move: null, // { ox, oy, x, y, sx, sy, t0, travel }: origin and finger of the move stick, and where and when it landed
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
    st.pos.delete(id);
    if (role === 'move') st.move = null;
    else if (role === 'aim') st.aim = null;
    return true;
  }

  // Going to the sticks (back from a menu or a pause) picks up every finger still down as a fresh stick at the finger's own spot, so a thumb
  // resting on the screen is never dead. Going to a menu, a finger that was steering must lift before it counts as a tap.
  function setMode(st, mode) {
    if ((mode !== 'menu' && mode !== 'sticks') || mode === st.mode) return;
    st.mode = mode;
    st.move = null;
    st.aim = null;
    st.shot = null;
    for (const id of Array.from(st.ptr.keys())) {
      const p = st.pos.get(id);
      if (mode === 'sticks' && p) {
        const which = p.x < W / 2 ? 'move' : 'aim';
        if (st[which]) st.ptr.set(id, 'ignored');
        else grab(st, which, id, p.x, p.y, false);
      } else st.ptr.set(id, 'ignored');
    }
  }

  const inPause = (x, y, P) => x >= P.x - HIT_PAD && x <= P.x + P.w + HIT_PAD && y >= P.y - HIT_PAD && y <= P.y + P.h + HIT_PAD;
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
    const d = Math.hypot(x - s.sx, y - s.sy);
    if (d > s.travel) s.travel = d;
    if (which === 'aim') {
      const l = Math.hypot(vx, vy);
      if (l >= DEAD_AIM) {
        st.dirX = vx / l;
        st.dirY = vy / l;
      }
    }
  }

  // The origin is exactly where the finger lands, even in the letterbox, so landing never moves or turns anything by itself.
  // `fresh` false (a finger picked up by a mode change, not one that just landed) can never count as a tap.
  // The arena floor in game px: a tap there is a shot at that point.
  function onField(x, y) {
    const A = CB.ARENA || { x: 8, y: 20, w: 304, h: 152 };
    return x >= A.x && x <= A.x + A.w && y >= A.y && y <= A.y + A.h;
  }

  function grab(st, which, id, x, y, fresh) {
    st[which] = { ox: x, oy: y, x, y, sx: x, sy: y, t0: fresh === false ? -Infinity : st.tick, travel: 0, field: onField(x, y) };
    st.ptr.set(id, which);
    if (which === 'aim') st.shot = null;
  }

  function down(st, id, x, y) {
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    release(st, id); // a pointer that goes down twice without lifting starts over
    st.touched = true;
    st.pos.set(id, { x, y });
    const L = st.layout || DEFAULT_LAYOUT;
    if (st.mode === 'menu') {
      st.ptr.set(id, 'menu');
      st.tap = { x, y };
      st.confirm = true;
    } else if (inPause(x, y, L.pause)) {
      st.ptr.set(id, 'pause');
      st.pause = true;
    } else if (inButton(x, y, L.dash)) {
      st.ptr.set(id, 'dash');
      st.dash = true;
    } else if (inButton(x, y, L.compact)) {
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
    const p = st.pos.get(id);
    if (p) {
      p.x = x;
      p.y = y;
    }
    if (role === 'move' || role === 'aim') follow(st, role, x, y);
  }

  // A short, still touch on the aim half is a tap: it fires at its point, as a mouse click would.
  function up(st, id) {
    const s = st.ptr.get(id) === 'aim' ? st.aim : null;
    if (s && isTap(st, s, TAP_TICKS + 1)) st.shot = { x: s.x, y: s.y, left: SHOT_TICKS };
    if (release(st, id)) st.touched = true;
  }

  // A cancelled touch (the system took it) is no tap.
  function cancel(st, id) {
    if (release(st, id)) st.touched = true;
  }

  function releaseAll(st) {
    st.ptr.clear();
    st.pos.clear();
    st.move = null;
    st.aim = null;
    st.shot = null;
  }

  // Down for fewer than `ticks` sim ticks and moved less than TAP_PX since landing.
  // Only a finger that lands on the arena itself is a tap at a point; one landing in a side bar or the HUD strip (a resting aim thumb) steers.
  const isTap = (st, s, ticks) => s.field !== false && st.tick - s.t0 < ticks && s.travel < TAP_PX;

  function sample(st) {
    const sticks = st.mode === 'sticks';
    const out = {
      active: st.touched || st.ptr.size > 0,
      moveX: 0,
      moveY: 0,
      aimDirX: null,
      aimDirY: null,
      aimAt: null, // { x, y }: aim at this point, with no direction (a tap), while it is set
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
      const a = st.aim;
      if (a && isTap(st, a, TAP_TICKS)) {
        // Still a possible tap: shoot at the finger's own point until it has moved or stayed down long enough to be a stick.
        out.aimAt = { x: a.x, y: a.y };
        out.fire = true;
      } else if (!a && st.shot) {
        out.aimAt = { x: st.shot.x, y: st.shot.y };
        out.fire = true;
        if (--st.shot.left <= 0) st.shot = null;
      } else {
        out.aimDirX = st.dirX;
        out.aimDirY = st.dirY;
        out.fire = a !== null; // held means firing along the stick
      }
    }
    st.tick++;
    st.dash = st.compact = st.pause = st.confirm = false;
    st.tap = null;
    st.touched = false;
    return out;
  }

  function holds(st, role) {
    for (const r of st.ptr.values()) if (r === role) return true;
    return false;
  }

  function setLayout(st, L) {
    st.layout = L && L.dash && L.compact && L.pause ? L : null;
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

  // ---- layout -----------------------------------------------------------------------------------------------------------

  // Where everything sits and is hit. The default is the in-arena layout above. On a wide phone the black side bars are where thumbs rest, so
  // the controls move there: move on the left; aim, /c, DASH and II on the right, II on top. `m` is the renderer's metrics(): the visible
  // canvas in game px (x0..x1, y0..y1, so x0 is negative when there is a bar on the left) and the safe-area insets in game px.
  // Each side keeps clear of the notch and the home indicator. Screens without bars (16:9) keep the default.
  const DEFAULT_LAYOUT = Object.freeze({
    bars: false,
    rest: REST,
    dash: BUTTONS.dash,
    compact: BUTTONS.compact,
    pause: PAUSE,
    span: Object.freeze({ move: Object.freeze({ lo: 2, hi: W - 2 }), aim: Object.freeze({ lo: 2, hi: W - 2 }) }), // the x range a label may use
  });

  let layoutKey = '';
  let layoutOut = DEFAULT_LAYOUT;

  // The x centre of something `half` px wide each way inside [lo, hi]: the middle of the bar, or hugging the outer edge when the bar is too narrow.
  function centre(lo, hi, half, outer) {
    if (hi - lo >= 2 * half + 2) return Math.round((lo + hi) / 2);
    return Math.round(outer < 0 ? lo + half + 1 : hi - half - 1);
  }

  function layoutFor(m) {
    if (!m || typeof m.x0 !== 'number' || typeof m.x1 !== 'number') return DEFAULT_LAYOUT;
    const s = m.safe || {};
    const sl = num(s.l, 0);
    const sr = num(s.r, 0);
    const st = num(s.t, 0);
    const sb = num(s.b, 0);
    const y0 = num(m.y0, 0);
    const y1 = num(m.y1, H);
    const key = [m.x0, m.x1, y0, y1, sl, sr, st, sb].map((v) => Math.round(v * 8)).join(',');
    if (key === layoutKey) return layoutOut;
    layoutKey = key;
    const leftLo = m.x0 + sl;
    const rightHi = m.x1 - sr;
    if (-m.x0 < MIN_BAR || m.x1 - W < MIN_BAR || 0 - leftLo < MIN_USABLE || rightHi - W < MIN_USABLE) {
      layoutOut = DEFAULT_LAYOUT;
      return layoutOut;
    }
    const top = Math.max(0, y0 + st);
    const bottom = Math.min(H, y1 - sb);
    const ringY = Math.round(bottom - 28);
    const half = STICK_R + 1;
    const bx = centre(W, rightHi, 13, 1);
    layoutOut = Object.freeze({
      bars: true,
      rest: Object.freeze({
        move: Object.freeze({ x: centre(leftLo, 0, half, -1), y: ringY }),
        aim: Object.freeze({ x: centre(W, rightHi, half, 1), y: ringY }),
      }),
      pause: Object.freeze({ x: bx - PAUSE.w / 2, y: Math.round(top + 3), w: PAUSE.w, h: PAUSE.h }),
      compact: Object.freeze({ x: bx, y: Math.round(top + 50), r: BUTTONS.compact.r }),
      dash: Object.freeze({ x: bx, y: Math.round(top + 88), r: BUTTONS.dash.r }),
      span: Object.freeze({ move: Object.freeze({ lo: leftLo, hi: 0 }), aim: Object.freeze({ lo: W, hi: rightHi }) }),
    });
    return layoutOut;
  }

  // ---- first-run labels -------------------------------------------------------------------------------------------------------

  // Each stick carries its label until it has been used once; that is kept with CB.Save (touchTaught) when it exists, else for the session.
  const taught = { move: false, aim: false };
  let taughtLoaded = false;

  function loadTaught() {
    if (taughtLoaded || !CB.Save || typeof CB.Save.get !== 'function') return;
    taughtLoaded = true;
    try {
      const v = CB.Save.get('touchTaught', null);
      if (v && typeof v === 'object') {
        if (v.move === true) taught.move = true;
        if (v.aim === true) taught.aim = true;
      }
    } catch (e) {
      // a storage that throws just shows the labels again
    }
  }

  function noteUsed(v) {
    loadTaught();
    let changed = false;
    for (const k of ['move', 'aim']) {
      if (v[k] && !taught[k]) {
        taught[k] = true;
        changed = true;
      }
    }
    if (!changed) return;
    try {
      if (CB.Save && typeof CB.Save.set === 'function') CB.Save.set('touchTaught', { move: taught.move, aim: taught.aim });
    } catch (e) {
      // not saved: the label comes back next visit
    }
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------

  // A 1 px circle outline. The renderer has ring(); a plain frame stands in for a renderer without it.
  function ring(r, x, y, rad, color) {
    if (typeof r.ring === 'function') r.ring(x, y, rad, color);
    else r.frame(x - rad, y - rad, 2 * rad + 1, 2 * rad + 1, color);
  }

  const textW = (r, s) => (typeof r.measure === 'function' ? r.measure(s, 1) : s.length * 6);

  // The first-run label above a ghost ring. It pulses (1 Hz), and is steady in calm mode. A label wider than the room splits into two lines.
  function drawLabel(r, C, text, cx, cy, span, t) {
    const calm = CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm();
    const a = calm ? 0.85 : 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI));
    const lines = textW(r, text) + 8 <= span.hi - span.lo ? [text] : text.split(' + ').map((p, i, all) => (i < all.length - 1 ? p + ' +' : p));
    const top = cy - STICK_R - 3 - 8 * lines.length;
    lines.forEach((ln, i) => {
      const w = textW(r, ln);
      const x = clamp(Math.round(cx - w / 2), Math.ceil(span.lo), Math.max(Math.ceil(span.lo), Math.floor(span.hi - w)));
      r.text(ln, x, top + 8 * i, { color: C.white, shadow: C.ink, alpha: a });
    });
  }

  // The faint idle ring and dot, and the label while it is still to be learned.
  function drawGhost(r, C, which, rest, span, color, t) {
    r.alpha(ALPHA_GHOST, () => {
      ring(r, rest.x, rest.y, STICK_R + 1, C.ink); // dark outline so the ring reads on any floor
      ring(r, rest.x, rest.y, STICK_R, color);
      r.disc(rest.x, rest.y, 3, color);
    });
    if (!taught[which]) drawLabel(r, C, LABELS[which], rest.x, rest.y, span, t);
  }

  // The ring sits exactly at the origin the finger landed on, and the knob at the finger, held inside the ring.
  function drawLive(r, C, live, color) {
    const cx = live.ox;
    const cy = live.oy;
    r.alpha(ALPHA_LIVE, () => {
      ring(r, cx, cy, STICK_R + 1, C.ink);
      ring(r, cx, cy, STICK_R, color);
      let vx = live.x - live.ox;
      let vy = live.y - live.oy;
      const len = Math.hypot(vx, vy);
      if (len > STICK_R) {
        vx = (vx * STICK_R) / len;
        vy = (vy * STICK_R) / len;
      }
      const kx = Math.round(cx + vx);
      const ky = Math.round(cy + vy);
      r.disc(kx, ky, KNOB_R, C.ink);
      r.disc(kx, ky, KNOB_R - 1, color);
      r.rect(kx - 2, ky - 3, 2, 1, C.white); // the shine
    });
  }

  // Does a live stick lie wholly inside the 320x180 buffer? If not (a thumb in the letterbox or a side bar) it is drawn in the full-resolution pass.
  const inBuffer = (s) => s.ox - STICK_R - KNOB_R - 1 >= 0 && s.ox + STICK_R + KNOB_R + 1 <= W && s.oy - STICK_R - KNOB_R - 1 >= 0 && s.oy + STICK_R + KNOB_R + 1 <= H;

  // Cyan like the dash pip; dim while the dash is cooling down.
  function drawDash(r, C, v, ready, b) {
    const vr = b.r + 1; // one px of margin round the 23 px wide label
    r.alpha(ready ? (v.dashDown ? 0.65 : ALPHA_LIVE) : 0.2, () => {
      r.disc(b.x, b.y, vr, C.ink);
      if (v.dashDown) r.disc(b.x, b.y, vr - 1, C.cyanDark);
      ring(r, b.x, b.y, vr, ready ? C.cyan : C.grey);
    });
    r.text('DASH', b.x, b.y - 3, { align: 'center', color: ready ? C.white : C.grey, alpha: ready ? 0.9 : 0.4 });
  }

  // Fills bottom-up with the context meter (cyan, like the HUD bar); when ready it is gold and the glow pulses.
  function drawCompact(r, C, v, o, t, b) {
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
  function drawPause(r, C, v, P) {
    const fx = P.x + Math.round((P.w - 11) / 2);
    const fy = P.y + Math.round((P.h - 11) / 2);
    r.alpha(v.pauseDown ? 0.65 : ALPHA_LIVE, () => {
      r.rect(fx, fy, 11, 11, C.ink);
      if (v.pauseDown) r.rect(fx + 1, fy + 1, 9, 9, C.greyDark);
      r.frame(fx, fy, 11, 11, C.offwhite);
    });
    r.text('II', fx + 2, fy + 2, { color: C.white, alpha: 0.85 });
  }

  // o: { compactFrac: 0..1, compactReady, dashReady } (dashReady defaults to true). A null view draws nothing.
  // The layout comes from the renderer's metrics() (the same function the input uses for hit areas). With side bars, the whole overlay goes
  // into the renderer's full-resolution pass (overlay()), which can draw outside the 320x180 buffer; a live stick outside the buffer does too.
  function draw(r, v, t, o) {
    const C = CB.Pal && CB.Pal.C;
    if (!r || !v || !C) return;
    const opt = o || {};
    const tt = num(t, 0);
    noteUsed(v);
    const L = layoutFor(typeof r.metrics === 'function' ? r.metrics() : null);
    const later = typeof r.overlay === 'function' ? (fn) => r.overlay(fn) : (fn) => fn(r);
    const now = (fn) => fn(r);
    const fixed = (rr) => {
      if (!v.move) drawGhost(rr, C, 'move', L.rest.move, L.span.move, C.offwhite, tt);
      if (!v.aim) drawGhost(rr, C, 'aim', L.rest.aim, L.span.aim, C.ember, tt);
      drawDash(rr, C, v, opt.dashReady !== false, L.dash);
      drawCompact(rr, C, v, opt, tt, L.compact);
      drawPause(rr, C, v, L.pause);
    };
    (L.bars ? later : now)(fixed);
    if (v.move) (inBuffer(v.move) ? now : later)((rr) => drawLive(rr, C, v.move, C.offwhite));
    if (v.aim) (inBuffer(v.aim) ? now : later)((rr) => drawLive(rr, C, v.aim, C.ember));
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
    STICK_R, DEAD_MOVE, DEAD_AIM, HIT_PAD, BUTTONS, PAUSE, REST, TAP_TICKS, TAP_PX, SHOT_TICKS,
    createState, setMode, setLayout, layoutFor, down, move, up, cancel, sample, releaseAll, view, draw, isPortrait, requestFullscreen,
  };
})(window.CB);
