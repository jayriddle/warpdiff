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
  assert(!fs.existsSync(output), 'Refusing to overwrite an existing stage directory');
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.mkdirSync(output);
  const hashes = {};
  for (const [file, bytes] of contents) {
    const target = path.join(output, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, bytes);
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
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
