'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

function setup() {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js'], { returnSandbox: true });
  CB.Font = CB.Font || { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  return { CB, r, w: CB.createWorld({ seed: 2 }) };
}

test('look: expression sprites exist at 16x12 and the original names are unchanged', () => {
  const { CB } = setup();
  for (const pose of ['idle0', 'idle1', 'walk0', 'walk2']) {
    for (const ex of ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried']) {
      const d = CB.Art.spriteDef(`clawd_${pose}_${ex}`);
      assert.ok(d, `${pose} ${ex}`);
      assert.equal(d.w, 16);
      assert.equal(d.h, 12);
    }
  }
  assert.deepEqual(H.plain(CB.Art.spriteDef('clawd_idle0').rows), H.plain(CB.Art.spriteDef('clawd_idle0_normal').rows));
});

test('look: expression priority', () => {
  const { CB, w } = setup();
  const p = w.player;
  assert.equal(CB.Player.expression(p), 'normal');
  p.idleT = 3;
  assert.equal(CB.Player.expression(p), 'squint');
  p.hearts = 1;
  assert.equal(CB.Player.expression(p), 'worried');
  p.dashT = 0.1;
  assert.equal(CB.Player.expression(p), 'angry');
  p.hurtT = 0.9;
  assert.equal(CB.Player.expression(p), 'hurt');
});

test('look: pose is (1,1) at rest and stays within 0.7..1.3', () => {
  const { CB, w } = setup();
  const p = w.player;
  assert.deepEqual(H.plain(CB.Player.pose(p)), { sx: 1, sy: 1 });
  for (const s of [{ dashT: 0.1, dashDX: 1, dashDY: 0 }, { dashT: 0.1, dashDX: 0, dashDY: 1 }, { hurtT: 0.95 }, { kick: 1 }]) {
    const q = CB.Player.pose(Object.assign({}, p, s));
    assert.ok(q.sx >= 0.7 && q.sx <= 1.3 && q.sy >= 0.7 && q.sy <= 1.3, JSON.stringify(q));
  }
});

test('look: recoil kicks and decays without moving the hitbox; idle timer grows and resets', () => {
  const { CB, w } = setup();
  const p = w.player;
  const x0 = p.x;
  H.stepN(w, 1, () => H.makeInput({ fire: true, aimX: 300, aimY: p.y }));
  assert.ok(p.kick > 0.7);
  H.stepN(w, 8, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.equal(p.kick, 0);
  assert.equal(p.x, x0);
  H.stepN(w, 180, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.ok(p.idleT > 2.5);
  H.stepN(w, 1, () => H.makeInput({ moveX: 1 }));
  assert.equal(p.idleT, 0);
});

test('look: draw with every expression, the bubble and every hat runs headless', () => {
  const { CB, r, w } = setup();
  const p = w.player;
  p.idleT = 3;
  for (const ex of ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried']) CB.Player.draw(p, r, 1.2, { expr: ex });
  for (const id of ['loopcap', 'slime', 'branch', 'shades', 'crown', 'sudo', 'halo']) {
    assert.ok(CB.Art.hasSprite('hat_' + id), id);
    CB.Player.drawHat(r, 100, 100, id, -1, 2);
  }
});

// ---- beyond the plan: sprites, rev 3 (cheer, calm), pose maths, draw placement and the hats ----------------------------------

const OLD_BODY = [
  '..ohhhhhhhhhho..',
  '..oooooooooooo..',
  '..ooookooookoo..',
  '..ooookooookoo..',
  'oooooooooooooooo',
  'oooooooooooooooo',
  '..oooooooooooo..',
  '..OOOOOOOOOOOO..',
];
const BLANK = '................';
const LEG = '...O.O....O.O...';
const POSES = {
  idle0: [BLANK, ...OLD_BODY, LEG, LEG, BLANK],
  idle1: [BLANK, BLANK, ...OLD_BODY, LEG, BLANK],
  walk0: [BLANK, ...OLD_BODY, LEG, '...O......O.....', BLANK],
  walk2: [BLANK, ...OLD_BODY, LEG, '.....O......O...', BLANK],
};
const EXPRS = ['normal', 'hurt', 'happy', 'angry', 'squint', 'worried'];
// [left eye, right eye], each as [row A, row B] over columns 5-7 and 10-12 ('.' keeps the body pixel).
const EYES = {
  normal: [['.k.', '.k.'], ['.k.', '.k.']],
  hurt: [['k.k', '.k.'], ['k.k', '.k.']],
  happy: [['.k.', 'k.k'], ['.k.', 'k.k']],
  angry: [['kk.', '.k.'], ['.kk', '.k.']],
  squint: [['...', 'kkk'], ['...', 'kkk']],
  worried: [['.k.', '.k.'], ['.k.', '.k.']],
};
const bodyStart = (pose) => (pose === 'idle1' ? 2 : 1);

test('look: the four original poses keep exactly their old pixels', () => {
  const { CB } = setup();
  for (const pose of Object.keys(POSES)) assert.deepEqual(H.plain(CB.Art.spriteDef('clawd_' + pose).rows), POSES[pose], pose);
  assert.equal(CB.Art.spriteDef('clawd_blink').h, 12);
});

test('look: each face only touches the eye cells (plus the one sweat pixel when worried)', () => {
  const { CB } = setup();
  for (const pose of Object.keys(POSES)) {
    for (const ex of EXPRS) {
      const rows = H.plain(CB.Art.spriteDef(`clawd_${pose}_${ex}`).rows);
      const expected = POSES[pose].slice();
      const top = bodyStart(pose) + 2; // BODY rows 2-3
      for (let side = 0; side < 2; side++) {
        const col = side === 0 ? 5 : 10;
        for (let i = 0; i < 2; i++) {
          const tpl = EYES[ex][side][i];
          let row = expected[top + i];
          for (let k = 0; k < 3; k++) row = row.slice(0, col + k) + (tpl[k] === 'k' ? 'k' : 'o') + row.slice(col + k + 1);
          expected[top + i] = row;
        }
      }
      if (ex === 'worried') {
        const sr = bodyStart(pose) + 1; // BODY row 1, column 13
        expected[sr] = expected[sr].slice(0, 13) + 'c' + expected[sr].slice(14);
      }
      assert.deepEqual(rows, expected, `${pose} ${ex}`);
    }
  }
});

test('look: only the worried face carries the cyan sweat pixel, and every face stays distinct', () => {
  const { CB } = setup();
  const seen = new Set();
  for (const ex of EXPRS) {
    const rows = CB.Art.spriteDef('clawd_idle0_' + ex).rows;
    const sweat = rows.join('').split('').filter((c) => c === 'c').length;
    assert.equal(sweat, ex === 'worried' ? 1 : 0, ex);
    seen.add(rows.join('|'));
  }
  assert.equal(seen.size, 6, 'all six faces are distinct images');
});

test('look: cheerT makes Clawd happy: just below hurt, above the dash and the 1-heart worry', () => {
  const { CB, w } = setup();
  const p = w.player;
  p.cheerT = 0.5;
  assert.equal(CB.Player.expression(p), 'happy');
  p.hearts = 1;
  p.idleT = 3;
  assert.equal(CB.Player.expression(p), 'happy');
  p.dashT = 0.1;
  assert.equal(CB.Player.expression(p), 'happy');
  p.hurtT = 0.9;
  assert.equal(CB.Player.expression(p), 'hurt');
  p.hurtT = 0;
  p.cheerT = 0;
  assert.equal(CB.Player.expression(p), 'angry');
});

test('look: the hurt face lasts 0.4 s after a hit, scaled to the hit length so --yolo (0.7 s) shows it too', () => {
  const { CB, w } = setup();
  const p = w.player;
  p.hurtT = 0.61;
  assert.equal(CB.Player.expression(p), 'hurt');
  p.hurtT = 0.6;
  assert.equal(CB.Player.expression(p), 'normal');
  p.hurtInvuln = 0.7;
  p.hurtT = 0.65;
  assert.equal(CB.Player.expression(p), 'hurt');
  p.hurtT = 0.29;
  assert.equal(CB.Player.expression(p), 'normal');
  p.hurtT = 0;
  assert.equal(CB.Player.expression(p), 'normal');
  p.hurtInvuln = 0.3; // a very short hit never leaves a permanent hurt face
  assert.equal(CB.Player.expression(p), 'normal');
});

test('look: expression and pose are pure and tolerate a bare player', () => {
  const { CB } = setup();
  assert.equal(CB.Player.expression({}), 'normal');
  assert.deepEqual(H.plain(CB.Player.pose({})), { sx: 1, sy: 1 });
  const p = { hurtT: 0.9, kick: 1, dashT: 0, idleT: 9 };
  const before = JSON.stringify(p);
  CB.Player.expression(p);
  CB.Player.pose(p);
  assert.equal(JSON.stringify(p), before);
});

test('look: pose values', () => {
  const { CB } = setup();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const P = (s) => CB.Player.pose(s);
  assert.deepEqual(H.plain(P({ dashT: 0.1, dashDX: 1, dashDY: 0 })), { sx: 1.3, sy: 0.8 });
  assert.deepEqual(H.plain(P({ dashT: 0.1, dashDX: -0.6, dashDY: 0.8 })), { sx: 0.8, sy: 1.3 });
  assert.deepEqual(H.plain(P({ dashT: 0.1, dashDX: 0.7071, dashDY: 0.7071 })), { sx: 1.3, sy: 0.8 }, 'a tie counts as horizontal');
  assert.deepEqual(H.plain(P({ hurtT: 1 })), { sx: 1.3, sy: 0.7 });
  const mid = P({ hurtT: 0.925 });
  assert.ok(near(mid.sx, 1.15) && near(mid.sy, 0.85), JSON.stringify(mid));
  assert.deepEqual(H.plain(P({ hurtT: 0.85 })), { sx: 1, sy: 1 });
  assert.deepEqual(H.plain(P({ hurtT: 0.7, hurtInvuln: 0.7 })), { sx: 1.3, sy: 0.7 });
  assert.deepEqual(H.plain(P({ hurtT: 0.5, hurtInvuln: 0.7 })), { sx: 1, sy: 1 });
  assert.deepEqual(H.plain(P({ kick: 0.6 })), { sx: 0.95, sy: 1.05 });
  assert.deepEqual(H.plain(P({ kick: 0.5 })), { sx: 1, sy: 1 });
  assert.deepEqual(H.plain(P({ dashT: 0.1, dashDX: 1, dashDY: 0, hurtT: 1, kick: 1 })), { sx: 1.3, sy: 0.8 }, 'the dash wins over the hurt and the kick');
  assert.deepEqual(H.plain(P({ hurtT: 1, kick: 1 })), { sx: 1.3, sy: 0.7 }, 'the hurt wins over the kick');
});

test('look: pose never leaves 0.7..1.3, even for a hurtT that is longer than hurtInvuln (a hand-built player, or --yolo)', () => {
  const { CB } = setup();
  for (const s of [{ hurtT: 1, hurtInvuln: 0.7 }, { hurtT: 5 }, { hurtT: 0.9, hurtInvuln: 0.1 }]) {
    const q = CB.Player.pose(s);
    assert.deepEqual(H.plain(q), { sx: 1.3, sy: 0.7 }, JSON.stringify(s));
    assert.equal(CB.Player.expression(s), 'hurt', JSON.stringify(s));
  }
  const yolo = CB.createWorld({ seed: 6, mode: { yolo: true } }).player;
  assert.equal(yolo.hurtInvuln, 0.7);
  yolo.hurtT = 1;
  assert.deepEqual(H.plain(CB.Player.pose(yolo)), { sx: 1.3, sy: 0.7 });
});

test('look: a new player starts with the cosmetic fields at rest', () => {
  const { w } = setup();
  const p = w.player;
  assert.equal(p.kick, 0);
  assert.equal(p.idleT, 0);
  assert.equal(p.cheerT, 0);
});

test('look: kick decays by dt*14 per tick and never goes negative; firing is what sets it', () => {
  const { CB, w } = setup();
  const p = w.player;
  p.kick = 1;
  H.stepN(w, 3, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.ok(Math.abs(p.kick - (1 - (3 * 14) / 60)) < 1e-9, `${p.kick}`);
  H.stepN(w, 20, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.equal(p.kick, 0);
  CB.Player.fire(p, w);
  assert.equal(p.kick, 1);
});

test('look: the idle timer ignores aiming but is reset by moving, firing and dashing', () => {
  const { w } = setup();
  const p = w.player;
  H.stepN(w, 30, (i) => H.makeInput({ aimX: 100 + i * 5, aimY: 50 + i }));
  assert.ok(Math.abs(p.idleT - 0.5) < 1e-9, `aiming alone keeps it growing: ${p.idleT}`);
  H.stepN(w, 1, () => H.makeInput({ fire: true, aimX: 300, aimY: p.y }));
  assert.equal(p.idleT, 0);
  H.stepN(w, 20, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.ok(p.idleT > 0.3);
  H.stepN(w, 1, () => H.makeInput({ dash: true, aimX: 300, aimY: p.y }));
  assert.equal(p.idleT, 0);
  H.stepN(w, 1, () => H.makeInput({ moveY: 1 }));
  assert.equal(p.idleT, 0);
});

test('look: cheerT counts down with the simulation clock and stops at 0', () => {
  const { w } = setup();
  const p = w.player;
  p.cheerT = 0.9;
  H.stepN(w, 20, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.ok(Math.abs(p.cheerT - (0.9 - 20 / 60)) < 1e-9, `${p.cheerT}`);
  H.stepN(w, 60, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.equal(p.cheerT, 0);
});

test('look: dash afterimages are pushed every 3rd dash tick, so the three spread across the dash', () => {
  const { w } = setup();
  const p = w.player;
  const x0 = p.x;
  H.stepN(w, 1, () => H.makeInput({ moveX: 1, dash: true, aimX: 300, aimY: p.y }));
  assert.equal(p.trail.length, 1, 'the first dash tick leaves one');
  H.stepN(w, 2, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  assert.equal(p.trail.length, 1, 'ticks 2 and 3 leave none');
  H.stepN(w, 1, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  assert.equal(p.trail.length, 2);
  H.stepN(w, 5, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  const xs = p.trail.map((g) => g.x);
  assert.equal(xs.length, 3);
  assert.ok(Math.abs(xs[0] - x0) < 1e-9);
  assert.ok(Math.abs(xs[1] - xs[0] - 13) < 0.01, `${xs}`);
  assert.ok(Math.abs(xs[2] - xs[1] - 13) < 0.01, `${xs}`);
  assert.ok(p.dashT <= 0.001);
});

test('look: a second dash starts its own 0, 3, 6 rhythm', () => {
  const { w } = setup();
  const p = w.player;
  const dash = (i) => H.makeInput({ moveX: 1, dash: i === 0, aimX: 300, aimY: p.y });
  H.stepN(w, 12, dash);
  H.stepN(w, 60, () => H.makeInput({ aimX: 300, aimY: p.y }));
  assert.equal(p.trail.length, 0);
  H.stepN(w, 1, dash);
  assert.equal(p.trail.length, 1);
  H.stepN(w, 3, () => H.makeInput({ moveX: 1, aimX: 300, aimY: p.y }));
  assert.equal(p.trail.length, 2);
});

// -- draw placement ------------------------------------------------------------------------------------------------------------

// Wraps the renderer so every sprite/text/squash/rect call is recorded; `depth` is how many squash callbacks it ran inside.
function spy(r) {
  const log = [];
  let depth = 0;
  const wrap = (k) => {
    const orig = r[k];
    r[k] = function (...a) {
      log.push({ k, a, depth });
      if (k === 'squash') {
        depth++;
        try {
          return orig.apply(r, a);
        } finally {
          depth--;
        }
      }
      return orig.apply(r, a);
    };
  };
  for (const k of ['sprite', 'text', 'squash', 'rect', 'ring']) wrap(k);
  return log;
}
const sprites = (log) => log.filter((e) => e.k === 'sprite');
const bodyCall = (log) => sprites(log).find((e) => /^clawd_/.test(e.a[0]));
const hatCall = (log) => sprites(log).find((e) => /^hat_/.test(e.a[0]));
const texts = (log) => log.filter((e) => e.k === 'text').map((e) => e.a[0]);

function quiet(CB, over) {
  // a player that is not moving, aiming at the right, on idle frame 0 and not blinking (p.t = 0.2: the blink is the first 0.12 s of every 3.2 s)
  const w = CB.createWorld({ seed: 4 });
  const p = w.player;
  p.aimX = p.x + 100;
  p.aimY = p.y;
  p.t = 0.2;
  return Object.assign(p, over || {});
}

test('look: the sprite name follows pose and expression; the plain names mean normal', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB);
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_idle0');
  log.length = 0;
  p.hearts = 1;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_worried');
  log.length = 0;
  p.hearts = 5;
  p.dashT = 0.1;
  p.dashDX = 1;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_walk0_angry');
  log.length = 0;
  p.dashT = 0;
  p.t = 0.7;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_idle1');
  log.length = 0;
  p.moving = true;
  p.walkT = 0.1;
  p.idleT = 3;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_squint', 'walkT 0.1 is the idle0 frame of the walk cycle');
});

test('look: opts.expr overrides the face; an unknown name falls back to the computed face', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { hearts: 1 });
  CB.Player.draw(p, r, 0, { expr: 'happy' });
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_happy');
  log.length = 0;
  CB.Player.draw(p, r, 0, { expr: 'normal' });
  assert.equal(bodyCall(log).a[0], 'clawd_idle0', 'an explicit normal beats the worried face');
  log.length = 0;
  CB.Player.draw(p, r, 0, { expr: 'nope' });
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_worried');
  log.length = 0;
  CB.Player.draw(p, r, 0, { expr: 'constructor' });
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_worried', 'inherited object keys are not faces');
});

test('look: the blink frame is only for the normal face', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { t: 3.25 });
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_blink');
  log.length = 0;
  CB.Player.draw(p, r, 0, { expr: 'happy' });
  assert.notEqual(bodyCall(log).a[0], 'clawd_blink');
});

test('look: recoil shifts the drawn sprite against the aim by 2 px x kick, rounded; the hitbox and shadow stay put', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB);
  CB.Player.draw(p, r, 0, {});
  const rest = bodyCall(log).a;
  assert.equal(rest[1], p.x);
  assert.equal(rest[2], p.y - 2);
  log.length = 0;
  p.kick = 1;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[1], p.x - 2, 'aiming right pushes Clawd left');
  assert.equal(bodyCall(log).a[2], p.y - 2);
  const shadow = log.find((e) => e.k === 'rect' && e.a[3] === 2);
  assert.ok(shadow, 'the shadow is still drawn');
  log.length = 0;
  p.kick = 0.4;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[1], p.x - 1, '0.8 px rounds to 1');
  log.length = 0;
  p.kick = 1;
  p.aimX = p.x - 100;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[1], p.x + 2, 'aiming left pushes Clawd right');
  log.length = 0;
  p.aimX = p.x;
  p.aimY = p.y - 100;
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[1], p.x);
  assert.equal(bodyCall(log).a[2], p.y - 2 + 2, 'aiming up pushes Clawd down');
  assert.equal(p.kick, 1, 'draw never changes state');
});

