// The run: stage → waves → boss → patch pick, with death/retry, as a headless state machine.
(function (CB) {
  'use strict';
  const T = Object.freeze({ stageIntro: 2.0, waveBreak: 1.5, bossWarn: 2.5, bossDead: 3.0, slowmo: 1.5, slowmoScale: 0.3, dying: 1.2, inputLock: 0.6 });
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
      bossesFixed: 0,
      maxChain: 0,
      attempt: 0,
      diedInBoss: false, // set on entering 'dying'; a boss death retries at bossWarn
      world: null,
      pending: [],
    };
    run.mode = { bossRush: run.bossRush, yolo: run.yolo };
    const stage = () => CB.STAGES[run.stageIndex];
    // 'boss' | 'stage': where a retry will land. Read-only; set on entering 'dying', read by the game-over screen.
    let checkpoint = 'stage';
    Object.defineProperty(run, 'checkpoint', { get: () => checkpoint, enumerable: true });

    function setState(s) {
      run.state = s;
      run.stateT = 0;
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
      run.pending.push({ type: 'bossWarn' });
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
      w.boss = CB.Bosses[stage().boss].create(w);
      w.player.invuln = Math.max(w.player.invuln, 1.0); // safe spawn
      setState('boss');
    }

    function enterDying(prev) {
      run.deaths++;
      run.diedInBoss = prev === 'boss';
      checkpoint = run.diedInBoss ? 'boss' : 'stage';
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
      const dt = CB.DT;
      run.stateT += dt;
      if (run.state !== 'patchPick' && run.state !== 'dead' && run.state !== 'victory') run.time += dt;
      const w = run.world;
      switch (run.state) {
        case 'stageIntro':
          w.step(dt, inp);
          if (run.stateT >= T.stageIntro) {
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
          if (run.stateT >= T.bossWarn) startBoss();
          break;
        case 'boss':
          w.step(dt, inp);
          if (w.boss && w.boss.defeated) bossDefeated();
          break;
        case 'bossDead':
          w.step(run.stateT <= T.slowmo ? dt * T.slowmoScale : dt, inp);
          if (run.stateT >= T.bossDead) {
            if (run.stageIndex >= CB.STAGES.length - 1) {
              setState('victory');
              run.pending.push({ type: 'victory' }); // returned by the next step (run -> unlocks/audio)
            } else {
              run.offer = CB.Patches.offer(w.rng, run.patches, 3);
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
      const ev = run.world.events;
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.type === 'enemyDie' && !e.boss && !e.silent && e.kind) run.squashed[e.kind] = (run.squashed[e.kind] || 0) + 1;
        else if (e.type === 'bossDie') run.bossesFixed++;
        out.push(e);
      }
      ev.length = 0;
      run.maxChain = Math.max(run.maxChain, run.world.stats.maxChain || 0);
      return out;
    };

    run.choosePatch = function (i) {
      if (run.state !== 'patchPick' || run.stateT < T.inputLock || !run.offer) return false;
      const id = run.offer[i];
      if (!id) return false;
      run.patches = CB.Patches.apply(run.patches, id);
      run.history.push(id);
      run.pending.push({ type: 'patchPick', id });
      advanceStage();
      return true;
    };

    run.retryStage = function () {
      if (run.state !== 'dead' || run.stateT < T.inputLock) return false;
      run.patches = Object.assign({}, run.stagePatches);
      run.squashed = Object.assign({}, run.stageSquashed); // kills from the failed attempt do not count
      run.attempt++;
      beginStage();
      if (run.diedInBoss) enterBossWarn(); // boss checkpoint: skip the intro and the waves
      return true;
    };

    beginStage();
    return run;
  };
})(window.CB);
