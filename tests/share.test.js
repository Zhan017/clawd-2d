'use strict';
// Share: CB.Share.text for every mode combination, CB.Share.send down every path (share sheet, clipboard, hidden textarea, and what each does
// when it is missing, refuses or throws), the victory screen's share button against its hit box on every device, and the play scene's
// victory flow: C, the pad's X or a tap on the button shares and stays; any other confirm plays again; a daily run's result is recorded once.
// CB.Daily is the other agent's module, so it is stubbed here. The whole script list is loaded unless a test says otherwise.
const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness');

const DEVICES = ['kbm', 'touch', 'pad'];
const SITE = 'https://clawd-2d.vercel.app';
const LOAD = ['src/core/ns.js', 'src/game/patches.js', 'src/core/share.js'];
const tick = () => new Promise((resolve) => setImmediate(resolve)); // lets the promise chains in send() and the toast settle
const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
const denied = () => Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });

// A finished run with every field the text reads.
function mkRun(over) {
  return Object.assign({
    time: 522.4, deaths: 3, daily: null, bossRush: false, yolo: false,
    squashed: { syntaxError: 100, nullPointer: 50, raceCondition: 30, memoryLeak: 20, offByOne: 14 },
    patches: { spread: 1, rapid: 2 }, history: ['rapid', 'spread', 'rapid'],
  }, over || {});
}

// ---- text() ------------------------------------------------------------------------------------------------------------------------------

test('share text: the plan\'s example, line for line', () => {
  const CB = H.load(LOAD);
  const text = CB.Share.text(mkRun({ daily: '2026-10-13', yolo: true }));
  assert.equal(text, [
    'Clawd vs Bugs: ALL TESTS PASSING ✓',
    '⏱ 08:42 · 💀 3 deaths · 🐛 214 bugs squashed',
    '🔧 Spread Shot, Rapid Fire ×2',
    '📅 Daily build 2026-10-13 · --yolo',
    SITE,
  ].join('\n'));
  assert.equal(CB.Share.URL, SITE);
});

test('share text: a plain run has four lines and no modes line', () => {
  const CB = H.load(LOAD);
  const lines = CB.Share.text(mkRun()).split('\n');
  assert.deepEqual(lines, ['Clawd vs Bugs: ALL TESTS PASSING ✓', '⏱ 08:42 · 💀 3 deaths · 🐛 214 bugs squashed', '🔧 Spread Shot, Rapid Fire ×2', SITE]);
});

test('share text: the modes line holds only the parts that apply, in the order daily, boss rush, --yolo, for every combination', () => {
  const CB = H.load(LOAD);
  const K = '2026-10-13';
  const cases = [
    [{}, null],
    [{ daily: K }, '📅 Daily build ' + K],
    [{ bossRush: true }, '🎮 Boss rush'],
    [{ yolo: true }, '🎮 --yolo'],
    [{ daily: K, bossRush: true }, '📅 Daily build ' + K + ' · Boss rush'],
    [{ daily: K, yolo: true }, '📅 Daily build ' + K + ' · --yolo'],
    [{ bossRush: true, yolo: true }, '🎮 Boss rush · --yolo'],
    [{ daily: K, bossRush: true, yolo: true }, '📅 Daily build ' + K + ' · Boss rush · --yolo'],
  ];
  for (const [over, want] of cases) {
    const lines = CB.Share.text(mkRun(over)).split('\n');
    if (want === null) assert.equal(lines.length, 4, JSON.stringify(over));
    else {
      assert.equal(lines.length, 5, JSON.stringify(over));
      assert.equal(lines[3], want, JSON.stringify(over));
    }
    assert.equal(lines[lines.length - 1], SITE, 'the URL is always last');
    assert.equal(lines[0], 'Clawd vs Bugs: ALL TESTS PASSING ✓', 'and the title first');
  }
});

test('share text: a daily key that is not a string, and a mode flag that is not true, count as no mode', () => {
  const CB = H.load(LOAD);
  for (const daily of [null, undefined, '', 0, 5, true, {}, ['2026-10-13']]) assert.equal(CB.Share.text(mkRun({ daily })).split('\n').length, 4, JSON.stringify(daily));
  for (const flag of [false, 0, null, undefined, '', NaN]) assert.equal(CB.Share.text(mkRun({ bossRush: flag, yolo: flag })).split('\n').length, 4, String(flag));
  assert.match(CB.Share.text(mkRun({ yolo: 1 })), /--yolo/, 'truthy is on, as the run reads it');
});

test('share text: the time is mm:ss like the victory screen, clamped and floored', () => {
  const { Share, Screens } = H.load();
  const timeOf = (t) => Share.text(mkRun({ time: t })).split('\n')[1].split(' · ')[0];
  for (const t of [0, 0.9, 59.99, 61.9, 522, 600, 3599.5, 6000, -5, NaN, Infinity, undefined, null, '90']) {
    assert.equal(timeOf(t), '⏱ ' + Screens.victory.formatTime(t), String(t));
  }
  assert.equal(timeOf(522.4), '⏱ 08:42');
  assert.equal(timeOf(6000), '⏱ 100:00');
});

test('share text: deaths and bugs say one, many or none properly, and add every kind up', () => {
  const CB = H.load(LOAD);
  const stats = (o) => CB.Share.text(mkRun(o)).split('\n')[1].split(' · ').slice(1).join(' · ');
  assert.equal(stats({ deaths: 0, squashed: {} }), '💀 0 deaths · 🐛 0 bugs squashed');
  assert.equal(stats({ deaths: 1, squashed: { syntaxError: 1 } }), '💀 1 death · 🐛 1 bug squashed');
  assert.equal(stats({ deaths: 2, squashed: { syntaxError: 1, nullPointer: 1 } }), '💀 2 deaths · 🐛 2 bugs squashed');
  assert.equal(stats({ deaths: 12.9, squashed: { offByOne: 3.9, memoryLeak: 0.5 } }), '💀 12 deaths · 🐛 3 bugs squashed', 'whole numbers');
  assert.equal(stats({ deaths: -4, squashed: { syntaxError: -9, nullPointer: NaN, raceCondition: 'x', offByOne: Infinity, memoryLeak: 2 } }), '💀 0 deaths · 🐛 2 bugs squashed', 'junk counts as nothing');
  for (const sq of [undefined, null, 5, 'x', []]) assert.equal(stats({ squashed: sq }), '💀 3 deaths · 🐛 0 bugs squashed', JSON.stringify(sq));
  assert.equal(stats({ squashed: { anything: 7, other: 5 } }), '💀 3 deaths · 🐛 12 bugs squashed', 'every key is added, as it is the tally of whatever was squashed');
});

