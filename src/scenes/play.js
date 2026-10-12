// Play scene: routes input to the run, handles pause/quit and patch clicks, layers world + HUD + overlays.
(function (CB) {
  'use strict';
  const EDGE_OFF = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] };
  const QUIT_ARM = 2.0; // seconds the second Q is accepted after the first one, while paused
  const TOAST_T = 2.5; // seconds a "NEW HAT" toast stays up
  const TOAST_MODES_T = 4.0; // ... and the "modes unlocked" one
  const TOAST_CALM_T = 1.5; // ... and the "calm mode: on/off" one
  const TOAST_FADE = 0.4; // a toast fades out over its last seconds
  const MODES_TEXT = 'UNLOCKED: boss rush + --yolo on the title';
  const RETRY_LABEL = '$ git reset --hard HEAD'; // typed by the transition after a retry
  const TOAST_Y = 171; // top of the toast text; its band (y 169-180) clears the victory prompt at y 160-166
  const BUBBLE_STATES = { wave: true, waveBreak: true, boss: true }; // states without a centred card, where Clawd may 'think'
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

  CB.Scenes.play = {
    game: null,
    run: null,
    paused: false,
    quitArmT: 0, // >0 after the first Q on the pause screen; the pause screen reads it for the "Q again" prompt
    toasts: [], // queue of { text, t }: only the first is shown and counts down, the next one starts after it
    attemptSeen: 0, // run.attempt as of the last update: a change means a retry happened, which starts the transition
    ui: { hover: -1 },

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
    },

    // Leaving the run for the title: the music stops with it.
    // Music is optional (and tests stub only part of it), so each call is guarded on the method itself.
    leave() {
      if (CB.Music && CB.Music.stop) CB.Music.stop();
      this.game.go('title');
    },

    onBlur() {
      if (this.run && CB.RUN_COMBAT_STATES[this.run.state]) this.paused = true;
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

    update(dt, inp) {
      const run = this.run;
      const game = this.game;
      if (Array.isArray(inp.keys) && inp.keys.includes('KeyV')) this.toggleCalm();
      if (inp.music && CB.Music) CB.Music.toggle();
      if (inp.pause && (this.paused || CB.RUN_COMBAT_STATES[run.state])) {
        this.paused = !this.paused;
        this.quitArmT = 0;
        CB.Audio.play('uiSelect');
      }
      if (this.paused) {
        if (CB.Music && CB.Music.update) CB.Music.update(run, true);
        if (this.quitArmT > 0) this.quitArmT = Math.max(0, this.quitArmT - dt);
        if (inp.quit) {
          // Two-step quit: a stray Q must not throw away the run.
          if (this.quitArmT > 0) this.leave();
          else this.quitArmT = QUIT_ARM;
        }
        return;
      }
      this.ui.hover = run.state === 'patchPick' ? CB.Screens.patchPick.cardAt(inp.aimX, inp.aimY) : -1;
      if (run.state === 'patchPick' && inp.confirm && this.ui.hover >= 0) run.choosePatch(this.ui.hover);
      if (run.state === 'dead' && inp.quit && run.stateT >= CB.RUN_T.inputLock) {
        this.leave();
        return;
      }
      if (run.state === 'victory' && run.stateT > 1.5 && inp.confirm) {
        this.leave();
        return;
      }
      if (this.toasts.length) {
        this.toasts[0].t -= dt; // frozen while paused (the pause branch returned above)
        if (this.toasts[0].t <= 0) this.toasts.shift();
      }
      const n = (game.debug && game.debug.speed) || 1;
      for (let i = 0; i < n; i++) {
        const evs = this.trackUnlocks(run.step(i === 0 ? inp : Object.assign({}, inp, EDGE_OFF)));
        CB.Audio.handleEvents(evs);
        this.celebrate(evs);
      }
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
      const ov = OVERLAY[run.state];
      if (ov) CB.Screens[ov].draw(r, run, t, this.ui);
      if (this.toasts.length) this.drawToast(r);
      if (this.paused) {
        this.ui.quitArmT = this.quitArmT;
        CB.Screens.pause.draw(r, run, t, this.ui);
      }
      const a = this.game.input.peekAim();
      const pointer = this.paused || run.state === 'patchPick' || run.state === 'dead' || run.state === 'victory';
      CB.Screens.hud.cursor(r, a.x, a.y, pointer ? 'pointer' : 'cross', t);
    },
  };
})(window.CB);
