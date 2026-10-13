# Title screen: menu redesign (2026-10-13)

User feedback, with a screenshot of the title's lower half: "not really clear for people reading."

## What's wrong today

`src/scenes/title.js`. Text rows (`Y`):

| Row | y | Content |
|---|---|---|
| hat | 105 | hat row |
| start | 114 | start |
| modes | 124 | modes |
| keys1 | 138 | legend line 1 |
| keys2 | 147 | legend line 2 |
| footer | 160 | disclaimer |
| status | 170 | chips |

The problems:

- About eight rows of same-coloured centred text sit straight on the busy code-line arena, with no hierarchy.
- The primary action ("Click to start") **blinks** (0.6 s on, 0.3 s off), which makes it harder to read.
- The modes are plain bracket text and don't look clickable. `[ ] --yolo` is cryptic.
- The keyboard legend repeats M/N/V, which the toggle chips already show.
- The disclaimer is squeezed between the legend and the chips.

## The redesign

The logo, Clawd, the wandering bugs and sparks, the secret codes, and every input path (mouse, touch, pad, Enter, Q/E) stay. Only the lower half is laid out again (from about y 96).

**1. A menu card.** A dark translucent panel behind the menu: `C.ink` at about 0.7 alpha, with a 1 px `greyDark` frame. Suggested box x 34–286, y 97–171. The menu stops fighting the arena background.

**2. The hat picker.** Shown only when a hat is unlocked, in the top row of the card: `‹ Crown ›` (or `‹ no hat ›`).

- The key hint goes on the outside: kbm `Q ‹ Crown › E`, pad `LB ‹ Crown › RB`, touch `‹ Crown ›`.
- Mouse and touch: the left arrow cycles back, the right arrow and the name cycle forward.
- Keep `HAT_BOX` covering the row, and add left/right sub-boxes.

**3. The START button.** A framed box (about 104×13, centred) in clawd orange (`C.clawd` frame, `C.clawdDark` fill at low alpha, white text).

- The label comes from `Prompts.text('start')`: `Click to start`, `Tap to start` or `Press A to start`.
- **The text no longer blinks.** The frame gently pulses brightness instead, at no more than 1 Hz, through `CB.Comfort.blink` / calm mode (steady in calm).
- It is a pointer hit box: a click or tap on it starts. A click or tap anywhere that isn't another control also still starts, as today.
- Mouse hover brightens it.

**4. Mode buttons.** One row of framed boxes in the toggle-chip style (the same frame and hover look as `CB.Screens.toggles`, so the screen has one button language).

| Button | When shown | Label |
|---|---|---|
| boss rush | modes unlocked | `boss rush` |
| daily build | always | `daily build`, or `daily build ✓` once cleared today |
| yolo | modes unlocked | `--yolo: off` / `--yolo: ON` |

- `--yolo: ON` has a red frame and red text, and a shape cue: the frame is doubled, so it isn't colour-only.
- Pad labels prefix the button: `Y boss rush`, `B daily build`, `X --yolo: off`.
- Without the modes unlock, only the daily build shows, centred.
- Keep the `BUTTONS` export (ids `rush`, `yolo`, `daily`) with hit boxes that match the drawn frames exactly. Tests check boxes against drawn frames.
- **A description line:** while the mouse hovers a mode button, a pad focus is on it, or (touch) for 2 s after a tap on the yolo toggle, one dim line under the row says what it does. Strings (each must fit the card):
  - boss rush: `all four bosses back to back`
  - daily build: `one seeded run a day, the same for everyone`
  - yolo: `3 hearts, faster bullets: bragging rights`

  With nothing hovered, that line shows the controls legend instead (see 5).

**5. The controls legend.** One or two short lines in a dimmer colour (`C.grey`, not `pale`), so they recede behind the buttons. The `legend1`/`legend2` Prompts strings for kbm drop the M/N/V part, since the chips show those keys:

| Device | legend1 | legend2 |
|---|---|---|
| kbm | `WASD move · Mouse aim · Click shoot` | `Space dash · E /compact · Esc pause` |
| touch | `Left thumb move · Right thumb aim + shoot` | `DASH and /c buttons · II pause` |
| pad | `L-stick move · R-stick aim + shoot` | `A dash · RB /compact · Start pause` |

Adjust the touch and pad strings so they fit. The pause screen uses `pauseLegend1`/`pauseLegend2`, which are unchanged.

**6. The chips row** (`CB.Screens.toggles`), unchanged in behaviour, sits just under the card or as its last row. Every box stays fully on screen.

**7. The disclaimer** gets the very last row, about y 173, in `C.greyDark`. When a toast is up, the toast takes the disclaimer's row with its ink band, as today, and never covers a button.

## Constraints

- **320×180 and the 5×7 bitmap font.** Every string must fit its box (measure with `CB.Font.measure`). No overlaps: the draw-test layout helpers (`H.recorder`, the `overlaps` helpers in `tests/draw.title.test.js`) must pass for these cases:
  - every device: kbm, touch, pad;
  - modes locked and unlocked;
  - hats none and some;
  - daily done and not done;
  - yolo on and off;
  - a toast showing;
  - a long hat name (`Branch beanie`).
- **No colour-only cues.** Blinking goes through `CB.Comfort.blink`.
- **Input behaviour is unchanged** except for the new hit boxes. The pointer hit order is chips, then the hat arrows and row, then the START button and the mode buttons, then the rest of the screen, which starts the game. That keeps "click anywhere to start" working.
  - Enter keeps today's behaviour.
  - The `START_LOCK` and pad rules are as today.
  - The secret codes still work.
- **`tests/menus.devices.test.js` and `tests/daily.test.js` cover title layout and input.** Update their pinned positions to the new layout. Keep every behavioural assertion.
- **Visual verification is required.** Take screenshots of the real title for kbm, touch and pad, with modes locked and unlocked, hats and no hats, and a toast. Look at them and iterate until the menu reads clearly at 1× (320×180) and 3×.
