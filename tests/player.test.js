'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function world(patches) {
  const CB = H.loadWith();
  return { CB, w: CB.createWorld({ seed: 3, patches: patches || {} }) };
}
const mv = (mx, my, extra) => () => H.makeInput(Object.assign({ moveX: mx, moveY: my, aimX: 300, aimY: 30 }, extra || {}));

test('player: moves at 80 px/s', () => {
  const { w } = world();
  const x0 = w.player.x;
  H.stepN(w, 60, mv(1, 0));
  assert.ok(Math.abs(w.player.x - x0 - 80) < 1.5, `${w.player.x - x0}`);
});

test('player: diagonal input is normalised', () => {
  const { w } = world();
  const p = w.player;
  const x0 = p.x;
  const y0 = p.y;
  H.stepN(w, 30, mv(1, 1));
  const d = Math.hypot(p.x - x0, p.y - y0);
  assert.ok(Math.abs(d - 40) < 1.5, `${d}`);
});

test('player: stays inside the arena', () => {
  const { w } = world();
  H.stepN(w, 400, mv(-1, -1));
  assert.equal(w.player.x, 13);
  assert.equal(w.player.y, 25);
});

test('player: dash covers ~39 px, grants 0.25 s invulnerability, then cools down', () => {
  const { w } = world();
  const p = w.player;
  const x0 = p.x;
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  assert.ok(p.invuln > 0.2);
  H.stepN(w, 17, () => H.makeInput({ aimX: 300, aimY: 30 }));
  const d = p.x - x0;
  assert.ok(Math.abs(d - 39) <= 1.5, `dash distance ${d}`);
  const dashes = () => w.events.filter((e) => e.type === 'dash').length;
  assert.equal(dashes(), 1);
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  assert.equal(dashes(), 1, 'second dash ignored during cooldown');
  H.stepN(w, 40, () => H.makeInput({ aimX: 300, aimY: 30 }));
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  assert.equal(dashes(), 2, 'dash available after 0.8 s');
});

test('player: dash protection lasts exactly 15 ticks (0.25 s)', () => {
  const { CB, w } = world();
  const p = w.player;
  let protectedTicks = 0;
  for (let i = 0; i < 40; i++) {
    H.stepN(w, 1, () => H.makeInput({ moveX: i === 0 ? 1 : 0, dash: i === 0, aimX: 300, aimY: 30 }));
    if (!CB.Player.canBeHit(p)) protectedTicks++;
  }
  assert.equal(protectedTicks, 15);
});

test('player: a dash trail never holds more than 3 afterimages', () => {
  const { w } = world();
  const p = w.player;
  let peak = 0;
  for (let i = 0; i < 30; i++) {
    H.stepN(w, 1, () => H.makeInput({ moveX: 1, dash: i === 0, aimX: 300, aimY: 30 }));
    peak = Math.max(peak, p.trail.length);
  }
  assert.equal(peak, 3);
});

test('player: a dash pressed on a frozen hit-stop tick fires on the first live tick', () => {
  const { CB, w } = world();
  const p = w.player;
  CB.Player.hurt(p, w, null);
  assert.ok(w.hitstop > 0, 'a normal (non-god) hit freezes the world');
  let tick = 0;
  let live = -1;
  let dashed = -1;
  H.stepN(w, 1, () => H.makeInput({ moveX: 1, dash: true, aimX: 300, aimY: 30 }));
  assert.equal(w.time, 0, 'the press landed on a frozen tick');
  assert.equal(w.events.some((e) => e.type === 'dash'), false);
  for (; tick < 12; tick++) {
    const t0 = w.time;
    H.stepN(w, 1, () => H.makeInput({ moveX: 1, aimX: 300, aimY: 30 }));
    if (live < 0 && w.time > t0) live = tick;
    if (dashed < 0 && w.events.some((e) => e.type === 'dash')) dashed = tick;
  }
  assert.ok(live >= 0);
  assert.equal(dashed, live, 'dash fires on the first live tick');
});