test('look: the cheer hop follows -abs(sin((0.9 - cheerT)/0.9 * 2pi)) * 5 and leaves the shadow on the ground', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB);
  const hopAt = (cheerT) => {
    log.length = 0;
    p.cheerT = cheerT;
    CB.Player.draw(p, r, 0, {});
    return p.y - 2 - bodyCall(log).a[2];
  };
  assert.equal(hopAt(0.9), 0, 'the hop starts on the ground');
  assert.equal(hopAt(0.675), 5, 'top of the first hop');
  assert.equal(hopAt(0.45), 0, 'between the hops');
  assert.equal(hopAt(0.225), 5, 'top of the second hop');
  assert.equal(hopAt(0), 0, 'no cheer, no hop');
  assert.equal(hopAt(0.8), Math.round(Math.abs(Math.sin(((0.9 - 0.8) / 0.9) * Math.PI * 2)) * 5));
  log.length = 0;
  p.cheerT = 0.675;
  CB.Player.draw(p, r, 0, {});
  assert.equal(CB.Player.expression(p), 'happy');
  assert.equal(bodyCall(log).a[0], 'clawd_idle0_happy');
  const shadow = log.find((e) => e.k === 'rect' && e.a[3] === 2);
  assert.equal(shadow.a[1], p.y + 4, 'the shadow does not hop');
});

