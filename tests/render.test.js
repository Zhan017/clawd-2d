'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function make(win, cssW, cssH) {
  const { CB, sandbox } = H.load([...H.CORE, 'src/art/render.js'], { returnSandbox: true });
  const canvas = sandbox.document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssW, height: cssH });
  const r = CB.createRenderer(canvas, win);
  r.resize();
  return { CB, r, canvas };
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

test('render: integer scale and centred letterbox', () => {
  const { r, canvas } = make({ innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 }, 1280, 800);
  assert.equal(canvas.width, 1280);
  assert.equal(r.scale, 4);
  assert.equal(r.ox, 0);
  assert.equal(r.oy, 40);
});

test('render: toInternal maps letterboxed coords', () => {
  const { r } = make({ innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1 }, 1280, 800);
  const p = r.toInternal(640, 400);
  assert.ok(near(p.x, 160) && near(p.y, 90), JSON.stringify(p));
  const q = r.toInternal(0, 40);
  assert.ok(near(q.x, 0) && near(q.y, 0));
});

test('render: devicePixelRatio 2 uses the backing store and still maps CSS coords', () => {
  const { r, canvas } = make({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 }, 1280, 720);
  assert.equal(canvas.width, 2560);
  assert.equal(r.scale, 8);
  const p = r.toInternal(640, 360);
  assert.ok(near(p.x, 160) && near(p.y, 90), JSON.stringify(p));
});

test('render: fractional scale below 320 px wide', () => {
  const { r } = make({ innerWidth: 300, innerHeight: 400, devicePixelRatio: 1 }, 300, 400);
  assert.ok(near(r.scale, 300 / 320));
  assert.equal(r.ox, 0);
  const p = r.toInternal(150, r.oy + 90 * r.scale);
  assert.ok(near(p.x, 160, 1e-6) && near(p.y, 90, 1e-6), JSON.stringify(p));
});

test('render: primitives and sprites run headless without throwing', () => {
  const { CB, r } = make({ innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 }, 640, 360);
  CB.Art.defineSprite('t_dot', ['o']);
  CB.Font = { CELL_H: 7, measure: (s, sc) => s.length * 6 * (sc || 1), draw() {} };
  r.clear('#000000');
  r.rect(1.4, 2.6, 3, 3, '#FFFFFF');
  r.frame(0, 0, 10, 10, '#FFFFFF');
  r.disc(50, 50, 4, '#FF0000');
  r.ring(50, 50, 6, '#FF0000');
  r.line(0, 0, 20, 7, '#00FF00');
  r.sprite('t_dot', 10, 10, { flip: true, white: true, alpha: 0.5, flipY: true, scale: 2 });
  r.text('hello', 160, 90, { align: 'center', shadow: '#000000', alpha: 0.5, scale: 2 });
  r.alpha(0.5, () => r.rect(0, 0, 1, 1, '#FFFFFF'));
  r.shaken(2, -1, () => r.rect(0, 0, 1, 1, '#FFFFFF'));
  let ran = 0;
  r.squash(10, 12, 1.25, 0.75, () => {
    ran++;
    r.sprite('t_dot', 10, 12);
  });
  assert.equal(ran, 1);
  r.present();
  assert.equal(r.measure('abc', 1), 18);
});

test('render: squash scales about the anchor and always restores, even when the callback throws', () => {
  const { CB, sandbox } = H.load([...H.CORE, 'src/art/render.js'], { returnSandbox: true });
  const log = [];
  const rec = new Proxy({ canvas: null, imageSmoothingEnabled: false }, {
    get: (t, prop) => (prop in t ? t[prop] : (...args) => { log.push([String(prop), ...args]); }),
    set: (t, prop, v) => { t[prop] = v; return true; },
  });
  sandbox.document.createElement = () => ({ width: 0, height: 0, style: {}, getContext: () => rec });
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, { innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 });
  log.length = 0;
  r.squash(10, 20, 1.5, 0.5, () => log.push(['fn']));
  assert.deepEqual(log, [['save'], ['translate', 10, 20], ['scale', 1.5, 0.5], ['translate', -10, -20], ['fn'], ['restore']]);
  log.length = 0;
  assert.throws(() => r.squash(0, 0, 2, 2, () => { throw new Error('boom'); }), /boom/);
  assert.equal(log[log.length - 1][0], 'restore');
  assert.equal(log.filter((l) => l[0] === 'save').length, log.filter((l) => l[0] === 'restore').length);
});
