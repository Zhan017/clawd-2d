# Clawd vs Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A top-down pixel boss-rush where Clawd shoots ✻ sparks at software-bug creatures across 4 stages and 4 bosses, playable from `index.html` and published as a claude.ai Artifact.

**Architecture:**
- Classic `<script>` files attach to one global `window.CB`. `index.html` holds their order.
- Game logic (world, entities, run state machine) is pure state mutation with a seeded RNG, so it runs headless in `node:vm` for tests and for a bot playthrough. Drawing lives only in `draw` functions.
- A 320×180 off-screen buffer is scaled up by an integer factor for crisp pixels.

**Tech Stack:** vanilla JavaScript (ES2020, no modules), Canvas 2D, Web Audio, Node ≥ 20 `node:test` + `node:vm`. Zero npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-06-clawd-vs-bugs-design.md`. Read it before any task. Numbers in this plan are copied from it, and if the two ever disagree, the spec wins unless this plan says "(plan override)".

## Global Constraints

- **No dependencies:** no npm packages, no bundler, no ES modules, no TypeScript.
- **No `Math.random()`** in anything under `src/game/` or `src/core/` except `audio.js` (noise buffer only). Use `world.rng` (logic) or `world.fxRng` (cosmetics). The test harness poisons `Math.random` to throw.
- **No `Date.now()`** in `src/game/`. `src/scenes/play.js` may use it for the run seed.
- **File shape:** every source file is `(function (CB) { 'use strict'; … })(window.CB);`. Only `src/core/ns.js` creates `window.CB`.
- **Logic never draws:** nothing under `src/game/` touches canvas APIs outside a function named `draw`.
- **Coordinates:** internal resolution is 320×180. The arena is `CB.ARENA = {x: 8, y: 20, w: 304, h: 152}`. All gameplay units are internal pixels and seconds. The fixed step is `CB.DT = 1/60`.
- **Script order:** `index.html` is the single source of truth. New files must be added there, and the order in Task 1 is final.
- **Copy:**
  - Title "CLAWD vs BUGS".
  - Footer "Fan game. Not affiliated with Anthropic."
  - Game over `Segmentation fault (core dumped)`.
  - Victory `ALL TESTS PASSING ✓`.
  - Crash `KERNEL PANIC`.
- **Artifact page:** `<title>Clawd vs Bugs</title>`, single dark look (`color-scheme: dark` on `:root`), explicit body background, no horizontal page scroll at 400 px width.
- **Parallel-agent safety:** implementers never run `git` and never edit files outside their task's **Files** list. The orchestrator commits.
- **Tests:** `node --test` from the repo root (auto-discovers `tests/*.test.js`; on Node 21+ the directory form `node --test tests/` does not recurse). Test files are named `tests/<area>.test.js`. One file: `node --test tests/<area>.test.js`.

## Review Focus

These are the failure modes the spec implies but no happy-path test covers, most likely first. Each one has a test in the task that owns the code.

1. **Click-through on menus.** A player holding or spamming fire when a boss dies must not accidentally pick a patch card, and one dying mid-spam must not instantly retry. Expect a 0.6 s input lock on `patchPick` and `dead`.
   - Test: Task 4, `stageRunner: patch choice ignored during first 0.6 s` and `stageRunner: death → dying → dead → retry restores the stage` (retry locked for 0.6 s); Task 7, `play: clicking a patch card picks it after the input lock`.
2. **Tab switch or window blur mid-fight.** Expect an auto-pause, and no burst of catch-up ticks when returning.
   - Test: Task 6, `loop: fixed steps, catch-up capped at 5, dt clamped to 0.25 s`; Task 7, `play: onBlur pauses in combat states and pause toggles`.
3. **Window resize, high-DPI or tiny windows.** Mouse aim must map to the right internal pixel at any scale, including fractional scale below 320 px.
   - Test: Task 5, `render: toInternal maps letterboxed coords`, `render: devicePixelRatio 2 …`, `render: fractional scale below 320 px wide`.
4. **Bullet storms.** Entity caps must hold during Heisenbug's spiral plus summons, with no NaN positions, ever.
   - Test: Task 22, `sim: … state healthy` (per-tick cap and NaN check); Task 3, `world: caps hold …`, `world: aiming exactly at the player never produces NaN`.
5. **Death during a boss's death slow-mo, or simultaneous hits.** Clawd must not die after the boss is defeated, and two hits in one tick must cost only one heart.
   - Test: Task 3, `world: an enemy bullet costs one heart and is consumed; a second one in the same tick passes`; Task 4, `stageRunner: player invulnerable during bossDead`.

---

## File Map

| File | Responsibility | Task |
|---|---|---|
| `index.html` | Local page: canvas, small-screen notice, ordered script tags | 1 |
| `package.json`, `.gitignore` | `npm test` → `node --test`; ignore `dist/` | 1 |
| `src/core/ns.js` | `window.CB` namespace, constants | 1 |
| `src/core/math.js` | `CB.M` vector/collision helpers | 1 |
| `src/core/rng.js` | `CB.createRng(seed)` mulberry32 | 1 |
| `tests/harness.js` | loads scripts into `node:vm`, DOM/canvas stubs, `makeInput`, `plain` | 1 |
| `src/art/palette.js` | `CB.Pal` colours, sprite char map, stage palettes | 2 |
| `src/art/sprites.js` | `CB.Art.defineSprite/sprite` (validate + lazy bake) | 2 |
| `src/art/font.js` | `CB.Font` 5×7 bitmap font, measure/wrap/draw | 8 |
| `src/art/render.js` | `CB.createRenderer(canvas)` buffer, scaling, primitives, text cache | 5 |
| `src/core/input.js` | `CB.createInput({canvas, renderer, win})` → `sample()` InputState | 6 |
| `src/core/loop.js` | `CB.createLoop({update, render, onError, now, raf, caf})` | 6 |
| `src/core/audio.js` | `CB.Audio` Web Audio synth SFX, mute, event mapping | 9 |
| `src/game/world.js` | `CB.createWorld`, `CB.makeEnemy`, spawning, damage, collisions, hazards, events | 3 |
| `src/game/projectiles.js` | `CB.Projectiles.update/draw`, bolt sprites | 3 |
| `src/game/patches.js` | `CB.Patches` defs, `computeStats`, `offer`, `apply` | 3 |
| `src/game/player.js` | `CB.Player` create/update/fire/hurt/draw, Clawd sprites | 3 (+7A/7B/7D, 21A look and hats) |
| `src/game/fx.js` | `CB.Fx.consume/update/draw` particles, text pops, explosions | 3 (+7A impact, 21B juice) |
| `src/game/compact.js` | `CB.Compact` context meter, /compact wave, graze, chain | 7B |
| `src/game/pickups.js` | `CB.Pickups` elites and hotfix pickups | 7C |
| `src/game/quips.js` | `CB.Quips` text pools | 21C |
| `src/game/unlocks.js` | `CB.Save`, `CB.HATS`, `CB.Unlocks`, `CB.Secrets` | 7E |
| `src/core/music.js` | `CB.Music` procedural chiptune | 9B |
| `src/game/enemies/*.js` | 5 gauntlet bugs | 10–14 |
| `src/game/bosses/*.js` | 4 bosses | 15–18 |
| `src/game/stages.js` | `CB.STAGES` data | 4 |
| `src/game/waves.js` | `CB.createWaveSpawner(world, waveDef)` | 4 |
| `src/game/stageRunner.js` | `CB.createRun(opts)` run state machine | 4 |
| `src/art/arena.js` | `CB.Arena.draw(r, stage, t)` code-editor floor + walls | 19 |
| `src/art/worldDraw.js` | `CB.WorldDraw.draw(r, world, t, opts)` layer order | 19 |
| `src/scenes/hud.js` | `CB.Screens.hud` hearts, dash pip, path, boss bar, wave text, cursor | 19 |
| `src/scenes/screens.js` | `CB.Screens.stageIntro/waveBanner/bossWarn/bossDead/pause` | 20 |
| `src/scenes/patchPick.js` | `CB.Screens.patchPick` cards + hit-testing | 20 |
| `src/scenes/gameOver.js` | `CB.Screens.gameOver` | 20 |
| `src/scenes/victory.js` | `CB.Screens.victory` | 20 |
| `src/scenes/panic.js` | `CB.Screens.panic` crash screen | 20 |
| `src/scenes/title.js` | `CB.Scenes.title` | 21 |
| `src/scenes/play.js` | `CB.Scenes.play` input routing, pause, delegation | 7 |
| `src/main.js` | boot, scene manager, debug hash, crash capture, hot snapshot | 7 |
| `tests/bot.js` | headless bot input | 22 |
| `tests/sim.test.js` | headless playthrough of all stages | 22 |
| `tools/build-artifact.mjs` | inline everything into `dist/clawd-vs-bugs.html` | 23 |
| `tests/smoke.test.js`, `tests/build.test.js` | whole-game load/draw smoke, build output checks | 23 |
| `README.md`, `.claude/launch.json` | docs, preview server | 24 |

## Execution Order (rev 2)

| Phase | Tasks | Mode | Gate before the next phase |
|---|---|---|---|
| A: Foundation | 1 → 2 → 3 → 4 → 5 → 6 → 7 | sequential; the code is given in full (rev 2, verified by a dry run) | `node --test` green; orchestrator reads every file |
| A2: Mechanics | 7A → 7B → 7C → 7D → 7E | sequential (they share `world.js`, `player.js`, `stageRunner.js`, `play.js`) | `node --test` green; orchestrator reads every diff |
| B: Content | 8, 9, 9B, 10–14, 15–18, 19, 20, 21, 21A, 21B, 21C | parallel, one agent per task; agents touch only their **Files** | each task's own test green; reviewer pass per task; then the full suite green |
| C: Integration | 22 → 23 → 24 | sequential | sim green + balance log; build test green; browser QA clean |

**Phase B dependencies** (start a task only after the listed tasks finish):

| Task | Waits for | Why |
|---|---|---|
| 15 | 10 | loads `syntaxError` at test time |
| 16 | 13 | loads `memoryLeak` at test time |
| 18 | 11 | loads `nullPointer` at test time |
| 21C | 8 | glyph lint needs the font |
| 9B | 9 | uses `CB.Audio.context()` and `output()` |

All other Phase B tasks are independent, and agents never write each other's files. Tasks 19–21, 21A and 21B stub `CB.Font` when `src/art/font.js` is absent, and they guard every call into `CB.Quips`, `CB.Unlocks`, `CB.Compact`, `CB.Pickups`, `CB.Music`, `CB.Fx.pose` and `CB.Fx.drawUnder`.

**Phase B file ownership:**
- `player.js` belongs to Task 21A.
- `fx.js` belongs to Task 21B.
- `projectiles.js` and `play.js` are frozen after Phase A2.
- If a Phase B task needs a change in a file it doesn't own, it reports that instead of editing.

## Cross-Task Contracts (read by every implementer)

### InputState (one per simulation tick)

```js
{ moveX: -1..1, moveY: -1..1,       // WASD/arrows, not normalised (player normalises)
  aimX, aimY,                        // internal px (may be outside 0..320/0..180)
  fire: bool,                        // left mouse held
  dash: bool,                        // Space/Shift/right-click pressed this tick (edge)
  pause: bool, mute: bool,           // Esc|P, M pressed this tick (edge)
  confirm: bool,                     // left click or Enter pressed this tick (edge)
  choice: 0|1|2|3,                   // digit 1..3 pressed this tick (edge), else 0
  retry: bool, quit: bool,           // R, Q pressed this tick (edge)
  compact: bool, music: bool,        // E (cast /compact), N (toggle music) pressed this tick (edge)
  keys: string[] }                   // KeyboardEvent.code of every key pressed this tick (secrets), max 16
```

### Enemy entity (plain object, created only via `CB.makeEnemy`)

```js
{ kind, x, y, r, vx, vy, hp, maxHp, t, state, stateT,
  targetable,   // player bolts damage it
  solid,        // player bolts are absorbed by it even when not targetable
  contact,      // touching the player costs a heart
  visible,      // false = not drawn, ignored by all collision
  hitFlash, invuln, dead,
  boss,         // part of a boss (excluded from wave counts)
  regular,      // counts toward a wave's alive total (default true; boss parts false)
  noContactT,   // > 0: no contact damage yet (spawn grace 0.3 s regulars, 0.5 s boss parts)
  elite, timeScale,   // P0 elites: x1.75 hp, update dt x timeScale (Task 7C)
  z,            // optional draw order key (default y); boss heads draw on top
  facing, alpha, data }
```

`world.step` increments `t` and `stateT` and decrements `hitFlash`/`invuln` before calling the module's `update`. Change state with `CB.setState(e, 'name')`, which resets `stateT`.

### Enemy module

```js
CB.Enemies[kind] = {
  create(world, x, y, opts) → entity,     // must return CB.makeEnemy(kind, x, y, {...})
  update(e, world, dt),
  draw(e, r, t),
  onHit(e, world, dmg, src) → number,     // optional; default subtracts dmg from e.hp
  onDeath(e, world),                      // optional; called once from world.killEnemy
}
```

### Boss module and controller

```js
CB.Bosses[id] = { id, name, tagline, commitMsg, file, diff: [2–4 lines], portrait: spriteName, deathPoints(controller) → [{x, y}], create(world) → controller };
controller = { id, x, y, hp, maxHp, phase, defeated, update(world, dt), draw(r, t) };
```

- `create` spawns the boss's part entities with `boss: true, regular: false`.
- The controller keeps `hp`, `x`, `y`, `phase` current every tick and sets `defeated = true` exactly once.
- `draw` renders overlays only (beams, banners, telegraph lines). Parts draw themselves through their enemy module.
- Once `defeated` is true, `world.step` never calls `update` and `WorldDraw` never calls `draw` again. The update that sets `defeated` also sets `hp = 0`, kills remaining parts silently and clears overlay state.
- See the Tasks 15–18 rules for thresholds (strict `<`, latched), safe spawn, periodic timers starting full, and `vx`/`vy` publishing.

### World events (`world.emit(type, data)`)

Every event has `type` and **must** carry finite `x`, `y`, except `patchPick`, `uiSelect`, `victory` and `unlock`, which come from the run or scenes and are audio-only.

| Event | Fields | Meaning |
|---|---|---|
| `shoot` | `angle` | the player fired |
| `hit` | `kind`, `boss` | an enemy took damage |
| `clink` | | a bolt was absorbed by a solid or invulnerable target |
| `enemyDie` | `kind`, `r`, `boss`, `silent` | an enemy died; `silent` kills (boss clear-out, sheds, blob landings) get no burst, decal or sound |
| `spawn` | `kind` | a spawn telegraph resolved |
| `playerHurt` | `god` | the player lost a heart (or would have, in god mode) |
| `playerDie` | | the player died |
| `dash` | | the player dashed |
| `bounce` | | a ricochet bolt bounced |
| `enemyShoot` | | an enemy fired (audio throttles it) |
| `bossPhase` | `phase` | a boss changed phase |
| `bossDie` | | a boss was defeated |
| `teleport` | `x2`, `y2` | something teleported |
| `beamCharge` / `beam` | `x1`, `y1`, `x2`, `y2` | Merge Conflict beam telegraph / fire |
| `lob` / `splat` | | Memory Leak blob thrown / landed |
| `text` | `text`, `color` | generic floating text |
| `revive` | | a Merge Conflict twin revived |
| `heartbeat` | | the player is at 1 heart (every 0.85 s) |
| `compact` / `compactReady` | | /compact cast / meter just filled |
| `graze` | `perfect` | an enemy bullet grazed (perfect = dashed through) |
| `pickup` | `heal` | a hotfix was collected |
| `blast` | | one chained finale explosion (emitted from `Fx.update`) |
| `bossWarn` | | the boss warning card started (run → audio) |
| `victory` | | the run entered `victory` (run → unlocks/audio) |
| `unlock` | | something was unlocked (scene → audio) |
| `patchPick` | `id` | emitted by the run, not the world |
| `uiSelect` | | emitted by scenes |

### Renderer `r` (Task 5). Content modules may only use these methods.

| Method | What it does |
|---|---|
| `r.ctx` | raw 2D context of the 320×180 buffer |
| `r.clear(color)` | fill the whole buffer |
| `r.rect(x, y, w, h, color)` | filled rectangle |
| `r.frame(x, y, w, h, color)` | 1 px outline |
| `r.disc(cx, cy, radius, color)` | filled pixel circle |
| `r.ring(cx, cy, radius, color)` | 1 px pixel circle outline |
| `r.line(x1, y1, x2, y2, color)` | 1 px Bresenham line |
| `r.sprite(name, cx, cy, opts)` | sprite drawn centred; `opts = { flip, white, alpha, scale, flipY }` |
| `r.text(str, x, y, opts)` | `opts = { color = '#FFFFFF', align = 'left', scale = 1, shadow = null, alpha = 1 }`; `y` is the top of the 7 px glyph cell; `align` is `left`, `center` or `right` |
| `r.measure(str, scale)` | text width in px |
| `r.alpha(a, fn)` | run `fn` with `globalAlpha = a` |
| `r.shaken(dx, dy, fn)` | run `fn` with a translation |
| `r.squash(ax, ay, sx, sy, fn)` | run `fn` scaled by (sx, sy) around anchor (ax, ay) |

All coordinates are rounded to whole pixels inside the renderer.

### Run (Task 4; rev 2 extras from Task 7D)

`CB.createRun({ seed = 1, startStage = 0, patches = {}, god = false, skipWaves = false })` returns:
- `run.step(input)`, which returns this tick's events array.
- `run.state`, one of `stageIntro | wave | waveBreak | bossWarn | boss | bossDead | patchPick | dying | dead | victory`.
- State fields: `run.stateT`, `run.stageIndex`, `run.waveIndex`, `run.world`, `run.patches` (counts object, e.g. `{spread: 1}`), `run.history` (patch ids in pick order), `run.offer` (3 ids during `patchPick`), `run.time`, `run.deaths`, `run.spawner`.
- `run.choosePatch(i)` → bool.
- Rev 2 fields: `run.bossRush`, `run.yolo`, `run.squashed` (kills by kind), `run.bossesFixed`, `run.maxChain`, and `run.diedInBoss` (true when the last death was in a boss fight, so retry resumes at `bossWarn`).

### World additions (rev 2)
- `w.hurtPlayer(src)`, `w.mode = { yolo }`, `w.flashColor`, `w.glitchT`, `w.fxQueue` (Task 21B).
- `w.context { value, max, announced }`, `w.chain { n, t, mul }`, `w.grazeTokens`, `w.compactWave`, `w.compactBannerT` (Task 7B).
- `w.pickups` (Task 7C).
- `w.stats` gains `maxChain`, `compacts`, `grazes`.
- `run.retryStage()` → bool.

---

## Phase A — Foundation (sequential; the full code is given here)

### Task 1: Scaffold, namespace, math, RNG, test harness

**Files:**
- Create: `package.json`, `.gitignore`, `index.html`, `src/core/ns.js`, `src/core/math.js`, `src/core/rng.js`, `tests/harness.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Produces:
  - `CB.W = 320`, `CB.H = 180`, `CB.DT = 1/60`, `CB.ARENA`.
  - `CB.Enemies`, `CB.Bosses`, `CB.Scenes`, `CB.Screens` as empty registries.
  - `CB.M` with these functions:

    | Group | Functions |
    |---|---|
    | General | `clamp`, `lerp`, `dist2`, `dist`, `len`, `norm`, `angleTo`, `wrapAngle`, `approach`, `isFiniteNum` |
    | Collision | `circleHit`, `segDist2`, `circleSegment` |
    | Arena | `clampToArena(e, arena?)`, `inArena(x, y, margin?, arena?)` |

  - `CB.createRng(seed)` returning `{next, range, int, chance, pick, angle, shuffle}`.
  - Harness exports: `load(files, opts)`, `loadWith(...extra)`, `scriptList()`, `GAME_BASE`, `CORE`, `makeInput(over)`, `plain(v)`.

- [ ] **Step 1: Create `package.json` and `.gitignore`**

```json
{
  "name": "clawd-vs-bugs",
  "version": "1.0.0",
  "private": true,
  "description": "Top-down pixel boss rush: Clawd vs software bugs.",
  "scripts": {
    "test": "node --test tests/",
    "build": "node tools/build-artifact.mjs",
    "serve": "python3 -m http.server 8137"
  },
  "engines": { "node": ">=20" }
}
```

```
dist/
.DS_Store
node_modules/
```

- [ ] **Step 2: Create `index.html` (final script order; files that don't exist yet will 404 harmlessly until their task lands)**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Clawd vs Bugs</title>
<style>
  :root { color-scheme: dark; --bg: #0B0B10; --fg: #E8E6F0; --muted: #8C8AA0; --accent: #D97757; }
  html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); overflow: hidden; }
  body { font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  #game { display: block; width: 100%; height: 100%; cursor: none; touch-action: none; image-rendering: pixelated; }
  #game:focus { outline: none; }
  noscript { position: absolute; inset: 0; display: grid; place-items: center; padding-inline: 16px; color: var(--fg); }
</style>
</head>
<body>
<canvas id="game" tabindex="0" aria-label="Clawd vs Bugs game screen"></canvas>
<noscript>Clawd vs Bugs needs JavaScript to run.</noscript>
<script src="src/core/ns.js"></script>
<script src="src/core/math.js"></script>
<script src="src/core/rng.js"></script>
<script src="src/art/palette.js"></script>
<script src="src/art/font.js"></script>
<script src="src/art/sprites.js"></script>
<script src="src/art/render.js"></script>
<script src="src/core/input.js"></script>
<script src="src/core/audio.js"></script>
<script src="src/core/loop.js"></script>
<script src="src/game/world.js"></script>
<script src="src/game/projectiles.js"></script>
<script src="src/game/patches.js"></script>
<script src="src/game/player.js"></script>
<script src="src/game/fx.js"></script>
<script src="src/game/enemies/syntaxError.js"></script>
<script src="src/game/enemies/nullPointer.js"></script>
<script src="src/game/enemies/raceCondition.js"></script>
<script src="src/game/enemies/memoryLeak.js"></script>
<script src="src/game/enemies/offByOne.js"></script>
<script src="src/game/bosses/infiniteLoop.js"></script>
<script src="src/game/bosses/memoryLeakBoss.js"></script>
<script src="src/game/bosses/mergeConflict.js"></script>
<script src="src/game/bosses/heisenbug.js"></script>
<script src="src/game/stages.js"></script>
<script src="src/game/waves.js"></script>
<script src="src/game/stageRunner.js"></script>
<script src="src/art/arena.js"></script>
<script src="src/art/worldDraw.js"></script>
<script src="src/scenes/hud.js"></script>
<script src="src/scenes/screens.js"></script>
<script src="src/scenes/patchPick.js"></script>
<script src="src/scenes/gameOver.js"></script>
<script src="src/scenes/victory.js"></script>
<script src="src/scenes/panic.js"></script>
<script src="src/scenes/title.js"></script>
<script src="src/scenes/play.js"></script>
<script src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `src/core/ns.js`**

```js
// Creates the global CB namespace. Every other script attaches to it.
(function (root) {
  'use strict';
  const CB = root.CB || {};
  CB.Enemies = CB.Enemies || {};
  CB.Bosses = CB.Bosses || {};
  CB.Scenes = CB.Scenes || {};
  CB.Screens = CB.Screens || {};
  CB.W = 320;
  CB.H = 180;
  CB.DT = 1 / 60;
  CB.ARENA = Object.freeze({ x: 8, y: 20, w: 304, h: 152 });
  root.CB = CB;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Create `src/core/math.js`**

```js
// Small vector, angle and collision helpers shared by logic and drawing.
(function (CB) {
  'use strict';
  const M = {
    clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist2: (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay),
    dist: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay),
    len: (x, y) => Math.hypot(x, y),
    norm(x, y) {
      const l = Math.hypot(x, y);
      return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
    },
    angleTo: (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax),
    wrapAngle(a) {
      while (a > Math.PI) a -= 2 * Math.PI;
      while (a < -Math.PI) a += 2 * Math.PI;
      return a;
    },
    approach: (v, target, delta) => (v < target ? Math.min(v + delta, target) : Math.max(v - delta, target)),
    circleHit: (ax, ay, ar, bx, by, br) => M.dist2(ax, ay, bx, by) <= (ar + br) * (ar + br),
    segDist2(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x1 + t * dx;
      const cy = y1 + t * dy;
      return (px - cx) * (px - cx) + (py - cy) * (py - cy);
    },
    circleSegment: (cx, cy, r, x1, y1, x2, y2) => M.segDist2(cx, cy, x1, y1, x2, y2) <= r * r,
    clampToArena(e, arena) {
      const a = arena || CB.ARENA;
      e.x = M.clamp(e.x, a.x + e.r, a.x + a.w - e.r);
      e.y = M.clamp(e.y, a.y + e.r, a.y + a.h - e.r);
      return e;
    },
    inArena(x, y, margin, arena) {
      const a = arena || CB.ARENA;
      const m = margin || 0;
      return x >= a.x - m && x <= a.x + a.w + m && y >= a.y - m && y <= a.y + a.h + m;
    },
    isFiniteNum: (v) => typeof v === 'number' && Number.isFinite(v),
  };
  CB.M = M;
})(window.CB);
```

- [ ] **Step 5: Create `src/core/rng.js`**

```js
// Seeded mulberry32 RNG. All game logic randomness goes through one of these.
(function (CB) {
  'use strict';
  CB.createRng = function (seed) {
    let s = seed >>> 0 || 0x6d2b79f5;
    const rng = {
      next() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: (a, b) => a + (b - a) * rng.next(),
      int: (a, b) => a + Math.floor(rng.next() * (b - a + 1)),
      chance: (p) => rng.next() < p,
      pick: (arr) => arr[Math.floor(rng.next() * arr.length)],
      angle: () => rng.next() * Math.PI * 2,
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1));
          const tmp = a[i];
          a[i] = a[j];
          a[j] = tmp;
        }
        return a;
      },
    };
    return rng;
  };
})(window.CB);
```

- [ ] **Step 6: Create `tests/harness.js`**

```js
'use strict';
// Loads game scripts into a node:vm sandbox with DOM/canvas stubs.
// Objects returned from the sandbox come from another realm: compare them
// with assert.deepEqual or plain(), never assert.deepStrictEqual.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"\s*><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function makeCtx2d() {
  // Real defaults for state the renderer reads back (so headless draw smoke tests stay numeric).
  const target = {
    canvas: null,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px monospace',
    textAlign: 'left',
    textBaseline: 'top',
    measureText: (s) => ({ width: String(s).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
}

function makeCanvas() {
  const c = {
    width: 300,
    height: 150,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }),
  };
  const ctx = makeCtx2d();
  ctx.canvas = c;
  c.getContext = () => ctx;
  return c;
}

function makeSandbox() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    CB_NO_BOOT: true,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { hash: '', reload() {} },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: 'node' },
    document: {
      readyState: 'complete',
      hidden: false,
      createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild() {}, addEventListener() {} }),
      getElementById: () => makeCanvas(),
      querySelector: () => null,
      addEventListener() {},
      removeEventListener() {},
      body: { appendChild() {}, classList: { add() {}, remove() {} } },
    },
  };
  sandbox.window = sandbox;
  return sandbox;
}

function load(files, opts) {
  const o = opts || {};
  const list = files || scriptList();
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  if (!o.allowRandom) {
    vm.runInContext(
      'Math.random = function () { throw new Error("Math.random() is not allowed in game logic; use world.rng / world.fxRng"); };',
      sandbox
    );
  }
  for (const f of list) {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  if (o.returnSandbox) return { CB: sandbox.CB, sandbox };
  return sandbox.CB;
}

// Logic never needs the font, so it is not part of CORE (render tests load it explicitly).
const CORE = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js'];
const GAME_BASE = [...CORE, 'src/game/world.js', 'src/game/projectiles.js', 'src/game/patches.js', 'src/game/player.js', 'src/game/fx.js'];

function loadWith(...extra) {
  return load([...GAME_BASE, ...extra]);
}

function makeInput(over) {
  return Object.assign(
    { moveX: 0, moveY: 0, aimX: 160, aimY: 40, fire: false, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false },
    over || {}
  );
}

function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

// Steps a world n fixed ticks. `input` may be an object or a function(i) → object.
function stepN(world, n, input) {
  for (let i = 0; i < n; i++) {
    const inp = typeof input === 'function' ? input(i) : input || makeInput();
    world.step(1 / 60, inp);
  }
}

module.exports = { ROOT, scriptList, load, loadWith, CORE, GAME_BASE, makeInput, plain, stepN };
```

- [ ] **Step 7: Write the failing tests `tests/core.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js'];

test('ns: constants and registries exist', () => {
  const CB = H.load(FILES);
  assert.equal(CB.W, 320);
  assert.equal(CB.H, 180);
  assert.ok(Math.abs(CB.DT - 1 / 60) < 1e-12);
  assert.deepEqual(H.plain(CB.ARENA), { x: 8, y: 20, w: 304, h: 152 });
  for (const k of ['Enemies', 'Bosses', 'Scenes', 'Screens']) assert.equal(typeof CB[k], 'object');
});

test('math: norm, clamp, circleHit, circleSegment', () => {
  const { M } = H.load(FILES);
  const n = M.norm(3, 4);
  assert.ok(Math.abs(n.x - 0.6) < 1e-9 && Math.abs(n.y - 0.8) < 1e-9);
  assert.deepEqual(H.plain(M.norm(0, 0)), { x: 0, y: 0 });
  assert.equal(M.clamp(5, 0, 3), 3);
  assert.equal(M.clamp(-1, 0, 3), 0);
  assert.equal(M.circleHit(0, 0, 2, 3, 0, 1), true);
  assert.equal(M.circleHit(0, 0, 2, 3.1, 0, 1), false);
  assert.equal(M.circleSegment(5, 2, 2, 0, 0, 10, 0), true);
  assert.equal(M.circleSegment(5, 3, 2, 0, 0, 10, 0), false);
  assert.equal(M.circleSegment(12, 0, 1.5, 0, 0, 10, 0), false);
  assert.ok(Math.abs(M.wrapAngle(3 * Math.PI) - Math.PI) < 1e-9);
  assert.equal(M.approach(0, 10, 3), 3);
  assert.equal(M.approach(9, 10, 3), 10);
});

test('math: clampToArena keeps the circle inside', () => {
  const CB = H.load(FILES);
  const e = { x: -50, y: 999, r: 5 };
  CB.M.clampToArena(e);
  assert.equal(e.x, 13);
  assert.equal(e.y, 167);
});

test('rng: same seed gives same sequence; ranges stay in bounds', () => {
  const CB = H.load(FILES);
  const a = CB.createRng(42);
  const b = CB.createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const r = CB.createRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(2, 5);
    assert.ok(v >= 2 && v <= 5 && Number.isInteger(v));
    const f = r.range(-1, 1);
    assert.ok(f >= -1 && f < 1);
  }
  assert.notEqual(CB.createRng(1).next(), CB.createRng(2).next());
  const sh = r.shuffle([1, 2, 3, 4, 5]);
  assert.deepEqual(H.plain(sh).sort(), [1, 2, 3, 4, 5]);
});

test('harness: Math.random is poisoned inside the sandbox unless allowed', () => {
  const vm = require('vm');
  const probe = '(() => { try { Math.random(); return "ok"; } catch (e) { return "threw"; } })()';
  const strict = H.load(FILES, { returnSandbox: true });
  assert.equal(vm.runInContext(probe, strict.sandbox), 'threw');
  const loose = H.load(FILES, { returnSandbox: true, allowRandom: true });
  assert.equal(vm.runInContext(probe, loose.sandbox), 'ok');
});

test('harness: scriptList parses index.html in order', () => {
  const list = H.scriptList();
  assert.equal(list[0], 'src/core/ns.js');
  assert.equal(list[list.length - 1], 'src/main.js');
  assert.ok(list.length >= 38);
});
```

- [ ] **Step 8: Run tests, then implement until green**

Run: `node --test tests/core.test.js`
Expected: all PASS. If a test fails before its file exists it fails with ENOENT. Create the files from Steps 3–6 and re-run.

- [ ] **Step 9: Commit (orchestrator)**

```bash
git add package.json .gitignore index.html src/core tests/harness.js tests/core.test.js
git commit -m "feat: scaffold namespace, math, rng and vm test harness"
```

### Task 2: Palette and sprite registry

**Files:**
- Create: `src/art/palette.js`, `src/art/sprites.js`
- Test: `tests/art.test.js`

**Interfaces:**
- Consumes: `CB` from Task 1.
- Produces:
  - `CB.Pal = { C, CHARS, STAGES }`. `C` holds named hex colours. `CHARS` maps a single sprite character to a hex colour, or `null` for transparent `.`. `STAGES[paletteId] = { floor, floorLine, wall, wallHi, wallLo, lineNo, accent, code: [5 hex], pulse? }`.
  - `CB.Art = { defineSprite(name, rows, pal?), hasSprite(name), spriteDef(name) → {name, rows, w, h, pal}, sprite(name) → baked {w, h, normal, flip, white, whiteFlip}, spriteNames() }`.
  - `defineSprite` validates eagerly and works headless. `sprite()` bakes lazily, browser only.

- [ ] **Step 1: Write the failing test `tests/art.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/palette.js', 'src/art/sprites.js'];

test('palette: every sprite char maps to null or a #RRGGBB colour', () => {
  const CB = H.load(FILES);
  for (const [ch, col] of Object.entries(CB.Pal.CHARS)) {
    assert.equal(ch.length, 1, `char key ${ch}`);
    if (ch === '.') assert.equal(col, null);
    else assert.match(col, /^#[0-9A-Fa-f]{6}$/, `char ${ch}`);
  }
});

test('palette: four stage palettes with five code colours each', () => {
  const CB = H.load(FILES);
  for (const id of ['src', 'node_modules', 'git', 'prod']) {
    const p = CB.Pal.STAGES[id];
    assert.ok(p, id);
    for (const k of ['floor', 'floorLine', 'wall', 'wallHi', 'wallLo', 'lineNo', 'accent']) assert.match(p[k], /^#[0-9A-Fa-f]{6}$/, `${id}.${k}`);
    assert.equal(p.code.length, 5);
  }
  assert.equal(CB.Pal.STAGES.prod.pulse, true);
});

test('sprites: define validates width and palette chars', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_ok', ['.o.', 'ooo']);
  assert.equal(CB.Art.hasSprite('t_ok'), true);
  const d = CB.Art.spriteDef('t_ok');
  assert.equal(d.w, 3);
  assert.equal(d.h, 2);
  assert.throws(() => CB.Art.defineSprite('t_ragged', ['..', '...']), /ragged/);
  assert.throws(() => CB.Art.defineSprite('t_badchar', ['.Q.']), /unknown palette char/);
  assert.throws(() => CB.Art.defineSprite('t_empty', []), /non-empty/);
});

test('sprites: custom palette per sprite', () => {
  const CB = H.load(FILES);
  CB.Art.defineSprite('t_custom', ['ab'], { a: '#000000', b: null });
  assert.equal(CB.Art.spriteDef('t_custom').pal.a, '#000000');
});
```

- [ ] **Step 2: Run to verify failure.** Run `node --test tests/art.test.js`. Expected: FAIL (ENOENT for `src/art/palette.js`).

- [ ] **Step 3: Create `src/art/palette.js`**

```js
// Named colours, the single-character sprite palette, and per-stage arena palettes.
(function (CB) {
  'use strict';
  const C = {
    clawd: '#D97757', clawdDark: '#A8513A', clawdLight: '#F2A07E',
    ink: '#14121A', white: '#FFFFFF', offwhite: '#E8E6F0',
    red: '#E0484D', redDark: '#8C2233', yellow: '#F2C94C', yellowDark: '#A37B12',
    green: '#5DBB63', greenDark: '#2C6B35', blue: '#4F8CE0', blueDark: '#23477E',
    purple: '#9A6BE0', purpleDark: '#4B2D7A', cyan: '#5FD4E0', cyanDark: '#2A7F8A',
    magenta: '#E055B0', magentaDark: '#7A2463', grey: '#9AA3B5', greyDark: '#4A5163',
    slate: '#2A2E3A', pale: '#C8CEDC', bullet: '#FF4F8B', bulletCore: '#FFE3EE', spark: '#FFB38A',
    gold: '#FFD27A', ember: '#FF8A5C', hurt: '#FF3355',
  };
  const CHARS = {
    '.': null,
    o: C.clawd, O: C.clawdDark, h: C.clawdLight,
    k: C.ink, w: C.white, W: C.offwhite,
    r: C.red, R: C.redDark, y: C.yellow, Y: C.yellowDark,
    g: C.green, G: C.greenDark, b: C.blue, B: C.blueDark,
    p: C.purple, P: C.purpleDark, c: C.cyan, C: C.cyanDark,
    m: C.magenta, M: C.magentaDark, s: C.grey, S: C.greyDark,
    d: C.slate, e: C.pale, x: C.bullet, X: C.bulletCore, z: C.spark,
    q: C.gold, f: C.ember,
  };
  const STAGES = {
    src: { floor: '#151922', floorLine: '#1A1F2A', wall: '#2B374B', wallHi: '#4A5D7C', wallLo: '#1C2433', lineNo: '#3D4A61', accent: '#7FA7D9', code: ['#2C4266', '#4A3557', '#2C5244', '#5A4A2C', '#284E5A'] },
    node_modules: { floor: '#131A15', floorLine: '#18211A', wall: '#2C4A2E', wallHi: '#4F7A4A', wallLo: '#1A2C1C', lineNo: '#3B5A3C', accent: '#8BCF6A', code: ['#2F5230', '#4D5A2A', '#2A4A44', '#5A3F2C', '#3A3A5A'] },
    git: { floor: '#17131F', floorLine: '#1D1827', wall: '#3B2C55', wallHi: '#6A4C93', wallLo: '#231A33', lineNo: '#4D3D66', accent: '#B78CF0', code: ['#3E2E66', '#5A2E4F', '#2E4A5A', '#4F4A2C', '#2E5A3E'] },
    prod: { floor: '#1C1214', floorLine: '#231618', wall: '#55232A', wallHi: '#9C3A44', wallLo: '#33151A', lineNo: '#6A3A40', accent: '#FF6B6B', pulse: true, code: ['#5A2A2E', '#5A452A', '#4A2A4A', '#2E3A5A', '#5A2A44'] },
  };
  CB.Pal = { C, CHARS, STAGES };
})(window.CB);
```

- [ ] **Step 4: Create `src/art/sprites.js`**

```js
// Sprite registry: sprites are arrays of equal-length strings, one palette char per pixel.
// defineSprite validates immediately (headless-safe); sprite() bakes canvases lazily (browser only).
(function (CB) {
  'use strict';
  const defs = Object.create(null);
  const baked = Object.create(null);

  function defineSprite(name, rows, pal) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`sprite ${name}: rows must be a non-empty array`);
    const w = rows[0].length;
    const p = pal || CB.Pal.CHARS;
    for (const row of rows) {
      if (row.length !== w) throw new Error(`sprite ${name}: ragged row "${row}" (expected width ${w})`);
      for (const ch of row) if (!(ch in p)) throw new Error(`sprite ${name}: unknown palette char "${ch}"`);
    }
    defs[name] = { name, rows, w, h: rows.length, pal: p };
    delete baked[name];
  }

  function bake(name) {
    const d = defs[name];
    if (!d) throw new Error(`unknown sprite ${name}`);
    const make = () => {
      const c = document.createElement('canvas');
      c.width = d.w;
      c.height = d.h;
      return c;
    };
    const normal = make();
    const flip = make();
    const white = make();
    const whiteFlip = make();
    const cn = normal.getContext('2d');
    const cf = flip.getContext('2d');
    const cw = white.getContext('2d');
    const cwf = whiteFlip.getContext('2d');
    cw.fillStyle = '#FFFFFF';
    cwf.fillStyle = '#FFFFFF';
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const col = d.pal[d.rows[y][x]];
        if (!col) continue;
        cn.fillStyle = col;
        cn.fillRect(x, y, 1, 1);
        cf.fillStyle = col;
        cf.fillRect(d.w - 1 - x, y, 1, 1);
        cw.fillRect(x, y, 1, 1);
        cwf.fillRect(d.w - 1 - x, y, 1, 1);
      }
    }
    baked[name] = { w: d.w, h: d.h, normal, flip, white, whiteFlip };
    return baked[name];
  }

  CB.Art = {
    defineSprite,
    hasSprite: (name) => name in defs,
    spriteDef: (name) => defs[name],
    sprite: (name) => baked[name] || bake(name),
    spriteNames: () => Object.keys(defs),
  };
})(window.CB);
```

- [ ] **Step 5: Run the tests.** Run `node --test tests/art.test.js`. Expected: 4 PASS.

- [ ] **Step 6: Commit (orchestrator).** `git add src/art/palette.js src/art/sprites.js tests/art.test.js && git commit -m "feat: palette and validated sprite registry"`

---

### Task 3: World core (world, projectiles, patches, player, fx)

These five files depend on each other at runtime (`createWorld` creates the player, `step` drives projectiles and fx), so they land together.

**Files:**
- Create: `src/game/world.js`, `src/game/projectiles.js`, `src/game/patches.js`, `src/game/player.js`, `src/game/fx.js`
- Test: `tests/world.test.js`, `tests/player.test.js`, `tests/patches.test.js`

**Interfaces:**
- Consumes: `CB.M`, `CB.createRng`, `CB.Pal`, `CB.Art.defineSprite`.
- Produces:
  - **world.js:**
    - `CB.CAPS = {enemies: 60, eBullets: 400, pBullets: 120, fx: 500}`, `CB.SPAWN_TELEGRAPH = 0.6`.
    - `CB.makeEnemy(kind, x, y, props) → entity` and `CB.setState(e, state)`.
    - `CB.createWorld({seed, stage, god, patches}) → world`, exposing:

      | Area | Members |
      |---|---|
      | State | `seed`, `rng`, `fxRng`, `time`, `arena`, `stage`, `god`, `player`, `enemies`, `pBullets`, `eBullets`, `hazards`, `fx`, `spawns`, `boss`, `events`, `shake`, `hitstop`, `flash`, `stats{wouldHits, shots, kills, damageDealt}` |
      | Spawning | `spawnEnemy(kind, x, y, opts)`, `queueSpawn(kind, x, y, opts, delay?)`, `regularAlive()`, `edgePoint(minDist = 60)`, `randomPoint(margin = 16, minDist = 0)` |
      | Firing | `fireEnemyBullet(x, y, angle, speed = 80, {r, life, color, spin, accel})`, `firePlayerBolt(x, y, angle)` |
      | Damage | `damageEnemy(e, dmg, src) → applied`, `killEnemy(e, silent?)`, `killAllEnemies()` |
      | Other | `clearEnemyBullets()`, `addHazard({kind, x, y, r = 12, life = 6, slow = 0.5})`, `emit(type, data)`, `addShake(n)`, `step(dt, input)` |

  - **projectiles.js:** `CB.Projectiles = { update(w, dt), draw(w, r, t) }`, plus sprites `bolt`, `bolt_big`, `ebullet`.
  - **patches.js:** `CB.Patches = { DEFS, ORDER, BASE, computeStats(counts) → stats, offer(rng, counts, n = 3) → ids, apply(counts, id) → newCounts }`.
    - `stats = { fireCooldown, boltSpeed, boltR, dmg, spread, pierce, bounces, dashCooldown, maxHearts }`.
  - **player.js:** `CB.Player = { SPEED: 80, DASH_SPEED: 260, DASH_TIME: 0.15, DASH_INVULN: 0.25, HURT_INVULN: 1.0, create(w, patches), update(p, w, dt, input), fire(p, w), hurt(p, w, src) → bool, canBeHit(p), draw(p, r, t) }`.
    - Player object: `{ x, y, r: 5, vx, vy, hearts, stats, facing, aimX, aimY, fireCd, dashCd, dashT, dashDX, dashDY, invuln, hurtT, dead, slow, moving, walkT, t, trail }`.
    - Sprites: `clawd_idle0`, `clawd_idle1`, `clawd_walk0`, `clawd_walk2`, `clawd_blink`.
  - **fx.js:** `CB.Fx = { consume(w, fromIndex), update(w, dt), draw(w, r, t), spark(w, x, y, color, n, speed, life), text(w, x, y, str, color, life), ring(w, x, y, r0, r1, color, life) }`.

- [ ] **Step 1: Write the failing tests `tests/patches.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/game/patches.js'];

test('patches: base stats', () => {
  const CB = H.load(FILES);
  const s = CB.Patches.computeStats({});
  assert.deepEqual(H.plain(s), { fireCooldown: 0.2, boltSpeed: 200, boltR: 2, dmg: 1, spread: 0, pierce: 0, bounces: 0, dashCooldown: 0.8, maxHearts: 5 });
});

test('patches: each patch effect matches the spec table', () => {
  const CB = H.load(FILES);
  const S = (c) => CB.Patches.computeStats(c);
  assert.equal(S({ spread: 2 }).spread, 2);
  assert.ok(Math.abs(S({ rapid: 1 }).fireCooldown - 0.14) < 1e-9);
  assert.ok(Math.abs(S({ rapid: 2 }).fireCooldown - 0.098) < 1e-9);
  assert.equal(S({ pierce: 2 }).pierce, 2);
  assert.equal(S({ heavy: 1 }).dmg, 1.5);
  assert.equal(S({ heavy: 2 }).dmg, 2);
  assert.equal(S({ heavy: 2 }).boltR, 4);
  assert.equal(S({ heart: 2 }).maxHearts, 7);
  assert.equal(S({ dash: 1 }).dashCooldown, 0.45);
  assert.equal(S({ ricochet: 1 }).bounces, 1);
  assert.equal(S({ spread: 9 }).spread, 2, 'counts above max are clamped');
});

test('patches: apply increments and refuses past max', () => {
  const CB = H.load(FILES);
  let c = CB.Patches.apply({}, 'dash');
  assert.equal(c.dash, 1);
  assert.throws(() => CB.Patches.apply(c, 'dash'), /max/);
  assert.throws(() => CB.Patches.apply({}, 'nope'), /unknown patch/);
  c = CB.Patches.apply(CB.Patches.apply({}, 'spread'), 'spread');
  assert.equal(c.spread, 2);
});

test('patches: offer returns 3 distinct non-maxed ids, deterministically', () => {
  const CB = H.load(FILES);
  const owned = { dash: 1, ricochet: 1, spread: 2 };
  for (let seed = 1; seed < 50; seed++) {
    const ids = H.plain(CB.Patches.offer(CB.createRng(seed), owned, 3));
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) assert.ok(!['dash', 'ricochet', 'spread'].includes(id), id);
  }
  assert.deepEqual(H.plain(CB.Patches.offer(CB.createRng(9), {}, 3)), H.plain(CB.Patches.offer(CB.createRng(9), {}, 3)));
});

test('patches: offer returns fewer when few remain', () => {
  const CB = H.load(FILES);
  const owned = { spread: 2, rapid: 2, pierce: 2, heavy: 2, heart: 2, dash: 1 };
  assert.deepEqual(H.plain(CB.Patches.offer(CB.createRng(1), owned, 3)), ['ricochet']);
});
```

- [ ] **Step 2: Write the failing tests `tests/world.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(props) {
  const CB = H.loadWith();
  CB.Enemies.dummy = {
    create: (w, x, y, o) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 3, r: 5 }, props || {}, o || {})),
    update() {},
    draw() {},
  };
  const w = CB.createWorld({ seed: 1 });
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const types = (w) => w.events.map((e) => e.type);

test('world: player starts below arena centre with full hearts', () => {
  const { w } = setup();
  assert.equal(w.player.x, 160);
  assert.equal(w.player.y, 126);
  assert.equal(w.player.hearts, 5);
});

test('world: makeEnemy defaults and maxHp', () => {
  const { CB } = setup();
  const e = CB.makeEnemy('k', 1, 2, { hp: 7 });
  assert.equal(e.maxHp, 7);
  assert.equal(e.targetable, true);
  assert.equal(e.solid, false);
  assert.equal(e.contact, true);
  assert.equal(e.visible, true);
  assert.equal(e.regular, true);
  assert.equal(e.boss, false);
  assert.equal(CB.makeEnemy('k', 0, 0, { hp: 7, maxHp: 10 }).maxHp, 10);
});

test('world: queueSpawn telegraphs 0.6 s before the enemy exists', () => {
  const { w } = setup();
  w.queueSpawn('dummy', 60, 60);
  H.stepN(w, 30, idle);
  assert.equal(w.enemies.length, 0);
  H.stepN(w, 10, idle);
  assert.equal(w.enemies.length, 1);
  assert.ok(types(w).includes('spawn'));
  assert.equal(w.spawns.length, 0);
});

test('world: a bolt damages a targetable enemy and dies', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 180, 60);
  const b = w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 15, idle);
  assert.equal(e.hp, 2);
  assert.equal(b.dead, true);
  assert.ok(types(w).includes('hit'));
});

test('world: pierce passes through exactly pierce enemies', () => {
  const { w } = setup();
  w.player.stats.pierce = 1;
  const a = w.spawnEnemy('dummy', 180, 60);
  const b = w.spawnEnemy('dummy', 200, 60);
  const c = w.spawnEnemy('dummy', 220, 60);
  w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 40, idle);
  assert.equal(a.hp, 2);
  assert.equal(b.hp, 2);
  assert.equal(c.hp, 3);
});

test('world: solid non-targetable enemies absorb bolts with a clink', () => {
  const { w } = setup({ targetable: false, solid: true });
  const e = w.spawnEnemy('dummy', 180, 60);
  const b = w.firePlayerBolt(150, 60, 0);
  H.stepN(w, 15, idle);
  assert.equal(e.hp, 3);
  assert.equal(b.dead, true);
  assert.ok(types(w).includes('clink'));
});

test('world: killing an enemy emits enemyDie and removes it', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 60);
  w.damageEnemy(e, 5);
  H.stepN(w, 1, idle);
  assert.equal(e.dead, true);
  assert.equal(w.enemies.length, 0);
  assert.ok(types(w).includes('enemyDie'));
});

test('world: caps hold for enemy bullets and enemies', () => {
  const { CB, w } = setup();
  for (let i = 0; i < 500; i++) w.fireEnemyBullet(30, 30, Math.PI, 10);
  assert.equal(w.eBullets.length, CB.CAPS.eBullets);
  for (let i = 0; i < 80; i++) w.spawnEnemy('dummy', 30, 30);
  assert.equal(w.enemies.length, CB.CAPS.enemies);
});

test('world: an enemy bullet costs one heart and is consumed; a second one in the same tick passes', () => {
  const { w } = setup();
  const p = w.player;
  const b1 = w.fireEnemyBullet(p.x, p.y, 0, 0);
  const b2 = w.fireEnemyBullet(p.x, p.y, 0, 0);
  H.stepN(w, 1, idle);
  assert.equal(p.hearts, 4);
  assert.equal(b1.dead, true);
  assert.equal(b2.dead, false);
});

test('world: contact with an enemy hurts the player', () => {
  const { w } = setup();
  w.spawnEnemy('dummy', w.player.x + 3, w.player.y);
  H.stepN(w, 1, idle);
  assert.equal(w.player.hearts, 4);
});

test('world: puddle hazard halves player speed while inside', () => {
  const { w } = setup();
  const p = w.player;
  w.addHazard({ x: p.x, y: p.y, r: 12 });
  H.stepN(w, 1, idle);
  assert.equal(p.slow, 0.5);
  const x0 = p.x;
  H.stepN(w, 10, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  const moved = p.x - x0;
  assert.ok(moved > 6 && moved < 7.5, `moved ${moved}`);
});

test('world: ricochet bolt bounces once off the wall', () => {
  const { w } = setup();
  w.player.stats.bounces = 1;
  const b = w.firePlayerBolt(300, 60, 0);
  H.stepN(w, 18, idle);
  assert.ok(b.vx < 0, 'reversed');
  assert.ok(b.x < 312);
  assert.equal(b.bounces, 0);
  assert.ok(b.life <= 0.6);
  assert.ok(types(w).includes('bounce'));
});

test('world: hitstop freezes simulation time', () => {
  const { w } = setup();
  w.hitstop = 0.1;
  H.stepN(w, 3, idle);
  assert.equal(w.time, 0);
  H.stepN(w, 10, idle);
  assert.ok(w.time > 0);
});

test('world: aiming exactly at the player never produces NaN', () => {
  const { w } = setup();
  const p = w.player;
  H.stepN(w, 20, () => H.makeInput({ aimX: p.x, aimY: p.y, fire: true }));
  for (const b of w.pBullets) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.vx));
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

// Only events emitted *during* step become particles (consume reads from the step's start index),
// so the flood is emitted from inside an enemy update.
test('world: fx particles respect the cap', () => {
  const CB = H.loadWith();
  CB.Enemies.boomer = {
    create: (w, x, y) => CB.makeEnemy('boomer', x, y, { hp: 1, contact: false }),
    update(e, w) {
      if (e.t <= 1 / 60 + 1e-9) for (let i = 0; i < 300; i++) w.emit('enemyDie', { x: 100, y: 100, kind: 'boomer', r: 8, boss: true });
    },
    draw() {},
  };
  const w = CB.createWorld({ seed: 1 });
  w.spawnEnemy('boomer', 30, 30);
  H.stepN(w, 2, idle);
  assert.ok(w.fx.length > 0);
  assert.ok(w.fx.length <= CB.CAPS.fx);
});
```

- [ ] **Step 3: Write the failing tests `tests/player.test.js`**

```js
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
  assert.ok(d > 35 && d < 46, `dash distance ${d}`);
  const dashes = () => w.events.filter((e) => e.type === 'dash').length;
  assert.equal(dashes(), 1);
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  assert.equal(dashes(), 1, 'second dash ignored during cooldown');
  H.stepN(w, 40, () => H.makeInput({ aimX: 300, aimY: 30 }));
  H.stepN(w, 1, mv(1, 0, { dash: true }));
  assert.equal(dashes(), 2, 'dash available after 0.8 s');
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
```

- [ ] **Step 4: Run to verify failure.** Run `node --test tests/patches.test.js tests/world.test.js tests/player.test.js`. Expected: FAIL (ENOENT).

- [ ] **Step 5: Create `src/game/patches.js`**

```js
// Patch (upgrade) definitions, stat computation and offer generation.
(function (CB) {
  'use strict';
  const DEFS = {
    spread: { name: 'Spread Shot', max: 2, desc: '+2 angled sparks' },
    rapid: { name: 'Rapid Fire', max: 2, desc: 'Fire 30% faster' },
    pierce: { name: 'Pierce', max: 2, desc: 'Sparks pass through +1 bug' },
    heavy: { name: 'Heavy Bolts', max: 2, desc: '+50% damage, bigger sparks' },
    heart: { name: 'Extra Heart', max: 2, desc: '+1 max heart' },
    dash: { name: 'Quick Dash', max: 1, desc: 'Dash recharges in 0.45 s' },
    ricochet: { name: 'Ricochet', max: 1, desc: 'Sparks bounce off walls once' },
  };
  const ORDER = ['spread', 'rapid', 'pierce', 'heavy', 'heart', 'dash', 'ricochet'];
  const BASE = Object.freeze({ fireCooldown: 0.2, boltSpeed: 200, boltR: 2, dmg: 1, spread: 0, pierce: 0, bounces: 0, dashCooldown: 0.8, maxHearts: 5 });

  function count(counts, id) {
    return Math.min((counts && counts[id]) | 0, DEFS[id].max);
  }

  CB.Patches = {
    DEFS,
    ORDER,
    BASE,
    computeStats(counts) {
      const c = (id) => count(counts, id);
      return {
        fireCooldown: BASE.fireCooldown * Math.pow(0.7, c('rapid')),
        boltSpeed: BASE.boltSpeed,
        boltR: BASE.boltR + c('heavy'),
        dmg: BASE.dmg + 0.5 * c('heavy'),
        spread: c('spread'),
        pierce: c('pierce'),
        bounces: c('ricochet'),
        dashCooldown: c('dash') ? 0.45 : BASE.dashCooldown,
        maxHearts: BASE.maxHearts + c('heart'),
      };
    },
    offer(rng, counts, n) {
      const avail = ORDER.filter((id) => ((counts && counts[id]) | 0) < DEFS[id].max);
      return rng.shuffle(avail).slice(0, n == null ? 3 : n);
    },
    apply(counts, id) {
      if (!DEFS[id]) throw new Error('unknown patch: ' + id);
      const cur = (counts && counts[id]) | 0;
      if (cur >= DEFS[id].max) throw new Error(`patch ${id} already at max (${DEFS[id].max})`);
      const next = Object.assign({}, counts);
      next[id] = cur + 1;
      return next;
    },
  };
})(window.CB);
```

> Check: `0.2 * 0.7 = 0.13999999999999999`, which passes the `< 1e-9` tolerance tests.

- [ ] **Step 6: Create `src/game/world.js`**

```js
// World state: entities, spawning, damage, collisions, hazards and the event queue.
(function (CB) {
  'use strict';
  const M = CB.M;
  const CAPS = Object.freeze({ enemies: 60, eBullets: 400, pBullets: 120, fx: 500 });
  CB.CAPS = CAPS;
  CB.SPAWN_TELEGRAPH = 0.6;

  CB.makeEnemy = function (kind, x, y, props) {
    const e = {
      kind, x, y, r: 5, vx: 0, vy: 0, hp: 1, maxHp: 1, t: 0, state: 'idle', stateT: 0,
      targetable: true, solid: false, contact: true, visible: true,
      hitFlash: 0, invuln: 0, dead: false, boss: false, regular: true, facing: 1, alpha: 1, data: {},
    };
    if (props) Object.assign(e, props);
    if (!props || props.maxHp == null) e.maxHp = e.hp;
    return e;
  };

  CB.setState = function (e, state) {
    e.state = state;
    e.stateT = 0;
  };

  function removeDead(arr) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (!arr[i].dead) arr[j++] = arr[i];
    arr.length = j;
  }

  function collide(w) {
    const p = w.player;
    for (const b of w.pBullets) {
      if (b.dead) continue;
      for (const e of w.enemies) {
        if (e.dead || !e.visible || !(e.targetable || e.solid)) continue;
        if (b.hits.indexOf(e) !== -1) continue;
        if (!M.circleHit(b.x, b.y, b.r, e.x, e.y, e.r)) continue;
        b.hits.push(e);
        if (e.targetable) w.damageEnemy(e, b.dmg, b);
        else w.emit('clink', { x: b.x, y: b.y });
        if (b.pierce > 0) b.pierce--;
        else {
          b.dead = true;
          break;
        }
      }
    }
    if (p.dead) return;
    for (const eb of w.eBullets) {
      if (eb.dead) continue;
      if (M.circleHit(eb.x, eb.y, eb.r, p.x, p.y, p.r) && CB.Player.hurt(p, w, eb)) eb.dead = true;
    }
    for (const e of w.enemies) {
      if (e.dead || !e.visible || !e.contact) continue;
      if (M.circleHit(e.x, e.y, e.r * 0.85, p.x, p.y, p.r)) CB.Player.hurt(p, w, e);
    }
  }

  function updateHazards(w, dt) {
    const p = w.player;
    let slow = 1;
    for (const h of w.hazards) {
      if (h.dead) continue;
      h.t += dt;
      h.life -= dt;
      if (h.life <= 0) {
        h.dead = true;
        continue;
      }
      if (h.kind === 'puddle' && !p.dead && M.dist2(h.x, h.y, p.x, p.y) <= h.r * h.r) slow = Math.min(slow, h.slow);
    }
    p.slow = slow;
  }

  CB.createWorld = function (opts) {
    const o = opts || {};
    const seed = o.seed == null ? 1 : o.seed >>> 0;
    const w = {
      seed,
      rng: CB.createRng(seed),
      fxRng: CB.createRng((seed * 7919 + 13) >>> 0),
      time: 0,
      arena: CB.ARENA,
      stage: o.stage || null,
      god: !!o.god,
      player: null,
      enemies: [],
      pBullets: [],
      eBullets: [],
      hazards: [],
      fx: [],
      spawns: [],
      boss: null,
      events: [],
      shake: 0,
      hitstop: 0,
      flash: 0,
      stats: { wouldHits: 0, shots: 0, kills: 0, damageDealt: 0 },
    };

    w.emit = function (type, data) {
      const ev = Object.assign({ type }, data);
      w.events.push(ev);
      return ev;
    };

    w.addShake = function (amount) {
      w.shake = Math.min(6, Math.max(w.shake, amount));
    };

    w.spawnEnemy = function (kind, x, y, o2) {
      const mod = CB.Enemies[kind];
      if (!mod) throw new Error('unknown enemy kind: ' + kind);
      if (w.enemies.length >= CAPS.enemies) return null;
      const e = mod.create(w, x, y, o2 || {});
      e.kind = kind;
      w.enemies.push(e);
      return e;
    };

    w.queueSpawn = function (kind, x, y, o2, delay) {
      const d = delay == null ? CB.SPAWN_TELEGRAPH : delay;
      const s = { kind, x, y, opts: o2 || {}, t: d, total: d, dead: false };
      w.spawns.push(s);
      return s;
    };

    w.regularAlive = function () {
      let n = 0;
      for (const e of w.enemies) if (!e.dead && e.regular) n++;
      return n;
    };

    w.edgePoint = function (minDist) {
      const md = minDist == null ? 60 : minDist;
      const a = w.arena;
      const inset = 10;
      const p = w.player;
      let best = null;
      let bestD = -1;
      for (let i = 0; i < 24; i++) {
        const side = w.rng.int(0, 3);
        let x;
        let y;
        if (side === 0) {
          x = w.rng.range(a.x + inset, a.x + a.w - inset);
          y = a.y + inset;
        } else if (side === 1) {
          x = w.rng.range(a.x + inset, a.x + a.w - inset);
          y = a.y + a.h - inset;
        } else if (side === 2) {
          x = a.x + inset;
          y = w.rng.range(a.y + inset, a.y + a.h - inset);
        } else {
          x = a.x + a.w - inset;
          y = w.rng.range(a.y + inset, a.y + a.h - inset);
        }
        const d = M.dist(x, y, p.x, p.y);
        if (d >= md) return { x, y };
        if (d > bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      return best;
    };

    w.randomPoint = function (margin, minDist) {
      const m = margin == null ? 16 : margin;
      const md = minDist || 0;
      const a = w.arena;
      const p = w.player;
      let best = null;
      let bestD = -1;
      for (let i = 0; i < 24; i++) {
        const x = w.rng.range(a.x + m, a.x + a.w - m);
        const y = w.rng.range(a.y + m, a.y + a.h - m);
        const d = M.dist(x, y, p.x, p.y);
        if (d >= md) return { x, y };
        if (d > bestD) {
          bestD = d;
          best = { x, y };
        }
      }
      return best;
    };

    w.fireEnemyBullet = function (x, y, angle, speed, o2) {
      if (w.eBullets.length >= CAPS.eBullets) return null;
      const opt = o2 || {};
      const sp = speed == null ? 80 : speed;
      const b = {
        x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
        r: opt.r || 2, life: opt.life || 8, color: opt.color || null,
        spin: opt.spin || 0, accel: opt.accel || 0, t: 0, dead: false,
      };
      w.eBullets.push(b);
      return b;
    };

    w.firePlayerBolt = function (x, y, angle) {
      if (w.pBullets.length >= CAPS.pBullets) return null;
      const st = w.player.stats;
      const b = {
        x, y, vx: Math.cos(angle) * st.boltSpeed, vy: Math.sin(angle) * st.boltSpeed, angle,
        r: st.boltR, dmg: st.dmg, pierce: st.pierce, bounces: st.bounces, life: 1.5, hits: [], t: 0, dead: false,
      };
      w.pBullets.push(b);
      return b;
    };

    w.damageEnemy = function (e, dmg, src) {
      if (!e || e.dead || !e.targetable || !e.visible) return 0;
      if (e.invuln > 0) {
        w.emit('clink', { x: e.x, y: e.y });
        return 0;
      }
      const mod = CB.Enemies[e.kind];
      let applied;
      if (mod && mod.onHit) applied = mod.onHit(e, w, dmg, src);
      else {
        e.hp -= dmg;
        applied = dmg;
      }
      if (applied > 0) {
        e.hitFlash = 0.08;
        w.stats.damageDealt += applied;
        w.emit('hit', { x: e.x, y: e.y, kind: e.kind, boss: e.boss });
      }
      if (e.hp <= 0 && !e.dead) w.killEnemy(e);
      return applied;
    };

    w.killEnemy = function (e, silent) {
      if (e.dead) return;
      e.dead = true;
      if (e.hp > 0) e.hp = 0;
      w.stats.kills++;
      const mod = CB.Enemies[e.kind];
      if (!silent && mod && mod.onDeath) mod.onDeath(e, w);
      w.emit('enemyDie', { x: e.x, y: e.y, kind: e.kind, r: e.r, boss: e.boss, silent: !!silent });
    };

    w.killAllEnemies = function () {
      for (const e of w.enemies) if (!e.dead) w.killEnemy(e, true);
      w.spawns.length = 0;
    };

    w.clearEnemyBullets = function () {
      w.eBullets.length = 0;
    };

    w.addHazard = function (h) {
      const hz = Object.assign({ kind: 'puddle', r: 12, life: 6, slow: 0.5, t: 0, dead: false }, h);
      w.hazards.push(hz);
      return hz;
    };

    w.step = function (dt, input) {
      if (w.hitstop > 0) {
        w.hitstop = Math.max(0, w.hitstop - dt);
        return;
      }
      const evStart = w.events.length;
      w.time += dt;
      for (const s of w.spawns) {
        if (s.dead) continue;
        s.t -= dt;
        if (s.t <= 0) {
          s.dead = true;
          const e = w.spawnEnemy(s.kind, s.x, s.y, s.opts);
          if (e) w.emit('spawn', { x: s.x, y: s.y, kind: s.kind });
        }
      }
      CB.Player.update(w.player, w, dt, input);
      for (let i = 0; i < w.enemies.length; i++) {
        const e = w.enemies[i];
        if (e.dead) continue;
        e.t += dt;
        e.stateT += dt;
        if (e.hitFlash > 0) e.hitFlash -= dt;
        if (e.invuln > 0) e.invuln -= dt;
        CB.Enemies[e.kind].update(e, w, dt);
      }
      if (w.boss) w.boss.update(w, dt);
      CB.Projectiles.update(w, dt);
      collide(w);
      updateHazards(w, dt);
      removeDead(w.enemies);
      removeDead(w.pBullets);
      removeDead(w.eBullets);
      removeDead(w.hazards);
      removeDead(w.spawns);
      CB.Fx.consume(w, evStart);
      CB.Fx.update(w, dt);
      if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 20);
      if (w.flash > 0) w.flash = Math.max(0, w.flash - dt);
    };

    w.player = CB.Player.create(w, o.patches || {});
    return w;
  };
})(window.CB);
```

- [ ] **Step 7: Create `src/game/projectiles.js`**

```js
// Movement, wall behaviour and drawing for player bolts and enemy bullets.
(function (CB) {
  'use strict';
  const M = CB.M;

  CB.Art.defineSprite('bolt', ['..z..', '.zwz.', 'zwwwz', '.zwz.', '..z..']);
  CB.Art.defineSprite('bolt_big', ['...z...', '..zwz..', '.zwwwz.', 'zwwwwwz', '.zwwwz.', '..zwz..', '...z...']);
  CB.Art.defineSprite('ebullet', ['..k..', '.kxk.', 'kxXxk', '.kxk.', '..k..']);

  CB.Projectiles = {
    update(w, dt) {
      const a = w.arena;
      for (const b of w.pBullets) {
        if (b.dead) continue;
        b.t += dt;
        b.life -= dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0) {
          b.dead = true;
          continue;
        }
        const outX = b.x < a.x || b.x > a.x + a.w;
        const outY = b.y < a.y || b.y > a.y + a.h;
        if (outX || outY) {
          if (b.bounces > 0) {
            if (outX) {
              b.vx = -b.vx;
              b.x = M.clamp(b.x, a.x, a.x + a.w);
            }
            if (outY) {
              b.vy = -b.vy;
              b.y = M.clamp(b.y, a.y, a.y + a.h);
            }
            b.bounces--;
            b.life = 0.6;
            b.hits.length = 0;
            b.angle = Math.atan2(b.vy, b.vx);
            w.emit('bounce', { x: b.x, y: b.y });
          } else b.dead = true;
        }
      }
      for (const b of w.eBullets) {
        if (b.dead) continue;
        b.t += dt;
        b.life -= dt;
        if (b.spin) {
          const c = Math.cos(b.spin * dt);
          const s = Math.sin(b.spin * dt);
          const vx = b.vx * c - b.vy * s;
          b.vy = b.vx * s + b.vy * c;
          b.vx = vx;
        }
        if (b.accel) {
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 0) {
            const ns = Math.max(10, sp + b.accel * dt);
            b.vx *= ns / sp;
            b.vy *= ns / sp;
          }
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.life <= 0 || !M.inArena(b.x, b.y, 4, a)) b.dead = true;
      }
    },

    draw(w, r) {
      for (const b of w.pBullets) r.sprite(b.r >= 3 ? 'bolt_big' : 'bolt', b.x, b.y);
      for (const b of w.eBullets) {
        if (b.color) {
          r.disc(b.x, b.y, b.r + 1, CB.Pal.C.ink);
          r.disc(b.x, b.y, b.r, b.color);
        } else r.sprite('ebullet', b.x, b.y);
      }
    },
  };
})(window.CB);
```

- [ ] **Step 8: Create `src/game/player.js`**

```js
// Clawd: movement, aiming, firing, dashing, damage and drawing.
(function (CB) {
  'use strict';
  const M = CB.M;
  const SPEED = 80;
  const DASH_SPEED = 260;
  const DASH_TIME = 0.15;
  const DASH_INVULN = 0.25;
  const HURT_INVULN = 1.0;
  const SPREAD_STEP = (12 * Math.PI) / 180;

  // 16x12 Clawd. Eyes sit one pixel right of centre so flipping reads as "facing".
  const BLANK = '................';
  const BODY = [
    '..ohhhhhhhhhho..',
    '..oooooooooooo..',
    '..ooookooookoo..',
    '..ooookooookoo..',
    'oooooooooooooooo',
    'oooooooooooooooo',
    '..oooooooooooo..',
    '..OOOOOOOOOOOO..',
  ];
  const BODY_BLINK = [BODY[0], BODY[1], BODY[1], BODY[2], BODY[4], BODY[5], BODY[6], BODY[7]];
  const LEG = '...O.O....O.O...';
  const LEG_A = '...O......O.....';
  const LEG_B = '.....O......O...';
  CB.Art.defineSprite('clawd_idle0', [BLANK, ...BODY, LEG, LEG, BLANK]);
  CB.Art.defineSprite('clawd_idle1', [BLANK, BLANK, ...BODY, LEG, BLANK]);
  CB.Art.defineSprite('clawd_walk0', [BLANK, ...BODY, LEG, LEG_A, BLANK]);
  CB.Art.defineSprite('clawd_walk2', [BLANK, ...BODY, LEG, LEG_B, BLANK]);
  CB.Art.defineSprite('clawd_blink', [BLANK, ...BODY_BLINK, LEG, LEG, BLANK]);
  const WALK = ['clawd_walk0', 'clawd_idle0', 'clawd_walk2', 'clawd_idle0'];

  CB.Player = {
    SPEED, DASH_SPEED, DASH_TIME, DASH_INVULN, HURT_INVULN,

    create(w, patches) {
      const stats = CB.Patches.computeStats(patches || {});
      const a = w.arena;
      return {
        x: a.x + a.w / 2, y: a.y + a.h / 2 + 30, r: 5, vx: 0, vy: 0,
        hearts: stats.maxHearts, stats, facing: 1,
        aimX: a.x + a.w / 2, aimY: a.y,
        fireCd: 0, dashCd: 0, dashT: 0, dashDX: 0, dashDY: 0,
        invuln: 0, hurtT: 0, dead: false, slow: 1, moving: false, walkT: 0, t: 0, trail: [],
      };
    },

    canBeHit: (p) => !p.dead && p.invuln <= 0,

    update(p, w, dt, input) {
      p.t += dt;
      for (const g of p.trail) g.life -= dt;
      while (p.trail.length && p.trail[0].life <= 0) p.trail.shift();
      if (p.dead) return;
      p.fireCd -= dt;
      p.dashCd -= dt;
      p.invuln -= dt;
      p.hurtT -= dt;
      p.aimX = input.aimX;
      p.aimY = input.aimY;
      p.facing = p.aimX >= p.x ? 1 : -1;
      const mv = M.norm(input.moveX || 0, input.moveY || 0);

      if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
        let d = mv;
        if (d.x === 0 && d.y === 0) d = M.norm(p.aimX - p.x, p.aimY - p.y);
        if (d.x === 0 && d.y === 0) d = { x: p.facing, y: 0 };
        p.dashDX = d.x;
        p.dashDY = d.y;
        p.dashT = DASH_TIME;
        p.invuln = Math.max(p.invuln, DASH_INVULN);
        p.dashCd = p.stats.dashCooldown;
        w.emit('dash', { x: p.x, y: p.y });
      }

      if (p.dashT > 0) {
        p.dashT -= dt;
        p.vx = p.dashDX * DASH_SPEED;
        p.vy = p.dashDY * DASH_SPEED;
        p.trail.push({ x: p.x, y: p.y, life: 0.2, facing: p.facing });
        if (p.trail.length > 8) p.trail.shift();
      } else {
        const sp = SPEED * p.slow;
        p.vx = mv.x * sp;
        p.vy = mv.y * sp;
      }
      p.moving = p.vx !== 0 || p.vy !== 0;
      if (p.moving) p.walkT += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      M.clampToArena(p, w.arena);

      if (input.fire && p.fireCd <= 0) {
        p.fireCd = p.stats.fireCooldown;
        CB.Player.fire(p, w);
      }
    },

    fire(p, w) {
      const base = Math.atan2(p.aimY - p.y, p.aimX - p.x);
      const sx = p.x + Math.cos(base) * 6;
      const sy = p.y + Math.sin(base) * 6;
      w.firePlayerBolt(sx, sy, base);
      for (let i = 1; i <= p.stats.spread; i++) {
        w.firePlayerBolt(sx, sy, base + SPREAD_STEP * i);
        w.firePlayerBolt(sx, sy, base - SPREAD_STEP * i);
      }
      w.stats.shots++;
      w.emit('shoot', { x: sx, y: sy, angle: base });
    },

    hurt(p, w) {
      if (p.dead || p.invuln > 0) return false;
      p.invuln = HURT_INVULN;
      p.hurtT = HURT_INVULN;
      w.addShake(4);
      w.hitstop = Math.max(w.hitstop, 0.06);
      w.flash = 0.15;
      if (w.god) {
        w.stats.wouldHits++;
        w.emit('playerHurt', { x: p.x, y: p.y, god: true });
        return true;
      }
      p.hearts -= 1;
      w.emit('playerHurt', { x: p.x, y: p.y });
      if (p.hearts <= 0) {
        p.hearts = 0;
        p.dead = true;
        p.dashT = 0;
        w.emit('playerDie', { x: p.x, y: p.y });
      }
      return true;
    },

    draw(p, r) {
      for (const g of p.trail) {
        r.alpha(Math.max(0, g.life / 0.2) * 0.45, () => r.sprite('clawd_idle0', g.x, g.y - 2, { flip: g.facing < 0, white: true }));
      }
      r.alpha(0.35, () => r.rect(p.x - 5, p.y + 4, 10, 2, CB.Pal.C.ink));
      if (p.dead) {
        r.sprite('clawd_idle0', p.x, p.y - 2, { flipY: true, flip: p.facing < 0 });
        return;
      }
      if (p.hurtT > 0 && Math.floor(p.hurtT * 20) % 2 === 0) return;
      let name;
      if (p.dashT > 0) name = 'clawd_walk0';
      else if (p.moving) name = WALK[Math.floor(p.walkT * 10) % 4];
      else if (p.t % 3.2 < 0.12) name = 'clawd_blink';
      else name = Math.floor(p.t * 2) % 2 ? 'clawd_idle1' : 'clawd_idle0';
      r.sprite(name, p.x, p.y - 2, { flip: p.facing < 0 });
    },
  };
})(window.CB);
```

- [ ] **Step 9: Create `src/game/fx.js`**

```js
// Cosmetic particles, rings and floating text, created from world events.
// Uses world.fxRng only (deterministic, never Math.random).
(function (CB) {
  'use strict';
  const C = () => CB.Pal.C;
  const DEATH_TEXT = { syntaxError: ';', nullPointer: 'null', raceCondition: 'race', memoryLeak: 'free()', offByOne: '+1' };

  function push(w, f) {
    if (w.fx.length >= CB.CAPS.fx) w.fx.splice(0, w.fx.length - CB.CAPS.fx + 1);
    f.dead = false;
    w.fx.push(f);
    return f;
  }

  const Fx = {
    spark(w, x, y, color, n, speed, life) {
      for (let i = 0; i < n; i++) {
        const a = w.fxRng.angle();
        const sp = speed * (0.4 + 0.6 * w.fxRng.next());
        push(w, { kind: 'p', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color });
      }
    },
    text(w, x, y, text, color, life) {
      const l = life || 0.8;
      push(w, { kind: 'text', x, y, vx: 0, vy: -14, life: l, max: l, text, color: color || '#FFFFFF' });
    },
    ring(w, x, y, r0, r1, color, life) {
      push(w, { kind: 'ring', x, y, r0, r1, life, max: life, color });
    },
    consume(w, from) {
      const ev = w.events;
      for (let i = from; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'hit': Fx.spark(w, e.x, e.y, C().white, 3, 40, 0.18); break;
          case 'clink': Fx.spark(w, e.x, e.y, C().grey, 2, 30, 0.12); break;
          case 'enemyDie':
            Fx.spark(w, e.x, e.y, e.boss ? C().gold : C().spark, Math.min(24, 6 + (e.r | 0) * 2), 70, 0.4);
            Fx.ring(w, e.x, e.y, 2, (e.r | 0) + 6, C().white, 0.25);
            if (!e.silent && DEATH_TEXT[e.kind] && w.fxRng.chance(0.5)) Fx.text(w, e.x, e.y - 8, DEATH_TEXT[e.kind], C().pale, 0.7);
            break;
          case 'spawn': Fx.ring(w, e.x, e.y, 2, 10, C().white, 0.25); break;
          case 'playerHurt': Fx.spark(w, e.x, e.y, C().hurt, 10, 80, 0.35); break;
          case 'playerDie': Fx.spark(w, e.x, e.y, C().clawd, 30, 90, 0.8); break;
          case 'bossPhase': Fx.ring(w, e.x, e.y, 4, 40, C().white, 0.5); break;
          case 'bossDie':
            for (let k = 0; k < 6; k++) Fx.ring(w, e.x + w.fxRng.range(-14, 14), e.y + w.fxRng.range(-10, 10), 2, 18 + k * 4, k % 2 ? C().gold : C().ember, 0.4 + k * 0.15);
            Fx.spark(w, e.x, e.y, C().gold, 40, 110, 1.0);
            break;
          case 'teleport': Fx.spark(w, e.x, e.y, C().cyan, 8, 50, 0.3); break;
          case 'text': Fx.text(w, e.x, e.y, e.text, e.color, 0.9); break;
          case 'splat': Fx.spark(w, e.x, e.y, C().green, 8, 40, 0.35); break;
          case 'revive': Fx.ring(w, e.x, e.y, 2, 24, C().purple, 0.5); break;
          default: break;
        }
      }
    },
    update(w, dt) {
      const damp = Math.max(0, 1 - 4 * dt);
      for (const f of w.fx) {
        f.life -= dt;
        if (f.life <= 0) {
          f.dead = true;
          continue;
        }
        f.x += (f.vx || 0) * dt;
        f.y += (f.vy || 0) * dt;
        if (f.kind === 'p') {
          f.vx *= damp;
          f.vy *= damp;
        }
      }
      let j = 0;
      for (let i = 0; i < w.fx.length; i++) if (!w.fx[i].dead) w.fx[j++] = w.fx[i];
      w.fx.length = j;
    },
    draw(w, r) {
      for (const f of w.fx) {
        const k = Math.max(0, f.life / f.max);
        if (f.kind === 'p') r.alpha(k, () => r.rect(f.x, f.y, 1, 1, f.color));
        else if (f.kind === 'ring') r.alpha(k, () => r.ring(f.x, f.y, Math.round(f.r0 + (f.r1 - f.r0) * (1 - k)), f.color));
        else if (f.kind === 'text') r.text(f.text, f.x, f.y, { align: 'center', color: f.color, alpha: Math.min(1, k * 2), shadow: CB.Pal.C.ink });
      }
    },
  };
  CB.Fx = Fx;
})(window.CB);
```

- [ ] **Step 10: Run all three suites.** Run `node --test tests/patches.test.js tests/world.test.js tests/player.test.js`. Expected: all PASS. Then fix any numeric drift by checking the tick math. Never loosen the tolerances. If a test still fails after the code matches this plan, report the failing assertion and actual value to the orchestrator.

- [ ] **Step 11: Commit (orchestrator).** `git add src/game/world.js src/game/projectiles.js src/game/patches.js src/game/player.js src/game/fx.js tests/world.test.js tests/player.test.js tests/patches.test.js && git commit -m "feat: world, projectiles, patches, player and fx core"`

---

### Task 4: Stages, wave spawner and run state machine

**Files:**
- Create: `src/game/stages.js`, `src/game/waves.js`, `src/game/stageRunner.js`
- Test: `tests/waves.test.js`, `tests/stageRunner.test.js`

**Interfaces:**
- Consumes: everything from Task 3. At runtime it needs `CB.Enemies[kind]` and `CB.Bosses[id]`; tests register stubs.
- Produces:
  - `CB.STAGES` (array of 4 `{id, n, path, palette, boss, waves: [[{kind, count}], [{kind, count}]]}`) and `CB.GROUP_SIZE = {raceCondition: 2}`.
  - `CB.WAVE = {INTERVAL: 0.7, MAX_ALIVE: 8}`.
  - `CB.createWaveSpawner(world, waveDef) → { queue, total, spawnedGroups, done, alive(), update(dt) }`.
  - `CB.RUN_T` (timings) and `CB.createRun(opts)` (see Cross-Task Contracts).

- [ ] **Step 1: Write the failing test `tests/waves.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js');
  for (const k of ['dummy', 'raceCondition']) {
    CB.Enemies[k] = { create: (w, x, y, o) => CB.makeEnemy(k, x, y, { hp: 1, contact: false, data: { opts: o } }), update() {}, draw() {} };
  }
  return CB;
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });

test('waves: never more than 8 regular enemies alive or pending', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 2 });
  const sp = CB.createWaveSpawner(w, [{ kind: 'dummy', count: 20 }]);
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) {
    w.step(CB.DT, idle());
    sp.update(CB.DT);
    peak = Math.max(peak, sp.alive());
  }
  assert.equal(peak, 8);
  assert.equal(sp.done, false, 'enemies still alive');
  for (let i = 0; i < 60 * 40 && !sp.done; i++) {
    for (const e of w.enemies) if (!e.dead) w.killEnemy(e);
    w.step(CB.DT, idle());
    sp.update(CB.DT);
  }
  assert.equal(sp.done, true);
  assert.equal(sp.spawnedGroups, 20);
});

test('waves: round-robin order by kind and 0.7 s stagger', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 2 });
  const sp = CB.createWaveSpawner(w, [{ kind: 'dummy', count: 2 }, { kind: 'raceCondition', count: 1 }]);
  assert.deepEqual(H.plain(sp.queue), ['dummy', 'raceCondition', 'dummy']);
  sp.update(CB.DT);
  assert.equal(w.spawns.length, 1, 'first group immediately');
  for (let i = 0; i < 40; i++) sp.update(CB.DT);
  assert.equal(w.spawns.length, 1, 'next group waits 0.7 s');
  for (let i = 0; i < 3; i++) sp.update(CB.DT);
  assert.equal(w.spawns.length, 3, 'raceCondition spawns as a pair');
  const phases = w.spawns.slice(1).map((s) => s.opts.phase);
  assert.deepEqual(H.plain(phases), [0, Math.PI]);
});

test('waves: spawn points are on the arena edge and at least 60 px from the player', () => {
  const CB = setup();
  const w = CB.createWorld({ seed: 5 });
  for (let i = 0; i < 50; i++) {
    const p = w.edgePoint(60);
    assert.ok(Math.hypot(p.x - w.player.x, p.y - w.player.y) >= 60);
    const a = CB.ARENA;
    const onEdge = Math.abs(p.x - (a.x + 10)) < 1e-9 || Math.abs(p.x - (a.x + a.w - 10)) < 1e-9 || Math.abs(p.y - (a.y + 10)) < 1e-9 || Math.abs(p.y - (a.y + a.h - 10)) < 1e-9;
    assert.ok(onEdge);
  }
});

test('stages: data matches the spec table', () => {
  const CB = setup();
  assert.equal(CB.STAGES.length, 4);
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.boss)), ['infiniteLoop', 'memoryLeakBoss', 'mergeConflict', 'heisenbug']);
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.path)), ['~/src/', '~/node_modules/', '~/.git/', '~/prod/']);
  for (const s of CB.STAGES) {
    assert.equal(s.waves.length, 2);
    assert.ok(CB.Pal.STAGES[s.palette], s.palette);
  }
  assert.deepEqual(H.plain(CB.STAGES[0].waves), [
    [{ kind: 'syntaxError', count: 4 }, { kind: 'nullPointer', count: 2 }],
    [{ kind: 'syntaxError', count: 6 }, { kind: 'nullPointer', count: 3 }],
  ]);
});
```

- [ ] **Step 2: Write the failing test `tests/stageRunner.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
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
function killAll(run) {
  for (const e of run.world.enemies) if (!e.dead) run.world.killEnemy(e);
}
function until(run, pred, maxTicks, each) {
  for (let i = 0; i < maxTicks; i++) {
    if (pred(run)) return true;
    if (each) each(run);
    run.step(idle());
  }
  return pred(run);
}

test('stageRunner: full stage sequence through to patch pick', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  assert.equal(run.state, 'stageIntro');
  assert.ok(until(run, (r) => r.state === 'wave', 200));
  assert.ok(Math.abs(run.time - 2.0) < 0.05);
  assert.ok(until(run, (r) => r.state === 'waveBreak', 600, killAll));
  assert.ok(until(run, (r) => r.state === 'wave' && r.waveIndex === 1, 200));
  assert.ok(until(run, (r) => r.state === 'bossWarn', 600, killAll));
  assert.ok(until(run, (r) => r.state === 'boss', 200));
  assert.ok(run.world.boss);
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'bossDead', 5));
  assert.ok(until(run, (r) => r.state === 'patchPick', 200));
  assert.equal(run.offer.length, 3);
  assert.ok(until(run, (r) => r.stateT >= 0.6, 60));
  assert.equal(run.choosePatch(0), true);
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.stageIndex, 1);
  assert.equal(run.history.length, 1);
  assert.equal(Object.values(run.patches).reduce((a, b) => a + b, 0), 1);
});

test('stageRunner: patch choice ignored during first 0.6 s', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'patchPick', 400);
  assert.equal(run.choosePatch(1), false);
  run.step(H.makeInput({ choice: 2 }));
  assert.equal(run.state, 'patchPick');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ choice: 2 }));
  assert.equal(run.state, 'stageIntro');
});

test('stageRunner: death → dying → dead → retry restores the stage', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  until(run, (r) => r.state === 'wave', 200);
  run.patches = { spread: 1, rapid: 1 };
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  run.step(idle());
  assert.equal(run.state, 'dying');
  assert.equal(run.deaths, 1);
  until(run, (r) => r.state === 'dead', 120);
  assert.equal(run.retryStage(), false, 'retry ignored during first 0.6 s');
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'dead');
  until(run, (r) => r.stateT >= 0.6, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.state, 'stageIntro');
  assert.equal(run.world.player.hearts, 5);
  assert.deepEqual(H.plain(run.patches), { spread: 1 });
});

test('stageRunner: player invulnerable during bossDead', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'bossDead', 5);
  const p = run.world.player;
  assert.equal(CB.Player.hurt(p, run.world, null), false);
  assert.equal(p.hearts, 5);
});

test('stageRunner: clearing the last stage leads to victory', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, startStage: 3, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  assert.ok(until(run, (r) => r.state === 'victory', 400));
});

test('stageRunner: time excludes patchPick; events are returned and cleared', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state === 'boss', 400);
  run.world.boss.hp = 0;
  until(run, (r) => r.state === 'patchPick', 400);
  const t0 = run.time;
  for (let i = 0; i < 30; i++) run.step(idle());
  assert.equal(run.time, t0);
  run.choosePatch(0);
  until(run, (r) => r.stateT >= 0.6, 60);
  run.choosePatch(0);
  // The first choosePatch above was locked (stateT < 0.6); the second succeeded and queued a patchPick event.
  const evs = run.step(idle());
  assert.ok(Array.isArray(evs));
  assert.ok(evs.some((e) => e.type === 'patchPick'));
  assert.equal(run.world.events.length, 0);
});

test('stageRunner: skipWaves goes from stageIntro straight to bossWarn', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, skipWaves: true });
  until(run, (r) => r.state !== 'stageIntro', 200);
  assert.equal(run.state, 'bossWarn');
});
```

- [ ] **Step 3: Run to verify failure.** Run `node --test tests/waves.test.js tests/stageRunner.test.js`. Expected: FAIL (ENOENT).

- [ ] **Step 4: Create `src/game/stages.js`**

```js
// Stage data: path label, palette, wave contents (raceCondition counts are pairs) and boss id.
(function (CB) {
  'use strict';
  CB.STAGES = [
    {
      id: 'src', n: 1, path: '~/src/', palette: 'src', boss: 'infiniteLoop',
      waves: [
        [{ kind: 'syntaxError', count: 4 }, { kind: 'nullPointer', count: 2 }],
        [{ kind: 'syntaxError', count: 6 }, { kind: 'nullPointer', count: 3 }],
      ],
    },
    {
      id: 'node_modules', n: 2, path: '~/node_modules/', palette: 'node_modules', boss: 'memoryLeakBoss',
      waves: [
        [{ kind: 'syntaxError', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'memoryLeak', count: 2 }],
        [{ kind: 'memoryLeak', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'nullPointer', count: 2 }],
      ],
    },
    {
      id: 'git', n: 3, path: '~/.git/', palette: 'git', boss: 'mergeConflict',
      waves: [
        [{ kind: 'offByOne', count: 2 }, { kind: 'syntaxError', count: 4 }, { kind: 'raceCondition', count: 1 }],
        [{ kind: 'offByOne', count: 3 }, { kind: 'memoryLeak', count: 2 }, { kind: 'nullPointer', count: 2 }],
      ],
    },
    {
      id: 'prod', n: 4, path: '~/prod/', palette: 'prod', boss: 'heisenbug',
      waves: [
        [{ kind: 'offByOne', count: 2 }, { kind: 'raceCondition', count: 2 }, { kind: 'memoryLeak', count: 2 }, { kind: 'nullPointer', count: 3 }],
        [{ kind: 'offByOne', count: 3 }, { kind: 'syntaxError', count: 4 }, { kind: 'memoryLeak', count: 2 }, { kind: 'raceCondition', count: 2 }],
      ],
    },
  ];
  CB.GROUP_SIZE = { raceCondition: 2 };
})(window.CB);
```

- [ ] **Step 5: Create `src/game/waves.js`**

```js
// Wave spawner: round-robin by kind, one group every 0.7 s, at most 8 regular enemies alive or pending.
(function (CB) {
  'use strict';
  const INTERVAL = 0.7;
  const MAX_ALIVE = 8;
  CB.WAVE = { INTERVAL, MAX_ALIVE };

  function groupSize(kind) {
    return (CB.GROUP_SIZE && CB.GROUP_SIZE[kind]) || 1;
  }

  function spawnGroup(w, kind) {
    const pt = w.edgePoint(60);
    if (groupSize(kind) === 2) {
      const ang = Math.atan2(w.player.y - pt.y, w.player.x - pt.x) + Math.PI / 2;
      const ox = Math.cos(ang) * 6;
      const oy = Math.sin(ang) * 6;
      w.queueSpawn(kind, pt.x + ox, pt.y + oy, { phase: 0 });
      w.queueSpawn(kind, pt.x - ox, pt.y - oy, { phase: Math.PI });
    } else {
      w.queueSpawn(kind, pt.x, pt.y, {});
    }
  }

  CB.createWaveSpawner = function (w, waveDef) {
    const lists = waveDef.map((d) => ({ kind: d.kind, left: d.count }));
    const queue = [];
    let any = true;
    while (any) {
      any = false;
      for (const l of lists) {
        if (l.left > 0) {
          queue.push(l.kind);
          l.left--;
          any = true;
        }
      }
    }
    const sp = {
      queue,
      total: queue.length,
      spawnedGroups: 0,
      timer: 0,
      done: false,
      alive() {
        return w.regularAlive() + w.spawns.length;
      },
      update(dt) {
        if (sp.done) return;
        sp.timer -= dt;
        if (queue.length && sp.timer <= 0) {
          const kind = queue[0];
          if (sp.alive() + groupSize(kind) <= MAX_ALIVE) {
            queue.shift();
            spawnGroup(w, kind);
            sp.spawnedGroups++;
            sp.timer = INTERVAL;
          }
        }
        if (!queue.length && w.spawns.length === 0 && w.regularAlive() === 0) sp.done = true;
      },
    };
    return sp;
  };
})(window.CB);
```

- [ ] **Step 6: Create `src/game/stageRunner.js`**

```js
// The run: stage → waves → boss → patch pick, with death/retry, as a headless state machine.
(function (CB) {
  'use strict';
  const T = Object.freeze({ stageIntro: 2.0, waveBreak: 1.5, bossWarn: 2.5, bossDead: 3.0, slowmo: 1.5, slowmoScale: 0.3, dying: 1.2, inputLock: 0.6 });
  CB.RUN_T = T;
  const COMBAT = { stageIntro: true, wave: true, waveBreak: true, bossWarn: true, boss: true };
  const NEUTRAL = Object.freeze({ moveX: 0, moveY: 0, aimX: 160, aimY: 90, fire: false, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false });
  CB.RUN_COMBAT_STATES = COMBAT;

  CB.createRun = function (opts) {
    const o = opts || {};
    const run = {
      seed: o.seed == null ? 1 : o.seed >>> 0,
      god: !!o.god,
      skipWaves: !!o.skipWaves,
      stageIndex: Math.max(0, Math.min(CB.STAGES.length - 1, o.startStage | 0)),
      patches: Object.assign({}, o.patches || {}),
      stagePatches: {},
      history: [],
      offer: null,
      state: 'stageIntro',
      stateT: 0,
      waveIndex: 0,
      spawner: null,
      time: 0,
      deaths: 0,
      attempt: 0,
      world: null,
      pending: [],
    };
    const stage = () => CB.STAGES[run.stageIndex];

    function setState(s) {
      run.state = s;
      run.stateT = 0;
    }

    function beginStage() {
      run.stagePatches = Object.assign({}, run.patches);
      run.world = CB.createWorld({
        seed: (run.seed * 1009 + run.stageIndex * 97 + run.attempt * 7919) >>> 0,
        stage: stage(),
        god: run.god,
        patches: run.patches,
      });
      run.waveIndex = 0;
      run.spawner = null;
      run.offer = null;
      setState('stageIntro');
    }

    function advanceStage() {
      run.stageIndex++;
      beginStage();
    }

    function startWave(i) {
      run.waveIndex = i;
      run.spawner = CB.createWaveSpawner(run.world, stage().waves[i]);
      setState('wave');
    }

    function enterBossWarn() {
      const w = run.world;
      w.clearEnemyBullets();
      w.pBullets.length = 0;
      w.hazards.length = 0;
      setState('bossWarn');
      run.pending.push({ type: 'bossWarn' });
    }

    function startBoss() {
      const w = run.world;
      w.clearEnemyBullets();
      w.boss = CB.Bosses[stage().boss].create(w);
      setState('boss');
    }

    function bossDefeated() {
      const w = run.world;
      w.killAllEnemies();
      w.clearEnemyBullets();
      w.hazards.length = 0;
      w.player.invuln = 999;
      w.emit('bossDie', { x: w.boss.x, y: w.boss.y });
      w.addShake(6);
      setState('bossDead');
    }

    run.step = function (input) {
      const inp = input || NEUTRAL;
      const out = run.pending.length ? run.pending.splice(0) : [];
      const dt = CB.DT;
      run.stateT += dt;
      if (run.state !== 'patchPick' && run.state !== 'dead' && run.state !== 'victory') run.time += dt;
      const w = run.world;
      switch (run.state) {
        case 'stageIntro':
          w.step(dt, inp);
          if (run.stateT >= T.stageIntro) {
            if (run.skipWaves) enterBossWarn();
            else startWave(0);
          }
          break;
        case 'wave':
          w.step(dt, inp);
          run.spawner.update(dt);
          if (run.spawner.done) {
            if (run.waveIndex === 0) setState('waveBreak');
            else enterBossWarn();
          }
          break;
        case 'waveBreak':
          w.step(dt, inp);
          if (run.stateT >= T.waveBreak) startWave(1);
          break;
        case 'bossWarn':
          w.step(dt, inp);
          if (run.stateT >= T.bossWarn) startBoss();
          break;
        case 'boss':
          w.step(dt, inp);
          if (w.boss && w.boss.defeated) bossDefeated();
          break;
        case 'bossDead':
          w.step(run.stateT <= T.slowmo ? dt * T.slowmoScale : dt, inp);
          if (run.stateT >= T.bossDead) {
            if (run.stageIndex >= CB.STAGES.length - 1) setState('victory');
            else {
              run.offer = CB.Patches.offer(w.rng, run.patches, 3);
              if (run.offer.length) setState('patchPick');
              else advanceStage();
            }
          }
          break;
        case 'patchPick':
          if (inp.choice) run.choosePatch(inp.choice - 1);
          break;
        case 'dying':
          w.step(dt * 0.5, NEUTRAL);
          if (run.stateT >= T.dying) setState('dead');
          break;
        case 'dead':
          if (inp.retry || inp.confirm) run.retryStage();
          break;
        default:
          break;
      }
      if (COMBAT[run.state] && run.world.player.dead) {
        run.deaths++;
        setState('dying');
      }
      const ev = run.world.events;
      for (let i = 0; i < ev.length; i++) out.push(ev[i]);
      ev.length = 0;
      return out;
    };

    run.choosePatch = function (i) {
      if (run.state !== 'patchPick' || run.stateT < T.inputLock || !run.offer) return false;
      const id = run.offer[i];
      if (!id) return false;
      run.patches = CB.Patches.apply(run.patches, id);
      run.history.push(id);
      run.pending.push({ type: 'patchPick', id });
      advanceStage();
      return true;
    };

    run.retryStage = function () {
      if (run.state !== 'dead' || run.stateT < T.inputLock) return false;
      run.patches = Object.assign({}, run.stagePatches);
      run.attempt++;
      beginStage();
      return true;
    };

    beginStage();
    return run;
  };
})(window.CB);
```

- [ ] **Step 7: Run tests.** Run `node --test tests/waves.test.js tests/stageRunner.test.js`. Expected: all PASS.
- [ ] **Step 8: Commit (orchestrator).** `git add src/game/stages.js src/game/waves.js src/game/stageRunner.js tests/waves.test.js tests/stageRunner.test.js && git commit -m "feat: stage data, wave spawner and run state machine"`

---

### Task 5: Renderer

**Files:**
- Create: `src/art/render.js`
- Test: `tests/render.test.js`

**Interfaces:**
- Consumes: `CB.Art.sprite(name)` and `CB.Font` (Task 8: `measure(str, scale)`, `draw(ctx, str, x, y, color, scale)`, `CELL_H`). `CB.Font` is read lazily at call time, so this task's tests don't need the font.
- Produces: `CB.createRenderer(canvas, win = window) → r`, with every member listed under Cross-Task Contracts plus `resize()`, `present()`, `toInternal(clientX, clientY) → {x, y}`, `scale`, `ox`, `oy`, `dpr`, `buf`.

- [ ] **Step 1: Write the failing test `tests/render.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function make(win, cssW, cssH) {
  const { CB, sandbox } = H.load([...H.CORE, 'src/art/render.js'], { returnSandbox: true });
  const canvas = sandbox.document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssW, height: cssH });
  const r = CB.createRenderer(canvas, win);
  r.resize();
  return { CB, r, canvas };
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

test('render: integer scale and centred letterbox', () => {
  const { r, canvas } = make({ innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 }, 1280, 800);
  assert.equal(canvas.width, 1280);
  assert.equal(r.scale, 4);
  assert.equal(r.ox, 0);
  assert.equal(r.oy, 40);
});

test('render: toInternal maps letterboxed coords', () => {
  const { r } = make({ innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 }, 1280, 800);
  const p = r.toInternal(640, 400);
  assert.ok(near(p.x, 160) && near(p.y, 90), JSON.stringify(p));
  const q = r.toInternal(0, 40);
  assert.ok(near(q.x, 0) && near(q.y, 0));
});

test('render: devicePixelRatio 2 uses the backing store and still maps CSS coords', () => {
  const { r, canvas } = make({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 }, 1280, 720);
  assert.equal(canvas.width, 2560);
  assert.equal(r.scale, 8);
  const p = r.toInternal(640, 360);
  assert.ok(near(p.x, 160) && near(p.y, 90), JSON.stringify(p));
});

test('render: fractional scale below 320 px wide', () => {
  const { r } = make({ innerWidth: 300, innerHeight: 400, devicePixelRatio: 1 }, 300, 400);
  assert.ok(near(r.scale, 300 / 320));
  assert.equal(r.ox, 0);
  const p = r.toInternal(150, r.oy + 90 * r.scale);
  assert.ok(near(p.x, 160, 1e-6) && near(p.y, 90, 1e-6), JSON.stringify(p));
});

test('render: primitives and sprites run headless without throwing', () => {
  const { CB, r } = make({ innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 }, 640, 360);
  CB.Art.defineSprite('t_dot', ['o']);
  CB.Font = { CELL_H: 7, measure: (s, sc) => s.length * 6 * (sc || 1), draw() {} };
  r.clear('#000000');
  r.rect(1.4, 2.6, 3, 3, '#FFFFFF');
  r.frame(0, 0, 10, 10, '#FFFFFF');
  r.disc(50, 50, 4, '#FF0000');
  r.ring(50, 50, 6, '#FF0000');
  r.line(0, 0, 20, 7, '#00FF00');
  r.sprite('t_dot', 10, 10, { flip: true, white: true, alpha: 0.5, flipY: true, scale: 2 });
  r.text('hello', 160, 90, { align: 'center', shadow: '#000000', alpha: 0.5, scale: 2 });
  r.alpha(0.5, () => r.rect(0, 0, 1, 1, '#FFFFFF'));
  r.shaken(2, -1, () => r.rect(0, 0, 1, 1, '#FFFFFF'));
  r.present();
  assert.equal(r.measure('abc', 1), 18);
});
```

- [ ] **Step 2: Run to verify failure.** Run `node --test tests/render.test.js`. Expected: FAIL (ENOENT).

- [ ] **Step 3: Create `src/art/render.js`**

```js
// 320x180 buffer renderer: integer upscaling with letterbox, pixel primitives, cached text and discs.
(function (CB) {
  'use strict';
  const TEXT_CACHE_MAX = 512;
  const SHAPE_CACHE_MAX = 256;

  function cacheGet(map, key) {
    const v = map.get(key);
    if (v !== undefined) {
      map.delete(key);
      map.set(key, v);
    }
    return v;
  }
  function cacheSet(map, key, val, max) {
    if (map.size >= max) map.delete(map.keys().next().value);
    map.set(key, val);
  }

  CB.createRenderer = function (canvas, win) {
    const W = win || window;
    const buf = document.createElement('canvas');
    buf.width = CB.W;
    buf.height = CB.H;
    const b = buf.getContext('2d');
    b.imageSmoothingEnabled = false;
    const out = canvas.getContext('2d');
    const textCache = new Map();
    const shapeCache = new Map();
    const R = Math.round;

    function shape(radius, color, outline) {
      const rr = Math.max(0, R(radius));
      const key = (outline ? 'o' : 'f') + rr + color;
      let c = cacheGet(shapeCache, key);
      if (c) return c;
      const size = rr * 2 + 1;
      c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = color;
      const outer = (rr + 0.5) * (rr + 0.5);
      const inner = (rr - 0.5) * (rr - 0.5);
      for (let y = -rr; y <= rr; y++) {
        for (let x = -rr; x <= rr; x++) {
          const d = x * x + y * y;
          if (d > outer) continue;
          if (outline && rr > 0 && d <= inner) continue;
          g.fillRect(x + rr, y + rr, 1, 1);
        }
      }
      cacheSet(shapeCache, key, c, SHAPE_CACHE_MAX);
      return c;
    }

    function textImage(s, color, sc) {
      const key = color + '|' + sc + '|' + s;
      let c = cacheGet(textCache, key);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = Math.max(1, CB.Font.measure(s, sc));
      c.height = CB.Font.CELL_H * sc;
      CB.Font.draw(c.getContext('2d'), s, 0, 0, color, sc);
      cacheSet(textCache, key, c, TEXT_CACHE_MAX);
      return c;
    }

    function withAlpha(a, fn) {
      if (a <= 0) return;
      const prev = b.globalAlpha;
      if (a !== 1) b.globalAlpha = prev * a;
      try {
        fn();
      } finally {
        b.globalAlpha = prev;
      }
    }

    const r = {
      canvas, buf, ctx: b, scale: 1, ox: 0, oy: 0, dpr: 1,

      resize() {
        const dpr = W.devicePixelRatio || 1;
        const cw = Math.max(1, Math.floor(W.innerWidth * dpr));
        const ch = Math.max(1, Math.floor(W.innerHeight * dpr));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        const s = Math.min(cw / CB.W, ch / CB.H);
        r.scale = s >= 1 ? Math.floor(s) : s;
        r.ox = Math.floor((cw - CB.W * r.scale) / 2);
        r.oy = Math.floor((ch - CB.H * r.scale) / 2);
        r.dpr = dpr;
      },

      present() {
        out.imageSmoothingEnabled = false;
        out.fillStyle = '#000000';
        out.fillRect(0, 0, canvas.width, canvas.height);
        out.drawImage(buf, 0, 0, CB.W, CB.H, r.ox, r.oy, CB.W * r.scale, CB.H * r.scale);
      },

      toInternal(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width > 0 ? canvas.width / rect.width : 1;
        const sy = rect.height > 0 ? canvas.height / rect.height : 1;
        const px = (clientX - rect.left) * sx;
        const py = (clientY - rect.top) * sy;
        return { x: (px - r.ox) / r.scale, y: (py - r.oy) / r.scale };
      },

      clear(color) {
        b.fillStyle = color;
        b.fillRect(0, 0, CB.W, CB.H);
      },

      rect(x, y, w, h, color) {
        b.fillStyle = color;
        b.fillRect(R(x), R(y), R(w), R(h));
      },

      frame(x, y, w, h, color) {
        const X = R(x), Y = R(y), Wd = R(w), Ht = R(h);
        b.fillStyle = color;
        b.fillRect(X, Y, Wd, 1);
        b.fillRect(X, Y + Ht - 1, Wd, 1);
        b.fillRect(X, Y, 1, Ht);
        b.fillRect(X + Wd - 1, Y, 1, Ht);
      },

      disc(cx, cy, radius, color) {
        const rr = Math.max(0, R(radius));
        b.drawImage(shape(rr, color, false), R(cx) - rr, R(cy) - rr);
      },

      ring(cx, cy, radius, color) {
        const rr = Math.max(0, R(radius));
        b.drawImage(shape(rr, color, true), R(cx) - rr, R(cy) - rr);
      },

      line(x1, y1, x2, y2, color) {
        let x = R(x1), y = R(y1);
        const xe = R(x2), ye = R(y2);
        const dx = Math.abs(xe - x), dy = -Math.abs(ye - y);
        const sx = x < xe ? 1 : -1, sy = y < ye ? 1 : -1;
        let err = dx + dy;
        b.fillStyle = color;
        for (let guard = 0; guard < 2048; guard++) {
          b.fillRect(x, y, 1, 1);
          if (x === xe && y === ye) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x += sx; }
          if (e2 <= dx) { err += dx; y += sy; }
        }
      },

      sprite(name, cx, cy, o) {
        const opt = o || {};
        const s = CB.Art.sprite(name);
        const sc = opt.scale || 1;
        const img = opt.white ? (opt.flip ? s.whiteFlip : s.white) : opt.flip ? s.flip : s.normal;
        const w = s.w * sc;
        const h = s.h * sc;
        const x = R(cx - w / 2);
        const y = R(cy - h / 2);
        withAlpha(opt.alpha == null ? 1 : opt.alpha, () => {
          if (opt.flipY) {
            b.save();
            b.translate(x, y + h);
            b.scale(1, -1);
            b.drawImage(img, 0, 0, w, h);
            b.restore();
          } else b.drawImage(img, x, y, w, h);
        });
      },

      measure(str, scale) {
        return CB.Font.measure(String(str), scale || 1);
      },

      text(str, x, y, o) {
        const opt = o || {};
        const s = String(str);
        if (!s) return;
        const sc = opt.scale || 1;
        const img = textImage(s, opt.color || '#FFFFFF', sc);
        let tx = R(x);
        if (opt.align === 'center') tx = R(x - img.width / 2);
        else if (opt.align === 'right') tx = R(x - img.width);
        const ty = R(y);
        withAlpha(opt.alpha == null ? 1 : opt.alpha, () => {
          if (opt.shadow) b.drawImage(textImage(s, opt.shadow, sc), tx + sc, ty + sc);
          b.drawImage(img, tx, ty);
        });
      },

      alpha(a, fn) {
        withAlpha(a, fn);
      },

      shaken(dx, dy, fn) {
        b.save();
        b.translate(R(dx), R(dy));
        try {
          fn();
        } finally {
          b.restore();
        }
      },
    };
    return r;
  };
})(window.CB);
```

- [ ] **Step 4: Run tests.** Run `node --test tests/render.test.js`. Expected: 5 PASS.
- [ ] **Step 5: Commit (orchestrator).** `git add src/art/render.js tests/render.test.js && git commit -m "feat: pixel renderer with integer scaling and cached text"`

---

### Task 6: Input and fixed-step loop

**Files:**
- Create: `src/core/input.js`, `src/core/loop.js`
- Test: `tests/platform.test.js`

**Interfaces:**
- Consumes: `renderer.toInternal`.
- Produces:
  - `CB.createInput({ canvas, renderer, win = window }) → { sample() → InputState, peekAim() → {x, y}, releaseAll(), dispose() }`.
  - `CB.createLoop({ update(dt), render(alpha), onError(err), now?, raf?, caf? }) → { start(), stop(), running }`.
  - `CB.LOOP = { MAX_STEPS: 5, MAX_FRAME: 0.25 }`.

- [ ] **Step 1: Write the failing test `tests/platform.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function fakeTarget() {
  const handlers = {};
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    fire(type, ev) { for (const fn of handlers[type] || []) fn(Object.assign({ preventDefault() {}, repeat: false }, ev)); },
    focus() {},
  };
}
function makeInput() {
  const CB = H.load(['src/core/ns.js', 'src/core/math.js', 'src/core/input.js']);
  const win = fakeTarget();
  const canvas = fakeTarget();
  const renderer = { toInternal: (x, y) => ({ x: x / 4, y: y / 4 }) };
  const input = CB.createInput({ canvas, renderer, win });
  return { CB, win, canvas, input };
}

test('input: WASD and arrows move, clamped to -1..1', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'KeyW' });
  win.fire('keydown', { code: 'ArrowUp' });
  win.fire('keydown', { code: 'KeyD' });
  const s = input.sample();
  assert.equal(s.moveX, 1);
  assert.equal(s.moveY, -1);
  win.fire('keyup', { code: 'KeyW' });
  win.fire('keyup', { code: 'ArrowUp' });
  assert.equal(input.sample().moveY, 0);
});

test('input: edges fire once per press; key repeat does not retrigger', () => {
  const { win, input } = makeInput();
  win.fire('keydown', { code: 'Space' });
  assert.equal(input.sample().dash, true);
  assert.equal(input.sample().dash, false);
  win.fire('keydown', { code: 'Space', repeat: true });
  assert.equal(input.sample().dash, false);
  win.fire('keydown', { code: 'Digit2' });
  win.fire('keydown', { code: 'KeyM' });
  win.fire('keydown', { code: 'Escape' });
  const s = input.sample();
  assert.equal(s.choice, 2);
  assert.equal(s.mute, true);
  assert.equal(s.pause, true);
  assert.equal(input.sample().choice, 0);
});

test('input: left mouse holds fire and confirms once; right mouse dashes; aim maps through renderer', () => {
  const { win, canvas, input } = makeInput();
  canvas.fire('mousedown', { button: 0, clientX: 400, clientY: 200 });
  let s = input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.confirm, true);
  assert.equal(s.aimX, 100);
  assert.equal(s.aimY, 50);
  s = input.sample();
  assert.equal(s.fire, true);
  assert.equal(s.confirm, false);
  win.fire('mouseup', { button: 0 });
  assert.equal(input.sample().fire, false);
  canvas.fire('mousedown', { button: 2, clientX: 0, clientY: 0 });
  assert.equal(input.sample().dash, true);
});

test('input: blur releases held keys and fire', () => {
  const { win, canvas, input } = makeInput();
  win.fire('keydown', { code: 'KeyA' });
  canvas.fire('mousedown', { button: 0, clientX: 1, clientY: 1 });
  win.fire('blur', {});
  const s = input.sample();
  assert.equal(s.moveX, 0);
  assert.equal(s.fire, false);
});

test('loop: fixed steps, catch-up capped at 5, dt clamped to 0.25 s', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/loop.js']);
  let now = 0;
  let cb = null;
  let updates = 0;
  let renders = 0;
  const loop = CB.createLoop({ update: () => updates++, render: () => renders++, onError: (e) => { throw e; }, now: () => now, raf: (f) => { cb = f; return 1; }, caf: () => {} });
  loop.start();
  now += 1000 / 60 + 0.01;
  cb(now);
  assert.equal(updates, 1);
  assert.equal(renders, 1);
  now += 5000;
  cb(now);
  assert.equal(updates, 1 + 5, 'capped at MAX_STEPS');
  now += 1000 / 60 + 0.01;
  cb(now);
  assert.equal(updates, 7, 'accumulator was reset after the cap');
});

test('loop: an exception stops the loop and reaches onError', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/loop.js']);
  let now = 0;
  let cb = null;
  let caught = null;
  const loop = CB.createLoop({ update: () => { throw new Error('boom'); }, render() {}, onError: (e) => { caught = e; }, now: () => now, raf: (f) => { cb = f; return 1; }, caf: () => {} });
  loop.start();
  now += 20;
  cb(now);
  assert.equal(caught && caught.message, 'boom');
  assert.equal(loop.running, false);
});
```

- [ ] **Step 2: Run to verify failure.** Run `node --test tests/platform.test.js`. Expected: FAIL (ENOENT).

- [ ] **Step 3: Create `src/core/input.js`**

```js
// Keyboard + mouse → per-tick InputState. Held state persists; edges are consumed by sample().
(function (CB) {
  'use strict';
  const MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  const CHOICE = { Digit1: 1, Numpad1: 1, Digit2: 2, Numpad2: 2, Digit3: 3, Numpad3: 3 };

  CB.createInput = function (o) {
    const win = o.win || window;
    const canvas = o.canvas;
    const renderer = o.renderer;
    const held = new Set();
    let fireHeld = false;
    let hasMouse = false;
    let mx = 0;
    let my = 0;
    const edges = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false };

    function onKeyDown(e) {
      if (PREVENT[e.code] && e.preventDefault) e.preventDefault();
      if (e.repeat) return;
      held.add(e.code);
      switch (e.code) {
        case 'Space': case 'ShiftLeft': case 'ShiftRight': edges.dash = true; break;
        case 'Escape': case 'KeyP': edges.pause = true; break;
        case 'KeyM': edges.mute = true; break;
        case 'Enter': case 'NumpadEnter': edges.confirm = true; break;
        case 'KeyR': edges.retry = true; break;
        case 'KeyQ': edges.quit = true; break;
        default: if (CHOICE[e.code]) edges.choice = CHOICE[e.code];
      }
    }
    function onKeyUp(e) { held.delete(e.code); }
    function onMouseDown(e) {
      hasMouse = true;
      mx = e.clientX;
      my = e.clientY;
      if (e.button === 0) {
        fireHeld = true;
        edges.confirm = true;
      } else if (e.button === 2) edges.dash = true;
      if (canvas.focus) canvas.focus();
    }
    function onMouseUp(e) { if (e.button === 0) fireHeld = false; }
    function onMouseMove(e) {
      hasMouse = true;
      mx = e.clientX;
      my = e.clientY;
    }
    function releaseAll() {
      held.clear();
      fireHeld = false;
    }
    function onContext(e) { if (e.preventDefault) e.preventDefault(); }

    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', releaseAll);
    win.addEventListener('mouseup', onMouseUp);
    win.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContext);

    function peekAim() {
      if (!hasMouse) return { x: CB.W / 2, y: CB.H / 2 - 40 };
      return renderer.toInternal(mx, my);
    }

    return {
      sample() {
        let x = 0;
        let y = 0;
        for (const code of held) {
          const m = MOVE[code];
          if (m) {
            x += m[0];
            y += m[1];
          }
        }
        const a = peekAim();
        const s = {
          moveX: Math.max(-1, Math.min(1, x)), moveY: Math.max(-1, Math.min(1, y)),
          aimX: a.x, aimY: a.y, fire: fireHeld,
          dash: edges.dash, pause: edges.pause, mute: edges.mute, confirm: edges.confirm,
          choice: edges.choice, retry: edges.retry, quit: edges.quit,
        };
        edges.dash = edges.pause = edges.mute = edges.confirm = edges.retry = edges.quit = false;
        edges.choice = 0;
        return s;
      },
      peekAim,
      releaseAll,
      dispose() {
        win.removeEventListener('keydown', onKeyDown);
        win.removeEventListener('keyup', onKeyUp);
        win.removeEventListener('blur', releaseAll);
        win.removeEventListener('mouseup', onMouseUp);
        win.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContext);
      },
    };
  };
})(window.CB);
```

- [ ] **Step 4: Create `src/core/loop.js`**

```js
// Fixed 60 Hz simulation with rAF rendering; catch-up capped; any exception stops the loop.
(function (CB) {
  'use strict';
  const MAX_STEPS = 5;
  const MAX_FRAME = 0.25;
  CB.LOOP = { MAX_STEPS, MAX_FRAME };

  CB.createLoop = function (o) {
    const now = o.now || (() => performance.now());
    const raf = o.raf || ((f) => requestAnimationFrame(f));
    const caf = o.caf || ((id) => cancelAnimationFrame(id));
    let acc = 0;
    let last = 0;
    let running = false;
    let id = 0;

    function frame() {
      if (!running) return;
      try {
        const t = now();
        let dt = (t - last) / 1000;
        last = t;
        if (dt > MAX_FRAME) dt = MAX_FRAME;
        if (dt < 0) dt = 0;
        acc += dt;
        let steps = 0;
        while (acc >= CB.DT && steps < MAX_STEPS) {
          o.update(CB.DT);
          acc -= CB.DT;
          steps++;
        }
        if (steps === MAX_STEPS) acc = 0;
        o.render(acc / CB.DT);
      } catch (err) {
        running = false;
        o.onError(err);
        return;
      }
      id = raf(frame);
    }

    return {
      start() {
        if (running) return;
        running = true;
        last = now();
        acc = 0;
        id = raf(frame);
      },
      stop() {
        running = false;
        caf(id);
      },
      get running() {
        return running;
      },
    };
  };
})(window.CB);
```

> Loop test arithmetic: the first frame advances 16.68 ms (one step, acc ≈ 0.01 ms). The second jumps 5 s, which clamps to 0.25 s = 15 steps' worth and caps at 5, then `acc = 0`. The third adds 16.68 ms, which is one step, for 7 updates total.

- [ ] **Step 5: Run tests.** Run `node --test tests/platform.test.js`. Expected: 6 PASS.
- [ ] **Step 6: Commit (orchestrator).** `git add src/core/input.js src/core/loop.js tests/platform.test.js && git commit -m "feat: input sampling and fixed-step loop"`

---

### Task 7: Boot (`main.js`) and the play scene

**Files:**
- Create: `src/main.js`, `src/scenes/play.js`
- Test: `tests/scenes.test.js`

**Interfaces:**
- Consumes:
  - `CB.createRenderer`, `CB.createInput`, `CB.createLoop`, `CB.createRun`, `CB.RUN_COMBAT_STATES`, `CB.Patches.DEFS`.
  - `CB.Audio.{init, play, handleEvents, toggleMute}` (Task 9).
  - `CB.WorldDraw.draw` (Task 19).
  - `CB.Screens.hud.{draw, cursor}` and the `CB.Screens.{stageIntro, waveBanner, bossWarn, bossDead, patchPick, gameOver, victory, pause, panic}.draw` screens (Tasks 19–20).
  - `CB.Screens.patchPick.cardAt(x, y) → index | -1` (Task 20).
  - `CB.Scenes.title` (Task 21).
- Produces:
  - `CB.parseDebugHash(hash) → { startStage?, skipWaves?, god?, seed?, speed?, patches?, hitboxes?, active }`.
  - `CB.game = { r, input, debug, scene, sceneName, t, go(name, data) }` and `CB.debug = { game, run }`.
  - `CB.Scenes.play = { enter(game, data), update(dt, input), draw(r, t), onBlur(), run, paused, ui }`, where `data = { runOpts?, restore? }`.
- Scene contract for every scene: `enter(game, data)`, `update(dt, input)`, `draw(r, t)`, optional `onBlur()`.

- [ ] **Step 1: Write the failing test `tests/scenes.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/scenes/play.js', 'src/main.js');
  CB.Audio = { play() {}, handleEvents() {}, init() {}, toggleMute() {} };
  CB.Screens.patchPick = { cardAt: () => 1, draw() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    if (!CB.Enemies[k]) CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  }
  const visits = [];
  const game = { debug: { speed: 1 }, input: { peekAim: () => ({ x: 0, y: 0 }) }, go(name, data) { visits.push([name, data]); } };
  return { CB, game, visits };
}

test('parseDebugHash: parses stage, boss, god, seed, speed, patches, hitboxes', () => {
  const { CB } = setup();
  const d = CB.parseDebugHash('#stage=3&boss&god&seed=42&speed=2&patches=spread,spread,nope,dash&hitboxes');
  assert.equal(d.startStage, 2);
  assert.equal(d.skipWaves, true);
  assert.equal(d.god, true);
  assert.equal(d.seed, 42);
  assert.equal(d.speed, 2);
  assert.deepEqual(H.plain(d.patches), { spread: 2, dash: 1 });
  assert.equal(d.hitboxes, true);
  assert.equal(d.active, true);
  assert.equal(CB.parseDebugHash('').active, false);
  assert.equal(CB.parseDebugHash('#stage=99').startStage, 3);
  assert.equal(CB.parseDebugHash('#speed=1000').speed, 8);
});

test('play: onBlur pauses in combat states and pause toggles', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  assert.equal(play.paused, false);
  play.onBlur();
  assert.equal(play.paused, true);
  const t0 = play.run.time;
  play.update(CB.DT, H.makeInput());
  assert.equal(play.run.time, t0, 'no simulation while paused');
  play.update(CB.DT, H.makeInput({ pause: true }));
  assert.equal(play.paused, false);
  play.update(CB.DT, H.makeInput());
  assert.ok(play.run.time > t0);
});

test('play: quit from pause returns to title', () => {
  const { CB, game, visits } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1 } });
  play.update(CB.DT, H.makeInput({ pause: true }));
  play.update(CB.DT, H.makeInput({ quit: true }));
  assert.equal(visits[0][0], 'title');
});

test('play: clicking a patch card picks it after the input lock', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { seed: 1, skipWaves: true } });
  CB.Bosses[play.run.world.stage.boss] = { create: () => ({ x: 0, y: 0, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} }) };
  for (let i = 0; i < 1200 && play.run.state !== 'patchPick'; i++) play.update(CB.DT, H.makeInput());
  assert.equal(play.run.state, 'patchPick');
  for (let i = 0; i < 40; i++) play.update(CB.DT, H.makeInput());
  const offered = play.run.offer[1];
  play.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(play.run.history[0], offered);
});

test('play: restore data carries deaths, time and history', () => {
  const { CB, game } = setup();
  const play = CB.Scenes.play;
  play.enter(game, { runOpts: { startStage: 2, patches: { rapid: 1 } }, restore: { deaths: 3, time: 99, history: ['rapid'] } });
  assert.equal(play.run.stageIndex, 2);
  assert.equal(play.run.deaths, 3);
  assert.equal(play.run.time, 99);
  assert.deepEqual(H.plain(play.run.history), ['rapid']);
});
```

- [ ] **Step 2: Run to verify failure.** Run `node --test tests/scenes.test.js`. Expected: FAIL (ENOENT).

- [ ] **Step 3: Create `src/scenes/play.js`**

```js
// Play scene: routes input to the run, handles pause/quit and patch clicks, layers world + HUD + overlays.
(function (CB) {
  'use strict';
  const EDGE_OFF = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false };
  const OVERLAY = {
    stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn',
    bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory',
  };

  CB.Scenes.play = {
    game: null,
    run: null,
    paused: false,
    ui: { hover: -1 },

    enter(game, data) {
      const d = data || {};
      this.game = game;
      const opts = Object.assign({ seed: Date.now() >>> 0 || 1 }, d.runOpts || {});
      this.run = CB.createRun(opts);
      if (d.restore) {
        this.run.deaths = d.restore.deaths | 0;
        this.run.time = +d.restore.time || 0;
        this.run.history = Array.isArray(d.restore.history) ? d.restore.history.slice() : [];
      }
      this.paused = false;
      this.ui.hover = -1;
    },

    onBlur() {
      if (this.run && CB.RUN_COMBAT_STATES[this.run.state]) this.paused = true;
    },

    update(dt, inp) {
      const run = this.run;
      const game = this.game;
      if (inp.pause && (this.paused || CB.RUN_COMBAT_STATES[run.state])) {
        this.paused = !this.paused;
        CB.Audio.play('uiSelect');
      }
      if (this.paused) {
        if (inp.quit) game.go('title');
        return;
      }
      this.ui.hover = run.state === 'patchPick' ? CB.Screens.patchPick.cardAt(inp.aimX, inp.aimY) : -1;
      if (run.state === 'patchPick' && inp.confirm && this.ui.hover >= 0) run.choosePatch(this.ui.hover);
      if (run.state === 'dead' && inp.quit) {
        game.go('title');
        return;
      }
      if (run.state === 'victory' && run.stateT > 1.5 && inp.confirm) {
        game.go('title');
        return;
      }
      const n = (game.debug && game.debug.speed) || 1;
      for (let i = 0; i < n; i++) CB.Audio.handleEvents(run.step(i === 0 ? inp : Object.assign({}, inp, EDGE_OFF)));
    },

    draw(r, t) {
      const run = this.run;
      const w = run.world;
      const sx = w.shake > 0 ? Math.round(Math.sin(t * 91) * w.shake) : 0;
      const sy = w.shake > 0 ? Math.round(Math.cos(t * 77) * w.shake) : 0;
      const hitboxes = !!(this.game.debug && this.game.debug.hitboxes);
      r.shaken(sx, sy, () => CB.WorldDraw.draw(r, w, t, { hitboxes }));
      if (w.flash > 0) r.alpha(Math.min(0.35, w.flash * 2), () => r.rect(0, 0, CB.W, CB.H, CB.Pal.C.hurt));
      CB.Screens.hud.draw(r, run, t);
      const ov = OVERLAY[run.state];
      if (ov) CB.Screens[ov].draw(r, run, t, this.ui);
      if (this.paused) CB.Screens.pause.draw(r, run, t);
      const a = this.game.input.peekAim();
      const pointer = this.paused || run.state === 'patchPick' || run.state === 'dead' || run.state === 'victory';
      CB.Screens.hud.cursor(r, a.x, a.y, pointer ? 'pointer' : 'cross', t);
    },
  };
})(window.CB);
```

- [ ] **Step 4: Create `src/main.js`**

```js
// Boot: renderer, input, audio unlock, scene manager, debug hash, crash screen, Artifact hot snapshot.
(function (CB) {
  'use strict';

  CB.parseDebugHash = function (hash) {
    const s = String(hash || '').replace(/^#/, '');
    const q = {};
    if (s) {
      for (const part of s.split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = decodeURIComponent(i < 0 ? part : part.slice(0, i));
        q[k] = i < 0 ? true : decodeURIComponent(part.slice(i + 1));
      }
    }
    const d = { active: Object.keys(q).length > 0 };
    if (q.stage != null) d.startStage = Math.max(0, Math.min(3, (parseInt(q.stage, 10) || 1) - 1));
    if (q.boss) d.skipWaves = true;
    if (q.god) d.god = true;
    if (q.seed != null) d.seed = parseInt(q.seed, 10) >>> 0;
    if (q.speed != null) d.speed = Math.max(1, Math.min(8, parseInt(q.speed, 10) || 1));
    if (q.patches) {
      d.patches = {};
      for (const id of String(q.patches).split(',')) {
        const def = CB.Patches.DEFS[id];
        if (def) d.patches[id] = Math.min(def.max, (d.patches[id] || 0) + 1);
      }
    }
    if (q.hitboxes) d.hitboxes = true;
    return d;
  };

  if (window.CB_NO_BOOT) return;

  function boot(hotData) {
    const canvas = document.getElementById('game');
    const r = CB.createRenderer(canvas);
    r.resize();
    window.addEventListener('resize', () => r.resize());
    const input = CB.createInput({ canvas, renderer: r });
    const debug = CB.parseDebugHash(location.hash);
    let loop = null;

    const game = {
      r, input, debug, scene: null, sceneName: '', t: 0,
      go(name, data) {
        game.scene = CB.Scenes[name];
        game.sceneName = name;
        input.releaseAll();
        game.scene.enter(game, data || {});
      },
    };
    CB.game = game;
    CB.debug = {
      game,
      get run() {
        return game.scene && game.scene.run;
      },
    };

    let crashed = false;
    function crash(err) {
      if (crashed) return;
      crashed = true;
      const e = err instanceof Error ? err : new Error(String(err));
      console.error(e);
      if (loop) loop.stop();
      try {
        r.ctx.setTransform(1, 0, 0, 1, 0, 0);
        r.ctx.globalAlpha = 1;
        CB.Screens.panic.draw(r, e);
        r.present();
      } catch (e2) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FF6B6B';
        ctx.font = '16px monospace';
        ctx.fillText('KERNEL PANIC: ' + e.message, 16, 32);
        ctx.fillText('Press R to reload', 16, 56);
      }
      window.addEventListener('keydown', (ev) => {
        if (ev.code === 'KeyR') location.reload();
      });
    }
    window.addEventListener('error', (ev) => crash(ev.error || new Error(ev.message)));
    window.addEventListener('unhandledrejection', (ev) => crash(ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason))));

    const unlock = () => CB.Audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const blur = () => {
      input.releaseAll();
      if (game.scene && game.scene.onBlur) game.scene.onBlur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) blur();
    });

    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) {
      hot.snapshot(() => {
        const run = game.sceneName === 'play' && game.scene.run;
        return run ? { stageIndex: run.stageIndex, patches: run.patches, deaths: run.deaths, time: run.time, history: run.history } : {};
      });
    }

    if (debug.active) game.go('play', { runOpts: debug });
    else if (hotData && hotData.stageIndex != null) {
      game.go('play', { runOpts: { startStage: hotData.stageIndex, patches: hotData.patches || {} }, restore: hotData });
    } else game.go('title');

    loop = CB.createLoop({
      update(dt) {
        game.t += dt;
        const inp = input.sample();
        if (inp.mute) CB.Audio.toggleMute();
        game.scene.update(dt, inp);
      },
      render() {
        game.scene.draw(r, game.t);
        r.present();
      },
      onError: crash,
    });
    loop.start();
    canvas.focus();
  }

  function start(data) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(data));
    else boot(data);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})(window.CB);
```

- [ ] **Step 5: Run tests.** Run `node --test tests/scenes.test.js`. Expected: 5 PASS.
- [ ] **Step 6: Commit (orchestrator).** `git add src/main.js src/scenes/play.js tests/scenes.test.js && git commit -m "feat: boot, debug hash, crash capture and play scene"`

---

## Phase A2 — Feature mechanics (sequential, after Task 7; rev 2)

These tasks add the rev-2 mechanics (spec §2.11) to the Phase A files. They run one at a time, in order, because several of them edit the same files (`world.js`, `player.js`, `stageRunner.js`, `play.js`). Each task:
- lists the exact hook points it adds;
- keeps every existing test green (`node --test`);
- guards every call into an optional module with `if (CB.X)`, so the Phase A test lists (`GAME_BASE`) keep working without the new files.

### Task 7A: Impact table, heartbeat, flash colour

**Files:**
- Modify: `src/game/fx.js`, `src/game/player.js`.
- Test: `tests/impact.test.js`.

**Spec:**
- **`fx.js`** defines `CB.IMPACT`:

  ```js
  CB.IMPACT = {
    bigKill:     { stop: 0.04, shake: 1.5 },
    bossPartDie: { stop: 0.10, shake: 3 },
    bossPhase:   { stop: 0.14, shake: 4, flash: 0.10, color: '#FFFFFF' },
    bossDie:     { stop: 0.08, shake: 6, flash: 0.25, color: '#FFFFFF' },
    beam:        { shake: 2 },
    compact:     { stop: 0.06, shake: 3, flash: 0.12, color: '#FFD27A' },
  };
  ```

  It also defines `CB.Fx.impact(w, key)`:
  - if `!w.god && k.stop`: `w.hitstop = Math.min(0.25, Math.max(w.hitstop, k.stop))`;
  - if `k.shake`: `w.addShake(k.shake)`;
  - if `k.flash`: `w.flash = Math.max(w.flash, k.flash); w.flashColor = k.color`.
- **`Fx.consume` calls `impact`** for:

  | Event | Impact key |
  |---|---|
  | `enemyDie` with `!silent && !boss && r >= 6` | `bigKill` |
  | `enemyDie` with `boss && !silent` | `bossPartDie` |
  | `bossPhase` | `bossPhase` |
  | `bossDie` | `bossDie` |
  | `beam` | `beam` |
  | `compact` | `compact` |

  Ordinary `hit`, `clink` and small kills get no impact.
- **`Player.hurt`** sets `w.flashColor = CB.Pal.C.hurt` next to `w.flash = 0.15`.
- **Heartbeat** (`player.js`): new player fields `beatT: 0.3, beatPulse: 0, lowWarned: false`. In `update`, right after the `if (p.dead) return;` guard:

  ```js
  if (p.hearts === 1 && !w.god) {
    if (!p.lowWarned) {
      p.lowWarned = true;
      w.emit('text', { x: p.x, y: p.y - 12, text: 'context low', color: CB.Pal.C.hurt });
    }
    p.beatT -= dt;
    if (p.beatT <= EPS) {
      p.beatT += 0.85;
      p.beatPulse = 1;
      w.emit('heartbeat', { x: p.x, y: p.y });
    }
  } else {
    p.beatT = 0.3;
    p.lowWarned = false;
  }
  p.beatPulse = Math.max(0, p.beatPulse - dt * 5);
  ```

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup(god) {
  const CB = H.loadWith();
  const w = CB.createWorld({ seed: 5, god: !!god });
  return { CB, w };
}
// Events must be emitted inside world.step to reach Fx.consume.
function emitInStep(CB, w, evs) {
  CB.Enemies.emitter = {
    create: (w2, x, y) => CB.makeEnemy('emitter', x, y, { hp: 1, contact: false, targetable: false, regular: false }),
    update(e, w2) {
      if (!e.data.done) {
        e.data.done = true;
        for (const ev of evs) w2.emit(ev.type, ev);
      }
    },
    draw() {},
  };
  w.spawnEnemy('emitter', 20, 30);
  H.stepN(w, 1, H.makeInput());
}

test('impact: bossPhase sets hitstop 0.14, a white flash and shake; time freezes then resumes', () => {
  const { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'bossPhase', x: 100, y: 60, phase: 2 }]);
  assert.ok(Math.abs(w.hitstop - 0.14) < 1e-9, `hitstop ${w.hitstop}`);
  assert.ok(w.flash > 0.05);
  assert.equal(w.flashColor, '#FFFFFF');
  assert.ok(w.shake > 0);
  const t0 = w.time;
  H.stepN(w, 8, H.makeInput());
  assert.equal(w.time, t0);
  H.stepN(w, 3, H.makeInput());
  assert.ok(w.time > t0);
});

test('impact: hits, clinks and small kills add nothing; an r=6 kill adds 0.04', () => {
  let { CB, w } = setup();
  emitInStep(CB, w, [{ type: 'hit', x: 1, y: 1 }, { type: 'clink', x: 1, y: 1 }, { type: 'enemyDie', x: 1, y: 1, kind: 'k', r: 5, boss: false }]);
  assert.equal(w.hitstop, 0);
  assert.equal(w.shake, 0);
  ({ CB, w } = setup());
  emitInStep(CB, w, [{ type: 'enemyDie', x: 1, y: 1, kind: 'k', r: 6, boss: false }]);
  assert.ok(Math.abs(w.hitstop - 0.04) < 1e-9);
  assert.ok(w.shake > 1);
});

test('impact: stacked boss events never exceed hitstop 0.25 or shake 6', () => {
  const { CB, w } = setup();
  const evs = [];
  for (let i = 0; i < 10; i++) evs.push({ type: 'bossPhase', x: 1, y: 1, phase: 2 }, { type: 'bossDie', x: 1, y: 1 });
  emitInStep(CB, w, evs);
  assert.ok(w.hitstop <= 0.25 + 1e-9);
  assert.ok(w.shake <= 6);
});

test('impact: god mode never freezes', () => {
  const { CB, w } = setup(true);
  emitInStep(CB, w, [{ type: 'bossPhase', x: 1, y: 1, phase: 2 }]);
  assert.equal(w.hitstop, 0);
});

test('heartbeat: at 1 heart beats at ~0.3 s then every 0.85 s; "context low" fires once', () => {
  const { w } = setup();
  w.player.hearts = 1;
  H.stepN(w, 180, H.makeInput());
  const beats = w.events.filter((e) => e.type === 'heartbeat').length;
  assert.ok(beats >= 3 && beats <= 4, `beats ${beats}`);
  assert.equal(w.events.filter((e) => e.type === 'text' && e.text === 'context low').length, 1);
});

test('heartbeat: none at 2 hearts; re-arms after healing', () => {
  const { w } = setup();
  w.player.hearts = 2;
  H.stepN(w, 120, H.makeInput());
  assert.equal(w.events.filter((e) => e.type === 'heartbeat').length, 0);
  w.player.hearts = 1;
  H.stepN(w, 30, H.makeInput());
  w.player.hearts = 2;
  H.stepN(w, 5, H.makeInput());
  w.player.hearts = 1;
  H.stepN(w, 5, H.makeInput());
  assert.equal(w.events.filter((e) => e.type === 'text' && e.text === 'context low').length, 2);
});

test('impact: hurt sets a red flash colour', () => {
  const { CB, w } = setup();
  CB.Player.hurt(w.player, w, null);
  assert.equal(w.flashColor, CB.Pal.C.hurt);
});
```

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 7B: Context meter, /compact, graze and chain

**Files:**
- Create: `src/game/compact.js`.
- Modify: `src/game/world.js`, `src/game/player.js`, `src/game/stageRunner.js` (`NEUTRAL` gets `compact: false, music: false, keys: []`).
- Test: `tests/compact.test.js`.

**Spec.** `compact.js` defines:

```js
CB.Compact = {
  MAX: 60, WAVE_SPEED: 520, WAVE_RMAX: 360, DMG_REGULAR: 3, DMG_BOSS: 5,
  GRAZE: 0.75, PERFECT: 3, GRAZE_RATE: 4.5, GRAZE_BAND: 6, CHAIN_T: 1.5, CHAIN_CAP: 20, BANNER_T: 1.0,
  charge(w, n), onBoltHit(w, applied), onHurt(w), cast(w) → bool, update(w, dt), graze(w, b, overlapping), draw(w, r, t),
};
```

**World state** (added in `createWorld`):
- `context: { value: 0, max: 60, announced: false }`
- `chain: { n: 0, t: 0, mul: 1 }`
- `grazeTokens: 4.5`, `compactWave: null`, `compactBannerT: 0`
- `stats` gains `maxChain: 0, compacts: 0, grazes: 0`.

**`charge(w, n)`:**
- `value = min(max, value + n)`.
- On reaching max when `!announced`: set `announced = true` and emit `compactReady` with the player's x, y.

**`onBoltHit(w, applied)`:**
- `n++`, `t = CHAIN_T`, `mul = 1 + min(n, 20)/20`, and `stats.maxChain = max(…)`.
- Then `charge(w, applied * mul)`.
- Called from `world.damageEnemy` when `applied > 0 && src && src.dmg != null && !src.compact`.

**`onHurt(w)`:** `chain.n = 0; chain.t = 0; chain.mul = 1`. Called from `Player.hurt` on a real (non-god) heart loss.

**`cast(w)`:**
- Refused (returns false) when any of these hold: `p.dead`, `value < max`, `w.compactWave`, or `(w.boss && w.boss.defeated)`.
- Otherwise:
  - `value = 0`, `announced = false`;
  - `p.invuln = max(p.invuln, 0.5)`;
  - `w.compactWave = { x: p.x, y: p.y, r: 0, hits: [] }` and `w.compactBannerT = 1.0`;
  - `stats.compacts++`, emit `compact` with x, y.
- Called from `Player.update` when `input.compact`, after the timers are decremented and before movement.

**`update(w, dt)`:** called in `world.step` right after `CB.Projectiles.update`.
1. **Chain:** `chain.t -= dt`. At `≤ 0`, set `n = 0` and `mul = 1`.
2. **Graze tokens:** `grazeTokens = min(4.5, grazeTokens + 4.5*dt)`.
3. **Banner:** `compactBannerT = max(0, compactBannerT - dt)`.
4. **Wave:** if a wave exists:
   - `r += 520*dt`.
   - For each live, visible, targetable enemy not in `hits` with `dist ≤ r + e.r`: push it to `hits`, then call `w.damageEnemy(e, e.boss ? 5 : 3, { compact: true })`.
   - For each live enemy bullet within `r`: `b.dead = true` and `CB.Fx.spark(w, b.x, b.y, CB.Pal.C.gold, 1, 20, 0.2)`.
   - For each puddle within `r`: `dead = true`.
   - When `r ≥ 360`: `w.compactWave = null`.

**`graze(w, b, overlapping)`:** called in `world` collide for each live enemy bullet that did not hurt the player, after the hit test:

```js
for (const eb of w.eBullets) {
  if (eb.dead) continue;
  const hit = M.circleHit(eb.x, eb.y, eb.r, p.x, p.y, p.r);
  if (hit && CB.Player.hurt(p, w, eb)) { eb.dead = true; continue; }
  if (CB.Compact) CB.Compact.graze(w, eb, hit);
}
```

- If `b.grazed`, return.
- **Overlapping:** if `p.invuln > 1e-9 && p.hurtT <= 1e-9` (dash protection, not hurt protection), it is a perfect graze:
  - `b.grazed = true`, `charge(w, 3)`, `stats.grazes++`;
  - emit `graze` with `{ x, y, perfect: true }`;
  - emit `text` "perfect" (gold).
  Any other overlap does nothing.
- **Not overlapping:** if `dist ≤ b.r + p.r + 6`:
  - `b.grazed = true`;
  - if `grazeTokens ≥ 0.75`: `grazeTokens -= 0.75`, `charge(w, 0.75)`, `stats.grazes++`, emit `graze` with x, y.

**`draw(w, r, t)`:** if a wave exists, draw a 2-ring gold/white expanding circle at radius `r` (alpha fading with `r / 360`). WorldDraw calls it (Task 19).

```js
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
```

> For `graze: a bullet passing within the band`, the bullet's centre passes 9 px from Clawd's centre. Contact needs ≤ 7 (2 + 5) and the band reaches 13, so it grazes once and never hits. The perfect-dash test places a stationary bullet on Clawd on the tick after a dash starts: dash protection is active, `hurtT` is 0, and Clawd has moved only about 4 px, so they still overlap.

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 7C: Elite "P0" bugs and hotfix pickups

**Files:**
- Create: `src/game/pickups.js`.
- Modify: `src/game/stages.js`, `src/game/waves.js`, `src/game/world.js`, `src/game/stageRunner.js`.
- Test: `tests/elites.test.js`.

**Spec:**
- **`stages.js`:** each stage gains `elites: [wave1Count, wave2Count]`. The values are `[0, 1]`, `[0, 1]`, `[1, 1]` and `[1, 2]` for stages 1–4.
- **`pickups.js`:**

  ```js
  CB.ELITE_KINDS = { syntaxError: true, memoryLeak: true, offByOne: true };
  CB.Pickups = {
    CAP: 6, LIFE: 8, RADIUS: 9,
    applyElite(e)   // e.elite = true; e.hp = e.maxHp = Math.ceil(e.hp * 1.75); e.timeScale = 1.2
    drop(w, x, y)   // push { kind: 'hotfix', x, y, life: 8, t: 0, dead: false } unless the CAP of 6 is reached
    update(w, dt)   // t += dt; life -= dt; expire at 0. Within RADIUS of a live player: heal +1 heart
                    // (≤ stats.maxHearts) and emit pickup {x, y, heal: true} plus text '+1 ♥'; at full health
                    // call CB.Compact && CB.Compact.charge(w, 15) and emit pickup {x, y, heal: false} plus
                    // text '+15 ctx'. Collected pickups die. Remove dead ones in place.
    draw(w, r, t)   // 9×8 'pickup_hotfix' heart sprite bobbing ±1.5 px at 2 Hz, a ring, and blinking at 8 Hz
                    // in the last 2 s
  };
  ```
- **`waves.js`:** `CB.createWaveSpawner(w, waveDef, eliteCount = 0)`.
  - After building `queue`, pick `eliteCount` distinct queue indices whose kind is in `CB.ELITE_KINDS`, using `w.rng.shuffle(candidates).slice(0, n)`.
  - Store them in a parallel boolean array `sp.eliteFlags`, aligned with `queue` and shifted with it. `queue` stays a plain array of kinds.
  - `spawnGroup` passes `{ elite: true }` in the opts for a flagged single spawn.
  - `CB.ELITE_KINDS` may be missing (Phase A tests): treat it as an empty set.
- **`world.js`:**
  - `createWorld` adds `pickups: []`.
  - `spawnEnemy`: after `create`, `if (o2 && o2.elite && CB.Pickups) CB.Pickups.applyElite(e);`.
  - Enemy update call: `CB.Enemies[e.kind].update(e, w, dt * (e.timeScale || 1));` (`e.t`/`e.stateT` still use the raw dt).
  - `killEnemy`: `if (!silent && e.elite && CB.Pickups) CB.Pickups.drop(w, e.x, e.y);`.
  - `step`: after `updateHazards`, `if (CB.Pickups) CB.Pickups.update(w, dt);`.
- **`stageRunner.js` `startWave(i)`:** `CB.createWaveSpawner(run.world, stage().waves[i], stage().elites ? stage().elites[i] : 0)`.
- Memory Leak splits never inherit `elite`.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/compact.js', 'src/game/pickups.js', 'src/game/stages.js', 'src/game/waves.js'];

function setup() {
  const CB = H.load(FILES);
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 4, contact: false }), update(e, w, dt) { e.x += 30 * dt; }, draw() {} };
  }
  const w = CB.createWorld({ seed: 21 });
  return { CB, w };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });

test('elites: stage data has two counts per stage', () => {
  const { CB } = setup();
  assert.deepEqual(H.plain(CB.STAGES.map((s) => s.elites)), [[0, 1], [0, 1], [1, 1], [1, 2]]);
});

test('elites: marking picks exactly N spawns from allowed kinds and leaves the queue unchanged', () => {
  const { CB, w } = setup();
  const def = [{ kind: 'offByOne', count: 3 }, { kind: 'raceCondition', count: 2 }, { kind: 'nullPointer', count: 2 }];
  const plain = CB.createWaveSpawner(w, def, 0);
  const sp = CB.createWaveSpawner(w, def, 2);
  assert.deepEqual(H.plain(sp.queue), H.plain(plain.queue));
  assert.equal(sp.eliteFlags.filter(Boolean).length, 2);
  sp.queue.forEach((k, i) => { if (sp.eliteFlags[i]) assert.equal(k, 'offByOne'); });
});

test('elites: hp is ceil(base × 1.75) and they move 20% farther', () => {
  const { w } = setup();
  const a = w.spawnEnemy('syntaxError', 40, 40);
  const b = w.spawnEnemy('syntaxError', 40, 80, { elite: true });
  assert.equal(b.hp, 7);
  assert.equal(b.maxHp, 7);
  assert.equal(b.elite, true);
  H.stepN(w, 60, idle);
  assert.ok(Math.abs((b.x - 40) - 1.2 * (a.x - 40)) < 0.5);
});

test('elites: a normal kill drops exactly one hotfix; a silent kill drops none', () => {
  const { w } = setup();
  const a = w.spawnEnemy('syntaxError', 40, 40, { elite: true });
  const b = w.spawnEnemy('syntaxError', 80, 40, { elite: true });
  w.damageEnemy(a, 99);
  w.killEnemy(b, true);
  assert.equal(w.pickups.length, 1);
});

test('hotfix: heals below max, gives +15 context at full, expires at 8 s, cap 6', () => {
  const { CB, w } = setup();
  const p = w.player;
  p.hearts = 3;
  CB.Pickups.drop(w, p.x, p.y);
  H.stepN(w, 1, idle);
  assert.equal(p.hearts, 4);
  assert.equal(w.pickups.length, 0);
  p.hearts = p.stats.maxHearts;
  CB.Pickups.drop(w, p.x, p.y);
  H.stepN(w, 1, idle);
  assert.equal(w.context.value, 15);
  CB.Pickups.drop(w, 30, 30);
  H.stepN(w, 8.1 * 60, idle);
  assert.equal(w.pickups.length, 0);
  for (let i = 0; i < 10; i++) CB.Pickups.drop(w, 30, 30);
  assert.equal(w.pickups.length, 6);
});

test('elites: the alive cap of 6 still holds with elites', () => {
  const { CB, w } = setup();
  const sp = CB.createWaveSpawner(w, [{ kind: 'syntaxError', count: 12 }], 3);
  let peak = 0;
  for (let i = 0; i < 60 * 20; i++) {
    w.step(CB.DT, idle());
    sp.update(CB.DT);
    peak = Math.max(peak, sp.alive());
  }
  assert.equal(peak, 6);
});
```

> In the hotfix test the player's movement (idle input) doesn't move Clawd, so the pickup at the player's own position is collected on the first tick.

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 7D: Run extras: tally, Boss Rush, YOLO, victory event, music hook

**Files:**
- Modify: `src/game/stageRunner.js`, `src/game/world.js`, `src/game/player.js`, `src/scenes/play.js`, `src/main.js` (debug keys).
- Test: `tests/modes.test.js`.

**Spec:**
- **`createRun` opts gain `bossRush` and `yolo`:**
  - `bossRush` sets `run.bossRush = true` and forces `skipWaves = true`.
  - `yolo` sets `run.yolo = true`, and every world is created with `mode: { yolo: true }`.
  - `run.mode` mirrors `{ bossRush, yolo }`.
- **`world.js`:** `w.mode = o.mode || {}`. In `fireEnemyBullet`, the speed is `(speed == null ? 80 : speed) * (w.mode.yolo ? 1.15 : 1)`.
- **`player.js`:** in `create`, if `w.mode && w.mode.yolo`, set `stats.maxHearts = Math.max(1, stats.maxHearts - 2)` and `p.hurtInvuln = 0.7`. Hearts start at the reduced max.
- **Tally:**
  - `run.squashed = {}` counts kinds. At the end of `run.step`, for every collected `enemyDie` event with `!boss && !silent && kind`, increment `squashed[kind]`.
  - `run.bossesFixed` increments on each `bossDie`.
  - `run.maxChain = Math.max(run.maxChain, w.stats.maxChain || 0)`.
  - `beginStage` snapshots `run.stageSquashed = {...run.squashed}`, and `retryStage` restores it.
- **Victory event:** entering `victory` pushes `{ type: 'victory' }` into `run.pending`, so it is returned by the next `step`.
- **Debug hash:** recognises `rush` and `yolo` (added to `KNOWN`), mapping to `bossRush: true` and `yolo: true`.
- **`play.js`:**
  - `enter` passes `data.runOpts` through unchanged (bossRush/yolo come from the title, Task 21).
  - In `update`, after stepping, call `if (CB.Music) CB.Music.update(this.run, false);`. While paused, call `CB.Music.update(this.run, true)` before returning.
  - When leaving to title, call `CB.Music && CB.Music.stop()`.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const CB = H.loadWith('src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js');
  CB.Enemies.dummy = { create: (w, x, y) => CB.makeEnemy('dummy', x, y, { hp: 1, contact: false }), update() {}, draw() {} };
  CB.Bosses.stub = { id: 'stub', name: 'S', tagline: 't', commitMsg: 'c', create: () => { const c = { x: 160, y: 60, hp: 1, maxHp: 1, phase: 1, defeated: false, update() { if (c.hp <= 0) c.defeated = true; }, draw() {} }; return c; } };
  CB.STAGES = [0, 1, 2, 3].map((i) => ({ id: 's' + i, n: i + 1, path: '~/s/', palette: 'src', boss: 'stub', waves: [[{ kind: 'dummy', count: 2 }], [{ kind: 'dummy', count: 1 }]], elites: [0, 0] }));
  return CB;
}
function until(run, pred, max, each) {
  for (let i = 0; i < max; i++) {
    if (pred(run)) return true;
    if (each) each(run);
    run.step(H.makeInput({ choice: run.state === 'patchPick' && run.stateT > 0.7 ? 1 : 0 }));
  }
  return pred(run);
}

test('modes: Boss Rush visits all four stages with only boss states and ends in victory', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, bossRush: true });
  const seen = new Set();
  until(run, (r) => r.state === 'victory', 60 * 60 * 3, (r) => {
    seen.add(r.state);
    if (r.state === 'boss') r.world.boss.hp = 0;
  });
  assert.equal(run.state, 'victory');
  assert.ok(!seen.has('wave') && !seen.has('waveBreak'));
  assert.equal(run.bossesFixed, 4);
});

test('modes: YOLO has 3 hearts, 15% faster bullets and 0.7 s hurt invuln; normal runs are unchanged', () => {
  const CB = setup();
  const y = CB.createRun({ seed: 1, yolo: true });
  assert.equal(y.world.player.hearts, 3);
  assert.equal(y.world.player.hurtInvuln, 0.7);
  const b = y.world.fireEnemyBullet(50, 50, 0);
  assert.ok(Math.abs(b.vx - 92) < 1e-9);
  const n = CB.createRun({ seed: 1 });
  assert.equal(n.world.player.hearts, 5);
  assert.ok(Math.abs(n.world.fireEnemyBullet(50, 50, 0).vx - 80) < 1e-9);
});

test('tally: counts non-boss non-silent kills by kind; a retry restores the stage-start tally', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1 });
  until(run, (r) => r.state === 'wave', 300);
  until(run, (r) => r.state === 'waveBreak', 600, (r) => { for (const e of r.world.enemies) if (!e.dead) r.world.killEnemy(e); });
  assert.equal(run.squashed.dummy, 2);
  const p = run.world.player;
  p.hearts = 1;
  CB.Player.hurt(p, run.world, null);
  until(run, (r) => r.state === 'dead', 200);
  until(run, (r) => r.stateT > 0.7, 60);
  run.step(H.makeInput({ retry: true }));
  assert.equal(run.squashed.dummy || 0, 0);
});

test('modes: victory emits a victory event', () => {
  const CB = setup();
  const run = CB.createRun({ seed: 1, startStage: 3, skipWaves: true });
  let got = false;
  for (let i = 0; i < 2000 && !got; i++) {
    if (run.state === 'boss') run.world.boss.hp = 0;
    got = run.step(H.makeInput()).some((e) => e.type === 'victory');
  }
  assert.ok(got);
});
```

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 7E: Unlocks, hats, secret codes (`unlocks.js`) and the unlock toast

**Files:**
- Create: `src/game/unlocks.js`.
- Modify: `src/scenes/play.js` (toast), `src/game/projectiles.js` (rainbow bolts).
- Test: `tests/unlocks.test.js`.

**Spec:**

```js
CB.Save = { get(key, def), set(key, value), _mem }   // JSON in localStorage under 'cb.' + key, every access in try/catch.
                                                      // _mem is a write-through cache: set() writes _mem[key] and then tries storage;
                                                      // get() returns _mem[key] if present, else the parsed storage value (cached), else def.
CB.HATS = [
  { id: 'loopcap', name: 'Loop cap', from: 'infiniteLoop' },
  { id: 'slime', name: 'Slime hat', from: 'memoryLeakBoss' },
  { id: 'branch', name: 'Branch beanie', from: 'mergeConflict' },
  { id: 'shades', name: 'Shades', from: 'heisenbug' },
  { id: 'crown', name: 'Crown', from: 'victory' },
  { id: 'sudo', name: 'sudo hat', from: 'yoloVictory' },
  { id: 'halo', name: 'Halo', from: 'konami' },
];
CB.Unlocks = {
  has(id), unlock(id) → true if new, list() → ids, hats() → unlocked hat ids in HATS order,
  hat() → selected hat id | null, setHat(id | null), cycleHat(dir) → id | null,   // cycles [null, ...hats()]
  onEvents(events, run) → newly unlocked ids,
};
CB.Secrets = { CODES: { konami: [...10 codes], ultrathink: [...10 codes] }, create() → { feed(code) → 'konami' | 'ultrathink' | null } };
```

**`onEvents` rules:**
- **`bossDie`:** unlock the hat whose `from === CB.STAGES[run.stageIndex].boss`.
- **`victory`:** unlock `crown` and `modes` (`modes` makes Boss Rush and YOLO appear on the title), plus `sudo` if `run.yolo`.

**Secrets:**
- `CODES.konami` = `ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight KeyB KeyA`, which unlocks `halo`.
- `CODES.ultrathink` = `KeyU KeyL KeyT KeyR KeyA KeyT KeyH KeyI KeyN KeyK`, which unlocks `rainbow`.
- The matcher keeps the last 12 codes and matches by suffix, so it fires once per completed sequence.

**`play.js`:** after each `run.step`:

```js
const fresh = CB.Unlocks ? CB.Unlocks.onEvents(evs, run) : [];
for (const id of fresh) {
  const hat = CB.HATS.find((h) => h.id === id);
  if (hat) this.toast = { text: 'NEW HAT: ' + hat.name, t: 2.5 };
}
```

- `toast.t` decays in `update`.
- `draw` shows it centred at y 168 in gold, with a dark band behind.
- Each unlock pushes `{ type: 'unlock' }` to the audio handler.

**`projectiles.js` draw:** `if (CB.Unlocks && CB.Unlocks.has('rainbow'))` draw bolts as discs of radius `b.r` coloured `RAINBOW[Math.floor(b.t * 20) % 6]` (red, ember, yellow, green, cyan, purple from `CB.Pal.C`) with a white centre pixel. Otherwise draw the sprite.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/stages.js', 'src/game/unlocks.js'];

function load(storage) {
  const { CB, sandbox } = H.load(FILES, { returnSandbox: true });
  if (storage === 'throw') Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('blocked'); } });
  return CB;
}

test('save: works with a throwing localStorage via the memory fallback', () => {
  const CB = load('throw');
  CB.Save.set('x', { a: 1 });
  assert.equal(CB.Save.get('x').a, 1);
  assert.equal(CB.Unlocks.unlock('crown'), true);
  assert.equal(CB.Unlocks.unlock('crown'), false);
  assert.equal(CB.Unlocks.has('crown'), true);
});

test('unlocks: bossDie in stage i gives that boss hat; victory gives crown and modes (+ sudo in YOLO)', () => {
  const CB = load();
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: 1 })), ['slime']);
  assert.deepEqual(H.plain(CB.Unlocks.onEvents([{ type: 'bossDie' }], { stageIndex: 1 })), []);
  const v = H.plain(CB.Unlocks.onEvents([{ type: 'victory' }], { stageIndex: 3, yolo: true }));
  assert.ok(v.includes('crown') && v.includes('modes') && v.includes('sudo'));
});

test('unlocks: hat cycling goes through none and the unlocked hats in order', () => {
  const CB = load();
  CB.Unlocks.unlock('shades');
  CB.Unlocks.unlock('loopcap');
  assert.equal(CB.Unlocks.hat(), null);
  assert.equal(CB.Unlocks.cycleHat(1), 'loopcap');
  assert.equal(CB.Unlocks.cycleHat(1), 'shades');
  assert.equal(CB.Unlocks.cycleHat(1), null);
  assert.equal(CB.Unlocks.cycleHat(-1), 'shades');
});

test('secrets: konami and ultrathink fire once on completion, even mid-stream', () => {
  const CB = load();
  const m = CB.Secrets.create();
  let hits = [];
  for (const c of ['KeyX', ...CB.Secrets.CODES.konami]) { const r = m.feed(c); if (r) hits.push(r); }
  assert.deepEqual(hits, ['konami']);
  hits = [];
  for (const c of ['KeyQ', 'KeyU', ...CB.Secrets.CODES.ultrathink]) { const r = m.feed(c); if (r) hits.push(r); }
  assert.deepEqual(hits, ['ultrathink']);
  assert.equal(m.feed('KeyA'), null);
});
```

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

---

## Phase B — Content (parallel; each task owns only its listed files)

Rules for every Phase B task:
- **Pixel-art bar:**
  - A 1 px `k` (ink) outline around every silhouette, at least 2 shades per body colour, and readable at 1× scale.
  - Animate with 2–4 frames named `<sprite>_0`, `<sprite>_1`, ….
  - Draw the hit flash with `r.sprite(name, x, y, { white: e.hitFlash > 0 })`.
- **Sprite location:** sprites are defined at the top of the module file with `CB.Art.defineSprite`, using palette chars from `CB.Pal.CHARS` (Task 2).
- **Determinism:** logic uses `w.rng` only. Draw functions may use `t` and `e.t` for animation but never RNG.
- **Bullets:** emit `enemyShoot` (once per volley) whenever an enemy fires.
- **Tests:** load `[...H.GAME_BASE, <deps>, <your file>]` and use god worlds (`createWorld({ seed, god: true })`) when contact damage could interfere.
- **Test edits:** never edit another task's file or test. If your test needs a helper, define it inside your test file.

### Task 8: Bitmap font

**Files:** Create `src/art/font.js`. Test: `tests/font.test.js`.

**Interfaces:**
- `CB.Font = { GLYPHS, CELL_H: 7, LINE_H: 9, measure(str, scale = 1), draw(ctx, str, x, y, color, scale = 1), wrap(str, maxWidth, scale = 1) → string[], has(ch) }`.

**Glyph format:**
- 7 strings of equal width (1–5 chars), `#` for lit and `.` for unlit. Baseline is row 6.
- Lowercase sits in rows 2–6. `g j p q y` don't descend; draw them raised so they still read.
- Advance is the glyph width + 1 px. Space is 3 px wide. Unknown characters render as `?`.

**Required characters:** `A–Z a–z 0–9`, space, `. , : ; ! ? ' " - _ / \ ( ) [ ] { } < > = + * # % & @ ~ | ^ $` and backtick, plus `✓ ⚠ ✻ ♥ · — × → …`. `⚠`, `✻` and `…` may be 5 wide; `—` is 5 wide.

**Draw:** fill one `fillRect(x + col*scale, y + row*scale, scale, scale)` per lit pixel using `ctx.fillStyle = color`.

- [ ] **Step 1: Write `tests/font.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const REQUIRED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;!?\'"-_/\\()[]{}<>=+*#%&@~|^$`✓⚠✻♥·—×→…';

test('font: every required glyph is 7 equal-width rows of . and #', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  for (const ch of REQUIRED) {
    const g = CB.Font.GLYPHS[ch];
    assert.ok(g, `missing glyph ${JSON.stringify(ch)}`);
    assert.equal(g.length, 7, `glyph ${ch} rows`);
    const w = g[0].length;
    assert.ok(w >= 1 && w <= 5, `glyph ${ch} width ${w}`);
    for (const row of g) {
      assert.equal(row.length, w, `glyph ${ch} ragged`);
      assert.match(row, /^[.#]+$/, `glyph ${ch} chars`);
    }
    if (ch !== ' ') assert.ok(g.some((row) => row.includes('#')), `glyph ${ch} is blank`);
  }
});

test('font: measure sums advances minus the trailing spacing, times scale', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  const wA = CB.Font.GLYPHS.A[0].length;
  const wB = CB.Font.GLYPHS.B[0].length;
  assert.equal(CB.Font.measure('AB'), wA + 1 + wB);
  assert.equal(CB.Font.measure('AB', 2), (wA + 1 + wB) * 2);
  assert.equal(CB.Font.measure(''), 0);
  assert.equal(CB.Font.measure('\u0001'), CB.Font.measure('?'), 'unknown → ?');
});

test('font: wrap keeps every line within maxWidth', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  const lines = CB.Font.wrap('TypeError: cannot read properties of undefined (reading x)', 120);
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(CB.Font.measure(l) <= 120, l);
  assert.equal(lines.join(' '), 'TypeError: cannot read properties of undefined (reading x)');
});

test('font: draw fills one rect per lit pixel', () => {
  const CB = H.load(['src/core/ns.js', 'src/art/font.js']);
  let n = 0;
  const ctx = { fillStyle: '', fillRect: () => n++ };
  CB.Font.draw(ctx, 'I', 0, 0, '#FFFFFF', 1);
  const lit = CB.Font.GLYPHS.I.join('').split('').filter((c) => c === '#').length;
  assert.equal(n, lit);
});
```

- [ ] **Step 2:** Run `node --test tests/font.test.js` and confirm it fails.
- [ ] **Step 3:** Implement `src/art/font.js` in the module shape. `wrap` splits on spaces and hard-breaks a single word longer than `maxWidth`.
- [ ] **Step 4:** Run the tests until all 4 pass.

### Task 9: Audio

**Files:** Create `src/core/audio.js`. Test: `tests/audio.test.js`.

**Interfaces:** `CB.Audio = { init(), play(name), handleEvents(events), toggleMute() → muted, setMuted(bool), isMuted(), SOUNDS, EVENT_SOUND }`.

**Behaviour:**
- **Context:** `init()` creates or resumes an `AudioContext` (or `webkitAudioContext`) on first call. It builds a master gain of 0.25 (0 when muted) and a 1 s white-noise buffer; this is the only `Math.random` allowed in `src/core`. Any failure leaves audio disabled.
- **Guards:** before `init` succeeds, or while muted, `play` is a no-op. Every Web Audio call is inside try/catch.
- **Mute:** the setting persists in `localStorage['cb.muted']` (`'1'`/`'0'`), read at load and written by `setMuted`, both inside try/catch.
- **Events:** `EVENT_SOUND` maps event type → sound name, and `handleEvents(events)` plays one sound per mapped event. Throttles: `shoot` at most once per 70 ms, `enemyShoot` once per 90 ms, `hit` once per 40 ms. Throttles use `ctx.currentTime`.

**Sound recipes** (tune by ear, keep each under 1 s except `bossDie`):

| Sound | Recipe |
|---|---|
| `shoot` | square 880→620 Hz, 45 ms, vol 0.10 |
| `hit` | triangle 320→180 Hz, 35 ms, vol 0.18 |
| `clink` | square 1400 Hz, 25 ms, vol 0.06 |
| `enemyDie` | noise 110 ms (lowpass 2 kHz) + square 240→70 Hz, 120 ms |
| `spawn` | triangle 220→440 Hz, 90 ms, vol 0.08 |
| `playerHurt` | square 320→90 Hz, 260 ms + noise 120 ms |
| `playerDie` | 4-note descending square arpeggio (E5 C5 A4 E4), 90 ms each |
| `dash` | noise 90 ms (highpass 1.5 kHz) |
| `bounce` | triangle 660 Hz, 30 ms |
| `enemyShoot` | square 210 Hz, 35 ms, vol 0.07 |
| `bossPhase` | two-tone alarm 660/440 Hz × 3, 120 ms each |
| `bossDie` | noise 1.2 s (lowpass sweeping 3 kHz→200 Hz) + square 200→40 Hz |
| `teleport` | square sweep 200→1600 Hz, 120 ms |
| `beamCharge` | sine 200→900 Hz over 0.8 s, vol 0.08 |
| `beam` | sawtooth 110 Hz with 30 Hz vibrato, 0.5 s |
| `lob` | triangle 380→720 Hz, 120 ms |
| `splat` | noise 80 ms (lowpass 900 Hz) |
| `revive` | rising square arpeggio A4 C5 E5 A5 |
| `patchPick` | chime C5 E5 G5 C6, triangle, 70 ms each |
| `uiSelect` | square 990 Hz, 30 ms |
| `bossWarn` | low square pulses 110 Hz × 4 |

`EVENT_SOUND` keys: `shoot hit clink enemyDie spawn playerHurt playerDie dash bounce enemyShoot bossPhase bossDie bossWarn teleport beamCharge beam lob splat revive patchPick uiSelect`. Map `playerHurt` with `god: true` to `hit` instead. `bossWarn` is emitted by the run (Task 4) when the warning card starts.

- [ ] **Step 1: Write `tests/audio.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/audio.js'];

test('audio: loads headless and is a no-op before init', () => {
  const CB = H.load(FILES);
  CB.Audio.play('shoot');
  CB.Audio.handleEvents([{ type: 'shoot' }, { type: 'hit' }, { type: 'nonsense' }]);
  CB.Audio.init();
  CB.Audio.play('bossDie');
});

test('audio: every mapped event names a defined sound', () => {
  const CB = H.load(FILES);
  for (const [ev, snd] of Object.entries(CB.Audio.EVENT_SOUND)) assert.equal(typeof CB.Audio.SOUNDS[snd], 'function', `${ev} → ${snd}`);
  for (const k of ['shoot', 'hit', 'enemyDie', 'playerHurt', 'bossDie', 'patchPick', 'uiSelect', 'bossWarn']) assert.equal(typeof CB.Audio.SOUNDS[k], 'function', k);
});

test('audio: toggleMute flips and reports state', () => {
  const CB = H.load(FILES);
  const m0 = CB.Audio.isMuted();
  assert.equal(CB.Audio.toggleMute(), !m0);
  assert.equal(CB.Audio.isMuted(), !m0);
  CB.Audio.setMuted(false);
  assert.equal(CB.Audio.isMuted(), false);
});
```

- [ ] **Step 2:** Run it and confirm it fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run until it passes. The harness has no `AudioContext`, so `init()` must quietly leave audio disabled.

---

**Rev 2 additions (Task 9):**
- **New sounds:**

| Sound | Recipe |
|---|---|
| `heartbeat` | two sine thumps 70→45 Hz, 80 ms each, at t and t + 0.14 s, gain 0.3 |
| `compact` | sine sweep 120→1400 Hz over 0.5 s plus highpass noise 0.4 s, gain 0.2 |
| `compactReady` | chime 880 then 1320 Hz, 60 ms each |
| `graze` | square 1800 Hz, 12 ms, gain 0.05 |
| `perfect` | rising two-tone 1200 → 1800 Hz, 40 ms each |
| `pickup` | triangle arpeggio C6 E6 G6, 50 ms each |
| `blast` | noise pop 90 ms (lowpass 1.2 kHz), pitch falling |
| `victory` | 6-note square fanfare G5 C6 E6 G6 E6 C7, 110 ms each |
| `unlock` | chime A5 C#6 E6 A6 |

- **Event mapping:** `EVENT_SOUND` gains `heartbeat`, `compact`, `compactReady`, `graze`, `pickup`, `blast`, `victory` and `unlock`.
  - `graze` with `perfect: true` plays `perfect`.
  - `enemyDie` with `silent: true` plays nothing.
- **Throttles:** add `graze` at 50 ms and `blast` at 60 ms.
- **For Task 9B:** expose `CB.Audio.context()` (the AudioContext or null) and `CB.Audio.output()` (the master gain node or null).
- **Mute:** applies to the master gain, so it silences the music too.
- **Extra test.** It uses an injected fake `AudioContext` in the sandbox: `sandbox.AudioContext = FakeCtx` before `init()`. FakeCtx is a minimal object with `currentTime`, `destination`, the `createGain`/`createOscillator`/`createBufferSource`/`createBiquadFilter`/`createBuffer` factories returning objects with `connect`, `start`, `stop`, `frequency`/`gain`/`Q` params (`setValueAtTime`, `linearRampToValueAtTime`, `exponentialRampToValueAtTime`), and `resume() → Promise.resolve()`. The test checks:
  - two `shoot` events in one call start only one oscillator;
  - a silent `enemyDie` starts nothing;
  - `setMuted(true)` sets master gain to 0.


### Task 9B: Procedural chiptune (`music.js`)

**Files:** Create `src/core/music.js`. Test: `tests/music.test.js`.

**Interfaces:**

```js
CB.Music = {
  pattern(stageId, bar) → [{ step: 0..15, freq, ch: 'bass' | 'lead' | 'hat', len }],
  intensityFor(run) → -1 | 0 | 1 | 2,   // -1 = silent
  update(run, paused), start(), stop(), toggle() → enabled, isEnabled(),
};
```

**Spec:**
- **Patterns:** each stage's `pattern` is pure and deterministic. It is seeded by a string hash of the stage id through `CB.createRng`. There are 16 steps per bar and 8 bars per loop. Use the RNG only to vary note order and rests; never `Math.random`.

| Stage | Scale | BPM | Notes |
|---|---|---|---|
| `src` | A minor pentatonic | 124 | |
| `node_modules` | D dorian | 108 | lead detuned +6 cents |
| `git` | E minor | 136 | bass rhythm 3+3+2 |
| `prod` | C# diminished | 152 | |

- **Channels:**
  - bass: triangle, root/fifth 8ths, gain 0.07;
  - lead: square 16th arpeggio, gain 0.035, played only at intensity ≥ 1;
  - hat: noise on the off-beats, gain 0.02, highpass 6 kHz.
- **Intensity by run state:**

| State | Intensity |
|---|---|
| `stageIntro`, `wave`, `waveBreak` | 0 |
| `bossWarn` | -1 (the warning sound is the stinger) |
| `boss` | 1 |
| `boss` with `world.boss.phase ≥ 2` | 2 (tempo ×1.1, lead up an octave) |
| `bossDead`, `dying`, `dead` | -1 |
| `patchPick` | 0 (half gain) |
| `victory` | 1 |

  `paused` mutes the scheduler. Track and intensity changes take effect at bar boundaries.
- **Scheduler:** a `setInterval` every 30 ms schedules notes whose start is before `ctx.currentTime + 0.15` (the lookahead pattern).
- **Output:** the music gain node (0.10) connects into `CB.Audio.output()`, so M mutes everything. If `CB.Audio.context()` is null, every method is a safe no-op.
- **Toggle:** `toggle()` flips the enabled flag, which persists in `localStorage['cb.music']` (`'1'`/`'0'`, try/catch). It defaults to on.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/core/audio.js', 'src/core/music.js'];

test('music: patterns are deterministic per stage and differ across stages', () => {
  const CB = H.load(FILES);
  const a = JSON.stringify(CB.Music.pattern('src', 0));
  assert.equal(a, JSON.stringify(CB.Music.pattern('src', 0)));
  assert.notEqual(a, JSON.stringify(CB.Music.pattern('prod', 0)));
});

test('music: every note has a legal step, channel and audible frequency', () => {
  const CB = H.load(FILES);
  for (const id of ['src', 'node_modules', 'git', 'prod']) {
    for (let bar = 0; bar < 8; bar++) {
      const notes = CB.Music.pattern(id, bar);
      assert.ok(notes.length > 0);
      for (const n of notes) {
        assert.ok(Number.isInteger(n.step) && n.step >= 0 && n.step <= 15);
        assert.ok(['bass', 'lead', 'hat'].includes(n.ch));
        if (n.ch !== 'hat') assert.ok(n.freq >= 55 && n.freq <= 1760, `${id} ${n.freq}`);
      }
    }
  }
});

test('music: intensity follows run state', () => {
  const CB = H.load(FILES);
  const I = (state, phase) => CB.Music.intensityFor({ state, world: { boss: phase ? { phase } : null } });
  assert.equal(I('wave'), 0);
  assert.equal(I('bossWarn'), -1);
  assert.equal(I('boss', 1), 1);
  assert.equal(I('boss', 2), 2);
  assert.equal(I('dead'), -1);
});

test('music: with no AudioContext every call is a safe no-op', () => {
  const CB = H.load(FILES);
  CB.Music.start();
  CB.Music.update({ state: 'boss', stageIndex: 0, world: { boss: { phase: 2 }, stage: { id: 'src' } } }, false);
  CB.Music.stop();
  assert.equal(typeof CB.Music.toggle(), 'boolean');
});
```

- [ ] Write the test, see it fail, implement, see it pass.

### Tasks 10–14: Gauntlet bugs

Each task creates one file under `src/game/enemies/` and one test file. All enemies use `CB.makeEnemy`, keep themselves inside the arena with `CB.M.clampToArena(e, w.arena)`, set `e.facing` from horizontal velocity, and draw a small ground shadow (`r.alpha(0.3, () => r.rect(x - r, y + r - 1, 2r, 2, ink))`) before the sprite.

**Rev 2 rules for all enemies:**
- Publish `e.vx`/`e.vy` as the actual velocity every tick (the bot and the aim-lead rely on it).
- Never touch `noContactT`: `world.spawnEnemy` gives regular enemies a 0.3 s contact grace, and soft separation is done by the world.
- Fire only through `w.fireEnemyBullet(...)` at fire time.
- Emit every event with `x, y`.

#### Task 10: `syntaxError`

**Files:** `src/game/enemies/syntaxError.js`, `tests/enemy.syntaxError.test.js`.

**Spec:**
- **Stats:** hp 3, r 5, speed 38.
- **Movement:** each tick, heading = angle to the player. Velocity is that heading × 38, plus a perpendicular wobble of `10 * sin(e.t * 2π * 3)` px/s.
- **Sprite:** a red beetle (`r`/`R` + `k` outline), 12×10, 2 walk frames `syntaxError_0/1` switching every 0.15 s.
- **Underline:** under the sprite, draw an animated 1 px yellow (`y`) zigzag "squiggle" 10 px wide, offset by `floor(t*8) % 2`.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/syntaxError.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

test('syntaxError: stats', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('syntaxError', 100, 100);
  assert.equal(e.hp, 3);
  assert.equal(e.maxHp, 3);
  assert.equal(e.r, 5);
  assert.equal(e.targetable, true);
  assert.equal(e.contact, true);
  assert.equal(e.regular, true);
});

test('syntaxError: closes ~38 px/s toward the player', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 240;
  w.player.y = 96;
  const e = w.spawnEnemy('syntaxError', 60, 96);
  H.stepN(w, 60, idle);
  assert.ok(e.x - 60 > 33 && e.x - 60 < 40, `dx ${e.x - 60}`);
  assert.ok(Math.abs(e.y - 96) < 6);
});

test('syntaxError: dies after 3 damage', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('syntaxError', 100, 60);
  w.damageEnemy(e, 1);
  w.damageEnemy(e, 1);
  assert.equal(e.dead, false);
  w.damageEnemy(e, 1);
  assert.equal(e.dead, true);
});

test('syntaxError: sprites are defined', () => {
  const CB = H.load(FILES);
  assert.ok(CB.Art.hasSprite('syntaxError_0') && CB.Art.hasSprite('syntaxError_1'));
});
```

#### Task 11: `nullPointer`

**Files:** `src/game/enemies/nullPointer.js`, `tests/enemy.nullPointer.test.js`.

**Spec (rev 2):**
- **Stats:** hp 2, r 5.
- **States** (use `CB.setState`; transition when `e.stateT >= duration`):

| State | Duration | Behaviour | `visible` | `targetable` | `contact` |
|---|---|---|---|---|---|
| `wander` | 1.5 s | speed 30; a new random heading from `w.rng` every 0.5 s | true | true | true |
| `vanish` | 0.8 s | stand still | false | false | false |
| `appear` | 0.5 s | on entry, move to a point 50–60 px from the player in a random direction (clamped to the arena); `e.alpha` ramps 0→1 | true | false | false |
| `lunge` | 0.4 s | on entry, store the direction to the player's *current* position; move at 130 px/s | true | true | true |

  After `lunge` it returns to `wander`.
- **Velocity:** set `e.vx`/`e.vy` to the actual velocity every tick (0 while standing still).
- **Sprite:** a pale moth (`e`/`s`/`W` + `k`), 12×10, 2 wing frames, drawn with `alpha: e.alpha * (0.75 + 0.25*sin(t*10))`.
- **Telegraph:** during `appear`, draw a dashed ring at **full alpha** (not faded) that tightens from radius 12 to 5 over the state, so the telegraph is readable from its first frame.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/nullPointer.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

function setup() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 4, god: true });
  w.player.x = 200;
  w.player.y = 110;
  const e = w.spawnEnemy('nullPointer', 60, 60);
  return { CB, w, e };
}
const at = (w, seconds, from) => H.stepN(w, Math.round((seconds - (from || 0)) * 60), idle);

test('nullPointer: full cycle with correct flags and timings', () => {
  const { w, e } = setup();
  at(w, 0.5);
  assert.equal(e.state, 'wander');
  assert.equal(e.targetable, true);
  at(w, 1.6, 0.5);
  assert.equal(e.state, 'vanish');
  assert.equal(e.visible, false);
  assert.equal(e.targetable, false);
  assert.equal(e.contact, false);
  at(w, 2.45, 1.6);
  assert.equal(e.state, 'appear');
  assert.equal(e.targetable, false);
  assert.equal(e.contact, false);
  const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  assert.ok(d >= 49.5 && d <= 60.5, `appear distance ${d}`);
  at(w, 2.9, 2.45);
  assert.equal(e.state, 'lunge');
  assert.equal(e.targetable, true);
  assert.ok(Math.abs(Math.hypot(e.vx, e.vy) - 130) < 1, `lunge speed ${Math.hypot(e.vx, e.vy)}`);
  at(w, 3.35, 2.9);
  assert.equal(e.state, 'wander');
});

test('nullPointer: bolts pass through while vanished', () => {
  const { w, e } = setup();
  at(w, 1.7);
  assert.equal(e.state, 'vanish');
  w.firePlayerBolt(e.x - 10, e.y, 0);
  H.stepN(w, 6, idle);
  assert.equal(e.hp, 2);
  assert.equal(w.damageEnemy(e, 1), 0);
});
```

> Timings: wander→vanish at about 1.5 s, vanish→appear at about 2.3 s, appear→lunge at about 2.8 s, lunge→wander at about 3.2 s. Each check sits mid-state with at least 3 ticks of slack.

#### Task 12: `raceCondition`

**Files:** `src/game/enemies/raceCondition.js`, `tests/enemy.raceCondition.test.js`.

**Spec (rev 2):**
- **Stats:** hp 1, r 4, forward speed 62 toward the player.
- **Zigzag:** a perpendicular velocity of `40 * sin(2π·2·e.t + phase)` px/s, where `phase` comes from `opts.phase` (default 0). Pairs are spawned with phases 0 and π.
- **Velocity:** set `e.vx`/`e.vy` to the actual velocity every tick.
- **Sprite:** a yellow ant (`y`/`Y` + `k`), 10×8, 3-frame scurry at 0.08 s per frame. Draw a 2 px speed-line streak behind it using alpha.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/raceCondition.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

test('raceCondition: stats', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  const e = w.spawnEnemy('raceCondition', 60, 96, { phase: 0 });
  assert.equal(e.hp, 1);
  assert.equal(e.r, 4);
});

test('raceCondition: a pair zigzags in opposite phase', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 280;
  w.player.y = 96;
  const a = w.spawnEnemy('raceCondition', 60, 90, { phase: 0 });
  const b = w.spawnEnemy('raceCondition', 60, 102, { phase: Math.PI });
  const ay0 = a.y;
  const by0 = b.y;
  H.stepN(w, 6, idle);
  assert.ok((a.y - ay0) * (b.y - by0) < 0, `a ${a.y - ay0} b ${b.y - by0}`);
});

test('raceCondition: advances ~62 px/s toward the player', () => {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 1 });
  w.player.x = 300;
  w.player.y = 96;
  const e = w.spawnEnemy('raceCondition', 40, 96, { phase: 0 });
  H.stepN(w, 60, idle);
  assert.ok(e.x - 40 > 50 && e.x - 40 < 64, `dx ${e.x - 40}`);
});
```

> The pair test spawns the ants 12 px apart, because soft separation (Task 3 rev 2) would push two ants spawned on the same point apart and mask the zigzag. It compares each ant's displacement from its own start.

#### Task 13: `memoryLeak`

**Files:** `src/game/enemies/memoryLeak.js`, `tests/enemy.memoryLeak.test.js`.

**Spec:**
- **Sizes:**

| Size | hp | r | speed |
|---|---|---|---|
| big (default) | 4 | 6 | 30 |
| small (`opts.small === true`, sets `e.data.small = true`) | 2 | 4 | 45 |

- **Movement:** both chase the player.
- **Split:** `onDeath` of a big blob spawns 2 smalls directly with `w.spawnEnemy` (no telegraph), offset ±5 px perpendicular to the player direction, and emits `splat`. A silent kill (`killEnemy(e, true)`) never calls `onDeath`.
- **Sprite:** a green slime (`g`/`G` + `k`, with a `w` highlight pixel), big 14×11 and small 10×8, each with a 2-frame squash. The bottom row drips.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/memoryLeak.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });
const leaks = (w) => w.enemies.filter((e) => !e.dead && e.kind === 'memoryLeak');

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
```

#### Task 14: `offByOne`

**Files:** `src/game/enemies/offByOne.js`, `tests/enemy.offByOne.test.js`.

**Spec (rev 2):**
- **Stats:** hp 4, r 5, speed 50.
- **Range-keeping:** let `d` = distance to the player.
  - `d < 70`: move directly away.
  - `d > 110`: move directly toward.
  - Otherwise strafe perpendicular, with a direction sign that flips every `w.rng.range(1.5, 2.5)` s.
- **Velocity:** publish `e.vx`/`e.vy`.
- **Attack:**
  - Every 2.8 s (the timer starts at 3.0, so the first volley comes 3.0 s after spawn) it fires a burst of **2** bullets 0.12 s apart at **speed 70**. Each one is aimed at `aimPoint(w)` computed at the moment of that shot.
  - `aimPoint(w)` is exported as `CB.Enemies.offByOne.aimPoint`. It returns the player position plus 8 px × the normalised player velocity (`p.vx, p.vy`), or the exact player position when the player is still.
  - Emit `enemyShoot` (with x, y) on the first bullet of each burst.
  - Always fire through `w.fireEnemyBullet(...)` at fire time; never cache or bind it.
- **Sprite:** a purple spider (`p`/`P` + `k`, with `r` eyes), 12×10, 2-frame leg shuffle. A thin purple tick mark is drawn 1 px off-centre above it (the "+1"). From 0.4 s before each burst, the eyes blink white as a tell.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/offByOne.js'];
const idle = () => H.makeInput({ aimX: 300, aimY: 30 });

function setup(ex, ey) {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 2, god: true });
  w.player.x = 160;
  w.player.y = 96;
  const e = w.spawnEnemy('offByOne', ex, ey);
  return { CB, w, e };
}

test('offByOne: stats', () => {
  const { e } = setup(60, 96);
  assert.equal(e.hp, 4);
  assert.equal(e.r, 5);
});

test('offByOne: fires a 2-bullet burst about 3.0 s after spawning, at 70 px/s', () => {
  const { w } = setup(60, 96);
  const shots = [];
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { const b = orig(...a); shots.push(b); return b; };
  H.stepN(w, 170, idle);
  assert.equal(shots.length, 0, 'nothing before 2.83 s');
  H.stepN(w, 30, idle);
  assert.equal(shots.length, 2);
  for (const b of shots) assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - 70) < 1e-6);
  assert.equal(w.events.filter((ev) => ev.type === 'enemyShoot').length, 1);
  H.stepN(w, 170, idle);
  assert.equal(shots.length, 4, 'second burst 2.8 s later');
});

test('offByOne: aims one tile ahead of a moving player', () => {
  const { CB, w } = setup(60, 96);
  w.player.vx = 80;
  w.player.vy = 0;
  const p1 = CB.Enemies.offByOne.aimPoint(w);
  assert.ok(Math.abs(p1.x - (w.player.x + 8)) < 1e-9 && Math.abs(p1.y - w.player.y) < 1e-9);
  w.player.vx = 0;
  const p2 = CB.Enemies.offByOne.aimPoint(w);
  assert.equal(p2.x, w.player.x);
});

test('offByOne: backs off when close and closes in when far', () => {
  let { w, e } = setup(130, 96);
  const d0 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  H.stepN(w, 60, idle);
  assert.ok(Math.hypot(e.x - w.player.x, e.y - w.player.y) > d0 + 15);
  ({ w, e } = setup(16, 30));
  const d1 = Math.hypot(e.x - w.player.x, e.y - w.player.y);
  H.stepN(w, 60, idle);
  assert.ok(Math.hypot(e.x - w.player.x, e.y - w.player.y) < d1 - 15);
});
```

> Burst timing: the first bullet comes at about 3.0 s (tick 180–181), the second 0.12 s later (tick 188). The 200-tick check has slack. The next burst comes at about 5.8 s (tick 348–349) plus 0.12 s (tick 356), which falls within 370 ticks.

For each of Tasks 10–14:
- [ ] **Step 1:** Write the test file exactly as above.
- [ ] **Step 2:** Run `node --test tests/enemy.<kind>.test.js` and confirm it fails.
- [ ] **Step 3:** Implement the module. Use this skeleton:

```js
// <Kind>: <one-line behaviour summary>.
(function (CB) {
  'use strict';
  const M = CB.M;
  CB.Art.defineSprite('<kind>_0', [/* rows */]);
  CB.Art.defineSprite('<kind>_1', [/* rows */]);
  CB.Enemies.<kind> = {
    create(w, x, y, opts) {
      return CB.makeEnemy('<kind>', x, y, { hp: 0, r: 0, data: {} });
    },
    update(e, w, dt) {
      // movement / state machine using w.rng, CB.setState, M helpers
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      M.clampToArena(e, w.arena);
      if (e.vx) e.facing = e.vx < 0 ? -1 : 1;
    },
    draw(e, r, t) {
      const frame = Math.floor(e.t / 0.15) % 2;
      r.sprite('<kind>_' + frame, e.x, e.y, { flip: e.facing < 0, white: e.hitFlash > 0, alpha: e.alpha });
    },
  };
})(window.CB);
```

- [ ] **Step 4:** Run the test until it passes.

---

### Tasks 15–18: Bosses

**Rules for every boss (rev 2). Each one is a requirement and is tested.**

1. **Registration:** each boss file registers its part kinds in `CB.Enemies` (all `boss: true, regular: false`) and the boss in `CB.Bosses[id]`.
2. **Controller fields:** the controller is a plain object with the fields named below. Tests poke them, so the names are part of the contract.
3. **Thresholds:** phases begin when HP drops **strictly below** a fraction of max HP (`hp < f * maxHp`). Phases latch (`if (target > phase) { phase = target; … }`) and never revert, even if HP regenerates. Every HP-threshold event fires at most once per fight.
4. **Phase change:**
   - emit `bossPhase` (`x, y, phase`);
   - call `w.addShake(4)`;
   - give the main targetable part (or each twin) `invuln = 0.5`.
5. **Safe spawn:**
   - Every part is created with `noContactT: 0.5`, so it does no contact damage for its first 0.5 s. `world.step` decrements it and collide skips contact while it's positive.
   - Each boss chooses its spawn from its candidate list by picking the candidate farthest from the player (the first one wins ties).
   - The run also gives the player 1.0 s of invulnerability at boss start (Task 4).
6. **Periodic attacks:** timers start full, so the first attack comes one full period after spawn or phase entry. Always fire through `w.fireEnemyBullet(...)` at fire time; never cache or bind it.
7. **Velocity:** every part a controller moves directly publishes `vx = dx/dt`, `vy = dy/dt` each tick.
8. **Defeat:**
   - When the main part dies, the controller sets `defeated = true` and `hp = 0` in that same update.
   - It kills all remaining parts with `w.killEnemy(part, true)` and clears overlay state (beams, banners, `resolveT`).
   - `world.step` never calls `update` again once `defeated` is set (Task 3), and `WorldDraw` never calls its `draw` again (Task 19).
9. **Finale data on the module object:**
   - `diff: [2–4 strings]`: each line starts with `- ` or `+ `, is at most 46 characters, and uses only Task 8 glyphs.
   - `file: '<name>'`.
   - `portrait: '<spriteName>'`: an existing sprite, normally the main body's frame 0.
   - `deathPoints(controller) → [{x, y}, …]`: finite positions, used by the finale's chained blasts (Task 21B).
10. **Draw:** bosses draw no health bar of their own (the HUD does), except for the Merge Conflict twin mini-bars.

#### Task 15: The Infinite Loop (`infiniteLoop`)

**Files:** `src/game/bosses/infiniteLoop.js`, `tests/boss.infiniteLoop.test.js`. Depends at runtime on `syntaxError`.

**Module fields:**
- `id: 'infiniteLoop'`, `name: 'THE INFINITE LOOP'`, `tagline: 'while (true) { bite(); }'`, `commitMsg: 'fix: add a break condition'`.
- `file: 'loop.js'`, `diff: ['- while (true) { bite(); }', '+ while (!done) { bite(); }', '+ if (++n > MAX) break;']`, `portrait: 'loopHead_0'`.
- `deathPoints(c)` returns the head, then the segments from head to tail.
- `create`.

**Parts:**

| Kind | r | hp | targetable | solid | contact |
|---|---|---|---|---|---|
| `loopHead` | 8 | 150 | yes | no | yes |
| `loopSegment` ×8 | 5 | 9999 | no | yes | yes |

The head has `z: 1e6` and segments have `z: 1e5 - i`, so the head draws on top (Task 19 sorts by `z ?? y`).

**Controller fields:** `x, y, hp, maxHp, phase, defeated, head, segments (front→tail, alive only), angle, radius, angSpeed, dir, fanT, fanTele, reverseT, shedT, path, cx: 160, cy: 96`.

**Motion:**
- The head sits at `(cx + cos(angle)*radius, cy + sin(angle)*radius)`, and `angle += dir*angSpeed*dt`.
- The start angle is the point on the circle farthest from the player: `angle = atan2(cy - p.y, cx - p.x)`.
- **Path following:**
  - Record the head's positions in `path`, newest first. Pre-fill it on creation by walking backwards along the circle in 1 px steps for 100 px.
  - Each tick, place segment i at the point `10 × (i + 1)` px of cumulative path length behind the head, interpolating between recorded points.
  - Trim `path` to the length needed.
  - The segments therefore always lie on the head's actual path. This is not follow-the-leader chasing, which curls the tail inward.

**Phases:**

| | Phase 1 | Phase 2 (`hp < 75`) |
|---|---|---|
| Radius | 60 | eases linearly 60→40 over 2 s |
| `angSpeed` | 0.9 rad/s | 1.4 rad/s |
| Fan | every 3.0 s (`fanT` starts 3.0): 3 bullets at ±15° around the aim at the player, speed 80 | every 2.5 s (`fanT` reset to 2.5 on phase entry): 5 bullets at ±30° in 15° steps |
| Reverse | | `reverseT = w.rng.range(4, 6)` on phase entry. When `reverseT ≤ 0.5`, set `head.data.telegraph = true` (the head blinks white). At 0, flip `dir`, clear the telegraph and re-roll. |
| Shed | | every 5 s (`shedT` starts 5 on phase entry) while more than 4 segments remain: silently kill the tail segment and `w.spawnEnemy('syntaxError', tail.x, tail.y)` |

- **Fan telegraph:** when `fanT ≤ 0.35`, set `fanTele = true`. The head draws with `white: true` blinking at 20 Hz. Clear it when the fan fires.

**Defeat:** when the head dies.

**Sprites:**
- `loopHead_0/1`: 18×18 purple (`p`/`P`) mandibled face with `w`/`k` eyes, 2 frames chomping.
- `loopSegment_0`: 12×12 `p`/`P` ring with a `{ }` motif. Draw every other segment with a darker variant (`loopSegment_1`).
- Overlay `draw`: nothing.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/syntaxError.js', 'src/game/bosses/infiniteLoop.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 96 });

function start() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 7, god: true });
  w.boss = CB.Bosses.infiniteLoop.create(w);
  return { CB, w, boss: w.boss };
}
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);
function countFires(w) {
  const box = { n: 0 };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { box.n++; return orig(...a); };
  return box;
}

test('infiniteLoop: one head and 8 solid untargetable r5 segments, all with spawn contact grace', () => {
  const { w, boss } = start();
  assert.equal(alive(w, 'loopHead').length, 1);
  const segs = alive(w, 'loopSegment');
  assert.equal(segs.length, 8);
  for (const s of segs) {
    assert.equal(s.targetable, false);
    assert.equal(s.solid, true);
    assert.equal(s.r, 5);
    assert.equal(s.boss, true);
    assert.equal(s.regular, false);
    assert.ok(s.noContactT >= 0.45);
  }
  assert.equal(boss.maxHp, 150);
  assert.equal(boss.hp, 150);
});

test('infiniteLoop: head starts on the far side from the player and circles at radius 60', () => {
  const { w, boss } = start();
  assert.ok(Math.hypot(boss.head.x - w.player.x, boss.head.y - w.player.y) > 85);
  H.stepN(w, 90, idle);
  const d = Math.hypot(boss.head.x - 160, boss.head.y - 96);
  assert.ok(Math.abs(d - 60) < 1, `radius ${d}`);
});

test('infiniteLoop: segments lie on the circle with ~10 px of path between them', () => {
  const { w, boss } = start();
  H.stepN(w, 120, idle);
  let prev = boss.head;
  for (const s of boss.segments) {
    assert.ok(Math.abs(Math.hypot(s.x - 160, s.y - 96) - 60) < 1, 'on the circle');
    const d = Math.hypot(s.x - prev.x, s.y - prev.y);
    assert.ok(d > 9 && d < 10.5, `chord ${d}`);
    prev = s;
  }
});

test('infiniteLoop: the head publishes its velocity (~54 px/s in phase 1)', () => {
  const { w, boss } = start();
  H.stepN(w, 30, idle);
  const v = Math.hypot(boss.head.vx, boss.head.vy);
  assert.ok(Math.abs(v - 54) < 1.5, `speed ${v}`);
});

test('infiniteLoop: segments absorb bolts; damage only lands on the head', () => {
  const { w, boss } = start();
  const seg = boss.segments[5];
  const b = w.firePlayerBolt(seg.x, seg.y, 0);
  b.vx = 0;
  b.vy = 0;
  H.stepN(w, 1, idle);
  assert.equal(b.dead, true);
  assert.ok(w.events.some((e) => e.type === 'clink'));
  assert.equal(w.damageEnemy(seg, 10), 0);
  w.damageEnemy(boss.head, 10);
  H.stepN(w, 1, idle);
  assert.equal(boss.hp, 140);
});

test('infiniteLoop: exactly 75 HP is still phase 1; below 75 is phase 2', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.head, 75);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.head, 76);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  assert.ok(w.events.some((e) => e.type === 'bossPhase'));
  H.stepN(w, 150, idle);
  assert.ok(Math.abs(boss.radius - 40) < 0.5, `radius ${boss.radius}`);
  assert.ok(Math.abs(boss.angSpeed - 1.4) < 1e-9);
});

test('infiniteLoop: phase 2 reverses direction within 6.5 s', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  const d0 = boss.dir;
  let flipped = false;
  for (let i = 0; i < 390 && !flipped; i++) {
    H.stepN(w, 1, idle);
    if (boss.dir !== d0) flipped = true;
  }
  assert.ok(flipped);
});

test('infiniteLoop: phase 2 sheds a segment into a syntaxError every 5 s, stopping at 4', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 80);
  H.stepN(w, 1, idle);
  H.stepN(w, 5.3 * 60, idle);
  assert.equal(alive(w, 'loopSegment').length, 7);
  assert.ok(alive(w, 'syntaxError').length >= 1);
  H.stepN(w, 40 * 60, idle);
  assert.equal(alive(w, 'loopSegment').length, 4);
});

test('infiniteLoop: phase 1 telegraphs then fires a 3-bullet fan every 3 s', () => {
  const { w, boss } = start();
  const c = countFires(w);
  H.stepN(w, 2.8 * 60, idle);
  assert.equal(c.n, 0);
  assert.equal(boss.fanTele, true, 'telegraph shows 0.35 s before the fan');
  H.stepN(w, 0.3 * 60, idle);
  assert.equal(c.n, 3);
  assert.equal(boss.fanTele, false);
});

test('infiniteLoop: killing the head defeats the boss and clears segments', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.hp, 0);
  assert.equal(alive(w, 'loopSegment').length, 0);
});

test('infiniteLoop: finale data', () => {
  const { CB, boss } = start();
  const B = CB.Bosses.infiniteLoop;
  assert.ok(B.diff.length >= 2 && B.diff.length <= 4);
  for (const l of B.diff) assert.match(l, /^[-+] /);
  assert.equal(typeof B.file, 'string');
  assert.ok(CB.Art.hasSprite(B.portrait));
  const pts = B.deathPoints(boss);
  assert.equal(pts.length, 9);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
```

