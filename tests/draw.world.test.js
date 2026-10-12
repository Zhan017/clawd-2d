'use strict';
// Task 19: arena floor and walls, the world draw order and the HUD. Smoke renders on the minimal font stub, then geometry,
// order, alpha and layout checks on a recording renderer and the real font.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const HAS_FONT = fs.existsSync(path.join(H.ROOT, 'src/art/font.js'));
const BASE = ['src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/art/render.js', 'src/art/arena.js', 'src/art/worldDraw.js', 'src/scenes/hud.js'];

// opts.font: load the real font (layout tests); otherwise the stub that has only CELL_H, measure and draw.
// opts.extra: more scripts, loaded before the Task 19 ones.
function setup(opts) {
  const o = opts || {};
  const files = [...H.GAME_BASE];
  if (o.font && HAS_FONT) files.push('src/art/font.js');
  files.push(...(o.extra || []), ...BASE);
  const { CB, sandbox } = H.load(files, { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1), draw() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1 }), update() {}, draw(e, r) { r.disc(e.x, e.y, e.r, '#FFFFFF'); } };
  }
  CB.Bosses.stub = { id: 'stub', name: 'STUB', tagline: 't', commitMsg: 'c', create: () => ({ id: 'stub', x: 160, y: 60, hp: 50, maxHp: 100, phase: 2, defeated: false, update() {}, draw() {} }) };
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r, sandbox };
}

test('draw: arena renders for every stage palette', () => {
  const { CB, r } = setup();
  for (const s of CB.STAGES) for (const t of [0, 1.3, 7.9]) CB.Arena.draw(r, s, t);
});

test('draw: world, HUD and both cursors render in wave and boss states', () => {
  const { CB, r } = setup();
  CB.STAGES = CB.STAGES.map((s) => Object.assign({}, s, { boss: 'stub' }));
  const run = CB.createRun({ seed: 3, startStage: 1 });
  const w = run.world;
  w.spawnEnemy('syntaxError', 50, 50);
  w.queueSpawn('nullPointer', 80, 80);
  w.addHazard({ x: 100, y: 100 });
  w.fireEnemyBullet(120, 60, 1);
  w.firePlayerBolt(150, 60, 0);
  CB.Fx.text(w, 100, 100, 'null', '#FFFFFF', 1);
  for (const state of ['stageIntro', 'wave', 'boss', 'bossDead']) {
    run.state = state;
    if (state === 'boss') w.boss = CB.Bosses.stub.create(w);
    CB.WorldDraw.draw(r, w, 1.25, { hitboxes: true });
    CB.Screens.hud.draw(r, run, 1.25);
  }
  w.player.hurtT = 0.5;
  w.player.dashCd = 0.3;
  CB.Screens.hud.draw(r, run, 2);
  CB.Screens.hud.cursor(r, 100, 100, 'cross', 0);
  CB.Screens.hud.cursor(r, 100, 100, 'pointer', 0);
  assert.ok(CB.Art.hasSprite('heart_full') && CB.Art.hasSprite('heart_empty'));
});

// ---- Rev 2 / Rev 3 additions: every boss overlay, the HUD extras, the title's arena -----------------------------------------------

const BOSS_IDS = ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug'];

test('draw: every boss overlay renders in phases 1-3, with and without the glitch scan bar', () => {
  const { CB, r } = setup({ extra: ['src/game/compact.js', 'src/game/comfort.js', 'src/game/pickups.js'] });
  const run = CB.createRun({ seed: 5, startStage: 0 });
  const w = run.world;
  for (const id of BOSS_IDS) {
    for (const phase of [1, 2, 3]) {
      for (const glitchT of [0, 0.2]) {
        w.boss = { id, x: 160, y: 90, hp: 40, maxHp: 100, phase, radius: 50, size: 1.5, defeated: false, update() {}, draw() {} };
        w.glitchT = glitchT;
        run.state = 'boss';
        for (const t of [0, 0.05, 1.75, 3.3]) {
          CB.Arena.draw(r, w.stage, t, w);
          CB.WorldDraw.draw(r, w, t, {});
          CB.Screens.hud.draw(r, run, t);
        }
      }
    }
  }
});

test('draw: low health, a full context meter, the /compact banner, YOLO and an elite all render', () => {
  const { CB, r } = setup({ extra: ['src/game/compact.js', 'src/game/comfort.js', 'src/game/pickups.js'] });
  const run = CB.createRun({ seed: 6, startStage: 2, yolo: true });
  const w = run.world;
  w.player.hearts = 1;
  w.player.beatPulse = 1;
  w.context = { value: 45, max: 45, announced: true };
  w.chain = { n: 25 }; // gone in rev 3: nothing may read it
  w.compactBannerT = 0.5;
  const e = w.spawnEnemy('syntaxError', 90, 90, { elite: true });
  e.elite = true;
  run.state = 'wave';
  for (const t of [0, 0.1, 0.17, 1.4]) {
    CB.WorldDraw.draw(r, w, t, {});
    CB.Screens.hud.draw(r, run, t);
  }
  assert.ok(run.yolo);
});

test('arena: draws without a world (the title), with an unknown palette, and bossTheme is a pure lookup', () => {
  const { CB, r } = setup();
  CB.Arena.draw(r, CB.STAGES[0], 3);
  CB.Arena.draw(r, { id: 'mystery', palette: 'nowhere' }, 3);
  CB.Arena.draw(r, null, 3);
  assert.equal(CB.Arena.bossTheme('nope', 1), null);
  for (const id of BOSS_IDS) {
    for (const phase of [1, 2, 3]) {
      const th = CB.Arena.bossTheme(id, phase);
      assert.equal(th.overlay, id);
      assert.match(th.tint, /^#[0-9A-Fa-f]{6}$/);
    }
  }
});

// ---- helpers for the stricter checks ---------------------------------------------------------------------------------------------

const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);
const EXTRA = ['src/game/compact.js', 'src/game/comfort.js', 'src/game/pickups.js'];
const NAMES = { infiniteLoop: 'THE INFINITE LOOP', memoryLeakBoss: 'MEMORY LEAK', mergeConflict: 'MERGE CONFLICT', heisenbug: 'THE HEISENBUG' };

// Wraps the renderer's drawing calls to log them with the alpha in force (r.alpha multiplies). Text and sprites keep their own
// opts.alpha in args. r.ctx.drawImage is logged too (sprites draw through it, so filter by the number of arguments).
function spy(r) {
  const calls = [];
  let a = 1;
  for (const fn of ['rect', 'frame', 'disc', 'ring', 'line', 'sprite', 'text']) {
    const orig = r[fn];
    r[fn] = function (...args) {
      calls.push({ fn, args, a });
      return orig.apply(this, args);
    };
  }
  const origAlpha = r.alpha;
  r.alpha = function (v, f) {
    const prev = a;
    a = prev * v;
    try {
      return origAlpha.call(this, v, f);
    } finally {
      a = prev;
    }
  };
  r.ctx.drawImage = (...args) => {
    calls.push({ fn: 'drawImage', args, a });
  };
  return { calls, of: (fn) => calls.filter((c) => c.fn === fn), clear: () => { calls.length = 0; } };
}
// The alpha a logged call really drew with.
const alphaOf = (c) => c.a * (c.fn === 'text' || c.fn === 'sprite' ? (c.args[c.fn === 'text' ? 3 : 3] && c.args[3].alpha != null ? c.args[3].alpha : 1) : 1);

// Replaces document.createElement so every canvas made from now on records its fillRect calls.
function probeCanvases(sandbox) {
  const made = [];
  const orig = sandbox.document.createElement;
  sandbox.document.createElement = (tag) => {
    const c = orig(tag);
    if (tag === 'canvas') {
      const fills = [];
      const ctx = new Proxy({ fillStyle: '#000000', fillRect(x, y, w, h) { fills.push({ x, y, w, h, color: ctx.fillStyle }); } }, {
        get: (t, p) => (p in t ? t[p] : () => {}),
        set: (t, p, v) => { t[p] = v; return true; },
      });
      c.getContext = () => ctx;
      made.push({ canvas: c, fills });
    }
    return c;
  };
  return made;
}

