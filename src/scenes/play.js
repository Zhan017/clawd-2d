// Play scene: routes input to the run, handles pause/quit and patch clicks, layers world + HUD + overlays.
(function (CB) {
  'use strict';
  const EDGE_OFF = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] };
  const QUIT_ARM = 2.0; // seconds the second Q is accepted after the first one, while paused
  const TOAST_T = 2.5; // seconds the "NEW HAT" toast stays up
  const TOAST_FADE = 0.4; // ... and it fades out over the last of them
  const TOAST_Y = 168; // top of the toast text (the dark band sits around it)
  const OVERLAY = {
    stageIntro: 'stageIntro', wave: 'waveBanner', waveBreak: 'waveBanner', bossWarn: 'bossWarn',
    bossDead: 'bossDead', patchPick: 'patchPick', dead: 'gameOver', victory: 'victory',
  };

  CB.Scenes.play = {
    game: null,
    run: null,
    paused: false,
    quitArmT: 0, // >0 after the first Q on the pause screen; the pause screen reads it for the "Q again" prompt
    toast: null, // { text, t } while an unlock toast is up
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
      }
      this.paused = false;
      this.quitArmT = 0;
      this.toast = null;
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

    // Runs the unlock rules on one step's events: a hat earns a toast, and any unlock chimes (once per step) through the audio handler.
    // Returns the events the audio handler should see.
    trackUnlocks(evs) {
      const fresh = CB.Unlocks ? CB.Unlocks.onEvents(evs, this.run) : [];
      if (!fresh || !fresh.length) return evs;
      for (const id of fresh) {
        const hat = (CB.HATS || []).find((h) => h.id === id);
        if (hat) this.toast = { text: 'NEW HAT: ' + hat.name, t: TOAST_T };
      }
      return evs.concat([{ type: 'unlock' }]);
    },

    update(dt, inp) {
      const run = this.run;
      const game = this.game;
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
      if (this.toast) {
        this.toast.t -= dt; // frozen while paused (the pause branch returned above)
        if (this.toast.t <= 0) this.toast = null;
      }
      const n = (game.debug && game.debug.speed) || 1;
      for (let i = 0; i < n; i++) CB.Audio.handleEvents(this.trackUnlocks(run.step(i === 0 ? inp : Object.assign({}, inp, EDGE_OFF))));
      if (CB.Music && CB.Music.update) CB.Music.update(run, false);
    },

    // Gold text on a dark band near the bottom edge, over the overlays.
    drawToast(r) {
      const tt = this.toast;
      const a = Math.min(1, tt.t / TOAST_FADE);
      r.alpha(a * 0.85, () => r.rect(0, TOAST_Y - 3, CB.W, 13, CB.Pal.C.ink));
      r.alpha(a, () => r.text(tt.text, CB.W / 2, TOAST_Y, { color: CB.Pal.C.gold, align: 'center' }));
    },

    draw(r, t) {
      const run = this.run;
      const w = run.world;
      const live = !this.paused;
      const shake = live ? w.shake : 0; // a paused frame is still: no shake, no flash
      const sx = shake > 0 ? Math.round(Math.sin(t * 91) * shake) : 0;
      const sy = shake > 0 ? Math.round(Math.cos(t * 77) * shake) : 0;
      const hitboxes = !!(this.game.debug && this.game.debug.hitboxes);
      r.clear('#000000'); // the shaken world leaves an uncovered strip at the edge
      r.shaken(sx, sy, () => CB.WorldDraw.draw(r, w, t, { hitboxes }));
      if (live && w.flash > 0) r.alpha(Math.min(0.35, w.flash * 2), () => r.rect(0, 0, CB.W, CB.H, w.flashColor || CB.Pal.C.hurt));
      CB.Screens.hud.draw(r, run, t);
      const ov = OVERLAY[run.state];
      if (ov) CB.Screens[ov].draw(r, run, t, this.ui);
      if (this.toast) this.drawToast(r);
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