#### Task 16: Memory Leak (`memoryLeakBoss`)

**Files:** `src/game/bosses/memoryLeakBoss.js`, `tests/boss.memoryLeakBoss.test.js`. Depends at runtime on `memoryLeak`.

**Module fields:**
- `id: 'memoryLeakBoss'`, `name: 'MEMORY LEAK'`, `tagline: 'heap: 99% used'`, `commitMsg: 'fix: free() what you malloc()'`.
- `file: 'heap.c'`, `diff: ['- p = malloc(HEAP);', '+ p = malloc(HEAP);', '+ free(p);']`, `portrait: 'leakBoss_0'`.
- `deathPoints(c)` returns the body centre plus 7 points on a circle of radius `body.r * 0.7`.

**Parts:**

| Kind | hp | r | targetable | solid | contact | notes |
|---|---|---|---|---|---|---|
| `leakBoss` | 340 | `14 × size` | yes | no | yes | candidates (160, 60), (80, 96), (240, 96) |
| `leakBlob` | n/a | 4 | no | no | no | `data = { sx, sy, tx, ty, t, dur: 1.0 }` |

**`leakBoss`:**
- Its `onHit` subtracts hp, sets `ctrl.idleT = 0`, and sets `ctrl.size = max(1, size − 0.004 × dmg)`.
- It drifts toward the player at `18 / size` px/s and publishes `vx`/`vy`.

