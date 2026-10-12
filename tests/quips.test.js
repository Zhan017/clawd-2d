'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/font.js', 'src/game/quips.js'];
const BOSSES = ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug'];
const KINDS = ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne'];

function allLines(Q) {
  const out = [];
  for (const pair of Q.stage) out.push(...pair);
  for (const k of ['waveBreak', 'hurt', 'dead', 'victory']) out.push(...Q[k]);
  for (const k of Object.keys(Q.kill)) out.push(...Q.kill[k]);
  for (const b of Object.keys(Q.bossPhase)) for (const ph of Object.keys(Q.bossPhase[b])) out.push(...Q.bossPhase[b][ph]);
  return out;
}

test('quips: every character has a glyph and no line implies affiliation', () => {
  const CB = H.load(FILES);
  for (const line of allLines(CB.Quips)) {
    for (const ch of line) assert.ok(CB.Font.GLYPHS[ch], `missing glyph ${JSON.stringify(ch)} in "${line}"`);
    assert.doesNotMatch(line, /anthropic|official|claude\.ai/i);
    assert.doesNotMatch(line, /esc to interrupt/i);
  }
});

test('quips: pool sizes and widths', () => {
  const CB = H.load(FILES);
  const Q = CB.Quips;
  assert.equal(Q.stage.length, 4);
  for (const pair of Q.stage) {
    assert.equal(pair.length, 2);
    for (const l of pair) assert.ok(CB.Font.measure(l) <= 290, l);
  }
  for (const k of ['waveBreak', 'hurt', 'dead', 'victory']) assert.ok(Q[k].length >= 3, k);
  for (const k of KINDS) {
    assert.ok(Q.kill[k].length >= 3, k);
    for (const l of Q.kill[k]) assert.ok(CB.Font.measure(l) <= 150, l);
  }
});

test('quips: stage prompts type a user line, then a Thinking line; both are short', () => {
  const CB = H.load(FILES);
  for (const [i, pair] of CB.Quips.stage.entries()) {
    assert.match(pair[0], /^> \S/, `stage ${i + 1} line 1`);
    assert.ok(pair[1].startsWith('✻ Thinking...'), `stage ${i + 1} line 2 starts with the Thinking marker: ${pair[1]}`);
    for (const l of pair) assert.ok(Array.from(l).length <= 60, `stage ${i + 1} line over 60 characters: ${l}`);
  }
  const second = CB.Quips.stage.map((p) => p[1]);
  assert.equal(second[0], '✻ Thinking...');
  assert.equal(second[1], '✻ Thinking... (compacting conversation)');
  assert.equal(second[2], '✻ Thinking... (reading MERGE_HEAD)');
  assert.equal(second[3], '✻ Thinking... ⚠ this is prod');
});

test('quips: the lowHp pool is gone', () => {
  const CB = H.load(FILES);
  assert.equal(CB.Quips.lowHp, undefined);
});

test('quips: pop lines (kill, hurt, boss phase, wave break) fit 150 px; screen lines fit 290 px', () => {
  const CB = H.load(FILES);
  const Q = CB.Quips;
  const m = (l) => CB.Font.measure(l);
  for (const l of Q.hurt) assert.ok(m(l) <= 150, `hurt: ${l}`);
  for (const l of Q.waveBreak) assert.ok(m(l) <= 150, `waveBreak: ${l}`);
  for (const b of BOSSES) {
    for (const ph of Object.keys(Q.bossPhase[b])) for (const l of Q.bossPhase[b][ph]) assert.ok(m(l) <= 150, `${b} ${ph}: ${l}`);
  }
  for (const l of Q.dead) assert.ok(m(l) <= 290, `dead: ${l}`);
  for (const l of Q.victory) assert.ok(m(l) <= 290, `victory: ${l}`);
});

test('quips: the pools have the shape their readers index into', () => {
  const CB = H.load(FILES);
  const Q = CB.Quips;
  assert.deepEqual(Object.keys(Q.kill).sort(), KINDS.slice().sort());
  assert.deepEqual(Object.keys(Q.bossPhase).sort(), BOSSES.slice().sort());
  assert.deepEqual(Object.keys(Q.bossPhase.infiniteLoop), ['2']);
  assert.deepEqual(Object.keys(Q.bossPhase.memoryLeakBoss), ['2']);
  assert.deepEqual(Object.keys(Q.bossPhase.mergeConflict), ['2']);
  assert.deepEqual(Object.keys(Q.bossPhase.heisenbug), ['2', '3']);
  for (const b of BOSSES) {
    for (const ph of Object.keys(Q.bossPhase[b])) {
      assert.ok(Array.isArray(Q.bossPhase[b][ph]) && Q.bossPhase[b][ph].length >= 3, `${b} phase ${ph}`);
    }
  }
  // Task 20 reads waveBreak[stageIndex % n]: one line per stage keeps every stage on its own line.
  assert.equal(Q.waveBreak.length, 4);
  // gameOver reads dead[(deaths * 3 + stageIndex) % n]: a multiple of 3 would freeze the deaths term at 0.
  assert.notEqual(Q.dead.length % 3, 0);
  // Every line is a non-empty single-line string.
  for (const line of allLines(Q)) {
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0 && !/[\n\t]/.test(line), JSON.stringify(line));
  }
  // The lines the spec names are present, first in their pools.
  assert.equal(Q.bossPhase.infiniteLoop[2][0], '// TODO: add exit condition');
  assert.equal(Q.bossPhase.memoryLeakBoss[2][0], 'malloc(99%)');
  assert.equal(Q.bossPhase.mergeConflict[2][0], 'git add -p ???');
  assert.equal(Q.bossPhase.heisenbug[2][0], 'cannot reproduce');
  assert.equal(Q.bossPhase.heisenbug[3][0], 'works on my machine');
  assert.deepEqual(Q.kill.syntaxError.slice(0, 3), ['Fix(;)', 'missing ;', 'lint: ok']);
  assert.deepEqual(Q.kill.nullPointer.slice(0, 3), ['Fix(null)', '?.', 'undefined']);
  assert.deepEqual(Q.kill.raceCondition.slice(0, 3), ['await', 'mutex', 'lock()']);
  assert.deepEqual(Q.kill.memoryLeak.slice(0, 3), ['free()', 'gc()', 'drop(x)']);
  assert.deepEqual(Q.kill.offByOne.slice(0, 3), ['i<n', 'n-1', '<=']);
  assert.deepEqual(Q.hurt.slice(0, 5), ['ouch', 'NaN', 'undefined', '403', 'rate limited']);
  assert.deepEqual(Q.dead.slice(0, 4), ['Clawd ran out of context', 'exit code 139', 'unexpected EOF', 'max turns reached']);
});

