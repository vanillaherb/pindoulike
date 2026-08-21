import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const buildDir = resolve(root, 'build/web-mobile');
const outputPath = resolve(buildDir, 'pindou-single.html');
const html = readFileSync(outputPath, 'utf8');
const inlinedShellFiles = new Set(['index.html', 'style.css', 'src/import-map.json', 'pindou-single.html']);

function toPosix(value) {
  return value.split(sep).join('/');
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const BASE91_ALPHABET = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index))
  .filter((character) => character !== "'" && character !== '\\' && character !== '<')
  .join('');

function decodeBase91(value) {
  const table = new Int16Array(128);
  table.fill(-1);
  for (let index = 0; index < BASE91_ALPHABET.length; index += 1) {
    table[BASE91_ALPHABET.charCodeAt(index)] = index;
  }

  const bytes = [];
  let accumulator = 0;
  let bitCount = 0;
  let pending = -1;
  for (const character of value) {
    const code = character.charCodeAt(0);
    const digit = code < table.length ? table[code] : -1;
    assert.ok(digit >= 0, 'packed payload must contain only the declared Base91 alphabet');
    if (pending < 0) {
      pending = digit;
      continue;
    }
    const pair = pending + digit * 91;
    pending = -1;
    accumulator |= pair << bitCount;
    bitCount += (pair & 8191) > 88 ? 13 : 14;
    while (bitCount >= 8) {
      bytes.push(accumulator & 255);
      accumulator >>>= 8;
      bitCount -= 8;
    }
  }
  if (pending >= 0) bytes.push((accumulator | pending << bitCount) & 255);
  return Buffer.from(bytes);
}

assert.match(html, /<meta name="pindou-single-file" content="gzip-v2-base91">/, 'single HTML must declare its embedded format');
assert.match(html, /new DecompressionStream\('gzip'\)/, 'single HTML must restore its gzip payload without a server');
assert.match(html, /function bytesFromBase91\(/, 'single HTML must restore its compact ASCII payload without a dependency');
assert.match(html, /XMLHttpRequest\.prototype\.open/, 'single HTML must virtualize Cocos XHR asset reads');
assert.match(html, /window\.fetch\s*=/, 'single HTML must virtualize fetch for WASM and SystemJS');
assert.match(html, /HTMLScriptElement/, 'single HTML must virtualize dynamically loaded scripts');
assert.match(html, /HTMLImageElement/, 'single HTML must virtualize image URLs');
assert.match(html, /"cc":"\.\/cocos-js\/cc\.js"/, 'inline import map must retain the original src/import-map.json base semantics');
assert.doesNotMatch(html, /<script[^>]+src=/i, 'single HTML must not depend on an external script tag');
assert.doesNotMatch(html, /<link[^>]+href=/i, 'single HTML must not depend on an external stylesheet');
assert.doesNotMatch(html, /recovered-site|拼豆（拼豆）/i, 'single HTML must not reference the retired comparison package');
assert.ok(statSync(outputPath).size < 3.5 * 1024 * 1024, 'packed single HTML should remain below 3.5 MiB');

const payloadMatch = html.match(/const EMBEDDED_FILES = (\{.*?\});\n  const EMBEDDED_PATHS/s);
assert.ok(payloadMatch, 'embedded payload manifest must be readable');
const manifest = JSON.parse(payloadMatch[1]);
const packedMatch = html.match(/const PACKED_PAYLOAD = '([^']*)';/);
assert.ok(packedMatch, 'packed payload must be readable');
const packedPayload = gunzipSync(decodeBase91(packedMatch[1]));

const sourceFiles = walk(buildDir)
  .map((absolute) => ({ absolute, path: toPosix(relative(buildDir, absolute)) }))
  .filter(({ path }) => !inlinedShellFiles.has(path))
  .sort((a, b) => a.path.localeCompare(b.path));

assert.equal(Object.keys(manifest).length, sourceFiles.length, 'single HTML must embed every non-shell Web Mobile build file exactly once');
assert.equal(
  packedPayload.length,
  sourceFiles.reduce((total, { absolute }) => total + statSync(absolute).size, 0),
  'unpacked payload must not contain untracked or missing bytes',
);
for (const { absolute, path } of sourceFiles) {
  const source = readFileSync(absolute);
  const entry = manifest[path];
  assert.ok(entry, `single HTML is missing ${path}`);
  const restored = packedPayload.subarray(entry.offset, entry.offset + entry.size);
  assert.equal(restored.length, source.length, `${path} restored length must match`);
  assert.equal(sha256(restored), sha256(source), `${path} restored bytes must match`);
}

console.log(`Single HTML package checks passed: ${sourceFiles.length} embedded files verified byte-for-byte.`);