**`leakBlob`:**
- Its position lerps from the start to the target point (the parabola is cosmetic, in `draw` only).
- At `t ≥ dur` it calls `w.addHazard({ kind: 'puddle', x: tx, y: ty, r: 12, life: 6, slow: 0.5 })`, emits `splat` (with x, y), and kills itself silently.

**Controller fields:** `x, y, hp, maxHp: 340, phase, defeated, body, size (1.0..2.0), idleT, lobT, ringT, split66, split33`.
- `idleT` accumulates and is reset by `onHit`.
- When `idleT ≥ 1.5`: `body.hp = min(maxHp, body.hp + 4*dt)` and `size = min(2, size + 0.10*dt)`.
- `body.r = 14 * size`, and `hp` mirrors `body.hp` every tick.

**Attacks and thresholds:**
- **Lob:** every 2.5 s (`lobT` starts 2.5) it lobs 2 blobs (3 in phase 2). Each target is the player position plus a point uniform on the 24 px disc (`ang = w.rng.angle(); rad = 24*Math.sqrt(w.rng.next())`), clamped inside the arena. Emit `lob`.
- **Splits:** when `hp < 0.66 × maxHp` (once) and `hp < 0.33 × maxHp` (once), spawn 3 `memoryLeak` (big) via `w.spawnEnemy` at 120° intervals 20 px from the body.
- **Phase 2:** at `hp < 0.5 × maxHp` (latched), set `ringT = 4.0` and add a ring of 8 bullets (speed 70) every 4 s.
- **Defeat:** when the body dies.

