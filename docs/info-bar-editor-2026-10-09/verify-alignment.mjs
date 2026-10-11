// Reproducible local UI/geometry probes for the Left/Right and drag continuation.
// Run from the repository root with its static server on port 8080.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const output = new URL('./',import.meta.url);
const browser = await chromium.launch({headless:true});
const result = {date:'2026-10-09',browser:'Playwright Chromium',cases:[],errors:[]};
const specs = [
  ['portrait-four-narrow',320,736,'portrait.mp4',4,'inline'],
  ['portrait-four-short',320,400,'portrait.mp4',4,'inline'],
  ['portrait-four-tablet-short',736,400,'portrait.mp4',4,'inline'],
  ['portrait-three-inline',320,400,'portrait.mp4',3,'inline'],
  ['portrait-three-offset',320,400,'portrait.mp4',3,'offset'],
  ['portrait-two-short',320,400,'portrait.mp4',2,'inline'],
  ['image-four-narrow',320,736,'tall.png',4,'inline'],
  ['image-three-short',320,400,'tall.png',3,'inline'],
  ['audio-four-narrow',320,736,'stereo.wav',4,'inline'],
  ['editor-desktop',1280,820,'landscape_a.mp4',2,'inline'],
  ['editor-touch-narrow',320,736,'landscape_a.mp4',2,'inline']
];
try {
  for (const [name,width,height,file,count,layout] of specs) {
    const context = await browser.newContext({viewport:{width,height},hasTouch:name.includes('touch')});
    const page = await context.newPage();page.on('pageerror',error=>result.errors.push({name,message:error.message}));
    await page.addInitScript(()=>localStorage.setItem('lastSeenVersion','999.0.0'));
    await page.goto('http://localhost:8080');await page.locator('#infoEditorButton').click();
    await page.locator('#infoEditorType').selectOption(file.endsWith('.png')?'image':file.endsWith('.wav')?'audio':'video');
    await page.locator('#infoEditorPreset').selectOption('all');await page.locator('#infoEditorClose').click();
    await page.locator('#multiFileInput').setInputFiles(Array(count).fill('tests/fixtures/'+file));
    await page.locator('#comparisonView.active').waitFor();
    if (count===3) await page.locator(layout==='inline'?'#inlineModeBtn':'#offsetModeBtn').click();
    await page.waitForFunction(n=>document.querySelectorAll('.asset-info-bar.info-custom').length===n,count);
    await page.waitForTimeout(600); // Includes media fade and late source metadata publication.
    const boxes = await page.locator('.asset-info-bar.info-custom').evaluateAll(bars=>bars.map(bar=>{
      const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      const bounds=rect(bar), cell=rect(bar.closest('.asset-layer'));
      const fields=[...bar.querySelectorAll('.info-item:not([hidden]),.info-more:not([hidden]),.asset-name')];
      return {bounds,cell,zoom:bar.querySelector('.info-field-zoom')?.textContent,
        controlsWithinBar:fields.every(field=>{const b=rect(field);return b.left>=bounds.left-1 && b.right<=bounds.right+1;}),
        barWithinCell:bounds.left>=cell.left-1 && bounds.right<=cell.right+1,
        barWithinViewport:bounds.left>=0 && bounds.right<=innerWidth,
        rightEdge:bar.querySelector('.info-section-right .info-item:not([hidden]):last-child') ? rect(bar.querySelector('.info-section-right .info-item:not([hidden]):last-child')).right : null};
    }));
    const geometry={name,width,height,file,count,layout,bars:boxes};
    if(name.startsWith('editor')) {
      await page.locator('#infoEditorButton').click();
      await page.locator('#infoEditorPreset').selectOption('visual');
      await page.locator('[data-info-select="zoom"]').click();await page.locator('#infoEditorBold').check();
      geometry.dialog=await page.locator('#infoEditorDialog').evaluate(dialog=>({width:dialog.clientWidth,contentWidth:dialog.scrollWidth,x:dialog.getBoundingClientRect().x,y:dialog.getBoundingClientRect().y}));
      await page.screenshot({path:new URL('alignment-'+name+'.png',output).pathname});await page.locator('#infoEditorClose').click();
    } else if(name.includes('four') && !file.endsWith('.wav')) await page.screenshot({path:new URL('alignment-'+name+'.png',output).pathname});
    const idle=await page.evaluate(async()=>{
      await new Promise(resolve=>requestAnimationFrame(resolve));let refreshes=0;
      const original=window._refreshInfoBars;window._refreshInfoBars=function(...args){refreshes++;return original(...args);};
      for(let frame=0;frame<40;frame++) await new Promise(resolve=>requestAnimationFrame(resolve));
      window._refreshInfoBars=original;return refreshes;
    });
    geometry.idleRefreshes=idle;
    geometry.pass=boxes.every(bar=>bar.controlsWithinBar && bar.barWithinCell && bar.barWithinViewport) && idle<8 && (!geometry.dialog || geometry.dialog.contentWidth<=geometry.dialog.width+1);
    result.cases.push(geometry);console.log(JSON.stringify({name,pass:geometry.pass,idleRefreshes:idle}));
    await context.close();
  }
} finally {await browser.close();await writeFile(new URL('alignment-ui.json',output),JSON.stringify(result,null,2)+'\n');}
if(result.errors.length || result.cases.some(item=>!item.pass)) process.exitCode=1;
