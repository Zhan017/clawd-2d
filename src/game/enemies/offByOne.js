// Off By One: a purple spider that keeps 70-110 px from Clawd, strafing, and fires a two-bullet burst aimed one tile ahead.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 50;
  const NEAR = 70; // closer than this: back away
  const FAR = 110; // farther than this: close in
  const HYST = 4; // px: a retreat or an approach runs this far past its trigger line, so a slowly closing Clawd cannot make it shudder on the line
  const FLIP_MIN = 1.5; // the strafe direction flips every FLIP_MIN..FLIP_MAX seconds
  const FLIP_MAX = 2.5;
  const FIRST_VOLLEY = 3.0; // seconds after spawning
  const VOLLEY_EVERY = 2.8;
  const BURST = 2;
  const BURST_GAP = 0.12;
  const BULLET_SPEED = 70;
  const LEAD = 8; // px ahead of Clawd, the way Clawd is moving
  const TELL = 0.4; // seconds of blinking eyes before a burst
  const TELL_HZ = 7.5; // lit on the first and the last frame of the 0.4 s tell
  const FRAME_T = 0.12;
  const SPRITE_W = 12;
  const SPRITE_H = 10;
  const EYE_COLS = [4, 7]; // columns of the two 1x2 eyes (rows 2-3) in both frames: symmetric, so a flipped sprite lines up too
  const FACE_DEADZONE = 0.5; // px/s: a near-vertical walk must not flip the sprite every tick
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly; 3 - 180/60 is a hair off 0

  // 12x10 spider from above: a round abdomen under a head with two red eyes (columns 4 and 7, rows 2-3), four legs a side.
  // The body carries the ink outline, broken where a leg leaves it; the legs are 1 px strokes (dark joint, bright shaft), so they
  // read on the near-ink floor. The two frames share the body and shuffle the legs: opposite legs lift and drop a foot pixel.
  CB.Art.defineSprite('offByOne_0', [
    '.p..kkkk..pp',
    'p.pkppppkp..',
    '...PrpprP...',
    '.p.kRppRk.pp',
    'p.PkppppkP..',
    '..kpppppPk..',
    '..PwpppPPP.p',
    'ppkPPPPPPkp.',
    '...PPPPPP..p',
    'ppp.kkkk.pp.',
  ]);
  CB.Art.defineSprite('offByOne_1', [
    'pp..kkkk..p.',
    '..pkppppkp.p',
    '...PrpprP...',
    'pp.kRppRk.p.',
    '..PkppppkP.p',
    '..kpppppPk..',
    'p.PwpppPPP..',
    '.pkPPPPPPkpp',
    'p..PPPPPP...',
    '.pp.kkkk.ppp',
  ]);

  // True while the eyes should be white: held through the burst, blinking in the last TELL seconds before it (real time, so an elite's tell is as long).
  function eyesWhite(e) {
    const d = e.data;
    if (d.pending > 0) return true;
    const ts = e.timeScale || 1;
    if (d.fireT <= 0 || d.fireT > TELL * ts) return false;
    const left = d.fireT / ts;
    return CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(left, TELL_HZ) : Math.floor(left * TELL_HZ) % 2 === 0;
  }

  // One bullet from the spider's centre at the aim point of this very moment. The first of a burst also announces itself.
  function shoot(e, w, first) {
    const a = Spider.aimPoint(w);
    const b = w.fireEnemyBullet(e.x, e.y, M.angleTo(e.x, e.y, a.x, a.y), BULLET_SPEED);
    if (b && first) w.emit('enemyShoot', { x: e.x, y: e.y });
  }

  const Spider = {
    create(w, x, y) {
      // The strafe side and its first flip time come from w.rng, so a pair of spiders does not circle Clawd in step.
      // `ph` offsets the leg shuffle from the spawn point (never from an RNG) for the same reason.
      return CB.makeEnemy('offByOne', x, y, {
        hp: 4,
        r: 5,
        data: {
          mode: 'strafe', side: w.rng.chance(0.5) ? 1 : -1, flipT: w.rng.range(FLIP_MIN, FLIP_MAX), hx: 1, hy: 0,
          fireT: FIRST_VOLLEY, pending: 0, gapT: 0,
          ph: ((Math.abs(Math.floor(x)) * 7 + Math.abs(Math.floor(y)) * 13) % 10) / 10 * FRAME_T * 2,
        },
      });
    },

    // The point a bullet fired now should head for: Clawd, plus LEAD px along Clawd's current move direction (Clawd's own spot when still).
    aimPoint(w) {
      const p = w.player;
      const v = M.norm(p.vx || 0, p.vy || 0);
      return { x: p.x + LEAD * v.x, y: p.y + LEAD * v.y };
    },

    update(e, w, dt) {
      const p = w.player;
      const d = e.data;
      const x0 = e.x;
      const y0 = e.y;

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-6) {
        d.hx = dx / dist;
        d.hy = dy / dist;
      } // else it sits exactly on Clawd: keep the last heading, so "away" still points somewhere

      d.flipT -= dt;
      if (d.flipT <= EPS) {
        d.side = -d.side;
        d.flipT += w.rng.range(FLIP_MIN, FLIP_MAX);
      }

      // Back off inside NEAR, close in beyond FAR, strafe between. An away or toward run carries on HYST px past its line before it hands over to the strafe.
      let mode = d.mode;
      if (dist < NEAR) mode = 'away';
      else if (dist > FAR) mode = 'toward';
      else if (mode === 'away' && dist >= NEAR + HYST) mode = 'strafe';
      else if (mode === 'toward' && dist <= FAR - HYST) mode = 'strafe';
      d.mode = mode;
      let mx = -d.hy * d.side; // strafe: perpendicular to the line to Clawd
      let my = d.hx * d.side;
      if (mode === 'away') {
        mx = -d.hx;
        my = -d.hy;
      } else if (mode === 'toward') {
        mx = d.hx;
        my = d.hy;
      }
      e.x += mx * SPEED * dt;
      e.y += my * SPEED * dt;
      M.clampToArena(e, w.arena);
      // The velocity it really moved at in px per real second (a wall eats the pushed-in part); dt already carries an elite's timeScale.
      const ts = e.timeScale || 1;
      e.vx = dt > 0 ? ((e.x - x0) / dt) * ts : 0;
      e.vy = dt > 0 ? ((e.y - y0) / dt) * ts : 0;
      if (e.vx > FACE_DEADZONE) e.facing = 1;
      else if (e.vx < -FACE_DEADZONE) e.facing = -1;

      // A burst of BURST bullets every VOLLEY_EVERY s, each one aimed at the moment it leaves. Always through w.fireEnemyBullet, looked up here.
      d.fireT -= dt;
      if (d.pending > 0) {
        d.gapT -= dt;
        if (d.gapT <= EPS) {
          d.pending--;
          d.gapT += BURST_GAP;
          shoot(e, w, false);
        }
      } else if (d.fireT <= EPS) {
        d.fireT += VOLLEY_EVERY;
        d.pending = BURST - 1;
        d.gapT = BURST_GAP;
        shoot(e, w, true);
      }
    },

    draw(e, r, t) {
      const C = CB.Pal.C;
      const a = e.alpha == null ? 1 : e.alpha;
      const flash = e.hitFlash > 0;
      const cx = Math.round(e.x);
      const left = Math.round(e.x - SPRITE_W / 2); // where the renderer puts the sprite's top-left pixel
      const top = Math.round(e.y - SPRITE_H / 2);
      r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
      r.sprite('offByOne_' + (Math.floor((e.t + e.data.ph) / FRAME_T) % 2), e.x, e.y, { flip: e.facing < 0, white: flash, alpha: e.alpha });
      r.alpha(a, () => {
        // The "+1": a thin purple tick, inked on both sides, one pixel right of the centre column and clear of the sprite.
        r.rect(cx, top - 6, 3, 5, C.ink);
        r.rect(cx + 1, top - 5, 1, 3, flash ? C.white : C.purple);
        if (!flash && eyesWhite(e)) for (const col of EYE_COLS) r.rect(left + col, top + 2, 1, 2, C.white);
      });
    },
  };
  CB.Enemies.offByOne = Spider;
})(window.CB);
