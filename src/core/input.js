// Keyboard + mouse → per-tick InputState. Held state persists; edges are consumed by sample().
(function (CB) {
  'use strict';
  const MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const PREVENT = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  const CHOICE = { Digit1: 1, Numpad1: 1, Digit2: 2, Numpad2: 2, Digit3: 3, Numpad3: 3 };

  CB.createInput = function (o) {
    const win = o.win || window;
    const canvas = o.canvas;
    const renderer = o.renderer;
    const held = new Set();
    let fireHeld = false;
    let hasMouse = false;
    let mx = 0;
    let my = 0;
    const KEYS_MAX = 16; // recent key codes, for typed secrets (Konami, "ultrathink")
    const keys = [];
    const edges = { dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false };

    function onKeyDown(e) {
      if (PREVENT[e.code] && e.preventDefault) e.preventDefault();
      // macOS sends no keyup for keys released while Cmd is down, so Cmd shortcuts must not leave keys stuck.
      if (e.metaKey) held.clear();
      if (e.repeat) return;
      if (!e.metaKey) held.add(e.code);
      keys.push(e.code);
      if (keys.length > KEYS_MAX) keys.shift();
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
      hasMouse = true;
      mx = e.clientX;
      my = e.clientY;
      if (e.button === 0) {
        fireHeld = true;
        edges.confirm = true;
      } else if (e.button === 2) edges.dash = true;
      if (canvas.focus) canvas.focus();
    }
    function onMouseUp(e) { if (e.button === 0) fireHeld = false; }
    function onMouseMove(e) {
      // A release outside the window can be missed: if the primary button is no longer down, stop firing.
      if (typeof e.buttons === 'number' && !(e.buttons & 1)) fireHeld = false;
      hasMouse = true;
      mx = e.clientX;
      my = e.clientY;
    }
    function releaseAll() {
      held.clear();
      fireHeld = false;
    }
    function onContext(e) { if (e.preventDefault) e.preventDefault(); }

    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.addEventListener('blur', releaseAll);
    win.addEventListener('mouseup', onMouseUp);
    win.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContext);

    function peekAim() {
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
        const a = peekAim();
        const s = {
          moveX: Math.max(-1, Math.min(1, x)), moveY: Math.max(-1, Math.min(1, y)),
          aimX: a.x, aimY: a.y, fire: fireHeld,
          dash: edges.dash, pause: edges.pause, mute: edges.mute, confirm: edges.confirm,
          choice: edges.choice, retry: edges.retry, quit: edges.quit,
          compact: edges.compact, music: edges.music, keys: keys.splice(0),
        };
        edges.dash = edges.pause = edges.mute = edges.confirm = edges.retry = edges.quit = edges.compact = edges.music = false;
        edges.choice = 0;
        return s;
      },
      peekAim,
      releaseAll,
      dispose() {
        win.removeEventListener('keydown', onKeyDown);
        win.removeEventListener('keyup', onKeyUp);
        win.removeEventListener('blur', releaseAll);
        win.removeEventListener('mouseup', onMouseUp);
        win.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('contextmenu', onContext);
      },
    };
  };
})(window.CB);
