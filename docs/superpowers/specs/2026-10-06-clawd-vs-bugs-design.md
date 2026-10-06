# Clawd vs Bugs — Design Spec

Date: 2026-10-06
Status: approved in conversation, pending written-spec review

## 1. Intent

**What the user asked for:** a pixel game where you play as Clawd (the Claude Code mascot) defeating bugs and bosses.

**Agreed outcome:** a shareable fun toy, about 10 minutes of play, that people open from a claude.ai Artifact link and play on desktop.

**Success criteria**
- A first-time player can start a run within 5 seconds of opening the link and understands the controls from the title screen.
- Four distinct, recognisable boss fights, each themed on a real software bug, each beatable with the base kit.
- Clawd is unmistakably Clawd. The software-bug jokes land without explanation.
- The game never freezes silently. Errors show an in-game crash screen.
- A headless test proves every boss is beatable and the simulation stays numerically healthy.

**Decisions made with the user**

| Topic | Decision |
|---|---|
| Purpose | Shareable fun toy, 5–15 min |
| Genre | Top-down room brawler |
| Combat | Ranged only (twin-stick: move + aim/shoot) |
| Theme | Software bugs as creatures; arenas look like a codebase |
| Platform | Desktop only: WASD + mouse |
| Structure | Boss rush with short gauntlets |
| Delivery | claude.ai Artifact; plain JS, no build step to run the game |
| Scoring | None (no leaderboard, no personal best) |
| Tech | Plain Canvas 2D, no libraries, classic scripts |

**Assumptions the user accepted**
- 4 bosses.
- Retry the current stage on death.
- A dash with brief invincibility.
- Pick 1 of 3 patches after bosses 1–3.
- Clawd is drawn from scratch and labelled a fan game.
- Synth sound effects with a mute key.

**Non-goals:** touch/gamepad controls, music tracks, scoring/leaderboards, save/resume across sessions, difficulty settings, localisation.

## 2. Gameplay

### 2.1 Coordinate space and arena
- Internal resolution is **320×180**. All gameplay units are internal pixels and seconds.
- A HUD strip occupies y 0–17.
- The **arena** is `{x: 8, y: 20, w: 304, h: 152}`. Walls are drawn in the 8 px border. Everything is clamped inside the arena: player and enemies by their radius; bullets are removed when they leave it (except for Ricochet).
- The fixed simulation step is **1/60 s**.

### 2.2 Clawd (player)
- **Sprite:** 16×16 terracotta (`#D97757` family) boxy body, two tall dark eyes, small arm nubs on each side, four stubby legs. It has a 2-frame idle bob and a 4-frame walk cycle, and faces left or right toward the aim point (horizontal flip).
- **Hitbox:** circle, r = 5.
- **Move:** WASD at 80 px/s with no inertia. Diagonal input is normalised.
- **Aim:** the mouse position, mapped to internal coordinates. A crosshair is drawn in-canvas and the system cursor is hidden over the canvas.
- **Fire:** hold the left mouse button.
  - Base cooldown 0.2 s (5 shots/s).
  - Each shot is a ✻ spark bolt: speed 200 px/s, r = 2, damage 1, lifetime 1.5 s.
  - Spawned 6 px from the centre toward the aim point.
- **Dash:** Space or Shift (edge-triggered).
  - Moves in the move direction, or toward the aim point if not moving.
  - Speed 260 px/s for 0.15 s.
  - Invulnerable for 0.25 s from dash start.
  - Cooldown 0.8 s.
  - Leaves 3 fading afterimages.
- **Health:** 5 hearts.
  - Any enemy contact or enemy bullet costs 1 heart.
  - Then 1.0 s of hurt-invulnerability, with the sprite blinking at 10 Hz.
  - At 0 hearts, Clawd dies.
- **Other keys:** Esc or P pauses. M mutes; the mute setting persists in `localStorage` inside try/catch.

### 2.3 Enemy bullets
- Default speed 80 px/s, r = 2.
- Drawn as small red/magenta diamonds with a 1 px dark outline for readability.
- Contact with the player costs 1 heart.