test('look: draw squashes about the feet only while the pose is not (1,1)', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB);
  CB.Player.draw(p, r, 0, {});
  assert.equal(log.filter((e) => e.k === 'squash').length, 0);
  assert.equal(bodyCall(log).depth, 0);
  log.length = 0;
  p.dashT = 0.1;
  p.dashDX = 1;
  p.dashDY = 0;
  p.x = 100.4;
  p.y = 90.6;
  CB.Player.draw(p, r, 0, {});
  const sq = log.find((e) => e.k === 'squash');
  assert.ok(sq, 'squash was used');
  assert.deepEqual(sq.a.slice(0, 4), [100, 95, 1.3, 0.8], 'anchored at the rounded feet (x, y + 4)');
  assert.equal(bodyCall(log).depth, 1, 'the sprite is drawn inside the squash');
});

test('look: a renderer without squash still draws (no crash, no squash)', () => {
  const { CB, r } = setup();
  const log = spy(r);
  r.squash = undefined;
  const p = quiet(CB, { dashT: 0.1, dashDX: 1, dashDY: 0 });
  CB.Player.draw(p, r, 0, {});
  assert.ok(bodyCall(log));
});

test('look: the hurt blink asks CB.Comfort when it can, and falls back to the 10 Hz blink without it', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { hurtT: 0.5 });
  const asked = [];
  let hide = true;
  CB.Comfort = { blink: (t, hz) => (asked.push([t, hz]), hide) };
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log), undefined, 'hidden when Comfort says so');
  assert.deepEqual(asked, [[0.5, 20]]);
  hide = false;
  CB.Player.draw(p, r, 0, {});
  assert.ok(bodyCall(log), 'shown when it does not');
  // no Comfort, or one with no blink method: the old 10 Hz rule (hidden while floor(hurtT*20) is even)
  for (const stub of [undefined, {}]) {
    CB.Comfort = stub;
    log.length = 0;
    p.hurtT = 0.51;
    CB.Player.draw(p, r, 0, {});
    assert.equal(bodyCall(log), undefined, 'floor(10.2) is even: hidden');
    p.hurtT = 0.46;
    CB.Player.draw(p, r, 0, {});
    assert.ok(bodyCall(log), 'floor(9.2) is odd: shown');
  }
  CB.Comfort = undefined;
  log.length = 0;
  p.hurtT = 0;
  CB.Player.draw(p, r, 0, {});
  assert.ok(bodyCall(log), 'no hurt, no blink');
});

