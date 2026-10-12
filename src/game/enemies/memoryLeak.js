// Memory Leak: a green slime that chases Clawd; a big blob splits into two small ones when it dies.
(function (CB) {
  'use strict';
  const M = CB.M;
  const INK = CB.Pal.C.ink;
  const BIG = { hp: 4, r: 6, speed: 30, frameT: 0.3, sprite: 'memoryLeak_' };
  const SMALL = { hp: 2, r: 4, speed: 45, frameT: 0.2, sprite: 'memoryLeakSmall_' };
  const SPLIT_OFFSET = 5; // px either side of the dying blob, across the line to the player
  const FACE_DEADZONE = 0.5; // px/s: a near-vertical chase must not flip the sprite every tick

  // Big slime, 14x11, in two poses: tall with long drips, and squashed wide with the drips shifted along. The eyes look right
  // (white, then pupil); flipping the sprite turns them left. The shine is kept two rows clear of the eyes so they never merge.
  CB.Art.defineSprite('memoryLeak_0', [
    '.....kkkk.....',
    '...kkggggkk...',
    '..kwwgggggGk..',
    '.kgggggggggGk.',
    '.kgwkgggwkgGk.',
    '.kgwkgggwkgGk.',
    '.kgggGGGgggGk.',
    '.kggggggggGGk.',
    '.kGGGGGGGGGGk.',
    '..kkGkkkkGkk..',
    '....k....k....',
  ]);
  CB.Art.defineSprite('memoryLeak_1', [
    '..............',
    '..............',
    '....kkkkkk....',
    '..kkwwgggGkk..',
    '.kgwkgggwkgGk.',
    'kggwkgggwkggGk',
    'kggggGGGggggGk',
    'kgggggggggGGGk',
    'kGGGGGGGGGGGGk',
    '.kkGkkkkkkGkk.',
    '...k......k...',
  ]);
  // Small slime, 10x8: the same two poses with bigger eyes for their size.
  CB.Art.defineSprite('memoryLeakSmall_0', [
    '...kkkk...',
    '..kwggGk..',
    '.kgggggGk.',
    '.kwkgwkGk.',
    '.kwkgwkGk.',
    '.kGGGGGGk.',
    '..kGkkkk..',
    '...k......',
  ]);
  CB.Art.defineSprite('memoryLeakSmall_1', [
    '..........',
    '...kkkk...',
    '.kkwgggkk.',
    'kgwkgwkgGk',
    'kgwkgwkgGk',
    'kGGGGGGGGk',
    '.kkkkkGkk.',
    '......k...',
  ]);

  const kindOf = (e) => (e.data.small ? SMALL : BIG);

  CB.Enemies.memoryLeak = {
    create(w, x, y, opts) {
      const small = !!opts && opts.small === true;
      const k = small ? SMALL : BIG;
      // `ph` offsets the squash cycle so a group of blobs doesn't pulse in lockstep (from the spawn point, never from an RNG).
      return CB.makeEnemy('memoryLeak', x, y, { hp: k.hp, r: k.r, data: { small, ph: (Math.abs(Math.floor(x) * 7 + Math.floor(y) * 13) % 10) / 10 } });
    },

    update(e, w, dt) {
      const p = w.player;
      const ox = e.x;
      const oy = e.y;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const step = Math.min(kindOf(e).speed * dt, d); // never overshoots, so a blob parked on Clawd stays put
        e.x += (dx / d) * step;
        e.y += (dy / d) * step;
      }
      M.clampToArena(e, w.arena);
      // Actual velocity in px per real second. World.step hands a P0 elite a dt scaled by timeScale, so scale it back out.
      const ts = e.timeScale || 1;
      e.vx = dt > 0 ? ((e.x - ox) * ts) / dt : 0;
      e.vy = dt > 0 ? ((e.y - oy) * ts) / dt : 0;
      if (e.vx > FACE_DEADZONE) e.facing = 1;
      else if (e.vx < -FACE_DEADZONE) e.facing = -1;
    },

    // A big blob bursts into two small ones, side by side across the line to Clawd. Smalls just die (enemyDie already pops them).
    // The splits are spawned with plain opts: never `elite`, and nothing is copied from the parent, so a P0 leaves ordinary blobs.
    onDeath(e, w) {
      if (e.data.small) return;
      const p = w.player;
      let dir = M.norm(p.x - e.x, p.y - e.y);
      if (dir.x === 0 && dir.y === 0) dir = { x: e.facing || 1, y: 0 }; // died right on top of Clawd: split along the facing
      for (const side of [1, -1]) {
        const spot = { x: e.x - dir.y * SPLIT_OFFSET * side, y: e.y + dir.x * SPLIT_OFFSET * side, r: SMALL.r };
        M.clampToArena(spot, w.arena);
        w.spawnEnemy('memoryLeak', spot.x, spot.y, { small: true }); // null at the enemy cap: that blob is simply not born
      }
      w.emit('splat', { x: e.x, y: e.y });
    },

    draw(e, r) {
      const k = kindOf(e);
      const frame = Math.floor((e.t + e.data.ph * k.frameT * 2) / k.frameT) % 2;
      r.alpha(0.3, () => r.rect(e.x - e.r, e.y + e.r - 1, e.r * 2, 2, INK));
      r.sprite(k.sprite + frame, e.x, e.y, { flip: e.facing < 0, white: e.hitFlash > 0, alpha: e.alpha });
    },
  };
})(window.CB);
