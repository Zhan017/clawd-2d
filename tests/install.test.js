'use strict';
// CB.Install (src/core/install.js): the stashed install prompt, the iPhone/iPad Share help overlay, the standalone check, and the page markup it needs.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./harness');

const CODE = fs.readFileSync(path.join(H.ROOT, 'src/core/install.js'), 'utf8');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1';
const IPHONE_FACEBOOK = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0] Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36';

// A page with a window that records listeners and an #install-help element with a class list.
function env(o) {
  const opt = o || {};
  const handlers = {};
  const classes = new Set();
  const elHandlers = {};
  const attrs = {};
  const el = {
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    addEventListener: (t, f) => { (elHandlers[t] = elHandlers[t] || []).push(f); },
    setAttribute: (k, v) => { attrs[k] = v; },
  };
  let now = 1000;
  const sandbox = {
    CB: {},
    navigator: Object.assign({ userAgent: ANDROID, maxTouchPoints: 5 }, opt.navigator),
    matchMedia: (q) => ({ matches: !!(opt.media && opt.media[q]) }),
    performance: { now: () => now },
    document: { getElementById: (id) => (id === 'install-help' && opt.help !== false ? el : null) },
    addEventListener: (t, f) => { (handlers[t] = handlers[t] || []).push(f); },
  };
  if (opt.noMatchMedia) delete sandbox.matchMedia;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: 'src/core/install.js' });
  const e = {
    I: sandbox.CB.Install,
    sandbox,
    el,
    attrs,
    open: () => classes.has('open'),
    at: (ms) => { now = ms; },
    fire(type, ev) {
      const x = Object.assign({ defaultPrevented: false, preventDefault() { x.defaultPrevented = true; } }, ev);
      for (const f of handlers[type] || []) f(x);
      return x;
    },
    tap(type, ts) {
      for (const f of elHandlers[type] || []) f({ timeStamp: ts });
    },
    offer(outcome, extra) {
      const calls = { prompt: 0 };
      const ev = Object.assign({ prompt() { calls.prompt++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome }) }, extra);
      const fired = e.fire('beforeinstallprompt', ev);
      return { ev, fired, calls };
    },
  };
  return e;
}

test('install: the API is there and the page starts with nothing to offer on a plain desktop', () => {
  const e = env({ navigator: { userAgent: MAC_CHROME, maxTouchPoints: 0 } });
  for (const k of ['kind', 'prompt', 'standalone', 'showIosHelp', 'hideIosHelp']) assert.equal(typeof e.I[k], 'function', k);
  assert.strictEqual(e.I.kind(), null);
  assert.equal(e.I.standalone(), false);
});

test('install: beforeinstallprompt is stashed and its default (the mini-infobar) prevented, so kind() is "prompt"', () => {
  const e = env();
  const { fired } = e.offer('accepted');
  assert.equal(fired.defaultPrevented, true);
  assert.equal(e.I.kind(), 'prompt');
});

test('install: prompt() resolves to accepted or dismissed from userChoice, spends the event, and never throws', async () => {
  let e = env();
  let o = e.offer('accepted');
  assert.equal(await e.I.prompt(), 'accepted');
  assert.equal(o.calls.prompt, 1);
  assert.strictEqual(e.I.kind(), null, 'an event can be used once');
  assert.equal(await e.I.prompt(), 'unavailable', 'and then there is nothing to show');

  e = env();
  e.offer('dismissed');
  assert.equal(await e.I.prompt(), 'dismissed');

  e = env();
  assert.equal(await e.I.prompt(), 'unavailable', 'no event at all');

  e = env();
  e.offer('accepted', { prompt() { throw new Error('not allowed'); } });
  assert.equal(await e.I.prompt(), 'unavailable', 'a prompt() that throws');

  e = env();
  e.offer('accepted', { prompt: () => Promise.reject(new Error('no gesture')) });
  assert.equal(await e.I.prompt(), 'unavailable', 'a prompt() that rejects');

  e = env();
  e.offer('accepted', { userChoice: Promise.reject(new Error('gone')) });
  assert.equal(await e.I.prompt(), 'unavailable', 'a userChoice that rejects');

  e = env();
  e.offer('accepted', { userChoice: Promise.resolve(null) });
  assert.equal(await e.I.prompt(), 'dismissed', 'a junk choice is a no');

  e = env();
  e.fire('beforeinstallprompt', {});
  assert.equal(await e.I.prompt(), 'unavailable', 'an event without prompt()');
});

test('install: appinstalled clears the offer and the help', () => {
  const e = env();
  e.offer('accepted');
  e.fire('appinstalled', {});
  assert.strictEqual(e.I.kind(), null);
  e.offer('accepted'); // a later offer in the same page does not bring it back to life
  assert.strictEqual(e.I.kind(), null);

  const ios = env({ navigator: { userAgent: IPHONE } });
  ios.I.showIosHelp();
  ios.fire('appinstalled', {});
  assert.equal(ios.open(), false);
  assert.strictEqual(ios.I.kind(), null);
});

test('install: standalone() is a standalone or fullscreen display mode or the iOS flag, and then kind() is null', () => {
  for (const [name, o] of [
    ['standalone', { media: { '(display-mode: standalone)': true } }],
    ['fullscreen', { media: { '(display-mode: fullscreen)': true } }],
    ['navigator.standalone', { navigator: { standalone: true, userAgent: IPHONE } }],
  ]) {
    const e = env(o);
    assert.equal(e.I.standalone(), true, name);
    e.offer('accepted');
    assert.strictEqual(e.I.kind(), null, name + ': installed, nothing to offer');
  }
  const ios = env({ navigator: { userAgent: IPHONE, standalone: false } });
  assert.equal(ios.I.standalone(), false);
  assert.equal(env({ noMatchMedia: true }).I.standalone(), false, 'no matchMedia is not a crash');
  const throwing = env();
  throwing.sandbox.matchMedia = () => { throw new Error('nope'); };
  assert.equal(throwing.I.standalone(), false);
});

