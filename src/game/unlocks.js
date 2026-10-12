// Cosmetic unlocks: localStorage-safe save, hats, the unlock rules and the secret-code matcher. Optional module: every caller guards `if (CB.Unlocks)`.
(function (CB) {
  'use strict';

  // JSON in localStorage under 'cb.' + key. localStorage is looked up on every access (it can throw or vanish at any time),
  // and _mem is a write-through cache, so everything keeps working for the session when storage is blocked.
  const Save = {
    _mem: {},

    get(key, def) {
      const mem = Save._mem;
      if (Object.prototype.hasOwnProperty.call(mem, key)) return mem[key];
      try {
        const raw = window.localStorage.getItem('cb.' + key);
        if (raw !== null && raw !== undefined) {
          const v = JSON.parse(raw);
          mem[key] = v;
          return v;
        }
      } catch (e) {
        // storage blocked or the stored text is not JSON: fall back to the default
      }
      return def;
    },

    set(key, value) {
      Save._mem[key] = value;
      try {
        window.localStorage.setItem('cb.' + key, JSON.stringify(value));
      } catch (e) {
        // blocked or full: the in-memory copy still serves this session
      }
    },
  };

  // `from` is what earns the hat: a boss id, 'victory', 'yoloVictory' or a secret code name.
  const HATS = [
    { id: 'loopcap', name: 'Loop cap', from: 'infiniteLoop' },
    { id: 'slime', name: 'Slime hat', from: 'memoryLeakBoss' },
    { id: 'branch', name: 'Branch beanie', from: 'mergeConflict' },
    { id: 'shades', name: 'Shades', from: 'heisenbug' },
    { id: 'crown', name: 'Crown', from: 'victory' },
    { id: 'sudo', name: 'sudo hat', from: 'yoloVictory' },
    { id: 'halo', name: 'Halo', from: 'konami' },
  ];

  // Unlocked ids live in one array under 'unlocks' (hats plus the flags 'modes' and 'rainbow'); the worn hat under 'hat'.
  // Storage can hold anything, so reads are validated and writes always replace the array.
  function ids() {
    const v = Save.get('unlocks', []);
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
  }

  const Unlocks = {
    has(id) {
      return ids().indexOf(id) >= 0;
    },

    // True only the first time.
    unlock(id) {
      if (typeof id !== 'string' || !id) return false;
      const list = ids();
      if (list.indexOf(id) >= 0) return false;
      list.push(id);
      Save.set('unlocks', list);
      return true;
    },

    list() {
      return ids();
    },

    // Unlocked hat ids, in HATS order.
    hats() {
      const have = ids();
      return HATS.filter((h) => have.indexOf(h.id) >= 0).map((h) => h.id);
    },

    // The worn hat, or null (also null when the saved id is not an unlocked hat).
    hat() {
      const id = Save.get('hat', null);
      return typeof id === 'string' && Unlocks.hats().indexOf(id) >= 0 ? id : null;
    },

    // null takes the hat off; an id that is not unlocked is ignored.
    setHat(id) {
      if (id === null || id === undefined) Save.set('hat', null);
      else if (Unlocks.hats().indexOf(id) >= 0) Save.set('hat', id);
    },

    // Steps through [none, ...unlocked hats], wrapping; returns the new hat id or null.
    cycleHat(dir) {
      const order = [null].concat(Unlocks.hats());
      const i = Math.max(0, order.indexOf(Unlocks.hat()));
      const next = order[(i + (dir < 0 ? -1 : 1) + order.length) % order.length];
      Unlocks.setHat(next);
      return next;
    },

    // Run events -> ids unlocked for the first time by them.
    onEvents(events, run) {
      const fresh = [];
      const unlock = (id) => {
        if (Unlocks.unlock(id)) fresh.push(id);
      };
      const earn = (from) => {
        for (const h of HATS) if (h.from === from) unlock(h.id);
      };
      if (!events || !events.length) return fresh;
      for (const e of events) {
        if (!e) continue;
        if (e.type === 'bossDie') {
          const stage = CB.STAGES && run ? CB.STAGES[run.stageIndex] : null; // stages.js loads after this file
          if (stage) earn(stage.boss);
        } else if (e.type === 'victory') {
          earn('victory');
          unlock('modes'); // Boss Rush and YOLO appear on the title
          if (run && run.yolo) earn('yoloVictory');
        }
      }
      return fresh;
    },
  };

  // Secret codes are KeyboardEvent.code lists. The matcher keeps the last SECRET_BUFFER codes and matches by suffix,
  // so the sequence can start mid-stream; a match empties the buffer so it fires once per completed sequence.
  // 'konami' earns the halo; 'ultrathink' earns the rainbow sparks (the title scene acts on the returned name).
  const SECRET_BUFFER = 12;
  const CODES = {
    konami: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'],
    ultrathink: ['KeyU', 'KeyL', 'KeyT', 'KeyR', 'KeyA', 'KeyT', 'KeyH', 'KeyI', 'KeyN', 'KeyK'],
  };

  const Secrets = {
    CODES,

    create() {
      const buf = [];
      return {
        feed(code) {
          buf.push(code);
          if (buf.length > SECRET_BUFFER) buf.shift();
          for (const name of Object.keys(CODES)) {
            const seq = CODES[name];
            const off = buf.length - seq.length;
            if (off >= 0 && seq.every((c, i) => buf[off + i] === c)) {
              buf.length = 0;
              return name;
            }
          }
          return null;
        },
      };
    },
  };

  CB.Save = Save;
  CB.HATS = HATS;
  CB.Unlocks = Unlocks;
  CB.Secrets = Secrets;
})(window.CB);
