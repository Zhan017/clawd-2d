// Boot: renderer, input, audio unlock, scene manager, debug hash, crash screen, Artifact hot snapshot.
(function (CB) {
  'use strict';

  CB.parseDebugHash = function (hash) {
    const s = String(hash || '').replace(/^#/, '');
    const q = Object.create(null);
    const dec = (v) => {
      try {
        return decodeURIComponent(v);
      } catch (e) {
        return v;
      }
    };
    if (s) {
      for (const part of s.split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        const k = dec(i < 0 ? part : part.slice(0, i));
        q[k] = i < 0 ? true : dec(part.slice(i + 1));
      }
    }
    const KNOWN = ['stage', 'boss', 'god', 'seed', 'speed', 'patches', 'hitboxes', 'rush', 'yolo'];
    const d = { active: KNOWN.some((k) => q[k] != null) };
    if (q.stage != null) d.startStage = Math.max(0, Math.min(3, (parseInt(q.stage, 10) || 1) - 1));
    if (q.boss) d.skipWaves = true;
    if (q.god) d.god = true;
    if (q.seed != null) d.seed = parseInt(q.seed, 10) >>> 0;
    if (q.speed != null) d.speed = Math.max(1, Math.min(8, parseInt(q.speed, 10) || 1));
    if (q.patches) {
      d.patches = {};
      for (const id of String(q.patches).split(',')) {
        const def = Object.prototype.hasOwnProperty.call(CB.Patches.DEFS, id) ? CB.Patches.DEFS[id] : null;
        if (def) d.patches[id] = Math.min(def.max, (d.patches[id] || 0) + 1);
      }
    }
    if (q.hitboxes) d.hitboxes = true;
    if (q.rush) d.bossRush = true;
    if (q.yolo) d.yolo = true;
    return d;
  };

  // Debug hashes only work locally: on a published Artifact a stray #boss or #god must not change the game.
  CB.debugFromLocation = function (loc) {
    const local = loc.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname);
    return local ? CB.parseDebugHash(loc.hash) : { active: false };
  };

  if (window.CB_NO_BOOT) return;

  // ---- crash handling --------------------------------------------------------------------------
  // `canvas`, `r` and `loop` are filled in by boot(); crash() copes with any of them still being null.
  let canvas = null;
  let r = null;
  let loop = null;
  let crashed = false;
  let crashErr = null;

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wrapLines(str, width, maxLines) {
    const out = [];
    for (const raw of String(str).split('\n')) {
      let line = raw;
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
      out.push(line);
    }
    return out.slice(0, maxLines);
  }

  // No renderer to draw with: put the panic text in the page itself.
  function showPre(e) {
    try {
      const pre = document.createElement('pre');
      pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:16px;z-index:2147483647;overflow:auto;white-space:pre-wrap;background:#000;color:#FF6B6B;font:14px/1.4 monospace;cursor:pointer';
      pre.innerHTML = 'KERNEL PANIC\n\n' + esc(String(e.message).slice(0, 600)) + '\n\nPress R to reload';
      if (pre.addEventListener) pre.addEventListener('mousedown', () => location.reload());
      (document.body || document.documentElement).appendChild(pre);
    } catch (e3) {
      // nothing left to try; the error is already in the console
    }
  }

  function paintFallback(e) {
    try {
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#FF6B6B';
      ctx.font = '16px monospace';
      ctx.fillText('KERNEL PANIC', 16, 32);
      const lines = wrapLines(e.message, Math.max(20, Math.floor((canvas.width - 32) / 10)), 10);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 16, 56 + i * 20);
      ctx.fillText('Press R to reload', 16, 56 + (lines.length + 1) * 20);
    } catch (e2) {
      showPre(e);
    }
  }

  function paintPanic() {
    const e = crashErr;
    if (!e) return;
    try {
      r.ctx.setTransform(1, 0, 0, 1, 0, 0);
      r.ctx.globalAlpha = 1;
      CB.Screens.panic.draw(r, e);
      r.present();
    } catch (e2) {
      paintFallback(e);
    }
  }

  function crash(err) {
    if (crashed) return;
    crashed = true;
    const e = err instanceof Error ? err : new Error(String(err));
    crashErr = e;
    console.error(e);
    if (loop) loop.stop();
    if (canvas && canvas.style) canvas.style.cursor = 'auto';
    if (r) {
      paintPanic();
      window.addEventListener('resize', () => {
        try {
          r.resize();
        } catch (e2) {
          // painting below still works with the old size
        }
        paintPanic();
      });
    } else showPre(e);
    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyR') location.reload();
    });
    if (canvas && canvas.addEventListener) canvas.addEventListener('mousedown', () => location.reload());
  }

  function installCrashHandlers() {
    // Only a real Error is fatal; ResizeObserver noise and cross-origin "Script error." events are not.
    window.addEventListener('error', (ev) => {
      if (ev && ev.error instanceof Error) crash(ev.error);
      else console.warn('Ignored non-fatal error event:', ev && ev.message);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      console.warn('Unhandled promise rejection:', ev && ev.reason);
    });
  }

  // ---- Artifact hot snapshot -------------------------------------------------------------------
  // Only mid-fight states resume cleanly (at that stage's intro); anywhere else the next load starts at the title.
  function snapshotState() {
    try {
      const g = CB.game;
      const run = g && g.sceneName === 'play' && g.scene && g.scene.run;
      if (!run || !(CB.RUN_COMBAT_STATES[run.state] || run.state === 'dying')) return {};
      return {
        stageIndex: run.stageIndex,
        patches: Object.assign({}, run.patches),
        deaths: run.deaths,
        time: run.time,
        history: run.history.slice(),
        bossRush: !!run.bossRush,
        yolo: !!run.yolo,
        squashed: Object.assign({}, run.stageSquashed), // the tally as the stage began: the resume restarts at that stage's intro
      };
    } catch (e) {
      return {};
    }
  }
  try {
    const hot0 = window.claude && window.claude.hot;
    if (hot0 && hot0.snapshot) hot0.snapshot(snapshotState);
  } catch (e) {
    console.warn('hot snapshot not registered:', e);
  }

  // ---- boot ------------------------------------------------------------------------------------
  // The terminal line typed by the scene-change wipe, by 'from>to'. The first scene of a session (title, a debug start, a hot resume) has no wipe.
  const WIPES = { 'title>play': '$ ./clawd --fight', 'play>title': '$ exit' };

  function boot(hotData) {
    installCrashHandlers();
    canvas = document.getElementById('game');
    r = CB.createRenderer(canvas);
    r.resize();
    window.addEventListener('resize', () => r.resize());
    const input = CB.createInput({ canvas, renderer: r });
    const debug = CB.debugFromLocation(location);

    const game = {
      r, input, debug, scene: null, sceneName: '', t: 0,
      go(name, data) {
        const from = game.scene ? game.sceneName : '';
        game.scene = CB.Scenes[name];
        game.sceneName = name;
        input.releaseAll();
        game.scene.enter(game, data || {});
        const label = from ? WIPES[from + '>' + name] : null;
        if (label && CB.Transition && CB.Transition.start) CB.Transition.start(label);
      },
    };
    CB.game = game;
    CB.debug = {
      game,
      get run() {
        return game.scene && game.scene.run;
      },
      get scene() {
        return game.scene;
      },
    };

    const unlock = () => CB.Audio.init();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const blur = () => {
      input.releaseAll();
      if (game.scene && game.scene.onBlur) game.scene.onBlur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) blur();
    });

    if (debug.active) game.go('play', { runOpts: debug });
    else if (hotData && hotData.stageIndex != null) {
      game.go('play', {
        runOpts: { startStage: hotData.stageIndex, patches: hotData.patches || {}, bossRush: !!hotData.bossRush, yolo: !!hotData.yolo },
        restore: hotData,
      });
    } else game.go('title');

    loop = CB.createLoop({
      update(dt) {
        game.t += dt;
        const inp = input.sample();
        if (inp.mute) CB.Audio.toggleMute();
        game.scene.update(dt, inp);
        if (CB.Transition && CB.Transition.update) CB.Transition.update(dt);
      },
      render() {
        r.resize();
        game.scene.draw(r, game.t);
        if (CB.Transition && CB.Transition.draw) CB.Transition.draw(r, game.t);
        r.present();
      },
      onError: crash,
    });
    loop.start();
    canvas.focus();
  }

  function start(data) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(data));
    else boot(data);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})(window.CB);
