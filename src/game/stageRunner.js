// The run: stage → waves → boss → patch pick, with death/retry, as a headless state machine.
(function (CB) {
  'use strict';
  // stageIntro, bossWarn and bossDead have a short form (…Retry) for every visit after the card has played through once.
  // The first BUG FIXED card holds 4.6 s: the passing-test line lands near 2.9 s, so it stays readable for the rest.
  const T = Object.freeze({ stageIntro: 2.0, stageIntroRetry: 0.9, waveBreak: 1.5, bossWarn: 2.5, bossWarnRetry: 1.3, bossDead: 4.6, bossDeadRetry: 3.0, slowmo: 1.5, slowmoScale: 0.3, dying: 1.2, inputLock: 0.6 });
  CB.RUN_T = T;
  const COMBAT = { stageIntro: true, wave: true, waveBreak: true, bossWarn: true, boss: true };
  const NEUTRAL = Object.freeze({ moveX: 0, moveY: 0, aimX: 160, aimY: 90, fire: false, dash: false, pause: false, mute: false, confirm: false, choice: 0, retry: false, quit: false, compact: false, music: false, keys: [] });
  CB.RUN_COMBAT_STATES = COMBAT;

  CB.createRun = function (opts) {
    const o = opts || {};
    const run = {
      seed: o.seed == null ? 1 : o.seed >>> 0,
      god: !!o.god,
      bossRush: !!o.bossRush, // Boss Rush: every stage goes straight to its boss
      yolo: !!o.yolo, // YOLO: 3 base hearts, enemy bullets x1.15, 0.7 s hurt invuln (applied by the world and the player)
      daily: typeof o.daily === 'string' && o.daily ? o.daily : null, // Daily build: its 'YYYY-MM-DD'; the patch offers then come from their own stream (offerRng)
      skipWaves: !!o.skipWaves || !!o.bossRush,
      stageIndex: Math.max(0, Math.min(CB.STAGES.length - 1, o.startStage | 0)),
      patches: Object.assign({}, o.patches || {}),
      stagePatches: {},
      history: [],
      offer: null,
      state: 'stageIntro',
      stateT: 0,
      waveIndex: 0,
      spawner: null,
      time: 0,
      deaths: 0,
      squashed: {}, // kills by enemy kind (non-boss, non-silent), for the victory/game-over tally
      stageSquashed: {}, // run.squashed as it was when the current stage began; a retry goes back to it
      wave2Squashed: {}, // run.squashed as it was when the wave break began; a wave-2 retry goes back to it
      bossesFixed: 0,
      attempt: 0,
      diedInBoss: false, // set on entering 'dying' (checkpoint === 'boss'); a boss death retries at bossWarn
      seenIntro: new Set(), // stage indices whose intro card has played to the end; later visits get the short card
      seenWarn: new Set(), // the same for the boss-warning card
      seenFixed: new Set(), // ...and for the BUG FIXED card: a boss beaten again after a retry gets the short hold
      introT: T.stageIntro, // length of the current stageIntro card, set on entering it (the screens read it)
      warnT: T.bossWarn, // length of the current bossWarn card
      deadT: T.bossDead, // length of the current BUG FIXED card
      timeScale: 1, // the play scene eases the world back in after a pause (0.3 -> 1); the headless runs never touch it
      world: null,
      pending: [],
    };
    run.mode = { bossRush: run.bossRush, yolo: run.yolo };
    const stage = () => CB.STAGES[run.stageIndex];
    // 'boss' | 'wave2' | 'stage': where a retry will land. Read-only; set on entering 'dying', read by the game-over screen.
    let checkpoint = 'stage';
    Object.defineProperty(run, 'checkpoint', { get: () => checkpoint, enumerable: true });

    function setState(s) {
      run.state = s;
      run.stateT = 0;
      if (s === 'stageIntro') run.introT = run.seenIntro.has(run.stageIndex) ? T.stageIntroRetry : T.stageIntro;
      else if (s === 'bossWarn') run.warnT = run.seenWarn.has(run.stageIndex) ? T.bossWarnRetry : T.bossWarn;
      else if (s === 'bossDead') run.deadT = run.seenFixed.has(run.stageIndex) ? T.bossDeadRetry : T.bossDead;
    }

    // Counts the world's events into the tally. Idempotent within a step: `tallied` marks how far it has read.
    let tallied = 0;
    function tally() {
      const ev = run.world.events;
      for (let i = Math.min(tallied, ev.length); i < ev.length; i++) {
        const e = ev[i];
        if (e.type === 'enemyDie' && !e.boss && !e.silent && e.kind) run.squashed[e.kind] = (run.squashed[e.kind] || 0) + 1;
        else if (e.type === 'bossDie') run.bossesFixed++;
        // A boss phase change drops a hotfix heart 24 px from Clawd toward the arena centre: a reachable reward (halfway-to-centre landed inside the Infinite Loop ring).
        else if (e.type === 'bossPhase' && CB.Pickups && CB.Pickups.drop) {
          const p = run.world.player;
          const d = Math.hypot(160 - p.x, 96 - p.y) || 1;
          CB.Pickups.drop(run.world, p.x + ((160 - p.x) / d) * 24, p.y + ((96 - p.y) / d) * 24);
        }
      }
      tallied = ev.length;
    }

    function beginStage() {
      run.stagePatches = Object.assign({}, run.patches);
      run.stageSquashed = Object.assign({}, run.squashed);
      run.world = CB.createWorld({
        seed: (run.seed * 1009 + run.stageIndex * 97 + run.attempt * 7919) >>> 0,
        stage: stage(),
        god: run.god,
        mode: run.yolo ? { yolo: true } : {},
        patches: run.patches,
      });
      run.waveIndex = 0;
      run.spawner = null;
      run.offer = null;
      setState('stageIntro');
    }

    // A daily run draws its offers from a stream keyed by the seed and the stage alone, so they are the same for everyone that day, whatever
    // happened in the fight and however many retries it took. Every other run keeps drawing from the world's rng.
    function offerRng() {
      if (!run.daily) return run.world.rng;
      return CB.createRng(Math.imul(run.seed ^ Math.imul(run.stageIndex + 1, 0x9e3779b1), 0x85ebca6b) >>> 0);
    }

    function advanceStage() {
      run.stageIndex++;
      beginStage();
    }

    function startWave(i) {
      run.waveIndex = i;
      run.spawner = CB.createWaveSpawner(run.world, stage().waves[i], stage().elites ? stage().elites[i] : 0);
      setState('wave');
    }

    function enterWaveBreak() {
      tally(); // the kills of this very tick belong in the snapshot
      run.wave2Squashed = Object.assign({}, run.squashed);
      const p = run.world.player;
      if (!p.dead) p.hearts = Math.min(p.stats.maxHearts, p.hearts + 2);
      setState('waveBreak');
    }

    function enterBossWarn() {
      const w = run.world;
      if (!w.player.dead) w.player.hearts = w.player.stats.maxHearts;
      w.clearEnemyBullets();
      w.pBullets.length = 0;
      w.hazards.length = 0;
      setState('bossWarn');
      run.pending.push({ type: 'bossWarn', x: CB.W / 2, y: CB.H / 2 });
    }

    function enterDead() {
      const w = run.world;
      w.enemies.length = 0;
      w.spawns.length = 0;
      w.pBullets.length = 0;
      w.hazards.length = 0;
      w.clearEnemyBullets();
      setState('dead');
    }

    function startBoss() {
      const w = run.world;
      w.clearEnemyBullets();
      const boss = CB.Bosses[stage().boss].create(w);
      w.boss = boss;
      w.player.invuln = Math.max(w.player.invuln, 1.0); // safe spawn
      if (CB.Compact && CB.Compact.fill) CB.Compact.fill(w); // every boss fight, retries and Boss Rush included, starts with one cast
      // The entrance: audio reads it from run.pending on the next step; Fx is fed it here, because pending events never pass through the world's queue.
      const enter = { type: 'bossEnter', x: Number.isFinite(boss.x) ? boss.x : CB.W / 2, y: Number.isFinite(boss.y) ? boss.y : CB.H / 2 };
      run.pending.push(enter);
      const from = w.events.length;
      w.events.push(enter);
      CB.Fx.consume(w, from);
      w.events.length = from;
      setState('boss');
    }

    function enterDying(prev) {
      run.deaths++;
      if (prev === 'boss') checkpoint = 'boss';
      else if (prev === 'waveBreak' || (prev === 'wave' && run.waveIndex === 1)) checkpoint = 'wave2';
      else checkpoint = 'stage';
      run.diedInBoss = checkpoint === 'boss';
      setState('dying');
    }

    function revivePlayer() {
      const p = run.world.player;
      p.dead = false;
      p.hearts = Math.max(1, p.hearts);
      p.trail.length = 0;
    }

    function bossDefeated() {
      const w = run.world;
      w.killAllEnemies();
      w.clearEnemyBullets();
      w.hazards.length = 0;
      w.player.invuln = 999;
      if (w.player.dead) revivePlayer();
      const from = w.events.length;
      w.emit('bossDie', { x: w.boss.x, y: w.boss.y });
      CB.Fx.consume(w, from);
      w.addShake(6);
      setState('bossDead');
    }

    run.step = function (input) {
      const inp = input || NEUTRAL;
      const out = run.pending.length ? run.pending.splice(0) : [];
      const dt = run.timeScale === 1 ? CB.DT : CB.DT * run.timeScale;
      run.stateT += dt;
      if (run.state !== 'patchPick' && run.state !== 'dead' && run.state !== 'victory') run.time += dt;
      const w = run.world;
      switch (run.state) {
        case 'stageIntro':
          w.step(dt, inp);
          if (run.stateT >= run.introT) {
            run.seenIntro.add(run.stageIndex);
            if (run.skipWaves) enterBossWarn();
            else startWave(0);
          }
          break;
        case 'wave':
          w.step(dt, inp);
          run.spawner.update(dt);
          if (run.spawner.done) {
            if (run.waveIndex === 0) enterWaveBreak();
            else enterBossWarn();
          }
          break;
        case 'waveBreak':
          w.step(dt, inp);
          if (run.stateT >= T.waveBreak) startWave(1);
          break;
        case 'bossWarn':
          w.step(dt, inp);
          if (run.stateT >= run.warnT) {
            run.seenWarn.add(run.stageIndex);
            startBoss();
          }
          break;
        case 'boss':
          w.step(dt, inp);
          if (w.boss && w.boss.defeated) bossDefeated();
          break;
        case 'bossDead':
          w.step(run.stateT <= T.slowmo ? dt * T.slowmoScale : dt, inp);
          if (run.stateT >= run.deadT) {
            run.seenFixed.add(run.stageIndex);
            if (run.stageIndex >= CB.STAGES.length - 1) {
              setState('victory');
              run.pending.push({ type: 'victory', x: CB.W / 2, y: CB.H / 2 }); // returned by the next step (run -> unlocks/audio)
            } else {
              run.offer = CB.Patches.offer(offerRng(), run.patches, 3);
              if (run.offer.length) setState('patchPick');
              else advanceStage();
            }
          }
          break;
        case 'patchPick':
          if (inp.choice) run.choosePatch(inp.choice - 1);
          break;
        case 'dying':
          w.step(dt * 0.5, NEUTRAL);
          if (run.diedInBoss && w.boss && w.boss.defeated) {
            // The boss fell during the death slow-down: the defeat wins and the death does not count.
            run.deaths--;
            revivePlayer();
            bossDefeated();
          } else if (run.stateT >= T.dying) enterDead();
          break;
        case 'dead':
          if (inp.retry || inp.confirm) run.retryStage();
          break;
        default:
          break;
      }
      if (COMBAT[run.state] && run.world.player.dead) enterDying(run.state);
      tally();
      const ev = run.world.events;
      for (let i = 0; i < ev.length; i++) out.push(ev[i]);
      ev.length = 0;
      tallied = 0;
      return out;
    };

    // A confirm press on the BUG FIXED card, once its last line (the passing test) has shown: the card is done, the next screen follows on this step.
    // False before the slow-mo ends or outside the card.
    run.skipFixedCard = function () {
      if (run.state !== 'bossDead' || run.stateT <= T.slowmo) return false;
      run.stateT = Math.max(run.stateT, run.deadT - CB.DT);
      return true;
    };

    run.choosePatch = function (i) {
      if (run.state !== 'patchPick' || run.stateT < T.inputLock || !run.offer) return false;
      const id = run.offer[i];
      if (!id) return false;
      run.patches = CB.Patches.apply(run.patches, id);
      run.history.push(id);
      run.pending.push({ type: 'patchPick', id, x: CB.W / 2, y: CB.H / 2 });
      advanceStage();
      return true;
    };

    run.retryStage = function () {
      if (run.state !== 'dead' || run.stateT < T.inputLock) return false;
      const cp = checkpoint;
      run.patches = Object.assign({}, run.stagePatches);
      run.squashed = Object.assign({}, run.stageSquashed); // kills from the failed attempt do not count
      run.attempt++;
      beginStage();
      if (cp === 'boss') enterBossWarn(); // boss checkpoint: skip the intro and the waves
      else if (cp === 'wave2' && !run.skipWaves) {
        run.squashed = Object.assign({}, run.wave2Squashed); // wave 1 stays counted
        startWave(1);
      }
      return true;
    };

    beginStage();
    return run;
  };
})(window.CB);
