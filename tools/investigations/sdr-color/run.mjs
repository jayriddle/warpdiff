// Standalone diagnostics: one browser at a time, no retry, no application patches.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { makeFixtures, ffmpeg, reference, sha256 } from './fixtures.mjs';
import { nativeChecks, difference, assertCopyPreserved } from './native.mjs';
import { browserChecks } from './browser.mjs';
import { pageFiles } from '../../../scripts/stage-pages.mjs';
const releasedBaseline = '3270b02fabf862c1aa8d4eed50343d33956b6227';
const root = process.cwd();
assert(fs.existsSync(path.join(root, 'index.html')), 'Run from the WarpDiff repository root');
const requested = process.argv.slice(2);
assert(requested.length <= 1, 'Usage: node tools/investigations/sdr-color/run.mjs [new-output-directory]');
fs.mkdirSync('output', {
  recursive: true
});
const directory = requested.length ? path.resolve(requested[0]) : fs.mkdtempSync(path.resolve('output/sdr-color-'));
if (requested.length) fs.mkdirSync(directory, {
  recursive: false
});
const write = (file, data) => fs.writeFileSync(path.join(directory, file), JSON.stringify(data, null, 2));
const git = args => execFileSync('git', args, {
  maxBuffer: 4 * 1024 * 1024
}).toString().trim();
const fixtureSnapshot = () => Object.fromEntries(fs.readdirSync('tests/fixtures').filter(f => fs.statSync('tests/fixtures/' + f).isFile()).map(f => {
  const file = 'tests/fixtures/' + f,
    s = fs.statSync(file);
  return [file, {
    sha256: sha256(fs.readFileSync(file)),
    size: s.size,
    mtimeMs: s.mtimeMs
  }];
}));
const before = fixtureSnapshot(),
  record = {
    startedAt: new Date().toISOString(),
    directory,
    head: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    releasedBaseline,
    productionChanged: null,
    methods: {
      browserConcurrency: 1,
      retries: 0,
      colors: 'Explicit SDR sRGB readback; two matrix references; reference differences reported separately from app preservation.',
      display: 'Headless browser compositor captures, not physical screen/colorimeter measurements.'
    },
    versions: {
      node: process.version,
      ffmpeg: execFileSync('ffmpeg', ['-version']).toString().split('\n')[0],
      ffprobe: execFileSync('ffprobe', ['-version']).toString().split('\n')[0]
    },
    findings: []
  };
