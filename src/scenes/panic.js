// Kernel panic screen: the crash message and the first src/ stack frame, painted without depending on any game state.
(function (CB) {
  'use strict';
  // Literal colours and sizes on purpose: the game's own modules may be what just failed.
  const BG = '#0A0A14';
  const RED = '#FF6B6B';
  const TEXT = '#E8E6F0';
  const GREY = '#9AA3B5';
  const X = 16;
  const WIDTH = 288; // 320 minus a 16 px margin each side
  const MAX_LINES = 6;
  const MSG_Y = 40;
  const LINE_H = 9;

  // "Press R to reload" (a tap on a phone). Prompts is a game module that may be what failed, so anything odd gives the keyboard text.
  function reloadText() {
    const fallback = 'Press R to reload';
    try {
      const P = CB.Prompts;
      const d = P && P.device;
      const s = P && typeof P.text === 'function' ? P.text('reload', d === 'touch' || d === 'pad' ? d : 'kbm') : '';
      return typeof s === 'string' && s ? s : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // err.message, or the error itself as text. A hostile error (a getter that throws) still gives a line.
  function messageOf(err) {
    try {
      const m = err && err.message != null && err.message !== '' ? err.message : err;
      return String(m);
    } catch (e) {
      return 'unknown error';
    }
  }

  // The first line of the stack that mentions src/, trimmed, with the page origin dropped from the file name.
  function stackFrame(err) {
    try {
      const stack = err && err.stack;
      if (typeof stack !== 'string') return '';
      const line = stack.split('\n').find((l) => l.includes('src/'));
      return line ? line.trim().replace(/(?:https?|file):\/\/[^\s)]*?(src\/)/, '$1') : '';
    } catch (e) {
      return '';
    }
  }

  // Wraps to 288 px and keeps at most six lines; a message that does not fit ends in "...".
  function wrapMessage(msg) {
    let lines = CB.Font.wrap(msg, WIDTH, 1);
    if (lines.length > MAX_LINES) {
      lines = lines.slice(0, MAX_LINES);
      lines[MAX_LINES - 1] = cut(lines[MAX_LINES - 1] + '...', WIDTH);
    }
    return lines;
  }

  // Shortens a line from the right until it fits `max` px, keeping a trailing "..." when it had to.
  function cut(str, max) {
    if (CB.Font.measure(str, 1) <= max) return str;
    const chars = Array.from(str.replace(/\.{3}$/, ''));
    while (chars.length > 1 && CB.Font.measure(chars.join('') + '...', 1) > max) chars.pop();
    return chars.join('') + '...';
  }

  // The normal screen, in the bitmap font.
  function paint(r, err) {
    r.clear(BG);
    r.text('KERNEL PANIC', X, 16, { scale: 2, color: RED });
    const lines = wrapMessage(messageOf(err));
    lines.forEach((l, i) => r.text(l, X, MSG_Y + LINE_H * i, { color: TEXT }));
    const frame = stackFrame(err);
    if (frame) r.text(cut(frame, WIDTH), X, MSG_Y + LINE_H * lines.length + 5, { color: GREY });
    r.text(reloadText(), X, 160, { color: TEXT });
  }

  // The fallback when the font or the text cache is what broke: the 2D context's own text, in a system monospace font.
  function paintPlain(r, err) {
    const g = r.ctx;
    g.fillStyle = BG;
    g.fillRect(0, 0, 320, 180);
    g.font = '10px monospace';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = RED;
    g.fillText('KERNEL PANIC', X, 16);
    g.fillStyle = TEXT;
    const msg = messageOf(err);
    for (let i = 0; i < MAX_LINES && i * 48 < msg.length; i++) g.fillText(msg.slice(i * 48, i * 48 + 48), X, MSG_Y + 11 * i);
    g.fillText(reloadText(), X, 160);
  }

  CB.Screens.panic = {
    // Never throws: if the normal path fails, the plain one tries, and if that fails too there is nothing left to do.
    draw(r, err) {
      try {
        paint(r, err);
        return;
      } catch (e) {
        // fall through to the plain painter
      }
      try {
        paintPlain(r, err);
      } catch (e) {
        // no usable renderer at all
      }
    },
  };
})(window.CB);
