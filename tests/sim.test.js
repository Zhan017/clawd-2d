'use strict';
// Full headless playthroughs driven by tests/bot.js: every stage under several seeds and kits, a whole run, Boss Rush, YOLO,
// and the difficulty report (rev 3 balance gate).
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { makeBot } = require('./bot');

const LIMIT_S = 240;
const DONE = new Set(['bossDead', 'patchPick', 'victory']);
const report = [];
// Rev 3 balance gate, would-be hits per stage with the base kit: the zero-latency bot takes at most GATE_FAST (no floor),
// the delayed bot (9 ticks = 0.15 s of reaction time) takes between GATE_SLOW[0] and GATE_SLOW[1].
const GATE_FAST = 10;
const GATE_SLOW = [3, 20];

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function healthCheck(CB, run, where) {
  const w = run.world;
  const p = w.player;
  if (!finite(p.x) || !finite(p.y)) throw new Error(`${where}: player position not finite`);
  for (const e of w.enemies) if (!finite(e.x) || !finite(e.y) || !finite(e.hp) || !finite(e.r)) throw new Error(`${where}: ${e.kind} has non-finite x/y/hp/r`);
  for (const b of w.eBullets) if (!finite(b.x) || !finite(b.y)) throw new Error(`${where}: enemy bullet not finite`);
  for (const b of w.pBullets) if (!finite(b.x) || !finite(b.y)) throw new Error(`${where}: bolt not finite`);
  for (const f of w.fx) if (!finite(f.x) || !finite(f.y)) throw new Error(`${where}: fx ${f.kind} not finite`);
  for (const h of w.hazards) if (!finite(h.x) || !finite(h.y)) throw new Error(`${where}: hazard not finite`);
  for (const k of w.pickups || []) if (!finite(k.x) || !finite(k.y)) throw new Error(`${where}: pickup not finite`);
  if (w.enemies.length > CB.CAPS.enemies) throw new Error(`${where}: enemy cap exceeded`);
  if (w.eBullets.length > CB.CAPS.eBullets) throw new Error(`${where}: bullet cap exceeded`);
  if (w.pBullets.length > CB.CAPS.pBullets) throw new Error(`${where}: bolt cap exceeded`);
  if (w.fx.length > CB.CAPS.fx) throw new Error(`${where}: fx cap exceeded`);
  if (w.boss && (!finite(w.boss.hp) || !finite(w.boss.x) || !finite(w.boss.y))) throw new Error(`${where}: boss state not finite`);
  if (w.context && !(w.context.value >= 0 && w.context.value <= w.context.max)) throw new Error(`${where}: context out of range`);
}

function makeRenderer(CB, sandbox) {
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return r;
}

const OV = { stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn', bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory' };
function drawFrame(CB, r, run, t) {
  CB.WorldDraw.draw(r, run.world, t, { hitboxes: false });
  CB.Screens.hud.draw(r, run, t);
  if (OV[run.state]) CB.Screens[OV[run.state]].draw(r, run, t, { hover: -1, quitArmT: 0 });
}

// Plays one stage. Stops when the boss is beaten (after checking the post-defeat world stays clear).
function playStage(seed, stageIndex, runOpts, botOpts) {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = makeRenderer(CB, sandbox);
  const run = CB.createRun(Object.assign({ seed, startStage: stageIndex, god: true }, runOpts || {}));
  const bot = makeBot(botOpts);
  const maxTicks = (LIMIT_S + 10) * 60;
  let ticks = 0;
  while (ticks < maxTicks && !DONE.has(run.state)) {
    run.step(bot(run));
    ticks++;
    healthCheck(CB, run, `seed ${seed} stage ${stageIndex + 1} tick ${ticks}`);
    if (ticks % 90 === 0) drawFrame(CB, r, run, ticks / 60);
  }
  const seconds = ticks / 60;
  const wouldHits = run.world.stats.wouldHits;
  if (run.state === 'bossDead') {
    for (let i = 0; i < 150 && run.state === 'bossDead'; i++) {
      run.step(bot(run));
      healthCheck(CB, run, `seed ${seed} stage ${stageIndex + 1} bossDead +${i}`);
      if (i % 30 === 0) drawFrame(CB, r, run, (ticks + i) / 60);
    }
    const w = run.world;
    if (run.state === 'bossDead') {
      const liveEnemies = w.enemies.filter((e) => !e.dead).length;
      if (liveEnemies || w.eBullets.length || w.hazards.length) throw new Error(`post-defeat world not clear: enemies ${liveEnemies}, bullets ${w.eBullets.length}, hazards ${w.hazards.length}`);
    }
  }
  drawFrame(CB, r, run, seconds);
  return { CB, run, seconds, wouldHits };
}

// Base-kit zero-latency runs are shared between the per-run tests and the balance gate (deterministic, so a cache is exact).
const baseCache = new Map();
function baseRun(seed, s) {
  const key = `${seed}:${s}`;
  if (!baseCache.has(key)) {
    const res = playStage(seed, s, { patches: {} });
    baseCache.set(key, { seconds: res.seconds, wouldHits: res.wouldHits, state: res.run.state });
  }
  return baseCache.get(key);
}

