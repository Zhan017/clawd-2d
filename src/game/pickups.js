// Elite "P0" bugs and hotfix pickups. Optional module: every caller guards `if (CB.Pickups)`.
(function (CB) {
  'use strict';
  const M = CB.M;
  const EPS = 1e-9; // life is summed from 1/60 steps, so an exact `<= 0` would expire a tick late

  // 9x8 heart: a collected hotfix heals one heart, or charges the context meter at full health.
  CB.Art.defineSprite('pickup_hotfix', [
    '.RRR.RRR.',
    'RrwrrrrrR',
    'RrrrrrrrR',
    'RrrrrrrrR',
    '.RrrrrrR.',
    '..RrrrR..',
    '...RrR...',
    '....R....',
  ]);

  // Kinds the wave spawner may promote to a P0 elite (pairs and the Null Pointer stay normal).
  CB.ELITE_KINDS = { syntaxError: true, memoryLeak: true, offByOne: true };

  const Pickups = {
    CAP: 6, LIFE: 8, RADIUS: 9, HP_MUL: 1.75, TIME_SCALE: 1.2, CHARGE: 15,

    // Turns a freshly created enemy into a P0: tougher and 20% faster (world.step scales its update dt by timeScale).
    applyElite(e) {
      e.elite = true;
      e.hp = e.maxHp = Math.ceil(e.hp * Pickups.HP_MUL);
      e.timeScale = Pickups.TIME_SCALE;
    },

    // Leaves a hotfix where an elite fell. Refused once CAP are lying around.
    drop(w, x, y) {
      const list = w.pickups || (w.pickups = []);
      if (list.length >= Pickups.CAP) return null;
      const k = { kind: 'hotfix', x, y, life: Pickups.LIFE, t: 0, dead: false };
      list.push(k);
      return k;
    },

    // Ages pickups, collects them for a live player (heal, or +15 context at full health) and removes the spent ones in place.
    update(w, dt) {
      const list = w.pickups;
      if (!list || !list.length) return;
      const p = w.player;
      const reach = Pickups.RADIUS * Pickups.RADIUS;
      for (const k of list) {
        if (k.dead) continue;
        k.t += dt;
        k.life -= dt;
        if (k.life <= EPS) {
          k.dead = true;
          continue;
        }
        if (p.dead || M.dist2(k.x, k.y, p.x, p.y) > reach) continue;
        k.dead = true;
        if (p.hearts < p.stats.maxHearts) {
          p.hearts = Math.min(p.stats.maxHearts, p.hearts + 1);
          w.emit('pickup', { x: k.x, y: k.y, heal: true });
          w.emit('text', { x: k.x, y: k.y - 10, text: '+1 ♥', color: CB.Pal.C.red });
        } else {
          if (CB.Compact) CB.Compact.charge(w, Pickups.CHARGE);
          w.emit('pickup', { x: k.x, y: k.y, heal: false });
          w.emit('text', { x: k.x, y: k.y - 10, text: '+15 ctx', color: CB.Pal.C.gold });
        }
      }
      let j = 0;
      for (let i = 0; i < list.length; i++) if (!list[i].dead) list[j++] = list[i];
      list.length = j;
    },

    // Bobbing heart (+-1.5 px at 2 Hz) over a ring; blinks at 8 Hz for the last 2 s of its life.
    draw(w, r, t) {
      const list = w.pickups;
      if (!list || !list.length) return;
      const tt = t == null ? w.time : t;
      for (const k of list) {
        if (k.dead) continue;
        if (k.life <= 2 && Math.floor(tt * 16) % 2 !== 0) continue;
        r.alpha(0.55, () => r.ring(k.x, k.y + 1, 7, CB.Pal.C.gold));
        r.sprite('pickup_hotfix', k.x, k.y + Math.sin(tt * Math.PI * 4) * 1.5, {});
      }
    },
  };
  CB.Pickups = Pickups;
})(window.CB);
