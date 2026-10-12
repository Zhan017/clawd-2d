// Patch (upgrade) definitions, stat computation and offer generation.
(function (CB) {
  'use strict';
  const DEFS = {
    spread: { name: 'Spread Shot', max: 2, desc: '+2 angled sparks' },
    rapid: { name: 'Rapid Fire', max: 2, desc: 'Fire 25% faster' },
    pierce: { name: 'Pierce', max: 2, desc: 'Sparks pass through +1 bug, +15% damage' },
    heavy: { name: 'Heavy Bolts', max: 2, desc: '+35% damage, bigger sparks' },
    heart: { name: 'Extra Heart', max: 2, desc: '+1 max heart' },
    dash: { name: 'Quick Dash', max: 1, desc: 'Dash recharges in 0.45 s' },
    ricochet: { name: 'Ricochet', max: 1, desc: 'Sparks bounce off walls once' },
  };
  const ORDER = ['spread', 'rapid', 'pierce', 'heavy', 'heart', 'dash', 'ricochet'];
  const BASE = Object.freeze({ fireCooldown: 0.2, boltSpeed: 200, boltR: 2, dmg: 1, spread: 0, pierce: 0, bounces: 0, dashCooldown: 0.8, maxHearts: 5 });

  function count(counts, id) {
    return Math.min((counts && counts[id]) | 0, DEFS[id].max);
  }

  CB.Patches = {
    DEFS,
    ORDER,
    BASE,
    computeStats(counts) {
      const c = (id) => count(counts, id);
      return {
        fireCooldown: BASE.fireCooldown * Math.pow(0.8, c('rapid')),
        boltSpeed: BASE.boltSpeed,
        boltR: BASE.boltR + c('heavy'),
        dmg: BASE.dmg + 0.35 * c('heavy') + 0.15 * c('pierce'),
        spread: c('spread'),
        pierce: c('pierce'),
        bounces: c('ricochet'),
        dashCooldown: c('dash') ? 0.45 : BASE.dashCooldown,
        maxHearts: BASE.maxHearts + c('heart'),
      };
    },
    offer(rng, counts, n) {
      const avail = ORDER.filter((id) => ((counts && counts[id]) | 0) < DEFS[id].max);
      return rng.shuffle(avail).slice(0, n == null ? 3 : n);
    },
    apply(counts, id) {
      if (!DEFS[id]) throw new Error('unknown patch: ' + id);
      const cur = (counts && counts[id]) | 0;
      if (cur >= DEFS[id].max) throw new Error(`patch ${id} already at max (${DEFS[id].max})`);
      const next = Object.assign({}, counts);
      next[id] = cur + 1;
      return next;
    },
  };
})(window.CB);
