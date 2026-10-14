// Game over screen: the segfault, where Clawd crashed, deaths, a one-liner, and the retry and quit hints once the input lock is over.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DIM_T = 0.25; // the dim fades in over this long
  const JITTER_T = 0.3; // the heading shakes sideways for its first 0.3 s (not in calm mode)
  const RETRY_LABEL = { boss: 'retry boss', wave2: 'retry wave 2', stage: 'retry stage' };
  // Two framed buttons side by side under the quip: [ retry ... ] and [ quit to title ] (20 px tall on touch, a 44 CSS px target at 2x).
  const BTN_Y = 128;
  const BTN_W = 150;
  const BTN_GAP = 8;
  const BTN_X0 = Math.round((W - (2 * BTN_W + BTN_GAP)) / 2);
  const box = (i, h) => Object.freeze({ x: BTN_X0 + i * (BTN_W + BTN_GAP), y: BTN_Y, w: BTN_W, h });
  const isTouch = () => !!(CB.Prompts && CB.Prompts.device === 'touch');
  const btnH = () => (isTouch() ? 20 : 12);
  const RETRY_BOX = box(0, 20); // touch-sized; retryBox() / quitBox() give the current device's
  const QUIT_BOX = box(1, 20); // a tap here leaves for the title
  const retryBox = () => box(0, btnH());
  const quitBox = () => box(1, btnH());

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lockT = () => (CB.RUN_T && typeof CB.RUN_T.inputLock === 'number' ? CB.RUN_T.inputLock : 0.6);
  const calm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // Where a retry lands: the run's checkpoint, or (for a run that only knows diedInBoss) the boss or the stage.
  // The key hint leads on a keyboard or a pad; a phone just taps the button.
  function retryLabel(run) {
    const cp = run.checkpoint || (run.diedInBoss ? 'boss' : 'stage');
    const d = CB.Prompts && CB.Prompts.device;
    const lead = d === 'pad' ? 'A: ' : d === 'touch' ? '' : 'R: ';
    return '[ ' + lead + (RETRY_LABEL[cp] || RETRY_LABEL.stage) + ' ]';
  }

  function quitLabel(armed) {
    const d = CB.Prompts && CB.Prompts.device;
    if (armed) return d === 'pad' ? '[ Back again to quit ]' : '[ quit again ]';
    return '[ ' + (d === 'pad' ? 'Back: ' : d === 'touch' ? '' : 'Q: ') + 'quit to title ]';
  }

  const inRect = (b, x, y) => !!b && Number.isFinite(x) && Number.isFinite(y) && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

  // Read as dead[(deaths * 3 + stageIndex) % n]; nothing when Quips has no such list.
  function deadQuip(run) {
    const q = CB.Quips && CB.Quips.dead;
    const line = Array.isArray(q) && q.length ? q[(Math.floor(num(run.deaths, 0)) * 3 + num(run.stageIndex, 0)) % q.length] : null;
    return typeof line === 'string' ? line : '';
  }

  // ui (optional): quitArmT (> 0 after the first Q), aimX/aimY (the mouse, for hover).
  function draw(r, run, t, ui) {
    const st = num(run.stateT, 0);
    const stage = (CB.STAGES && CB.STAGES[num(run.stageIndex, 0)]) || (run.world && run.world.stage) || null;
    r.alpha(0.75 * clamp(st / DIM_T, 0, 1), () => r.rect(0, 0, W, H, C.ink));
    const jitter = st < JITTER_T && !calm() ? (Math.floor(st * 30) % 2 ? 2 : -2) : 0;
    r.text('Segmentation fault', W / 2 + jitter, 56, { scale: 2, color: C.hurt, shadow: C.ink, align: 'center' });
    r.text('(core dumped)', W / 2, 76, { color: C.pale, shadow: C.ink, align: 'center' });
    r.text('Clawd crashed in ' + (stage && stage.path ? stage.path : '~/'), W / 2, 92, { color: C.pale, shadow: C.ink, align: 'center' });
    r.text('deaths: ' + Math.floor(num(run.deaths, 0)), W / 2, 104, { color: C.pale, shadow: C.ink, align: 'center' });
    const quip = deadQuip(run);
    if (quip) r.text(quip, W / 2, 114, { color: C.grey, shadow: C.ink, align: 'center' });
    if (st >= lockT()) {
      const armed = !!(ui && num(ui.quitArmT, 0) > 0);
      const kbm = !(CB.Prompts && (CB.Prompts.device === 'touch' || CB.Prompts.device === 'pad'));
      const aim = kbm && ui && Number.isFinite(ui.aimX) && Number.isFinite(ui.aimY) ? ui : null;
      const rb = retryBox();
      const qb = quitBox();
      const btn = CB.Screens.button;
      const retry = retryLabel(run);
      const quit = quitLabel(armed);
      if (typeof btn === 'function') {
        btn(r, rb, retry, { lit: !!(aim && inRect(rb, aim.x, aim.y)), color: C.white });
        btn(r, qb, quit, { lit: armed || !!(aim && inRect(qb, aim.x, aim.y)), color: armed ? C.gold : undefined });
      } else {
        r.text(retry, rb.x + rb.w / 2, rb.y + 2, { color: C.white, shadow: C.ink, align: 'center' });
        r.text(quit, qb.x + qb.w / 2, qb.y + 2, { color: C.pale, shadow: C.ink, align: 'center' });
      }
    }
  }

  CB.Screens.gameOver = { RETRY_BOX, QUIT_BOX, retryBox, quitBox, draw };
})(window.CB);
