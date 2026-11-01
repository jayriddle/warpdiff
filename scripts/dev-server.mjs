#!/usr/bin/env node
// Loopback preview for local review and Playwright. GitHub Pages does not use this.
// It serves the public app files (the same set scripts/stage-pages.mjs already
// publishes) plus media under tests/fixtures. Repository internals stay unread.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pageFiles } from './stage-pages.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const publicFiles = new Set(pageFiles(root));
const fixtureExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.m4v', '.mov', '.webm',
  '.wav', '.mp3', '.flac', '.aac', '.m4a', '.ogg', '.opus',
]);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.flac', 'audio/flac'],
  ['.aac', 'audio/aac'],
  ['.m4a', 'audio/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.opus', 'audio/ogg'],
  ['.wasm', 'application/wasm'],
]);

function isServable(relative) {
  const parts = relative.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.startsWith('.'))) return false;
  if (publicFiles.has(relative)) return true;
  if (parts.length >= 3 && parts[0] === 'tests' && parts[1] === 'fixtures') {
    return fixtureExtensions.has(path.posix.extname(parts[parts.length - 1]).toLowerCase());
  }
  return false;
}

// Lexical decision only. Callers still have to resolve the real file inside the repo.
export function requestRelativePath(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0 || pathname.length > 2048) return { ok: false, status: 400 };
  if (pathname.includes('\\') || pathname.includes('\0')) return { ok: false, status: 400 };
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return { ok: false, status: 400 }; }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return { ok: false, status: 400 };
  const relative = path.posix.normalize(decoded.slice(1));
  if (relative === '.' || relative === '') return isServable('index.html') ? { ok: true, relative: 'index.html' } : { ok: false, status: 404 };
  if (relative.startsWith('/') || relative === '..' || relative.startsWith('../') || relative.endsWith('/')) return { ok: false, status: 404 };
  if (!isServable(relative)) return { ok: false, status: 404 };
  return { ok: true, relative };
}

export function isLoopbackHost(header) {
  if (typeof header !== 'string') return false;
  const value = header.trim().toLowerCase();
  if (value.length === 0 || value.length > 255) return false;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end < 0) return false;
    const rest = value.slice(end + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return false;
    return value.slice(1, end) === '::1';
  }
  const colon = value.lastIndexOf(':');
  const host = colon > 0 && /^\d{1,5}$/.test(value.slice(colon + 1)) ? value.slice(0, colon) : value;
  return host === '127.0.0.1' || host === 'localhost';
}

function text(res, status, body, extra) {
  if (res.headersSent || res.writableEnded) return;
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-WarpDiff-Dev-Server': 'loopback',
    ...extra,
  });
  res.end(payload);
}