function bossWorld(CB, id, over) {
  const run = CB.createRun({ seed: 11, startStage: 0 });
  const w = run.world;
  w.boss = Object.assign({ id, x: 160, y: 80, hp: 60, maxHp: 100, phase: 1, radius: 60, size: 1.5, defeated: false, update() {}, draw() {} }, over || {});
  run.state = 'boss';
  run.stateT = 5;
  return { run, w };
}

// ---- Arena: the static layer ------------------------------------------------------------------------------------------------------

test('arena: the static layer is baked once per stage into a 320x180 canvas, with the spec geometry', () => {
  const { CB, r, sandbox } = setup();
  const made = probeCanvases(sandbox);
  const stage = CB.STAGES[0];
  for (let i = 0; i < 4; i++) CB.Arena.draw(r, stage, i * 0.7);
  assert.equal(made.length, 1, 'one canvas, built on the first draw only');
  assert.equal(made[0].canvas.width, 320);
  assert.equal(made[0].canvas.height, 180);
  const pal = CB.Pal.STAGES.src;
  const fills = made[0].fills;
  const has = (x, y, w, h, color) => fills.some((f) => f.x === x && f.y === y && f.w === w && f.h === h && f.color === color);
  assert.ok(has(0, 0, 320, 17, '#0D0D12'), 'HUD strip y 0-16');
  assert.ok(has(0, 17, 320, 1, pal.wallLo), '1 px wallLo line at y 17');
  assert.ok(has(8, 20, 304, 152, pal.floor), 'floor');
  assert.ok(has(0, 18, 1, 162, pal.wallLo) && has(319, 18, 1, 162, pal.wallLo) && has(0, 179, 320, 1, pal.wallLo), 'outer bevel');
  assert.ok(has(7, 19, 306, 1, pal.wallHi) && has(7, 172, 306, 1, pal.wallHi) && has(7, 19, 1, 154, pal.wallHi) && has(312, 19, 1, 154, pal.wallHi), 'inner bevel');
  const rules = fills.filter((f) => f.color === pal.floorLine);
  assert.equal(rules.length, 25);
  rules.forEach((f, i) => assert.deepEqual([f.x, f.y, f.w, f.h], [8, 25 + 6 * i, 304, 1], 'a rule every 6 px'));

  const layout = CB.Arena.layout(stage);
  const bars = fills.filter((f) => pal.code.includes(f.color));
  assert.equal(bars.length, 2 * layout.lines.reduce((n, l) => n + l.bars.length, 0), 'two rows per token');
  for (const f of bars) assert.ok(f.x >= 12 && f.x + f.w <= 308 && f.y >= 20 && f.y + f.h <= 172, `code bar ${JSON.stringify(f)} touches a wall`);

  const nums = fills.filter((f) => f.color === pal.lineNo && f.x + f.w <= 7);
  assert.ok(nums.every((f) => f.x >= 0 && f.y >= 21 && f.y + f.h <= 170), 'line numbers stay inside the left wall bevel');
  assert.ok(has(5, 21, 1, 1, pal.lineNo), 'line 1: the top pixel of a "1" at x 5');
  assert.ok(has(1, 165, 1, 1, pal.lineNo), 'line 13 starts at y 165 with the "1" of "13"');
  const ys = new Set(nums.map((f) => Math.floor((f.y - 21) / 12)));
  assert.deepEqual([...ys].sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i), 'thirteen numbers, 12 px apart');

  CB.Arena.draw(r, CB.STAGES[1], 0);
  CB.Arena.draw(r, CB.STAGES[1], 5);
  assert.equal(made.length, 2, 'a second stage bakes a second canvas, once');
});

test('arena: 20-30 code lines per stage, deterministic, 1-4 tokens on an 8 px indent, clear of the walls', () => {
  const a = setup().CB;
  const b = setup().CB;
  const seen = new Set();
  for (const s of a.STAGES) {
    const L = a.Arena.layout(s);
    assert.ok(L.lines.length >= 20 && L.lines.length <= 30, `${s.id}: ${L.lines.length} lines`);
    assert.equal(a.Arena.layout(s), L, 'memoised');
    assert.equal(JSON.stringify(H.plain(L)), JSON.stringify(H.plain(b.Arena.layout(b.STAGES.find((q) => q.id === s.id)))), 'same stage id, same lines in a fresh load');
    seen.add(JSON.stringify(H.plain(L)));
    const rows = new Set();
    for (const ln of L.lines) {
      assert.ok(!rows.has(ln.row), 'one code line per row');
      rows.add(ln.row);
      assert.equal(ln.y, 20 + 6 * ln.row + 2);
      assert.ok(ln.bars.length >= 1 && ln.bars.length <= 4);
      assert.equal(ln.bars[0].x % 8, 0, 'indentation is a multiple of 8 px');
      const pal = a.Pal.STAGES[s.palette];
      for (const bar of ln.bars) {
        assert.ok(bar.x >= 12 && bar.x + bar.w <= 308, 'clear of the walls');
        assert.ok(pal.code.includes(bar.color), 'coloured from the stage palette');
      }
    }
  }
  assert.equal(seen.size, 4, 'each stage has its own code');
});

// ---- Arena: per-frame effects -------------------------------------------------------------------------------------------------------

test('arena: the cursor line is a 6 px band at alpha 0.06 that drifts 6 px/s down the floor and wraps', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const band = (t) => {
    s.clear();
    CB.Arena.draw(r, CB.STAGES[0], t);
    return s.of('rect').filter((c) => near(c.a, 0.06));
  };
  assert.deepEqual(band(0).map((c) => c.args.slice(0, 4)), [[8, 20, 304, 6]]);
  assert.deepEqual(band(1).map((c) => c.args.slice(0, 4)), [[8, 26, 304, 6]]);
  assert.deepEqual(band(10).map((c) => c.args.slice(0, 4)), [[8, 80, 304, 6]]);
  const edge = band(24.8)[0].args;
  assert.ok(near(edge[1], 168.8, 1e-6) && near(edge[3], 3.2, 1e-6), `clipped at the floor's bottom: ${edge}`);
  assert.equal(band(152 / 6).length, 1);
  assert.ok(near(band(152 / 6 + 1)[0].args[1], 26, 1e-6), 'wraps back to the top');
});

test('arena: only the pulsing palette (prod) overlays its walls, at alpha 0.10 + 0.08 sin(3t)', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const prod = CB.STAGES.find((q) => q.id === 'prod');
  const accent = CB.Pal.STAGES.prod.accent;
  const overlay = (stage, t) => {
    s.clear();
    CB.Arena.draw(r, stage, t);
    return s.of('rect').filter((c) => c.args[4] === CB.Pal.STAGES[stage.palette].accent);
  };
  assert.equal(overlay(prod, 0).length, 4, 'top, left, right and bottom walls');
  assert.ok(near(overlay(prod, 0)[0].a, 0.1));
  assert.ok(near(overlay(prod, Math.PI / 6)[0].a, 0.18), 'peak');
  assert.ok(near(overlay(prod, Math.PI / 2)[0].a, 0.02), 'trough');
  assert.equal(overlay(prod, 0)[0].args[4], accent);
  for (const id of ['src', 'node_modules', 'git']) assert.equal(overlay(CB.STAGES.find((q) => q.id === id), 1).length, 0, `${id} does not pulse`);
});

