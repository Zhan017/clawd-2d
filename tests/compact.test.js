'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/compact.js'];

function setup(o) {
  const CB = H.load(FILES);
  CB.Enemies.dummy = { create: (w, x, y, op) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 1000, r: 5, contact: false }, op || {})), update() {}, draw() {} };
  const w = CB.createWorld(Object.assign({ seed: 9 }, o || {}));
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const count = (w, type) => w.events.filter((e) => e.type === type).length;

test('compact: bolt damage charges the meter scaled by chain, capped at 60, announced once', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  w.damageEnemy(e, 1, { dmg: 1 });
  assert.ok(Math.abs(w.context.value - 1.05) < 1e-9, `${w.context.value}`);
  for (let i = 0; i < 100; i++) w.damageEnemy(e, 1, { dmg: 1 });
  assert.equal(w.context.value, 60);
  assert.equal(count(w, 'compactReady'), 1);
});

test('compact: damage with no bolt source, or from the wave itself, never charges', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  w.damageEnemy(e, 5);
  w.damageEnemy(e, 5, { compact: true });
  assert.equal(w.context.value, 0);
});

test('compact: refused below full; at full it empties the meter, gives 0.5 s invuln and emits compact', () => {
  const { w } = setup();
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(count(w, 'compact'), 0);
  w.context.value = 60;
  H.stepN(w, 1, () => H.makeInput({ compact: true }));
  assert.equal(count(w, 'compact'), 1);
  assert.equal(w.context.value, 0);
  assert.ok(w.player.invuln > 0.45);
  assert.ok(w.compactWave || w.compactBannerT > 0);
});

test('compact: the wave hits each enemy once, 3 to regulars and 5 to boss parts, skipping untouchables', () => {
  const { w } = setup();
  const reg = w.spawnEnemy('dummy', 100, 100, { hp: 10 });
  const boss = w.spawnEnemy('dummy', 220, 60, { hp: 10, boss: true, regular: false });
  const untarg = w.spawnEnemy('dummy', 60, 60, { hp: 10, targetable: false });
  const hidden = w.spawnEnemy('dummy', 260, 140, { hp: 10, visible: false });
  const solid = w.spawnEnemy('dummy', 40, 150, { hp: 10, targetable: false, solid: true });
  w.context.value = 60;
  H.stepN(w, 60, (i) => H.makeInput({ compact: i === 0 }));
  assert.equal(reg.hp, 7);
  assert.equal(boss.hp, 5);
  assert.equal(untarg.hp, 10);
  assert.equal(hidden.hp, 10);
  assert.equal(solid.hp, 10);
  assert.equal(w.compactWave, null);
});

test('compact: deletes enemy bullets and puddles inside the radius and leaves player bolts', () => {
  const { w } = setup();
  const p = w.player;
  for (let i = 0; i < 20; i++) w.fireEnemyBullet(p.x + Math.cos(i) * 50, p.y + Math.sin(i) * 30, 0, 0);
  w.addHazard({ x: p.x - 80, y: p.y - 20 });
  const bolt = w.firePlayerBolt(p.x, 40, 0);
  bolt.vx = 0;
  bolt.vy = 0;
  w.context.value = 60;
  H.stepN(w, 40, (i) => H.makeInput({ compact: i === 0 }));
  assert.equal(w.eBullets.length, 0);
  assert.equal(w.hazards.length, 0);
  assert.ok(w.pBullets.length >= 1);
});

test('compact: cannot cast while dead or after a boss defeat', () => {
  const { CB, w } = setup();
  w.context.value = 60;
  w.boss = { defeated: true, update() {}, draw() {} };
  assert.equal(CB.Compact.cast(w), false);
  w.boss = null;
  w.player.dead = true;
  assert.equal(CB.Compact.cast(w), false);
});

test('graze: a bullet passing within the band charges 0.75 once', () => {
  const { w } = setup();
  const p = w.player;
  w.fireEnemyBullet(p.x - 40, p.y + 9, 0, 80);
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(w.context.value - 0.75) < 1e-9, `${w.context.value}`);
  assert.equal(count(w, 'graze'), 1);
  assert.equal(p.hearts, 5);
});

test('graze: a perfect dash through a bullet gives +3 once; hurt-invuln overlap gives nothing', () => {
  let { w } = setup();
  H.stepN(w, 1, () => H.makeInput({ dash: true, moveX: 1 }));
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 2, () => H.makeInput({ moveX: 1 }));
  assert.equal(w.context.value, 3);
  assert.ok(w.events.some((e) => e.type === 'graze' && e.perfect));
  ({ w } = setup());
  w.player.invuln = 1;
  w.player.hurtT = 1;
  w.fireEnemyBullet(w.player.x, w.player.y, 0, 0);
  H.stepN(w, 2, idle);
  assert.equal(w.context.value, 0);
});

test('graze: 100 grazing bullets at once never exceed the 4.5 budget', () => {
  const { w } = setup();
  const p = w.player;
  for (let i = 0; i < 100; i++) w.fireEnemyBullet(p.x + Math.cos(i) * 10, p.y + Math.sin(i) * 10, 0, 0);
  H.stepN(w, 1, idle);
  assert.ok(w.context.value <= 4.5 + 1e-9, `${w.context.value}`);
});

test('chain: grows per applied hit, decays after 1.5 s, resets on a real heart loss, multiplier caps at 2', () => {
  const { CB, w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  for (let i = 0; i < 30; i++) w.damageEnemy(e, 1, { dmg: 1 });
  assert.equal(w.chain.n, 30);
  assert.equal(w.chain.mul, 2);
  H.stepN(w, 95, idle);
  assert.equal(w.chain.n, 0);
  for (let i = 0; i < 5; i++) w.damageEnemy(e, 1, { dmg: 1 });
  CB.Player.hurt(w.player, w, null);
  assert.equal(w.chain.n, 0);
});
