// Daily build: one seeded run per UTC day, the same patch offers for everyone, and today's best result. Optional module: callers guard `if (CB.Daily)`.
(function (CB) {
  'use strict';

  const STORE_KEY = 'cb.daily';
  const KEEP = 30; // dates kept in storage, newest first
  const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  // FNV-1a, 32 bit, over the string's UTF-16 code units (the daily keys are ASCII, where that is the byte hash).
  function hash32(str) {
    const s = String(str);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  const pad = (n, w) => String(n).padStart(w, '0');

  // ---- storage ----------------------------------------------------------------------------------------------------------------
  // { 'YYYY-MM-DD': { time, deaths, yolo } } under one localStorage key. localStorage is looked up on every access (it can throw or
  // vanish at any time) and `mem` is a write-through copy, so a blocked or full store still serves the session. Storage can hold
  // anything, so every entry read back is validated.
  let mem = null;
  let seen = null; // the storage text last folded into `mem`, so a store nobody changed costs no parse (the title asks every frame)

  function clean(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const k of Object.keys(raw)) {
      const e = raw[k];
      if (!KEY_RE.test(k) || !e || typeof e !== 'object') continue;
      if (!(Number.isFinite(e.time) && e.time >= 0 && Number.isFinite(e.deaths) && e.deaths >= 0)) continue;
      out[k] = { time: e.time, deaths: Math.floor(e.deaths), yolo: !!e.yolo };
    }
    return out;
  }

  // Fewer deaths win, then the faster clear; a tie keeps what is saved.
  const better = (a, b) => a.deaths < b.deaths || (a.deaths === b.deaths && a.time < b.time);

  // `mem` with what storage holds right now folded in: another tab may have saved since this page last looked, so per date the better
  // entry wins, and an entry only in memory stays (storage that is blocked, unreadable or wiped never loses a result).
  function table() {
    if (!mem) mem = {};
    let text = null;
    try {
      text = window.localStorage.getItem(STORE_KEY);
    } catch (e) {
      // blocked: memory alone serves
    }
    if (text && text !== seen) {
      seen = text;
      let raw = null;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        // not JSON: nothing to fold in
      }
      const fresh = clean(raw);
      for (const k of Object.keys(fresh)) if (!mem[k] || better(fresh[k], mem[k])) mem[k] = fresh[k];
    }
    return mem;
  }

  const Daily = {
    hash32,

    // 'YYYY-MM-DD' in UTC. Anything but a valid date (or a time value) reads as now.
    dateKey(date) {
      let d = date && typeof date.getUTCFullYear === 'function' ? date : date == null ? new Date() : new Date(date);
      if (!Number.isFinite(d.getTime())) d = new Date();
      return pad(d.getUTCFullYear(), 4) + '-' + pad(d.getUTCMonth() + 1, 2) + '-' + pad(d.getUTCDate(), 2);
    },

    today() {
      return Daily.dateKey(new Date());
    },

    // Never 0: createRun reads a 0 seed as "missing" and the rng treats it as unset.
    seedFor(key) {
      return hash32('clawd-daily:' + key) || 1;
    },

    // The patch the day starts with: a deterministic pick from the patch list; null when there is no patch module.
    patchFor(key) {
      const order = CB.Patches && CB.Patches.ORDER;
      if (!Array.isArray(order) || !order.length) return null;
      return order[Daily.seedFor(key) % order.length];
    },

    // Keeps the best clear per date (fewest deaths, then fastest), against a fresh read of storage so another tab's better clear is never
    // overwritten; ignores a key or a result that is not usable.
    record(key, res) {
      if (typeof key !== 'string' || !KEY_RE.test(key) || !res || !Number.isFinite(res.time) || res.time < 0) return;
      const t = table();
      const entry = { time: res.time, deaths: Math.max(0, Math.floor(Number(res.deaths) || 0)), yolo: !!res.yolo };
      if (t[key] && !better(entry, t[key])) return;
      t[key] = entry;
      for (const old of Object.keys(t).sort().slice(0, -KEEP)) delete t[old];
      try {
        const text = JSON.stringify(t);
        window.localStorage.setItem(STORE_KEY, text);
        seen = text;
      } catch (e) {
        // blocked or full: the in-memory copy still serves this session
      }
    },

    // The saved best for that date (this tab's or another's), or null.
    result(key) {
      const e = typeof key === 'string' && KEY_RE.test(key) ? table()[key] : null;
      return e ? { time: e.time, deaths: e.deaths, yolo: e.yolo } : null;
    },
  };

  CB.Daily = Daily;
})(window.CB);