**Sprites:**
- `leakBoss_0/1`: 28×22 green slime (`g`/`G`/`k` + `w` shine), 2 wobble frames. Draw at natural size and centred. Underneath, draw a translucent (alpha 0.35) green disc of radius `body.r`, so the true hitbox growth is visible. Above it, write `heap NN%` with `NN = round(50 + 49 × (size − 1))` in small text.
- `leakBlob_0`: 6×6 green droplet, plus a dark shadow ellipse at the target.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/memoryLeak.js', 'src/game/bosses/memoryLeakBoss.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);

function start() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 11, god: true });
  w.boss = CB.Bosses.memoryLeakBoss.create(w);
  return { CB, w, boss: w.boss };
}
function countFires(w) {
  const box = { n: 0 };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { box.n++; return orig(...a); };
  return box;
}

test('memoryLeakBoss: 340 HP, spawns at the farthest candidate, radius tracks size', () => {
  const { w, boss } = start();
  assert.equal(boss.maxHp, 340);
  assert.equal(boss.body.hp, 340);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) > 80);
  boss.size = 1.5;
  H.stepN(w, 1, idle);
  assert.ok(Math.abs(boss.body.r - 14 * boss.size) < 1e-9);
});

test('memoryLeakBoss: regenerates 4 HP/s and grows 0.10/s after 1.5 s without damage', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 40);
  const hp0 = boss.body.hp;
  H.stepN(w, 3.5 * 60, idle);
  const gained = boss.body.hp - hp0;
  assert.ok(gained > 7 && gained < 9, `gained ${gained}`);
  assert.ok(boss.size > 1.15 && boss.size < 1.25, `size ${boss.size}`);
});

