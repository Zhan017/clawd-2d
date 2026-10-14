'use strict';
// The claude.ai Artifact build (tools/build-artifact.mjs): the page shape, the Artifact rules for style, title and external
// references, one parseable <script> per source file, and the built page itself loaded into a node:vm sandbox.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const H = require('./harness');

const DIST = path.join(H.ROOT, 'dist', 'clawd-vs-bugs.html');
const SCRIPT_RE = /<script>\n([\s\S]*?)\n<\/script>/g;

let built = null;
// Builds once for the whole file (the tests run one after another; the build writes dist/clawd-vs-bugs.html).
function buildOnce() {
  if (!built) {
    built = import(pathToFileURL(path.join(H.ROOT, 'tools', 'build-artifact.mjs')).href).then((mod) => mod.build());
  }
  return built;
}

function chunksOf(out) {
  return [...out.matchAll(SCRIPT_RE)].map((m) => m[1]);
}

// Everything in the page except the inlined scripts: the title, the styles and the body markup.
function pageWithoutScripts(out) {
  return out.replace(/<script>\n[\s\S]*?\n<\/script>/g, '');
}

function styleOf(out) {
  return (out.match(/<style>([\s\S]*?)<\/style>/g) || []).map((s) => s.replace(/^<style>|<\/style>$/g, '')).join('\n');
}

// [{ selectors: ['html', 'body'], body: 'height: 100%; ...' }] for the flat rules of a stylesheet (no @media nesting is used).
function rulesOf(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) rules.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] });
  return rules;
}

test('build: Artifact page has no document wrapper and inlines every script in order', async () => {
  const { out, scripts } = await buildOnce();
  assert.ok(out.startsWith('<title>Clawd vs Bugs</title>'));
  assert.doesNotMatch(out, /<!doctype/i);
  assert.doesNotMatch(out, /<html[\s>]/i);
  assert.doesNotMatch(out, /<head[\s>]/i);
  assert.doesNotMatch(out, /<body[\s>]/i);
  assert.match(out, /<canvas id="game"/);
  assert.equal((out.match(/<\/script/gi) || []).length, scripts.length, 'one closing tag per file');
  assert.equal((out.match(/<script/gi) || []).length, scripts.length, 'one opening tag per file');
  assert.doesNotMatch(pageWithoutScripts(out), /<script/i, 'no stray script tag outside the chunks');
  const chunks = chunksOf(out);
  assert.equal(chunks.length, scripts.length);
  chunks.forEach((code, i) => {
    assert.doesNotMatch(code, /<!--/, `${scripts[i]} contains an HTML comment opener`);
    assert.doesNotThrow(() => new vm.Script(code, { filename: scripts[i] }), `${scripts[i]} must parse`);
    assert.ok(code.includes(`//# sourceURL=${scripts[i]}`));
    assert.ok(code.trimEnd().endsWith(`//# sourceURL=${scripts[i]}`), `${scripts[i]}: sourceURL is the last line`);
  });
  let last = -1;
  for (const s of scripts) {
    const i = out.indexOf(`// ---- ${s} ----`);
    assert.ok(i > last, `${s} in order`);
    last = i;
  }
  assert.equal(scripts.length, H.scriptList().length);
  assert.deepEqual(scripts, H.scriptList(), 'the same scripts in the same order as index.html');
});

test('build: every source file is inlined byte for byte (apart from the </script escape)', async () => {
  const { out, scripts } = await buildOnce();
  const chunks = chunksOf(out);
  scripts.forEach((s, i) => {
    const src = fs.readFileSync(path.join(H.ROOT, s), 'utf8').replace(/<\/script/gi, '<\\/script');
    assert.equal(chunks[i], `// ---- ${s} ----\n${src}\n//# sourceURL=${s}`, s);
  });
});

test('build: the style sets a dark colour scheme, a body background and no scrolling', async () => {
  const { out } = await buildOnce();
  const css = styleOf(out);
  assert.ok(css.trim().length > 0, 'a <style> block is present');
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*dark/, ':root { ... color-scheme: dark }');
  const rules = rulesOf(css);
  const forBody = rules.filter((r) => r.selectors.includes('body'));
  assert.ok(forBody.some((r) => /(?:^|[;\s])background(?:-color)?\s*:/.test(r.body)), 'a body rule sets a background');
  const forPage = rules.filter((r) => r.selectors.includes('body') || r.selectors.includes('html'));
  assert.ok(forPage.some((r) => /(?:^|[;\s])overflow\s*:\s*hidden/.test(r.body)), 'html or body sets overflow: hidden');
  assert.match(css, /#game\s*\{[^}]*image-rendering:[^;}]*pixelated/, 'the canvas keeps crisp pixels');
});

