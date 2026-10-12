// SyntaxError: red beetle that walks at the player with a sideways wobble and a yellow squiggle underline.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 38;
  const WOBBLE = 10; // px/s, perpendicular to the heading
  const WOBBLE_HZ = 3;
  const FRAME_T = 0.15;
  const SQUIGGLE_W = 10;

  // 12x10 side-view beetle facing right: glossy shell, white eye, antenna and three legs that shuffle between frames.
  // The shell and head carry the ink outline; legs and antenna are dark-red strokes so they stay visible on the near-ink floor.
  const BODY = [
    '............',
    '...kkk.....R',
    '..krwrk...R.',
    '.krwrrrk..R.',
    'krrrrrrRkkk.',
    'krrrrrrRkRwk',
    'krrRRRRRkRRk',
    'kkkkkkkkkkk.',
    '.R..R..R....',
  ];
  CB.Art.defineSprite('syntaxError_0', [...BODY, 'R...R...R...']);
  CB.Art.defineSprite('syntaxError_1', [...BODY, '..R..R..R...']);

  CB.Enemies.syntaxError = {
    create(w, x, y) {
      return CB.makeEnemy('syntaxError', x, y, { hp: 3, r: 5 });
    },

    update(e, w, dt) {
      const p = w.player;
      const h = M.norm(p.x - e.x, p.y - e.y); // (0, 0) when it sits exactly on the player: it simply stops there
      const wob = WOBBLE * Math.sin(e.t * 2 * Math.PI * WOBBLE_HZ);
      const x0 = e.x;
      const y0 = e.y;
      e.x += (h.x * SPEED - h.y * wob) * dt;
      e.y += (h.y * SPEED + h.x * wob) * dt;
      M.clampToArena(e, w.arena);
      // The velocity it really moved at (a wall zeroes the pushed-in part); dt already carries an elite's timeScale.
      const ts = e.timeScale || 1;
      e.vx = dt > 0 ? ((e.x - x0) / dt) * ts : 0;
      e.vy = dt > 0 ? ((e.y - y0) / dt) * ts : 0;
      if (Math.abs(h.x) > 0.15) e.facing = h.x < 0 ? -1 : 1; // by the heading, so the wobble can't flip it on a vertical chase
    },

    draw(e, r, t) {
      const C = CB.Pal.C;
      const tt = t == null ? e.t : t;
      const a = e.alpha == null ? 1 : e.alpha;
      const flash = e.hitFlash > 0;
      const cx = Math.round(e.x);
      const cy = Math.round(e.y);
      r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
      // The underline: a 1 px zigzag, 10 wide, that shifts by one pixel every 1/8 s.
      const off = Math.floor(tt * 8) % 2;
      r.alpha(a, () => {
        for (let i = 0; i < SQUIGGLE_W; i++) r.rect(cx - SQUIGGLE_W / 2 + i, cy + 6 + ((i + off) % 2), 1, 1, flash ? C.white : C.yellow);
      });
      r.sprite('syntaxError_' + (Math.floor(e.t / FRAME_T) % 2), e.x, e.y, { flip: e.facing < 0, white: flash, alpha: e.alpha });
    },
  };
})(window.CB);
