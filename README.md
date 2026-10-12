# Clawd vs Bugs

A top-down pixel boss rush. You play as Clawd and shoot your way through four software-bug bosses, fixing a codebase one stage at a time: `~/src/`, `~/node_modules/`, `~/.git/` and `~/prod/`.

Fan game. Not affiliated with Anthropic.

It runs in the browser on desktop (keyboard and mouse) and takes about 10 minutes per run.

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

## How to play

- Each stage has two short waves of bugs, then a boss. Beat a boss and you pick one of three **patches**: upgrades such as Spread Shot, Rapid Fire, Pierce or Extra Heart.
- **Context meter:** every hit you land charges the bar under your hearts. When it's full, an `E` keycap floats above Clawd. Press it to cast **/compact**, a shockwave that wipes enemy bullets and damages every bug. Every boss fight starts with a full meter.
- **Perfect dash:** dash *through* an enemy bullet to get a gold "perfect" and a chunk of meter.
- **P0 elites:** bugs with a gold ring and a `P0` tag are tougher. They drop a hotfix heart when they die. Bosses drop one at each phase change too.
- **Checkpoints:** die to a boss and you retry the boss, not the whole stage. Die in wave 2 and you restart at wave 2.
- Each boss has a trick. The health bars and the screen tell you what it is. Watch the twins' bars in `.git/`, and watch what happens when you stare at the Heisenbug.

Beat the game to unlock **Boss Rush** and the `--yolo` flag on the title screen. Bosses also leave behind hats, and there are a couple of secrets for people who type the right things on the title screen.

## Running it

There are no dependencies and no build step.

```bash
npm run serve
```

Then open http://127.0.0.1:8137/. You can also double-click `index.html`, since the game uses classic scripts and works from `file://`.

## Development

```bash
npm test
```

This runs about 1,000 headless tests with `node:test`. They include a bot that plays every stage in invincible mode, checks every boss can be beaten, and prints a difficulty report.

Debug URLs work only on localhost or `file://`, never on the published page:

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

## Building the single-file page

```bash
npm run build
```

This writes `dist/clawd-vs-bugs.html`: the page markup and styles plus every script inlined in order (one `<script>` per file, with `sourceURL` comments so stack traces name the real file). That is the file published as the claude.ai Artifact.

## How it's built

- Plain JavaScript classic scripts on one global, `window.CB`, rendered with Canvas 2D on a 320×180 buffer scaled up with integer scaling.
- Game logic is deterministic: a seeded RNG and a fixed 60 Hz step, with drawing kept separate. The whole game can therefore run headless in Node for tests and the playthrough bot.
- Sound effects and the chiptune are synthesised with Web Audio. There are no audio or image files: every sprite is a string of palette characters in the source.
- Design spec: `docs/superpowers/specs/2026-10-06-clawd-vs-bugs-design.md`. Implementation plan and balance log: `docs/superpowers/plans/2026-10-12-clawd-vs-bugs.md`.