test('share text: patches are "Name ×n" in CB.Patches.ORDER order, names from DEFS, or "no patches"', () => {
  const CB = H.load(LOAD);
  const line = (o) => CB.Share.text(mkRun(o)).split('\n')[2];
  assert.equal(line({ patches: { spread: 1, rapid: 2 } }), '🔧 Spread Shot, Rapid Fire ×2');
  assert.equal(line({ patches: { ricochet: 1, spread: 2, heart: 1, dash: 1 } }), '🔧 Spread Shot ×2, Extra Heart, Quick Dash, Ricochet', 'ORDER order, not the order held');
  const all = {};
  for (const id of CB.Patches.ORDER) all[id] = 1;
  assert.equal(line({ patches: all }), '🔧 ' + CB.Patches.ORDER.map((id) => CB.Patches.DEFS[id].name).join(', '));
  assert.equal(line({ patches: {}, history: [] }), '🔧 no patches');
  assert.equal(line({ patches: undefined, history: undefined }), '🔧 no patches');
  assert.equal(line({ patches: { spread: 0, rapid: -1, pierce: NaN }, history: [] }), '🔧 no patches', 'zero and junk counts are not patches');
  assert.equal(line({ patches: { spread: 1, bogus: 3 } }), '🔧 Spread Shot', 'an id that is not a patch is left out');
  assert.equal(line({ patches: { rapid: 2.9 } }), '🔧 Rapid Fire ×2');
});

test('share text: what the run holds wins, so a daily build\'s starting patch is in it; a run with only a pick history counts that', () => {
  const CB = H.load(LOAD);
  const line = (o) => CB.Share.text(mkRun(o)).split('\n')[2];
  assert.equal(line({ patches: { rapid: 1, spread: 1 }, history: ['spread'] }), '🔧 Spread Shot, Rapid Fire', 'rapid was never picked: it was the daily patch');
  assert.equal(line({ patches: {}, history: ['rapid', 'spread', 'rapid'] }), '🔧 Spread Shot, Rapid Fire ×2');
  assert.equal(line({ patches: undefined, history: ['heavy', 'pierce'] }), '🔧 Pierce, Heavy Bolts');
  assert.equal(line({ patches: null, history: ['nonsense'] }), '🔧 no patches');
});

test('share text: a missing, bare or hostile run still makes a result and never throws', () => {
  const CB = H.load(LOAD);
  for (const run of [undefined, null, {}, 5, 'x', [], { squashed: 3, patches: 'x', history: 'x' }]) {
    const t = CB.Share.text(run);
    assert.equal(typeof t, 'string');
    assert.ok(t.startsWith('Clawd vs Bugs: ALL TESTS PASSING ✓\n⏱ 00:00 · 💀 0 deaths · 🐛 0 bugs squashed\n🔧 no patches'), JSON.stringify(run));
    assert.ok(t.endsWith(SITE));
  }
  assert.doesNotThrow(() => CB.Share.text({ get time() { return 5; }, get deaths() { return 1; } }));
});

test('share text: without CB.Patches the ids stand in for the names and nothing throws', () => {
  const CB = H.load(['src/core/ns.js', 'src/core/share.js']);
  assert.equal(CB.Patches, undefined);
  assert.equal(CB.Share.text(mkRun({ patches: { spread: 1, rapid: 2 } })).split('\n')[2], '🔧 spread, rapid ×2');
  assert.equal(CB.Share.text(mkRun({ patches: {}, history: [] })).split('\n')[2], '🔧 no patches');
});

test('share text: plain text a clipboard can take (no control characters, one trailing URL, no markup)', () => {
  const CB = H.load(LOAD);
  const t = CB.Share.text(mkRun({ daily: '2026-10-13', bossRush: true, yolo: true }));
  assert.doesNotMatch(t, /[\u0000-\u0009\u000b-\u001f]/, 'only newlines');
  assert.doesNotMatch(t, /<|>|&/, 'no markup');
  assert.equal(t.split(SITE).length, 2, 'the URL once');
});

// ---- send() ------------------------------------------------------------------------------------------------------------------------------

// A navigator that records its calls. share / write are what the method does (return a promise, throw, ...); leave one out for "missing".
function mkNav(o) {
  const opt = o || {};
  const nav = { calls: [] };
  if (opt.share) nav.share = function (data) { nav.calls.push(['share', data]); return opt.share(data); };
  if (opt.write) nav.clipboard = { writeText(text) { nav.calls.push(['write', text]); return opt.write(text); } };
  return nav;
}

// A document that records what a hidden-textarea copy does to it.
function mkDoc(o) {
  const opt = o || {};
  const host = { children: [] }; // the body (or, with documentElementOnly, the documentElement)
  const doc = { log: [], areas: [], body: host };
  doc.activeElement = { focus() { doc.log.push('prev.focus'); } };
  if (!opt.noBody) {
    host.appendChild = (el) => { doc.log.push('append'); host.children.push(el); return el; };
    host.removeChild = (el) => { doc.log.push('removeChild'); host.children = host.children.filter((c) => c !== el); };
  }
  if (opt.documentElementOnly) {
    doc.documentElement = host;
    delete doc.body;
  }
  doc.createElement = (tag) => {
    if (opt.createThrows) throw new Error('no elements');
    doc.log.push('create:' + tag);
    const el = {
      tag, value: '', style: {}, attrs: {},
      setAttribute(k, v) { el.attrs[k] = v; },
      focus() { doc.log.push('area.focus'); },
      select() { doc.log.push('select'); },
      setSelectionRange(a, b) { doc.log.push('range:' + a + '-' + b); },
    };
    if (!opt.noRemove) el.remove = () => { doc.log.push('remove'); host.children = host.children.filter((c) => c !== el); };
    doc.areas.push(el);
    return el;
  };
  if (!opt.noExec) {
    doc.execCommand = (cmd) => {
      doc.log.push('exec:' + cmd);
      doc.copied = doc.areas.length ? doc.areas[doc.areas.length - 1].value : undefined;
      if (opt.execThrows) throw new Error('exec refused');
      return opt.exec !== false;
    };
  }
  return doc;
}

const TEXT = 'Clawd vs Bugs: ALL TESTS PASSING ✓\nline two\n' + SITE;

test('send, touch: nav.share gets { title, text } before send returns, and a resolved share is "shared" with nothing else touched', async () => {
  const CB = H.load(LOAD);
  const nav = mkNav({ share: () => Promise.resolve(), write: () => Promise.resolve() });
  const doc = mkDoc();
  const p = CB.Share.send(TEXT, { nav, doc, device: 'touch' });
  assert.equal(nav.calls.length, 1, 'called synchronously, so a user activation is still live');
  assert.deepEqual(H.plain(nav.calls[0]), ['share', { title: 'Clawd vs Bugs', text: TEXT }]);
  assert.equal(typeof p.then, 'function');
  assert.equal(await p, 'shared');
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share'], 'the clipboard was not used');
  assert.deepEqual(doc.log, [], 'and no textarea');
});