test('install: kind() is "ios" on an iPhone or iPad in Safari or Chrome, not in an in-app browser, a Mac or Android', () => {
  assert.equal(env({ navigator: { userAgent: IPHONE } }).I.kind(), 'ios');
  assert.equal(env({ navigator: { userAgent: IPHONE_CHROME } }).I.kind(), 'ios');
  assert.equal(env({ navigator: { userAgent: IPAD_DESKTOP, maxTouchPoints: 5 } }).I.kind(), 'ios', 'iPadOS says Macintosh, with a touch screen');
  assert.strictEqual(env({ navigator: { userAgent: IPAD_DESKTOP, maxTouchPoints: 0 } }).I.kind(), null, 'a real Mac');
  assert.strictEqual(env({ navigator: { userAgent: MAC_CHROME, maxTouchPoints: 5 } }).I.kind(), null, 'Chrome with touch emulation is not an iPad');
  assert.strictEqual(env({ navigator: { userAgent: IPHONE_FACEBOOK } }).I.kind(), null, 'an in-app browser has no Add to Home Screen');
  assert.strictEqual(env({ navigator: { userAgent: ANDROID } }).I.kind(), null, 'Android waits for beforeinstallprompt');
  assert.strictEqual(env({ navigator: { userAgent: IPHONE, standalone: true } }).I.kind(), null, 'already on the home screen');
  assert.strictEqual(env({ navigator: {} }).I.kind(), null, 'a navigator with nothing in it');
});

test('install: the iOS help opens and closes, closes on a tap or Escape, and ignores the tap that opened it', () => {
  const e = env({ navigator: { userAgent: IPHONE } });
  e.at(5000);
  assert.equal(e.I.showIosHelp(), true);
  assert.equal(e.open(), true);
  assert.equal(e.attrs['aria-hidden'], 'false');
  e.tap('click', 5100); // 100 ms after opening: the opening touch's own click
  assert.equal(e.open(), true);
  e.tap('click', 5400);
  assert.equal(e.open(), false, 'a later tap closes it');
  assert.equal(e.attrs['aria-hidden'], 'true');
  e.at(9000);
  e.I.showIosHelp();
  e.tap('pointerup', 9500);
  assert.equal(e.open(), false, 'pointerup closes it too');
  e.I.showIosHelp();
  e.fire('keydown', { code: 'KeyA' });
  assert.equal(e.open(), true);
  e.fire('keydown', { code: 'Escape' });
  assert.equal(e.open(), false);
  e.I.showIosHelp();
  e.I.hideIosHelp();
  assert.equal(e.open(), false);
});

test('install: without the element or with a broken one, showing and hiding never throw', () => {
  const none = env({ help: false });
  assert.equal(none.I.showIosHelp(), false);
  assert.doesNotThrow(() => none.I.hideIosHelp());
  const broken = env({ navigator: { userAgent: IPHONE } });
  broken.el.classList = null;
  assert.equal(broken.I.showIosHelp(), false);
  assert.doesNotThrow(() => broken.I.hideIosHelp());
});

// ---- the markup, head and manifest it relies on ------------------------------------------------------------------------------

const INDEX = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');

test('page: #install-help is a hidden full-screen card with a share icon and the Share instruction, below the rotate overlay, with no script or link', () => {
  const m = INDEX.match(/<div id="install-help"[^>]*>[\s\S]*?<\/div><\/div>/);
  assert.ok(m, '#install-help is in index.html');
  assert.match(m[0], /<svg [^>]*viewBox="0 0 24 24"/, 'an inline share icon');
  assert.match(m[0], /Tap Share, then Add to Home Screen/);
  assert.doesNotMatch(m[0], /<script|https?:|\bhref=|\bsrc=|\bon\w+\s*=/i);
  const css = INDEX.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#install-help\s*\{[^}]*display:\s*none/, 'hidden until opened');
  assert.match(css, /#install-help\.open\s*\{[^}]*display:\s*grid/);
  const z = (sel) => Number((css.match(new RegExp(sel + '\\s*\\{[^}]*z-index:\\s*(\\d+)')) || [])[1]);
  assert.ok(z('#install-help') > 0 && z('#install-help') < z('#rotate'), 'the portrait overlay always wins');
  assert.match(css, /#install-help\s*\{[^}]*pointer-events:\s*auto/, 'a tap on it never reaches the canvas');
  assert.ok(INDEX.indexOf('id="install-help"') > INDEX.indexOf('<canvas id="game"'), 'after the canvas, so it paints on top');
});

test('page: the portrait overlay has a big icon and both lines', () => {
  const m = INDEX.match(/<div id="rotate">[\s\S]*?<\/div><\/div>/);
  assert.ok(m);
  assert.match(m[0], /<svg /);
  assert.match(m[0], /Turn your device sideways to play/);
  assert.match(m[0], /Rotation locked\? Turn off Portrait Orientation Lock in Control Center\./);
  const css = INDEX.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /#rotate svg\s*\{[^}]*width:\s*(?:9\d|1\d\d)px/, 'about 96 px or more');
});

test('page: install.js is listed after loop.js and the manifest has an id and a short short_name', () => {
  const list = H.scriptList();
  assert.equal(list.indexOf('src/core/install.js'), list.indexOf('src/core/loop.js') + 1);
  const m = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.id, '/');
  assert.ok(m.short_name.length <= 12);
  assert.equal(m.display, 'fullscreen');
  assert.match(INDEX, /<meta name="apple-mobile-web-app-title" content="Clawd">/);
  assert.match(INDEX, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
});
