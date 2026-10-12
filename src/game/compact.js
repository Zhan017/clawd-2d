// Context meter, the perfect-dash bonus, the /compact shockwave and its keycap prompt. Optional module: every caller guards `if (CB.Compact)`.
(function (CB) {
  'use strict';
  const M = CB.M;

  // 9x9 "E" keycap: ink outline, highlight/face/shade in offwhite, dark glyph.
  CB.Art.defineSprite('keycap_e', [
    '.kkkkkkk.',
    'kwwwwwwwk',
    'kWdddddWk',
    'kWdWWWWWk',
    'kWddddWWk',
    'kWdWWWWWk',
    'kWdddddWk',
    'keeeeeeek',
    '.kkkkkkk.',
  ]);

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
    MAX: 45, HIT: 1, INCOME_CAP: 7, PERFECT: 3, WAVE_SPEED: 520, WAVE_RMAX: 360, DMG_REGULAR: 3, DMG_BOSS: 5, BANNER_T: 1.0,

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

    // One applied player-bolt hit: worth HIT whatever the damage, paid out of the income bucket (at most INCOME_CAP meter per second).
    onBoltHit(w, applied) {
      if (!(applied > 0)) return;
      const take = Math.min(Compact.HIT, w.incomeTokens);
      w.incomeTokens -= take;
      Compact.charge(w, take);
    },

    // An enemy bullet overlapped Clawd while a dash protected her (world collide checks that): a perfect dodge, paid outside the bucket.
    perfect(w, b) {
      if (b.grazed) return;
      const p = w.player;
      b.grazed = true;
      Compact.charge(w, Compact.PERFECT);
      w.stats.perfects++;
      w.emit('graze', { x: b.x, y: b.y, perfect: true });
      w.emit('text', { x: p.x, y: p.y - 12, text: 'perfect', color: CB.Pal.C.gold });
    },

    // Tops the meter up and announces it. Every boss fight starts with this (stageRunner startBoss).
    fill(w) {
      const c = w.context;
      c.value = c.max;
      c.announced = true;
      w.emit('compactReady', { x: w.player.x, y: w.player.y });
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
      w.seenCompact = true;
      if (CB.Save && CB.Save.set) CB.Save.set('seenCompact', true);
      w.emit('compact', { x: p.x, y: p.y });
      return true;
    },

    update(w, dt) {
      w.incomeTokens = Math.min(Compact.INCOME_CAP, w.incomeTokens + Compact.INCOME_CAP * dt);
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

    // The "press E" keycap bobbing above Clawd while a cast is available; WorldDraw calls it right after Player.draw.
    // Until the first cast ever it also spells out `/compact` in gold beside the key.
    drawPrompt(w, r, t) {
      const p = w.player;
      const c = w.context;
      if (c.value < c.max || p.dead || w.compactWave || (w.boss && w.boss.defeated)) return;
      const y = p.y - 17 + Math.round(Math.sin(t * 4));
      r.sprite('keycap_e', p.x, y);
      if (!w.seenCompact) r.text('/compact', p.x + 7, y - 3, { color: CB.Pal.C.gold, shadow: CB.Pal.C.ink });
    },
  };
  CB.Compact = Compact;
})(window.CB);
