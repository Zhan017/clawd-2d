// Merge Conflict boss: twin beetles HEAD and incoming that mirror each other, with a crossfire, a conflict-line beam, a phase-2 charge and a 6 s finish window.
(function (CB) {
  'use strict';
  const M = CB.M;
  const C = CB.Pal.C;
  const EPS = 1e-9; // timers are sums of 1/60 steps: 2.8 - 168/60 is +1e-15, not 0
  const CX = 160; // the arena centre the twins mirror through
  const CY = 96;
  const TWIN_HP = 130;
  const MAX_HP = 2 * TWIN_HP;
  const REVIVE_HP = 20;
  const FINISH_HP = 17; // the notch on the mini HP bar: a twin at or below this is in the finish zone
  const PHASE2_HP = 130; // combined hp strictly below this starts phase 2
  const PHASE_INVULN = 0.5;
  const GRACE = 0.5; // contact-free spawn time for every twin
  const WANDER_SPEED = 50;
  const WP_REACH = 4; // a waypoint is re-rolled once the twin is this close
  const RETURN_SPEED = 120; // incoming catching up with its mirror point
  const PERIOD = 2.8; // seconds between attack starts
  const ROT1 = ['crossfire', 'line'];
  const ROT2 = ['crossfire', 'line', 'charge'];
  const BURST = 3;
  const BURST_GAP = 0.12;
  const BULLET_SPEED = 85;
  const LINE_TELE = 0.8;
  const LINE_BEAM = 0.5;
  const CHARGE_TELE = 0.4;
  const CHARGE_DASH = 0.5;
  const CHARGE_SPEED = 160;
  const CHARGE_SKIP = 40; // a twin this close to the player at telegraph start stays put
  const RESOLVE_T = 6.0;
  const FRAME_T = 0.2;
  const SPAWNS = [[90, 56], [230, 56], [90, 136], [230, 136]]; // HEAD's candidates; incoming takes the mirror point
  const REVIVES = [[60, 50], [260, 50], [160, 150]];
  const BAR_W = 24;
  const BAR_H = 3;

  // 16x14 beetles seen from above: angry white eyes under two curved mandibles, a shell with a chevron marking
  // (HEAD wears <, incoming wears >), ink stubs for legs. Frame 0 holds the mandibles open, frame 1 snaps them shut and shifts the legs.
  CB.Art.defineSprite('conflictHead_0', [
    '..kk........kk..',
    '.kbbk......kbbk.',
    '.kbBkkkkkkkkBbk.',
    '..kkbwkbbkwbkk..',
    '...kbwwbbwwbk...',
    '...kkbbbbbbkk...',
    'kkkBbbbbbbbbBkkk',
    '..kBbbbbcbbbBk..',
    'kkkBbbbcbbbbBkkk',
    '..kBbbcbbbbbBk..',
    'kkkBbbbcbbbbBkkk',
    '..kkBbbbcbbBkk..',
    '...kkBBBBBBkk...',
    '....kkkkkkkk....',
  ]);
  CB.Art.defineSprite('conflictHead_1', [
    '.....kk..kk.....',
    '....kbbkkbbk....',
    '...kbBkkkkBbk...',
    '..kkbwkbbkwbkk..',
    '...kbwwbbwwbk...',
    '...kkbbbbbbkk...',
    '..kBbbbbbbbbBk..',
    'kkkBbbbbcbbbBkkk',
    '..kBbbbcbbbbBk..',
    'kkkBbbcbbbbbBkkk',
    '..kBbbbcbbbbBk..',
    'kkkkBbbbcbbBkkkk',
    '...kkBBBBBBkk...',
    '....kkkkkkkk....',
  ]);
  CB.Art.defineSprite('conflictIncoming_0', [
    '..kk........kk..',
    '.kggk......kggk.',
    '.kgGkkkkkkkkGgk.',
    '..kkgwkggkwgkk..',
    '...kgwwggwwgk...',
    '...kkggggggkk...',
    'kkkGggggggggGkkk',
    '..kGgggWggggGk..',
    'kkkGggggWgggGkkk',
    '..kGgggggWggGk..',
    'kkkGggggWgggGkkk',
    '..kkGggWgggGkk..',
    '...kkGGGGGGkk...',
    '....kkkkkkkk....',
  ]);
  CB.Art.defineSprite('conflictIncoming_1', [
    '.....kk..kk.....',
    '....kggkkggk....',
    '...kgGkkkkGgk...',
    '..kkgwkggkwgkk..',
    '...kgwwggwwgk...',
    '...kkggggggkk...',
    '..kGggggggggGk..',
    'kkkGgggWggggGkkk',
    '..kGggggWgggGk..',
    'kkkGgggggWggGkkk',
    '..kGggggWgggGk..',
    'kkkkGggWgggGkkkk',
    '...kkGGGGGGkk...',
    '....kkkkkkkk....',
  ]);

  // The blink rate for flashes above 4 Hz goes through Comfort when it exists (calm mode slows it).
  const blink = (t, hz) => (CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  // The candidate [x, y] farthest from the player; the first one wins ties.
  function farthest(list, p) {
    let best = list[0];
    let bestD = -1;
    for (const c of list) {
      const d = M.dist(c[0], c[1], p.x, p.y);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  // Moves e toward (tx, ty) by at most speed*dt and lands exactly on it when that is within one step.
  function stepToward(e, tx, ty, speed, dt) {
    const d = M.dist(e.x, e.y, tx, ty);
    if (d <= speed * dt) {
      e.x = tx;
      e.y = ty;
    } else {
      e.x += ((tx - e.x) / d) * speed * dt;
      e.y += ((ty - e.y) / d) * speed * dt;
    }
  }

  function wander(w, e, dt) {
    const d = e.data;
    if (!d.wp || M.dist(e.x, e.y, d.wp.x, d.wp.y) <= WP_REACH) d.wp = w.randomPoint(24);
    stepToward(e, d.wp.x, d.wp.y, WANDER_SPEED, dt);
    M.clampToArena(e, w.arena);
  }

  function lineEvent(c) {
    const a = c.head;
    const b = c.incoming;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  // The part kind. The controller moves the twins; this module only draws them.
  CB.Enemies.conflictTwin = {
    create(w, x, y, opts) {
      const o = opts || {};
      return CB.makeEnemy('conflictTwin', x, y, {
        r: 8, hp: o.hp == null ? TWIN_HP : o.hp, maxHp: TWIN_HP, boss: true, regular: false, noContactT: GRACE,
        data: { side: o.side === 'incoming' ? 'incoming' : 'head', wp: null, jit: false },
      });
    },

    update() {},

    draw(e, r, t) {
      const tt = Number.isFinite(t) ? t : e.t;
      const head = e.data.side === 'head';
      const name = (head ? 'conflictHead_' : 'conflictIncoming_') + (Math.floor(e.t / FRAME_T) % 2);
      const def = CB.Art.spriteDef ? CB.Art.spriteDef(name) : null;
      const jx = e.data.jit ? (blink(tt, 30) ? 1 : -1) : 0; // the charge telegraph: a fast 1 px shake
      const a = (e.alpha == null ? 1 : e.alpha) * (e.invuln > 0 && !blink(tt, 14) ? 0.45 : 1);
      r.alpha(0.3, () => r.rect(e.x - e.r, e.y + e.r - 1, e.r * 2, 2, C.ink));
      r.sprite(name, e.x + jx, e.y, { white: e.hitFlash > 0, alpha: a });

      // 24x3 HP bar, 4 px above the sprite: ink background, own-colour fill, a white notch where the finish zone (17 HP) begins.
      const top = Math.round(e.y - (def ? def.h : 14) / 2);
      const bx = Math.round(e.x) - BAR_W / 2;
      const by = top - 4 - BAR_H;
      const frac = M.clamp(e.hp / e.maxHp, 0, 1);
      const fw = e.hp > 0 ? Math.max(1, Math.round(BAR_W * frac)) : 0;
      const finish = e.hp > 0 && e.hp <= FINISH_HP;
      const col = finish && blink(tt, 6) ? C.gold : head ? C.blue : C.green;
      r.alpha(0.5, () => r.frame(bx - 1, by - 1, BAR_W + 2, BAR_H + 2, C.greyDark));
      r.rect(bx, by, BAR_W, BAR_H, C.ink);
      if (fw > 0) r.rect(bx, by, fw, BAR_H, col);
      r.rect(bx + Math.round((BAR_W * FINISH_HP) / TWIN_HP), by, 1, BAR_H, C.white);

      // Tiny <<<<<<< above HEAD and >>>>>>> above incoming: seven 3 px chevrons.
      const lc = head ? C.cyan : C.green;
      const ly = by - 4;
      const lx = Math.round(e.x) - 10;
      for (let i = 0; i < 7; i++) {
        const x = lx + i * 3;
        const xa = head ? x + 1 : x; // the tip column and the open column
        const xb = head ? x : x + 1;
        r.rect(xa, ly, 1, 1, lc);
        r.rect(xb, ly + 1, 1, 1, lc);
        r.rect(xa, ly + 2, 1, 1, lc);
      }
    },
  };

  // ---- the controller ------------------------------------------------------------------------------------------------------

  function spawnTwin(w, x, y, side, hp, force) {
    const e = w.spawnEnemy('conflictTwin', x, y, { side, hp });
    if (e || !force) return e;
    // The boss cannot exist without its twins, so creation ignores the entity cap.
    const forced = CB.Enemies.conflictTwin.create(w, x, y, { side, hp });
    forced.kind = 'conflictTwin';
    w.enemies.push(forced);
    return forced;
  }

  // hp = sum of the living twins' hp, x/y = their midpoint (unchanged when none is alive).
  function refresh(c) {
    let hp = 0;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of [c.head, c.incoming]) {
      if (e.dead) continue;
      hp += Math.max(0, e.hp);
      sx += e.x;
      sy += e.y;
      n++;
    }
    c.hp = Math.max(0, hp);
    if (n) {
      c.x = sx / n;
      c.y = sy / n;
    }
  }

  function defeat(c, w) {
    for (const e of w.enemies) if (!e.dead && e.kind === 'conflictTwin') w.killEnemy(e, true);
    c.defeated = true;
    c.hp = 0;
    c.resolveT = null;
    c.deadSide = null;
    c.attack = null;
    c.head.data.jit = false;
    c.incoming.data.jit = false;
    c.x = (c.head.x + c.incoming.x) / 2; // where the finale starts: between the two last positions
    c.y = (c.head.y + c.incoming.y) / 2;
  }

  // A missed window brings the dead twin back at 20 HP, as far from the player as one of three spots allows (always the farthest, so >= 70 px
  // whenever any of them is). At the entity cap nothing spawns and the next tick tries again.
  function reviveTwin(c, w) {
    const spot = farthest(REVIVES, w.player);
    const side = c.deadSide;
    const e = w.spawnEnemy('conflictTwin', spot[0], spot[1], { side, hp: REVIVE_HP });
    if (!e) return;
    if (side === 'head') c.head = e;
    else c.incoming = e;
    c.resolveT = null;
    c.deadSide = null;
    w.emit('revive', { x: e.x, y: e.y });
    w.emit('text', { x: e.x, y: e.y - 12, text: 'merge failed', color: C.red });
  }

  // One twin down opens a 6 s window to finish the other; the window re-opens whenever exactly one twin is dead.
  function resolve(c, w, dt) {
    const headDead = c.head.dead;
    if (headDead === c.incoming.dead) {
      c.resolveT = null;
      c.deadSide = null;
      return;
    }
    if (c.resolveT == null) {
      c.deadSide = headDead ? 'head' : 'incoming';
      c.resolveT = RESOLVE_T;
      const survivor = headDead ? c.incoming : c.head;
      w.emit('text', { x: CX, y: CY, text: 'FINISH ' + survivor.data.side.toUpperCase() + '!', color: C.gold });
      return;
    }
    c.resolveT -= dt;
    if (c.resolveT <= EPS) reviveTwin(c, w);
  }

  function checkPhase(c, w) {
    if (c.phase >= 2 || !(c.hp < PHASE2_HP)) return;
    c.phase = 2;
    c.attackT = PERIOD; // the first attack of the new phase is a full period away
    w.emit('bossPhase', { x: c.x, y: c.y, phase: 2 });
    w.addShake(4);
    for (const e of [c.head, c.incoming]) if (!e.dead) e.invuln = PHASE_INVULN;
  }

  function startAttack(c, w, kind) {
    const alive = [c.head, c.incoming].filter((e) => !e.dead);
    if (!alive.length) return;
    const k = kind === 'line' && alive.length < 2 ? 'crossfire' : kind; // the line needs both twins
    const a = { kind: k, t: 0, n: 0, fired: false, go: false, movers: [] };
    if (k === 'line') w.emit('beamCharge', lineEvent(c));
    else if (k === 'charge') {
      const p = w.player;
      for (const e of alive) if (M.dist(e.x, e.y, p.x, p.y) > CHARGE_SKIP) a.movers.push({ e, dx: 0, dy: 0 });
    }
    c.attack = a;
  }

  function volley(c, w) {
    const p = w.player;
    for (const e of [c.head, c.incoming]) {
      if (e.dead) continue;
      w.fireEnemyBullet(e.x, e.y, Math.atan2(p.y - e.y, p.x - e.x), BULLET_SPEED);
      w.emit('enemyShoot', { x: e.x, y: e.y });
    }
  }

  function stepAttack(c, w, dt) {
    const a = c.attack;
    if (!a) return;
    a.t += dt;
    const p = w.player;
    if (a.kind === 'crossfire') {
      while (a.n < BURST && a.t >= a.n * BURST_GAP - EPS) {
        volley(c, w);
        a.n++;
      }
      if (a.n >= BURST) c.attack = null;
    } else if (a.kind === 'line') {
      if (c.head.dead || c.incoming.dead || a.t >= LINE_TELE + LINE_BEAM - EPS) {
        c.attack = null;
        return;
      }
      if (!a.fired && a.t >= LINE_TELE - EPS) {
        a.fired = true;
        w.emit('beam', lineEvent(c));
      }
      if (a.fired && M.circleSegment(p.x, p.y, p.r + 1, c.head.x, c.head.y, c.incoming.x, c.incoming.y)) w.hurtPlayer(null);
    } else if (a.kind === 'charge') {
      if (a.t >= CHARGE_TELE + CHARGE_DASH - EPS) {
        c.attack = null;
        return;
      }
      const going = a.t >= CHARGE_TELE - EPS;
      if (going && !a.go) {
        a.go = true; // lock each heading on the player's position at the moment the dash starts
        for (const m of a.movers) {
          const h = M.norm(p.x - m.e.x, p.y - m.e.y);
          m.dx = h.x;
          m.dy = h.y;
        }
      }
      for (const m of a.movers) {
        if (m.e.dead) continue;
        if (!going) {
          m.e.data.jit = true;
          continue;
        }
        m.e.x += m.dx * CHARGE_SPEED * dt;
        m.e.y += m.dy * CHARGE_SPEED * dt;
        M.clampToArena(m.e, w.arena);
      }
    }
  }

  // The next attack of the rotation (phase 2 adds the charge). A line that falls back to crossfire still uses up its slot.
  function nextKind(c) {
    const rot = c.phase >= 2 ? ROT2 : ROT1;
    return rot[c.attackIdx++ % rot.length];
  }

  function update(c, w, dt) {
    if (c.defeated) return;
    if (c.head.dead && c.incoming.dead) {
      defeat(c, w);
      return;
    }
    resolve(c, w, dt);
    const list = [c.head, c.incoming]; // after a revive these are the new entities
    const was = list.map((e) => ({ x: e.x, y: e.y }));
    for (const e of list) e.data.jit = false;
    refresh(c);
    checkPhase(c, w);

    c.attackT -= dt;
    if (c.attackT <= EPS && !c.attack) {
      c.attackT += PERIOD;
      startAttack(c, w, nextKind(c));
    }
    const a = c.attack;
    if (!(a && (a.kind === 'line' || a.kind === 'charge'))) {
      // HEAD roams; incoming holds the point mirrored through the arena centre (catching up at up to 120 px/s), or roams alone once HEAD is dead.
      if (!c.head.dead) wander(w, c.head, dt);
      if (!c.incoming.dead) {
        if (c.head.dead) wander(w, c.incoming, dt);
        else {
          stepToward(c.incoming, 2 * CX - c.head.x, 2 * CY - c.head.y, RETURN_SPEED, dt);
          M.clampToArena(c.incoming, w.arena);
        }
      }
    }
    stepAttack(c, w, dt);

    list.forEach((e, i) => {
      e.vx = dt > 0 ? (e.x - was[i].x) / dt : 0;
      e.vy = dt > 0 ? (e.y - was[i].y) / dt : 0;
    });
    refresh(c);
  }

  // A 3 px line: the centre line plus one either side across the minor axis.
  function thick(r, x1, y1, x2, y2, color) {
    const flat = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
    const ox = flat ? 0 : 1;
    const oy = flat ? 1 : 0;
    r.line(x1 - ox, y1 - oy, x2 - ox, y2 - oy, color);
    r.line(x1, y1, x2, y2, color);
    r.line(x1 + ox, y1 + oy, x2 + ox, y2 + oy, color);
  }

  function arrowDown(r, x, y, color) {
    r.rect(x - 1, y, 3, 2, color);
    r.rect(x - 3, y + 2, 7, 1, color);
    r.rect(x - 2, y + 3, 5, 1, color);
    r.rect(x - 1, y + 4, 3, 1, color);
    r.rect(x, y + 5, 1, 1, color);
  }

  // Overlays only: the line telegraph and beam, the charge marks and the finish banner. The twins draw themselves.
  function draw(c, r, time) {
    if (c.defeated) return;
    const t = Number.isFinite(time) ? time : 0;
    const a = c.attack;
    const h = c.head;
    const i = c.incoming;
    if (a && a.kind === 'line' && !h.dead && !i.dead) {
      const x1 = Math.round(h.x);
      const y1 = Math.round(h.y);
      const x2 = Math.round(i.x);
      const y2 = Math.round(i.y);
      if (a.t < LINE_TELE) {
        const k = a.t / LINE_TELE;
        r.alpha(0.35, () => r.line(x1, y1, x2, y2, C.hurt));
        if (blink(t, 12)) r.line(x1, y1, x2, y2, C.hurt);
        const rad = Math.round(13 - 5 * k); // a ring tightening on each twin as the beam charges
        r.ring(x1, y1, rad, C.hurt);
        r.ring(x2, y2, rad, C.hurt);
      } else {
        thick(r, x1, y1, x2, y2, C.red);
        r.line(x1, y1, x2, y2, C.white);
        r.ring(x1, y1, 11, C.white);
        r.ring(x2, y2, 11, C.white);
      }
    }
    if (a && a.kind === 'charge' && a.t < CHARGE_TELE) {
      for (const m of a.movers) {
        if (m.e.dead) continue;
        const ex = Math.round(m.e.x);
        const ey = Math.max(22, Math.round(m.e.y) - 28);
        r.rect(ex, ey, 1, 4, C.hurt); // a red ! over each twin that is about to charge
        r.rect(ex, ey + 5, 1, 1, C.hurt);
      }
    }
    if (c.resolveT != null) {
      const survivor = c.deadSide === 'head' ? i : h;
      const urgent = c.resolveT < 2 && blink(t, 6);
      r.text('FINISH ' + survivor.data.side.toUpperCase() + '!', c.cx, 30, { align: 'center', color: urgent ? C.hurt : C.gold, shadow: C.ink });
      const left = Math.max(0, c.resolveT); // a revive blocked by the entity cap lets resolveT sink below 0 until it can spawn
      r.text(left.toFixed(1), c.cx, 39, { align: 'center', color: C.white, shadow: C.ink });
      r.rect(c.cx - 30, 48, 60, 2, C.ink);
      r.rect(c.cx - 30, 48, Math.round((60 * left) / RESOLVE_T), 2, urgent ? C.hurt : C.gold);
      if (blink(t, 5)) arrowDown(r, Math.round(survivor.x), Math.max(22, Math.round(survivor.y) - 28 + Math.round(Math.sin(t * 8))), C.gold);
    }
  }

  CB.Bosses.mergeConflict = {
    id: 'mergeConflict',
    name: 'MERGE CONFLICT',
    tagline: '<<<<<<< HEAD',
    commitMsg: 'fix: resolve merge conflict',
    file: 'merge.js',
    diff: ['- <<<<<<< HEAD', '- =======', '- >>>>>>> incoming', '+ // kept both. you are welcome'],
    portrait: 'conflictHead_0',

    // Both twins' last positions (the dead ones keep theirs) plus their midpoint.
    deathPoints(c) {
      const fin = (v, d) => (Number.isFinite(v) ? v : d);
      const ax = fin(c.head.x, CX);
      const ay = fin(c.head.y, CY);
      const bx = fin(c.incoming.x, CX);
      const by = fin(c.incoming.y, CY);
      return [{ x: ax, y: ay }, { x: bx, y: by }, { x: (ax + bx) / 2, y: (ay + by) / 2 }];
    },

    create(w) {
      const at = farthest(SPAWNS, w.player);
      const head = spawnTwin(w, at[0], at[1], 'head', TWIN_HP, true);
      const incoming = spawnTwin(w, 2 * CX - at[0], 2 * CY - at[1], 'incoming', TWIN_HP, true);
      const c = {
        id: 'mergeConflict', x: (head.x + incoming.x) / 2, y: (head.y + incoming.y) / 2, hp: MAX_HP, maxHp: MAX_HP, phase: 1, defeated: false,
        head, incoming, resolveT: null, deadSide: null, attackT: PERIOD, attackIdx: 0, attack: null, cx: CX, cy: CY,
      };
      c.startAttack = (kind) => startAttack(c, w, kind);
      c.update = (w2, dt) => update(c, w2, dt);
      c.draw = (r, t) => draw(c, r, t);
      return c;
    },
  };
})(window.CB);
