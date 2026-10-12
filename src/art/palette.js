// Named colours, the single-character sprite palette, and per-stage arena palettes.
(function (CB) {
  'use strict';
  const C = {
    clawd: '#D97757', clawdDark: '#A8513A', clawdLight: '#F2A07E',
    ink: '#14121A', white: '#FFFFFF', offwhite: '#E8E6F0',
    red: '#E0484D', redDark: '#8C2233', yellow: '#F2C94C', yellowDark: '#A37B12',
    green: '#5DBB63', greenDark: '#2C6B35', blue: '#4F8CE0', blueDark: '#23477E',
    purple: '#9A6BE0', purpleDark: '#4B2D7A', cyan: '#5FD4E0', cyanDark: '#2A7F8A',
    magenta: '#E055B0', magentaDark: '#7A2463', grey: '#9AA3B5', greyDark: '#4A5163',
    slate: '#2A2E3A', pale: '#C8CEDC', bullet: '#FF4F8B', bulletCore: '#FFE3EE', spark: '#FFB38A',
    gold: '#FFD27A', ember: '#FF8A5C', hurt: '#FF3355',
  };
  const CHARS = {
    '.': null,
    o: C.clawd, O: C.clawdDark, h: C.clawdLight,
    k: C.ink, w: C.white, W: C.offwhite,
    r: C.red, R: C.redDark, y: C.yellow, Y: C.yellowDark,
    g: C.green, G: C.greenDark, b: C.blue, B: C.blueDark,
    p: C.purple, P: C.purpleDark, c: C.cyan, C: C.cyanDark,
    m: C.magenta, M: C.magentaDark, s: C.grey, S: C.greyDark,
    d: C.slate, e: C.pale, x: C.bullet, X: C.bulletCore, z: C.spark,
    q: C.gold, f: C.ember,
  };
  const STAGES = {
    src: { floor: '#151922', floorLine: '#1A1F2A', wall: '#2B374B', wallHi: '#4A5D7C', wallLo: '#1C2433', lineNo: '#3D4A61', accent: '#7FA7D9', code: ['#2C4266', '#4A3557', '#2C5244', '#5A4A2C', '#284E5A'] },
    node_modules: { floor: '#131A15', floorLine: '#18211A', wall: '#2C4A2E', wallHi: '#4F7A4A', wallLo: '#1A2C1C', lineNo: '#3B5A3C', accent: '#8BCF6A', code: ['#2F5230', '#4D5A2A', '#2A4A44', '#5A3F2C', '#3A3A5A'] },
    git: { floor: '#17131F', floorLine: '#1D1827', wall: '#3B2C55', wallHi: '#6A4C93', wallLo: '#231A33', lineNo: '#4D3D66', accent: '#B78CF0', code: ['#3E2E66', '#5A2E4F', '#2E4A5A', '#4F4A2C', '#2E5A3E'] },
    prod: { floor: '#1C1214', floorLine: '#231618', wall: '#55232A', wallHi: '#9C3A44', wallLo: '#33151A', lineNo: '#6A3A40', accent: '#FF6B6B', pulse: true, code: ['#5A2A2E', '#5A452A', '#4A2A4A', '#2E3A5A', '#5A2A44'] },
  };
  CB.Pal = { C, CHARS, STAGES };
})(window.CB);