### 2.4 Gauntlet bugs (regular enemies)
All enemies deal 1 heart on contact. They spawn at the arena edge, at least 60 px from the player, after a **0.6 s spawn telegraph**: a blinking `!` marker where they will appear. During the telegraph they cannot hurt or be hurt.

| Kind | Look | HP | r | Speed | Behaviour |
|---|---|---|---|---|---|
| `syntaxError` | red beetle with a squiggly underline | 3 | 5 | 38 | Walks toward the player with a slight sine wobble. |
| `nullPointer` | pale grey moth, semi-transparent | 2 | 5 | 30 (wander) | Loops through four steps (see below). |
| `raceCondition` | pair of yellow ants | 2 each | 4 | 75 | Always spawned as a pair. Moves toward the player plus a perpendicular zigzag (amplitude 40 px/s sideways, 2 Hz). The two ants are in opposite zigzag phase. |
| `memoryLeak` | green blob | 4 (big) / 2 (small) | 6 / 4 | 30 / 45 | Chases the player. A big blob splits into 2 small blobs on death; small blobs do not split. |
| `offByOne` | purple spider | 4 | 5 | 50 | Keeps 70–110 px from the player, strafing. Every 2.2 s fires a 3-bullet burst (0.12 s apart). It aims "one tile ahead": at the player position plus 8 px in the player's current move direction. |

**`nullPointer` loop**
1. Wanders visibly for 1.5 s.
2. Vanishes for 0.8 s. While vanished it is untargetable, has no collision and is not drawn.
3. Reappears 30–40 px from the player in a random direction, with a 0.4 s fade-in telegraph. It is still untargetable during the fade-in.
4. Lunges at 140 px/s for 0.35 s toward the player's position at lunge start.

### 2.5 Stages

| # | Path label | Accent | Wave 1 | Wave 2 | Boss |
|---|---|---|---|---|---|
| 1 | `~/src/` | blue-grey | 4 syntaxError, 2 nullPointer | 6 syntaxError, 3 nullPointer | The Infinite Loop |
| 2 | `~/node_modules/` | murky green | 3 syntaxError, 2 raceCondition pairs, 2 memoryLeak | 3 memoryLeak, 2 raceCondition pairs, 2 nullPointer | Memory Leak |
| 3 | `~/.git/` | purple | 2 offByOne, 4 syntaxError, 1 raceCondition pair | 3 offByOne, 2 memoryLeak, 2 nullPointer | Merge Conflict |
| 4 | `~/prod/` | red, pulsing | 2 offByOne, 2 raceCondition pairs, 2 memoryLeak, 3 nullPointer | 3 offByOne, 4 syntaxError, 2 memoryLeak, 2 raceCondition pairs | The Heisenbug |

**Spawning within a wave**
- Spawns are staggered: one spawn group every 0.7 s, in the listed order, round-robin by kind.
- No more than 8 regular enemies are alive at once; the remaining spawns wait.
- A wave ends when everything is spawned and every enemy is dead.

**Arena floor**
- Dark editor background with faint line numbers in the left wall area.
- 20–30 dim syntax-coloured "code line" bars drawn as floor texture, generated from the stage seed.
- The stage accent tints the walls.
- `prod/` slowly pulses its wall tint red.

### 2.6 Bosses
Every boss has a **2.5 s warning card** before the fight: flashing `⚠ WARNING`, the boss name and a one-line code joke. During the fight, the boss HP bar sits at the top centre with the name above it. Boss phases trigger at HP fractions. Phases never revert, and every HP-threshold event (phase change, Memory Leak split) fires at most once per fight, even if HP regenerates back above the threshold. At each phase change:
- emit `bossPhase`;
- shake the screen;
- give the boss 0.5 s of invulnerability with a flash.

**Boss 1 — The Infinite Loop** (`infiniteLoop`)
- **Tagline:** `while (true) { bite(); }`
- **Body:** a centipede of 1 head (r = 8) and 12 segments (r = 6). Segments follow the head's path with 10 px spacing.
- **Damage rules:**
  - Only the head takes damage (HP 150).
  - Segments are `solid`: they absorb player bolts (Pierce passes through them).
  - Head and segments deal contact damage.
