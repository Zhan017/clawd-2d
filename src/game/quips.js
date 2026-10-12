// Quip text pools: stage intro prompts, wave-break and victory lines, kill, hurt and boss-phase pops, and a no-repeat pick.
(function (CB) {
  'use strict';

  // Generic software and CLI humour only: nothing here is an official string and nothing claims affiliation.
  // Every character has a glyph in CB.Font. Pops (kill, hurt, bossPhase, waveBreak) stay within 150 px, prompt lines within 290 px.
  const Quips = {
    // Typed under STAGE n / path in the intro: the user's prompt, then the "thinking" status.
    stage: [
      ['> fix the failing tests', '✻ Thinking...'],
      ['> why is the heap 99% full', '✻ Thinking... (compacting conversation)'],
      ['> resolve the merge conflict', '✻ Thinking... (reading MERGE_HEAD)'],
      ['> it works on my machine', '✻ Thinking... ⚠ this is prod'],
    ],
    // Read as waveBreak[stageIndex % n]: exactly one line per stage.
    waveBreak: ['running tests...', 'npm install (again)', 'git rebase HEAD~3', 'deploying on a friday...'],
    hurt: ['ouch', 'NaN', 'undefined', '403', 'rate limited'],
    // Read as dead[(deaths * 3 + stageIndex) % n]: keep n coprime with 3 or the deaths term never moves.
    dead: ['Clawd ran out of context', 'exit code 139', 'unexpected EOF', 'max turns reached'],
    victory: ['all green. ship it.', 'LGTM', 'exit code 0', 'no regressions found', 'merged to main'],
    kill: {
      syntaxError: ['Fix(;)', 'missing ;', 'lint: ok', '0 errors'],
      nullPointer: ['Fix(null)', '?.', 'undefined', 'x ?? 0'],
      raceCondition: ['await', 'mutex', 'lock()', 'join()'],
      memoryLeak: ['free()', 'gc()', 'drop(x)', 'delete x'],
      offByOne: ['i<n', 'n-1', '<=', 'len-1'],
    },
    // bossPhase[boss id][phase]: said once as the boss enters that phase.
    bossPhase: {
      infiniteLoop: { 2: ['// TODO: add exit condition', 'while (true) {}', 'for (;;) {}'] },
      memoryLeakBoss: { 2: ['malloc(99%)', 'heap: 99% full', 'oom killer next'] },
      mergeConflict: { 2: ['git add -p ???', '<<<<<<< HEAD', '>>>>>>> theirs'] },
      heisenbug: {
        2: ['cannot reproduce', 'works for me', 'observed: no bug'],
        3: ['works on my machine', 'flaky test?', "it's a feature"],
      },
    },
    pick,
  };

  // One line from list as { text, idx }, never lastIdx when there is a choice. It spends exactly one rng.next() (none for a
  // one-line list), drawing among the n-1 other slots and skipping over lastIdx. An empty or missing list gives { text: '', idx: -1 }.
  // A missing or partial rng cycles to the next slot instead, so a stubbed caller still gets a line.
  function pick(rng, list, lastIdx) {
    const n = Array.isArray(list) ? list.length : 0;
    if (n === 0) return { text: '', idx: -1 };
    const last = Number.isInteger(lastIdx) && lastIdx >= 0 && lastIdx < n ? lastIdx : -1;
    let idx = 0;
    if (n > 1) {
      if (rng && typeof rng.next === 'function') {
        const span = last < 0 ? n : n - 1;
        const u = rng.next();
        idx = Number.isFinite(u) ? Math.max(0, Math.min(span - 1, Math.floor(u * span))) : 0;
        if (last >= 0 && idx >= last) idx++;
      } else {
        idx = (last + 1) % n;
      }
    }
    return { text: list[idx], idx };
  }

  CB.Quips = Quips;
})(window.CB);