test('send, touch: closing the sheet is "cancelled", whether it rejects or throws, and nothing else is tried', async () => {
  const CB = H.load(LOAD);
  for (const how of ['reject', 'throw']) {
    const nav = mkNav({ share: () => (how === 'reject' ? Promise.reject(abort()) : (() => { throw abort(); })()), write: () => Promise.resolve() });
    const doc = mkDoc();
    assert.equal(await CB.Share.send(TEXT, { nav, doc, device: 'touch' }), 'cancelled', how);
    assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share'], how + ': no clipboard');
    assert.deepEqual(doc.log, [], how + ': no textarea');
  }
});

test('send, touch: any other share error falls through to the clipboard, then the textarea', async () => {
  const CB = H.load(LOAD);
  for (const how of ['reject', 'throw', 'reject-undefined', 'reject-string']) {
    const share = {
      reject: () => Promise.reject(denied()),
      throw: () => { throw new TypeError('bad data'); },
      'reject-undefined': () => Promise.reject(undefined),
      'reject-string': () => Promise.reject('nope'),
    }[how];
    const nav = mkNav({ share, write: () => Promise.resolve() });
    assert.equal(await CB.Share.send(TEXT, { nav, doc: mkDoc(), device: 'touch' }), 'copied', how);
    assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share', 'write'], how);
    assert.equal(nav.calls[1][1], TEXT);
  }
  // The clipboard refuses too: the textarea.
  const nav = mkNav({ share: () => Promise.reject(denied()), write: () => Promise.reject(denied()) });
  const doc = mkDoc();
  assert.equal(await CB.Share.send(TEXT, { nav, doc, device: 'touch' }), 'copied');
  assert.equal(doc.copied, TEXT);
});

test('send: on a keyboard or a pad nav.share is left alone (the buttons say "copy"), and a phone with no nav.share copies', async () => {
  const CB = H.load(LOAD);
  for (const device of ['kbm', 'pad', undefined, 'gyro']) {
    const nav = mkNav({ share: () => Promise.resolve(), write: () => Promise.resolve() });
    assert.equal(await CB.Share.send(TEXT, { nav, doc: mkDoc(), device }), 'copied', String(device));
    assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['write'], String(device));
  }
  const nav = mkNav({ write: () => Promise.resolve() });
  assert.equal(await CB.Share.send(TEXT, { nav, doc: mkDoc(), device: 'touch' }), 'copied');
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['write']);
  const bad = { share: 'not a function', clipboard: { writeText: () => Promise.resolve() } };
  assert.equal(await CB.Share.send(TEXT, { nav: bad, doc: mkDoc(), device: 'touch' }), 'copied', 'a share that is not callable is no share');
});

test('send: the clipboard writes the exact text before send returns, and a resolved write is "copied"', async () => {
  const CB = H.load(LOAD);
  const nav = mkNav({ write: () => Promise.resolve() });
  const doc = mkDoc();
  const p = CB.Share.send(TEXT, { nav, doc, device: 'kbm' });
  assert.deepEqual(H.plain(nav.calls), [['write', TEXT]], 'written synchronously');
  assert.equal(await p, 'copied');
  assert.deepEqual(doc.log, [], 'no textarea needed');
  const nav2 = mkNav({ write: () => undefined }); // a clipboard that returns nothing at all
  assert.equal(await CB.Share.send(TEXT, { nav: nav2, doc, device: 'kbm' }), 'copied');
});

test('send: a refused or throwing clipboard falls back to a hidden textarea that is copied and then removed', async () => {
  const CB = H.load(LOAD);
  for (const how of ['reject', 'throw']) {
    const nav = mkNav({ write: how === 'reject' ? () => Promise.reject(denied()) : () => { throw denied(); } });
    const doc = mkDoc();
    assert.equal(await CB.Share.send(TEXT, { nav, doc, device: 'kbm' }), 'copied', how);
    assert.equal(doc.areas.length, 1, how);
    const area = doc.areas[0];
    assert.equal(area.tag, 'textarea');
    assert.equal(area.value, TEXT);
    assert.equal(doc.copied, TEXT, 'execCommand saw the text selected');
    assert.equal(area.attrs.readonly, '', 'read-only, so a phone shows no keyboard');
    assert.equal(area.style.position, 'fixed');
    assert.equal(area.style.opacity, '0', 'hidden');
    assert.deepEqual(doc.log, ['create:textarea', 'append', 'area.focus', 'select', 'range:0-' + TEXT.length, 'exec:copy', 'remove', 'prev.focus'], how + ': the whole dance, then the page as it was');
    assert.equal(doc.body.children.length, 0, 'removed');
  }
});

test('send: with no clipboard at all (no nav, or a nav without one) the textarea does it', async () => {
  const CB = H.load(LOAD);
  for (const nav of [undefined, null, {}, { clipboard: null }, { clipboard: {} }, { clipboard: { writeText: 'x' } }]) {
    const doc = mkDoc();
    assert.equal(await CB.Share.send(TEXT, { nav, doc, device: 'kbm' }), 'copied', JSON.stringify(nav));
    assert.equal(doc.copied, TEXT);
  }
});

test('send: the textarea path copes with a document that is thin, refuses or throws, and always cleans up', async () => {
  const CB = H.load(LOAD);
  const noNav = (doc) => CB.Share.send(TEXT, { nav: undefined, doc, device: 'kbm' });
  assert.equal(await noNav(mkDoc({ exec: false })), 'failed', 'execCommand says no');
  const thrower = mkDoc({ execThrows: true });
  assert.equal(await noNav(thrower), 'failed', 'execCommand throws');
  assert.ok(thrower.log.includes('remove'), 'and the textarea still leaves');
  assert.equal(await noNav(mkDoc({ noExec: true })), 'failed', 'no execCommand');
  assert.equal(await noNav(mkDoc({ createThrows: true })), 'failed', 'createElement throws');
  assert.equal(await noNav(mkDoc({ noBody: true })), 'failed', 'a body that cannot take a child (and no documentElement)');
  const de = mkDoc({ documentElementOnly: true });
  assert.equal(await noNav(de), 'copied', 'the documentElement stands in for a missing body');
  const noRemove = mkDoc({ noRemove: true });
  assert.equal(await noNav(noRemove), 'copied', 'an element with no remove() is taken out through its parent');
  assert.ok(noRemove.log.includes('removeChild'));
  for (const doc of [undefined, null, {}, 5, 'x']) assert.equal(await noNav(doc), 'failed', String(doc));
});

test('send: it never throws or rejects, whatever it is given', async () => {
  const CB = H.load(LOAD);
  const hostile = {
    get share() { throw new Error('share getter'); },
    get clipboard() { throw new Error('clipboard getter'); },
  };
  const thenable = { then() { throw new Error('then throws'); } };
  const envs = [undefined, null, 0, 'x', [], {}, { nav: hostile, doc: mkDoc(), device: 'touch' }, { nav: hostile, doc: mkDoc(), device: 'kbm' },
    { nav: mkNav({ share: () => thenable, write: () => thenable }), doc: mkDoc(), device: 'touch' }, { nav: mkNav({ share: () => { throw 5; } }), doc: undefined, device: 'touch' }];
  for (const env of envs) {
    const p = CB.Share.send(TEXT, env);
    assert.equal(typeof p.then, 'function', 'a promise');
    const got = await p;
    assert.ok(['shared', 'copied', 'cancelled', 'failed'].includes(got), JSON.stringify(got));
  }
  // Nothing can be sent without text.
  for (const t of ['', undefined, null, 5, {}, ['x']]) assert.equal(await CB.Share.send(t, { nav: mkNav({ write: () => Promise.resolve() }), doc: mkDoc(), device: 'kbm' }), 'failed', String(t));
  assert.equal(await CB.Share.send(TEXT), 'failed', 'no env at all: nothing to send with');
});

