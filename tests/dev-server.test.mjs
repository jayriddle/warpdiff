import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pageFiles} from '../scripts/stage-pages.mjs';
import {isLoopbackHost, requestRelativePath, startDevServer, stopDevServer} from '../scripts/dev-server.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const launcher = path.join(root, 'start.sh');

function request(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    req.end();
  });
}

function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port}, () => socket.end(text));
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    socket.on('error', reject);
  });
}

async function listen(server, host, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({port, host, ipv6Only: host === '::1'}, resolve);
  });
}

test('preview paths allow the public app and fixture media only', () => {
  for (const file of pageFiles(root)) assert.equal(requestRelativePath('/' + file).relative, file, file);
  assert.equal(requestRelativePath('/').relative, 'index.html');
  assert.equal(requestRelativePath('/tests/fixtures/green.png').relative, 'tests/fixtures/green.png');
  assert.equal(requestRelativePath('/tests/fixtures/landscape_a.mp4').relative, 'tests/fixtures/landscape_a.mp4');
  for (const blocked of [
    '/AGENTS.md', '/CLAUDE.md', '/package.json', '/package-lock.json', '/.git/config',
    '/.github/workflows/checks.yml', '/node_modules/serve/package.json', '/docs/release-safeguards.md',
    '/scripts/stage-pages.mjs', '/tools/media-prepare/prepare.mjs', '/tests/ownership.test.mjs',
    '/tests/fixtures/generate.sh', '/tests/fixtures/readme.txt', '/tests/fixtures/ffmpeg-command-filenames.json',
    '/tests/fixtures/.hidden.png', '/js/../package.json', '/tests/fixtures/../../package.json',
    '/%2e%2e/package.json', '/%2e%67it/config', '/tests/fixtures/%2e%2e/%2e%2e/AGENTS.md',
  ]) {
    const decision = requestRelativePath(blocked);
    assert.equal(decision.ok, false, blocked);
    assert.equal(decision.relative, undefined, blocked);
  }
  assert.equal(requestRelativePath('/%00index.html').status, 400);
  assert.equal(isLoopbackHost('localhost:8080'), true);
  assert.equal(isLoopbackHost('127.0.0.1:8080'), true);
  assert.equal(isLoopbackHost('[::1]:8080'), true);
  assert.equal(isLoopbackHost('evil.example'), false);
  assert.equal(isLoopbackHost('127.0.0.1.evil.example'), false);
  assert.equal(isLoopbackHost('localhost.evil.example'), false);
});

