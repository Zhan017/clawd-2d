#!/usr/bin/env node
// Builds public/ for static hosting (Vercel): index.html plus every script it lists, nothing else
// (tests, docs and tools stay out of the deployed site). Zero dependencies; run with `npm run build:site`.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'public');

export function buildSite() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), html);
  for (const s of srcs) {
    mkdirSync(dirname(join(OUT, s)), { recursive: true });
    copyFileSync(join(ROOT, s), join(OUT, s));
  }
  return { files: srcs.length + 1, scripts: srcs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = buildSite();
  console.log(`public/: index.html + ${res.scripts.length} scripts`);
}
