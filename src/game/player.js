// Clawd: movement, aiming, firing, dashing, damage and drawing.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 80;
  const DASH_SPEED = 260;
  const DASH_TIME = 0.15;
  const DASH_INVULN = 0.25;
  const HURT_INVULN = 1.0;
  const SPREAD_STEP = (12 * Math.PI) / 180;
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly; 0.2 - 12/60 is +5e-17, not 0

  // 16x12 Clawd. Eyes sit one pixel right of centre so flipping reads as "facing".
  const BLANK = '................';
  const BODY = [
    '..ohhhhhhhhhho..',
    '..oooooooooooo..',
    '..ooookooookoo..',
    '..ooookooookoo..',
    'oooooooooooooooo',
    'oooooooooooooooo',
    '..oooooooooooo..',
    '..OOOOOOOOOOOO..',
  ];
  const BODY_BLINK = [BODY[0], BODY[1], BODY[1], BODY[2], BODY[4], BODY[5], BODY[6], BODY[7]];
  const LEG = '...O.O....O.O...';
  const LEG_A = '...O......O.....';
  const LEG_B = '.....O......O...';
  CB.Art.defineSprite('clawd_idle0', [BLANK, ...BODY, LEG, LEG, BLANK]);
  CB.Art.defineSprite('clawd_idle1', [BLANK, BLANK, ...BODY, LEG, BLANK]);
  CB.Art.defineSprite('clawd_walk0', [BLANK, ...BODY, LEG, LEG_A, BLANK]);
  CB.Art.defineSprite('clawd_walk2', [BLANK, ...BODY, LEG, LEG_B, BLANK]);
  CB.Art.defineSprite('clawd_blink', [BLANK, ...BODY_BLINK, LEG, LEG, BLANK]);
  const WALK = ['clawd_walk0', 'clawd_idle0', 'clawd_walk2', 'clawd_idle0'];

  CB.Player = {
    SPEED, DASH_SPEED, DASH_TIME, DASH_INVULN, HURT_INVULN,

    create(w, patches) {
      const stats = CB.Patches.computeStats(patches || {});
      const yolo = !!(w.mode && w.mode.yolo);
      if (yolo) stats.maxHearts = Math.max(1, stats.maxHearts - 2); // YOLO: two fewer hearts, hearts start at the reduced max
      const a = w.arena;
      return {
        x: a.x + a.w / 2, y: a.y + a.h / 2 + 30, r: 5, vx: 0, vy: 0,
        hearts: stats.maxHearts, stats, facing: 1,
        aimX: a.x + a.w / 2, aimY: a.y,
        fireCd: 0, dashCd: 0, dashT: 0, dashDX: 0, dashDY: 0,
        invuln: 0, hurtT: 0, hurtInvuln: yolo ? 0.7 : HURT_INVULN, dead: false, slow: 1, moving: false, walkT: 0, t: 0, trail: [],
        beatT: 0.3, beatPulse: 0, lowWarned: false,
      };
    },

    canBeHit: (p) => !p.dead && p.invuln <= EPS,

    update(p, w, dt, input) {
      p.t += dt;
      for (const g of p.trail) g.life -= dt;
      while (p.trail.length && p.trail[0].life <= 0) p.trail.shift();
      if (p.dead) return;
      // Low-health heartbeat: first thump 0.3 s after dropping to 1 heart, then every 0.85 s; "context low" pops once per low spell.
      if (p.hearts === 1 && !w.god) {
        if (!p.lowWarned) {
          p.lowWarned = true;
          w.emit('text', { x: p.x, y: p.y - 12, text: 'context low', color: CB.Pal.C.hurt });
        }
        p.beatT -= dt;
        if (p.beatT <= EPS) {
          p.beatT += 0.85;
          p.beatPulse = 1;
          w.emit('heartbeat', { x: p.x, y: p.y });
        }
      } else {
        p.beatT = 0.3;
        p.lowWarned = false;
      }
      p.beatPulse = Math.max(0, p.beatPulse - dt * 5);
      p.fireCd -= dt;
      p.dashCd -= dt;
      p.invuln -= dt;
      p.hurtT -= dt;
      if (input.compact && CB.Compact) CB.Compact.cast(w);
      p.aimX = input.aimX;
      p.aimY = input.aimY;
      p.facing = p.aimX >= p.x ? 1 : -1;
      const mv = M.norm(input.moveX || 0, input.moveY || 0);

      const wantDash = input.dash || w.dashBuffered;
      w.dashBuffered = false;
      if (wantDash && p.dashCd <= EPS && p.dashT <= EPS) {
        let d = mv;
        if (d.x === 0 && d.y === 0) d = M.norm(p.aimX - p.x, p.aimY - p.y);
        if (d.x === 0 && d.y === 0) d = { x: p.facing, y: 0 };
        p.dashDX = d.x;
        p.dashDY = d.y;
        p.dashT = DASH_TIME;
        p.invuln = Math.max(p.invuln, DASH_INVULN);
        p.dashCd = p.stats.dashCooldown;
        w.emit('dash', { x: p.x, y: p.y });
      }

      if (p.dashT > EPS) {
        p.dashT -= dt;
        p.vx = p.dashDX * DASH_SPEED;
        p.vy = p.dashDY * DASH_SPEED;
        p.trail.push({ x: p.x, y: p.y, life: 0.2, facing: p.facing });
        if (p.trail.length > 3) p.trail.shift();
      } else {
        const sp = SPEED * p.slow;
        p.vx = mv.x * sp;
        p.vy = mv.y * sp;
      }
      p.moving = p.vx !== 0 || p.vy !== 0;
      if (p.moving) p.walkT += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      M.clampToArena(p, w.arena);

      if (input.fire && p.fireCd <= EPS) {
        // Keep the sub-tick remainder (so 0.14 s really averages 8.4 ticks), but give no credit for idle time.
        const carry = p.fireCd > -dt + EPS ? p.fireCd : 0;
        p.fireCd = carry + p.stats.fireCooldown;
        CB.Player.fire(p, w);
      }
    },

    fire(p, w) {
      const base = Math.atan2(p.aimY - p.y, p.aimX - p.x);
      const sx = p.x + Math.cos(base) * 6;
      const sy = p.y + Math.sin(base) * 6;
      w.firePlayerBolt(sx, sy, base);
      for (let i = 1; i <= p.stats.spread; i++) {
        w.firePlayerBolt(sx, sy, base + SPREAD_STEP * i);
        w.firePlayerBolt(sx, sy, base - SPREAD_STEP * i);
      }
      w.stats.shots++;
      w.emit('shoot', { x: sx, y: sy, angle: base });
    },

    hurt(p, w) {
      if (p.dead || p.invuln > EPS) return false;
      p.invuln = p.hurtInvuln;
      p.hurtT = p.hurtInvuln;
      w.addShake(4);
      if (!w.god) w.hitstop = Math.max(w.hitstop, 0.06);
      w.flash = 0.15;
      w.flashColor = CB.Pal.C.hurt;
      if (w.god) {
        w.stats.wouldHits++;
        w.emit('playerHurt', { x: p.x, y: p.y, god: true });
        return true;
      }
      p.hearts -= 1;
      if (CB.Compact) CB.Compact.onHurt(w);
      w.emit('playerHurt', { x: p.x, y: p.y });
      if (p.hearts <= 0) {
        p.hearts = 0;
        p.dead = true;
        p.dashT = 0;
        w.emit('playerDie', { x: p.x, y: p.y });
      }
      return true;
    },

    draw(p, r) {
      for (const g of p.trail) {
        r.alpha(Math.max(0, g.life / 0.2) * 0.45, () => r.sprite('clawd_idle0', g.x, g.y - 2, { flip: g.facing < 0, white: true }));
      }
      r.alpha(0.35, () => r.rect(p.x - 5, p.y + 4, 10, 2, CB.Pal.C.ink));
      if (p.dead) {
        r.sprite('clawd_idle0', p.x, p.y - 2, { flipY: true, flip: p.facing < 0 });
        return;
      }
      if (p.hurtT > 0 && Math.floor(p.hurtT * 20) % 2 === 0) return;
      let name;
      if (p.dashT > 0) name = 'clawd_walk0';
      else if (p.moving) name = WALK[Math.floor(p.walkT * 10) % 4];
      else if (p.t % 3.2 < 0.12) name = 'clawd_blink';
      else name = Math.floor(p.t * 2) % 2 ? 'clawd_idle1' : 'clawd_idle0';
      r.sprite(name, p.x, p.y - 2, { flip: p.facing < 0 });
    },
  };
})(window.CB);
