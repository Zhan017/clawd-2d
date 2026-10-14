'use strict';
// Daily build: CB.Daily (date key, seed, starting patch, saved best), the run's daily flag and its own patch-offer stream,
// and the title's daily build button on every device.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const DAY = '2026-10-13';
const DEVICES = ['kbm', 'touch', 'pad'];
const PAD0 = { a: false, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false };

// A localStorage stand-in whose contents the tests can read and seed.
function memStore(init) {
  const m = Object.assign({}, init || {});
  return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}
const load = (store) => H.load(undefined, { localStorage: store || memStore() });
const utc = (...a) => new Date(Date.UTC(...a));

// ---- dateKey and today ---------------------------------------------------------------------------------------------------------------

test('daily: dateKey is the UTC calendar date, whatever the time zone of the Date', () => {
  const D = load().Daily;
  assert.equal(D.dateKey(utc(2026, 0, 1, 0, 0, 0)), '2026-01-01', 'the first instant of a day');
  assert.equal(D.dateKey(new Date('2026-12-31T23:59:59.999Z')), '2026-12-31', 'the last millisecond of a day');
  assert.equal(D.dateKey(new Date('2026-03-01T00:30:00+05:00')), '2026-02-28', 'east of UTC: still the day before in UTC');
  assert.equal(D.dateKey(new Date('2026-10-13T23:59:59.999-12:00')), '2026-10-14', 'west of UTC: already the next day in UTC');
  assert.equal(D.dateKey(utc(2028, 1, 29, 12)), '2028-02-29', 'leap day');
  assert.equal(D.dateKey(utc(2027, 1, 28, 23, 59, 59, 999)), '2027-02-28');
  assert.equal(D.dateKey(utc(2027, 2, 1, 0, 0, 0)), '2027-03-01', 'no leap day in 2027');
  assert.equal(D.dateKey(utc(2026, 11, 31, 23, 59, 59, 999)) < D.dateKey(utc(2027, 0, 1)), true, 'keys sort as dates');
  const old = utc(2000, 0, 1);
  old.setUTCFullYear(99);
  assert.equal(D.dateKey(old), '0099-01-01', 'the year is padded to four digits');
  assert.equal(D.dateKey(Date.UTC(2026, 9, 13, 1)), DAY, 'a time value works too');
});

test('daily: dateKey of nothing or of an invalid date is a valid key for now; today is dateKey of now', () => {
  const D = load().Daily;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const before = D.dateKey(new Date());
  const got = [D.dateKey(), D.dateKey(new Date(NaN)), D.dateKey('not a date'), D.today()];
  const after = D.dateKey(new Date());
  for (const k of got) {
    assert.match(k, re);
    assert.ok(k === before || k === after, 'now: ' + k);
  }
});

// ---- seed and patch --------------------------------------------------------------------------------------------------------------------

test('daily: hash32 is FNV-1a 32 (the published vectors)', () => {
  const D = load().Daily;
  assert.equal(D.hash32(''), 0x811c9dc5);
  assert.equal(D.hash32('a'), 0xe40c292c);
  assert.equal(D.hash32('foobar'), 0xbf9cf968);
});

test('daily: seedFor is deterministic, a non-zero uint32, the FNV hash of the prefixed key, and differs from day to day', () => {
  const D = load().Daily;
  assert.equal(D.seedFor(DAY), D.seedFor(DAY));
  assert.equal(D.seedFor(DAY), D.hash32('clawd-daily:' + DAY));
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const s = D.seedFor(D.dateKey(utc(2026, 0, 1 + i)));
    assert.ok(Number.isInteger(s) && s > 0 && s <= 0xffffffff, 'uint32 and not 0: ' + s);
    seen.add(s);
  }
  assert.equal(seen.size, 2000, 'no two of 2000 consecutive days share a seed');
  assert.notEqual(D.seedFor('2026-10-13'), D.seedFor('2026-10-14'));
});

test('daily: patchFor is deterministic, always one of the patches, and every patch comes up over a year', () => {
  const CB = load();
  const D = CB.Daily;
  const seen = new Set();
  for (let i = 0; i < 365; i++) {
    const key = D.dateKey(utc(2026, 0, 1 + i));
    const p = D.patchFor(key);
    assert.ok(CB.Patches.ORDER.includes(p), 'valid patch id: ' + p);
    assert.equal(D.patchFor(key), p, 'deterministic');
    seen.add(p);
  }
  assert.equal(seen.size, CB.Patches.ORDER.length);
  assert.equal(D.patchFor(DAY), CB.Patches.ORDER[D.seedFor(DAY) % CB.Patches.ORDER.length]);
});

test('daily: patchFor without the patch module is null, and the rest still works', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/daily.js']);
  assert.equal(CB.Daily.patchFor(DAY), null);
  assert.equal(CB.Daily.dateKey(utc(2026, 9, 13)), DAY);
  assert.ok(CB.Daily.seedFor(DAY) > 0);
});

test('daily: every day starts a run that really has its patch', () => {
  const CB = load();
  for (let i = 0; i < 14; i++) {
    const key = CB.Daily.dateKey(utc(2026, 9, 13 + i));
    const patch = CB.Daily.patchFor(key);
    const run = CB.createRun({ daily: key, seed: CB.Daily.seedFor(key), patches: { [patch]: 1 } });
    assert.deepEqual(H.plain(run.patches), { [patch]: 1 });
    assert.deepEqual(H.plain(run.world.player.stats), H.plain(CB.Patches.computeStats({ [patch]: 1 })), patch);
  }
});

// ---- record and result -----------------------------------------------------------------------------------------------------------------

