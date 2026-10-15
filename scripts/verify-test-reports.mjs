import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const allowedSkip = JSON.stringify(['warpdiff.spec.ts', 'File Loading & Slot Assignment',
  'shows warning toast for timestamp collision', 'chromium']);

export function inventory(report) {
  assert.deepEqual(report.errors || [], [], 'Report contains runner errors');
  const tests = [];
  function visit(suite, parents = []) {
    for (const spec of suite.specs || []) for (const test of spec.tests) {
      tests.push({key: JSON.stringify([spec.file, ...parents, spec.title, test.projectName]), test});
    }
    for (const child of suite.suites || []) visit(child, [...parents, child.title]);
  }
  // The outer suite title is the file, already included as spec.file.
  for (const suite of report.suites) visit(suite);
  assert(tests.length > 0, 'Empty test inventory');
  assert.equal(new Set(tests.map(t => t.key)).size, tests.length, 'Duplicate test identities');
  return tests;
}

export function verifyReports(expected, reports) {
  const wanted = new Map(inventory(expected).map(t => [t.key, t.test.expectedStatus]));
  const seen = new Set();
  let passed = 0, skipped = 0;
  for (const report of reports) {
    assert.equal(report.config.workers, 1, 'One worker per machine');
    for (const {key, test} of inventory(report)) {
      assert(wanted.has(key), 'Unexpected test: ' + key);
      assert(!seen.has(key), 'Repeated test across shards: ' + key);
      seen.add(key);
      // This pre-existing skip is declared inside the test body, so --list
      // reports "passed". No other dynamic or static skips may pass the gate.
      if (test.expectedStatus === 'skipped') {
        assert.equal(key, allowedSkip, 'Unapproved skipped test: ' + key);
        assert(test.annotations.some(a => a.type === 'skip' &&
          a.description === 'Needs fixtures with near-identical lastModified timestamps'), 'Missing existing skip reason');
      } else assert.equal(test.expectedStatus, 'passed', 'Expected failures are not release passes');
      assert.equal(test.results.length, 1, 'Missing execution or retry: ' + key);
      const result = test.results[0];
      assert.equal(result.retry, 0, 'Retries are not accepted: ' + key);
      assert.equal(test.status, test.expectedStatus === 'skipped' ? 'skipped' : 'expected', 'Flaky/failed test: ' + key);
      assert.equal(result.status, test.expectedStatus, 'Unexpected execution status: ' + key);
      assert.deepEqual(result.errors || [], [], 'Test errors: ' + key);
      assert(['passed', 'skipped'].includes(result.status), 'Expected failures are not release passes');
      if (result.status === 'skipped') skipped++; else passed++;
    }
  }
  assert.equal(seen.size, wanted.size, 'Missing tests from complete inventory');
  return {total: seen.size, passed, skipped, reports: reports.length};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inventoryFile, directory] = process.argv.slice(2);
  assert(inventoryFile && directory, 'Usage: node scripts/verify-test-reports.mjs <inventory.json> <reports-directory>');
  const files = fs.readdirSync(directory).filter(f => /^chromium-[123]\.json$/.test(f)).sort();
  assert.deepEqual(files, ['chromium-1.json', 'chromium-2.json', 'chromium-3.json'], 'All three shard reports are required');
  console.log(JSON.stringify(verifyReports(JSON.parse(fs.readFileSync(inventoryFile)),
    files.map(f => JSON.parse(fs.readFileSync(path.join(directory, f))))), null, 2));
}
