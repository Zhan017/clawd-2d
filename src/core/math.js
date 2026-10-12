// Small vector, angle and collision helpers shared by logic and drawing.
(function (CB) {
  'use strict';
  const M = {
    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist2: (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    len: (x, y) => Math.hypot(x, y),
    norm(x, y) {
      const l = Math.hypot(x, y);
      return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
    },
    angleTo: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    wrapAngle(a) {
      if (!Number.isFinite(a)) return 0;
      if (a > 1e6 || a < -1e6) a %= 2 * Math.PI;
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    },
    approach: (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target)),
    circleHit: (ax, ay, ar, bx, by, br) => M.dist2(ax, ay, bx, by) <= (ar + br) * (ar + br),
    segDist2(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      return (px - cx) * (px - cx) + (py - cy) * (py - cy);
    },
    circleSegment: (cx, cy, r, x1, y1, x2, y2) => M.segDist2(cx, cy, x1, y1, x2, y2) <= r * r,
    clampToArena(e, arena) {
      const a = arena || CB.ARENA;
      e.x = M.clamp(e.x, a.x + e.r, a.x + a.w - e.r);
      e.y = M.clamp(e.y, a.y + e.r, a.y + a.h - e.r);
      return e;
    },
    inArena(x, y, margin, arena) {
      const a = arena || CB.ARENA;
      const m = margin || 0;
      return x >= a.x - m && x <= a.x + a.w + m && y >= a.y - m && y <= a.y + a.h + m;
    },
    isFiniteNum: (v) => typeof v === 'number' && Number.isFinite(v),
  };
  CB.M = M;
})(window.CB);
