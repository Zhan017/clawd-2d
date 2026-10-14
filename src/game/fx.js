// Cosmetic juice from world events: particles, rings, decals, muzzle flashes, the boss finale, quip pops and bug squash poses (world.fxRng only).
(function (CB) {
  'use strict';
  const C = () => CB.Pal.C;
  const DEATH_TEXT = { syntaxError: ';', nullPointer: 'null', raceCondition: 'race', memoryLeak: 'free()', offByOne: '+1' };
  // Debris and floor-stain colours per bug kind, as [bright, dark] palette names.
  const KIND_COLOR = {
    syntaxError: ['red', 'redDark'], nullPointer: ['pale', 'grey'], raceCondition: ['yellow', 'yellowDark'],
    memoryLeak: ['green', 'greenDark'], offByOne: ['purple', 'purpleDark'],
  };
  const KIND_FALLBACK = ['spark', 'greyDark'];
  const DECAL_COLOR = { memoryLeak: 'greyDark' }; // the boss's puddles are green: a slime kill's stain must not read as one
  const PATCH_COLOR = { spread: 'cyan', rapid: 'yellow', pierce: 'purple', heavy: 'ember', heart: 'red', dash: 'cyan', ricochet: 'green' };
  const MAX_DECALS = 40;
  const DECAL_LIFE = 6;
  const DECAL_FADE = 2; // the last seconds of a decal's life
  const DECAL_ALPHA = 0.35;
  const BLASTS = 12;
  const BLAST_GAP = 0.03; // world seconds between finale blasts
  const FINALE_AT = 0.45; // world seconds after the boss falls: the big ring and the confetti
  const CONFETTI = 60;
  const CALM_CONFETTI = 20;
  const CALM_BLAST_RINGS = 6;
  const HURT_QUIP_CHANCE = 0.35;
  const QUIP_COOLDOWN = 5;
  const BIG_RING = 40; // rings wider than this are plotted pixel by pixel; the renderer's cached rings are for small radii
  const TEXT_PAD = 4;
  const LANE_H = 9; // a pop is 7 px tall: pops closer than this in y, with overlapping x, would print over each other
  const LANE_TRIES = [0, -1, -2, -3, 1, 2, 3, 4]; // lane offsets tried in order (negative is up)
  const PRIORITY_TEXT = { 'last heart!': true, '+1 ♥': true, '+15 /compact': true, perfect: true }; // pops about Clawd's own state beat quips for a slot
  const BLOCKED_GAP = 1.2; // world seconds between two 'blocked' pops

  // Over the cap the oldest entry goes first, but floor stains (at most 40) outlive a particle flood.
  function push(w, f) {
    if (!(Number.isFinite(f.x) && Number.isFinite(f.y))) return null;
    while (w.fx.length > 0 && w.fx.length >= CB.CAPS.fx) {
      let i = 0;
      while (i < w.fx.length - 1 && w.fx[i].kind === 'decal') i++;
      w.fx.splice(i, 1);
    }
    f.dead = false;
    w.fx.push(f);
    return f;
  }

  const isCalm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // Screen-impact table: hitstop (s), shake, flash (s) and flash colour per big moment.
  CB.IMPACT = {
    bigKill:     { stop: 0.04, shake: 1.5 },
    bossPartDie: { stop: 0.10, shake: 3 },
    bossPhase:   { stop: 0.14, shake: 4, flash: 0.10, color: '#FFFFFF' },
    bossDie:     { stop: 0.08, shake: 6, flash: 0.25, color: '#FFFFFF' },
    beam:        { shake: 2 },
    compact:     { stop: 0.06, shake: 3, flash: 0.12, color: '#FFD27A' },
  };

  // The last quip index shown per pool, per world, so a pool never repeats back to back (kept off the world and out of module state: replays stay deterministic).
  const LAST_QUIP = new WeakMap();
  // The text CB.Quips.pick gives for a pool, or null when quips are missing, partial or return junk.
  function pickQuip(w, list) {
    const Q = CB.Quips;
    if (!(Q && typeof Q.pick === 'function' && Array.isArray(list) && list.length)) return null;
    let seen = LAST_QUIP.get(w);
    if (!seen) LAST_QUIP.set(w, (seen = new Map()));
    const q = Q.pick(w.fxRng, list, seen.has(list) ? seen.get(list) : -1);
    if (!q || typeof q.text !== 'string' || !q.text) return null;
    if (Number.isInteger(q.idx)) seen.set(list, q.idx);
    return q.text;
  }

  function textHalfWidth(text) {
    const F = CB.Font;
    const px = F && typeof F.measure === 'function' ? F.measure(String(text), 1) : String(text).length * 6;
    return Number.isFinite(px) ? px / 2 : 0;
  }

  const textBox = (x, y, text) => {
    const h = textHalfWidth(text);
    return { x0: x - h, x1: x + h, y0: y };
  };
  const lanesClash = (a, b) => a.x0 < b.x1 + 1 && b.x0 < a.x1 + 1 && Math.abs(a.y0 - b.y0) < LANE_H;
  // Clawd's own box (her sprite spans about x-8..x+8, y-10..y+4): no pop sits on it.
  const onClawd = (w, box) => {
    const p = w.player;
    return !!p && !p.dead && box.x0 < p.x + 8 && box.x1 > p.x - 8 && box.y0 < p.y + 4 && box.y0 + 7 > p.y - 10;
  };

  // A pop kept on screen: centred text slides in from the edges, and its rise never carries it above the arena top. It takes the first lane
  // (up, then down) that clears Clawd and every live pop. A priority pop takes its slot and clears the quips under it; a quip that would
  // land on a live priority pop, or finds no free lane, is dropped (null).
  function popText(w, x, y, text, color, life, vy, forcePrio) {
    const A = CB.ARENA;
    const half = textHalfWidth(text);
    const px = Math.min(CB.W - TEXT_PAD - half, Math.max(TEXT_PAD + half, x));
    const rise = vy == null ? -14 : vy; // Fx.text's default
    const top = A.y + Math.abs(rise) * life;
    const lowest = A.y + A.h - 8;
    const clampY = (v) => Math.min(lowest, Math.max(top, v));
    const prio = forcePrio === true || PRIORITY_TEXT[text] === true;
    const live = w.fx.filter((f) => f.kind === 'text' && !f.dead && f.life > 0);
    const clash = (box, list) => list.filter((f) => lanesClash(box, textBox(f.x, f.y, f.text)));
    let py = null;
    for (const k of LANE_TRIES) {
      const cy = clampY(y + k * LANE_H);
      const box = textBox(px, cy, text);
      if (onClawd(w, box)) continue;
      if (!prio && k === 0 && clash(box, live.filter((f) => f.prio)).length) return null; // a priority pop already holds this spot
      if (!clash(box, prio ? live.filter((f) => f.prio) : live).length) { // a priority pop only dodges other priority pops
        py = cy;
        break;
      }
    }
    if (py == null) return prio ? Fx.text(w, px, clampY(y), text, color, life, rise) : null;
    if (prio) for (const f of clash(textBox(px, py, text), live)) if (!f.prio) f.life = 0; // the quips under it give way
    const f = Fx.text(w, px, py, text, color, life, rise);
    if (f && prio) f.prio = true;
    return f;
  }

  function kindColors(kind) {
    const pair = KIND_COLOR[kind] || KIND_FALLBACK;
    return [C()[pair[0]], C()[pair[1]]];
  }

  // The floor stain a bug leaves. At most MAX_DECALS exist; a new one pushes out the oldest.
  function addDecal(w, x, y, radius, color) {
    if (!(Number.isFinite(x) && Number.isFinite(y))) return;
    let count = 0;
    let oldest = -1;
    for (let i = 0; i < w.fx.length; i++) {
      if (w.fx[i].kind !== 'decal') continue;
      if (oldest < 0) oldest = i;
      count++;
    }
    if (count >= MAX_DECALS) w.fx.splice(oldest, 1);
    push(w, { kind: 'decal', x, y, vx: 0, vy: 0, r: radius, life: DECAL_LIFE, max: DECAL_LIFE, color });
  }

  // A real (non-silent, non-boss) kill: a white pop disc, debris in the bug's colours and a stain.
  function deathBurst(w, e) {
    const rr = Number.isFinite(e.r) ? Math.max(1, e.r) : 4;
    const [bright, dark] = kindColors(e.kind);
    push(w, { kind: 'pop', x: e.x, y: e.y, vx: 0, vy: 0, r: rr, life: 0.06, max: 0.06 });
    const n = Math.min(24, 4 + Math.round(rr));
    for (let i = 0; i < n; i++) {
      const a = w.fxRng.angle();
      const sp = w.fxRng.range(40, 90);
      push(w, { kind: 'p', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, max: 0.5, color: i % 3 === 2 ? dark : bright, size: 2 });
    }
    addDecal(w, e.x, e.y, rr * 0.9, DECAL_COLOR[e.kind] ? C()[DECAL_COLOR[e.kind]] : dark);
  }

  // Kill pop: a CB.Quips line when there is one, else the old per-kind word, at the old 50% chance.
  function killQuip(w, e) {
    const pool = CB.Quips && CB.Quips.kill ? CB.Quips.kill[e.kind] : null;
    if (!(DEATH_TEXT[e.kind] || Array.isArray(pool))) return;
    if (!w.fxRng.chance(0.5)) return;
    const text = pickQuip(w, pool) || DEATH_TEXT[e.kind];
    if (text) popText(w, e.x, e.y - 8, text, C().pale, 0.7, -14);
  }

  // Hurt pop: 35% per hit, never in god mode, at most one per QUIP_COOLDOWN seconds (w.quipT).
  function hurtQuip(w, e) {
    if (e.god || w.quipT > 0 || (w.player && (w.player.dead || w.player.hearts <= 1)) || !(CB.Quips && Array.isArray(CB.Quips.hurt))) return; // the hit that leaves one heart says "last heart!" instead
    if (!w.fxRng.chance(HURT_QUIP_CHANCE)) return;
    const text = pickQuip(w, CB.Quips.hurt);
    if (!text) return;
    w.quipT = QUIP_COOLDOWN;
    popText(w, e.x, e.y - 16, text, C().pale, 1.0, -12);
  }

  // A bolt turned away (a Loop segment, a boss's phase invulnerability): a bigger grey spark, and on the Loop a rate-limited "blocked" pop.
  const LAST_BLOCKED = new WeakMap();
  function clink(w, e) {
    Fx.spark(w, e.x, e.y, C().grey, 5, 55, 0.2, 2);
    Fx.spark(w, e.x, e.y, C().white, 1, 20, 0.1);
    if (!(w.boss && w.boss.id === 'infiniteLoop')) return;
    const last = LAST_BLOCKED.has(w) ? LAST_BLOCKED.get(w) : -Infinity;
    if (w.time - last < BLOCKED_GAP) return;
    LAST_BLOCKED.set(w, w.time);
    popText(w, e.x, e.y - 10, 'blocked', C().grey, 0.6, -10);
  }

  // Boss phase pop: CB.Quips.bossPhase[boss id][phase], gold, above the boss.
  function phaseQuip(w, e) {
    const b = w.boss;
    const table = CB.Quips && CB.Quips.bossPhase;
    const byBoss = b && table ? table[b.id] : null;
    const list = byBoss ? byBoss[e.phase] : null;
    if (!Array.isArray(list)) return;
    const text = pickQuip(w, list);
    if (!text) return;
    const rad = Math.min(40, Math.max(8, b.radius || b.size || 12));
    popText(w, e.x, e.y - rad - 10, text, C().gold, 1.6, -8);
  }

  // Queues the finale: 12 blasts 0.03 s apart walking the boss's deathPoints, then at +0.45 s a screen ring and confetti.
  function scheduleFinale(w, e) {
    if (!Array.isArray(w.fxQueue)) w.fxQueue = [];
    if (w.fxQueue.some((q) => q.kind === 'blast' || q.kind === 'finale')) return; // one finale per world
    const ex = Number.isFinite(e.x) ? e.x : CB.W / 2;
    const ey = Number.isFinite(e.y) ? e.y : CB.H / 2;
    const mod = CB.Bosses && w.boss && CB.Bosses[w.boss.id];
    let pts = null;
    try { pts = mod && typeof mod.deathPoints === 'function' ? mod.deathPoints(w.boss) : null; } catch (err) { pts = null; }
    pts = Array.isArray(pts) ? pts.filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y)) : [];
    for (let k = 0; k < BLASTS; k++) {
      let x = ex;
      let y = ey;
      if (pts.length) {
        x = pts[k % pts.length].x;
        y = pts[k % pts.length].y;
      } else {
        const a = w.fxRng.angle();
        const d = w.fxRng.range(0, 20);
        x += Math.cos(a) * d;
        y += Math.sin(a) * d;
      }
      w.fxQueue.push({ at: w.time + BLAST_GAP * k, kind: 'blast', k, x, y });
    }
    w.fxQueue.push({ at: w.time + FINALE_AT, kind: 'finale', x: ex, y: ey });
  }

  function fireBlast(w, q) {
    if (!isCalm() || q.k < CALM_BLAST_RINGS) Fx.ring(w, q.x, q.y, 2, 14, q.k % 2 ? C().white : C().gold, 0.3);
    const colors = [C().gold, C().ember, C().white];
    for (let j = 0; j < 14; j++) Fx.spark(w, q.x, q.y, colors[j % 3], 1, 80, 0.5, 2);
    w.addShake(2);
    w.emit('blast', { x: q.x, y: q.y }); // audio only: emitted after consume, so Fx never sees it
  }

  function fireFinale(w, q) {
    const ring = Fx.ring(w, q.x, q.y, 0, 300, C().white, 0.5);
    if (ring) ring.thick = true;
    const A = CB.ARENA;
    const colors = [C().clawd, C().gold, C().spark];
    const n = isCalm() ? CALM_CONFETTI : CONFETTI;
    for (let i = 0; i < n; i++) {
      const life = w.fxRng.range(1.2, 2.0);
      push(w, {
        kind: 'conf',
        x: Math.min(A.x + A.w, Math.max(A.x, q.x + w.fxRng.range(-80, 80))),
        y: Math.min(A.y + A.h, Math.max(A.y, q.y + w.fxRng.range(-20, 30))),
        vx: w.fxRng.range(-12, 12), vy: -w.fxRng.range(18, 50), drag: 0.5, sway: w.fxRng.range(6, 16), ph: w.fxRng.range(0, 6.28),
        life, max: life, color: colors[i % 3],
      });
    }
  }

  // Runs every queued entry that is due by world time (so a hitstop freezes the finale too). The array keeps its identity.
  function runQueue(w) {
    const q = w.fxQueue;
    if (!q || !q.length) return;
    const due = [];
    const keep = [];
    for (const it of q) (it.at <= w.time + 1e-9 ? due : keep).push(it);
    if (!due.length) return;
    q.length = 0;
    for (const it of keep) q.push(it);
    for (const it of due) {
      if (it.kind === 'blast') fireBlast(w, it);
      else if (it.kind === 'finale') fireFinale(w, it);
    }
  }

  // A pixel ring plotted point by point, clipped to the screen. Used for the huge finale ring, where a cached disc would be 600 px wide.
  function bigRing(r, cx, cy, radius, color) {
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    const plot = (px, py) => {
      if (px >= 0 && px < CB.W && py >= 0 && py < CB.H) r.rect(px, py, 1, 1, color);
    };
    let x = Math.max(0, Math.round(radius));
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      plot(x0 + x, y0 + y); plot(x0 + y, y0 + x); plot(x0 - y, y0 + x); plot(x0 - x, y0 + y);
      plot(x0 - x, y0 - y); plot(x0 - y, y0 - x); plot(x0 + y, y0 - x); plot(x0 + x, y0 - y);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  function drawRing(r, f, k) {
    const rad = Math.round(f.r0 + (f.r1 - f.r0) * (1 - k));
    r.alpha(k, () => {
      if (rad > BIG_RING) {
        bigRing(r, f.x, f.y, rad, f.color);
        if (f.thick) bigRing(r, f.x, f.y, rad - 1, f.color);
      } else {
        r.ring(f.x, f.y, rad, f.color);
        if (f.thick && rad > 0) r.ring(f.x, f.y, rad - 1, f.color);
      }
    });
  }

  function drawMuzzle(r, f, k) {
    const c = Math.cos(f.a);
    const s = Math.sin(f.a);
    if (k > 0.5) {
      r.rect(f.x - 2, f.y, 5, 1, C().gold);
      r.rect(f.x, f.y - 2, 1, 5, C().gold);
    }
    r.line(f.x + c * 2, f.y + s * 2, f.x + c * 6, f.y + s * 6, C().white);
    r.rect(f.x - 1, f.y - 1, 3, 3, C().white);
  }

  const Fx = {
    // Applies one IMPACT entry to the world. Hitstop is capped at 0.25 s and skipped in god mode (shake is capped by addShake).
    impact(w, key) {
      const k = CB.IMPACT[key];
      if (!k) return;
      if (!w.god && k.stop) w.hitstop = Math.min(0.25, Math.max(w.hitstop, k.stop));
      if (k.shake) w.addShake(k.shake);
      if (k.flash && k.flash >= w.flash) {
        w.flash = k.flash; // a weaker flash neither shortens nor recolours a stronger one
        w.flashColor = k.color;
      }
    },
    // The squash-and-stretch scale of a bug, for WorldDraw: a pop-in for its first 0.25 s, a small squash while hit-flashing, else (1, 1). Boss parts never deform.
    pose(e) {
      if (!e || e.boss) return { sx: 1, sy: 1 };
      const t = Number.isFinite(e.t) ? Math.max(0, e.t) : 1;
      if (t < 0.25) {
        let sy;
        if (t < 0.15) {
          const u = t / 0.15;
          sy = 0.2 + 1.0 * (1 - (1 - u) * (1 - u)); // 0.2 -> 1.2, easing out
        } else {
          const u = (t - 0.15) / 0.1;
          sy = 1.2 - 0.2 * (u * u * (3 - 2 * u)); // 1.2 -> 1.0, smooth
        }
        return { sx: Math.min(1.4, Math.max(0.8, 1 / sy)), sy };
      }
      if (e.hitFlash > 0) return { sx: 1.12, sy: 0.9 };
      return { sx: 1, sy: 1 };
    },
    spark(w, x, y, color, n, speed, life, size) {
      for (let i = 0; i < n; i++) {
        const a = w.fxRng.angle();
        const sp = speed * (0.4 + 0.6 * w.fxRng.next());
        push(w, { kind: 'p', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color, size: size || 1 });
      }
    },
    text(w, x, y, text, color, life, vy) {
      const l = life || 0.8;
      return push(w, { kind: 'text', x, y, vx: 0, vy: vy == null ? -14 : vy, life: l, max: l, text, color: color || '#FFFFFF' });
    },
    ring(w, x, y, r0, r1, color, life) {
      return push(w, { kind: 'ring', x, y, r0, r1, life, max: life, color });
    },
    // A picked patch: a gold ring, sparks in the patch colour, "+ name", and Clawd cheers (Player reads cheerT).
    celebrate(w, id) {
      const p = w.player;
      const x = p && Number.isFinite(p.x) ? p.x : CB.W / 2;
      const y = p && Number.isFinite(p.y) ? p.y : CB.H / 2;
      const def = CB.Patches && CB.Patches.DEFS ? CB.Patches.DEFS[id] : null;
      const color = C()[PATCH_COLOR[id]] || C().gold;
      Fx.ring(w, x, y, 2, 26, C().gold, 0.4);
      Fx.spark(w, x, y, color, 12, 60, 0.5, 2);
      popText(w, x, y - 18, '+ ' + (def && def.name ? def.name : String(id)), C().gold, 1.2, -10, true); // patch names are dynamic, so they ask for priority instead of sitting in PRIORITY_TEXT
      if (p) p.cheerT = 0.9;
    },
    consume(w, from) {
      const ev = w.events;
      for (let i = from; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'hit': Fx.spark(w, e.x, e.y, C().white, 3, 40, 0.18); break;
          case 'clink': clink(w, e); break;
          case 'shoot':
            push(w, { kind: 'muzzle', x: e.x, y: e.y, vx: 0, vy: 0, a: Number.isFinite(e.angle) ? e.angle : 0, life: 0.06, max: 0.06 });
            break;
          case 'enemyDie':
            if (e.silent) {
              Fx.spark(w, e.x, e.y, C().spark, 4, 50, 0.25); // cleared, not killed: no ring, no text
              break;
            }
            Fx.spark(w, e.x, e.y, e.boss ? C().gold : C().spark, Math.min(24, 6 + (e.r | 0) * 2), 70, 0.4);
            Fx.ring(w, e.x, e.y, 2, (e.r | 0) + 6, C().white, 0.25);
            if (!e.boss) deathBurst(w, e);
            killQuip(w, e);
            if (e.boss) Fx.impact(w, 'bossPartDie');
            else if (e.r >= 6) Fx.impact(w, 'bigKill');
            break;
          case 'spawn':
            Fx.ring(w, e.x, e.y, 2, 10, C().white, 0.25);
            push(w, { kind: 'implode', x: e.x, y: e.y, vx: 0, vy: 0, r0: 10, a0: w.fxRng.angle(), life: 0.15, max: 0.15 });
            break;
          case 'playerHurt':
            Fx.spark(w, e.x, e.y, C().hurt, 10, 80, 0.35);
            hurtQuip(w, e);
            break;
          case 'playerDie': Fx.spark(w, e.x, e.y, C().clawd, 30, 90, 0.8); break;
          case 'bossEnter':
            Fx.ring(w, e.x, e.y, 4, 32, C().white, 0.4);
            Fx.spark(w, e.x, e.y, C().cyan, 8, 60, 0.4);
            Fx.spark(w, e.x, e.y, C().white, 8, 60, 0.4);
            break;
          case 'bossPhase':
            Fx.ring(w, e.x, e.y, 4, 40, C().white, 0.5);
            Fx.impact(w, 'bossPhase');
            w.glitchT = 0.4;
            phaseQuip(w, e);
            break;
          case 'bossDie':
            for (let k = 0; k < 6; k++) Fx.ring(w, e.x + w.fxRng.range(-14, 14), e.y + w.fxRng.range(-10, 10), 2, 18 + k * 4, k % 2 ? C().gold : C().ember, 0.4 + k * 0.15);
            Fx.spark(w, e.x, e.y, C().gold, 40, 110, 1.0);
            Fx.impact(w, 'bossDie');
            scheduleFinale(w, e);
            break;
          case 'teleport': Fx.spark(w, e.x, e.y, C().cyan, 8, 50, 0.3); break;
          case 'text': popText(w, e.x, e.y, String(e.text), e.color, 0.9); break;
          case 'splat': Fx.spark(w, e.x, e.y, C().green, 8, 40, 0.35); break;
          case 'revive': Fx.ring(w, e.x, e.y, 2, 24, C().purple, 0.5); break;
          case 'beam': Fx.impact(w, 'beam'); break;
          case 'compact': Fx.impact(w, 'compact'); break;
          default: break;
        }
      }
    },
    update(w, dt) {
      if (w.glitchT > 0) w.glitchT = Math.max(0, w.glitchT - dt);
      if (w.quipT > 0) w.quipT = Math.max(0, w.quipT - dt);
      const damp = Math.max(0, 1 - 4 * dt);
      for (const f of w.fx) {
        f.life -= dt;
        if (f.life <= 0) {
          f.dead = true;
          continue;
        }
        f.x += ((f.vx || 0) + (f.sway ? Math.sin(f.life * 9 + f.ph) * f.sway : 0)) * dt;
        f.y += (f.vy || 0) * dt;
        if (f.kind === 'p') {
          f.vx *= damp;
          f.vy *= damp;
        } else if (f.kind === 'conf') {
          const d = Math.max(0, 1 - f.drag * dt);
          f.vx *= d;
          f.vy *= d;
        }
      }
      let j = 0;
      for (let i = 0; i < w.fx.length; i++) if (!w.fx[i].dead) w.fx[j++] = w.fx[i];
      w.fx.length = j;
      runQueue(w);
    },
    // Floor stains. WorldDraw calls this right after the arena, before any entity.
    drawUnder(w, r) {
      for (const f of w.fx) {
        if (f.kind !== 'decal') continue;
        r.alpha(DECAL_ALPHA * Math.min(1, f.life / DECAL_FADE), () => r.disc(f.x, f.y, f.r, f.color));
      }
    },
    draw(w, r) {
      for (const f of w.fx) {
        const k = Math.max(0, f.life / f.max);
        switch (f.kind) {
          case 'p': {
            const s = f.size || 1;
            const o = s > 1 ? 1 : 0;
            r.alpha(k, () => r.rect(f.x - o, f.y - o, s, s, f.color));
            break;
          }
          case 'conf': {
            const flat = Math.floor(f.life * 4 + f.ph) % 2 === 0; // tumbling at 4 Hz at most
            r.alpha(Math.min(1, k * 2), () => r.rect(f.x, f.y, flat ? 2 : 1, flat ? 1 : 2, f.color));
            break;
          }
          case 'ring': drawRing(r, f, k); break;
          case 'text': r.text(f.text, f.x, f.y, { align: 'center', color: f.color, alpha: Math.min(1, k * 2), shadow: C().ink }); break;
          case 'pop': r.disc(f.x, f.y, f.r, C().white); break;
          case 'implode': {
            const rad = f.r0 * k;
            for (let n = 0; n < 8; n++) {
              const a = f.a0 + n * (Math.PI / 4);
              r.rect(f.x + Math.cos(a) * rad, f.y + Math.sin(a) * rad, 1, 1, C().white);
            }
            break;
          }
          case 'muzzle': drawMuzzle(r, f, k); break;
          default: break; // decals are drawn by drawUnder
        }
      }
    },
  };
  CB.Fx = Fx;
})(window.CB);