test('daily: result is null until a record exists; each date is on its own', () => {
  const D = load().Daily;
  assert.equal(D.result(DAY), null);
  D.record(DAY, { time: 300, deaths: 1, yolo: false });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 300, deaths: 1, yolo: false });
  assert.equal(D.result('2026-10-14'), null);
  D.record('2026-10-14', { time: 200, deaths: 0, yolo: true });
  assert.deepEqual(H.plain(D.result('2026-10-14')), { time: 200, deaths: 0, yolo: true });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 300, deaths: 1, yolo: false }, 'the other date is untouched');
});

test('daily: record keeps the best clear of a date: fewest deaths, then fastest, a tie keeps the first', () => {
  const D = load().Daily;
  D.record(DAY, { time: 500, deaths: 3, yolo: false });
  D.record(DAY, { time: 400, deaths: 4, yolo: false });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 500, deaths: 3, yolo: false }, 'faster but more deaths: not better');
  D.record(DAY, { time: 600, deaths: 3, yolo: false });
  assert.equal(D.result(DAY).time, 500, 'slower with the same deaths: not better');
  D.record(DAY, { time: 500, deaths: 3, yolo: true });
  assert.equal(D.result(DAY).yolo, false, 'an exact tie keeps what was saved');
  D.record(DAY, { time: 450, deaths: 3, yolo: true });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 450, deaths: 3, yolo: true }, 'faster with the same deaths wins');
  D.record(DAY, { time: 900, deaths: 2, yolo: false });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 900, deaths: 2, yolo: false }, 'fewer deaths win even when slower');
  D.record(DAY, { time: 1200, deaths: 0, yolo: false });
  assert.equal(D.result(DAY).deaths, 0);
});

test('daily: record and result ignore what is not a usable key or result, and clean the numbers', () => {
  const D = load().Daily;
  for (const key of ['nope', '2026-1-3', '', null, undefined, 20261013, '__proto__']) D.record(key, { time: 1, deaths: 0 });
  for (const bad of [null, undefined, 5, {}, { time: NaN }, { time: Infinity, deaths: 0 }, { time: -1, deaths: 0 }, { time: '12', deaths: 0 }]) D.record(DAY, bad);
  assert.equal(D.result(DAY), null);
  for (const key of ['nope', null, undefined, 5, '__proto__', 'constructor']) assert.equal(D.result(key), null);
  D.record(DAY, { time: 61.5, deaths: 2.9 });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 61.5, deaths: 2, yolo: false }, 'deaths are a whole number, yolo a boolean');
  D.record('2026-10-14', { time: 10, deaths: -4, yolo: 'yes' });
  assert.deepEqual(H.plain(D.result('2026-10-14')), { time: 10, deaths: 0, yolo: true });
  D.record('2026-10-15', { time: 10 });
  assert.equal(D.result('2026-10-15').deaths, 0, 'a missing death count is 0');
  const r = D.result(DAY);
  r.deaths = 99;
  assert.equal(D.result(DAY).deaths, 2, 'result hands out a copy');
});

test('daily: the best is saved under cb.daily and the next page load reads it back', () => {
  const store = memStore();
  const a = load(store);
  a.Daily.record(DAY, { time: 321, deaths: 1, yolo: true });
  const saved = JSON.parse(store.m['cb.daily']);
  assert.deepEqual(Object.keys(saved), [DAY]);
  assert.deepEqual(saved[DAY], { time: 321, deaths: 1, yolo: true });
  const b = load(store);
  assert.deepEqual(H.plain(b.Daily.result(DAY)), { time: 321, deaths: 1, yolo: true });
  b.Daily.record(DAY, { time: 999, deaths: 5, yolo: false });
  assert.equal(JSON.parse(store.m['cb.daily'])[DAY].time, 321, 'a worse clear writes nothing new');
});

test('daily: only the 30 most recent dates are kept', () => {
  const store = memStore();
  const D = load(store).Daily;
  const keys = [];
  for (let i = 0; i < 40; i++) keys.push(D.dateKey(utc(2026, 8, 1 + i)));
  for (const k of keys) D.record(k, { time: 100, deaths: 0, yolo: false });
  assert.deepEqual(Object.keys(JSON.parse(store.m['cb.daily'])).sort(), keys.slice(10));
  for (const k of keys.slice(0, 10)) assert.equal(D.result(k), null, 'dropped: ' + k);
  for (const k of keys.slice(10)) assert.notEqual(D.result(k), null, 'kept: ' + k);
  D.record('2020-01-01', { time: 1, deaths: 0, yolo: false });
  assert.equal(D.result('2020-01-01'), null, 'a date older than all 30 is not kept');
  assert.equal(Object.keys(JSON.parse(store.m['cb.daily'])).length, 30);
});

test('daily: whatever is in storage, only well-formed dated entries count', () => {
  for (const junk of ['not json', '[1,2,3]', '"text"', '7', 'null', '{']) {
    const D = load(memStore({ 'cb.daily': junk })).Daily;
    assert.equal(D.result(DAY), null, junk);
    D.record(DAY, { time: 5, deaths: 0 });
    assert.equal(D.result(DAY).time, 5, junk + ': recording still works');
  }
  const mixed = JSON.stringify({
    '2026-10-12': { time: 5, deaths: 1, yolo: 1 },
    '2026-10-13': { time: 'x', deaths: 0 },
    '2026-10-14': { time: 5 },
    '2026-10-15': 'str',
    '2026-10-16': null,
    '2026-10-17': { time: -3, deaths: 0 },
    bad: { time: 5, deaths: 0 },
    '__proto__': { time: 5, deaths: 0 },
  });
  const D = load(memStore({ 'cb.daily': mixed })).Daily;
  assert.deepEqual(H.plain(D.result('2026-10-12')), { time: 5, deaths: 1, yolo: true });
  for (const k of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', 'bad']) assert.equal(D.result(k), null, k);
});

test('daily: storage that throws still gives the session its results from memory', () => {
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  const D = load(throwing).Daily;
  assert.equal(D.result(DAY), null);
  D.record(DAY, { time: 77, deaths: 2, yolo: false });
  assert.deepEqual(H.plain(D.result(DAY)), { time: 77, deaths: 2, yolo: false });
  D.record(DAY, { time: 60, deaths: 2, yolo: false });
  assert.equal(D.result(DAY).time, 60);
});

test('daily: reading window.localStorage itself can throw (blocked site data)', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('SecurityError'); } });
  assert.equal(CB.Daily.result(DAY), null);
  CB.Daily.record(DAY, { time: 12, deaths: 0, yolo: false });
  assert.equal(CB.Daily.result(DAY).time, 12);
});

