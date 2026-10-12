// Title scene: dimmed arena, wavy logo, Clawd zapping wandering bugs, start and mode buttons, hat, music and calm keys, typed secrets.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const START_LOCK = 0.3; // seconds before a click or Enter starts anything
  const DIM = 0.55;
  const TOAST_FADE = 0.4;
  const TOAST_SECRET_T = 2.0;
  const TOAST_CALM_T = 1.5;
  const MUSIC_UNDO_WINDOW = 1.5; // seconds: the N of "ultrathink" toggles the music, the K that finishes the code puts it back
  const SPARK_FIRST = 1.0; // seconds after entering to Clawd's first spark, then SPARK_EVERY
  const SPARK_EVERY = 2.0;
  const SPARK_SPEED = 150;
  const SPARK_TWINKLE_HZ = 20; // colour swaps a second; calm mode caps it through Comfort.blink
  const SMALL_RECHECK = 0.5; // seconds between small-screen checks while drawing
  const TITLE_STAGE = Object.freeze({ id: 'title', palette: 'src' });

  // Top of each 7 px text cell (the Rev 3 layout table).
  const Y = { clawd: 4, vs: 27, bugs: 36, note: 96, hat: 105, start: 114, modes: 124, keys1: 138, keys2: 147, footer: 160, status: 170 };
  const CLAWD = { x: 160, y: 82, scale: 2 };
  const HAT_DY_FALLBACK = -7; // per scale: where an ordinary hat is centred above Clawd's centre (Player.HAT_DY says the same)
  const LOGO_GAP = 1; // extra logo letter spacing, in logo pixels (3 screen px each), on top of the font's own gap
  const MODE_X = { rush: 110, yolo: 220 };
  // Hit boxes of the two mode labels (6 px of slack around the text). Fixed numbers: nothing may measure text at load time.
  const BUTTONS = Object.freeze([
    Object.freeze({ id: 'rush', x: 76, y: 121, w: 68, h: 13 }),
    Object.freeze({ id: 'yolo', x: 190, y: 121, w: 60, h: 13 }),
  ]);
  const SECRETS = {
    konami: { id: 'halo', text: 'cheat codes are just undocumented features' },
    ultrathink: { id: 'rainbow', text: '✻ ultrathink enabled' },
  };

  // The four cosmetic bugs. Each wanders inside its own cell on the right, clear of the logo, the text rows and the walls.
  const BUGS = [
    { sprite: 'syntaxError', color: C.red, cell: { x0: 228, x1: 258, y0: 30, y1: 50 } },
    { sprite: 'raceCondition', color: C.yellow, cell: { x0: 276, x1: 304, y0: 30, y1: 50 } },
    { sprite: 'memoryLeak', color: C.green, cell: { x0: 228, x1: 258, y0: 62, y1: 84 } },
    { sprite: 'nullPointer', color: C.grey, cell: { x0: 276, x1: 304, y0: 62, y1: 84 } },
  ];

  // Clawd's spark: an 8-armed star that twinkles by swapping which arms are bright (same silhouette, so it never jitters).
  CB.Art.defineSprite('title_spark0', [
    '.k..k..k.',
    'kfkkqkkfk',
    '.kfkzkfk.',
    '.kkfzfkk.',
    'kqzzwzzqk',
    '.kkfzfkk.',
    '.kfkzkfk.',
    'kfkkqkkfk',
    '.k..k..k.',
  ]);
  CB.Art.defineSprite('title_spark1', [
    '.k..k..k.',
    'kqkkfkkqk',
    '.kzkfkzk.',
    '.kkzfzkk.',
    'kfffwfffk',
    '.kkzfzkk.',
    '.kzkfkzk.',
    'kqkkfkkqk',
    '.k..k..k.',
  ]);

  // Optional modules are called by method, never by object only: tests stub partial ones.
  function sfx(name) {
    if (CB.Audio && typeof CB.Audio.play === 'function') CB.Audio.play(name);
  }
  function modesOn() {
    const u = CB.Unlocks;
    return !!(u && typeof u.has === 'function' && u.has('modes'));
  }
  function hatIds() {
    const u = CB.Unlocks;
    const list = u && typeof u.hats === 'function' ? u.hats() : null;
    return Array.isArray(list) ? list : [];
  }
  function wornHat() {
    const u = CB.Unlocks;
    return (u && typeof u.hat === 'function' && u.hat()) || null;
  }
  function hatName(id) {
    const def = Array.isArray(CB.HATS) ? CB.HATS.find((h) => h.id === id) : null;
    return def ? def.name : id;
  }
  function isSmallScreen() {
    try {
      if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) {
      // no media queries here: judge by the window width alone
    }
    return typeof window.innerWidth === 'number' && window.innerWidth < 480;
  }

  const inside = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

  CB.Scenes.title = {
    BUTTONS,
    game: null,
    t: 0, // scene time (drawing uses the game clock it is given)
    yolo: false,
    secrets: null,
    toast: null, // { text, t }
    rng: null,
    bugs: [],
    sparks: [],
    particles: [],
    sparkT: SPARK_FIRST,
    shots: 0,
    kick: 0,
    aimX: 0,
    aimY: 0,
    musicToggledAt: -Infinity,
    small: false,
    smallAt: -Infinity,

    enter(game) {
      this.game = game;
      if (CB.Music && typeof CB.Music.stop === 'function') CB.Music.stop();
      this.secrets = CB.Secrets && typeof CB.Secrets.create === 'function' ? CB.Secrets.create() : null;
      this.t = 0;
      this.yolo = false;
      this.toast = null;
      this.rng = CB.createRng(7);
      this.sparks = [];
      this.particles = [];
      this.sparkT = SPARK_FIRST;
      this.shots = 0;
      this.kick = 0;
      this.aimX = 0;
      this.aimY = 0;
      this.musicToggledAt = -Infinity;
      this.smallAt = -Infinity;
      this.bugs = BUGS.map((def) => {
        const b = { def, x: 0, y: 0, tx: 0, ty: 0, wait: 0, speed: 0, face: 1, flash: 0, kx: 0 };
        b.x = this.rng.range(def.cell.x0, def.cell.x1);
        b.y = this.rng.range(def.cell.y0, def.cell.y1);
        b.speed = this.rng.range(12, 20);
        this.pickTarget(b);
        return b;
      });
    },

    pickTarget(b) {
      const c = b.def.cell;
      b.tx = this.rng.range(c.x0, c.x1);
      b.ty = this.rng.range(c.y0, c.y1);
      b.wait = this.rng.range(1.4, 3.2);
    },

    setToast(text, t) {
      this.toast = { text, t };
    },

    // A typed secret: a fresh unlock chimes and toasts. Finishing "ultrathink" puts back the music toggle its own N press just made.
    onSecret(name) {
      if (!Object.prototype.hasOwnProperty.call(SECRETS, name)) return;
      const s = SECRETS[name];
      const u = CB.Unlocks;
      if (u && typeof u.unlock === 'function' && u.unlock(s.id)) {
        this.setToast(s.text, TOAST_SECRET_T);
        sfx('unlock');
      }
      if (name === 'ultrathink' && this.t - this.musicToggledAt <= MUSIC_UNDO_WINDOW) {
        this.musicToggledAt = -Infinity;
        if (CB.Music && typeof CB.Music.toggle === 'function') CB.Music.toggle();
      }
    },

    toggleCalm() {
      if (!(CB.Comfort && typeof CB.Comfort.toggle === 'function')) return;
      this.setToast('calm mode: ' + (CB.Comfort.toggle() ? 'on' : 'off'), TOAST_CALM_T);
    },

    cycleHat(dir) {
      CB.Unlocks.cycleHat(dir);
      sfx('uiSelect');
    },

    start(runOpts) {
      sfx('uiSelect');
      this.game.go('play', { runOpts });
    },

    // Enter or a click, past the input lock. Returns true when it started a run.
    confirm(x, y) {
      if (modesOn()) {
        if (inside(BUTTONS[0], x, y)) {
          this.start({ bossRush: true, yolo: this.yolo });
          return true;
        }
        if (inside(BUTTONS[1], x, y)) {
          this.yolo = !this.yolo;
          sfx('uiSelect');
          return false;
        }
      }
      this.start({ yolo: this.yolo });
      return true;
    },

    update(dt, input) {
      const inp = input || {};
      this.t += dt;
      if (Number.isFinite(inp.aimX) && Number.isFinite(inp.aimY)) {
        this.aimX = inp.aimX;
        this.aimY = inp.aimY;
      }
      if (this.toast) {
        this.toast.t -= dt;
        if (this.toast.t <= 0) this.toast = null;
      }
      // N comes before the typed codes: a fast "ultrathink" can bring its N and K in one tick.
      if (inp.music && CB.Music && typeof CB.Music.toggle === 'function') {
        CB.Music.toggle();
        this.musicToggledAt = this.t;
        sfx('uiSelect');
      }
      if (Array.isArray(inp.keys) && inp.keys.length) {
        let calm = false;
        for (const code of inp.keys) {
          if (this.secrets) {
            const name = this.secrets.feed(code);
            if (name) this.onSecret(name);
          }
          if (code === 'KeyV') calm = true;
        }
        if (calm) this.toggleCalm();
      }
      // Hats are Q and E only: the arrows and A/D are how the secret codes are typed.
      if ((inp.quit || inp.compact) && hatIds().length > 0 && CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') {
        if (inp.quit) this.cycleHat(-1);
        if (inp.compact) this.cycleHat(1);
      }
      if (inp.confirm && this.t >= START_LOCK - 1e-6 && this.confirm(this.aimX, this.aimY)) return;
      this.animate(dt);
    },

    // Cosmetic motion only: wandering bugs, Clawd's spark and its hit puffs, all from the scene's own seeded rng.
    animate(dt) {
      const rng = this.rng;
      for (const b of this.bugs) {
        const c = b.def.cell;
        b.flash = Math.max(0, b.flash - dt);
        b.wait -= dt;
        if (b.wait <= 0) this.pickTarget(b);
        const dx = b.tx - b.x;
        const dy = b.ty - b.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.5) {
          const step = Math.min(d, b.speed * dt);
          b.x += (dx / d) * step;
          b.y += (dy / d) * step;
          if (Math.abs(dx) > 0.3) b.face = dx < 0 ? -1 : 1;
        }
        if (b.kx > 0) {
          b.x += b.kx * dt;
          b.kx = Math.max(0, b.kx - 220 * dt);
        }
        b.x = Math.max(c.x0, Math.min(c.x1, b.x));
        b.y = Math.max(c.y0, Math.min(c.y1, b.y));
      }

      this.kick = Math.max(0, this.kick - dt * 10);
      this.sparkT -= dt;
      if (this.sparkT <= 0) {
        this.sparkT += SPARK_EVERY;
        const target = this.bugs[this.shots++ % this.bugs.length];
        this.sparks.push({ x: CLAWD.x + 21, y: CLAWD.y + 2, target, age: 0, trailT: 0 });
        this.kick = 1;
      }
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.age += dt;
        s.trailT -= dt;
        if (s.trailT <= 0) {
          s.trailT = 0.03;
          this.puff(s.x, s.y, 0, 0, 0.2, C.ember);
        }
        const dx = s.target.x - s.x;
        const dy = s.target.y - s.y;
        const d = Math.hypot(dx, dy);
        if (d < 6 || s.age > 3) {
          s.target.flash = 0.12;
          s.target.kx = 70;
          for (let k = 0; k < 6; k++) {
            const a = rng.angle();
            const v = rng.range(25, 70);
            this.puff(s.x, s.y, Math.cos(a) * v, Math.sin(a) * v, rng.range(0.25, 0.4), rng.pick([C.spark, C.ember, C.white, C.gold]));
          }
          this.sparks.splice(i, 1);
          continue;
        }
        const step = SPARK_SPEED * dt;
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
      }
    },

    puff(x, y, vx, vy, life, color) {
      if (this.particles.length >= 48) this.particles.shift();
      this.particles.push({ x, y, vx, vy, life, max: life, color });
    },

    draw(r, t) {
      if (CB.Arena && typeof CB.Arena.draw === 'function') CB.Arena.draw(r, TITLE_STAGE, t);
      else r.clear(C.ink);
      r.alpha(DIM, () => r.rect(0, 0, CB.W, CB.H, C.ink));

      const peek = this.game && this.game.input && typeof this.game.input.peekAim === 'function' ? this.game.input.peekAim() : null;
      const aim = peek && Number.isFinite(peek.x) && Number.isFinite(peek.y) ? peek : { x: this.aimX, y: this.aimY };
      this.drawBugs(r, t);
      this.drawSparks(r, t);
      this.drawClawd(r, t);
      this.drawLogo(r, t);
      this.drawText(r, t, aim);
      if (CB.Screens.hud && typeof CB.Screens.hud.cursor === 'function') CB.Screens.hud.cursor(r, aim.x, aim.y, 'pointer', t);
    },

    drawBugs(r, t) {
      for (let i = 0; i < this.bugs.length; i++) {
        const b = this.bugs[i];
        const white = b.flash > 0;
        const second = b.def.sprite + '_1';
        const name = b.def.sprite + (Math.floor(t * 4 + i) % 2 && CB.Art.hasSprite(second) ? '_1' : '_0');
        if (CB.Art.hasSprite(name)) {
          const def = CB.Art.spriteDef(name);
          r.alpha(0.3, () => r.rect(b.x - def.w / 2 + 1, b.y + def.h / 2 - 1, def.w - 2, 2, C.ink));
          r.sprite(name, b.x, b.y, { flip: b.face < 0, white });
        } else {
          r.disc(b.x, b.y, 5, white ? C.white : b.def.color);
        }
      }
    },

    drawSparks(r, t) {
      for (const p of this.particles) {
        const size = p.max > 0.3 ? 2 : 1;
        r.alpha(Math.min(1, (p.life / p.max) * 1.5), () => r.rect(p.x, p.y, size, size, p.color));
      }
      for (const s of this.sparks) {
        const hot = CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(s.age, SPARK_TWINKLE_HZ) : Math.floor(s.age * SPARK_TWINKLE_HZ) % 2 === 0;
        r.sprite(hot ? 'title_spark0' : 'title_spark1', s.x, s.y);
      }
    },

    drawClawd(r, t) {
      const second = Math.floor(t * 2) % 2;
      const blink = t % 3.4 < 0.12;
      let name = blink ? 'clawd_blink' : second ? 'clawd_idle1' : 'clawd_idle0';
      if (this.kick > 0.2) name = (second ? 'clawd_idle1' : 'clawd_idle0') + '_angry'; // a game face for the shot
      if (!CB.Art.hasSprite(name)) name = second ? 'clawd_idle1' : 'clawd_idle0';
      const x = CLAWD.x - Math.round(this.kick * 2); // recoil away from the bugs
      r.alpha(0.3, () => r.rect(CLAWD.x - 14, CLAWD.y + 10, 28, 2, C.ink));
      r.sprite(name, x, CLAWD.y, { scale: CLAWD.scale });
      const hat = wornHat();
      if (hat && CB.Player && typeof CB.Player.drawHat === 'function') {
        const dy = (CB.Player && Number.isFinite(CB.Player.HAT_DY) ? CB.Player.HAT_DY : HAT_DY_FALLBACK) * CLAWD.scale;
        const bob = second && !blink ? CLAWD.scale : 0; // the idle1 frame has the whole body one pixel lower
        CB.Player.drawHat(r, x, CLAWD.y + dy + bob, hat, 1, CLAWD.scale);
      }
    },

    // Each letter bobs 1 px in a travelling wave. Letters sit at their measured prefix width plus LOGO_GAP extra, so the shadows do not fill the gaps.
    word(r, str, y, color, shadow, t, phase) {
      const sc = 3;
      const extra = sc * LOGO_GAP;
      const x0 = (CB.W - (r.measure(str, sc) + (str.length - 1) * extra)) / 2;
      for (let i = 0; i < str.length; i++) {
        const x = x0 + (i ? r.measure(str.slice(0, i), sc) + sc + i * extra : 0);
        const bob = Math.round(Math.sin(t * 3 + (i + phase) * 0.8));
        r.text(str[i], x, y + bob, { color, shadow, scale: sc });
      }
    },

    drawLogo(r, t) {
      this.word(r, 'CLAWD', Y.clawd, C.clawd, C.clawdDark, t, 0);
      r.text('vs', CB.W / 2, Y.vs, { color: C.pale, align: 'center' });
      this.word(r, 'BUGS', Y.bugs, C.red, C.redDark, t, 5);
    },

    drawText(r, t, aim) {
      const mid = CB.W / 2;
      if (t - this.smallAt >= SMALL_RECHECK || t < this.smallAt) {
        this.small = isSmallScreen();
        this.smallAt = t;
      }
      if (this.small) r.text('Best on desktop with keyboard + mouse', mid, Y.note, { color: C.gold, align: 'center' });

      if (hatIds().length > 0) {
        const id = wornHat();
        r.text('hat: ' + (id ? hatName(id) : 'none') + ' (Q/E)', mid, Y.hat, { color: C.pale, align: 'center' });
      }

      // 0.6 s on, 0.3 s off
      if (t % 0.9 < 0.6) r.text('Click to start', mid, Y.start, { color: C.white, shadow: C.ink, align: 'center' });

      if (modesOn()) {
        const hover = (b) => inside(b, aim.x, aim.y);
        r.text('[ boss rush ]', MODE_X.rush, Y.modes, { color: hover(BUTTONS[0]) ? C.white : C.pale, align: 'center' });
        r.text(this.yolo ? '[x] --yolo' : '[ ] --yolo', MODE_X.yolo, Y.modes, { color: this.yolo ? C.red : hover(BUTTONS[1]) ? C.white : C.pale, align: 'center' });
      }

      r.text('WASD move · Mouse aim · Click shoot · Space dash', mid, Y.keys1, { color: C.pale, align: 'center' });
      r.text('E /compact · N music · M mute · V calm · Esc pause', mid, Y.keys2, { color: C.pale, align: 'center' });

      // A toast takes the footer row while it is up.
      if (this.toast) {
        const a = Math.min(1, this.toast.t / TOAST_FADE);
        r.alpha(a * 0.85, () => r.rect(0, Y.footer - 3, CB.W, 13, C.ink));
        r.alpha(a, () => r.text(this.toast.text, mid, Y.footer, { color: C.gold, align: 'center' }));
      } else {
        r.text('Fan game. Not affiliated with Anthropic.', mid, Y.footer, { color: C.grey, align: 'center' });
      }

      const status = [];
      if (CB.Audio && typeof CB.Audio.isMuted === 'function') status.push('M sound: ' + (CB.Audio.isMuted() ? 'off' : 'on'));
      if (CB.Music && typeof CB.Music.isEnabled === 'function') status.push('N music: ' + (CB.Music.isEnabled() ? 'on' : 'off'));
      if (status.length) r.text(status.join(' · '), mid, Y.status, { color: C.greyDark, align: 'center' });
    },
  };
})(window.CB);
