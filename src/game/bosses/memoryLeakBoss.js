// Memory Leak, boss 2: a giant slime that heals and swells while Clawd holds fire, lobs puddle blobs and splits into memoryLeaks.
(function (CB) {
  'use strict';
  const M = CB.M;
  const C = CB.Pal.C;
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly: 150 steps leave 2.5 as 3.9e-15, and 90 leave 1.5 as 1.4999999999999996
  const MAX_HP = 260;
  const BODY_R = 14; // the hitbox radius at size 1; it is BODY_R * size
  const MAX_SIZE = 2;
  const SHRINK_PER_HP = 0.0052; // size lost per point of damage (a full kill shrinks it as much as it did at 340 HP)
  const LEAK_AFTER = 1.5; // seconds without a hit before it heals and swells
  const HEAL_RATE = 3; // HP per second (about 1.2% of its health a second, as at 340 HP)
  const GROW_RATE = 0.1; // size per second
  const DRIFT = 18; // px/s toward Clawd at size 1, divided by size
  const FACE_DEADZONE = 4; // px: the slime turns to face Clawd only past this, so a near-vertical approach does not flip it
  const WOBBLE_T = 0.35;
  const INVULN_ON_PHASE = 0.5;
  const LOB_EVERY = 2.5;
  const LOB_FLIGHT = 1.0;
  const LOB_SPREAD = 24; // blobs land within this many px of Clawd, uniform over the disc
  const ARC_HEIGHT = 22; // the parabola's apex over the straight line, in px (drawing only)
  const PUDDLE_R = 12;
  const PUDDLE_LIFE = 4.5; // seconds; puddles hurt on contact, so they clear a little sooner than the 6 s they had as slow-only zones
  const SPLIT_FRACS = [0.66, 0.33];
  const SPLIT_DIST = 20; // px from the body's centre
  const SPLIT_TURN = Math.PI / 3; // the second split is turned 60 degrees from the first, so a double split never stacks
  const PHASE2_FRAC = 0.5;
  const RING_EVERY = 4;
  const RING_BULLETS = 8;
  const RING_SPEED = 70;
  const SPAWNS = [{ x: 160, y: 60 }, { x: 80, y: 96 }, { x: 240, y: 96 }];
  const SHADOW = [[-2, 5], [-1, 9], [0, 11], [1, 9], [2, 5]]; // [dy, width] rows of the blob's ground shadow, centred on its target
  const blink = (t, hz) => (CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  // 28x22 slime in two poses: tall, with a short left drip and a long right one, and squashed wide with the drips swapped
  // and the eyes narrowed. Shine on the top left, a dark rim on the right and underneath, two bubbles, a toothy grin.
  // The silhouette is mirror-symmetric down to the grin; only the drips are uneven.
  CB.Art.defineSprite('leakBoss_0', [
    '..........kkkkkkkk..........',
    '.......kkkgwwgggGGkkk.......',
    '.....kkgwwwgggggggGGGkk.....',
    '....kgwwggggggGGGgggGGGk....',
    '...kgwggggggggGgGggggGGGk...',
    '..kgwgggggggggGGGgggggGGGk..',
    '..kgwgggggggggggggggggGGGk..',
    '.kgggggggggggggggggggggGGGk.',
    '.kgggggkkkkggggggkkkkgGGGGk.',
    '.kggggkwwwwkggggkwwwwkGGGGk.',
    '.kggggkwwkkkggggkwwkkkGGGGk.',
    '.kgGGGkwwkkkggggkwwkkkGGGGk.',
    '.kgGgGgkkkkggggggkkkkgGGGGk.',
    '.kgGGGggggggggggggggggGGGGk.',
    '.kgggggkwRwRwRwRwRwRkgGGGGk.',
    '.kggggggkkRRrrrrRRkkggGGGGk.',
    '.kGGGGGggkkkkkkkkkkggGGGGGk.',
    '.kGGGGGGGGGGGGGGGGGGGGGGGGk.',
    '..kkkkkgGkkkkkkkkkkgGGkkkk..',
    '......kgGk........kgGGk.....',
    '.......kk.........kgGGk.....',
    '...................kkk......',
  ]);
  CB.Art.defineSprite('leakBoss_1', [
    '............................',
    '............................',
    '............................',
    '.........kkkkkkkkkk.........',
    '......kkkgwwgggggGGkkk......',
    '....kkgwwwggggGGGggGGGkk....',
    '...kgwwgggggggGgGggggGGGk...',
    '..kgwgggggggggGGGgggggGGGk..',
    '.kgwgggggggggggggggggggGGGk.',
    'kgwgggggggggggggggggggggGGGk',
    'kggggggkkkkggggggkkkkgggGGGk',
    'kgggggkwwwwkggggkwwwwkgGGGGk',
    'kggGGGkwwkkkggggkwwkkkgGGGGk',
    'kggGgGgkkkkggggggkkkkggGGGGk',
    'kggGGGgggggggggggggggggGGGGk',
    'kggggggkwRwRwRwRwRwRkggGGGGk',
    'kgggggggkkRRrrrrRRkkgggGGGGk',
    'kGGGGGGggkkkkkkkkkkggGGGGGGk',
    'kGGGGGGGGGGGGGGGGGGGGGGGGGGk',
    '.kkkkkkgGkkkkkkkkkkgGGkkkkk.',
    '......kgGk.........kkk......',
    '.......kk...................',
  ]);
  // 6x6 droplet in flight, round and then squashed.
  CB.Art.defineSprite('leakBlob_0', ['.kkkk.', 'kgwggk', 'kwgggk', 'kgggGk', 'kgGGGk', '.kkkk.']);
  CB.Art.defineSprite('leakBlob_1', ['......', '.kkkk.', 'kgwggk', 'kgggGk', 'kGGGGk', '.kkkk.']);

  const ctrlOf = new WeakMap(); // body -> its controller, so the body's own onHit can reach size and the idle clock

  // The body: a big targetable boss part. The controller moves, heals and grows it; the hit rule lives here.
  CB.Enemies.leakBoss = {
    create(w, x, y) {
      // z -1 keeps the slime under everything else, so the memoryLeaks it spawns and Clawd's sparks draw over its hitbox disc.
      return CB.makeEnemy('leakBoss', x, y, { hp: MAX_HP, r: BODY_R, boss: true, regular: false, noContactT: 0.5, z: -1 });
    },

    update() {},

    // Every point of damage also shrinks it, and the idle clock that gates the leak starts over.
    onHit(e, w, dmg) {
      e.hp -= dmg;
      const c = ctrlOf.get(e);
      if (c) {
        c.idleT = 0;
        c.size = Math.max(1, c.size - SHRINK_PER_HP * dmg);
      }
      return dmg;
    },

    // Translucent disc at the true hitbox radius (it grows with size while the sprite does not), the slime, and a heap gauge above.
    draw(e, r) {
      const size = e.r / BODY_R;
      const pct = Math.round(100 * M.clamp(size - 1, 0, 1)); // the label reads the wall gauge's own number: 0 % at size 1, full at size 2
      r.alpha(0.35, () => r.disc(e.x, e.y, e.r, C.green));
      r.alpha(0.6, () => r.ring(e.x, e.y, e.r, C.green));
      const white = e.hitFlash > 0 || (e.invuln > 0 && blink(e.t, 16)); // a hit, or the phase change's invulnerability
      r.sprite('leakBoss_' + (Math.floor(e.t / WOBBLE_T) % 2), e.x, e.y, { flip: e.facing < 0, white, alpha: e.alpha });
      const top = Math.max(CB.ARENA.y + 1, e.y - e.r - 9); // never up into the HUD, even full size against the top wall
      const f = size - 1; // the Arena's heap thermometer: green to 50 %, yellow to 80 %, red above; the label uses the same bands
      r.text('heap ' + pct + '%', e.x, top, { align: 'center', color: f < 0.5 ? C.green : f < 0.8 ? C.yellow : C.red, shadow: C.ink });
    },
  };

  // A lobbed blob: flies the straight line from the body to its target in one second, then lands as a puddle. The arc is only drawn.
  CB.Enemies.leakBlob = {
    create(w, x, y, opts) {
      const o = opts || {};
      const tx = M.isFiniteNum(o.tx) ? o.tx : x;
      const ty = M.isFiniteNum(o.ty) ? o.ty : y;
      return CB.makeEnemy('leakBlob', x, y, {
        hp: 1, r: 4, targetable: false, solid: false, contact: false, boss: true, regular: false, noContactT: 0.5, z: 1e5,
        data: { sx: x, sy: y, tx, ty, t: 0, dur: LOB_FLIGHT },
      });
    },

    update(e, w, dt) {
      const d = e.data;
      const ox = e.x;
      const oy = e.y;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      e.x = M.lerp(d.sx, d.tx, k);
      e.y = M.lerp(d.sy, d.ty, k);
      e.vx = dt > 0 ? (e.x - ox) / dt : 0;
      e.vy = dt > 0 ? (e.y - oy) / dt : 0;
      if (d.t >= d.dur - EPS) {
        w.addHazard({ kind: 'puddle', x: d.tx, y: d.ty, r: PUDDLE_R, life: PUDDLE_LIFE, slow: 0.5 });
        w.emit('splat', { x: d.tx, y: d.ty });
        w.killEnemy(e, true); // silent: the splat above is its burst
      }
    },

    // Ground shadow and a faint puddle preview at the target (both firm up as it nears), and the droplet on its parabola.
    draw(e, r) {
      const d = e.data;
      const k = Math.min(1, d.t / d.dur);
      r.alpha(0.3 + 0.35 * k, () => {
        for (const [dy, wd] of SHADOW) r.rect(d.tx - (wd - 1) / 2, d.ty + dy, wd, 1, C.ink);
      });
      // The landing mark: a 2 px yellow rim that firms up as the blob nears, with an inner ring shrinking onto the spot (static in calm mode).
      r.alpha(0.55 + 0.4 * k, () => {
        r.ring(d.tx, d.ty, PUDDLE_R, C.yellow);
        r.ring(d.tx, d.ty, PUDDLE_R - 1, C.yellow);
      });
      const calm = !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());
      const inner = calm ? Math.round(PUDDLE_R / 2) : Math.max(1, Math.round((PUDDLE_R - 2) * (1 - k)));
      r.alpha(0.9, () => r.ring(d.tx, d.ty, inner, C.white));
      r.sprite('leakBlob_' + (Math.floor(e.t / 0.12) % 2), e.x, e.y - 4 * k * (1 - k) * ARC_HEIGHT); // a true parabola: 0 at both ends, ARC_HEIGHT at k = 0.5
    },
  };

  // Moves the body toward Clawd at 18 / size px/s, keeps it in the arena, publishes the velocity it really had and turns it to face Clawd.
  function drift(c, w, dt) {
    const b = c.body;
    const p = w.player;
    const ox = b.x;
    const oy = b.y;
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1e-6) {
      const step = Math.min((DRIFT / c.size) * dt, dist); // never overshoots, so a body parked on Clawd stays put
      b.x += (dx / dist) * step;
      b.y += (dy / dist) * step;
    }
    M.clampToArena(b, w.arena);
    b.vx = dt > 0 ? (b.x - ox) / dt : 0;
    b.vy = dt > 0 ? (b.y - oy) / dt : 0;
    if (dx > FACE_DEADZONE) b.facing = 1;
    else if (dx < -FACE_DEADZONE) b.facing = -1;
  }

  // Three big memoryLeaks around the body, 120 degrees apart. Plain spawns: never elite, nothing copied from the boss.
  function split(c, w, turn) {
    const b = c.body;
    for (let i = 0; i < 3; i++) {
      const a = turn + (i * 2 * Math.PI) / 3;
      const spot = { x: b.x + Math.cos(a) * SPLIT_DIST, y: b.y + Math.sin(a) * SPLIT_DIST, r: 6 };
      M.clampToArena(spot, w.arena);
      w.spawnEnemy('memoryLeak', spot.x, spot.y); // null at the enemy cap: that blob is simply not born
    }
    w.emit('splat', { x: b.x, y: b.y });
  }

  // 2 blobs (3 in phase 2), each aimed at a point uniform over the 24 px disc around Clawd and kept far enough inside the arena
  // for the whole puddle to sit on the floor.
  function lob(c, w) {
    const b = c.body;
    const p = w.player;
    w.emit('lob', { x: b.x, y: b.y });
    const n = c.phase >= 2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const ang = w.rng.angle();
      const rad = LOB_SPREAD * Math.sqrt(w.rng.next());
      const target = { x: p.x + Math.cos(ang) * rad, y: p.y + Math.sin(ang) * rad, r: PUDDLE_R };
      M.clampToArena(target, w.arena);
      w.spawnEnemy('leakBlob', b.x, b.y, { tx: target.x, ty: target.y });
    }
  }

  // Eight bullets from the body's centre; every other ring is turned half a step so the gaps move.
  function ring(c, w) {
    const b = c.body;
    const turn = c.ringN % 2 === 1 ? Math.PI / RING_BULLETS : 0;
    c.ringN++;
    for (let i = 0; i < RING_BULLETS; i++) w.fireEnemyBullet(b.x, b.y, turn + (i * 2 * Math.PI) / RING_BULLETS, RING_SPEED);
    w.emit('enemyShoot', { x: b.x, y: b.y });
  }

  // The body died: end the fight, and silently clear everything the boss still owns (blobs in flight).
  function defeat(c, w) {
    c.defeated = true;
    c.hp = 0;
    for (const e of w.enemies) if (!e.dead && (e.kind === 'leakBlob' || e.kind === 'leakBoss')) w.killEnemy(e, true);
  }

  CB.Bosses.memoryLeakBoss = {
    id: 'memoryLeakBoss',
    name: 'MEMORY LEAK',
    tagline: 'heap: 99% used',
    commitMsg: 'fix: free() what you malloc()',
    file: 'heap.c',
    diff: ['- p = malloc(HEAP);', '+ p = malloc(HEAP);', '+ free(p);'],
    portrait: 'leakBoss_0',

    // The centre, then 7 points evenly around a ring at 0.7 r. Read from the body, which keeps its position and radius when dead.
    deathPoints(c) {
      const b = c.body;
      const pts = [{ x: b.x, y: b.y }];
      for (let i = 0; i < 7; i++) {
        const a = (i * 2 * Math.PI) / 7;
        pts.push({ x: b.x + Math.cos(a) * b.r * 0.7, y: b.y + Math.sin(a) * b.r * 0.7 });
      }
      return pts;
    },

    create(w) {
      const p = w.player;
      let at = SPAWNS[0];
      let far = -1;
      for (const s of SPAWNS) {
        const d = M.dist(s.x, s.y, p.x, p.y);
        if (d > far) { // strictly: the first listed wins a tie
          far = d;
          at = s;
        }
      }
      const body = w.spawnEnemy('leakBoss', at.x, at.y);
      const c = {
        id: 'memoryLeakBoss', x: body.x, y: body.y, hp: body.hp, maxHp: MAX_HP, phase: 1, defeated: false,
        body, size: 1, radius: body.r, // size (1..2) is read by the Arena's heap overlay, radius (= body.r) by Fx to place the phase quip
        idleT: 0, lobT: LOB_EVERY, ringT: RING_EVERY, ringN: 0, split66: false, split33: false,

        update(world, dt) {
          const b = c.body;
          if (b.dead) {
            defeat(c, world);
            return;
          }
          c.idleT += dt;
          if (c.idleT >= LEAK_AFTER - EPS) {
            b.hp = Math.min(c.maxHp, b.hp + HEAL_RATE * dt);
            c.size = Math.min(MAX_SIZE, c.size + GROW_RATE * dt);
          }
          b.r = BODY_R * c.size;
          c.radius = b.r;
          drift(c, world, dt);
          c.x = b.x;
          c.y = b.y;
          c.hp = b.hp;

          // Thresholds are strict and latch, so healing back over one never repeats it.
          if (c.phase < 2 && b.hp < PHASE2_FRAC * c.maxHp) {
            c.phase = 2;
            c.ringT = RING_EVERY; // the first ring comes a full period after the change
            b.invuln = INVULN_ON_PHASE;
            world.emit('bossPhase', { x: b.x, y: b.y, phase: 2 });
            world.addShake(4);
          } else if (c.phase >= 2) {
            c.ringT -= dt;
            if (c.ringT <= EPS) {
              c.ringT += RING_EVERY;
              ring(c, world);
            }
          }
          if (!c.split66 && b.hp < SPLIT_FRACS[0] * c.maxHp) {
            c.split66 = true;
            split(c, world, -Math.PI / 2);
          }
          if (!c.split33 && b.hp < SPLIT_FRACS[1] * c.maxHp) {
            c.split33 = true;
            split(c, world, -Math.PI / 2 + SPLIT_TURN);
          }

          c.lobT -= dt;
          if (c.lobT <= EPS) {
            c.lobT += LOB_EVERY;
            lob(c, world);
          }
        },

        draw() {}, // the parts draw themselves; the HUD owns the health bar
      };
      ctrlOf.set(body, c);
      return c;
    },
  };
})(window.CB);
