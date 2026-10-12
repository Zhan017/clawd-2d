// Draw order for one world frame. Cosmetic only: nothing here mutates world state.
(function (CB) {
  'use strict';
  // Blinks faster than 4 Hz go through Calm mode when it is loaded.
  const blink = (t, hz) => (CB.Comfort && CB.Comfort.blink ? CB.Comfort.blink(t, hz) : Math.floor(t * hz) % 2 === 0);

  function drawHazard(r, h, t) {
    const k = Math.min(1, h.life / 0.5);
    r.alpha(0.45 * k, () => r.disc(h.x, h.y, h.r, CB.Pal.C.greenDark));
    r.alpha(0.6 * k, () => r.ring(h.x, h.y, h.r - (Math.floor(t * 6) % 3), CB.Pal.C.green));
  }

  function drawTelegraph(r, s, t) {
    const on = blink(t, 12);
    const k = 1 - Math.max(0, s.t) / (s.total || 0.6);
    r.ring(s.x, s.y, Math.max(2, Math.round(10 - 7 * k)), on ? CB.Pal.C.gold : CB.Pal.C.hurt);
    r.text('!', s.x, s.y - 4, { align: 'center', color: on ? CB.Pal.C.gold : CB.Pal.C.hurt, shadow: CB.Pal.C.ink });
  }

  // P0 elites: a pulsing gold ring and a red "P0" tag above the bug.
  function drawElite(r, e, t) {
    r.alpha(0.6 + 0.3 * Math.sin(t * 6), () => r.ring(e.x, e.y, e.r + 3, CB.Pal.C.gold));
    r.rect(e.x - 5, e.y - e.r - 10, 11, 7, CB.Pal.C.redDark);
    r.text('P0', e.x, e.y - e.r - 10, { align: 'center', color: CB.Pal.C.white });
  }

  const zOf = (e) => (e.z != null ? e.z : e.y);

  CB.WorldDraw = {
    draw(r, w, t, opts) {
      CB.Arena.draw(r, w.stage, t, w);
      if (CB.Fx.drawUnder) CB.Fx.drawUnder(w, r, t);
      for (const h of w.hazards) drawHazard(r, h, t);
      for (const s of w.spawns) drawTelegraph(r, s, t);
      if (CB.Pickups && CB.Pickups.draw) CB.Pickups.draw(w, r, t);
      const list = w.enemies.filter((e) => !e.dead && e.visible).sort((a, b) => zOf(a) - zOf(b));
      for (const e of list) {
        const mod = CB.Enemies[e.kind];
        if (!mod || !mod.draw) continue;
        const pose = CB.Fx.pose && !e.boss ? CB.Fx.pose(e) : null;
        if (pose && (pose.sx !== 1 || pose.sy !== 1)) r.squash(e.x, e.y + e.r, pose.sx, pose.sy, () => mod.draw(e, r, t));
        else mod.draw(e, r, t);
        if (e.elite) drawElite(r, e, t);
      }
      CB.Player.draw(w.player, r, t);
      if (CB.Compact && CB.Compact.drawPrompt) CB.Compact.drawPrompt(w, r, t);
      CB.Projectiles.draw(w, r, t, 'player');
      if (w.boss && !w.boss.defeated && w.boss.draw) w.boss.draw(r, t);
      if (CB.Compact && CB.Compact.draw) CB.Compact.draw(w, r, t);
      CB.Fx.draw(w, r, t);
      CB.Projectiles.draw(w, r, t, 'enemy'); // last, so no effect ever hides a bullet
      if (opts && opts.hitboxes) {
        for (const e of w.enemies) if (!e.dead) r.ring(e.x, e.y, e.r, e.targetable ? '#00FF88' : e.solid ? '#FFAA00' : '#888888');
        r.ring(w.player.x, w.player.y, w.player.r, '#00FFFF');
        for (const b of w.eBullets) r.ring(b.x, b.y, b.r, '#FF00FF');
      }
    },
  };
})(window.CB);