// ---- two tabs ----------------------------------------------------------------------------------------------------------------------
// Each load() is a page with its own cache over the one localStorage, so two loads of the same store are two tabs.

test('daily: a second tab never overwrites a better saved result with a worse one', () => {
  const store = memStore();
  const a = load(store).Daily;
  const b = load(store).Daily;
  assert.equal(a.result(DAY), null, 'tab A has looked, and found nothing');
  b.record(DAY, { time: 300, deaths: 0, yolo: false });
  a.record(DAY, { time: 200, deaths: 2, yolo: false });
  assert.deepEqual(JSON.parse(store.m['cb.daily'])[DAY], { time: 300, deaths: 0, yolo: false }, 'the saved better clear stands');
  assert.deepEqual(H.plain(a.result(DAY)), { time: 300, deaths: 0, yolo: false }, 'and tab A now shows it');
  // A better clear still wins, in either tab, and the tie rule is record()'s.
  a.record(DAY, { time: 250, deaths: 0, yolo: true });
  assert.deepEqual(JSON.parse(store.m['cb.daily'])[DAY], { time: 250, deaths: 0, yolo: true });
  b.record(DAY, { time: 250, deaths: 0, yolo: false });
  assert.equal(JSON.parse(store.m['cb.daily'])[DAY].yolo, true, 'a tie keeps what is saved');
});

test('daily: a tab sees another tab\'s clear without recording anything itself (the title tick)', () => {
  const store = memStore();
  const a = load(store).Daily;
  const b = load(store).Daily;
  assert.equal(a.result(DAY), null);
  b.record(DAY, { time: 123, deaths: 1, yolo: false });
  assert.deepEqual(H.plain(a.result(DAY)), { time: 123, deaths: 1, yolo: false });
  // And one written straight into storage (anything else on the page) is seen too, then bettered by a later write.
  store.m['cb.daily'] = JSON.stringify({ [DAY]: { time: 100, deaths: 0, yolo: false }, '2026-10-14': { time: 50, deaths: 0, yolo: true } });
  assert.deepEqual(H.plain(a.result(DAY)), { time: 100, deaths: 0, yolo: false }, 'a better entry replaces the cached one');
  assert.deepEqual(H.plain(a.result('2026-10-14')), { time: 50, deaths: 0, yolo: true }, 'and a new date arrives');
});

test('daily: a worse entry written by another tab does not replace the better one this tab has', () => {
  const store = memStore();
  const a = load(store).Daily;
  a.record(DAY, { time: 100, deaths: 0, yolo: false });
  store.m['cb.daily'] = JSON.stringify({ [DAY]: { time: 900, deaths: 5, yolo: false } });
  assert.deepEqual(H.plain(a.result(DAY)), { time: 100, deaths: 0, yolo: false });
  a.record('2026-10-14', { time: 70, deaths: 1, yolo: false });
  const saved = JSON.parse(store.m['cb.daily']);
  assert.deepEqual(saved[DAY], { time: 100, deaths: 0, yolo: false }, 'the next save puts the better one back');
  assert.deepEqual(saved['2026-10-14'], { time: 70, deaths: 1, yolo: false });
});

test('daily: record keeps the other tab\'s other dates when it writes', () => {
  const store = memStore();
  const a = load(store).Daily;
  const b = load(store).Daily;
  a.record('2026-10-12', { time: 10, deaths: 0, yolo: false });
  b.record('2026-10-13', { time: 20, deaths: 0, yolo: false });
  a.record('2026-10-14', { time: 30, deaths: 0, yolo: false });
  assert.deepEqual(Object.keys(JSON.parse(store.m['cb.daily'])).sort(), ['2026-10-12', '2026-10-13', '2026-10-14']);
  assert.equal(b.result('2026-10-14').time, 30);
});

test('daily: memory-only results survive storage that was wiped, went unreadable or turned to junk', () => {
  const store = memStore();
  let blocked = false;
  const flaky = { getItem: (k) => { if (blocked) throw new Error('blocked'); return store.getItem(k); }, setItem: (k, v) => { if (blocked) throw new Error('blocked'); store.setItem(k, v); } };
  const a = load(flaky).Daily;
  a.record(DAY, { time: 80, deaths: 1, yolo: false });
  delete store.m['cb.daily']; // another tab (or the player) cleared the site data
  assert.deepEqual(H.plain(a.result(DAY)), { time: 80, deaths: 1, yolo: false }, 'wiped: still served');
  store.m['cb.daily'] = 'not json';
  assert.deepEqual(H.plain(a.result(DAY)), { time: 80, deaths: 1, yolo: false }, 'junk: still served');
  blocked = true;
  assert.deepEqual(H.plain(a.result(DAY)), { time: 80, deaths: 1, yolo: false }, 'unreadable: still served');
  a.record('2026-10-14', { time: 60, deaths: 0, yolo: false });
  assert.ok(a.result(DAY) && a.result('2026-10-14'), 'and recording on top of it keeps both');
  blocked = false;
  a.record('2026-10-15', { time: 50, deaths: 0, yolo: false });
  assert.deepEqual(Object.keys(JSON.parse(store.m['cb.daily'])).sort(), [DAY, '2026-10-14', '2026-10-15'], 'storage is back: the next save writes everything held');
});

