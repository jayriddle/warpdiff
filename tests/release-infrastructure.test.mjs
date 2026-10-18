import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {inventory, verifyReports} from '../scripts/verify-test-reports.mjs';
import {pageFiles, stagePages} from '../scripts/stage-pages.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = parse(fs.readFileSync(path.join(root, '.github/workflows/checks.yml'), 'utf8'));
const copy = value => structuredClone(value);
const spec = title => ({file: 'sample.spec.ts', title, tests: [{projectName: 'chromium',
  expectedStatus: 'passed', status: 'expected', annotations: [],
  results: [{status: 'passed', retry: 0, errors: []}]}]});
const report = specs => ({errors: [], config: {workers: 1}, suites: [{title: 'sample.spec.ts', specs}]});

test('pushes run only on main; PRs and explicit dispatch retain complete checks', () => {
  assert.deepEqual(workflow.on, {push: {branches: ['main']}, pull_request: {branches: ['main']}, workflow_dispatch: null});
  assert.deepEqual(workflow.permissions, {contents: 'read'});
  assert(workflow.concurrency.group.includes('github.event_name'), 'Manual checks must not cancel a main-push release');
  assert.equal(workflow.jobs.chromium.name, 'Chromium and ownership');
  assert.equal(workflow.jobs.webkit.name, 'WebKit preparation workflow');
  assert.deepEqual(workflow.jobs['chromium-shards'].strategy, {'fail-fast': false, matrix: {shard: [1, 2, 3]}});
  assert.deepEqual(workflow.jobs.chromium.needs, ['ownership', 'chromium-shards']);
  assert.equal(workflow.jobs.chromium.if, '${{ always() }}');
  const commands = workflow.jobs.ownership.steps.map(s => s.run);
  assert(commands.indexOf('npm run test:fixtures') < commands.indexOf('npm run test:ownership'));
  assert(commands.includes('npm run test:fixtures'), 'Ownership demux checks require actual media fixtures');
  const gate = workflow.jobs.chromium.steps[0];
  for (const ownership of ['success', 'failure', 'cancelled', 'skipped']) {
    for (const chromium of ['success', 'failure', 'cancelled', 'skipped']) {
      const run = execFileSync;
      try {
        run('bash', ['-c', gate.run], {env: {...process.env, OWNERSHIP_RESULT: ownership, CHROMIUM_RESULT: chromium}, stdio: 'pipe'});
        assert(ownership === 'success' && chromium === 'success');
      } catch (error) {
        if (ownership === 'success' && chromium === 'success') throw error;
        assert.equal(error.status, 1);
      }
    }
  }
});

test('publication requires successful checks and staging on a main push only', () => {
  const deploy = workflow.jobs.deploy;
  assert.deepEqual(deploy.needs, ['chromium', 'webkit', 'pages-artifact']);
  assert.deepEqual(deploy.permissions, {pages: 'write', 'id-token': 'write'});
  assert.equal(deploy.environment.name, 'github-pages');
  const expression = deploy.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  for (const event_name of ['push', 'pull_request', 'workflow_dispatch']) {
    for (const ref of ['refs/heads/main', 'refs/heads/codex/test', 'refs/pull/46/merge']) {
      for (const failed of [null, ...deploy.needs]) {
        const eligible = vm.runInNewContext(expression, {github: {event_name, ref}, success: () => failed === null});
        assert.equal(eligible, failed === null && event_name === 'push' && ref === 'refs/heads/main');
      }
    }
  }
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (id !== 'deploy') assert.equal(job.permissions, undefined, 'Test/staging jobs may not gain deployment permission');
    for (const step of job.steps || []) if (step.uses) {
      assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, 'Actions must be pinned');
      if (step.uses.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
    }
  }
});

test('real external-preparation checks are part of the protected ownership job', () => {
  const commands=workflow.jobs.ownership.steps.map(step=>step.run);
  assert(commands.includes('npm run test:preparation'));
  assert(commands.indexOf('npm run test:preparation')>commands.indexOf('npm run test:fixtures'));
  const metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(metadata.scripts['test:preparation'],'node --test --test-concurrency=1 tests/media-prepare.test.mjs tests/local-companion.test.mjs');
  assert(!pageFiles(root).some(file=>file.startsWith('tools/')||file.includes('ffmpeg')));
});

