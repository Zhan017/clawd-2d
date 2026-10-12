// Movement, wall behaviour and drawing for player bolts and enemy bullets.
(function (CB) {
  'use strict';
  const M = CB.M;
  const PC = CB.Pal.C;
  const RAINBOW = [PC.red, PC.ember, PC.yellow, PC.green, PC.cyan, PC.purple]; // ultrathink sparks, 20 colour steps a second
  const BOLT_FULL = 14; // up to this many player bolts are drawn solid; each one beyond it takes 0.03 off the alpha, down to BOLT_FLOOR
  const BOLT_STEP = 0.03;
  const BOLT_FLOOR = 0.55;
  const PULSE_HZ = 10; // enemy bullet cores flip bright/normal every 0.1 s
  const PULSE_PHASE = 0.073; // seconds of phase between neighbouring bullets, so they do not flash in step

  CB.Art.defineSprite('bolt', ['..z..', '.zwz.', 'zwwwz', '.zwz.', '..z..']);
  CB.Art.defineSprite('bolt_big', ['...z...', '..zwz..', '.zwwwz.', 'zwwwwwz', '.zwwwz.', '..zwz..', '...z...']);
  CB.Art.defineSprite('ebullet', ['..k..', '.kxk.', 'kxXxk', '.kxk.', '..k..']);
  CB.Art.defineSprite('ebullet_hot', ['..k..', '.kXk.', 'kXwXk', '.kXk.', '..k..']); // the bright half of the core pulse

  // A crowd of bolts fades so the bullets between them stay readable.
  function drawBolts(w, r) {
    const n = w.pBullets.length;
    if (!n) return;
    const rainbow = !!(CB.Unlocks && CB.Unlocks.has('rainbow'));
    const paint = () => {
      for (const b of w.pBullets) {
        if (rainbow) {
          r.disc(b.x, b.y, b.r, RAINBOW[Math.floor(b.t * 20) % RAINBOW.length]);
          r.rect(b.x, b.y, 1, 1, PC.white);
        } else r.sprite(b.r >= 3 ? 'bolt_big' : 'bolt', b.x, b.y);
      }
    };
    const a = n <= BOLT_FULL ? 1 : Math.max(BOLT_FLOOR, 1 - (n - BOLT_FULL) * BOLT_STEP);
    if (a < 1) r.alpha(a, paint);
    else paint();
  }

  // Enemy bullet cores pulse, each bullet on its own phase. Static in calm mode, and when Comfort is missing or cannot blink.
  function drawBullets(w, r, t) {
    const C = CB.Comfort;
    const pulse = !!(C && C.calm && C.blink && !C.calm());
    for (let i = 0; i < w.eBullets.length; i++) {
      const b = w.eBullets[i];
      const hot = pulse && C.blink(t + i * PULSE_PHASE, PULSE_HZ);
      if (b.color) {
        r.disc(b.x, b.y, b.r + 1, PC.ink);
        r.disc(b.x, b.y, b.r, b.color);
        if (hot && b.r >= 2) r.disc(b.x, b.y, Math.round(b.r) - 1, PC.bulletCore);
      } else r.sprite(hot ? 'ebullet_hot' : 'ebullet', b.x, b.y);
    }
  }

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

    // `layer` is 'player' (bolts), 'enemy' (bullets) or undefined (both, player first). WorldDraw draws the enemy layer last so shots stay on top.
    draw(w, r, t, layer) {
      const now = t || 0;
      if (layer !== 'enemy') drawBolts(w, r);
      if (layer !== 'player') drawBullets(w, r, now);
    },
  };
})(window.CB);
