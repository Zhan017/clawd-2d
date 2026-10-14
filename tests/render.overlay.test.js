'use strict';
// The renderer's side of the touch controls in the side bars: metrics(), the full-resolution overlay pass and the safe-area probe.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);

// A renderer whose every context records its calls (the screen canvas's log is returned), with an optional replacement for the probe div.
function recorded(win, mkDiv) {
  const { CB, sandbox } = H.load([...H.CORE, 'src/art/render.js'], { returnSandbox: true });
  const logs = new Map();
  sandbox.document.createElement = (tag) => {
    if (tag === 'div') {
      if (mkDiv) return mkDiv();
      return { style: {}, setAttribute() {} };
    }
    const log = [];
    const ctx = new Proxy({ imageSmoothingEnabled: false, globalAlpha: 1 }, {
      get: (t, p) => (p in t ? t[p] : (...args) => { log.push([String(p), ...args]); }),
      set: (t, p, v) => { t[p] = v; return true; },
    });
    const c = { width: 0, height: 0, style: {}, getContext: () => ctx, getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }) };
    logs.set(c, log);
    return c;
  };
  sandbox.document.body = { appendChild() {} };
  const canvas = sandbox.document.createElement('canvas');
  const r = CB.createRenderer(canvas, win);
  r.resize();
  return { CB, r, canvas, sandbox, log: logs.get(canvas) };
}

test('render: metrics() is the visible canvas in game px, with a bar on each side of a wide screen and the letterbox above and below', () => {
  const { r } = recorded({ innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 });
  assert.equal(r.scale, 6);
  const m = r.metrics();
  assert.ok(near(m.x0, -51) && near(m.x1, 371), JSON.stringify(m));
  assert.ok(near(m.y0, -7.5) && near(m.y1, 187.5), JSON.stringify(m));
  assert.deepEqual(m.safe, { l: 0, t: 0, r: 0, b: 0 }, 'no env() in a test window');
  const wide = recorded({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 }).r.metrics();
  assert.ok(near(wide.x0, 0) && near(wide.x1, 320) && near(wide.y0, 0) && near(wide.y1, 180), '16:9 has no bars');
});

test('render: overlay() queues drawing for after the blit, in game px on the screen canvas, then clears', () => {
  const { r, log } = recorded({ innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 });
  let ran = 0;
  r.overlay(() => {
    ran++;
    r.rect(-30, 10, 4, 4, '#FF0000'); // in the left bar
  });
  assert.equal(ran, 0, 'nothing runs until present()');
  log.length = 0;
  r.present();
  assert.equal(ran, 1);
  const names = log.map((l) => l[0]);
  const blit = names.indexOf('drawImage');
  const tf = names.indexOf('setTransform');
  assert.ok(blit >= 0 && tf > blit, 'after the blit');
  assert.deepEqual(log[tf], ['setTransform', 6, 0, 0, 6, r.ox, r.oy], 'game px at the canvas scale');
  assert.ok(log.some((l) => l[0] === 'fillRect' && l[1] === -30), 'drawn straight on the screen canvas, outside the 320x180 buffer');
  assert.equal(names[names.length - 1], 'restore');
  log.length = 0;
  r.present();
  assert.equal(ran, 1, 'cleared by the present that ran it');
  assert.ok(!log.some((l) => l[0] === 'setTransform'), 'and no pass when nothing is queued');
});

test('render: the overlay pass puts the buffer back even when a callback throws, ignores junk and caps its queue', () => {
  const { r, log } = recorded({ innerWidth: 640, innerHeight: 360, devicePixelRatio: 1 });
  r.overlay(() => { throw new Error('boom'); });
  r.overlay(null);
  r.overlay('x');
  assert.throws(() => r.present(), /boom/);
  assert.equal(log[log.length - 1][0], 'restore');
  log.length = 0;
  r.rect(1, 1, 2, 2, '#FFFFFF'); // back on the buffer, not the screen canvas
  assert.equal(log.length, 0);
  let ran = 0;
  for (let i = 0; i < 200; i++) r.overlay(() => { ran++; });
  r.present();
  assert.equal(ran, 64, 'the newest 64 survive');
});

test('render: the safe-area probe feeds metrics() in game px, and is read again when the size or the orientation changes', () => {
  const pads = { paddingLeft: '47px', paddingTop: '0px', paddingRight: '47px', paddingBottom: '21px' };
  let reads = 0;
  const probe = { style: {}, setAttribute() {} };
  const win = { innerWidth: 844, innerHeight: 390, devicePixelRatio: 3, screen: { orientation: { angle: 90 } }, getComputedStyle: () => { reads++; return pads; } };
  const { r } = recorded(win, () => probe);
  assert.match(probe.style.cssText, /env\(safe-area-inset-left/);
  const m = r.metrics();
  assert.ok(near(m.safe.l, 23.5) && near(m.safe.r, 23.5) && near(m.safe.b, 10.5) && m.safe.t === 0, JSON.stringify(m.safe));
  for (let i = 0; i < 40; i++) r.resize();
  const settled = reads;
  assert.ok(settled <= 21, 'it settles: the style is not read every frame (' + settled + ')');
  r.resize();
  assert.equal(reads, settled, 'a steady size and angle read nothing');
  win.screen.orientation.angle = 270; // the other landscape: same size, the notch on the other side
  r.resize();
  assert.ok(reads > settled, 'a new angle reads again');
  const before = reads;
  win.innerWidth = 390;
  win.innerHeight = 844;
  r.resize();
  assert.ok(reads > before, 'and so does a new size');
});

test('render: a probe that cannot be read leaves the insets at zero and never throws', () => {
  const { r } = recorded({ innerWidth: 844, innerHeight: 390, devicePixelRatio: 3 }, () => { throw new Error('no dom'); });
  assert.doesNotThrow(() => {
    r.resize();
    r.resize();
  });
  assert.deepEqual(r.metrics().safe, { l: 0, t: 0, r: 0, b: 0 });
});
