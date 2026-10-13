// Haptics: picks the strongest game event of a step and rumbles for it (pad rumble or phone vibration via the sink). Calm mode switches it off.
(function (CB) {
  'use strict';
  const OWN = Object.prototype.hasOwnProperty;

  // strong / weak: dual-rumble motor magnitudes 0..1. ms: rumble length. vib: navigator.vibrate pattern. pri: higher wins within one step.
  const EFFECTS = {
    playerHurt: { strong: 0.8, weak: 0.4, ms: 160, vib: 40, pri: 2 },
    playerDie: { strong: 1.0, weak: 1.0, ms: 400, vib: [60, 40, 120], pri: 3 },
    bossPhase: { strong: 0.6, weak: 0.6, ms: 250, vib: 50, pri: 2 },
    bossDie: { strong: 1.0, weak: 0.7, ms: 600, vib: [80, 50, 80, 50, 160], pri: 3 },
    compact: { strong: 0.3, weak: 0.9, ms: 300, vib: 30, pri: 1 },
    pickup: { strong: 0.0, weak: 0.3, ms: 80, vib: 15, pri: 0 },
  };
  for (const k of Object.keys(EFFECTS)) {
    if (Array.isArray(EFFECTS[k].vib)) Object.freeze(EFFECTS[k].vib);
    Object.freeze(EFFECTS[k]);
  }
  Object.freeze(EFFECTS);

  const calm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  const Haptics = {
    EFFECTS,

    // Plays the one highest-priority effect among `evs` (the first of equals) through sink.rumble(strong, weak, ms, vib).
    // Returns its name, or null when nothing played: no sink, calm mode, nothing mapped, or the sink threw.
    handleEvents(evs, sink) {
      if (!sink || typeof sink.rumble !== 'function' || !Array.isArray(evs)) return null;
      if (calm()) return null;
      let best = null;
      for (const e of evs) {
        const name = e && typeof e.type === 'string' && OWN.call(EFFECTS, e.type) ? e.type : null;
        if (name && (best === null || EFFECTS[name].pri > EFFECTS[best].pri)) best = name;
      }
      if (best === null) return null;
      const fx = EFFECTS[best];
      try {
        sink.rumble(fx.strong, fx.weak, fx.ms, Array.isArray(fx.vib) ? fx.vib.slice() : fx.vib);
      } catch (err) {
        return null; // a failing motor must never stop the game
      }
      return best;
    },
  };
  CB.Haptics = Haptics;
})(window.CB);
