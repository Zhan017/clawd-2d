// Context meter, the /compact shockwave, graze and the hit chain. Optional module: every caller guards `if (CB.Compact)`.
(function (CB) {
  'use strict';
  const M = CB.M;
  const EPS = 1e-9; // timers and the graze budget are summed from 1/60 steps, so exact comparisons drift

  // 1 px midpoint circle, clipped to the screen: the wave grows to 360 px, and r.ring would build a 721 px sprite per radius.
  function pixelRing(r, cx, cy, rad, color) {
    const put = (x, y) => {
      if (x >= 0 && x < CB.W && y >= 0 && y < CB.H) r.rect(x, y, 1, 1, color);
    };
    const quad = (a, b) => {
      put(cx + a, cy + b);
      if (a) put(cx - a, cy + b);
      if (b) {
        put(cx + a, cy - b);
        if (a) put(cx - a, cy - b);
      }
    };
    let x = rad;
    let y = 0;
    let err = 1 - rad;
    while (x >= y) {
      quad(x, y);
      if (x !== y) quad(y, x);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  const Compact = {
    MAX: 60, WAVE_SPEED: 520, WAVE_RMAX: 360, DMG_REGULAR: 3, DMG_BOSS: 5,
    GRAZE: 0.75, PERFECT: 3, GRAZE_RATE: 4.5, GRAZE_BAND: 6, CHAIN_T: 1.5, CHAIN_CAP: 20, BANNER_T: 1.0,

    // Adds to the context meter. Reaching full for the first time since the last cast announces it once.
    charge(w, n) {
      if (!(n > 0)) return;
      const c = w.context;
      c.value = Math.min(c.max, c.value + n);
      if (c.value >= c.max && !c.announced) {
        c.announced = true;
        w.emit('compactReady', { x: w.player.x, y: w.player.y });
      }
    },

    // One applied player-bolt hit: extend the chain, then charge the meter scaled by the new multiplier.
    onBoltHit(w, applied) {
      const c = w.chain;
      c.n++;
      c.t = Compact.CHAIN_T;
      c.mul = 1 + Math.min(c.n, Compact.CHAIN_CAP) / Compact.CHAIN_CAP;
      if (c.n > w.stats.maxChain) w.stats.maxChain = c.n;
      Compact.charge(w, applied * c.mul);
    },

    // A real (non-god) heart loss breaks the chain.
    onHurt(w) {
      const c = w.chain;
      c.n = 0;
      c.t = 0;
      c.mul = 1;
    },

    // Casts /compact. Returns false when refused (dead, meter not full, a wave already out, or the boss is down).
    cast(w) {
      const p = w.player;
      const c = w.context;
      if (p.dead || c.value < c.max || w.compactWave || (w.boss && w.boss.defeated)) return false;
      c.value = 0;
      c.announced = false;
      p.invuln = Math.max(p.invuln, 0.5);
      w.compactWave = { x: p.x, y: p.y, r: 0, hits: [] };
      w.compactBannerT = Compact.BANNER_T;
      w.stats.compacts++;
      w.emit('compact', { x: p.x, y: p.y });
      return true;
    },

    update(w, dt) {
      // Chain: decays 1.5 s after the last applied hit.
      const ch = w.chain;
      ch.t -= dt;
      if (ch.t <= EPS) {
        ch.t = 0;
        ch.n = 0;
        ch.mul = 1;
      }
      w.grazeTokens = Math.min(Compact.GRAZE_RATE, w.grazeTokens + Compact.GRAZE_RATE * dt);
      w.compactBannerT = Math.max(0, w.compactBannerT - dt);

      const cw = w.compactWave;
      if (!cw) return;
      cw.r += Compact.WAVE_SPEED * dt;
      for (const e of w.enemies) {
        if (e.dead || !e.visible || !e.targetable || cw.hits.indexOf(e) !== -1) continue;
        const reach = cw.r + e.r;
        if (M.dist2(cw.x, cw.y, e.x, e.y) > reach * reach) continue;
        cw.hits.push(e); // marked before the damage: a kill callback can never re-enter this enemy
        w.damageEnemy(e, e.boss ? Compact.DMG_BOSS : Compact.DMG_REGULAR, { compact: true });
      }
      const r2 = cw.r * cw.r;
      for (const b of w.eBullets) {
        if (b.dead || M.dist2(cw.x, cw.y, b.x, b.y) > r2) continue;
        b.dead = true;
        CB.Fx.spark(w, b.x, b.y, CB.Pal.C.gold, 1, 20, 0.2);
      }
      for (const h of w.hazards) {
        if (!h.dead && h.kind === 'puddle' && M.dist2(cw.x, cw.y, h.x, h.y) <= r2) h.dead = true;
      }
      if (cw.r >= Compact.WAVE_RMAX) w.compactWave = null;
    },

    // Called by world collide for every live enemy bullet that did not hurt the player. `overlapping` is the hit test.
    graze(w, b, overlapping) {
      if (b.grazed) return;
      const p = w.player;
      if (overlapping) {
        // Only dash protection counts (invulnerable but not recovering from a hit): a perfect graze.
        if (p.invuln > EPS && p.hurtT <= EPS) {
          b.grazed = true;
          Compact.charge(w, Compact.PERFECT);
          w.stats.grazes++;
          w.emit('graze', { x: b.x, y: b.y, perfect: true });
          w.emit('text', { x: p.x, y: p.y - 12, text: 'perfect', color: CB.Pal.C.gold });
        }
        return;
      }
      const reach = b.r + p.r + Compact.GRAZE_BAND;
      if (M.dist2(b.x, b.y, p.x, p.y) > reach * reach) return;
      b.grazed = true; // spent even when the budget is dry: a bullet grazes at most once
      if (w.grazeTokens >= Compact.GRAZE - EPS) {
        w.grazeTokens = Math.max(0, w.grazeTokens - Compact.GRAZE);
        Compact.charge(w, Compact.GRAZE);
        w.stats.grazes++;
        w.emit('graze', { x: b.x, y: b.y });
      }
    },

    // Expanding gold/white shockwave, fading as it grows. Called by WorldDraw (Task 19).
    draw(w, r) {
      const cw = w.compactWave;
      if (!cw) return;
      const rad = Math.round(cw.r);
      r.alpha(Math.max(0, 1 - cw.r / Compact.WAVE_RMAX), () => {
        pixelRing(r, Math.round(cw.x), Math.round(cw.y), rad, CB.Pal.C.gold);
        pixelRing(r, Math.round(cw.x), Math.round(cw.y), Math.max(0, rad - 2), CB.Pal.C.white);
      });
    },
  };
  CB.Compact = Compact;
})(window.CB);