test('look: with the real calm mode the hurt blink slows to 4 Hz', () => {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js', 'src/game/comfort.js'], { returnSandbox: true });
  CB.Font = { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const log = spy(r);
  const p = quiet(CB, { hurtT: 0.3 });
  CB.Comfort.set(false);
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log), undefined, 'normal: floor(0.3 * 20) = 6 is even, hidden');
  CB.Comfort.set(true);
  CB.Player.draw(p, r, 0, {});
  assert.ok(bodyCall(log), 'calm: floor(0.3 * 4) = 1 is odd, shown');
});

test('look: the Thinking bubble shows from 2.5 s idle, in pale, with a glyph cycling at 8 Hz', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 2.4 });
  CB.Player.draw(p, r, 0, {});
  assert.deepEqual(texts(log), [], 'not yet');
  p.idleT = 2.5;
  const glyphAt = (t) => {
    log.length = 0;
    CB.Player.draw(p, r, t, {});
    const ts = texts(log);
    assert.equal(ts.length, 2, JSON.stringify(ts));
    assert.equal(ts[1], 'Thinking...');
    return ts[0];
  };
  assert.equal(glyphAt(0), '·');
  assert.equal(glyphAt(0.13), '*');
  assert.equal(glyphAt(0.26), '✻');
  assert.equal(glyphAt(0.4), '·');
  for (const e of log.filter((x) => x.k === 'text')) assert.equal(e.a[3].color, CB.Pal.C.pale);
});

