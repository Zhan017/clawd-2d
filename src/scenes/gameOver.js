// Game over screen: the segfault, where Clawd crashed, deaths, a one-liner, and the retry and quit hints once the input lock is over.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const W = CB.W;
  const H = CB.H;
  const DIM_T = 0.25; // the dim fades in over this long
  const JITTER_T = 0.3; // the heading shakes sideways for its first 0.3 s (not in calm mode)
  const RETRY_LABEL = { boss: 'retry boss', wave2: 'retry wave 2', stage: 'retry stage' };

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lockT = () => (CB.RUN_T && typeof CB.RUN_T.inputLock === 'number' ? CB.RUN_T.inputLock : 0.6);
  const calm = () => !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());

  // Where a retry lands: the run's checkpoint, or (for a run that only knows diedInBoss) the boss or the stage.
  function retryHint(run) {
    const cp = run.checkpoint || (run.diedInBoss ? 'boss' : 'stage');
    return 'R / click: ' + (RETRY_LABEL[cp] || RETRY_LABEL.stage);
  }

  // Read as dead[(deaths * 3 + stageIndex) % n]; nothing when Quips has no such list.
  function deadQuip(run) {
    const q = CB.Quips && CB.Quips.dead;
    const line = Array.isArray(q) && q.length ? q[(Math.floor(num(run.deaths, 0)) * 3 + num(run.stageIndex, 0)) % q.length] : null;
    return typeof line === 'string' ? line : '';
  }

  function draw(r, run) {
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
      r.text(retryHint(run), W / 2, 124, { color: C.white, shadow: C.ink, align: 'center' });
      r.text('Q: quit to title', W / 2, 136, { color: C.pale, shadow: C.ink, align: 'center' });
    }
  }

  CB.Screens.gameOver = { draw };
})(window.CB);
