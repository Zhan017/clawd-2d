// Add to Home Screen: stashes the browser's install prompt (Chrome and Android), knows when to show the iPhone/iPad "Tap Share" help, and when the game is already installed.
(function (CB) {
  'use strict';
  const HELP_ID = 'install-help';
  const IGNORE_MS = 300; // a tap this soon after the help opened is the tap that opened it
  const IN_APP = /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|MicroMessenger|GSA\//; // in-app browsers on iOS have no Add to Home Screen

  let deferred = null; // the stashed beforeinstallprompt event; it can be used once
  let installed = false; // appinstalled fired in this page
  let openedAt = 0;
  let wired = false;

  const nav = () => (typeof navigator === 'object' && navigator) || {};

  function media(q) {
    try {
      return typeof window.matchMedia === 'function' && !!window.matchMedia(q).matches;
    } catch (e) {
      return false;
    }
  }

  // Running from the home screen: a standalone, minimal-ui or fullscreen display mode (the manifest asks for fullscreen), or iOS's own flag.
  // The fullscreen display mode also matches a browser tab the page itself put into Fullscreen-API fullscreen (the game does that on its first start tap),
  // so it only counts while there is no fullscreenElement: an installed fullscreen app has none at launch.
  function standalone() {
    let apiFs = false;
    try {
      apiFs = !!(typeof document === 'object' && document && document.fullscreenElement);
    } catch (e) {
      apiFs = false;
    }
    return media('(display-mode: standalone)') || media('(display-mode: minimal-ui)') || (!apiFs && media('(display-mode: fullscreen)')) || nav().standalone === true;
  }

  // Inside a frame (the claude.ai Artifact, an embed) Add to Home Screen would add the host page, not the game.
  function embedded() {
    try {
      return !!window.top && window.top !== window; // a missing top (tests, odd hosts) reads as not embedded
    } catch (e) {
      return true; // reading top threw: a cross-origin frame
    }
  }

  // iPhone or iPad in Safari or another browser that has Share > Add to Home Screen. iPadOS 13+ says it is a Mac, with a touch screen.
  function iosBrowser() {
    const n = nav();
    const ua = String(n.userAgent || '');
    const ipad = /Macintosh/.test(ua) && !/Chrome\/|Firefox\/|Edg\//.test(ua) && typeof n.maxTouchPoints === 'number' && n.maxTouchPoints > 1; // Chrome with touch emulation says Macintosh too
    if (!(/iPhone|iPad|iPod/.test(ua) || ipad)) return false;
    return /Safari\//.test(ua) && !IN_APP.test(ua);
  }

  // 'prompt': the browser offered an install and the event is stashed. 'ios': show the Share help. null: installed, standalone, or nothing to offer.
  function kind() {
    if (installed || standalone() || embedded()) return null;
    if (deferred) return 'prompt';
    return iosBrowser() ? 'ios' : null;
  }

  // Shows the browser's install dialog. Resolves to 'accepted', 'dismissed' or 'unavailable', and never rejects. Call it inside a user gesture
  // (for a touch, the release: see input.withActivation); the stashed event is spent once the browser has shown (or declined) its dialog, but kept if the call was refused for lacking a gesture.
  function prompt() {
    const ev = deferred;
    if (!ev || typeof ev.prompt !== 'function') return Promise.resolve('unavailable');
    deferred = null;
    try {
      return Promise.resolve(ev.prompt())
        .then(() => ev.userChoice)
        .then(
          (c) => (c && c.outcome === 'accepted' ? 'accepted' : 'dismissed'),
          (err) => {
            if (err && err.name === 'NotAllowedError' && !deferred && !installed) deferred = ev; // no user gesture reached it: the event is not spent, so the next tap can retry
            return 'unavailable';
          }
        );
    } catch (e) {
      return Promise.resolve('unavailable');
    }
  }

  function helpEl() {
    try {
      return (typeof document === 'object' && document && document.getElementById(HELP_ID)) || null;
    } catch (e) {
      return null;
    }
  }

  // Any tap on the help closes it, as does Escape.
  function wire(el) {
    if (wired || !el) return;
    wired = true;
    try {
      const close = (ev) => {
        if (typeof ev.timeStamp === 'number' && openedAt && ev.timeStamp - openedAt < IGNORE_MS && ev.timeStamp > 0) return;
        hideIosHelp();
      };
      el.addEventListener('click', close);
      el.addEventListener('pointerup', close);
      window.addEventListener('keydown', (ev) => {
        if (ev && ev.code === 'Escape') hideIosHelp();
      });
    } catch (e) {
      // the help can still be closed by reloading: it is a nicety
    }
  }

  // True when the help is now showing.
  function showIosHelp() {
    const el = helpEl();
    if (!el) return false;
    wire(el);
    try {
      openedAt = typeof performance === 'object' && performance && typeof performance.now === 'function' ? performance.now() : 0;
      el.classList.add('open');
      if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'false');
    } catch (e) {
      return false;
    }
    return true;
  }

  function hideIosHelp() {
    const el = helpEl();
    if (!el) return;
    try {
      el.classList.remove('open');
      if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
    } catch (e) {
      // nothing to hide
    }
  }

  // Chrome and Android offer the install through an event that has to be kept for later; the default mini-infobar is silenced.
  try {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('beforeinstallprompt', (ev) => {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        deferred = ev || null;
      });
      window.addEventListener('appinstalled', () => {
        installed = true;
        deferred = null;
        hideIosHelp();
      });
    }
  } catch (e) {
    // no events, no install offer: the game does not need one
  }

  CB.Install = { kind, prompt, standalone, showIosHelp, hideIosHelp };
})(window.CB);
