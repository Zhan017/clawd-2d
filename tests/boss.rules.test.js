'use strict';
// Rev 3 boss rules, checked on every boss through the whole game's scripts (see "Tasks 15-18: Bosses", rules 3-7 and the Phase C changes):
//   - every boss part is boss && !regular and starts with noContactT >= 0.45;
//   - a phase change emits bossPhase (finite x, y), shakes the screen (>= 4) and shields the main part(s) for 0.5 s;
//   - the first attack comes no earlier than one period after spawn;
//   - a part that moves publishes a non-zero velocity;
//   - every event emitted during 10+ s of fighting carries a finite x, y.
// The part, velocity and event checks run in every scenario (phase 1, each later phase, and for the Merge Conflict the one-twin-down window with its revive),
// so parts that only exist later (Heisenbug decoys, the revived twin, Memory Leak blobs) are covered too.
// Shake is asserted through a spy on w.addShake and by calling the controller directly: world.step decays w.shake at the end of the tick.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { makeBot } = require('./bot');

const DT = 1 / 60;
const FIGHT_S = 10; // the fight scenarios run at least this long (world seconds, so a hit-stop does not eat the budget)
const ATTACK_EVENTS = new Set(['enemyShoot', 'lob', 'beamCharge', 'beam']);
// Gauntlet bugs that bosses summon or shed: ordinary enemies, not boss parts. Any other kind that shows up mid-fight must be a boss part.
const ORDINARY = new Set(['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']);

