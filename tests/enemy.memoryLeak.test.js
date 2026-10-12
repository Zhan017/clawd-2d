'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/memoryLeak.js'];
const ELITE_FILES = [...FILES, 'src/game/pickups.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });
const leaks = (w) => w.enemies.filter((e) => !e.dead && e.kind === 'memoryLeak');

// A renderer that records every call and runs alpha() callbacks, so draw() can be inspected headless.
function fakeRenderer() {
  const calls = [];
  const r = new Proxy({}, {
    get(_, name) {
      if (name === 'alpha') return (a, fn) => { calls.push({ fn: 'alpha', a }); fn(); };
      return (...args) => { calls.push({ fn: String(name), args }); };
    },
  });
  return { r, calls };
}
const spriteCalls = (calls) => calls.filter((c) => c.fn === 'sprite');

test('memoryLeak: big and small stats', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 60, 60);
  const small = w.spawnEnemy('memoryLeak', 90, 60, { small: true });
  assert.equal(big.hp, 4);
  assert.equal(big.r, 6);
  assert.equal(small.hp, 2);
  assert.equal(small.r, 4);
  assert.equal(small.data.small, true);
});

test('memoryLeak: a big blob splits into exactly two smalls; smalls do not split', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 60, 60);
  w.damageEnemy(big, 4);
  H.stepN(w, 1, idle);
  const smalls = leaks(w);
  assert.equal(smalls.length, 2);
  for (const s of smalls) {
    assert.equal(s.data.small, true);
    assert.equal(s.hp, 2);
  }
  for (const s of smalls) w.damageEnemy(s, 2);
  H.stepN(w, 1, idle);
  assert.equal(leaks(w).length, 0);
  assert.ok(w.events.some((e) => e.type === 'splat'));
});

test('memoryLeak: silent kills never split', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.spawnEnemy('memoryLeak', 60, 60);
  w.killAllEnemies();
  H.stepN(w, 1, idle);
  assert.equal(leaks(w).length, 0);
});

test('memoryLeak: small blobs move ~45 px/s', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = 96;
  const s = w.spawnEnemy('memoryLeak', 40, 96, { small: true });
  H.stepN(w, 60, idle);
  assert.ok(s.x - 40 > 40 && s.x - 40 < 47, `dx ${s.x - 40}`);
});

// ---- Rev 3: splits never inherit elite ---------------------------------------------------------------------------------------

test('memoryLeak: killing an elite big blob leaves two plain smalls (no elite flag, no time scale, hp 2)', () => {
  const CB = H.load(ELITE_FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 60, 60, { elite: true });
  assert.equal(big.elite, true, 'the parent really is a P0');
  assert.equal(big.hp, 7); // ceil(4 * 1.75)
  assert.equal(big.timeScale, 1.2);
  w.damageEnemy(big, 7);
  assert.equal(big.dead, true);
  const smalls = leaks(w);
  assert.equal(smalls.length, 2);
  for (const s of smalls) {
    assert.ok(!s.elite, 'split is not elite');
    assert.ok(!s.timeScale, 'split runs at normal speed');
    assert.equal(s.hp, 2);
    assert.equal(s.maxHp, 2);
    assert.equal(s.data.small, true);
  }
  assert.equal(w.pickups.length, 1, 'only the elite parent drops a hotfix');
  for (const s of smalls) w.damageEnemy(s, 2);
  H.stepN(w, 1, idle);
  assert.equal(leaks(w).length, 0);
  assert.equal(w.pickups.length, 1, 'killing the splits adds no hotfix');
});

test('memoryLeak: splits ignore elite flags set on the parent by hand', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 60, 60);
  big.elite = true;
  big.timeScale = 1.2;
  w.killEnemy(big);
  const smalls = leaks(w);
  assert.equal(smalls.length, 2);
  for (const s of smalls) {
    assert.ok(!s.elite);
    assert.ok(!s.timeScale);
    assert.equal(s.hp, 2);
  }
});

// ---- split placement ---------------------------------------------------------------------------------------------------------