test('report gate accepts a complete disjoint inventory', () => {
  assert.deepEqual(verifyReports(report([spec('one'), spec('two')]), [report([spec('one')]), report([spec('two')])]),
    {total: 2, passed: 2, skipped: 0, reports: 2});
});

for (const [name, mutate] of [
  ['missing test', r => { r.suites[0].specs.pop(); }],
  ['extra test', r => { r.suites[0].specs.push(spec('extra')); }],
  ['duplicate test', r => { r.suites[0].specs.push(copy(r.suites[0].specs[0])); }],
  ['runner error', r => { r.errors.push({message: 'failed setup'}); }],
  ['missing result', r => { r.suites[0].specs[0].tests[0].results = []; }],
  ['extra result', r => { r.suites[0].specs[0].tests[0].results.push(copy(r.suites[0].specs[0].tests[0].results[0])); }],
  ['retry', r => { r.suites[0].specs[0].tests[0].results[0].retry = 1; }],
  ['failure', r => { r.suites[0].specs[0].tests[0].results[0].status = 'failed'; }],
  ['test error', r => { r.suites[0].specs[0].tests[0].results[0].errors.push({message: 'bad'}); }],
  ['flaky', r => { r.suites[0].specs[0].tests[0].status = 'flaky'; }],
  ['new skip', r => { r.suites[0].specs[0].tests[0].expectedStatus = 'skipped'; }],
  ['multiple workers', r => { r.config.workers = 2; }],
]) test('report gate rejects ' + name, () => {
  const baseline = report([spec('one'), spec('two')]);
  const changed = copy(baseline); mutate(changed);
  assert.throws(() => verifyReports(baseline, [changed]));
});

test('report gate accepts only the documented pre-existing dynamic skip', () => {
  const expected = report([spec('shows warning toast for timestamp collision')]);
  const suite = expected.suites[0];
  suite.title = 'warpdiff.spec.ts';
  suite.suites = [{title: 'File Loading & Slot Assignment', specs: suite.specs}];
  suite.specs = [];
  suite.suites[0].specs[0].file = 'warpdiff.spec.ts';
  const actual = copy(expected), t = actual.suites[0].suites[0].specs[0].tests[0];
  t.expectedStatus = t.status = t.results[0].status = 'skipped';
  t.annotations = [{type: 'skip', description: 'Needs fixtures with near-identical lastModified timestamps'}];
  assert.equal(verifyReports(expected, [actual]).skipped, 1);
  t.annotations = [];
  assert.throws(() => verifyReports(expected, [actual]));
});

