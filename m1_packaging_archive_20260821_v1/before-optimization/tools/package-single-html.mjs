import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const buildDir = resolve(root, 'build/web-mobile');
const outputPath = resolve(root, process.argv[2] || 'build/web-mobile/pindou-single.html');

const requiredFiles = [
  'application.js',
  'index.js',
  'src/polyfills.bundle.js',
  'src/system.bundle.js',
  'src/import-map.json',
  'src/settings.json',
  'cocos-js/cc.js',
];

const inlinedShellFiles = new Set([
  'index.html',
  'style.css',
  'src/import-map.json',
]);

const mimeByExtension = new Map([
  ['.bin', 'application/octet-stream'],
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
  ['.png', 'image/png'],
  ['.wasm', 'application/wasm'],
  ['.wav', 'audio/wav'],
  ['.webp', 'image/webp'],
]);

function toPosix(value) {
  return value.split(sep).join('/');
}

function extensionOf(file) {
  const match = /(?:\.[^./]+)$/.exec(file);
  return match ? match[0].toLowerCase() : '';
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

function escapeInlineStyle(value) {
  return value.replace(/<\/style/gi, '<\\/style');
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// Base91 keeps the embedded payload ASCII-only while adding less overhead than
// Base64. The alphabet intentionally excludes apostrophe, backslash, and '<'
// so the generated single-quoted JavaScript literal cannot break or close the
// surrounding HTML script element.
const BASE91_ALPHABET = Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index))
  .filter((character) => character !== "'" && character !== '\\' && character !== '<')
  .join('');

if (BASE91_ALPHABET.length !== 91) {
  throw new Error('Internal Base91 alphabet must contain exactly 91 characters.');
}

function encodeBase91(bytes) {
  let accumulator = 0;
  let bitCount = 0;
  let output = '';

  for (const byte of bytes) {
    accumulator |= byte << bitCount;
    bitCount += 8;
    if (bitCount > 13) {
      const value = accumulator & 8191;
      const width = value > 88 ? 13 : 14;
      const pair = width === 13 ? value : accumulator & 16383;
      accumulator >>>= width;
      bitCount -= width;
      output += BASE91_ALPHABET[pair % 91] + BASE91_ALPHABET[Math.floor(pair / 91)];
    }
  }

  if (bitCount > 0) {
    output += BASE91_ALPHABET[accumulator % 91];
    if (bitCount > 7 || accumulator > 90) {
      output += BASE91_ALPHABET[Math.floor(accumulator / 91)];
    }
  }
  return output;
}

