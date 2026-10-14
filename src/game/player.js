// Clawd: movement, aiming, firing, dashing, damage, body language (faces, squash, recoil, idle bubble, hats) and drawing.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 80;
  const DASH_SPEED = 260;
  const DASH_TIME = 0.15;
  const DASH_INVULN = 0.25;
  const HURT_INVULN = 1.0;
  const DASH_BUFFER = 0.15; // a dash pressed this early (or less) before the cooldown ends fires the moment it does
  const REFUSE_T = 0.15; // how long the HUD flashes after a refused dash or /compact
  const AIM_R = 48; // stick aim: the aim point sits this far out along the stick direction
  const ASSIST_DEG = 10; // stick aim assist: a bug this close to the stick direction...
  const ASSIST_COS = Math.cos((ASSIST_DEG * Math.PI) / 180);
  const ASSIST_RANGE = 140; // ...and this near Clawd pulls the aim onto itself
  const ASSIST_TIE = 0.002; // directions this close in cosine count as equally well aimed, and the nearer bug wins
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
  // `keycapBelow`: a /compact prompt already sits under Clawd, so a flipped bubble goes below that.
  function drawThinking(p, r, t, keycapBelow) {
    const C = CB.Pal.C;
    const width = (s) => (CB.Font && typeof CB.Font.measure === 'function' ? CB.Font.measure(s, 1) : s.length * 6);
    const calm = !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());
    const glyph = THINK_GLYPHS[Math.floor(t * (calm ? 4 : 8)) % THINK_GLYPHS.length];
    const gw = Math.max(...THINK_GLYPHS.map(width));
    const word = 'Thinking...';
    const total = gw + 4 + width(word);
    const x = Math.round(M.clamp(p.x - total / 2, 2, CB.W - total - 2));
    // Above Clawd, unless that would leave the arena: near the top wall it flips below her.
    const A = CB.ARENA;
    let y = Math.round(p.y - 31);
    if (y < A.y + 2) y = Math.min(A.y + A.h - 9, Math.round(p.y + (keycapBelow ? 22 : 10)));
    const o = { color: C.pale, shadow: C.ink };
    r.text(glyph, x + Math.round((gw - width(glyph)) / 2), y, o); // centred in the widest glyph's cell
    r.text(word, x + gw + 4, y, o);
  }

  // The first seconds of a wave stay quiet: the HUD (which knows the run's state) says so. Optional: without it the bubble is never held back.
  function waveStartQuiet(t) {
    const H = CB.Screens && CB.Screens.hud;
    return !!(H && typeof H.bubbleQuiet === 'function' && H.bubbleQuiet(t));
  }

  // At one heart a ring pulses under Clawd's feet on the beat (steady in calm mode). Gold on the red ~/prod/ floor, where red would vanish.
  function drawLastHeartRing(p, r, w) {
    const C = CB.Pal.C;
    const calm = !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());
    const pulse = calm ? 0.4 : M.clamp(Number.isFinite(p.beatPulse) ? p.beatPulse : 0, 0, 1);
    const prod = !!(w && w.stage && w.stage.palette === 'prod');
    const rad = 9 + Math.round(3 * pulse);
    r.alpha(0.55 + 0.35 * pulse, () => {
      r.ring(p.x, p.y + 2, rad, prod ? C.gold : C.hurt);
      r.ring(p.x, p.y + 2, rad - 1, prod ? C.gold : C.hurt);
    });
  }

  // Cosine between the stick direction `u` and the line to bug `e`; -2 when the bug cannot be assisted: not hittable right now,
  // a boss part (every boss body, segment, twin and moth is `boss: true, regular: false`), out of range or outside the cone.
  function assistCos(e, p, u) {
    if (!e || e.dead || !e.visible || !e.targetable || !e.regular || e.boss || e.invuln > 0) return -2;
    const vx = e.x - p.x;
    const vy = e.y - p.y;
    const d = Math.hypot(vx, vy);
    if (d > ASSIST_RANGE || d < 1e-6) return -2;
    const c = (vx * u.x + vy * u.y) / d;
    return c >= ASSIST_COS ? c : -2;
  }

  // The bug a firing stick snaps onto, or null. (dx, dy) is the stick direction. The largest cosine wins; among cosines within
  // ASSIST_TIE of it, the nearer bug. Bosses are never assisted, so the Heisenbug's moths are never snapped to.
  function assistTarget(w, p, dx, dy) {
    const u = M.norm(dx, dy);
    if (u.x === 0 && u.y === 0) return null;
    const list = (w && w.enemies) || [];
    let bestCos = -2;
    for (const e of list) bestCos = Math.max(bestCos, assistCos(e, p, u));
    if (bestCos < 0) return null;
    let best = null;
    let bestD = Infinity;
    for (const e of list) {
      if (assistCos(e, p, u) < bestCos - ASSIST_TIE) continue;
      const d = M.dist(p.x, p.y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // The aim point for a stick, or null when this input aims with the mouse. A stick aims by direction (a unit vector in
  // input.aimDirX/aimDirY): 48 px out from Clawd, or onto an assist target while the stick fires. An idle stick is never
  // assisted, so passing bugs do not pull the crosshair around.
  function stickAim(p, w, input) {
    const dx = input.aimDirX;
    const dy = input.aimDirY;
    if (!M.isFiniteNum(dx) || !M.isFiniteNum(dy)) return null;
    const u = M.norm(dx, dy);
    if (u.x === 0 && u.y === 0) return null;
    if (input.aimAssist && input.fire) {
      const t = assistTarget(w, p, u.x, u.y);
      if (t) return { x: t.x, y: t.y };
    }
    return { x: p.x + u.x * AIM_R, y: p.y + u.y * AIM_R };
  }

  CB.Player = {
    SPEED, DASH_SPEED, DASH_TIME, DASH_INVULN, HURT_INVULN, HAT_DY, AIM_R, ASSIST_DEG, ASSIST_RANGE,
    expression, pose, drawHat, assistTarget,

    create(w, patches) {
      const stats = CB.Patches.computeStats(patches || {});
      const yolo = !!(w.mode && w.mode.yolo);
      if (yolo) stats.maxHearts = Math.max(1, stats.maxHearts - 3); // YOLO: three fewer hearts (3 base), hearts start at the reduced max
      const a = w.arena;
      return {
        x: a.x + a.w / 2, y: a.y + a.h / 2 + 30, r: 5, vx: 0, vy: 0,
        hearts: stats.maxHearts, stats, facing: 1,
        aimX: a.x + a.w / 2, aimY: a.y, aimStick: false, // aimStick: this tick's aim came from a stick direction, not the mouse
        fireCd: 0, dashCd: 0, dashT: 0, dashDX: 0, dashDY: 0,
        invuln: 0, dashInvulnT: 0, hurtT: 0, hurtInvuln: yolo ? 0.7 : HURT_INVULN, dead: false, slow: 1, moving: false, walkT: 0, t: 0, trail: [],
        beatT: 0.3, beatPulse: 0, lowWarned: false,
        kick: 0, idleT: 0, cheerT: 0, dashN: 0, // cosmetic: recoil, idle clock, celebration, dash ticks so far
        dashBufT: 0, refuseDashT: 0, refuseCompactT: 0, // input feel: the early-dash buffer, and the HUD's refusal flashes
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
          w.emit('text', { x: p.x, y: p.y - 12, text: 'last heart!', color: CB.Pal.C.hurt });
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
      p.refuseDashT = Math.max(0, (p.refuseDashT || 0) - dt);
      p.refuseCompactT = Math.max(0, (p.refuseCompactT || 0) - dt);
      p.dashBufT = Math.max(0, (p.dashBufT || 0) - dt);
      const wantCompact = input.compact || w.compactBuffered; // an E pressed during hitstop is cast on the first live tick
      w.compactBuffered = false;
      if (wantCompact && CB.Compact && !CB.Compact.cast(w) && input.compact && w.context && w.context.value < w.context.max) {
        p.refuseCompactT = REFUSE_T; // a press on a meter that is not full: the HUD flashes the meter and a dull tick plays
        w.emit('refuse', { x: p.x, y: p.y, what: 'compact' });
      }
      const sa = stickAim(p, w, input);
      p.aimStick = !!sa;
      p.aimX = sa ? sa.x : input.aimX;
      p.aimY = sa ? sa.y : input.aimY;
      p.facing = p.aimX >= p.x ? 1 : -1;
      const mv = M.norm(input.moveX || 0, input.moveY || 0);

      const wantDash = input.dash || w.dashBuffered || p.dashBufT > EPS; // a press up to DASH_BUFFER early fires when the cooldown ends
      w.dashBuffered = false;
      p.idleT = mv.x !== 0 || mv.y !== 0 || input.fire || wantDash ? 0 : (p.idleT || 0) + dt; // any move, fire or dash input restarts the idle clock
      const canDash = p.dashCd <= EPS && p.dashT <= EPS;
      if (input.dash && !canDash) {
        if (p.dashCd > DASH_BUFFER + EPS) {
          p.refuseDashT = REFUSE_T; // too early to buffer: a dull tick and a flash on the pip
          w.emit('refuse', { x: p.x, y: p.y, what: 'dash' });
        } else p.dashBufT = DASH_BUFFER;
      }
      if (wantDash && canDash) {
        p.dashBufT = 0;
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
      if (sa) {
        const sb = stickAim(p, w, input); // re-anchored on where Clawd ended up, so the shot goes exactly along the stick
        p.aimX = sb.x;
        p.aimY = sb.y;
      }

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
      if (p.hearts === 1 && !p.dead) drawLastHeartRing(p, r, o.w);
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
      if ((p.idleT || 0) >= IDLE_T && !o.noBubble && !waveStartQuiet(tt)) { // no bubble under the stage/boss cards, nor as a wave begins
        const below = !!(o.w && CB.Compact && typeof CB.Compact.ready === 'function' && typeof CB.Compact.promptBelow === 'function' && CB.Compact.ready(o.w) && CB.Compact.promptBelow(p));
        drawThinking(p, r, tt, below);
      }
    },
  };
})(window.CB);
