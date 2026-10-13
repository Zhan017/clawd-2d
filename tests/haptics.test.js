'use strict';
// CB.Haptics: one effect per step (the highest priority), calm mode off switch, and a sink that may be missing or broken.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const BASE = ['src/core/ns.js', 'src/core/haptics.js'];

function setup(files) {
  const CB = H.load(files || BASE);
  const calls = [];
  const sink = { rumble: (...args) => { calls.push(args); } };
  return { CB, calls, sink };
}
const ev = (type, extra) => Object.assign({ type }, extra);

test('haptics: EFFECTS match the contract', () => {
  const { CB } = setup();
  assert.deepEqual(H.plain(CB.Haptics.EFFECTS), {
    playerHurt: { strong: 0.8, weak: 0.4, ms: 160, vib: 40, pri: 2 },
    playerDie: { strong: 1.0, weak: 1.0, ms: 400, vib: [60, 40, 120], pri: 3 },
    bossPhase: { strong: 0.6, weak: 0.6, ms: 250, vib: 50, pri: 2 },
    bossDie: { strong: 1.0, weak: 0.7, ms: 600, vib: [80, 50, 80, 50, 160], pri: 3 },
    compact: { strong: 0.3, weak: 0.9, ms: 300, vib: 30, pri: 1 },
    pickup: { strong: 0.0, weak: 0.3, ms: 80, vib: 15, pri: 0 },
  });
});

test('haptics: every effect name is an event the game really emits', () => {
  const { CB } = setup();
  const files = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(path.join(H.ROOT, dir), { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(dir, f.name));
      else if (f.name.endsWith('.js')) files.push(path.join(dir, f.name));
    }
  })('src/game');
  const source = files.map((f) => fs.readFileSync(path.join(H.ROOT, f), 'utf8')).join('\n');
  for (const name of Object.keys(CB.Haptics.EFFECTS)) assert.ok(source.includes(`emit('${name}'`), `no src/game file emits '${name}'`);
});

test('haptics: each known event rumbles once with its own numbers, and its name comes back', () => {
  const { CB, calls, sink } = setup();
  for (const [name, fx] of Object.entries(CB.Haptics.EFFECTS)) {
    calls.length = 0;
    assert.equal(CB.Haptics.handleEvents([ev(name, { x: 10, y: 20 })], sink), name);
    assert.equal(calls.length, 1, name);
    assert.deepEqual(H.plain(calls[0]), H.plain([fx.strong, fx.weak, fx.ms, fx.vib]), name);
  }
});

test('haptics: the highest-priority event of a step wins, whatever the order', () => {
  const { CB, calls, sink } = setup();
  const play = (...names) => {
    calls.length = 0;
    const got = CB.Haptics.handleEvents(names.map((n) => ev(n)), sink);
    assert.equal(calls.length, 1, `${names.join(',')}: exactly one rumble`);
    return got;
  };
  assert.equal(play('pickup', 'playerHurt'), 'playerHurt');
  assert.equal(play('playerHurt', 'pickup'), 'playerHurt');
  assert.equal(play('pickup', 'compact'), 'compact');
  assert.equal(play('compact', 'playerHurt', 'pickup'), 'playerHurt');
  assert.equal(play('compact', 'bossDie', 'playerHurt'), 'bossDie');
  assert.equal(play('playerHurt', 'bossPhase', 'playerDie', 'compact'), 'playerDie');
  assert.equal(play('pickup', 'pickup', 'pickup'), 'pickup');
  assert.deepEqual(H.plain(calls[0]), [0, 0.3, 80, 15], 'the winner is the one that plays');
});

test('haptics: on a priority tie the first event wins', () => {
  const { CB, calls, sink } = setup();
  assert.equal(CB.Haptics.handleEvents([ev('playerHurt'), ev('bossPhase')], sink), 'playerHurt');
  assert.equal(CB.Haptics.handleEvents([ev('bossPhase'), ev('playerHurt')], sink), 'bossPhase');
  assert.equal(CB.Haptics.handleEvents([ev('playerDie'), ev('bossDie')], sink), 'playerDie');
  assert.equal(CB.Haptics.handleEvents([ev('bossDie'), ev('playerDie')], sink), 'bossDie');
  assert.equal(CB.Haptics.handleEvents([ev('bossDie'), ev('bossDie')], sink), 'bossDie');
  assert.equal(calls.length, 5, 'one rumble per call');
  assert.deepEqual(H.plain(calls[2]), [1, 1, 400, [60, 40, 120]]);
  assert.deepEqual(H.plain(calls[3]), [1, 0.7, 600, [80, 50, 80, 50, 160]]);
});

test('haptics: unknown events, empty lists and junk entries play nothing and return null', () => {
  const { CB, calls, sink } = setup();
  const none = (evs) => {
    assert.strictEqual(CB.Haptics.handleEvents(evs, sink), null, JSON.stringify(evs));
  };
  none([]);
  none([ev('shoot'), ev('hit'), ev('enemyDie'), ev('dash'), ev('spawn')]);
  none([null, undefined, 0, 'playerHurt', {}, { type: 5 }, { type: null }, { type: ['playerHurt'] }, { kind: 'playerHurt' }]);
  none([ev('constructor'), ev('toString'), ev('__proto__'), ev('hasOwnProperty'), ev('pri')]);
  none([ev('PlayerHurt'), ev('playerhurt'), ev(' playerHurt')]);
  none(null);
  none(undefined);
  none('playerHurt');
  none({ type: 'playerHurt' });
  none(7);
  assert.equal(calls.length, 0);
  // Unknown entries do not disturb a known one among them.
  assert.equal(CB.Haptics.handleEvents([null, ev('shoot'), ev('compact'), 'x', ev('hit')], sink), 'compact');
  assert.equal(calls.length, 1);
});

