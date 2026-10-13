# More ways to play: implementation plan (2026-10-13)

Spec: `docs/superpowers/specs/2026-10-06-clawd-vs-bugs-design.md` (base) and `docs/superpowers/specs/2026-10-13-more-ways-to-play-design.md` (this feature; its decisions are binding).

## Global rules (same as the v1 plan)

- Vanilla JS classic scripts. Each file is `(function (CB) { 'use strict'; … })(window.CB);` and touches only `window.CB`. No dependencies.
- No `Math.random` or `Date.now` anywhere in `src/` (the lint test enforces it). Use `event.timeStamp` for event timing in input code.
- Optional modules are always called guarded on the method itself (`if (CB.X && typeof CB.X.f === 'function')`), because tests load partial stubs.
- Every existing keyboard + mouse prompt string stays byte-identical when the device is `'kbm'`. Existing tests must keep passing; when a test pins old behaviour this plan deliberately changes (listed per task), update that test and say so in your report.
- Run the whole suite with `npm test` (`node --test`; Node 26, so never `node --test tests/`). It must be green before you report.
- Match the surrounding code: comment density, naming, one-line "why" comments, `num()`/`clamp()` helpers where the file has them.

## Execution order

| Wave | Task | Owns (only these files) |
|---|---|---|
| 1 (parallel) | T1 Prompts, Gamepad, Haptics | `src/core/prompts.js`, `src/core/gamepad.js`, `src/core/haptics.js`, `tests/prompts.test.js`, `tests/gamepad.test.js`, `tests/haptics.test.js` |
| 1 (parallel) | T2 Touch | `src/core/touch.js`, `tests/touch.test.js` |
| 2 (parallel) | T3 Input + boot + page | `src/core/input.js`, `src/main.js`, `index.html`, `tools/build-artifact.mjs` (only if needed), `tests/platform.test.js`, `tests/boot.test.js`, `tests/build.test.js`, `tests/lint.test.js`, new `tests/input.devices.test.js` |
| 2 (parallel) | T4a Gameplay + play scene | `src/game/player.js`, `src/scenes/play.js`, `src/scenes/hud.js`, `src/game/compact.js`, `tests/scenes.test.js`, `tests/player.look.test.js`, `tests/draw.world.test.js`, `tests/compact.test.js`, new `tests/play.devices.test.js`, new `tests/aimassist.test.js` |
| 2 (parallel) | T4b Menus + screens | `src/scenes/title.js`, `src/scenes/screens.js`, `src/scenes/gameOver.js`, `src/scenes/victory.js`, `src/scenes/patchPick.js`, `src/scenes/panic.js`, `tests/draw.title.test.js`, `tests/draw.screens.test.js`, `tests/unlocks.test.js`, new `tests/menus.devices.test.js` |
| 3 | Orchestrator | Review every diff, full suite, browser QA (synthetic touch PointerEvents and a mocked `navigator.getGamepads`), README, push |

In wave 2, `index.html` is owned by T3. T4a and T4b load new scripts in their own tests through the harness (check how `tests/harness.js` loads a script list and add `src/core/prompts.js`, `src/core/touch.js` and `src/core/haptics.js` where needed), never by editing `index.html`. If a wave-2 test needs a module from another wave-2 task, stub it in the test.

The script order in `index.html` after T3: `… src/art/render.js`, **`src/core/prompts.js`, `src/core/gamepad.js`, `src/core/touch.js`**, `src/core/input.js`, **`src/core/haptics.js`**, `src/core/audio.js` … (45 → 49 scripts).

## Cross-task contracts (binding)

### InputState additions (every field always present after T3)

```js
{
  // existing: moveX, moveY, aimX, aimY, fire, dash, pause, mute, confirm, choice, retry, quit, compact, music, keys
  device: 'kbm' | 'pad' | 'touch', // last device used
  aimDirX: null | number,         // unit vector when aiming by stick (pad R-stick, touch aim stick), else both null
  aimDirY: null | number,
  aimAssist: false | true,        // true exactly when aimDirX !== null
  navX: -1 | 0 | 1,               // menu-navigation edges: d-pad press, L-stick flick, keyboard arrows / WASD keydown
  navY: -1 | 0 | 1,
  tap: false | true,              // this tick's confirm came from a pointer press (mouse button 0 or a touch tap) at (aimX, aimY)
  pad: null | { a, b, x, y, lb, rb, start, back }, // this tick's raw pad button edges (booleans); null when no pad is connected
}
```

