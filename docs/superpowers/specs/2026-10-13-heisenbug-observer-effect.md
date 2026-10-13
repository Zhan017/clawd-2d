# The Heisenbug, redesigned: "The Observer Effect" (2026-10-13)

The user's complaint: "heisenbug is too easy to beat and has nothing really special."

This redesign comes from a judge panel (4 proposals, 3 judges). The "Observer Effect" design won 2 of 3 votes and was the third judge's alternate. The judges' grafts and cuts below are binding. It replaces the Boss 4 section of `2026-10-06-clawd-vs-bugs-design.md`.

Keep from today: the name, the tagline `works on my machine`, the moth sprites and eye sprites (the smoke test pins their names), the `~/prod/` stage, the boss card, the commit line `fix: cannot reproduce (closed)`, and the two phase thresholds (two `bossPhase` events, so two hotfix hearts).

## The law: only what you look at is real

### Looking (the gaze)

Looking is a **ray** from Clawd through the aim point: `p.aimX/p.aimY`, which already holds the mouse point, the stick aim point or the touch aim point.

- A moth is looked at when it is ahead of Clawd and within **14 px** of the ray. Once looked at, it stays looked at within **20 px** (hysteresis). After the ray leaves, a grace period of **0.35 s** keeps bolts already in flight landing.
- When the aim point is within 6 px of Clawd, fall back to the point rule (aim point within 14 px of the moth), so the ray can't flicker.
- Mouse, stick and touch play by the same rule. Stick aim assist never targets bosses (they are `boss: true, regular: false`).

### Observed: stone

A moth you look at turns to stone.

- **Behaviour:** frozen and solid. It is harmless to touch and the **only thing that takes damage**.
- **Look:** a grey stone silhouette, wings folded, no bob, with a **cyan** 16-dot strain ring and the eye glyph above it.
- **Gaze line:** a faint dotted **cyan tether** from Clawd to every observed moth, and the crosshair tints cyan while it observes. On a stick or a phone the crosshair is only 48 px out, so the line is how you see what you're looking at.

### Unobserved: wave

A moth you don't look at becomes a translucent ghost.

- **Look:** a ghostly copy with a strong RGB split and thin expanding ripple rings, about 55% alpha. **Not magenta**, because pink is the enemy-bullet colour on the red prod stage.
- **Immune:** player bolts and the /compact wave clink off it. A throttled (1.6 s) `<optimized out>` text pop teaches the rule. Direct `damageEnemy(e, n)` calls with no `src` still apply, which keeps test helpers working.
- **Harmless to touch, except during a lunge.**
- **Hunts:**
  - It creeps toward Clawd at 22 px/s, rising to 44 px/s, and parks about 50 px away.
  - It slides at up to 55 px/s to stay at least 70° off the aim ray, so it always comes from the blind side.
  - Loose moths keep 60 px apart.

### The cost of looking: strain

- **Filling:** every point of damage dealt to a stone moth fills its strain ring. 22 is full. It cools 3.5/s while unobserved.
- **Warning:** at 70% the eye turns red, with a dark outline so it isn't red-on-red.
- **When full:**
  - a held **white** sprite for 0.25 s (no flicker), then
  - a **nova** of 8 bullets at 75 px/s with a 45° gap centred on Clawd, then
  - a jump to a spot at least 80 px from Clawd (afterimages, a `!?` pop, `w.glitchT`), then
  - 1.0 s **dazzled**: it ignores the gaze and is immune.
- **The loop:** shoot one moth, the other winds up, look at it during its tell and it freezes (the lunge is cancelled) while the first thaws. Swap before the ring fills.

### Lashes (attacks are paid for in damage)

- **Charge:** each point of damage you deal adds to a shared charge. At **11** (phase 1) or **8** (phase 2), the nearest idle wave lashes. If you deal no damage, a lash still comes every 4.5 s.
- **Start:** no attack in the first 2.6 s.
- **Lunge** (the hunter is within 90 px):
  - A 0.6 s tell: the moth crouches, and a **white dotted line with a dark outline** runs to the locked landing point, with a white landing ring. The heading locks at the start of the tell, so a 36 px sidestep clears it.
  - Then 0.22 s at 250 px/s (55 px). Contact hurts **only** in this window.
  - Then 0.6 s of harmless recovery.
  - Emits `beamCharge` with finite `x1, y1, x2, y2`.
- **Ripple** (the hunter is further than 90 px): a 12-slot ring with 3 gaps (9 bullets) at 75 px/s, one gap centred on Clawd.
- **Freezing cancels a lunge:** looking at a moth during its tell freezes it and cancels the lunge.

## Phases (one shared HP pool, one boss bar)

`MAX_HP` is about 320. Tune it in 300–360 so the bot with 3 patches (spread, rapid, pierce, zero latency, god mode, waves skipped) averages about 38–44 s. Thresholds are `round(0.6 × MAX)` and `round(0.25 × MAX)`; each is strictly below and latches.

### 1. Entangled pair (100–60%)

