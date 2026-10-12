// Seeded mulberry32 RNG. All game logic randomness goes through one of these.
(function (CB) {
  'use strict';
  CB.createRng = function (seed) {
    let s = seed >>> 0 || 0x6d2b79f5;
    const rng = {
      next() {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: (a, b) => a + (b - a) * rng.next(),
      int: (a, b) => a + Math.floor(rng.next() * (b - a + 1)),
      chance: (p) => rng.next() < p,
      pick: (arr) => arr[Math.floor(rng.next() * arr.length)],
      angle: () => rng.next() * Math.PI * 2,
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(rng.next() * (i + 1));
          const tmp = a[i];
          a[i] = a[j];
          a[j] = tmp;
        }
        return a;
      },
    };
    return rng;
  };
})(window.CB);
