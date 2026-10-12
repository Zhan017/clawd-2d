// Clawd: movement, aiming, firing, dashing, damage, body language (faces, squash, recoil, idle bubble, hats) and drawing.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 80;
  const DASH_SPEED = 260;
  const DASH_TIME = 0.15;
  const DASH_INVULN = 0.25;
  const HURT_INVULN = 1.0;
  const SPREAD_STEP = (12 * Math.PI) / 180;
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly; 0.2 - 12/60 is +5e-17, not 0
  const IDLE_T = 2.5; // idle seconds before the squint (past it) and the "Thinking..." bubble (from it)
  const HURT_FACE_T = 0.4; // after a hit: the hurt face for this long...
  const HURT_SQUASH_T = 0.15; // ...and a squash that eases back over this long
  const CHEER_T = 0.9; // Fx.celebrate's cheer; the hop makes two bounces across it
  const KICK_DECAY = 14; // recoil per second
  const TRAIL_EVERY = 3; // dash ticks between afterimages: the 3 the trail holds then spread across the dash
  const HAT_DY = -7; // an ordinary hat's centre sits 7 px per scale above Clawd's sprite centre (its bottom row on the head's top row)
  const HAT_SHIFT = { shades: 5, halo: -2 }; // sprite px from that slot: shades drop onto the eye row, the halo floats 2 px higher

  // 16x12 Clawd. Eyes sit one pixel right of centre so flipping reads as "facing".
  const BLANK = '................';
  const BODY = [
    '..ohhhhhhhhhho..',
    '..oooooooooooo..',
    '..ooookooookoo..',
    '..ooookooookoo..',
    'oooooooooooooooo',
    'oooooooooooooooo',
    '..oooooooooooo..',
    '..OOOOOOOOOOOO..',
  ];
  const BODY_BLINK = [BODY[0], BODY[1], BODY[1], BODY[2], BODY[4], BODY[5], BODY[6], BODY[7]];
  const LEG = '...O.O....O.O...';
  const LEG_A = '...O......O.....';
  const LEG_B = '.....O......O...';

  // Faces: 3x2 eye templates over BODY rows 2-3 at columns 5-7 (left eye) and 10-12 (right eye); '.' keeps the body pixel.
  const EYES = {
    normal: { l: ['.k.', '.k.'], r: ['.k.', '.k.'] },
    hurt: { l: ['k.k', '.k.'], r: ['k.k', '.k.'] },
    happy: { l: ['.k.', 'k.k'], r: ['.k.', 'k.k'] },
    angry: { l: ['kk.', '.k.'], r: ['.kk', '.k.'] },
    squint: { l: ['...', 'kkk'], r: ['...', 'kkk'] },
    worried: { l: ['.k.', '.k.'], r: ['.k.', '.k.'] }, // plus the sweat pixel below
  };
  const isFace = (e) => typeof e === 'string' && Object.prototype.hasOwnProperty.call(EYES, e);

  function paint(row, col, tpl) {
    let out = row;
    for (let i = 0; i < tpl.length; i++) out = out.slice(0, col + i) + (tpl[i] === 'k' ? 'k' : 'o') + out.slice(col + i + 1);
    return out;
  }

  // BODY wearing a face. The worried one also gets a cyan sweat pixel on the temple (BODY row 1, column 13).
  function bodyFor(expr) {
    const e = EYES[expr];
    const rows = BODY.slice();
    for (let i = 0; i < 2; i++) rows[2 + i] = paint(paint(BODY[2 + i], 5, e.l[i]), 10, e.r[i]);
    if (expr === 'worried') rows[1] = rows[1].slice(0, 13) + 'c' + rows[1].slice(14);
    return rows;
  }

  // 12 rows: blank, [blank when `drop`: the idle1 bob], the body, one or two leg rows, blank.
  function makeClawd(drop, legA, legB, expr) {
    const rows = drop ? [BLANK, BLANK] : [BLANK];
    rows.push(...bodyFor(expr), legA);
    if (legB) rows.push(legB);
    rows.push(BLANK);
    return rows;
  }

  const POSES = { idle0: [false, LEG, LEG], idle1: [true, LEG, null], walk0: [false, LEG, LEG_A], walk2: [false, LEG, LEG_B] };
  for (const pose of Object.keys(POSES)) {
    const [drop, a, b] = POSES[pose];
    CB.Art.defineSprite('clawd_' + pose, makeClawd(drop, a, b, 'normal')); // the original names mean "normal"
    for (const expr of Object.keys(EYES)) CB.Art.defineSprite(`clawd_${pose}_${expr}`, makeClawd(drop, a, b, expr));
  }
  CB.Art.defineSprite('clawd_blink', [BLANK, ...BODY_BLINK, LEG, LEG, BLANK]);
  const WALK = ['walk0', 'idle0', 'walk2', 'idle0'];
  const frameName = (pose, expr) => (expr === 'normal' ? 'clawd_' + pose : `clawd_${pose}_${expr}`);

  // Hats, 11x6, each with an ink outline and two or more shades. An 11 px hat sits on the 12 px head; its bottom row covers the head's top row.
  // Shades are drawn on the eye row (see HAT_SHIFT) with their lenses over the eyes, the halo is a ring that floats clear of the head.
  const HAT_ROWS = {
    loopcap: ['...kkkkk...', '..kcbbbbk..', '.kbbcccbbk.', '.kbbcBcbbk.', '.kbbCCCbBk.', 'kBBBBBBBBBk'],
    slime: ['....kkk....', '...kgwgk...', '..kgwgggk..', '.kgggggggk.', '.kgggGggGgk', 'kgGkGGkGGgk'],
    branch: ['....kkk....', '...kqyYk...', '..kbbgggk..', '.kbbbggggk.', 'kbBbBgGgGgk', 'kBBBBGGGGGk'],
    shades: ['...........', '.kkkkkkkkkk', '.kwddkkwddk', '.kdsdkkdsdk', '.kkkk..kkkk', '...........'],
    crown: ['.k...k...k.', 'kqk.kqk.kqk', 'kyykyyykyyk', 'kyyyyyyyyyk', 'kyryycyyryk', 'kYYYYYYYYYk'],
    sudo: ['..kkwkwkk..', '..kwwwwwk..', '..kSwdwdk..', '..kwwwwwk..', '..kSwdwdk..', 'kkrrrrrrRkk'],
    halo: ['..kkkkkkk..', '.kywwyyyyk.', 'kyk.....kyk', '.kYYYYYYYk.', '..kkkkkkk..', '...........'],
  };
  for (const id of Object.keys(HAT_ROWS)) CB.Art.defineSprite('hat_' + id, HAT_ROWS[id]);

  // (x, y) is where an ordinary hat is centred: for Clawd drawn at scale s around (cx, cy) that is (cx, cy + HAT_DY * s).
  // The hat leans half a (scaled) pixel toward the facing, which centres it on the 12 px head and mirrors it with the flip.
  function drawHat(r, x, y, hatId, facing, scale) {
    const name = 'hat_' + hatId;
    if (!CB.Art.hasSprite(name)) return;
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const f = facing < 0 ? -1 : 1;
    r.sprite(name, x + 0.5 * f * s, y + (HAT_SHIFT[hatId] || 0) * s, { flip: f < 0, scale: s });
  }

  // The unlocked hat Clawd is wearing, or null. Optional module, guarded by method.
  function wornHat() {
    const U = CB.Unlocks;
    if (!U || typeof U.hat !== 'function') return null;
    const id = U.hat();
    return typeof id === 'string' && CB.Art.hasSprite('hat_' + id) ? id : null;
  }

  // Seconds since the last hit landed, or Infinity when none is showing. hurtT counts down from hurtInvuln, which a mode can shorten.
  // Never negative, so a hurtT that is longer than hurtInvuln (a hand-built player) cannot push the squash past 1.3 / 0.7.
  function hurtAge(p) {
    return p.hurtT > 0 ? Math.max(0, (p.hurtInvuln || HURT_INVULN) - p.hurtT) : Infinity;
  }

  // Pure: the face Clawd wears right now.
  function expression(p) {
    if (hurtAge(p) < HURT_FACE_T) return 'hurt';
    if (p.cheerT > 0) return 'happy';
    if (p.dashT > EPS) return 'angry';
    if (p.hearts === 1) return 'worried';
    if (p.idleT > IDLE_T) return 'squint';
    return 'normal';
  }

  // Pure: squash and stretch about the feet (the caller anchors at p.x, p.y + 4).
  function pose(p) {
    if (p.dashT > EPS) return Math.abs(p.dashDX || 0) >= Math.abs(p.dashDY || 0) ? { sx: 1.3, sy: 0.8 } : { sx: 0.8, sy: 1.3 };
    const age = hurtAge(p);
    if (age < HURT_SQUASH_T) {
      const k = 1 - age / HURT_SQUASH_T; // 1 on the hit, back to 0 as the squash eases out
      return { sx: 1 + 0.3 * k, sy: 1 - 0.3 * k };
    }
    if (p.kick > 0.5) return { sx: 0.95, sy: 1.05 };
    return { sx: 1, sy: 1 };
  }

  // The hurt blink: hidden on the "on" half of a fast blink. Calm mode slows it through CB.Comfort when that is loaded.
  function hurtHides(hurtT) {
    if (CB.Comfort && typeof CB.Comfort.blink === 'function') return CB.Comfort.blink(hurtT, 20);
    return Math.floor(hurtT * 20) % 2 === 0;
  }

  // "✻ Thinking..." above Clawd (and above the /compact keycap). The glyph cycles; the words stay put (laid out for the widest glyph).
  const THINK_GLYPHS = ['·', '*', '✻'];
  function drawThinking(p, r, t) {
    const C = CB.Pal.C;
    const width = (s) => (CB.Font && typeof CB.Font.measure === 'function' ? CB.Font.measure(s, 1) : s.length * 6);
    const calm = !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());
    const glyph = THINK_GLYPHS[Math.floor(t * (calm ? 4 : 8)) % THINK_GLYPHS.length];
    const gw = Math.max(...THINK_GLYPHS.map(width));
    const word = 'Thinking...';
    const total = gw + 4 + width(word);
    const x = Math.round(M.clamp(p.x - total / 2, 2, CB.W - total - 2));
    const y = Math.max(2, Math.round(p.y - 31));
    const o = { color: C.pale, shadow: C.ink };
    r.text(glyph, x + Math.round((gw - width(glyph)) / 2), y, o); // centred in the widest glyph's cell
    r.text(word, x + gw + 4, y, o);
  }

  CB.Player = {
    SPEED, DASH_SPEED, DASH_TIME, DASH_INVULN, HURT_INVULN, HAT_DY,
    expression, pose, drawHat,

    create(w, patches) {
      const stats = CB.Patches.computeStats(patches || {});
      const yolo = !!(w.mode && w.mode.yolo);
      if (yolo) stats.maxHearts = Math.max(1, stats.maxHearts - 3); // YOLO: three fewer hearts (3 base), hearts start at the reduced max
      const a = w.arena;
      return {
        x: a.x + a.w / 2, y: a.y + a.h / 2 + 30, r: 5, vx: 0, vy: 0,
        hearts: stats.maxHearts, stats, facing: 1,
        aimX: a.x + a.w / 2, aimY: a.y,
        fireCd: 0, dashCd: 0, dashT: 0, dashDX: 0, dashDY: 0,
        invuln: 0, dashInvulnT: 0, hurtT: 0, hurtInvuln: yolo ? 0.7 : HURT_INVULN, dead: false, slow: 1, moving: false, walkT: 0, t: 0, trail: [],
        beatT: 0.3, beatPulse: 0, lowWarned: false,
        kick: 0, idleT: 0, cheerT: 0, dashN: 0, // cosmetic: recoil, idle clock, celebration, dash ticks so far
      };
    },

    canBeHit: (p) => !p.dead && p.invuln <= EPS,

    update(p, w, dt, input) {
      p.t += dt;
      p.kick = Math.max(0, (p.kick || 0) - dt * KICK_DECAY);
      p.cheerT = Math.max(0, (p.cheerT || 0) - dt);
      for (const g of p.trail) g.life -= dt;
      while (p.trail.length && p.trail[0].life <= 0) p.trail.shift();
      if (p.dead) return;
      // Low-health heartbeat: first thump 0.3 s after dropping to 1 heart, then every 0.85 s; "context low" pops once per low spell.
      if (p.hearts === 1 && !w.god) {
        if (!p.lowWarned) {
          p.lowWarned = true;
          w.emit('text', { x: p.x, y: p.y - 12, text: 'context low', color: CB.Pal.C.hurt });
        }
        p.beatT -= dt;
        if (p.beatT <= EPS) {
          p.beatT += 0.85;
          p.beatPulse = 1;
          w.emit('heartbeat', { x: p.x, y: p.y });
        }
      } else {
        p.beatT = 0.3;
        p.lowWarned = false;
      }
      p.beatPulse = Math.max(0, p.beatPulse - dt * 5);
      p.fireCd -= dt;
      p.dashCd -= dt;
      p.invuln -= dt;
      p.dashInvulnT -= dt;
      p.hurtT -= dt;
      const wantCompact = input.compact || w.compactBuffered; // an E pressed during hitstop is cast on the first live tick
      w.compactBuffered = false;
      if (wantCompact && CB.Compact) CB.Compact.cast(w);
      p.aimX = input.aimX;
      p.aimY = input.aimY;
      p.facing = p.aimX >= p.x ? 1 : -1;
      const mv = M.norm(input.moveX || 0, input.moveY || 0);

      const wantDash = input.dash || w.dashBuffered;
      w.dashBuffered = false;
      p.idleT = mv.x !== 0 || mv.y !== 0 || input.fire || wantDash ? 0 : (p.idleT || 0) + dt; // any move, fire or dash input restarts the idle clock
      if (wantDash && p.dashCd <= EPS && p.dashT <= EPS) {
        let d = mv;
        if (d.x === 0 && d.y === 0) d = M.norm(p.aimX - p.x, p.aimY - p.y);
        if (d.x === 0 && d.y === 0) d = { x: p.facing, y: 0 };
        p.dashDX = d.x;
        p.dashDY = d.y;
        p.dashT = DASH_TIME;
        p.dashN = 0;
        p.invuln = Math.max(p.invuln, DASH_INVULN);
        p.dashInvulnT = DASH_INVULN; // what makes an overlapped enemy bullet a "perfect" (invuln alone also covers hurt, spawn and /compact)
        p.dashCd = p.stats.dashCooldown;
        w.emit('dash', { x: p.x, y: p.y });
      }

      if (p.dashT > EPS) {
        p.dashT -= dt;
        p.vx = p.dashDX * DASH_SPEED;
        p.vy = p.dashDY * DASH_SPEED;
        if ((p.dashN || 0) % TRAIL_EVERY === 0) {
          p.trail.push({ x: p.x, y: p.y, life: 0.2, facing: p.facing });
          if (p.trail.length > 3) p.trail.shift();
        }
        p.dashN = (p.dashN || 0) + 1;
      } else {
        const sp = SPEED * p.slow;
        p.vx = mv.x * sp;
        p.vy = mv.y * sp;
      }
      p.moving = p.vx !== 0 || p.vy !== 0;
      if (p.moving) p.walkT += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      M.clampToArena(p, w.arena);

      if (input.fire && p.fireCd <= EPS) {
        // Keep the sub-tick remainder (so 0.14 s really averages 8.4 ticks), but give no credit for idle time.
        const carry = p.fireCd > -dt + EPS ? p.fireCd : 0;
        p.fireCd = carry + p.stats.fireCooldown;
        CB.Player.fire(p, w);
      }
    },

    fire(p, w) {
      const base = Math.atan2(p.aimY - p.y, p.aimX - p.x);
      const sx = p.x + Math.cos(base) * 6;
      const sy = p.y + Math.sin(base) * 6;
      p.kick = 1;
      w.firePlayerBolt(sx, sy, base);
      for (let i = 1; i <= p.stats.spread; i++) {
        w.firePlayerBolt(sx, sy, base + SPREAD_STEP * i);
        w.firePlayerBolt(sx, sy, base - SPREAD_STEP * i);
      }
      w.stats.shots++;
      w.emit('shoot', { x: sx, y: sy, angle: base });
    },

    hurt(p, w) {
      if (p.dead || p.invuln > EPS) return false;
      p.invuln = p.hurtInvuln;
      p.hurtT = p.hurtInvuln;
      w.addShake(4);
      if (!w.god) w.hitstop = Math.max(w.hitstop, 0.06);
      w.flash = 0.15;
      w.flashColor = CB.Pal.C.hurt;
      if (w.god) {
        w.stats.wouldHits++;
        w.emit('playerHurt', { x: p.x, y: p.y, god: true });
        return true;
      }
      p.hearts -= 1;
      w.emit('playerHurt', { x: p.x, y: p.y });
      if (p.hearts <= 0) {
        p.hearts = 0;
        p.dead = true;
        p.dashT = 0;
        w.emit('playerDie', { x: p.x, y: p.y });
      }
      return true;
    },

    // `t` is the screen's clock (the bubble glyph); opts.expr forces a face (the victory screen passes 'happy').
    draw(p, r, t, opts) {
      const C = CB.Pal.C;
      const o = opts || {};
      const tt = Number.isFinite(t) ? t : p.t || 0;
      const pt = Number.isFinite(p.t) ? p.t : tt; // animation clock; it stands still in hit-stop
      for (const g of p.trail || []) {
        r.alpha(Math.max(0, g.life / 0.2) * 0.45, () => r.sprite('clawd_idle0', g.x, g.y - 2, { flip: g.facing < 0, white: true }));
      }
      r.alpha(0.35, () => r.rect(p.x - 5, p.y + 4, 10, 2, C.ink));
      if (p.dead) {
        r.sprite('clawd_idle0_hurt', p.x, p.y - 2, { flipY: true, flip: p.facing < 0 });
        return;
      }
      if (p.hurtT > 0 && hurtHides(p.hurtT)) return;
      const expr = isFace(o.expr) ? o.expr : expression(p);
      let name;
      let bob = 0; // the idle1 frame has the whole body one pixel lower, and the hat goes with it
      if (p.dashT > EPS) name = frameName('walk0', expr);
      else if (p.moving) name = frameName(WALK[Math.floor(p.walkT * 10) % 4], expr);
      else if (expr === 'normal' && pt % 3.2 < 0.12) name = 'clawd_blink';
      else if (Math.floor(pt * 2) % 2) {
        name = frameName('idle1', expr);
        bob = 1;
      } else name = frameName('idle0', expr);
      // Recoil pushes the sprite against the aim, the cheer hops it; neither touches p.x/p.y (the hitbox) or the shadow.
      const aim = M.norm(p.aimX - p.x, p.aimY - p.y);
      const kick = p.kick > 0 ? p.kick : 0;
      const hop = p.cheerT > 0 ? Math.abs(Math.sin(((CHEER_T - p.cheerT) / CHEER_T) * Math.PI * 2)) * 5 : 0;
      const cx = p.x + Math.round(-aim.x * 2 * kick) + 0;
      const cy = p.y - 2 + Math.round(-aim.y * 2 * kick - hop) + 0;
      const f = p.facing < 0 ? -1 : 1;
      const hat = wornHat();
      const body = () => {
        r.sprite(name, cx, cy, { flip: f < 0 });
        if (hat) drawHat(r, cx, cy + HAT_DY + bob, hat, f, 1);
      };
      const sq = pose(p);
      if ((sq.sx !== 1 || sq.sy !== 1) && typeof r.squash === 'function') r.squash(Math.round(p.x), Math.round(p.y + 4), sq.sx, sq.sy, body);
      else body();
      if ((p.idleT || 0) >= IDLE_T && !(opts && opts.noBubble)) drawThinking(p, r, tt); // no bubble under the stage/boss cards
    },
  };
})(window.CB);
