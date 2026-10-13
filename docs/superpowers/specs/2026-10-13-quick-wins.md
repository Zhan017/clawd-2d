# Quick wins: locked teasers, first-run hints, visitor stats (2026-10-13)

The user asked for the three quick wins from the "what next" list. Each one is small and lives in its own files.

## Q1. Locked teasers on the title (`src/scenes/title.js`)

New players (and every incognito visit) see no hat picker and no Boss Rush or `--yolo`, so they don't know those exist. Show them locked instead of hiding them.

**Hats.** When no hat is unlocked, the hat row becomes one dim, non-interactive line: `hats: beat a boss to earn one`. It uses `C.grey`, has no arrows and no key hints, and sits in the same row, so the card layout is the same as with hats. Once a hat is unlocked, the picker appears as today.

**Modes.** When the modes are locked, the mode row still shows all three buttons, in the unlocked layout (rush, daily, yolo):

- `boss rush` and `--yolo` are drawn **locked**: a dotted or dashed frame in `C.greyDark` and `C.greyDark` text, so the shape and not just the colour says "locked".
- Hovering them (mouse) or a pad press shows the description line `win a full run to unlock`.
- A click or tap on a locked button does **not** start a run and does not toggle anything. It shows a short toast, `win a full run to unlock boss rush` or `…--yolo`, with the `uiSelect` sound or a softer one.
- Pad Y and X while locked show the same toast.

The daily build button is unchanged.

**Contract.** Hit boxes match the drawn frames for every state. There are no overlaps (the draw-test helpers apply). All existing behaviour with unlocks stays identical.

## Q2. First-run hints (new `src/game/hints.js`, plus `src/scenes/play.js` wiring)

These are one-time tips, shown at the moment they matter. They are presentation only: no simulation changes, no `Math.random` and no `Date.now`.

- **Storage.** Each hint shows at most once per player, through `CB.Save` (`src/game/unlocks.js`, guarded) under the key `hints` (an array of seen ids). In incognito they show once per session.
- **When.** Only in the `wave` and `boss` states, unpaused, one at a time with a queue, each for about 3 s with a fade.
- **No hints in debug runs**, i.e. when `game.debug.active` (bot screenshots and tests stay clean).
- **Strings** are device-aware through `CB.Prompts`. Add keys to `TABLE` (`hintDash`, `hintCompact`, `hintPerfect`, `hintLook`) with kbm, touch and pad variants. Every string must fit 300 px.

| id | Trigger (from the play scene's step events and the world) | kbm text |
|---|---|---|
| `dash` | The first time an enemy bullet is within 48 px of Clawd and moving toward her | `Space: dash through bullets` |
| `compact` | The first `compactReady` event | `E: /compact clears the screen` |
| `perfect` | The first `graze` event with `perfect: true` | `perfect! dashing through bullets charges /compact` |
| `look` | The Heisenbug fight, 2.6 s in (or the first `<optimized out>` clink if that comes sooner) | `aim at a moth: only what you look at is real` |

Touch and pad variants name their buttons, for example `DASH: dash through bullets` and `A: dash through bullets`.

**Drawing.** A small framed banner (an ink box at about 0.8 alpha, 1 px `C.gold` frame, gold text) centred near the top of the arena, just under the HUD strip.

- It must not overlap the boss name or bar, the /compact banner (y 22; hide the hint while that banner shows), the touch pause box (x 296–316, y 22–40), or the wave text.
- Calm mode: no blinking, just a fade.

`CB.Hints` is an optional module that callers guard. The play scene calls `CB.Hints.onEvents(evs, run)` after each step and `CB.Hints.draw(r, t)` after the HUD. Add a test file (`tests/hints.test.js`) covering each trigger, the once-only storage, the debug and state gating, the queue, and the draw layout.

## Q3. Visitor stats (Vercel Web Analytics; `tools/build-site.mjs`)

Vercel Web Analytics is cookieless and first-party. The user enables it in the Vercel dashboard (project → Analytics → Enable). Until then `/_vercel/insights/script.js` returns 404.

- **Injection.** `build-site.mjs` adds the snippet to `public/index.html` only (never to the dev `index.html` or the Artifact build). The snippet:
  - first defines `window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };`
  - then loads `/_vercel/insights/script.js` without console noise while analytics is off: append the `<script defer>` only after a `fetch(..., { method: 'HEAD' })` comes back ok;
  - runs only on `https:`, guarded with try/catch.
- **Service worker.** `public/sw.js` must **not** handle `/_vercel/` paths (let the browser go to the network), so the analytics script is never served stale from cache.
- **Tests.** `tests/site.test.js`:
  - the snippet appears exactly once in `public/index.html` and never in the dev page;
  - `sw.js` skips `/_vercel/`;
  - the site still boots.
- **README.** One line in Deploying: analytics is cookieless and needs the dashboard toggle.

## Rules for all three

- `npm test` (`node --test`; never `node --test tests/`) stays green.
- Don't weaken tests.
- Keyboard and mouse text stays unchanged except where this spec adds something.
- Verify visually (screenshots) for Q1 and Q2.