- **Phase 1 (100–50%):**
  - The head travels a circle centred on the arena centre: radius 60, angular speed 0.9 rad/s.
  - Every 3 s it fires a 3-bullet fan (±15°) at the player.
- **Phase 2 (<50%):**
  - The radius eases to 40 over 2 s and the angular speed rises to 1.4 rad/s.
  - Every 4–6 s it reverses direction, after a 0.5 s white flash telegraph on the head.
  - Every 5 s the tail segment detaches and becomes a `syntaxError` (stops at 4 segments left).
  - Every 2.5 s it fires a 5-bullet fan (±30°).

**Boss 2 — Memory Leak** (`memoryLeakBoss`)
- **Tagline:** `heap: 99% used`
- **Body:**
  - A giant green slime with HP 240.
  - Its `size` runs from 1.0 to 2.0, and its radius is `14 × size`.
  - It drifts toward the player at `18 / size` px/s.
- **Leak mechanic:**
  - If it has taken no damage for 1.5 s, it regenerates 4 HP/s (never above max) and grows 0.04 size/s (cap 2.0).
  - Each point of damage shrinks size by 0.004 (floor 1.0).
- **Lob attack:**
  - Every 2.5 s it lobs 2 blobs (3 in phase 2).
  - Each blob flies in an arc for 1.0 s to a point within 24 px of the player.
  - The arc is purely visual: a parabola over the straight line, with its shadow drawn on the ground.
  - On landing a blob becomes a **puddle hazard** (r = 12, lasts 6 s). The player moves at 50% speed while inside it. Puddles do no damage.
- **Splits:** at 66% and 33% HP it spawns 3 `memoryLeak` (big) enemies around itself.
- **Phase 2 (<50%):** adds a ring of 8 bullets every 4 s.

**Boss 3 — Merge Conflict** (`mergeConflict`)
- **Tagline:** `<<<<<<< HEAD`
- **Body:** twin beetles, **HEAD** (blue) and **incoming** (green), r = 8, HP 90 each. The combined bar shows the sum (max 180).
- **Movement:**
  - HEAD moves toward random waypoints in the arena at 50 px/s.
  - Incoming always sits at the point reflection of HEAD through the arena centre.
  - While one twin is dead, the living twin moves on its own toward random waypoints.
- **Attacks** run on a 2.8 s cycle, alternating between the two:
  - **Crossfire:** both fire aimed 3-bullet bursts (0.12 s apart).
  - **Conflict line:** a thin line between the twins flashes for 0.8 s (telegraph). Then it becomes a beam for 0.5 s that damages the player if the player's circle touches the segment.
- **Phase 2** (combined HP < 50%) adds a **charge** to the rotation: both dash at the player at 160 px/s for 0.5 s after a 0.4 s shake telegraph.
- **Resolve rule:**
  - When one twin dies, a banner "RESOLVE THE CONFLICT" appears with a 4.0 s countdown.
  - If the other twin dies before the countdown ends, the boss is defeated.
  - Otherwise the dead twin revives at 45 HP (50% of its max) beside the arena centre, with a "merge failed" text pop.

**Boss 4 — The Heisenbug** (`heisenbug`)
- **Tagline:** `works on my machine`
- **Body:** a glitchy moth with chromatic-offset rendering, r = 9, HP 260.
- **Observation rule (all phases):**
  - If the aim point stays within 14 px of the real Heisenbug continuously for 1.0 s, it is "observed".
  - It immediately teleports (a "!?" pop and glitch burst) to a random arena point at least 80 px from the player.
  - The observe timer resets on teleport or when the aim leaves the 14 px radius.
- **Phase 1 (100–60%):**
  - It blinks to a new random position every 2.5–3.5 s: a 0.3 s fade-out, then a 0.3 s fade-in. It is untargetable while faded.
  - After each blink it fires a ring of 10 bullets.