function byteRange(size, header) {
  if (header == null) return null;
  if (typeof header !== 'string' || !/^bytes=\d*-\d*$/.test(header)) return { invalid: true };
  const [startText, endText] = header.slice('bytes='.length).split('-');
  if (startText === '' && endText === '') return { invalid: true };
  if (size === 0) return { unsatisfiable: true };
  let start;
  let end;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { unsatisfiable: true };
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Number(endText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
      return { unsatisfiable: true };
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function handle(req, res, rootReal) {
  if (!isLoopbackHost(req.headers.host)) {
    text(res, 403, 'Forbidden\n');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    text(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return;
  }
  if (!req.url || !req.url.startsWith('/')) {
    text(res, 400, 'Bad request\n');
    return;
  }
  let pathname;
  try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; }
  catch { text(res, 400, 'Bad request\n'); return; }
  const requested = requestRelativePath(pathname);
  if (!requested.ok) {
    text(res, requested.status, requested.status === 400 ? 'Bad request\n' : 'Not found\n');
    return;
  }
  const candidate = path.resolve(rootReal, requested.relative);
  if (candidate !== rootReal && !candidate.startsWith(rootReal + path.sep)) {
    text(res, 404, 'Not found\n');
    return;
  }
  let real;
  try { real = await realpath(candidate); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP') {
      text(res, 404, 'Not found\n');
      return;
    }
    throw error;
  }
  const realRelative = path.relative(rootReal, real).split(path.sep).join('/');
  if (requestRelativePath('/' + realRelative).relative !== realRelative) {
    text(res, 404, 'Not found\n');
    return;
  }
  let handle;
  try { handle = await open(real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ELOOP' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
      text(res, 404, 'Not found\n');
      return;
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      text(res, 404, 'Not found\n');
      return;
    }
    const range = byteRange(info.size, req.headers.range);
    if (range && range.unsatisfiable) {
      text(res, 416, 'Range not satisfiable\n', { 'Content-Range': `bytes */${info.size}` });
      return;
    }
    const start = range && !range.invalid ? range.start : 0;
    const end = range && !range.invalid ? range.end : info.size - 1;
    const status = range && !range.invalid ? 206 : 200;
    const length = info.size === 0 ? 0 : end - start + 1;
    const headers = {
      'Content-Type': types.get(path.posix.extname(realRelative).toLowerCase()) || 'application/octet-stream',
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-WarpDiff-Dev-Server': 'loopback',
    };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || length === 0) {
      res.end();
      return;
    }
    const stream = handle.createReadStream({ start, end });
    handle = null;
    stream.on('error', () => { if (!res.writableEnded) res.destroy(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } finally {
    if (handle) await handle.close();
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const fail = error => {
      server.off('listening', ready);
      reject(error);
    };
    const ready = () => {
      server.off('error', fail);
      resolve();
    };
    server.once('error', fail);
    server.once('listening', ready);
    server.listen({ port, host, ipv6Only: host === '::1' });
  });
}

export async function stopDevServer(servers) {
  await Promise.all((servers || []).map(server => new Promise(resolve => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  })));
}

export async function startDevServer({ port = 8080, hosts = ['127.0.0.1', '::1'] } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Object.assign(new Error('Dev server port must be from 0 to 65535.'), { code: 'ERR_INVALID_PORT' });
  }
  const rootReal = await realpath(root);
  const servers = [];
  try {
    for (const host of hosts) {
      if (host !== '127.0.0.1' && host !== '::1') {
        throw Object.assign(new Error('Dev server only binds loopback addresses.'), { code: 'ERR_INVALID_HOST' });
      }
      const server = http.createServer((req, res) => {
        handle(req, res, rootReal).catch(error => {
          console.error('Dev server request failed:', error && error.code ? error.code : 'error');
          text(res, 500, 'Request failed\n');
        });
      });
      server.on('clientError', (_error, socket) => {
        if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      });
      try {
        await listen(server, host, port);
      } catch (error) {
        server.close();
        if (host === '::1' && (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL')) continue;
        throw Object.assign(new Error(
          `Could not listen on ${host}:${port} (${error.code || 'error'}). The dev server does not switch ports.`
        ), { code: error.code });
      }
      const address = server.address();
      if (!address || typeof address === 'string' || (address.address !== '127.0.0.1' && address.address !== '::1') ||
          (port !== 0 && address.port !== port)) {
        server.close();
        throw new Error('Refusing a listener that is not the requested loopback port.');
      }
      servers.push(server);
    }
  } catch (error) {
    await stopDevServer(servers);
    throw error;
  }
  if (!servers.length) throw new Error('No loopback address was available.');
  return servers;
}

async function main() {
  const port = Number(process.env.WARPDIFF_DEV_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('WARPDIFF_DEV_PORT must be a TCP port from 1 to 65535.');
    process.exit(1);
  }
  try {
    const servers = await startDevServer({ port });
    for (const server of servers) {
      const address = server.address();
      const host = address.address.includes(':') ? `[${address.address}]` : address.address;
      console.log(`WarpDiff dev server listening on http://${host}:${address.port}/`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
