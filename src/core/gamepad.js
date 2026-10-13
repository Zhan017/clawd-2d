// Standard-mapping gamepad → plain data: sticks, D-pad, fire and one-shot button edges per poll, plus dual-rumble. Pure apart from the state it is handed.
(function (CB) {
  'use strict';
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const DZ_MOVE = 0.25; // L-stick radial deadzone
  const DZ_AIM = 0.3; // R-stick radial deadzone
  const FIRE_AT = 0.5; // R-stick deflection that auto-fires
  const TRIGGER_AT = 0.35; // a trigger counts as pressed from here
  const NAV_ON = 0.6; // an L-stick axis past this is one menu flick...
  const NAV_OFF = 0.3; // ...and must fall back under this before the next one
  const BUTTONS = 16; // the standard mapping
  const PRESS_AT = 0.5; // an analog button with no `pressed` flag counts as down past this

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const noop = () => {};

  function createState() {
    return { prev: [], lt: false, navLatchX: 0, navLatchY: 0 };
  }

  // The first connected pad, preferring one that reports the standard mapping. `list` is navigator.getGamepads() (nulls and all).
  function pick(list) {
    if (!list || typeof list !== 'object' || typeof list.length !== 'number') return null;
    let first = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || typeof p !== 'object' || p.connected === false) continue;
      if (p.mapping === 'standard') return p;
      if (!first) first = p;
    }
    return first;
  }

  // A stick axis flick: fires once at NAV_ON, then stays latched until the axis falls under NAV_OFF. Returns [edge, latch].
  function flick(v, latch) {
    if (latch === 0) {
      if (Math.abs(v) >= NAV_ON) {
        const s = v < 0 ? -1 : 1;
        return [s, s];
      }
      return [0, 0];
    }
    return [0, Math.abs(v) < NAV_OFF ? 0 : latch];
  }

  function idle() {
    return {
      active: false, moveX: 0, moveY: 0, aimDirX: null, aimDirY: null, fire: false,
      edges: { confirm: false, dash: false, compact: false, pause: false, quit: false },
      pad: { a: false, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false },
      navX: 0, navY: 0,
    };
  }

  // One poll of `pad` (a Gamepad, or null). `state` carries what the next poll needs: last tick's buttons and the stick latches.
  // A null pad changes nothing in `state`, so a button held across a reconnect does not fire a second edge.
  function read(pad, state) {
    const out = idle();
    if (!pad) return out;
    const st = state || createState();
    if (!Array.isArray(st.prev)) st.prev = [];

    const buttons = pad.buttons || [];
    const axes = pad.axes || [];
    const axis = (i) => num(axes[i]);
    const pressed = (b) => !!(b && (b.pressed || b.value > PRESS_AT));
    const trigger = (b) => (b ? (typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0) : 0);

    // This tick's down-state for the 16 standard buttons (triggers by TRIGGER_AT); `active` also looks at any extra buttons.
    const down = [];
    let anyDown = false;
    for (let i = 0; i < Math.max(BUTTONS, buttons.length); i++) {
      const b = buttons[i];
      const d = i === BTN.LT || i === BTN.RT ? trigger(b) >= TRIGGER_AT : pressed(b);
      if (i < BUTTONS) down[i] = d;
      if (d) anyDown = true;
    }
    const edge = (i) => down[i] && !st.prev[i];
    const lt = down[BTN.LT];
    const ltEdge = lt && !st.lt;

    // Sticks.
    const lx = axis(0);
    const ly = axis(1);
    const rx = axis(2);
    const ry = axis(3);
    const lMag = Math.hypot(lx, ly);
    const rMag = Math.hypot(rx, ry);

    const dpad = down[BTN.UP] || down[BTN.DOWN] || down[BTN.LEFT] || down[BTN.RIGHT];
    if (dpad) {
      out.moveX = (down[BTN.RIGHT] ? 1 : 0) - (down[BTN.LEFT] ? 1 : 0);
      out.moveY = (down[BTN.DOWN] ? 1 : 0) - (down[BTN.UP] ? 1 : 0);
    } else if (lMag >= DZ_MOVE) {
      out.moveX = lx + 0; // + 0 turns -0 into 0
      out.moveY = ly + 0;
    }
    if (rMag >= DZ_AIM) {
      out.aimDirX = rx / rMag + 0;
      out.aimDirY = ry / rMag + 0;
    }
    out.fire = rMag >= FIRE_AT || trigger(buttons[BTN.RT]) >= TRIGGER_AT;
    out.active = anyDown || lMag >= DZ_MOVE || rMag >= DZ_AIM;

    // Edges.
    const e = out.pad;
    e.a = edge(BTN.A);
    e.b = edge(BTN.B);
    e.x = edge(BTN.X);
    e.y = edge(BTN.Y);
    e.lb = edge(BTN.LB);
    e.rb = edge(BTN.RB);
    e.start = edge(BTN.START);
    e.back = edge(BTN.BACK);
    out.edges.confirm = e.a;
    out.edges.dash = e.a || e.lb || ltEdge;
    out.edges.compact = e.rb || e.b;
    out.edges.pause = e.start;
    out.edges.quit = e.back;

    // Menu navigation: a D-pad press wins, else an L-stick flick on that axis.
    const fx = flick(lx, num(st.navLatchX));
    const fy = flick(ly, num(st.navLatchY));
    const dx = (edge(BTN.RIGHT) ? 1 : 0) - (edge(BTN.LEFT) ? 1 : 0);
    const dy = (edge(BTN.DOWN) ? 1 : 0) - (edge(BTN.UP) ? 1 : 0);
    out.navX = dx || fx[0];
    out.navY = dy || fy[0];

    // Remember this tick.
    for (let i = 0; i < BUTTONS; i++) st.prev[i] = down[i];
    st.lt = lt;
    st.navLatchX = fx[1];
    st.navLatchY = fy[1];
    return out;
  }

  // Dual-rumble through the pad's vibrationActuator. Safe to call on any pad (or none): returns whether an effect was requested.
  function rumble(pad, strong, weak, ms) {
    try {
      const act = pad && pad.vibrationActuator;
      if (!act || typeof act.playEffect !== 'function') return false;
      const p = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(0, num(ms)),
        weakMagnitude: clamp(num(weak), 0, 1),
        strongMagnitude: clamp(num(strong), 0, 1),
      });
      if (p && typeof p.then === 'function') p.then(null, noop); // a refused effect (pad asleep, tab hidden) is not an error
      return true;
    } catch (e) {
      return false;
    }
  }

  CB.Gamepad = { BTN, DZ_MOVE, DZ_AIM, FIRE_AT, TRIGGER_AT, NAV_ON, NAV_OFF, pick, createState, read, rumble };
})(window.CB);