test('build: no prefers-color-scheme anywhere (the Artifact is dark in both themes)', async () => {
  const { out } = await buildOnce();
  assert.doesNotMatch(out, /prefers-color-scheme/i);
});

test('build: no external src, href, url() or @import (the page is self-contained)', async () => {
  const { out } = await buildOnce();
  const page = pageWithoutScripts(out);
  assert.doesNotMatch(page, /https?:/i, 'no http(s) reference in the title, style or markup');
  assert.doesNotMatch(out, /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i, 'no external src/href attribute');
  assert.doesNotMatch(out, /url\(\s*["']?\s*(?:https?:)?\/\//i, 'no external url()');
  assert.doesNotMatch(out, /@import/i);
  assert.doesNotMatch(page, /<(?:link|img|iframe|object|embed|video|audio|source)\b/i, 'the markup loads nothing');
  assert.doesNotMatch(page, /\b(?:src|href)\s*=/i, 'no src or href attribute outside the inlined scripts');
});

test('build: exactly one <title>, two to four words', async () => {
  const { out } = await buildOnce();
  const titles = out.match(/<title>[\s\S]*?<\/title>/gi) || [];
  assert.equal(titles.length, 1);
  assert.equal((out.match(/<title/gi) || []).length, 1);
  const text = titles[0].replace(/<\/?title>/gi, '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  assert.ok(words.length >= 2 && words.length <= 4, `title "${text}" has ${words.length} words`);
});

test('build: the file on disk is the built page and well under the 16 MB limit', async () => {
  const { out, bytes } = await buildOnce();
  assert.equal(fs.readFileSync(DIST, 'utf8'), out);
  assert.equal(fs.statSync(DIST).size, bytes);
  assert.ok(bytes < 2 * 1024 * 1024, `${bytes} bytes`);
});

test('build: a load-time throw names the real file through the sourceURL', async () => {
  const { out, scripts } = await buildOnce();
  const chunks = chunksOf(out);
  const { sandbox } = H.load([], { returnSandbox: true }); // an empty sandbox: math.js needs CB from ns.js, so it throws on load
  const i = scripts.indexOf('src/core/math.js');
  assert.ok(i > 0);
  let err = null;
  try {
    vm.runInContext(chunks[i], sandbox); // no filename option: only the sourceURL comment can name the file
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'math.js throws without ns.js');
  assert.match(String(err.stack), /src\/core\/math\.js:\d+/);
});

test('build: the built page runs in a vm sandbox and defines the game', async () => {
  const { out, scripts } = await buildOnce();
  assert.equal(out, fs.readFileSync(DIST, 'utf8'));
  const html = fs.readFileSync(DIST, 'utf8');
  const chunks = chunksOf(html);
  assert.equal(chunks.length, scripts.length);

  // The sandbox the harness makes (DOM and canvas stubs, CB_NO_BOOT, Math.random banned), with nothing loaded yet.
  const { sandbox } = H.load([], { returnSandbox: true });
  assert.equal(sandbox.CB_NO_BOOT, true);
  chunks.forEach((code, i) => vm.runInContext(code, sandbox, { filename: scripts[i] }));
  const CB = sandbox.CB;
  assert.equal(typeof CB.createRun, 'function', 'CB.createRun');
  assert.ok(CB.Scenes.title && typeof CB.Scenes.title.update === 'function', 'CB.Scenes.title');
  assert.ok(CB.Scenes.play && typeof CB.Scenes.play.update === 'function', 'CB.Scenes.play');

  // The same namespace as loading the source files directly.
  const fromSource = H.load();
  assert.deepEqual(Object.keys(CB).sort(), Object.keys(fromSource).sort(), 'same CB members as the source load');
  assert.deepEqual(Object.keys(CB.Bosses).sort(), Object.keys(fromSource.Bosses).sort());
  assert.deepEqual(Object.keys(CB.Enemies).sort(), Object.keys(fromSource.Enemies).sort());
  assert.deepEqual(Object.keys(CB.Screens).sort(), Object.keys(fromSource.Screens).sort());
  assert.deepEqual(CB.Art.spriteNames().sort(), fromSource.Art.spriteNames().sort(), 'same sprites');

  // And it plays: a god-mode run steps for two seconds and the world stays finite.
  const run = CB.createRun({ seed: 11, god: true });
  for (let i = 0; i < 120; i++) run.step(H.makeInput({ fire: true, aimX: 200, aimY: 80, moveX: Math.sin(i / 20) }));
  assert.ok(Number.isFinite(run.world.player.x) && Number.isFinite(run.world.player.y));
  assert.ok(run.time > 0);
});

// ---- more ways to play: touch-friendly page (no selection or callouts, a rotate overlay, home-screen metas) -------------------------

const INDEX = fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8');
const headOf = (html) => (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || '';

test('build: the page stops text selection, the iOS callout, the tap highlight and overscroll', async () => {
  const { out } = await buildOnce();
  const rules = rulesOf(styleOf(out));
  const page = rules.filter((r) => r.selectors.includes('html') && r.selectors.includes('body'));
  assert.equal(page.length, 1, 'one rule for html and body');
  const body = page[0].body;
  assert.match(body, /(?:^|[;\s])user-select\s*:\s*none/);
  assert.match(body, /-webkit-user-select\s*:\s*none/);
  assert.match(body, /-webkit-touch-callout\s*:\s*none/);
  assert.match(body, /-webkit-tap-highlight-color\s*:\s*transparent/);
  assert.match(body, /overscroll-behavior\s*:\s*none/);
  assert.match(body, /overflow\s*:\s*hidden/, 'still no scrolling');
});

test('build: the #game rule stays one rule and keeps crisp pixels and touch-action: none', async () => {
  const { out } = await buildOnce();
  const css = styleOf(out);
  assert.equal((css.match(/#game\s*\{/g) || []).length, 1, 'one #game rule');
  assert.match(css, /#game\s*\{[^}]*touch-action:\s*none/);
  assert.match(css, /#game\s*\{[^}]*image-rendering:[^;}]*pixelated/);
});

test('build: the #rotate overlay is in the Artifact page, hidden by default, full-screen over the canvas and clickable in portrait on touch', async () => {
  const { out } = await buildOnce();
  const page = pageWithoutScripts(out);
  assert.match(page, /<div id="rotate"><div class="card"><svg [^>]*>[\s\S]*?<\/svg><p class="big">Turn your device sideways to play<\/p><p class="small">Rotation locked\? Turn off Portrait Orientation Lock in Control Center\.<\/p><\/div><\/div>/);
  assert.ok(page.indexOf('<canvas id="game"') < page.indexOf('id="rotate"'), 'after the canvas, so it paints on top');
  const css = styleOf(out);
  const base = rulesOf(css).filter((r) => r.selectors.includes('#rotate'));
  assert.ok(base.length >= 1, 'a #rotate rule');
  const baseCss = base[0].body;
  assert.match(baseCss, /display\s*:\s*none/, 'hidden unless the media query says otherwise');
  assert.match(baseCss, /position\s*:\s*fixed/);
  assert.match(baseCss, /inset\s*:\s*0/, 'full screen');
  assert.match(baseCss, /z-index\s*:\s*\d+/, 'above the canvas');
  assert.match(baseCss, /place-items\s*:\s*center/, 'centred text');
  assert.match(baseCss, /text-align\s*:\s*center/);
  assert.match(baseCss, /background\s*:\s*var\(--bg\)/, 'the page background');
  assert.match(baseCss, /pointer-events\s*:\s*auto/, 'a portrait tap must not reach the canvas under it');
  assert.doesNotMatch(baseCss, /pointer-events\s*:\s*none/);
  const media = css.match(/@media\s*\(orientation:\s*portrait\)\s*and\s*\(pointer:\s*coarse\)\s*\{\s*#rotate\s*\{([^}]*)\}\s*\}/);
  assert.ok(media, 'shown only in portrait on a coarse pointer');
  assert.match(media[1], /display\s*:\s*grid/);
  assert.equal((css.match(/@media/g) || []).length, 1, 'that is the only media query');
});

test('build: index.html carries the theme-color and home-screen metas in its head, and its <style> has no attributes', () => {
  const head = headOf(INDEX);
  assert.match(head, /<meta name="theme-color" content="#0B0B10">/);
  assert.match(head, /<meta name="mobile-web-app-capable" content="yes">/);
  assert.match(head, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(head, /<meta name="apple-mobile-web-app-title" content="Clawd">/);
  assert.match(head, /<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">/);
  assert.match(head, /<meta name="viewport" content="[^"]*viewport-fit=cover/, 'the viewport meta is unchanged');
  const styleTags = INDEX.match(/<style\b[^>]*>/g) || [];
  assert.deepEqual(styleTags, ['<style>'], 'build-artifact.mjs matches a bare <style>');
});

test('build: the rotate overlay needs no script, no https and no colour-scheme query (the Artifact rules still hold)', async () => {
  const { out } = await buildOnce();
  const rotate = (pageWithoutScripts(out).match(/<div id="rotate">[\s\S]*?<\/div><\/div>/) || [''])[0];
  assert.ok(rotate.length > 0);
  assert.doesNotMatch(rotate, /<script|https?:|\bon\w+\s*=/i);
  assert.doesNotMatch(out, /prefers-color-scheme/i);
});