test('send: every path fails to "failed" when nothing works', async () => {
  const CB = H.load(LOAD);
  const nav = mkNav({ share: () => Promise.reject(denied()), write: () => Promise.reject(denied()) });
  assert.equal(await CB.Share.send(TEXT, { nav, doc: mkDoc({ exec: false }), device: 'touch' }), 'failed');
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share', 'write']);
  assert.equal(await CB.Share.send(TEXT, { nav: {}, doc: {}, device: 'touch' }), 'failed');
});

// ---- the share button and its hit box --------------------------------------------------------------------------------------------------

// The whole game, a renderer on the stub canvas with the layout recorder, and the play scene on a victory run.
function victoryScene(dev, over) {
  const o = over || {};
  const { CB, sandbox } = H.load(undefined, { returnSandbox: true });
  CB.Audio = { play() {}, handleEvents() {}, init() {}, toggleMute() {} };
  CB.Music = { stop() {}, update() {}, toggle() {} };
  CB.Haptics = undefined;
  CB.Prompts.setDevice(dev || 'kbm');
  const r = CB.createRenderer(sandbox.document.createElement('canvas'), { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 });
  r.resize();
  const rec = H.recorder(r, CB);
  const run = CB.createRun({ seed: 7, startStage: 3 });
  Object.assign(run, { state: 'victory', stateT: 3, deaths: 3, time: 61.9, bossesFixed: 4, history: ['spread', 'rapid'], squashed: { syntaxError: 3, nullPointer: 2 } }, o.run || {});
  return { CB, sandbox, r, rec, run };
}

test('victory share: every pixel of the drawn label is a hit and the pixels around the box are not, on every device', () => {
  const LABEL = { kbm: '[ copy result ] (C)', touch: '[ share result ]', pad: '[ X: copy result ]' };
  for (const dev of DEVICES) {
    const { CB, r, rec, run } = victoryScene(dev);
    CB.Screens.victory.draw(r, run, 3);
    const label = rec.texts().find((b) => b.str === LABEL[dev]);
    assert.ok(label, dev);
    const S = CB.Screens.victory.shareBox(); // the box of this device (22 px tall on touch, 14 elsewhere)
    const inside = (x, y) => x >= S.x && x < S.x + S.w && y >= S.y && y < S.y + S.h;
    for (const [x, y] of [[label.x, label.y], [label.x + label.w - 1, label.y], [label.x, label.y + label.h - 1], [label.x + label.w - 1, label.y + label.h - 1], [label.x + label.w / 2, label.y + label.h / 2]]) {
      assert.ok(inside(x, y), `${dev}: ${x},${y} of the label is a hit`);
    }
    for (const [x, y] of [[S.x - 1, S.y + 3], [S.x + S.w, S.y + 3], [S.x + 20, S.y - 1], [S.x + 20, S.y + S.h]]) assert.ok(!inside(x, y), `${dev}: ${x},${y} is outside`);
    // And the play scene agrees with the box on both sides of its edge.
    const play = CB.Scenes.play;
    play.run = run;
    const tap = (x, y) => play.wantsShare({ tap: true, aimX: x, aimY: y, keys: [] });
    assert.equal(tap(label.x + 1, label.y + 1), true, dev + ': a tap on the label shares');
    assert.equal(tap(label.x + label.w - 2, label.y + label.h - 2), true);
    assert.equal(tap(S.x - 1, S.y + 3), false, dev + ': a tap beside it does not');
    assert.equal(tap(160, 100), false);
    assert.equal(tap(210, 163), false, dev + ': nor one on the continue button');
  }
});

// ---- the play scene ------------------------------------------------------------------------------------------------------------------

// The play scene on a victory run with a fake host. over.device, over.navigator (undefined removes it), over.document (the same), over.send
// replaces CB.Share.send with a recording stub that answers what over.send returns, over.noActivation drops input.withActivation.
function playScene(over) {
  const o = over || {};
  const s = victoryScene(o.device || 'kbm', o);
  const { CB, sandbox } = s;
  if ('navigator' in o) {
    if (o.navigator === undefined) delete sandbox.navigator;
    else sandbox.navigator = o.navigator;
  }
  if ('document' in o) {
    if (o.document === undefined) delete sandbox.document;
    else sandbox.document = o.document;
  }
  s.sent = [];
  if (o.send) {
    CB.Share.send = (text, env) => {
      s.sent.push({ text, env });
      return o.send(text, env);
    };
  }
  s.visits = [];
  s.activations = [];
  s.input = { device: o.device || 'kbm', peekAim: () => ({ x: 30, y: 40 }), setTouchMode() {} };
  if (!o.noActivation) {
    s.input.withActivation = o.withActivation || ((fn) => {
      s.activations.push('asked');
      fn();
    });
  }
  s.game = { debug: {}, input: s.input, go: (name) => s.visits.push(name) };
  s.play = CB.Scenes.play;
  s.play.enter(s.game, { runOpts: { seed: 7, skipWaves: true, startStage: 3 } });
  Object.assign(s.play.run, { state: 'victory', stateT: o.stateT == null ? 3 : o.stateT, deaths: 3, time: 61.9, bossesFixed: 4, history: ['spread', 'rapid'], squashed: { syntaxError: 3, nullPointer: 2 } }, o.run || {});
  s.step = (inp) => s.play.update(CB.DT, H.makeInput(inp));
  s.toastTexts = () => s.play.toasts.map((t) => t.text);
  return s;
}
const ok = () => Promise.resolve('copied');

test('play victory: C shares and stays on the receipt', async () => {
  const s = playScene({ send: ok });
  s.step({ keys: ['KeyC'] });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].text, s.CB.Share.text(s.play.run), 'the text of this run');
  assert.deepEqual(s.visits, [], 'did not leave');
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  s.step({});
  assert.deepEqual(s.visits, [], 'still here a tick later');
});

test('play victory: the pad\'s X shares and stays, with the pad\'s toast', async () => {
  const s = playScene({ send: ok, device: 'pad' });
  const pad = { a: false, b: false, x: true, y: false, lb: false, rb: false, start: false, back: false };
  s.step({ pad });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].env.device, 'pad');
  assert.deepEqual(s.visits, []);
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  // Other pad buttons are not the share button.
  const s2 = playScene({ send: ok, device: 'pad' });
  s2.step({ pad: Object.assign({}, pad, { x: false, y: true, b: true }) });
  assert.equal(s2.sent.length, 0);
  assert.deepEqual(s2.visits, []);
});