test('loopback server serves fixtures and refuses repository internals', async () => {
  const servers = await startDevServer({port: 0, hosts: ['127.0.0.1']});
  try {
    const address = servers[0].address();
    assert.equal(address.address, '127.0.0.1');
    assert.notEqual(address.address, '0.0.0.0');
    const port = address.port;
    const home = await request({hostname: '127.0.0.1', port, path: '/'});
    assert.equal(home.status, 200);
    assert.equal(home.headers['x-warpdiff-dev-server'], 'loopback');
    assert.match(home.headers['content-type'], /^text\/html/);
    assert.match(home.body.toString('utf8'), /<title>WarpDiff<\/title>/);

    const head = await request({hostname: '127.0.0.1', port, method: 'HEAD', path: '/index.html'});
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers['content-length']), fs.statSync(path.join(root, 'index.html')).size);

    const image = fs.readFileSync(path.join(root, 'tests/fixtures/green.png'));
    const fixture = await request({hostname: '127.0.0.1', port, path: '/tests/fixtures/green.png'});
    assert.equal(fixture.status, 200);
    assert.equal(fixture.headers['content-type'], 'image/png');
    assert.deepEqual(fixture.body, image);
    const partial = await request({hostname: '127.0.0.1', port, path: '/tests/fixtures/green.png', headers: {Range: 'bytes=0-7'}});
    assert.equal(partial.status, 206);
    assert.equal(partial.headers['content-range'], `bytes 0-7/${image.length}`);
    assert.deepEqual(partial.body, image.subarray(0, 8));

    for (const file of pageFiles(root)) {
      const response = await request({hostname: '127.0.0.1', port, path: '/' + file});
      assert.equal(response.status, 200, file);
      assert.equal(response.headers['x-warpdiff-dev-server'], 'loopback', file);
    }

    for (const blocked of [
      '/AGENTS.md', '/CLAUDE.md', '/package.json', '/package-lock.json', '/.git/config',
      '/node_modules/serve/index.js', '/docs/release-safeguards.md', '/scripts/dev-server.mjs',
      '/tests/dev-server.test.mjs', '/tests/fixtures/generate.sh', '/playwright.config.ts', '/start.sh',
    ]) {
      const response = await request({hostname: '127.0.0.1', port, path: blocked});
      assert.equal(response.status, 404, blocked);
      assert.equal(response.body.toString('utf8'), 'Not found\n', blocked);
    }
    const traversal = await rawRequest(port, 'GET /tests/fixtures/../../package.json HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    assert.match(traversal, /^HTTP\/1\.1 404/);
    assert.equal(traversal.includes('devDependencies'), false);
    const encoded = await rawRequest(port, 'GET /%2e%67it/config HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    assert.match(encoded, /^HTTP\/1\.1 404/);
    assert.equal(encoded.includes('[core]'), false);

    const posted = await request({hostname: '127.0.0.1', port, method: 'POST', path: '/'});
    assert.equal(posted.status, 405);
    const foreign = await request({hostname: '127.0.0.1', port, path: '/', headers: {Host: 'evil.example'}});
    assert.equal(foreign.status, 403);
    const listing = await request({hostname: '127.0.0.1', port, path: '/js/'});
    assert.equal(listing.status, 404);
    assert.equal(listing.body.toString('utf8').includes('audio-viz.js'), false);
    const escape = path.join(root, 'tests/fixtures/dev-server-escape.png');
    fs.symlinkSync(path.join(root, 'package.json'), escape);
    try {
      const linked = await request({hostname: '127.0.0.1', port, path: '/tests/fixtures/dev-server-escape.png'});
      assert.equal(linked.status, 404);
      assert.equal(linked.body.toString('utf8').includes('devDependencies'), false);
    } finally {
      fs.unlinkSync(escape);
    }

    const external = Object.values(os.networkInterfaces()).flat().find(info => info && info.family === 'IPv4' && !info.internal);
    if (external) {
      await new Promise((resolve, reject) => {
        const socket = net.connect({host: external.address, port, timeout: 400});
        const finish = () => { socket.destroy(); resolve(); };
        socket.on('connect', () => { socket.destroy(); reject(new Error('accepted ' + external.address)); });
        socket.on('timeout', finish);
        socket.on('error', finish);
      });
    }
  } finally {
    await stopDevServer(servers);
  }
});

test('a taken port is a hard failure and both loopback stacks share it', async () => {
  const probe = http.createServer();
  await listen(probe, '127.0.0.1', 0);
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const servers = await startDevServer({port, hosts: ['127.0.0.1', '::1']});
  try {
    assert.deepEqual(servers.map(server => server.address().address).sort(), ['127.0.0.1', '::1']);
    assert.equal(new Set(servers.map(server => server.address().port)).size, 1);
    const v4 = await request({hostname: '127.0.0.1', port, path: '/'});
    const v6 = await request({hostname: '::1', port, path: '/'});
    assert.equal(v4.status, 200);
    assert.equal(v6.status, 200);
    await assert.rejects(startDevServer({port, hosts: ['127.0.0.1']}), error =>
      error.code === 'EADDRINUSE' && /does not switch ports/.test(error.message));
  } finally {
    await stopDevServer(servers);
  }

  const v6Only = http.createServer();
  await listen(v6Only, '::1', port);
  try {
    await assert.rejects(startDevServer({port, hosts: ['127.0.0.1', '::1']}), error => error.code === 'EADDRINUSE');
    const rollback = http.createServer();
    await listen(rollback, '127.0.0.1', port);
    await new Promise(resolve => rollback.close(resolve));
  } finally {
    await new Promise(resolve => v6Only.close(resolve));
  }
});

