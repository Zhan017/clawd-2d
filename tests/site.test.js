'use strict';
// The deployed site (tools/build-site.mjs -> public/): one content-hashed bundle with a source map, the page that loads it,
// the service worker (parsed, then run against fake CacheStorage and fetch), the copied manifest and assets, and vercel.json.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const H = require('./harness');

const OUT = path.join(H.ROOT, 'public');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

let builtOnce = null;
const importBuilder = () => import(pathToFileURL(path.join(H.ROOT, 'tools', 'build-site.mjs')).href);
// Builds the real repo once for the file (the tests run one after another and all read public/).
function buildOnce() {
  if (!builtOnce) builtOnce = importBuilder().then((mod) => mod.buildSite());
  return builtOnce;
}

const readOut = (rel) => fs.readFileSync(path.join(OUT, rel), 'utf8');

// Sorted '/'-separated file paths under dir, skipping dotfiles like the build does; [] when dir is missing.
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)).map((p) => `${d.name}/${p}`) : [d.name]));
}

// What the repo has to ship alongside the page, by the same rules as the build (made by another task, so it may not exist yet).
function sourceCopies() {
  const out = [];
  if (fs.existsSync(path.join(H.ROOT, 'manifest.webmanifest'))) out.push('manifest.webmanifest');
  for (const a of walk(path.join(H.ROOT, 'assets'))) out.push(`assets/${a}`);
  return out;
}

// A throwaway site tree under the OS temp dir: { 'rel/path': text } -> root.
function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-site-'));
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  return root;
}