test('memoryLeakBoss: damage shrinks size with a floor of 1.0', () => {
  const { w, boss } = start();
  boss.size = 1.5;
  w.damageEnemy(boss.body, 50);
  assert.ok(Math.abs(boss.size - 1.3) < 1e-9);
  w.damageEnemy(boss.body, 100);
  assert.equal(boss.size, 1);
});

test('memoryLeakBoss: lobs 2 blobs every 2.5 s that land within 24 px of the player as puddles', () => {
  const { w } = start();
  H.stepN(w, 2.6 * 60, idle);
  assert.equal(alive(w, 'leakBlob').length, 2);
  H.stepN(w, 1.1 * 60, idle);
  assert.equal(alive(w, 'leakBlob').length, 0);
  assert.ok(w.hazards.length >= 2);
  for (const h of w.hazards) assert.ok(Math.hypot(h.x - w.player.x, h.y - w.player.y) <= 24.5);
});

test('memoryLeakBoss: splits below 66% and 33%, each exactly once', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 120);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 3);
  boss.body.hp = 300;
  H.stepN(w, 1, idle);
  w.damageEnemy(boss.body, 50);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 3, 'no second 66% split');
  w.damageEnemy(boss.body, 140);
  H.stepN(w, 1, idle);
  assert.equal(alive(w, 'memoryLeak').length, 6);
});

