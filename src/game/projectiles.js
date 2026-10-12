// Movement, wall behaviour and drawing for player bolts and enemy bullets.
(function (CB) {
  'use strict';
  const M = CB.M;
  const PC = CB.Pal.C;
  const RAINBOW = [PC.red, PC.ember, PC.yellow, PC.green, PC.cyan, PC.purple]; // ultrathink sparks, 20 colour steps a second

  CB.Art.defineSprite('bolt', ['..z..', '.zwz.', 'zwwwz', '.zwz.', '..z..']);
  CB.Art.defineSprite('bolt_big', ['...z...', '..zwz..', '.zwwwz.', 'zwwwwwz', '.zwwwz.', '..zwz..', '...z...']);
  CB.Art.defineSprite('ebullet', ['..k..', '.kxk.', 'kxXxk', '.kxk.', '..k..']);

  CB.Projectiles = {
    update(w, dt) {
      const a = w.arena;
      for (const b of w.pBullets) {
        if (b.dead) continue;
        // A bolt does not move on the tick it was created, so an enemy hugging Clawd can still be hit.
        const fresh = b.t === 0;
        b.t += dt;
        b.life -= dt;
        if (!fresh) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
        if (b.life <= 0) {
          b.dead = true;
          continue;
        }
        const outX = b.x < a.x || b.x > a.x + a.w;
        const outY = b.y < a.y || b.y > a.y + a.h;
        if (outX || outY) {
          if (b.bounces > 0) {
            if (outX) {
              b.vx = -b.vx;
              b.x = M.clamp(b.x, a.x, a.x + a.w);
            }
            if (outY) {
              b.vy = -b.vy;
              b.y = M.clamp(b.y, a.y, a.y + a.h);
            }
            b.bounces--;
            b.life = 0.6;
            b.hits.length = 0;
            b.angle = Math.atan2(b.vy, b.vx);
            w.emit('bounce', { x: b.x, y: b.y });
          } else b.dead = true;
        }
      }
      for (const b of w.eBullets) {
        if (b.dead) continue;
        b.t += dt;
        b.life -= dt;
        if (b.spin) {
          const c = Math.cos(b.spin * dt);
          const s = Math.sin(b.spin * dt);
          const vx = b.vx * c - b.vy * s;
          b.vy = b.vx * s + b.vy * c;
          b.vx = vx;
        }
        if (b.accel) {
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 0) {
            const ns = Math.max(10, sp + b.accel * dt);
            b.vx *= ns / sp;
            b.vy *= ns / sp;
          }
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0 || !M.inArena(b.x, b.y, 4, a)) b.dead = true;
      }
    },

    draw(w, r) {
      const rainbow = !!(CB.Unlocks && CB.Unlocks.has('rainbow'));
      for (const b of w.pBullets) {
        if (rainbow) {
          r.disc(b.x, b.y, b.r, RAINBOW[Math.floor(b.t * 20) % RAINBOW.length]);
          r.rect(b.x, b.y, 1, 1, PC.white);
        } else r.sprite(b.r >= 3 ? 'bolt_big' : 'bolt', b.x, b.y);
      }
      for (const b of w.eBullets) {
        if (b.color) {
          r.disc(b.x, b.y, b.r + 1, CB.Pal.C.ink);
          r.disc(b.x, b.y, b.r, b.color);
        } else r.sprite('ebullet', b.x, b.y);
      }
    },
  };
})(window.CB);
