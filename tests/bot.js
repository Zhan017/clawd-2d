'use strict';
// Deterministic headless bot.
// Targeting: boss parts first. Among them it keeps its current target unless another part has 15+ more HP.
// This level-keeping wears the Merge Conflict twins down evenly, so both can fall inside the resolve window,
// and since Heisenbug mirrors one HP pool into every moth it simply keeps staring at the moth it has (which is
// what fills that moth's strain ring). With no boss part it shoots the nearest regular bug.
// Movement: kite at ~80 px, strafe, lead the aim, steer off walls, dash across bullets about to hit.
// /compact (rev 3 meter: 45 hits, every boss fight starts full) fires as soon as the meter is full during a boss fight,
// or when 6+ enemy bullets are on screen.
function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function makeBot(opts) {
  const o = Object.assign({ kite: 80, delayTicks: 0 }, opts || {});
  let strafe = 1;
  let strafeT = 1.5;
  let current = null;
  const queue = [];

  function decide(run) {
    const w = run.world;
    const p = w.player;
    const inp = { moveX: 0, moveY: 0, aimX: p.x + 40, aimY: p.y, fire: true, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] };
    if (run.state === 'patchPick') {
      if (run.stateT > 0.7) inp.choice = 1;
      inp.fire = false;
      return inp;
    }
    if (run.state === 'dead') {
      if (run.stateT > 0.7) inp.retry = true;
      return inp;
    }
    const live = (e) => e && !e.dead && e.visible && e.targetable;
    const bossParts = w.enemies.filter((e) => live(e) && e.boss);
    let best = null;
    if (bossParts.length) {
      const top = bossParts.reduce((a, b) => (b.hp > a.hp ? b : a));
      best = live(current) && current.boss && top.hp - current.hp < 15 ? current : top;
    } else {
      let bestD = Infinity;
      for (const e of w.enemies) {
        if (!live(e)) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    current = best;
    let mx = 0;
    let my = 0;
    if (best) {
      const d = Math.hypot(best.x - p.x, best.y - p.y) || 1;
      const lead = d / p.stats.boltSpeed;
      inp.aimX = best.x + (best.vx || 0) * lead;
      inp.aimY = best.y + (best.vy || 0) * lead;
      const nx = (best.x - p.x) / d;
      const ny = (best.y - p.y) / d;
      if (d < o.kite - 15) {
        mx -= nx;
        my -= ny;
      } else if (d > o.kite + 25) {
        mx += nx;
        my += ny;
      }
      mx += -ny * strafe * 0.8;
      my += nx * strafe * 0.8;
    }
    strafeT -= 1 / 60;
    if (strafeT <= 0) {
      strafe = -strafe;
      strafeT = 1.2 + ((w.time * 7.31) % 1);
    }
    const a = w.arena;
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    if (p.x < a.x + 24 || p.x > a.x + a.w - 24 || p.y < a.y + 24 || p.y > a.y + a.h - 24) {
      mx += (cx - p.x) / 50;
      my += (cy - p.y) / 50;
    }
    // Leak puddles hurt: step out of them, and away from where a lobbed blob is about to land (its shadow).
    const zones = [];
    for (const h of w.hazards || []) if (!h.dead && h.kind === 'puddle') zones.push([h.x, h.y, h.r]);
    for (const e of w.enemies) if (!e.dead && e.kind === 'leakBlob' && e.data) zones.push([e.data.tx, e.data.ty, 12]);
    for (const [hx, hy, hr] of zones) {
      const dx = p.x - hx;
      const dy = p.y - hy;
      const d = Math.hypot(dx, dy) || 1;
      if (d < hr + 10) {
        mx += (dx / d) * 2;
        my += (dy / d) * 2;
      }
    }
    for (const b of w.eBullets) {
      const vv = b.vx * b.vx + b.vy * b.vy;
      if (vv < 1) continue;
      const rx = p.x - b.x;
      const ry = p.y - b.y;
      const tc = (rx * b.vx + ry * b.vy) / vv;
      if (tc < 0 || tc > 0.3) continue;
      const qx = b.x + b.vx * tc - p.x;
      const qy = b.y + b.vy * tc - p.y;
      if (qx * qx + qy * qy < 100) {
        const l = Math.sqrt(vv);
        const side = qx * -b.vy + qy * b.vx > 0 ? -1 : 1;
        mx += (-b.vy / l) * side * 1.5;
        my += (b.vx / l) * side * 1.5;
        if (p.dashCd <= 0) inp.dash = true;
        break;
      }
    }
    if (w.context && w.context.value >= w.context.max && (bossParts.length || w.eBullets.length >= 6)) inp.compact = true;
    inp.moveX = clamp1(mx);
    inp.moveY = clamp1(my);
    return inp;
  }

  // delayTicks > 0 simulates human reaction time: the input acted on now was decided delayTicks ticks ago.
  // Menu choices are never delayed.
  return function botInput(run) {
    const now = decide(run);
    if (!o.delayTicks || run.state === 'patchPick' || run.state === 'dead') return now;
    queue.push(now);
    if (queue.length <= o.delayTicks) return Object.assign({}, now, { moveX: 0, moveY: 0, dash: false, compact: false });
    return queue.shift();
  };
}

module.exports = { makeBot };
