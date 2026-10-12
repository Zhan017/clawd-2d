// RaceCondition: yellow ant that sprints at the player in a sideways zigzag; pairs run in opposite phase.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 62; // px/s along the heading
  const SWAY = 40; // px/s, perpendicular to the heading
  const SWAY_HZ = 2;
  const FRAME_T = 0.08;
  const FRAMES = 3;
  const TAU = Math.PI * 2;

  // 10x8 side-view ant facing right: a round abdomen raised behind a flat thorax-and-head capsule with one eye, two antennae and
  // three legs. The body carries the ink outline; legs and antennae are dark-yellow strokes so they stay visible on the near-ink
  // floor. Frames scurry in a tripod gait: the front and hind legs swing together while the middle one swings against them.
  const BODY = ['kyyykkkkk.', 'kYYYkYYkyk', '.kkkkYYyyk', '.....kkkk.'];
  const FRAME_ROWS = [
    ['.kkk.Y...Y', 'kwyyk.Y.Y.', ...BODY, '....Y.Y.Y.', '.....Y...Y'],
    ['.kkk..Y.Y.', 'kwyyk.Y.Y.', ...BODY, '....Y.Y.Y.', '....Y.Y.Y.'],
    ['.kkk...Y.Y', 'kwyyk.Y.Y.', ...BODY, '....Y.Y.Y.', '...Y...Y..'],
  ];
  for (let i = 0; i < FRAMES; i++) CB.Art.defineSprite('raceCondition_' + i, FRAME_ROWS[i]);

  CB.Enemies.raceCondition = {
    create(w, x, y, opts) {
      const o = opts || {};
      // hx/hy is the last good heading: it stands in while the ant sits on top of the player.
      return CB.makeEnemy('raceCondition', x, y, { hp: 1, r: 4, data: { phase: M.isFiniteNum(o.phase) ? o.phase : 0, hx: 1, hy: 0 } });
    },

    update(e, w, dt) {
      const p = w.player;
      const d = e.data;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.5) {
        d.hx = dx / dist;
        d.hy = dy / dist;
      }
      const sway = SWAY * Math.sin(TAU * SWAY_HZ * e.t + d.phase); // e.t keeps the raw dt, so a P0's zigzag keeps its rhythm
      const x0 = e.x;
      const y0 = e.y;
      e.x += (d.hx * SPEED - d.hy * sway) * dt;
      e.y += (d.hy * SPEED + d.hx * sway) * dt;
      M.clampToArena(e, w.arena);
      // The velocity it really moved at (a wall zeroes the pushed-in part); dt already carries an elite's timeScale.
      const ts = e.timeScale || 1;
      e.vx = dt > 0 ? ((e.x - x0) / dt) * ts : 0;
      e.vy = dt > 0 ? ((e.y - y0) / dt) * ts : 0;
      if (Math.abs(d.hx) > 0.15) e.facing = d.hx < 0 ? -1 : 1; // by the heading, so the zigzag can't flip it on a vertical chase
    },

    draw(e, r, t) {
      const C = CB.Pal.C;
      const a = e.alpha == null ? 1 : e.alpha;
      const frame = Math.floor(e.t / FRAME_T) % FRAMES;
      r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
      // Speed lines: two parallel strokes trailing opposite the way it is really moving, the outer one fainter.
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > 10) {
        const ux = e.vx / sp;
        const uy = e.vy / sp;
        const sx = -uy * 1.5; // sideways offset between the two strokes
        const sy = ux * 1.5;
        const start = 6;
        const len1 = 6 + (frame % 2);
        const len2 = 4 + ((frame + 1) % 2);
        r.alpha(0.5 * a, () => r.line(e.x - ux * start + sx, e.y - uy * start + sy, e.x - ux * (start + len1) + sx, e.y - uy * (start + len1) + sy, C.yellow));
        r.alpha(0.25 * a, () => r.line(e.x - ux * start - sx, e.y - uy * start - sy, e.x - ux * (start + len2) - sx, e.y - uy * (start + len2) - sy, C.yellow));
      }
      r.sprite('raceCondition_' + frame, e.x, e.y, { flip: e.facing < 0, white: e.hitFlash > 0, alpha: e.alpha });
    },
  };
})(window.CB);