test('look: the bubble is steady in place (the glyph never shifts the words), on screen and above Clawd', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3 });
  const place = (t) => {
    log.length = 0;
    CB.Player.draw(p, r, t, {});
    const ts = log.filter((e) => e.k === 'text');
    return { glyph: ts[0].a.slice(1, 3), word: ts[1].a.slice(1, 3) };
  };
  const a = place(0);
  const b = place(0.13);
  const c = place(0.26);
  assert.deepEqual(a.word, b.word);
  assert.deepEqual(b.word, c.word);
  assert.deepEqual(a.glyph, c.glyph);
  assert.ok(a.word[1] < p.y - 12, 'above the head');
  for (const [px, py] of [[13, 25], [307, 25], [160, 100]]) {
    p.x = px;
    p.y = py;
    const q = place(0);
    assert.ok(q.glyph[0] >= 0 && q.word[0] + 11 * 6 <= CB.W, `x on screen at ${px}: ${q.glyph[0]}..${q.word[0]}`);
    assert.ok(q.glyph[1] >= 0, `y on screen at ${py}`);
  }
});

test('look: a narrow glyph is centred in the widest glyph\'s cell so the star does not seem to shift', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const widths = { '·': 2, '*': 5, '✻': 5 };
  CB.Font = { CELL_H: 7, measure: (s) => (s in widths ? widths[s] : String(s).length * 4), draw() {} };
  const p = quiet(CB, { idleT: 3 });
  const place = (t) => {
    log.length = 0;
    CB.Player.draw(p, r, t, {});
    const ts = log.filter((e) => e.k === 'text');
    return { glyph: ts[0].a[0], gx: ts[0].a[1], wx: ts[1].a[1] };
  };
  const dot = place(0);
  const star = place(0.13);
  assert.equal(dot.glyph, '·');
  assert.equal(star.glyph, '*');
  assert.equal(dot.gx, star.gx + Math.round((5 - 2) / 2), 'the 2 px dot sits in the middle of the 5 px cell');
  assert.equal(dot.wx, star.wx, 'the words never move');
  assert.equal(star.wx - star.gx, 5 + 4, 'a 5 px cell and a 4 px gap');
});

test('look: calm mode caps the bubble glyph at 4 Hz', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3 });
  CB.Comfort = { calm: () => true };
  CB.Player.draw(p, r, 0.26, {});
  assert.equal(texts(log)[0], '*', 'floor(0.26 * 4) = 1');
  log.length = 0;
  CB.Comfort = { calm: () => false };
  CB.Player.draw(p, r, 0.26, {});
  assert.equal(texts(log)[0], '✻', 'floor(0.26 * 8) = 2');
  log.length = 0;
  CB.Comfort = undefined;
  CB.Player.draw(p, r, 0.26, {});
  assert.equal(texts(log)[0], '✻');
});

test('look: no bubble while dead, none for a fake player without an idle timer, and none while the hurt blink hides Clawd', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3, dead: true });
  CB.Player.draw(p, r, 0, {});
  assert.deepEqual(texts(log), []);
  p.dead = false;
  p.idleT = undefined;
  CB.Player.draw(p, r, 0, {});
  assert.deepEqual(texts(log), []);
  p.idleT = 3;
  CB.Comfort = { blink: () => true };
  p.hurtT = 0.5;
  CB.Player.draw(p, r, 0, {});
  assert.deepEqual(texts(log), [], 'hidden by the hurt blink');
  CB.Comfort = { blink: () => false };
  CB.Player.draw(p, r, 0, {});
  assert.equal(texts(log).length, 2, 'shown once the blink lets Clawd back');
});

