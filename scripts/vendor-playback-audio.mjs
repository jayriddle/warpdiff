#!/usr/bin/env node
// Experimental selected-stream playback; independent of the released scrub pin.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), value = key => args.includes(key) ? args[args.indexOf(key) + 1] : null;
const repo = value('--repo'), ref = value('--ref');
const files = [
  ['shared/media/playback-audio.js', 'js/playback-audio-core.js'],
  ['shared/media/signalsmith/worklet.js', 'js/signalsmith-worklet.js'],
  ['shared/media/signalsmith/LICENSE.txt', 'js/signalsmith-LICENSE.txt']
];
const lockFile = path.join(root, 'js/PLAYBACK_AUDIO_LOCK.json');
const sha = b => createHash('sha256').update(b).digest('hex');
if (args.includes('--check')) {
  const lock = JSON.parse(readFileSync(lockFile));
  if (lock.source !== 'https://github.com/jayriddle/warpcap' || !/^[a-f0-9]{40}$/.test(lock.commit) || lock.files.length !== files.length) throw Error('Invalid playback pin');
  for (const [source, target] of files) {
    const entry = lock.files.find(f => f.source === source && f.target === target);
    if (!entry || sha(readFileSync(path.join(root, target))) !== entry.sha256) throw Error('Playback pin differs: ' + target);
    if (repo && sha(readFileSync(path.join(repo, source))) !== entry.sha256) throw Error('Canonical playback differs: ' + source);
  }
  console.log('Playback component: pinned files match.');
} else {
  if (!repo || !!ref === args.includes('--worktree')) throw Error('Use --repo <WarpCap> and either --ref <commit> or --worktree');
  const git = argv => execFileSync('git', argv, {cwd:repo});
  const commit = git(['rev-parse', `${ref || 'HEAD'}^{commit}`]).toString().trim();
  const entries = files.map(([source, target]) => ({source, target,
    bytes:ref ? git(['show', `${commit}:${source}`]) : readFileSync(path.join(repo, source))}));
  const version = entries[0].bytes.toString().match(/version:'([^']+)'/)?.[1];
  if (!version || !entries[1].bytes.includes('signalsmith-stretch')) throw Error('Invalid playback component');
  for (const {target, bytes} of entries) writeFileSync(path.join(root, target), bytes);
  writeFileSync(lockFile, JSON.stringify({schemaVersion:1, source:'https://github.com/jayriddle/warpcap',
    commit, version, workingTree:!ref, files:entries.map(({source,target,bytes}) => ({source,target,sha256:sha(bytes)}))}, null, 2) + '\n');
  console.log('Playback component pinned from ' + commit + (ref ? '' : ' with local edits'));
}
