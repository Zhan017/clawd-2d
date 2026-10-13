// The Heisenbug, "The Observer Effect": only what you look at is real. Moths you stare at turn to stone and take damage; the ones you do not are ghosts that hunt you.
(function (CB) {
  'use strict';
  const M = CB.M;
  const C = CB.Pal.C;
  const TAU = Math.PI * 2;
  const EPS = 1e-9; // timers are sums of 1/60 steps: 0.6 s can land on 0.5999999999999999
  const CX = 160; // the arena centre: where the three moths merge
  const CY = 96;

  // Tuning knobs, in the order to turn them when the sim gates fail: pincer, nova counts, strain, lash charges, the phase 3 reflect rate, then HP.
  const PINCER = true; // phase 2: a lunge starts a second one 0.3 s later from the other flank
  const NOVA_N = [8, 16]; // bullets per overload nova: moths, giant
  const STRAIN_FULL = [22, 26]; // damage a stone moth (an awake giant) takes before it overloads
  const LASH_CHARGE = [14, 11]; // damage dealt per lash, phase 1 and phase 2 (the spec's 11 and 8, raised so the base-kit stage-4 gate keeps a margin)
  const REFLECT_DMG = 2.4; // phase 3: damage dealt per pair of reflected sparks
  const MAX_HP = 340;
  const PHASE2_HP = Math.round(0.6 * MAX_HP); // a phase begins strictly below its threshold and never reverts
  const PHASE3_HP = Math.round(0.25 * MAX_HP);
  const PHASE_INVULN = 0.5;
  const BODY_R = 9;
  const GIANT_R = 2 * BODY_R; // the merged moth: drawn at exactly 2x, hitbox to match
  const SPAWN_GRACE = 0.5; // a new or jumped moth does no contact for this long
  const SPAWN_INVULN = 0.5; // the third moth cannot be hurt for this long
  const START_QUIET = 2.6; // nothing attacks before this
  const CANDIDATES = [{ x: 60, y: 60 }, { x: 260, y: 60 }, { x: 60, y: 140 }, { x: 260, y: 140 }]; // the two farthest from Clawd are the pair

  // Looking: the ray from Clawd through the aim point, whatever drives the aim.
  const LOOK_R = 14; // a moth ahead of Clawd and this close to the ray is looked at...
  const LOOK_KEEP_R = 20; // ...and stays looked at inside this
  const LOOK_NEAR = 6; // an aim point this close to Clawd has no direction: the point rule applies
  const LOOK_GRACE = 0.35; // bolts already in flight still land this long after the ray leaves
  const GIANT_GRACE = 0.3;

  // The hunt: a wave creeps toward Clawd, parks 50 px away, slides off the aim ray and keeps off its sisters.
  const CREEP_FROM = 22;
  const CREEP_TO = [44, 55]; // px/s after CREEP_RAMP s as a wave; phase 2 is faster
  const CREEP_RAMP = 4;
  const PARK = 50;
  const FLANK = (70 * Math.PI) / 180; // a wave stays at least this far off the aim ray, as seen from Clawd
  const SLIDE = 55; // px/s it can sidestep the ray at
  const APART = 60; // loose moths keep this far from each other
  const APART_PUSH = 60;

  // Strain: damage dealt to a stone moth fills its ring; a full ring is a white-out, a nova and a jump.
  const STRAIN_COOL = [3.5, 4]; // per second while unobserved (moth), asleep (giant)
  const STRAIN_WARN = 0.7; // the eye turns red here
  const WHITE_T = 0.25;
  const NOVA_GAP = (45 * Math.PI) / 180; // centred on Clawd
  const NOVA_CLEAR = 10; // the gap is widened when Clawd is so close that 45 degrees would be narrower than this
  const NOVA_SPEED = 75;
  const JUMP_MARGIN = 24;
  const JUMP_MIN = 80; // a jump or a split lands at least this far from Clawd
  const DAZZLE_T = 1.0;
  const SHIELD_3 = 1.2;

  // Lashes: damage dealt charges them, a quiet player still gets one every 4.5 s.
  const LASH_IDLE = 4.5;
  const LUNGE_RANGE = 90;
  const TELL_T = 0.6;
  const DASH_T = 0.22;
  const DASH_SPEED = 250;
  const LUNGE_LEN = DASH_SPEED * DASH_T; // 55 px
  const REST_T = 0.6;
  const PINCER_LAG = 0.3;
  const RIPPLE_SLOTS = 12;
  const RIPPLE_GAPS = [0, 4, 8]; // slot 0 points at Clawd
  const RIPPLE_SPEED = 75;

  // Phase 3: the three moths fold into one giant and the law inverts (awake and solid only while looked at).
  const MERGE_T = 0.5;
  const REFLECT_SPEED = 75;
  const REFLECT_TURN = 0.35; // rad per pair
  const GIANT_LUNGE_DMG = 14;
  const FINISH_T = 0.9;
  const FLOOR_HP = 0.01; // the last blow leaves this much

  const POP_EVERY = 1.6; // the "<optimized out>" hint
  const FRAME_T = 0.08;
  const FLUTTER = [0, 1, 2, 1]; // sprite frames in order: open, half, closed, half
  const RING_DOTS = 16;
  const GHOST_T = 0.3; // afterimage life
  const WAVE_ALPHA = 0.55;
  const RIPPLE_RING_T = 1.2;

  // 16x14 moth seen from above, symmetric: pale wings with a gold eyespot each (it watches back), a banded grey body and red eyes.
  // Three frames of wing flutter: open, half closed, nearly closed. Every edge of every wing carries the ink outline.
  const FRAME_2 = [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '...kkkrSSrkkk...',
    '..kwekRSSRkewk..',
    '..kWqekSSkeqWk..',
    '..kWkekSSkekWk..',
    '..kWqekSSkeqWk..',
    '...kWeksskeWk...',
    '....kekSSkek....',
    '...kWeksskeWk...',
    '...ksekSSkesk...',
    '....kkksskkk....',
    '.......kk.......',
  ];
  CB.Art.defineSprite('heisenbug_0', [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '.kkkkkrSSrkkkkk.',
    'kwWWekRSSRkeWWwk',
    'kWYqYekSSkeYqYWk',
    'kWqkqekSSkeqkqWk',
    'kWYqYekSSkeYqYWk',
    '.kWWWeksskeWWWk.',
    '..kkWekSSkeWkk..',
    '.kssWeksskeWssk.',
    '.kSsWekSSkeWsSk.',
    '..kkkkksskkkkk..',
    '.......kk.......',
  ]);
  CB.Art.defineSprite('heisenbug_1', [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '..kkkkrSSrkkkk..',
    '.kwWekRSSRkeWwk.',
    '.kWYqekSSkeqYWk.',
    '.kWqkekSSkekqWk.',
    '.kWYqekSSkeqYWk.',
    '..kWWeksskeWWk..',
    '...kWekSSkeWk...',
    '..ksWeksskeWsk..',
    '..kSWekSSkeWSk..',
    '...kkkksskkkk...',
    '.......kk.......',
  ]);
  CB.Art.defineSprite('heisenbug_2', FRAME_2);
  // The same wings folded and carved in grey: the observed moth (and the sleeping giant). The red head and the gold eyespots go dull.
  const STONE = { w: 'e', W: 's', e: 's', Y: 'S', q: 'S', r: 'S', R: 'S' };
  CB.Art.defineSprite('heisenStone_0', FRAME_2.map((row) => row.replace(/[wWeYqrR]/g, (ch) => STONE[ch])));
  // The chromatic copies: the same shapes in one flat colour, drawn offset to either side of the moth. The ghost wears cyan and yellow:
  // pink is the enemy-bullet colour on the red prod stage, so the magenta copy stays defined but is never drawn there.
  for (let i = 0; i < 3; i++) {
    CB.Art.defineTint('heisenbug_cyan_' + i, 'heisenbug_' + i, C.cyan);
    CB.Art.defineTint('heisenbug_mag_' + i, 'heisenbug_' + i, C.magenta);
    CB.Art.defineTint('heisenbug_yel_' + i, 'heisenbug_' + i, C.yellow);
  }
  // The eye that hangs over the strain ring: cyan while it counts, red (in a white lid with an ink outline) once the ring is 70% full.
  CB.Art.defineSprite('heisenEye_0', ['..kkkkk..', '.kwwwwwk.', 'kwcCkCcwk', '.kwwwwwk.', '..kkkkk..']);
  CB.Art.defineSprite('heisenEye_1', ['..kkkkk..', '.kwwwwwk.', 'kwrRkRrwk', '.kwwwwwk.', '..kkkkk..']);

  // Blink flicker goes through Comfort, which slows anything faster than 4 Hz in calm mode.
  const blink = (t, hz) => (CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  const ctrlOf = new WeakMap(); // moth -> its controller, so a moth's own onHit can reach the shared pool

  const mothData = () => ({
    look: false, grace: 0, obs: false, // looked at this tick / seconds of grace left / looked at or in grace
    strain: 0, over: 0, // strain ring (damage) / seconds of white-out left
    dazzle: 0, wave: 0, // seconds ignoring the gaze / seconds spent as a wave (the creep speeds up)
    lunge: null, pincer: 0, born: 0, giant: false, // the lunge in progress / seconds until a pincer lunge / seconds of newborn tear
  });

  // The moth: a boss part that takes damage into one shared pool (c.body.hp, mirrored into every moth) and only while it is looked at.
  CB.Enemies.heisenbug = {
    create(w, x, y) {
      return CB.makeEnemy('heisenbug', x, y, { hp: MAX_HP, r: BODY_R, boss: true, regular: false, contact: false, noContactT: SPAWN_GRACE, data: mothData() });
    },

    update() {}, // the controller moves, hunts and shoots it

    // `src` is the player bolt (it has dmg) or the /compact wave ({ compact: true }); a direct call has none and always applies.
    onHit(e, w, dmg, src) {
      const c = ctrlOf.get(e);
      if (!c) {
        e.hp -= dmg;
        return dmg;
      }
      if (c.finish) return 0; // the last blow has landed: nothing counts any more
      if (src && (!e.data.obs || c.merge)) {
        w.emit('clink', { x: e.x, y: e.y }); // a ghost, a sleeping giant or a dazzled moth: it bounces off
        if (w.time - c.popAt >= POP_EVERY - EPS) {
          c.popAt = w.time;
          const half = textHalf('<optimized out>');
          w.emit('text', { x: M.clamp(e.x, 4 + half, CB.W - 4 - half), y: e.y - e.r - 8, text: '<optimized out>', color: C.grey });
        }
        return 0;
      }
      const b = c.body;
      b.hp -= dmg;
      if (src) {
        c.charge += dmg;
        e.data.strain += dmg;
        if (c.giant) {
          c.reflectAcc += dmg;
          c.lungeAcc += dmg;
        }
      }
      if (b.hp <= 0) beginFinish(c, w);
      mirror(c);
      return dmg;
    },

    draw(e, r, t) {
      drawMoth(e, r, t == null ? e.t : t, ctrlOf.get(e));
    },
  };

  function textHalf(s) {
    const F = CB.Font;
    return (F && typeof F.measure === 'function' ? F.measure(s, 1) : s.length * 6) / 2;
  }

  // ---- drawing -----------------------------------------------------------------------------------------------------------------

  // 16 dots on a circle of radius `rad`, the first `lit` of them in cyan; the rest are a faint grey.
  function ringDots(r, x, y, rad, lit, color) {
    const dot = (i, col) => {
      const a = -Math.PI / 2 + (i * TAU) / RING_DOTS;
      r.rect(x + Math.cos(a) * rad - 1, y + Math.sin(a) * rad - 1, 2, 2, col);
    };
    r.alpha(0.4, () => {
      for (let i = lit; i < RING_DOTS; i++) dot(i, C.grey);
    });
    for (let i = 0; i < lit; i++) dot(i, color);
  }

  // Everything a moth can look like. `c` is its controller (null for a moth spawned on its own).
  function drawMoth(e, r, tt, c) {
    const d = e.data || mothData();
    const s = d.giant ? 2 : 1;
    const finishing = !!(c && c.finish);
    const merging = !!(c && c.merge);
    let a = e.alpha == null ? 1 : e.alpha;
    if (e.invuln > 0 && !blink(tt, 14)) a *= 0.6; // a shield flickers: the phase change, a newborn, the giant's rest
    // stone: grey, still, harmless. white: the held white-out. awake: the giant that is being looked at. wave: the ghost.
    let look = 'wave';
    if (finishing) look = 'stone';
    else if (d.over > 0) look = 'white';
    else if (d.giant) look = d.obs ? 'awake' : 'stone';
    else if (!merging && d.obs) look = 'stone';
    const frame = FLUTTER[Math.floor(tt / FRAME_T) % FLUTTER.length];
    const hover = look === 'wave' || look === 'awake' ? Math.round(Math.sin(tt * 4 + e.x)) : 0; // stone does not bob
    const y = e.y + hover;
    const flash = e.hitFlash > 0;
    r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
    const lunge = d.lunge;
    const body = () => {
      if (look === 'wave') {
        const dash = lunge && lunge.stage === 'dash';
        const wa = dash ? 1 : WAVE_ALPHA;
        const off = (d.born > 0 ? 4 : 3) * s; // a strong RGB split; a newborn tears wider
        const ripple = (tt / RIPPLE_RING_T) % 1;
        for (let i = 0; i < 2; i++) {
          const k = (ripple + i * 0.5) % 1;
          r.alpha(0.45 * (1 - k) * a, () => r.ring(e.x, e.y, Math.round((4 + 12 * k) * s), C.pale));
        }
        r.sprite('heisenbug_cyan_' + frame, e.x - off, y, { alpha: 0.5 * a, scale: s });
        r.sprite('heisenbug_yel_' + frame, e.x + off, y, { alpha: 0.5 * a, scale: s });
        r.sprite('heisenbug_' + frame, e.x, y, { alpha: wa * a, scale: s });
        if (d.dazzle > 0) {
          for (let i = 0; i < 3; i++) {
            const an = tt * 5 + (i * TAU) / 3; // three dots circling its head: dazed
            r.rect(e.x + Math.cos(an) * 7 - 1, e.y - e.r - 5 + Math.sin(an) * 2, 2, 2, C.gold);
          }
        }
        if (d.born > 0) r.alpha(0.7 * a, () => r.rect(e.x - 10 * s, Math.round(e.y), 20 * s, 1, C.white)); // the tear it split along
      } else if (look === 'awake') {
        const off = 3 * s / 2 + 1;
        r.sprite('heisenbug_cyan_' + frame, e.x - off, y, { alpha: 0.5 * a, scale: s });
        r.sprite('heisenbug_yel_' + frame, e.x + off, y, { alpha: 0.5 * a, scale: s });
        r.sprite('heisenbug_' + frame, e.x, y, { alpha: a, scale: s, white: flash });
      } else {
        r.sprite('heisenStone_0', e.x, y, { alpha: a, scale: s, white: look === 'white' || flash });
      }
    };
    if (lunge && lunge.stage === 'tell') r.squash(e.x, e.y + e.r, 1.2, 0.78, body); // the crouch before a lunge
    else body();

    const ringR = e.r + 5;
    const full = STRAIN_FULL[d.giant ? 1 : 0];
    const frac = M.clamp(d.strain / full, 0, 1);
    const asleep = d.giant && look === 'stone'; // a sleeping giant shows its ring only while it cools, and has no eye open
    if (!finishing && (look === 'white' || look === 'awake' || (look === 'stone' && (!d.giant || d.strain > 0)))) {
      ringDots(r, e.x, e.y, ringR, Math.min(RING_DOTS, Math.floor(RING_DOTS * frac)), C.cyan);
      if (!asleep) r.sprite(frac >= STRAIN_WARN ? 'heisenEye_1' : 'heisenEye_0', e.x, e.y - ringR - 7);
    }
    if (asleep && !finishing && d.strain <= 0) {
      // a sleeping giant: a "z" drifting up from its shut eyes, a shape and not a colour
      const k = (tt * 0.8) % 1;
      r.alpha(1 - k, () => r.text('z', e.x + 8 + Math.round(k * 4), e.y - e.r - 5 - Math.round(k * 6), { color: C.pale, shadow: C.ink }));
    }
  }

  // A dotted line of 2 px dots every 5 px that marches along it, each on a 4 px ink square so it reads on any floor.
  function dotted(r, x1, y1, x2, y2, march) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (!(len > 0)) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    for (let s = march % 5; s <= len; s += 5) {
      const x = Math.round(x1 + ux * s);
      const y = Math.round(y1 + uy * s);
      r.rect(x - 1, y - 1, 4, 4, C.ink);
      r.rect(x, y, 2, 2, C.white);
    }
  }

  // The faint tether from Clawd to a moth it is looking at: 1 px cyan dots every 4 px.
  function tether(r, p, m) {
    const len = Math.hypot(m.x - p.x, m.y - p.y);
    const end = len - (m.r + 5);
    if (!(end > 12)) return;
    const ux = (m.x - p.x) / len;
    const uy = (m.y - p.y) / len;
    r.alpha(0.6, () => {
      for (let s = 10; s < end; s += 4) r.rect(Math.round(p.x + ux * s), Math.round(p.y + uy * s), 1, 1, C.cyan);
    });
  }

  // The ghosts of the three bosses it is built from, folding into the centre while the moths merge. Draw-only; each one only if its sprite exists.
  const CAMEOS = [{ sprite: 'loopHead_0', x: 40, y: 50 }, { sprite: 'leakBoss_0', x: 280, y: 60 }, { sprite: 'conflictHead_0', x: 40, y: 150 }];

  // The overlay the controller draws on top of the moths: tethers, lunge tells, afterimages, the merge cameos and the last-blow ring.
  function drawOverlay(c, w, r, t) {
    const tt = Number.isFinite(t) ? t : w.time;
    const p = w.player;
    if (c.defeated) return;
    for (const m of c.moths) {
      if (m.dead) continue;
      const d = m.data;
      if (d.obs && !c.finish && !d.over) tether(r, p, m);
      const L = d.lunge;
      if (L && L.stage === 'tell') {
        const k = M.clamp(L.t / TELL_T, 0, 1);
        dotted(r, L.sx, L.sy, L.tx, L.ty, Math.floor(tt * 20));
        const rad = Math.round((8 + 5 * (1 - k)) * (m.r / BODY_R)); // the landing ring tightens as the lunge nears; the giant's is twice as wide
        r.ring(L.tx, L.ty, rad + 1, C.ink);
        r.ring(L.tx, L.ty, rad, C.white);
        r.rect(L.tx - 1, L.ty - 1, 2, 2, C.white);
      }
    }
    for (const g of c.ghosts) {
      const k = M.clamp(g.t / GHOST_T, 0, 1);
      r.sprite('heisenbug_cyan_0', g.x, g.y, { alpha: 0.5 * k, scale: g.s });
      r.alpha(0.5 * k, () => r.ring(g.x, g.y, Math.round((4 + 10 * (1 - k)) * g.s), C.cyan));
    }
    if (c.merge) {
      const k = M.clamp(c.merge.t / MERGE_T, 0, 1);
      for (const cm of CAMEOS) {
        if (!CB.Art.hasSprite(cm.sprite)) continue;
        r.sprite(cm.sprite, M.lerp(cm.x, CX, k), M.lerp(cm.y, CY, k), { alpha: 0.5 });
      }
    }
    if (c.finish) {
      const k = M.clamp(c.finish.t / FINISH_T, 0, 1);
      const b = c.body;
      const rad = Math.round((1 - k) * 44 + b.r * 0.5);
      r.ring(b.x, b.y, rad + 1, C.ink);
      r.ring(b.x, b.y, rad, C.gold);
      if (rad > 6) r.alpha(0.5, () => r.ring(b.x, b.y, rad - 3, C.gold));
    }
  }

  // ---- gaze --------------------------------------------------------------------------------------------------------------------

  // Is moth m looked at? The ray from Clawd through the aim point (a mouse point, a stick's aim point or a touch point): the moth has to
  // be ahead of Clawd and within 14 px of the ray, or 20 px once it is already looked at. An aim point almost on Clawd has no direction,
  // so the point rule applies there.
  function looking(p, m, keep) {
    const R = keep ? LOOK_KEEP_R : LOOK_R;
    const dx = p.aimX - p.x;
    const dy = p.aimY - p.y;
    const len = Math.hypot(dx, dy);
    if (!(len >= LOOK_NEAR)) return M.dist(p.aimX, p.aimY, m.x, m.y) <= R;
    const vx = m.x - p.x;
    const vy = m.y - p.y;
    if (vx * dx + vy * dy <= 0) return false;
    return Math.abs(vx * dy - vy * dx) / len <= R;
  }

  function gaze(c, w, m, dt) {
    const d = m.data;
    if (d.dazzle > 0) {
      d.dazzle = Math.max(0, d.dazzle - dt); // a dazzled moth ignores the gaze, and is immune because it counts as unobserved
      d.look = false;
      d.grace = 0;
      d.obs = false;
      return;
    }
    d.look = looking(w.player, m, d.look);
    if (d.look) d.grace = c.giant ? GIANT_GRACE : LOOK_GRACE;
    else d.grace = Math.max(0, d.grace - dt);
    d.obs = d.look || d.grace > EPS;
  }

  // ---- the pool ----------------------------------------------------------------------------------------------------------------

  // c.body.hp is the authority; every moth carries the same number.
  function mirror(c) {
    const hp = c.body.hp;
    for (const m of c.moths) m.hp = hp;
    c.hp = Math.max(0, hp);
  }

  // The pool is empty: HP floors just above 0, every moth goes to stone and the controller closes the bug ~0.9 s later.
  function beginFinish(c, w) {
    const b = c.body;
    b.hp = FLOOR_HP;
    c.finish = { t: 0 };
    c.observing = false;
    for (const m of c.moths) {
      cancelLunge(m);
      m.data.over = 0;
      m.data.pincer = 0;
    }
    w.emit('text', { x: M.clamp(b.x, 4 + textHalf('REPRODUCED'), CB.W - 4 - textHalf('REPRODUCED')), y: b.y - b.r - 12, text: 'REPRODUCED', color: C.gold });
  }

  // ---- attacks -----------------------------------------------------------------------------------------------------------------

  const full = (c) => STRAIN_FULL[c.giant ? 1 : 0];

  // Bullets are fired from here; the cap can return null and nothing depends on a bullet existing.
  function fire(w, x, y, a, speed) {
    return w.fireEnemyBullet(x, y, a, speed);
  }

  // `n` bullets around a 45 degree gap centred on Clawd. Close up the gap widens so Clawd's 5 px body still fits through it.
  function nova(w, m, n) {
    const p = w.player;
    const a = Math.atan2(p.y - m.y, p.x - m.x);
    const dist = M.dist(m.x, m.y, p.x, p.y);
    const half = Math.max(NOVA_GAP / 2, Math.asin(Math.min(1, NOVA_CLEAR / Math.max(dist, 1e-6))));
    const span = TAU - 2 * half;
    for (let i = 0; i < n; i++) fire(w, m.x, m.y, a + half + (span * i) / (n - 1), NOVA_SPEED);
    w.emit('enemyShoot', { x: m.x, y: m.y });
  }

  // 12 slots, 3 gaps (9 bullets): slot 0 points at Clawd, so the lane to her is open.
  function ripple(w, m) {
    const p = w.player;
    const a = Math.atan2(p.y - m.y, p.x - m.x);
    for (let i = 0; i < RIPPLE_SLOTS; i++) if (RIPPLE_GAPS.indexOf(i) < 0) fire(w, m.x, m.y, a + (i * TAU) / RIPPLE_SLOTS, RIPPLE_SPEED);
    w.emit('enemyShoot', { x: m.x, y: m.y });
  }

  // One opposite pair of "your own sparks coming back", turning 0.35 rad per pair.
  function reflect(c, w, m) {
    fire(w, m.x, m.y, c.spiral, REFLECT_SPEED);
    fire(w, m.x, m.y, c.spiral + Math.PI, REFLECT_SPEED);
    c.spiral += REFLECT_TURN;
    w.emit('enemyShoot', { x: m.x, y: m.y });
  }

  // The landing for a jump or a split: at least 80 px from Clawd, and clear of the other moths when a few tries find room.
  function farSpot(c, w, m) {
    let spot = null;
    for (let i = 0; i < 4; i++) {
      spot = w.randomPoint(m.r + 15, JUMP_MIN);
      let clear = true;
      for (const o of c.moths) if (o !== m && !o.dead && M.dist(spot.x, spot.y, o.x, o.y) < 40) clear = false;
      if (clear && M.dist(spot.x, spot.y, w.player.x, w.player.y) >= JUMP_MIN) break;
    }
    return spot;
  }

  // The moth leaves an afterimage and lands somewhere far from Clawd, with a "!?" and a glitch burst. It does no contact for a moment.
  function jump(c, w, m) {
    const from = { x: m.x, y: m.y };
    const to = farSpot(c, w, m);
    c.ghosts.push({ x: from.x, y: from.y, t: GHOST_T, s: m.data.giant ? 2 : 1 });
    m.x = to.x;
    m.y = to.y;
    m.noContactT = Math.max(m.noContactT, SPAWN_GRACE);
    w.emit('teleport', { x: from.x, y: from.y, x2: to.x, y2: to.y });
    w.emit('text', { x: from.x, y: from.y - m.r - 6, text: '!?', color: C.cyan });
    if (w.glitchT < 0.2) w.glitchT = 0.2;
  }

  function cancelLunge(m) {
    m.data.lunge = null;
    m.contact = false;
  }

  const idle = (m) => !m.dead && !m.data.obs && m.data.dazzle <= 0 && !m.data.lunge && m.data.over <= 0 && m.data.born <= 0;

  // Locks the heading on Clawd's position right now: crouch for 0.6 s (a dotted line and a landing ring), dash 55 px, rest for 0.6 s.
  // In phase 2 the nearest other idle wave within 90 px follows with its own tell 0.3 s later.
  function startLunge(c, w, m, lead) {
    const p = w.player;
    const h = M.norm(p.x - m.x, p.y - m.y);
    const dir = h.x === 0 && h.y === 0 ? { x: 1, y: 0 } : h;
    const to = { x: m.x + dir.x * LUNGE_LEN, y: m.y + dir.y * LUNGE_LEN, r: m.r };
    M.clampToArena(to, w.arena);
    m.data.lunge = { stage: 'tell', t: 0, sx: m.x, sy: m.y, tx: to.x, ty: to.y };
    w.emit('beamCharge', { x: m.x, y: m.y, x1: m.x, y1: m.y, x2: to.x, y2: to.y });
    if (!(lead && PINCER && c.phase >= 2)) return;
    let other = null;
    let best = LUNGE_RANGE;
    for (const o of c.moths) {
      if (o === m || !idle(o)) continue;
      const dd = M.dist(o.x, o.y, p.x, p.y);
      if (dd <= best) {
        best = dd;
        other = o;
      }
    }
    if (other) other.data.pincer = PINCER_LAG;
  }

  function lungeStep(m, dt) {
    const L = m.data.lunge;
    L.t += dt;
    if (L.stage === 'tell') {
      if (L.t >= TELL_T - EPS) {
        L.stage = 'dash';
        L.t = 0;
      }
    } else if (L.stage === 'dash') {
      const k = Math.min(1, L.t / DASH_T);
      m.x = M.lerp(L.sx, L.tx, k);
      m.y = M.lerp(L.sy, L.ty, k);
      if (L.t >= DASH_T - EPS) {
        m.x = L.tx;
        m.y = L.ty;
        L.stage = 'rest';
        L.t = 0;
      } else m.contact = true; // the only time a moth can hurt by touch: while it is still dashing
    } else if (L.t >= REST_T - EPS) m.data.lunge = null;
  }

  // The nearest idle wave lashes: a lunge if it is within 90 px of Clawd, a ripple otherwise. False when no wave is free.
  function lash(c, w) {
    const p = w.player;
    let pick = null;
    let best = Infinity;
    for (const m of c.moths) {
      if (!idle(m)) continue;
      const dd = M.dist(m.x, m.y, p.x, p.y);
      if (dd < best) {
        best = dd;
        pick = m;
      }
    }
    if (!pick) return false;
    if (best <= LUNGE_RANGE) startLunge(c, w, pick, true);
    else ripple(w, pick);
    c.charge = 0;
    c.lashIdle = 0;
    return true;
  }

  // ---- moving ------------------------------------------------------------------------------------------------------------------

  // A wave creeps toward Clawd (faster the longer it stays a wave), parks 50 px out, sidesteps the aim ray to stay 70 degrees off it and
  // keeps 60 px from the other moths.
  function hunt(c, w, m, dt) {
    const d = m.data;
    const p = w.player;
    d.wave += dt;
    const top = CREEP_TO[c.phase >= 2 ? 1 : 0];
    const creep = CREEP_FROM + (top - CREEP_FROM) * Math.min(1, d.wave / CREEP_RAMP);
    const rad = M.dist(m.x, m.y, p.x, p.y);
    const phi = rad > 1e-6 ? Math.atan2(m.y - p.y, m.x - p.x) : 0;
    const nr = rad > PARK ? Math.max(PARK, rad - creep * dt) : rad;
    let nphi = phi;
    const dx = p.aimX - p.x;
    const dy = p.aimY - p.y;
    if (Math.hypot(dx, dy) >= LOOK_NEAR) {
      const rel = M.wrapAngle(phi - Math.atan2(dy, dx));
      if (Math.abs(rel) < FLANK) nphi = phi + (rel < 0 ? -1 : 1) * Math.min((SLIDE * dt) / Math.max(nr, 20), FLANK - Math.abs(rel));
    }
    m.x = p.x + Math.cos(nphi) * nr;
    m.y = p.y + Math.sin(nphi) * nr;
    for (const o of c.moths) {
      if (o === m || o.dead) continue;
      const gap = M.dist(m.x, m.y, o.x, o.y);
      if (gap >= APART) continue;
      const push = Math.min(APART - gap, APART_PUSH * dt);
      if (gap > 1e-6) {
        m.x += ((m.x - o.x) / gap) * push;
        m.y += ((m.y - o.y) / gap) * push;
      } else m.x += push;
    }
    M.clampToArena(m, w.arena);
  }

  // ---- one moth, one tick ------------------------------------------------------------------------------------------------------

  // The white-out is held for 0.25 s, then the nova, the jump and the dazzle (the giant gets a 1.2 s shield instead).
  function overStep(c, w, m, dt) {
    const d = m.data;
    d.over -= dt;
    if (d.over > EPS) return;
    d.over = 0;
    nova(w, m, NOVA_N[c.giant ? 1 : 0]);
    jump(c, w, m);
    d.strain = 0;
    d.look = false;
    d.grace = 0;
    d.obs = false;
    if (c.giant) m.invuln = Math.max(m.invuln, SHIELD_3);
    else d.dazzle = DAZZLE_T;
  }

  // A full ring starts the white-out, but not so early that the nova would land inside the quiet first 2.6 s.
  const overload = (c, d) => d.strain >= full(c) - EPS && c.age >= START_QUIET - WHITE_T - EPS;

  // Phases 1 and 2. Looked at: stone, frozen, harmless, the only thing that takes damage. Not looked at: a ghost that hunts.
  function mothStep(c, w, m, dt) {
    const d = m.data;
    d.born = Math.max(0, d.born - dt);
    m.contact = false;
    if (d.over > 0) overStep(c, w, m, dt);
    else if (overload(c, d)) {
      d.over = WHITE_T;
      cancelLunge(m);
    } else if (d.obs) {
      if (d.lunge) cancelLunge(m); // looking at a moth freezes it, and that cancels a lunge
      d.pincer = 0;
      d.wave = 0;
    } else {
      d.strain = Math.max(0, d.strain - STRAIN_COOL[0] * dt);
      if (d.lunge) lungeStep(m, dt);
      else {
        if (d.pincer > 0) {
          d.pincer -= dt;
          if (d.pincer <= EPS) {
            d.pincer = 0;
            if (idle(m) && M.dist(m.x, m.y, w.player.x, w.player.y) <= LUNGE_RANGE) startLunge(c, w, m, false);
          }
        }
        if (!d.lunge) hunt(c, w, m, dt);
      }
    }
  }

  // Phase 3. The giant is awake and solid only while looked at; unobserved it sleeps (harmless, immune). Looking provokes it, by damage.
  function giantStep(c, w, dt) {
    const m = c.body;
    const d = m.data;
    m.contact = false;
    if (d.over > 0) overStep(c, w, m, dt);
    else if (overload(c, d)) {
      d.over = WHITE_T;
      cancelLunge(m);
    } else if (!d.obs) {
      if (d.lunge) cancelLunge(m); // looking away is the panic button
      d.strain = Math.max(0, d.strain - STRAIN_COOL[1] * dt);
    } else {
      for (let i = 0; i < 8 && c.reflectAcc >= REFLECT_DMG - EPS; i++) {
        c.reflectAcc -= REFLECT_DMG;
        reflect(c, w, m);
      }
      if (d.lunge) lungeStep(m, dt);
      else if (c.lungeAcc >= GIANT_LUNGE_DMG - EPS) {
        c.lungeAcc -= GIANT_LUNGE_DMG;
        startLunge(c, w, m, false);
      }
    }
  }

  // ---- phases ------------------------------------------------------------------------------------------------------------------

  // The third moth splits off with a chromatic tear and lands at least 80 px from Clawd: newborn, harmless, and it cannot be hurt for 0.5 s.
  function split(c, w) {
    const b = c.body;
    const spot = w.randomPoint(JUMP_MARGIN, JUMP_MIN);
    const m = w.spawnEnemy('heisenbug', spot.x, spot.y); // null at the enemy cap: the split is skipped
    if (!m) return;
    ctrlOf.set(m, c);
    m.hp = b.hp;
    m.invuln = SPAWN_INVULN;
    m.noContactT = Math.max(m.noContactT, SPAWN_GRACE);
    m.data.born = SPAWN_INVULN;
    c.moths.push(m);
    w.emit('teleport', { x: b.x, y: b.y, x2: spot.x, y2: spot.y });
  }

  // All three moths slide to the arena centre inside the phase shield.
  function startMerge(c) {
    c.merge = { t: 0, from: c.moths.map((m) => ({ m, x: m.x, y: m.y })) };
    c.observing = false;
    for (const m of c.moths) {
      const d = m.data;
      cancelLunge(m);
      d.strain = 0;
      d.over = 0;
      d.dazzle = 0;
      d.pincer = 0;
      d.look = false;
      d.grace = 0;
      d.obs = false;
      m.invuln = Math.max(m.invuln, MERGE_T);
    }
  }

  function mergeStep(c, w, dt) {
    const g = c.merge;
    g.t += dt;
    const k = Math.min(1, g.t / MERGE_T);
    for (const f of g.from) {
      f.m.x = M.lerp(f.x, CX, k);
      f.m.y = M.lerp(f.y, CY, k);
    }
    if (g.t < MERGE_T - EPS) return;
    const b = c.body;
    for (const m of c.moths) if (m !== b && !m.dead) w.killEnemy(m, true); // folded into the giant
    c.moths = [b];
    c.merge = null;
    c.giant = true;
    c.radius = GIANT_R;
    c.spiral = w.rng.angle();
    b.r = GIANT_R;
    b.x = CX;
    b.y = CY;
    b.data.giant = true;
  }

  function enterPhase(c, w, n) {
    const b = c.body;
    c.phase = n;
    w.emit('bossPhase', { x: b.x, y: b.y, phase: n });
    w.addShake(4);
    b.invuln = Math.max(b.invuln, PHASE_INVULN);
    c.charge = 0; // every timer starts over: the first lash of a phase is a full wait away
    c.lashIdle = 0;
    if (n === 2) split(c, w);
    else if (n === 3) startMerge(c);
  }

  // The body died (or the last blow's beat is over): the controller is done. Parts keep their last x, y (deathPoints reads them).
  function defeat(c, w) {
    c.defeated = true;
    c.hp = 0;
    c.observing = false;
    c.merge = null;
    for (const m of c.moths) {
      cancelLunge(m);
      if (m !== c.body && !m.dead) w.killEnemy(m, true);
    }
  }

  function update(c, w, dt) {
    if (c.defeated) return;
    const b = c.body;
    if (b.dead) {
      defeat(c, w);
      return;
    }
    c.moths = c.moths.filter((m) => !m.dead);
    c.age += dt;
    const was = new Map(c.moths.map((m) => [m, { x: m.x, y: m.y }]));
    mirror(c);
    for (const g of c.ghosts) g.t -= dt;
    c.ghosts = c.ghosts.filter((g) => g.t > 0);
    if (c.finish) {
      c.finish.t += dt;
      if (c.finish.t >= FINISH_T - EPS) {
        w.killEnemy(b); // the existing slow motion, blasts and BUG FIXED card take over from here
        defeat(c, w);
      }
    } else if (c.merge) mergeStep(c, w, dt);
    else {
      for (const m of c.moths) gaze(c, w, m, dt);
      c.observing = c.moths.some((m) => m.data.look);
      if (c.giant) giantStep(c, w, dt);
      else {
        for (const m of c.moths) mothStep(c, w, m, dt);
        c.lashIdle += dt;
        const need = LASH_CHARGE[c.phase >= 2 ? 1 : 0];
        if (c.age >= START_QUIET - EPS && (c.charge >= need - EPS || c.lashIdle >= LASH_IDLE - EPS)) lash(c, w);
      }
      // Phases are checked last, so a new phase's timers first count down on the next tick.
      const target = c.hp < PHASE3_HP ? 3 : c.hp < PHASE2_HP ? 2 : 1;
      while (c.phase < target && !c.finish) enterPhase(c, w, c.phase + 1); // one hit across both thresholds applies 1 -> 2 -> 3
    }
    c.x = b.x;
    c.y = b.y;
    // Rule 7: the velocity it really moved at. A jump or a lunge is one big step.
    for (const m of c.moths) {
      const o = was.get(m);
      m.vx = o && dt > 0 ? (m.x - o.x) / dt : 0;
      m.vy = o && dt > 0 ? (m.y - o.y) / dt : 0;
    }
  }

  CB.Bosses.heisenbug = {
    id: 'heisenbug',
    name: 'THE HEISENBUG',
    tagline: 'works on my machine',
    commitMsg: 'fix: cannot reproduce (closed)',
    file: 'repro.js',
    diff: ['- // works on my machine', '+ // works on every machine', '+ // (probably)'],
    portrait: 'heisenbug_0',

    // The body, then 6 points on a ring around it. The body keeps its x, y when dead, so this still works after defeat.
    deathPoints(c) {
      const b = c && c.body;
      const x = b && M.isFiniteNum(b.x) ? b.x : CB.W / 2;
      const y = b && M.isFiniteNum(b.y) ? b.y : CB.H / 2;
      const ring = b && b.data && b.data.giant ? 26 : 14;
      const pts = [{ x, y }];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 6;
        pts.push({ x: x + Math.cos(a) * ring, y: y + Math.sin(a) * ring });
      }
      return pts;
    },

    create(w) {
      const p = w.player;
      const order = CANDIDATES.map((s, i) => ({ s, i, d: M.dist2(s.x, s.y, p.x, p.y) })).sort((a, b) => b.d - a.d || a.i - b.i); // farthest first, the first listed wins ties
      const moths = [];
      for (let k = 0; k < 2; k++) {
        const s = order[k].s;
        let m = w.spawnEnemy('heisenbug', s.x, s.y);
        if (!m) {
          // The enemy cap is full, but the boss has to exist.
          m = CB.Enemies.heisenbug.create(w, s.x, s.y);
          m.kind = 'heisenbug';
          w.enemies.push(m);
        }
        moths.push(m);
      }
      const c = {
        id: 'heisenbug',
        x: moths[0].x,
        y: moths[0].y,
        hp: MAX_HP,
        maxHp: MAX_HP,
        phase: 1,
        defeated: false,
        radius: 12, // where Fx puts the phase quip
        body: moths[0],
        moths,
        age: 0, // fight time, for the quiet start
        charge: 0, // damage dealt since the last lash
        lashIdle: 0,
        popAt: -Infinity,
        giant: false,
        merge: null,
        finish: null,
        reflectAcc: 0,
        lungeAcc: 0,
        spiral: 0,
        observing: false, // some moth is being looked at: the HUD tints the crosshair
        ghosts: [], // afterimages, draw only
        update: (world, dt) => update(c, world, dt),
        draw: (r, t) => drawOverlay(c, w, r, t),
      };
      for (const m of moths) ctrlOf.set(m, c);
      return c;
    },
  };
})(window.CB);