test('quips: pick never repeats the previous index and is deterministic', () => {
  const CB = H.load(FILES);
  const a = CB.createRng(5);
  const b = CB.createRng(5);
  let last = -1;
  for (let i = 0; i < 50; i++) {
    const x = CB.Quips.pick(a, CB.Quips.hurt, last);
    const y = CB.Quips.pick(b, CB.Quips.hurt, last);
    assert.equal(x.idx, y.idx);
    assert.notEqual(x.idx, last);
    last = x.idx;
  }
});

test('quips: pick returns {text, idx} that agree, reaches every slot and consumes one rng draw', () => {
  const CB = H.load(FILES);
  const list = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  const rng = CB.createRng(11);
  const probe = CB.createRng(11);
  let last = -1;
  for (let i = 0; i < 200; i++) {
    const r = CB.Quips.pick(rng, list, last);
    probe.next();
    assert.equal(r.text, list[r.idx]);
    assert.ok(Number.isInteger(r.idx) && r.idx >= 0 && r.idx < list.length);
    seen.add(r.idx);
    last = r.idx;
  }
  assert.equal(seen.size, list.length, 'every slot is reachable');
  assert.equal(rng.next(), probe.next(), 'exactly one draw per pick, so replays stay in step');
  // lastIdx defaults to -1: any slot may come up on the first pick.
  const first = new Set();
  for (let s = 1; s <= 60; s++) first.add(CB.Quips.pick(CB.createRng(s), list).idx);
  assert.equal(first.size, list.length);
});

test('quips: pick copes with one-line, empty, missing and out-of-range input', () => {
  const CB = H.load(FILES);
  const rng = CB.createRng(3);
  assert.deepEqual(H.plain(CB.Quips.pick(rng, ['only'], 0)), { text: 'only', idx: 0 }, 'a single line repeats rather than failing');
  assert.deepEqual(H.plain(CB.Quips.pick(rng, ['only'])), { text: 'only', idx: 0 });
  for (const bad of [[], undefined, null, 'text', 5, {}]) {
    const r = CB.Quips.pick(rng, bad, -1);
    assert.equal(r.text, '');
    assert.equal(r.idx, -1);
  }
  for (const last of [99, -5, NaN, 1.5, undefined, null, '2']) {
    for (let i = 0; i < 20; i++) {
      const r = CB.Quips.pick(rng, ['a', 'b', 'c'], last);
      assert.ok(r.idx >= 0 && r.idx < 3, `lastIdx ${last}`);
      assert.equal(r.text, ['a', 'b', 'c'][r.idx]);
    }
  }
  // A caller whose rng is missing or partial still gets a line, by cycling and never repeating.
  const list = ['a', 'b', 'c'];
  for (const noRng of [null, undefined, {}]) {
    let last = -1;
    for (let i = 0; i < 9; i++) {
      const r = CB.Quips.pick(noRng, list, last);
      assert.notEqual(r.idx, last);
      assert.equal(r.text, list[r.idx]);
      last = r.idx;
    }
  }
});

test('quips: pick works with an rng stub that only has next()', () => {
  const CB = H.load(FILES);
  let n = 0;
  const stub = { next: () => [0, 0.5, 0.99, 0.2][n++ % 4] };
  const list = ['a', 'b', 'c', 'd'];
  const out = [];
  let last = -1;
  for (let i = 0; i < 4; i++) {
    const r = CB.Quips.pick(stub, list, last);
    out.push(r.idx);
    last = r.idx;
  }
  assert.deepEqual(out, [0, 2, 3, 0]);
  // A draw outside [0, 1) (or not a number) still lands on a real slot that is not lastIdx.
  for (const u of [1, 5, -1, NaN, Infinity, undefined]) {
    for (const last of [-1, 0, 3]) {
      const r = CB.Quips.pick({ next: () => u }, list, last);
      assert.ok(r.idx >= 0 && r.idx < list.length, `draw ${u}`);
      assert.notEqual(r.idx, last);
      assert.equal(r.text, list[r.idx]);
    }
  }
});

test('quips: loads without the font and touches no renderer at load time', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/game/quips.js']);
  assert.equal(CB.Font, undefined);
  assert.ok(CB.Quips && Array.isArray(CB.Quips.hurt) && typeof CB.Quips.pick === 'function');
});
