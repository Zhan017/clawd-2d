'use strict';
// Source hygiene over every script index.html lists: no Math.random in logic, no Date.now in game code, one IIFE shape per file,
// only ns.js creates window.CB, no canvas context grabbed in game logic, and no listed script missing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./harness');

// index.html already lists the Phase B scripts; until a task writes its file it may be missing. Entries here are tolerated as
// missing and nothing else is. Files that now exist are checked like any other, so this list only ever needs deleting from.
// Task 23 (build) runs with CB_LINT_STRICT=1, which ignores the list: by then every listed script must exist.
const NOT_BUILT_YET = []; // every script in index.html exists now
const STRICT = process.env.CB_LINT_STRICT === '1';

// A '/' starts a regex literal (not a division) after an operator, an opening bracket, a separator or `return`.
function regexAllowedAfter(out) {
  const t = out.trimEnd();
  if (!t) return true;
  return '(,=:[!&|?{};~+-*%<>^'.includes(t[t.length - 1]) || /\b(?:return|typeof)$/.test(t);
}

// Index just past the regex literal that starts at src[i], or -1 when the line ends first (so it was not one).
function regexEnd(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length && src[j] !== '\n') {
    const ch = src[j];
    if (ch === '\\') j++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

// Removes // and /* */ comments. String, template and regex literals are kept as they are (so '//' inside a string survives
// and a quote inside a regex such as /'/g does not open a string). A quote still open at its line's end is dropped there.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '/' && regexAllowedAfter(out)) {
      const end = regexEnd(src, i);
      if (end > i) {
        out += src.slice(i, end);
        i = end;
      } else {
        out += c;
        i++;
      }
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') {
          out += ch + (src[i + 1] || '');
          i += 2;
        } else if (ch === c) {
          out += ch;
          i++;
          break;
        } else if (ch === '\n' && c !== '`') break;
        else {
          out += ch;
          i++;
        }
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const RE_RANDOM = /\bMath\s*\.\s*random\b/;
const RE_DATE_NOW = /\bDate\s*\.\s*now\b/;
const RE_CB_ASSIGN = /\b(?:window|globalThis|self|root)\s*(?:\.\s*CB\b|\[\s*(['"])CB\1\s*\])\s*=(?!=)/;

// Every rule broken by one file, as readable lines. `file` is the path relative to the repo root.
function problems(file, src) {
  const out = [];
  const code = stripComments(src);
  const inDir = (d) => file.startsWith(d);
  if ((inDir('src/core/') || inDir('src/game/')) && RE_RANDOM.test(code)) out.push(`${file}: Math.random (use a seeded CB.createRng)`);
  if (inDir('src/game/') && RE_DATE_NOW.test(code)) out.push(`${file}: Date.now in game logic`);
  if (inDir('src/game/') && code.includes('getContext(')) out.push(`${file}: getContext( in src/game (only draw code may touch a canvas, and it is handed r)`);
  if (path.basename(file) !== 'ns.js') {
    if (!/^\/\//.test(src.replace(/^﻿/, ''))) out.push(`${file}: the first line must be a // comment`);
    const t = code.trim();
    if (!t.startsWith('(function (CB) {')) out.push(`${file}: must open with "(function (CB) {" after its header comment`);
    if (!t.endsWith('})(window.CB);')) out.push(`${file}: must end with "})(window.CB);"`);
    if (RE_CB_ASSIGN.test(code)) out.push(`${file}: assigns window.CB (only ns.js may)`);
  }
  return out;
}

const LIST = H.scriptList();
const exists = (f) => fs.existsSync(path.join(H.ROOT, f));
const read = (f) => fs.readFileSync(path.join(H.ROOT, f), 'utf8');

// ---- the rules themselves, on synthetic sources ---------------------------------------------------------------------------

const GOOD = "// A header.\n(function (CB) {\n  'use strict';\n  CB.x = 1;\n})(window.CB);\n";

test('lint: stripComments drops comments but keeps strings, apostrophe regexes and line numbers', () => {
  assert.equal(stripComments('a // Math.random()\nb'), 'a \nb');
  assert.equal(stripComments('a /* Date.now\n x */ b'), 'a \n b');
  assert.equal(stripComments("const u = 'http://x.y'; // gone"), "const u = 'http://x.y'; ");
  assert.equal(stripComments('const s = "a // b"; // c'), 'const s = "a // b"; ');
  assert.equal(stripComments('const s = `x // ${y}`; // c'), 'const s = `x // ${y}`; ');
  assert.equal(stripComments("s.replace(/'/g, '&#39;'); // it's"), "s.replace(/'/g, '&#39;'); ", 'an apostrophe regex does not swallow the line');
  assert.equal(stripComments("x = 'it\\'s'; // c"), "x = 'it\\'s'; ", 'escaped quotes');
  assert.equal(stripComments('x = 1 / 2; y = 3 / 4;'), 'x = 1 / 2; y = 3 / 4;', 'division is not a comment');
  assert.equal(stripComments("x = (a + b) / c; // 'q"), 'x = (a + b) / c; ', 'division after a bracket');
  assert.equal(stripComments("ok = /[/']+x/g.test(s); // it's"), "ok = /[/']+x/g.test(s); ", 'a slash and a quote inside a regex class');
  assert.equal(stripComments("return /\\//.test(s); // c"), "return /\\//.test(s); ", 'an escaped slash');
  assert.equal(stripComments('a\n// c1\n// c2\nb').split('\n').length, 4, 'line count kept');
});

test('lint: the rules accept a well-formed file and name every violation in a bad one', () => {
  assert.deepEqual(problems('src/game/a.js', GOOD), []);
  const bad = (src, file) => problems(file || 'src/game/a.js', src);
  assert.match(bad(GOOD.replace('CB.x = 1;', 'CB.x = Math.random();'))[0], /Math\.random/);
  assert.match(bad(GOOD.replace('CB.x = 1;', 'CB.x = Math . random();'), 'src/core/a.js')[0], /Math\.random/, 'also in src/core, and with spaces');
  assert.deepEqual(bad(GOOD.replace('CB.x = 1;', 'CB.x = Math.random();'), 'src/art/a.js'), [], 'the renderer side is not covered');
  assert.deepEqual(bad(GOOD.replace('CB.x = 1;', '// Math.random() and Date.now() are banned\n  CB.x = 1;')), [], 'comments do not count');
  assert.match(bad(GOOD.replace('CB.x = 1;', 'CB.t = Date.now();'))[0], /Date\.now/);
  assert.deepEqual(bad(GOOD.replace('CB.x = 1;', 'CB.t = Date.now();'), 'src/scenes/a.js'), [], 'Date.now is fine outside src/game');
  assert.match(bad(GOOD.replace('CB.x = 1;', "const c = canvas.getContext('2d');"))[0], /getContext\(/);
  assert.deepEqual(bad(GOOD.replace('CB.x = 1;', "const c = canvas.getContext('2d');"), 'src/art/render.js'), [], 'the renderer owns the context');
  assert.match(bad('var x;\n' + GOOD).join('\n'), /first line/, 'code before the header comment');
  assert.match(bad(GOOD.replace('// A header.\n', '')).join('\n'), /first line/, 'no header comment at all');
  assert.match(bad('// h\n(function () {\n})(window.CB);\n')[0], /must open with/);
  assert.match(bad(GOOD + 'CB.late = 1;\n').join('\n'), /must end with/);
  assert.match(bad(GOOD.replace('CB.x = 1;', 'window.CB = {};')).join('\n'), /assigns window\.CB/);
  assert.match(bad(GOOD.replace('CB.x = 1;', "window['CB'] = {};")).join('\n'), /assigns window\.CB/);
  assert.match(bad(GOOD.replace('CB.x = 1;', 'globalThis.CB = {};')).join('\n'), /assigns window\.CB/);
  assert.deepEqual(bad(GOOD.replace('CB.x = 1;', 'if (window.CB === CB) CB.x = window.CB_NO_BOOT;')), [], 'reading it, or window.CB_NO_BOOT, is fine');
  assert.deepEqual(bad('// h\n(function (root) {\n  root.CB = {};\n})(window);\n', 'src/core/ns.js'), [], 'ns.js has its own shape');
});

// ---- the real scripts -------------------------------------------------------------------------------------------------------

test('lint: index.html lists each script once, under src/, as .js', () => {
  assert.ok(LIST.length > 0);
  assert.equal(new Set(LIST).size, LIST.length, 'no script is listed twice');
  for (const f of LIST) assert.match(f, /^src\/.+\.js$/, f);
  assert.equal(LIST[0], 'src/core/ns.js', 'the namespace is created first');
});

test('lint: every listed script exists (only the known unbuilt Phase B ones may be missing for now)', (t) => {
  const missing = LIST.filter((f) => !exists(f));
  const allowed = STRICT ? [] : NOT_BUILT_YET;
  assert.deepEqual(missing.filter((f) => !allowed.includes(f)), [], 'listed in index.html but not on disk');
  for (const f of NOT_BUILT_YET) assert.ok(LIST.includes(f), `${f} is in NOT_BUILT_YET but index.html does not list it (typo, or the list is stale)`);
  t.diagnostic(`${missing.length} listed script(s) not written yet`);
});

test('lint: no Math.random in src/core or src/game, no Date.now in src/game, no getContext( in src/game', () => {
  const found = [];
  for (const f of LIST.filter(exists)) {
    for (const p of problems(f, read(f))) if (/Math\.random|Date\.now|getContext\(/.test(p)) found.push(p);
  }
  assert.deepEqual(found, []);
});

test('lint: every script opens with a // comment and the (function (CB) { ... })(window.CB); shape (ns.js excepted)', () => {
  const found = [];
  for (const f of LIST.filter(exists)) {
    for (const p of problems(f, read(f))) if (/first line|must open|must end/.test(p)) found.push(p);
  }
  assert.deepEqual(found, []);
});

test('lint: only ns.js creates window.CB', () => {
  const found = [];
  for (const f of LIST.filter(exists)) {
    for (const p of problems(f, read(f))) if (/assigns window\.CB/.test(p)) found.push(p);
  }
  assert.deepEqual(found, []);
  assert.match(stripComments(read('src/core/ns.js')), /root\.CB\s*=\s*CB/, 'ns.js is the one place that does');
});

test('lint: the whole set at once reports nothing', () => {
  const all = [];
  for (const f of LIST.filter(exists)) all.push(...problems(f, read(f)));
  assert.deepEqual(all, []);
});

// ---- more ways to play (+ daily, share and the first-run hints): 52 scripts, in an order that lets input.js find its helpers -----------------------------------------------

test('lint: index.html lists 52 scripts, with prompts, gamepad and touch before input.js and haptics, daily and share between input.js and audio.js', () => {
  assert.equal(LIST.length, 52);
  const at = (f) => {
    const i = LIST.indexOf(f);
    assert.ok(i >= 0, f + ' is listed');
    return i;
  };
  const render = at('src/art/render.js');
  assert.deepEqual(
    LIST.slice(render, render + 9),
    ['src/art/render.js', 'src/core/prompts.js', 'src/core/gamepad.js', 'src/core/touch.js', 'src/core/input.js', 'src/core/haptics.js', 'src/core/daily.js', 'src/core/share.js', 'src/core/audio.js'],
    'the order the plan fixes'
  );
  // The first-run hints read the palette when they load and CB.Save / CB.Prompts when they run, and the play scene that calls them comes later.
  const hints = at('src/game/hints.js');
  for (const dep of ['src/art/palette.js', 'src/art/font.js', 'src/core/prompts.js', 'src/game/unlocks.js']) assert.ok(hints > at(dep), 'hints.js after ' + dep);
  assert.ok(hints < at('src/scenes/play.js'), 'hints.js before the play scene');
});

test('lint: input.js and main.js never read a clock or a random source (input timing is event.timeStamp)', () => {
  for (const f of ['src/core/input.js', 'src/main.js']) {
    const code = stripComments(read(f));
    assert.doesNotMatch(code, /\bMath\s*\.\s*random\b/, f + ': Math.random');
    assert.doesNotMatch(code, /\bDate\s*\.\s*now\b/, f + ': Date.now');
    assert.doesNotMatch(code, /\bperformance\s*\.\s*now\b/, f + ': performance.now');
  }
});

test('lint: input.js reaches the platform only through the window it was given (a fake window has to be enough)', () => {
  const code = stripComments(read('src/core/input.js'));
  // `win.navigator`, `win.document`, `win.screen` are fine; a bare `navigator.`, `document.` or `screen.` would bypass the test window.
  assert.doesNotMatch(code, /(?<![.\w$])(?:navigator|document|screen|localStorage)\s*\./, 'a free platform global');
  assert.doesNotMatch(code, /(?<![.\w$])(?:addEventListener|removeEventListener|getGamepads|matchMedia)\s*\(/, 'a free platform function');
});