test('arena: bossTheme maps the four boss ids to an overlay and a tint, clamps the phase, and nothing else', () => {
  const { CB } = setup();
  assert.deepEqual(H.plain(CB.Arena.bossTheme('heisenbug', 7)), { overlay: 'heisenbug', tint: CB.Pal.C.magenta, phase: 3 });
  assert.equal(CB.Arena.bossTheme('infiniteLoop', 0).phase, 1);
  assert.equal(CB.Arena.bossTheme('infiniteLoop', NaN).phase, 1);
  for (const bad of ['nope', 'toString', '__proto__', '', undefined, null]) assert.equal(CB.Arena.bossTheme(bad, 1), null);
});

test('arena: the three-phase overlays stay at alpha <= 0.2 (left-wall furniture aside) and a defeated boss draws none', () => {
  const { CB, r } = setup();
  const s = spy(r);
  for (const id of BOSS_IDS) {
    for (const phase of [1, 2, 3]) {
      for (const t of [0, 0.05, 1.75, 3.3, 7.9]) {
        const { w } = bossWorld(CB, id, { phase });
        s.clear();
        CB.Arena.draw(r, w.stage, t, w);
        for (const c of s.calls) {
          if (c.fn === 'drawImage') continue;
          const wallFurniture = (c.fn === 'rect' || c.fn === 'frame') && c.args[0] + c.args[2] <= 8;
          if (wallFurniture) continue; // the heap gauge and the cycled line numbers are part of the wall
          assert.ok(alphaOf(c) <= 0.2 + 1e-9, `${id} p${phase} t${t}: ${c.fn} ${JSON.stringify(c.args)} at alpha ${alphaOf(c)}`);
        }
      }
    }
  }
  for (const id of BOSS_IDS) {
    const { w } = bossWorld(CB, id, { phase: 3, defeated: true });
    s.clear();
    CB.Arena.draw(r, w.stage, 1.75, w);
    assert.equal(s.calls.filter((c) => c.fn !== 'drawImage').length, 1, `${id}: only the cursor line is left`);
  }
});

test('arena: the Infinite Loop ring is dashed, centred on (160, 96) at boss.radius, and phase 2 cycles the line numbers 1 2 3', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const accent = CB.Pal.STAGES.src.accent;
  for (const radius of [60, 40]) {
    const { w } = bossWorld(CB, 'infiniteLoop', { radius });
    s.clear();
    CB.Arena.draw(r, w.stage, 0.3, w);
    const pts = s.of('rect').filter((c) => c.args[4] === accent && c.args[2] === 1 && c.args[3] === 1 && near(c.a, 0.18));
    const circ = 2 * Math.PI * radius;
    assert.ok(pts.length > circ * 0.3 && pts.length < circ * 0.7, `${pts.length} dash pixels of a ${Math.round(circ)} px circle`);
    for (const c of pts) assert.ok(Math.abs(Math.hypot(c.args[0] - 160, c.args[1] - 96) - radius) < 0.8);
  }
  const { w } = bossWorld(CB, 'infiniteLoop', { phase: 1 });
  s.clear();
  CB.Arena.draw(r, w.stage, 0.3, w);
  assert.equal(s.of('rect').filter((c) => c.args[4] === CB.Pal.STAGES.src.lineNo).length, 0, 'phase 1 leaves the baked numbers alone');
  w.boss.phase = 2;
  s.clear();
  CB.Arena.draw(r, w.stage, 0.3, w);
  const digits = s.of('rect').filter((c) => c.args[4] === CB.Pal.STAGES.src.lineNo);
  assert.ok(digits.length > 0 && digits.every((c) => c.args[0] >= 4 && c.args[0] + c.args[2] <= 7), 'only single digits (1-3), right-aligned in the wall');
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => CB.Arena.lineNumber(i + 1, w)), [1, 2, 3, 1, 2, 3, 1]);
  assert.equal(CB.Arena.lineNumber(9, w), 3);
  w.boss.phase = 1;
  assert.equal(CB.Arena.lineNumber(9, w), 9);
  w.boss.phase = 2;
  w.boss.defeated = true;
  assert.equal(CB.Arena.lineNumber(9, w), 9);
  assert.equal(CB.Arena.lineNumber(9, null), 9);
});

test('arena: the Memory Leak heap gauge fills bottom-up by size - 1 (green, yellow, red) and tints the floor 0.05 x (size - 1)', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const C = CB.Pal.C;
  const gauge = (size) => {
    const { w } = bossWorld(CB, 'memoryLeakBoss', { size });
    s.clear();
    CB.Arena.draw(r, w.stage, 0.3, w);
    return s;
  };
  const bands = (sp) => sp.of('rect').filter((c) => c.args[0] === 2 && c.args[2] === 4 && [C.green, C.yellow, C.red].includes(c.args[4])).map((c) => c.args.slice(1, 5));
  assert.deepEqual(bands(gauge(1)), [], 'empty at size 1');
  assert.deepEqual(bands(gauge(1.5)), [[96, 4, 50, C.green]]);
  assert.deepEqual(bands(gauge(1.8)), [[96, 4, 50, C.green], [66, 4, 30, C.yellow]], '80 %: the red band is still empty');
  const full = bands(gauge(2));
  assert.deepEqual(full, [[96, 4, 50, C.green], [66, 4, 30, C.yellow], [46, 4, 20, C.red]], 'a full thermometer');
  assert.deepEqual(bands(gauge(3)), full, 'size is clamped at 2');
  const tint = (size) => gauge(size).of('rect').filter((c) => c.args[4] === C.green && c.args[2] === 304).map((c) => c.a);
  assert.deepEqual(tint(1), [], 'no tint at size 1');
  assert.ok(near(tint(1.5)[0], 0.025) && near(tint(2)[0], 0.05));
  const frame = gauge(1.5).of('frame').find((c) => c.args[0] === 1);
  assert.deepEqual(frame.args.slice(0, 4), [1, 45, 6, 102], 'a 4x100 gauge in the left wall, framed');
  // The baked two-digit line numbers (10, 11) start at x 0 and the frame at x 1: the outer edge column is repainted first, before the frame.
  const calls = gauge(1.5).calls;
  const edge = calls.findIndex((c) => c.fn === 'rect' && c.args[0] === 0 && c.args[2] === 1 && c.args[3] === 102);
  assert.ok(edge >= 0, 'the outer wall edge is restored behind the gauge');
  assert.equal(calls[edge].args[1], 45);
  assert.equal(calls[edge].args[4], CB.Pal.STAGES.src.wallLo, 'in the stage wall colour (bossWorld runs stage 0)');
  assert.ok(edge < calls.findIndex((c) => c.fn === 'frame' && c.args[0] === 1), 'drawn before the frame');
});

test('arena: the Merge Conflict split tints the halves blue and green at 0.07, divides at x 160 and labels both sides', () => {
  const { CB, r } = setup({ font: true });
  const s = spy(r);
  const rec = H.recorder(r, CB);
  const C = CB.Pal.C;
  const { w } = bossWorld(CB, 'mergeConflict');
  CB.Arena.draw(r, w.stage, 0.3, w);
  const tints = s.of('rect').filter((c) => near(c.a, 0.07));
  assert.deepEqual(tints.map((c) => c.args), [[8, 20, 152, 152, C.blue], [160, 20, 152, 152, C.green]]);
  const dashes = s.of('rect').filter((c) => c.args[0] === 160 && c.args[2] === 1 && near(c.a, 0.18));
  assert.ok(dashes.length >= 20 && dashes.every((c) => c.args[1] >= 20 && c.args[1] + c.args[3] <= 172), 'a dashed divider across the floor');
  const head = rec.texts().find((b) => b.str === '<<<<<<< HEAD');
  const inc = rec.texts().find((b) => b.str === '>>>>>>> incoming');
  assert.deepEqual([head.x, head.y], [12, 22]);
  assert.deepEqual([inc.x + inc.w, inc.y], [308, 166], 'right-aligned at (308, 166)');
  const colour = (str) => s.of('text').find((c) => c.args[0] === str).args[3];
  assert.equal(colour('<<<<<<< HEAD').color, C.blue);
  assert.equal(colour('>>>>>>> incoming').color, C.green);
  assert.ok(colour('<<<<<<< HEAD').alpha <= 0.2 && colour('>>>>>>> incoming').alpha <= 0.2);
});