Bot and test inputs that omit the new fields must behave exactly as before. `undefined` aimDirX means mouse aim.

### `game.input` API additions (T3 implements; T4a uses, guarded)

```js
input.device                 // getter: 'kbm' | 'pad' | 'touch'
input.setTouchMode(mode)     // 'menu' | 'sticks'; the play scene sets it every update
input.touchView()            // null unless device === 'touch'; else CB.Touch.view(state)
input.rumble(strong, weak, ms, vib) // pad: Gamepad.rumble on the active pad; touch: navigator.vibrate(vib); kbm: nothing
```

### `CB.Prompts` (T1)

```js
CB.Prompts = {
  device: 'kbm',                       // current device; input.js keeps it in sync
  setDevice(d),                        // ignores anything but 'kbm' | 'pad' | 'touch'
  detect(win) -> 'touch' | 'kbm',      // 'touch' when matchMedia('(pointer: coarse)') matches and '(any-pointer: fine)' doesn't; try/catch → 'kbm'
  text(key, device?) -> string,        // '' for an unknown key; device defaults to CB.Prompts.device
  TABLE,                               // { key: { kbm, touch, pad } }
}
```

Keys and strings (kbm strings are the current ones, byte-identical):

| key | kbm | touch | pad |
|---|---|---|---|
| start | `Click to start` | `Tap to start` | `Press A to start` |
| again | `Click to play again` | `Tap to play again` | `Press A to play again` |
| retryKey | `R / click` | `Tap` | `A` |
| quitDead | `Q: quit to title` | `[ quit to title ]` | `Back: quit to title` |
| pauseLine | `Esc: resume · Q: quit to title` | `Tap: resume` | `Start: resume · Back: quit to title` |
| quitArm | `Press Q again to quit` | `Tap quit again to quit` | `Press Back again to quit` |
| legend1 | `WASD move · Mouse aim · Click shoot · Space dash` | `Left thumb: move · Right thumb: aim + shoot` | `L-stick move · R-stick aim + shoot · A dash` |
| legend2 | `E /compact · N music · M mute · V calm · Esc pause` | `DASH and /compact buttons · II pause` | `RB /compact · Start pause · RT shoot` |
| pauseLegend1 | `WASD move · Mouse aim · Click shoot` | `Left thumb: move · Right thumb: aim + shoot` | `L-stick move · R-stick aim + shoot` |
| pauseLegend2 | `Space dash · E /compact (meter full)` | `DASH · /compact (meter full)` | `A/LB dash · RB/B /compact (meter full)` |
| hat | `(Q/E)` | `(tap)` | `(LB/RB)` |
| reload | `Press R to reload` | `Tap to reload` | `Press R to reload` |

Every string must fit in 312 px with `CB.Font.measure` (assert it in `tests/prompts.test.js`). If one doesn't, shorten the touch/pad string (never the kbm one) and note it.

### `CB.Gamepad` (T1)

```js
CB.Gamepad = {
  BTN: { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 },
  DZ_MOVE: 0.25, DZ_AIM: 0.3, FIRE_AT: 0.5, TRIGGER_AT: 0.35, NAV_ON: 0.6, NAV_OFF: 0.3,
  pick(list) -> pad | null,      // from navigator.getGamepads(): first non-null with connected !== false, preferring mapping === 'standard'
  createState() -> state,        // { prev: [], lt: false, navLatchX: 0, navLatchY: 0 }
  read(pad, state) -> out,       // pure apart from updating state; pad may be null → an idle out (active false, all zero/false/null)
  rumble(pad, strong, weak, ms) -> boolean, // vibrationActuator.playEffect('dual-rumble', {...}); try/catch; swallows a rejected promise
}
// out:
{
  active,            // any button down, a trigger ≥ TRIGGER_AT, or a stick past its deadzone this tick
  moveX, moveY,      // D-pad if any D-pad button is held (−1/0/1 per axis), else L-stick with a radial DZ_MOVE deadzone (raw values past it)
  aimDirX, aimDirY,  // R-stick unit vector when its magnitude ≥ DZ_AIM, else null
  fire,              // R-stick magnitude ≥ FIRE_AT, or RT value ≥ TRIGGER_AT
  edges: { confirm, dash, compact, pause, quit }, // confirm = A; dash = A | LB | LT crossing TRIGGER_AT; compact = RB | B; pause = START; quit = BACK
  pad: { a, b, x, y, lb, rb, start, back },       // press edges
  navX, navY,        // edges: a D-pad press, or the L-stick crossing NAV_ON on that axis (re-armed below NAV_OFF)
}
```

