// Wave spawner: round-robin by kind, one group every 0.7 s, at most 6 regular enemies alive or pending.
// A few queued spawns per wave are flagged as P0 elites (see CB.Pickups).
(function (CB) {
  'use strict';
  const INTERVAL = 0.7;
  const MAX_ALIVE = 6;
  CB.WAVE = { INTERVAL, MAX_ALIVE };

  function groupSize(kind) {
    return (CB.GROUP_SIZE && CB.GROUP_SIZE[kind]) || 1;
  }

  // `elite` only applies to single spawns: CB.ELITE_KINDS never lists a pair kind.
  function spawnGroup(w, kind, elite) {
    const pt = w.edgePoint(60);
    if (groupSize(kind) === 2) {
      const ang = Math.atan2(w.player.y - pt.y, w.player.x - pt.x) + Math.PI / 2;
      const ox = Math.cos(ang) * 6;
      const oy = Math.sin(ang) * 6;
      w.queueSpawn(kind, pt.x + ox, pt.y + oy, { phase: 0 });
      w.queueSpawn(kind, pt.x - ox, pt.y - oy, { phase: Math.PI });
    } else {
      w.queueSpawn(kind, pt.x, pt.y, elite ? { elite: true } : {});
    }
  }

  CB.createWaveSpawner = function (w, waveDef, eliteCount = 0) {
    const lists = waveDef.map((d) => ({ kind: d.kind, left: d.count }));
    const queue = [];
    let any = true;
    while (any) {
      any = false;
      for (const l of lists) {
        if (l.left > 0) {
          queue.push(l.kind);
          l.left--;
          any = true;
        }
      }
    }
    // Parallel to `queue` (shifted with it): which pending spawns are P0 elites. An rng draw only happens when elites are asked for.
    const eliteFlags = queue.map(() => false);
    const kinds = CB.ELITE_KINDS || {};
    if (eliteCount > 0) {
      const candidates = [];
      queue.forEach((kind, i) => {
        if (kinds[kind]) candidates.push(i);
      });
      for (const i of w.rng.shuffle(candidates).slice(0, eliteCount)) eliteFlags[i] = true;
    }
    const sp = {
      queue,
      eliteFlags,
      total: queue.length,
      spawnedGroups: 0,
      timer: 0,
      done: false,
      alive() {
        return w.regularAlive() + w.spawns.length;
      },
      update(dt) {
        if (sp.done) return;
        sp.timer -= dt;
        if (queue.length && sp.timer <= 0) {
          const kind = queue[0];
          if (sp.alive() + groupSize(kind) <= MAX_ALIVE) {
            queue.shift();
            spawnGroup(w, kind, eliteFlags.shift());
            sp.spawnedGroups++;
            sp.timer = INTERVAL;
          }
        }
        if (!queue.length && w.spawns.length === 0 && w.regularAlive() === 0) sp.done = true;
      },
    };
    return sp;
  };
})(window.CB);