async function withTree(files, fn) {
  const root = makeTree(files);
  try {
    return await fn(root, path.join(root, 'public'), (await importBuilder()).buildSite);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---- source map helpers ---------------------------------------------------------------------------------------------------------

function decodeVlqs(segment) {
  const out = [];
  let shift = 0;
  let value = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    assert.ok(digit >= 0, `base64 digit ${ch}`);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  assert.equal(shift, 0, 'no segment ends mid-number');
  return out;
}

// Per generated line, its segments as absolute [generated column, source index, source line, source column].
function decodeMappings(mappings) {
  let src = 0;
  let line = 0;
  let col = 0;
  return mappings.split(';').map((group) => {
    if (!group) return [];
    return group.split(',').map((seg) => {
      const f = decodeVlqs(seg);
      assert.equal(f.length, 4, 'segments carry a source position and no name');
      src += f[1];
      line += f[2];
      col += f[3];
      return [f[0], src, line, col];
    });
  });
}

// ---- the real build -------------------------------------------------------------------------------------------------------------

test('site build: public/ holds the page, the bundle, its map, sw.js and the manifest and assets that exist, nothing else', async () => {
  const res = await buildOnce();
  assert.deepEqual(res.scripts, H.scriptList());
  assert.match(res.bundle, /^game\.[0-9a-f]{10}\.js$/);
  assert.equal(res.map, `${res.bundle}.map`);
  const expected = ['index.html', res.bundle, res.map, 'sw.js', ...sourceCopies()].sort();
  assert.deepEqual(walk(OUT), expected, 'no tests, docs, tools or loose src scripts in the deployed site');
  assert.deepEqual(res.files, expected, 'buildSite() lists the files it wrote');
  for (const c of sourceCopies()) assert.equal(readOut(c), fs.readFileSync(path.join(H.ROOT, c), 'utf8'), `${c} is copied as is`);
});

test('site build: the bundle is the scripts in index.html order, each after its separator line, hashed by content', async () => {
  const { scripts, bundle, hash } = await buildOnce();
  const body = scripts.map((s) => `// ---- ${s} ----\n${fs.readFileSync(path.join(H.ROOT, s), 'utf8')}`).join('');
  const text = readOut(bundle);
  assert.equal(text, `${body}//# sourceMappingURL=${bundle}.map\n`, 'ordered concatenation with separators, then the map comment');
  assert.equal(hash, crypto.createHash('sha256').update(body).digest('hex').slice(0, 10), 'hash = sha256 of the bundle without its map comment');
  assert.equal(bundle, `game.${hash}.js`);
  assert.equal([...text.matchAll(/^\/\/ ---- (.+) ----$/gm)].length, scripts.length, 'one separator per script');
  assert.deepEqual([...text.matchAll(/^\/\/ ---- (.+) ----$/gm)].map((m) => m[1]), scripts);
});

test('site build: the output is deterministic, so the hash only moves when the code does', async () => {
  const first = await buildOnce();
  const snap = () => Object.fromEntries(walk(OUT).map((f) => [f, fs.readFileSync(path.join(OUT, f)).toString('base64')]));
  const before = snap();
  const second = (await importBuilder()).buildSite();
  assert.equal(second.bundle, first.bundle);
  assert.deepEqual(snap(), before, 'every file is byte-identical across builds');
});

test('site build: public/index.html is the dev page with one bundle script and the worker registration', async () => {
  const { bundle } = await buildOnce();
  const dev = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
  const page = readOut('index.html');
  assert.equal([...page.matchAll(/<script\b[^>]*\bsrc=/g)].length, 1, 'exactly one external script');
  const tag = `<script src="${bundle}"></script>\n`;
  assert.equal(page.split(tag).length, 2, 'and it is the bundle');
  const inline = [...page.matchAll(/<script>\n([\s\S]*?)<\/script>\n?/g)];
  assert.equal(inline.length, 1, 'plus one inline script: the registration');
  assert.ok(page.indexOf('<canvas id="game"') < page.indexOf(tag), 'the bundle comes after the canvas it boots on');
  assert.ok(page.indexOf(tag) < page.indexOf(inline[0][0]) && inline[0].index + inline[0][0].length <= page.indexOf('</body>'));
  const reg = inline[0][1];
  assert.match(reg, /'serviceWorker' in navigator/);
  assert.match(reg, /location\.protocol === 'https:'/);
  assert.match(reg, /register\('\/sw\.js'\)/);
  assert.match(reg, /try \{[\s\S]*\} catch/);
  assert.match(reg, /addEventListener\('load'/);
  assert.doesNotThrow(() => new vm.Script(reg, { filename: 'registration' }));
  // Everything else is byte-identical to the dev page.
  const devRest = dev.replace(/<script\s+src="[^"]+"\s*><\/script>\n?/g, '');
  const pageRest = page.replace(tag, '').replace(inline[0][0], '');
  assert.equal(pageRest, devRest);
});

test('site build: the registration only registers /sw.js on https with service worker support and never throws', async () => {
  await buildOnce();
  const reg = readOut('index.html').match(/<script>\n([\s\S]*?)<\/script>/)[1];
  function run({ protocol, hasSw = true, register }) {
    const calls = [];
    const handlers = {};
    const navigator = hasSw ? { serviceWorker: { register: (url) => (calls.push(url), register ? register() : Promise.resolve({})) } } : {};
    const sandbox = { window: { addEventListener: (t, fn) => (handlers[t] = fn) }, navigator, location: { protocol } };
    vm.runInNewContext(reg, sandbox);
    assert.equal(calls.length, 0, 'nothing registers before the page has loaded');
    assert.equal(typeof handlers.load, 'function', 'it waits for window load');
    handlers.load();
    return calls;
  }
  assert.deepEqual(run({ protocol: 'https:' }), ['/sw.js']);
  assert.deepEqual(run({ protocol: 'http:' }), [], 'plain http (local dev) never registers');
  assert.deepEqual(run({ protocol: 'file:' }), []);
  assert.deepEqual(run({ protocol: 'https:', hasSw: false }), [], 'no service worker support');
  assert.deepEqual(run({ protocol: 'https:', register: () => Promise.reject(new Error('blocked')) }), ['/sw.js'], 'a rejected registration is swallowed');
  assert.deepEqual(run({ protocol: 'https:', register: () => { throw new Error('sync'); } }), ['/sw.js'], 'a throwing register() is caught');
});

test('site build: the bundle boots in a vm sandbox, defines the game and steps 600 ticks headless like the source scripts', async () => {
  const { bundle } = await buildOnce();
  const { sandbox } = H.load([], { returnSandbox: true });
  assert.equal(sandbox.CB, undefined, 'nothing loaded yet');
  vm.runInContext(readOut(bundle), sandbox, { filename: bundle });
  const CB = sandbox.CB;
  assert.equal(typeof CB.createRun, 'function', 'CB.createRun');
  assert.ok(CB.Scenes.title && typeof CB.Scenes.title.update === 'function', 'CB.Scenes.title');
  assert.ok(CB.Scenes.play && typeof CB.Scenes.play.update === 'function', 'CB.Scenes.play');

  const fromSource = H.load();
  assert.deepEqual(Object.keys(CB).sort(), Object.keys(fromSource).sort(), 'same CB members as the source load');
  assert.deepEqual(CB.Art.spriteNames().sort(), fromSource.Art.spriteNames().sort(), 'same sprites');

  const play = (C) => {
    const run = C.createRun({ seed: 7, god: true });
    for (let i = 0; i < 600; i++) run.step(H.makeInput({ fire: true, aimX: 200 + (i % 90), aimY: 80, moveX: Math.sin(i / 25), moveY: Math.cos(i / 31) }));
    const p = run.world.player;
    return { x: p.x, y: p.y, time: run.time, state: run.state, stage: run.stageIndex, enemies: run.world.enemies.length };
  };
  const got = play(CB);
  assert.ok(Number.isFinite(got.x) && Number.isFinite(got.y), 'the world stays finite');
  assert.ok(got.time > 0, 'time advanced');
  assert.deepEqual(got, play(fromSource), 'the bundle simulates bit-identically to the source scripts');
});

test('site build: the source map is a v3 line-level identity map over the original files', async () => {
  const { scripts, bundle, map: mapName } = await buildOnce();
  // The encoder, against known base64 VLQ values.
  const { vlq } = await importBuilder();
  const vectors = { 0: 'A', 1: 'C', '-1': 'D', 15: 'e', 16: 'gB', 123: '2H', '-123': '3H', 1000: 'w+B' };
  for (const [n, s] of Object.entries(vectors)) assert.equal(vlq(Number(n)), s, `vlq(${n})`);
  for (const n of [0, 1, -1, 31, 32, -32, 511, 9863, -9863, 123456]) assert.deepEqual(decodeVlqs(vlq(n)), [n], `round trip ${n}`);

  const map = JSON.parse(readOut(mapName));
  assert.equal(map.version, 3);
  assert.equal(map.file, bundle);
  assert.deepEqual(map.sources, scripts);
  assert.deepEqual(map.names, []);
  assert.deepEqual(map.sourcesContent, scripts.map((s) => fs.readFileSync(path.join(H.ROOT, s), 'utf8')), 'original sources are embedded');

  const text = readOut(bundle);
  assert.ok(text.endsWith(`\n//# sourceMappingURL=${mapName}\n`));
  const bundleLines = text.split('\n');
  const groups = decodeMappings(map.mappings);
  assert.ok(groups.length <= bundleLines.length);

  // Walk the bundle: a separator line is unmapped and starts the next file; every other line maps to the same text in its own file.
  let current = -1;
  const lineOf = scripts.map(() => 0); // next source line expected per file
  groups.forEach((segs, g) => {
    const line = bundleLines[g];
    if (line === `// ---- ${scripts[current + 1]} ----`) {
      current++;
      assert.deepEqual(segs, [], `separator at bundle line ${g + 1} is unmapped`);
      return;
    }
    assert.ok(current >= 0, 'every mapped line follows a separator');
    if (line.startsWith('//# sourceMappingURL=')) return assert.deepEqual(segs, [], 'the map comment is unmapped');
    assert.equal(segs.length, 1, `bundle line ${g + 1} has one segment`);
    const [col, src, srcLine, srcCol] = segs[0];
    assert.equal(col, 0);
    assert.equal(srcCol, 0);
    assert.equal(src, current, `bundle line ${g + 1} maps into ${scripts[current]}`);
    assert.equal(srcLine, lineOf[current]++, `${scripts[current]} lines map in order`);
    assert.equal(map.sourcesContent[src].split('\n')[srcLine], line, `bundle line ${g + 1} is ${scripts[src]}:${srcLine + 1}`);
  });
  assert.equal(current, scripts.length - 1, 'all separators were seen');
  scripts.forEach((s, i) => assert.equal(lineOf[i], map.sourcesContent[i].split('\n').length - 1, `every line of ${s} is mapped`));

  // Spot checks by content: a known line in main.js and the first line of ns.js.
  const mainIdx = scripts.indexOf('src/main.js');
  const nsIdx = scripts.indexOf('src/core/ns.js');
  const probe = (needle, file) => {
    const g = bundleLines.findIndex((l) => l.includes(needle));
    assert.ok(g >= 0, needle);
    const srcLine = map.sourcesContent[file].split('\n').findIndex((l) => l.includes(needle));
    assert.deepEqual(groups[g], [[0, file, srcLine, 0]], `${needle} -> ${scripts[file]}:${srcLine + 1}`);
  };
  probe('CB_NO_BOOT', mainIdx);
  assert.deepEqual(groups[1], [[0, nsIdx, 0, 0]], 'the first source line follows the first separator');
});

// ---- the service worker, run against fakes --------------------------------------------------------------------------------------

const ORIGIN = 'https://clawd-2d.vercel.app';

// A tiny service-worker world: CacheStorage, fetch, Request and Response fakes plus the lifecycle events.
function swWorld(source, seed = {}) {
  const listeners = {};
  const stores = new Map(Object.entries(seed).map(([name, urls]) => [name, new Map(urls.map((u) => [new URL(u, ORIGIN).href, { status: 200, type: 'basic', body: `old:${u}` }]))]));
  const net = { up: true, status: {}, type: {}, calls: [] };
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
  class Request {
    constructor(url, init) {
      this.url = new URL(url, ORIGIN).href;
      this.method = 'GET';
      this.mode = 'no-cors';
      Object.assign(this, init);
    }
  }
  class Response {
    constructor(body, init) {
      this.body = body;
      this.status = (init && init.status) || 200;
      this.type = (init && init.type) || 'basic';
    }
    static error() {
      return Object.assign(new Response('', { status: 0 }), { type: 'error' });
    }
    clone() {
      return new Response(this.body, this);
    }
  }
  const doFetch = async (req) => {
    net.calls.push(req);
    if (!net.up) throw new TypeError('offline');
    const url = keyOf(req);
    return new Response(`net:${url}`, { status: net.status[url] || 200, type: net.type[url] || 'basic' });
  };
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const caches = {
    open: async (name) => ({
      addAll: async (reqs) => {
        const rs = await Promise.all(reqs.map(doFetch));
        if (rs.some((r) => r.status !== 200)) throw new TypeError('addAll: bad response');
        reqs.forEach((q, i) => store(name).set(keyOf(q), rs[i]));
      },
      put: async (req, res) => void store(name).set(keyOf(req), res),
    }),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req, opts) => {
      for (const n of opts && opts.cacheName ? [opts.cacheName] : [...stores.keys()]) {
        const hit = stores.has(n) && stores.get(n).get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const w = { net, stores, Request, flags: { skipWaiting: 0, claim: 0 } };
  const self = {
    addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
    location: new URL(`${ORIGIN}/sw.js`),
    skipWaiting: () => (w.flags.skipWaiting++, Promise.resolve()),
    clients: { claim: () => (w.flags.claim++, Promise.resolve()) },
  };
  const sandbox = { self, caches, fetch: doFetch, Request, Response, URL, Promise };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sw.js' });
  w.cacheName = vm.runInContext('CACHE', sandbox);
  w.precache = [...vm.runInContext('PRECACHE', sandbox)];
  w.bundle = vm.runInContext('BUNDLE', sandbox);
  w.lifecycle = async (type) => {
    const waits = [];
    for (const fn of listeners[type]) fn({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };
  // Fires a fetch event: { handled, res } (handled is false when the worker left the request to the browser); settles waitUntil work.
  w.fetch = async (req) => {
    let responded = null;
    const waits = [];
    for (const fn of listeners.fetch) fn({ request: req, respondWith: (p) => (responded = Promise.resolve(p)), waitUntil: (p) => waits.push(p) });
    const res = responded ? await responded : null;
    await Promise.all(waits);
    return { handled: Boolean(responded), res };
  };
  return w;
}

const swSource = async () => {
  await buildOnce();
  return readOut('sw.js');
};

test('site build: sw.js parses, precaches the page, the bundle, the manifest and every asset but og.png, and is versioned by the bundle hash', async () => {
  const { bundle, hash, precache } = await buildOnce();
  const sw = readOut('sw.js');
  assert.doesNotThrow(() => new vm.Script(sw, { filename: 'sw.js' }));
  const w = swWorld(sw);
  assert.equal(w.cacheName, `clawd-${hash}`, 'the cache name carries the bundle hash');
  assert.equal(w.bundle, `/${bundle}`);
  assert.deepEqual(w.precache, precache);
  const copies = sourceCopies().filter((c) => c !== 'assets/og.png');
  assert.deepEqual(w.precache, ['/', `/${bundle}`, ...copies.map((c) => `/${c}`)]);
  assert.ok(!precache.some((u) => u.endsWith('og.png')), 'og.png is only for link-preview crawlers');
  assert.ok(!precache.some((u) => u.endsWith('.map')), 'the source map is not precached');
  for (const u of precache.filter((p) => p !== '/')) assert.ok(fs.existsSync(path.join(OUT, u.slice(1))), `${u} exists in public/`);
});

test('sw.js install: caches every precache URL under this build, fresh from the network except the immutable bundle, then skips waiting', async () => {
  const w = swWorld(await swSource());
  await w.lifecycle('install');
  assert.equal(w.flags.skipWaiting, 1);
  const cached = w.stores.get(w.cacheName);
  assert.deepEqual([...cached.keys()].sort(), w.precache.map((u) => new URL(u, ORIGIN).href).sort());
  assert.deepEqual(w.net.calls.map((r) => r.url).sort(), [...cached.keys()].sort());
  for (const r of w.net.calls) {
    if (r.url === new URL(w.bundle, ORIGIN).href) assert.notEqual(r.cache, 'reload', 'the hashed bundle may come from the HTTP cache');
    else assert.equal(r.cache, 'reload', `${r.url} skips the HTTP cache`);
  }
});

test('sw.js install: a failed precache fetch fails the install (the old worker and cache keep serving)', async () => {
  const w = swWorld(await swSource());
  w.net.status[new URL(w.bundle, ORIGIN).href] = 404;
  await assert.rejects(w.lifecycle('install'));
  assert.equal(w.flags.skipWaiting, 0);
  assert.ok(!w.stores.has(w.cacheName) || w.stores.get(w.cacheName).size === 0, 'nothing half-cached');
});

test('sw.js activate: deletes the other clawd- caches, keeps this build and unrelated caches, then claims the open pages', async () => {
  const w = swWorld(await swSource(), { 'clawd-old1': ['/'], 'clawd-old2': ['/'], 'other-app': ['/x'] });
  await w.lifecycle('install');
  await w.lifecycle('activate');
  assert.deepEqual([...w.stores.keys()].sort(), [w.cacheName, 'other-app'].sort());
  assert.equal(w.flags.claim, 1);
});

test('sw.js navigations: network-first (a new deploy shows at once), the cached page when offline or on a 5xx', async () => {
  const w = swWorld(await swSource());
  await w.lifecycle('install');
  const nav = (url) => new w.Request(url, { mode: 'navigate' });
  const cachedPage = w.stores.get(w.cacheName).get(`${ORIGIN}/`);

  w.net.calls.length = 0;
  let r = await w.fetch(nav('/'));
  assert.equal(r.res.body, `net:${ORIGIN}/`, 'online: the network page, not the cached one');
  assert.equal(w.net.calls.length, 1);

  w.net.up = false;
  r = await w.fetch(nav('/'));
  assert.equal(r.res, cachedPage, 'offline: the page cached at install');
  r = await w.fetch(nav('/?utm_source=x'));
  assert.equal(r.res, cachedPage, 'offline with a query string: still the cached page');

  w.net.up = true;
  w.net.status[`${ORIGIN}/`] = 503;
  r = await w.fetch(nav('/'));
  assert.equal(r.res, cachedPage, 'a 5xx falls back to the cached page');
  w.net.status[`${ORIGIN}/`] = 404;
  r = await w.fetch(nav('/'));
  assert.equal(r.res.status, 404, 'a 404 is shown as is');

  const bare = swWorld(await swSource());
  bare.net.up = false;
  r = await bare.fetch(new bare.Request('/', { mode: 'navigate' }));
  assert.equal(r.res.type, 'error', 'offline with nothing cached is a network error');
  bare.net.up = true;
  bare.net.status[`${ORIGIN}/`] = 502;
  r = await bare.fetch(new bare.Request('/', { mode: 'navigate' }));
  assert.equal(r.res.status, 502, 'a 5xx with nothing cached shows the server error');
});

test('sw.js other GETs: cache-first, filled from the network, never caching failures or opaque responses', async () => {
  const w = swWorld(await swSource());
  await w.lifecycle('install');
  w.net.calls.length = 0;
  const bundleUrl = new URL(w.bundle, ORIGIN).href;

  let r = await w.fetch(new w.Request(w.bundle));
  assert.equal(r.res.body, `net:${bundleUrl}`, 'the precached bundle');
  assert.equal(w.net.calls.length, 0, 'a hit never touches the network');

  const fresh = `${ORIGIN}/assets/new.png`;
  r = await w.fetch(new w.Request('/assets/new.png'));
  assert.equal(r.res.body, `net:${fresh}`);
  assert.equal(w.net.calls.length, 1);
  assert.ok(w.stores.get(w.cacheName).has(fresh), 'filled from the network');
  await w.fetch(new w.Request('/assets/new.png'));
  assert.equal(w.net.calls.length, 1, 'then served from the cache');

  w.net.status[`${ORIGIN}/missing.png`] = 404;
  await w.fetch(new w.Request('/missing.png'));
  assert.ok(!w.stores.get(w.cacheName).has(`${ORIGIN}/missing.png`), '404s are not cached');
  w.net.type[`${ORIGIN}/opaque.png`] = 'opaque';
  await w.fetch(new w.Request('/opaque.png'));
  assert.ok(!w.stores.get(w.cacheName).has(`${ORIGIN}/opaque.png`), 'non-basic responses are not cached');

  w.net.up = false;
  await assert.rejects(w.fetch(new w.Request('/assets/never-seen.png')), 'offline and uncached is a network error');
});

test('sw.js leaves non-GET and cross-origin requests to the browser and never caches them', async () => {
  const w = swWorld(await swSource());
  await w.lifecycle('install');
  w.net.calls.length = 0;
  const before = JSON.stringify([...w.stores.get(w.cacheName).keys()]);
  for (const req of [
    new w.Request('/api/score', { method: 'POST' }),
    new w.Request('/', { method: 'POST', mode: 'navigate' }),
    new w.Request('https://example.com/lib.js'),
    new w.Request('https://example.com/', { mode: 'navigate' }),
  ]) {
    const r = await w.fetch(req);
    assert.equal(r.handled, false, `${req.method} ${req.url}`);
  }
  assert.equal(w.net.calls.length, 0);
  assert.equal(JSON.stringify([...w.stores.get(w.cacheName).keys()]), before);
});

// ---- edge cases on throwaway trees ----------------------------------------------------------------------------------------------

const PAGE = '<!doctype html>\n<html>\n<head>\n<title>t</title>\n</head>\n<body>\n<canvas id="game"></canvas>\n<script src="src/a.js"></script>\n<script src="src/sub/b.js"></script>\n</body>\n</html>\n';

test('site build without a manifest or assets: just the page, bundle, map and sw.js', async () => {
  await withTree({ 'index.html': PAGE, 'src/a.js': 'var a = 1;\n', 'src/sub/b.js': 'var b = 2;\n' }, (root, out, buildSite) => {
    const res = buildSite({ root });
    assert.deepEqual(res.files, ['index.html', res.bundle, res.map, 'sw.js'].sort());
    assert.deepEqual(res.precache, ['/', `/${res.bundle}`]);
    assert.equal(fs.readFileSync(path.join(out, res.bundle), 'utf8'), `// ---- src/a.js ----\nvar a = 1;\n// ---- src/sub/b.js ----\nvar b = 2;\n//# sourceMappingURL=${res.map}\n`);
    assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8').replace(`<script src="${res.bundle}"></script>\n`, '').replace(/<script>\n[\s\S]*?<\/script>\n/, ''), PAGE.replace(/<script src="[^"]+"><\/script>\n/g, ''));
  });
});

test('site build copies the manifest and every asset (recursively, no dotfiles), precaches all but og.png, and re-versions sw.js when one changes', async () => {
  const files = {
    'index.html': PAGE,
    'src/a.js': 'var a = 1;\n',
    'src/sub/b.js': 'var b = 2;\n',
    'manifest.webmanifest': '{"name":"t"}',
    'assets/icon-192.png': 'icon',
    'assets/og.png': 'og',
    'assets/deep/er/x.png': 'x',
    'assets/.DS_Store': 'junk',
  };
  await withTree(files, (root, out, buildSite) => {
    const res = buildSite({ root });
    const want = ['assets/deep/er/x.png', 'assets/icon-192.png', 'assets/og.png', 'index.html', res.bundle, res.map, 'manifest.webmanifest', 'sw.js'].sort();
    assert.deepEqual(res.files, want);
    for (const f of want.filter((f) => f !== 'index.html' && files[f] != null)) assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), files[f]);
    assert.deepEqual(res.precache, ['/', `/${res.bundle}`, '/manifest.webmanifest', '/assets/deep/er/x.png', '/assets/icon-192.png']);

    const sw1 = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    fs.writeFileSync(path.join(root, 'assets/icon-192.png'), 'icon, redrawn');
    const res2 = buildSite({ root });
    const sw2 = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
    assert.equal(res2.bundle, res.bundle, 'same code, same bundle');
    assert.notEqual(sw2, sw1, 'but a changed icon gives browsers a new sw.js to install');
    assert.match(sw2, /const CACHE = "clawd-[0-9a-f]{10}"/);
  });
});

test('site build normalises CRLF and a missing final newline, so source lines stay bundle lines', async () => {
  await withTree({ 'index.html': PAGE, 'src/a.js': 'var a = 1;\r\nvar a2 = 2;', 'src/sub/b.js': 'var b = 2;\n' }, (root, out, buildSite) => {
    const res = buildSite({ root });
    const text = fs.readFileSync(path.join(out, res.bundle), 'utf8');
    assert.equal(text, `// ---- src/a.js ----\nvar a = 1;\nvar a2 = 2;\n// ---- src/sub/b.js ----\nvar b = 2;\n//# sourceMappingURL=${res.map}\n`);
    const map = JSON.parse(fs.readFileSync(path.join(out, res.map), 'utf8'));
    assert.deepEqual(decodeMappings(map.mappings), [[], [[0, 0, 0, 0]], [[0, 0, 1, 0]], [], [[0, 1, 0, 0]]]);
    assert.deepEqual(map.sourcesContent, ['var a = 1;\nvar a2 = 2;\n', 'var b = 2;\n']);
  });
});

test('site build refuses a page that lists no scripts', async () => {
  await withTree({ 'index.html': '<!doctype html><title>t</title>' }, (root, out, buildSite) => {
    assert.throws(() => buildSite({ root }), /lists no <script src>/);
  });
});

// ---- vercel.json ----------------------------------------------------------------------------------------------------------------

test('vercel.json: static build into public/ with no framework, and the security headers it already had', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'vercel.json'), 'utf8'));
  assert.equal(cfg.framework, null);
  assert.equal(cfg.outputDirectory, 'public');
  assert.equal(cfg.buildCommand, 'node tools/build-site.mjs');
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  assert.deepEqual(all.headers, [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  ]);
});

test('vercel.json: hashed bundle and map are immutable, assets revalidate in the background, sw.js is never cached, the manifest has its type', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'vercel.json'), 'utf8'));
  const headersFor = (source) => {
    const rule = cfg.headers.filter((h) => h.source === source);
    assert.equal(rule.length, 1, `exactly one rule for ${source}`);
    return Object.fromEntries(rule[0].headers.map((h) => [h.key, h.value]));
  };
  const immutable = 'public, max-age=31536000, immutable';
  assert.deepEqual(headersFor('/game.(.*).js'), { 'Cache-Control': immutable });
  assert.deepEqual(headersFor('/game.(.*).js.map'), { 'Cache-Control': immutable });
  assert.deepEqual(headersFor('/assets/(.*)'), { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' });
  assert.deepEqual(headersFor('/sw.js'), { 'Cache-Control': 'no-cache' });
  assert.deepEqual(headersFor('/manifest.webmanifest'), { 'Content-Type': 'application/manifest+json' });
});