test('look: a dead Clawd lies upside down with the hurt face and no hat', () => {
  const { CB, r } = setup();
  const log = spy(r);
  CB.Unlocks = { hat: () => 'crown' };
  const p = quiet(CB, { dead: true, hearts: 0 });
  CB.Player.draw(p, r, 0, {});
  const b = bodyCall(log);
  assert.equal(b.a[0], 'clawd_idle0_hurt');
  assert.equal(b.a[3].flipY, true);
  assert.equal(hatCall(log), undefined);
});

test('look: a bare player object (as the victory and title screens may build) draws without throwing', () => {
  const { CB, r } = setup();
  CB.Player.draw({ x: 160, y: 60, facing: 1, aimX: 200, aimY: 60 }, r, 0.5, { expr: 'happy' });
  CB.Player.draw({ x: 160, y: 60, facing: -1 }, r, 0.5);
  CB.Player.draw({ x: 160, y: 60, facing: 1, idleT: 4 }, r);
});

// -- hats ----------------------------------------------------------------------------------------------------------------------

const HATS = ['loopcap', 'slime', 'branch', 'shades', 'crown', 'sudo', 'halo'];

test('look: every hat is an 11x6 sprite with an ink outline and at least two shades', () => {
  const { CB } = setup();
  for (const id of HATS) {
    const d = CB.Art.spriteDef('hat_' + id);
    assert.ok(d, id);
    assert.equal(d.w, 11, id);
    assert.equal(d.h, 6, id);
    const px = d.rows.join('').split('').filter((c) => c !== '.');
    assert.ok(px.length >= 14, `${id}: has pixels`);
    assert.ok(px.includes('k'), `${id}: ink outline`);
    const colours = new Set(px.filter((c) => c !== 'k'));
    assert.ok(colours.size >= 2, `${id}: at least two shades, got ${[...colours].join('')}`);
    for (const c of colours) assert.ok(c in CB.Pal.CHARS, `${id}: palette char ${c}`);
  }
});

test('look: every colour a hat uses for more than a few pixels comes in two shades, and the sides are ink-outlined', () => {
  const { CB } = setup();
  // [light, dark(, extra)] families; white and the 1-2 px gems and glints are accents, not volumes.
  const families = ['bB', 'cC', 'gG', 'yYq', 'rR', 'dsSe'];
  for (const id of HATS) {
    const rows = CB.Art.spriteDef('hat_' + id).rows;
    const all = rows.join('');
    for (const fam of families) {
      const used = all.split('').filter((c) => fam.includes(c));
      if (used.length >= 6) assert.ok(new Set(used).size >= 2, `${id}: ${fam} has ${used.length} px in one shade`);
    }
    for (const row of rows) {
      const first = row.search(/[^.]/);
      if (first < 0) continue;
      assert.equal(row[first], 'k', `${id}: "${row}" starts without ink`);
      assert.equal(row[row.search(/[^.]\.*$/)], 'k', `${id}: "${row}" ends without ink`);
    }
  }
});

test('look: each hat is drawn as its own sprite name, flipped with the facing', () => {
  const { CB, r } = setup();
  const log = spy(r);
  for (const id of HATS) {
    log.length = 0;
    CB.Player.drawHat(r, 100, 100, id, -1, 2);
    const c = hatCall(log);
    assert.equal(c.a[0], 'hat_' + id);
    assert.equal(c.a[3].flip, true);
    assert.equal(c.a[3].scale, 2);
    log.length = 0;
    CB.Player.drawHat(r, 100, 100, id, 1);
    assert.equal(hatCall(log).a[3].flip, false);
    assert.equal(hatCall(log).a[3].scale, 1, 'scale defaults to 1');
  }
});

test('look: drawHat takes the slot above the head; shades drop to the eye row and the halo floats 2 px higher', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const at = (id, f, s) => {
    log.length = 0;
    CB.Player.drawHat(r, 100, 100, id, f, s);
    return hatCall(log).a;
  };
  assert.equal(at('crown', 1, 1)[2], 100);
  assert.equal(at('shades', 1, 1)[2], 105, 'eye row: 5 px below the slot');
  assert.equal(at('halo', 1, 1)[2], 98, '2 px up');
  assert.equal(at('shades', 1, 3)[2], 115, 'offsets scale with the hat');
  assert.equal(at('halo', 1, 3)[2], 94);
  assert.equal(at('crown', 1, 1)[1], 100.5, 'an 11 px hat on a 12 px head leans 1/2 px toward the facing');
  assert.equal(at('crown', -1, 1)[1], 99.5);
  assert.equal(at('crown', 1, 2)[1], 101);
  assert.equal(CB.Player.HAT_DY, -7, 'the slot is 7 px per scale above the Clawd sprite centre');
});

test('look: bad hat ids and scales are harmless', () => {
  const { CB, r } = setup();
  const log = spy(r);
  CB.Player.drawHat(r, 100, 100, 'nope', 1, 1);
  CB.Player.drawHat(r, 100, 100, undefined, 1, 1);
  CB.Player.drawHat(r, 100, 100, 'constructor', 1, 1);
  assert.equal(hatCall(log), undefined);
  CB.Player.drawHat(r, 100, 100, 'crown', 1, 0);
  CB.Player.drawHat(r, 100, 100, 'crown', 1, NaN);
  assert.deepEqual(sprites(log).map((e) => e.a[3].scale), [1, 1]);
});