- **Phase 2 (60–25%):**
  - Each blink also places 2 **decoys** that look identical. Decoys are separate enemies with HP 1 that pop with a "404" text when hit.
  - Decoys fire 6-bullet rings when the real one fires its ring.
  - Decoys are removed and replaced on every blink.
  - Only the real one flickers white when hit.
- **Phase 3 (<25%):**
  - It blinks every 5 s.
  - It fires a rotating 2-arm spiral: 8 bullets/s, rotating 2.2 rad/s.
  - Every 8 s it summons 2 `nullPointer`s, with at most 4 alive.

**Boss defeat**
- 1.5 s of slow motion (sim at 0.3×) with chained explosions.
- Then "BUG FIXED ✓" and a fake commit line, e.g. `git commit -m "fix: infinite loop"`.
- Then the patch pick (stages 1–3) or victory (stage 4).
- All remaining enemies and enemy bullets are cleared on boss defeat.

### 2.7 Patches (upgrades)
After bosses 1–3 the player is offered **3 distinct patches** not yet at max stacks, drawn with the run RNG. The player picks one by clicking a card or pressing 1/2/3. Cards show a pixel icon, name, one-line description and stack level.

| Id | Name | Max | Effect per stack |
|---|---|---|---|
| `spread` | Spread Shot | 2 | +2 extra bolts at ±12° × stack (stack 2: ±12° and ±24°) |
| `rapid` | Rapid Fire | 2 | fire cooldown × 0.7 |
| `pierce` | Pierce | 2 | bolts pass through +1 enemy/solid |
| `heavy` | Heavy Bolts | 2 | damage +0.5, bolt r +1 |
| `heart` | Extra Heart | 2 | +1 max heart and heal to full |
| `dash` | Quick Dash | 1 | dash cooldown 0.8 → 0.45 s |
| `ricochet` | Ricochet | 1 | bolts bounce off arena walls once, with lifetime refreshed to 0.6 s |

### 2.8 Run flow (StageRunner states)

```
title → [stageIntro 2.0s] → wave(1) → [waveBreak 1.5s] → wave(2) → [bossWarn 2.5s] → boss
      → [bossDead 3.0s] → patchPick (stages 1–3) → stageIntro(next) …
      → after stage 4 bossDead → victory
any state with player at 0 hearts → [dying 1.2s] → dead
dead → retry: restart current stage at stageIntro (full hearts, patches as they were at stage start)
     → quit: title
```

- Hearts refill to max at every `stageIntro`.
- Player bullets, enemies, hazards and enemy bullets are cleared on every state change into `stageIntro`, `bossWarn` or `dead`.
- Run time accumulates during every play state except pause and patchPick. Deaths are counted.

### 2.9 Screens
- **Title:**
  - Pixel logo "CLAWD vs BUGS" with Clawd idling and a few bugs wandering across.
  - Controls list: `WASD move · Mouse aim · Click shoot · Space dash · Esc pause · M mute`.
  - "Click to start".
  - Footer: "Fan game. Not affiliated with Anthropic."
- **Stage intro:** "STAGE n" plus the path label, typed out terminal-style.
- **HUD:**
  - Hearts at top left.
  - Dash-ready pip next to the hearts (dim while cooling down).
  - Stage path at top right.
  - Boss bar at top centre during boss states.
  - "WAVE n/2" text during waves.
- **Patch pick:** title `PR #n — choose a patch` and 3 cards.
- **Game over:** `Segmentation fault (core dumped)`, then "R / click: retry stage" and "Q: quit to title".
- **Victory:** `ALL TESTS PASSING ✓`, then clear time (mm:ss), deaths, patches taken, and "Click to play again".
- **Pause overlay:** "PAUSED", then "Esc: resume · M: mute", then the current patches.
- **Kernel panic** (crash): "KERNEL PANIC", the error message (wrapped), and "Press R to reload".