test('arena: Heisenbug glitch bands appear from phase 2, 0.12 s every 1.7 s, placed by a hash and not by RNG; ghosts only in phase 3', () => {
  const { CB, r } = setup({ font: true });
  const s = spy(r);
  const rec = H.recorder(r, CB);
  const bands = (phase, t) => {
    const { w } = bossWorld(CB, 'heisenbug', { phase });
    s.clear();
    rec.clear();
    CB.Arena.draw(r, w.stage, t, w);
    return s.of('drawImage').filter((c) => c.args.length === 9).map((c) => c.args.slice(1));
  };
  assert.equal(bands(1, 0.05).length, 0, 'phase 1 has none');
  const b = bands(2, 0.05);
  assert.equal(b.length, 3, 'three strips');
  for (const [sx, sy, sw, sh, dx, dy, dw, dh] of b) {
    assert.ok(sh >= 4 && sh <= 8 && dh === sh && sw === 304 && dw === 304 && sx === 8 && dy === sy);
    assert.ok(sy >= 20 && sy + sh <= 172, 'inside the floor');
    assert.ok(dx - sx === 3 || dx - sx === -3, 'offset by 3 px either way');
  }
  assert.deepEqual(bands(2, 0.05), b, 'a hash of floor(t * 8): same t, same bands');
  assert.equal(bands(2, 0.5).length, 0, 'between bands');
  assert.equal(bands(2, 1.69).length, 0);
  assert.equal(bands(2, 1.75).length, 3, 'the next band opens at 1.7 s');
  assert.equal(bands(2, 1.83).length, 0, 'and shuts after 0.12 s');
  assert.notDeepEqual(bands(2, 1.75), b, 'a different hash, different strips');
  assert.equal(rec.texts().length, 0, 'no ghosts in phase 2');
  bands(3, 0.5);
  const ghosts = rec.texts().map((q) => q.str).sort();
  assert.deepEqual(ghosts, ['404', '404', '?', '?']);
  for (const q of rec.texts()) assert.ok(q.x >= 8 && q.x + q.w <= 312 && q.y >= 20 && q.y + q.h <= 172);
  const at = (t) => { bands(3, t); return JSON.stringify(rec.texts().map((q) => [q.str, q.x, q.y])); };
  assert.equal(at(0.5), at(0.9), 'hashed positions hold for half a second');
  assert.notEqual(at(0.5), at(1.2));
  assert.ok(s.of('text').every((c) => c.args[3].alpha <= 0.2), 'ghost alpha');
});

test('arena: the phase-change scan bar sweeps the floor top to bottom over w.glitchT 0.4 -> 0 at alpha 0.35', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const bar = (glitchT) => {
    const { w } = bossWorld(CB, 'infiniteLoop', { phase: 1 });
    w.glitchT = glitchT;
    s.clear();
    CB.Arena.draw(r, w.stage, 0.3, w);
    return s.of('rect').filter((c) => near(c.a, 0.35) && c.args[2] === 304 && c.args[4] === CB.Pal.C.white).map((c) => c.args.slice(1, 4));
  };
  assert.deepEqual(bar(0), []);
  assert.deepEqual(bar(0.2), [[93, 304, 6]], 'half way: y 14 + 0.5 x 158');
  const late = bar(0.01)[0];
  assert.ok(late[0] > 160 && late[0] + late[2] <= 172 + 1e-9, `clipped at the floor's bottom: ${late}`);
  assert.deepEqual(bar(0.4), [], 'it has not entered the floor yet');
  assert.deepEqual(bar(0.5), []);
  const { w } = bossWorld(CB, 'none', {});
  w.glitchT = 0.2;
  s.clear();
  CB.Arena.draw(r, w.stage, 0.3, w);
  assert.equal(s.of('rect').filter((c) => near(c.a, 0.35) && c.args[4] === CB.Pal.C.white).length, 1, 'any world with glitchT > 0 gets the bar, boss or not');
});

// ---- WorldDraw ------------------------------------------------------------------------------------------------------------------

test('worldDraw: layer order, with bolts before the boss overlay and Fx, enemy bullets last, z-sorted bugs and a P0 tag on elites', () => {
  const { CB, r } = setup({ extra: EXTRA });
  const log = [];
  const mark = (name, mod, fn) => {
    const orig = mod[fn];
    mod[fn] = function (...args) {
      log.push(name + (name === 'bullets' ? ':' + args[3] : ''));
      return orig ? orig.apply(this, args) : undefined;
    };
  };
  mark('arena', CB.Arena, 'draw');
  mark('under', CB.Fx, 'drawUnder');
  mark('pickups', CB.Pickups, 'draw');
  mark('player', CB.Player, 'draw');
  mark('prompt', CB.Compact, 'drawPrompt');
  mark('bullets', CB.Projectiles, 'draw');
  mark('compact', CB.Compact, 'draw');
  mark('fx', CB.Fx, 'draw');
  CB.Enemies.syntaxError.draw = (e) => log.push('bug@' + e.y + (e.elite ? '+P0' : ''));
  const run = CB.createRun({ seed: 2 });
  const w = run.world;
  const lo = w.spawnEnemy('syntaxError', 100, 140);
  const hi = w.spawnEnemy('syntaxError', 100, 40);
  const top = w.spawnEnemy('syntaxError', 100, 30, { elite: true });
  top.z = 1e6;
  hi.elite = true;
  const dead = w.spawnEnemy('syntaxError', 90, 90);
  dead.dead = true;
  const hidden = w.spawnEnemy('syntaxError', 95, 95);
  hidden.visible = false;
  w.boss = { id: 'stub', x: 1, y: 1, hp: 1, maxHp: 1, phase: 1, defeated: false, update() {}, draw() { log.push('boss'); } };
  const texts = [];
  const origText = r.text;
  r.text = function (str, ...rest) {
    texts.push(str);
    return origText.call(this, str, ...rest);
  };
  CB.WorldDraw.draw(r, w, 1.5, {});
  assert.deepEqual(log, ['arena', 'under', 'pickups', 'bug@40+P0', 'bug@140', 'bug@30+P0', 'player', 'prompt', 'bullets:player', 'boss', 'compact', 'fx', 'bullets:enemy']);
  assert.equal(texts.filter((s) => s === 'P0').length, 2, 'both elites wear the tag');
  assert.ok(lo && !lo.elite);
  log.length = 0;
  w.boss.defeated = true;
  CB.WorldDraw.draw(r, w, 1.5, {});
  assert.ok(!log.includes('boss'), 'a defeated boss is never drawn again');
});

test('worldDraw: the /compact keycap shows above Clawd only while the meter is full', () => {
  const { CB, r } = setup({ extra: EXTRA });
  const s = spy(r);
  const run = CB.createRun({ seed: 2 });
  const w = run.world;
  const keycaps = () => {
    s.clear();
    CB.WorldDraw.draw(r, w, 1, {});
    return s.of('sprite').filter((c) => c.args[0] === 'keycap_e');
  };
  assert.equal(keycaps().length, 0);
  w.context.value = w.context.max;
  const k = keycaps();
  assert.equal(k.length, 1);
  assert.ok(k[0].args[1] === w.player.x && k[0].args[2] < w.player.y - 10, 'above the player');
  const order = s.calls.filter((c) => c.fn === 'sprite').map((c) => c.args[0]);
  assert.ok(order.indexOf('keycap_e') > order.findIndex((n) => n.startsWith('clawd')), 'right after Player.draw');
});