// ---- the run ---------------------------------------------------------------------------------------------------------------------------

function runSetup() {
  const CB = H.loadWith('src/core/daily.js', 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.dummyBoss = {
    id: 'dummyBoss', name: 'DUMMY', tagline: 'noop()', commitMsg: 'fix: dummy',
    create() {
      const c = { id: 'dummyBoss', x: 160, y: 60, hp: 10, maxHp: 10, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} };
      return c;
    },
  };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: `~/s${i}/`, palette: 'src', boss: 'dummyBoss', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]] }));
  return CB;
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const killAll = (run) => {
  for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e);
};
function until(run, pred, max, each) {
  for (let i = 0; i < max; i++) {
    if (pred(run)) return true;
    if (each) each(run, i);
    run.step(idle());
  }
  return pred(run);
}
// Different play for the same seed: aimless movement and shooting, and a lot of use of the world's own rng.
const busyInput = (i) => H.makeInput({ moveX: i % 2 ? 1 : -1, moveY: 1, fire: true, aimX: (i * 37) % 320, aimY: (i * 11) % 180 });
function drainRng(run, i) {
  for (let k = 0; k < 1 + (i % 7); k++) run.world.rng.next();
}
// One stage played to its patch pick, then to the end of the pick's input lock. `noise(run, i)` runs each tick before the fight's step
// and `input(i)` is what the player does; the offer is returned.
function toPick(run, noise, input) {
  for (let i = 0; i < 4000 && run.state !== 'boss'; i++) {
    killAll(run);
    if (noise) noise(run, i);
    run.step(input ? input(i) : idle());
  }
  assert.equal(run.state, 'boss', 'reached the boss');
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'patchPick', 600), 'reached the patch pick');
  assert.ok(until(run, (r) => r.stateT >= 0.6, 100));
  return run.offer.slice();
}

test('daily: createRun sets run.daily to the key, else null', () => {
  const CB = runSetup();
  assert.equal(CB.createRun({ seed: 1, daily: DAY }).daily, DAY);
  assert.equal(CB.createRun({ seed: 1 }).daily, null);
  assert.equal(CB.createRun().daily, null);
  for (const bad of [undefined, null, '', 0, 1, true, {}, []]) assert.equal(CB.createRun({ seed: 1, daily: bad }).daily, null, String(bad));
});

test('daily: a daily run is a normal run of four stages; --yolo may ride along, Boss Rush too', () => {
  const CB = runSetup();
  const plain = CB.createRun({ seed: 5, daily: DAY });
  assert.equal(plain.bossRush, false);
  assert.equal(plain.yolo, false);
  assert.equal(plain.skipWaves, false);
  assert.equal(plain.stageIndex, 0);
  const yolo = CB.createRun({ seed: 5, daily: DAY, yolo: true });
  assert.equal(yolo.daily, DAY);
  assert.equal(yolo.yolo, true);
  assert.equal(yolo.world.player.stats.maxHearts, 3, 'yolo rules apply to a daily run');
  const rush = CB.createRun({ seed: 5, daily: DAY, bossRush: true });
  assert.equal(rush.daily, DAY);
  assert.equal(rush.skipWaves, true);
});

test('daily: the same seed gives the same fight setup, so everyone plays the same day', () => {
  const CB = runSetup();
  const key = CB.Daily.dateKey(utc(2026, 9, 13));
  const mk = () => CB.createRun({ daily: key, seed: CB.Daily.seedFor(key), patches: { [CB.Daily.patchFor(key)]: 1 } });
  const a = mk();
  const b = mk();
  assert.equal(a.seed, b.seed);
  assert.equal(a.seed, CB.Daily.seedFor(key));
  assert.deepEqual(H.plain(a.patches), H.plain(b.patches));
  assert.equal(a.world.rng.next(), b.world.rng.next());
});

test('daily: the offers come from their own stream, the same whatever the fight did', () => {
  const CB = runSetup();
  const seed = CB.Daily.seedFor(DAY);
  const mk = () => CB.createRun({ daily: DAY, seed, patches: { [CB.Daily.patchFor(DAY)]: 1 } });

  const calm = mk();
  const busy = mk();
  const hurt = (r, i) => {
    drainRng(r, i);
    if (i === 90 && r.state === 'wave') CB.Player.hurt(r.world.player, r.world, null); // some damage on the way
  };
  const first = toPick(calm);
  const second = toPick(busy, hurt, busyInput);
  assert.ok(busy.time > 0 && busy.world.player.hearts <= busy.world.player.stats.maxHearts);
  assert.deepEqual(first, second, 'offers after stage 1');
  assert.equal(first.length, 3);
  assert.equal(new Set(first).size, 3);

  // The same pick leads to the same next stage, and its offers match too (they depend on the stage, not on the play).
  calm.choosePatch(0);
  busy.choosePatch(0);
  assert.equal(calm.stageIndex, 1);
  assert.equal(busy.stageIndex, 1);
  const next1 = toPick(calm);
  const next2 = toPick(busy, drainRng, busyInput);
  assert.deepEqual(next1, next2, 'offers after stage 2');
  assert.notDeepEqual(next1, first, 'a later stage draws its own offers');
});

test('daily: the fight really does change what a normal run is offered (so the daily stream is doing the work)', () => {
  const CB = runSetup();
  const offers = new Set();
  for (const noise of [null, drainRng]) {
    const run = CB.createRun({ seed: 3 });
    offers.add(toPick(run, noise).join());
  }
  assert.equal(offers.size, 2, 'a normal run follows the world rng');
  const dailies = new Set();
  for (const noise of [null, drainRng]) dailies.add(toPick(CB.createRun({ seed: 3, daily: DAY }), noise).join());
  assert.equal(dailies.size, 1, 'a daily run does not');
});