test('play victory: a tap on the share button shares and does not play again, though it is a confirm too', async () => {
  for (const dev of DEVICES) {
    const s = playScene({ send: ok, device: dev });
    const box = s.CB.Screens.victory.shareBox();
    s.step({ confirm: true, tap: true, aimX: box.x + box.w / 2, aimY: box.y + box.h / 2 });
    assert.equal(s.sent.length, 1, dev);
    assert.deepEqual(s.visits, [], dev + ': stayed');
    await tick();
    assert.deepEqual(s.toastTexts(), ['result copied ✓'], dev + ': the stub copied, whatever the device');
  }
});

test('play victory: only [ continue ], Enter and pad A leave -- a tap or click anywhere else, even just beside a button, does nothing', () => {
  for (const dev of DEVICES) {
    const probe = playScene({ send: ok, device: dev });
    const SB = probe.CB.Screens.victory.shareBox();
    const NB = probe.CB.Screens.victory.continueBox();
    const taps = [[160, 100], [20, 20], [SB.x - 1, SB.y + 3], [NB.x + NB.w, NB.y + 3], [NB.x + 4, NB.y - 1], [NB.x + 4, NB.y + NB.h], [SB.x + SB.w + 2, SB.y + 3]];
    for (const [x, y] of taps) {
      const s = playScene({ send: ok, device: dev });
      s.step({ confirm: true, tap: true, aimX: x, aimY: y });
      assert.deepEqual(s.visits, [], `${dev}: a tap at ${x},${y} stays on the receipt`);
      assert.equal(s.sent.length, 0);
    }
    for (const [x, y] of [[NB.x, NB.y], [NB.x + NB.w - 1, NB.y + NB.h - 1], [NB.x + NB.w / 2, NB.y + NB.h / 2]]) {
      const s = playScene({ send: ok, device: dev });
      s.step({ confirm: true, tap: true, aimX: x, aimY: y });
      assert.deepEqual(s.visits, ['title'], `${dev}: a tap at ${x},${y} is the continue button`);
      assert.equal(s.sent.length, 0);
    }
  }
  const enter = playScene({ send: ok });
  enter.step({ confirm: true });
  assert.deepEqual(enter.visits, ['title'], 'Enter');
  const a = playScene({ send: ok, device: 'pad' });
  a.step({ confirm: true, pad: { a: true, b: false, x: false, y: false, lb: false, rb: false, start: false, back: false } });
  assert.deepEqual(a.visits, ['title'], 'pad A');
  assert.equal(a.sent.length, 0);
});

test('play victory: the receipt stays after a share, and a second tap on share shares again', async () => {
  const s = playScene({ send: ok });
  const box = s.CB.Screens.victory.shareBox();
  s.step({ confirm: true, tap: true, aimX: box.x + 5, aimY: box.y + 5 });
  s.step({});
  s.step({ confirm: true, tap: true, aimX: 160, aimY: 100 });
  assert.deepEqual(s.visits, []);
  assert.equal(s.sent.length, 1);
  s.step({ confirm: true, tap: true, aimX: box.x + 5, aimY: box.y + 5 });
  assert.equal(s.sent.length, 2);
  assert.deepEqual(s.visits, []);
});

test('play victory: share wins when it arrives with a confirm, so C and Enter together do not leave', () => {
  const s = playScene({ send: ok });
  s.step({ keys: ['KeyC'], confirm: true });
  assert.equal(s.sent.length, 1);
  assert.deepEqual(s.visits, []);
});

test('play victory: nothing shares before the input delay (strictly after 2.5 s), and nothing leaves either', () => {
  for (const st of [0, 0.5, 1.5, 2.5]) {
    const s = playScene({ send: ok, stateT: st });
    // stateT moves on with the step: set it back so the update that sees it is at `st`.
    s.play.run.stateT = st;
    s.step({ keys: ['KeyC'], confirm: true });
    assert.equal(s.sent.length, 0, 'C at ' + st);
    const box = s.CB.Screens.victory.shareBox();
    s.play.run.stateT = st;
    s.step({ confirm: true, tap: true, aimX: box.x + 4, aimY: box.y + 4 });
    assert.equal(s.sent.length, 0, 'a tap on the button at ' + st);
    assert.deepEqual(s.visits, [], 'and no leave at ' + st);
    s.play.run.stateT = st;
    s.step({ confirm: true });
    assert.deepEqual(s.visits, [], 'Enter does not leave at ' + st);
  }
  const late = playScene({ send: ok, stateT: 2.51 });
  late.step({ keys: ['KeyC'] });
  assert.equal(late.sent.length, 1, 'just after 2.5 s it works');
});

test('play victory: C does nothing outside victory', () => {
  for (const state of ['stageIntro', 'bossDead', 'patchPick', 'dead']) {
    const s = playScene({ send: ok });
    s.play.run.state = state;
    s.step({ keys: ['KeyC'] });
    assert.equal(s.sent.length, 0, state);
  }
});

test('play victory: the share goes through input.withActivation, and waits there until the input calls it', async () => {
  const held = [];
  const s = playScene({ send: ok, withActivation: (fn) => held.push(fn) });
  s.step({ keys: ['KeyC'] });
  assert.equal(held.length, 1, 'asked for an activation');
  assert.equal(s.sent.length, 0, 'not sent yet');
  held[0]();
  assert.equal(s.sent.length, 1, 'sent when the input says so');
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  // The text was made when the player pressed, not when the activation came.
  const s2 = playScene({ send: ok, withActivation: (fn) => held.push(fn) });
  s2.step({ keys: ['KeyC'] });
  const before = s2.CB.Share.text(s2.play.run);
  s2.play.run.deaths = 99;
  held[held.length - 1]();
  assert.equal(s2.sent[0].text, before, 'the receipt the player saw');
});

test('play victory: an input without withActivation sends straight away', async () => {
  const s = playScene({ send: ok, noActivation: true });
  s.step({ keys: ['KeyC'] });
  assert.equal(s.sent.length, 1);
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
});

test('play victory: send gets the real navigator and document, and the device', () => {
  const nav = mkNav({ write: () => Promise.resolve() });
  const doc = mkDoc();
  const s = playScene({ send: ok, navigator: nav, document: doc, device: 'touch' });
  s.step({ keys: ['KeyC'] });
  assert.strictEqual(s.sent[0].env.nav, nav);
  assert.strictEqual(s.sent[0].env.doc, doc);
  assert.equal(s.sent[0].env.device, 'touch');
});

test('play victory: with no navigator or document (a headless host) it sends nothing real, says so, and does not throw', async () => {
  const s = playScene({ navigator: undefined, document: undefined });
  assert.doesNotThrow(() => s.step({ keys: ['KeyC'] }));
  await tick();
  assert.deepEqual(s.toastTexts(), ["couldn't copy"]);
  const s2 = playScene({ send: ok, navigator: undefined, document: undefined });
  s2.step({ keys: ['KeyC'] });
  assert.equal(s2.sent[0].env.nav, null);
  assert.equal(s2.sent[0].env.doc, null);
});