test('haptics: a missing sink, or one without a rumble function, is a quiet null', () => {
  const { CB } = setup();
  const evs = [ev('playerDie')];
  for (const sink of [undefined, null, {}, { rumble: 5 }, { rumble: null }, { rumble: 'yes' }, 'sink', 0]) {
    assert.doesNotThrow(() => CB.Haptics.handleEvents(evs, sink));
    assert.strictEqual(CB.Haptics.handleEvents(evs, sink), null, String(sink));
  }
  assert.doesNotThrow(() => CB.Haptics.handleEvents(evs));
});

test('haptics: a sink that throws never stops the caller, and nothing is reported as played', () => {
  const { CB } = setup();
  const sink = { rumble() { throw new Error('motor jammed'); } };
  assert.doesNotThrow(() => CB.Haptics.handleEvents([ev('bossDie')], sink));
  assert.strictEqual(CB.Haptics.handleEvents([ev('bossDie')], sink), null);
});

test('haptics: the sink is called as a method (its `this` is the sink) with exactly four arguments', () => {
  const { CB } = setup();
  let self = null;
  let n = -1;
  const sink = { rumble() { self = this; n = arguments.length; } };
  CB.Haptics.handleEvents([ev('compact')], sink);
  assert.equal(self, sink);
  assert.equal(n, 4);
});

test('haptics: the vibration pattern handed out is a copy, so a sink cannot change the effect table', () => {
  const { CB } = setup();
  const sink = { rumble(strong, weak, ms, vib) { vib.push(9999); vib[0] = -1; } };
  CB.Haptics.handleEvents([ev('playerDie')], sink);
  assert.deepEqual(H.plain(CB.Haptics.EFFECTS.playerDie.vib), [60, 40, 120]);
});

test('haptics: calm mode (a stub) switches haptics off', () => {
  const { CB, calls, sink } = setup();
  let calm = true;
  CB.Comfort = { calm: () => calm };
  assert.strictEqual(CB.Haptics.handleEvents([ev('playerDie')], sink), null);
  assert.strictEqual(CB.Haptics.handleEvents([ev('bossDie'), ev('pickup')], sink), null);
  assert.equal(calls.length, 0);
  calm = false;
  assert.equal(CB.Haptics.handleEvents([ev('playerDie')], sink), 'playerDie', 'calm is read every call, not cached');
  assert.equal(calls.length, 1);
  calm = true;
  assert.strictEqual(CB.Haptics.handleEvents([ev('playerDie')], sink), null);
  assert.equal(calls.length, 1);
});

test('haptics: the real Comfort module turns haptics off in calm mode and back on', () => {
  const { CB, calls, sink } = setup(['src/core/ns.js', 'src/game/comfort.js', 'src/core/haptics.js']);
  CB.Comfort.set(true);
  assert.strictEqual(CB.Haptics.handleEvents([ev('compact')], sink), null);
  assert.equal(calls.length, 0);
  CB.Comfort.set(false);
  assert.equal(CB.Haptics.handleEvents([ev('compact')], sink), 'compact');
  assert.equal(calls.length, 1);
});

test('haptics: without Comfort, or with a Comfort that has no calm(), haptics play', () => {
  const { CB, calls, sink } = setup();
  assert.equal(CB.Comfort, undefined);
  assert.equal(CB.Haptics.handleEvents([ev('pickup')], sink), 'pickup');
  CB.Comfort = {};
  assert.equal(CB.Haptics.handleEvents([ev('pickup')], sink), 'pickup');
  CB.Comfort = { calm: 'yes' };
  assert.equal(CB.Haptics.handleEvents([ev('pickup')], sink), 'pickup');
  assert.equal(calls.length, 3);
});

test('haptics: only a truthy calm() silences haptics', () => {
  const { CB, calls, sink } = setup();
  CB.Comfort = { calm: () => 0 };
  assert.equal(CB.Haptics.handleEvents([ev('pickup')], sink), 'pickup');
  CB.Comfort = { calm: () => undefined };
  assert.equal(CB.Haptics.handleEvents([ev('pickup')], sink), 'pickup');
  CB.Comfort = { calm: () => 1 };
  assert.strictEqual(CB.Haptics.handleEvents([ev('pickup')], sink), null, 'any truthy calm() means calm');
  assert.equal(calls.length, 2);
});

test('haptics: through CB.Gamepad.rumble a hurt event reaches a pad actuator', () => {
  const CB = H.load([...BASE, 'src/core/gamepad.js']);
  const played = [];
  const pad = { vibrationActuator: { playEffect: (type, params) => { played.push([type, params]); return Promise.resolve(); } } };
  const sink = { rumble: (strong, weak, ms) => CB.Gamepad.rumble(pad, strong, weak, ms) };
  assert.equal(CB.Haptics.handleEvents([ev('pickup'), ev('playerHurt')], sink), 'playerHurt');
  assert.equal(played.length, 1);
  assert.equal(played[0][0], 'dual-rumble');
  assert.deepEqual(H.plain(played[0][1]), { startDelay: 0, duration: 160, weakMagnitude: 0.4, strongMagnitude: 0.8 });
});

test('haptics: a phone sink gets the vibration pattern', () => {
  const { CB } = setup();
  const vibrated = [];
  const sink = { rumble: (strong, weak, ms, vib) => vibrated.push(vib) };
  CB.Haptics.handleEvents([ev('playerHurt')], sink);
  CB.Haptics.handleEvents([ev('bossDie')], sink);
  assert.deepEqual(H.plain(vibrated), [40, [80, 50, 80, 50, 160]]);
});
