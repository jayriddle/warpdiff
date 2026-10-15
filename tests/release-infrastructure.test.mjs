import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
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

test('public staging preserves runtime bytes, includes notices and excludes tooling', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'warpdiff-pages-test-'));
  try {
    const sha = 'a'.repeat(40), output = path.join(directory, 'site');
    const result = stagePages({root, output, sha});
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, 'version.json'))), {sha});
    for (const file of Object.keys(result.files).filter(f => f !== 'version.json')) {
      assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(root, file)));
    }
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
