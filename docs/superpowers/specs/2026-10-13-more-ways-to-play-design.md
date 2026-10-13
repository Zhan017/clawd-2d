# More ways to play: gamepad + touch (design, 2026-10-13)

Addendum to `2026-10-06-clawd-vs-bugs-design.md`. That spec made the game desktop-only; this lifts it. The keyboard + mouse game stays exactly as it is (every existing kbm prompt text unchanged); gamepad and touch are added beside it.

## Goals

- A standard controller (Xbox / PlayStation / Switch Pro via the browser Gamepad API) plays the whole game with no keyboard or mouse: menus, fights, patch picks, pause, game over, victory.
- A phone or tablet held in landscape plays the whole game with on-screen twin sticks and buttons.
- Every on-screen prompt matches the device you're using right now, and switches the moment you touch a different one.
- No new dependencies, and the simulation stays deterministic: new inputs are just data in the per-tick InputState.

## Decisions

| Topic | Decision |
|---|---|
| Device tracking | `device` is the last device used: `'kbm'`, `'pad'` or `'touch'`. Key or mouse activity → kbm, pad button or stick past its deadzone → pad, any touch → touch. Phones (coarse pointer, no fine pointer) start in `'touch'`, so the title already says "Tap to start". |
| Stick aim | Pads and touch aim by **direction**, not by position: InputState gains `aimDirX/aimDirY` (a unit vector, or null for mouse aim). The player puts its aim point 48 px out along it. |
| Aim assist | Stick aim only (never the mouse): if a regular enemy that can be hit right now sits within 10° of the stick direction and 140 px, the aim snaps onto it (smallest angle wins, then the nearest). Bosses and boss parts are never assisted, so the Heisenbug's decoys stay a puzzle. |
| Movement | Pad and touch movement is direction only, at full speed, like the keyboard (the player already normalises it), so balance doesn't change. |
| Pad layout | L-stick or D-pad to move. R-stick aims and auto-fires past 0.5 deflection; RT also fires. **A** = dash and confirm. **LB/LT** = dash. **RB/B** = /compact. **Start** = pause. **Back/Select** = quit (twice from pause; once from game over). Title: A start, Y boss rush, X toggles --yolo, LB/RB cycle hats. Patch pick and pause toggles: D-pad or L-stick flicks move a focus, A picks. |
| Touch layout | Floating twin sticks: a touch on the left half becomes the move stick where it lands; one on the right half becomes the aim stick, which fires while held (a tap fires along the last direction). The DASH and /compact buttons sit bottom-right, with a pause button top-right. Faint rings show where the sticks rest. The /compact button fills with the meter and glows when ready. |
| Touch in menus | Outside combat, a touch is a tap: it moves the pointer there and confirms, just like a click. Title, patch cards, game over, victory and pause all work by tapping. |
| Sound, music and calm on touch | Phones have no M, N or V keys, so the title and pause screens get three tappable chips: `sound: on`, `music: on`, `calm: off`. They're clickable with a mouse too, and the pad picks them with focus plus A on the pause screen. |
| Pause on touch/mouse | A tap or click on the pause screen resumes, except on a chip (toggles it) or on `[ quit to title ]` (first tap arms, second quits, like Q). |
| Game over on touch | A tap retries, and a tap on the quit line quits. |
| Haptics | Pad rumble through `vibrationActuator`, and phone vibration through `navigator.vibrate` (Android; iOS ignores it). Triggered by hurt, death, boss phase, boss death, /compact and pickups. Calm mode turns haptics off. |
| Phone extras | Starting a run from the title on touch asks for fullscreen and a landscape lock (Android; harmless elsewhere). In portrait, a CSS overlay asks you to rotate, and a running fight auto-pauses. No callouts, text selection or double-tap zoom on the canvas. Home-screen meta tags make a saved icon launch fullscreen. |
| Controller events | "controller connected" and "controller disconnected" toasts. A disconnect mid-fight auto-pauses. |
| Keyboard bonus | The arrow keys and A/D move the patch-pick focus, and Enter picks, so the keyboard alone can choose a patch. |

## Prompts per device

| Where | kbm (unchanged) | touch | pad |
|---|---|---|---|
| Title start | Click to start | Tap to start | Press A to start |
| Title legend 1 | WASD move · Mouse aim · Click shoot · Space dash | Left thumb: move · Right thumb: aim + shoot | L-stick move · R-stick aim + shoot · A dash |
| Title legend 2 | E /compact · N music · M mute · V calm · Esc pause | DASH and /compact buttons · II pause | RB /compact · Start pause · RT shoot |
| Hat row | (Q/E) | (tap) | (LB/RB) |
| Patch hint on a card | [1] [2] [3] | tap | A on the focused card |
| /compact prompt above Clawd | E keycap | none (the button glows) | RB keycap |
| Game over | R / click: retry … · Q: quit to title | Tap: retry … · [ quit to title ] | A: retry … · Back: quit to title |
| Victory | Click to play again | Tap to play again | Press A to play again |
| Pause line | Esc: resume · Q: quit to title | Tap: resume | Start: resume · Back: quit to title |
| Panic | Press R to reload | Tap to reload | Press R to reload |

## Out of scope

- Remapping controls, analog walk speed, and gyro aim.
- Portrait gameplay (we ask the player to rotate).
- Aim assist on bosses.