console.log('SDR diagnostic evidence: ' + directory);
try {
  record.sourceHashes = Object.fromEntries([...pageFiles(root), 'tools/media-prepare/companion/processor.mjs', ...fs.readdirSync('tools/investigations/sdr-color').filter(f => f.endsWith('.mjs')).map(f => 'tools/investigations/sdr-color/' + f)].map(f => [f, sha256(fs.readFileSync(f))]));
  const unchanged = [...pageFiles(root), 'tools/media-prepare/companion/processor.mjs'].every(f => fs.readFileSync(f).equals(execFileSync('git', ['show', releasedBaseline + ':' + f], {
    maxBuffer: 2 * 1024 * 1024
  })));
  // Preserve the released comparison point while allowing this diagnostic to test future fixes.
  record.productionChanged = !unchanged;
  const fixtures = makeFixtures(path.join(directory, 'fixtures'));
  write('fixtures.json', fixtures);
  for (const f of fixtures.cases) {
    assert.equal(f.rawHash, fixtures.rawHash, f.name + ' generation changed the input samples');
    if (f.matrix) {
      assert.equal(f.metadata.color_space, f.matrix);
      assert.equal(f.metadata.color_range, f.range);
      assert.equal(f.metadata.color_primaries, f.primaries);
      assert.equal(f.metadata.color_transfer, f.transfer);
    }
  }
  await nativeChecks(fixtures, directory, record);
  write('native-results.json', record.native);
  const tagged = fixtures.cases.find(c => c.name === 'srgb-transfer');
  tagged.references.wrongRange = reference(tagged.file, 'bt709', 'pc');
  // Deliberately alter only color interpretation. The same decoded samples must not make this pass.
  const good = record.native.find(c => c.name === 'matrix709-limited' && c.passed);
  assert(good);
  const mutant = path.join(directory, 'wrong-matrix-control.mp4');
  ffmpeg(['-i', good.output, '-c', 'copy', '-bsf:v', 'h264_metadata=matrix_coefficients=6', '-colorspace', 'smpte170m', mutant]);
  assert.throws(() => assertCopyPreserved(good.input, mutant), /Copied color metadata changed/);
  record.negativeControls = {
    changedMetadataRejected: true
  };
  await browserChecks(fixtures, record.native, directory, record);
  for (const b of record.browsers) {
    const srgb = b.cases.find(c => c.name === 'srgb-transfer');
    assert(srgb.referenceError.bt709 <= 2, b.engine + ' explicitly sRGB-tagged reference does not match');
    assert(srgb.referenceError.bt601 >= 20, 'Wrong-matrix control was not discriminating');
    assert(difference(srgb.bare.samples, tagged.references.wrongRange) > 10, 'Wrong-range control was not discriminating');
    const red601 = b.red.find(c => c.name === 'red-tag601'),
      red709 = b.red.find(c => c.name === 'red-tag709'),
      untagged = b.red.find(c => c.name === 'red-untagged');
    assert(red601.original[1] <= 2 && red709.original[1] >= 20, 'Tagged red matrix control failed');
    assert.deepEqual(untagged.original, red709.original, 'HD untagged red no longer matches this recorded browser inference');
    b.referenceControls = {
      srgbWithin2: true,
      wrongMatrixRejected: true,
      wrongRangeRejected: true
    };
    if (b.surfaces.videoDifferenceError > 1) {
      record.findings.push({
        id: 'video-difference',
        engine: b.engine,
        severity: 'P2',
        maxCodeError: b.surfaces.videoDifferenceError,
        controlDirectError: difference(b.surfaces.blendControl.direct, b.surfaces.videoDifferenceExpected),
        controlStagedError: difference(b.surfaces.blendControl.staged, b.surfaces.videoDifferenceExpected),
        description: 'Direct video difference blending does not match independently sampled RGB subtraction. Canvas-staging control is retained.'
      });
    }
    const scrub = b.surfaces.scrub;
    if (scrub.path === 'webcodecs' && scrub.screenError > 2) {
      assert(scrub.withoutFilterError <= 2, 'Scrub screenshot also differs without the filter; investigate capture occlusion before assigning a color cause');
      record.findings.push({
        id: 'scrub-filter',
        engine: b.engine,
        severity: 'P2',
        maxCodeError: scrub.screenError,
        rawError: scrub.rawError,
        withoutFilterError: scrub.withoutFilterError,
        environment: b.environment,
        description: 'The active scrub correction changes the compositor result despite matching raw decoded pixels. Physical P3 behavior is not established.'
      });
    }
  }
  for (const n of record.native.filter(n => !n.passed)) record.findings.push({
    id: 'preparation-' + n.name,
    severity: 'P2',
    error: n.error,
    description: 'Preparation did not satisfy the tested picture/metadata preservation case. A rejection is not a color-conformance pass.'
  });
  record.summary = {
    nativeCases: record.native.length,
    nativePassed: record.native.filter(n => n.passed).length,
    nativeFailed: record.native.filter(n => !n.passed).length,
    browserEngines: record.browsers.length,
    browserFixtureCases: record.browsers.reduce((n, b) => n + b.cases.length, 0),
    redControls: record.browsers.reduce((n, b) => n + b.red.length, 0),
    findings: record.findings.length,
    conformance: 'not-certified'
  };
  record.status = record.findings.length ? 'findings' : 'passed';
  process.exitCode = record.findings.length ? 1 : 0;
} catch (error) {
  record.status = 'harness-failure';
  record.error = error.stack;
  process.exitCode = 2;
  console.error(error.stack);
} finally {
  record.completedAt = new Date().toISOString();
  record.fixturePreservation = {
    before,
    after: fixtureSnapshot()
  };
  try {
    assert.deepEqual(record.fixturePreservation.after, before);
    record.fixturePreservation.passed = true;
  } catch (error) {
    record.fixturePreservation.passed = false;
    record.fixturePreservation.error = error.message;
    process.exitCode = 2;
  }
  write('verification.json', record);
  console.log(JSON.stringify({
    status: record.status,
    ...record.summary,
    findingsCount: record.findings.length,
    findingDetails: record.findings.map(({
      id,
      engine,
      maxCodeError
    }) => ({
      id,
      engine,
      maxCodeError
    })),
    evidence: directory
  }, null, 2));
}