test('daily: a retry changes nothing about the offers; the run stays a daily', () => {
  const CB = runSetup();
  const seed = CB.Daily.seedFor(DAY);
  const offered = toPick(CB.createRun({ daily: DAY, seed }));

  const run = CB.createRun({ daily: DAY, seed });
  until(run, (r) => r.state === 'wave', 200);
  run.world.player.hearts = 1;
  CB.Player.hurt(run.world.player, run.world, null);
  assert.ok(until(run, (r) => r.state === 'dead', 400));
  assert.equal(run.deaths, 1);
  until(run, (r) => r.stateT >= 0.6, 100);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.attempt, 1);
  assert.equal(run.daily, DAY, 'the retry keeps the daily');
  assert.equal(run.seed, seed);
  assert.deepEqual(toPick(run), offered, 'the offers did not notice the death');
  assert.equal(run.daily, DAY);
});

test('daily: a different day draws different offers', () => {
  const CB = runSetup();
  const firsts = new Set();
  for (let i = 0; i < 8; i++) {
    const key = CB.Daily.dateKey(utc(2026, 9, 13 + i));
    firsts.add(toPick(CB.createRun({ daily: key, seed: CB.Daily.seedFor(key) })).join());
  }
  assert.ok(firsts.size > 1, 'eight days, more than one distinct first offer');
});

test('daily: Boss Rush and --yolo daily runs draw the same stream', () => {
  const CB = runSetup();
  const seed = CB.Daily.seedFor(DAY);
  const base = toPick(CB.createRun({ daily: DAY, seed }));
  assert.deepEqual(toPick(CB.createRun({ daily: DAY, seed, yolo: true }), drainRng, busyInput), base, 'yolo');
  assert.deepEqual(toPick(CB.createRun({ daily: DAY, seed, bossRush: true })), base, 'boss rush');
});

test('daily: a run that is not a daily still draws its offers from the world rng, exactly as before', () => {
  const CB = runSetup();
  const orig = CB.Patches.offer;
  const seen = [];
  CB.Patches.offer = function (rng, counts, n) {
    seen.push(rng);
    return orig.call(this, rng, counts, n);
  };
  const normal = CB.createRun({ seed: 9 });
  toPick(normal);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], normal.world.rng, 'the world rng');
  const daily = CB.createRun({ seed: 9, daily: DAY });
  toPick(daily);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[1], daily.world.rng, 'its own rng');
  // The same seed on a normal run is the same fight as before: unchanged offers for the same play.
  const again = CB.createRun({ seed: 9 });
  assert.deepEqual(toPick(again), normal.offer, 'deterministic');
});

// ---- the title -------------------------------------------------------------------------------------------------------------------------

// The whole game loaded on the stub canvas, with the daily date fixed to DAY.
function titleEnv(dev, o) {
  const opt = o || {};
  const store = memStore(opt.store);
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true, localStorage: store });
  const env = { CB, sandbox, store, C: CB.Pal.C, visits: [], sounds: [], texts: [], frames: [], aim: { x: 0, y: 0 }, fullscreen: 0, day: DAY };
  CB.Daily.today = () => env.day;
  env.r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  env.r.resize();
  env.rec = H.recorder(env.r, CB);
  const text = env.r.text;
  env.r.text = function (str, x, y, opts) {
    env.texts.push([String(str), opts || {}, y]);
    return text.apply(this, arguments);
  };
  const drawFrame = env.r.frame;
  env.r.frame = function (x, y, w, h, color) {
    env.frames.push({ x, y, w, h, color });
    return drawFrame.apply(this, arguments);
  };
  CB.Audio = { play: (n) => env.sounds.push(n), isMuted: () => false, toggleMute() {} };
  CB.Music = { stop() {}, isEnabled: () => true, toggle() {} };
  CB.Comfort = { calm: () => false, toggle: () => false, blink: () => true };
  CB.Screens.hud = { cursor() {} };
  env.game = {
    go: (n, d) => env.visits.push([n, H.plain(d)]),
    input: { peekAim: () => env.aim, device: dev, requestFullscreenOnRelease: () => { env.fullscreen++; } },
    debug: {},
  };
  env.title = CB.Scenes.title;
  CB.Prompts.setDevice(dev);
  if (opt.modes) CB.Unlocks.unlock('modes');
  if (opt.hats) for (const id of opt.hats) CB.Unlocks.unlock(id);
  env.title.enter(env.game, {});
  if (!opt.locked) tick(env, 20);
  return env;
}
function tick(env, n, input) {
  for (let i = 0; i < n; i++) env.title.update(env.CB.DT, input || H.makeInput());
}
function frame(env, t) {
  env.rec.clear();
  env.texts.length = 0;
  env.frames.length = 0;
  env.title.draw(env.r, t == null ? 0.3 : t);
  return env.rec;
}
const padInput = (edge, over) => H.makeInput(Object.assign({ pad: Object.assign({}, PAD0, { [edge]: true }), confirm: edge === 'a', dash: edge === 'a' || edge === 'lb', compact: edge === 'rb' || edge === 'b', pause: edge === 'start', quit: edge === 'back' }, over || {}));
const tapInput = (x, y, over) => H.makeInput(Object.assign({ confirm: true, tap: true, aimX: x, aimY: y }, over || {}));
const boxOf = (rec, s) => rec.texts().find((b) => b.str === s);
const inBox = (b, hit) => b.x >= hit.x && b.x + b.w <= hit.x + hit.w && b.y >= hit.y && b.y + b.h <= hit.y + hit.h;
const touches = (b, hit) => b.x < hit.x + hit.w && hit.x < b.x + b.w && b.y < hit.y + hit.h && hit.y < b.y + b.h;
const centreX = (b) => b.x + b.w / 2;
const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

