// Title scene: dimmed arena, wavy logo, Clawd zapping wandering bugs, and one menu card under them: hat picker, START button, daily build / boss rush /
// --yolo buttons, a description-or-controls line and the sound / music / calm chips; typed secrets. What is still locked shows as a teaser: a dim
// "beat a boss" line where the hat picker will be, dashed boss rush and --yolo buttons that only say what unlocks them.
// Prompts follow the device in use (keyboard + mouse, touch or pad); a click or tap and the pad's buttons all work here.
// The pad also walks a gold focus over install, the hat, START, the modes and the chips (D-pad or L-stick, A activates); a tap that misses by a few px on a phone still lands.
(function (CB) {
  'use strict';
  const C = CB.Pal.C;
  const START_LOCK = 0.3; // seconds before a click, tap, Enter or pad button starts anything
  const DIM = 0.55;
  const TOAST_FADE = 0.4;
  const FOOTER_ALPHA = 0.55; // the ink band under the card behind the disclaimer...
  const TOAST_ALPHA = 0.85; // ...and the heavier one a toast puts there
  const TOAST_SECRET_T = 2.0;
  const TOAST_NOTIFY_T = 2.0; // "controller connected" and friends
  const TOAST_CALM_T = 1.5;
  const MUSIC_UNDO_WINDOW = 1.5; // seconds: the N of "ultrathink" toggles the music, the K that finishes the code puts it back
  const SPARK_FIRST = 1.0; // seconds after entering to Clawd's first spark, then SPARK_EVERY
  const SPARK_EVERY = 2.0;
  const SPARK_SPEED = 150;
  const SPARK_TWINKLE_HZ = 20; // colour swaps a second; calm mode caps it through Comfort.blink
  const TITLE_STAGE = Object.freeze({ id: 'title', palette: 'src' });

  // Rows of the logo and of the menu card, as the top of each 7 px text cell (or of each button box). `status` is the text row of the chips.
  const Y = { clawd: 4, vs: 27, bugs: 36, hat: 99, start: 109, modes: 125, line1: 139, line2: 148, desc: 143, status: 160, footer: 173 };
  const CLAWD = { x: 160, y: 82, scale: 2 };
  const HAT_DY_FALLBACK = -7; // per scale: where an ordinary hat is centred above Clawd's centre (Player.HAT_DY says the same)
  const LOGO_GAP = 1; // extra logo letter spacing, in logo pixels (3 screen px each), on top of the font's own gap
  // The card behind the menu. Its edges are fixed: the hat row (the picker, or its locked teaser) is always the first row, and the START button is 3 px under it. Rows are 3 px apart, 2 px of padding at the card's top and bottom.
  const CARD = Object.freeze({ x: 34, w: 252, top: 96, bottom: 172 });
  const START_BOX = Object.freeze({ x: 108, y: Y.start, w: 104, h: 13 });
  // The mode buttons share the chips' grid (columns 45, 123 and 201, 74 x 11): the daily build is always there, centred; boss rush and --yolo flank it, dashed and locked until the modes are unlocked.
  // Fixed numbers: nothing may measure text at load time. Each box is exactly the frame that is drawn (for a locked one, the bounding box of its dashes).
  const BUTTONS = Object.freeze([
    Object.freeze({ id: 'rush', x: 45, y: Y.modes, w: 74, h: 11 }),
    Object.freeze({ id: 'yolo', x: 201, y: Y.modes, w: 74, h: 11 }),
    Object.freeze({ id: 'daily', x: 123, y: Y.modes, w: 74, h: 11 }),
  ]);
  const [RUSH_BOX, YOLO_BOX, DAILY_BOX] = BUTTONS;
  // --yolo ON doubles its frame outward (drawButton), so while it is on the pointer hits the outer frame too: a click on the ring toggles it off instead of falling through to "start".
  const YOLO_ON_BOX = Object.freeze({ id: 'yolo', x: YOLO_BOX.x - 1, y: YOLO_BOX.y - 1, w: YOLO_BOX.w + 2, h: YOLO_BOX.h + 2 });
  // The hat row (a picker only when a hat is unlocked; until then it is a dim line that takes no taps): "Q ‹ name › E", the name centred in a fixed field so the chevrons stay put as it changes.
  // A tap on its left part (the Q and the left chevron) wears the previous hat, anywhere else on it the next one.
  const HAT_BOX = Object.freeze({ x: 76, y: Y.hat - 2, w: 168, h: 11 });
  const HAT_LEFT = Object.freeze({ x: 76, y: Y.hat - 2, w: 46, h: 11 });
  const HAT_RIGHT = Object.freeze({ x: 122, y: Y.hat - 2, w: 122, h: 11 }); // the name, the right chevron and its key hint
  // The install button (only while CB.Install says the game can be installed): top-right, clear of the logo (it ends near x 213) and of the bugs (they start at y 30).
  const INSTALL_BOX = Object.freeze({ id: 'install', x: 262, y: 4, w: 52, h: 11 });
  const NEAR_PX = 6; // a touch that misses every control by up to this many px still lands on the nearest one
  const TOUCH_PAD = 3; // invisible padding the chips get on touch (toggles.hit's optional argument)
  const HINT_PAD = { x: 6, y: 6 }; // the pad's dim "D-pad: options" hint, top-left
  const HAT_FIELD = 74; // px the name may take (the longest hat name is 59)
  const CHEV_GAP = 5; // px between the name field and each chevron
  const CHEV_W = 4;
  const HINT_GAP = 4; // px between a chevron and its key hint
  const PULSE_HZ = 1.5; // the START frame swaps between two shades this many times a second (0.75 Hz round trip)
  const DESC_T = 2; // seconds a tapped --yolo (or a poked locked button) keeps its description up (a touch has no hover)
  const TOAST_LOCKED_T = 1.6; // "win a full run to unlock ..."
  // What each mode button does, shown under the row while one is hovered or focused.
  const DESC = Object.freeze({
    rush: 'all four bosses back to back',
    daily: 'one seeded run a day, the same for everyone',
    yolo: '3 hearts, faster bullets: bragging rights',
  });
  // The locked teasers: the hat row's stand-in line, the description of a locked mode button and the name its toast ends with.
  const HATS_LOCKED = 'hats: beat a boss to earn one';
  const DESC_LOCKED = 'win a full run to unlock';
  const LOCKED_NAME = Object.freeze({ rush: 'boss rush', yolo: '--yolo' });
  const DISCLAIMER = 'Fan game. Not affiliated with Anthropic.';
  const PAD_HINT = 'D-pad: options';
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

  // The hat picker's chevron, pointing left (the font has no ‹ or ›); the right one is this flipped. Gold, white while the pointer is on it.
  CB.Art.defineSprite('title_chev', [
    '...q',
    '..q.',
    '.q..',
    'q...',
    '.q..',
    '..q.',
    '...q',
  ]);

  // Optional modules are called by method, never by object only: tests stub partial ones.
  function sfx(name) {
    if (CB.Audio && typeof CB.Audio.play === 'function') CB.Audio.play(name);
  }
  function modesOn() {
    const u = CB.Unlocks;
    return !!(u && typeof u.has === 'function' && u.has('modes'));
  }
  // The daily build needs CB.Daily; a module that is missing or only partly there leaves the title as it was.
  function dailyOn() {
    const d = CB.Daily;
    return !!(d && typeof d.today === 'function' && typeof d.seedFor === 'function' && typeof d.patchFor === 'function');
  }
  function dailyDone() {
    const d = CB.Daily;
    return !!(dailyOn() && typeof d.result === 'function' && d.result(d.today()));
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
  const isDevice = (d) => d === 'kbm' || d === 'pad' || d === 'touch';
  // The device in use: CB.Prompts keeps it, the game's input is the fallback; no module, no input or an unknown value reads as keyboard + mouse.
  function deviceOf(game) {
    const p = CB.Prompts && CB.Prompts.device;
    if (isDevice(p)) return p;
    const i = game && game.input && game.input.device;
    return isDevice(i) ? i : 'kbm';
  }
  // CB.Screens.toggles lives in screens.js, which not every test loads.
  function chips() {
    const T = CB.Screens && CB.Screens.toggles;
    return T && typeof T.hit === 'function' && typeof T.apply === 'function' && typeof T.draw === 'function' ? T : null;
  }

  // CB.Install (src/core/install.js) is optional too: its kind() is 'prompt', 'ios' or null, and standalone reads as installed. A module that throws reads as none.
  function installKind() {
    const I = CB.Install;
    try {
      if (!I || typeof I.kind !== 'function') return null;
      if (typeof I.standalone === 'function' && I.standalone()) return null;
      return I.kind() || null;
    } catch (e) {
      return null;
    }
  }

  // The mode buttons the player has used (`seenModes` under CB.Save); the new ones wear a "new" pip. Without CB.Save it lasts for the session.
  let sessionSeen = {};
  function seenModes() {
    const S = CB.Save;
    if (!(S && typeof S.get === 'function')) return sessionSeen;
    const v = S.get('seenModes', {});
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function markSeen(id) {
    const seen = seenModes();
    if (seen[id] === true) return;
    const next = Object.assign({}, seen, { [id]: true });
    if (CB.Save && typeof CB.Save.set === 'function') CB.Save.set('seenModes', next);
    else sessionSeen = next;
  }

  const inside = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

  // A dashed frame, 1 px thick: 2 px lit, 2 px dark along each side, counted in from both ends so the corners are always lit and the sides mirror. It spans exactly `b`.
  function dashFrame(r, b, color) {
    const lit = (i, n) => Math.min(i, n - 1 - i) % 4 < 2;
    const runs = (n, draw) => {
      for (let i = 0; i < n; i++) {
        if (!lit(i, n)) continue;
        let j = i + 1;
        while (j < n && lit(j, n)) j++;
        draw(i, j - i);
        i = j; // j is dark (or the end); the loop's own step skips it
      }
    };
    runs(b.w, (i, len) => {
      r.rect(b.x + i, b.y, len, 1, color);
      r.rect(b.x + i, b.y + b.h - 1, len, 1, color);
    });
    runs(b.h, (i, len) => {
      r.rect(b.x, b.y + i, 1, len, color);
      r.rect(b.x + b.w - 1, b.y + i, 1, len, color);
    });
  }

  CB.Scenes.title = {
    BUTTONS,
    START_BOX,
    HAT_BOX,
    HAT_LEFT,
    HAT_RIGHT,
    INSTALL_BOX,
    CARD,
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
    focus: null, // the pad's focus: 'install', 'hat', 'start', a mode button ('rush', 'daily', 'yolo'), a chip ('sound', 'music', 'calm') or null (A then starts, as ever)
    lastDevice: 'kbm', // the device at the last update: the press that switches kbm to pad only wakes the pad
    descId: null, // the mode button whose description a tap or the pad's X keeps up, for descT more seconds
    descT: 0,

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
      this.focus = null;
      this.lastDevice = this.device();
      this.descId = null;
      this.descT = 0;
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

    // Messages from the page ("controller connected").
    notify(text) {
      this.setToast(text, TOAST_NOTIFY_T);
    },

    device() {
      return deviceOf(this.game);
    },

    // The prompt for `key` on the current device; `kbm` shows when CB.Prompts is not loaded.
    say(key, kbm) {
      const P = CB.Prompts;
      return (P && typeof P.text === 'function' && P.text(key, this.device())) || kbm;
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
      if (runOpts && runOpts.bossRush) markSeen('rush');
      // A phone goes fullscreen (and landscape) on the next finger lift: a touch press alone is not a user activation.
      const input = this.game && this.game.input;
      if (this.device() === 'touch' && input && typeof input.requestFullscreenOnRelease === 'function') input.requestFullscreenOnRelease();
      this.game.go('play', { runOpts });
    },

    // Today's daily build: UTC date, its seed and its starting patch; --yolo may ride along. Every other start leaves these out.
    startDaily() {
      const d = CB.Daily;
      const key = d.today();
      const patch = d.patchFor(key);
      this.start({ daily: key, seed: d.seedFor(key), patches: patch ? { [patch]: 1 } : {}, yolo: this.yolo });
    },

    // --yolo flips, chimes, and its description stays up for a moment (a finger or a pad has no hover to keep it there).
    toggleYolo() {
      this.yolo = !this.yolo;
      markSeen('yolo');
      this.descId = 'yolo';
      this.descT = DESC_T;
      sfx('uiSelect');
    },

    // The box a pointer hits for a mode button: exactly its outermost drawn frame (BUTTONS holds the single frame; --yolo ON draws one more around it, but a locked --yolo never does).
    hit(b) {
      return b === YOLO_BOX && this.yolo && modesOn() ? YOLO_ON_BOX : b;
    },

    // The locked mode button under (x, y), or null (all of them are unlocked, or the point is elsewhere).
    lockedAt(x, y) {
      if (modesOn()) return null;
      if (inside(RUSH_BOX, x, y)) return 'rush';
      if (inside(YOLO_BOX, x, y)) return 'yolo';
      return null;
    },

    // A click, tap or pad press on a locked button: nothing starts and nothing toggles, the toast says what unlocks it (and only the toast: the same words twice was noise).
    pokeLocked(id) {
      this.setToast('win a full run to unlock ' + LOCKED_NAME[id], TOAST_LOCKED_T);
      sfx('uiSelect');
    },

    // Enter, or a click or tap that missed the chips, the hat row and the locked buttons (so it is on a button or anywhere else), past the input lock. Returns true when it started a run.
    // Enter over a locked button is "anywhere else": the pointer's last spot must never keep a keyboard player from starting.
    confirm(x, y) {
      if (dailyOn() && inside(DAILY_BOX, x, y)) {
        this.startDaily();
        return true;
      }
      if (modesOn()) {
        if (inside(RUSH_BOX, x, y)) {
          this.start({ bossRush: true, yolo: this.yolo });
          return true;
        }
        if (inside(this.hit(YOLO_BOX), x, y)) {
          this.toggleYolo();
          return false;
        }
      }
      this.start({ yolo: this.yolo });
      return true;
    },

    // The install button: iOS has no prompt to show, so a card says where Share and Add to Home Screen are; elsewhere the browser's own prompt answers with a toast.
    install() {
      const kind = installKind();
      const I = CB.Install;
      if (!kind) return;
      sfx('uiSelect');
      try {
        if (kind === 'ios') {
          if (typeof I.showIosHelp === 'function') I.showIosHelp();
          return;
        }
        if (typeof I.prompt !== 'function') return;
        Promise.resolve(I.prompt()).then((res) => {
          if (res === 'accepted') this.setToast('installing Clawd ✓', TOAST_NOTIFY_T);
          else if (res === 'dismissed') this.setToast('install skipped', TOAST_CALM_T);
          else this.setToast('use your browser menu to install', TOAST_NOTIFY_T);
        }, () => {});
      } catch (e) {
        // an install that fails is a button that did nothing, never a broken title
      }
    },

    // Every control a tap can land on, as a box, for the near-miss rule: install, the hat row, the mode buttons (locked ones too), START and the chips.
    controls() {
      const out = [];
      if (installKind()) out.push(INSTALL_BOX);
      if (hatIds().length > 0 && CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') out.push(HAT_BOX);
      if (dailyOn()) out.push(this.hit(DAILY_BOX));
      out.push(this.hit(RUSH_BOX), this.hit(YOLO_BOX), START_BOX);
      const T = chips();
      if (T && typeof T.boxes === 'function') for (const b of T.boxes(Y.status)) out.push(b);
      return out;
    },

    // A touch that is on no control but within NEAR_PX of one counts as a touch on the nearest (ties go to the first listed); the point moves just inside that control.
    // Null when the touch is on a control already or nothing is near, and the tap then goes on as it always has (anywhere else starts).
    snap(x, y) {
      let best = null;
      let bestD = NEAR_PX + 1e-6;
      for (const b of this.controls()) {
        const px = Math.max(b.x, Math.min(b.x + b.w - 1, x));
        const py = Math.max(b.y, Math.min(b.y + b.h - 1, y));
        const d = Math.hypot(px - x, py - y);
        if (d === 0) return null;
        if (d < bestD) {
          bestD = d;
          best = { x: px, y: py };
        }
      }
      return best;
    },

    // A mouse click or a touch tap at (x, y), past the input lock: install, a chip, the hat arrows and row, a locked mode button, a mode button, else start (the START button is just a part of "else"). True when it started a run.
    tapAt(x, y) {
      const touch = this.device() === 'touch';
      if (touch) {
        const near = this.snap(x, y);
        if (near) {
          x = near.x;
          y = near.y;
        }
      }
      if (installKind() && inside(INSTALL_BOX, x, y)) {
        this.install();
        return false;
      }
      const T = chips();
      const id = T ? T.hit(x, y, Y.status, touch ? TOUCH_PAD : undefined) : null;
      if (id) {
        T.apply(id);
        return false;
      }
      if (hatIds().length > 0 && inside(HAT_BOX, x, y) && CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') {
        this.cycleHat(inside(HAT_LEFT, x, y) ? -1 : 1);
        return false;
      }
      const locked = this.lockedAt(x, y);
      if (locked) {
        this.pokeLocked(locked);
        return false;
      }
      return this.confirm(x, y);
    },

    // The pad's focus ring, top to bottom: install, the hat, START, the modes (left to right), the chips; each item with the x of its centre, so up and down keep the column.
    rows() {
      const mid = (b) => b.x + b.w / 2;
      const rows = [];
      if (installKind()) rows.push([{ id: 'install', cx: mid(INSTALL_BOX) }]);
      if (hatIds().length > 0) rows.push([{ id: 'hat', cx: CB.W / 2 }]);
      rows.push([{ id: 'start', cx: mid(START_BOX) }]);
      const modes = [{ id: 'rush', cx: mid(RUSH_BOX) }];
      if (dailyOn()) modes.push({ id: 'daily', cx: mid(DAILY_BOX) });
      modes.push({ id: 'yolo', cx: mid(YOLO_BOX) });
      rows.push(modes);
      const T = chips();
      const cs = T && typeof T.boxes === 'function' ? T.boxes(Y.status).map((b) => ({ id: b.id, cx: mid(b) })) : [];
      if (cs.length) rows.push(cs);
      return rows;
    },

    // One D-pad or stick press. The first one lights START without moving (like the pause menu's first chip); then left and right walk a row (on the hat row they wear another hat),
    // up and down change rows and land on the item nearest in x.
    navigate(dx, dy) {
      const rows = this.rows();
      let ri = -1;
      let ci = -1;
      rows.forEach((row, i) => row.forEach((it, j) => {
        if (it.id === this.focus) {
          ri = i;
          ci = j;
        }
      }));
      if (ri < 0) {
        this.focus = 'start';
        sfx('uiSelect');
        return;
      }
      if (dy) {
        const to = Math.max(0, Math.min(rows.length - 1, ri + dy));
        if (to === ri) return;
        const cx = rows[ri][ci].cx;
        let pick = rows[to][0];
        for (const it of rows[to]) if (Math.abs(it.cx - cx) < Math.abs(pick.cx - cx)) pick = it;
        this.focus = pick.id;
      } else if (dx) {
        if (this.focus === 'hat') {
          if (CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') this.cycleHat(dx);
          return;
        }
        const row = rows[ri];
        this.focus = row[(ci + dx + row.length) % row.length].id;
      } else return;
      sfx('uiSelect');
    },

    // A on the focused item. True when it started a run.
    activate(id) {
      const T = chips();
      switch (id) {
        case 'install':
          this.install();
          return false;
        case 'hat':
          if (CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') this.cycleHat(1);
          return false;
        case 'rush':
          if (!modesOn()) {
            this.pokeLocked('rush');
            return false;
          }
          this.start({ bossRush: true, yolo: this.yolo });
          return true;
        case 'daily':
          if (!dailyOn()) return false;
          this.startDaily();
          return true;
        case 'yolo':
          if (!modesOn()) {
            this.pokeLocked('yolo');
            return false;
          }
          this.toggleYolo();
          return false;
        case 'sound':
        case 'music':
        case 'calm':
          if (T) T.apply(id);
          return false;
        default:
          this.start({ yolo: this.yolo });
          return true;
      }
    },

    update(dt, input) {
      let inp = input || {};
      // The press that switches the device from keyboard or mouse to the pad only wakes the pad: nothing it carries (A, a D-pad flick) acts. Going back to another device drops the focus.
      const dev = this.device();
      if (dev === 'pad' && this.lastDevice !== 'pad') inp = Object.assign({}, inp, { pad: null, confirm: false, dash: false, compact: false, quit: false, navX: 0, navY: 0 });
      else if (dev !== 'pad' && this.lastDevice === 'pad') this.focus = null;
      this.lastDevice = dev;
      this.t += dt;
      if (Number.isFinite(inp.aimX) && Number.isFinite(inp.aimY)) {
        this.aimX = inp.aimX;
        this.aimY = inp.aimY;
      }
      if (this.toast) {
        this.toast.t -= dt;
        if (this.toast.t <= 0) this.toast = null;
      }
      if (this.descT > 0) this.descT = Math.max(0, this.descT - dt);
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
      const pad = inp.pad || null;
      const edge = (k) => !!(pad && pad[k]);
      const open = this.t >= START_LOCK - 1e-6;
      // Hats are Q and E (the arrows and A/D are how the secret codes are typed) and the pad's LB and RB. The pad's Back and B raise the
      // quit and compact edges too, but they are not hat buttons; the pad edges wait out the input lock like every other title edge.
      const hatBack = (inp.quit && !edge('back')) || (edge('lb') && open);
      const hatNext = inp.compact && !edge('b') && (open || !edge('rb'));
      if ((hatBack || hatNext) && hatIds().length > 0 && CB.Unlocks && typeof CB.Unlocks.cycleHat === 'function') {
        if (hatBack) this.cycleHat(-1);
        if (hatNext) this.cycleHat(1);
      }
      if (!open) {
        this.animate(dt);
        return;
      }
      // Pad: A starts (its confirm edge is not also read as a click at the old pointer spot), B the daily build, Y boss rush, X --yolo (locked, Y and X say what unlocks them).
      if (pad) {
        // The D-pad and the L-stick walk the focus (a keyboard's arrows also say navX, so only the pad's own device does); A then activates it, with none it starts. Start always begins a normal run.
        if (dev === 'pad') {
          const nx = Number.isFinite(inp.navX) ? Math.sign(inp.navX) : 0;
          const ny = Number.isFinite(inp.navY) ? Math.sign(inp.navY) : 0;
          if (nx || ny) this.navigate(ny ? 0 : nx, ny);
        }
        if (pad.start) {
          this.start({ yolo: this.yolo });
          return;
        }
        if (pad.a) {
          if (!this.focus) {
            this.start({ yolo: this.yolo });
            return;
          }
          if (this.activate(this.focus)) return;
          this.animate(dt);
          return;
        }
        if (pad.b && dailyOn()) {
          this.startDaily();
          return;
        }
        if (modesOn()) {
          if (pad.y) {
            this.start({ bossRush: true, yolo: this.yolo });
            return;
          }
          if (pad.x) this.toggleYolo();
        } else if (pad.y) this.pokeLocked('rush');
        else if (pad.x) this.pokeLocked('yolo');
      }
      // A click or tap hits the chips, the hat row and the mode buttons; Enter (a confirm with no pointer press) reads the pointer's last spot as it always has.
      if (inp.tap) {
        if (this.tapAt(this.aimX, this.aimY)) return;
      } else if (inp.confirm && this.confirm(this.aimX, this.aimY)) return;
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
      // Only a mouse has a pointer worth drawing; a finger or a pad does not.
      if (this.device() === 'kbm' && CB.Screens.hud && typeof CB.Screens.hud.cursor === 'function') CB.Screens.hud.cursor(r, aim.x, aim.y, 'pointer', t);
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

    // Frame, fill and label of one framed button in the toggle chips' look: ink at 0.6, a frame, a centred label.
    // o: lit (the pointer or the pad's focus is on it), on (--yolo is on: red, and the frame is doubled so it is not colour only).
    drawButton(r, b, label, o) {
      const lit = !!o.lit;
      const on = !!o.on;
      const frame = on ? (lit ? C.hurt : C.red) : lit ? C.gold : C.grey;
      r.alpha(0.6, () => r.rect(b.x, b.y, b.w, b.h, C.ink));
      r.frame(b.x, b.y, b.w, b.h, frame);
      if (on) r.frame(b.x - 1, b.y - 1, b.w + 2, b.h + 2, frame); // the second frame sits just outside the single-frame box, in the gap between buttons; hit() counts it
      r.text(label, b.x + b.w / 2, b.y + 2, { color: on ? C.red : lit ? C.white : C.pale, align: 'center' });
    },

    // A locked mode button: its box, filled like the others, but framed with dashes and written in grey, so the shape and not only the colour says "locked". It never lights up; the description line and the toast do the talking.
    drawLocked(r, b, label) {
      r.alpha(0.6, () => r.rect(b.x, b.y, b.w, b.h, C.ink));
      dashFrame(r, b, C.greyDark);
      r.text(label, b.x + b.w / 2, b.y + 2, { color: C.grey, align: 'center' }); // grey: greyDark was too faint to read what unlocks it
    },

    // A small gold "new" pip sitting on a corner of a mode button the player has not used yet (`left` puts it on the left corner, so neither pip crowds START).
    drawPip(r, b, left) {
      const w = r.measure('new', 1) + 4;
      const x = left ? b.x : b.x + b.w - w;
      r.rect(x, b.y - 7, w, 7, C.gold); // a tag sitting on the button's top edge, touching nothing: its text cell ends on the row above the frame
      r.text('new', x + 2, b.y - 8, { color: C.ink });
    },

    // The START button: clawd orange, its frame swapping between two shades through Comfort.blink (steady in calm mode); the text never blinks.
    drawStart(r, t, lit) {
      const b = START_BOX;
      const calm = !!(CB.Comfort && typeof CB.Comfort.calm === 'function' && CB.Comfort.calm());
      const bright = !calm && (CB.Comfort && typeof CB.Comfort.blink === 'function' ? CB.Comfort.blink(t, PULSE_HZ) : Math.floor(t * PULSE_HZ) % 2 === 0);
      r.alpha(lit ? 0.75 : bright ? 0.55 : 0.4, () => r.rect(b.x, b.y, b.w, b.h, C.clawdDark));
      r.frame(b.x, b.y, b.w, b.h, lit ? C.white : bright ? C.clawdLight : C.clawd);
      if (this.focus === 'start') r.frame(b.x - 1, b.y - 1, b.w + 2, b.h + 2, C.gold); // the pad's focus: a gold ring just outside the frame
      r.text(this.say('start', 'Click to start'), b.x + b.w / 2, b.y + 3, { color: C.white, shadow: C.ink, align: 'center' });
    },

    // "Q ‹ Crown › E": the worn hat between two chevrons, the key hints outside them (the hat prompt is "(Q/E)", "(LB/RB)" or "(tap)"; a phone has no keys to name).
    drawHatRow(r, aim, mouse) {
      const mid = CB.W / 2;
      const id = wornHat();
      const name = id ? hatName(id) : 'no hat';
      const keys = String(this.say('hat', '(Q/E)')).replace(/[()]/g, '').split('/');
      const hint = keys.length === 2 && keys[0] && keys[1] ? keys : null;
      const lx = mid - HAT_FIELD / 2 - CHEV_GAP - CHEV_W;
      const rx = mid + HAT_FIELD / 2 + CHEV_GAP;
      const cy = Y.hat + 3.5;
      const left = mouse && inside(HAT_LEFT, aim.x, aim.y);
      const right = mouse && inside(HAT_RIGHT, aim.x, aim.y);
      if (this.focus === 'hat') r.frame(HAT_BOX.x, HAT_BOX.y, HAT_BOX.w, HAT_BOX.h, C.gold);
      r.text(name, mid, Y.hat, { color: C.pale, align: 'center' });
      r.sprite('title_chev', lx + CHEV_W / 2, cy, { white: left || this.focus === 'hat' });
      r.sprite('title_chev', rx + CHEV_W / 2, cy, { flip: true, white: right || this.focus === 'hat' });
      if (hint) {
        r.text(hint[0], lx - HINT_GAP, Y.hat, { color: C.grey, align: 'right' });
        r.text(hint[1], rx + CHEV_W + HINT_GAP, Y.hat, { color: C.grey });
      }
    },

    // The mode button whose description is up: the one under the mouse, else the pad's focus, else the --yolo a tap or X just flipped (or the locked button a tap or press just poked). Null when it is not on the title.
    describedId(aim, mouse) {
      let id = null;
      if (mouse) for (const b of BUTTONS) if (inside(this.hit(b), aim.x, aim.y)) id = b.id;
      if (!id && typeof this.focus === 'string') id = this.focus;
      if (!id && this.descT > 0) id = this.descId;
      if (!Object.prototype.hasOwnProperty.call(DESC, id)) return null;
      return id === 'daily' && !dailyOn() ? null : id; // a locked rush or yolo is on the title too: its description says what unlocks it
    },

    drawText(r, t, aim) {
      const mid = CB.W / 2;
      const dev = this.device();
      const mouse = dev === 'kbm'; // only a mouse has a pointer to hover with
      const pad = dev === 'pad'; // the pad has no pointer: its buttons are named on the labels
      const hats = hatIds().length > 0;
      const hover = (b) => mouse && inside(b, aim.x, aim.y);

      // The card the menu sits on, so it does not fight the arena's code lines.
      r.alpha(0.7, () => r.rect(CARD.x, CARD.top, CARD.w, CARD.bottom - CARD.top, C.ink));
      r.frame(CARD.x, CARD.top, CARD.w, CARD.bottom - CARD.top, C.greyDark);

      if (installKind()) this.drawButton(r, INSTALL_BOX, 'install', { lit: hover(INSTALL_BOX) || this.focus === 'install' });
      if (pad && !this.focus) r.alpha(0.8, () => r.text(PAD_HINT, HINT_PAD.x, HINT_PAD.y, { color: C.grey }));

      if (hats) this.drawHatRow(r, aim, mouse);
      else r.text(HATS_LOCKED, mid, Y.hat, { color: C.grey, align: 'center' }); // the picker's place until a hat is earned: dim, no arrows, no keys, no taps
      this.drawStart(r, t, hover(START_BOX));

      const tag = (key, label) => (pad ? key + ' ' + label : label); // the pad's buttons are named in front of the label
      if (dailyOn()) this.drawButton(r, DAILY_BOX, tag('B', 'daily build' + (dailyDone() ? ' ✓' : '')), { lit: hover(DAILY_BOX) || this.focus === 'daily' });
      if (modesOn()) {
        this.drawButton(r, RUSH_BOX, tag('Y', 'boss rush'), { lit: hover(RUSH_BOX) || this.focus === 'rush' });
        this.drawButton(r, YOLO_BOX, tag('X', '--yolo: ' + (this.yolo ? 'ON' : 'off')), { lit: hover(this.hit(YOLO_BOX)) || this.focus === 'yolo', on: this.yolo });
        const seen = seenModes();
        if (seen.rush !== true) this.drawPip(r, RUSH_BOX, true);
        if (seen.yolo !== true) this.drawPip(r, this.hit(YOLO_BOX), false);
      } else {
        this.drawLocked(r, RUSH_BOX, tag('Y', LOCKED_NAME.rush));
        this.drawLocked(r, YOLO_BOX, tag('X', LOCKED_NAME.yolo));
      }

      // One line under the buttons: what the button under the pointer does, else the controls, dimmer so they sit behind the buttons.
      const id = this.describedId(aim, mouse);
      if (id) r.text(id !== 'daily' && !modesOn() ? DESC_LOCKED : DESC[id], mid, Y.desc, { color: C.pale, align: 'center' }); // centred on the two legend rows it stands in for
      else {
        r.text(this.say('legend1', 'WASD move · Mouse aim · Click shoot'), mid, Y.line1, { color: C.grey, align: 'center' });
        r.text(this.say('legend2', 'Space dash · E /compact · Esc pause'), mid, Y.line2, { color: C.grey, align: 'center' });
      }

      // The sound / music / calm chips close the card.
      const T = chips();
      if (T) T.draw(r, Y.status, Array.isArray(T.IDS) ? T.IDS.indexOf(this.focus) : -1, mouse ? aim : null);

      // The last row, under the card, sits on a dark band so the dim text stays readable over the arena's wall. The disclaimer has it; a toast takes it
      // (a heavier band, fading with the toast) and never covers a button.
      const a = this.toast ? Math.min(1, this.toast.t / TOAST_FADE) : 0;
      r.alpha(FOOTER_ALPHA + (TOAST_ALPHA - FOOTER_ALPHA) * a, () => r.rect(0, CARD.bottom, CB.W, CB.H - CARD.bottom, C.ink));
      if (this.toast) r.alpha(a, () => r.text(this.toast.text, mid, Y.footer, { color: C.gold, align: 'center' }));
      else r.text(DISCLAIMER, mid, Y.footer, { color: C.grey, align: 'center' }); // grey, not greyDark: it must stay readable on the band
    },
  };
})(window.CB);
