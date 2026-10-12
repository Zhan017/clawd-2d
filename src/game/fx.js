// Cosmetic particles, rings and floating text, created from world events.
// Uses world.fxRng only (deterministic, never Math.random).
(function (CB) {
  'use strict';
  const C = () => CB.Pal.C;
  const DEATH_TEXT = { syntaxError: ';', nullPointer: 'null', raceCondition: 'race', memoryLeak: 'free()', offByOne: '+1' };

  function push(w, f) {
    if (w.fx.length >= CB.CAPS.fx) w.fx.splice(0, w.fx.length - CB.CAPS.fx + 1);
    f.dead = false;
    w.fx.push(f);
    return f;
  }

  // Screen-impact table: hitstop (s), shake, flash (s) and flash colour per big moment.
  CB.IMPACT = {
    bigKill:     { stop: 0.04, shake: 1.5 },
    bossPartDie: { stop: 0.10, shake: 3 },
    bossPhase:   { stop: 0.14, shake: 4, flash: 0.10, color: '#FFFFFF' },
    bossDie:     { stop: 0.08, shake: 6, flash: 0.25, color: '#FFFFFF' },
    beam:        { shake: 2 },
    compact:     { stop: 0.06, shake: 3, flash: 0.12, color: '#FFD27A' },
  };

  const Fx = {
    // Applies one IMPACT entry to the world. Hitstop is capped at 0.25 s and skipped in god mode (shake is capped by addShake).
    impact(w, key) {
      const k = CB.IMPACT[key];
      if (!k) return;
      if (!w.god && k.stop) w.hitstop = Math.min(0.25, Math.max(w.hitstop, k.stop));
      if (k.shake) w.addShake(k.shake);
      if (k.flash) {
        w.flash = Math.max(w.flash, k.flash);
        w.flashColor = k.color;
      }
    },
    spark(w, x, y, color, n, speed, life) {
      for (let i = 0; i < n; i++) {
        const a = w.fxRng.angle();
        const sp = speed * (0.4 + 0.6 * w.fxRng.next());
        push(w, { kind: 'p', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color });
      }
    },
    text(w, x, y, text, color, life) {
      const l = life || 0.8;
      push(w, { kind: 'text', x, y, vx: 0, vy: -14, life: l, max: l, text, color: color || '#FFFFFF' });
    },
    ring(w, x, y, r0, r1, color, life) {
      push(w, { kind: 'ring', x, y, r0, r1, life, max: life, color });
    },
    consume(w, from) {
      const ev = w.events;
      for (let i = from; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'hit': Fx.spark(w, e.x, e.y, C().white, 3, 40, 0.18); break;
          case 'clink': Fx.spark(w, e.x, e.y, C().grey, 2, 30, 0.12); break;
          case 'enemyDie':
            if (e.silent) {
              Fx.spark(w, e.x, e.y, C().spark, 4, 50, 0.25); // cleared, not killed: no ring, no text
              break;
            }
            Fx.spark(w, e.x, e.y, e.boss ? C().gold : C().spark, Math.min(24, 6 + (e.r | 0) * 2), 70, 0.4);
            Fx.ring(w, e.x, e.y, 2, (e.r | 0) + 6, C().white, 0.25);
            if (DEATH_TEXT[e.kind] && w.fxRng.chance(0.5)) Fx.text(w, e.x, e.y - 8, DEATH_TEXT[e.kind], C().pale, 0.7);
            if (e.boss) Fx.impact(w, 'bossPartDie');
            else if (e.r >= 6) Fx.impact(w, 'bigKill');
            break;
          case 'spawn': Fx.ring(w, e.x, e.y, 2, 10, C().white, 0.25); break;
          case 'playerHurt': Fx.spark(w, e.x, e.y, C().hurt, 10, 80, 0.35); break;
          case 'playerDie': Fx.spark(w, e.x, e.y, C().clawd, 30, 90, 0.8); break;
          case 'bossPhase':
            Fx.ring(w, e.x, e.y, 4, 40, C().white, 0.5);
            Fx.impact(w, 'bossPhase');
            break;
          case 'bossDie':
            for (let k = 0; k < 6; k++) Fx.ring(w, e.x + w.fxRng.range(-14, 14), e.y + w.fxRng.range(-10, 10), 2, 18 + k * 4, k % 2 ? C().gold : C().ember, 0.4 + k * 0.15);
            Fx.spark(w, e.x, e.y, C().gold, 40, 110, 1.0);
            Fx.impact(w, 'bossDie');
            break;
          case 'teleport': Fx.spark(w, e.x, e.y, C().cyan, 8, 50, 0.3); break;
          case 'text': Fx.text(w, e.x, e.y, e.text, e.color, 0.9); break;
          case 'splat': Fx.spark(w, e.x, e.y, C().green, 8, 40, 0.35); break;
          case 'revive': Fx.ring(w, e.x, e.y, 2, 24, C().purple, 0.5); break;
          case 'beam': Fx.impact(w, 'beam'); break;
          case 'compact': Fx.impact(w, 'compact'); break;
          default: break;
        }
      }
    },
    update(w, dt) {
      const damp = Math.max(0, 1 - 4 * dt);
      for (const f of w.fx) {
        f.life -= dt;
        if (f.life <= 0) {
          f.dead = true;
          continue;
        }
        f.x += (f.vx || 0) * dt;
        f.y += (f.vy || 0) * dt;
        if (f.kind === 'p') {
          f.vx *= damp;
          f.vy *= damp;
        }
      }
      let j = 0;
      for (let i = 0; i < w.fx.length; i++) if (!w.fx[i].dead) w.fx[j++] = w.fx[i];
      w.fx.length = j;
    },
    draw(w, r) {
      for (const f of w.fx) {
        const k = Math.max(0, f.life / f.max);
        if (f.kind === 'p') r.alpha(k, () => r.rect(f.x, f.y, 1, 1, f.color));
        else if (f.kind === 'ring') r.alpha(k, () => r.ring(f.x, f.y, Math.round(f.r0 + (f.r1 - f.r0) * (1 - k)), f.color));
        else if (f.kind === 'text') r.text(f.text, f.x, f.y, { align: 'center', color: f.color, alpha: Math.min(1, k * 2), shadow: CB.Pal.C.ink });
      }
    },
  };
  CB.Fx = Fx;
})(window.CB);
