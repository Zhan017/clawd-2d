// Fixed 60 Hz simulation with rAF rendering; catch-up capped; any exception stops the loop.
(function (CB) {
  'use strict';
  const MAX_STEPS = 5;
  const MAX_FRAME = 0.25;
  CB.LOOP = { MAX_STEPS, MAX_FRAME };

  CB.createLoop = function (o) {
    const now = o.now || (() => performance.now());
    const raf = o.raf || ((f) => requestAnimationFrame(f));
    const caf = o.caf || ((id) => cancelAnimationFrame(id));
    let acc = 0;
    let last = 0;
    let running = false;
    let id = 0;

    function frame() {
      if (!running) return;
      try {
        const t = now();
        let dt = (t - last) / 1000;
        last = t;
        if (dt > MAX_FRAME) dt = MAX_FRAME;
        if (dt < 0) dt = 0;
        acc += dt;
        let steps = 0;
        while (acc >= CB.DT && steps < MAX_STEPS) {
          o.update(CB.DT);
          acc -= CB.DT;
          steps++;
        }
        if (steps === MAX_STEPS) acc = 0;
        o.render(acc / CB.DT);
      } catch (err) {
        running = false;
        o.onError(err);
        return;
      }
      id = raf(frame);
    }

    return {
      start() {
        if (running) return;
        running = true;
        last = now();
        acc = 0;
        id = raf(frame);
      },
      stop() {
        running = false;
        caf(id);
      },
      get running() {
        return running;
      },
    };
  };
})(window.CB);