### 2.10 Audio
- Web Audio synthesis only (square/triangle oscillators plus a noise buffer). No audio files.
- The `AudioContext` is created and resumed on the first pointer/key gesture. If unavailable, all sound calls are no-ops.
- Master gain 0.25.
- Shoot sounds are throttled to at most one per 70 ms.
- Sounds are driven by world events: `shoot`, `hit`, `enemyDie`, `playerHurt`, `dash`, `bossPhase`, `bossDie`, `patchPick`, `uiSelect`, `spawn`.
- Mute toggles master gain.

## 3. Architecture

### 3.1 Files

```
index.html                 full HTML doc for local play; ordered <script src> tags (the single source of script order)
src/core/ns.js             creates window.CB = { Enemies: {}, Bosses: {}, Scenes: {}, ... }
src/core/math.js           vec helpers, clamp, lerp, angle utils, circle/segment collision
src/core/rng.js            seeded mulberry32: next(), range(a,b), int(a,b), pick(arr), shuffle(arr)
src/core/input.js          keyboard+mouse → InputState; edge-triggered presses; internal-coord mapping
src/core/loop.js           fixed-step loop, rAF render, catch-up cap (max 5 steps), visibility pause, crash capture
src/core/audio.js          Web Audio synth SFX, event → sound mapping, mute
src/art/palette.js         named colours, stage palettes
src/art/font.js            bitmap pixel font (5×7 glyphs) + drawText/measureText
src/art/sprites.js         pixel-string sprite definitions → baked canvases (normal, flipped, white-flash)
src/art/render.js          320×180 buffer, integer scaling + letterbox, screen shake, draw helpers
src/game/world.js          entity containers, spawn/damage/collision/event queue, caps, hazards
src/game/player.js         player create/update (move, aim, fire, dash, hurt), draw
src/game/projectiles.js    bullet create/update for both teams (pierce, ricochet, lifetime)
src/game/fx.js             particles, afterimages, text pops, explosions (driven by events)
src/game/patches.js        patch definitions, apply(), offer(rng, owned)
src/game/stages.js         stage data (waves, boss id, palette, path label, jokes)
src/game/waves.js          wave spawner (telegraphs, stagger, alive cap)
src/game/stageRunner.js    run state machine (headless; §2.8) — CB.createRun()
src/game/enemies/*.js      syntaxError, nullPointer, raceCondition, memoryLeak, offByOne
src/game/bosses/*.js       infiniteLoop, memoryLeakBoss, mergeConflict, heisenbug
src/scenes/*.js            title, play, patchPick, gameOver, victory, pause, panic
src/main.js                boot: canvas, input, audio, loop, scene manager, debug hash, hot-reload snapshot
tests/harness.js           loads index.html's scripts into a node:vm context with stub DOM/canvas
tests/bot.js               headless bot (auto-aim, kite, dash on threat)
tests/*.test.js            node:test suites
tools/build-artifact.mjs   zero-dep: inline all scripts into dist/clawd-vs-bugs.html for publishing
```

Every source file is a classic script of the form `(function (CB) { 'use strict'; … })(window.CB);`. Only `ns.js` assigns `window.CB`.

### 3.2 Core rule: logic never draws
- `update` functions mutate plain-object state only.
- `draw` functions read state and draw.
- Nothing under `src/game/` calls canvas APIs except inside `draw` functions, and the headless runner never calls `draw`.
- Logic does not use `Math.random()`. It uses `world.rng`. Cosmetic particles use `world.fxRng`, which is also seeded.

### 3.3 Entity contracts

**Enemy entity** (plain object in `world.enemies`):

```js
{ kind, x, y, r, vx, vy, hp, maxHp, t /*age s*/, state, stateT,
  targetable /*player bolts can hit*/, solid /*absorbs bolts even if not targetable*/,
  contact /*deals contact damage*/, visible, hitFlash, dead, boss /*bool*/, data /*kind-specific*/ }
```

**Enemy module:**

```js
CB.Enemies[kind] = {
  create(world, x, y, opts) → entity,
  update(e, world, dt),
  draw(e, r, t),
  onHit?(e, world, dmg, bolt) → dmgApplied,   // default: e.hp -= dmg
  onDeath?(e, world),                          // e.g. memoryLeak split
}
```

Boss parts (loop head and segments, the twins, decoys) are registered as `CB.Enemies` kinds inside their boss file.

