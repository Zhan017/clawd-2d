// On-screen prompt strings per input device (keyboard + mouse, touch, controller). Optional module: callers guard `if (CB.Prompts)`.
(function (CB) {
  'use strict';
  const OWN = Object.prototype.hasOwnProperty;
  const isDevice = (d) => d === 'kbm' || d === 'pad' || d === 'touch';

  // Every string must fit the 312 px text column at scale 1 (tests/prompts.test.js measures them with CB.Font).
  // The kbm column is the text the game has always shown; it never changes.
  const TABLE = {
    start: { kbm: 'Click to start', touch: 'Tap to start', pad: 'Press A to start' },
    again: { kbm: 'Click to play again', touch: 'Tap to play again', pad: 'Press A to play again' },
    retryKey: { kbm: 'R / click', touch: 'Tap', pad: 'A' },
    quitDead: { kbm: 'Q: quit to title', touch: '[ quit to title ]', pad: 'Back: quit to title' },
    pauseLine: { kbm: 'Esc: resume · Q: quit to title', touch: 'Tap: resume', pad: 'Start: resume · Back: quit to title' },
    quitArm: { kbm: 'Press Q again to quit', touch: 'Tap quit again to quit', pad: 'Press Back again to quit' },
    legend1: {
      kbm: 'WASD move · Mouse aim · Click shoot · Space dash',
      touch: 'Left thumb: move · Right thumb: aim + shoot',
      pad: 'L-stick move · R-stick aim + shoot · A dash',
    },
    legend2: {
      kbm: 'E /compact · N music · M mute · V calm · Esc pause',
      touch: 'DASH and /compact buttons · II pause',
      pad: 'RB /compact · Start pause · RT shoot',
    },
    pauseLegend1: {
      kbm: 'WASD move · Mouse aim · Click shoot',
      touch: 'Left thumb: move · Right thumb: aim + shoot',
      pad: 'L-stick move · R-stick aim + shoot',
    },
    pauseLegend2: {
      kbm: 'Space dash · E /compact (meter full)',
      touch: 'DASH · /compact (meter full)',
      pad: 'A/LB dash · RB/B /compact (meter full)',
    },
    hat: { kbm: '(Q/E)', touch: '(tap)', pad: '(LB/RB)' },
    reload: { kbm: 'Press R to reload', touch: 'Tap to reload', pad: 'Press R to reload' },
    // The victory screen's share button and the toasts that answer it (the result goes to the share sheet on a phone, the clipboard elsewhere).
    share: { kbm: '[ copy result ] (C)', touch: '[ share result ]', pad: '[ X: copy result ]' },
    shareDone: { kbm: 'result copied ✓', touch: 'shared ✓', pad: 'result copied ✓' },
    shareFail: { kbm: "couldn't copy", touch: "couldn't copy", pad: "couldn't copy" },
  };
  for (const k of Object.keys(TABLE)) Object.freeze(TABLE[k]);
  Object.freeze(TABLE);

  const Prompts = {
    device: 'kbm', // the last device used; input.js keeps it in sync

    // Anything but a known device is ignored, so a bad value can never blank the prompts.
    setDevice(d) {
      if (isDevice(d)) Prompts.device = d;
    },

    // The device to start on: a phone (coarse pointer, no fine pointer anywhere) starts on touch. matchMedia can be missing or throw.
    detect(win) {
      try {
        const coarse = win.matchMedia('(pointer: coarse)');
        if (!coarse || !coarse.matches) return 'kbm';
        const fine = win.matchMedia('(any-pointer: fine)');
        return fine && fine.matches ? 'kbm' : 'touch';
      } catch (e) {
        return 'kbm';
      }
    },

    // The string for `key` on `device` (default: the current one); '' for a key that does not exist.
    text(key, device) {
      if (typeof key !== 'string' || !OWN.call(TABLE, key)) return '';
      return TABLE[key][isDevice(device) ? device : Prompts.device];
    },

    TABLE,
  };
  CB.Prompts = Prompts;
})(window.CB);