test('worldDraw: the spawn telegraph blinks through CB.Comfort.blink at 12 Hz, and works without it', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const run = CB.createRun({ seed: 2 });
  const w = run.world;
  w.queueSpawn('nullPointer', 80, 80);
  const asked = [];
  CB.Comfort = { blink: (t, hz) => { asked.push([t, hz]); return asked.length % 2 === 0; } };
  CB.WorldDraw.draw(r, w, 1.25, {});
  CB.WorldDraw.draw(r, w, 1.25, {});
  assert.deepEqual(asked, [[1.25, 12], [1.25, 12]]);
  const colours = s.of('ring').filter((c) => c.args[2] <= 10).map((c) => c.args[3]);
  assert.deepEqual(colours, [CB.Pal.C.hurt, CB.Pal.C.gold], 'off phase red, on phase gold');
  CB.Comfort = undefined;
  s.clear();
  CB.WorldDraw.draw(r, w, 0, {});
  assert.equal(s.of('ring')[0].args[3], CB.Pal.C.gold, 'floor(0 x 12) is even: on');
  CB.WorldDraw.draw(r, w, 1 / 12, {});
  assert.equal(s.of('ring').pop().args[3], CB.Pal.C.hurt);
});

test('worldDraw: every optional module may be missing, and hitbox rings are drawn on top', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const run = CB.createRun({ seed: 2 });
  const w = run.world;
  w.spawnEnemy('syntaxError', 60, 60);
  w.fireEnemyBullet(120, 60, 1);
  for (const k of ['Compact', 'Pickups', 'Comfort', 'Music', 'Unlocks']) delete CB[k];
  delete CB.Fx.pose;
  delete CB.Fx.drawUnder;
  CB.WorldDraw.draw(r, w, 0.4, { hitboxes: true });
  CB.WorldDraw.draw(r, w, 0.4);
  CB.Enemies.ghostKind = undefined;
  w.enemies.push(CB.makeEnemy('ghostKind', 70, 70, {}));
  CB.WorldDraw.draw(r, w, 0.4, {});
  s.clear();
  CB.WorldDraw.draw(r, w, 0.4, { hitboxes: true });
  const rings = s.of('ring');
  assert.deepEqual(rings.slice(-2).map((c) => c.args[3]), ['#00FFFF', '#FF00FF'], 'the player box, then the bullet boxes, are the very last things drawn');
  assert.equal(s.calls.filter((c) => c.fn !== 'drawImage').pop().fn, 'ring');
});

test('worldDraw: drawing never touches the RNG or the world', () => {
  const build = () => {
    const { CB, r } = setup({ extra: EXTRA });
    const run = CB.createRun({ seed: 21 });
    const w = run.world;
    w.spawnEnemy('syntaxError', 50, 50, { elite: true });
    w.queueSpawn('nullPointer', 80, 80);
    w.addHazard({ x: 100, y: 100 });
    w.fireEnemyBullet(120, 60, 1);
    w.firePlayerBolt(150, 60, 0);
    CB.Fx.text(w, 100, 100, 'null', '#FFFFFF', 1);
    w.boss = { id: 'heisenbug', x: 160, y: 80, hp: 40, maxHp: 100, phase: 3, defeated: false, update() {}, draw() {} };
    w.glitchT = 0.2;
    w.context.value = 45;
    run.state = 'boss';
    run.stateT = 0.3;
    return { CB, r, run, w };
  };
  const a = build();
  const b = build();
  const before = JSON.stringify(a.w);
  for (const t of [0.05, 1.75, 2.2, 9.9]) {
    a.CB.WorldDraw.draw(a.r, a.w, t, { hitboxes: true });
    a.CB.Screens.hud.draw(a.r, a.run, t);
    a.CB.Screens.hud.cursor(a.r, 100, 90, 'cross', t);
  }
  assert.equal(JSON.stringify(a.w), before, 'world state is byte-identical after drawing');
  assert.equal(a.w.rng.next(), b.w.rng.next());
  assert.equal(a.w.fxRng.next(), b.w.fxRng.next());
});

// ---- HUD ------------------------------------------------------------------------------------------------------------------------

function hudSetup(opts) {
  const env = setup(Object.assign({ extra: EXTRA }, opts || {}));
  const { CB } = env;
  for (const [id, name] of Object.entries(NAMES)) CB.Bosses[id] = CB.Bosses[id] || { id, name };
  env.s = spy(env.r);
  env.run = CB.createRun({ seed: 4, startStage: 0 });
  env.w = env.run.world;
  env.hud = (t) => {
    env.s.clear();
    CB.Screens.hud.draw(env.r, env.run, t == null ? 1 : t);
    return env.s;
  };
  return env;
}
const heartsOf = (s) => s.of('sprite').filter((c) => c.args[0].startsWith('heart_')).map((c) => c.args[0] + (c.args[3] && c.args[3].scale ? '*' + c.args[3].scale : '') + (c.args[3] && c.args[3].white ? 'w' : ''));

test('hud: hearts start at (4, 5), 9 px apart, full then empty; the pip follows them', () => {
  const { CB, w, hud } = hudSetup();
  w.player.hearts = 3;
  const s = hud();
  assert.deepEqual(heartsOf(s), ['heart_full', 'heart_full', 'heart_full', 'heart_empty', 'heart_empty']);
  const xs = s.of('sprite').filter((c) => c.args[0].startsWith('heart_')).map((c) => c.args[1] - 3.5);
  assert.deepEqual(xs, [4, 13, 22, 31, 40], '9 px apart');
  assert.ok(s.of('sprite').filter((c) => c.args[0].startsWith('heart_')).every((c) => c.args[2] === 8));
  const pip = s.of('sprite').find((c) => c.args[0] === 'dash_ready');
  assert.deepEqual([pip.args[1] - 2.5, pip.args[2] - 2.5], [4 + 45 + 2, 5], 'right after the last heart slot');
  w.player.stats.maxHearts = 7;
  w.player.hearts = 7;
  assert.equal(heartsOf(hud()).length, 7);
  assert.equal(hud().of('sprite').find((c) => c.args[0] === 'dash_ready').args[1] - 2.5, 69);
  assert.ok(CB.Art.hasSprite('heart_full'));
});

test('hud: the heart just lost blinks while Clawd is hurt (through CB.Comfort.blink at 12 Hz)', () => {
  const { CB, w, hud } = hudSetup();
  w.player.hearts = 3;
  w.player.hurtT = 0.5;
  let on = true;
  const asked = [];
  CB.Comfort = { blink: (t, hz) => { asked.push(hz); return on; } };
  assert.deepEqual(heartsOf(hud()), ['heart_full', 'heart_full', 'heart_full', 'heart_fullw', 'heart_empty']);
  on = false;
  assert.deepEqual(heartsOf(hud()), ['heart_full', 'heart_full', 'heart_full', 'heart_empty', 'heart_empty']);
  assert.ok(asked.includes(12));
  w.player.hurtT = 0;
  on = true;
  assert.deepEqual(heartsOf(hud()), ['heart_full', 'heart_full', 'heart_full', 'heart_empty', 'heart_empty'], 'steady when not hurt');
  w.player.hearts = 5;
  w.player.hurtT = 0.5;
  assert.deepEqual(heartsOf(hud()), Array(5).fill('heart_full'), 'nothing was lost (god mode): no blink');
});