const LABEL = { kbm: 'daily build', touch: 'daily build', pad: 'B daily build' };
const LABEL_DONE = { kbm: 'daily build ✓', touch: 'daily build ✓', pad: 'B daily build ✓' };
const RUSH = { kbm: 'boss rush', touch: 'boss rush', pad: 'Y boss rush' };
const YOLO = { kbm: ['--yolo: off', '--yolo: ON'], touch: ['--yolo: off', '--yolo: ON'], pad: ['X --yolo: off', 'X --yolo: ON'] };

function expectedDailyOpts(env, yolo) {
  const D = env.CB.Daily;
  return { daily: env.day, seed: D.seedFor(env.day), patches: { [D.patchFor(env.day)]: 1 }, yolo: !!yolo };
}

for (const dev of DEVICES) {
  test('title (' + dev + '): the daily build button is there without the modes unlock, centred on its row', () => {
    const env = titleEnv(dev);
    const rec = frame(env);
    const label = boxOf(rec, LABEL[dev]);
    assert.ok(label, 'label ' + LABEL[dev]);
    assert.ok(Math.abs(centreX(label) - 160) <= 1, 'centred');
    assert.equal(label.y, 127, 'the modes row: the text of the 11 px buttons that start at 125');
    assert.deepEqual(H.plain(env.title.BUTTONS.find((b) => b.id === 'daily')), { id: 'daily', x: 123, y: 125, w: 74, h: 11 }, 'the middle column of the chips\' grid');
    const B = env.title.BUTTONS.find((b) => b.id === 'daily');
    assert.ok(B && inBox(label, B), 'the label sits inside its hit box');
    assert.ok(env.frames.some((f) => f.x === B.x && f.y === B.y && f.w === B.w && f.h === B.h), 'and the drawn frame is exactly the hit box');
    assert.ok(Math.abs(centreX(B) - 160) <= 1, 'the hit box is centred too');
    // Changed with the locked teasers: rush and yolo are on the row, locked (their labels, no ON/off), flanking the daily build; they used to be absent.
    const rush = boxOf(rec, RUSH[dev]);
    const yolo = boxOf(rec, dev === 'pad' ? 'X --yolo' : '--yolo');
    assert.ok(rush && yolo, 'rush and yolo are still locked, but shown');
    assert.ok(!rec.texts().some((b) => /--yolo: (ON|off)/.test(b.str)), 'a locked --yolo has no state');
    assert.ok(rush.x + rush.w < label.x && label.x + label.w < yolo.x, 'rush | daily | yolo');
    assert.equal(rush.y, label.y);
    assert.equal(yolo.y, label.y);
    assert.deepEqual(rec.outside().map((b) => b.str || b.name), []);
    assert.deepEqual(rec.overlaps().map((p) => p[0].str + ' / ' + p[1].str), []);
  });

  test('title (' + dev + '): with the modes unlocked the row holds rush, daily and yolo, apart and inside their hit boxes', () => {
    for (const done of [false, true]) {
      for (const yolo of [false, true]) {
        for (const hats of [[], ['loopcap']]) {
          const env = titleEnv(dev, { modes: true, hats });
          if (done) env.CB.Daily.record(DAY, { time: 100, deaths: 0, yolo: false });
          env.title.yolo = yolo;
          const rec = frame(env);
          const tag = dev + ' done=' + done + ' yolo=' + yolo + ' hats=' + hats.length;
          const rush = boxOf(rec, RUSH[dev]);
          const daily = boxOf(rec, (done ? LABEL_DONE : LABEL)[dev]);
          const yoloBox = boxOf(rec, YOLO[dev][yolo ? 1 : 0]);
          assert.ok(rush && daily && yoloBox, tag + ': all three labels');
          const [BR, BY, BD] = ['rush', 'yolo', 'daily'].map((id) => env.title.BUTTONS.find((b) => b.id === id));
          assert.ok(inBox(rush, BR) && inBox(daily, BD) && inBox(yoloBox, BY), tag + ': labels inside their boxes');
          assert.ok(rush.x + rush.w + 8 <= daily.x && daily.x + daily.w + 8 <= yoloBox.x, tag + ': labels at least 8 px apart, rush | daily | yolo');
          assert.ok(BR.x + BR.w <= BD.x && BD.x + BD.w <= BY.x, tag + ': hit boxes disjoint in the same order');
          assert.equal(rush.y, 127);
          assert.equal(daily.y, 127);
          assert.equal(yoloBox.y, 127);
          assert.deepEqual(rec.outside().map((b) => b.str || b.name), [], tag + ': on screen');
          assert.deepEqual(rec.overlaps().map((p) => p[0].str + ' / ' + p[1].str), [], tag + ': no overlapping text');
          // No hit box swallows any text but its own label: the start prompt, the hat row and the legend stay clear.
          for (const [b, own] of [[BR, rush], [BD, daily], [BY, yoloBox]]) {
            for (const t of rec.texts()) if (t !== own) assert.ok(!touches(t, b), tag + ': ' + b.id + ' box over ' + t.str);
          }
          for (const b of [BR, BD, BY]) assert.ok(b.x >= 0 && b.x + b.w <= 320 && b.y + b.h <= 180, tag + ': ' + b.id + ' box on screen');
        }
      }
    }
  });
}

test('title: hit boxes are fixed numbers, frozen, and the daily one is the only one between rush and yolo', () => {
  const env = titleEnv('kbm');
  const B = env.title.BUTTONS;
  assert.deepEqual(B.map((b) => b.id), ['rush', 'yolo', 'daily']);
  assert.ok(Object.isFrozen(B));
  for (const b of B) {
    assert.ok(Object.isFrozen(b));
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isFinite(b[k]), b.id + '.' + k);
  }
});

