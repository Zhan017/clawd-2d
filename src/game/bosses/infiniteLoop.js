// The Infinite Loop: a purple centipede that circles the arena; only the head takes damage, and it fans bullets at Clawd.
(function (CB) {
  'use strict';
  const M = CB.M;
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly; 3 - 180/60 is not exactly 0
  const CX = 160;
  const CY = 96;
  const MAX_HP = 150;
  const PHASE2_HP = 0.5 * MAX_HP; // phase 2 begins strictly below this
  const SEGMENTS = 8;
  const MIN_SEGMENTS = 4; // shedding stops here
  const SPACING = 10; // px of head path between neighbouring segments
  const PREFILL = 100; // px of path laid down behind the head at spawn
  const RADIUS = [60, 40]; // circle radius per phase (phase 2 eases)
  const EASE_T = 2; // seconds the radius takes to go from RADIUS[0] to RADIUS[1]
  const ANG_SPEED = [0.9, 1.2]; // phase 2 was 1.4: playtests showed "so close" deaths at the tight ring // rad/s per phase
  const FAN_EVERY = [3.0, 2.5];
  const FAN_SIDE = [1, 2]; // bullets either side of the aim: 3-bullet fan, then 5
  const FAN_STEP = (15 * Math.PI) / 180;
  const FAN_SPEED = 72;
  const FAN_TELE = 0.35; // the head flashes this long before a fan
  const REVERSE_TELE = 0.5;
  const SHED_EVERY = 6;
  const INVULN = 0.5;
  const FRAME_T = 0.25; // jaws chomp at 2 Hz
  const BLINK_HZ = 20;
  const Z_HEAD = 1e6;
  const Z_SEG = 1e5;

  // Head, 18x18, seen head-on: round purple plate, angry white eyes with ink pupils, two antennae and bone-white pincers.
  // Frame 0 holds the pincers shut in a V; frame 1 swings them wide and shows the red mouth. Pixels are mirrored left to right
  // except the highlight; the dark purple shade sits lower right, light falls from the upper left.
  CB.Art.defineSprite('loopHead_0', [
    '.kk............kk.',
    'kppkk........kkppk',
    '.kkpPkkkkkkkkPpkk.',
    '...kppppppppppk...',
    '..kppeeppppppppk..',
    '.kppewwkppkwwpppk.',
    '.kppwwkkppkkwwppk.',
    '.kppwkkwppwkkwppk.',
    '.kpppwwppppwwpppk.',
    '.kppppppppppppPPk.',
    '.kppppppppppPPPPk.',
    '..kWWppppppPPWWk..',
    '..kWeWpppPPPWeWk..',
    '...kWeWkkkkWeWk...',
    '....kWeWkkWeWk....',
    '.....kWeWWeWk.....',
    '......kkeekk......',
    '........kk........',
  ]);
  CB.Art.defineSprite('loopHead_1', [
    '.kk............kk.',
    'kppkk........kkppk',
    '.kkpPkkkkkkkkPpkk.',
    '...kppppppppppk...',
    '..kppeeppppppppk..',
    '.kppewwkppkwwpppk.',
    '.kppwwkkppkkwwppk.',
    '.kppwkkwppwkkwppk.',
    '.kpppwwppppwwpppk.',
    '.kppppppppppppPPk.',
    '.kWWppppppppPPWWk.',
    'kWeppwRWRRWRwPPeWk',
    'kWekpRRRrrRRRPkeWk',
    'kWekkkkkkkkkkkkeWk',
    '.kWek........keWk.',
    '..kWek......keWk..',
    '...kWek....keWk...',
    '....kk......kk....',
  ]);

  // Segments, 12x12: a lit rim round a recessed core that holds a pale `{ }`. The odd segments are the darker twin (an ink core
  // instead of purple), so the body reads as a chain of alternating links.
  CB.Art.defineSprite('loopSegment_0', [
    '....kkkk....',
    '..kkppppkk..',
    '.kppkkkkppk.',
    '.kpWWPPWWpk.',
    'kpkWPPPPWPpk',
    'kpWPPPPPPWpk',
    'kpPWPPPPWPpk',
    'kpPWWPPWWPPk',
    '.kpPPPPPPPk.',
    '.kppPPPPPPk.',
    '..kkpppPkk..',
    '....kkkk....',
  ]);
  CB.Art.defineSprite('loopSegment_1', [
    '....kkkk....',
    '..kkppppkk..',
    '.kppkkkkppk.',
    '.kpeekkeepk.',
    'kpkekkkkekPk',
    'kpekkkkkkePk',
    'kpkekkkkekPk',
    'kpkeekkeekPk',
    '.kpkkkkkkPk.',
    '.kppkkkkPPk.',
    '..kkPPPPkk..',
    '....kkkk....',
  ]);

  // Parts go straight into the world's list: the boss needs all nine of them and the enemy cap must not refuse one.
  function addPart(w, kind, x, y, opts) {
    const e = CB.Enemies[kind].create(w, x, y, opts || {});
    e.kind = kind;
    w.enemies.push(e);
    return e;
  }

  // Parks the segments on the head's recorded path, SPACING px of path length apart, then drops the path nobody needs.
  // Walking the path (rather than chasing the segment in front) keeps them on the circle instead of curling the tail inward.
  function follow(c) {
    const pts = c.path;
    const segs = c.segments;
    let k = 0;
    let acc = 0;
    let j = 1;
    for (; j < pts.length && k < segs.length; j++) {
      const a = pts[j - 1];
      const b = pts[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      while (k < segs.length && acc + d >= SPACING * (k + 1) - EPS) {
        const u = d > EPS ? (SPACING * (k + 1) - acc) / d : 0;
        segs[k].x = a.x + (b.x - a.x) * u;
        segs[k].y = a.y + (b.y - a.y) * u;
        k++;
      }
      acc += d;
    }
    pts.length = Math.min(pts.length, j + 1);
    for (; k < segs.length; k++) {
      // Only if the path were shorter than the body (it never is): park the rest on its oldest point.
      segs[k].x = pts[pts.length - 1].x;
      segs[k].y = pts[pts.length - 1].y;
    }
  }

  // Circle motion, the path record and every part's published velocity.
  function move(c, dt) {
    const h = c.head;
    const segs = c.segments;
    const hx = h.x;
    const hy = h.y;
    for (let i = 0; i < segs.length; i++) {
      c.lx[i] = segs[i].x;
      c.ly[i] = segs[i].y;
    }
    if (c.phase >= 2 && c.radius > RADIUS[1]) c.radius = Math.max(RADIUS[1], c.radius - ((RADIUS[0] - RADIUS[1]) / EASE_T) * dt);
    c.angle += c.dir * c.angSpeed * dt;
    h.x = c.cx + Math.cos(c.angle) * c.radius;
    h.y = c.cy + Math.sin(c.angle) * c.radius;
    c.path.unshift({ x: h.x, y: h.y });
    follow(c);
    h.vx = dt > 0 ? (h.x - hx) / dt : 0;
    h.vy = dt > 0 ? (h.y - hy) / dt : 0;
    for (let i = 0; i < segs.length; i++) {
      segs[i].vx = dt > 0 ? (segs[i].x - c.lx[i]) / dt : 0;
      segs[i].vy = dt > 0 ? (segs[i].y - c.ly[i]) / dt : 0;
    }
    c.x = h.x;
    c.y = h.y;
  }

  function enterPhase(c, w, phase) {
    c.phase = phase;
    c.angSpeed = ANG_SPEED[phase - 1];
    c.fanT = FAN_EVERY[phase - 1]; // the first fan of phase 2 comes a full period after the change
    c.fanTele = false;
    c.head.data.fanTele = false;
    c.head.data.telegraph = false;
    c.reverseT = w.rng.range(4, 6);
    c.shedT = SHED_EVERY;
    c.head.invuln = INVULN;
    w.emit('bossPhase', { x: c.head.x, y: c.head.y, phase });
    w.addShake(4);
  }

  function fireFan(c, w) {
    const h = c.head;
    const p = w.player;
    const aim = M.angleTo(h.x, h.y, p.x, p.y);
    const side = FAN_SIDE[c.phase - 1];
    for (let i = -side; i <= side; i++) w.fireEnemyBullet(h.x, h.y, aim + i * FAN_STEP, FAN_SPEED);
    w.emit('enemyShoot', { x: h.x, y: h.y });
  }

  function fan(c, w, dt) {
    c.fanT -= dt;
    c.fanTele = c.fanT <= FAN_TELE + EPS;
    if (c.fanT <= EPS) {
      fireFan(c, w);
      c.fanT = FAN_EVERY[c.phase - 1];
      c.fanTele = false;
    }
    c.head.data.fanTele = c.fanTele;
  }

  // Phase 2: a 0.5 s white flash, then the circle runs the other way; the next reversal is 4-6 s off.
  function reverse(c, w, dt) {
    c.reverseT -= dt;
    if (c.reverseT <= REVERSE_TELE + EPS) c.head.data.telegraph = true;
    if (c.reverseT <= EPS) {
      c.dir = -c.dir;
      c.head.data.telegraph = false;
      c.reverseT = w.rng.range(4, 6);
    }
  }

  // Phase 2: the tail link drops off silently and hatches a SyntaxError where it stood. The body never gets shorter than 4.
  function shed(c, w, dt) {
    c.shedT -= dt;
    if (c.shedT > EPS) return;
    c.shedT = SHED_EVERY;
    if (c.segments.length <= MIN_SEGMENTS) return;
    const tail = c.segments.pop();
    w.killEnemy(tail, true);
    w.spawnEnemy('syntaxError', tail.x, tail.y);
  }

  // The head died. The segments go quietly; the arrays are kept, because the finale reads the dead parts' positions.
  function defeat(c, w) {
    c.defeated = true;
    c.hp = 0;
    for (const s of c.segments) w.killEnemy(s, true);
    c.fanTele = false;
    c.head.data.fanTele = false;
    c.head.data.telegraph = false;
  }

  function step(c, w, dt) {
    if (c.defeated) return;
    const head = c.head;
    if (head.dead) {
      defeat(c, w);
      return;
    }
    c.hp = Math.max(0, head.hp);
    const target = head.hp < PHASE2_HP ? 2 : 1;
    if (target > c.phase) enterPhase(c, w, target);
    move(c, dt);
    fan(c, w, dt);
    if (c.phase >= 2) {
      reverse(c, w, dt);
      shed(c, w, dt);
    }
  }

  // Both parts are moved by the controller, so their own update does nothing.
  CB.Enemies.loopHead = {
    create(w, x, y) {
      return CB.makeEnemy('loopHead', x, y, {
        hp: MAX_HP, r: 8, targetable: true, solid: false, contact: true, boss: true, regular: false, noContactT: 0.5, z: Z_HEAD,
        data: { telegraph: false, fanTele: false },
      });
    },

    update() {},

    // Telegraphs (the fan, the reversal) blink the whole head white at 20 Hz, through Comfort so calm mode slows it.
    // The jaws gape while a fan is charging.
    draw(e, r, t) {
      const C = CB.Pal.C;
      const tt = t == null ? e.t : t;
      const a = e.alpha == null ? 1 : e.alpha;
      const d = e.data;
      const tele = !!(d.fanTele || d.telegraph);
      const on = tele && (CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(tt, BLINK_HZ) : Math.floor(tt * BLINK_HZ) % 2 === 0);
      const open = !!d.fanTele || Math.floor(e.t / FRAME_T) % 2 === 1;
      r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
      r.sprite('loopHead_' + (open ? 1 : 0), e.x, e.y, { white: e.hitFlash > 0 || on, alpha: e.alpha });
    },
  };

  CB.Enemies.loopSegment = {
    create(w, x, y, opts) {
      const idx = opts && opts.idx ? opts.idx : 0;
      return CB.makeEnemy('loopSegment', x, y, {
        hp: 9999, r: 5, targetable: false, solid: true, contact: true, boss: true, regular: false, noContactT: 0.5, z: Z_SEG - idx,
        data: { idx },
      });
    },

    update() {},

    draw(e, r) {
      const C = CB.Pal.C;
      const a = e.alpha == null ? 1 : e.alpha;
      r.alpha(0.3 * a, () => r.rect(e.x - 3, e.y + 4, 6, 2, C.ink));
      r.sprite('loopSegment_' + (e.data.idx % 2), e.x, e.y, { white: e.hitFlash > 0, alpha: e.alpha });
    },
  };

  CB.Bosses.infiniteLoop = {
    id: 'infiniteLoop',
    name: 'THE INFINITE LOOP',
    tagline: 'while (true) { bite(); }',
    commitMsg: 'fix: add a break condition',
    file: 'loop.js',
    diff: ['- while (true) { bite(); }', '+ while (!done) { bite(); }', '+ if (++n > MAX) break;'],
    portrait: 'loopHead_0',

    // The head, then the segments from head to tail. Dead parts keep their x/y, so this works through the finale too.
    deathPoints(c) {
      const pts = [];
      if (!c || !c.head) return pts;
      const add = (e) => {
        if (e && Number.isFinite(e.x) && Number.isFinite(e.y)) pts.push({ x: e.x, y: e.y });
      };
      add(c.head);
      for (const s of c.segments) add(s);
      return pts;
    },

    create(w) {
      const p = w.player;
      // The head starts on the circle's point farthest from Clawd: the direction from the player through the centre.
      const angle = M.angleTo(p.x, p.y, CX, CY);
      const x = CX + Math.cos(angle) * RADIUS[0];
      const y = CY + Math.sin(angle) * RADIUS[0];
      const head = addPart(w, 'loopHead', x, y);
      const segments = [];
      for (let i = 0; i < SEGMENTS; i++) segments.push(addPart(w, 'loopSegment', x, y, { idx: i }));
      const c = {
        id: 'infiniteLoop', x, y, hp: MAX_HP, maxHp: MAX_HP, phase: 1, defeated: false,
        head, segments, angle, radius: RADIUS[0], angSpeed: ANG_SPEED[0], dir: 1,
        fanT: FAN_EVERY[0], fanTele: false, reverseT: null, shedT: null, path: [], cx: CX, cy: CY, lx: [], ly: [],
        update: (w2, dt) => step(c, w2, dt),
        draw() {}, // no overlay: the parts draw themselves
      };
      // The path starts as the circle behind the head, a pixel at a time, so the body is laid out from the first frame.
      for (let i = 0; i <= PREFILL; i++) {
        const a = angle - (c.dir * i) / c.radius;
        c.path.push({ x: CX + Math.cos(a) * c.radius, y: CY + Math.sin(a) * c.radius });
      }
      follow(c);
      return c;
    },
  };
})(window.CB);