function command(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-dev-server-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
  return {dir, file};
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode) return;
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

test('launcher opens only after the expected port is serving and never switches ports', async () => {
  const openLog = path.join(os.tmpdir(), `warpdiff-open-${process.pid}-${Date.now()}`);
  const bin = command('open', `#!/bin/bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(openLog)}\n`);
  const uname = command('uname', '#!/bin/bash\nif [[ "$1" == "-s" ]]; then echo Darwin; else exec /usr/bin/uname "$@"; fi\n');
  const env = {...process.env, PATH: `${bin.dir}:${uname.dir}:${process.env.PATH}`, WARPDIFF_DEV_OPEN: '1'};
  const busy = http.createServer((req, res) => { res.writeHead(200); res.end('other'); });
  await listen(busy, '127.0.0.1', 0);
  const busyPort = busy.address().port;
  const blocked = spawn('bash', [launcher], {cwd: root, env: {...env, WARPDIFF_DEV_PORT: String(busyPort)}, stdio: ['ignore', 'pipe', 'pipe']});
  let blockedErr = '';
  blocked.stderr.on('data', chunk => { blockedErr += chunk; });
  try {
    const code = await new Promise(resolve => blocked.once('exit', resolve));
    assert.notEqual(code, 0);
    assert.match(blockedErr, /browser was not opened/);
    assert.equal(fs.existsSync(openLog), false);
  } finally {
    await stopChild(blocked);
    await new Promise(resolve => busy.close(resolve));
  }

  const invalid = spawn('bash', [launcher], {cwd: root, env: {...env, WARPDIFF_DEV_PORT: '99999'}, stdio: ['ignore', 'pipe', 'pipe']});
  let invalidErr = '';
  invalid.stderr.on('data', chunk => { invalidErr += chunk; });
  const invalidCode = await new Promise(resolve => invalid.once('exit', resolve));
  assert.notEqual(invalidCode, 0);
  assert.match(invalidErr, /browser was not opened/);
  assert.equal(fs.existsSync(openLog), false);

  const probe = http.createServer();
  await listen(probe, '127.0.0.1', 0);
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn('bash', [launcher], {cwd: root, env: {...env, WARPDIFF_DEV_PORT: String(port)}, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const opened = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output || 'browser was not opened')), 8000);
      const poll = setInterval(() => {
        if (!fs.existsSync(openLog)) return;
        clearInterval(poll);
        clearTimeout(timer);
        resolve(fs.readFileSync(openLog, 'utf8').trim());
      }, 50);
      child.once('exit', () => {
        clearInterval(poll);
        clearTimeout(timer);
        reject(new Error('launcher exited early: ' + output));
      });
    });
    assert.equal(opened, `http://127.0.0.1:${port}/`);
    const response = await request({hostname: '127.0.0.1', port, path: '/package.json'});
    assert.equal(response.status, 404);
    const page = await request({hostname: 'localhost', port, path: '/'});
    const v6 = await request({hostname: '::1', port, path: '/'});
    assert.equal(page.status, 200);
    assert.equal(v6.status, 200);
    assert.equal(page.headers['x-warpdiff-dev-server'], 'loopback');
  } finally {
    await stopChild(child);
    fs.rmSync(bin.dir, {recursive: true, force: true});
    fs.rmSync(uname.dir, {recursive: true, force: true});
    fs.rmSync(openLog, {force: true});
  }
  let closed = false;
  for (let attempt = 0; attempt < 20 && !closed; attempt++) {
    try { await request({hostname: '127.0.0.1', port, path: '/'}); }
    catch { closed = true; }
    if (!closed) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(closed, true);
});