for (const dev of DEVICES) {
  test('title (' + dev + '): the label shows a tick once today\'s daily is cleared, and loses it on a new day', () => {
    const env = titleEnv(dev, { modes: true });
    assert.ok(boxOf(frame(env), LABEL[dev]));
    assert.ok(!boxOf(frame(env), LABEL_DONE[dev]));
    env.CB.Daily.record('2026-10-12', { time: 100, deaths: 0, yolo: false });
    assert.ok(boxOf(frame(env), LABEL[dev]), 'yesterday\'s clear does not tick today');
    env.CB.Daily.record(DAY, { time: 250, deaths: 2, yolo: false });
    const rec = frame(env);
    assert.ok(boxOf(rec, LABEL_DONE[dev]), 'ticked after a record');
    assert.ok(!boxOf(rec, LABEL[dev]));
    env.day = '2026-10-14'; // midnight UTC passes while the title is open
    assert.ok(boxOf(frame(env), LABEL[dev]), 'a new day starts unticked');
    assert.ok(!boxOf(frame(env), LABEL_DONE[dev]));
  });
}

test('title: the tick survives a page load (the clear is in storage)', () => {
  const first = titleEnv('kbm');
  first.CB.Daily.record(DAY, { time: 250, deaths: 2, yolo: true });
  const second = titleEnv('kbm', { store: first.store.m });
  assert.ok(boxOf(frame(second), LABEL_DONE.kbm));
});

test('title: the daily label and the other labels follow the mouse hover (kbm only)', () => {
  const colour = (env, s) => env.texts.find((t) => t[0] === s)[1].color;
  const kb = titleEnv('kbm', { modes: true });
  const B = (id) => kb.title.BUTTONS.find((b) => b.id === id);
  kb.aim = { x: B('daily').x + 3, y: B('daily').y + 3 };
  frame(kb);
  assert.equal(colour(kb, LABEL.kbm), kb.C.white, 'hovered');
  assert.equal(colour(kb, RUSH.kbm), kb.C.pale);
  kb.aim = { x: 5, y: 5 };
  frame(kb);
  assert.equal(colour(kb, LABEL.kbm), kb.C.pale, 'not hovered');
  kb.aim = { x: B('daily').x + B('daily').w - 1, y: B('daily').y + B('daily').h - 1 };
  frame(kb);
  assert.equal(colour(kb, LABEL.kbm), kb.C.white, 'the far corner is inside');
  kb.aim = { x: B('daily').x + B('daily').w, y: B('daily').y };
  frame(kb);
  assert.equal(colour(kb, LABEL.kbm), kb.C.pale, 'one past the edge is outside');
  for (const dev of ['touch', 'pad']) {
    const env = titleEnv(dev);
    env.aim = mid(env.title.BUTTONS.find((b) => b.id === 'daily'));
    frame(env);
    assert.equal(colour(env, LABEL[dev]), env.C.pale, dev + ': a finger or a pad has no hover');
  }
});

// ---- starting the daily ----------------------------------------------------------------------------------------------------------------

test('title (pad): B starts today\'s daily build, with and without the modes unlock', () => {
  for (const modes of [false, true]) {
    const env = titleEnv('pad', { modes });
    tick(env, 1, padInput('b'));
    assert.deepEqual(env.visits, [['play', { runOpts: expectedDailyOpts(env, false) }]], 'modes=' + modes);
    assert.deepEqual(env.sounds, ['uiSelect']);
  }
});

test('title (pad): B carries --yolo along once X switched it on', () => {
  const env = titleEnv('pad', { modes: true });
  tick(env, 1, padInput('x'));
  assert.equal(env.title.yolo, true);
  tick(env, 1, padInput('b'));
  assert.deepEqual(env.visits, [['play', { runOpts: expectedDailyOpts(env, true) }]]);
});

test('title (pad): B waits out the 0.3 s input lock; A, Y and X still do what they did', () => {
  const locked = titleEnv('pad', { modes: true, locked: true });
  tick(locked, 5, padInput('b'));
  assert.equal(locked.visits.length, 0);
  assert.deepEqual(locked.sounds, []);
  tick(locked, 20);
  tick(locked, 1, padInput('b'));
  assert.equal(locked.visits.length, 1);

  const env = titleEnv('pad', { modes: true });
  tick(env, 1, padInput('a'));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }], 'A: a normal run');
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('y'));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { bossRush: true, yolo: false } }], 'Y: boss rush');
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('x'));
  assert.equal(env.title.yolo, true);
  assert.equal(env.visits.length, 0, 'X only toggles');
});

test('title (pad): A with B on the same tick is a normal start, and a pad B never cycles hats', () => {
  const env = titleEnv('pad', { modes: true, hats: ['loopcap', 'halo'] });
  const both = padInput('a');
  both.pad.b = true;
  tick(env, 1, both);
  assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]]);
  const hat = env.CB.Unlocks.hat();
  const again = titleEnv('pad', { modes: true, hats: ['loopcap', 'halo'] });
  const before = again.CB.Unlocks.hat();
  tick(again, 1, padInput('b'));
  assert.equal(again.CB.Unlocks.hat(), before, 'B is compact on the pad, not a hat button');
  assert.equal(again.visits.length, 1);
  assert.equal(hat, env.CB.Unlocks.hat());
});

