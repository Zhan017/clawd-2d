# Clawd vs Bugs

A top-down pixel boss rush. You play as Clawd and shoot your way through four software-bug bosses, fixing a codebase one stage at a time: `~/src/`, `~/node_modules/`, `~/.git/` and `~/prod/`.

Fan game. Not affiliated with Anthropic.

It runs in the browser on desktop (keyboard and mouse) and takes about 10 minutes per run.

## Play

- **Web:** https://clawd-2d.vercel.app (deployed from `main` on Vercel)
- **Locally:** `npm run serve`, then open http://127.0.0.1:8137/. You can also double-click `index.html`.

## Controls

| Input | Action |
|---|---|
| WASD or arrow keys | Move |
| Mouse | Aim |
| Left click (hold) | Shoot ✻ sparks |
| Space, Shift or right click | Dash, with a moment of invulnerability |
| E | Cast /compact when the context meter is full |
| Esc or P | Pause |
| M | Mute everything |
| N | Toggle music |
| V | Calm mode: no screen shake, softer flashes, slower blinking |
| 1, 2, 3 or click | Pick a patch after a boss |
| R or click | Retry from the checkpoint (game over screen) |
| Q | Quit to the title (press twice from pause) |

## Features

### The run

- Four stages, each a code-editor arena with its own palette:
  - `~/src/` (blue-grey)
  - `~/node_modules/` (murky green)
  - `~/.git/` (purple)
  - `~/prod/` (red, pulsing)
- Each stage plays out the same way:
  1. A terminal-style intro.
  2. Two short waves of bugs.
  3. A ⚠ WARNING card.
  4. The boss.
- **Checkpoints:**
  - Die to a boss and you retry the boss.
  - Die in wave 2 and you restart at wave 2.
  - Every retry has full hearts and a shorter intro.
- **Health:** 6 hearts. Hearts partly refill between waves and fully refill before each boss.

### Clawd

- A boxy terracotta Clawd that faces your aim, bobs, walks and blinks.
- **Expressions:** hurt, determined while dashing, worried at one heart, squinting when idle, happy when you win.
- **Feedback:** a muzzle flash, a little recoil, and squash and stretch on dashes and hits.
- **Idling** shows a "✻ Thinking..." bubble.
- **Dash:** a short burst with invulnerability frames and afterimages.

### Bugs

| Bug | What it does |
|---|---|
| Syntax Error | Red beetle with a squiggly underline. Walks straight at you. |
| Null Pointer | Pale moth. Vanishes, reappears next to you, then lunges. |
| Race Condition | Fast yellow ants that come in pairs and zigzag in opposite phase. |
| Memory Leak | Green blob that splits into two smaller blobs when popped. |
| Off-by-One | Purple spider. Keeps its distance and fires bursts aimed one tile ahead of where you're going. |

**P0 elites** wear a gold ring and a `P0` tag. They're tougher and faster, and they drop a hotfix heart when they die.

### Bosses

| Boss | Stage | Trick |
|---|---|---|
| **The Infinite Loop** | `~/src/` | A centipede circling the arena. Only its head takes damage, and its body blocks your shots. In phase 2 the circle tightens, it reverses direction and sheds segments that become Syntax Errors. |
| **Memory Leak** | `~/node_modules/` | A slime that heals and grows whenever you stop hurting it. It lobs blobs that leave slowing puddles and splits off smaller leaks as it weakens. |
| **Merge Conflict** | `~/.git/` | Twin beetles, HEAD and incoming, that mirror each other and fire a beam between them. Kill one and you have 6 seconds to finish the other, or it comes back. Wear both down evenly. |
| **The Heisenbug** | `~/prod/` | It teleports away if you stare at it too long; an observer ring shows the timer. It spawns decoys, then switches to spiral bullet patterns and summons Null Pointers. |

- **Stagecraft:** each boss arrives with a glitching portrait on the warning card and an entrance burst. The arena also changes: an orbit ring for the Loop, a heap gauge for the Leak, a HEAD/incoming split for the Conflict, glitch bands for the Heisenbug.
- **Fair hits:** phase changes come with a freeze-frame, a shake and a scan line, and each one drops a hotfix heart near you.
- **Finale:** a defeated boss blows apart in a chain of 12 explosions. Then a **BUG FIXED ✓** card shows the commit message and the actual code diff that fixed it, ending in `✓ 1 test passing`.

### /compact and perfect dashes

- **Context meter:** every hit you land charges the bar under your hearts.
- **Casting:** when it's full, an `E` keycap floats above Clawd. Press it for a **/compact** shockwave that clears enemy bullets and puddles and damages every bug on screen ("Compacting conversation...").
- **Boss fights** always start with a full meter.
- **Perfect dash:** dash *through* an enemy bullet for a gold "perfect" and a chunk of meter.

### Patches

After each of the first three bosses you pick one of three patches.