test('hud: at 1 heart the last heart throbs to 2x on the beat and the screen edge gets three red frames at 0.10 + 0.20 x beatPulse', () => {
  const { CB, w, hud } = hudSetup();
  const C = CB.Pal.C;
  w.player.hearts = 1;
  w.player.beatPulse = 1;
  let s = hud();
  const big = s.of('sprite').find((c) => c.args[0] === 'heart_full');
  assert.deepEqual(big.args.slice(1, 3), [7.5, 7]);
  assert.equal(big.args[3].scale, 2);
  assert.deepEqual(heartsOf(s).slice(-1), ['heart_full*2'], 'drawn last, over its neighbour');
  const frames = s.of('frame');
  assert.deepEqual(frames.map((c) => c.args), [[0, 0, 320, 180, C.hurt], [1, 1, 318, 178, C.hurt], [2, 2, 316, 176, C.hurt]]);
  assert.ok(frames.every((c) => near(c.a, 0.3)));
  w.player.beatPulse = 0.4;
  s = hud();
  assert.equal(s.of('sprite').filter((c) => c.args[0] === 'heart_full').length, 1);
  assert.equal(s.of('sprite').find((c) => c.args[0] === 'heart_full').args[3], undefined, 'normal size below the 0.5 threshold');
  assert.ok(near(s.of('frame')[0].a, 0.18));
  w.player.beatPulse = 0;
  assert.ok(near(hud().of('frame')[0].a, 0.1));
  w.player.hearts = 2;
  assert.equal(hud().of('frame').length, 0, 'only at exactly 1 heart');
  w.player.hearts = 1;
  w.player.dead = true;
  assert.equal(hud().of('frame').length, 0, 'not while dead');
});

test('hud: the dash pip is lit when ready, dim while cooling and fills from the bottom by 1 - dashCd / cooldown', () => {
  const { CB, w, hud } = hudSetup();
  const C = CB.Pal.C;
  const fillRows = (s) => s.of('rect').filter((c) => c.args[4] === C.cyan && c.args[3] === 1 && c.args[1] >= 5 && c.args[1] <= 9 && c.args[0] >= 51 && c.args[0] <= 55);
  assert.equal(hud().of('sprite').filter((c) => c.args[0] === 'dash_ready').length, 1);
  w.player.dashCd = 0.8;
  let s = hud();
  assert.equal(s.of('sprite').filter((c) => c.args[0] === 'dash_cool').length, 1);
  assert.equal(s.of('sprite').filter((c) => c.args[0] === 'dash_ready').length, 0);
  assert.equal(fillRows(s).length, 0, 'just started cooling: empty');
  w.player.dashCd = 0.4;
  s = hud();
  assert.deepEqual(fillRows(s).map((c) => c.args[1]), [7, 8, 9], '50 % rounds to 3 of 5 rows, from the bottom');
  w.player.dashCd = 0.08;
  assert.equal(fillRows(hud()).length, 5, '90 % rounds to all five rows');
  w.player.stats.dashCooldown = 0.45;
  w.player.dashCd = 0.45;
  assert.equal(fillRows(hud()).length, 0, 'follows the Quick Dash cooldown');
});

test('hud: the context meter is 48x3 at (4, 13), cyan, and flashes gold at full; the old [E] prompt and chain label are gone', () => {
  const { CB, w, hud } = hudSetup();
  const C = CB.Pal.C;
  const meter = (s) => s.of('rect').filter((c) => c.args[0] === 4 && c.args[1] >= 13 && c.args[1] <= 15 && c.args[3] <= 3);
  w.context = { value: 0, max: 45, announced: false };
  assert.deepEqual(meter(hud()).map((c) => c.args), [[4, 13, 48, 3, C.ink]], 'an empty meter is just the ink well');
  w.context.value = 22.5;
  assert.deepEqual(meter(hud()).map((c) => c.args), [[4, 13, 48, 3, C.ink], [4, 13, 24, 2, C.cyan], [4, 15, 24, 1, C.cyanDark]]);
  w.context.value = 45;
  w.chain = { n: 25 };
  const flashing = [];
  CB.Comfort = { blink: (t, hz) => { flashing.push(hz); return t < 0.5; } };
  const on = meter(hud(0)).map((c) => c.args[4]);
  const off = meter(hud(0.7)).map((c) => c.args[4]);
  assert.deepEqual(on, [C.ink, C.gold, C.ember]);
  assert.deepEqual(off, [C.ink, C.cyan, C.cyanDark]);
  assert.ok(flashing.includes(6), '3 Hz = 6 flips a second, through Calm mode');
  assert.deepEqual(meter(hud(0)).map((c) => c.args[2]), [48, 48, 48], 'full width');
  const strings = hud(0).of('text').map((c) => c.args[0]);
  assert.ok(!strings.some((q) => /\[E\]|ULTRATHINK|^x\d+$|\/compact/.test(q)), `no prompt or chain text: ${strings}`);
});

test('hud: YOLO tag, stage path in the accent colour, WAVE n/2 in grey, and the /compact banner fading in its last third of a second', () => {
  const { CB, run, w, hud } = hudSetup();
  const C = CB.Pal.C;
  const text = (s, str) => s.of('text').find((c) => c.args[0] === str);
  let s = hud();
  assert.equal(text(s, 'YOLO'), undefined);
  run.yolo = true;
  s = hud();
  assert.deepEqual([text(s, 'YOLO').args[1], text(s, 'YOLO').args[2], text(s, 'YOLO').args[3].color], [78, 5, C.red]);
  assert.deepEqual(text(s, '~/src/').args.slice(1), [316, 5, { align: 'right', color: CB.Pal.STAGES.src.accent }]);
  run.state = 'wave';
  run.waveIndex = 1;
  assert.deepEqual(text(hud(), 'WAVE 2/2').args.slice(1), [160, 5, { align: 'center', color: C.grey }]);
  run.state = 'waveBreak';
  assert.ok(!hud().of('text').some((c) => /^WAVE/.test(c.args[0])), 'wave text is for the wave itself');
  assert.equal(text(hud(), 'Compacting conversation...'), undefined);
  w.compactBannerT = 0.2;
  const b = text(hud(), 'Compacting conversation...');
  assert.deepEqual(b.args.slice(1, 3), [160, 22]);
  assert.equal(b.args[3].color, C.gold);
  assert.ok(near(b.args[3].alpha, 0.6));
  w.compactBannerT = 1;
  assert.equal(text(hud(), 'Compacting conversation...').args[3].alpha, 1);
  run.stageIndex = 2;
  w.stage = CB.STAGES[2];
  assert.equal(text(hud(), '~/.git/').args[3].color, CB.Pal.STAGES.git.accent);
});

test('hud: bossBarFill eases out cubically over the first 0.8 s of the fight, then tracks hp / maxHp', () => {
  const { CB, run, w } = hudSetup();
  const fill = (state, stateT, hp, maxHp) => {
    run.state = state;
    run.stateT = stateT;
    w.boss = { id: 'x', hp, maxHp, phase: 1, defeated: false };
    return CB.Screens.hud.bossBarFill(run);
  };
  assert.equal(fill('boss', 0, 50, 100), 0);
  assert.ok(near(fill('boss', 0.4, 50, 100), 0.875 * 0.5), 'easeOutCubic(0.5) = 0.875');
  assert.ok(near(fill('boss', 0.8, 50, 100), 0.5));
  assert.ok(near(fill('boss', 30, 50, 100), 0.5));
  assert.ok(near(fill('bossDead', 0, 50, 100), 0.5), 'no easing outside the boss state');
  assert.equal(fill('bossDead', 1, 0, 100), 0);
  assert.equal(fill('boss', 5, 150, 100), 1, 'clamped');
  assert.equal(fill('boss', 5, -4, 100), 0);
  assert.equal(fill('boss', 5, NaN, 100), 0);
  assert.equal(fill('boss', 5, 50, 0), 0);
  let prev = -1;
  for (let t = 0; t <= 0.8; t += 0.05) {
    const v = fill('boss', t, 100, 100);
    assert.ok(v >= prev, 'monotonic');
    prev = v;
  }
  w.boss = null;
  assert.equal(CB.Screens.hud.bossBarFill(run), 0, 'no boss, no bar');
  assert.equal(CB.Screens.hud.bossBarFill({}), 0);
});