test('memoryLeakBoss: phase 2 strictly below 50% latches and adds an 8-bullet ring every 4 s', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.body, 170);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1, 'exactly 50% is still phase 1');
  ({ w, boss } = start());
  w.damageEnemy(boss.body, 171);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  const c = countFires(w);
  H.stepN(w, 4.1 * 60, idle);
  assert.ok(c.n >= 8, `bullets ${c.n}`);
  boss.body.hp = 330;
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2, 'phases never revert');
});

test('memoryLeakBoss: defeat when the body dies; finale data', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  const B = CB.Bosses.memoryLeakBoss;
  assert.ok(CB.Art.hasSprite(B.portrait));
  for (const l of B.diff) assert.match(l, /^[-+] /);
  for (const p of B.deathPoints(boss)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
```

> Regen test: the hit at t = 0 resets `idleT`, so regen runs from 1.5 s to 3.5 s: 8 HP (±1 tick). The hit's size shrink (0.16) floors at 1.0, then size grows by 0.20 to 1.2.
>
> Split test: 340 − 120 = 220, which is below 224.4 (66%), so it splits. Setting hp to 300 and dealing 50 gives 250: no new 66% split. Dealing 140 more gives 110, below 112.2 (33%), so it splits again.

#### Task 17: Merge Conflict (`mergeConflict`)

**Files:** `src/game/bosses/mergeConflict.js`, `tests/boss.mergeConflict.test.js`.

**Module fields:**
- `id: 'mergeConflict'`, `name: 'MERGE CONFLICT'`, `tagline: '<<<<<<< HEAD'`, `commitMsg: 'fix: resolve merge conflict'`.
- `file: 'merge.js'`, `diff: ['- <<<<<<< HEAD', '- =======', '- >>>>>>> incoming', '+ // kept both. you are welcome']`, `portrait: 'conflictHead_0'`.
- `deathPoints(c)` returns both twins' last positions plus their midpoint.

**Parts:** `conflictTwin` ×2 with `data.side = 'head' | 'incoming'`. Each has r 8, **hp 130**, is targetable and has contact.
- Sprites are `conflictHead_0/1` (blue, `b`/`B`) and `conflictIncoming_0/1` (green, `g`/`G`).
- Each twin draws a **24×3 mini HP bar** 4 px above its sprite: an `ink` background, a fill in its own colour, and a 1 px white **notch at 17 HP** (the finish zone).
- Tiny `<<<<<<<` above HEAD and `>>>>>>>` above incoming.

**Controller fields:** `x, y (midpoint of living twins), hp (sum of living twins' hp, clamped ≥ 0), maxHp: 260, phase, defeated, head, incoming, resolveT (null | seconds), deadSide (null | 'head' | 'incoming'), attackT, attackIdx, attack (null | {kind, t}), cx: 160, cy: 96`.

**Spawn:** HEAD goes at the candidate farthest from the player among (90, 56), (230, 56), (90, 136) and (230, 136). Incoming goes at its mirror point. Both are therefore at least 40 px from the arena centre.

**Movement:**
- HEAD moves toward a waypoint (`w.randomPoint(24)`) at 50 px/s and re-rolls the waypoint within 4 px of it.
- Incoming sits at `(2*cx − head.x, 2*cy − head.y)` while HEAD is alive and no charge or line attack is running.
- If HEAD is dead, incoming wanders on its own waypoints. After a charge, incoming returns to its mirror point at up to 120 px/s.
- Publish `vx`/`vy` for both twins.

**Attacks:** every 2.8 s (`attackT` starts 2.8), start the next attack from the rotation `['crossfire', 'line']`. In phase 2 the rotation is `['crossfire', 'line', 'charge']`.
- **crossfire:** each living twin fires a 3-bullet aimed burst (0.12 s apart, speed 85).
- **line:**
  - Needs both twins alive, otherwise it falls back to crossfire.
  - Twins hold position for the whole attack.
  - Telegraph for 0.8 s (emit `beamCharge` with x1, y1, x2, y2), then a beam for 0.5 s (emit `beam` once, with coordinates).
  - While the beam is active, if `CB.M.circleSegment(p.x, p.y, p.r + 1, head.x, head.y, incoming.x, incoming.y)`, call `w.hurtPlayer(null)`.
- **charge:**
  - A 0.4 s jitter telegraph, then each living twin dashes at the player's position at 160 px/s for 0.5 s.
  - A twin within 40 px of the player at telegraph start does not charge.
- `startAttack(kind)` is exposed on the controller for tests.

**Resolve rule:**
- Whenever exactly one twin is dead and `resolveT` is null: set `resolveT = 6.0` and `deadSide` = that side, and emit `text` "FINISH <SIDE>!" at the arena centre.
- If the other twin dies while `resolveT > 0`, set `defeated`.
- When `resolveT` reaches 0:
  - Spawn a new `conflictTwin` of `deadSide` with **hp 20** at the candidate farthest from the player among (60, 50), (260, 50) and (160, 150). Its distance must be ≥ 70 px, else use the farthest anyway.
  - It gets `noContactT: 0.5`.
  - Emit `revive` (x, y) and `text` "merge failed".
  - Set `resolveT = null`, `deadSide = null`, and wire it back as `head`/`incoming`.
- The window re-triggers every time exactly one twin is dead.
- Both twins dying in the same tick defeats the boss.

**Phase 2:** when combined hp < 130 (latched).

**Overlay `draw`:**
- The telegraph line (blinking 1 px) and the beam (3 px with a bright core) between the twins.
- While `resolveT != null`: `FINISH <SIDE>!` and `resolveT.toFixed(1)`, centred at y 30, plus a blinking arrow over the surviving twin.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/bosses/mergeConflict.js'];
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });
const twins = (w) => w.enemies.filter((e) => !e.dead && e.kind === 'conflictTwin');

function start(god) {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 13, god: god !== false });
  w.boss = CB.Bosses.mergeConflict.create(w);
  return { CB, w, boss: w.boss };
}

test('mergeConflict: two twins of 130 HP, combined 260, at least 40 px from centre', () => {
  const { w, boss } = start();
  const t = twins(w);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((e) => e.data.side).sort(), ['head', 'incoming']);
  for (const e of t) {
    assert.equal(e.hp, 130);
    assert.ok(Math.hypot(e.x - 160, e.y - 96) >= 40);
  }
  assert.equal(boss.maxHp, 260);
  assert.equal(boss.hp, 260);
});

test('mergeConflict: incoming mirrors HEAD through the arena centre', () => {
  const { w, boss } = start();
  H.stepN(w, 60, idle);
  assert.ok(Math.abs(boss.incoming.x - (320 - boss.head.x)) < 0.01);
  assert.ok(Math.abs(boss.incoming.y - (192 - boss.head.y)) < 0.01);
});

test('mergeConflict: a missed 6 s window revives the dead twin at 20 HP, far from the player', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 1, idle);
  assert.ok(boss.resolveT > 5.9 && boss.resolveT <= 6.0, `resolveT ${boss.resolveT}`);
  assert.equal(boss.deadSide, 'head');
  H.stepN(w, 6.2 * 60, idle);
  const head = twins(w).find((e) => e.data.side === 'head');
  assert.ok(head, 'HEAD revived');
  assert.equal(head.hp, 20);
  assert.ok(head.noContactT > 0);
  assert.equal(boss.resolveT, null);
  assert.ok(w.events.some((e) => e.type === 'revive'));
  assert.equal(boss.defeated, false);
  w.damageEnemy(boss.head, 20);
  H.stepN(w, 1, idle);
  assert.ok(boss.resolveT > 5.9, 'the window re-triggers after a revive');
});

test('mergeConflict: killing the second twin inside the window defeats the boss', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  H.stepN(w, 5 * 60, idle);
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
  assert.equal(boss.resolveT, null);
});

test('mergeConflict: both twins dying in the same tick defeats the boss', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.head, 130);
  w.damageEnemy(boss.incoming, 130);
  H.stepN(w, 1, idle);
  assert.equal(boss.defeated, true);
});

test('mergeConflict: the conflict-line beam hurts a player standing on it, only after the telegraph', () => {
  const { w, boss } = start(false);
  boss.head.x = 100;
  boss.head.y = 60;
  boss.incoming.x = 220;
  boss.incoming.y = 132;
  w.player.x = 160;
  w.player.y = 96;
  boss.startAttack('line');
  H.stepN(w, 40, idle);
  assert.equal(w.player.hearts, 5, 'no damage during the 0.8 s telegraph');
  assert.ok(w.events.some((e) => e.type === 'beamCharge'));
  H.stepN(w, 17, idle);
  assert.equal(w.player.hearts, 4);
  assert.ok(w.events.some((e) => e.type === 'beam'));
});

test('mergeConflict: phase 2 strictly below 130 combined HP', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.head, 65);
  w.damageEnemy(boss.incoming, 65);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.head, 70);
  w.damageEnemy(boss.incoming, 61);
  H.stepN(w, 1, idle);
  assert.equal(boss.phase, 2);
  assert.ok(w.events.some((e) => e.type === 'bossPhase'));
});