test('title: a tap or click on the daily button starts it on kbm and touch; touch also asks for fullscreen', () => {
  for (const dev of ['kbm', 'touch']) {
    for (const modes of [false, true]) {
      const env = titleEnv(dev, { modes });
      const b = env.title.BUTTONS.find((x) => x.id === 'daily');
      const p = mid(b);
      tick(env, 1, tapInput(p.x, p.y));
      assert.deepEqual(env.visits, [['play', { runOpts: expectedDailyOpts(env, false) }]], dev + ' modes=' + modes);
      assert.equal(env.fullscreen, dev === 'touch' ? 1 : 0);
    }
  }
  for (const dev of ['kbm', 'touch']) {
    const env = titleEnv(dev);
    const b = env.title.BUTTONS.find((x) => x.id === 'daily');
    for (const [x, y] of [[b.x, b.y], [b.x + b.w - 1, b.y + b.h - 1]]) {
      env.visits.length = 0;
      env.title.enter(env.game, {});
      tick(env, 20);
      tick(env, 1, tapInput(x, y));
      assert.equal(env.visits.length, 1);
      assert.ok(env.visits[0][1].runOpts.daily, 'the corner is inside the button');
    }
    // On touch a miss within 6 px lands on the nearest control (M3): the daily button's neighbours are all that near, so only a mouse starts from 1 px away.
    const outside = dev === 'touch' ? [[b.x + 3, b.y + b.h + 12]] : [[b.x - 1, b.y + 3], [b.x + b.w, b.y + 3], [b.x + 3, b.y - 1], [b.x + 3, b.y + b.h]];
    for (const [x, y] of outside) {
      env.visits.length = 0;
      env.title.enter(env.game, {});
      tick(env, 20);
      tick(env, 1, tapInput(x, y));
      assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]], 'just outside the box starts a normal run');
    }
  }
});

test('title: a tap on the daily button takes --yolo along; the rush and yolo buttons still work beside it', () => {
  const env = titleEnv('kbm', { modes: true });
  const B = (id) => env.title.BUTTONS.find((b) => b.id === id);
  tick(env, 1, tapInput(mid(B('yolo')).x, mid(B('yolo')).y));
  assert.equal(env.title.yolo, true);
  tick(env, 1, tapInput(mid(B('daily')).x, mid(B('daily')).y));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: expectedDailyOpts(env, true) }]);
  env.title.enter(env.game, {});
  assert.equal(env.title.yolo, false, 'a fresh title starts with --yolo off');
  tick(env, 20);
  tick(env, 1, tapInput(mid(B('rush')).x, mid(B('rush')).y));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { bossRush: true, yolo: false } }]);
});

test('title: Enter reads the pointer spot as ever: on the daily button it starts the daily, elsewhere a normal run', () => {
  const env = titleEnv('kbm');
  const p = mid(env.title.BUTTONS.find((b) => b.id === 'daily'));
  tick(env, 1, H.makeInput({ confirm: true, aimX: p.x, aimY: p.y }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: expectedDailyOpts(env, false) }]);
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, H.makeInput({ confirm: true, aimX: 160, aimY: 40 }));
  assert.deepEqual(env.visits.pop(), ['play', { runOpts: { yolo: false } }]);
});

test('title: starting a daily changes nothing about the next normal start', () => {
  const env = titleEnv('pad', { modes: true });
  tick(env, 1, padInput('b'));
  assert.ok(env.visits.pop()[1].runOpts.daily);
  env.title.enter(env.game, {});
  tick(env, 20);
  tick(env, 1, padInput('a'));
  const opts = env.visits.pop()[1].runOpts;
  assert.deepEqual(opts, { yolo: false });
  for (const k of ['daily', 'seed', 'patches']) assert.ok(!(k in opts), 'no ' + k);
});

test('title: the options the daily start hands over make the right run', () => {
  const env = titleEnv('pad');
  tick(env, 1, padInput('b'));
  const opts = env.visits[0][1].runOpts;
  const CB = env.CB;
  const run = CB.createRun(opts);
  assert.equal(run.daily, DAY);
  assert.equal(run.seed, CB.Daily.seedFor(DAY));
  assert.deepEqual(H.plain(run.patches), { [CB.Daily.patchFor(DAY)]: 1 });
  assert.equal(run.yolo, false);
  assert.equal(run.bossRush, false);
  // The play scene adds a clock seed only when none is given; a daily brings its own.
  assert.ok(Object.prototype.hasOwnProperty.call(opts, 'seed'));
});

test('title: a click or tap inside the lock window does not start the daily', () => {
  const env = titleEnv('touch', { locked: true });
  const p = mid(env.title.BUTTONS.find((b) => b.id === 'daily'));
  tick(env, 5, tapInput(p.x, p.y));
  assert.equal(env.visits.length, 0);
  assert.deepEqual(env.sounds, []);
});

test('title: without CB.Daily, or with only part of it, the title is what it was', () => {
  for (const stub of [undefined, {}, { today: () => DAY }, { today: () => DAY, seedFor: () => 5 }]) {
    const env = titleEnv('pad', { modes: true });
    env.CB.Daily = stub;
    const rec = frame(env);
    assert.ok(!rec.texts().some((b) => /daily/.test(b.str)), 'no daily label');
    assert.ok(boxOf(rec, RUSH.pad) && boxOf(rec, YOLO.pad[0]), 'rush and yolo still drawn');
    tick(env, 1, padInput('b'));
    assert.equal(env.visits.length, 0, 'B does nothing');
    const p = mid(env.title.BUTTONS.find((b) => b.id === 'daily'));
    tick(env, 1, tapInput(p.x, p.y));
    assert.deepEqual(env.visits, [['play', { runOpts: { yolo: false } }]], 'a tap where the button would be starts a normal run');
  }
});

test('title: a Daily without a patch to offer still starts a daily (no starting patch)', () => {
  const env = titleEnv('pad');
  env.CB.Daily.patchFor = () => null;
  tick(env, 1, padInput('b'));
  const opts = env.visits[0][1].runOpts;
  assert.equal(opts.daily, DAY);
  assert.deepEqual(opts.patches, {});
});

test('title: a Daily with no result method still draws and starts', () => {
  const env = titleEnv('kbm');
  env.CB.Daily.result = undefined;
  assert.ok(boxOf(frame(env), LABEL.kbm));
  const p = mid(env.title.BUTTONS.find((b) => b.id === 'daily'));
  tick(env, 1, tapInput(p.x, p.y));
  assert.equal(env.visits.length, 1);
});