**Boss module:**

```js
CB.Bosses[id] = {
  name, tagline, commitMsg,
  create(world) → controller   // spawns its part entities
}
controller = { id, hp, maxHp, phase, defeated, update(world, dt), draw(r, t) /*overlays: beams, banners*/ }
```

`controller.hp` is kept current by the controller. The StageRunner reads `hp/maxHp` for the bar and `defeated` to advance.

**World API** (`CB.createWorld({ seed, stage, god })`):
- **State:**
  - `player`, `enemies`, `pBullets`, `eBullets`, `hazards`, `fx`, `boss`, `events` (array drained each tick)
  - `rng`, `fxRng`, `time`, `arena`, `shake`
- **Methods:**
  - `spawnEnemy(kind, x, y, opts)` (direct)
  - `queueSpawn(kind, opts)` (with telegraph)
  - `fireEnemyBullet(x, y, angle, speed?, opts?)`
  - `firePlayerBolt(...)`
  - `damageEnemy(e, dmg, src)`
  - `hurtPlayer(src)`
  - `addHazard(h)`
  - `emit(type, data)`
  - `step(dt, input)`
- **Caps:** enemies 60, enemy bullets 400, player bolts 120, particles 500. Spawning beyond a cap drops the new object; for particles, the oldest are dropped.
- **Collision order per tick:**
  1. Player update.
  2. Enemies update.
  3. Bullets update.
  4. Player bolts vs enemies (solid/targetable, pierce).
  5. Enemy bullets vs player.
  6. Enemy contact vs player.
  7. Hazards.
  8. Remove dead.

**InputState** (produced by `CB.Input` or the bot):

```js
{ moveX, moveY /*-1..1*/, aimX, aimY /*internal px*/, fire /*held*/, dash /*pressed this tick*/,
  pause /*pressed*/, mute /*pressed*/, confirm /*click or Enter pressed*/, choice /*1|2|3|0*/ }
```

**Run API** (`CB.createRun({ seed, startStage = 0, patches = [], god = false, skipWaves = false })`):
- `run.step(input)` advances exactly one 1/60 s tick, including time scaling for boss-death slow-mo.
- `run.state` is one of the §2.8 states.
- Also exposed: `run.world`, `run.stageIndex`, `run.time`, `run.deaths`, `run.patches`.
- Actions: `run.choosePatch(i)`, `run.retryStage()`.
- `run.offer` holds the current 3 patch ids during `patchPick`.

### 3.4 Scenes
- A scene manager holds the active scene `{ enter(data), update(dt, input), draw(r, t) }`.
- `play` owns a `run` and draws world, HUD and state overlays. `patchPick`, `gameOver`, `victory` and `pause` draw from the run's state, and `play` delegates to them while the run is in those states.
- `title` creates the run.

### 3.5 Rendering
- All drawing goes to an off-screen 320×180 canvas.
- The visible canvas is sized to the window. The buffer is drawn at the largest integer scale that fits, centred, letterboxed in black, with `imageSmoothingEnabled = false`. Scale is at least 1; at tiny windows it may be fractional, with smoothing still off.
- **Sprites** are arrays of equal-length strings where each character maps to a palette colour (`.` is transparent). They are baked once at boot into canvases with normal, horizontally flipped and all-white (hit flash) variants.
- Screen shake is a decaying random offset applied to the world layer only (not the HUD).

### 3.6 Debug hooks (local only)
- The URL hash `#stage=N&boss&god&speed=S&patches=a,b&seed=K&hitboxes` configures `createRun` and the render. Parsed in `main.js`.
- `window.CB.debug` exposes `{ run, scene }`.
- Artifact links drop `key=value` hashes, so these work only when running locally. That is fine.

### 3.7 Artifact hot snapshot
`main.js` registers `window.claude?.hot?.snapshot(() => ({ stageIndex, patches, deaths, time }))`. It boots through `window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {})`. With snapshot data present, it resumes at that stage's intro.

