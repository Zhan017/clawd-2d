// 320x180 buffer renderer: integer upscaling with letterbox, pixel primitives, cached text and discs.
(function (CB) {
  'use strict';
  const TEXT_CACHE_MAX = 512;
  const SHAPE_CACHE_MAX = 256;

  function cacheGet(map, key) {
    const v = map.get(key);
    if (v !== undefined) {
      map.delete(key);
      map.set(key, v);
    }
    return v;
  }
  function cacheSet(map, key, val, max) {
    if (map.size >= max) map.delete(map.keys().next().value);
    map.set(key, val);
  }

  CB.createRenderer = function (canvas, win) {
    const W = win || window;
    const buf = document.createElement('canvas');
    buf.width = CB.W;
    buf.height = CB.H;
    const b = buf.getContext('2d');
    b.imageSmoothingEnabled = false;
    const out = canvas.getContext('2d');
    const textCache = new Map();
    const shapeCache = new Map();
    const R = Math.round;

    function shape(radius, color, outline) {
      const rr = Math.max(0, R(radius));
      const key = (outline ? 'o' : 'f') + rr + color;
      let c = cacheGet(shapeCache, key);
      if (c) return c;
      const size = rr * 2 + 1;
      c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = color;
      const outer = (rr + 0.5) * (rr + 0.5);
      const inner = (rr - 0.5) * (rr - 0.5);
      for (let y = -rr; y <= rr; y++) {
        for (let x = -rr; x <= rr; x++) {
          const d = x * x + y * y;
          if (d > outer) continue;
          if (outline && rr > 0 && d <= inner) continue;
          g.fillRect(x + rr, y + rr, 1, 1);
        }
      }
      cacheSet(shapeCache, key, c, SHAPE_CACHE_MAX);
      return c;
    }

    function textImage(s, color, sc) {
      const key = color + '|' + sc + '|' + s;
      let c = cacheGet(textCache, key);
      if (c) return c;
      c = document.createElement('canvas');
      c.width = Math.max(1, CB.Font.measure(s, sc));
      c.height = CB.Font.CELL_H * sc;
      CB.Font.draw(c.getContext('2d'), s, 0, 0, color, sc);
      cacheSet(textCache, key, c, TEXT_CACHE_MAX);
      return c;
    }

    function withAlpha(a, fn) {
      if (a <= 0) return;
      const prev = b.globalAlpha;
      if (a !== 1) b.globalAlpha = prev * a;
      try {
        fn();
      } finally {
        b.globalAlpha = prev;
      }
    }

    const r = {
      canvas, buf, ctx: b, scale: 1, ox: 0, oy: 0, dpr: 1,

      resize() {
        const dpr = W.devicePixelRatio || 1;
        const cw = Math.max(1, Math.floor(W.innerWidth * dpr));
        const ch = Math.max(1, Math.floor(W.innerHeight * dpr));
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        const s = Math.min(cw / CB.W, ch / CB.H);
        r.scale = s >= 1 ? Math.floor(s) : s;
        r.ox = Math.floor((cw - CB.W * r.scale) / 2);
        r.oy = Math.floor((ch - CB.H * r.scale) / 2);
        r.dpr = dpr;
      },

      present() {
        out.imageSmoothingEnabled = false;
        out.fillStyle = '#000000';
        out.fillRect(0, 0, canvas.width, canvas.height);
        out.drawImage(buf, 0, 0, CB.W, CB.H, r.ox, r.oy, CB.W * r.scale, CB.H * r.scale);
      },

      toInternal(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width > 0 ? canvas.width / rect.width : 1;
        const sy = rect.height > 0 ? canvas.height / rect.height : 1;
        const px = (clientX - rect.left) * sx;
        const py = (clientY - rect.top) * sy;
        return { x: (px - r.ox) / r.scale, y: (py - r.oy) / r.scale };
      },

      clear(color) {
        b.fillStyle = color;
        b.fillRect(0, 0, CB.W, CB.H);
      },

      rect(x, y, w, h, color) {
        b.fillStyle = color;
        b.fillRect(R(x), R(y), R(w), R(h));
      },

      frame(x, y, w, h, color) {
        const X = R(x), Y = R(y), Wd = R(w), Ht = R(h);
        b.fillStyle = color;
        b.fillRect(X, Y, Wd, 1);
        b.fillRect(X, Y + Ht - 1, Wd, 1);
        b.fillRect(X, Y, 1, Ht);
        b.fillRect(X + Wd - 1, Y, 1, Ht);
      },

      disc(cx, cy, radius, color) {
        const rr = Math.max(0, R(radius));
        b.drawImage(shape(rr, color, false), R(cx) - rr, R(cy) - rr);
      },

      ring(cx, cy, radius, color) {
        const rr = Math.max(0, R(radius));
        b.drawImage(shape(rr, color, true), R(cx) - rr, R(cy) - rr);
      },

      line(x1, y1, x2, y2, color) {
        let x = R(x1), y = R(y1);
        const xe = R(x2), ye = R(y2);
        const dx = Math.abs(xe - x), dy = -Math.abs(ye - y);
        const sx = x < xe ? 1 : -1, sy = y < ye ? 1 : -1;
        let err = dx + dy;
        b.fillStyle = color;
        for (let guard = 0; guard < 2048; guard++) {
          b.fillRect(x, y, 1, 1);
          if (x === xe && y === ye) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x += sx; }
          if (e2 <= dx) { err += dx; y += sy; }
        }
      },

      sprite(name, cx, cy, o) {
        const opt = o || {};
        const s = CB.Art.sprite(name);
        const sc = opt.scale || 1;
        const img = opt.white ? (opt.flip ? s.whiteFlip : s.white) : opt.flip ? s.flip : s.normal;
        const w = s.w * sc;
        const h = s.h * sc;
        const x = R(cx - w / 2);
        const y = R(cy - h / 2);
        withAlpha(opt.alpha == null ? 1 : opt.alpha, () => {
          if (opt.flipY) {
            b.save();
            b.translate(x, y + h);
            b.scale(1, -1);
            b.drawImage(img, 0, 0, w, h);
            b.restore();
          } else b.drawImage(img, x, y, w, h);
        });
      },

      measure(str, scale) {
        return CB.Font.measure(String(str), scale || 1);
      },

      text(str, x, y, o) {
        const opt = o || {};
        const s = String(str);
        if (!s) return;
        const sc = opt.scale || 1;
        const img = textImage(s, opt.color || '#FFFFFF', sc);
        let tx = R(x);
        if (opt.align === 'center') tx = R(x - img.width / 2);
        else if (opt.align === 'right') tx = R(x - img.width);
        const ty = R(y);
        withAlpha(opt.alpha == null ? 1 : opt.alpha, () => {
          if (opt.shadow) b.drawImage(textImage(s, opt.shadow, sc), tx + sc, ty + sc);
          b.drawImage(img, tx, ty);
        });
      },

      alpha(a, fn) {
        withAlpha(a, fn);
      },

      // Scales fn's drawing about the anchor point (ax, ay): squash and stretch.
      squash(ax, ay, sx, sy, fn) {
        b.save();
        b.translate(ax, ay);
        b.scale(sx, sy);
        b.translate(-ax, -ay);
        try {
          fn();
        } finally {
          b.restore();
        }
      },

      shaken(dx, dy, fn) {
        b.save();
        b.translate(R(dx), R(dy));
        try {
          fn();
        } finally {
          b.restore();
        }
      },
    };
    return r;
  };
})(window.CB);