| Patch | Effect | Max stacks |
|---|---|---|
| Spread Shot | +2 angled sparks | 2 |
| Rapid Fire | Fire 25% faster | 2 |
| Pierce | Sparks pass through +1 bug, +15% damage | 2 |
| Heavy Bolts | +35% damage, bigger sparks | 2 |
| Extra Heart | +1 max heart | 2 |
| Quick Dash | Dash recharges in 0.45 s | 1 |
| Ricochet | Sparks bounce off walls once | 1 |

Picking a patch makes Clawd celebrate.

### Juice and jokes

- **Bugs:** they pop in when they spawn, squash when hit, burst into debris and leave stains on the code floor.
- **Kill pops:** tool-call style, such as `Fix(;)`, `await` and `free()`.
- **Clawd's lines:**
  - stage intros read like a terminal prompt;
  - bosses taunt at phase changes;
  - every game over gets a crash line (`Segmentation fault (core dumped)`, `exit code 139`, …).
- **Victory screen:** `ALL TESTS PASSING ✓`, your time, deaths and patches, a tally of every bug you squashed by type, and a `git log` of the four fixes.
- **Transitions:** terminal-wipe scene changes (`$ ./clawd --fight`, `$ git reset --hard HEAD`).
- **Low health:** a heartbeat, a throbbing last heart and a red screen edge.

### Sound

- Every sound effect is synthesised live with Web Audio, with no audio files. Repeated sounds vary slightly in pitch so they don't grate.
- A procedural chiptune plays per stage. Each stage has its own scale and tempo, and each boss has its own loop that intensifies in phase 2.
- The music ducks under big moments.
- **M** mutes everything and **N** toggles just the music. Both settings are remembered.

### Unlocks and modes

- **Hats:** beating a boss earns its hat (Loop cap, Slime hat, Branch beanie, Shades). A full clear earns the Crown. Pick your hat on the title screen with Q/E.
- **Boss Rush:** after your first victory, play all four bosses back to back.
- **`--yolo`:** a flag run with 3 base hearts, faster bullets and shorter mercy frames. Winning it earns a special hat.
- **Secrets:** there are a couple for people who type the right things on the title screen.

### Comfort and robustness

- **Calm mode (V):** turns off screen shake, swaps full-screen flashes for edge glows and slows fast blinking. It's on by default if your system asks for reduced motion.
- **Scaling:** whole-number pixel scaling with letterboxing fits any window and keeps the pixel art crisp.
- **Auto-pause:** the game pauses when the tab loses focus.
- **Crash screen:** if anything ever breaks, a **KERNEL PANIC** screen shows the error. Press R to reload.
- **No dependencies:** no npm packages, no image or audio files, no build step needed to play.

## How to play

- **Fight, then upgrade:** beat each stage's waves and boss, then pick a patch.
- **Watch the bars:** each boss has a trick, and the health bars and the screen hint at it. In `.git/`, watch the twins' bars; in `prod/`, watch what happens when you stare.
- **Use E:** /compact is your panic button. Every boss fight hands you one charge.
- **Grab P0 drops:** P0 elites and boss phase changes drop hotfix hearts, so go get them.

## Development

```bash
npm test
```

This runs about 1,000 headless tests with `node:test`. They include a bot that plays every stage in invincible mode, checks every boss can be beaten, and prints a difficulty report.

Debug URLs work only on localhost or `file://`, never on a deployed page:

| Hash | Effect |
|---|---|
| `#stage=3` | Start at stage 3 |
| `#stage=3&boss` | Skip the waves and go straight to the boss |
| `#god` | Invincible |
| `#seed=42` | Fixed run seed |
| `#speed=4` | Simulation speed multiplier (1–8) |
| `#patches=spread,rapid,rapid` | Start with patches |
| `#hitboxes` | Draw hitboxes |
| `#rush`, `#yolo` | Boss Rush / YOLO mode |

`window.CB.debug.run` exposes the live run in the console.

## Building

| Command | Output | Used for |
|---|---|---|
| `npm run build:site` | `public/`: `index.html` plus exactly the 45 scripts it lists. Tests, docs and tools stay out. | Static hosting (Vercel). |
| `npm run build` | `dist/clawd-vs-bugs.html`: every script inlined into one file (one `<script>` per source file, with `sourceURL` comments so stack traces name the real file). | The claude.ai Artifact version. |

## Deploying (Vercel)

- `vercel.json` sets `framework: null`, runs `node tools/build-site.mjs` and serves `public/`.
- Pushing to `main` deploys production through the Vercel Git integration.
- Preview deployments stay behind Vercel Authentication. The production domain is meant to be public; that's set under the project's Deployment Protection settings.

## How it's built

- Plain JavaScript classic scripts on one global, `window.CB`, rendered with Canvas 2D on a 320×180 buffer scaled up with integer scaling.
- Game logic is deterministic: a seeded RNG and a fixed 60 Hz step, with drawing kept separate. The whole game can therefore run headless in Node for tests and the playthrough bot.
- Every sprite is a string of palette characters in the source. Sound effects and music are synthesised with Web Audio.
- Design spec: `docs/superpowers/specs/2026-10-06-clawd-vs-bugs-design.md`. Implementation plan and balance log: `docs/superpowers/plans/2026-10-12-clawd-vs-bugs.md`.