test('memoryLeak: the splits land 5 px either side of the blob, perpendicular to the player direction', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 200;
  w.player.y = 100;
  const big = w.spawnEnemy('memoryLeak', 100, 100);
  w.killEnemy(big);
  const ys = leaks(w).map((e) => e.y).sort((a, b) => a - b);
  assert.deepEqual(H.plain(ys), [95, 105]);
  for (const s of leaks(w)) assert.equal(s.x, 100);

  // A diagonal approach: both splits are 5 px out, at a right angle to the way the player lies.
  w.player.x = 200;
  w.player.y = 200;
  const b2 = w.spawnEnemy('memoryLeak', 100, 100);
  const before = new Set(leaks(w));
  w.killEnemy(b2);
  const added = leaks(w).filter((e) => !before.has(e));
  assert.equal(added.length, 2);
  const ux = Math.SQRT1_2;
  const uy = Math.SQRT1_2;
  for (const s of added) {
    assert.ok(Math.abs(Math.hypot(s.x - 100, s.y - 100) - 5) < 1e-9, 'offset is 5 px');
    assert.ok(Math.abs((s.x - 100) * ux + (s.y - 100) * uy) < 1e-9, 'offset is perpendicular to the player direction');
  }
  assert.ok(Math.abs(added[0].x + added[1].x - 200) < 1e-9 && Math.abs(added[0].y + added[1].y - 200) < 1e-9, 'one each side');
});

test('memoryLeak: splits are pulled inside the arena when the parent dies against a wall', () => {
  const CB = H.load(FILES);
  const a = CB.ARENA;
  const inside = (s) => s.x >= a.x + s.r && s.x <= a.x + a.w - s.r && s.y >= a.y + s.r && s.y <= a.y + a.h - s.r;
  // Left wall with the player straight below: the sideways offset would put one split at x = a.x + 1.
  let w = CB.createWorld({ seed: 1 });
  w.player.x = a.x + 6;
  w.player.y = a.y + 100;
  w.killEnemy(w.spawnEnemy('memoryLeak', a.x + 6, a.y + 40));
  let kids = leaks(w);
  assert.equal(kids.length, 2);
  for (const s of kids) assert.ok(inside(s), `${s.x},${s.y}`);
  assert.ok(kids.some((s) => s.x === a.x + s.r), 'one split was pulled in off the wall');
  // Top wall with the player straight to the right: the offset runs up and down.
  w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = a.y + 6;
  w.killEnemy(w.spawnEnemy('memoryLeak', 160, a.y + 6));
  kids = leaks(w);
  assert.equal(kids.length, 2);
  for (const s of kids) assert.ok(inside(s), `${s.x},${s.y}`);
  assert.ok(kids.some((s) => s.y === a.y + s.r), 'one split was pulled in off the ceiling');
});

test('memoryLeak: a blob dying exactly on the player still splits, with finite positions and a finite splat event', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 120, 90);
  w.player.x = 120;
  w.player.y = 90;
  w.killEnemy(big);
  const smalls = leaks(w);
  assert.equal(smalls.length, 2);
  for (const s of smalls) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
  const splat = w.events.filter((e) => e.type === 'splat');
  assert.equal(splat.length, 1);
  assert.ok(Number.isFinite(splat[0].x) && Number.isFinite(splat[0].y));
  assert.notDeepEqual([smalls[0].x, smalls[0].y], [smalls[1].x, smalls[1].y], 'the two splits do not share a point');
});

test('memoryLeak: only the big blob splashes; a small one dying emits no splat', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const s = w.spawnEnemy('memoryLeak', 90, 60, { small: true });
  w.damageEnemy(s, 2);
  assert.equal(s.dead, true);
  assert.equal(w.events.filter((e) => e.type === 'splat').length, 0);
  assert.equal(w.events.filter((e) => e.type === 'enemyDie').length, 1);
});

test('memoryLeak: at the enemy cap the split just spawns nothing (no throw), and the splat still fires', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  for (let i = 0; i < CB.CAPS.enemies - 1; i++) w.spawnEnemy('memoryLeak', 40 + (i % 10) * 20, 40 + Math.floor(i / 10) * 15, { small: true });
  const big = w.spawnEnemy('memoryLeak', 160, 160);
  assert.ok(big, 'the cap is not yet reached');
  assert.equal(w.enemies.length, CB.CAPS.enemies);
  assert.doesNotThrow(() => w.killEnemy(big));
  assert.equal(w.enemies.length, CB.CAPS.enemies, 'nothing was added');
  assert.equal(w.events.filter((e) => e.type === 'splat').length, 1);
});

// ---- movement ----------------------------------------------------------------------------------------------------------------

test('memoryLeak: a big blob chases at ~30 px/s and publishes its velocity', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = 96;
  const e = w.spawnEnemy('memoryLeak', 40, 96);
  H.stepN(w, 60, idle);
  assert.ok(e.x - 40 > 28 && e.x - 40 < 32, `dx ${e.x - 40}`);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 30) < 0.5, `speed ${Math.hypot(e.vx, e.vy)}`);
  assert.equal(e.facing, 1);
});