test('play victory: the toast answers the outcome, not the device -- shared on shared, copied on copied, failed on failed, nothing on cancelled', async () => {
  const cases = [
    ['shared', 'touch', 'shared ✓'], ['shared', 'kbm', 'shared ✓'], ['shared', 'pad', 'shared ✓'],
    ['copied', 'kbm', 'result copied ✓'], ['copied', 'pad', 'result copied ✓'], ['copied', 'touch', 'result copied ✓'],
    ['failed', 'kbm', "couldn't copy"], ['failed', 'touch', "couldn't copy"], ['failed', 'pad', "couldn't copy"], ['cancelled', 'touch', null], ['cancelled', 'kbm', null],
  ];
  for (const [result, dev, want] of cases) {
    const s = playScene({ send: () => Promise.resolve(result), device: dev });
    s.step({ keys: ['KeyC'] });
    await tick();
    assert.deepEqual(s.toastTexts(), want === null ? [] : [want], `${result} on ${dev}`);
    if (want !== null) assert.equal(s.play.toasts[0].t, 2.5, 'the usual toast time');
  }
});

test('play victory: a phone whose share sheet is refused falls back to the clipboard, and the toast says copied, not shared', async () => {
  // The real CB.Share.send, end to end: touch device, navigator.share rejects (not an abort), no clipboard API, execCommand('copy') works.
  const nav = mkNav({ share: () => Promise.reject(denied()) });
  const doc = mkDoc();
  const s = playScene({ device: 'touch', navigator: nav, document: doc });
  s.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share'], 'the sheet was tried first');
  assert.equal(doc.copied, s.CB.Share.text(s.play.run), 'then the hidden textarea copied the result');
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  // The same phone with a working sheet says shared.
  const ok2 = playScene({ device: 'touch', navigator: mkNav({ share: () => Promise.resolve() }), document: mkDoc() });
  ok2.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(ok2.toastTexts(), ['shared ✓']);
});

test('play victory: the share answer shows now, ahead of the unlock toasts already waiting, which resume after it with their remaining time', async () => {
  const s = playScene({ send: ok });
  s.play.toasts.push({ text: 'NEW HAT: Cap', t: 2.5 }, { text: 'NEW HAT: Crown', t: 2.5 });
  s.step({ keys: ['KeyC'] });
  const left = s.play.toasts[0].t; // the answer has not come yet: the first unlock toast is still the one on screen, part way through
  assert.ok(left < 2.5);
  await tick();
  assert.equal(s.play.toasts[0].kind, 'share', 'the answer to the press is on screen');
  assert.deepEqual(s.toastTexts(), ['result copied ✓', 'NEW HAT: Cap', 'NEW HAT: Crown']);
  assert.equal(s.play.toasts[1].t, left, 'the displaced toast kept its remaining time');
  // Pressing again rewrites the share toast in place, not a second one at the front.
  s.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓', 'NEW HAT: Cap', 'NEW HAT: Crown']);
  // It runs out first (only toasts[0] counts down), then the displaced one carries on from where it was.
  for (let i = 0; i < 160; i++) s.step({});
  assert.deepEqual(s.toastTexts(), ['NEW HAT: Cap', 'NEW HAT: Crown']);
  assert.ok(s.play.toasts[0].t <= left && s.play.toasts[0].t > 0);
});

test('play victory: a send that throws, rejects or answers nonsense is a failed toast, never a crash', async () => {
  const hows = [() => { throw new Error('boom'); }, () => Promise.reject(new Error('boom')), () => undefined, () => 'maybe', () => null];
  for (const send of hows) {
    const s = playScene({ send });
    assert.doesNotThrow(() => s.step({ keys: ['KeyC'] }));
    await tick();
    assert.deepEqual(s.toastTexts(), ["couldn't copy"]);
    assert.deepEqual(s.visits, []);
  }
});

test('play victory: a text() that throws is a failed share, not a crash', async () => {
  const s = playScene({ navigator: mkNav({ write: () => Promise.resolve() }), document: mkDoc() });
  s.CB.Share.text = () => { throw new Error('no text'); };
  assert.doesNotThrow(() => s.step({ keys: ['KeyC'] }));
  await tick();
  assert.deepEqual(s.toastTexts(), ["couldn't copy"], 'the real send refuses the empty text');
  assert.equal(s.play.device(), 'kbm');
});

test('play victory: pressing share again before the toast is gone rewrites it rather than queueing a second', async () => {
  const s = playScene({ send: ok });
  for (let i = 0; i < 4; i++) {
    s.step({ keys: ['KeyC'] });
    await tick();
  }
  assert.equal(s.sent.length, 4, 'every press sends');
  assert.equal(s.play.toasts.length, 1, 'one toast');
  assert.equal(s.play.toasts[0].kind, 'share');
  assert.equal(s.play.toasts[0].t, 2.5, 'its time restarted');
  // A different kind of toast still queues behind it.
  s.play.notify('controller connected');
  assert.deepEqual(s.toastTexts(), ['result copied ✓', 'controller connected']);
  s.step({ keys: ['KeyC'] });
  await tick();
  assert.equal(s.play.toasts.length, 2, 'the share toast was rewritten in place, behind nothing new');
});

test('play victory: notify keeps its old shape for a plain message and rewrites only a toast of the same kind', () => {
  const s = playScene({ send: ok });
  s.play.notify('controller connected');
  s.play.notify('controller connected');
  assert.deepEqual(H.plain(s.play.toasts), [{ text: 'controller connected', t: 2.5 }, { text: 'controller connected', t: 2.5 }], 'no kind: every message queues, as it always did');
  s.play.notify('', 'share');
  s.play.notify(5, 'share');
  assert.equal(s.play.toasts.length, 2, 'junk is ignored');
});

test('play victory: without CB.Share, C and the pad\'s X do nothing and a tap where the button would be is only a tap', () => {
  const s = playScene({});
  delete s.CB.Share;
  s.step({ keys: ['KeyC'] });
  s.step({ pad: { a: false, b: false, x: true, y: false, lb: false, rb: false, start: false, back: false } });
  assert.deepEqual(s.visits, [], 'nothing happened');
  const box = s.CB.Screens.victory.shareBox();
  s.step({ confirm: true, tap: true, aimX: box.x + 4, aimY: box.y + 4 });
  assert.deepEqual(s.visits, [], 'it is only a tap now: nothing');
  s.step({ confirm: true });
  assert.deepEqual(s.visits, ['title'], 'Enter still leaves');
  const t = playScene({});
  t.CB.Share = { text: () => 'x' }; // half a module is no module
  t.step({ keys: ['KeyC'] });
  assert.deepEqual(t.toastTexts(), []);
});

