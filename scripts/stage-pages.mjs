import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function pageFiles(root) {
  const assets = vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + '\nASSETS', {
    URL, self: {registration: {scope: 'https://warpdiff.invalid/'}, addEventListener() {}},
  }, {timeout: 1000});
  const files = [...new Set([...assets.map(f => f === './' ? 'index.html' : f),
    'sw.js', 'WarpDiff_Logo_v1.png', 'js/signalsmith-LICENSE.txt'])].sort();
  for (const file of files) assert(
    /^(?:index\.html|sw\.js|version\.json|manifest\.json|favicon-32\.png|icon-(?:192|512)\.png|WarpDiff_Logo_v1\.png|js\/[\w.-]+\.js|js\/signalsmith-LICENSE\.txt)$/.test(file),
    'Unexpected public asset; review the deployment allowlist: ' + file);
  return files;
}

export function stagePages({root, output, sha}) {
  assert(/^[a-f0-9]{40}$/.test(sha), 'A complete Git revision is required');
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], {cwd: root}).toString().split('\0'));
  const contents = pageFiles(root).map(file => {
    assert(tracked.has(file), 'Public asset must be tracked: ' + file);
    assert(fs.lstatSync(path.join(root, file)).isFile(), 'Public assets must be regular files: ' + file);
    return [file, file === 'version.json' ? Buffer.from(JSON.stringify({sha}) + '\n') : fs.readFileSync(path.join(root, file))];
  });
  const bytes = new Map(contents);
  const releaseRoot = 'releases/' + sha + '/';
  const integrity = value => 'sha256-' + createHash('sha256').update(value).digest('base64');
  // Relative source URLs remain build-free locally. Published documents pin every
  // dependency, including worker imports and worklets, through their base URL.
  let html = bytes.get('index.html').toString();
  assert(!/<base\b/i.test(html), 'The app must have one deployment-owned base URL');
  html = html.replace('<head>', '<head>\n    <base href="./' + releaseRoot + '">\n    <meta name="warpdiff-release" content="' + sha + '">');
  const background = {};
  for (const file of ['js/audio-analysis-worker.js','js/scrub-worklet.js','js/signalsmith-worklet.js']) {
    assert(bytes.has(file), 'Background dependency missing: ' + file);
    let content = bytes.get(file);
    if (file === 'js/audio-analysis-worker.js') {
      const worker = content.toString();
      assert(worker.includes("importScripts('audio-viz.js');"), 'Analysis import marker missing');
      content = Buffer.from(worker.replace("importScripts('audio-viz.js');",
        "importScripts('data:text/javascript;base64," + bytes.get('js/audio-viz.js').toString('base64') + "');"));
    }
    background[file] = content.toString('base64');
  }
  html = html.replace('<title>WarpDiff</title>', '<title>WarpDiff</title>\n    <script id="warpdiff-background-scripts" type="application/json">' + JSON.stringify(background) + '</script>');
  html = html.replace(/<script src="(js\/[^"/]+\.js)"[^>]*><\/script>/g, (_, file) => {
    assert(bytes.has(file), 'Script missing from public assets: ' + file);
    return '<script src="' + file + '" integrity="' + integrity(bytes.get(file)) + '"></script>';
  });
  const failures = `<script>
        window._warpdiffScriptFailed = false;
        window.addEventListener('error', event => {
            if (event.target instanceof HTMLScriptElement && event.target.src &&
                !event.target.src.endsWith('/js/usage.js')) {
                window._warpdiffScriptFailed = true;
                if (typeof window._warpdiffUpdateFailure === 'function') window._warpdiffUpdateFailure();
            }
        }, true);
    </script>`;
  html = html.replace('<title>WarpDiff</title>', '<title>WarpDiff</title>\n    ' + failures);
  const guard = `function _warpdiffUpdateFailure() {
            if (document.getElementById('appUpdateFailure')) return;
            const notice = document.createElement('div');
            notice.id = 'appUpdateFailure'; notice.setAttribute('role', 'alert');
            notice.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#181818;color:white;padding:40px;font:18px sans-serif';
            notice.textContent = 'WarpDiff could not load this update completely. Reload when online to try again. Your local files have not been changed. ';
            const retry = document.createElement('button'); retry.textContent = 'Reload';
            retry.addEventListener('click', async () => {
                retry.disabled = true;
                try {
                    // The failed document's release directory may have disappeared.
                    // Refresh the stable document first, then its own required scripts.
                    const documentUrl = new URL(location.href);
                    // A query also bypasses predecessor workers' exact stable-URL caches.
                    documentUrl.searchParams.set('_warpdiffReload', '1');
                    const response = await fetch(documentUrl, {cache:'reload'});
                    if (!response.ok) throw Error('App document unavailable');
                    const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
                    const base = new URL(fresh.querySelector('base[href]')?.getAttribute('href') || './', response.url);
                    const scripts = [...fresh.scripts].filter(script => script.hasAttribute('src')).map(script => ({
                        url:new URL(script.getAttribute('src'), base), integrity:script.integrity
                    })).filter(script => !script.url.pathname.endsWith('/js/usage.js'));
                    if (!scripts.length) throw Error('App scripts unavailable');
                    await Promise.all(scripts.map(script =>
                        fetch(script.url, {cache:'reload', integrity:script.integrity}).then(result => {if (!result.ok) throw Error('Unavailable');})));
                    location.reload();
                } catch {retry.disabled = false; retry.textContent = 'Try again when online';}
            }); notice.append(retry); document.body.append(notice);
        }
        if (window._warpdiffScriptFailed) {
            _warpdiffUpdateFailure();
            throw Error('WarpDiff update incomplete');
        }
        `;
  assert(html.includes('const APP_VERSION = '), 'App startup marker missing');
  html = html.replace('const APP_VERSION = ', guard + 'const APP_VERSION = ');
  bytes.set('index.html', Buffer.from(html));
  for (const [file, value] of [...bytes]) {
    if (file === 'index.html' || file === 'sw.js') continue;
    let pinned = value;
    if (file === 'manifest.json') pinned = Buffer.from(JSON.stringify({
      // Without an explicit id, browsers preserve the released start-URL identity.
      // Unlike start_url/scope, a manifest id resolves against the origin root.
      ...JSON.parse(value), start_url:'../../', scope:'../../'
    }) + '\n');
    bytes.set(releaseRoot + file, pinned);
  }
  const release = {sha, files:Object.fromEntries([...bytes].filter(([file]) =>
    file === 'index.html' || file.startsWith(releaseRoot)).map(([file, value]) => [file, integrity(value)]))};
  const worker = bytes.get('sw.js').toString();
  assert(worker.includes('const RELEASE = null;'), 'Service worker release marker missing');
  bytes.set('sw.js', Buffer.from(worker.replace('const RELEASE = null;', 'const RELEASE = ' + JSON.stringify(release) + ';')));
  assert(!fs.existsSync(output), 'Refusing to overwrite an existing stage directory');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.mkdirSync(output);
  const hashes = {};
  for (const [file, value] of bytes) {
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, value);
    hashes[file] = createHash('sha256').update(value).digest('hex');
  }
  return {sha, files: hashes};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root}).toString().trim();
  if (process.env.GITHUB_SHA) assert.equal(process.env.GITHUB_SHA, sha, 'Stage the checked-out workflow revision');
  const manifest = stagePages({root, output: path.join(root, 'output/pages'), sha});
  fs.writeFileSync(path.join(root, 'output/pages-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Staged ' + Object.keys(manifest.files).length + ' public files for ' + sha);
}