test('mergeConflict: finale data', () => {
  const { CB, boss } = start();
  const B = CB.Bosses.mergeConflict;
  assert.ok(CB.Art.hasSprite(B.portrait));
  for (const l of B.diff) assert.match(l, /^[-+] /);
  for (const p of B.deathPoints(boss)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
```

> The beam test pins the twins so the segment passes through (160, 96). The first `line` tick is the start of the 0.8 s telegraph, so the beam starts at tick 48–49 and 57 ticks is inside the beam. The twins hold position during `line`, so the mirror rule doesn't move them.

#### Task 18: The Heisenbug (`heisenbug`)

**Files:** `src/game/bosses/heisenbug.js`, `tests/boss.heisenbug.test.js`. Depends at runtime on `nullPointer`.

**Module fields:**
- `id: 'heisenbug'`, `name: 'THE HEISENBUG'`, `tagline: 'works on my machine'`, `commitMsg: 'fix: cannot reproduce (closed)'`.
- `file: 'repro.js'`, `diff: ['- // works on my machine', '+ // works on every machine', '+ // (probably)']`, `portrait: 'heisenbug_0'`.
- `deathPoints(c)` returns the body plus 6 points on a radius-14 ring.

**Parts:**

| Kind | r | hp | notes |
|---|---|---|---|
| `heisenbug` | 9 | 240 | the real one; candidates (160, 50), (60, 96), (260, 96) |
| `heisenDecoy` | 9 | 1 | `onDeath` emits `text` "404" (grey, with x, y) |

**Controller fields:** `x, y, hp, maxHp: 240, phase, defeated, body, decoys, observeT, blinkT, blink (null | {stage: 'out' | 'in', t}), spiralAngle, spiralT, summonT`.

**Blink:**
- When `blinkT ≤ 0`, start fading out for 0.3 s: the body is untargetable, has no contact, and its alpha goes 1→0.
- Then teleport to `w.randomPoint(24, 80)`.
- **In phase 2 only:** replace the decoys. Silently kill the old ones and spawn 2 new `heisenDecoy` at `w.randomPoint(24, 60)`, fading in with the body.
- Fade in for 0.3 s while still untargetable, then become targetable and fire a ring of 10 bullets at speed 75 (each decoy fires a 6-bullet ring).
- `blinkT` resets to `w.rng.range(2.5, 3.5)` in phases 1–2 and to 5 in phase 3. The first `blinkT` is `w.rng.range(2.5, 3.5)`.

**Observation:**
- Each tick, if the body is targetable and `dist(w.player.aimX, w.player.aimY, body) ≤ 14`, then `observeT += dt`. Otherwise `observeT = 0`.
- At `observeT ≥ 2.0`, teleport instantly to `w.randomPoint(24, 80)`, emit `teleport` (x, y, x2, y2) and `text` "!?", and reset `observeT` to 0.

**Tell (draw):**
- **Observer ring:** while `observeT > 0`, light `floor(16 * observeT / 2.0)` of 16 dots on a radius-14 ring around the **real** body, with a small eye glyph above it that turns red after 1.5 s.
- **Chromatic offset:** grows from 1 to 3 px linearly with `observeT / 2.0`.
- **Flash:** the body flashes white once at `observeT ≥ 1.0`.

**Phases:**
- **Phase 2** at hp < 144 (60%).
- **Phase 3** at hp < 60 (25%):
  - On entry, silently kill all decoys. No more decoys in phase 3.
  - **Spiral:** every 0.25 s (`spiralT`, starts 0.25) fire 2 bullets at `spiralAngle` and `spiralAngle + π` (speed 70), with `spiralAngle += 2.2*dt`.
  - **Summons:** every 8 s (`summonT`, starts 2 on phase-3 entry), spawn `min(2, 4 − (alive + pending nullPointers))` `nullPointer`s via `w.queueSpawn` at `w.edgePoint(60)`.
- Multiple thresholds crossed in one hit apply in order (1→2→3).

**Defeat:** when the body dies. Silently kill the decoys.

**Sprites:**
- `heisenbug_0/1/2`: 16×14 moth, 3-frame wing flutter.
- `heisenbug_cyan_N` and `heisenbug_mag_N`: made with `CB.Art.defineTint` (Task 2) in cyan `#5FD4E0` and magenta `#E055B0`.
- Draw: cyan copy at −offset px x, magenta copy at +offset px x (both alpha 0.5), then the normal sprite.
- Decoys draw identically, except that only the real one flickers white when hit and only the real one shows the observer ring.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = [...H.GAME_BASE, 'src/game/enemies/nullPointer.js', 'src/game/bosses/heisenbug.js'];
const alive = (w, kind) => w.enemies.filter((e) => !e.dead && e.kind === kind);

function start() {
  const CB = H.load(FILES);
  const w = CB.createWorld({ seed: 17, god: true });
  w.boss = CB.Bosses.heisenbug.create(w);
  return { CB, w, boss: w.boss };
}
const aimAt = (boss) => () => H.makeInput({ aimX: boss.body.x, aimY: boss.body.y });
const aimAway = () => H.makeInput({ aimX: 10, aimY: 170 });
function countFires(w) {
  const box = { n: 0 };
  const orig = w.fireEnemyBullet;
  w.fireEnemyBullet = (...a) => { box.n++; return orig(...a); };
  return box;
}

test('heisenbug: 240 HP, spawns away from the player', () => {
  const { w, boss } = start();
  assert.equal(boss.maxHp, 240);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) > 70);
});

test('heisenbug: teleports after 2.0 s of continuous observation, landing ≥ 80 px from the player', () => {
  const { w, boss } = start();
  let tp = -1;
  for (let i = 0; i < 140 && tp < 0; i++) {
    H.stepN(w, 1, aimAt(boss));
    if (w.events.some((e) => e.type === 'teleport')) tp = i + 1;
  }
  assert.ok(tp >= 119 && tp <= 123, `teleport tick ${tp}`);
  assert.ok(Math.hypot(boss.body.x - w.player.x, boss.body.y - w.player.y) >= 80);
  assert.equal(boss.observeT, 0);
});

test('heisenbug: observation resets when the aim leaves', () => {
  const { w, boss } = start();
  H.stepN(w, 72, aimAt(boss));
  assert.ok(boss.observeT > 1.1);
  H.stepN(w, 6, aimAway);
  assert.equal(boss.observeT, 0);
  H.stepN(w, 72, aimAt(boss));
  assert.equal(w.events.filter((e) => e.type === 'teleport').length, 0);
});

test('heisenbug: untargetable while fading during a blink', () => {
  const { w, boss } = start();
  boss.blinkT = 0;
  H.stepN(w, 3, aimAway);
  assert.equal(boss.body.targetable, false);
  assert.equal(w.damageEnemy(boss.body, 5), 0);
  H.stepN(w, 40, aimAway);
  assert.equal(boss.body.targetable, true);
});

test('heisenbug: thresholds are strict (144 → phase 1, 143 → phase 2)', () => {
  let { w, boss } = start();
  w.damageEnemy(boss.body, 96);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 1);
  ({ w, boss } = start());
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 2);
});

test('heisenbug: phase 2 places 2 one-HP decoys per blink that pop with 404', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  const decoys = alive(w, 'heisenDecoy');
  assert.equal(decoys.length, 2);
  w.damageEnemy(decoys[0], 1);
  assert.equal(decoys[0].dead, true);
  assert.ok(w.events.some((e) => e.type === 'text' && e.text === '404'));
});

test('heisenbug: phase 3 removes decoys, spirals ~8 bullets/s and keeps at most 4 nullPointers', () => {
  const { w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  assert.equal(alive(w, 'heisenDecoy').length, 2);
  w.damageEnemy(boss.body, 90);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.phase, 3);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
  boss.blinkT = 999;
  const c = countFires(w);
  H.stepN(w, 120, aimAway);
  assert.ok(c.n >= 14 && c.n <= 18, `spiral bullets in 2 s: ${c.n}`);
  let peak = 0;
  for (let i = 0; i < 30 * 60; i++) {
    H.stepN(w, 1, aimAway);
    peak = Math.max(peak, alive(w, 'nullPointer').length + w.spawns.filter((s) => s.kind === 'nullPointer').length);
  }
  assert.ok(peak >= 2 && peak <= 4, `peak ${peak}`);
});

test('heisenbug: defeat clears decoys; finale data; tinted sprites exist', () => {
  const { CB, w, boss } = start();
  w.damageEnemy(boss.body, 97);
  H.stepN(w, 1, aimAway);
  boss.blinkT = 0;
  H.stepN(w, 45, aimAway);
  w.damageEnemy(boss.body, 999);
  H.stepN(w, 1, aimAway);
  assert.equal(boss.defeated, true);
  assert.equal(alive(w, 'heisenDecoy').length, 0);
  const B = CB.Bosses.heisenbug;
  assert.ok(CB.Art.hasSprite(B.portrait));
  assert.ok(CB.Art.hasSprite('heisenbug_cyan_0') && CB.Art.hasSprite('heisenbug_mag_0'));
  for (const l of B.diff) assert.match(l, /^[-+] /);
  for (const p of B.deathPoints(boss)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
```

> Phase-change invulnerability (0.5 s) blocks a second `damageEnemy` within 0.5 s. In the phase-3 test, the 90-damage hit lands 46 ticks (0.77 s) after the phase-2 change, so it isn't blocked. 143 − 90 = 53 < 60, so it reaches phase 3.

For each of Tasks 15–18:
- [ ] **Step 1:** Write the test file exactly as above.
- [ ] **Step 2:** Run it and confirm it fails.
- [ ] **Step 3:** Implement the module. Every number in the spec block is a requirement.
- [ ] **Step 4:** Run until it passes, then run the whole suite with `node --test` to make sure nothing else broke.

---

### Task 19: Arena, world draw order, HUD

**Files:** Create `src/art/arena.js`, `src/art/worldDraw.js`, `src/scenes/hud.js`. Test: `tests/draw.world.test.js`.

**Interfaces:**
- `CB.Arena = { draw(r, stage, t) }`.
- `CB.WorldDraw = { draw(r, world, t, { hitboxes }) }`.
- `CB.Screens.hud = { draw(r, run, t), cursor(r, x, y, mode: 'cross' | 'pointer', t) }`.

**Arena** (cosmetic, browser canvas cache per stage id, built on first draw with `document.createElement('canvas')` at 320×180):
- **Base:** the HUD strip (y 0–17) is `#0D0D12`, with a 1 px `wallLo` line at y 17. The arena floor is `floor`, with `floorLine` 1 px horizontal rules every 6 px (an editor's line grid).
- **Code lines:** 20–30 "code lines" from `CB.createRng(hash(stage.id))`. Each one is 1–4 dim rounded bars 2 px tall, coloured from `stage palette.code`, with indentation at multiples of 8 px. They must not overlap the walls.
- **Walls:** 8 px border around the arena with a 3-tone bevel (`wallLo` outer, `wall`, `wallHi` inner edge).
- **Line numbers:** the left wall carries them in a local 3×5 digit font (defined in `arena.js`, digits only), one every 12 px, starting at 1, in `lineNo` colour.
- **Per-frame effects:**
  - A slowly drifting 1-row "cursor line" highlight (alpha 0.06) moves down the floor at 6 px/s and wraps.
  - On a palette with `pulse: true`, the walls get an extra overlay of `accent` at `alpha = 0.10 + 0.08 × sin(t × 3)`.

**WorldDraw** (code given):

```js
// Draw order for one world frame. Everything here is cosmetic; nothing mutates world state.
(function (CB) {
  'use strict';
  function drawHazard(r, h, t) {
    const k = Math.min(1, h.life / 0.5);
    r.alpha(0.45 * k, () => r.disc(h.x, h.y, h.r, CB.Pal.C.greenDark));
    r.alpha(0.6 * k, () => r.ring(h.x, h.y, h.r - (Math.floor(t * 6) % 3), CB.Pal.C.green));
  }
  function drawTelegraph(r, s, t) {
    const blink = Math.floor(t * 12) % 2 === 0;
    const k = 1 - Math.max(0, s.t) / (s.total || 0.6);
    r.ring(s.x, s.y, Math.max(2, Math.round(10 - 7 * k)), blink ? CB.Pal.C.gold : CB.Pal.C.hurt);
    r.text('!', s.x, s.y - 4, { align: 'center', color: blink ? CB.Pal.C.gold : CB.Pal.C.hurt, shadow: CB.Pal.C.ink });
  }
  CB.WorldDraw = {
    draw(r, w, t, opts) {
      CB.Arena.draw(r, w.stage, t);
      for (const h of w.hazards) drawHazard(r, h, t);
      for (const s of w.spawns) drawTelegraph(r, s, t);
      const list = w.enemies.filter((e) => !e.dead && e.visible).sort((a, b) => a.y - b.y);
      for (const e of list) CB.Enemies[e.kind].draw(e, r, t);
      CB.Player.draw(w.player, r, t);
      CB.Projectiles.draw(w, r, t);
      if (w.boss) w.boss.draw(r, t);
      CB.Fx.draw(w, r, t);
      if (opts && opts.hitboxes) {
        for (const e of w.enemies) if (!e.dead) r.ring(e.x, e.y, e.r, e.targetable ? '#00FF88' : e.solid ? '#FFAA00' : '#888888');
        r.ring(w.player.x, w.player.y, w.player.r, '#00FFFF');
        for (const b of w.eBullets) r.ring(b.x, b.y, b.r, '#FF00FF');
      }
    },
  };
})(window.CB);
```

**HUD:**
- **Hearts:** at top left, starting (4, 5), 9 px apart. Sprites `heart_full` (`r`/`R` + `w` shine) and `heart_empty` (`S` outline), each 7×6. When hurt (`player.hurtT > 0`), the last lost heart blinks.
- **Dash pip:** right after the hearts, a 5×5 pip. When ready it is cyan (`c`) with a white pixel. While cooling it is dim (`C`) and fills from the bottom by `1 − dashCd / stats.dashCooldown`.
- **Stage path:** at top right, `stage.path` in the stage `accent` colour, right-aligned at x 316, y 5.
- **Centre:**
  - During `wave` it shows `WAVE n/2` in grey.
  - During `boss` and `bossDead` it shows the boss bar. The name is in small text at y 1 (`CB.Bosses[stage.boss].name`), above a bar 140×5 at (90, 10), drawn `ink` frame + `redDark` background + a `red` fill proportional to `hp / maxHp`. A white flash segment shows the last 0.3 s of damage (a trailing "ghost" bar that eases toward the fill), and the fill turns `ember` in phase ≥ 2.
- **Cursor:**
  - `cross` is a 9×9 crosshair (white with an ink outline, 1 px gap in the centre) with a 2-frame pulse driven by `t` (the arms extend 1 px every other 0.25 s).
  - `pointer` is a 7×10 arrow (white, ink outline) with its hotspot at the tip.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const files = [...H.GAME_BASE, 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/art/render.js', 'src/art/arena.js', 'src/art/worldDraw.js', 'src/scenes/hud.js'];
  const { CB, sandbox } = H.load(files, { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1), draw() {} };
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    CB.Enemies[k] = { create: (w, x, y) => CB.makeEnemy(k, x, y, { hp: 1 }), update() {}, draw(e, r) { r.disc(e.x, e.y, e.r, '#FFFFFF'); } };
  }
  CB.Bosses.stub = { id: 'stub', name: 'STUB', tagline: 't', commitMsg: 'c', create: () => ({ id: 'stub', x: 160, y: 60, hp: 50, maxHp: 100, phase: 2, defeated: false, update() {}, draw() {} }) };
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r };
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
```

- [ ] Step 1: Write the test. Step 2: Run it and confirm it fails. Step 3: Implement `arena.js` and `hud.js`, and paste `worldDraw.js` from above. Step 4: Run it until it passes.

**Rev 2 additions (Task 19):**
- **`CB.Arena.draw(r, stage, t, w)`:** the 4th argument is optional, since the title omits it. When `w` is given, draw per-frame overlays after the cached static floor and before entities. Every overlay alpha is ≤ 0.2 except the scan bar.
  - **`infiniteLoop`:** a dashed ring at `(160, 96)` with radius `w.boss.radius`, in accent at alpha 0.18. In phase 2 the left-wall line numbers cycle `1 2 3`.
  - **`memoryLeakBoss`:** a 4×100 gauge in the left wall filled bottom-up by `size − 1`, going green → yellow → red, plus a green floor tint at alpha `0.05 × (size − 1)`.
  - **`mergeConflict`:**
    - a vertical dashed divider at x 160;
    - the left half tinted blue and the right half green, both at alpha 0.07;
    - labels `<<<<<<< HEAD` (blue) at (12, 22) and `>>>>>>> incoming` (green), right-aligned at (308, 166).
  - **`heisenbug`:**
    - From phase 2, every 1.7 s a 0.12 s glitch band: 3 horizontal strips 4–8 px tall, offset ±3 px. Position and offset come from a hash of `floor(t × 8)`, never RNG.
    - In phase 3, ghost `404` and `?` texts at hashed positions.
  - **Scan bar:** while `w.glitchT > 0`, a bright 6 px scan bar sweeps top → bottom at alpha 0.35 over 0.4 s.
  - **`CB.Arena.bossTheme(id, phase)`:** a pure lookup that returns `{ overlay: id, tint }` for the four ids and `null` otherwise.
- **WorldDraw:** replace the Task 19 code with this rev-2 version.

```js
// Draw order for one world frame. Cosmetic only: nothing here mutates world state.
(function (CB) {
  'use strict';
  function drawHazard(r, h, t) {
    const k = Math.min(1, h.life / 0.5);
    r.alpha(0.45 * k, () => r.disc(h.x, h.y, h.r, CB.Pal.C.greenDark));
    r.alpha(0.6 * k, () => r.ring(h.x, h.y, h.r - (Math.floor(t * 6) % 3), CB.Pal.C.green));
  }
  function drawTelegraph(r, s, t) {
    const blink = Math.floor(t * 12) % 2 === 0;
    const k = 1 - Math.max(0, s.t) / (s.total || 0.6);
    r.ring(s.x, s.y, Math.max(2, Math.round(10 - 7 * k)), blink ? CB.Pal.C.gold : CB.Pal.C.hurt);
    r.text('!', s.x, s.y - 4, { align: 'center', color: blink ? CB.Pal.C.gold : CB.Pal.C.hurt, shadow: CB.Pal.C.ink });
  }
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
      if (CB.Pickups) CB.Pickups.draw(w, r, t);
      const list = w.enemies.filter((e) => !e.dead && e.visible).sort((a, b) => zOf(a) - zOf(b));
      for (const e of list) {
        const mod = CB.Enemies[e.kind];
        const pose = CB.Fx.pose && !e.boss ? CB.Fx.pose(e) : null;
        if (pose && (pose.sx !== 1 || pose.sy !== 1)) r.squash(e.x, e.y + e.r, pose.sx, pose.sy, () => mod.draw(e, r, t));
        else mod.draw(e, r, t);
        if (e.elite) drawElite(r, e, t);
      }
      CB.Player.draw(w.player, r, t);
      CB.Projectiles.draw(w, r, t);
      if (w.boss && !w.boss.defeated) w.boss.draw(r, t);
      if (CB.Compact) CB.Compact.draw(w, r, t);
      CB.Fx.draw(w, r, t);
      if (opts && opts.hitboxes) {
        for (const e of w.enemies) if (!e.dead) r.ring(e.x, e.y, e.r, e.targetable ? '#00FF88' : e.solid ? '#FFAA00' : '#888888');
        r.ring(w.player.x, w.player.y, w.player.r, '#00FFFF');
        for (const b of w.eBullets) r.ring(b.x, b.y, b.r, '#FF00FF');
      }
    },
  };
})(window.CB);
```

- **HUD rev 2:**
  - **Last heart:** at 1 heart, draw the remaining heart at `scale = 1 + 0.35 × player.beatPulse` (rounded down to 1 or 2 by the renderer's scale param: use `scale: beatPulse > 0.5 ? 2 : 1`, centred).
  - **Low-health vignette:** at 1 heart, three nested 1 px `frame`s around the screen edge in `hurt`, at `alpha 0.10 + 0.20 × beatPulse`.
  - **Context meter:** a 48×3 bar at (4, 13) with an `ink` background and a cyan fill of `context.value / max`. At full it flashes gold at 3 Hz and shows `[E] /compact` in gold at (56, 11).
  - **Chain:** when `w.chain.n ≥ 3`, show `x<n>` in `pale` after the meter. At `n ≥ 20` show `ULTRATHINK` instead, coloured by `floor(t × 10) % 6` through red, ember, yellow, green, cyan and purple.
  - **YOLO:** when `run.yolo`, a red `YOLO` tag at (78, 5).
  - **/compact banner:** while `w.compactBannerT > 0`, `Compacting conversation...` centred at y 22 in gold, with alpha = `min(1, compactBannerT × 3)`.
  - Everything is guarded, so the HUD works without `CB.Compact`.
- **Extra test:** add draw cases to `tests/draw.world.test.js`:
  - for each boss id (with stub `w.boss` objects carrying `id`, `phase`, `radius`, `size`), phases 1–3 and `w.glitchT` in {0, 0.2};
  - hearts = 1 with beatPulse 1;
  - `w.context = {value: 60, max: 60}` and `w.chain = {n: 25}`;
  - `w.compactBannerT = 0.5` and `run.yolo = true`;
  - an elite enemy (`elite: true`);
  - `CB.Arena.draw(r, stage, t)` with no 4th argument;
  - `CB.Arena.bossTheme('nope', 1) === null`.

### Task 20: Screens (overlays, patch pick, game over, victory, panic)

**Files:** Create `src/scenes/screens.js`, `src/scenes/patchPick.js`, `src/scenes/gameOver.js`, `src/scenes/victory.js`, `src/scenes/panic.js`. Test: `tests/draw.screens.test.js`.

**Interfaces:**
- Each screen is `CB.Screens.<name> = { draw(r, run, t, ui?) }`. The panic screen is `CB.Screens.panic.draw(r, err)`.
- `CB.Screens.patchPick` also exposes `CARDS = [{x: 22, y: 44, w: 84, h: 100}, {x: 118, …}, {x: 214, …}]` and `cardAt(x, y) → 0 | 1 | 2 | -1`.
- `CB.Screens.victory.formatTime(seconds) → 'm:ss'`.

**Screen specs.** Every overlay reads `run.stateT` for its animation. Use `CB.Pal.C` colours and `r.text` with `shadow: CB.Pal.C.ink`.

- **`stageIntro`** (screens.js):
  - A 34 px band at y 70, `ink` at alpha 0.7.
  - `STAGE n` at scale 2, centred at y 74, typed out one character per 0.06 s.
  - `stage.path` in `accent` at y 92, typed out after the title finishes.
  - The band fades out over the last 0.3 s of `CB.RUN_T.stageIntro`.
- **`waveBanner`** (screens.js):
  - During `waveBreak`, show `WAVE 2` at scale 2, centred at y 74, plus `incoming…` below in grey.
  - During `wave` with `stateT < 1.2`, show `WAVE n/2` at scale 1, centred at y 40, fading out.
- **`bossWarn`** (screens.js):
  - Top and bottom 10 px hazard stripes (diagonal `hurt`/`ink` stripes scrolling at 30 px/s).
  - `⚠ WARNING ⚠` blinking at 4 Hz, centred at y 56, in `hurt`.
  - The boss `name` at scale 2, centred at y 72.
  - The `tagline` centred at y 92 in `gold`, typed out.
  - A red screen-edge vignette pulsing at 2 Hz (`frame` rects at alpha 0.3).
  - Screens are draw-only and never play audio. The warning sound comes from the `bossWarn` event the run emits (Task 4).
- **`bossDead`** (screens.js):
  - While `stateT > CB.RUN_T.slowmo`, show `BUG FIXED ✓` at scale 2 in `green`, centred at y 64.
  - Below it, `git commit -m "<commitMsg>"` in `pale`, typed out at y 84.
- **`pause`** (screens.js):
  - The full screen dimmed (`ink` at alpha 0.75).
  - `PAUSED` at scale 2, centred at y 50.
  - `Esc: resume · M: mute · Q: quit to title` at y 72.
  - `Sound: on/off` (from `CB.Audio.isMuted()`, guarded by `CB.Audio &&`) at y 84.
  - The owned patches as `Name ×n` lines from y 104.
- **`patchPick`:**
  - The dimmed screen, with the title `PR #<stageIndex + 1> — choose a patch` centred at y 24.
  - Each card is drawn only after `stateT ≥ 0.15 × i`, sliding up 8 px into place by 0.6 s:
    - frame: `wall`-coloured fill, `ink` frame;
    - an icon sprite `patch_<id>` (12×12, define all 7 in this file) at the card's top centre, scale 2;
    - the name (wrapped to the card width − 8);
    - the description in `pale` (wrapped);
    - stack pips at the bottom (`●` filled for owned + new, `○` empty up to max; draw with discs);
    - the key hint `[1]` / `[2]` / `[3]`.
  - The hovered card (`ui.hover`) gets a 2 px `gold` frame and lifts 2 px.
  - Until 0.6 s, a small `…` shows under the title, matching the input lock.
- **`gameOver`:**
  - Dim overlay. `Segmentation fault` at scale 2 in `hurt` at y 56. `(core dumped)` at y 76.
  - `Clawd crashed in <stage.path>` in `pale` at y 92.
  - `deaths: N` at y 104.
  - After `stateT ≥ 0.6`: `R / click: retry stage`, then `Q: quit to title` at y 124 / 136.
- **`victory`:**
  - Full overlay `ink` at alpha 0.8, then `ALL TESTS PASSING ✓` at scale 2 in `green` at y 40.
  - Clawd `clawd_idle0`/`clawd_idle1` at scale 3, centred at y 84, hopping (`y −= abs(sin(t × 6)) × 4`).
  - Stats lines at y 116: `time m:ss`, `deaths N`, `patches: a, b, c` (from `run.history`, or `none`).
  - After `stateT > 1.5`: `Click to play again` blinking at y 160.
  - Confetti: 24 ✻ sparks with positions derived from `t` and the index (no RNG), in `gold`, `spark` and `clawd` colours.
- **`panic`:**
  - Clear to `#0A0A14`.
  - `KERNEL PANIC` at scale 2 in `#FF6B6B`, at (16, 16).
  - The error message wrapped to 288 px, max 6 lines, from y 40.
  - The first line of `err.stack` that contains `src/` in grey.
  - `Press R to reload` at y 160.
  - Wrap it in try/catch; it must not throw even if `CB.Font` is missing (fall back to `r.ctx.fillText`).

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const files = [...H.GAME_BASE, 'src/game/stages.js', 'src/game/waves.js', 'src/game/stageRunner.js', 'src/art/render.js',
    'src/scenes/screens.js', 'src/scenes/patchPick.js', 'src/scenes/gameOver.js', 'src/scenes/victory.js', 'src/scenes/panic.js'];
  const { CB, sandbox } = H.load(files, { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1), draw() {}, wrap: (s) => [String(s)] };
  CB.Bosses.stub = { id: 'stub', name: 'STUB', tagline: 'noop()', commitMsg: 'fix: stub', create: () => ({ x: 160, y: 60, hp: 1, maxHp: 1, phase: 1, defeated: false, update() {}, draw() {} }) };
  CB.STAGES = CB.STAGES.map((s) => Object.assign({}, s, { boss: 'stub' }));
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r };
}

test('screens: every overlay draws across its timeline without throwing', () => {
  const { CB, r } = setup();
  const run = CB.createRun({ seed: 1, patches: { spread: 1 } });
  run.history = ['spread'];
  run.offer = ['rapid', 'pierce', 'heart'];
  const screens = { stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn', bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory' };
  for (const [state, screen] of Object.entries(screens)) {
    run.state = state;
    for (const st of [0, 0.3, 0.7, 1.6, 2.4]) {
      run.stateT = st;
      CB.Screens[screen].draw(r, run, st, { hover: 1 });
    }
  }
  CB.Screens.pause.draw(r, run, 0);
});

test('screens: patch card hit-testing', () => {
  const { CB } = setup();
  const P = CB.Screens.patchPick;
  assert.equal(P.CARDS.length, 3);
  assert.equal(P.cardAt(P.CARDS[0].x + 1, P.CARDS[0].y + 1), 0);
  assert.equal(P.cardAt(P.CARDS[2].x + P.CARDS[2].w - 1, P.CARDS[2].y + P.CARDS[2].h - 1), 2);
  assert.equal(P.cardAt(P.CARDS[1].x - 2, P.CARDS[1].y + 10), -1);
  assert.equal(P.cardAt(5, 5), -1);
  for (const id of CB.Patches.ORDER) assert.ok(CB.Art.hasSprite('patch_' + id), id);
});

test('screens: victory time format', () => {
  const { CB } = setup();
  const f = CB.Screens.victory.formatTime;
  assert.equal(f(0), '0:00');
  assert.equal(f(61.9), '1:01');
  assert.equal(f(600), '10:00');
});

test('screens: panic screen never throws', () => {
  const { CB, r } = setup();
  const e = new Error('TypeError: cannot read properties of undefined (reading x) '.repeat(4));
  CB.Screens.panic.draw(r, e);
  CB.Screens.panic.draw(r, { message: 'no stack' });
  delete CB.Font;
  CB.Screens.panic.draw(r, e);
});
```

- [ ] Step 1: Write the test. Step 2: Run it and confirm it fails. Step 3: Implement. Step 4: Run it until it passes.

**Rev 2 additions (Task 20):**
- **`stageIntro`:** when `CB.Quips` exists, the band grows to 56 px (y 62–118). Under the path, type `CB.Quips.stage[run.stageIndex]` (2 lines) in `pale` at 0.02 s per character, starting at 0.5 s.
- **`bossWarn`:** draw `CB.Bosses[id].portrait` (if the sprite exists) at scale 4, beneath the text:
  - it slides from y 190 to y 138 over 0.6 s (easeOutCubic);
  - two chromatic copies at ±2 px and alpha 0.35, with the offset flipping every 0.05 s via `floor(t × 20) % 2`;
  - from `stateT ≥ 2.3`, it flashes `white: true` at 8 Hz.
- **`bossDead`** (after `stateT > CB.RUN_T.slowmo`):
  - `BUG FIXED ✓` at scale 2 in green, centred at y 40, then `git commit -m "<commitMsg>"` typed at y 58.
  - A diff panel (x 40–280, from y 72) with a header `@@ <file> @@` in grey, then the boss `diff` lines, one every 0.25 s. `-` lines go on a `redDark` bar at alpha 0.3 with `red` text; `+` lines go on a `greenDark` bar at alpha 0.3 with `green` text.
  - Then `✓ 1 test passing` in green.
  - Everything must fit before `stateT = 3.0`.
- **`victory`:**
  - **Tally:** under the stats, a row of up to 5 cells, one per kind with `run.squashed[kind] > 0`. Each cell is sprite `<kind>_0` (guarded with `hasSprite`) with `x<count>` under it, spaced 56 px apart around y 132.
  - **`git log`:** a list in grey of the fixed bosses, `<hash> <commitMsg>`, where `hash = ((run.seed × 2654435761 + i × 97) >>> 0).toString(16).padStart(8, '0').slice(0, 7)`.
  - **Chain:** `longest chain x<run.maxChain>` when > 0.
  - **Clawd:** drawn with `CB.Player.draw`-style sprites and `expr: 'happy'`, or the `clawd_idle0_happy` sprite if it exists.
  - **Layout:** re-flow so nothing overlaps at 320×180. Drop the confetti density if needed.
  - **Exports:** `CB.Screens.victory.commitHash(seed, i)` is exported for the test.
- **`gameOver`:**
  - Below `deaths: N`, a third line `CB.Quips.dead[(run.deaths × 3 + run.stageIndex) % n]` in grey (guarded).
  - The retry hint reads `R / click: retry boss` when `run.diedInBoss`, else `retry stage`.
  - The quit hint appears only after the input lock.
- **`pause`:** when the play scene's `quitArmT > 0`, replace the hint line with `Press Q again to quit` in gold. The screen receives it via `ui.quitArmT`; Task 7's play.js passes `{ hover, quitArmT }` as `ui`.
- **Test additions:**
  - draw `bossDead` at `stateT` 1.6, 2.2 and 2.9 with each real boss's `diff`, using stub bosses with `diff` and `file`;
  - draw `victory` with a populated `run.squashed`;
  - `commitHash(1, 0)` is 7 lowercase hex chars and deterministic;
  - draw `gameOver` with `diedInBoss` true and false.

### Task 21: Title scene

**Files:** Create `src/scenes/title.js`. Test: `tests/draw.title.test.js`.

**Interface:** `CB.Scenes.title = { enter(game, data), update(dt, input), draw(r, t) }`. On `input.confirm` after 0.3 s in the scene, it emits `uiSelect` via `CB.Audio.play('uiSelect')` and calls `game.go('play', {})`.

**Spec:**
- **Background:** the `src` arena (`CB.Arena.draw` with a fake stage `{ id: 'title', palette: 'src' }`), dimmed with `ink` at alpha 0.55.
- **Logo:**
  - `CLAWD` at scale 3 in `clawd` with a `clawdDark` shadow, centred at y 22.
  - `vs` at scale 1 in `pale` at y 46.
  - `BUGS` at scale 3 in `red` with `redDark` shadow at y 56.
  - Logo letters bob 1 px in a wave (each letter offset by its index).
- **Clawd:** `clawd_idle0/1` at scale 3, centred at (160, 104). Every 2 s Clawd fires a ✻ spark to the right at a wandering bug, drawn cosmetically.
- **Bugs:** 4 wandering cosmetic bugs (`syntaxError_0`, `raceCondition_0`, `memoryLeak_0`, `nullPointer_0` if defined, otherwise plain discs), moved in `update` by a scene-owned `CB.createRng(7)`.
- **Prompt:** `Click to start` blinking (0.6 s on, 0.3 s off) at y 132.
- **Controls:** `WASD move · Mouse aim · Click shoot · Space dash · Esc pause · M mute` in `pale` at y 148, wrapped if needed.
- **Footer:** `Fan game. Not affiliated with Anthropic.` in `greyDark` at y 170.
- **Small screens:** if `matchMedia('(pointer: coarse)').matches || innerWidth < 480` (guarded), add `Best on desktop with keyboard + mouse` in `gold` at y 120.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('title: draws, animates and starts the game on confirm', () => {
  const files = [...H.GAME_BASE, 'src/art/render.js', 'src/scenes/title.js'];
  const { CB, sandbox } = H.load(files, { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s, sc) => String(s).length * 6 * (sc || 1), draw() {}, wrap: (s) => [String(s)] };
  CB.Arena = CB.Arena || { draw() {} };
  CB.Audio = { play() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const visits = [];
  const game = { go: (n, d) => visits.push(n), input: { peekAim: () => ({ x: 0, y: 0 }) }, debug: {} };
  const title = CB.Scenes.title;
  title.enter(game, {});
  for (let i = 0; i < 120; i++) {
    title.update(CB.DT, H.makeInput());
    if (i % 20 === 0) title.draw(r, i * CB.DT);
  }
  assert.equal(visits.length, 0);
  title.update(CB.DT, H.makeInput({ confirm: true }));
  assert.deepEqual(visits, ['play']);
});

test('title: confirm is ignored during the first 0.3 s', () => {
  const files = [...H.GAME_BASE, 'src/art/render.js', 'src/scenes/title.js'];
  const CB = H.load(files);
  CB.Audio = { play() {} };
  const visits = [];
  const title = CB.Scenes.title;
  title.enter({ go: (n) => visits.push(n), input: { peekAim: () => ({ x: 0, y: 0 }) } }, {});
  title.update(CB.DT, H.makeInput({ confirm: true }));
  assert.equal(visits.length, 0);
});
```

- [ ] Step 1: Write the test. Step 2: Run it and confirm it fails. Step 3: Implement. Step 4: Run it until it passes.

---

**Rev 2 additions (Task 21):**
- **Enter:** call `CB.Music && CB.Music.stop()`. Create `this.secrets = CB.Secrets ? CB.Secrets.create() : null`.
- **Hats:**
  - When `CB.Unlocks && CB.Unlocks.hats().length > 0`, show `hat: <name> (A/D)` in `pale` at y 120. A rising edge of `input.moveX` (from 0 to ±1) calls `CB.Unlocks.cycleHat(sign)`.
  - Draw the selected hat on the big title Clawd with `CB.Player.drawHat(r, 160, 104 - 20, id, 1, 3)` (guarded).
