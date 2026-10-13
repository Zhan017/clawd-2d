// Keyboard, mouse, gamepad and touch → one per-tick InputState. Held state persists; edges are consumed by sample().
(function (CB) {
  'use strict';
  const MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  const CHOICE = { Digit1: 1, Numpad1: 1, Digit2: 2, Numpad2: 2, Digit3: 3, Numpad3: 3 };
  const COMPAT_MS = 1000; // a mouse event this soon after a touch event is the browser's compatibility copy of it
  const MOUSE_MIN_PX = 2; // a mouse takes the device back only after moving this far
  const PAD_WAKE = 0.5; // a pad stick takes the device only past this; drift under it still moves and aims, but does not steal it
  const NO_EDGES = {};

  const isDevice = (d) => d === 'kbm' || d === 'pad' || d === 'touch';
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));

  CB.createInput = function (o) {
    const win = o.win || window;
    const canvas = o.canvas;
    const renderer = o.renderer;
    const held = new Set();
    let fireHeld = false;
    let hasMouse = false;
    let mx = 0;
    let my = 0;
    let tapX = 0;
    let tapY = 0;
    let tapNewer = false; // the last pointer position is a touch tap (tapX, tapY) rather than the mouse (mx, my)
    const KEYS_MAX = 16; // recent key codes, for typed secrets (Konami, "ultrathink")
    const keys = [];
    const edges = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, navX: 0, navY: 0, tap: false };

    // ---- device: the last one used, mirrored into CB.Prompts so every on-screen prompt matches it ------------------------
    let device = 'kbm';
    try {
      if (CB.Prompts && typeof CB.Prompts.detect === 'function') {
        const d = CB.Prompts.detect(win);
        if (isDevice(d)) device = d;
      }
    } catch (err) {
      device = 'kbm';
    }
    function syncPrompts() {
      if (CB.Prompts && typeof CB.Prompts.setDevice === 'function') CB.Prompts.setDevice(device);
    }
    function setDevice(d) {
      if (d === device) return;
      device = d;
      syncPrompts();
    }
    if (CB.Prompts && CB.Prompts.device !== device) syncPrompts();

    // ---- touch ---------------------------------------------------------------------------------------------------------
    let touchState = null;
    let touchMode = 'menu';
    let lastTouchTS = -Infinity; // event.timeStamp of the last touch pointer event; the tests' events carry none, so they never look like compat events
    let fullscreenArmed = false;

    // CB.Touch is optional (tests load partial stubs), so every call is guarded on the method itself.
    function touchCall(name, a, b, c) {
      const T = CB.Touch;
      if (!T || typeof T[name] !== 'function') return undefined;
      if (!touchState && typeof T.createState === 'function') touchState = T.createState();
      return T[name](touchState, a, b, c);
    }
    const touchLoaded = () => !!(CB.Touch && typeof CB.Touch.down === 'function');
    function stampTouch(e) {
      if (typeof e.timeStamp === 'number' && Number.isFinite(e.timeStamp)) lastTouchTS = e.timeStamp;
    }
    function toInternal(e) {
      return renderer && typeof renderer.toInternal === 'function' ? renderer.toInternal(e.clientX, e.clientY) : null;
    }
    // The mouse events a browser fires after a touch (and the ones it marks as touch-born) are not a mouse.
    function isCompat(e) {
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return true;
      return typeof e.timeStamp === 'number' && e.timeStamp - lastTouchTS < COMPAT_MS;
    }

    function onPointerDown(e) {
      if (e.pointerType !== 'touch' || !touchLoaded()) return;
      stampTouch(e);
      if (e.preventDefault) e.preventDefault(); // also stops the compatibility mouse events, and the focus and selection they bring
      try {
        if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(e.pointerId);
      } catch (err) {
        // a pointer that already lifted cannot be captured; the window listeners still get its moves
      }
      if (canvas.focus) canvas.focus();
      const p = toInternal(e);
      if (p) touchCall('down', e.pointerId, p.x, p.y);
      setDevice('touch');
    }
    function onPointerMove(e) {
      if (e.pointerType !== 'touch' || !touchLoaded()) return;
      stampTouch(e);
      const p = toInternal(e);
      if (p) touchCall('move', e.pointerId, p.x, p.y);
    }
    function onPointerUp(e) {
      if (e.pointerType !== 'touch' || !touchLoaded()) return;
      stampTouch(e);
      touchCall('up', e.pointerId);
      // A touch pointerdown is not a user activation but its pointerup is, so a requested fullscreen waits for the release.
      if (fullscreenArmed) {
        fullscreenArmed = false;
        try {
          if (CB.Touch && typeof CB.Touch.requestFullscreen === 'function') CB.Touch.requestFullscreen(win.document, win.screen);
        } catch (err) {
          // fullscreen is a nicety
        }
      }
    }
    function onPointerCancel(e) {
      if (e.pointerType !== 'touch' || !touchLoaded()) return;
      stampTouch(e);
      touchCall('up', e.pointerId);
    }

    // ---- keyboard and mouse ----------------------------------------------------------------------------------------------
    function onKeyDown(e) {
      if (PREVENT[e.code] && e.preventDefault) e.preventDefault();
      // macOS sends no keyup for keys released while Cmd is down, so Cmd shortcuts must not leave keys stuck.
      if (e.metaKey) held.clear();
      if (e.repeat) return;
      setDevice('kbm');
      if (!e.metaKey) held.add(e.code);
      keys.push(e.code);
      if (keys.length > KEYS_MAX) keys.shift();
      const nav = MOVE[e.code]; // the same keys that walk also move a menu focus
      if (nav) {
        if (nav[0]) edges.navX = nav[0];
        if (nav[1]) edges.navY = nav[1];
      }
      switch (e.code) {
        case 'Space': case 'ShiftLeft': case 'ShiftRight': edges.dash = true; break;
        case 'Escape': case 'KeyP': edges.pause = true; break;
        case 'KeyM': edges.mute = true; break;
        case 'KeyN': edges.music = true; break;
        case 'KeyE': edges.compact = true; break;
        case 'Enter': case 'NumpadEnter': edges.confirm = true; break;
        case 'KeyR': edges.retry = true; break;
        case 'KeyQ': edges.quit = true; break;
        default: if (CHOICE[e.code]) edges.choice = CHOICE[e.code];
      }
    }
    function onKeyUp(e) { held.delete(e.code); }
    function onMouseDown(e) {
      if (isCompat(e)) return;
      setDevice('kbm');
      hasMouse = true;
      tapNewer = false;
      mx = e.clientX;
      my = e.clientY;
      if (e.button === 0) {
        fireHeld = true;
        edges.confirm = true;
        edges.tap = true;
      } else if (e.button === 2) edges.dash = true;
      if (canvas.focus) canvas.focus();
    }
    function onMouseUp(e) {
      if (isCompat(e)) return;
      if (e.button === 0) fireHeld = false;
    }
    function onMouseMove(e) {
      if (isCompat(e)) return;
      // A release outside the window can be missed: if the primary button is no longer down, stop firing.
      if (typeof e.buttons === 'number' && !(e.buttons & 1)) fireHeld = false;
      const moved = Math.hypot(e.clientX - mx, e.clientY - my) >= MOUSE_MIN_PX; // since the last position taken
      // On the mouse's own device every move counts. On another, a twitch under 2 px changes nothing (not the device, not the aim).
      if (device === 'kbm' || moved) {
        hasMouse = true;
        tapNewer = false;
        mx = e.clientX;
        my = e.clientY;
        if (moved) setDevice('kbm');
      }
    }
    function releaseKbm() {
      held.clear();
      fireHeld = false;
    }
    function releaseAll() {
      releaseKbm();
      touchCall('releaseAll');
    }
    function onContext(e) { if (e.preventDefault) e.preventDefault(); }

    // ---- gamepad ---------------------------------------------------------------------------------------------------------
    let padState = null;
    let lastPad = null; // the pad rumble() talks to
    let padDirX = 0; // the last R-stick direction, kept while it rests
    let padDirY = -1;
    const padDown = []; // which buttons were down at the last poll, for press edges that can steal the device

    function unlockAudio() {
      try {
        if (CB.Audio && typeof CB.Audio.init === 'function') CB.Audio.init();
      } catch (err) {
        // audio is optional
      }
    }
    // Did the pad itself wake up? A new button press (a trigger counts when it crosses its threshold) or a stick pushed past PAD_WAKE.
    function padWake(G, pad) {
      const buttons = pad.buttons || [];
      const axes = pad.axes || [];
      const BT = G.BTN || {};
      const lt = typeof BT.LT === 'number' ? BT.LT : 6;
      const rt = typeof BT.RT === 'number' ? BT.RT : 7;
      const at = typeof G.TRIGGER_AT === 'number' ? G.TRIGGER_AT : 0.35;
      let press = false;
      for (let i = 0; i < Math.max(buttons.length, padDown.length); i++) {
        const b = buttons[i];
        let d = false;
        if (b) d = i === lt || i === rt ? (typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0) >= at : !!(b.pressed || b.value > 0.5);
        if (d && !padDown[i]) press = true;
        padDown[i] = d;
      }
      const stick = Math.max(Math.hypot(num(axes[0]), num(axes[1])), Math.hypot(num(axes[2]), num(axes[3])));
      return { press, stick: stick > PAD_WAKE };
    }
    // One poll: null when there is no pad (or the browser refuses to list them), else CB.Gamepad.read's output.
    function readPad() {
      lastPad = null;
      const G = CB.Gamepad;
      if (!G || typeof G.read !== 'function' || typeof G.pick !== 'function') return null;
      try {
        const nav = win.navigator; // a permissions policy can make getGamepads() throw, and a plain test window has no navigator at all
        if (!nav || typeof nav.getGamepads !== 'function') return null;
        const pad = G.pick(nav.getGamepads());
        if (!pad) return null;
        lastPad = pad;
        if (!padState && typeof G.createState === 'function') padState = G.createState();
        const g = G.read(pad, padState);
        const wake = padWake(G, pad);
        if (wake.press || wake.stick) setDevice('pad');
        if (wake.press) unlockAudio(); // a pad press is a user gesture the page never sees as a pointer or key event
        return g;
      } catch (err) {
        return null;
      }
    }

    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', releaseAll);
    win.addEventListener('mouseup', onMouseUp);
    win.addEventListener('mousemove', onMouseMove);
    win.addEventListener('pointermove', onPointerMove);
    win.addEventListener('pointerup', onPointerUp);
    win.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('mouseleave', releaseKbm); // a button released outside the page never arrives, so leaving stops fire

    function peekAim() {
      if (tapNewer) return { x: tapX, y: tapY };
      if (!hasMouse) return { x: CB.W / 2, y: CB.H / 2 - 40 };
      return renderer.toInternal(mx, my);
    }

    return {
      sample() {
        let x = 0;
        let y = 0;
        for (const code of held) {
          const m = MOVE[code];
          if (m) {
            x += m[0];
            y += m[1];
          }
        }
        const g = readPad();
        const t = touchCall('sample') || null;
        if (t && t.tap && typeof t.tap.x === 'number' && typeof t.tap.y === 'number') {
          tapX = t.tap.x;
          tapY = t.tap.y;
          tapNewer = true;
        }
        const a = peekAim();

        // Stick aim: the pad's R-stick when the pad is the device, the aim stick when the device is touch and the sticks are up.
        if (g && typeof g.aimDirX === 'number') {
          padDirX = g.aimDirX;
          padDirY = g.aimDirY;
        }
        let adx = null;
        let ady = null;
        if (device === 'pad') {
          adx = padDirX;
          ady = padDirY;
        } else if (device === 'touch' && touchMode === 'sticks' && t && typeof t.aimDirX === 'number') {
          adx = t.aimDirX;
          ady = t.aimDirY;
        }

        const ge = g ? g.edges : NO_EDGES;
        const te = t && t.edges ? t.edges : NO_EDGES;
        const s = {
          moveX: clamp1(x + (g ? g.moveX : 0) + (t ? t.moveX : 0)), moveY: clamp1(y + (g ? g.moveY : 0) + (t ? t.moveY : 0)),
          aimX: a.x, aimY: a.y, fire: fireHeld || !!(g && g.fire) || !!(t && t.fire),
          dash: edges.dash || !!ge.dash || !!te.dash, pause: edges.pause || !!ge.pause || !!te.pause, mute: edges.mute,
          confirm: edges.confirm || !!ge.confirm || !!te.confirm,
          choice: edges.choice, retry: edges.retry, quit: edges.quit || !!ge.quit,
          compact: edges.compact || !!ge.compact || !!te.compact, music: edges.music, keys: keys.splice(0),
          device,
          aimDirX: adx, aimDirY: ady, aimAssist: adx !== null,
          navX: edges.navX || (g ? g.navX : 0), navY: edges.navY || (g ? g.navY : 0),
          tap: edges.tap || !!(t && t.tap),
          pad: g ? g.pad : null,
        };
        edges.dash = edges.pause = edges.mute = edges.confirm = edges.retry = edges.quit = edges.compact = edges.music = edges.tap = false;
        edges.choice = 0;
        edges.navX = edges.navY = 0;
        return s;
      },
      peekAim,
      releaseAll,
      get device() { return device; },
      // 'menu': a touch is a tap. 'sticks': twin sticks and buttons. The play scene sets it every update.
      setTouchMode(mode) {
        if (mode !== 'menu' && mode !== 'sticks') return;
        touchMode = mode;
        touchCall('setMode', mode);
      },
      touchView() {
        return device === 'touch' ? touchCall('view') || null : null;
      },
      // Pad: dual-rumble on the pad in use. Touch: navigator.vibrate. Keyboard and mouse: nothing. True when something was requested.
      rumble(strong, weak, ms, vib) {
        try {
          if (device === 'pad') return !!(CB.Gamepad && typeof CB.Gamepad.rumble === 'function' && CB.Gamepad.rumble(lastPad, strong, weak, ms));
          const nav = win.navigator;
          if (device === 'touch' && vib != null && nav && typeof nav.vibrate === 'function') {
            nav.vibrate(vib);
            return true;
          }
        } catch (err) {
          // a motor that fails must never stop the game
        }
        return false;
      },
      // Asks for fullscreen (and a landscape lock) at the next touch release, the first moment the browser allows it.
      requestFullscreenOnRelease() {
        fullscreenArmed = true;
      },
      dispose() {
        win.removeEventListener('keydown', onKeyDown);
        win.removeEventListener('keyup', onKeyUp);
        win.removeEventListener('blur', releaseAll);
        win.removeEventListener('mouseup', onMouseUp);
        win.removeEventListener('mousemove', onMouseMove);
        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('pointerup', onPointerUp);
        win.removeEventListener('pointercancel', onPointerCancel);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('contextmenu', onContext);
        canvas.removeEventListener('mouseleave', releaseKbm);
      },
    };
  };
})(window.CB);
