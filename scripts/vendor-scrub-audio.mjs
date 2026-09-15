#!/usr/bin/env node
// Pin only the reusable scrub component; this does not update WarpCap's WarpDiff vendor.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const repository = value('--repo');
const lockPath = path.join(root, 'js/SCRUB_AUDIO_LOCK.json');
const files = [['shared/media/scrub-audio.js', 'js/scrub-audio-core.js'], ['audio/wsola-worklet.js', 'js/scrub-worklet.js']];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = target => readFileSync(path.join(root, target));
function assert(condition, message) { if (!condition) throw new Error(message); }
if (args.includes('--check')) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert(lock.source === 'https://github.com/jayriddle/warpcap' && /^[a-f0-9]{40}$/.test(lock.commit), 'Invalid scrub source identity');
  assert(lock.files.length === files.length, 'Incomplete scrub component inventory');
  for (const [source, target] of files) {
    const entry = lock.files.find(f => f.source === source && f.target === target);
    assert(entry && sha(read(target)) === entry.sha256, `Pinned scrub file changed: ${target}`);
    if (repository) assert(sha(readFileSync(path.join(repository, source))) === entry.sha256, `Canonical scrub component differs: ${source}`);
  }
  assert(read('index.html').toString().includes('src="js/scrub-audio-core.js"'), 'Shared scrub controller is not loaded');
  assert(read('sw.js').toString().includes("'js/scrub-worklet.js'"), 'Scrub worklet is missing from offline assets');
  console.log(`Shared scrub ${lock.version}: pinned files${repository ? ' and canonical source' : ''} match.`);
} else {
  assert(repository && existsSync(repository), 'Usage: --repo <WarpCap> (--ref <commit> | --worktree), or --check [--repo <WarpCap>]');
  const ref = value('--ref');
  assert(!!ref !== args.includes('--worktree'), 'Choose exactly one of --ref or --worktree');
  const git = values => execFileSync('git', values, {cwd:repository});
  const commit = git(['rev-parse', `${ref || 'HEAD'}^{commit}`]).toString().trim();
  // Read and validate the complete selection before touching either destination.
  const selection = files.map(([source, target]) => ({source, target,
    bytes:ref ? git(['show', `${commit}:${source}`]) : readFileSync(path.join(repository, source))}));
  const version = selection[0].bytes.toString().match(/version:'([^']+)'/)?.[1];
  assert(version && selection[1].bytes.toString().includes("registerProcessor('phase-vocoder-processor'"), 'Invalid scrub runtime');
  const lock = {schemaVersion:1, source:'https://github.com/jayriddle/warpcap', commit,
    version, workingTree:!ref, files:selection.map(({source,target,bytes}) => ({source,target,sha256:sha(bytes)}))};
  for (const {target,bytes} of selection) writeFileSync(path.join(root,target),bytes);
  writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n');
  console.log(`Pinned shared scrub ${version} from ${commit}${!ref ? ' with local edits' : ''}.`);
}
