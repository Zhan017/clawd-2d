// Calm mode: one saved switch (default from prefers-reduced-motion) that slows blinks and drops shake and full-screen flashes. Optional module: every caller guards `if (CB.Comfort)`.
(function (CB) {
  'use strict';
  const BLINK_CALM_MAX = 4; // Hz: calm mode never blinks faster than this
  const FLASH_ALPHA_MAX = 0.35; // the full-screen flash
  const FRAME_ALPHA_MAX = 0.5; // the calm replacement: two 1 px frames at the screen edge

  let session = null; // the choice kept for the session when CB.Save is missing

  // The saved flag is a boolean; anything else (nothing saved, or junk in storage) means "no choice yet".
  function saved() {
    const v = CB.Save && CB.Save.get ? CB.Save.get('calm', null) : session;
    return v === true || v === false ? v : null;
  }

  // The OS "reduce motion" preference. matchMedia can be missing or throw (old browsers, sandboxes, tests).
  // The MediaQueryList is live, so it is made once: blink() runs per bullet per frame and must stay cheap.
  let query = null;
  function prefersReducedMotion() {
    try {
      if (!query && typeof window.matchMedia === 'function') query = window.matchMedia('(prefers-reduced-motion: reduce)');
      return !!(query && query.matches);
    } catch (e) {
      return false;
    }
  }

  const Comfort = {
    // True in calm mode: the saved choice if there is one, else the OS preference.
    calm() {
      const s = saved();
      return s === null ? prefersReducedMotion() : s;
    },

    set(b) {
      const v = !!b;
      if (CB.Save && CB.Save.set) CB.Save.set('calm', v);
      else session = v;
    },

    // Flips calm mode and returns the new state.
    toggle() {
      const next = !Comfort.calm();
      Comfort.set(next);
      return next;
    },

    // True on the "on" half of a blink at `hz` flips a second; calm mode caps the rate at 4 Hz.
    blink(t, hz) {
      return Math.floor(t * (Comfort.calm() ? Math.min(hz, BLINK_CALM_MAX) : hz)) % 2 === 0;
    },

    // The shake to draw with: none when calm. The sim value (w.shake) is never touched.
    shake(w) {
      return Comfort.calm() ? 0 : w.shake;
    },

    // How to show the world's flash: a full-screen tint normally, or only a frame at the screen edge when calm.
    flash(w) {
      if (Comfort.calm()) return { alpha: 0, frame: Math.min(FRAME_ALPHA_MAX, w.flash * 3) };
      return { alpha: Math.min(FLASH_ALPHA_MAX, w.flash * 2), frame: 0 };
    },
  };
  CB.Comfort = Comfort;
})(window.CB);