// Per boss: the main targetable part(s), the one-attack period, and how to put the HP at a fraction of max (strictly below it).
// `phases` maps a phase number to the HP fraction it begins under (spec 2.6; phases latch, so 3 implies 2).
// `late` lists the boss-part kinds that only appear mid-fight (all scenarios together must show exactly these).
const BOSSES = [
  { id: 'infiniteLoop', period: 3.0, main: (b) => [b.head], phases: { 2: 0.5 }, expect: ['enemyShoot', 'bossPhase'], late: [] },
  { id: 'memoryLeakBoss', period: 2.5, main: (b) => [b.body], phases: { 2: 0.5 }, expect: ['lob', 'splat', 'bossPhase', 'enemyShoot'], late: ['leakBlob'] },
  { id: 'mergeConflict', period: 2.8, main: (b) => [b.head, b.incoming], phases: { 2: 0.5 }, expect: ['enemyShoot', 'beamCharge', 'beam', 'bossPhase'], late: ['conflictTwin'] },
  { id: 'heisenbug', period: 2.5, main: (b) => [b.body], phases: { 2: 0.6, 3: 0.25 }, expect: ['enemyShoot', 'teleport', 'bossPhase'], late: ['heisenDecoy'] },
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function start(id, seed) {
  const CB = H.load();
  const stage = CB.STAGES.find((s) => s.boss === id);
  const w = CB.createWorld({ seed: seed || 5, god: true, stage });
  w.boss = CB.Bosses[id].create(w);
  w.player.invuln = Math.max(w.player.invuln, 1.0); // what stageRunner.startBoss does besides creating the boss
  CB.Compact.fill(w);
  w.events.length = 0;
  return { CB, w, boss: w.boss };
}

// Puts the boss's main part(s) strictly under `frac` of max HP (a combined bar is split evenly across the twins).
function setHpUnder(def, boss, frac) {
  const parts = def.main(boss);
  const total = frac * boss.maxHp - 1;
  for (const p of parts) p.hp = total / parts.length;
}

const idle = () => H.makeInput({ aimX: 10, aimY: 170 });

// Steps the world like run.step does (events drained every tick) for `seconds` of world time. The bot plays unless `input` is given.
function fight(w, seconds, onTick, input) {
  const bot = makeBot();
  const fake = { state: 'boss', stateT: 1, world: w };
  const t0 = w.time;
  let guard = 0;
  while (w.time - t0 < seconds && guard++ < seconds * 60 * 5) {
    w.step(DT, input ? input() : bot(fake));
    if (onTick) onTick(w);
    w.events.length = 0;
  }
  assert.ok(w.time - t0 >= seconds, 'the fight never reached its time budget (stuck in hit-stop?)');
}

// The fights every per-tick rule is checked in: phase 1, each later phase entered with a fresh world, and for the Merge Conflict the
// "one twin down" window (FINISH text, then the revive). Each runs in its own world, `onStart(w, boss, sc)` first, then `onTick(w, boss, sc)` after every step.
function scenarios(def) {
  const list = [{ name: 'phase 1', setup() {}, seconds: FIGHT_S + 2 }];
  for (const n of Object.keys(def.phases).map(Number)) list.push({ name: `phase ${n}`, setup: (w, boss) => setHpUnder(def, boss, def.phases[n]), seconds: FIGHT_S + 4 });
  if (def.id === 'mergeConflict') list.push({ name: 'one twin down', setup: (w, boss) => w.killEnemy(boss.head), seconds: FIGHT_S + 2 });
  return list;
}

function runScenarios(def, onStart, onTick) {
  for (const sc of scenarios(def)) {
    const { w, boss } = start(def.id, 11);
    sc.setup(w, boss);
    try {
      if (onStart) onStart(w, boss, sc);
      fight(w, sc.seconds, (world) => onTick(world, boss, sc));
    } catch (err) {
      err.message = `${def.id} ${sc.name}: ${err.message}`;
      throw err;
    }
  }
}

for (const def of BOSSES) {
  test(`${def.id}: every part is boss && !regular with noContactT >= 0.45, also the ones added mid-fight (all phases)`, () => {
    const { w, boss } = start(def.id);
    assert.equal(boss.id, def.id);
    const parts = w.enemies.filter((e) => e.boss);
    assert.ok(parts.length >= 1);
    for (const e of w.enemies) {
      assert.ok(e.boss, `${e.kind} is part of the boss but not flagged boss`);
      assert.ok(!e.regular, `${e.kind} is flagged regular`);
      assert.ok(e.noContactT >= 0.45, `${e.kind} noContactT ${e.noContactT}`);
    }
    // Anything that appears later and is not an ordinary gauntlet bug (blobs, decoys, a revived twin) is a boss part too: it is checked on the tick it first shows.
    const lateKinds = new Set();
    let known;
    runScenarios(
      def,
      (world) => {
        known = new Set(world.enemies);
      },
      (world) => {
        for (const e of world.enemies) {
          if (known.has(e)) continue;
          known.add(e);
          if (ORDINARY.has(e.kind)) continue; // summoned or shed gauntlet bugs
          lateKinds.add(e.kind);
          assert.ok(e.boss, `${e.kind} (added mid-fight) is not flagged boss`);
          assert.ok(!e.regular, `${e.kind} (added mid-fight) is flagged regular`);
          assert.ok(e.noContactT >= 0.45, `${e.kind} (added mid-fight) noContactT ${e.noContactT}`);
        }
      }
    );
    assert.deepEqual([...lateKinds].sort(), [...def.late].sort(), 'the boss parts that appear mid-fight changed: update `late` and make sure the new kind obeys the part rules');
  });

  const phaseNumbers = Object.keys(def.phases).map(Number);
  for (const n of phaseNumbers) {
    test(`${def.id}: phase ${n} emits bossPhase with finite x, y, shakes >= 4 and shields the main part for 0.5 s`, () => {
      const { w, boss } = start(def.id);
      const shakes = [];
      const addShake = w.addShake;
      w.addShake = (a) => {
        shakes.push(a);
        addShake(a);
      };
      for (let k = 2; k < n; k++) {
        // Earlier phases first, each one past its own shield.
        setHpUnder(def, boss, def.phases[k]);
        boss.update(w, DT);
        for (let i = 0; i < 40; i++) w.step(DT, idle());
      }
      w.events.length = 0;
      shakes.length = 0;
      w.shake = 0;
      setHpUnder(def, boss, def.phases[n]);
      boss.update(w, DT); // the controller alone: world.step would decay w.shake before the assertions run
      const phases = w.events.filter((e) => e.type === 'bossPhase');
      assert.equal(phases.length, 1, `bossPhase events ${phases.length}`);
      assert.equal(phases[0].phase, n);
      assert.ok(finite(phases[0].x) && finite(phases[0].y), `bossPhase x/y ${phases[0].x}, ${phases[0].y}`);
      assert.equal(boss.phase, n);
      assert.ok(shakes.some((a) => a >= 4), `addShake calls ${JSON.stringify(shakes)}`);
      assert.ok(w.shake >= 4, `w.shake ${w.shake}`);
      const main = def.main(boss);
      for (const m of main) assert.equal(w.damageEnemy(m, 1), 0, `${m.kind} took damage on the phase-change tick`);
      for (let i = 0; i < 25; i++) w.step(DT, idle()); // 0.42 s later it is still shielded
      for (const m of main) assert.equal(w.damageEnemy(m, 1), 0, `${m.kind} took damage 0.42 s after the phase change`);
      for (let i = 0; i < 15; i++) w.step(DT, idle()); // 0.67 s: the shield is over, so the same hit lands
      assert.ok(main.some((m) => w.damageEnemy(m, 1) > 0), 'the shield never ended');
    });
  }

  test(`${def.id}: the first attack comes no earlier than one period (${def.period} s) after spawn`, () => {
    const { w } = start(def.id);
    let firstBullet = Infinity;
    let firstEvent = Infinity;
    const fire = w.fireEnemyBullet;
    w.fireEnemyBullet = (...a) => {
      if (w.time < firstBullet) firstBullet = w.time;
      return fire(...a);
    };
    fight(
      w,
      def.period + 3,
      () => {
        for (const e of w.events) if (ATTACK_EVENTS.has(e.type) && w.time < firstEvent) firstEvent = w.time;
      },
      idle
    );
    const first = Math.min(firstBullet, firstEvent);
    assert.ok(first < Infinity, 'no attack within one period + 3 s');
    assert.ok(first >= def.period - 1e-6, `first attack at ${first.toFixed(3)} s, period ${def.period} s`);
  });

  test(`${def.id}: a part that moves publishes |v| > 0 (checked every tick, in every phase)`, () => {
    let last;
    let moves = 0;
    runScenarios(
      def,
      () => {
        last = new Map();
      },
      (w) => {
        for (const e of w.enemies) {
          if (!e.boss) continue;
          const was = last.get(e);
          last.set(e, { x: e.x, y: e.y });
          if (!was) continue;
          const d = Math.hypot(e.x - was.x, e.y - was.y);
          if (d < 1e-9) continue;
          moves++;
          assert.ok(Math.hypot(e.vx || 0, e.vy || 0) > 0, `${e.kind} moved ${d.toFixed(4)} px at t=${w.time.toFixed(2)} with v = (${e.vx}, ${e.vy})`);
        }
      }
    );
    assert.ok(moves > 0, 'no boss part ever moved');
  });

  test(`${def.id}: every event over ${FIGHT_S}+ s of fighting in each phase has finite x, y`, () => {
    const seen = new Set();
    runScenarios(def, null, (w) => {
      for (const e of w.events) {
        seen.add(e.type);
        assert.ok(finite(e.x) && finite(e.y), `${e.type} event has x=${e.x}, y=${e.y} at t=${w.time.toFixed(2)}`);
        if (e.type === 'beamCharge' || e.type === 'beam') for (const k of ['x1', 'y1', 'x2', 'y2']) assert.ok(finite(e[k]), `${e.type}.${k} = ${e[k]}`);
        if (e.type === 'teleport') assert.ok(finite(e.x2) && finite(e.y2), `teleport target ${e.x2}, ${e.y2}`);
      }
    });
    for (const type of def.expect) assert.ok(seen.has(type), `no ${type} event ever emitted (saw ${[...seen].join(', ')})`);
  });
}