test('play victory: without CB.Prompts the toast still says something', async () => {
  const s = playScene({ send: ok });
  delete s.CB.Prompts;
  s.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  const f = playScene({ send: () => Promise.resolve('failed') });
  delete f.CB.Prompts;
  f.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(f.toastTexts(), ["couldn't copy"]);
});

test('play victory: the real share on a keyboard puts the result on the clipboard', async () => {
  const nav = mkNav({ write: () => Promise.resolve() });
  const s = playScene({ navigator: nav, document: mkDoc() });
  s.step({ keys: ['KeyC'] });
  assert.deepEqual(H.plain(nav.calls), [['write', s.CB.Share.text(s.play.run)]]);
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
});

test('play victory: the real share on a phone opens the share sheet, and closing it is no failure', async () => {
  const nav = mkNav({ share: () => Promise.reject(abort()), write: () => Promise.resolve() });
  const s = playScene({ navigator: nav, document: mkDoc(), device: 'touch' });
  s.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['share']);
  assert.deepEqual(s.toastTexts(), [], 'cancelled is silent');
  const ok2 = playScene({ navigator: mkNav({ share: () => Promise.resolve() }), document: mkDoc(), device: 'touch' });
  ok2.step({ keys: ['KeyC'] });
  await tick();
  assert.deepEqual(ok2.toastTexts(), ['shared ✓']);
});

// ---- the daily result ------------------------------------------------------------------------------------------------------------------------

test('play daily: a daily run records its result once, when it is first seen in victory', () => {
  const calls = [];
  const s = playScene({ run: { daily: '2026-10-13', time: 521.5, deaths: 2, yolo: true }, stateT: 0.1 });
  s.CB.Daily = { record: (key, res) => calls.push([key, H.plain(res)]) };
  s.step({});
  assert.deepEqual(calls, [['2026-10-13', { time: 521.5, deaths: 2, yolo: true }]]);
  for (let i = 0; i < 30; i++) s.step({});
  assert.equal(calls.length, 1, 'once, however long the receipt stays');
  s.step({ keys: ['KeyC'] });
  s.step({ confirm: true });
  assert.equal(calls.length, 1, 'sharing and leaving do not record again');
});

test('play daily: the record is the run\'s time, deaths and yolo flag, with yolo a real boolean', () => {
  for (const [yolo, want] of [[true, true], [false, false], [undefined, false], [0, false], [1, true]]) {
    const calls = [];
    const s = playScene({ run: { daily: '2026-10-14', time: 90, deaths: 0, yolo } });
    s.CB.Daily = { record: (key, res) => calls.push(H.plain(res)) };
    s.step({});
    assert.deepEqual(calls, [{ time: 90, deaths: 0, yolo: want }], String(yolo));
  }
});

test('play daily: a run that really ends reaches victory through the step and records on that very update', () => {
  const calls = [];
  const s = playScene({ run: { daily: '2026-10-13' } });
  const { play, CB } = s;
  CB.Daily = { record: (key, res) => calls.push([key, res.deaths]) };
  play.enter(s.game, { runOpts: { seed: 3, startStage: 3 } });
  play.run.daily = '2026-10-13';
  Object.assign(play.run, { state: 'bossDead', stateT: CB.RUN_T.bossDead - 0.001, deaths: 1 });
  s.step({});
  assert.equal(play.run.state, 'victory', 'the step ended the run');
  assert.deepEqual(calls, [['2026-10-13', 1]], 'recorded in the update that saw it end, not a frame later');
  s.step({});
  s.step({});
  assert.equal(calls.length, 1);
});

test('play daily: nothing is recorded for a run that is not daily, not in victory, or has no module to take it', () => {
  for (const daily of [null, undefined, '', 0, 5, true, {}]) {
    const calls = [];
    const s = playScene({ run: { daily } });
    s.CB.Daily = { record: () => calls.push(1) };
    s.step({});
    assert.equal(calls.length, 0, 'daily = ' + JSON.stringify(daily));
  }
  for (const state of ['stageIntro', 'bossDead', 'patchPick', 'dead']) {
    const calls = [];
    const s = playScene({ run: { daily: '2026-10-13', state } });
    s.CB.Daily = { record: () => calls.push(1) };
    s.play.run.state = state;
    s.step({});
    assert.equal(calls.length, 0, state);
  }
  const s = playScene({ run: { daily: '2026-10-13' } });
  s.CB.Daily = undefined;
  assert.doesNotThrow(() => s.step({}));
  s.CB.Daily = {};
  assert.doesNotThrow(() => s.step({}));
});

test('play daily: a record that throws is swallowed, and is not retried every frame', () => {
  let n = 0;
  const s = playScene({ run: { daily: '2026-10-13' } });
  s.CB.Daily = { record: () => { n++; throw new Error('storage full'); } };
  assert.doesNotThrow(() => s.step({}));
  for (let i = 0; i < 5; i++) s.step({});
  assert.equal(n, 1);
  assert.deepEqual(s.visits, [], 'the receipt still shows');
});

test('play daily: a new run records its own result', () => {
  const calls = [];
  const s = playScene({ run: { daily: '2026-10-13' } });
  s.CB.Daily = { record: (key) => calls.push(key) };
  s.step({});
  s.play.enter(s.game, { runOpts: { seed: 9, startStage: 3 } });
  Object.assign(s.play.run, { daily: '2026-10-14', state: 'victory', stateT: 3 });
  s.step({});
  assert.deepEqual(calls, ['2026-10-13', '2026-10-14']);
});

test('play daily: a daily run that leaves straight after the delay was recorded first', () => {
  const calls = [];
  const s = playScene({ run: { daily: '2026-10-13' }, stateT: 3 });
  s.CB.Daily = { record: (key) => calls.push(key) };
  s.step({ confirm: true });
  assert.deepEqual(s.visits, ['title']);
  assert.deepEqual(calls, ['2026-10-13']);
});

// ---- end to end: the real input, a real tap, the activation rule -----------------------------------------------------------------------------

function fakeTarget() {
  const handlers = {};
  const t = {
    handlers,
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter((f) => f !== fn); },
    fire(type, ev) {
      const e = Object.assign({ repeat: false, preventDefault() {} }, ev);
      for (const fn of (handlers[type] || []).slice()) fn(e);
      return e;
    },
    focus() {},
    setPointerCapture() {},
  };
  return t;
}

// The play scene on a victory run, driven by the real input through fake window and canvas events. Client px / 4 = internal px.
function wired(dev, over) {
  const o = over || {};
  const nav = o.nav || mkNav({ share: () => Promise.resolve(), write: () => Promise.resolve() });
  const s = playScene({ device: dev, navigator: nav, document: mkDoc(), run: o.run });
  const win = fakeTarget();
  const canvas = fakeTarget();
  win.navigator = o.padNav || null;
  const renderer = { toInternal: (x, y) => ({ x: x / 4, y: y / 4 }) };
  const input = s.CB.createInput({ canvas, renderer, win });
  s.game.input = input;
  s.input = input;
  s.win = win;
  s.canvas = canvas;
  s.nav = nav;
  s.frame = () => s.play.update(s.CB.DT, input.sample());
  s.tdown = (id, ix, iy) => canvas.fire('pointerdown', { pointerType: 'touch', pointerId: id, clientX: ix * 4, clientY: iy * 4 });
  s.tup = (id) => win.fire('pointerup', { pointerType: 'touch', pointerId: id });
  s.frame(); // the first update puts the touch layer in menu mode
  return s;
}

