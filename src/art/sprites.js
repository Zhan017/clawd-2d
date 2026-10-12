// Sprite registry: sprites are arrays of equal-length strings, one palette char per pixel.
// defineSprite validates immediately (headless-safe); sprite() bakes canvases lazily (browser only).
(function (CB) {
  'use strict';
  const defs = Object.create(null);
  const baked = Object.create(null);

  function defineSprite(name, rows, pal) {
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`sprite ${name}: rows must be a non-empty array`);
    const w = rows[0].length;
    const p = pal || CB.Pal.CHARS;
    for (const row of rows) {
      if (row.length !== w) throw new Error(`sprite ${name}: ragged row "${row}" (expected width ${w})`);
      for (const ch of row) if (!(ch in p)) throw new Error(`sprite ${name}: unknown palette char "${ch}"`);
    }
    defs[name] = { name, rows, w, h: rows.length, pal: p };
    delete baked[name];
  }

  // A same-shape sprite with every visible pixel drawn in one colour ('.' stays transparent).
  function defineTint(name, srcName, color) {
    const src = defs[srcName];
    if (!src) throw new Error(`sprite ${name}: unknown source sprite ${srcName}`);
    const pal = {};
    for (const ch of Object.keys(src.pal)) pal[ch] = src.pal[ch] ? color : null;
    pal['.'] = null;
    defineSprite(name, src.rows, pal);
  }

  function bake(name) {
    const d = defs[name];
    if (!d) throw new Error(`unknown sprite ${name}`);
    const make = () => {
      const c = document.createElement('canvas');
      c.width = d.w;
      c.height = d.h;
      return c;
    };
    const normal = make();
    const flip = make();
    const white = make();
    const whiteFlip = make();
    const cn = normal.getContext('2d');
    const cf = flip.getContext('2d');
    const cw = white.getContext('2d');
    const cwf = whiteFlip.getContext('2d');
    cw.fillStyle = '#FFFFFF';
    cwf.fillStyle = '#FFFFFF';
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const col = d.pal[d.rows[y][x]];
        if (!col) continue;
        cn.fillStyle = col;
        cn.fillRect(x, y, 1, 1);
        cf.fillStyle = col;
        cf.fillRect(d.w - 1 - x, y, 1, 1);
        cw.fillRect(x, y, 1, 1);
        cwf.fillRect(d.w - 1 - x, y, 1, 1);
      }
    }
    baked[name] = { w: d.w, h: d.h, normal, flip, white, whiteFlip };
    return baked[name];
  }

  CB.Art = {
    defineSprite,
    defineTint,
    hasSprite: (name) => name in defs,
    spriteDef: (name) => defs[name],
    sprite: (name) => baked[name] || bake(name),
    spriteNames: () => Object.keys(defs),
  };
})(window.CB);