- Two moths share one pool: `c.body.hp` is the authority, mirrored into every moth each tick.
- They spawn on the two candidate spots farthest from Clawd.
- Lash charge 11.

### 2. Superposition (60–25%)

- **The split:** on the `bossPhase` tick, the usual 0.5 s shield on the main part and a shake of at least 4. A third moth splits off with a chromatic tear and lands at least 80 px from Clawd. It has **0.5 s invulnerability and no contact**, and if the enemy cap returns null it is skipped silently.
- **Faster:** lash charge 8, creep up to 55 px/s.
- **Pincer:** when a lunge starts, the other idle wave within 90 px starts its own lunge tell 0.3 s later, from its own flank. Two dotted lines 0.3 s apart. This is the **first thing to cut** if the sim gates fail.
- **Pop:** the `cannot reproduce` quip.

### 3. Regression (below 25%): the law inverts

- **The merge:** the three moths slide to the arena centre over 0.5 s, inside the phase shield, and merge into one **giant**. Draw it at exactly **2× scale** (no fractional scaling), with its hitbox scaled to match.
- **The merge cameos:** faint ghosts of the Infinite Loop head, the Memory Leak slime and a Merge Conflict twin fold into it at about 0.5 alpha. They are draw-only, guarded with `CB.Art.hasSprite`, and use each boss's own sprite names, which you look up.
- **Pop:** `regression detected`, appended to the phase-3 quip pool. Tests pin only index 0.
- **The inverted law:** the giant is **awake and solid only while observed** (0.3 s grace). Unobserved, it is grey stone with its eyes shut: asleep, harmless and immune. Looking away is the panic button, and looking is what provokes it.
- **Provocation is damage-driven:**
  - Every 2.4 damage you deal while it's awake, it reflects one opposite pair of spiral bullets (75 px/s, the angle advancing 0.35 rad per pair). Those are "your own sparks coming back".
  - Every 14 damage, it lunges, with the same tell as before.
- **Strain:** at 26 strain, a 0.25 s white-out, a nova of 16 (gap on Clawd), a jump at least 80 px and a 1.2 s shield, then it sleeps until looked at again. Strain cools 4/s while asleep.
- **Fallback:** if this inversion reads badly in playtest, it's a one-line change to keep the phase 1–2 law with three moths.

### The last hit: REPRODUCED

When the pool empties, the final blow doesn't kill at once:

- HP floors just above 0.
- The giant goes to stone, a gold ring collapses into it, and a gold `REPRODUCED` pop appears.
- About 0.9 s later the controller kills the body, so the existing slow motion, chained blasts and `BUG FIXED` card run as usual.
- The controller keeps updating during this beat.

## Fairness rules (each one gets a test)

- **Telegraphed contact:** contact only during a lunge, and every lunge is telegraphed for at least 0.6 s.
- **Safe lanes:** every nova and ripple leaves a gap centred on Clawd's position at the moment it fires.
- **Safe spawns:** new, split and jumping moths land at least 80 px from Clawd, with at least 0.45 s of no contact.
- **Gentle start:** nothing attacks in the first 2.6 s.
- **Calm mode:** the white-out is held, not flashed; any blink goes through `CB.Comfort.blink`.
- **Not colour alone:** every tell also has a shape, such as dotted line, ring or eye, and none is red-only on the red stage.
- **YOLO:** `fireEnemyBullet` makes bullets 15% faster, and the gaps must still be passable.
- **Bullet caps:** `fireEnemyBullet` and `spawnEnemy` can return null at the caps, so code must tolerate it.

## Engine notes

- **Telling hits apart in `onHit`:** `world.collide` passes the bolt as `src` (it has `dmg`), and /compact passes `{ compact: true }`. That lets `onHit` tell player hits from direct calls.
- **Clink sound:** `clink` has no audio throttle today. Add one of about 0.05 s in `src/core/audio.js`.
- **/compact:** it damages stone moths and clinks off waves.
- **Moth flags:** moths are enemy kind `heisenbug` (`boss: true`, `regular: false`, always `targetable: true` so `tests/bot.js` keeps aiming at them).
- **The bot:** it targets the boss part with the most HP and keeps its current one unless another has 15 more. With the hp mirrored, it simply stares at one moth, which exercises strain and novas.
- **Published velocity:** report it as displacement / dt, so jumps and lunges are non-zero, as `boss.rules` requires.

## Test and gate changes allowed

- **Rewrite** `tests/boss.heisenbug.test.js`.
- **`tests/boss.rules.test.js`:** the Heisenbug row becomes `late: ['heisenbug']`.
- **`tests/aimassist.test.js`:** remove the `heisenDecoy` lines and re-record the stage-4 GOLDEN fingerprint.
- **The sim gates in `tests/sim.test.js` must not be loosened:**
  - zero-latency base kit: at most 10 would-be hits per stage;
  - delayed bot: 3 to 20.

  Tune with these knobs, in order: the pincer, nova counts, strain tolerance, lash charges, the phase-3 reflect rate, then HP.
