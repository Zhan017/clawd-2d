'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('./harness');

test('site build: public/ holds index.html and exactly the scripts it lists, nothing else', async () => {
  const mod = await import(pathToFileURL(path.join(H.ROOT, 'tools', 'build-site.mjs')).href);
  const { scripts } = mod.buildSite();
  assert.deepEqual(scripts, H.scriptList());
  const out = path.join(H.ROOT, 'public');
  assert.equal(fs.readFileSync(path.join(out, 'index.html'), 'utf8'), fs.readFileSync(path.join(H.ROOT, 'index.html'), 'utf8'));
  const listed = new Set(['index.html', ...scripts]);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.relative(out, path.join(dir, d.name))]));
  const shipped = walk(out).map((p) => p.split(path.sep).join('/')).sort();
  assert.deepEqual(shipped, [...listed].sort(), 'no tests, docs or tools in the deployed site');
  for (const s of scripts) assert.equal(fs.readFileSync(path.join(out, s), 'utf8'), fs.readFileSync(path.join(H.ROOT, s), 'utf8'), s);
});

test('vercel.json: static build into public/ with no framework', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'vercel.json'), 'utf8'));
  assert.equal(cfg.framework, null);
  assert.equal(cfg.outputDirectory, 'public');
  assert.equal(cfg.buildCommand, 'node tools/build-site.mjs');
});