"Pressed" means `b && (b.pressed || b.value > 0.5)`. Triggers use `value ≥ TRIGGER_AT`. Axes 0/1 are the L-stick and 2/3 the R-stick. Missing buttons or axes count as released or zero.

### `CB.Haptics` (T1)

```js
CB.Haptics = {
  EFFECTS: {
    playerHurt: { strong: 0.8, weak: 0.4, ms: 160, vib: 40, pri: 2 },
    playerDie:  { strong: 1.0, weak: 1.0, ms: 400, vib: [60, 40, 120], pri: 3 },
    bossPhase:  { strong: 0.6, weak: 0.6, ms: 250, vib: 50, pri: 2 },
    bossDie:    { strong: 1.0, weak: 0.7, ms: 600, vib: [80, 50, 80, 50, 160], pri: 3 },
    compact:    { strong: 0.3, weak: 0.9, ms: 300, vib: 30, pri: 1 },
    pickup:     { strong: 0.0, weak: 0.3, ms: 80,  vib: 15, pri: 0 },
  },
  handleEvents(evs, sink) -> name | null, // plays only the highest-priority effect in evs (first wins a tie) via sink.rumble(strong, weak, ms, vib); nothing when calm mode is on or sink has no rumble
};
```

Check the real event names with `grep -rn "emit('" src/game` (the ones above exist today: `playerHurt`, `playerDie`, `bossPhase`, `bossDie`, `compact`, `pickup`).

### `CB.Touch` (T2)

Pure state machine in **internal** coordinates (320×180). Input converts client coordinates with `renderer.toInternal`, and they may fall outside 0..320 × 0..180 (letterbox).

```js
CB.Touch = {
  STICK_R: 16, DEAD_MOVE: 3, DEAD_AIM: 4, HIT_PAD: 6,
  BUTTONS: { dash: { x: 298, y: 146, r: 12 }, compact: { x: 272, y: 163, r: 10 } },
  PAUSE: { x: 296, y: 22, w: 20, h: 18 },         // hit box in the arena's top-right corner (Rev 2; draw a small framed "II" inside it)
  REST: { move: { x: 40, y: 140 }, aim: { x: 236, y: 140 } }, // faint ghost rings when a stick is idle
  createState() -> st,
  setMode(st, 'menu' | 'sticks'),  // on a change: every live pointer becomes ignored until it lifts, sticks clear
  down(st, id, x, y), move(st, id, x, y), up(st, id), // up also handles pointercancel
  sample(st) -> out,               // consumes edges and the tap
  releaseAll(st),
  view(st) -> { mode, move: null | { ox, oy, x, y }, aim: null | { ox, oy, x, y }, dashDown, compactDown, pauseDown },
  draw(r, view, t, o),             // o: { compactFrac: 0..1, compactReady, dashReady }
  isPortrait(win) -> boolean,      // innerHeight > innerWidth
  requestFullscreen(doc, scr),     // documentElement.requestFullscreen({ navigationUI: 'hide' }) then screen.orientation.lock('landscape'); every step guarded, promises caught
};
// out:
{ active, moveX, moveY, aimDirX, aimDirY, fire, edges: { dash, compact, pause, confirm }, tap: null | { x, y } }
```

Rules:

- **Menu mode:** `down` records `tap = {x, y}` and a `confirm` edge. Nothing else.
- **Sticks mode, `down` classification in order:**
  1. In PAUSE (expanded by HIT_PAD): `pause` edge.
  2. Within `r + HIT_PAD` of dash: `dash` edge (owner dash).
  3. Within `r + HIT_PAD` of compact: `compact` edge.
  4. `x < 160`: the move stick if it's free, else ignored.
  5. Otherwise: the aim stick if it's free, else ignored.

  A stick's origin is where the finger lands, clamped to `[STICK_R + 2, W − STICK_R − 2] × [STICK_R + 2, H − STICK_R − 2]`.
- **Sticks mode, `move`:** with `v = finger − origin`, when `|v| > STICK_R` the origin is dragged along so `|v| = STICK_R`.
  - Move output is `(0, 0)` when `|v| < DEAD_MOVE`, else `v̂` (full speed).
  - Aim: when `|v| ≥ DEAD_AIM`, the last aim direction becomes `v̂`.