test('memoryLeak: it turns to face the player and keeps its facing when the heading is nearly vertical', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 40;
  w.player.y = 150;
  const e = w.spawnEnemy('memoryLeak', 200, 60);
  H.stepN(w, 5, idle);
  assert.equal(e.facing, -1);
  e.x = 40; // straight above the player: vx ~ 0, so the facing must not flicker
  H.stepN(w, 30, idle);
  assert.equal(e.facing, -1);
});

test('memoryLeak: an elite blob runs 20% faster and its published velocity is the real one', () => {
  const CB = H.load(ELITE_FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = 96;
  const e = w.spawnEnemy('memoryLeak', 40, 96, { elite: true });
  H.stepN(w, 60, idle);
  assert.ok(e.x - 40 > 34.5 && e.x - 40 < 37.5, `dx ${e.x - 40}`);
  assert.ok(Math.abs(e.vx - 36) < 0.6, `vx ${e.vx}`);
});

test('memoryLeak: it stays inside the arena and stands still on top of the player', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1, god: true });
  const a = w.arena;
  const out = w.spawnEnemy('memoryLeak', a.x - 30, a.y - 30);
  H.stepN(w, 1, idle);
  assert.ok(out.x >= a.x + out.r && out.y >= a.y + out.r, `${out.x},${out.y}`);
  const on = w.spawnEnemy('memoryLeak', w.player.x, w.player.y, { small: true });
  H.stepN(w, 2, idle);
  assert.ok(Number.isFinite(on.x) && Number.isFinite(on.y) && Number.isFinite(on.vx) && Number.isFinite(on.vy));
  assert.deepEqual(H.plain([on.x, on.y, on.vx, on.vy]), [w.player.x, w.player.y, 0, 0], 'a blob on top of Clawd rests there');
});

test('memoryLeak: it never overshoots Clawd; it lands on the spot, rests there and does not flicker its facing', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1, god: true });
  w.player.x = 150;
  w.player.y = 100;
  const e = w.spawnEnemy('memoryLeak', 150.3, 100); // closer than one tick of travel (0.5 px)
  H.stepN(w, 1, idle);
  assert.equal(e.x, 150);
  assert.equal(e.facing, -1);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    H.stepN(w, 1, idle);
    seen.push([e.x, e.vx, e.facing]);
  }
  assert.deepEqual(H.plain(seen), [[150, 0, -1], [150, 0, -1], [150, 0, -1], [150, 0, -1], [150, 0, -1]]);
});

// ---- sprites and drawing -----------------------------------------------------------------------------------------------------

const SPRITES = { memoryLeak_0: [14, 11], memoryLeak_1: [14, 11], memoryLeakSmall_0: [10, 8], memoryLeakSmall_1: [10, 8] };

test('memoryLeak: the four slime sprites are defined at 14x11 and 10x8', () => {
  const CB = H.load(FILES);
  for (const [name, [wd, ht]] of Object.entries(SPRITES)) {
    assert.ok(CB.Art.hasSprite(name), name);
    const d = CB.Art.spriteDef(name);
    assert.equal(d.w, wd, `${name} width`);
    assert.equal(d.h, ht, `${name} height`);
    CB.Art.sprite(name); // bakes headless
  }
});

test('memoryLeak: sprite art rules: ink outline all round, two greens, a white highlight, the bottom row drips', () => {
  const CB = H.load(FILES);
  for (const name of Object.keys(SPRITES)) {
    const rows = CB.Art.spriteDef(name).rows;
    const h = rows.length;
    const w = rows[0].length;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? '.' : rows[y][x]);
    let greens = 0;
    let darks = 0;
    let whites = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = at(x, y);
        if (ch === '.') continue;
        if (ch === 'g') greens++;
        if (ch === 'G') darks++;
        if (ch === 'w') whites++;
        if (ch === 'k') continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          assert.notEqual(at(x + dx, y + dy), '.', `${name}: "${ch}" at ${x},${y} touches empty space; the silhouette needs a k outline`);
        }
      }
    }
    assert.ok(greens >= 8, `${name}: light green fill (${greens})`);
    assert.ok(darks >= 4, `${name}: dark green shading (${darks})`);
    assert.ok(whites >= 1, `${name}: highlight pixel`);
    const last = rows.map((row, y) => [y, row.replace(/\./g, '').length]).filter(([, n]) => n > 0).pop();
    const widest = Math.max(...rows.map((row) => row.replace(/\./g, '').length));
    assert.equal(last[0], h - 1, `${name}: the sprite reaches its last row`);
    assert.ok(last[1] < widest / 2, `${name}: the bottom row is narrower than the body, i.e. it drips (${last[1]} of ${widest})`);
  }
});