- **Secrets:** feed every code in `input.keys` to `this.secrets.feed(code)`.
  - `'konami'` calls `CB.Unlocks.unlock('halo')`.
  - `'ultrathink'` calls `CB.Unlocks.unlock('rainbow')`.
  - On a fresh unlock, show a 2 s toast at y 160 (`cheat codes are just undocumented features` for konami, `✻ ultrathink enabled` for ultrathink) and play `CB.Audio.play('unlock')`.
- **Modes:** when `CB.Unlocks.has('modes')`, show two clickable lines under `Click to start`:
  - `[ boss rush ]`;
  - a toggle, `[ ] --yolo` or `[x] --yolo`.

  Expose them for hit-testing as `CB.Scenes.title.BUTTONS = [{id: 'rush', x, y, w, h}, {id: 'yolo', …}]`. On `confirm`:
  - inside `rush`: start play with `{ runOpts: { bossRush: true, yolo: this.yolo } }`;
  - inside `yolo`: toggle `this.yolo`;
  - anywhere else after 0.3 s: start a normal run with `{ runOpts: { yolo: this.yolo } }`.
- **Status line:** `M: sound <on/off> · N: music <on/off>` in `greyDark` at y 177, read from `CB.Audio.isMuted()` and `CB.Music.isEnabled()` (both guarded). The footer moves to y 170.
- **Cursor:** finish with `const a = game.input.peekAim(); CB.Screens.hud && CB.Screens.hud.cursor(r, a.x, a.y, 'pointer', t);`.
- **Sprites:** for each of the 4 wandering bugs, use `CB.Art.hasSprite(name) ? r.sprite(…) : r.disc(…)`.
- **Test additions** (stub `CB.Unlocks`/`CB.Secrets` objects):
  - feeding the konami codes through `input.keys` calls `unlock('halo')`;
  - with `has('modes')` true, a confirm inside the rush button starts play with `bossRush: true`;
  - moveX edges cycle the hat.


### Task 21A: Clawd body language and hats (owns `src/game/player.js` in Phase B)

**Files:** Modify `src/game/player.js` (draw-side additions only; logic changes are limited to the cosmetic fields below). Test: `tests/player.look.test.js`.

**Spec:**
- **Expressions:**
  - A helper `makeClawd(rowsBody, legA, legB, expr)` builds sprites by replacing the eye cells of `BODY` rows 2–3 at columns 6 and 11. The 3×2 eye templates use columns 5–7 and 10–12:

    | Expression | Rows A / B |
    |---|---|
    | normal | `.k.` / `.k.` |
    | hurt | `k.k` / `.k.` |
    | happy | `.k.` / `k.k` |
    | angry | left `kk.` / `.k.`, right `.kk` / `.k.` |
    | squint | `...` / `kkk` |
    | worried | normal, plus one `c` sweat pixel at column 13, row 1 |

  - Define `clawd_<pose>_<expr>` for poses `idle0`, `idle1`, `walk0`, `walk2` and every expression. The original five names stay as they are and mean "normal".
- **`Player.expression(p)`** is pure, with this priority:
  1. `hurtT > 0.6` gives `hurt`;
  2. `dashT > 0` gives `angry`;
  3. `hearts === 1` gives `worried`;
  4. `idleT > 2.5` gives `squint`;
  5. otherwise `normal`.
- **`Player.pose(p) → { sx, sy }`:**
  - dashing (`dashT > 0`): horizontal dash gives `{1.3, 0.8}` and vertical gives `{0.8, 1.3}`, chosen by `|dashDX| ≥ |dashDY|`;
  - `hurtT > 0.85`: `{1.3, 0.7}`, lerping back to 1 over 0.15 s;
  - `kick > 0.5`: `{0.95, 1.05}`;
  - otherwise exactly `{1, 1}`.
  The anchor is the feet (`p.x, p.y + 4`), using `r.squash`.
- **Recoil:** `Player.fire` sets `p.kick = 1`, and `update` decays it by `dt * 14` (min 0). `draw` offsets the sprite by `−aimDir × 2 × kick` px, rounded. `p.x`/`p.y` are never changed.
- **Idle:** `p.idleT` grows while there is no move, fire or dash input, and resets otherwise. At `idleT ≥ 2.5`, draw `✻ Thinking...` in `pale` above Clawd, with the leading glyph cycling `·` `*` `✻` at 8 Hz.
- **Hats:**
  - 11×6 sprites `hat_loopcap`, `hat_slime`, `hat_branch` (a blue/green two-tone beanie), `hat_shades` (sunglasses worn over the eyes; draw them on the eye row instead of above the head), `hat_crown`, `hat_sudo` (a `#` hat) and `hat_halo` (yellow ring floating 2 px above).
  - `CB.Player.drawHat(r, x, y, hatId, facing, scale = 1)` draws a hat for an arbitrary position. The title uses it too.
  - `Player.draw` draws `CB.Unlocks && CB.Unlocks.hat()` on Clawd, bobbing with the idle frame.
- **Draw override:** `Player.draw(p, r, t, opts)` accepts `opts.expr` (the victory screen passes `'happy'`).

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js'], { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r, w: CB.createWorld({ seed: 2 }) };
}

test('look: expression sprites exist at 16x12 and the original names are unchanged', () => {
  const { CB } = setup();
  for (const pose of ['idle0', 'idle1', 'walk0', 'walk2']) {
    for (const ex of ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried']) {
      const d = CB.Art.spriteDef(`clawd_${pose}_${ex}`);
      assert.ok(d, `${pose} ${ex}`);
      assert.equal(d.w, 16);
      assert.equal(d.h, 12);
    }
  }
  assert.deepEqual(H.plain(CB.Art.spriteDef('clawd_idle0').rows), H.plain(CB.Art.spriteDef('clawd_idle0_normal').rows));
});

test('look: expression priority', () => {
  const { CB, w } = setup();
  const p = w.player;
  assert.equal(CB.Player.expression(p), 'normal');
  p.idleT = 3;
  assert.equal(CB.Player.expression(p), 'squint');
  p.hearts = 1;
  assert.equal(CB.Player.expression(p), 'worried');
  p.dashT = 0.1;
  assert.equal(CB.Player.expression(p), 'angry');
  p.hurtT = 0.9;
  assert.equal(CB.Player.expression(p), 'hurt');
});

test('look: pose is (1,1) at rest and stays within 0.7..1.3', () => {
  const { CB, w } = setup();
  const p = w.player;
  assert.deepEqual(H.plain(CB.Player.pose(p)), { sx: 1, sy: 1 });
  for (const s of [{ dashT: 0.1, dashDX: 1, dashDY: 0 }, { dashT: 0.1, dashDX: 0, dashDY: 1 }, { hurtT: 0.95 }, { kick: 1 }]) {
    const q = CB.Player.pose(Object.assign({}, p, s));
    assert.ok(q.sx >= 0.7 && q.sx <= 1.3 && q.sy >= 0.7 && q.sy <= 1.3, JSON.stringify(q));
  }
});

test('look: recoil kicks and decays without moving the hitbox; idle timer grows and resets', () => {
  const { CB, w } = setup();
  const p = w.player;
  const x0 = p.x;
  H.stepN(w, 1, () => H.makeInput({ fire: true, aimX: 300, aimY: p.y }));
  assert.ok(p.kick > 0.7);
  H.stepN(w, 8, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.equal(p.kick, 0);
  assert.equal(p.x, x0);
  H.stepN(w, 180, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.ok(p.idleT > 2.5);
  H.stepN(w, 1, () => H.makeInput({ moveX: 1 }));
  assert.equal(p.idleT, 0);
});

test('look: draw with every expression, the bubble and every hat runs headless', () => {
  const { CB, r, w } = setup();
  const p = w.player;
  p.idleT = 3;
  for (const ex of ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried']) CB.Player.draw(p, r, 1.2, { expr: ex });
  for (const id of ['loopcap', 'slime', 'branch', 'shades', 'crown', 'sudo', 'halo']) {
    assert.ok(CB.Art.hasSprite('hat_' + id), id);
    CB.Player.drawHat(r, 100, 100, id, -1, 2);
  }
});
```

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 21B: FX juice: bug life cycle, muzzle flash, boss finale, glitch, quip hooks (owns `src/game/fx.js` in Phase B)

**Files:** Modify `src/game/fx.js` (keep `CB.IMPACT` and all existing behaviour). Test: `tests/fx.juice.test.js`.

**Spec:**
- **`CB.Fx.pose(e) → { sx, sy }`** is pure:
  - pop-in while `e.t < 0.25`: `sy` eases 0.2 → 1.2 (at 0.15 s) → 1.0 (at 0.25 s), with `sx = clamp(1/sy, 0.8, 1.4)`;
  - hit squash while `e.hitFlash > 0`: `{1.12, 0.9}`;
  - otherwise exactly `{1, 1}`;
  - boss parts always return `{1, 1}`.
- **Spawn:** the `spawn` event adds an `implode` effect: 8 white 1 px particles converging from radius 10 over 0.15 s.
- **Death** (non-silent, non-boss `enemyDie`):
  - a white `pop` disc of radius `r` for 0.06 s;
  - `4 + r` debris squares (2×2) in the kind's colours, from `KIND_COLOR`, at speed 40–90, damped, life 0.5;
  - a `decal`: a disc of radius `0.9 r`, alpha 0.35, in the kind's dark colour, life 6 s fading over the last 2 s. Keep at most 40 decals, dropping the oldest first.

  `KIND_COLOR` maps syntaxError to red/redDark, nullPointer to pale/grey, raceCondition to yellow/yellowDark, memoryLeak to green/greenDark and offByOne to purple/purpleDark.
- **`Fx.drawUnder(w, r, t)`** draws decals. WorldDraw calls it before entities.
- **Muzzle:** each `shoot` event adds a `muzzle` effect (life 0.06 s): a 3×3 white core, a gold 5 px plus, and a 4 px streak along `angle`.
- **Finale:** on `bossDie`, schedule 12 blasts into `w.fxQueue` at `w.time + 0.03*k`.
  - Positions cycle through `CB.Bosses[w.boss.id].deathPoints(w.boss)`, falling back to the boss x/y plus `fxRng` jitter within 20 px.
  - Each blast is a ring from 2 to 14 px, 14 sparks alternating gold, ember and white, and `w.addShake(2)`. It also emits a `blast` event with x, y; that event is for audio only, because it is emitted from `update` after `consume`.
  - At `w.time + 0.45` comes a full-screen white ring growing from 0 to 300 px, and 60 confetti sparks drifting up in clawd, gold and spark colours.
  - `Fx.update` runs due queue entries.
- **Glitch:** `bossPhase` sets `w.glitchT = 0.4`, which decays in `Fx.update`.
- **Quips** (when `CB.Quips` exists):
  - **Kills:** text comes from `CB.Quips.pick(w.fxRng, CB.Quips.kill[kind])` at the existing 50% chance, falling back to `DEATH_TEXT`.
  - **Hurt:** a 35% chance on `playerHurt` (not god), with a global cooldown `w.quipT = 5` s.
  - **Boss phase:** `CB.Quips.bossPhase[w.boss.id][phase]` in gold above the boss, life 1.6 s.
- **Caps:** everything respects `CAPS.fx` and uses `w.fxRng` only.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js'], { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  CB.Enemies.dummy = { create: (w, x, y, o) => CB.makeEnemy('dummy', x, y, Object.assign({ hp: 2, r: 6 }, o || {})), update() {}, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r, w: CB.createWorld({ seed: 4, god: true }) };
}
const idle = () => H.makeInput({ aimX: 160, aimY: 30 });

test('juice: pose is exactly (1,1) after 0.25 s and bounded during pop-in', () => {
  const { CB } = setup();
  for (let t = 0; t < 0.25; t += 0.01) {
    const q = CB.Fx.pose({ t, hitFlash: 0, boss: false });
    assert.ok(q.sy >= 0.2 && q.sy <= 1.4 && q.sx >= 0.8 && q.sx <= 1.4);
  }
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 0.3, hitFlash: 0 })), { sx: 1, sy: 1 });
  assert.ok(CB.Fx.pose({ t: 1, hitFlash: 0.05 }).sy < 1);
  assert.deepEqual(H.plain(CB.Fx.pose({ t: 0, hitFlash: 0.05, boss: true })), { sx: 1, sy: 1 });
});

test('juice: a kill leaves a decal and debris; a silent kill leaves no decal; decals cap at 40', () => {
  const { w } = setup();
  const e = w.spawnEnemy('dummy', 100, 80);
  H.stepN(w, 1, idle);
  w.damageEnemy(e, 5);
  const f = w.spawnEnemy('dummy', 150, 80);
  H.stepN(w, 1, idle);
  w.killEnemy(f, true);
  H.stepN(w, 1, idle);
  assert.equal(w.fx.filter((x) => x.kind === 'decal').length, 0, 'decals only from in-step deaths');
  for (let i = 0; i < 60; i++) {
    const g = w.spawnEnemy('dummy', 40 + i, 60, { hp: 0.5 });
    w.firePlayerBolt(g.x, g.y, 0);
  }
  H.stepN(w, 2, idle);
  const decals = w.fx.filter((x) => x.kind === 'decal').length;
  assert.ok(decals > 0 && decals <= 40, `decals ${decals}`);
  assert.ok(w.fx.length <= 500);
});

test('juice: bossDie schedules 12 blasts that all fire within 0.4 world seconds', () => {
  const { CB, w } = setup();
  CB.Bosses.stub = { id: 'stub', deathPoints: () => [{ x: 100, y: 60 }, { x: 120, y: 70 }] };
  w.boss = { id: 'stub', x: 110, y: 65, hp: 0, maxHp: 1, phase: 1, defeated: true, update() {}, draw() {} };
  const from = w.events.length;
  w.emit('bossDie', { x: 110, y: 65 });
  CB.Fx.consume(w, from);
  let blasts = 0;
  for (let i = 0; i < 40; i++) {
    const mark = w.events.length;
    H.stepN(w, 1, idle);
    blasts += w.events.slice(mark).filter((e) => e.type === 'blast').length;
  }
  assert.equal(blasts, 12);
  assert.ok(w.fx.some((f) => f.kind === 'ring'));
});

test('juice: muzzle flash per volley and glitch on phase change; everything stays finite', () => {
  const { CB, w, r } = setup();
  H.stepN(w, 1, () => H.makeInput({ fire: true, aimX: 300, aimY: 126 }));
  assert.equal(w.fx.filter((f) => f.kind === 'muzzle').length, 1);
  CB.Enemies.ph = { create: (w2, x, y) => CB.makeEnemy('ph', x, y, { contact: false }), update(e, w2) { if (!e.data.d) { e.data.d = 1; w2.emit('bossPhase', { x: 1, y: 1, phase: 2 }); } }, draw() {} };
  w.spawnEnemy('ph', 10, 30);
  H.stepN(w, 1, idle);
  assert.ok(w.glitchT > 0.3);
  H.stepN(w, 200, idle);
  for (const f of w.fx) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.y));
  CB.Fx.drawUnder(w, r, 1);
  CB.Fx.draw(w, r, 1);
});
```

> Kill-decal test: an enemy must die *inside* a step for its `enemyDie` to reach `consume`. The test fires zero-life-buffer bolts onto 60 fragile dummies, which collide during the next step.

- [ ] Write the test, see it fail, implement, see it pass, then run the full `node --test`.

### Task 21C: Quips data (`quips.js`)

**Files:** Create `src/game/quips.js`. Test: `tests/quips.test.js`. Depends on Task 8 (font) for the glyph lint.

**Spec:**

```js
CB.Quips = {
  stage: [ [line1, line2] × 4 ],      // typed under STAGE n / path in the intro
  waveBreak: [...], hurt: [...], lowHp: [...], dead: [...], victory: [...],
  kill: { syntaxError: [...], nullPointer: [...], raceCondition: [...], memoryLeak: [...], offByOne: [...] },
  bossPhase: { infiniteLoop: { 2: [...] }, memoryLeakBoss: { 2: [...] }, mergeConflict: { 2: [...] }, heisenbug: { 2: [...], 3: [...] } },
  pick(rng, list, lastIdx = -1) → { text, idx },   // never repeats lastIdx when list.length > 1
};
```

**Content seeds** (extend each pool to ≥ 3 lines in the same voice):

| Pool | Lines |
|---|---|
| Stage 1 (`src`) | `> fix the failing tests`, `✻ Thinking... (esc to interrupt)` |
| Stage 2 (`node_modules`) | `> why is the heap 99% full`, `✻ Compacting conversation...` |
| Stage 3 (`git`) | `> resolve the merge conflict`, `✻ Reading MERGE_HEAD...` |
| Stage 4 (`prod`) | `> it works on my machine`, `⚠ this is prod. continue? (y/n)` |
| kill: syntaxError | `Fix(;)`, `missing ;`, `lint: ok` |
| kill: nullPointer | `Fix(null)`, `?.`, `undefined` |
| kill: raceCondition | `await`, `mutex`, `lock()` |
| kill: memoryLeak | `free()`, `gc()`, `drop(x)` |
| kill: offByOne | `i<n`, `n-1`, `<=` |
| hurt | `ouch`, `NaN`, `undefined`, `403`, `rate limited` |
| dead | `Clawd ran out of context`, `exit code 139`, `unexpected EOF`, `max turns reached` |
| bossPhase | infiniteLoop 2: `// TODO: add exit condition`; memoryLeakBoss 2: `malloc(99%)`; mergeConflict 2: `git add -p ???`; heisenbug 2: `cannot reproduce`; heisenbug 3: `works on my machine` |

**Rules:**
- Generic software and CLI humour only. Never claim official strings or affiliation. No line may match `/anthropic|official|claude\.ai/i`.
- Pop lines are ≤ 150 px at scale 1 and prompt lines ≤ 290 px.
- Every character must have a glyph in `CB.Font.GLYPHS`.

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const FILES = ['src/core/ns.js', 'src/core/math.js', 'src/core/rng.js', 'src/art/font.js', 'src/game/quips.js'];

function allLines(Q) {
  const out = [];
  for (const pair of Q.stage) out.push(...pair);
  for (const k of ['waveBreak', 'hurt', 'lowHp', 'dead', 'victory']) out.push(...Q[k]);
  for (const k of Object.keys(Q.kill)) out.push(...Q.kill[k]);
  for (const b of Object.keys(Q.bossPhase)) for (const ph of Object.keys(Q.bossPhase[b])) out.push(...Q.bossPhase[b][ph]);
  return out;
}

test('quips: every character has a glyph and no line implies affiliation', () => {
  const CB = H.load(FILES);
  for (const line of allLines(CB.Quips)) {
    for (const ch of line) assert.ok(CB.Font.GLYPHS[ch], `missing glyph ${JSON.stringify(ch)} in "${line}"`);
    assert.doesNotMatch(line, /anthropic|official|claude\.ai/i);
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
  for (const k of ['waveBreak', 'hurt', 'lowHp', 'dead', 'victory']) assert.ok(Q[k].length >= 3, k);
  for (const k of ['syntaxError', 'nullPointer', 'raceCondition', 'memoryLeak', 'offByOne']) {
    assert.ok(Q.kill[k].length >= 3, k);
    for (const l of Q.kill[k]) assert.ok(CB.Font.measure(l) <= 150, l);
  }
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
```

- [ ] Write the test, see it fail, implement, see it pass.


---

## Phase C — Integration, playthrough, delivery

### Task 22: Headless bot and full playthrough

**Files:** Create `tests/bot.js`, `tests/sim.test.js`. May modify numbers in `src/game/**` during balancing (Step 5) with orchestrator review.

**Interfaces:**
- Consumes: the whole game, loaded through `H.load()` (all `index.html` scripts, `CB_NO_BOOT`).
- Produces: `makeBot(opts) → (run) → InputState`.

- [ ] **Step 1: Create `tests/bot.js`**

```js
'use strict';
// Deterministic headless bot.
// Targeting: boss parts first. Among them it keeps its current target unless another part has 15+ more HP.
// This level-keeping wears the Merge Conflict twins down evenly, so both can fall inside the resolve window,
// and it ignores Heisenbug's 1-HP decoys while the real body is targetable. With no boss part it shoots the
// nearest regular bug.
// Movement: kite at ~80 px, strafe, lead the aim, steer off walls, dash across bullets about to hit.
// /compact fires as soon as the meter is full during a boss fight, or when 6+ bullets are on screen.
function clamp1(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function makeBot(opts) {
  const o = Object.assign({ kite: 80, delayTicks: 0 }, opts || {});
  let strafe = 1;
  let strafeT = 1.5;
  let current = null;
  const queue = [];

  function decide(run) {
    const w = run.world;
    const p = w.player;
    const inp = { moveX: 0, moveY: 0, aimX: p.x + 40, aimY: p.y, fire: true, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] };
    if (run.state === 'patchPick') {
      if (run.stateT > 0.7) inp.choice = 1;
      inp.fire = false;
      return inp;
    }
    if (run.state === 'dead') {
      if (run.stateT > 0.7) inp.retry = true;
      return inp;
    }
    const live = (e) => e && !e.dead && e.visible && e.targetable;
    const bossParts = w.enemies.filter((e) => live(e) && e.boss);
    let best = null;
    if (bossParts.length) {
      const top = bossParts.reduce((a, b) => (b.hp > a.hp ? b : a));
      best = live(current) && current.boss && top.hp - current.hp < 15 ? current : top;
    } else {
      let bestD = Infinity;
      for (const e of w.enemies) {
        if (!live(e)) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
    current = best;
    let mx = 0;
    let my = 0;
    if (best) {
      const d = Math.hypot(best.x - p.x, best.y - p.y) || 1;
      const lead = d / p.stats.boltSpeed;
      inp.aimX = best.x + (best.vx || 0) * lead;
      inp.aimY = best.y + (best.vy || 0) * lead;
      const nx = (best.x - p.x) / d;
      const ny = (best.y - p.y) / d;
      if (d < o.kite - 15) {
        mx -= nx;
        my -= ny;
      } else if (d > o.kite + 25) {
        mx += nx;
        my += ny;
      }
      mx += -ny * strafe * 0.8;
      my += nx * strafe * 0.8;
    }
    strafeT -= 1 / 60;
    if (strafeT <= 0) {
      strafe = -strafe;
      strafeT = 1.2 + ((w.time * 7.31) % 1);
    }
    const a = w.arena;
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    if (p.x < a.x + 24 || p.x > a.x + a.w - 24 || p.y < a.y + 24 || p.y > a.y + a.h - 24) {
      mx += (cx - p.x) / 50;
      my += (cy - p.y) / 50;
    }
    for (const b of w.eBullets) {
      const vv = b.vx * b.vx + b.vy * b.vy;
      if (vv < 1) continue;
      const rx = p.x - b.x;
      const ry = p.y - b.y;
      const tc = (rx * b.vx + ry * b.vy) / vv;
      if (tc < 0 || tc > 0.3) continue;
      const qx = b.x + b.vx * tc - p.x;
      const qy = b.y + b.vy * tc - p.y;
      if (qx * qx + qy * qy < 100) {
        const l = Math.sqrt(vv);
        const side = qx * -b.vy + qy * b.vx > 0 ? -1 : 1;
        mx += (-b.vy / l) * side * 1.5;
        my += (b.vx / l) * side * 1.5;
        if (p.dashCd <= 0) inp.dash = true;
        break;
      }
    }
    if (w.context && w.context.value >= w.context.max && (bossParts.length || w.eBullets.length >= 6)) inp.compact = true;
    inp.moveX = clamp1(mx);
    inp.moveY = clamp1(my);
    return inp;
  }

  // delayTicks > 0 simulates human reaction time: the input acted on now was decided delayTicks ticks ago.
  // Menu choices are never delayed.
  return function botInput(run) {
    const now = decide(run);
    if (!o.delayTicks || run.state === 'patchPick' || run.state === 'dead') return now;
    queue.push(now);
    if (queue.length <= o.delayTicks) return Object.assign({}, now, { moveX: 0, moveY: 0, dash: false, compact: false });
    return queue.shift();
  };
}

module.exports = { makeBot };
```

- [ ] **Step 2: Create `tests/sim.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');
const { makeBot } = require('./bot');

const LIMIT_S = 240;
const DONE = new Set(['bossDead', 'patchPick', 'victory']);
const report = [];

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

for (const seed of [1, 2, 3]) {
  for (let s = 0; s < 4; s++) {
    for (const [kit, patches] of [['base', {}], ['patched', { spread: 1, rapid: 1, pierce: 1 }]]) {
      test(`sim: seed ${seed} stage ${s + 1} ${kit}, boss beaten within ${LIMIT_S} s, state healthy`, () => {
        const res = playStage(seed, s, { patches });
        report.push(`stage ${s + 1} seed ${seed} ${kit.padEnd(7)} ${res.seconds.toFixed(1).padStart(6)} s  would-be hits ${res.wouldHits}`);
        assert.ok(DONE.has(res.run.state), `stuck in ${res.run.state} after ${res.seconds.toFixed(1)} s`);
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

test('sim: a full run from stage 1 reaches victory', () => {
  const { CB } = H.load(undefined, { returnSandbox: true });
  const run = CB.createRun({ seed: 99, god: true });
  const bot = makeBot();
  let ticks = 0;
  while (ticks < 60 * 60 * 20 && run.state !== 'victory') {
    run.step(bot(run));
    ticks++;
  }
  assert.equal(run.state, 'victory');
  assert.equal(run.history.length, 3);
  assert.equal(run.bossesFixed, 4);
  report.push(`full run seed 99: ${(run.time / 60).toFixed(1)} min, patches ${run.history.join(', ')}, squashed ${JSON.stringify(run.squashed)}`);
});

test('sim: Boss Rush full run reaches victory', () => {
  const { CB } = H.load(undefined, { returnSandbox: true });
  const run = CB.createRun({ seed: 7, god: true, bossRush: true });
  const bot = makeBot();
  let ticks = 0;
  while (ticks < 60 * 60 * 15 && run.state !== 'victory') {
    run.step(bot(run));
    ticks++;
  }
  assert.equal(run.state, 'victory');
  report.push(`boss rush seed 7: ${(run.time / 60).toFixed(1)} min`);
});

test('sim: delayed-input bot (0.15 s reaction) difficulty report', () => {
  for (let s = 0; s < 4; s++) {
    const res = playStage(1, s, {}, { delayTicks: 9 });
    report.push(`delayed bot stage ${s + 1}: ${res.seconds.toFixed(1)} s, would-be hits ${res.wouldHits}${DONE.has(res.run.state) ? '' : ' (NOT CLEARED)'}`);
  }
});

test.after(() => {
  console.log('\n--- difficulty report ---\n' + report.join('\n'));
});
```

- [ ] **Step 3: Run the playthrough.** Run `node --test tests/sim.test.js`. Expected: 30 PASS, with the difficulty report printed (24 per-stage runs, random patches, YOLO, full run, Boss Rush and the delayed-bot report). A `stuck in boss` failure is a boss-logic bug (a unreachable/never-targetable part, an attack that blocks forever, etc.). Debug it with `superpowers:systematic-debugging`, and never by raising `LIMIT_S`.
- [ ] **Step 4: Run every test.** Run `node --test`. Expected: everything PASS.
- [ ] **Step 5: Balance pass (orchestrator reviews every number changed).** Targets with the base kit:
  - each stage clears in **45–150 s** of bot time;
  - **would-be hits** per stage are between 2 and 18 (the bot dodges worse than a human but has perfect aim). Too few hits means too easy, so raise bullet density or speed by ≤ 15%. Too many means too hard, so lower it.
  - Adjust only boss/enemy tuning numbers, record every change in a `## Balance log` section appended to this plan, then re-run Step 3.
- [ ] **Step 6: Commit (orchestrator).** `git add tests/bot.js tests/sim.test.js src/game && git commit -m "test: headless bot playthrough of every stage; balance pass"`

### Task 23: Whole-game smoke test and Artifact build

**Files:** Create `tests/smoke.test.js`, `tools/build-artifact.mjs`, `tests/build.test.js`.

- [ ] **Step 1: Write `tests/smoke.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

test('smoke: every script in index.html loads together without throwing', () => {
  const CB = H.load();
  assert.ok(CB.createRun && CB.createWorld && CB.createRenderer && CB.createInput && CB.createLoop);
});

test('smoke: every stage references registered enemies and bosses', () => {
  const CB = H.load();
  for (const s of CB.STAGES) {
    assert.ok(CB.Bosses[s.boss], `boss ${s.boss}`);
    for (const wave of s.waves) for (const g of wave) assert.ok(CB.Enemies[g.kind], `enemy ${g.kind}`);
  }
});

test('smoke: every screen and scene is registered', () => {
  const CB = H.load();
  for (const n of ['hud', 'stageIntro', 'waveBanner', 'bossWarn', 'bossDead', 'patchPick', 'gameOver', 'victory', 'pause', 'panic']) assert.equal(typeof CB.Screens[n].draw, 'function', n);
  for (const n of ['title', 'play']) assert.equal(typeof CB.Scenes[n].update, 'function', n);
  assert.equal(typeof CB.Font.measure, 'function');
  assert.equal(typeof CB.Audio.handleEvents, 'function');
});

test('smoke: all sprites bake headless and the required ones exist', () => {
  const CB = H.load();
  for (const n of CB.Art.spriteNames()) CB.Art.sprite(n);
  const REQUIRED = ['clawd_idle0', 'clawd_idle0_happy', 'bolt', 'bolt_big', 'ebullet', 'heart_full', 'heart_empty', 'pickup_hotfix',
    'syntaxError_0', 'nullPointer_0', 'raceCondition_0', 'memoryLeak_0', 'offByOne_0', 'loopHead_0', 'loopSegment_0', 'leakBoss_0',
    'leakBlob_0', 'conflictHead_0', 'conflictIncoming_0', 'heisenbug_0', 'heisenbug_cyan_0', 'heisenbug_mag_0', 'hat_crown', 'hat_halo'];
  for (const n of REQUIRED) assert.ok(CB.Art.hasSprite(n), n);
  for (const id of CB.Patches.ORDER) assert.ok(CB.Art.hasSprite('patch_' + id), 'patch_' + id);
  for (const s of CB.STAGES) assert.ok(CB.Art.hasSprite(CB.Bosses[s.boss].portrait), s.boss + ' portrait');
});

test('smoke: title and play scenes run and draw through a real renderer', () => {
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const game = { r, debug: {}, input: { peekAim: () => ({ x: 160, y: 90 }), releaseAll() {} }, scene: null, go(name, data) { game.scene = CB.Scenes[name]; game.scene.enter(game, data || {}); } };
  game.go('title');
  for (let i = 0; i < 60; i++) {
    game.scene.update(CB.DT, H.makeInput());
    game.scene.draw(r, i / 60);
  }
  game.go('play', { runOpts: { seed: 5, god: true } });
  for (let i = 0; i < 60 * 20; i++) {
    game.scene.update(CB.DT, H.makeInput({ fire: true, aimX: 160, aimY: 40, moveX: Math.sin(i / 30) }));
    if (i % 15 === 0) game.scene.draw(r, i / 60);
  }
  CB.Screens.panic.draw(r, new Error('smoke'));
});
```

- [ ] **Step 2: Create `tools/build-artifact.mjs`**

```js
#!/usr/bin/env node
// Builds dist/clawd-vs-bugs.html for the claude.ai Artifact: <title> and <style> first, the body markup,
// then every <script src> from index.html inlined in order. The Artifact adds its own html/head/body.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'dist', 'clawd-vs-bugs.html');

export function build() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const title = (html.match(/<title>[\s\S]*?<\/title>/) || ['<title>Clawd vs Bugs</title>'])[0];
  const styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
  const body = (html.match(/<body>([\s\S]*?)<\/body>/) || [null, ''])[1];
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  const markup = body.replace(/<script\s+src="[^"]+"\s*><\/script>\s*/g, '').trim();
  // One <script> per source file: a load-time throw in one file can't stop the others, and the sourceURL
  // makes stack traces (and the panic screen's src/ line) name the real file.
  const chunks = srcs.map((s) => {
    const code = readFileSync(join(ROOT, s), 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script>\n// ---- ${s} ----\n${code}\n//# sourceURL=${s}\n</script>`;
  });
  const out = `${title}\n${styles}\n${markup}\n${chunks.join('\n')}\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  return { out, bytes: Buffer.byteLength(out), scripts: srcs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = build();
  console.log(`dist/clawd-vs-bugs.html: ${res.scripts.length} scripts inlined, ${(res.bytes / 1024).toFixed(1)} KB`);
}
```

- [ ] **Step 3: Write `tests/build.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('./harness');

test('build: Artifact page has no document wrapper and inlines every script in order', async () => {
  const mod = await import(pathToFileURL(path.join(H.ROOT, 'tools', 'build-artifact.mjs')).href);
  const { out, scripts } = mod.build();
  assert.ok(out.startsWith('<title>Clawd vs Bugs</title>'));
  assert.doesNotMatch(out, /<!doctype/i);
  assert.doesNotMatch(out, /<html[\s>]/i);
  assert.doesNotMatch(out, /<head[\s>]/i);
  assert.doesNotMatch(out, /<body[\s>]/i);
  assert.match(out, /<canvas id="game"/);
  assert.equal((out.match(/<\/script/gi) || []).length, scripts.length, 'one closing tag per file');
  const vm = require('vm');
  const chunks = [...out.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]);
  assert.equal(chunks.length, scripts.length);
  chunks.forEach((code, i) => {
    assert.doesNotMatch(code, /<!--/, `${scripts[i]} contains an HTML comment opener`);
    assert.doesNotThrow(() => new vm.Script(code, { filename: scripts[i] }), `${scripts[i]} must parse`);
    assert.ok(code.includes(`//# sourceURL=${scripts[i]}`));
  });
  let last = -1;
  for (const s of scripts) {
    const i = out.indexOf(`// ---- ${s} ----`);
    assert.ok(i > last, `${s} in order`);
    last = i;
  }
  assert.equal(scripts.length, H.scriptList().length);
});
```

- [ ] **Step 4: Run the tests.** Run `node --test`. Expected: everything PASS.
- [ ] **Step 5: Commit (orchestrator).** `git add tests/smoke.test.js tests/build.test.js tools/build-artifact.mjs && git commit -m "feat: whole-game smoke tests and Artifact build"`

### Task 24: Browser QA, polish and publish (orchestrator)

**Files:** Create `.claude/launch.json` and `README.md`. Modify any file to fix defects found.

- [ ] **Step 1: Preview server.** Create `.claude/launch.json` with `{"version":"0.0.1","configurations":[{"name":"game","runtimeExecutable":"python3","runtimeArgs":["-m","http.server","8137"],"port":8137}]}` and start it with `preview_start`.
- [ ] **Step 2: Visual checks.** Screenshot each of these and check the console for errors after each one:
  - the title screen;
  - `#stage=1`, `#stage=1&boss&god`, `#stage=2&boss&god`, `#stage=3&boss&god`, `#stage=4&boss&god`;
  - a patch pick (beat a boss with `&god`);
  - the pause overlay;
  - game over (play without god and die);
  - victory (`#stage=4&boss&god&patches=heavy,heavy,rapid,rapid,spread`);
  - the panic screen (`CB.debug.game.scene.draw = () => { throw new Error('test') }` via the JS tool).
- [ ] **Step 3: Scaling.** Check 1280×720, 1920×1080, 800×600 and a narrow 400×800 viewport: no horizontal scroll, crisp pixels, and correct aim mapping (the crosshair sits under the mouse).
- [ ] **Step 4: Fix and re-test.** Fix every defect with a regression test where it is logic. Re-run `node --test`.
- [ ] **Step 5: Write `README.md`.** Cover: what it is, how to play (controls), `npm test`, `npm run serve`, the debug hash table, `npm run build`, and the fan-game note.
- [ ] **Step 6: Build.** Run `node tools/build-artifact.mjs`.
- [ ] **Step 7: Publish.** Publish `dist/clawd-vs-bugs.html` as an Artifact (icon `game`, description "Top-down pixel boss rush: play as Clawd and squash four software-bug bosses.").
- [ ] **Step 8: Commit and push.** `git add -A && git commit -m "docs: README; chore: launch config" && git push`