test('look: Player.draw wears the hat Unlocks reports, centred over the head and on the idle bob', () => {
  const { CB, r } = setup();
  const log = spy(r);
  CB.Unlocks = { hat: () => 'crown' };
  const p = quiet(CB);
  CB.Player.draw(p, r, 0, {});
  const body = bodyCall(log).a;
  let hat = hatCall(log).a;
  assert.equal(hat[0], 'hat_crown');
  assert.equal(hat[1], body[1] + 0.5);
  assert.equal(hat[2], body[2] - 7);
  assert.equal(hat[3].flip, false);
  log.length = 0;
  p.t = 0.7; // the idle1 frame has the whole body one pixel lower
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[0], 'clawd_idle1');
  hat = hatCall(log).a;
  assert.equal(hat[2], bodyCall(log).a[2] - 7 + 1, 'the hat bobs with it');
  log.length = 0;
  p.facing = -1;
  CB.Player.draw(p, r, 0, {});
  assert.equal(hatCall(log).a[3].flip, true);
  assert.equal(hatCall(log).a[1], bodyCall(log).a[1] - 0.5);
});

test('look: the worn hat follows the recoil and the hop, and squashes with the body', () => {
  const { CB, r } = setup();
  const log = spy(r);
  CB.Unlocks = { hat: () => 'slime' };
  const p = quiet(CB, { kick: 1, cheerT: 0.675 });
  CB.Player.draw(p, r, 0, {});
  assert.equal(bodyCall(log).a[1], p.x - 2);
  assert.equal(bodyCall(log).a[2], p.y - 2 - 5);
  assert.equal(hatCall(log).a[1], p.x - 2 + 0.5);
  assert.equal(hatCall(log).a[2], p.y - 2 - 5 - 7);
  log.length = 0;
  Object.assign(p, { kick: 0, cheerT: 0, dashT: 0.1, dashDX: 1, dashDY: 0 });
  CB.Player.draw(p, r, 0, {});
  assert.equal(hatCall(log).depth, 1, 'inside the squash, like the body');
});

test('look: Unlocks is optional and guarded by method: nothing, a bare object, null or an unknown id all mean no hat', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB);
  for (const u of [undefined, {}, { hat: () => null }, { hat: () => 'nope' }, { hat: () => 'constructor' }, { hat: 5 }]) {
    CB.Unlocks = u;
    log.length = 0;
    CB.Player.draw(p, r, 0, {});
    assert.ok(bodyCall(log), 'Clawd is drawn');
    assert.equal(hatCall(log), undefined, JSON.stringify(u && Object.keys(u)));
  }
});

test('look: no hat while the hurt blink hides Clawd', () => {
  const { CB, r } = setup();
  const log = spy(r);
  CB.Unlocks = { hat: () => 'crown' };
  CB.Comfort = { blink: () => true };
  const p = quiet(CB, { hurtT: 0.5 });
  CB.Player.draw(p, r, 0, {});
  assert.equal(hatCall(log), undefined);
});

test('look: the real Unlocks hat (once unlocked and chosen) is drawn on Clawd', () => {
  const { CB, sandbox } = H.load([...H.GAME_BASE, 'src/art/render.js', 'src/game/unlocks.js'], { returnSandbox: true });
  CB.Font = { CELL_H: 7, measure: (s) => String(s).length * 6, draw() {} };
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const log = spy(r);
  const p = quiet(CB);
  CB.Player.draw(p, r, 0, {});
  assert.equal(hatCall(log), undefined, 'no hat by default');
  CB.Unlocks.unlock('halo');
  CB.Unlocks.setHat('halo');
  log.length = 0;
  CB.Player.draw(p, r, 0, {});
  assert.equal(hatCall(log).a[0], 'hat_halo');
});

test('look: a seeded 1500-tick scramble of moves, shots, dashes, hits, cheers and hats draws only finite coordinates', () => {
  const { CB, r, w } = setup();
  const rng = CB.createRng(77);
  const log = spy(r);
  const p = w.player;
  const ids = [null, ...HATS];
  for (let i = 0; i < 1500; i++) {
    const hat = ids[Math.floor(i / 60) % ids.length];
    CB.Unlocks = { hat: () => hat };
    if (i % 200 === 100) p.cheerT = 0.9;
    if (i % 333 === 50) p.invuln = 0;
    if (i % 333 === 51) CB.Player.hurt(p, w, null);
    const idle = Math.floor(i / 150) % 3 === 2; // a stretch of standing still every third 150 ticks
    H.stepN(w, 1, () => H.makeInput({
      moveX: idle ? 0 : rng.int(-1, 1),
      moveY: idle ? 0 : rng.int(-1, 1),
      aimX: rng.range(0, 320),
      aimY: rng.range(0, 180),
      fire: !idle && rng.chance(0.5),
      dash: !idle && rng.chance(0.05),
    }));
    if (p.dead) {
      p.dead = false;
      p.hearts = 5;
    }
    log.length = 0;
    CB.Player.draw(p, r, i / 60, {});
    for (const e of log) {
      if (e.k === 'sprite' || e.k === 'text') assert.ok(Number.isFinite(e.a[1]) && Number.isFinite(e.a[2]), `tick ${i}: ${e.k} ${e.a[0]} at ${e.a[1]},${e.a[2]}`);
      if (e.k === 'squash') assert.ok(e.a.slice(0, 4).every(Number.isFinite), `tick ${i}: squash ${e.a.slice(0, 4)}`);
    }
    for (const e of sprites(log)) assert.ok(CB.Art.hasSprite(e.a[0]), `tick ${i}: unknown sprite ${e.a[0]}`);
  }
});

// ---- T4a: Clawd's body language follows a stick aim just like a mouse aim ---------------------------------------------------

test('look: a stick aim flips Clawd to face the stick, and a mouse aim still faces the pointer', () => {
  const { w } = setup();
  const p = w.player;
  H.stepN(w, 1, () => H.makeInput({ aimDirX: -1, aimDirY: 0, aimAssist: true }));
  assert.equal(p.facing, -1);
  H.stepN(w, 1, () => H.makeInput({ aimDirX: 0.6, aimDirY: -0.8, aimAssist: true }));
  assert.equal(p.facing, 1);
  H.stepN(w, 1, () => H.makeInput({ aimX: p.x - 50, aimY: p.y }));
  assert.equal(p.facing, -1, 'back to the pointer');
});