test('memoryLeak: the two frames of each size differ (a real squash)', () => {
  const CB = H.load(FILES);
  assert.notDeepEqual(CB.Art.spriteDef('memoryLeak_0').rows, CB.Art.spriteDef('memoryLeak_1').rows);
  assert.notDeepEqual(CB.Art.spriteDef('memoryLeakSmall_0').rows, CB.Art.spriteDef('memoryLeakSmall_1').rows);
});

test('memoryLeak: draw uses both squash frames, the right size, a shadow first, and flips with facing', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 100, 80);
  const small = w.spawnEnemy('memoryLeak', 140, 80, { small: true });
  const seen = { big: new Set(), small: new Set() };
  for (let i = 0; i < 40; i++) {
    const t = i * 0.05;
    for (const [key, e] of [['big', big], ['small', small]]) {
      e.t = t;
      const { r, calls } = fakeRenderer();
      CB.Enemies.memoryLeak.draw(e, r, t);
      const sp = spriteCalls(calls);
      assert.equal(sp.length, 1);
      seen[key].add(sp[0].args[0]);
      const firstSprite = calls.findIndex((c) => c.fn === 'sprite');
      const shadow = calls.findIndex((c) => c.fn === 'rect');
      assert.ok(shadow >= 0 && shadow < firstSprite, 'the ground shadow is drawn before the sprite');
    }
  }
  assert.deepEqual([...seen.big].sort(), ['memoryLeak_0', 'memoryLeak_1']);
  assert.deepEqual([...seen.small].sort(), ['memoryLeakSmall_0', 'memoryLeakSmall_1']);
  big.facing = 1;
  let c = fakeRenderer();
  CB.Enemies.memoryLeak.draw(big, c.r, 0);
  assert.ok(!spriteCalls(c.calls)[0].args[3].flip);
  big.facing = -1;
  c = fakeRenderer();
  CB.Enemies.memoryLeak.draw(big, c.r, 0);
  assert.equal(spriteCalls(c.calls)[0].args[3].flip, true);
});

test('memoryLeak: draw always names a defined sprite, wherever the blob spawned and whatever its age', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  for (const [x, y] of [[-40, -17], [-1, 0], [0, -1], [7, 7], [123.7, 98.2], [300, 170], [1000, -1000]]) {
    for (const opts of [undefined, { small: true }]) {
      const e = w.spawnEnemy('memoryLeak', x, y, opts);
      for (let i = 0; i < 60; i++) {
        e.t = i / 20;
        const { r, calls } = fakeRenderer();
        CB.Enemies.memoryLeak.draw(e, r, e.t);
        const name = spriteCalls(calls)[0].args[0];
        assert.ok(CB.Art.hasSprite(name), `${name} at ${x},${y} t=${e.t}`);
      }
      e.dead = true;
    }
  }
});

test('memoryLeak: the hit flash draws the sprite white', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  for (const opts of [undefined, { small: true }]) {
    const e = w.spawnEnemy('memoryLeak', 100, 80, opts);
    e.hitFlash = 0.05;
    let c = fakeRenderer();
    CB.Enemies.memoryLeak.draw(e, c.r, 0.3);
    assert.equal(spriteCalls(c.calls)[0].args[3].white, true);
    e.hitFlash = 0;
    c = fakeRenderer();
    CB.Enemies.memoryLeak.draw(e, c.r, 0.3);
    assert.equal(spriteCalls(c.calls)[0].args[3].white, false);
  }
});

test('memoryLeak: draw bakes through a real renderer without throwing', () => {
  const { CB, sandbox } = H.load([...H.CORE, 'src/art/render.js', ...H.GAME_BASE.slice(H.CORE.length), 'src/game/enemies/memoryLeak.js'], { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const w = CB.createWorld({ seed: 1 });
  const big = w.spawnEnemy('memoryLeak', 100, 80);
  const small = w.spawnEnemy('memoryLeak', 140, 80, { small: true });
  small.alpha = 0.5;
  for (let i = 0; i < 20; i++) {
    CB.Enemies.memoryLeak.draw(big, r, i / 10);
    CB.Enemies.memoryLeak.draw(small, r, i / 10);
  }
});