for (const seed of [1, 2, 3]) {
  for (let s = 0; s < 4; s++) {
    for (const [kit, patches] of [['base', {}], ['patched', { spread: 1, rapid: 1, pierce: 1 }]]) {
      test(`sim: seed ${seed} stage ${s + 1} ${kit}, boss beaten within ${LIMIT_S} s, state healthy`, () => {
        let res;
        if (kit === 'base') res = baseRun(seed, s);
        else {
          const full = playStage(seed, s, { patches });
          res = { seconds: full.seconds, wouldHits: full.wouldHits, state: full.run.state };
        }
        report.push(`stage ${s + 1} seed ${seed} ${kit.padEnd(7)} ${res.seconds.toFixed(1).padStart(6)} s  would-be hits ${res.wouldHits}`);
        assert.ok(DONE.has(res.state), `stuck in ${res.state} after ${res.seconds.toFixed(1)} s`);
        assert.ok(res.seconds <= LIMIT_S, `took ${res.seconds.toFixed(1)} s`);
        if (kit === 'base') assert.ok(res.wouldHits <= 40, `would-be hits ${res.wouldHits} (> 40 means a stage is unfair)`);
      });
    }
  }
}

test('sim: random patch sets (all 7 patches) on stages 3 and 4 stay healthy', () => {
  const ids = ['spread', 'rapid', 'pierce', 'heavy', 'heart', 'dash', 'ricochet'];
  const max = { spread: 2, rapid: 2, pierce: 2, heavy: 2, heart: 2, dash: 1, ricochet: 1 };
  for (const seed of [4, 5, 6, 7]) {
    const patches = {};
    ids.forEach((id, i) => {
      const n = (seed * 7 + i * 3) % (max[id] + 1);
      if (n) patches[id] = n;
    });
    for (const s of [2, 3]) {
      const res = playStage(seed, s, { patches });
      assert.ok(DONE.has(res.run.state), `seed ${seed} stage ${s + 1} with ${JSON.stringify(patches)} stuck in ${res.run.state}`);
    }
  }
});

test('sim: YOLO mode stage 4 (god) is still beatable and healthy', () => {
  const res = playStage(2, 3, { yolo: true });
  assert.ok(DONE.has(res.run.state));
  report.push(`YOLO stage 4: ${res.seconds.toFixed(1)} s, would-be hits ${res.wouldHits}`);
});

function countEvents(counts, events) {
  for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
}

test('sim: a full run from stage 1 reaches victory', () => {
  const { CB } = H.load(undefined, { returnSandbox: true });
  const run = CB.createRun({ seed: 99, god: true });
  const bot = makeBot();
  const counts = {};
  let ticks = 0;
  while (ticks < 60 * 60 * 20 && run.state !== 'victory') {
    countEvents(counts, run.step(bot(run)));
    ticks++;
  }
  assert.equal(run.state, 'victory');
  assert.equal(run.history.length, 3);
  assert.equal(run.bossesFixed, 4);
  countEvents(counts, run.step(bot(run))); // the victory event rides the next step
  assert.equal(counts.bossDie, 4, `bossDie ${counts.bossDie}`);
  assert.equal(counts.blast, 48, `blast ${counts.blast}`);
  assert.ok(counts.bossPhase >= 5, `bossPhase ${counts.bossPhase}`);
  assert.ok(counts.compact >= 4, `compact ${counts.compact} (every boss starts with a full meter)`);
  assert.equal(counts.bossEnter, 4, `bossEnter ${counts.bossEnter}`);
  report.push(`full run seed 99: ${(run.time / 60).toFixed(1)} min, patches ${run.history.join(', ')}, squashed ${JSON.stringify(run.squashed)}`);
  report.push(`full run events: bossDie ${counts.bossDie}, blast ${counts.blast}, bossPhase ${counts.bossPhase}, compact ${counts.compact}, bossEnter ${counts.bossEnter}`);
});

test('sim: Boss Rush full run reaches victory with no wave states', () => {
  const { CB } = H.load(undefined, { returnSandbox: true });
  const run = CB.createRun({ seed: 7, god: true, bossRush: true });
  const bot = makeBot();
  const counts = {};
  const seen = new Set();
  let ticks = 0;
  while (ticks < 60 * 60 * 15 && run.state !== 'victory') {
    countEvents(counts, run.step(bot(run)));
    seen.add(run.state);
    ticks++;
  }
  assert.equal(run.state, 'victory');
  assert.equal(counts.bossDie, 4, `bossDie ${counts.bossDie}`);
  assert.ok(!seen.has('wave') && !seen.has('waveBreak'), `Boss Rush visited ${[...seen].join(', ')}`);
  report.push(`boss rush seed 7: ${(run.time / 60).toFixed(1)} min`);
});

test('sim: balance gate, zero-latency bot takes at most 10 would-be hits per stage with the base kit', () => {
  for (const seed of [1, 2, 3]) {
    for (let s = 0; s < 4; s++) {
      const res = baseRun(seed, s);
      assert.ok(res.wouldHits <= GATE_FAST, `seed ${seed} stage ${s + 1}: would-be hits ${res.wouldHits} > ${GATE_FAST}`);
    }
  }
});

test('sim: delayed-input bot (0.15 s reaction) difficulty report and gate (3-20 would-be hits per stage)', () => {
  for (let s = 0; s < 4; s++) {
    const res = playStage(1, s, {}, { delayTicks: 9 });
    report.push(`delayed bot stage ${s + 1}: ${res.seconds.toFixed(1)} s, would-be hits ${res.wouldHits}${DONE.has(res.run.state) ? '' : ' (NOT CLEARED)'}`);
    assert.ok(DONE.has(res.run.state), `delayed bot stage ${s + 1} stuck in ${res.run.state}`);
    assert.ok(res.wouldHits >= GATE_SLOW[0] && res.wouldHits <= GATE_SLOW[1], `delayed bot stage ${s + 1}: would-be hits ${res.wouldHits} outside ${GATE_SLOW[0]}-${GATE_SLOW[1]}`);
  }
});

test.after(() => {
  console.log('\n--- difficulty report ---\n' + report.join('\n'));
});
