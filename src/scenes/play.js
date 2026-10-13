// Play scene: routes input to the run, handles pause/quit, patch picks (mouse, tap, pad or keyboard focus), layers world + HUD + overlays.
(function (CB) {
  'use strict';
  const EDGE_OFF = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [], navX: 0, navY: 0, tap: false, pad: null };
  const QUIT_ARM = 2.0; // seconds the second Q is accepted after the first one, while paused
  const TOAST_T = 2.5; // seconds a "NEW HAT" toast stays up
  const TOAST_MODES_T = 4.0; // ... and the "modes unlocked" one
  const TOAST_CALM_T = 1.5; // ... and the "calm mode: on/off" one
  const TOAST_FADE = 0.4; // a toast fades out over its last seconds
  const MODES_TEXT = 'UNLOCKED: boss rush + --yolo on the title';
  const RETRY_LABEL = '$ git reset --hard HEAD'; // typed by the transition after a retry
  const TOAST_Y = 171; // top of the toast text; its band (y 169-180) clears the victory prompt and share button at y 160-166
  const VICTORY_INPUT_AT = 1.5; // the victory screen takes play-again and share input strictly after this (victory.js CLICK_AT)
  const BUBBLE_STATES = { wave: true, waveBreak: true, boss: true }; // states without a centred card, where Clawd may 'think'
  const POINTER_STATES = { patchPick: true, dead: true, victory: true }; // screens driven by a pointer (and paused): a mouse cursor, or taps
  const PAUSE_CHIPS_Y = 68; // where the pause screen's sound/music/calm chips sit when screens.js does not say
  const OVERLAY = {
    stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn',
    bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory',
  };

  // A kill tally out of host data: finite, non-negative counts under their own keys; anything else is dropped.
  function cleanTally(v) {
    const out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) {
        const n = v[k];
        if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
      }
    }
    return out;
  }

  const inBox = (b, x, y) => !!b && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const dirOf = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0); // a nav edge from host input: anything but a number is no edge
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  CB.Scenes.play = {
    game: null,
    run: null,
    paused: false,
    quitArmT: 0, // >0 after the first Q on the pause screen; the pause screen reads it for the "Q again" prompt
    toasts: [], // queue of { text, t }: only the first is shown and counts down, the next one starts after it
    attemptSeen: 0, // run.attempt as of the last update: a change means a retry happened, which starts the transition
    ui: { hover: -1, nav: false, focus: 1, pauseNav: false, pauseFocus: 0 }, // nav/focus: patch-pick focus (pad, keyboard); pauseNav/pauseFocus: the pause chips
    stateSeen: null, // run.state as of the last unpaused update: a change to patchPick starts the pick's focus
    aimSeenX: NaN, // the pointer as of the last unpaused update: a move hands a patch pick back to the pointer
    aimSeenY: NaN,
    dailyDone: false, // a daily run's result has gone to CB.Daily (once, when the run first reaches victory)

    enter(game, data) {
      const d = data || {};
      this.game = game;
      const opts = Object.assign({ seed: Date.now() >>> 0 || 1 }, d.runOpts || {});
      this.run = CB.createRun(opts);
      if (d.restore) {
        this.run.deaths = d.restore.deaths | 0;
        this.run.time = +d.restore.time || 0;
        this.run.history = Array.isArray(d.restore.history) ? d.restore.history.slice() : [];
        const sq = cleanTally(d.restore.squashed); // two copies: kills must not leak into the stage-start tally a retry returns to
        this.run.squashed = Object.assign({}, sq);
        this.run.stageSquashed = Object.assign({}, sq);
      }
      this.paused = false;
      this.quitArmT = 0;
      this.toasts = [];
      this.attemptSeen = this.run.attempt;
      this.ui.hover = -1;
      this.ui.nav = false;
      this.ui.focus = 1;
      this.resetPauseUi();
      this.stateSeen = null;
      this.aimSeenX = NaN;
      this.aimSeenY = NaN;
      this.dailyDone = false;
    },

    // The device in use ('kbm' | 'pad' | 'touch'); a host that does not say is the keyboard and mouse.
    device() {
      const d = this.game && this.game.input && this.game.input.device;
      return d === 'pad' || d === 'touch' ? d : 'kbm';
    },

    // The screens that take a pointer: pause, patch pick, game over and victory. Everything else is a fight (or a card over one).
    pointerState() {
      return this.paused || POINTER_STATES[this.run.state] === true;
    },

    // A freshly opened pause screen starts with no chip focused.
    resetPauseUi() {
      this.ui.pauseNav = false;
      this.ui.pauseFocus = 0;
    },

    // Leaving the run for the title: the music stops with it.
    // Music is optional (and tests stub only part of it), so each call is guarded on the method itself.
    leave() {
      if (CB.Music && CB.Music.stop) CB.Music.stop();
      this.game.go('title');
    },

    onBlur() {
      if (this.run && CB.RUN_COMBAT_STATES[this.run.state] && !this.paused) {
        this.paused = true;
        this.resetPauseUi();
      }
    },

    // A toast from outside the run (the host: "controller connected"). With a `kind`, a toast of that kind still waiting is rewritten
    // instead of queued again, so a mashed share button shows one toast; a kinded toast with none waiting jumps the queue (it answers
    // an action, so it shows now, and the toast it displaced resumes after it with its remaining time: only toasts[0] counts down).
    notify(text, kind) {
      if (typeof text !== 'string' || !text) return;
      const queued = kind ? this.toasts.find((q) => q.kind === kind) : null;
      if (queued) {
        queued.text = text;
        queued.t = TOAST_T;
      } else if (kind) this.toasts.unshift({ text, t: TOAST_T, kind });
      else this.toasts.push({ text, t: TOAST_T });
    },

    // A daily run's result goes to CB.Daily the first time the run is seen in 'victory', and never again. Daily is optional, and a result
    // that cannot be saved must not stop the screen.
    recordDaily() {
      const run = this.run;
      if (this.dailyDone || run.state !== 'victory' || typeof run.daily !== 'string' || !run.daily) return;
      this.dailyDone = true;
      try {
        if (CB.Daily && typeof CB.Daily.record === 'function') CB.Daily.record(run.daily, { time: run.time, deaths: run.deaths, yolo: !!run.yolo });
      } catch (err) {
        // the best-of-the-day record is a nicety
      }
    },

    // Victory, after the prompt delay: C, the pad's X, or a tap on the share button. Without CB.Share there is no button and no share.
    wantsShare(inp) {
      const S = CB.Share;
      if (!S || typeof S.send !== 'function' || typeof S.text !== 'function') return false;
      if (Array.isArray(inp.keys) && inp.keys.includes('KeyC')) return true;
      if (inp.pad && inp.pad.x) return true;
      return !!inp.tap && inBox(CB.Screens.victory && CB.Screens.victory.SHARE_BOX, inp.aimX, inp.aimY);
    },

    // Sends the result: to the share sheet on a phone, the clipboard elsewhere. The text is made now. The send runs inside a user activation
    // (a touch's lift; the input says when) and its outcome becomes a toast: nothing when the player closed the share sheet themselves.
    share() {
      const S = CB.Share;
      const device = this.device();
      let text = '';
      try {
        text = S.text(this.run);
      } catch (err) {
        text = '';
      }
      const env = { nav: typeof navigator !== 'undefined' ? navigator : null, doc: typeof document !== 'undefined' ? document : null, device };
      const answer = (result) => {
        if (result === 'cancelled') return;
        const done = result === 'shared' || result === 'copied';
        const P = CB.Prompts;
        // The wording follows what happened, not the device: only the share sheet says "shared" (a phone whose sheet failed copied instead).
        const said = P && typeof P.text === 'function' ? P.text(done ? 'shareDone' : 'shareFail', result === 'shared' ? 'touch' : 'kbm') : '';
        this.notify(said || (result === 'shared' ? 'shared ✓' : done ? 'result copied ✓' : "couldn't copy"), 'share');
      };
      const send = () => {
        let sent;
        try {
          sent = S.send(text, env);
        } catch (err) {
          sent = 'failed';
        }
        Promise.resolve(sent).then(answer, () => answer('failed'));
      };
      const input = this.game && this.game.input;
      if (input && typeof input.withActivation === 'function') input.withActivation(send);
      else send();
    },

    // Runs the unlock rules on one step's events: a hat (or the modes unlock) queues a toast, and any unlock chimes (once per step) through the audio handler.
    // Returns the events the audio handler should see.
    trackUnlocks(evs) {
      const fresh = CB.Unlocks ? CB.Unlocks.onEvents(evs, this.run) : [];
      if (!fresh || !fresh.length) return evs;
      for (const id of fresh) {
        const hat = (CB.HATS || []).find((h) => h.id === id);
        if (hat) this.toasts.push({ text: 'NEW HAT: ' + hat.name, t: TOAST_T });
        else if (id === 'modes') this.toasts.push({ text: MODES_TEXT, t: TOAST_MODES_T });
      }
      return evs.concat([{ type: 'unlock', x: CB.W / 2, y: CB.H / 2 }]);
    },

    // V: calm mode on/off. One "calm mode" toast at a time: pressing V again rewrites it rather than queueing another.
    toggleCalm() {
      if (!(CB.Comfort && CB.Comfort.toggle)) return;
      const text = 'calm mode: ' + (CB.Comfort.toggle() ? 'on' : 'off');
      const queued = this.toasts.find((q) => q.kind === 'calm');
      if (queued) {
        queued.text = text;
        queued.t = TOAST_CALM_T;
      } else this.toasts.push({ text, t: TOAST_CALM_T, kind: 'calm' });
    },

    // A picked patch (the run reports it one step after the pick, on the new stage's world) gets its celebration.
    celebrate(evs) {
      if (!(CB.Fx && CB.Fx.celebrate)) return;
      for (const e of evs) if (e.type === 'patchPick') CB.Fx.celebrate(this.run.world, e.id);
    },

    // The two-step quit shared by Q, the pad's Back and a tap on the quit button: a stray press must not throw away the run.
    // True when it left for the title.
    quitPress() {
      if (this.quitArmT > 0) {
        this.leave();
        return true;
      }
      this.quitArmT = QUIT_ARM;
      return false;
    },

    // The pause screen's chips as screens.js lays them out (only the modules that exist), or [] without screens.js.
    chipBoxes() {
      const T = CB.Screens.toggles;
      if (!T || typeof T.boxes !== 'function') return [];
      const boxes = T.boxes(this.chipsY());
      return Array.isArray(boxes) ? boxes : [];
    },

    chipsY() {
      const P = CB.Screens.pause;
      return P && typeof P.CHIPS_Y === 'number' ? P.CHIPS_Y : PAUSE_CHIPS_Y;
    },

    // Pause screen input: nav edges move a chip focus, pad A or Enter toggles the focused chip, and a tap toggles the chip under it,
    // arms/confirms the quit button, or (anywhere else) resumes.
    pauseInput(inp) {
      const ui = this.ui;
      const T = CB.Screens.toggles;
      const apply = (id) => {
        if (id && T && typeof T.apply === 'function') T.apply(id);
      };
      const boxes = this.chipBoxes();
      const nav = dirOf(inp.navX);
      if (nav && boxes.length) {
        ui.pauseNav = true;
        ui.pauseFocus = (clamp(ui.pauseFocus | 0, 0, boxes.length - 1) + nav + boxes.length) % boxes.length;
      }
      const press = !!(inp.pad && inp.pad.a) || (inp.confirm && !inp.tap); // pad A, or Enter (a click confirms too, but is a tap)
      if (ui.pauseNav && press && boxes[ui.pauseFocus]) apply(boxes[ui.pauseFocus].id);
      if (!inp.tap) return;
      ui.pauseNav = false; // the pointer is in charge again
      const hit = T && typeof T.hit === 'function' ? T.hit(inp.aimX, inp.aimY, this.chipsY()) : null;
      if (hit) apply(hit);
      else if (inBox(CB.Screens.pause && CB.Screens.pause.QUIT_BOX, inp.aimX, inp.aimY)) this.quitPress();
      else {
        this.paused = false;
        this.quitArmT = 0;
        CB.Audio.play('uiSelect');
      }
    },

    // The patch pick's focus: a pad starts on the middle card, nav edges move it, and the pointer (a move, a tap) takes over again.
    // On a phone a card is only ever "hovered" by this tick's tap.
    pickInput(inp, entering, device) {
      const ui = this.ui;
      const P = CB.Screens.patchPick;
      const cardAt = P && typeof P.cardAt === 'function' ? P.cardAt : () => -1;
      const last = clamp((this.run.offer ? this.run.offer.length : 3) - 1, 0, 2);
      const moved = inp.aimX !== this.aimSeenX || inp.aimY !== this.aimSeenY;
      if (entering) {
        ui.nav = device === 'pad';
        ui.focus = Math.min(1, last);
      } else if (moved || inp.tap) ui.nav = false;
      const nav = dirOf(inp.navX);
      if (nav) {
        ui.nav = true;
        ui.focus = clamp((ui.focus | 0) + nav, 0, last);
      }
      if (device === 'touch') ui.hover = inp.tap ? cardAt(inp.aimX, inp.aimY) : -1;
      else ui.hover = ui.nav ? ui.focus : cardAt(inp.aimX, inp.aimY);
      if (inp.confirm && ui.hover >= 0) this.run.choosePatch(ui.hover);
    },

    update(dt, inp) {
      const run = this.run;
      const game = this.game;
      // The touch layer follows the screen: taps in menus, sticks in a fight. First, before any early return or leave().
      if (game.input && typeof game.input.setTouchMode === 'function') game.input.setTouchMode(this.pointerState() ? 'menu' : 'sticks');
      if (Array.isArray(inp.keys) && inp.keys.includes('KeyV')) this.toggleCalm();
      if (inp.music && CB.Music) CB.Music.toggle();
      if (inp.pause && (this.paused || CB.RUN_COMBAT_STATES[run.state])) {
        this.paused = !this.paused;
        this.quitArmT = 0;
        if (this.paused) this.resetPauseUi();
        CB.Audio.play('uiSelect');
      }
      if (this.paused) {
        if (CB.Music && CB.Music.update) CB.Music.update(run, true);
        if (this.quitArmT > 0) this.quitArmT = Math.max(0, this.quitArmT - dt);
        if (inp.quit && this.quitPress()) return;
        this.pauseInput(inp);
        return;
      }
      const inPick = run.state === 'patchPick';
      const entering = inPick && this.stateSeen !== 'patchPick';
      if (inPick) this.pickInput(inp, entering, this.device());
      else {
        this.ui.hover = -1;
        this.ui.nav = false;
      }
      this.stateSeen = run.state;
      this.aimSeenX = inp.aimX;
      this.aimSeenY = inp.aimY;
      if (run.state === 'dead' && run.stateT >= CB.RUN_T.inputLock) {
        // A tap on the quit line leaves here, before the step: the same tap would otherwise retry.
        const G = CB.Screens.gameOver;
        if (inp.quit || (inp.tap && inBox(G && G.QUIT_BOX, inp.aimX, inp.aimY))) {
          this.leave();
          return;
        }
      }
      this.recordDaily();
      if (run.state === 'victory' && run.stateT > VICTORY_INPUT_AT) {
        // The share button keeps the player on the receipt (its own click or tap is also a confirm); any other confirm plays again.
        if (this.wantsShare(inp)) this.share();
        else if (inp.confirm) {
          this.leave();
          return;
        }
      }
      if (this.toasts.length) {
        this.toasts[0].t -= dt; // frozen while paused (the pause branch returned above)
        if (this.toasts[0].t <= 0) this.toasts.shift();
      }
      const n = (game.debug && game.debug.speed) || 1;
      for (let i = 0; i < n; i++) {
        const evs = this.trackUnlocks(run.step(i === 0 ? inp : Object.assign({}, inp, EDGE_OFF)));
        CB.Audio.handleEvents(evs);
        if (CB.Haptics && typeof CB.Haptics.handleEvents === 'function') CB.Haptics.handleEvents(evs, game.input);
        this.celebrate(evs);
        if (CB.Hints && typeof CB.Hints.onEvents === 'function') CB.Hints.onEvents(evs, run, game); // first-run tips: they read the step, they never change it
      }
      this.recordDaily(); // the step that ended the run
      if (run.attempt !== this.attemptSeen) {
        // The step (or a caller outside update) retried the stage: wipe to the new attempt.
        this.attemptSeen = run.attempt;
        if (CB.Transition && CB.Transition.start) CB.Transition.start(RETRY_LABEL);
      }
      if (CB.Music && CB.Music.update) CB.Music.update(run, false);
    },

    // Gold text on a dark band near the bottom edge, over the overlays.
    drawToast(r) {
      const tt = this.toasts[0];
      const a = Math.min(1, tt.t / TOAST_FADE);
      r.alpha(a * 0.85, () => r.rect(0, TOAST_Y - 2, CB.W, 11, CB.Pal.C.ink));
      r.alpha(a, () => r.text(tt.text, CB.W / 2, TOAST_Y, { color: CB.Pal.C.gold, align: 'center' }));
    },

    // The world's flash: a tint over the whole screen, or (calm mode) two nested 1 px frames at its edge.
    drawFlash(r, w) {
      const f = CB.Comfort && CB.Comfort.flash ? CB.Comfort.flash(w) : { alpha: Math.min(0.35, w.flash * 2), frame: 0 };
      const color = w.flashColor || CB.Pal.C.hurt;
      if (f.alpha > 0) r.alpha(f.alpha, () => r.rect(0, 0, CB.W, CB.H, color));
      if (f.frame > 0) {
        r.alpha(f.frame, () => {
          r.frame(0, 0, CB.W, CB.H, color);
          r.frame(1, 1, CB.W - 2, CB.H - 2, color);
        });
      }
    },

    // The on-screen sticks and buttons (touch only): the /compact button fills with the meter and glows when a cast is available,
    // the dash button dims while the dash cools down.
    drawTouch(r, w, t) {
      const input = this.game.input;
      const view = input && typeof input.touchView === 'function' ? input.touchView() : null;
      if (!view || !CB.Touch || typeof CB.Touch.draw !== 'function') return;
      const c = w.context;
      const ready = CB.Compact && typeof CB.Compact.ready === 'function' ? CB.Compact.ready(w) : c.value >= c.max;
      CB.Touch.draw(r, view, t, { compactFrac: c.max > 0 ? clamp(c.value / c.max, 0, 1) : 0, compactReady: ready, dashReady: w.player.dashCd <= 1e-9 });
    },

    draw(r, t) {
      const run = this.run;
      const w = run.world;
      const live = !this.paused;
      const shake = live ? (CB.Comfort && CB.Comfort.shake ? CB.Comfort.shake(w) : w.shake) : 0; // a paused frame is still: no shake, no flash; calm mode never shakes
      const sx = shake > 0 ? Math.round(Math.sin(t * 91) * shake) : 0;
      const sy = shake > 0 ? Math.round(Math.cos(t * 77) * shake) : 0;
      const hitboxes = !!(this.game.debug && this.game.debug.hitboxes);
      r.clear('#000000'); // the shaken world leaves an uncovered strip at the edge
      const noBubble = this.paused || !BUBBLE_STATES[run.state]; // the idle bubble would collide with card text
      r.shaken(sx, sy, () => CB.WorldDraw.draw(r, w, t, { hitboxes, noBubble }));
      if (live && w.flash > 0) this.drawFlash(r, w);
      CB.Screens.hud.draw(r, run, t);
      if (live && CB.Hints && typeof CB.Hints.draw === 'function') CB.Hints.draw(r, t, run); // under the overlays; a paused frame shows none
      const device = this.device();
      const pointer = this.pointerState();
      if (device === 'touch' && !pointer) this.drawTouch(r, w, t);
      const ov = OVERLAY[run.state];
      if (ov) CB.Screens[ov].draw(r, run, t, this.ui);
      if (this.toasts.length) this.drawToast(r);
      if (this.paused) {
        this.ui.quitArmT = this.quitArmT;
        const m = this.game.input.peekAim(); // the mouse lights the chip or quit button under it (screens.js ignores it off kbm)
        this.ui.aimX = m.x;
        this.ui.aimY = m.y;
        CB.Screens.pause.draw(r, run, t, this.ui);
      }
      if (device === 'kbm') {
        const a = this.game.input.peekAim();
        CB.Screens.hud.cursor(r, a.x, a.y, pointer ? 'pointer' : 'cross', t);
      } else if (!pointer && !w.player.dead) {
        CB.Screens.hud.cursor(r, w.player.aimX, w.player.aimY, 'cross', t); // a stick has no pointer: the crosshair rides the aim point
      }
    },
  };
})(window.CB);
