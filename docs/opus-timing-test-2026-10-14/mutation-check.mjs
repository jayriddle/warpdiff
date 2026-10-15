// Run from any directory with the existing localhost:8080 test server available.
// Copies the actual test file; only isolated browser responses are mutated.
// An optional first argument selects a fresh output directory for retained evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=process.argv[2] ? path.resolve(process.argv[2]) : path.join(root,'output/opus-timing-test-2026-10-14/mutations');
const source=fs.readFileSync(path.join(root,'js/opus-sync.js'),'utf8');
const spec=fs.readFileSync(path.join(root,'tests/warpdiff.spec.ts'),'utf8');
const cases=[
  {name:'baseline',grep:'Opus deferred-start window'},
  {name:'missing-pending-cancel',grep:'stopping a pending source',
    assertion:'Pending cancellation preserves the previous fade deadline',
    from:'if (gain && _opusSyncStartCtx[slot] > ctx.currentTime) {',to:'if (false) {'},
  {name:'cancel-at-start-boundary',grep:'stopping at the scheduled start',
    assertion:'An audible stop extends the fade deadline',
    from:'if (gain && _opusSyncStartCtx[slot] > ctx.currentTime) {',to:'if (gain && _opusSyncStartCtx[slot] >= ctx.currentTime) {'},
  {name:'missing-offset-compensation',grep:'deferred start compensates the buffer offset',
    assertion:'Deferred start compensates the media offset',
    from:'let startVideoTime = fromTime + (startTime - ctx.currentTime) * rate;',to:'let startVideoTime = fromTime;'},
  {name:'pending-rate-reanchors',grep:'rate change during the pending window',
    assertion:'Pending rate change preserves the media anchor',
    from:'if (elapsed >= 0) {',to:'if (true) {'},
];
const result={at:new Date().toISOString(),cases:[]};
for(const variant of cases){
  const directory=path.join(output,variant.name);fs.mkdirSync(directory,{recursive:true});
  let response=source;
  if(variant.from){
    assert.equal(source.split(variant.from).length,2,'Unique mutation target: '+variant.name);
    response=source.replace(variant.from,variant.to);
  }
  const route=`\ntest.use({serviceWorkers:'block'});\ntest.beforeEach(async ({page}) => {\n  await page.route('**/js/opus-sync.js',route=>route.fulfill({contentType:'text/javascript',body:${JSON.stringify(response)}}));\n});\n`;
  const fixtures="const fixturesDir = path.join(__dirname, 'fixtures');";
  assert(spec.includes(fixtures));
  const probeFile=path.join(directory,'probe.spec.ts');
  const probe=spec.replace(fixtures,'const fixturesDir = '+JSON.stringify(path.join(root,'tests/fixtures'))+';')+route;
  const assertionLines=variant.assertion ? probe.split('\n').flatMap((line,i)=>
    line.includes("'"+variant.assertion+"'") && /^\s*expect\(/.test(line) ? [i+1] : []) : [];
  if(variant.assertion)assert.equal(assertionLines.length,1,'Unique behavioral assertion: '+variant.name);
  fs.writeFileSync(probeFile,probe);
  const reportFile=path.join(directory,'report.json');
  fs.writeFileSync(path.join(directory,'config.ts'),`export default ${JSON.stringify({
    testDir:directory,testMatch:'probe.spec.ts',workers:1,retries:0,timeout:60000,
    outputDir:path.join(directory,'test-results'),
    reporter:[['line'],['json',{outputFile:reportFile}]],
    use:{baseURL:'http://localhost:8080',viewport:{width:1280,height:720},serviceWorkers:'block'},
    projects:[{name:'chromium',use:{browserName:'chromium',channel:'chrome',
      launchOptions:{args:['--autoplay-policy=no-user-gesture-required','--mute-audio']}}}],
  })};\n`);
  const run=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(directory,'config.ts'),'--grep',variant.grep],
    {cwd:root,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  fs.writeFileSync(path.join(directory,'run.txt'),(run.stdout||'')+(run.stderr||''));
  assert(!run.error,String(run.error));
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  const specs=[];
  const visit=suite=>{specs.push(...(suite.specs||[]));for(const child of suite.suites||[])visit(child);};
  for(const suite of report.suites)visit(suite);
  const testResults=specs.flatMap(s=>s.tests.flatMap(t=>t.results));
  const failures=specs.flatMap(s=>s.tests.flatMap(t=>t.results.filter(r=>r.status==='failed').map(r=>({title:s.title,error:r.error?.message,location:r.error?.location}))));
  const data={name:variant.name,exit:run.status,stats:report.stats,
    expectedAssertion:variant.assertion,expectedAssertionLine:assertionLines[0],failures};result.cases.push(data);
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
  assert.equal(report.errors.length,0,'No runner/setup errors');
  assert.equal(report.stats.skipped,0);assert.equal(report.stats.flaky,0);
  assert(testResults.every(r=>r.retry===0),'No retries');
  if(!variant.from){assert.equal(run.status,0);assert.equal(report.stats.expected,8);assert.equal(report.stats.unexpected,0);}
  else{
    assert.equal(run.status,1);assert.equal(report.stats.unexpected,1);
    assert.equal(testResults.length,1);assert.equal(failures.length,1);
    assert.equal(testResults[0].errors.length,1,'Exactly the intended assertion fails');
    assert(failures[0].error.includes(variant.assertion),'Failure must reach the intended behavioral assertion: '+variant.name);
    assert.equal(failures[0].location?.file,probeFile,'Failure must be in the copied scenario');
    assert.equal(failures[0].location?.line,assertionLines[0],'Reject failed setup/precondition assertions');
  }
  data.verified=true;fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(data));
}
result.passed=true;fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