test('hud: the boss bar is a 140x5 ink frame at (90, 10) with a redDark well; red fill, ember from phase 2; the name types in at y 1', () => {
  const { CB, run, w, hud } = hudSetup({ font: true });
  const C = CB.Pal.C;
  w.boss = { id: 'infiniteLoop', hp: 50, maxHp: 100, phase: 1, defeated: false };
  run.state = 'bossDead';
  run.stateT = 1;
  let s = hud();
  assert.deepEqual(s.of('frame').find((c) => c.args[0] === 90).args, [90, 10, 140, 5, C.ink]);
  const rects = s.of('rect').filter((c) => c.args[1] >= 11 && c.args[1] <= 13 && c.args[0] >= 91);
  assert.deepEqual(rects.map((c) => c.args), [[91, 11, 138, 3, C.redDark], [91, 11, 69, 3, C.red], [91, 11, 69, 1, C.hurt]]);
  w.boss.phase = 2;
  assert.equal(hud().of('rect').filter((c) => c.args[1] === 11 && c.args[2] === 69).map((c) => c.args[4]).join(), [C.ember, C.gold].join());
  const name = (state, t) => {
    run.state = state;
    run.stateT = t;
    return hud().of('text').filter((c) => c.args[0] !== '~/src/' && c.args[2] === 1);
  };
  assert.equal(name('boss', 0).length, 0, 'nothing typed yet');
  assert.equal(name('boss', 0.1)[0].args[0], 'THE ');
  assert.equal(name('boss', 0.2)[0].args[0], 'THE INFI');
  assert.equal(name('boss', 5)[0].args[0], 'THE INFINITE LOOP');
  assert.equal(name('bossDead', 0)[0].args[0], 'THE INFINITE LOOP', 'whole in bossDead');
  const xs = new Set([0.1, 0.2, 0.3, 5].map((t) => name('boss', t)[0].args[1]));
  assert.equal(xs.size, 1, 'anchored where the whole name is centred: it types out without sliding');
  assert.equal([...xs][0], Math.round(160 - 91 / 2));
  assert.equal(name('wave', 5).length, 0, 'no boss text in a wave');
});

test('hud: the white damage segment holds for a moment after a hit, then eases down to the fill', () => {
  const { CB, run, w, hud } = hudSetup();
  const C = CB.Pal.C;
  w.boss = { id: 'infiniteLoop', hp: 100, maxHp: 100, phase: 1, defeated: false };
  run.state = 'bossDead';
  run.stateT = 1;
  let t = 1;
  // One frame at 60 fps; returns the [x, y, width] of the white segment (none when the bar is caught up).
  const frame = () => {
    t += 1 / 60;
    return hud(t).of('rect').filter((c) => c.args[4] === C.white && c.args[1] === 11).map((c) => c.args.slice(0, 3));
  };
  const frames = (n) => {
    let out;
    for (let i = 0; i < n; i++) out = frame();
    return out;
  };
  assert.deepEqual(frames(3), [], 'no damage, no segment');
  w.boss.hp = 50;
  assert.deepEqual(frame(), [[160, 11, 69]], 'the full 69 px of the hit are white on the first frame');
  assert.deepEqual(frames(4), [[160, 11, 69]], 'and held for the next few frames');
  const widths = [];
  for (let i = 0; i < 120; i++) {
    const seg = frame();
    if (!seg.length) break;
    widths.push(seg[0][2]);
  }
  assert.ok(widths.length > 3 && Math.min(...widths) < 69, 'easing down after the hold');
  assert.ok((5 + widths.length) / 60 < 0.45, `gone about 0.3 s after the hit (${5 + widths.length} frames)`);
  assert.ok(widths.every((v, i) => i === 0 || v <= widths[i - 1]), 'monotonically shrinking');
  assert.deepEqual(frames(10), [], 'caught up with the fill');
  w.boss.hp = 20;
  assert.deepEqual(frame(), [[119, 11, 41]], 'a second hit opens a new segment from the old fill (28 px) to the new one (69 px)');
  w.boss = { id: 'infiniteLoop', hp: 100, maxHp: 100, phase: 1, defeated: false };
  assert.deepEqual(frame(), [], 'a new boss object starts with no ghost');
  w.boss.hp = 90;
  assert.equal(frame().length, 1);
  w.boss.hp = 100;
  assert.deepEqual(frame(), [], 'healing pushes the ghost along at once');
});

test('hud: cursors. The crosshair is centred and pulses its arms every 0.25 s; the pointer has its tip on the hotspot', () => {
  const { CB, r } = hudSetup({ font: true });
  const rec = H.recorder(r, CB);
  const at = (mode, x, y, t) => {
    rec.clear();
    CB.Screens.hud.cursor(r, x, y, mode, t);
    return rec.sprites();
  };
  for (const [x, y] of [[100, 90], [100.4, 90.4], [100.6, 90.6], [3, 4], [0, 0]]) {
    const [a] = at('cross', x, y, 0);
    assert.equal(a.name, 'cursor_cross_0');
    assert.deepEqual([a.w, a.h], [9, 9]);
    assert.deepEqual([a.x + 4, a.y + 4], [Math.round(x), Math.round(y)], 'the middle pixel is on the aim point');
    const [b] = at('cross', x, y, 0.25);
    assert.equal(b.name, 'cursor_cross_1');
    assert.deepEqual([b.x + 5, b.y + 5], [Math.round(x), Math.round(y)]);
  }
  assert.equal(at('cross', 50, 50, 0.49)[0].name, 'cursor_cross_1');
  assert.equal(at('cross', 50, 50, 0.5)[0].name, 'cursor_cross_0');
  assert.equal(at('cross', 50, 50, 1.3)[0].name, 'cursor_cross_1');
  for (const [x, y] of [[100, 90], [160.3, 20.7], [0, 0]]) {
    const [p] = at('pointer', x, y, 0);
    assert.equal(p.name, 'cursor_pointer');
    assert.deepEqual([p.w, p.h], [7, 10]);
    assert.deepEqual([p.x, p.y], [Math.round(x), Math.round(y)], 'the tip pixel is the hotspot');
    assert.equal(CB.Art.spriteDef('cursor_pointer').rows[0][0], 'k');
  }
  assert.deepEqual(at('cross', NaN, 5, 0), []);
  assert.deepEqual(at('pointer', 5, Infinity, 0), []);
  assert.deepEqual(at('whatever', 20, 20, 0).map((b) => b.name), ['cursor_cross_0'], 'anything but pointer is the crosshair');
});