test('public staging pins and verifies runtime bytes, includes notices and excludes tooling', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-pages-test-'));
  try {
    const sha = 'a'.repeat(40), output = path.join(directory, 'site');
    const result = stagePages({root, output, sha});
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'version.json'))), {sha});
    for (const file of pageFiles(root).filter(f => !['version.json','index.html','sw.js'].includes(f))) {
      assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(root, file)));
    }
    const prefix = 'releases/' + sha + '/';
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert(html.includes('<base href="./' + prefix + '">'));
    const background = JSON.parse(html.match(/<script id="warpdiff-background-scripts" type="application\/json">([^<]+)<\/script>/)[1]);
    assert.deepEqual(Object.keys(background).sort(), ['js/audio-analysis-worker.js','js/scrub-worklet.js','js/signalsmith-worklet.js']);
    for (const file of ['js/scrub-worklet.js','js/signalsmith-worklet.js']) {
      assert.deepEqual(Buffer.from(background[file],'base64'),fs.readFileSync(path.join(root,file)));
    }
    const workerSource = Buffer.from(background['js/audio-analysis-worker.js'],'base64').toString();
    const embeddedAlgorithm = workerSource.match(/importScripts\('data:text\/javascript;base64,([^']+)'\);/)[1];
    assert.deepEqual(Buffer.from(embeddedAlgorithm,'base64'),fs.readFileSync(path.join(root,'js/audio-viz.js')));
    assert.equal(workerSource.replace(/importScripts\('data:text\/javascript;base64,[^']+'\);/, "importScripts('audio-viz.js');"),
      fs.readFileSync(path.join(root,'js/audio-analysis-worker.js'),'utf8'));
    const worker = fs.readFileSync(path.join(output, 'sw.js'), 'utf8');
    const release = vm.runInNewContext(worker + '\nRELEASE', {URL, Set,
      self:{registration:{scope:'https://example.test/warpdiff/'},addEventListener(){}}});
    assert.equal(release.sha, sha);
    const integrity = bytes => 'sha256-' + createHash('sha256').update(bytes).digest('base64');
    for (const [file, hash] of Object.entries(release.files)) {
      assert.equal(integrity(fs.readFileSync(path.join(output, file))), hash);
    }
    const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
    assert.equal(scriptTags.length, [...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b[^>]*\bsrc=/g)].length);
    for (const tag of scriptTags) assert.match(tag[0], /integrity="sha256-[^"]+"/, 'Every runtime script must be pinned');
    for (const match of html.matchAll(/<script src="([^"]+)" integrity="([^"]+)"/g)) {
      assert.equal(integrity(fs.readFileSync(path.join(output, prefix + match[1]))), match[2]);
    }
    for (const file of pageFiles(root).filter(f => !['sw.js','index.html','manifest.json','version.json'].includes(f))) {
      assert.deepEqual(fs.readFileSync(path.join(output, prefix + file)), fs.readFileSync(path.join(root, file)));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(output, prefix + 'manifest.json')));
    assert.equal(manifest.start_url, '../../');assert.equal(manifest.scope, '../../');
    assert(!Object.hasOwn(manifest, 'id'), 'Preserve the released start-URL-derived application identity');
    assert(result.files['js/signalsmith-LICENSE.txt']);
    for (const file of ['output', 'tests', 'docs', 'tools', 'ffmpeg', 'package.json', '.github']) {
      assert(!fs.existsSync(path.join(output, file)), file + ' must not be published');
    }
    assert.throws(() => stagePages({root, output, sha}), /overwrite/);
    assert.throws(() => stagePages({root, output: path.join(directory, 'invalid'), sha: 'invalid'}), /revision/);
    const fake = path.join(directory, 'fake');fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'sw.js'), "const ASSETS = ['../private.txt'];");
    assert.throws(() => pageFiles(fake), /Unexpected public asset/);
    fs.writeFileSync(path.join(fake, 'sw.js'), "const ASSETS = ['output/private.json'];");
    assert.throws(() => pageFiles(fake), /Unexpected public asset/);
    fs.writeFileSync(path.join(fake, 'sw.js'), "const ASSETS = ['index.html'];");
    execFileSync('git', ['init', '-q'], {cwd: fake});
    fs.writeFileSync(path.join(fake, 'index.html'), 'untracked');
    assert.throws(() => stagePages({root: fake, output: path.join(directory, 'untracked'), sha}), /must be tracked/);
    fs.unlinkSync(path.join(fake, 'index.html'));
    fs.writeFileSync(path.join(fake, 'target.html'), 'private');
    fs.symlinkSync('target.html', path.join(fake, 'index.html'));
    for (const file of pageFiles(fake).filter(f => f !== 'index.html' && f !== 'sw.js')) {
      fs.mkdirSync(path.dirname(path.join(fake, file)), {recursive: true});
      fs.writeFileSync(path.join(fake, file), 'fixture');
    }
    execFileSync('git', ['add', '.'], {cwd: fake});
    assert.throws(() => stagePages({root: fake, output: path.join(directory, 'symlink'), sha}), /regular files/);
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('generated evidence is ignored by Git and excluded from legacy Pages', () => {
  for (const file of ['output/probe.spec.ts', 'output/nested/report.json', 'blob-report/report.zip']) {
    assert.equal(execFileSync('git', ['check-ignore', file], {cwd: root}).toString().trim(), file);
  }
  assert(parse(fs.readFileSync(path.join(root, '_config.yml'), 'utf8')).exclude.includes('output/'));
});

