// World state: entities, spawning, damage, collisions, hazards and the event queue.
(function (CB) {
  'use strict';
  const M = CB.M;
  const CAPS = Object.freeze({ enemies: 60, eBullets: 400, pBullets: 120, fx: 500 });
  CB.CAPS = CAPS;
  CB.SPAWN_TELEGRAPH = 0.6;
  CB.SPAWN_GRACE = 0.3; // a freshly spawned regular enemy can be shot but cannot hurt for this long
  const EPS = 1e-9; // timers are decremented by 1/60 repeatedly; 0.3 - 18/60 is +5e-17, not 0
  const SEP_FRAC = 0.8;
  const SEP_SPEED = 30;

  CB.makeEnemy = function (kind, x, y, props) {
    const e = {
      kind, x, y, r: 5, vx: 0, vy: 0, hp: 1, maxHp: 1, t: 0, state: 'idle', stateT: 0,
      targetable: true, solid: false, contact: true, visible: true,
      hitFlash: 0, invuln: 0, noContactT: 0, dead: false, boss: false, regular: true, facing: 1, alpha: 1, data: {},
    };
    if (props) Object.assign(e, props);
    if (!props || props.maxHp == null) e.maxHp = e.hp;
    return e;
  };

  CB.setState = function (e, state) {
    e.state = state;
    e.stateT = 0;
  };

  function removeDead(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
  }

  function separable(e) {
    return !e.dead && e.visible && e.regular && !e.boss;
  }

  // Gentle pairwise push so a pile of regular enemies can't collapse onto one point.
  function separate(w, dt) {
    const list = w.enemies;
    const maxPush = SEP_SPEED * dt;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!separable(a)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!separable(b)) continue;
        const min = SEP_FRAC * (a.r + b.r);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        let nx = 1;
        let ny = 0;
        if (d > 1e-9) {
          nx = dx / d;
          ny = dy / d;
        }
        const push = Math.min((min - d) / 2, maxPush);
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        M.clampToArena(a, w.arena);
        M.clampToArena(b, w.arena);
      }
    }
  }

  function collide(w) {
    const p = w.player;
    for (const b of w.pBullets) {
      if (b.dead) continue;
      for (const e of w.enemies) {
        if (e.dead || !e.visible || !(e.targetable || e.solid)) continue;
        if (b.hits.indexOf(e) !== -1) continue;
        if (!M.circleHit(b.x, b.y, b.r, e.x, e.y, e.r)) continue;
        b.hits.push(e);
        if (e.targetable) w.damageEnemy(e, b.dmg, b);
        else w.emit('clink', { x: b.x, y: b.y });
        if (b.pierce > 0) b.pierce--;
        else {
          b.dead = true;
          break;
        }
      }
    }
    if (p.dead) return;
    for (const eb of w.eBullets) {
      if (eb.dead || !M.circleHit(eb.x, eb.y, eb.r, p.x, p.y, p.r)) continue;
      if (CB.Player.hurt(p, w, eb)) eb.dead = true;
      else if (p.dashInvulnT > EPS && !eb.grazed && CB.Compact && CB.Compact.perfect) CB.Compact.perfect(w, eb); // only a dash counts, not hurt, spawn or /compact invuln
    }
    for (const e of w.enemies) {
      if (e.dead || !e.visible || !e.contact || e.noContactT > EPS) continue;
      if (M.circleHit(e.x, e.y, e.r * 0.85, p.x, p.y, p.r)) CB.Player.hurt(p, w, e);
    }
  }

  function updateHazards(w, dt) {
    const p = w.player;
    let slow = 1;
    for (const h of w.hazards) {
      if (h.dead) continue;
      h.t += dt;
      h.life -= dt;
      if (h.life <= 0) {
        h.dead = true;
        continue;
      }
      if (h.kind === 'puddle' && !p.dead && M.dist2(h.x, h.y, p.x, p.y) <= h.r * h.r) slow = Math.min(slow, h.slow);
    }
    p.slow = slow;
  }

  CB.createWorld = function (opts) {
    const o = opts || {};
    const seed = o.seed == null ? 1 : o.seed >>> 0;
    const w = {
      seed,
      rng: CB.createRng(seed),
      fxRng: CB.createRng((seed * 7919 + 13) >>> 0),
      time: 0,
      arena: CB.ARENA,
      stage: o.stage || null,
      god: !!o.god,
      mode: o.mode || {}, // { yolo } from the run (Task 7D)
      player: null,
      enemies: [],
      pBullets: [],
      eBullets: [],
      hazards: [],
      pickups: [],
      fx: [],
      spawns: [],
      boss: null,
      events: [],
      shake: 0,
      hitstop: 0,
      dashBuffered: false,
      flash: 0,
      flashColor: null, // colour of the current flash (Fx.impact keeps the strongest one's)
      glitchT: 0,
      fxQueue: [],
      quipT: 0,
      // Context meter (Task 7B, rev 3). Values mirror CB.Compact (MAX 45, INCOME_CAP 7); compact.js is optional.
      context: { value: 0, max: 45, announced: false },
      incomeTokens: 7,
      compactWave: null,
      compactBannerT: 0,
      compactBuffered: false, // an E pressed during hitstop, cast on the first live tick
      seenCompact: !!(CB.Save && CB.Save.get && CB.Save.get('seenCompact', false)), // the "/compact" hint shows until the first cast ever
      stats: { wouldHits: 0, shots: 0, kills: 0, damageDealt: 0, compacts: 0, perfects: 0 },
    };

    w.emit = function (type, data) {
      const ev = Object.assign({ type }, data);
      w.events.push(ev);
      return ev;
    };

    w.addShake = function (amount) {
      w.shake = Math.min(6, Math.max(w.shake, amount));
    };

    w.spawnEnemy = function (kind, x, y, o2) {
      const mod = CB.Enemies[kind];
      if (!mod) throw new Error('unknown enemy kind: ' + kind);
      if (w.enemies.length >= CAPS.enemies) return null;
      const e = mod.create(w, x, y, o2 || {});
      e.kind = kind;
      if (o2 && o2.elite && CB.Pickups) CB.Pickups.applyElite(e);
      if (e.regular && !e.boss) e.noContactT = Math.max(e.noContactT || 0, CB.SPAWN_GRACE);
      w.enemies.push(e);
      return e;
    };

    w.queueSpawn = function (kind, x, y, o2, delay) {
      const d = delay == null ? CB.SPAWN_TELEGRAPH : delay;
      const s = { kind, x, y, opts: o2 || {}, t: d, total: d, dead: false };
      w.spawns.push(s);
      return s;
    };

    w.regularAlive = function () {
      let n = 0;
      for (const e of w.enemies) if (!e.dead && e.regular) n++;
      return n;
    };

    w.edgePoint = function (minDist) {
      const md = minDist == null ? 60 : minDist;
      const a = w.arena;
      const inset = 10;
      const p = w.player;
      let best = null;
      let bestD = -1;
      for (let i = 0; i < 24; i++) {
        const side = w.rng.int(0, 3);
        let x;
        let y;
        if (side === 0) {
          x = w.rng.range(a.x + inset, a.x + a.w - inset);
          y = a.y + inset;
        } else if (side === 1) {
          x = w.rng.range(a.x + inset, a.x + a.w - inset);
          y = a.y + a.h - inset;
        } else if (side === 2) {
          x = a.x + inset;
          y = w.rng.range(a.y + inset, a.y + a.h - inset);
        } else {
          x = a.x + a.w - inset;
          y = w.rng.range(a.y + inset, a.y + a.h - inset);
        }
        const d = M.dist(x, y, p.x, p.y);
        if (d >= md) return { x, y };
        if (d > bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      return best;
    };

    w.randomPoint = function (margin, minDist) {
      const m = margin == null ? 16 : margin;
      const md = minDist || 0;
      const a = w.arena;
      const p = w.player;
      let best = null;
      let bestD = -1;
      for (let i = 0; i < 24; i++) {
        const x = w.rng.range(a.x + m, a.x + a.w - m);
        const y = w.rng.range(a.y + m, a.y + a.h - m);
        const d = M.dist(x, y, p.x, p.y);
        if (d >= md) return { x, y };
        if (d > bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      return best;
    };

    w.fireEnemyBullet = function (x, y, angle, speed, o2) {
      if (w.eBullets.length >= CAPS.eBullets) return null;
      const opt = o2 || {};
      const sp = (speed == null ? 80 : speed) * (w.mode.yolo ? 1.15 : 1); // YOLO: every enemy bullet 15% faster
      const b = {
        x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
        r: opt.r || 2, life: opt.life || 8, color: opt.color || null,
        spin: opt.spin || 0, accel: opt.accel || 0, t: 0, dead: false, grazed: false,
      };
      w.eBullets.push(b);
      return b;
    };

    w.firePlayerBolt = function (x, y, angle) {
      if (w.pBullets.length >= CAPS.pBullets) return null;
      const st = w.player.stats;
      const b = {
        x, y, vx: Math.cos(angle) * st.boltSpeed, vy: Math.sin(angle) * st.boltSpeed, angle,
        r: st.boltR, dmg: st.dmg, pierce: st.pierce, bounces: st.bounces, life: 1.5, hits: [], t: 0, dead: false,
      };
      w.pBullets.push(b);
      return b;
    };

    w.hurtPlayer = (src) => CB.Player.hurt(w.player, w, src);

    w.damageEnemy = function (e, dmg, src) {
      if (!e || e.dead || !e.targetable || !e.visible) return 0;
      if (e.invuln > 0) {
        w.emit('clink', { x: e.x, y: e.y });
        return 0;
      }
      const mod = CB.Enemies[e.kind];
      let applied;
      if (mod && mod.onHit) applied = mod.onHit(e, w, dmg, src);
      else {
        e.hp -= dmg;
        applied = dmg;
      }
      if (applied > 0) {
        e.hitFlash = 0.08;
        w.stats.damageDealt += applied;
        w.emit('hit', { x: e.x, y: e.y, kind: e.kind, boss: e.boss });
        // Only player bolts (src.dmg) feed the meter; the /compact wave's own damage never does.
        if (CB.Compact && src && src.dmg != null && !src.compact) CB.Compact.onBoltHit(w, applied);
      }
      if (e.hp <= 0 && !e.dead) w.killEnemy(e);
      return applied;
    };

    w.killEnemy = function (e, silent) {
      if (e.dead) return;
      e.dead = true;
      if (e.hp > 0) e.hp = 0;
      w.stats.kills++;
      const mod = CB.Enemies[e.kind];
      if (!silent && mod && mod.onDeath) mod.onDeath(e, w);
      if (!silent && e.elite && CB.Pickups) CB.Pickups.drop(w, e.x, e.y);
      w.emit('enemyDie', { x: e.x, y: e.y, kind: e.kind, r: e.r, boss: e.boss, silent: !!silent });
    };

    w.killAllEnemies = function () {
      for (const e of w.enemies) if (!e.dead) w.killEnemy(e, true);
      w.spawns.length = 0;
    };

    w.clearEnemyBullets = function () {
      w.eBullets.length = 0;
    };

    w.addHazard = function (h) {
      const hz = Object.assign({ kind: 'puddle', r: 12, life: 6, slow: 0.5, t: 0, dead: false }, h);
      w.hazards.push(hz);
      return hz;
    };

    w.step = function (dt, input) {
      if (w.hitstop > 0) {
        w.hitstop = Math.max(0, w.hitstop - dt);
        if (input && input.dash) w.dashBuffered = true;
        if (input && input.compact) w.compactBuffered = true;
        return;
      }
      const evStart = w.events.length;
      w.time += dt;
      for (const s of w.spawns) {
        if (s.dead) continue;
        s.t -= dt;
        if (s.t <= 0) {
          s.dead = true;
          const e = w.spawnEnemy(s.kind, s.x, s.y, s.opts);
          if (e) w.emit('spawn', { x: s.x, y: s.y, kind: s.kind });
        }
      }
      CB.Player.update(w.player, w, dt, input);
      for (let i = 0; i < w.enemies.length; i++) {
        const e = w.enemies[i];
        if (e.dead) continue;
        e.t += dt;
        e.stateT += dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.invuln > 0) e.invuln -= dt;
        if (e.noContactT > 0) e.noContactT -= dt;
        CB.Enemies[e.kind].update(e, w, dt * (e.timeScale || 1)); // P0 elites run 20% faster; e.t/e.stateT keep the raw dt
      }
      separate(w, dt);
      if (w.boss && !w.boss.defeated) w.boss.update(w, dt);
      CB.Projectiles.update(w, dt);
      if (CB.Compact) CB.Compact.update(w, dt);
      collide(w);
      updateHazards(w, dt);
      if (CB.Pickups) CB.Pickups.update(w, dt);
      removeDead(w.enemies);
      removeDead(w.pBullets);
      removeDead(w.eBullets);
      removeDead(w.hazards);
      removeDead(w.spawns);
      CB.Fx.consume(w, evStart);
      CB.Fx.update(w, dt);
      if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 20);
      if (w.flash > 0) w.flash = Math.max(0, w.flash - dt);
    };

    w.player = CB.Player.create(w, o.patches || {});
    return w;
  };
})(window.CB);
