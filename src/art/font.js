// 5x7 bitmap font: the glyph table plus measure, wrap and pixel-exact draw for the 320x180 renderer.
(function (CB) {
  'use strict';
  const CELL_H = 7;
  const LINE_H = 9;
  const SPACE_W = 3;
  const OWN = Object.prototype.hasOwnProperty;

  // Each sheet names its characters, then gives 7 rows with one token per character in that order ('#' lit, '.' unlit).
  // Baseline is row 6. Caps and digits fill rows 0-6 and digits are all 5 wide so a ticking timer does not jiggle.
  // Lowercase sits in rows 2-6, ascenders (b d f h k l t) and dots (i j) climb higher. The cell has no room below the
  // baseline, so g p q y keep the x-height and put their tail on row 6 (raised bowls made p read as P and q as 9).
  const SHEETS = [
    ['ABCDEFGHI', [
      '.###. ####. .###. ####. ##### ##### .###. #...# ###',
      '#...# #...# #...# #...# #.... #.... #...# #...# .#.',
      '#...# #...# #.... #...# #.... #.... #.... #...# .#.',
      '##### ####. #.... #...# ####. ####. #.### ##### .#.',
      '#...# #...# #.... #...# #.... #.... #...# #...# .#.',
      '#...# #...# #...# #...# #.... #.... #...# #...# .#.',
      '#...# ####. .###. ####. ##### #.... .###. #...# ###',
    ]],
    ['JKLMNOPQR', [
      '..### #...# #.... #...# #...# .###. ####. .###. ####.',
      '...#. #..#. #.... ##.## #...# #...# #...# #...# #...#',
      '...#. #.#.. #.... #.#.# ##..# #...# #...# #...# #...#',
      '...#. ##... #.... #.#.# #.#.# #...# ####. #...# ####.',
      '...#. #.#.. #.... #...# #..## #...# #.... #.#.# #.#..',
      '#..#. #..#. #.... #...# #...# #...# #.... #..#. #..#.',
      '.##.. #...# ##### #...# #...# .###. #.... .##.# #...#',
    ]],
    ['STUVWXYZ', [
      '.#### ##### #...# #...# #...# #...# #...# #####',
      '#.... ..#.. #...# #...# #...# #...# #...# ....#',
      '#.... ..#.. #...# #...# #...# .#.#. .#.#. ...#.',
      '.###. ..#.. #...# #...# #.#.# ..#.. ..#.. ..#..',
      '....# ..#.. #...# #...# #.#.# .#.#. ..#.. .#...',
      '....# ..#.. #...# .#.#. #.#.# #...# ..#.. #....',
      '####. ..#.. .###. ..#.. .#.#. #...# ..#.. #####',
    ]],
    ['abcdefghi', [
      '.... #... ... ...# .... .## .... #... #',
      '.... #... ... ...# .... #.. .... #... .',
      '.##. ###. .## .### .##. ### .### ###. #',
      '...# #..# #.. #..# #..# #.. #..# #..# #',
      '.### #..# #.. #..# #### #.. #..# #..# #',
      '#..# #..# #.. #..# #... #.. .### #..# #',
      '.### ###. .## .### .### #.. ###. #..# #',
    ]],
    ['jklmnopqr', [
      '..# #... #. ..... .... .... .... .... ...',
      '... #... #. ..... .... .... .... .... ...',
      '..# #..# #. ##.#. ###. .##. ###. .### #.#',
      '..# #.#. #. #.#.# #..# #..# #..# #..# ##.',
      '..# ##.. #. #.#.# #..# #..# #..# #..# #..',
      '..# #.#. #. #.#.# #..# #..# ###. .### #..',
      '##. #..# .# #.#.# #..# .##. #... ...# #..',
    ]],
    ['stuvwxyz', [
      '.... ... .... ..... ..... ..... .... ....',
      '.... .#. .... ..... ..... ..... .... ....',
      '.### ### #..# #...# #...# #...# #..# ####',
      '#... .#. #..# #...# #...# .#.#. #..# ...#',
      '.##. .#. #..# #...# #.#.# ..#.. #..# .##.',
      '...# .#. #..# .#.#. #.#.# .#.#. .### #...',
      '###. .## .### ..#.. .#.#. #...# ###. ####',
    ]],
    ['0123456789', [
      '.###. ..#.. .###. .###. ...#. ##### ..##. ##### .###. .###.',
      '#...# .##.. #...# #...# ..##. #.... .#... ....# #...# #...#',
      '#..## ..#.. ....# ....# .#.#. ####. #.... ...#. #...# #...#',
      '#.#.# ..#.. ...#. ..##. #..#. ....# ####. ..#.. .###. .####',
      '##..# ..#.. ..#.. ....# ##### ....# #...# .#... #...# ....#',
      '#...# ..#.. .#... #...# ...#. #...# #...# .#... #...# ...#.',
      '.###. .###. ##### .###. ...#. .###. .###. .#... .###. .##..',
    ]],
    [".,:;!?'\"-_", [
      '. .. . .. # .###. # #.# ... .....',
      '. .. . .. # #...# # #.# ... .....',
      '. .. # .# # ....# . ... ... .....',
      '. .. . .. # ...#. . ... ### .....',
      '. .. . .. # ..#.. . ... ... .....',
      '. ## # .# . ..... . ... ... .....',
      '# #. . #. # ..#.. . ... ... #####',
    ]],
    ["/\\()[]{}<>", [
      '...# #... ..# #.. ## ## .## ##. ... ...',
      '...# #... .#. .#. #. .# .#. .#. ..# #..',
      '..#. .#.. #.. ..# #. .# .#. .#. .#. .#.',
      '..#. .#.. #.. ..# #. .# #.. ..# #.. ..#',
      '.#.. ..#. #.. ..# #. .# .#. .#. .#. .#.',
      '.#.. ..#. .#. .#. #. .# .#. .#. ..# #..',
      '#... ...# ..# #.. ## ## .## ##. ... ...',
    ]],
    ['=+*#%&@~|^$`', [
      '.... ..... ..... .#.#. ##..# .##.. .###. ..... # ..#.. ..#.. #.',
      '.... ..#.. ..#.. .#.#. ##..# #..#. #...# ..... # .#.#. .#### .#',
      '#### ..#.. #.#.# ##### ...#. #.#.. #.### .#..# # #...# #.#.. ..',
      '.... ##### .###. .#.#. ..#.. .#... #.#.# #.##. # ..... .###. ..',
      '#### ..#.. #.#.# ##### .#... #.#.# #.### ..... # ..... ..#.# ..',
      '.... ..#.. ..#.. .#.#. #..## #..#. #.... ..... # ..... ####. ..',
      '.... ..... ..... .#.#. #..## .##.# .#### ..... # ..... ..#.. ..',
    ]],
    ['✓⚠✻♥·—×→…', [
      '..... ..... ..... ..... .. ..... ... ..... .....',
      '....# ..... #.#.# .#.#. .. ..... ... ..#.. .....',
      '....# ..#.. .###. ##### .. ..... #.# ...#. .....',
      '...#. .###. ##### ##### ## ##### .#. ##### .....',
      '#..#. .#.#. .###. .###. ## ..... #.# ...#. .....',
      '.##.. ##.## #.#.# ..#.. .. ..... ... ..#.. .....',
      '..#.. ##### ..... ..... .. ..... ... ..... #.#.#',
    ]],
  ];

  const GLYPHS = {};
  const WIDTH = {};
  const PIXELS = {}; // char -> flat [col, row, col, row, ...] of its lit pixels, so draw never rescans strings

  function addGlyph(ch, rows) {
    const w = rows[0].length;
    if (rows.length !== CELL_H || w < 1 || w > 5) throw new Error('font: glyph ' + JSON.stringify(ch) + ' must be ' + CELL_H + ' rows, 1-5 wide');
    const px = [];
    rows.forEach((row, r) => {
      if (row.length !== w || !/^[.#]+$/.test(row)) throw new Error('font: glyph ' + JSON.stringify(ch) + ' row ' + r + ' is ragged or not . and #');
      for (let c = 0; c < w; c++) if (row[c] === '#') px.push(c, r);
    });
    GLYPHS[ch] = rows;
    WIDTH[ch] = w;
    PIXELS[ch] = px;
  }

  for (const sheet of SHEETS) {
    const keys = Array.from(sheet[0]);
    if (sheet[1].length !== CELL_H) throw new Error('font: sheet ' + JSON.stringify(sheet[0]) + ' needs ' + CELL_H + ' rows');
    const cols = sheet[1].map((row) => row.split(' '));
    for (const c of cols) if (c.length !== keys.length) throw new Error('font: sheet ' + JSON.stringify(sheet[0]) + ' has a row with ' + c.length + ' glyphs, expected ' + keys.length);
    keys.forEach((ch, i) => addGlyph(ch, cols.map((c) => c[i])));
  }
  addGlyph(' ', new Array(CELL_H).fill('.'.repeat(SPACE_W)));

  const asText = (str) => (str == null ? '' : String(str));
  const scaleOf = (s) => (typeof s === 'number' && s > 0 ? s : 1);
  // Unknown characters take the width and look of '?'.
  const known = (ch) => (OWN.call(GLYPHS, ch) ? ch : '?');

  // Width in unscaled pixels: every glyph advances by its width plus 1, minus the trailing gap.
  function units(str) {
    let n = 0;
    for (const ch of asText(str)) n += WIDTH[known(ch)] + 1;
    return n > 0 ? n - 1 : 0;
  }

  function measure(str, scale) {
    return units(str) * scaleOf(scale);
  }

  function has(ch) {
    return typeof ch === 'string' && OWN.call(GLYPHS, ch);
  }

  // One fillRect per lit pixel. Callers cache the result (the renderer bakes each string once), so no batching.
  function draw(ctx, str, x, y, color, scale) {
    const sc = scaleOf(scale);
    ctx.fillStyle = color;
    let cx = x;
    for (const ch of asText(str)) {
      const k = known(ch);
      const px = PIXELS[k];
      for (let i = 0; i < px.length; i += 2) ctx.fillRect(cx + px[i] * sc, y + px[i + 1] * sc, sc, sc);
      cx += (WIDTH[k] + 1) * sc;
    }
  }

  // Greedy word wrap on spaces ('\n' forces a break). A word wider than maxWidth is hard-broken, one glyph per line at worst.
  function wrap(str, maxWidth, scale) {
    const sc = scaleOf(scale);
    const fits = (s) => units(s) * sc <= maxWidth;
    const out = [];
    for (const para of asText(str).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        if (!word) continue;
        if (line) {
          if (fits(line + ' ' + word)) {
            line += ' ' + word;
            continue;
          }
          out.push(line);
          line = '';
        }
        let rest = Array.from(word);
        while (rest.length > 1 && !fits(rest.join(''))) {
          let n = 1;
          while (fits(rest.slice(0, n + 1).join(''))) n++;
          out.push(rest.slice(0, n).join(''));
          rest = rest.slice(n);
        }
        line = rest.join('');
      }
      out.push(line);
    }
    return out;
  }

  CB.Font = { GLYPHS, CELL_H, LINE_H, measure, draw, wrap, has };
})(window.CB);
