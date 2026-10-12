// NullPointer: pale moth that wanders, vanishes, reappears 50-60 px from Clawd inside a tightening dashed ring, then lunges.
(function (CB) {
  'use strict';
  const M = CB.M;
  const EPS = 1e-9; // stateT is a sum of 1/60 steps: 90 of them can land on 1.4999999999999998
  const DUR = { wander: 1.5, vanish: 0.8, appear: 0.5, lunge: 0.4 };
  const NEXT = { wander: 'vanish', vanish: 'appear', appear: 'lunge', lunge: 'wander' };
  const WANDER_SPEED = 30;
  const LUNGE_SPEED = 130;
  const TURN_EVERY = 0.5; // a new random wander heading
  const APPEAR_MIN = 50;
  const APPEAR_MAX = 60;
  const RING_FROM = 12;
  const RING_TO = 5; // the moth's own radius
  const RING_DASHES = 6;
  const RING_ARC = Math.PI / 6; // each dash covers 30 degrees, then a 30 degree gap
  const RING_SPIN = 5; // rad/s
  const FRAME_T = 0.15;

  // 12x10 moth seen from above: pale wings with white leading edges, grey shading and an eyespot each, a dark body, two antennae.
  // Frame 0 holds the wings flat, frame 1 lifts the tips; the ink outline closes the silhouette against light floor blocks.
  CB.Art.defineSprite('nullPointer_0', [
    '..k......k..',
    '...k.kk.k...',
    '....kWWk....',
    '..kkkSSkkk..',
    '.kWWkSSkWWk.',
    'kWWeWSSWeWWk',
    'kWeSeSSeSeWk',
    '.kseeSSeesk.',
    '..kksSSskk..',
    '....kkkk....',
  ]);
  CB.Art.defineSprite('nullPointer_1', [
    '..k......k..',
    '...k.kk.k...',
    '....kWWk....',
    '.kk.kSSk.kk.',
    'kWWkkSSkkWWk',
    'kWeWWSSWWeWk',
    '.keSeSSeSek.',
    '..kseSSesk..',
    '...ksSSsk...',
    '....kkkk....',
  ]);

  // Moves by (vx, vy) * dt, stays in the arena and publishes the velocity it really had (a wall zeroes the pushed-in part).
  // dt already carries an elite's timeScale, so the published value is per real second.
  function move(e, w, vx, vy, dt) {
    const x0 = e.x;
    const y0 = e.y;
    e.x += vx * dt;
    e.y += vy * dt;
    M.clampToArena(e, w.arena);
    const ts = e.timeScale || 1;
    e.vx = dt > 0 ? ((e.x - x0) / dt) * ts : 0;
    e.vy = dt > 0 ? ((e.y - y0) / dt) * ts : 0;
    if (Math.abs(vx) > 0.5) e.facing = vx < 0 ? -1 : 1;
  }

  function stand(e) {
    e.vx = 0;
    e.vy = 0;
  }

  // Jumps to a spot 50-60 px from the player in a random direction. A direction that would leave the arena is turned
  // in 22.5 degree steps until one fits, so the distance holds even with Clawd in a corner (the clamp is the last resort).
  function relocate(e, w) {
    const p = w.player;
    const a0 = w.rng.angle();
    const dist = w.rng.range(APPEAR_MIN, APPEAR_MAX);
    let x = p.x;
    let y = p.y;
    for (let i = 0; i < 16; i++) {
      const a = a0 + (i * Math.PI) / 8;
      x = p.x + Math.cos(a) * dist;
      y = p.y + Math.sin(a) * dist;
      if (M.inArena(x, y, -e.r, w.arena)) break;
    }
    e.x = x;
    e.y = y;
    M.clampToArena(e, w.arena);
    e.facing = p.x >= e.x ? 1 : -1;
  }

  // Locks the lunge direction onto where the player is right now; it does not steer afterwards.
  function aimLunge(e, w) {
    const p = w.player;
    const h = M.norm(p.x - e.x, p.y - e.y);
    e.data.lx = h.x !== 0 || h.y !== 0 ? h.x : e.facing;
    e.data.ly = h.x !== 0 || h.y !== 0 ? h.y : 0;
  }

  // Flags per state: only wander and lunge can be shot or can hurt; vanish is also invisible and drawn nowhere.
  function enter(e, w, state) {
    CB.setState(e, state);
    e.visible = state !== 'vanish';
    e.targetable = state === 'wander' || state === 'lunge';
    e.contact = e.targetable;
    e.alpha = state === 'vanish' || state === 'appear' ? 0 : 1;
    if (state === 'wander') {
      e.data.heading = w.rng.angle();
      e.data.nextTurn = TURN_EVERY;
    } else if (state === 'appear') relocate(e, w);
    else if (state === 'lunge') aimLunge(e, w);
  }

  // The dashed telegraph: full alpha from its first frame, radius 12 shrinking to 5 across the fade-in, slowly turning.
  function drawRing(e, r) {
    const C = CB.Pal.C;
    const k = Math.min(1, e.stateT / DUR.appear);
    const rad = RING_FROM + (RING_TO - RING_FROM) * k;
    const spin = e.stateT * RING_SPIN;
    for (let i = 0; i < RING_DASHES; i++) {
      const a0 = spin + (i * 2 * Math.PI) / RING_DASHES;
      const a1 = a0 + RING_ARC;
      r.line(e.x + Math.cos(a0) * rad, e.y + Math.sin(a0) * rad, e.x + Math.cos(a1) * rad, e.y + Math.sin(a1) * rad, C.hurt);
    }
  }

  CB.Enemies.nullPointer = {
    create(w, x, y) {
      const e = CB.makeEnemy('nullPointer', x, y, { hp: 2, r: 5, data: { heading: 0, nextTurn: TURN_EVERY, lx: 1, ly: 0 } });
      enter(e, w, 'wander');
      return e;
    },

    update(e, w, dt) {
      const d = e.data;
      if (e.stateT >= DUR[e.state] - EPS) enter(e, w, NEXT[e.state]); // the new state acts on this same tick
      switch (e.state) {
        case 'wander':
          if (e.stateT >= d.nextTurn - EPS) {
            d.heading = w.rng.angle();
            d.nextTurn += TURN_EVERY;
          }
          move(e, w, Math.cos(d.heading) * WANDER_SPEED, Math.sin(d.heading) * WANDER_SPEED, dt);
          break;
        case 'lunge':
          move(e, w, d.lx * LUNGE_SPEED, d.ly * LUNGE_SPEED, dt);
          break;
        case 'appear':
          e.alpha = Math.min(1, e.stateT / DUR.appear);
          stand(e);
          break;
        default: // vanish
          stand(e);
      }
    },

    draw(e, r, t) {
      const C = CB.Pal.C;
      const tt = t == null ? e.t : t;
      const a = e.alpha == null ? 1 : e.alpha;
      r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
      r.sprite('nullPointer_' + (Math.floor(e.t / FRAME_T) % 2), e.x, e.y, { flip: e.facing < 0, white: e.hitFlash > 0, alpha: a * (0.75 + 0.25 * Math.sin(tt * 10)) });
      if (e.state === 'appear') drawRing(e, r);
    },
  };
})(window.CB);
