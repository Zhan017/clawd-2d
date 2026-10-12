// The Heisenbug: a glitchy moth that teleports when watched, hides behind decoys, then spirals bullets and summons NullPointers.
(function (CB) {
  'use strict';
  const M = CB.M;
  const TAU = Math.PI * 2;
  const EPS = 1e-9; // timers are sums of 1/60 steps: 2.0 s can land on 1.9999999999999991

  const MAX_HP = 240;
  const PHASE2_HP = 144; // 60% of 240. A phase begins strictly below its threshold and never reverts.
  const PHASE3_HP = 60; // 25%
  const PHASE_INVULN = 0.5;
  const BODY_R = 9;
  const SPAWN_GRACE = 0.5; // a new part does no contact damage for this long
  const CANDIDATES = [{ x: 160, y: 50 }, { x: 60, y: 96 }, { x: 260, y: 96 }];

  const OBSERVE_R = 14; // the aim has to stay this close to the real body...
  const OBSERVE_T = 2.0; // ...for this long, and it jumps
  const OBSERVE_FLASH = 1.0; // the body flashes white once at this mark
  const OBSERVE_RED = 1.5; // the eye over the ring turns red
  const FLASH_LEN = 0.12;
  const RING_DOTS = 16;
  const JUMP_MARGIN = 24;
  const JUMP_MIN = 80; // a jump lands at least this far from Clawd

  const FADE = 0.3; // each half of a blink
  const BLINK_MIN = 2.5;
  const BLINK_MAX = 3.5;
  const BLINK_P3 = 5;
  const RING_N = 10;
  const DECOY_RING_N = 6;
  const RING_SPEED = 75;
  const DECOYS = 2;
  const DECOY_MIN = 60; // from Clawd
  const DECOY_GAP = 24; // from the body and from each other
  const DECOY_TRIES = 8;

  const SPIRAL_EVERY = 0.25;
  const SPIRAL_SPEED = 70;
  const SPIRAL_SPIN = 2.2; // rad/s
  const SUMMON_FIRST = 2; // Rule 6 exception: phase 3 opens with a summon after 2 s, not a full 8
  const SUMMON_EVERY = 8;
  const SUMMON_CAP = 4; // nullPointers alive or queued
  const SUMMON_N = 2;

  const FRAME_T = 0.08;
  const FRAMES = 3;
  const FLUTTER = [0, 1, 2, 1]; // sprite frames in order: open, half, closed, half
  const FLICKER_HZ = 16; // the main sprite flickers while it fades, behind the RGB copies
  const GLITCH_EVERY = 1.7; // body and decoys widen their RGB split together for GLITCH_LEN seconds
  const GLITCH_LEN = 0.1;

  // 16x14 moth seen from above, symmetric: pale wings with a gold eyespot each (it watches back), a banded grey body and red eyes.
  // Three frames of wing flutter: open, half closed, nearly closed. Every edge of every wing carries the ink outline.
  CB.Art.defineSprite('heisenbug_0', [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '.kkkkkrSSrkkkkk.',
    'kwWWekRSSRkeWWwk',
    'kWYqYekSSkeYqYWk',
    'kWqkqekSSkeqkqWk',
    'kWYqYekSSkeYqYWk',
    '.kWWWeksskeWWWk.',
    '..kkWekSSkeWkk..',
    '.kssWeksskeWssk.',
    '.kSsWekSSkeWsSk.',
    '..kkkkksskkkkk..',
    '.......kk.......',
  ]);
  CB.Art.defineSprite('heisenbug_1', [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '..kkkkrSSrkkkk..',
    '.kwWekRSSRkeWwk.',
    '.kWYqekSSkeqYWk.',
    '.kWqkekSSkekqWk.',
    '.kWYqekSSkeqYWk.',
    '..kWWeksskeWWk..',
    '...kWekSSkeWk...',
    '..ksWeksskeWsk..',
    '..kSWekSSkeWSk..',
    '...kkkksskkkk...',
    '.......kk.......',
  ]);
  CB.Art.defineSprite('heisenbug_2', [
    '...kk......kk...',
    '.....k....k.....',
    '......kkkk......',
    '...kkkrSSrkkk...',
    '..kwekRSSRkewk..',
    '..kWqekSSkeqWk..',
    '..kWkekSSkekWk..',
    '..kWqekSSkeqWk..',
    '...kWeksskeWk...',
    '....kekSSkek....',
    '...kWeksskeWk...',
    '...ksekSSkesk...',
    '....kkksskkk....',
    '.......kk.......',
  ]);
  // The chromatic copies: the same shapes in one flat colour, drawn offset to either side of the moth.
  for (let i = 0; i < FRAMES; i++) {
    CB.Art.defineTint('heisenbug_cyan_' + i, 'heisenbug_' + i, CB.Pal.C.cyan);
    CB.Art.defineTint('heisenbug_mag_' + i, 'heisenbug_' + i, CB.Pal.C.magenta);
  }
  // The eye that hangs over the observer ring: cyan while it counts, red once the jump is close.
  CB.Art.defineSprite('heisenEye_0', ['..kkkkk..', '.kwwwwwk.', 'kwcCkCcwk', '.kwwwwwk.', '..kkkkk..']);
  CB.Art.defineSprite('heisenEye_1', ['..kkkkk..', '.kwwwwwk.', 'kwrRkRrwk', '.kwwwwwk.', '..kkkkk..']);

  // Blink flicker goes through Comfort, which slows anything faster than 4 Hz in calm mode.
  const blink = (t, hz) => (CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  // The moth and its decoys draw through here, so a decoy is the real thing minus the hit flash and the observer tells.
  // `tt` is the shared clock, so every moth flutters, bobs and glitches in step.
  function drawMoth(e, r, tt, real) {
    const C = CB.Pal.C;
    const a = e.alpha == null ? 1 : e.alpha;
    const obs = real && e.data ? e.data.observeT || 0 : 0;
    const fading = a < 0.999;
    let off = 1 + (2 * Math.min(1, obs / OBSERVE_T)); // 1 px at rest, 3 px when the jump is due
    if (obs <= 0 && tt % GLITCH_EVERY < GLITCH_LEN) off += 1;
    if (fading) off = 3;
    off = Math.round(off);
    const frame = FLUTTER[Math.floor(tt / FRAME_T) % FLUTTER.length];
    const y = e.y + Math.round(Math.sin(tt * 4)); // a 1 px hover
    const flash = !!real && (e.hitFlash > 0 || (obs >= OBSERVE_FLASH && obs < OBSERVE_FLASH + FLASH_LEN));
    r.alpha(0.3 * a, () => r.rect(e.x - e.r, e.y + e.r - 1, 2 * e.r, 2, C.ink));
    r.sprite('heisenbug_cyan_' + frame, e.x - off, y, { alpha: 0.5 * a });
    r.sprite('heisenbug_mag_' + frame, e.x + off, y, { alpha: 0.5 * a });
    if (!fading || blink(tt, FLICKER_HZ)) r.sprite('heisenbug_' + frame, e.x, y, { white: flash, alpha: a });
  }

  CB.Enemies.heisenbug = {
    create(w, x, y) {
      return CB.makeEnemy('heisenbug', x, y, { hp: MAX_HP, r: BODY_R, boss: true, regular: false, noContactT: SPAWN_GRACE, data: { observeT: 0 } });
    },

    update() {}, // the controller moves, hides and shoots it

    draw(e, r, t) {
      drawMoth(e, r, t == null ? e.t : t, true);
    },
  };

  // A one-HP copy of the moth. It never moves or shoots on its own: the controller places it and fires its rings.
  CB.Enemies.heisenDecoy = {
    create(w, x, y) {
      return CB.makeEnemy('heisenDecoy', x, y, { hp: 1, r: BODY_R, boss: true, regular: false, noContactT: SPAWN_GRACE });
    },

    update() {},

    // Only a real kill gets here: the controller's replacements are silent.
    onDeath(e, w) {
      w.emit('text', { x: e.x, y: e.y - 6, text: '404', color: CB.Pal.C.grey });
    },

    draw(e, r, t) {
      drawMoth(e, r, t == null ? e.t : t, false);
    },
  };

  // ---- controller ------------------------------------------------------------------------------------------------------------

  function killDecoys(c, w) {
    for (const d of c.decoys) if (!d.dead) w.killEnemy(d, true);
  }

  // One alpha for the body and its decoys. Anything below 1 can neither be shot nor touch Clawd.
  function fade(c, a) {
    const solid = a >= 1;
    const set = (e) => {
      if (e.dead) return;
      e.alpha = a;
      e.targetable = solid;
      e.contact = solid;
    };
    set(c.body);
    for (const d of c.decoys) set(d);
  }

  function ring(w, x, y, n) {
    const a0 = w.rng.angle();
    for (let i = 0; i < n; i++) w.fireEnemyBullet(x, y, a0 + (i * TAU) / n, RING_SPEED);
  }

  // The volley that ends a blink: 10 from the body and 6 from each decoy, with one enemyShoot for all of it.
  function volley(c, w) {
    const b = c.body;
    ring(w, b.x, b.y, RING_N);
    for (const d of c.decoys) if (!d.dead) ring(w, d.x, d.y, DECOY_RING_N);
    w.emit('enemyShoot', { x: b.x, y: b.y });
  }

  function spiral(c, w) {
    const b = c.body;
    w.fireEnemyBullet(b.x, b.y, c.spiralAngle, SPIRAL_SPEED);
    w.fireEnemyBullet(b.x, b.y, c.spiralAngle + Math.PI, SPIRAL_SPEED);
    w.emit('enemyShoot', { x: b.x, y: b.y });
  }

  // Moves the body to a fresh spot at least 80 px from Clawd. The event's x, y is where it was, x2, y2 where it lands.
  function jump(c, w) {
    const b = c.body;
    const from = { x: b.x, y: b.y };
    const to = w.randomPoint(JUMP_MARGIN, JUMP_MIN);
    b.x = to.x;
    b.y = to.y;
    w.emit('teleport', { x: from.x, y: from.y, x2: to.x, y2: to.y });
    return from;
  }

  // A decoy spot at least 60 px from Clawd, kept off the body and the other decoy so the two never stack (the last try is taken if all crowd).
  function decoySpot(c, w) {
    let spot = null;
    for (let i = 0; i < DECOY_TRIES; i++) {
      spot = w.randomPoint(JUMP_MARGIN, DECOY_MIN);
      let clear = M.dist(spot.x, spot.y, c.body.x, c.body.y) >= DECOY_GAP;
      for (const d of c.decoys) if (M.dist(spot.x, spot.y, d.x, d.y) < DECOY_GAP) clear = false;
      if (clear) break;
    }
    return spot;
  }

  // Phase 2: every blink swaps the old decoys (silently, no 404) for two new ones that fade in with the body.
  function replaceDecoys(c, w) {
    killDecoys(c, w);
    c.decoys = [];
    for (let i = 0; i < DECOYS; i++) {
      const spot = decoySpot(c, w);
      const d = w.spawnEnemy('heisenDecoy', spot.x, spot.y); // null at the enemy cap: that decoy is simply not made
      if (d) c.decoys.push(d);
    }
  }

  // Watching it for 2 s makes it jump. The timer counts only while the aim is within 14 px of the real body and it can be shot.
  function observe(c, w, dt) {
    const b = c.body;
    const p = w.player;
    if (b.targetable && M.dist(p.aimX, p.aimY, b.x, b.y) <= OBSERVE_R) c.observeT += dt;
    else c.observeT = 0;
    if (c.observeT >= OBSERVE_T - EPS) {
      const from = jump(c, w);
      w.emit('text', { x: from.x, y: from.y - 8, text: '!?', color: CB.Pal.C.cyan });
      if (w.glitchT < 0.2) w.glitchT = 0.2; // the glitch burst
      c.observeT = 0;
    }
    b.data.observeT = c.observeT; // the body's own draw reads it (the RGB split and the white flash)
  }

  // Out 0.3 s (untargetable, no contact, alpha 1 -> 0), jump, in 0.3 s, then the volley and a fresh wait.
  function blinkStep(c, w, dt) {
    if (!c.blink) {
      c.blinkT -= dt;
      if (c.blinkT > EPS) return;
      c.blink = { stage: 'out', t: 0 };
    }
    const k = c.blink;
    k.t += dt;
    if (k.stage === 'out') {
      if (k.t < FADE - EPS) {
        fade(c, 1 - k.t / FADE);
        return;
      }
      jump(c, w);
      if (c.phase === 2) replaceDecoys(c, w);
      fade(c, 0);
      k.stage = 'in';
      k.t = 0;
      return;
    }
    if (k.t < FADE - EPS) {
      fade(c, k.t / FADE);
      return;
    }
    fade(c, 1);
    c.blink = null;
    c.blinkT = c.phase === 3 ? BLINK_P3 : w.rng.range(BLINK_MIN, BLINK_MAX);
    volley(c, w);
  }

  // Tops the field up to 4 nullPointers, counting the ones still on their spawn telegraph.
  function summon(c, w) {
    let n = 0;
    for (const e of w.enemies) if (!e.dead && e.kind === 'nullPointer') n++;
    for (const s of w.spawns) if (!s.dead && s.kind === 'nullPointer') n++;
    for (let i = Math.min(SUMMON_N, SUMMON_CAP - n); i > 0; i--) {
      const at = w.edgePoint(60);
      w.queueSpawn('nullPointer', at.x, at.y);
    }
  }

  // The spiral keeps its timer frozen while the body is faded out (nothing fires from an invisible boss); summons run on.
  function phase3(c, w, dt) {
    if (!c.blink) {
      c.spiralAngle += SPIRAL_SPIN * dt;
      c.spiralT -= dt;
      if (c.spiralT <= EPS) {
        c.spiralT += SPIRAL_EVERY;
        spiral(c, w);
      }
    }
    c.summonT -= dt;
    if (c.summonT <= EPS) {
      c.summonT += SUMMON_EVERY;
      summon(c, w);
    }
  }

  function enterPhase(c, w, n) {
    const b = c.body;
    c.phase = n;
    w.emit('bossPhase', { x: b.x, y: b.y, phase: n });
    w.addShake(4);
    b.invuln = Math.max(b.invuln, PHASE_INVULN);
    if (n === 3) {
      killDecoys(c, w);
      c.decoys = [];
      c.spiralAngle = w.rng.angle();
      c.spiralT = SPIRAL_EVERY;
      c.summonT = SUMMON_FIRST;
      if (!c.blink) c.blinkT = BLINK_P3;
    }
  }

  // The body died: the controller is done. Parts keep their last x, y (deathPoints reads them), and the decoys go quietly.
  function defeat(c, w) {
    c.defeated = true;
    c.hp = 0;
    c.observeT = 0;
    c.blink = null;
    c.body.data.observeT = 0;
    killDecoys(c, w);
  }

  function update(c, w, dt) {
    const b = c.body;
    if (c.defeated) return;
    if (b.dead) {
      defeat(c, w);
      return;
    }
    const x0 = b.x;
    const y0 = b.y;
    c.hp = Math.max(0, b.hp);
    observe(c, w, dt);
    blinkStep(c, w, dt);
    if (c.phase === 3) phase3(c, w, dt);
    // Phases are checked last, so a new phase's timers (spiral, summons, the 5 s blink) first count down on the next tick.
    const target = c.hp < PHASE3_HP ? 3 : c.hp < PHASE2_HP ? 2 : 1;
    while (c.phase < target) enterPhase(c, w, c.phase + 1); // one hit across both thresholds applies 1 -> 2 -> 3
    c.x = b.x;
    c.y = b.y;
    // Rule 7: the velocity it really moved at. A jump is one big step in one tick.
    b.vx = dt > 0 ? (b.x - x0) / dt : 0;
    b.vy = dt > 0 ? (b.y - y0) / dt : 0;
  }

  // The observer ring: 16 dots on the 14 px radius that counts, lighting one per 0.125 s, with an eye above it that goes red at 1.5 s.
  function drawTell(c, r) {
    const b = c.body;
    if (c.defeated || b.dead || !b.targetable || !(c.observeT > 0)) return;
    const C = CB.Pal.C;
    const lit = Math.min(RING_DOTS, Math.floor((RING_DOTS * c.observeT) / OBSERVE_T));
    const dot = (i, color) => {
      const a = -Math.PI / 2 + (i * TAU) / RING_DOTS;
      r.rect(b.x + Math.cos(a) * OBSERVE_R - 1, b.y + Math.sin(a) * OBSERVE_R - 1, 2, 2, color);
    };
    r.alpha(0.3, () => {
      for (let i = lit; i < RING_DOTS; i++) dot(i, C.grey);
    });
    for (let i = 0; i < lit; i++) dot(i, C.cyan);
    r.sprite(c.observeT >= OBSERVE_RED ? 'heisenEye_1' : 'heisenEye_0', b.x, b.y - OBSERVE_R - 7);
  }

  CB.Bosses.heisenbug = {
    id: 'heisenbug',
    name: 'THE HEISENBUG',
    tagline: 'works on my machine',
    commitMsg: 'fix: cannot reproduce (closed)',
    file: 'repro.js',
    diff: ['- // works on my machine', '+ // works on every machine', '+ // (probably)'],
    portrait: 'heisenbug_0',

    // The body, then 6 points on a radius-14 ring. The body keeps its x, y when dead, so this still works after defeat.
    deathPoints(c) {
      const b = c && c.body;
      const x = b && M.isFiniteNum(b.x) ? b.x : CB.W / 2;
      const y = b && M.isFiniteNum(b.y) ? b.y : CB.H / 2;
      const pts = [{ x, y }];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 6;
        pts.push({ x: x + Math.cos(a) * 14, y: y + Math.sin(a) * 14 });
      }
      return pts;
    },

    create(w) {
      const p = w.player;
      let spot = CANDIDATES[0];
      let far = -1;
      for (const s of CANDIDATES) {
        const d = M.dist2(s.x, s.y, p.x, p.y);
        if (d > far) {
          far = d;
          spot = s; // strictly farther: the first candidate wins ties
        }
      }
      let body = w.spawnEnemy('heisenbug', spot.x, spot.y);
      if (!body) {
        // The enemy cap is full, but the boss has to exist.
        body = CB.Enemies.heisenbug.create(w, spot.x, spot.y);
        body.kind = 'heisenbug';
        w.enemies.push(body);
      }
      const c = {
        id: 'heisenbug',
        x: body.x,
        y: body.y,
        hp: MAX_HP,
        maxHp: MAX_HP,
        phase: 1,
        defeated: false,
        body,
        decoys: [],
        observeT: 0,
        blinkT: w.rng.range(BLINK_MIN, BLINK_MAX),
        blink: null,
        spiralAngle: 0,
        spiralT: SPIRAL_EVERY,
        summonT: SUMMON_FIRST,
        update: (world, dt) => update(c, world, dt),
        draw: (r) => drawTell(c, r),
      };
      return c;
    },
  };
})(window.CB);
