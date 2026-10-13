// Share: the victory result as text, sent to the share sheet or the clipboard. Optional module: callers guard `if (CB.Share)`.
(function (CB) {
  'use strict';
  const SITE = 'https://clawd-2d.vercel.app';
  const TITLE = 'Clawd vs Bugs';
  const OWN = Object.prototype.hasOwnProperty;

  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const whole = (v) => Math.floor(Math.max(0, num(v, 0)));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // "mm:ss", minutes padded to two digits (what the victory screen shows).
  function formatTime(seconds) {
    const s = whole(seconds);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // Every kind squashed, added up.
  function bugsSquashed(run) {
    const sq = run.squashed && typeof run.squashed === 'object' ? run.squashed : {};
    let total = 0;
    for (const k of Object.keys(sq)) total += whole(sq[k]);
    return total;
  }

  // Patch id -> times taken. What the run holds (which includes a daily build's starting patch); a run that only has its pick history counts that.
  function patchCounts(run) {
    const out = {};
    const held = run.patches && typeof run.patches === 'object' ? run.patches : {};
    for (const id of Object.keys(held)) if (whole(held[id]) > 0) out[id] = whole(held[id]);
    if (Object.keys(out).length) return out;
    for (const id of Array.isArray(run.history) ? run.history : []) out[String(id)] = (out[String(id)] || 0) + 1;
    return out;
  }

  // "Spread Shot, Rapid Fire ×2" in CB.Patches.ORDER order, or "no patches".
  function patchesLine(run) {
    const counts = patchCounts(run);
    const P = CB.Patches;
    const order = P && Array.isArray(P.ORDER) ? P.ORDER : Object.keys(counts);
    const defs = (P && P.DEFS) || {};
    const parts = order.filter((id) => OWN.call(counts, id)).map((id) => (defs[id] && defs[id].name ? defs[id].name : id) + (counts[id] > 1 ? ' ×' + counts[id] : ''));
    return parts.length ? parts.join(', ') : 'no patches';
  }

  // The modes that apply to the run, in the order daily, boss rush, --yolo; '' when it was a plain run.
  function modesLine(run) {
    const daily = typeof run.daily === 'string' && run.daily;
    const parts = [];
    if (daily) parts.push('Daily build ' + run.daily);
    if (run.bossRush) parts.push('Boss rush');
    if (run.yolo) parts.push('--yolo');
    return parts.length ? (daily ? '📅 ' : '🎮 ') + parts.join(' · ') : '';
  }

  // The result as plain text (emoji allowed: it goes to the clipboard, not the bitmap font).
  function text(run) {
    const r = run && typeof run === 'object' ? run : {};
    const deaths = whole(r.deaths);
    const bugs = bugsSquashed(r);
    const lines = [
      'Clawd vs Bugs: ALL TESTS PASSING ✓',
      '⏱ ' + formatTime(r.time) + ' · 💀 ' + plural(deaths, 'death', 'deaths') + ' · 🐛 ' + plural(bugs, 'bug', 'bugs') + ' squashed',
      '🔧 ' + patchesLine(r),
    ];
    const modes = modesLine(r);
    if (modes) lines.push(modes);
    lines.push(SITE);
    return lines.join('\n');
  }

  // The last resort: a hidden textarea and execCommand('copy'). 'copied' or 'failed'; never throws, and leaves the page as it found it.
  function viaTextarea(str, doc) {
    let area = null;
    let host = null;
    let prev = null;
    try {
      if (!doc || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return 'failed';
      host = doc.body || doc.documentElement;
      if (!host || typeof host.appendChild !== 'function') return 'failed';
      prev = doc.activeElement || null;
      area = doc.createElement('textarea');
      area.value = str;
      if (typeof area.setAttribute === 'function') area.setAttribute('readonly', '');
      if (area.style) {
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '-9999px';
        area.style.opacity = '0';
      }
      host.appendChild(area);
      if (typeof area.focus === 'function') area.focus();
      if (typeof area.select === 'function') area.select();
      if (typeof area.setSelectionRange === 'function') area.setSelectionRange(0, str.length);
      return doc.execCommand('copy') ? 'copied' : 'failed';
    } catch (err) {
      return 'failed';
    } finally {
      try {
        if (area && typeof area.remove === 'function') area.remove();
        else if (area && host && typeof host.removeChild === 'function') host.removeChild(area);
        if (prev && typeof prev.focus === 'function') prev.focus();
      } catch (err) {
        // a textarea that will not leave is not worth failing for
      }
    }
  }

  // navigator.clipboard.writeText, then the textarea when it is missing, throws or is refused.
  function viaClipboard(str, nav, doc) {
    try {
      const clip = nav && nav.clipboard;
      if (clip && typeof clip.writeText === 'function') return Promise.resolve(clip.writeText(str)).then(() => 'copied', () => viaTextarea(str, doc));
    } catch (err) {
      // fall through to the textarea
    }
    return Promise.resolve(viaTextarea(str, doc));
  }

  // The system share sheet. Closing it is not a failure ('cancelled', and nothing else is tried); any other error falls back to the clipboard.
  function viaShare(str, nav, doc) {
    const aborted = (err) => !!err && err.name === 'AbortError';
    let sheet;
    try {
      sheet = nav.share({ title: TITLE, text: str });
    } catch (err) {
      return aborted(err) ? Promise.resolve('cancelled') : viaClipboard(str, nav, doc);
    }
    return Promise.resolve(sheet).then(() => 'shared', (err) => (aborted(err) ? 'cancelled' : viaClipboard(str, nav, doc)));
  }

  // Sends `str`: the share sheet on a touch device that has one, else the clipboard, else a hidden textarea. Resolves to
  // 'shared' | 'copied' | 'cancelled' | 'failed' and never throws or rejects. The first browser call is made before send() returns, so a caller
  // that runs inside a user activation (input.withActivation) still has it.
  function send(str, env) {
    try {
      const e = env && typeof env === 'object' ? env : {};
      if (typeof str !== 'string' || !str) return Promise.resolve('failed');
      if (e.device === 'touch' && e.nav && typeof e.nav.share === 'function') return viaShare(str, e.nav, e.doc);
      return viaClipboard(str, e.nav, e.doc);
    } catch (err) {
      return Promise.resolve('failed');
    }
  }

  CB.Share = { URL: SITE, text, send };
})(window.CB);