## 4. Error handling
- **Crash capture:**
  - `loop.js` wraps each update and draw in try/catch.
  - On an exception it stops the loop, logs to the console and switches to the `panic` scene (drawn with a minimal path that does not depend on the failed state).
  - `window.onerror` and `unhandledrejection` do the same.
- **Audio:** lazy creation and resume on gesture. Every audio call is guarded, and failure leaves the game silent.
- **Browser defaults:**
  - `contextmenu` and Space/arrow-key page scrolling are suppressed on the page.
  - `mouseleave`/`blur` releases fire and clears held keys.
  - `visibilitychange` (hidden) and `blur` auto-pause the play scene.
- **Small screens:** on touch-primary devices (`matchMedia('(pointer: coarse)')`) or windows narrower than 480 px, the title shows "Best on desktop with keyboard + mouse". The game still renders, scaled to fit, and the page never scrolls horizontally.
- **Caps** prevent runaway entity counts (§3.3).
- **`localStorage`** access (mute only) is wrapped in try/catch.

## 5. Testing
- All tests use `node --test tests/` with no npm dependencies.
- `tests/harness.js` parses `index.html` for `<script src>` order and runs each file in one `vm` context. The context has `window = globalThis` and a stub `document`/canvas whose 2D context methods are no-ops.

**Unit suites**
- `math`: vector ops, circle-circle and circle-segment collision.
- `rng`: same seed gives the same sequence; ranges stay in bounds.
- `patches`: max stacks enforced; an offer returns 3 distinct non-maxed ids; apply effects match §2.7.
- `stages`: every wave kind exists in `CB.Enemies`; every boss id exists in `CB.Bosses`; each stage has exactly 2 waves.
- `player`: diagonal normalised; dash invulnerability window and cooldown; hurt invulnerability; death at 0 hearts; puddle slow.
- `projectiles`: pierce counts, ricochet single bounce, lifetime expiry, solids absorb.
- `enemies`: each kind's spawn telegraph; `nullPointer` untargetable while vanished; `memoryLeak` splits exactly once; `offByOne` burst count and lead aim.
- `bosses`:
  - phase transitions at the exact thresholds;
  - Infinite Loop: segments absorb bolts and the head takes damage;
  - Memory Leak: regenerates and grows when idle, shrinks on hit;
  - Merge Conflict: revive after 4.0 s, defeat if both die within the window;
  - Heisenbug: teleports after 1.0 s of observation, decoys pop in one hit.
- `stageRunner`: the full state sequence; retry restores stage-start patches and full hearts; victory after stage 4; deaths and time accounting.

**Headless playthrough** (`sim.test.js`)
- For seeds {1, 2, 3}, each stage runs separately with `god: true` and the bot driving input:
  - with no patches;
  - with a representative patch set (`spread`, `rapid`, `pierce`).
- **Asserts:**
  - each stage reaches `bossDead` within 240 s of sim time;
  - no entity position or HP is ever NaN or Infinity;
  - all caps are respected;
  - no exception is thrown.
- **Reports:** the test prints the would-be hits taken per stage as a difficulty report (not asserted).

**Browser check** (manual, via the built-in browser against `python3 -m http.server`):
- title screen;
- each stage via `#stage=N`;
- each boss via `#stage=N&boss`;
- the patch pick, game over, victory and panic screens;
- the console has zero errors;
- scaling at 1280×720, 1920×1080 and a narrow window.

## 6. Delivery
- **Local:** open `index.html` directly (works over `file://`, since there are no modules) or serve the folder.
- **Publish:**
  - `node tools/build-artifact.mjs` reads `index.html`, strips the doctype/html/head/body wrapper (the Artifact skeleton adds its own) and inlines every `<script src>` in order. It writes `dist/clawd-vs-bugs.html` with `<title>Clawd vs Bugs</title>` and a `<style>` block first.
  - That file is published as a private claude.ai Artifact (icon: `game`) with a one-sentence description.
  - The page commits to a single dark look: `color-scheme: dark` on `:root`, an explicit body background, and every colour set explicitly.
- **Git:** local repo only. The spec, plan and code are committed. Nothing is pushed.
