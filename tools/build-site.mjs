#!/usr/bin/env node
// Builds public/ for static hosting (Vercel): index.html with one content-hashed game bundle (plus its source map),
// a service worker for offline play, and the manifest and assets when they exist. Tests, docs and tools stay out of
// the deployed site. Zero dependencies; run with `npm run build:site`.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'public');

const SCRIPT_RE = /<script\s+src="([^"]+)"\s*><\/script>\n?/g;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const sha256 = (data) => createHash('sha256').update(data);

// Base64 VLQ, the number format of source map "mappings": the sign goes in bit 0, then 5 bits per digit, bit 5 = "more digits".
export function vlq(n) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v) digit |= 32;
    out += B64[digit];
  } while (v);
  return out;
}

// Sorted '/'-separated file paths under `dir` (dotfiles such as .DS_Store stay out); [] when `dir` does not exist.
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith('.'))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)).map((p) => `${d.name}/${p}`) : [d.name]));
}

// Registers the service worker once the page has loaded. https only (localhost dev stays on plain scripts), and a failure
// to register must never touch the game, so it is wrapped and its rejection swallowed.
const REGISTER = `<script>
window.addEventListener('load', function () {
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(function () {});
  } catch (e) {}
});
</script>
`;

// The worker's behaviour, appended to a generated header that defines CACHE, BUNDLE and PRECACHE.
const SW_RUNTIME = `
// Install: fill this build's cache. The page and the unhashed files skip the HTTP cache, so the cached page and bundle are
// one deploy's matching pair; the bundle is content-hashed (immutable), so the HTTP cache copy it just loaded is safe to reuse.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, url === BUNDLE ? undefined : { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: drop every other Clawd cache, then take over the open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('clawd-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Fetch: navigations are network-first, so a new deploy always shows, and fall back to the cached page when offline or on a
// 5xx. Other same-origin GETs are cache-first and fill from the network. Non-GET and cross-origin requests are left alone.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    const offline = (res) => caches.match('/', { cacheName: CACHE }).then((hit) => hit || res || Response.error());
    event.respondWith(fetch(req).then((res) => (res.status >= 500 ? offline(res) : res), () => offline()));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {}));
          }
          return res;
        })
    )
  );
});
`;

// root/out default to the repo and its public/; tests pass a temporary tree. Returns what was built:
//   files    every file written under out, as sorted '/'-separated paths
//   scripts  the script paths index.html listed, in order
//   bundle   the bundle's file name, game.<hash>.js (hash = first 10 hex of the sha256 of the bundle without its map comment)
//   hash, map (the map's file name), precache (the URLs sw.js precaches), bytes and gzip (bundle sizes)
export function buildSite({ root = ROOT, out = join(root, 'public') } = {}) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(SCRIPT_RE)].map((m) => m[1]);
  if (!scripts.length) throw new Error('index.html lists no <script src>');

  // Sources are read with LF endings and a final newline, so every source line is one bundle line on any checkout.
  const codes = scripts.map((s) => {
    const code = readFileSync(join(root, s), 'utf8').replace(/\r\n/g, '\n');
    return code.endsWith('\n') ? code : `${code}\n`;
  });
  const body = scripts.map((s, i) => `// ---- ${s} ----\n${codes[i]}`).join('');
  const hash = sha256(body).digest('hex').slice(0, 10);
  const bundle = `game.${hash}.js`;
  const map = `${bundle}.map`;
  const bundleText = `${body}//# sourceMappingURL=${map}\n`;

  // v3 line-level identity map: bundle line -> same line of its own file, column 0. Separator lines have no segment.
  // A segment is [generated column, source index, source line, source column], the last three relative to the previous segment.
  const lines = [];
  let prevSource = 0;
  let prevLine = 0;
  codes.forEach((code, i) => {
    lines.push('');
    const n = code.split('\n').length - 1;
    for (let j = 0; j < n; j++) {
      lines.push(vlq(0) + vlq(i - prevSource) + vlq(j - prevLine) + vlq(0));
      prevSource = i;
      prevLine = j;
    }
  });
  const sourceMap = { version: 3, file: bundle, sources: scripts, sourcesContent: codes, names: [], mappings: lines.join(';') };

  // The dev page with its script tags replaced by the bundle (where the first one stood) and the worker registration.
  let first = true;
  const page = html.replace(SCRIPT_RE, () => {
    if (!first) return '';
    first = false;
    return `<script src="${bundle}"></script>\n${REGISTER}`;
  });

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const put = (name, data) => {
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), data);
  };
  put('index.html', page);
  put(bundle, bundleText);
  put(map, JSON.stringify(sourceMap));

  // Copies, when the sources exist (the art and manifest are made separately, and the build works without them).
  const copies = [];
  if (existsSync(join(root, 'manifest.webmanifest'))) copies.push('manifest.webmanifest');
  for (const a of walk(join(root, 'assets'))) copies.push(`assets/${a}`);
  for (const c of copies) {
    mkdirSync(dirname(join(out, c)), { recursive: true });
    copyFileSync(join(root, c), join(out, c));
  }

  // Precache: the page, the bundle, the manifest and every asset except og.png (only link-preview crawlers fetch it).
  const files = copies.filter((c) => c !== 'assets/og.png');
  const precache = ['/', `/${bundle}`, ...files.map((c) => `/${c}`)];
  // The digest covers everything precached but the bundle (already named by its hash). It rides in sw.js as a comment, so
  // changing an icon or the page alone still changes sw.js, and browsers then install it and refresh the cached copies.
  const digest = sha256(page);
  for (const c of files) digest.update(`\0${c}\0`).update(readFileSync(join(out, c)));
  put(
    'sw.js',
    `// Clawd vs Bugs service worker. Generated by tools/build-site.mjs; do not edit.\n` +
      `// Precache digest ${digest.digest('hex').slice(0, 10)}: it changes whenever the page or a precached file does, so browsers fetch the new sw.js and refresh the cache.\n` +
      `'use strict';\n` +
      `const CACHE = ${JSON.stringify(`clawd-${hash}`)};\n` +
      `const BUNDLE = ${JSON.stringify(`/${bundle}`)};\n` +
      `const PRECACHE = ${JSON.stringify(precache, null, 2)};\n` +
      SW_RUNTIME
  );

  return {
    files: walk(out),
    scripts,
    bundle,
    hash,
    map,
    precache,
    bytes: Buffer.byteLength(bundleText),
    gzip: gzipSync(bundleText).length,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = buildSite();
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(
    `public/: ${res.files.length} files; ${res.bundle} bundles ${res.scripts.length} scripts (${kb(res.bytes)}, ${kb(res.gzip)} gzipped); sw.js precaches ${res.precache.length} URLs`
  );
}