test('hud: sprites are well-formed pixel art (ink-outlined cursors, two shades on the hearts, mirrored crosshairs, a transparent middle)', () => {
  const { CB } = setup();
  const def = (n) => CB.Art.spriteDef(n);
  assert.deepEqual([def('heart_full').w, def('heart_full').h, def('heart_empty').w, def('heart_empty').h], [7, 6, 7, 6]);
  assert.deepEqual([def('dash_ready').w, def('dash_ready').h, def('dash_cool').w, def('dash_cool').h], [5, 5, 5, 5]);
  const pix = (n) => def(n).rows.join('');
  for (const ch of 'rRw') assert.ok(pix('heart_full').includes(ch), `heart_full has ${ch}`);
  assert.ok(pix('heart_empty').includes('S'));
  // Both hearts are one silhouette; only the shine pixel (row 1) breaks the body's mirror symmetry.
  const mirror = (rows) => rows.map((q) => [...q].reverse().join(''));
  assert.deepEqual(def('heart_empty').rows, mirror(def('heart_empty').rows), 'the empty heart is left/right symmetric');
  const noShine = def('heart_full').rows.map((q) => q.replace('w', 'r'));
  assert.deepEqual(noShine, mirror(noShine), 'the full heart is symmetric apart from its shine pixel');
  for (const ch of 'cCw') assert.ok(pix('dash_ready').includes(ch));
  for (const [n, size] of [['cursor_cross_0', 9], ['cursor_cross_1', 11]]) {
    const rows = def(n).rows;
    assert.deepEqual([def(n).w, def(n).h], [size, size]);
    const mid = (size - 1) / 2;
    assert.equal(rows[mid][mid], '.', '1 px gap in the centre');
    assert.deepEqual(rows, rows.slice().reverse(), 'top/bottom mirror');
    assert.deepEqual(rows, rows.map((q) => [...q].reverse().join('')), 'left/right mirror');
    assert.ok(pix(n).includes('k') && pix(n).includes('w') && /^[.kw]+$/.test(pix(n)), 'white arms, ink outline');
    assert.equal(rows[0][mid], 'k', 'the arm ends in ink');
  }
  assert.ok(/^[.kw]+$/.test(pix('cursor_pointer')));
  assert.equal(def('cursor_cross_1').rows[5].indexOf('w'), 1, 'arms one pixel longer than frame 0');
  assert.equal(def('cursor_cross_0').rows[4].indexOf('w'), 1);
  assert.equal(def('cursor_cross_1').rows[5].lastIndexOf('k'), 10);
});

// ---- HUD layout (real font, recorder) --------------------------------------------------------------------------------------------------

function layoutEnv(stageIndex, over) {
  const env = hudSetup({ font: true });
  const { CB } = env;
  env.run = CB.createRun(Object.assign({ seed: 4, startStage: stageIndex }, over || {}));
  env.w = env.run.world;
  env.rec = H.recorder(env.r, CB);
  return env;
}
function worst(env, state, stateT) {
  const { CB, run, w } = env;
  const id = CB.STAGES[run.stageIndex].boss;
  w.player.stats.maxHearts = 7;
  w.player.hearts = 7;
  w.player.dashCd = 0.3;
  w.context = { value: 45, max: 45, announced: true };
  w.compactBannerT = 1;
  w.boss = { id, hp: 70, maxHp: 100, phase: 2, defeated: false };
  run.yolo = true;
  run.state = state;
  run.stateT = stateT;
  run.waveIndex = 1;
  env.rec.clear();
  CB.Screens.hud.draw(env.r, run, 1.1);
  return env.rec;
}

test('hud layout: the worst-case HUD (7 hearts, full meter, banner, boss bar, YOLO) stays on screen with no overlapping text', { skip: !HAS_FONT }, () => {
  for (let i = 0; i < 4; i++) {
    for (const [state, stateT] of [['boss', 5], ['boss', 0.2], ['bossDead', 2], ['wave', 3]]) {
      const env = layoutEnv(i);
      const rec = worst(env, state, stateT);
      const where = `stage ${i} ${state}`;
      assert.deepEqual(rec.outside(), [], `${where}: every text and sprite box is inside 320x180`);
      assert.deepEqual(rec.overlaps().map(([a, b]) => [a.str, b.str]), [], `${where}: no two text boxes overlap`);
      const strs = rec.texts().map((q) => q.str);
      assert.ok(strs.includes('YOLO') && strs.includes('Compacting conversation...'), where);
      assert.ok(strs.includes(env.CB.STAGES[i].path), where);
      if (state === 'wave') assert.ok(strs.includes('WAVE 2/2'), where);
      if (state === 'boss' && stateT === 5) assert.ok(strs.includes(NAMES[env.CB.STAGES[i].boss]), where);
      for (const t of rec.texts()) for (const sp of rec.sprites()) {
        assert.ok(!(t.x < sp.x + sp.w && sp.x < t.x + t.w && t.y < sp.y + sp.h && sp.y < t.y + t.h), `${where}: text "${t.str}" sits on sprite ${sp.name}`);
      }
    }
  }
});

test('hud layout: the 1-heart throb, a dead player and the wave state also stay on screen', { skip: !HAS_FONT }, () => {
  const env = layoutEnv(0);
  const { CB, w, run, rec } = env;
  w.player.hearts = 1;
  w.player.beatPulse = 1;
  run.state = 'wave';
  CB.Screens.hud.draw(env.r, run, 0.3);
  assert.deepEqual(rec.outside(), []);
  const heart = rec.sprites().find((b) => b.name === 'heart_full');
  assert.deepEqual([heart.x, heart.y, heart.w, heart.h], [1, 1, 14, 12], 'the swollen heart stays above the meter at y 13');
  rec.clear();
  w.player.hearts = 0;
  w.player.dead = true;
  CB.Screens.hud.draw(env.r, run, 0.3);
  assert.deepEqual(rec.outside(), []);
  assert.equal(rec.sprites().filter((b) => b.name === 'heart_empty').length, 5);
});

test('hud: draws with no world, no player, no stage and none of the optional modules', () => {
  const { CB, r } = setup();
  CB.Screens.hud.draw(r, null, 1);
  CB.Screens.hud.draw(r, {}, 1);
  CB.Screens.hud.draw(r, { world: {} }, 1);
  const run = CB.createRun({ seed: 1 });
  run.world.stage = null;
  run.world.context = null;
  run.state = 'boss';
  run.world.boss = { hp: 1, maxHp: 2 };
  CB.Screens.hud.draw(r, run, NaN);
  CB.Screens.hud.draw(r, run, undefined);
  run.world.player.stats = undefined;
  run.world.player.hearts = undefined;
  CB.Screens.hud.draw(r, run, 2);
});

test('arena: the Infinite Loop dashes march 8 px/s but stand still in calm mode, and a huge radius stays inside the floor', () => {
  const { CB, r } = setup();
  const s = spy(r);
  const ring = (t, radius) => {
    const { w } = bossWorld(CB, 'infiniteLoop', { radius: radius == null ? 60 : radius });
    s.clear();
    CB.Arena.draw(r, w.stage, t, w);
    return s.of('rect').filter((c) => near(c.a, 0.18) && c.args[2] === 1 && c.args[3] === 1).map((c) => c.args.slice(0, 2).join());
  };
  assert.notDeepEqual(ring(0.3), ring(0.6), 'marching');
  assert.deepEqual(ring(0.3), ring(0.3 + 1 / 60), 'one pixel step per 1/8 s, not per frame');
  CB.Comfort = { calm: () => true };
  assert.deepEqual(ring(0.3), ring(0.6), 'calm: still');
  CB.Comfort = { calm: () => false, blink: () => true };
  assert.notDeepEqual(ring(0.3), ring(0.6));
  for (const key of ring(0, 5000)) {
    const y = Number(key.split(',')[1]);
    assert.ok(y >= 20 && y < 172, `ring pixel at y ${y} leaves the floor`);
  }
});

test('hud: YOLO is drawn after the boss bar (so it stays legible over the bar end), and also shows when only the world mode says yolo', () => {
  const { CB, run, w, hud } = hudSetup();
  w.boss = { id: 'infiniteLoop', hp: 50, maxHp: 100, phase: 1, defeated: false };
  run.state = 'boss';
  run.stateT = 5;
  run.yolo = true;
  let s = hud();
  const at = (fn, pred) => s.calls.findIndex((c) => c.fn === fn && pred(c));
  assert.ok(at('text', (c) => c.args[0] === 'YOLO') > at('frame', (c) => c.args[0] === 90), 'the tag follows the bar');
  assert.equal(s.of('text').find((c) => c.args[0] === 'YOLO').args[3].shadow, CB.Pal.C.ink);
  run.yolo = false;
  assert.equal(hud().of('text').filter((c) => c.args[0] === 'YOLO').length, 0);
  w.mode = { yolo: true };
  assert.equal(hud().of('text').filter((c) => c.args[0] === 'YOLO').length, 1);
});
