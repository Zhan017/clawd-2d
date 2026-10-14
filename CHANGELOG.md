# Changelog

## v1.0.0 (2026-10-14)

The first finished release. Play it at https://clawd-2d.vercel.app.

### The game

- **The run:** four stages (`~/src/`, `~/node_modules/`, `~/.git/`, `~/prod/`). Each has two waves of software bugs and a boss.
- **Bosses:** each has one rule to learn.
  - **The Infinite Loop:** only its head takes damage.
  - **Memory Leak:** it heals if you stop hitting it, and its puddles slow and burn.
  - **Merge Conflict:** twin beetles. Finish the second within 6 s of the first.
  - **The Heisenbug:** only what you look at is real.
- **Between bosses:** patches, the /compact shockwave, perfect dashes, P0 elites and hotfix hearts.
- **Unlocks and modes:** hats, Boss Rush and `--yolo`.
- **Daily build:** one seeded run a day, the same for everyone.
- **Victory receipt:** a share button that copies your result, or opens the share sheet on a phone.
- **Sound:** synthesised effects and a procedural chiptune. There are no audio files.

### Play anywhere

- **Devices:** keyboard and mouse, any standard controller (with rumble), or a phone or tablet in landscape.
- **Prompts:** they follow the device you last touched.
- **Touch:**
  - floating twin sticks, plus tap to shoot where you tap;
  - on wide phones the controls sit in the side bars, clear of the notch;
  - menus are made to survive near-miss taps.
- **Installable app:** use the in-game **install** button, or Add to Home Screen on iPhone. It works offline after the first visit.
- **Calm mode:** no screen shake or rumble, and softer flashes.
- **Toggles:** tappable sound and music switches.

### Under the hood

- Zero dependencies, plain JavaScript and Canvas 2D on a 320×180 buffer.
- A deterministic 60 Hz simulation, about 1,780 headless tests and a playthrough bot that balance-checks every boss.
- The deployed site is one content-hashed bundle with a service worker, a link preview card, app icons drawn from the game's own sprites, and cookieless Vercel Web Analytics.

What could come next: [docs/IDEAS.md](docs/IDEAS.md).