test('look: the idle timer ignores a stick aim like it ignores the mouse, and a firing stick resets it', () => {
  const { w } = setup();
  const p = w.player;
  H.stepN(w, 30, (i) => H.makeInput({ aimDirX: Math.cos(i / 5), aimDirY: Math.sin(i / 5), aimAssist: true }));
  assert.ok(Math.abs(p.idleT - 0.5) < 1e-9, `swinging the stick alone keeps the clock running: ${p.idleT}`);
  H.stepN(w, 1, () => H.makeInput({ aimDirX: 1, aimDirY: 0, aimAssist: true, fire: true }));
  assert.equal(p.idleT, 0);
});

test('look: a shot from a stick sets the recoil, and the drawn sprite is pushed against the stick direction', () => {
  const { CB, w, r } = setup();
  const p = w.player;
  H.stepN(w, 1, () => H.makeInput({ aimDirX: 1, aimDirY: 0, aimAssist: true, fire: true }));
  assert.ok(p.kick > 0.7);
  const log = spy(r);
  p.hurtT = 0;
  CB.Player.draw(p, r, 0, {});
  const x = bodyCall(log).a[1];
  assert.ok(x < p.x, `aiming right pushes Clawd left (${x} vs ${p.x})`);
});

// ---- H1 / H3: the bubble stays in the arena and holds back at wave starts; one heart pulses a ring under Clawd -------------------------

test('look: the Thinking bubble flips below Clawd near the top wall so it never leaves the arena', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3 });
  const ys = [];
  for (const py of [22, 30, 45, 52, 53, 54, 60, 100]) {
    p.y = py;
    log.length = 0;
    CB.Player.draw(p, r, 0, {});
    const t = log.filter((e) => e.k === 'text');
    assert.equal(t.length, 2);
    ys.push(t[1].a[2]);
    assert.ok(t[1].a[2] >= CB.ARENA.y + 2, `at y ${py} the bubble is at ${t[1].a[2]}`);
    assert.ok(t[1].a[2] + 7 <= CB.ARENA.y + CB.ARENA.h, 'and above the bottom wall');
  }
  assert.ok(ys[0] > 22 + 3, 'flipped below Clawd when she is at the top');
  assert.equal(ys[7], 100 - 31, 'unchanged mid-arena');
});

test('look: a flipped bubble clears a /compact prompt that is also below her', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3 });
  p.y = 30;
  const w = CB.createWorld({ seed: 1 });
  w.player = p;
  CB.Compact = { ready: () => false, promptBelow: () => true };
  log.length = 0;
  CB.Player.draw(p, r, 0, { w });
  const plain = log.filter((e) => e.k === 'text')[1].a[2];
  CB.Compact.ready = () => true;
  log.length = 0;
  CB.Player.draw(p, r, 0, { w });
  const lower = log.filter((e) => e.k === 'text')[1].a[2];
  assert.ok(lower >= plain + 10, `the bubble sits below the prompt: ${plain} -> ${lower}`);
});

test('look: the bubble holds back while the HUD says a wave is starting, and comes back after it', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const p = quiet(CB, { idleT: 3 });
  CB.Screens = { hud: { bubbleQuiet: (t) => t < 2 } };
  CB.Player.draw(p, r, 1, {});
  assert.deepEqual(texts(log), [], 'quiet');
  CB.Player.draw(p, r, 2.5, {});
  assert.equal(texts(log).length, 2, 'back');
  CB.Screens = { hud: {} };
  log.length = 0;
  CB.Player.draw(p, r, 1, {});
  assert.equal(texts(log).length, 2, 'a HUD without the hook never holds it back');
});

test('look: at one heart a ring pulses under Clawd, steady in calm mode, gold on the prod floor; none at two hearts or when dead', () => {
  const { CB, r } = setup();
  const log = spy(r);
  const C = CB.Pal.C;
  const rings = () => log.filter((e) => e.k === 'ring');
  const p = quiet(CB, { hearts: 2 });
  CB.Player.draw(p, r, 0, {});
  assert.equal(rings().length, 0, 'two hearts: none');
  p.hearts = 1;
  p.beatPulse = 0;
  log.length = 0;
  CB.Player.draw(p, r, 0, {});
  const calmRad = rings()[0].a[2];
  assert.equal(rings().length, 2, 'two nested rings');
  assert.equal(rings()[0].a[3], C.hurt);
  assert.deepEqual([rings()[0].a[0], rings()[0].a[1]], [p.x, p.y + 2], 'under her feet');
  p.beatPulse = 1;
  log.length = 0;
  CB.Player.draw(p, r, 0, {});
  assert.ok(rings()[0].a[2] > calmRad, 'swells on the beat');
  CB.Comfort = { calm: () => true, blink: () => true };
  const steady = [0, 1].map((b) => {
    p.beatPulse = b;
    log.length = 0;
    CB.Player.draw(p, r, 0, {});
    return rings()[0].a[2];
  });
  assert.equal(steady[0], steady[1], 'calm: no pulse');
  CB.Comfort = undefined;
  const w = CB.createWorld({ seed: 1, stage: CB.STAGES ? CB.STAGES[3] : { palette: 'prod' } });
  w.stage = { palette: 'prod' };
  log.length = 0;
  CB.Player.draw(p, r, 0, { w });
  assert.equal(rings()[0].a[3], C.gold, 'prod: gold, since red vanishes on that floor');
  p.dead = true;
  log.length = 0;
  CB.Player.draw(p, r, 0, {});
  assert.equal(rings().length, 0, 'not while dead');
});