test('end to end, touch: a tap on the button waits for the finger to lift, then opens the share sheet once and stays', async () => {
  const s = wired('touch');
  const box = s.CB.Screens.victory.shareBox();
  s.tdown(1, box.x + 20, box.y + 5);
  s.frame();
  assert.equal(s.nav.calls.length, 0, 'the finger is down: a touch pointerdown is not a user activation');
  assert.deepEqual(s.visits, [], 'and the tap did not play again');
  s.frame();
  assert.equal(s.nav.calls.length, 0, 'still waiting, a frame later');
  s.tup(1);
  assert.equal(s.nav.calls.length, 1, 'the release is the activation');
  assert.deepEqual(H.plain(s.nav.calls[0][0]), 'share');
  assert.deepEqual(H.plain(s.nav.calls[0][1]), { title: 'Clawd vs Bugs', text: s.CB.Share.text(s.play.run) });
  await tick();
  assert.deepEqual(s.toastTexts(), ['shared ✓']);
  s.frame();
  assert.deepEqual(s.visits, []);
  s.tdown(2, box.x + 20, box.y + 5);
  s.tup(2);
  s.frame();
  assert.equal(s.nav.calls.length, 2, 'a second tap on the button is a second share');
});

test('end to end, touch: a quick tap that has lifted before the frame shares at once', async () => {
  const s = wired('touch');
  const box = s.CB.Screens.victory.shareBox();
  s.tdown(1, box.x + 20, box.y + 5);
  s.tup(1);
  assert.equal(s.nav.calls.length, 0, 'nothing runs by itself');
  s.frame();
  assert.equal(s.nav.calls.length, 1, 'the frame that sees the tap finds no finger down, so it runs now');
  await tick();
  assert.deepEqual(s.toastTexts(), ['shared ✓']);
  assert.deepEqual(s.visits, []);
});

test('end to end, touch: a tap anywhere else does nothing, [ continue ] plays again, and a cancelled share tap shares nothing later', () => {
  const s = wired('touch');
  s.tdown(1, 160, 100);
  s.frame();
  assert.deepEqual(s.visits, [], 'a tap on nothing');
  assert.equal(s.nav.calls.length, 0);
  const cont = s.CB.Screens.victory.continueBox();
  s.tdown(2, cont.x + 20, cont.y + 5);
  s.frame();
  assert.deepEqual(s.visits, ['title'], 'the continue button');
  assert.equal(s.nav.calls.length, 0);
  const t = wired('touch');
  const box = t.CB.Screens.victory.shareBox();
  t.tdown(1, box.x + 20, box.y + 5);
  t.frame();
  t.win.fire('pointercancel', { pointerType: 'touch', pointerId: 1 });
  t.tdown(2, box.x + 20, box.y + 5);
  t.tup(2);
  assert.equal(t.nav.calls.length, 0, 'the cancelled tap\'s share did not wait for the next lift');
  assert.deepEqual(t.visits, []);
});

test('end to end, mouse: a click on the button copies now (mousedown is an activation, nav.share stays unused) and only [ continue ] plays again', async () => {
  const nav = mkNav({ share: () => Promise.resolve(), write: () => Promise.resolve() });
  const s = wired('kbm', { nav });
  const box = s.CB.Screens.victory.shareBox();
  s.canvas.fire('mousedown', { button: 0, clientX: (box.x + 20) * 4, clientY: (box.y + 5) * 4 });
  s.frame();
  assert.deepEqual(H.plain(nav.calls.map((c) => c[0])), ['write']);
  assert.equal(nav.calls[0][1], s.CB.Share.text(s.play.run));
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  assert.deepEqual(s.visits, []);
  s.canvas.fire('mousedown', { button: 0, clientX: 160 * 4, clientY: 100 * 4 });
  s.frame();
  assert.deepEqual(s.visits, [], 'a click on nothing stays');
  const cont = s.CB.Screens.victory.continueBox();
  s.canvas.fire('mousedown', { button: 0, clientX: (cont.x + 20) * 4, clientY: (cont.y + 5) * 4 });
  s.frame();
  assert.deepEqual(s.visits, ['title'], 'the continue button leaves');
});

test('end to end, keyboard: C copies and Enter plays again', async () => {
  const nav = mkNav({ write: () => Promise.resolve() });
  const s = wired('kbm', { nav });
  s.win.fire('keydown', { code: 'KeyC' });
  s.frame();
  assert.equal(nav.calls.length, 1);
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  assert.deepEqual(s.visits, []);
  s.win.fire('keydown', { code: 'Enter' });
  s.frame();
  assert.deepEqual(s.visits, ['title']);
});

test('end to end, pad: X copies and A plays again', async () => {
  const buttons = [];
  for (let i = 0; i < 17; i++) buttons.push({ pressed: false, touched: false, value: 0 });
  const pad = { id: 'fake', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0] };
  const nav = mkNav({ write: () => Promise.resolve() });
  const s = wired('pad', { nav, padNav: { getGamepads: () => [pad, null, null, null] } });
  buttons[2] = { pressed: true, touched: true, value: 1 }; // X
  s.frame();
  assert.equal(s.input.device, 'pad');
  assert.equal(nav.calls.length, 1, 'X copied');
  await tick();
  assert.deepEqual(s.toastTexts(), ['result copied ✓']);
  assert.deepEqual(s.visits, []);
  buttons[2] = { pressed: false, touched: false, value: 0 };
  s.frame();
  buttons[0] = { pressed: true, touched: true, value: 1 }; // A
  s.frame();
  assert.deepEqual(s.visits, ['title']);
});

test('play victory: the toast band over the footer disclaimer is opaque (a translucent one lets the two lines garble each other); in a fight it stays translucent', () => {
  const s = playScene({ send: ok });
  const draw = () => {
    const bands = [];
    let alpha = 1;
    const r = {
      alpha(a, fn) { const prev = alpha; alpha = a; fn(); alpha = prev; },
      rect(x, y, w, h) { bands.push({ x, y, w, h, alpha }); },
      text() {},
    };
    s.play.drawToast(r);
    return bands;
  };
  s.play.toasts.push({ text: 'shared ✓', t: 2.5 });
  const v = draw();
  assert.equal(v.length, 1);
  assert.equal(v[0].y, 171, 'the victory band starts under the buttons, over the disclaimer');
  assert.equal(v[0].alpha, 1, 'fully opaque');
  s.play.run.state = 'playing';
  const f = draw();
  assert.equal(f[0].y, 169);
  assert.equal(f[0].alpha, 0.85, 'a fight toast stays see-through');
});