for (const file of requiredFiles) {
  const absolute = resolve(buildDir, file);
  if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing required Web Mobile build file: ${file}`);
  }
}

const outputRelativeToBuild = toPosix(relative(buildDir, outputPath));
const sourceFiles = walk(buildDir)
  .map((absolute) => ({ absolute, path: toPosix(relative(buildDir, absolute)) }))
  .filter(({ path }) => !inlinedShellFiles.has(path))
  .filter(({ path }) => path !== 'pindou-single.html')
  .filter(({ path }) => path !== outputRelativeToBuild)
  .sort((a, b) => a.path.localeCompare(b.path));

const embeddedFiles = Object.create(null);
let rawBytes = 0;
const rawParts = [];

for (const { absolute, path } of sourceFiles) {
  const source = readFileSync(absolute);
  const mime = mimeByExtension.get(extensionOf(path)) || 'application/octet-stream';
  embeddedFiles[path] = { mime, offset: rawBytes, size: source.length };
  rawParts.push(source);
  rawBytes += source.length;
}

const compressedPayload = gzipSync(Buffer.concat(rawParts), { level: 9, mtime: 0 });
const compressedBytes = compressedPayload.length;
const encodedPayload = encodeBase91(compressedPayload);

const importMap = JSON.parse(readFileSync(resolve(buildDir, 'src/import-map.json'), 'utf8'));
for (const [specifier, target] of Object.entries(importMap.imports || {})) {
  const rebased = new URL(target, 'https://single-file.invalid/src/import-map.json');
  importMap.imports[specifier] = `.${rebased.pathname}`;
}

const gameCss = escapeInlineStyle(readFileSync(resolve(buildDir, 'style.css'), 'utf8'));
const entriesJson = escapeJsonForScript(embeddedFiles);
const importMapJson = escapeJsonForScript(importMap);

const loader = String.raw`
(() => {
  'use strict';

  const EMBEDDED_FILES = ${entriesJson};
  const EMBEDDED_PATHS = Object.keys(EMBEDDED_FILES);
  const EMBEDDED_URLS = new Map();
  const PACKED_PAYLOAD = '${encodedPayload}';
  const PAGE_ROOT = new URL('.', location.href);
  const boot = document.getElementById('SingleFileBoot');
  const progress = document.getElementById('SingleFileProgress');

  window.__PINDOU_SINGLE_FILE__ = {
    version: 2,
    fileCount: EMBEDDED_PATHS.length,
    rawBytes: ${rawBytes},
    compressedBytes: ${compressedBytes},
    hydrated: false,
    ready: false,
    error: null,
  };

  function bytesFromBase91(value, expectedLength) {
    const table = new Int16Array(128);
    table.fill(-1);
    for (let index = 0; index < ${BASE91_ALPHABET.length}; index += 1) {
      table['${BASE91_ALPHABET}'.charCodeAt(index)] = index;
    }

    const bytes = new Uint8Array(expectedLength);
    let offset = 0;
    let accumulator = 0;
    let bitCount = 0;
    let pending = -1;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      const digit = code < table.length ? table[code] : -1;
      if (digit < 0) throw new Error('Invalid Base91 payload.');
      if (pending < 0) {
        pending = digit;
        continue;
      }
      const pair = pending + digit * 91;
      pending = -1;
      accumulator |= pair << bitCount;
      bitCount += (pair & 8191) > 88 ? 13 : 14;
      while (bitCount >= 8) {
        if (offset >= bytes.length) throw new Error('Base91 payload is longer than expected.');
        bytes[offset++] = accumulator & 255;
        accumulator >>>= 8;
        bitCount -= 8;
      }
    }
    if (pending >= 0) {
      if (offset >= bytes.length) throw new Error('Base91 payload is longer than expected.');
      bytes[offset++] = (accumulator | pending << bitCount) & 255;
    }
    if (offset !== bytes.length) throw new Error('Base91 payload length mismatch.');
    return bytes;
  }

  async function gunzip(value) {
    const stream = new Blob([value])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function normalizePath(value) {
    const parts = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  function embeddedKey(request) {
    if (request == null) return null;
    const raw = typeof Request !== 'undefined' && request instanceof Request
      ? request.url
      : String(request);
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return null;

    let url;
    try {
      url = new URL(raw, PAGE_ROOT);
    } catch {
      return null;
    }

    let pathname;
    let rootPath;
    try {
      pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/');
      rootPath = decodeURIComponent(PAGE_ROOT.pathname).replace(/\\/g, '/');
    } catch {
      pathname = url.pathname.replace(/\\/g, '/');
      rootPath = PAGE_ROOT.pathname.replace(/\\/g, '/');
    }

    if (pathname.startsWith(rootPath)) {
      const direct = normalizePath(pathname.slice(rootPath.length));
      if (Object.prototype.hasOwnProperty.call(EMBEDDED_FILES, direct)) return direct;
    }

    const normalized = normalizePath(pathname);
    for (const path of EMBEDDED_PATHS) {
      if (normalized === path || normalized.endsWith('/' + path)) return path;
    }
    return null;
  }

  function embeddedUrl(request) {
    const key = embeddedKey(request);
    return key ? EMBEDDED_URLS.get(key) : null;
  }

  async function hydrateFiles() {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This single-file build requires a current Chrome, Edge, Firefox, or Safari browser.');
    }

    const compressed = bytesFromBase91(PACKED_PAYLOAD, ${compressedBytes});
    const payload = await gunzip(compressed);
    if (payload.byteLength !== ${rawBytes}) {
      throw new Error('Embedded payload size mismatch.');
    }
    for (let index = 0; index < EMBEDDED_PATHS.length; index += 1) {
      const path = EMBEDDED_PATHS[index];
      const entry = EMBEDDED_FILES[path];
      const bytes = payload.subarray(entry.offset, entry.offset + entry.size);
      if (bytes.byteLength !== entry.size) {
        throw new Error('Embedded file size mismatch: ' + path);
      }
      EMBEDDED_URLS.set(path, URL.createObjectURL(new Blob([bytes], { type: entry.mime })));
      if (progress) progress.style.transform = 'scaleX(' + ((index + 1) / EMBEDDED_PATHS.length) + ')';
    }
    window.__PINDOU_SINGLE_FILE__.hydrated = true;
  }

  function installVirtualFiles() {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const mapped = embeddedUrl(input);
      return nativeFetch(mapped || input, mapped && init ? { ...init, integrity: undefined } : init);
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      return nativeOpen.call(this, method, embeddedUrl(url) || url, ...rest);
    };

    function patchUrlProperty(prototype, property) {
      if (!prototype) return;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (!descriptor?.get || !descriptor?.set) return;
      Object.defineProperty(prototype, property, {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set(value) {
          descriptor.set.call(this, embeddedUrl(value) || value);
        },
      });
    }

    patchUrlProperty(window.HTMLScriptElement?.prototype, 'src');
    patchUrlProperty(window.HTMLImageElement?.prototype, 'src');
    patchUrlProperty(window.HTMLMediaElement?.prototype, 'src');
    patchUrlProperty(window.HTMLSourceElement?.prototype, 'src');

    const nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
      const isEmbeddedSource = String(name).toLowerCase() === 'src';
      return nativeSetAttribute.call(this, name, isEmbeddedSource ? (embeddedUrl(value) || value) : value);
    };
  }

  function loadClassicScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = EMBEDDED_URLS.get(path);
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => reject(new Error('Unable to start embedded script: ' + path));
      document.head.appendChild(script);
    });
  }

  function showFatal(error) {
    console.error('[Pindou single file]', error);
    window.__PINDOU_SINGLE_FILE__.error = String(error?.stack || error);
    if (!boot) return;
    boot.classList.add('is-error');
    boot.innerHTML = '<strong>游戏启动失败</strong><span>请使用最新版 Chrome、Edge、Firefox 或 Safari 重新打开此文件。</span>';
  }

  async function start() {
    await hydrateFiles();
    installVirtualFiles();
    await loadClassicScript('src/polyfills.bundle.js');
    await loadClassicScript('src/system.bundle.js');

    const importMap = document.createElement('script');
    importMap.type = 'systemjs-importmap';
    importMap.textContent = JSON.stringify(${importMapJson});
    document.head.appendChild(importMap);

    if (boot) boot.remove();
    await System.import('./index.js');
    window.__PINDOU_SINGLE_FILE__.ready = true;
  }

  start().catch(showFatal);
})();`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>拼豆</title>
  <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,viewport-fit=cover,minimal-ui=true">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="format-detection" content="telephone=no">
  <meta name="screen-orientation" content="portrait">
  <meta name="renderer" content="webkit">
  <meta name="force-rendering" content="webkit">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="msapplication-tap-highlight" content="no">
  <meta name="full-screen" content="yes">
  <meta name="x5-fullscreen" content="true">
  <meta name="360-fullscreen" content="true">
  <meta name="x5-page-mode" content="app">
  <meta name="pindou-single-file" content="gzip-v2-base91">
  <meta name="pindou-embedded-file-count" content="${sourceFiles.length}">
  <style>
${gameCss}
#SingleFileBoot {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-content: center;
  gap: 14px;
  color: #5b4269;
  background: #e7ddec;
  font-size: 15px;
}
#SingleFileBoot::before {
  content: '';
  width: 52px;
  height: 52px;
  justify-self: center;
  border: 5px solid rgba(91, 66, 105, 0.18);
  border-top-color: #5b4269;
  border-radius: 50%;
  animation: single-file-spin 0.8s linear infinite;
}
#SingleFileBoot.is-error::before { display: none; }
#SingleFileBoot span { max-width: 280px; line-height: 1.6; }
#SingleFileTrack {
  width: 150px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(91, 66, 105, 0.14);
}
#SingleFileProgress {
  width: 100%;
  height: 100%;
  transform: scaleX(0);
  transform-origin: left center;
  background: #5b4269;
}
@keyframes single-file-spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main id="GameStage">
    <div id="GameDiv">
      <div id="Cocos3dGameContainer">
        <canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="99"></canvas>
      </div>
    </div>
  </main>
  <div id="SingleFileBoot" role="status" aria-label="正在加载游戏">
    <div id="SingleFileTrack"><div id="SingleFileProgress"></div></div>
  </div>
  <script>${loader.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;

writeFileSync(outputPath, html);

const ratio = rawBytes === 0 ? 0 : (compressedBytes / rawBytes) * 100;
console.log(`Single HTML created: ${outputPath}`);
console.log(`Embedded files: ${sourceFiles.length}`);
console.log(`Payload: ${(rawBytes / 1024 / 1024).toFixed(2)} MiB -> ${(compressedBytes / 1024 / 1024).toFixed(2)} MiB (${ratio.toFixed(1)}%)`);
console.log(`HTML size: ${(statSync(outputPath).size / 1024 / 1024).toFixed(2)} MiB`);
