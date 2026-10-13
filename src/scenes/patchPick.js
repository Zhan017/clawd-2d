// Patch pick screen: three cards (icon, name, description, stack pips, key hint) that slide in one after another, plus mouse hit-testing.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const CARD_STEP = 0.15; // card i arrives this long after card i - 1...
  const SLIDE_T = 0.3; // ...and slides up over this long, so the last one is in place by 0.6 s
  const SLIDE_PX = 8;
  const LIFT_PX = 2; // the hovered card
  const PAD = 4; // text sits this far inside the card
  const ICON_DY = 20; // icon centre below the card top
  const NAME_DY = 37;
  const DESC_DY = 47;
  const LINE_H = 8;
  const PIP_DY = 83;
  const PIP_STEP = 8;
  const HINT_DY = 90;

  // 12x12 icons, one per patch, in the colour Fx.celebrate bursts in. Ink outline, a highlight and two or more shades each.
  // Spread: three orbs in a triangle.
  CB.Art.defineSprite('patch_spread', [
    '.....kk.....',
    '....kwck....',
    '...kwccCk...',
    '...kcccCk...',
    '....kCCk....',
    '.....kk.....',
    '..kk....kk..',
    '.kwck..kwck.',
    'kwccCkkwccCk',
    'kcccCkkcccCk',
    '.kCCk..kCCk.',
    '..kk....kk..',
  ]);
  // Rapid Fire: a lightning bolt.
  CB.Art.defineSprite('patch_rapid', [
    '.....kkkk...',
    '....kwyyYk..',
    '...kwyyYk...',
    '..kwyyYk....',
    '.kwyyYkkkk..',
    'kwyyyyyyyYk.',
    '.kkkkwyyYk..',
    '...kwyyYk...',
    '..kwyyYk....',
    '.kwyyYk.....',
    '.kwYkk......',
    '..kk........',
  ]);
  // Pierce: an arrow that has gone right through a wall.
  CB.Art.defineSprite('patch_pierce', [
    '....kk......',
    '...ksSkk....',
    '.k.ksSkwk...',
    'kPkksSkppk..',
    'kPPksSkpwpk.',
    'kppppppppppk',
    'kPPPPPPPPPPk',
    'kPPksSkpPPk.',
    'kPkksSkpPk..',
    '.k.ksSkPk...',
    '...ksSkk....',
    '....kk......',
  ]);
  // Heavy Bolts: the spark diamond, big.
  CB.Art.defineSprite('patch_heavy', [
    '.....kk.....',
    '....kzzk....',
    '...kzwzfk...',
    '..kzwzzffk..',
    '.kzwzzfffOk.',
    'kzwzzfffffOk',
    'kzzzfffffOOk',
    '.kzfffffOOk.',
    '..kffffOOk..',
    '...kffOOk...',
    '....kOOk....',
    '.....kk.....',
  ]);
  CB.Art.defineSprite('patch_heart', [
    '............',
    '.kkkk..kkkk.',
    'krrwrkkrrrrk',
    'krwrrrrrrrRk',
    'krrrrrrrrrRk',
    'krrrrrrrrRRk',
    '.krrrrrrRRk.',
    '..krrrrRRk..',
    '...krrRRk...',
    '....krRk....',
    '.....kk.....',
    '............',
  ]);
  // Quick Dash: a double chevron, the rear one dim.
  CB.Art.defineSprite('patch_dash', [
    '.kk..kk.....',
    'kCCkkwck....',
    '.kCCkkcck...',
    '..kCCkkcck..',
    '...kCCkkcck.',
    '....kCCkkcck',
    '....kCCkkcck',
    '...kCCkkcck.',
    '..kCCkkcck..',
    '.kCCkkcck...',
    'kCCkkwck....',
    '.kk..kk.....',
  ]);
  // Ricochet: a spark that came in dim, hit the floor and left bright.
  CB.Art.defineSprite('patch_ricochet', [
    '.........k..',
    '........kgk.',
    '.......kgwgk',
    '.kk.....kgk.',
    'kGGk....kggk',
    '.kGGk..kggk.',
    '..kGGkkggk..',
    '...kGGggk...',
    '.kkkkwwkkkk.',
    'kssssssssssk',
    'kSSSSSSSSSSk',
    '.kkkkkkkkkk.',
  ]);

  const CARDS = Object.freeze([
    Object.freeze({ x: 22, y: 44, w: 84, h: 100 }),
    Object.freeze({ x: 118, y: 44, w: 84, h: 100 }),
    Object.freeze({ x: 214, y: 44, w: 84, h: 100 }),
  ]);

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const easeOutCubic = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
  const lockT = () => (CB.RUN_T && typeof CB.RUN_T.inputLock === 'number' ? CB.RUN_T.inputLock : 0.6);

  // Which card the point is on (0..2), or -1. Uses the resting rectangles: sliding and lifting never move the hit boxes.
  function cardAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    for (let i = 0; i < CARDS.length; i++) {
      const c = CARDS[i];
      if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return i;
    }
    return -1;
  }

  function stagePalette(run) {
    const P = CB.Pal.STAGES;
    const stage = (CB.STAGES && CB.STAGES[num(run.stageIndex, 0)]) || (run.world && run.world.stage) || null;
    return (stage && (P[stage.palette] || P[stage.id])) || P.src;
  }

  // Greedy word wrap to the card's text width; the font does the measuring.
  function wrap(str, maxW) {
    return CB.Font && typeof CB.Font.wrap === 'function' ? CB.Font.wrap(String(str), maxW, 1) : [String(str)];
  }

  // Stack pips: a disc for each stack already owned (pale) and the one this patch adds (gold), a hollow ring for each left up to the max.
  function drawPips(r, cx, y, owned, max) {
    const have = Math.min(owned, max);
    for (let j = 0; j < max; j++) {
      const x = cx + (j - (max - 1) / 2) * PIP_STEP;
      if (j < have) r.disc(x, y, 2, C.pale);
      else if (j === have) r.disc(x, y, 2, C.gold);
      else r.ring(x, y, 2, C.grey);
    }
  }

  // The key hint at the foot of card i: [n] with a keyboard, "tap" on a phone, and [A] on the focused card only while the pad is navigating.
  function hintFor(i, hover, nav) {
    const d = CB.Prompts && CB.Prompts.device;
    if (d === 'touch') return 'tap';
    if (d === 'pad') return hover && nav ? '[A]' : '';
    return '[' + (i + 1) + ']';
  }

  function drawCard(r, run, i, id, st, hover, pal, nav) {
    const def = CB.Patches && CB.Patches.DEFS && CB.Patches.DEFS[id];
    const start = CARD_STEP * i;
    if (!def || st < start) return;
    const c = CARDS[i];
    const k = clamp((st - start) / SLIDE_T, 0, 1);
    const y = c.y + Math.round(SLIDE_PX * (1 - easeOutCubic(k))) - (hover ? LIFT_PX : 0);
    const cx = c.x + c.w / 2;
    if (hover) {
      r.frame(c.x - 2, y - 2, c.w + 4, c.h + 4, C.gold);
      r.frame(c.x - 1, y - 1, c.w + 2, c.h + 2, C.gold);
    }
    r.rect(c.x, y, c.w, c.h, pal.wall);
    r.rect(c.x + 1, y + 1, c.w - 2, 1, pal.wallHi);
    r.rect(c.x + 1, y + c.h - 2, c.w - 2, 1, pal.wallLo);
    r.frame(c.x, y, c.w, c.h, C.ink);
    r.alpha(0.45, () => r.rect(cx - 14, y + 6, 28, 28, C.ink));
    if (CB.Art.hasSprite('patch_' + id)) r.sprite('patch_' + id, cx, y + ICON_DY, { scale: 2 });
    const name = wrap(def.name, c.w - 2 * PAD).slice(0, 2);
    name.forEach((l, j) => r.text(l, cx, y + NAME_DY + LINE_H * j, { color: C.white, shadow: C.ink, align: 'center' }));
    const room = name.length > 1 ? 3 : 4;
    const desc = wrap(def.desc, c.w - 2 * PAD).slice(0, room);
    desc.forEach((l, j) => r.text(l, cx, y + DESC_DY + LINE_H * (name.length - 1) + LINE_H * j, { color: C.pale, align: 'center' }));
    drawPips(r, cx, y + PIP_DY, (run.patches && run.patches[id]) | 0, def.max);
    const hint = hintFor(i, hover, nav);
    if (hint) r.text(hint, cx, y + HINT_DY, { color: hover ? C.white : C.grey, align: 'center' });
  }

  function draw(r, run, t, ui) {
    const st = num(run.stateT, 0);
    const lock = lockT();
    r.alpha(0.75, () => r.rect(0, 0, W, H, C.ink));
    r.text('PR #' + (num(run.stageIndex, 0) + 1) + ' — choose a patch', W / 2, 24, { color: C.white, shadow: C.ink, align: 'center' });
    if (st < lock) r.text('…', W / 2, 34, { color: C.grey, align: 'center' }); // the input lock: clicks do nothing yet
    const offer = Array.isArray(run.offer) ? run.offer : [];
    const hover = ui && Number.isInteger(ui.hover) && st >= lock ? ui.hover : -1; // no highlight while a click would be ignored
    const nav = !!(ui && ui.nav); // the pad (or the arrow keys) moved the focus: show [A] on the focused card
    const pal = stagePalette(run);
    for (let i = 0; i < CARDS.length && i < offer.length; i++) drawCard(r, run, i, offer[i], st, hover === i, pal, nav);
  }

  CB.Screens.patchPick = { CARDS, cardAt, draw };
})(window.CB);