function updateWorker({failInstall=false, clientSha, unknown=false, existing=false}={}) {
  const listeners={}, deleted=[], added=[], stamps=new Map();let skipped=false;
  const sha='b'.repeat(40), scope='https://example.test/app/';
  const source=fs.readFileSync(path.join(root,'sw.js'),'utf8').replace('const RELEASE = null;',
    'const RELEASE = '+JSON.stringify({sha,files:{'index.html':'sha256-'+Buffer.alloc(32).toString('base64')}})+';');
  const metadata = new Map();
  const caches={keys:async()=>[...stamps.keys()],delete:async name=>{deleted.push(name);stamps.delete(name);return true;},
    open:async name=>({addAll:async requests=>{added.push(...requests);if(failInstall)throw Error('Bad bundle');},
      put:async(url,response)=>{metadata.set(name,await response.json());stamps.set(name,true);},
      match:async()=>metadata.has(name)?new Response(JSON.stringify(metadata.get(name))):undefined})};
  const client={url:scope,postMessage:(_,ports)=>{if(!unknown)ports[0].postMessage({sha:clientSha});}};
  const context=vm.createContext({URL,Set,Map,Promise,Request,Response,MessageChannel,setTimeout,clearTimeout,
    Date:class {static now(){throw Error('The wall clock must not order caches');}},
    self:{registration:{scope},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{skipped=true;},
      clients:{claim:async()=>{},matchAll:async()=>clientSha||unknown?[client]:[]}},caches});
  vm.runInContext(source,context); const name=vm.runInContext('RELEASE_CACHE',context);
  if(existing){stamps.set(name,true);metadata.set(name,{sequence:20});}
  return {name,added,deleted,stamps,metadata,skipped:()=>skipped,
    add:(name,time)=>{stamps.set(name,true);if(time!==null)metadata.set(name,{sequence:time});},
    run:async type=>{let pending;listeners[type]({waitUntil:p=>pending=p});await pending;}};
}

test('verified install bypasses the HTTP cache and activates only after all assets pass', async()=>{
  const worker=updateWorker();await worker.run('install');
  assert(worker.skipped());assert.equal(worker.added.length,1);
  assert.equal(worker.added[0].cache,'reload');assert.match(worker.added[0].integrity,/^sha256-/);
});
for(const existing of [false,true]) test('failed install '+(existing?'preserves an existing bundle':'removes its incomplete cache'),async()=>{
  const worker=updateWorker({failInstall:true,existing});await assert.rejects(worker.run('install'),/Bad bundle/);
  assert(!worker.skipped());assert.deepEqual(worker.deleted,existing?[]:[worker.name]);
});

test('an older controller cannot retire a newer installation or another app scope',async()=>{
  const worker=updateWorker({existing:true});
  const older=worker.name.replace('b'.repeat(40),'a'.repeat(40));
  const newer=worker.name.replace('b'.repeat(40),'c'.repeat(40));
  const sibling=older.replace('%2Fapp%2F','%2Fsibling%2F');
  worker.add(older,10);worker.add(newer,30);worker.add(sibling,5);worker.add('host-cache',null);worker.add('warpdiff-ffmpeg',null);
  await worker.run('activate');assert.deepEqual(worker.deleted.sort(),[older,'warpdiff-ffmpeg'].sort());
});
test('open comparisons retain their release cache',async()=>{
  const worker=updateWorker({existing:true,clientSha:'a'.repeat(40)});
  const older=worker.name.replace('b'.repeat(40),'a'.repeat(40));worker.add(older,10);
  await worker.run('activate');assert.deepEqual(worker.deleted,[]);
});
test('unidentified legacy clients conservatively preserve previous app caches',async()=>{
  const worker=updateWorker({existing:true,unknown:true});worker.add('warpdiff-v3.19.3',null);
  await worker.run('activate');assert.deepEqual(worker.deleted,[]);
});

test('installation ordering advances beyond retained generations without consulting the wall clock',async()=>{
  const worker=updateWorker();worker.add(worker.name.replace('b'.repeat(40),'a'.repeat(40)),30);
  await worker.run('install');assert(worker.metadata.get(worker.name).sequence>30);assert(worker.skipped());
});
