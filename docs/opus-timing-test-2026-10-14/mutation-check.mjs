// Run from any directory with the existing localhost:8080 test server available.
// Copies the actual test file; only isolated browser responses are mutated.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'output/opus-timing-test-2026-10-14/mutations');
const source=fs.readFileSync(path.join(root,'js/opus-sync.js'),'utf8');
const spec=fs.readFileSync(path.join(root,'tests/warpdiff.spec.ts'),'utf8');
const cases=[
  {name:'baseline',grep:'Opus deferred-start window'},
  {name:'missing-pending-cancel',grep:'stopping a pending source',
    from:'if (gain && _opusSyncStartCtx[slot] > ctx.currentTime) {',to:'if (false) {'},
  {name:'cancel-at-start-boundary',grep:'stopping at the scheduled start',
    from:'if (gain && _opusSyncStartCtx[slot] > ctx.currentTime) {',to:'if (gain && _opusSyncStartCtx[slot] >= ctx.currentTime) {'},
  {name:'missing-offset-compensation',grep:'deferred start compensates the buffer offset',
    from:'let startVideoTime = fromTime + (startTime - ctx.currentTime) * rate;',to:'let startVideoTime = fromTime;'},
  {name:'pending-rate-reanchors',grep:'rate change during the pending window',
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
  fs.writeFileSync(path.join(directory,'probe.spec.ts'),spec.replace(fixtures,'const fixturesDir = '+JSON.stringify(path.join(root,'tests/fixtures'))+';')+route);
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
  const failures=specs.flatMap(s=>s.tests.flatMap(t=>t.results.filter(r=>r.status==='failed').map(r=>({title:s.title,error:r.error?.message}))));
  const data={name:variant.name,exit:run.status,stats:report.stats,failures};result.cases.push(data);
  fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
  if(!variant.from){assert.equal(run.status,0);assert.equal(report.stats.expected,8);assert.equal(report.stats.unexpected,0);}
  else{
    assert.equal(run.status,1);assert.equal(report.stats.unexpected,1);
    assert.equal(failures.length,1);assert.match(failures[0].error,/expect\(/);
  }
  console.log(JSON.stringify(data));
}
result.passed=true;fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(result,null,2));