test('player: god mode never freezes the world on a hit', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 1, god: true });
  assert.equal(CB.Player.hurt(w.player, w, null), true);
  assert.equal(w.hitstop, 0);
  assert.equal(w.stats.wouldHits, 1);
  H.stepN(w, 1, () => H.makeInput());
  assert.ok(w.time > 0);
});

test('player: hurt invulnerability comes from p.hurtInvuln (default 1 s) so a mode can lower it', () => {
  const { CB, w } = world();
  const p = w.player;
  assert.equal(p.hurtInvuln, 1.0);
  CB.Player.hurt(p, w, null);
  assert.equal(p.invuln, 1.0);
  assert.equal(p.hurtT, 1.0);
  const w2 = world().w;
  w2.player.hurtInvuln = 0.7;
  CB.Player.hurt(w2.player, w2, null);
  assert.equal(w2.player.invuln, 0.7);
  assert.equal(w2.player.hurtT, 0.7);
});

test('player: dash with no movement goes toward the aim point', () => {
  const { w } = world();
  const p = w.player;
  const y0 = p.y;
  H.stepN(w, 12, (i) => H.makeInput({ aimX: p.x, aimY: 0, dash: i === 0 }));
  assert.ok(p.y < y0 - 30);
});

test('player: bullets pass through while dashing', () => {
  const { w } = world();
  const p = w.player;
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  w.fireEnemyBullet(p.x, p.y, 0, 0);
  H.stepN(w, 1, mv(1, 0));
  assert.equal(p.hearts, 5);
});

test('player: firing respects cooldown and spread patch', () => {
  let { w } = world();
  H.stepN(w, 60, () => H.makeInput({ aimX: 300, aimY: 126, fire: true }));
  const shots = w.events.filter((e) => e.type === 'shoot').length;
  assert.ok(shots >= 5 && shots <= 6, `shots ${shots}`);
  ({ w } = world({ spread: 2 }));
  H.stepN(w, 1, () => H.makeInput({ aimX: 300, aimY: 126, fire: true }));
  assert.equal(w.pBullets.length, 5);
});

test('player: holding fire for 10 s gives 50-51 shots (cooldown keeps its sub-tick remainder)', () => {
  const { w } = world();
  H.stepN(w, 600, () => H.makeInput({ aimX: 300, aimY: 126, fire: true }));
  assert.ok(w.stats.shots >= 50 && w.stats.shots <= 51, `shots ${w.stats.shots}`);
});

test('player: hurt grants 1 s invulnerability; death at 0 hearts', () => {
  const { CB, w } = world();
  const p = w.player;
  assert.equal(CB.Player.hurt(p, w, null), true);
  assert.equal(p.hearts, 4);
  assert.equal(CB.Player.hurt(p, w, null), false, 'invulnerable');
  p.invuln = 0;
  p.hearts = 1;
  CB.Player.hurt(p, w, null);
  assert.equal(p.dead, true);
  assert.ok(w.events.some((e) => e.type === 'playerDie'));
});

test('player: god mode counts would-be hits without losing hearts', () => {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 1, god: true });
  CB.Player.hurt(w.player, w, null);
  assert.equal(w.player.hearts, 5);
  assert.equal(w.stats.wouldHits, 1);
});

test('player: extra heart patch raises max hearts', () => {
  const { w } = world({ heart: 2 });
  assert.equal(w.player.hearts, 7);
});

test('player: sprites are all defined at 16x12', () => {
  const { CB } = world();
  for (const n of ['clawd_idle0', 'clawd_idle1', 'clawd_walk0', 'clawd_walk2', 'clawd_blink']) {
    const d = CB.Art.spriteDef(n);
    assert.ok(d, n);
    assert.equal(d.w, 16);
    assert.equal(d.h, 12);
  }
});
