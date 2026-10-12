#!/usr/bin/env node
// Builds dist/clawd-vs-bugs.html for the claude.ai Artifact: <title> and <style> first, the body markup,
// then every <script src> from index.html inlined in order. The Artifact adds its own html/head/body.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(ROOT, 'dist', 'clawd-vs-bugs.html');

export function build() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const title = html.match(/<title>[\s\S]*?<\/title>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!title) throw new Error('index.html has no <title>');
  if (!bodyMatch) throw new Error('index.html has no <body>');
  const styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
  if (!styles) throw new Error('index.html has no <style>');
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
  if (!srcs.length) throw new Error('index.html lists no <script src>');
  const markup = bodyMatch[1].replace(/<script\s+src="[^"]+"\s*><\/script>\s*/g, '').trim();
  // One <script> per source file: a load-time throw in one file can't stop the others, and the sourceURL
  // makes stack traces (and the panic screen's src/ line) name the real file.
  const chunks = srcs.map((s) => {
    const code = readFileSync(join(ROOT, s), 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script>\n// ---- ${s} ----\n${code}\n//# sourceURL=${s}\n</script>`;
  });
  const out = `${title[0]}\n${styles}\n${markup}\n${chunks.join('\n')}\n`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  return { out, bytes: Buffer.byteLength(out), scripts: srcs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = build();
  console.log(`dist/clawd-vs-bugs.html: ${res.scripts.length} scripts inlined, ${(res.bytes / 1024).toFixed(1)} KB`);
}