- **Sticks-mode output:** `aimDir` is always the last aim direction (starting at `(0, −1)`), so it is never null in sticks mode. `fire` is true while the aim stick is held, so a tap fires along the last direction. `active` is true when any touch happened since the last sample, or any is held.
- **Menu-mode output:** `aimDirX` and `aimDirY` are null and `fire` is false.
- **Drawing:** chunky 1 px pixel-art shapes using `r.frame`, `r.rect`, `r.disc` and `r.alpha`.
  - Idle sticks show ghost rings at REST at alpha about 0.18. A live stick shows its ring at the origin and a knob at the clamped finger, at about 0.45.
  - Buttons are a ring plus a label drawn with `r.text`: `DASH` (dim while dash is cooling down) and `/c`. The /compact button fills bottom-up with `compactFrac` and pulses gold when ready.
  - `II` for pause.
  - Use palette colours from `CB.Pal.C`.

## T1: Prompts, Gamepad, Haptics

Create the three modules exactly per the contracts. In tests, prove:

- Prompts: every key × device; the kbm strings match the table (and therefore today's source strings); every string fits 312 px; `detect` against stubbed matchMedia (coarse + no fine → touch; fine → kbm; throwing → kbm); unknown keys give `''`; `setDevice` ignores junk.
- Gamepad:
  - Pure `read` on fake pad objects: deadzones, D-pad over stick, fire by stick and by RT, every edge (fires once on press, not while held), LT edge, nav latch and re-arm, missing axes or buttons, a null pad.
  - `pick` preference; `rumble` with and without `vibrationActuator`, including a rejecting promise.
- Haptics: priority choice, calm mode off switch, a missing sink or rumble, unknown events ignored, return value.

## T2: Touch

Create `src/core/touch.js` per the contract. Tests:

- Menu taps; each sticks-mode classification region, including letterbox coordinates.
- Origin clamping; drag-follow; deadzones; last aim direction kept after release; fire while held.
- Two simultaneous pointers (move and aim) plus a third ignored; a button pointer moving doesn't move a stick.
- `setMode` change drops live pointers (their later move or up is harmless); `releaseAll`; edges consumed once by `sample`.
- `view` shape; `draw` runs against the recording renderer stub the other draw tests use (find it in `tests/harness.js` or `tests/draw.*.test.js`) without throwing and paints the buttons; `isPortrait`; `requestFullscreen` with missing APIs and rejecting promises.

## T3: Input, boot, page

`src/core/input.js`:

- Keep every existing behaviour.
- **Gamepad:**
  - In `sample()`, poll `(win.navigator || {}).getGamepads` (try/catch: a permissions policy can throw), `CB.Gamepad.pick`, then `read`. Remember the picked pad for `rumble`.
  - `out.active` sets device 'pad'.
- **Touch:**
  - Add `pointerdown` on the canvas, and `pointermove`, `pointerup` and `pointercancel` on the window, for `e.pointerType === 'touch'` only. On down call `preventDefault`, then `canvas.setPointerCapture` (guarded) and `canvas.focus`.
  - Convert with `renderer.toInternal` and feed `CB.Touch`. Device becomes 'touch'.
  - Remember `lastTouchTS = e.timeStamp`.
- **Mouse:**
  - Ignore `mousedown`, `mousemove` and `mouseup` when `e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents`, or when `e.timeStamp − lastTouchTS < 1000` (the compatibility events after a tap).
  - `mousemove` sets device 'kbm' only after moving ≥ 2 px from the last mouse position. `mousedown` and `keydown` set 'kbm'.
- **Keyboard nav edges on keydown (non-repeat):**
  - ArrowLeft and KeyA give navX −1; ArrowRight and KeyD give +1.
  - ArrowUp and KeyW give navY −1; ArrowDown and KeyS give +1.
- **Pointer position:** `peekAim()` returns the last pointer position. A touch tap (menu mode) sets it to the tap's internal point; a mouse move sets it from client coordinates as now. Store which one is newer.
- **Merge in `sample()`:**
  - move is the sum of keyboard, pad and touch, clamped per axis.
  - `fire` is mouse, pad or touch.
  - Edges are OR'd: pad edges into confirm, dash, compact, pause and quit; touch edges into dash, compact, pause and confirm.
  - `pad` is the pad's edges object, or null when no pad is picked.
  - `navX` and `navY` come from the keyboard, else the pad.
  - `tap` is true for a mouse-button-0 press or a touch tap this tick.
- **Aim direction:**
  - When the device is 'pad': the R-stick direction when given, else the last R-stick direction (initially `(0, −1)`).
  - When the device is 'touch' and touch mode is 'sticks': touch's aimDir.
  - Otherwise null. `aimAssist` is `aimDirX !== null`.
- **Prompts:** initial device is `CB.Prompts.detect(win)` (guarded). Call `CB.Prompts.setDevice` on every change.
- **New methods:** `device` getter, `setTouchMode`, `touchView`, `rumble` (pad → `CB.Gamepad.rumble(lastPad, …)`; touch → `win.navigator.vibrate(vib)` guarded). `releaseAll` also releases touch.
- **`dispose`** removes every new listener too.

`src/main.js`:

- Add a `touchend` audio unlock beside `pointerdown` and `keydown`.
- `game.notify(text)` calls `game.scene.notify(text)` when present.
- `gamepadconnected` → notify `controller connected`; `gamepaddisconnected` → notify `controller disconnected` and call `blur()`, which auto-pauses a fight.
- Resize or orientationchange: when `CB.Touch.isPortrait(window)` and `input.device === 'touch'`, call `blur()`.
- `crash()`: also reload on canvas `pointerdown` (the touch handler's preventDefault swallows the compatibility mousedown).

`index.html`:

- Add the four scripts in the order above.
- CSS: `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none` and `-webkit-tap-highlight-color: transparent` on html and body; `overscroll-behavior: none` on html and body.
- A `#rotate` overlay: `display: none` by default; under `@media (orientation: portrait) and (pointer: coarse)` it becomes a full-screen grid with the page background, centred text `↻ Rotate your phone to play`, above the canvas, with `pointer-events: none`.
- Metas: `theme-color` `#0B0B10`, `mobile-web-app-capable` `yes`, `apple-mobile-web-app-capable` `yes`.

Make sure `tools/build-artifact.mjs` still produces a working single file that keeps the `#rotate` element and the CSS. Read it and `tests/build.test.js` first, and only change the tool if it drops them.

Tests:

- Extend `tests/platform.test.js` or create `tests/input.devices.test.js`:
  - fake window, canvas and renderer with listeners you can fire;
  - a fake `navigator.getGamepads` returning scripted pads;
  - device switching and Prompts sync;
  - the mouse compatibility-event guard;
  - the 2 px mousemove threshold;
  - nav edges;
  - merged fields;
  - aimDir rules per device and mode;
  - tap and confirm from touch in menu mode vs sticks mode;
  - pointer position from a tap;
  - rumble routing;
  - `getGamepads` throwing;
  - dispose.
- Boot test: notify routing, gamepad events, `touchend` unlock.
- Lint and build tests stay green with 49 scripts.

## T4a: Gameplay and the play scene

- **`player.js`:**
  - Constants `AIM_R = 48`, `ASSIST_DEG = 10`, `ASSIST_RANGE = 140`.
  - With `input.aimDirX != null` (and a non-zero vector), the aim is `p + dir * AIM_R`, or the assist target's position when `input.aimAssist` and `CB.Player.assistTarget(w, p, dx, dy)` finds one. Otherwise the aim is `input.aimX/aimY`, exactly as now.
  - Export `assistTarget` on `CB.Player`. Candidates are `w.enemies` entries that are `!dead && visible && targetable`, not `boss`, and not a decoy or a boss part. Read every boss file to learn how parts and decoys are flagged, and exclude all of them, with a test for each boss.
  - A candidate must be within ASSIST_RANGE and ASSIST_DEG of the stick. Pick the largest cosine; within 0.002 of each other, pick the nearer one.
- **`play.js`:**
  - `EDGE_OFF` gains `navX: 0, navY: 0, tap: false, pad: null`.
  - **Touch mode:** in `update`, the pointer states are paused, patchPick, dead and victory (the same set `draw` uses for the cursor). Call `game.input.setTouchMode(pointerState ? 'menu' : 'sticks')`, guarded.
  - `notify(text)` pushes `{ text, t: TOAST_T }`.
  - **Haptics:** after `CB.Audio.handleEvents(evs)`, call `CB.Haptics.handleEvents(evs, game.input)`, guarded.
  - **Paused:**
    - `navX` moves `ui.pauseFocus` over the three chips (wrapping) and sets `ui.pauseNav`.
    - Pad A (`inp.pad && inp.pad.a`) with `ui.pauseNav` toggles the focused chip through `CB.Screens.toggles.apply`.
    - `inp.tap`: a chip hit toggles it. A hit on `CB.Screens.pause.QUIT_BOX` runs the same arm-then-quit logic as Q. Anything else resumes (unpause, `quitArmT = 0`, uiSelect sound).
    - Keep Esc, P and Q as they are.
  - **patchPick:**
    - On entering patchPick (state change seen in update), start focus nav (`ui.nav = true`, `ui.focus = 1`) when the device is 'pad'.
    - `navX` moves `ui.focus` (clamped 0..2) and sets `ui.nav`. A pointer move (`aimX/aimY` changed since the last tick) or a tap clears `ui.nav`.
    - `ui.hover = ui.nav ? ui.focus : cardAt(aim)`. Confirm picks `ui.hover` as now. Expose `ui.nav` for patchPick's hint.
  - **dead:** a tap inside `CB.Screens.gameOver.QUIT_BOX`, after `CB.RUN_T.inputLock`, leaves for the title before the run steps (so the tap doesn't also retry).
  - **Drawing:**
    - When the device isn't 'kbm' and it isn't a pointer state, draw the crosshair at `w.player.aimX/aimY` (not when the player is dead).
    - In pointer states, draw no cursor for touch or pad.
    - When the device is 'touch' and it isn't a pointer state, draw `CB.Touch.draw(r, input.touchView(), t, { compactFrac, compactReady, dashReady })` after the HUD and before the overlay.
- **`hud.js`:** no change (Rev 2 moved the touch pause box below the HUD strip).
- **`compact.js`:** `drawPrompt` by device:
  - kbm: as now.
  - pad: a new `keycap_rb` sprite (a keycap like `keycap_e`, wide enough for `RB` in readable pixels).
  - touch: no keycap and no gold text (the button glows instead).
- **Tests:**
  - assist rules, including the boss, part and decoy exclusions and that mouse aim is never assisted;
  - aimDir aim point;
  - bot-style inputs unchanged (deterministic replay of the sim test still matches);
  - touch-mode switching per state;
  - pause chips, quit box and tap-to-resume;
  - patch focus nav with pad and keyboard;
  - the dead quit box;
  - Haptics and notify calls;
  - crosshair placement per device;
  - HUD path shift;
  - keycap per device.

## T4b: Menus and screens

- **`screens.js`:** add `CB.Screens.toggles` (shared by title and pause).

  ```js
  CB.Screens.toggles = {
    IDS: ['sound', 'music', 'calm'],
    boxes(y0) -> [{ id, x, y, w, h }], // fixed layout: 3 chips of w 74, h 11, gap 4, centred (x 45/123/201), y = y0 − 2; only chips whose module methods exist
    hit(x, y, y0) -> id | null,
    label(id) -> string,               // kbm: 'M sound: on' / 'N music: on' / 'V calm: off'; touch and pad: no key prefix
    apply(id) -> boolean,              // toggles through CB.Audio.toggleMute / CB.Music.toggle / CB.Comfort.toggle, plays uiSelect; returns the new on-state
    draw(r, y0, focusIndex),           // chips with a dim frame; a focused one (pad) or hovered one is bright
  };
  ```

  - **Pause:**
    - Line 34 is `Prompts.text('quitArm')` while armed, else `pauseLine`.
    - Lines 48 and 57 are `pauseLegend1` and `pauseLegend2`.
    - The y 66 status line becomes `toggles.draw(r, 66, ui.pauseNav ? ui.pauseFocus : -1)`.
    - Add `[ quit to title ]` at y 146 with `QUIT_BOX = { x: 110, y: 144, w: 100, h: 11 }`.
    - Export `CB.Screens.pause = { draw, CHIPS_Y: 66, QUIT_BOX }`.
    - With kbm, every line except the status-line-to-chips change and the new quit button reads exactly as before.
- **`gameOver.js`:**
  - The retry hint is `Prompts.text('retryKey') + ': ' + label`, so kbm still reads `R / click: retry boss`.
  - The quit line is `Prompts.text('quitDead')`.
  - Export `QUIT_BOX = { x: 100, y: 133, w: 120, h: 11 }` on `CB.Screens.gameOver`.
- **`victory.js`:** the prompt is `Prompts.text('again')`.
- **`patchPick.js`:** the card hint is kbm `[n]`; touch `tap`; pad `[A]` on the hovered card only when `ui.nav` is set, else blank.
- **`panic.js`:** the reload line is `Prompts.text('reload')`, in both the renderer path and the raw-canvas fallback.
- **`title.js`:**
  - **Removed:** `isSmallScreen`, the small-screen note and their state, since the touch prompts replace them.
  - **Prompts:** the start line uses `start`; the legend rows use `legend1` and `legend2`; the hat row uses `'hat: <name> ' + text('hat')`.
  - **Mode labels:** on pad, `Y: boss rush` and `X: [ ] --yolo` / `X: [x] --yolo`; kbm and touch keep the current labels.
  - **Status row** at `Y.status`: becomes `toggles.draw(r, Y.status, -1)`.
  - **`notify(text)`:** calls `setToast(text, 2.0)`.
  - **Pad edges (when `inp.pad`):**
    - `a` starts a normal run, honouring `this.yolo`, and skips the positional confirm that the same A's `confirm` would trigger.
    - `y`, when modes are on, starts boss rush.
    - `x`, when modes are on, toggles yolo with uiSelect.
    - `lb` cycles the hat back when hats exist (RB already arrives as `compact`).
  - **Pointer hit tests (only when `inp.tap`), in order:**
    1. A toggles chip.
    2. `HAT_BOX = { x: 90, y: 102, w: 140, h: 11 }` when hats exist: cycle forward.
    3. The mode buttons, as now.
    4. Otherwise start.

    Enter (`confirm` without `tap`) keeps today's behaviour.
  - **Touch start:** when a run starts with the device on 'touch', call `CB.Touch.requestFullscreen(document, screen)`, guarded.
  - **Cursor:** draw the title cursor only when the device is 'kbm'.
- **Tests:**
  - Every prompt per device on every screen. The kbm strings stay identical; update the pinned status-line expectations to the chips and note the changes.
  - Chip hit and apply; the pause and game-over boxes.
  - Pad title edges, hat box, chips and taps; Enter unchanged.
  - The patchPick hint per device.
  - Panic per device.
  - Title draws without the small-screen note.

## Orchestrator checklist (wave 3)

1. Read every diff. Run `npm test` myself.
2. Run `npm run build`, `npm run build:site` and `npm run serve`. QA in Playwright:
   - **Desktop:** confirm the kbm flow is unchanged.
   - **Touch:** dispatch `PointerEvent`s with `pointerType: 'touch'`. Tap to start, move and aim sticks, dash and /compact buttons, pause button, tap a patch, game over tap and quit, plus the chips.
   - **Pad:** override `navigator.getGamepads` with a scripted pad. A to start, stick aim fires, RB compact, Start pause, D-pad patch focus and A pick, Back quit, connect toast.
   - **Portrait:** check the rotate overlay at 390×844.
   - **Screenshots:** take one of each state.
3. Update the README (controls per device, features, script count 49) and the memory notes. Commit, push (Vercel redeploys), and verify https://clawd-2d.vercel.app serves 49 scripts.

## Rev 2: review fixes (authoritative; overrides anything above that it contradicts)

Wave 1 is done and verified: `prompts.js`, `gamepad.js`, `haptics.js` and `touch.js` exist with tests. The orchestrator already added the four script tags to `index.html` (49 scripts), so `H.load()` without a list, plus smoke, sim, build and lint, see them. T3 owns everything else in `index.html` (CSS, metas, `#rotate`), but not the script tags.

**Touch change made by the orchestrator:** a stick's origin is exactly where the finger lands, even in the letterbox, so landing never moves Clawd. Only the drawn ring is clamped on screen. `aimDir` keeps the last direction until the finger slides at least `DEAD_AIM`.

**Shared rules for every wave-2 task**

- Scene and draw code treats a missing `CB.Prompts`, a missing `game.input.device` or an undefined device as `'kbm'`. Tests give `game.input = { peekAim }` and nothing more (`draw.title.test.js:60`, `scenes.test.js:14`).
- Guard `CB.Screens.toggles`, because some title tests don't load `screens.js`.
- Files no task owns must pass unchanged: `extra.test.js`, `transition.test.js`, `smoke.test.js`, `sim.test.js`, `elites`, `stageRunner` and the boss tests (apart from those listed below). If you truly must change one, do the smallest change and report it.

**T3 (input, boot, page)**

- **Device switching:**
  - The device becomes `'pad'` on a pad button press edge, a trigger crossing, or a stick past **0.5**. Stick drift between the deadzone and 0.5 still moves and aims, but doesn't steal the device. That needs either `Gamepad.read`'s `active` plus a magnitude check in `input.js`, or a stronger flag computed in `input.js` from the raw pad.
  - `lastTouchTS` starts at `-Infinity` and updates on touch pointerdown, pointermove and pointerup alike. Events without a `timeStamp` (the tests) never count as compatibility events.
- **Activation work** (fullscreen and audio) runs in a touch `pointerup`/`touchend` handler, because a touch pointerdown is not a user activation:
  - `main.js` already unlocks audio on `touchend`. Also unlock on any pad press, via `CB.Audio.init()` (it resumes) from `input.sample()` when a pad edge fires, and on `gamepadconnected`.
  - Fullscreen: `input` exposes `requestFullscreenOnRelease()`, which arms a flag. The next touch `pointerup` calls `CB.Touch.requestFullscreen(document, window.screen)` and clears it. Guard `document`, `document.documentElement` and `window.screen`. The title (T4b) calls `game.input.requestFullscreenOnRelease()`, guarded, when it starts a run with the device on touch.
- **`#rotate` overlay:** uses `pointer-events: auto`, so a portrait tap can't reach the canvas and resume the fight underneath. While portrait and touch, `main.js` re-applies `blur()` on every resize and orientationchange.
- **`main.js` crash text:** the raw "Press R to reload" strings at `main.js:81` and `:101` use `CB.Prompts.text('reload')` when available.
- **Script count:** `tools/serve.mjs:4` mentions about 45 scripts; make it 49.

**T4a (gameplay + play scene)**

- **Assist predicate:** `!e.dead && e.visible && e.targetable && e.regular && !e.boss && !(e.invuln > 0)`. There are no decoy or part flags: every boss body, segment, twin and decoy has `boss: true, regular: false`.
- **Assist trigger:** only when `input.aimAssist && input.fire`, so an idle stick never snaps the crosshair onto passing bugs.
- **`player.js`:** sets `p.aimStick = true` when the aim came from `aimDirX` (else false). It's a plain field on the player object.
- **Heisenbug (T4a now also owns `src/game/bosses/heisenbug.js` and `tests/boss.heisenbug.test.js`):**
  - With `p.aimStick`, the boss counts as observed when the forward ray from Clawd along the aim direction passes within `OBSERVE_R` of the real body: `t = dot(b − p, dir) > 0` and the perpendicular distance is `≤ OBSERVE_R`.
  - Mouse aim keeps the current point check, and every existing test stays green.
  - The aim direction is `normalize(p.aimX − p.x, p.aimY − p.y)`, which is valid because the stick aim point is `p + dir * AIM_R` or the assist target.
- **`setTouchMode`:** call it first thing in `play.update`, before any early return or `leave()`.
- **Pause chips:** when pause opens, reset `ui.pauseNav = false` and `ui.pauseFocus = 0`. A chip toggles on `inp.pad && inp.pad.a`, or on `inp.confirm && !inp.tap` (Enter), when `ui.pauseNav` is set.
- **Patch pick hover:** on the touch device, `ui.hover` comes only from this tick's tap (`inp.tap ? cardAt(aimX, aimY) : -1`), so no stale highlight lingers from an earlier tap.
- **No HUD change:** the orchestrator moved the touch pause box into the arena's top-right corner, `CB.Touch.PAUSE = { x: 296, y: 22, w: 20, h: 18 }`, so the stage path stays where it is for every device. T4a doesn't touch `hud.js`.
- **Ownership:** T4a also owns `unlocks.test.js` (its play.js-driven cases at 188–260) and `boss.heisenbug.test.js`.

**T4b (menus + screens)**

- **Pause quit button:** `[ quit to title ]` text at **y 152**, with `QUIT_BOX = { x: 110, y: 150, w: 100, h: 10 }`. The old y 146 collided with the 7th patch line at 91 + 9·6 = 145; the disclaimer is at y 160. The worst-case layout test (`draw.screens.test.js:560-576`) must pass.
- **`toggles.apply('sound')`:** returns `!CB.Audio.toggleMute()`, because `toggleMute` returns the muted flag. Music and calm return their own new state.
- **Title hats:**
  - Gate `inp.quit` hat cycling on `!(inp.pad && inp.pad.back)`, and `inp.compact` on `!(inp.pad && inp.pad.b)`. Only LB and RB (and keyboard Q and E) cycle hats.
  - Every pad title edge respects `START_LOCK`, like confirm.
- **Fullscreen on start:** the title calls `game.input.requestFullscreenOnRelease()` (guarded), not `CB.Touch.requestFullscreen` directly.
- **Ownership:** T4b keeps `draw.title.test.js`, `draw.screens.test.js` and `menus.devices.test.js`. `unlocks.test.js` moves to T4a.
